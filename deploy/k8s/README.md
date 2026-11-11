# Kubernetes: Mac или свои Linux-серверы

Распределённая версия Lecturer Assistant в настоящем кластере Kubernetes (k3s).
Узлы — обычные Ubuntu-машины с k3s под systemd. Всем управляет один скрипт
`deploy/k8s/lecturer-k8s.sh`; площадку выбирает `init`.

| | **mac** — Lima на Mac | **linux** — арендованные серверы |
|---|---|---|
| Узлы | виртуальная машина Ubuntu на этом Mac | ваши серверы Ubuntu 22.04/24.04, доступ по SSH с sudo |
| Профиль | `light`: одна копия каждого сервиса, без автомасштабирования | `full`: 2–3 копии, автомасштабирование, БД и RabbitMQ по 3 экземпляра |
| Вход | `127.0.0.1:18088` на Mac, наружу через туннель (Tuna) | домен, HTTPS (Traefik + Let's Encrypt), HTTP → HTTPS |
| Сборка образов | отдельная VM, включается на время сборки | на первом сервере (отдельный containerd + BuildKit) |
| Видео (SFU) | только внутри Mac | публичный IP последнего сервера |

Простой вариант без Kubernetes, на одном сервере через docker compose: [deploy/cloud](../cloud/README.md).

## Что внутри кластера

```
edge (nginx) ─┬─ /api, /health   → core (Spring Boot)
              ├─ SSE, /ws        → realtime (Node.js)
              ├─ /rtc            → media-control → SFU (LiveKit)
              ├─ /webhook/       → max-adapter
              └─ остальное       → web (React)

PostgreSQL ×2 (CloudNativePG) — данные приложения и аналитика
RabbitMQ (оператор) — события между сервисами
content-worker, converter (LibreOffice) — импорт презентаций; файлы на общем NFS-томе
event-publisher, analytics — outbox и отчёты
cert-manager, registry (образы только по digest); в full ещё KEDA + Prometheus + HPA
```

Приложение рендерит проверенный генератор [deploy/scalable/ha/render.py](../scalable/ha/render.py);
`render-site.py` добавляет площадку: профиль ресурсов, NFS-том, Redis для LiveKit,
MAX-адаптер, внешний вход. Все версии зафиксированы в [versions.env](versions.env).

## Ресурсы

### mac (профиль light)

| VM | vCPU | Память | Когда работает |
|---|---|---|---|
| lecturer-k8s-1 | 4 | 6 ГБ | всегда |
| lecturer-k8s-builder | 4 | 4 ГБ | только во время `build` (~10 минут) |

Измерено: вся система занимает **около 2,5–2,8 ГБ памяти и 0,6 CPU** в простое.
Хватает Mac на Apple Silicon с 16 ГБ; диск — 60 ГБ под узел и 60 ГБ под сборщик.

### linux (профиль full)

Резерв планировщика при минимальном числе копий — **около 31 ГБ памяти и 20 CPU**
(приложение ~15 ГБ / 9 CPU, PostgreSQL и RabbitMQ по три экземпляра ~16 ГБ / 12 CPU),
плюс около 2 ГБ на операторы и k3s. Автомасштабирование до максимума добавляет ещё ~12 ГБ и ~4 CPU.

| | Минимум | С запасом под автомасштабирование |
|---|---|---|
| Серверы | 3 × 8 vCPU / 16 ГБ | 4 × 8 vCPU / 16 ГБ (четвёртый — под видео) |
| Диск | 200 ГБ каждому (PostgreSQL 100 + 50 ГБ, RabbitMQ 20 ГБ, образы), первому 250 ГБ | то же |
| Сеть | общая частная сеть между серверами, публичный IP | то же |

Профиль можно поменять в `site.env`: `PROFILE=light` на серверах экономит ресурсы,
`PROFILE=full` на Mac требует трёх узлов и 32+ ГБ.

## Запуск

```sh
sh deploy/k8s/lecturer-k8s.sh init   # площадка mac/linux, адрес, бот MAX; секреты генерируются сами
sh deploy/k8s/lecturer-k8s.sh up     # узлы, платформа, сборка, развёртывание: 30–60 минут в первый раз
sh deploy/k8s/lecturer-k8s.sh admin  # создать администратора
sh deploy/k8s/lecturer-k8s.sh lock-setup
```

Для **mac** нужна Lima: `brew install lima`. Python 3 и openssl уже есть в macOS.

Для **linux** перед `up`:
- SSH по ключу без пароля к каждому серверу и `sudo` без пароля (обычная настройка облачных VM);
- DNS: A-запись домена на публичные IP серверов;
- файрвол — наружу только 22, 80, 443 и на последнем сервере 7881/tcp, 7882/udp (видео);
  между серверами по частной сети — 6443, 8472/udp, 10250, 2049, 111, 5000;
- `init` спросит адреса серверов (первый — главный), домен, почту для Let's Encrypt,
  интерфейс частной сети и публичный IP сервера для видео.

`up` состоит из четырёх шагов, их можно запускать и по отдельности:

| Шаг | Что делает |
|---|---|
| `cluster` | готовит узлы (VM или серверы), ставит k3s, NFS для файлов, зеркало реестра |
| `platform` | реестр образов, cert-manager, операторы CloudNativePG и RabbitMQ; в full — KEDA и Prometheus |
| `build` | собирает 7 образов из текущей рабочей копии, кладёт в реестр, записывает digest |
| `deploy` | секреты, БД и RabbitMQ, приложение, внешний вход; в full — автомасштабирование |

## Обычная работа

| Задача | Команда |
|---|---|
| Что запущено и отвечает ли сайт | `sh deploy/k8s/lecturer-k8s.sh status` |
| Журналы компонента | `sh deploy/k8s/lecturer-k8s.sh logs core` (realtime, edge, analytics, max-adapter…) |
| Выкатить новую версию кода | `git pull && sh deploy/k8s/lecturer-k8s.sh build && sh deploy/k8s/lecturer-k8s.sh deploy` |
| Резервная копия на этот компьютер | `sh deploy/k8s/lecturer-k8s.sh backup` → `~/lecturer-k8s-backups/<время>/` |
| Любая команда kubectl | `sh deploy/k8s/lecturer-k8s.sh kubectl -n lecturer get pods` |
| (mac) Остановить / запустить VM | `sh deploy/k8s/lecturer-k8s.sh stop` / `start` |
| (mac) Удалить кластер с данными | `sh deploy/k8s/lecturer-k8s.sh destroy` |

Обновление идёт как в продакшене: новые образы получают новый digest, Deployment'ы
меняют поды по одному. SFU обновляется только вручную (`OnDelete`), чтобы не оборвать
идущую демонстрацию: после смены версии или `MEDIA_PUBLIC_IP` удалите под `sfu` в паузе
между занятиями — `kubectl -n lecturer delete pod -l app.kubernetes.io/component=sfu`.

kubectl, k9s или Lens с этого компьютера: `export KUBECONFIG=$PWD/deploy/k8s/.state/kubeconfig`
(на linux сначала `ssh -L 6443:127.0.0.1:6443 <первый сервер>`).

## Настройки

`deploy/k8s/.state/site.env` создаёт `init`; секреты — в `deploy/k8s/.state/secrets.env`
(права 600, не попадают в git и в образы).

| Параметр | mac | linux | Смысл |
|---|---|---|---|
| `PLATFORM` | `lima` | `linux` | площадка |
| `PROFILE` | `light` | `full` | профиль ресурсов |
| `PUBLIC_MODE` | `tunnel` | `ingress` | вход: порт для туннеля или HTTPS по домену |
| `PUBLIC_DOMAIN` | `lecturer-assistant.ru.tuna.am` | ваш домен | CORS, ссылка мини-приложения, вебхук MAX |
| `SERVERS` | — | `root@IP1 root@IP2 root@IP3` | SSH-адреса, первый — главный |
| `PRIVATE_IFACE` | — | пусто = интерфейс маршрута по умолчанию | сеть между узлами |
| `MEDIA_PUBLIC_IP` | — | IP последнего сервера | адрес, который SFU сообщает браузерам |
| `ACME_EMAIL` | — | почта | Let's Encrypt |
| `NODE_COUNT`, `NODE_CPUS`, `NODE_MEMORY_GIB` | 1, 4, 6 | — | размер VM |
| `AUTOSCALING` | false | true | KEDA/HPA (только в full) |
| `MEMORY_REQUEST_RATIO` | из профиля (0.25) | из профиля (1.0) | доля лимита памяти, которую резервирует планировщик |
| `MAX_REGISTER_WEBHOOK_ON_START` | true | true | адаптер регистрирует вебхук бота на `PUBLIC_DOMAIN` при старте |

## Как проверено (11 ноября 2026, Mac M1 Pro 16 ГБ)

- **mac / light**: `init` + `up` с настройками по умолчанию прошли без ручных шагов; 16 подов
  на одном узле 4 vCPU / 6 ГБ; занято ~2,4–2,8 ГБ и 0,6 CPU.
- **linux / light**: чистая VM Ubuntu 24.04, доступ только по SSH, как к облачному серверу.
  `up` поставил k3s, nerdctl-full (с проверкой SHA256), собрал образы на сервере, реестр
  слушает только частный адрес. HTTPS через Traefik: HTTP → 301 на HTTPS, `/health` 200,
  `/internal` 404. Let's Encrypt не проверялся (тестовый домен никуда не указывает).
- В обоих случаях `e2e/service-smoke.mjs` прошёл: импорт презентации через worker и converter
  на NFS, доставка смены слайда за 170–250 мс по SSE и WebSocket через RabbitMQ, выдача
  доступа к SFU, приватный ответ, отчёт отдельной аналитики; `backup` создаёт дампы
  обеих БД и архив файлов с контрольными суммами.
- **full** (3 копии БД с синхронной репликой, кворум RabbitMQ, KEDA/HPA) проверялся раньше на одном
  узле с 10 vCPU: автомасштабирование читает очереди и соединения. На трёх настоящих серверах
  профиль full ещё не запускался — это первая проверка после аренды.

## Ограничения

- **mac**: один физический компьютер; видео (SFU) доступно только внутри Mac — туннель
  пропускает только HTTP.
- **NFS для файлов презентаций** живёт на первом узле. Его потеря останавливает загрузку
  и показ слайдов до восстановления узла. Для настоящей отказоустойчивости нужно
  общее хранилище провайдера (NFS/CephFS) с `NFS_SERVER` в `site.env`.
- **Резервные копии** — команда `backup`. Непрерывное резервирование CloudNativePG
  (WAL в объектное хранилище) не настроено.
- **Один токен бота — одна установка**: адаптер переносит вебхук бота на эту установку.
