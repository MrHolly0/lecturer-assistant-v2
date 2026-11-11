#!/usr/bin/env sh
# Lecturer Assistant в Kubernetes (k3s). Две площадки:
#   mac   — виртуальные Linux-машины Lima на этом Mac, лёгкий профиль (одна копия каждого сервиса);
#   linux — арендованные Linux-серверы по SSH, полный профиль (реплики, автомасштабирование, HTTPS).
#
#   sh deploy/k8s/lecturer-k8s.sh init        один раз: площадка, адрес, бот MAX, секреты в deploy/k8s/.state
#   sh deploy/k8s/lecturer-k8s.sh up          всё сразу: cluster + platform + build + deploy
#
#   sh deploy/k8s/lecturer-k8s.sh cluster     подготовить узлы и установить k3s
#   sh deploy/k8s/lecturer-k8s.sh platform    реестр образов, cert-manager, операторы БД и RabbitMQ (+ KEDA, Prometheus)
#   sh deploy/k8s/lecturer-k8s.sh build       собрать образы и положить во внутренний реестр
#   sh deploy/k8s/lecturer-k8s.sh deploy      данные, секреты, приложение, автомасштабирование
#
#   sh deploy/k8s/lecturer-k8s.sh status      узлы, поды, масштабирование, проверка сайта
#   sh deploy/k8s/lecturer-k8s.sh logs <компонент>   например core, realtime, edge, max-adapter
#   sh deploy/k8s/lecturer-k8s.sh admin       создать первого администратора
#   sh deploy/k8s/lecturer-k8s.sh lock-setup  закрыть создание администратора
#   sh deploy/k8s/lecturer-k8s.sh backup      дамп обеих БД и архив файлов презентаций на этот компьютер
#   sh deploy/k8s/lecturer-k8s.sh kubectl ... любая команда kubectl в кластере
#   sh deploy/k8s/lecturer-k8s.sh stop | start    (mac) остановить / запустить VM, данные сохраняются
#   sh deploy/k8s/lecturer-k8s.sh destroy     (mac) удалить VM вместе со всеми данными кластера
set -eu

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
K8S=deploy/k8s
STATE="$K8S/.state"
SITE="$STATE/site.env"
SECRETS="$STATE/secrets.env"
IMAGES="$STATE/images.json"
NS=lecturer
REGISTRY_NAME=registry.lecturer.local
# shellcheck disable=SC1091
. "$K8S/versions.env"

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

file_value() { [ -f "$2" ] && sed -n "s/^$1=//p" "$2" | tail -1 || true; }
site() { v="$(file_value "$1" "$SITE")"; echo "${v:-${2:-}}"; }
secret_value() { file_value "$1" "$SECRETS"; }

set_value() {
  file="$1"; key="$2"; value="$3"
  touch "$file"; chmod 600 "$file"
  if grep -q "^$key=" "$file"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'index($0, k"=")==1 {print k"="v; next} {print}' "$file" > "$tmp"
    cat "$tmp" > "$file" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

PLATFORM="$(site PLATFORM lima)"
CLUSTER="$(site CLUSTER_NAME lecturer-k8s)"
EDGE_PORT="$(site EDGE_PORT 18088)"
BUILDER="$CLUSTER-builder"
SERVERS="$(site SERVERS)"
SSH_OPTIONS="$(site SSH_OPTIONS)"
if [ "$PLATFORM" = linux ]; then
  NODE_COUNT="$(echo "$SERVERS" | wc -w | tr -d ' ')"
  SRC=/opt/lecturer-src
else
  NODE_COUNT="$(site NODE_COUNT 1)"
  SRC="$ROOT"
fi

# Lima по умолчанию пробрасывает на Mac каждый порт VM; эти правила это отключают.
NO_FORWARDS='- {guestIP: 0.0.0.0, guestPortRange: [1, 65535], proto: any, ignore: true}
- {guestPortRange: [1, 65535], proto: any, ignore: true}'

# ---------------------------------------------------------------------------- running commands on nodes

shell_quote() { for arg in "$@"; do printf "'%s' " "$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")"; done; }
node_indexes() { i=1; while [ "$i" -le "$NODE_COUNT" ]; do echo "$i"; i=$((i + 1)); done; }
vm_name() { echo "$CLUSTER-$1"; }
server_host() { echo "$SERVERS" | tr -s ' ' '\n' | sed -n "${1}p"; }

# on_node <номер узла> <команда...>: команда выполняется на узле; stdin передаётся.
on_node() {
  n="$1"; shift
  if [ "$PLATFORM" = linux ]; then
    # shellcheck disable=SC2086
    ssh $SSH_OPTIONS -o BatchMode=yes "$(server_host "$n")" "$(shell_quote "$@")"
  else
    limactl shell --workdir / "$(vm_name "$n")" -- "$@"
  fi
}
# Сборка: на Mac — в отдельной VM, на серверах — на первом узле.
on_builder() {
  if [ "$PLATFORM" = linux ]; then on_node 1 "$@"; else limactl shell --workdir / "$BUILDER" -- "$@"; fi
}
kc() { on_node 1 sudo k3s kubectl "$@"; }
render() { python3 "$K8S/render-site.py" "$@" --site "$SITE" --images "$IMAGES"; }
settings() { python3 "$K8S/render-site.py" show --site "$SITE"; }
profile() { settings | cut -d' ' -f2; }
public_mode() { settings | cut -d' ' -f3; }
autoscaling_on() { [ "$(settings | cut -d' ' -f4)" = true ]; }

vm_exists() { limactl list -q 2>/dev/null | grep -qx "$1"; }
vm_running() { [ "$(limactl list --format '{{.Status}}' "$1" 2>/dev/null)" = Running ]; }

require_tools() {
  if [ "$PLATFORM" = linux ]; then command -v ssh >/dev/null || die "нужен ssh"
  else command -v limactl >/dev/null || die "нужна Lima: brew install lima"; fi
  command -v python3 >/dev/null || die "нужен python3"
  command -v openssl >/dev/null || die "нужен openssl"
}

require_init() {
  [ -f "$SITE" ] && [ -f "$SECRETS" ] || die "сначала: sh $K8S/lecturer-k8s.sh init"
  settings >/dev/null || die "проверьте $SITE"
}

# ---------------------------------------------------------------------------- init

ask_site() {
  key="$1"; prompt="$2"; default="${3:-}"
  grep -q "^$key=" "$SITE" 2>/dev/null && return 0
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default"; else printf '%s: ' "$prompt"; fi
  read -r answer
  set_value "$SITE" "$key" "${answer:-$default}"
}

cmd_init() {
  mkdir -p "$STATE"; chmod 700 "$STATE"
  say "Настройка $STATE (уже заданные значения не меняются)."
  if ! grep -q '^PLATFORM=' "$SITE" 2>/dev/null; then
    say "Где разворачиваем?"
    say "  mac   — виртуальные машины на этом Mac, лёгкий профиль (~6 ГБ RAM)"
    say "  linux — свои Linux-серверы по SSH, полный профиль с репликами, автомасштабированием и HTTPS"
    printf 'Площадка (mac/linux) [mac]: '
    read -r answer
    case "${answer:-mac}" in mac|lima) set_value "$SITE" PLATFORM lima ;; linux) set_value "$SITE" PLATFORM linux ;;
      *) die "ответьте mac или linux" ;; esac
  fi
  PLATFORM="$(site PLATFORM)"
  require_tools

  if [ "$PLATFORM" = linux ]; then
    ask_site SERVERS "SSH-адреса серверов через пробел, первый — главный (например root@10.0.0.1 root@10.0.0.2 root@10.0.0.3)"
    ask_site PUBLIC_DOMAIN "Домен сайта (A-запись указывает на серверы)"
    ask_site ACME_EMAIL "Почта для Let's Encrypt"
    ask_site PRIVATE_IFACE "Сетевой интерфейс частной сети серверов (пусто — интерфейс маршрута по умолчанию)" ""
    last_host="$(echo "$(site SERVERS)" | tr -s ' ' '\n' | tail -1 | sed 's/.*@//')"
    echo "$last_host" | grep -Eq '^[0-9]+(\.[0-9]+){3}$' || last_host=""
    ask_site MEDIA_PUBLIC_IP "Публичный IPv4 последнего сервера — на нём видео (SFU); пусто — видео только внутри сети" "$last_host"
    defaults="PROFILE=full PUBLIC_MODE=ingress AUTOSCALING=true"
  else
    ask_site PUBLIC_DOMAIN "Публичный адрес туннеля без https://" lecturer-assistant.ru.tuna.am
    defaults="PROFILE=light PUBLIC_MODE=tunnel AUTOSCALING=false NODE_COUNT=1 NODE_CPUS=4 NODE_MEMORY_GIB=6 \
NODE_DISK_GIB=60 BUILDER_CPUS=4 BUILDER_MEMORY_GIB=4 BUILDER_DISK_GIB=60 EDGE_PORT=18088"
  fi
  for pair in CLUSTER_NAME=lecturer-k8s MAX_REGISTER_WEBHOOK_ON_START=true $defaults; do
    key="${pair%%=*}"
    grep -q "^$key=" "$SITE" || set_value "$SITE" "$key" "${pair#*=}"
  done
  ask_site VITE_MAX_BOT_NAME "Публичное имя бота MAX (пусто — пропустить)" ""
  if ! grep -q '^MAX_BOT_TOKEN=' "$SECRETS" 2>/dev/null; then
    printf 'Токен бота MAX (ввод скрыт; пусто — без бота): '
    stty -echo 2>/dev/null || true; read -r answer; stty echo 2>/dev/null || true; echo
    set_value "$SECRETS" MAX_BOT_TOKEN "$answer"
  fi

  for key in JWT_SECRET SLIDE_IMAGE_URL_SECRET CHANNEL_INTERNAL_API_KEY SERVICE_EVENTS_KEY SERVICE_REALTIME_KEY \
      SERVICE_ANALYTICS_KEY SERVICE_MEDIA_KEY ADMIN_SETUP_TOKEN LIVEKIT_API_SECRET REDIS_PASSWORD \
      CONTENT_DB_PASSWORD CONTENT_SCALER_PASSWORD ANALYTICS_SCALER_PASSWORD MAX_WEBHOOK_SECRET; do
    grep -q "^$key=" "$SECRETS" 2>/dev/null || set_value "$SECRETS" "$key" "$(openssl rand -hex 32)"
  done
  grep -q '^LIVEKIT_API_KEY=' "$SECRETS" || set_value "$SECRETS" LIVEKIT_API_KEY "API$(openssl rand -hex 24)"
  grep -q '^MAX_WEBHOOK_PATH=' "$SECRETS" || set_value "$SECRETS" MAX_WEBHOOK_PATH "/webhook/$(openssl rand -hex 24)"
  if [ ! -f "$STATE/turn.key" ]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=turn.lecturer.local \
      -keyout "$STATE/turn.key" -out "$STATE/turn.crt" 2>/dev/null
    chmod 600 "$STATE/turn.key"
  fi
  settings >/dev/null
  say ""
  say "Готово: $(settings | awk '{print "площадка " $1 ", профиль " $2 ", вход " $3}')."
  say "Настройки: $SITE, секреты: $SECRETS (права 600, в git не попадают). Сохраните secrets.env в менеджер паролей."
  say "Дальше: sh $K8S/lecturer-k8s.sh up"
}

# ---------------------------------------------------------------------------- cluster

write_node_config() {
  n="$1"; name="$(vm_name "$n")"; file="$STATE/lima/$name.yaml"
  mkdir -p "$STATE/lima"
  {
    echo "minimumLimaVersion: 2.0.0"
    echo "base: $UBUNTU_IMAGE"
    echo "vmType: vz"
    echo "cpus: $(site NODE_CPUS 4)"
    echo "memory: $(site NODE_MEMORY_GIB 6)GiB"
    echo "disk: $(site NODE_DISK_GIB 60)GiB"
    echo "mounts: []"
    echo "containerd: {system: false, user: false}"
    echo "networks:"
    echo "- lima: user-v2"
    # На Mac (только 127.0.0.1) выходят API Kubernetes и вход на сайт; всё остальное закрыто.
    echo "portForwards:"
    if [ "$n" = 1 ]; then
      echo "- {guestIP: 0.0.0.0, guestPort: 6443, hostIP: 127.0.0.1}"
      echo "- {guestIP: 0.0.0.0, guestPort: $EDGE_PORT, hostIP: 127.0.0.1}"
    fi
    echo "$NO_FORWARDS"
  } > "$file"
  echo "$file"
}

start_vm() {
  name="$1"; config="$2"
  if ! vm_exists "$name"; then
    say "Создаю VM $name"
    limactl create -y --name "$name" "$config" >/dev/null 2>&1 || die "не удалось создать VM $name"
  fi
  vm_running "$name" || limactl start -y "$name" >/dev/null 2>&1 || die "не удалось запустить VM $name"
}

# Интерфейс сети узлов: на Mac единственный eth0, на серверах — PRIVATE_IFACE или маршрут по умолчанию.
node_iface() {
  iface="$(site PRIVATE_IFACE)"
  [ -n "$iface" ] && { echo "$iface"; return; }
  on_node "$1" sh -c "ip -4 route show default | awk '{print \$5; exit}'"
}
node_ip() { on_node "$1" sh -c "ip -4 -o addr show dev $2 | awk '{print \$4}' | cut -d/ -f1 | head -1"; }
apt_install() { on_node "$1" sudo sh -c "command -v $2 >/dev/null || { DEBIAN_FRONTEND=noninteractive apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y $3; } >/dev/null 2>&1"; }

cmd_cluster() {
  require_tools; require_init
  if [ "$PLATFORM" = lima ]; then
    step "Узлы: $NODE_COUNT VM по $(site NODE_CPUS 4) CPU / $(site NODE_MEMORY_GIB 6) ГБ"
    for n in $(node_indexes); do start_vm "$(vm_name "$n")" "$(write_node_config "$n")"; done
  else
    [ "$NODE_COUNT" -ge 1 ] || die "в SERVERS нет серверов"
    step "Серверы: $SERVERS"
    for n in $(node_indexes); do
      on_node "$n" sudo true || die "нет SSH-доступа с sudo к $(server_host "$n")"
    done
  fi

  iface="$(node_iface 1)"
  server_ip="$(node_ip 1 "$iface")"
  [ -n "$server_ip" ] || die "не найден адрес главного узла на интерфейсе $iface"
  server_node="$(on_node 1 hostname | tr '[:upper:]' '[:lower:]')"
  if [ "$PLATFORM" = linux ]; then registry="$server_ip:5000"; else registry="lima-$(vm_name 1).internal:30500"; fi
  set_value "$SITE" SERVER_IP "$server_ip"
  set_value "$SITE" SERVER_NODE "$server_node"
  set_value "$SITE" REGISTRY_ENDPOINT "$registry"
  if [ "$(public_mode)" = tunnel ]; then
    k3s_extra="--disable traefik --node-label svccontroller.k3s.cattle.io/enablelb=true"
  else
    k3s_extra=""   # Traefik из k3s принимает 80/443 для Ingress с сертификатом Let's Encrypt.
  fi

  for n in $(node_indexes); do
    # Образы приложения приходят из внутреннего реестра по HTTP внутри сети узлов.
    on_node "$n" sudo sh -c "mkdir -p /etc/rancher/k3s && printf 'mirrors:\n  \"$REGISTRY_NAME\":\n    endpoint:\n      - \"http://$registry\"\n' > /etc/rancher/k3s/registries.yaml"
    apt_install "$n" mount.nfs nfs-common
  done

  step "k3s $K3S_VERSION: главный узел $server_node ($server_ip)"
  # NFS-сервер для общей папки с файлами презентаций (ReadWriteMany), доступ только из сети узлов.
  apt_install 1 exportfs nfs-kernel-server
  on_node 1 sudo sh -c "test -f /etc/exports.d/lecturer.exports || { subnet=\$(ip -o -4 route show dev $iface scope link | awk '{print \$1}' | head -1) && mkdir -p /srv/nfs/lecturer-blobs /etc/exports.d && chmod 0777 /srv/nfs/lecturer-blobs && echo \"/srv/nfs/lecturer-blobs \$subnet(rw,sync,no_subtree_check,no_root_squash)\" > /etc/exports.d/lecturer.exports && exportfs -ra; }"
  on_node 1 sh -c "test -x /usr/local/bin/k3s || curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION='$K3S_VERSION' INSTALL_K3S_EXEC='server --write-kubeconfig-mode 600 --tls-san 127.0.0.1 --node-ip $server_ip --flannel-iface $iface $k3s_extra' sh - >/dev/null"
  i=0
  until kc get --raw /readyz >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "k3s на главном узле не стартовал: journalctl -u k3s на нём"
    sleep 3
  done
  token="$(on_node 1 sudo cat /var/lib/rancher/k3s/server/node-token)"

  for n in $(node_indexes); do
    [ "$n" = 1 ] && continue
    ip="$(node_ip "$n" "$(node_iface "$n")")"
    step "k3s agent: узел $n ($ip)"
    on_node "$n" sh -c "test -x /usr/local/bin/k3s || curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION='$K3S_VERSION' K3S_URL='https://$server_ip:6443' K3S_TOKEN='$token' INSTALL_K3S_EXEC='agent --node-ip $ip --flannel-iface $(node_iface "$n")' sh - >/dev/null"
  done

  step "Жду готовности узлов"
  i=0
  until [ "$(kc get nodes --no-headers 2>/dev/null | awk '$2=="Ready"' | wc -l | tr -d ' ')" -ge "$NODE_COUNT" ]; do
    i=$((i + 1)); [ "$i" -le 100 ] || die "не все узлы перешли в Ready: sh $K8S/lecturer-k8s.sh kubectl get nodes"
    sleep 3
  done
  # SFU (видео) работает на узле с меткой lecturer.media=true — последнем.
  media_node="$(on_node "$NODE_COUNT" hostname | tr '[:upper:]' '[:lower:]')"
  kc label node "$media_node" lecturer.media=true --overwrite >/dev/null
  on_node 1 sudo cat /etc/rancher/k3s/k3s.yaml > "$STATE/kubeconfig"; chmod 600 "$STATE/kubeconfig"
  kc get nodes -o wide
  if [ "$PLATFORM" = linux ]; then
    say "kubectl с этого компьютера: ssh -L 6443:127.0.0.1:6443 $(server_host 1), затем export KUBECONFIG=$ROOT/$STATE/kubeconfig"
  else
    say "kubectl с Mac: export KUBECONFIG=$ROOT/$STATE/kubeconfig"
  fi
}

# ---------------------------------------------------------------------------- platform

wait_deployments() {
  namespace="$1"; shift
  for deploy in "$@"; do
    kc -n "$namespace" rollout status "deployment/$deploy" --timeout=10m >/dev/null \
      || die "$namespace/$deploy не запустился: sh $K8S/lecturer-k8s.sh kubectl -n $namespace describe deployment $deploy"
  done
}

cmd_platform() {
  require_tools; require_init
  step "Пространство имён и реестр образов"
  render namespace | kc apply -f - >/dev/null
  render platform | kc apply -f - >/dev/null
  step "Операторы: cert-manager, CloudNativePG, RabbitMQ"
  # cert-manager выпускает сертификаты вебхуков оператора RabbitMQ и, на серверах, HTTPS сайта.
  kc apply -f "$CERT_MANAGER_MANIFEST" >/dev/null
  wait_deployments cert-manager cert-manager cert-manager-cainjector cert-manager-webhook
  kc apply --server-side --force-conflicts -f "$CNPG_MANIFEST" >/dev/null
  kc apply -f "$RABBITMQ_OPERATOR_MANIFEST" >/dev/null
  wait_deployments registry registry
  wait_deployments cnpg-system cnpg-controller-manager
  wait_deployments rabbitmq-system rabbitmq-cluster-operator
  if autoscaling_on; then
    step "Автомасштабирование: KEDA и Prometheus"
    kc apply --server-side --force-conflicts -f "$KEDA_MANIFEST" >/dev/null
    wait_deployments monitoring prometheus
    wait_deployments keda keda-operator keda-metrics-apiserver keda-admission
  fi
  say "Платформа готова (профиль $(profile))."
}

# ---------------------------------------------------------------------------- build

write_builder_config() {
  file="$STATE/lima/$BUILDER.yaml"
  mkdir -p "$STATE/lima"
  cat > "$file" <<EOF
minimumLimaVersion: 2.0.0
base: $UBUNTU_IMAGE
vmType: vz
cpus: $(site BUILDER_CPUS 4)
memory: $(site BUILDER_MEMORY_GIB 4)GiB
disk: $(site BUILDER_DISK_GIB 60)GiB
mounts:
- {location: "$ROOT", writable: false}
containerd: {system: true, user: false}
networks:
- lima: user-v2
portForwards:
$NO_FORWARDS
EOF
  echo "$file"
}

# На сервере сборка идёт отдельным containerd + BuildKit (nerdctl-full), не трогая containerd k3s.
prepare_server_builder() {
  on_node 1 sh -c "command -v nerdctl >/dev/null && systemctl is-active --quiet buildkit" && return 0
  say "  ставлю nerdctl-full $NERDCTL_VERSION на главный узел"
  on_node 1 sudo sh -c "set -e
    case \$(uname -m) in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) echo 'неизвестная архитектура' >&2; exit 1 ;; esac
    file=nerdctl-full-$NERDCTL_VERSION-linux-\$arch.tar.gz
    cd /tmp && curl -sfLO https://github.com/containerd/nerdctl/releases/download/v$NERDCTL_VERSION/\$file
    curl -sfL https://github.com/containerd/nerdctl/releases/download/v$NERDCTL_VERSION/SHA256SUMS | grep \" \$file\$\" | sha256sum -c - >/dev/null
    tar -xzf \$file -C /usr/local && rm -f \$file
    systemctl daemon-reload && systemctl enable --now containerd buildkit >/dev/null 2>&1"
}

sync_sources() {
  # Отправляется рабочая копия без игнорируемых файлов (секреты в .state и node_modules не уходят).
  git ls-files -co --exclude-standard -z | COPYFILE_DISABLE=1 tar --null --no-mac-metadata -cf - -T - \
    | on_node 1 sudo sh -c "rm -rf $SRC && mkdir -p $SRC && tar -xf - -C $SRC 2>/dev/null"
}

image_digest() {
  on_builder curl -sfI \
    -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.list.v2+json' \
    "http://$REGISTRY_ENDPOINT/v2/lecturer/$1/manifests/$2" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'
}

build_image() {
  name="$1"; dockerfile="$2"; shift 2
  say "  $name ($dockerfile)"
  on_builder sh -c "cd '$SRC' && sudo nerdctl build -q -f '$dockerfile' -t '$REGISTRY_ENDPOINT/lecturer/$name:$TAG' $* . >/dev/null && sudo nerdctl push -q --insecure-registry '$REGISTRY_ENDPOINT/lecturer/$name:$TAG' >/dev/null 2>&1" \
    || die "сборка $name не удалась"
}

cmd_build() {
  require_tools; require_init
  REGISTRY_ENDPOINT="$(site REGISTRY_ENDPOINT)"
  [ -n "$REGISTRY_ENDPOINT" ] || die "сначала: sh $K8S/lecturer-k8s.sh cluster"
  kc -n registry rollout status deployment/registry --timeout=10s >/dev/null 2>&1 \
    || die "реестр не запущен: сначала sh $K8S/lecturer-k8s.sh platform"
  TAG="$(git rev-parse --short HEAD)"
  [ -z "$(git status --porcelain)" ] || TAG="$TAG-dirty-$(date +%Y%m%d%H%M%S)"
  if [ "$PLATFORM" = linux ]; then
    step "Сборка образов $TAG на главном узле"
    prepare_server_builder
    sync_sources
  else
    step "Сборка образов $TAG в VM $BUILDER"
    start_vm "$BUILDER" "$(write_builder_config)"
  fi
  bot_name="$(site VITE_MAX_BOT_NAME)"
  build_image core core/Dockerfile
  build_image services services/Dockerfile
  build_image sfu services/Dockerfile.sfu
  build_image web web/Dockerfile --build-arg "VITE_MAX_BOT_NAME='$bot_name'"
  build_image converter deploy/converter/Dockerfile
  build_image max-adapter adapters/max/Dockerfile
  say "  authority ($CADDY_IMAGE)"
  on_builder sh -c "sudo nerdctl pull -q '$CADDY_IMAGE' >/dev/null && sudo nerdctl tag '$CADDY_IMAGE' '$REGISTRY_ENDPOINT/lecturer/authority:$TAG' && sudo nerdctl push -q --insecure-registry '$REGISTRY_ENDPOINT/lecturer/authority:$TAG' >/dev/null 2>&1" \
    || die "не удалось взять $CADDY_IMAGE"

  # Манифесты ссылаются на образы только по digest: что проверено, то и запущено.
  tmp="$(mktemp)"
  printf '{' > "$tmp"; sep=''
  for name in core services sfu web converter max-adapter authority; do
    digest="$(image_digest "$name" "$TAG")"
    [ -n "$digest" ] || die "нет digest для $name"
    printf '%s"%s": "%s/lecturer/%s@%s"' "$sep" "$name" "$REGISTRY_NAME" "$name" "$digest" >> "$tmp"; sep=', '
  done
  printf '}\n' >> "$tmp"
  mv "$tmp" "$IMAGES"
  if [ "$PLATFORM" = lima ] && [ "${KEEP_BUILDER:-0}" != 1 ]; then limactl stop "$BUILDER" >/dev/null 2>&1 || true; fi
  say "Образы: $IMAGES"
}

# ---------------------------------------------------------------------------- deploy

secret_field() { kc -n "$NS" get secret "$1" -o "jsonpath={.data.$2}" | base64 -d; }

primary_pod() {
  kc -n "$NS" get pods -l "cnpg.io/cluster=$1,cnpg.io/instanceRole=primary" -o 'jsonpath={.items[0].metadata.name}'
}

site_url() {
  if [ "$(public_mode)" = tunnel ]; then echo "http://127.0.0.1:$EDGE_PORT"; else echo "https://$(site PUBLIC_DOMAIN)"; fi
}

check_site() {
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$(site_url)/health" || true)"
  if [ "$code" = 200 ]; then say "OK   $(site_url)/health"; else say "FAIL $(site_url)/health: $code"; fi
}

cmd_deploy() {
  require_tools; require_init
  [ -f "$IMAGES" ] || die "образов ещё нет: sh $K8S/lecturer-k8s.sh build"
  step "Секреты и слой данных (PostgreSQL x2, RabbitMQ), профиль $(profile)"
  render namespace | kc apply -f - >/dev/null
  python3 "$K8S/render-site.py" secrets --site "$SITE" --secrets "$SECRETS" | kc apply -f - >/dev/null
  render data | kc apply -f - >/dev/null
  kc -n "$NS" wait --for=condition=Ready cluster.postgresql.cnpg.io/app-db cluster.postgresql.cnpg.io/analytics-db --timeout=20m >/dev/null \
    || die "PostgreSQL не готов: sh $K8S/lecturer-k8s.sh kubectl -n $NS get clusters.postgresql.cnpg.io"
  kc -n "$NS" wait --for=condition=AllReplicasReady rabbitmqcluster/events --timeout=20m >/dev/null \
    || die "RabbitMQ не готов: sh $K8S/lecturer-k8s.sh kubectl -n $NS get rabbitmqclusters"

  step "Секреты приложения"
  RABBITMQ_USERNAME="$(secret_field events-default-user username)" \
  RABBITMQ_PASSWORD="$(secret_field events-default-user password)" \
  ANALYTICS_DB_PASSWORD="$(secret_field analytics-db-app password)" \
    python3 "$K8S/render-site.py" secrets --stage runtime --site "$SITE" --secrets "$SECRETS" | kc apply -f - >/dev/null

  step "Приложение"
  render app | kc apply -f - >/dev/null
  wait_deployments "$NS" authority core analytics

  if autoscaling_on; then
    step "Автомасштабирование (KEDA + HPA)"
    # Роли счётчиков очередей: только чтение нужных столбцов, создаются после миграций.
    kc -n "$NS" exec -i "$(primary_pod app-db)" -c postgres -- psql -q -v ON_ERROR_STOP=1 -d lecturer \
      < deploy/scalable/ha/scaling-content.sql >/dev/null
    kc -n "$NS" exec -i "$(primary_pod analytics-db)" -c postgres -- psql -q -v ON_ERROR_STOP=1 -d analytics \
      < deploy/scalable/ha/scaling-analytics.sql >/dev/null
    render autoscaling | kc apply -f - >/dev/null
  fi

  step "Жду все сервисы"
  for deploy in $(kc -n "$NS" get deployments -o 'jsonpath={.items[*].metadata.name}'); do
    wait_deployments "$NS" "$deploy"
  done
  check_site
  say ""
  if [ "$(public_mode)" = tunnel ]; then
    say "Готово. С Mac: http://127.0.0.1:$EDGE_PORT/ ; публично через туннель: https://$(site PUBLIC_DOMAIN)/"
  else
    say "Готово: https://$(site PUBLIC_DOMAIN)/ (первый сертификат Let's Encrypt выпускается до пары минут)"
  fi
  [ -n "$(secret_value ADMIN_SETUP_TOKEN)" ] && say "Администратора ещё нет? sh $K8S/lecturer-k8s.sh admin"
  return 0
}

# ---------------------------------------------------------------------------- operations

cmd_status() {
  require_init
  kc get nodes -o wide
  say ""; kc -n "$NS" get pods -o wide
  say ""; kc -n "$NS" get clusters.postgresql.cnpg.io,rabbitmqclusters 2>/dev/null || true
  autoscaling_on && { say ""; kc -n "$NS" get scaledobjects,hpa 2>/dev/null || true; }
  say ""; check_site
}

cmd_backup() {
  require_init
  umask 077
  dir="${BACKUP_DIR:-$HOME/lecturer-k8s-backups}/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$dir"; chmod 700 "$dir"
  step "Резервная копия в $dir"
  kc -n "$NS" exec "$(primary_pod app-db)" -c postgres -- pg_dump -Fc -d lecturer > "$dir/lecturer.dump"
  kc -n "$NS" exec "$(primary_pod analytics-db)" -c postgres -- pg_dump -Fc -d analytics > "$dir/analytics.dump"
  on_node 1 sudo tar -czf - -C /srv/nfs lecturer-blobs > "$dir/lecturer-blobs.tar.gz"
  (cd "$dir" && shasum -a 256 ./* > SHA256SUMS)
  ls -lh "$dir"
}

cmd_admin() {
  require_init
  [ -n "$(secret_value ADMIN_SETUP_TOKEN)" ] || die "создание администратора закрыто"
  CORE_BASE_URL="$(site_url)" ADMIN_SETUP_TOKEN="$(secret_value ADMIN_SETUP_TOKEN)" python3 deploy/admin/provision.py
  say "Когда вход проверен: sh $K8S/lecturer-k8s.sh lock-setup"
}

cmd_lock_setup() {
  require_init
  set_value "$SECRETS" ADMIN_SETUP_TOKEN ""
  kc -n "$NS" patch secret lecturer-runtime --type merge -p '{"stringData":{"ADMIN_SETUP_TOKEN":""}}' >/dev/null
  kc -n "$NS" rollout restart deployment/core >/dev/null
  wait_deployments "$NS" core
  say "Создание администратора закрыто."
}

require_lima() {
  [ "$PLATFORM" = lima ] || die "команда только для Mac. На серверах: sudo systemctl stop|start k3s (агенты: k3s-agent)"
}

cmd_stop() {
  require_lima
  for name in $BUILDER $(node_indexes | sort -r | while read -r n; do vm_name "$n"; done); do
    if vm_running "$name"; then say "Останавливаю $name"; limactl stop "$name" >/dev/null 2>&1; fi
  done
  return 0
}

cmd_start() {
  require_lima; require_init
  for n in $(node_indexes); do vm_exists "$(vm_name "$n")" || die "нет VM $(vm_name "$n"): sh $K8S/lecturer-k8s.sh cluster"; done
  for n in $(node_indexes); do
    vm_running "$(vm_name "$n")" || { say "Запускаю $(vm_name "$n")"; limactl start -y "$(vm_name "$n")" >/dev/null 2>&1; }
  done
  say "VM запущены; k3s и приложение поднимутся сами за пару минут: sh $K8S/lecturer-k8s.sh status"
}

cmd_destroy() {
  require_lima
  names="$(node_indexes | while read -r n; do vm_name "$n"; done | tr '\n' ' ')$BUILDER"
  say "Будут удалены VM $names вместе с базами, файлами и реестром."
  say "Настройки и секреты в $STATE останутся. Сначала сделайте backup."
  printf 'Для подтверждения введите имя кластера (%s): ' "$CLUSTER"
  read -r answer
  [ "$answer" = "$CLUSTER" ] || die "отменено"
  for name in $names; do if vm_exists "$name"; then limactl delete -f "$name" >/dev/null 2>&1; fi; done
  rm -f "$IMAGES" "$STATE/kubeconfig"
  say "Удалено."
}

case "${1:-help}" in
  init) cmd_init ;;
  cluster) cmd_cluster ;;
  platform) cmd_platform ;;
  build) cmd_build ;;
  deploy) cmd_deploy ;;
  up) [ -f "$SECRETS" ] || cmd_init; cmd_cluster; cmd_platform; cmd_build; cmd_deploy ;;
  status) cmd_status ;;
  logs) require_init; [ -n "${2:-}" ] || die "укажите компонент: core, realtime, edge, analytics, max-adapter..."
        kc -n "$NS" logs -l "app.kubernetes.io/component=$2" --tail=100 -f --max-log-requests 10 --prefix ;;
  admin) cmd_admin ;;
  lock-setup) cmd_lock_setup ;;
  backup) cmd_backup ;;
  kubectl) shift; kc "$@" ;;
  stop) cmd_stop ;;
  start) cmd_start ;;
  destroy) cmd_destroy ;;
  help|-h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "неизвестная команда '$1'. Список: sh $K8S/lecturer-k8s.sh help" ;;
esac
