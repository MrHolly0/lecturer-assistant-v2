#!/usr/bin/env sh
# Lecturer Assistant в Kubernetes: k3s на виртуальных Linux-машинах (Lima) на Mac.
#
#   sh deploy/k8s/lecturer-k8s.sh init        один раз: адрес, бот MAX, секреты в deploy/k8s/.state
#   sh deploy/k8s/lecturer-k8s.sh up          всё сразу: cluster + platform + build + deploy
#
#   sh deploy/k8s/lecturer-k8s.sh cluster     создать/запустить узлы и установить k3s
#   sh deploy/k8s/lecturer-k8s.sh platform    реестр образов, операторы БД и RabbitMQ, KEDA, Prometheus
#   sh deploy/k8s/lecturer-k8s.sh build       собрать образы в отдельной VM и отправить в реестр
#   sh deploy/k8s/lecturer-k8s.sh deploy      данные, секреты, приложение, автомасштабирование
#
#   sh deploy/k8s/lecturer-k8s.sh status      узлы, поды, масштабирование, проверка сайта
#   sh deploy/k8s/lecturer-k8s.sh logs <компонент>   например core, realtime, edge, max-adapter
#   sh deploy/k8s/lecturer-k8s.sh admin       создать первого администратора
#   sh deploy/k8s/lecturer-k8s.sh lock-setup  закрыть создание администратора
#   sh deploy/k8s/lecturer-k8s.sh backup      дамп обеих БД и архив файлов презентаций на Mac
#   sh deploy/k8s/lecturer-k8s.sh kubectl ... любая команда kubectl в кластере
#   sh deploy/k8s/lecturer-k8s.sh stop | start    остановить / запустить все VM (данные сохраняются)
#   sh deploy/k8s/lecturer-k8s.sh destroy     удалить VM вместе со всеми данными кластера
set -eu

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
K8S=deploy/k8s
STATE="$K8S/.state"
SITE="$STATE/site.env"
SECRETS="$STATE/secrets.env"
IMAGES="$STATE/images.json"
NS=lecturer
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

CLUSTER="$(site CLUSTER_NAME lecturer-k8s)"
NODE_COUNT="$(site NODE_COUNT 3)"
EDGE_PORT="$(site EDGE_PORT 18088)"
SERVER="$CLUSTER-1"
BUILDER="$CLUSTER-builder"
REGISTRY_NAME=registry.lecturer.local
REGISTRY_ENDPOINT="lima-$SERVER.internal:30500"

# Lima по умолчанию пробрасывает на Mac каждый порт VM; эти правила это отключают.
NO_FORWARDS='- {guestIP: 0.0.0.0, guestPortRange: [1, 65535], proto: any, ignore: true}
- {guestPortRange: [1, 65535], proto: any, ignore: true}'

node_names() { i=1; while [ "$i" -le "$NODE_COUNT" ]; do echo "$CLUSTER-$i"; i=$((i + 1)); done; }
vm_exists() { limactl list -q 2>/dev/null | grep -qx "$1"; }
vm_running() { [ "$(limactl list --format '{{.Status}}' "$1" 2>/dev/null)" = Running ]; }
in_vm() { name="$1"; shift; limactl shell --workdir / "$name" -- "$@"; }
kc() { limactl shell --workdir / "$SERVER" -- sudo k3s kubectl "$@"; }
render() { python3 "$K8S/render-site.py" "$@" --site "$SITE" --images "$IMAGES"; }

require_tools() {
  command -v limactl >/dev/null || die "нужна Lima: brew install lima"
  command -v python3 >/dev/null || die "нужен python3 (xcode-select --install)"
  command -v openssl >/dev/null || die "нужен openssl"
}

require_init() {
  [ -f "$SITE" ] && [ -f "$SECRETS" ] || die "сначала: sh $K8S/lecturer-k8s.sh init"
}

# ---------------------------------------------------------------------------- init

cmd_init() {
  require_tools
  mkdir -p "$STATE"; chmod 700 "$STATE"
  say "Настройка $STATE (уже заданные значения не меняются)."

  if [ -z "$(site PUBLIC_DOMAIN)" ]; then
    printf 'Публичный адрес без https:// [lecturer-assistant.ru.tuna.am]: '
    read -r answer
    set_value "$SITE" PUBLIC_DOMAIN "${answer:-lecturer-assistant.ru.tuna.am}"
  fi
  for pair in CLUSTER_NAME=lecturer-k8s NODE_COUNT=3 NODE_CPUS=4 NODE_MEMORY_GIB=7 NODE_DISK_GIB=60 \
      BUILDER_CPUS=4 BUILDER_MEMORY_GIB=5 BUILDER_DISK_GIB=60 EDGE_PORT=18088 \
      MEMORY_REQUEST_RATIO=0.5 AUTOSCALING=true MAX_REGISTER_WEBHOOK_ON_START=true; do
    key="${pair%%=*}"
    [ -n "$(site "$key")" ] || set_value "$SITE" "$key" "${pair#*=}"
  done
  if [ -z "$(file_value VITE_MAX_BOT_NAME "$SITE")" ] && ! grep -q '^VITE_MAX_BOT_NAME=' "$SITE"; then
    printf 'Публичное имя бота MAX (пусто — пропустить): '
    read -r answer
    set_value "$SITE" VITE_MAX_BOT_NAME "$answer"
  fi
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
  say ""
  say "Готово. Настройки: $SITE, секреты: $SECRETS (права 600, в git не попадают)."
  say "Сохраните копию secrets.env в менеджер паролей. Дальше: sh $K8S/lecturer-k8s.sh up"
}

# ---------------------------------------------------------------------------- cluster

write_node_config() {
  name="$1"; file="$STATE/lima/$name.yaml"
  mkdir -p "$STATE/lima"
  {
    echo "minimumLimaVersion: 2.0.0"
    echo "base: $UBUNTU_IMAGE"
    echo "vmType: vz"
    echo "cpus: $(site NODE_CPUS 4)"
    echo "memory: $(site NODE_MEMORY_GIB 7)GiB"
    echo "disk: $(site NODE_DISK_GIB 60)GiB"
    echo "mounts: []"
    echo "containerd: {system: false, user: false}"
    echo "networks:"
    echo "- lima: user-v2"
    # На Mac (только 127.0.0.1) выходят API Kubernetes и вход на сайт; всё остальное закрыто.
    echo "portForwards:"
    if [ "$name" = "$SERVER" ]; then
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
    limactl create -y --name "$name" "$config" >/dev/null
  fi
  vm_running "$name" || limactl start -y "$name" >/dev/null
}

node_ip() { in_vm "$1" sh -c "ip -4 -o addr show eth0 | awk '{print \$4}' | cut -d/ -f1"; }

prepare_node() {
  name="$1"
  # Образы приложения приходят из внутреннего реестра по HTTP внутри сети узлов.
  in_vm "$name" sudo sh -c "mkdir -p /etc/rancher/k3s && printf 'mirrors:\n  \"$REGISTRY_NAME\":\n    endpoint:\n      - \"http://$REGISTRY_ENDPOINT\"\n' > /etc/rancher/k3s/registries.yaml"
  in_vm "$name" sh -c 'command -v mount.nfs >/dev/null || { sudo DEBIAN_FRONTEND=noninteractive apt-get -qq update && sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y nfs-common; } >/dev/null'
}

cmd_cluster() {
  require_tools; require_init
  step "Узлы: $NODE_COUNT VM по $(site NODE_CPUS 4) CPU / $(site NODE_MEMORY_GIB 7) ГБ"
  for name in $(node_names); do start_vm "$name" "$(write_node_config "$name")"; done

  step "k3s $K3S_VERSION на $SERVER (control plane)"
  prepare_node "$SERVER"
  # NFS-сервер для общей папки с файлами презентаций (ReadWriteMany).
  # Доступ только из сети узлов (подсеть eth0).
  in_vm "$SERVER" sh -c 'test -f /etc/exports.d/lecturer.exports || { subnet="$(ip -o -4 route show dev eth0 scope link | awk "{print \$1}" | head -1)" && sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y nfs-kernel-server >/dev/null && sudo mkdir -p /srv/nfs/lecturer-blobs /etc/exports.d && sudo chmod 0777 /srv/nfs/lecturer-blobs && echo "/srv/nfs/lecturer-blobs $subnet(rw,sync,no_subtree_check,no_root_squash)" | sudo tee /etc/exports.d/lecturer.exports >/dev/null && sudo exportfs -ra; }'
  server_ip="$(node_ip "$SERVER")"
  in_vm "$SERVER" sh -c "test -x /usr/local/bin/k3s || curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION='$K3S_VERSION' INSTALL_K3S_EXEC='server --disable traefik --write-kubeconfig-mode 600 --tls-san 127.0.0.1 --node-ip $server_ip --flannel-iface eth0 --node-label svccontroller.k3s.cattle.io/enablelb=true' sh - >/dev/null"
  i=0
  until kc get --raw /readyz >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -le 60 ] || die "k3s на $SERVER не стартовал: limactl shell $SERVER sudo journalctl -u k3s"
    sleep 3
  done
  token="$(in_vm "$SERVER" sudo cat /var/lib/rancher/k3s/server/node-token)"

  for name in $(node_names); do
    [ "$name" = "$SERVER" ] && continue
    step "k3s agent на $name"
    prepare_node "$name"
    ip="$(node_ip "$name")"
    in_vm "$name" sh -c "test -x /usr/local/bin/k3s || curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION='$K3S_VERSION' K3S_URL='https://lima-$SERVER.internal:6443' K3S_TOKEN='$token' INSTALL_K3S_EXEC='agent --node-ip $ip --flannel-iface eth0' sh - >/dev/null"
  done

  step "Жду готовности узлов"
  i=0
  until [ "$(kc get nodes --no-headers 2>/dev/null | awk '$2=="Ready"' | wc -l | tr -d ' ')" -ge "$NODE_COUNT" ]; do
    i=$((i + 1)); [ "$i" -le 100 ] || die "не все узлы перешли в Ready: sh $K8S/lecturer-k8s.sh kubectl get nodes"
    sleep 3
  done
  # SFU (видео) работает на отдельном узле с меткой lecturer.media=true — последнем.
  kc label node "lima-$CLUSTER-$NODE_COUNT" lecturer.media=true --overwrite >/dev/null
  in_vm "$SERVER" sudo cat /etc/rancher/k3s/k3s.yaml > "$STATE/kubeconfig"; chmod 600 "$STATE/kubeconfig"
  kc get nodes -o wide
  say "kubectl с Mac: export KUBECONFIG=$ROOT/$STATE/kubeconfig"
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
  step "Пространство имён, реестр образов и Prometheus"
  render namespace | kc apply -f - >/dev/null
  render platform | kc apply -f - >/dev/null
  step "Операторы: cert-manager, CloudNativePG, RabbitMQ, KEDA"
  # Сертификаты вебхуков оператора RabbitMQ выпускает cert-manager.
  kc apply -f "$CERT_MANAGER_MANIFEST" >/dev/null
  wait_deployments cert-manager cert-manager cert-manager-cainjector cert-manager-webhook
  kc apply --server-side --force-conflicts -f "$CNPG_MANIFEST" >/dev/null
  kc apply -f "$RABBITMQ_OPERATOR_MANIFEST" >/dev/null
  kc apply --server-side --force-conflicts -f "$KEDA_MANIFEST" >/dev/null
  wait_deployments registry registry
  wait_deployments monitoring prometheus
  wait_deployments cnpg-system cnpg-controller-manager
  wait_deployments rabbitmq-system rabbitmq-cluster-operator
  wait_deployments keda keda-operator keda-metrics-apiserver keda-admission
  say "Платформа готова."
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
memory: $(site BUILDER_MEMORY_GIB 5)GiB
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

image_digest() {
  in_vm "$BUILDER" curl -sfI \
    -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.list.v2+json' \
    "http://$REGISTRY_ENDPOINT/v2/lecturer/$1/manifests/$2" | tr -d '\r' | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: //p'
}

build_image() {
  name="$1"; dockerfile="$2"; shift 2
  say "  $name ($dockerfile)"
  in_vm "$BUILDER" sh -c "cd '$ROOT' && sudo nerdctl build -q -f '$dockerfile' -t '$REGISTRY_ENDPOINT/lecturer/$name:$TAG' $* . >/dev/null && sudo nerdctl push -q --insecure-registry '$REGISTRY_ENDPOINT/lecturer/$name:$TAG' >/dev/null 2>&1" \
    || die "сборка $name не удалась"
}

cmd_build() {
  require_tools; require_init
  kc -n registry rollout status deployment/registry --timeout=10s >/dev/null 2>&1 \
    || die "реестр не запущен: сначала sh $K8S/lecturer-k8s.sh platform"
  TAG="$(git rev-parse --short HEAD)"
  [ -z "$(git status --porcelain)" ] || TAG="$TAG-dirty-$(date +%Y%m%d%H%M%S)"
  step "Сборка образов $TAG в VM $BUILDER"
  start_vm "$BUILDER" "$(write_builder_config)"
  bot_name="$(site VITE_MAX_BOT_NAME)"
  build_image core core/Dockerfile
  build_image services services/Dockerfile
  build_image sfu services/Dockerfile.sfu
  build_image web web/Dockerfile --build-arg "VITE_MAX_BOT_NAME='$bot_name'"
  build_image converter deploy/converter/Dockerfile
  build_image max-adapter adapters/max/Dockerfile
  say "  authority ($CADDY_IMAGE)"
  in_vm "$BUILDER" sh -c "sudo nerdctl pull -q '$CADDY_IMAGE' >/dev/null && sudo nerdctl tag '$CADDY_IMAGE' '$REGISTRY_ENDPOINT/lecturer/authority:$TAG' && sudo nerdctl push -q --insecure-registry '$REGISTRY_ENDPOINT/lecturer/authority:$TAG' >/dev/null 2>&1" \
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
  if [ "${KEEP_BUILDER:-0}" != 1 ]; then limactl stop "$BUILDER" >/dev/null 2>&1 || true; fi
  say "Образы: $IMAGES"
}

# ---------------------------------------------------------------------------- deploy

secret_field() { kc -n "$NS" get secret "$1" -o "jsonpath={.data.$2}" | base64 -d; }

primary_pod() {
  kc -n "$NS" get pods -l "cnpg.io/cluster=$1,cnpg.io/instanceRole=primary" -o 'jsonpath={.items[0].metadata.name}'
}

cmd_deploy() {
  require_tools; require_init
  [ -f "$IMAGES" ] || die "образов ещё нет: sh $K8S/lecturer-k8s.sh build"
  step "Секреты и слой данных (PostgreSQL x2, RabbitMQ)"
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

  if [ "$(site AUTOSCALING true)" = true ]; then
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
  domain="$(site PUBLIC_DOMAIN)"
  cat <<EOF

Готово. Вход в кластер с Mac: http://127.0.0.1:$EDGE_PORT/
Публичный адрес (через туннель на 127.0.0.1:$EDGE_PORT): https://$domain/
EOF
  [ -n "$(secret_value ADMIN_SETUP_TOKEN)" ] && say "Администратора ещё нет? sh $K8S/lecturer-k8s.sh admin"
  return 0
}

check_site() {
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$EDGE_PORT/health" || true)"
  if [ "$code" = 200 ]; then say "OK   http://127.0.0.1:$EDGE_PORT/health"; else say "FAIL http://127.0.0.1:$EDGE_PORT/health: $code"; fi
}

# ---------------------------------------------------------------------------- operations

cmd_status() {
  require_init
  kc get nodes -o wide
  say ""; kc -n "$NS" get pods -o wide
  say ""; kc -n "$NS" get clusters.postgresql.cnpg.io,rabbitmqclusters,scaledobjects,hpa 2>/dev/null || true
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
  in_vm "$SERVER" sudo tar -czf - -C /srv/nfs lecturer-blobs > "$dir/lecturer-blobs.tar.gz"
  (cd "$dir" && shasum -a 256 ./* > SHA256SUMS)
  ls -lh "$dir"
}

cmd_admin() {
  require_init
  [ -n "$(secret_value ADMIN_SETUP_TOKEN)" ] || die "создание администратора закрыто"
  CORE_BASE_URL="http://127.0.0.1:$EDGE_PORT" ADMIN_SETUP_TOKEN="$(secret_value ADMIN_SETUP_TOKEN)" \
    python3 deploy/admin/provision.py
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

cmd_stop() {
  for name in $BUILDER $(node_names | sort -r); do
    vm_running "$name" && { say "Останавливаю $name"; limactl stop "$name" >/dev/null; }
  done
  return 0
}

cmd_start() {
  require_init
  for name in $(node_names); do vm_exists "$name" || die "нет VM $name: sh $K8S/lecturer-k8s.sh cluster"; done
  for name in $(node_names); do vm_running "$name" || { say "Запускаю $name"; limactl start -y "$name" >/dev/null; }; done
  say "VM запущены; k3s и приложение поднимутся сами за пару минут: sh $K8S/lecturer-k8s.sh status"
}

cmd_destroy() {
  say "Будут удалены VM $(node_names | tr '\n' ' ')$BUILDER вместе с базами, файлами и реестром."
  say "Настройки и секреты в $STATE останутся. Сначала сделайте backup."
  printf 'Для подтверждения введите имя кластера (%s): ' "$CLUSTER"
  read -r answer
  [ "$answer" = "$CLUSTER" ] || die "отменено"
  for name in $BUILDER $(node_names); do vm_exists "$name" && limactl delete -f "$name" >/dev/null; done
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
  help|-h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "неизвестная команда '$1'. Список: sh $K8S/lecturer-k8s.sh help" ;;
esac
