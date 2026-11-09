# Отдельный распределённый профиль

Этот профиль запускает отдельную установку с новыми данными. Он не читает `.env`
старого стенда, не регистрирует автозапуск и не поднимает туннель. Все локальные
контейнеры имеют `restart: "no"`. Полная HA требует независимых Linux-узлов;
контейнеры на одном Mac служат функциональной лабораторией.

Состав: два Application API, три Realtime Gateway, transactional outbox publisher,
RabbitMQ из трёх узлов, Analytics с собственной PostgreSQL, отдельный Content Worker
и converter, Media Control, SFU с локальным контролем доступа, Redis, статический
веб и два маршрутизатора — публичный и внутренний.

## Локальный запуск

Из корня репозитория, с Docker Compose v2 и BuildKit:

```sh
python3 deploy/scalable/init-local.py
docker compose -f deploy/scalable/compose.yml config --quiet
docker compose -f deploy/scalable/compose.yml up -d --build
docker compose -f deploy/scalable/compose.yml ps -a
```

Адрес: `http://localhost:18089`. Скрипт создаёт `.env` и `livekit.local.yaml` с
правами 0600 и отказывается заменять существующие ключи. Эти файлы исключены из
Git и Docker build context. Не выводить результат `compose config` с секретами
в общедоступный журнал. Сборка SFU требует сети для фиксированного исходника Go.

Для браузерного видео опубликованы TCP 7881, UDP 7882 и UDP 3478. Это лабораторные
порты; не открывать эту HTTP-конфигурацию в интернет. Ключ первичной настройки
администратора находится только в приватном `.env`. Для синтетической проверки:

```sh
SCALE_LAB=true node --env-file deploy/scalable/.env e2e/service-smoke.mjs
```

Тест создаёт фальшивые аккаунты, курс, импорт и занятие. Доступ сохраняется в 0600
`/private/tmp/lecturer-scale-fixture.json`; отчёт не содержит паролей. Для проверки
завершения занятия и отдельной аналитики добавить `SCALE_END_SESSION=true`.
Нагрузочный тест использует только изолированную HTTP-площадку:

```sh
CAPACITY_ISOLATED=true CAPACITY_TRANSPORT_GATEWAY=true \
CAPACITY_ADMIN_FIXTURE=/private/tmp/lecturer-scale-fixture.json \
BASE_URL=http://localhost:18089 CAPACITY_STAGES=10x100 \
CAPACITY_OUTPUT=artifacts/scalable-capacity \
node --env-file deploy/scalable/.env e2e/system-capacity.mjs
```

Это нагрузка слайдов, SSE, голосов, сигналов и повторного подключения, **без видео**.
`e2e/sfu-harness.mjs` отдельно поднимает локальную страницу с синтетическим видео
1280×720 для двух браузеров. Для него также требуется `SCALE_LAB=true`.

Для больших прогонов генератор следует запускать в Linux-сети стенда. Десятки тысяч
пробросов через Docker Desktop на Mac добавляют собственные ограничения: они не
измеряют только приложение. Внутренний lab alias edge — `capacity-caddy:8088`
(сохранён для существующего harness), фактический proxy — Nginx.

Перед измерением обязательна проверка всех зависимостей, включая текущую связь
каждого Gateway с брокером:

```sh
python3 deploy/scalable/verify-ready.py
python3 e2e/run-scalable-capacity.py --stages 10x100,100x100
```

Второй скрипт запускает ограниченный Linux-генератор в сети лаборатории. В него
попадают только тестовые сценарии, golden PDF и заранее созданный синтетический
fixture; приватный `.env` не монтируется. Протокол содержит SHA/dirty state,
версию/CPU/RAM Docker, digest runtime, ограничения генератора и его CPU/GC/память.
Имена собственных контейнеров уникальны, после прогона генератор удаляется.
Команды/PNG используют отдельный ограниченный HTTP pool; тысячи SSE не занимают
его соединения. Сетевые ошибки сохраняют безопасный код (`ECONNRESET` и т. п.).
Выходной каталог новый, под `artifacts/`; существующие отчёты не перезаписываются.
Режим без брокера оценивается отдельно: 15-секундная сверка — деградация.

Для отдельного испытания потери реплик runner принимает повторяемый
`--expect-stopped`: максимум один `core-*`, один `realtime-*` и один `rabbit-*`.
Он проверяет, что указанные реплики действительно остановлены, а остальные
работают; сам скрипт никого не выключает. Например, после контролируемого
отключения `core-b`, `realtime-c`, `rabbit-c`:

```sh
python3 e2e/run-scalable-capacity.py --stages 100x100 \
  --expect-stopped core-b --expect-stopped realtime-c --expect-stopped rabbit-c
```

Это потеря процессов на одном хосте, не доказательство HA независимых площадок.

Если после полного выключения один RabbitMQ узел завершился при старте, проверить
его журнал и состояние остальных. Допустим повторный обычный `docker start`
только остановившегося узла. `force_boot`, reset и удаление volumes не являются
штатным способом сделать readiness зелёным. Пока все зависимости не готовы,
`verify-ready.py` возвращает ненулевой код и runner не начинает измерение.

Остановка без удаления данных:

```sh
docker compose -f deploy/scalable/compose.yml stop
```

Не использовать `down -v` для обычной остановки. После полного выключения RabbitMQ
все три участника запускаются вместе: ожидание healthy первого перед запуском
остальных может заблокировать восстановление уже существующего кластера.

## Что отличается от обычной конфигурации

| Настройка | Здесь | По умолчанию в приложении |
|---|---|---|
| `INTEGRATION_ENABLED` | true, события в durable outbox | false |
| `LEGACY_LIVE_TRANSPORTS_ENABLED` | false, SSE/WS обслуживает Gateway | true |
| `CONTENT_WORKER_ENABLED` в API | false | прежнее поведение |
| `APP_ROLE` отдельного worker | content-worker | полное приложение |
| `MEDIA_PROVIDER` | sfu | legacy |
| `ANALYTICS_SERVICE_URL` | отдельный сервис | пусто, локальный отчёт |

Не включать эти флаги по отдельности на действующей установке: сначала должны
быть доступны соответствующие маршруты, worker, брокер и сервисы. Настройки и
режимы проверяются до переключения трафика. Общее JDBC-хранилище не делает старые
process-local media maps пригодными для нескольких реплик.

MAX в синтетической лаборатории выключен. Для своей новой установки можно задать
`MAX_BOT_TOKEN`, `MAX_WEBAPP_URL` и включить профиль `--profile channels`: он
использует существующий отдельный MAX adapter и закрытый Channel SPI. При webhook
нужны также `MAX_WEBHOOK_URL`/`MAX_WEBHOOK_SECRET`; edge маршрутизирует `/webhook/`.
Регистрация webhook по умолчанию не выполняется, её включают явно через
`MAX_REGISTER_WEBHOOK_ON_START=true` после проверки кабинета своего бота. Не
запускать этот профиль с токеном работающего бота параллельно прежней установке.
В Kubernetes adapter развёртывается отдельно; reference renderer его не создаёт.
Core получает необязательный `MAX_BOT_TOKEN` из `lecturer-runtime` Secret.

## Границы данных и права

- Application API остаётся владельцем IAM, курса и транзакций занятия. Изменение
  данных и запись outbox происходят одной транзакцией. Полезная работа не зависит
  от доступности RabbitMQ до исчерпания ограниченного backlog.
- Gateway не имеет DB-учётной записи. Права проверяются пакетно с lease до 5 секунд.
  После expiry защищённые кадры и heartbeat не отправляются, несброшенный буфер
  очищается. Socket можно сохранить до 30 секунд после исходного expiry, чтобы
  получить новое разрешение без массового reconnect. Deny закрывает его сразу;
  повторные ошибки не двигают этот срок. Неверный/задержанный grant не разрешает
  доставку. Это ожидание проверки, не увеличение TTL доступа. Параметр
  `PERMISSION_RECOVERY_MS` допускает 0..30000; при 0 socket закрывается сразу.
  Продление планируется от фактического deadline; ошибки используют отдельный
  backoff с jitter до 2 секунд на комнату. Invalidations не обходят этот backoff.
  В Application выделен отдельный read-only пул (4 подключения на реплику) для
  разрешений: он не ждёт свободного подключения за бизнес-транзакциями и их locks.
  Он читает тот же primary, а не отстающую read replica.
  SSE получает общий безопасный снимок и только персональный overlay адресата.
  Потерянная invalidation восстанавливается полной сверкой через 15 секунд.
- Worker запускает только Content-компоненты. Роль `content_worker` имеет доступ к
  трём таблицам Content, но не к IAM/занятиям. API метаданных и БД Content пока
  остаются внутри Application, файлы разделяются общим томом.
- Analytics хранит inbox, задачи и готовые отчёты в своей БД. Согласованный исходный
  отчёт экспортирует Application; последующее чтение проверяет точный fingerprint.
  Это отдельная read model, не восстановление продукта из полного event store.
- Service keys разделены по ролям. Публичный edge блокирует `/internal`, метрики
  и административный SFU API. Для production нужны также закрытая сеть, TLS между
  узлами и политика доступа к внутренним адресам; mTLS автоматически не настраивается.

Фактическая схема события: `services/contracts/integration-event.schema.json`.
Все broker-события имеют audience `INTERNAL`; их нельзя транслировать браузеру
целиком. Изоляция учреждения задаётся отдельной БД, сетью и RabbitMQ vhost/кластером.

## SFU и отзыв доступа

`MEDIA_PROVIDER=sfu` заменяет серверную пересылку JPEG/видео через API на один
WebRTC uplink преподавателя и подписки через LiveKit. Студенту запрещены публикация
аудио/видео и data-сообщений. Браузер загружает SDK только при использовании SFU.

JWT сам по себе не отзывает открытый поток. Каждый SFU запускается под локальным
supervisor: он получает **только местный** список комнат/участников и сверяет права
с Application. Истёкшие права удаляются через административный API. Если проверка
или локальное применение отзыва не завершается до expiry lease, supervisor
останавливает свой SFU. Другие SFU не зависят от недоступного соседнего узла.
При плановом SIGTERM комнаты дренируются, а контроль прав продолжает работать.

Длительная потеря authority прекращает видео. Если истёк и lease комнаты, ведущему
потребуется заново запустить демонстрацию; это безопасное прекращение, не бесшовная
миграция. Текущие результаты и незакрытая приёмка 10 000 описаны в
`docs/system-design/implementation.md`.

Для местного списка добавлено небольшое расширение LiveKit, закреплённое на commit
`385aa40f9292fe1db8caad87301e4b285b7c198a`. Endpoint доступен только с TCP loopback,
проверяет административный JWT и не использует global room routing. Docker-сборка
проверяет совместимость расширения и запускает его Go-тесты. При смене версии
LiveKit нужны повторные сборка и security/failure прогоны; upstream license
сохранён в образе. Стандартный образ LiveKit не заменяет этот образ автоматически.

## Метрики и восстановление

Для поиска пауз доступны `e2e/collect-runtime.mjs` и `e2e/collect-database.py`.
Они сохраняют только числовые/агрегированные сведения без запросов, токенов и
имён участников. Пример минутного сбора в отдельном терминале:

```sh
mkdir -p artifacts/runtime-sample
docker exec -e DIAGNOSTICS_DURATION_MS=60000 -i lecturer-scale-lab-realtime-a-1 \
  node --input-type=module < e2e/collect-runtime.mjs > artifacts/runtime-sample/gateway.jsonl
CAPACITY_ISOLATED=true python3 e2e/collect-database.py --seconds 60 \
  > artifacts/runtime-sample/database.jsonl
```

Сопоставлять время образца, задержку event loop, CPU, GC, throttling, swap,
pressure и ожидания БД. Высокий event-loop delay сам по себе не устанавливает
причину: процесс мог быть остановлен извне или не получать CPU. Сборщики имеют
конечный срок работы; недоступный источник отражается в отчёте.

`SCALE_LAB=true node e2e/realtime-recovery.mjs` проверяет настоящую заморозку
Gateway и Application, продолжение по тем же SSE/WS и отзыв прав. Он ограничен
именами/labels лабораторного проекта и завершает созданное тестовое занятие.
Не запускать его одновременно с измерением healthy latency.

Для настоящего декодирования видео несколькими браузерами установить в отдельное
Python-окружение `e2e/requirements-browser.txt` и соответствующий Chromium
(`python -m playwright install chromium --only-shell`). Запустить
`SCALE_LAB=true SCALE_MEDIA_VIEWERS=16 SCALE_MEDIA_FRESH_SESSION=true node e2e/sfu-harness.mjs`,
затем с теми же переменными `python e2e/sfu-browser-capacity.py`. Harness — только
loopback, использует отдельные синтетические аккаунты и завершает собственное
занятие при SIGTERM. Браузерный скрипт всегда закрывает свой headless browser.
Статистика считает декодированные/показанные кадры, байты, bitrate и packet loss.
Малоподвижный canvas не создаёт нагрузку 6 Мбит/с только из-за maxBitrate=6M:
в отчёте учитывается фактический bitrate, этот тест не заменяет массовое видео.

`/metrics` Node-служб доступен только внутри сети. Следить за:

- `realtime_broker_connected=0`, ошибками RPC, slow consumers и отзывами доступа;
- `integration_outbox_pending_events`, `_dead_events`, `_pending_bytes`,
  `_oldest_seconds`, `_metrics_age_seconds` и `_cleanup_events`;
- памятью/CPU, DB pool saturation, WAL/диском, Rabbit quorum/alarms и analytics lag;
- supervisor `/ready`, скоростью прекращения запрещённого видео и media reconnect.

Outbox ограничен 50 000 событиями / 256 МиБ (включая оценку накладных расходов).
При заполнении бизнес-команда получает 503, а не ложный успех. Claim имеет срок и
fencing token; повтор с прежним eventId допустим. Publisher ACK после broker confirm.
Очистка подтверждённых событий идёт короткими транзакциями по quota lanes.

После 12 неуспешных попыток событие остаётся `DEAD`, занимает бюджет и требует
разбора оператором. Через закрытый API с `SERVICE_EVENTS_KEY`:
`POST /internal/v1/events/outbox/status`, затем
`POST /internal/v1/events/outbox/redrive` с `{"ids":["event-uuid"]}` (до 256).
Не удалять outbox вручную для получения зелёной метрики. Сначала восстановить
причину отказа, затем redrive сохраняет прежний eventId для dedupe.

Analytics использует inbox и fenced jobs. После 8 попыток задача получает dead;
`POST /internal/v1/analytics/redrive` с `{"sessionId":"uuid"}` и analytics service
key запускает пересборку. Повторное чтение устаревшего отчёта не продлевает lease
и не отменяет backoff. Исходные данные остаются в Application.

Разрешения содержат `checkedAt`/`expiresAt` с интервалом до 5 секунд. Получатель
вычитает весь RPC round trip из срока через локальные монотонные часы; сравнивать
wall clocks разных узлов для продления нельзя. Задержавшийся ответ не даёт новый
TTL. При обновлении сначала выпускается совместимый Application API, затем Node
службы; при откате порядок обратный. Неверный/неполный grant закрывает доставку.

## Несколько физических узлов

`ha/data.yaml` — ресурсы для CloudNativePG 1.28 и RabbitMQ Cluster Operator:
отдельные трёхузловые БД Application/Analytics и quorum broker. Пример использует
обязательную синхронную копию PostgreSQL; потеря допустимого кворума ограничивает
записи. Операторы, storage class, WAL backup и restore на площадке не установлены.

`ha/render.py release.json` печатает Kubernetes List и ничего не применяет.
В JSON нужны `publicOrigin` (HTTPS), необязательный `namespace` и `images` с ключами
`core`, `services`, `sfu`, `web`, `authority`, `converter`. `web` содержит Nginx и
используется также публичным edge; `authority` — внутренний Caddy. Каждый образ указывается
`registry/image@sha256:<64 hex>`. Использовать только проверенные digest.

До применения подготовить:

1. Не менее трёх независимых узлов для quorum; запас N+1 и отдельные media-узлы с
   label `lecturer.media=true`, подходящей сетью, UDP/TCP/TURN и синхронизацией часов.
   На edge нужен лимит файловых дескрипторов не менее 65 536; media-узлам требуется
   настройка UDP buffers по рекомендациям LiveKit и проверка реального packet loss.
2. Secrets `lecturer-runtime`, `content-worker-db`, `livekit-config`, `turn-tls`.
   Значения роли/ключа берутся из настроек выше; `AMQP_URL` содержит несколько
   адресов одного vhost, `ANALYTICS_DATABASE_URL` — endpoint отдельной БД. CNPG
   предоставляет `app-db-app`, worker использует username `content_worker`.
3. HA Redis/Sentinel для LiveKit; образец `ha/livekit.example.yaml` нужно заполнить
   адресами, TLS-сертификатами и ключами площадки. Общий RWX PVC `lecturer-blobs`
   должен иметь собственную отказоустойчивость. Один NFS-хост её не обеспечивает.
4. Внешний HA ingress/LB с TLS, маршрутом к edge:80, поддержкой SSE/WS; отдельные
   media-порты и host firewall. Edge Service слушает 8088. Ни DB, ни authority,
   ни supervisor не публикуются. `dnsResolver` в release JSON задаёт DNS кластера;
   по умолчанию это `kube-dns.kube-system.svc.cluster.local`.
5. Разрешения роли worker до V49. Если роль создана позже — отдельно выполнить
   GRANT из V49 владельцем таблиц. Миграции V47–V50 additive; Flyway сериализует
   запуск, а для production выпусков предпочтителен отдельный migration job.

Манифесты задают PDB, распределение реплик, readiness/liveness и SFU OnDelete/drain.
Они **не применялись в реальном Kubernetes-кластере** и не доказывают RPO/RTO.
Backup/PITR, восстановление файлов, отказ узла/сети и несколько тысяч реальных
видеозрителей проверяются по `docs/system-design/acceptance.md` на площадке.
Никаких заявлений о 10 000 видеозрителей только по результату SSE-теста.
