# Расчёт требований, не бенчмарк

Сгенерировано `e2e/planning/capacity.py` из `capacity-model.json`.

**Ёмкость production не подтверждена. Числа ниже являются оценками.**

| Видео на зрителя | Payload SFU | Бюджет SFU с запасом | Сетевой минимум узлов N+1 | Пример packing с резервом |
|---|---:|---:|---:|---:|
| 6 Мбит/с | 60 Гбит/с | 75 Гбит/с | 6 | 6 |
| 12 Мбит/с | 120 Гбит/с | 150 Гбит/с | 10 | 10 |

Минимум рассчитан только по NIC. Пример packing предполагает заранее
свободный резервный узел и не моделирует реальный scheduler LiveKit, CPU,
pps или время reconnect. Это не спецификация закупки и не доказательство HA.

- Полезный бюджет исходящего NIC одного media-узла: 17.5 Гбит/с.
- Подключения с преподавателями и проекторами: 10300; после одного отказа: 5150 на gateway.
- Цель отдельного теста одной gateway-реплики: 6000 соединений.
- Только pending queues одной gateway-реплики после отказа: 243.9 МиБ, без TLS/heap/native/TCP.
- Верхний сценарий общего fanout: 843.8 Мбит/с.
- Полное восстановление за 30 секунд: 343.3 подключений/с.
- Проверки субъектов gateway: lease 5 секунд, refresh 2 секунд: 5150/с, нужны batch-запросы.
- Вместе с проверками media agent: 11950 subject checks/с.
- Сумма заданных пиков бизнес-операций: 4720.0/с; это не количество SQL-записей.
- DB pools на максимуме реплик: 138; вместе с резервом 168 из 180.

## Отдельные пики

| Операция | Операций/с |
|---|---:|
| votes | 2000.0 |
| signals | 2000.0 |
| receipts | 333.3 |
| questions | 200.0 |
| joins | 166.7 |
| teacher_commands | 20.0 |

## Что ещё надо измерить

- CPU, packets per second, TLS/native memory and disk/WAL throughput
- Actual SFU room placement, failure recovery and TURN capacity
- LiveKit/Redis/DB/broker configuration on the selected independent hosts
- Network reachability and video quality in real MAX/iOS clients
- 10k mixed end-to-end load, soak and fault injection
