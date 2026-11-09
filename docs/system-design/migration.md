# Поэтапный переход

Ниже — последовательность реализации с gates для полного перехода. Выполненная
часть первого выпуска и ограничения отмечены в [implementation.md](implementation.md).
Текущий остановленный стенд не участвует в миграционных опытах.
Все прогоны используют отдельный проект, synthetic data и независимые порты/volumes.

## 0. Зафиксировать базу и контракты

- Сохранить локальную модерацию, её V46 и тесты как отдельную функциональную часть.
  Не потерять изменения при выборе baseline архитектурной ветки.
- Провести inventory process-local состояния; отличать cache от authority.
- Versioned integration envelope + JSON Schemas/AsyncAPI, снимок/дельта/cursor,
  audience и permission leases. Проверки producer/consumer входят в CI.
- Добавить SLO-метрики по ошибкам, latency, backlog, reconnect и media delivery;
  correlation ID не содержит персональные данные.

Gate: существующие права/MAX/гостевой вход/модерация/аналитика остаются корректны,
контракт не раскрывает имя анонимного автора и чужой ответ.

## 1. Durable integration outbox

Новая таблица и publisher за выключенным по умолчанию feature flag. Сохранить
действующую запись бизнес-фактов; в той же транзакции добавить намерение доставки.
Это не двойная запись в две базы. Shadow consumer сверяет эффекты, но не уведомляет
пользователей повторно. Publisher leases/fencing, подтверждения, retry/DLQ и inbox.

Gate: crash после commit до publish, после publish до confirm и после consumer
commit до ACK не теряет факт и не применяет бизнес-эффект дважды. При недоступном
broker контролируемый outbox backlog, при заполнении видимый отказ без ложного ACK.

## 2. Выделить Realtime Gateway

Перенести существующий async transport и сохранить внешний wire-контракт.
Application остаётся authority/bootstrap/command API; gateway не подключается
напрямую к БД. Отдельный адрес за тем же origin, приватный batch access API,
transient queue на каждую реплику, bounded room cache и queues.

Сначала одна реплика в isolated environment. Потом две/три с reconnect на другую
реплику и недоставленной invalidation. Параллельно перейти от периодического полного
персонального снимка к versioned public state и частным overlay invalidations.
Legacy transport выключается для конкретной installation/session cohort целиком;
не смешивать два независимо пишущих протокола управления.

Gate: потеря любой gateway-реплики, отзыв прав при partition, отсутствие приватных
данных у соседнего студента; 6 000 соединений на surviving replica. Rolling update
не вызывает одновременный reconnect всех клиентов. Read load не растёт на каждый
idle socket каждую секунду.

## 3. Перенести медиа в SFU

Выбрать и зафиксировать совместимые SDK/server releases, поднять отдельный media
контур с TURN, Redis, room authorization и teardown. Сначала browser desktop,
затем действительные MAX/iOS/Safari и проектор. Сохранить обычный показ слайдов.
Не включать неограниченный JPEG fallback после отказа SFU.

Gate: несколько SFU-узлов, аппаратное кодирование/потребление ведущего, читаемость
кода, narrow networks/TURN, падение SFU/Redis/TURN. Проверка revoke/end на уже
установленном media соединении. Только после неё удалять legacy media maps из core.

До завершения шагов 2–3 запрещено объявлять `core --scale=3` рабочей HA-схемой.
Дополнительный helper lifecycle и любые оставшиеся control leases также должны
пройти проверку между репликами.

## 4. Content и общее хранилище

Сначала интерфейс хранилища и перенос immutable файлов с checksum manifest. Затем
самостоятельный worker из уже существующих claim/lease/fencing механизмов. Потом
выделить metadata/jobs API и владельца БД Content.

Перенос через backfill → watermark → catch-up → сверка → переключение write owner.
В каждый момент у сущности один writer. Не выполнять два независимых save через
HTTP «на всякий случай». Протокол загрузки finalizes объект только после checksum,
конвертация публикует готовую версию атомарно; временные объекты убираются позже.
Согласовать новую backup/restore процедуру до удаления локальной копии.

Gate: падение worker во время записи, истёкший lease, повтор задачи, повреждённый
файл, storage outage, старые лекции на старой версии колоды и restore с manifest.

## 5. Analytics и Channel

Analytics получает отдельный owner/DB и versioned read models. Начать с consistent
export текущих данных и catch-up новых событий; старый журнал не считать полным
event store. Сверять отчёты старого и нового расчёта на одних synthetic sessions,
включая анонимность, отсутствующие исторические времена и снятые публикации.

Channel переносится со своими idempotency/inbox, provider queue, ACK/fencing,
общим cooldown и webhook dedupe. Остановить предыдущих consumers перед передачей
владения; два параллельных внешних отправителя могут дублировать сообщения.

Gate: повтор событий, отставание проекции, полный rebuild и безопасное переключение
generation; outage MAX и восстановление без перепривязки аккаунтов.

## 6. Production HA и приёмка ёмкости

На выбранной площадке: независимые узлы/диски/сеть, PostgreSQL failover + fencing,
broker quorum, Redis failure policy, storage HA, ingress и правильный media egress.
Проверить N/N-1 релизы, draining, миграции и восстановление из копии.

Запустить матрицу [acceptance](acceptance.md). Сохранить SHA всех компонентов,
digest образов, topology, resource limits, scripts и необработанные результаты.
Только после успешного mixed/video/soak/failure прогона публиковать конкретную
подтверждённую конфигурацию на 10 000 пользователей. Первые 10 000 SSE-сокетов без
полезной работы не являются завершением этого шага.
