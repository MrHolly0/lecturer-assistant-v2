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
