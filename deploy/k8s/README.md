# Kubernetes на Mac: k3s в виртуальных машинах

Полная распределённая версия Lecturer Assistant в настоящем кластере Kubernetes.
Узлы — обычные Ubuntu-машины с k3s под systemd, как арендованные Linux-серверы.
Здесь они запущены как виртуальные машины Lima на одном Mac. Всем управляет
один скрипт: `deploy/k8s/lecturer-k8s.sh`.

Простой вариант на одном сервере через docker compose описан в [deploy/cloud](../cloud/README.md).

## Как устроено

```
Mac (macOS)
├── Tuna ──> 127.0.0.1:18088 ───────────────┐
│                                           ▼
├── VM lecturer-k8s-1  (k3s server)    edge (nginx) ─┬─ /api, /health   → core ×2..3 (Spring Boot)
├── VM lecturer-k8s-2  (k3s agent)                   ├─ SSE, /ws        → realtime ×3..4 (Node.js)
├── VM lecturer-k8s-3  (k3s agent, SFU)              ├─ /rtc            → media-control → SFU (LiveKit)
│                                                    ├─ /webhook/       → max-adapter
│                                                    └─ остальное       → web (React)
└── VM lecturer-k8s-builder  (сборка образов, включается только на время build)

Внутри кластера:
  PostgreSQL ×3 (CloudNativePG, синхронная реплика) — данные приложения
  PostgreSQL ×3 (CloudNativePG) — аналитика
  RabbitMQ ×3 (quorum) — события между сервисами
  content-worker, converter (LibreOffice) — импорт презентаций; файлы на общем NFS-томе
  event-publisher, analytics — outbox и отчёты
  KEDA + Prometheus + HPA — автомасштабирование realtime, core, converter, workers
  cert-manager — сертификаты вебхуков оператора RabbitMQ
  registry — внутренний реестр образов; манифесты ссылаются на образы только по digest
```

Приложение рендерит тот же проверенный генератор манифестов, что описан в
[deploy/scalable](../scalable/README.md) (`ha/render.py`), без изменений.
`render-site.py` добавляет к нему то, что нужно конкретной площадке: размеры БД,
NFS-том, Redis для LiveKit, Prometheus, MAX-адаптер и внешний вход.

## Что нужно

- Mac на Apple Silicon с macOS 13+. Для трёх узлов — **32 ГБ RAM**
  (3 узла × 4 CPU / 7 ГБ + сборщик 4 CPU / 5 ГБ на время сборки), 200+ ГБ свободного диска.
- [Lima](https://lima-vm.io) ≥ 2.0: `brew install lima`. Python 3 и openssl уже есть в macOS.
  kubectl на Mac не обязателен: скрипт вызывает kubectl внутри узла.
- Для внешнего доступа — туннель (Tuna) на `127.0.0.1:18088`, как и раньше.

## Запуск

```sh
sh deploy/k8s/lecturer-k8s.sh init   # адрес, имя и токен бота MAX; секреты генерируются сами
sh deploy/k8s/lecturer-k8s.sh up     # узлы, платформа, сборка, развёртывание: 30–60 минут в первый раз
sh deploy/k8s/lecturer-k8s.sh admin  # создать администратора
sh deploy/k8s/lecturer-k8s.sh lock-setup
```

`up` состоит из четырёх шагов, которые можно запускать и по отдельности:

| Шаг | Что делает |
|---|---|
| `cluster` | создаёт VM, ставит k3s (server + agents), NFS для файлов, реестр в настройках узлов |
| `platform` | реестр образов, cert-manager, операторы CloudNativePG и RabbitMQ, KEDA, Prometheus |
| `build` | поднимает VM-сборщик, собирает 7 образов из текущего клона, кладёт в реестр, записывает digest |
| `deploy` | секреты, БД и RabbitMQ, приложение, права счётчиков очередей, автомасштабирование |

Все версии (k3s, операторы, образы) зафиксированы в [versions.env](versions.env).
На Mac пробрасываются только два порта узла: 6443 (API Kubernetes) и 18088 (сайт), оба на `127.0.0.1`.

## Обычная работа

| Задача | Команда |
|---|---|
| Что запущено и отвечает ли сайт | `sh deploy/k8s/lecturer-k8s.sh status` |
| Журналы компонента | `sh deploy/k8s/lecturer-k8s.sh logs core` (realtime, edge, analytics, max-adapter…) |
| Выкатить новую версию кода | `git pull && sh deploy/k8s/lecturer-k8s.sh build && sh deploy/k8s/lecturer-k8s.sh deploy` |
| Резервная копия на Mac | `sh deploy/k8s/lecturer-k8s.sh backup` → `~/lecturer-k8s-backups/<время>/` |
| Любая команда kubectl | `sh deploy/k8s/lecturer-k8s.sh kubectl -n lecturer get pods` |
| Остановить всё (данные сохраняются) | `sh deploy/k8s/lecturer-k8s.sh stop` |
| Запустить снова | `sh deploy/k8s/lecturer-k8s.sh start` |
| Удалить кластер с данными | `sh deploy/k8s/lecturer-k8s.sh destroy` |

Выкатка обновления идёт как в продакшене: новые образы получают новый digest,
Deployment'ы обновляются по одному поду (`maxUnavailable: 0`), PodDisruptionBudget не даёт
погасить все копии сразу.

Для kubectl, k9s или Lens прямо с Mac: `export KUBECONFIG=$PWD/deploy/k8s/.state/kubeconfig`.

## Настройки

`deploy/k8s/.state/site.env` создаётся командой `init`:

| Параметр | По умолчанию | Смысл |
|---|---|---|
| `PUBLIC_DOMAIN` | `lecturer-assistant.ru.tuna.am` | публичный адрес (CORS, ссылка мини-приложения, вебхук MAX) |
| `NODE_COUNT` | 3 | число узлов; с 3 узлами БД и RabbitMQ работают как отказоустойчивые кластеры |
| `NODE_CPUS` / `NODE_MEMORY_GIB` / `NODE_DISK_GIB` | 4 / 7 / 60 | размер каждого узла |
| `EDGE_PORT` | 18088 | порт на Mac, куда смотрит туннель |
| `MEMORY_REQUEST_RATIO` | 0.5 | какую долю лимита памяти резервирует планировщик |
| `AUTOSCALING` | true | KEDA/HPA для realtime, core, converter, content-worker, analytics |
| `MAX_REGISTER_WEBHOOK_ON_START` | true | адаптер регистрирует вебхук бота на `PUBLIC_DOMAIN` при старте |

Секреты лежат в `deploy/k8s/.state/secrets.env` (права 600, не попадают в git и в образы).

## Как проверено

11 ноября 2026 на Mac (M1 Pro, 16 ГБ) прогнан весь путь `init → cluster → platform → build → deploy`
на одном узле (для трёх не хватило памяти этой машины):

- сборка 7 образов в VM-сборщике — около 10 минут, образы в реестре по digest;
- PostgreSQL ×2 (CloudNativePG), RabbitMQ, все сервисы запущены; сайт, API и `/health`
  отвечают через edge на `127.0.0.1:18088`, `/internal` и `/metrics` снаружи закрыты;
- первый администратор создан, вход по паролю работает;
- `e2e/service-smoke.mjs` прошёл: импорт презентации через worker и converter на NFS,
  доставка смены слайда 206 мс по SSE и WebSocket через RabbitMQ, выдача доступа к SFU,
  приватный ответ, отчёт отдельной аналитики;
- KEDA читает очереди из PostgreSQL и число соединений из Prometheus, HPA — CPU core;
- `backup` создаёт дампы обеих БД и архив файлов с контрольными суммами.

Трёхузловой вариант (синхронная реплика PostgreSQL, кворум RabbitMQ, разнесение реплик по
узлам) на этой машине не запускался — его первая проверка на Mac mini.

## Ограничения этой площадки

- **Один физический компьютер.** Три узла дают настоящую работу кластера, rolling update
  и переживают падение одной VM, но не выключение самого Mac.
- **Видео демонстрации экрана (SFU) доступно только внутри Mac.** WebRTC-медиа идёт по UDP/TCP
  напрямую на узел, а туннель пропускает только HTTP. Для студентов из интернета нужен
  сервер с публичным IP или TURN.
- **NFS для файлов презентаций живёт на первом узле.** Его потеря останавливает загрузку и показ
  слайдов до восстановления узла.
- **Резервные копии** — команда `backup` (дамп БД и архив файлов). Непрерывное резервирование
  CloudNativePG (WAL в объектное хранилище) не настроено.
- **Один токен бота — одна установка.** Адаптер переносит вебхук бота на эту установку.

Перенос на настоящие Linux-серверы: те же шаги `platform`, `build`, `deploy` поверх k3s,
установленного на серверах. NFS заменяется отказоустойчивым хранилищем, Tuna —
балансировщиком с TLS.
