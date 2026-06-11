# Матрица прав фазы 1

Документ фиксирует backend-правила для IAM и организационной модели. Любой новый endpoint должен обновлять эту матрицу до реализации кода.

| Роль | Ресурс | Действие | Условие |
| --- | --- | --- | --- |
| Анонимный | `/api/v1/system/info` | Читать статус | Всегда |
| Анонимный | `auth/bootstrap-admin` | Создать первого администратора | Только если нет пользователей |
| Анонимный | `auth/login` | Войти | Валидные учетные данные |
| Анонимный | `auth/register` | Зарегистрироваться | Действующее приглашение |
| Анонимный | `auth/refresh` | Обновить access-token | Валидная httpOnly refresh-cookie |
| Администратор | `admin/users` | Читать список пользователей | Всегда |
| Администратор | `admin/invitations` | Создать приглашение ADMIN/LECTURER/ASSISTANT | STUDENT создается только в курсе |
| Администратор | `courses` | Читать список курсов | Все курсы |
| Лектор | `courses` | Создать курс | Создатель становится LECTURER курса |
| Лектор | `courses/{courseId}` | Читать курс | Только курс, где пользователь участник |
| Лектор | `courses/{courseId}/groups` | Создать группу | Только свой курс |
| Лектор | `courses/{courseId}/invitations` | Создать приглашение LECTURER/ASSISTANT/STUDENT | Только свой курс |
| Лектор | `courses/{courseId}/bans` | Читать и создавать бан | Только свой курс |
| Лектор | `courses/{courseId}/decks` | Загружать презентации, читать версии | Только свой курс |
| Лектор | `courses/{courseId}/import-jobs/{jobId}` | Читать прогресс импорта | Только свой курс |
| Лектор | `courses/{courseId}/decks/{deckId}` | Читать дек и слайды | Только свой курс |
| Лектор | `courses/{courseId}/decks/{deckId}/slides/{idx}/image` | Читать изображение слайда | Только свой курс |
| Лектор | `courses/{courseId}/decks/{deckId}/slides/{idx}/notes` | Создавать и менять заметки | Только свой курс |
| Лектор | `courses/{courseId}/lectures` | CRUD лекций | Только свой курс |
| Лектор | `courses/{courseId}/lectures/{lectureId}/attachments` | Загружать материалы | Только свой курс |
| Лектор | `courses/{courseId}/lectures/{lectureId}/sessions` | Стартовать live-сессию | Только свой курс |
| Лектор | `courses/{courseId}/sessions/{sessionId}` | Читать состояние live-сессии | Только свой курс |
| Лектор | `courses/{courseId}/sessions/{sessionId}/slide` | Менять текущий слайд | Только свой курс |
| Лектор | `courses/{courseId}/sessions/{sessionId}/annotations` | Сохранять аннотации | Только свой курс |
| Лектор | `courses/{courseId}/sessions/{sessionId}/pause/resume/end` | Управлять FSM сессии | Только свой курс |
| Ассистент | `courses/{courseId}` | Читать курс | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/groups` | Создать группу | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/invitations` | Создать приглашение STUDENT | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/decks` | Загружать презентации, читать версии | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/decks/{deckId}/slides/{idx}/notes` | Создавать и менять заметки | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/lectures` | CRUD лекций и материалов | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/lectures/{lectureId}/sessions` | Стартовать live-сессию | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/sessions/{sessionId}/slide` | Менять текущий слайд | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/sessions/{sessionId}/annotations` | Сохранять аннотации | Только курс, где пользователь участник |
| Ассистент | `courses/{courseId}/sessions/{sessionId}/pause/resume/end` | Управлять FSM сессии | Только курс, где пользователь участник |
| Студент | `courses` | Читать список курсов | Только курсы, где есть членство |
| Студент | `courses/{courseId}` | Читать курс | Только свой курс и если нет активного бана |
| Студент | `courses/{courseId}/decks` | Читать версии презентаций | Только свой курс |
| Студент | `courses/{courseId}/import-jobs/{jobId}` | Читать прогресс импорта | Только свой курс |
| Студент | `courses/{courseId}/decks/{deckId}` | Читать дек и слайды | Только свой курс |
| Студент | `courses/{courseId}/decks/{deckId}/slides/{idx}/image` | Читать изображение слайда | Только свой курс |
| Студент | `courses/{courseId}/lectures` | Читать список лекций | Только свой курс |
| Студент | `courses/{courseId}/sessions/{sessionId}` | Читать live-состояние | Только свой курс |
| Студент | `courses/{courseId}/sessions/join` | Вступить в live-сессию | Только свой курс и валидный join-code |
| Любая роль | `auth/me` | Читать свой профиль | Только authenticated |
| Любая роль | `auth/change-password` | Сменить свой пароль | Только authenticated |
| Любая роль | `identity/link-codes` | Создать код привязки канала | Только authenticated |
| Любая роль | `identity/link` | Привязать внешний канал | По валидному одноразовому коду |

Правила изоляции:

- Проверки доступа к курсу выполняются по `org.course_members`, а не по данным из JWT.
- Внешние идентификаторы Telegram/VK хранятся только в `iam.channel_identities`.
- Забаненный участник не получает доступ к курсу даже при сохраненном членстве.
- Refresh-token не читается JavaScript-кодом фронта и передается только cookie `la_refresh` на пути `/api/v1/auth`.
- Файлы контента не отдаются по прямым blob-ссылкам: каждый slide image проходит через проверку доступа к курсу.
- WebSocket `/ws/session/{id}` принимает JWT в STOMP `CONNECT` и не меняет доменное состояние сам.
