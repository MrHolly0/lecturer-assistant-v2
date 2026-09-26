# Проверка публичного API — 27.09.2026

Стенд: `https://lecturer-assistant.ru.tuna.am/api/v1`. Развёрнутый код приложения: `945c0ea`. Проверки выполнены по [DATA-API.yaml](../../DATA-API.yaml) с локальным паролем seed-преподавателя. Пароль, access token и данные ответов в отчёт не записывались.

| Проверка | Метод и путь | Итог |
|---|---|---|
| `system-info` | `GET /system/info` | PASS, 200 |
| `lecturer-login` | `POST /auth/login` | PASS, 200 |
| `lecturer-profile` | `GET /auth/me` | PASS, 200 |
| `lecturer-courses` | `GET /courses` | PASS, 200 |
| `course-details` | `GET /courses/{courseId}` | PASS, 200 |
| `course-groups` | `GET /courses/{courseId}/groups` | PASS, 200 |
| `group-analytics` | `GET /courses/{courseId}/analytics/groups` | PASS, 200 |
| `student-analytics` | `GET /courses/{courseId}/analytics/students?limit=5&offset=0` | PASS, 200 |

Проверены JSON Content-Type, ожидаемые поля ответов, seed-логин и извлечение ID первого курса. Все восемь методов и путей сверены с OpenAPI. `docker compose config --quiet` прошёл. Эта проверка не подтверждает интерфейсные действия, доставку сообщений в MAX или нагрузку на текущей ревизии.
