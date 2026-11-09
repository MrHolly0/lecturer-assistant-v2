# Что есть в коде и что нужно изменить

Проверено чтением исходников 9 ноября 2026 на базе `a404fa5` с сохранённой локальной
модерацией V46. Никаких измерений работающего стенда при аудите не проводилось.

## Основа, которую сохраняем

- PostgreSQL и транзакционные бизнес-команды; сервер определяет статус занятия.
- Идемпотентность поддерживаемых команд в той же транзакции, `expectedVersion`,
  сохранение клиентского черновика, backoff/jitter и `Retry-After`.
- Пакетная сборка снимков и проверка прав, ограниченные кэши и очереди,
  раздельные общая и персональная части снимка.
- Claim/lease/fencing импортов, сохраняемая очередь MAX с подтверждением попытки,
  общий provider cooldown; независимый converter.
- Подготовленные итоги занятия; асинхронная аналитика может развиваться без
  превращения всей предметной модели в event sourcing.
- Курсные права, отзыв доступа, анонимность вопросов, гостевые подключения,
  подпись MAX, подтверждение перепривязки, последнее подтверждение доставки.

## Препятствия для горизонтального запуска

| Место | Наблюдение | Требуемое изменение |
|---|---|---|
| [StudentSseBroadcaster](../../core/src/main/java/ru/university/assistant/live/internal/StudentSseBroadcaster.java) | Клиенты и send queues локальны процессу; сборка снимков раз в секунду | Выделить транспорт; получать инвалидации, а не собирать всё при отсутствии изменений |
| [StudentSessionSnapshotService](../../core/src/main/java/ru/university/assistant/live/internal/StudentSessionSnapshotService.java) | Локальный bounded cache и свежая персонализация | Сохранить как bootstrap/read API; убрать постоянное чтение всей истории вопросов для каждого idle-клиента |
| [LiveWebSocketConfig](../../core/src/main/java/ru/university/assistant/live/internal/LiveWebSocketConfig.java) | Simple STOMP broker и подписки локальны | Gateway принимает межпроцессные события и доставляет только своим соединениям |
| [LiveSessionPublisher](../../core/src/main/java/ru/university/assistant/live/internal/LiveSessionPublisher.java) | After-commit отправка в локальный broker, без durable transport intent | Outbox в одной транзакции с командой; отдельный publisher |
| [ShareService](../../core/src/main/java/ru/university/assistant/projection/internal/ShareService.java) | Комнаты, leases и signalling в `ConcurrentHashMap` | SFU и стабильный внешний media room ID; временная маршрутизация по владельцу не заменяет HA |
| [ShareVideoStore](../../core/src/main/java/ru/university/assistant/projection/internal/ShareVideoStore.java) | H.264-сегменты в памяти одного core | Убрать основной видео-fanout из Application API; HTTP fallback ограничивать отдельно |
| [ProjectionService](../../core/src/main/java/ru/university/assistant/projection/internal/ProjectionService.java) | Helper-протокол связан с занятиями и control leases | Сохранить DB leases, проверить весь helper lifecycle между репликами; не считать работу SFU доказательством готовности helper |
| [BlobStorage](../../core/src/main/java/ru/university/assistant/content/internal/BlobStorage.java) | Файлы на локальном диске и блокировки согласованной пары DB/blob | Storage interface и общее отказоустойчивое хранилище, immutable object versions |
| [SlideImportWorker](../../core/src/main/java/ru/university/assistant/content/internal/SlideImportWorker.java) | Worker уже умеет разделять jobs через БД, но живёт внутри core | Самостоятельный процесс с минимальными правами, отдельными CPU/RAM и health |
| [JdbcEventBus](../../core/src/main/java/ru/university/assistant/analytics/internal/JdbcEventBus.java) | Пишет `analytics.events`; не публикует новый durable outbox | Новый integration outbox; не оживлять молча заброшенную `analytics.outbox` |
| [CommandIdempotency](../../core/src/main/java/ru/university/assistant/shared/api/CommandIdempotency.java) | DB-backed результаты поддерживаемых команд | Сохранить, расширять контракт по операциям; не объявлять все POST безопасно повторяемыми |
| [Runtime budgets](../runtime-budgets.md) | Квоты и admission локальны процессу | Локальный bulkhead плюс общий бюджет установки; отключение Redis не должно открывать бесконечный доступ |

Наличие локального кэша само по себе допустимо. Проблема возникает, если в нём
находится единственная копия комнаты, lease или необходимого события.

## Что подтверждено нагрузкой

[Прогон 23 октября](../capacity-check-20261023.md) прошёл 100×30 студентов и 10×150
через локальный Caddy: это полезная отправная точка. Одна общая пятистраничная колода,
ступенчатое подключение, отсутствие видео, реального MAX и публичного TLS означают,
что результат нельзя переносить на 10 000 студентов и 100 разных видеозанятий.

Увеличение `rooms`, `viewersPerRoom`, Hikari или `--scale core` не устраняет
перечисленные зависимости и не является приёмкой новой архитектуры.
