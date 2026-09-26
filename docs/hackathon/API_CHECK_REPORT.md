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

## Дополнительный браузерный smoke

На том же стенде в headless Chrome тестовый преподаватель открыл веб-вход, вошёл и перешёл из списка курсов в тестовый курс и раздел «Аналитика». Раздел показал групповые данные и историю завершённых лекций. При ширине 390 px страницы входа, списка курсов, обзора курса и аналитики не имели горизонтального переполнения. Никаких учебных данных в этом прогоне не меняли. Управление текущей лекцией, ответы студенту в MAX и полный живой студенческий путь остаются отдельными проверками.

На кандидате сдачи `a770c4f` все пять Docker-образов успешно собраны командой `docker compose build --no-cache --quiet`. Сервисный код и Docker-конфигурация между развернутой `945c0ea` и этим кандидатом не менялись.
