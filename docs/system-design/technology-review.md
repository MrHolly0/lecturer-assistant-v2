# Выбор технологий для следующего этапа

Проверено 10.11.2026. Цель: одна установка учреждения, 100 занятий и 10 000
студентов, включая видеодемонстрацию. Решения ниже относятся к распределённой
ветке; результаты чужих benchmarks не являются проверкой нашего продукта.

## Realtime runtime

| Вариант | Что подходит задаче | Решение |
|---|---|---|
| Node.js 24 LTS | Совместимость с существующими SDK/HTTP/SSE/STOMP; встроенные метрики event loop, CPU и GC. Можно сравнить с 22 без переписывания протокола | Выбран после unit/PG/fault проверок; ускорение относительно 22 этим не доказано |
| Go | Подходит отдельному транспортному процессу; есть CPU/heap/blocking profiles и tracing. Потребует повторить все проверки прав, coalescing и восстановления | Кандидат, если профиль покажет устойчивый CPU/GC bottleneck шлюза |
| Bun | Есть нативные WebSocket server API, явные backpressure/drain controls; потребуется проверить SDK и переписать адаптер транспорта | Пока не выбран: выигрыш на другом WebSocket benchmark не доказывает выигрыш нашего SSE+authority пути |

Смена runtime не устраняет задержки PostgreSQL, сети или остановку всей VM.
Сначала измеряем event-loop delay, process CPU, GC, cgroup throttling/swap,
общие CPU/memory/I/O pressure и отдельно загрузку генератора. Меняем один фактор
между прогонами; сборка образов и другие тяжёлые проверки не идут одновременно
с измеряемой нагрузкой. Паузы и recovery не исключаются из отчёта здорового SLO.

Источники: [Node 22 → 24 LTS](https://nodejs.org/uk/blog/migrations/v22-to-v24),
[Node performance APIs](https://nodejs.org/download/release/v24.21.0/docs/api/perf_hooks.html),
[Go diagnostics](https://go.dev/doc/diagnostics),
[Bun WebSockets](https://bun.sh/docs/runtime/http/websockets).

## События и фоновые работы

Сравнены RabbitMQ quorum queues и NATS JetStream. Оба дают средства для устойчивого
обмена; JetStream поддерживает хранение, replay и повторную доставку. Quorum queues
RabbitMQ используют Raft и сохраняют существующий publisher-confirm/consumer-ack
контракт. Сохраняем RabbitMQ: причин менять брокер по измерениям пока нет.
При любом выборе остаются transactional outbox, consumer inbox, fencing и
идемпотентность: транспорт не делает бизнес-операцию exactly-once автоматически.

После полного перезапуска лаборатории наблюдался отказ старта одного узла
RabbitMQ 4.1/Mnesia; два других ждали таблицы, доставка работала через резервную
сверку. Обычный повторный запуск остановившегося узла восстановил кластер без
reset/force_boot. Добавлены проверка broker readiness и отказ runner начинать
healthy-прогон при деградации. У новых RabbitMQ начиная с 4.2 есть Khepri по
умолчанию. Его переход на Raft для метаданных стоит проверять отдельной миграцией
с сохранением очередей; смена image tag поверх существующих volumes не считается
проверкой такого перехода. В этой доработке формат хранилища не менялся.

Источники: [RabbitMQ quorum queues](https://www.rabbitmq.com/docs/quorum-queues),
[NATS JetStream](https://docs.nats.io/concepts/jetstream).
О метаданных: [RabbitMQ metadata store](https://www.rabbitmq.com/docs/metadata-store).

## Видео

Сохраняем LiveKit SFU: распределение комнат и контролируемый drain предусмотрены
самим сервером, а у нас уже реализована проверка действующих прав. Каждое занятие
должно помещаться на одном SFU-узле. Размер кластера выбирается по реальному
bitrate, packet rate, TURN и размещению комнат. Замена SFU не отменяет исходящий
трафик: при 10 000 подписчиках по 6 Мбит/с это 60 Гбит/с полезного видео.

Следующий media gate: encoded streams, фактический приём кадров/пакетов,
несколько независимых генераторов, отказ узла и TURN. Собственные счётчики
подписок или успешные HTTP tickets не заменяют эту проверку.

Источники: [LiveKit distributed](https://docs.livekit.io/transport/self-hosting/distributed/),
[методика нагрузки](https://docs.livekit.io/transport/self-hosting/benchmark/).
