# Матрица прав

Документ фиксирует backend-правила и зеркалит frontend-guards. Любой новый endpoint или роут обновляет эту матрицу до реализации кода.

| Роль | Ресурс | Действие | Условие |
| --- | --- | --- | --- |
| Анонимный | `/api/v1/system/info` | Читать статус | Всегда |
| Оператор установки | `auth/bootstrap-admin` | Создать первого администратора | Только с настроенным `ADMIN_SETUP_TOKEN`, верным заголовком и пока нет администратора; затем секрет удаляется |
| Анонимный | `auth/login`, `auth/register`, `auth/refresh` | Войти, зарегистрироваться, обновить access-token | По валидным данным/cookie |
| Анонимный | `courses/{courseId}/decks/{deckId}/slides/{idx}/image?t=...` | Читать картинку слайда | Только валидный HMAC-токен дека |
| Администратор | `admin/**` | Управлять пользователями и приглашениями | Только `ADMIN` |
| Администратор | `courses` | Читать все курсы, создать курс | Всегда |
| Администратор | `courses/{courseId}` | Архивировать курс | Любой курс |
| Лектор | `courses` | Создать курс | Создатель становится `LECTURER` курса |
| Лектор/Ассистент | `courses/{courseId}` | Читать курс | Только курс, где пользователь участник |
| Лектор/Ассистент | `courses/{courseId}/groups` | Создать группу | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/groups/{groupId}` | Удалить группу | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/invitations` | Создать приглашение | Manage-роль курса |
| Администратор / manage-участник курса | `courses/{courseId}/member-candidates?email=...` | Найти существующий активный аккаунт по точному email | Только активный курс; проверка manage до поиска; не возвращает адреса или каталог аккаунтов; заблокированный в курсе не находится |
| Администратор / manage-участник курса | `courses/{courseId}/members` | Добавить существующего участника с курсной ролью | Только активный аккаунт и курс, без снятия бана; повторное членство — 409; учебная группа только для STUDENT и из этого курса; системная роль не меняется |
| Лектор/Ассистент | `courses/{courseId}/bans` | Читать и создавать бан | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/decks` | Загружать презентации, читать версии | Manage-роль для загрузки; visible-роль для чтения |
| Лектор/Ассистент | `courses/{courseId}/decks/{deckId}` | Читать или архивировать дек | Visible для чтения; manage для архива |
| Лектор/Ассистент | `courses/{courseId}/decks/{deckId}/slides/{idx}/notes` | Сохранять или очищать заметку | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/lectures` | Создать и читать лекции | Manage для создания; visible для чтения |
| Лектор/Ассистент | `courses/{courseId}/lectures/{lectureId}` | Обновить, удалить или архивировать лекцию | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/lectures/{lectureId}/attachments` | Загружать вложения | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/lectures/{lectureId}/attachments/{attachmentId}` | Удалить вложение | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/lectures/{lectureId}/sessions` | Стартовать live-сессию | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/sessions/{sessionId}` | Читать состояние live-сессии | Visible-роль курса |
| Лектор/Ассистент | `courses/{courseId}/sessions/{sessionId}/participants` | Читать список студентов | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/sessions/{sessionId}/slide` | Менять текущий слайд | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/sessions/{sessionId}/annotations` | Сохранять аннотации | Manage-роль курса |
| Лектор/Ассистент | `courses/{courseId}/sessions/{sessionId}/pause/resume/end` | Управлять FSM сессии | Manage-роль курса |
| Студент | `courses` | Читать список своих курсов | Только членство |
| Студент | `courses/{courseId}` | Читать курс | Только свой курс |
| Студент | `courses/{courseId}/sessions/join` | Вступить в live-сессию | Свой курс и валидный join-code |
| Любая роль | `auth/me`, `auth/change-password`, `identity/link-codes` | Свой профиль, пароль, код привязки канала | Только authenticated |
| Адаптер канала | `/internal/v1/channels/**` | Capabilities, outbox, reports, inbound | Только валидный `X-Internal-Api-Key` |

Frontend-guards:

| Роль | Роуты | Правило |
| --- | --- | --- |
| `ADMIN` | `/courses`, `/courses/:id/**`, `/admin/users` | Полный кабинет и админка |
| `LECTURER` | `/courses`, `/courses/:id/**` | Кабинет лектора; создание курсов разрешено |
| `ASSISTANT` | `/courses`, `/courses/:id/**` | Кабинет лектора без создания курса; manage-действия только по `CourseDetails.canManage` |
| `STUDENT` | `/home` | Прямой переход в `/courses/**`, `/admin/**`, presenter/projection редиректит в `/home` |

Правила изоляции:

- Проверки доступа к курсу выполняются по `org.course_members`, а не по данным из JWT.
- Manage-действия на фронте рендерятся только при `CourseDetails.canManage`.
- Внешние идентификаторы Telegram/VK хранятся только в `iam.channel_identities`.
- Refresh-token не читается JavaScript-кодом фронта и передается только cookie `la_refresh`.
- Приватные картинки слайдов отдаются по подписанному URL `?t=<expires>.<hmac>`, а не по Bearer-заголовку.
- WebSocket `/ws/session/{id}` принимает JWT в STOMP `CONNECT` и не меняет доменное состояние сам.

## Необязательный помощник проектора

| Роль / credential | Маршруты | Правило |
| --- | --- | --- |
| ADMIN, LECTURER, ASSISTANT | `projection/settings` | Политика учреждения и только собственные устройства; STUDENT — 403 |
| ADMIN | `admin/projection/policy` | Изменение по `expectedRevision`, конфликт — 409; по умолчанию агент запрещён |
| Сотрудник | `projection/pairings`, `projection/devices/{id}` | Код только при разрешённой политике; устройство привязано к владельцу; отзыв только владельцем |
| Manage-участник курса | `courses/{courseId}/sessions/{sessionId}/projection/commands` | Собственное устройство, актуальные права курса и занятие; показ только после проверки физического экрана |
| Отдельный device token | `projection/agent/poll` | Ограниченный outbound канал, права владельца и курс проверяются повторно, lease 12 секунд |
| Одноразовый pairing code | `projection/agent/pair` | 5 минут, один обмен, политика и активная роль сотрудника проверяются сервером |

Запрет политики прекращает lease и команды показа уже установленного компонента, сохраняя
канал получения исправлений. Изменение минимальной версии запрещает новые показы старым
агентом, не перезапускает работающий процесс посреди занятия. Публичная сцена не получает
служебных данных; произвольных URL/команд в протоколе нет. Детали:
[projector-helper-protocol.md](projector-helper-protocol.md).

Каталог обновлений настраивает оператор отдельными локальными файлами доверенных
публичных ключей и подписанных metadata, а не пользователь кабинета. Сервер проверяет
подпись, репозиторий, совместимость, срок действия и сохранённые high-water marks;
клиент независимо повторяет проверку. `CHECK_UPDATE` не принимает URL или executable.
По умолчанию ключи и пакеты отсутствуют. Публикация и схемы описаны в
[projector-release-catalog.md](projector-release-catalog.md).

### Публичный медиаприёмник и HTTPS кадры

- Native WebView получает отдельный read-media grant в START-команде. Он связан с
  exact device/session/active output, коротким lease, policy и текущими правами владельца,
  ограничен 8 часами; не даёт staff API, QA, host commands или управления занятием.
  Local Stop (переход helper в IDLE) также отзывает grant.
- Только владелец активной демонстрации с текущими manage-правами загружает последний
  JPEG fallback кадр. Другой manage-участник может остановить демонстрацию, но не подменять
  её кадры. Размер, геометрия и частота ограничены сервером.
- Получение кадра требует уже зарегистрированного media viewer того же Person и текущего
  receipt/участия, либо действующего native grant. Кадры не создают участника и не продляют
  signalling leases. Kick/ban/account/device/policy revoke действует при каждом запросе.
- Кадры живут только в RAM до 4 секунд, очищаются на паузе/завершении. HTTP no-store;
  это запасной низкочастотный поток, не хранилище записей занятия.
