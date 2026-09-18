# MAX — техническая справка по интеграции

Назначение: исходные данные для задач B-01, B-02, F-01, F-02 (`docs/hackathon/TEAM_TASKS.md`).
Дата сбора: 18.09.2026. Источники — только официальная документация `https://dev.max.ru/docs`, официальный портал `https://dev.max.ru/ui` и репозитории организации `max-messenger` на GitHub.

Правила чтения документа:
- каждый факт снабжён ссылкой на страницу-источник;
- пометка **[SDK]** означает, что факт взят не из текста документации, а из исходного кода официального SDK (типы TypeScript) — это более точный, но формально не документированный источник;
- пометка **[?]** означает, что данных в документации нет; такие пункты собраны в разделе 7 «Открытые вопросы»;
- готового кода под наш стек здесь нет намеренно: справка описывает протокол, реализацию пишет команда.

---

## 1. Bot API

Источники: [Подготовка и настройка бота](https://dev.max.ru/docs/chatbots/bots-coding/prepare), [Справочник API](https://dev.max.ru/docs-api), [Установка MAX Bot API](https://dev.max.ru/docs/chatbots/bots-coding/js).

### 1.1 Базовый URL и авторизация

| Параметр | Значение | Источник |
|---|---|---|
| Базовый URL | `https://platform-api2.max.ru` | [prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare), [docs-api](https://dev.max.ru/docs-api) |
| Авторизация | HTTP-заголовок `Authorization: <token>` | [docs-api](https://dev.max.ru/docs-api) |
| Формат токена | непрозрачная строка, отдаётся в кабинете партнёра | [prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare) |

Важные уточнения:

- Заголовок именно `Authorization: <token>` — **без** префикса `Bearer`. Подтверждается исходником официального клиента: `init.headers = { ...init.headers, Authorization: token }` **[SDK]** (`src/core/network/api/client.ts`, [max-bot-api-client-ts](https://github.com/max-messenger/max-bot-api-client-ts)).
- Передача токена query-параметром `access_token` больше не поддерживается ([docs-api](https://dev.max.ru/docs-api)). В старых примерах в сети встречается именно она — не копировать.
- В SDK закомментирован устаревший хост `https://platform-api.max.ru` с пометкой «use botapi v2 instead» **[SDK]**. Для нас актуален только `platform-api2`.
- Токен бота берётся в кабинете: «Чат-боты» → «Расширенные настройки» (перенесено туда в июне 2026, [История изменений платформы](https://dev.max.ru/docs/changelog-platform)).

### 1.2 Лимиты

- **30 rps** на хост `platform-api2.max.ru`: «максимальное количество запросов в секунду на `platform-api2.max.ru` — 30 rps» ([prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare)).
- Разбивка лимита (на бота / на IP / на метод), поведение при превышении (код ответа, `Retry-After`) в документации не описаны — **[?]**.

Практический вывод для B-01: рассылка уведомлений по группе студентов должна идти через очередь с ограничителем ≤ 30 rps с запасом (планируем 10–15 rps), иначе при лекции на 150 человек упрёмся в лимит.

### 1.3 Получение событий: webhook и long polling

**Webhook (production).**

| Пункт | Значение | Источник |
|---|---|---|
| Подписка | `POST /subscriptions` | [docs-api](https://dev.max.ru/docs-api) |
| Список подписок | `GET /subscriptions` | [prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare) |
| Отписка | `DELETE /subscriptions?url=<url>` **[SDK]** | [max-bot-api-client-ts](https://github.com/max-messenger/max-bot-api-client-ts) |

Тело `POST /subscriptions` **[SDK]** (`src/core/network/api/modules/subscriptions/types.ts`):

```
{
  "url":          string,      // обязателен, внешний HTTPS-адрес
  "update_types": string[],    // опционален; если не задан — приходят все типы
  "secret":       string       // опционален, но нужен нам обязательно
}
```

Ответ `GET /subscriptions` содержит `subscriptions[]` с полями `url`, `time` (unix-время создания в миллисекундах), `update_types` **[SDK]**.

**Требования к URL вебхука** ([prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare)):

- только **HTTPS**; с 25 мая «прекращается поддержка получения вебхуков по HTTP, а также самоподписанных сертификатов»;
- сертификат — от **доверенного центра сертификации**; SDK дополнительно уточняет: «в том числе сертификаты Минцифры» ([docs/06-webhook.md](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/docs/06-webhook.md));
- для локальной разработки документация прямо рекомендует long polling, а не туннель.

**Проверка подлинности входящего запроса.** Если при подписке передан `secret`, MAX присылает его в заголовке **`x-max-bot-api-secret`**; официальный SDK сверяет значение через `timingSafeEqual` и отвечает `404 Not Found` на запросы с неверным или отсутствующим секретом ([docs/06-webhook.md](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/docs/06-webhook.md)). Это единственный документированный механизм аутентификации вебхука — подписи тела нет.

Прочее из того же источника:

- одновременно может существовать несколько подписок; SDK при запуске в режиме webhook удаляет все прочие подписки, оставляя активную (`Webhook.clearSubscriptions`);
- рекомендуемый путь — `/webhook/<sha256(token)>`, чтобы URL не угадывался;
- требований к порту, таймауту ответа, коду ответа и политике повторных доставок в документации нет — **[?]**.

**Long polling (только для разработки).** `GET /updates` с query-параметрами `limit`, `timeout`, `marker`, `types` **[SDK]**; ответ `{ updates: Update[], marker: number }`. Документация прямо предупреждает: способ «ограничен по скорости и сроку хранения событий — этот способ не подходит для production-окружения» ([prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare)).

### 1.4 Формат событий

Общая форма: объект `Update` с полями `update_type: string` и `timestamp: number` плюс полезная нагрузка **[SDK]** (`src/core/network/api/types/subcription.ts`).

Полный список `update_type` **[SDK]**:

`bot_added`, `bot_removed`, `bot_started`, `bot_stopped`, `chat_title_changed`, `comment_created`, `comment_edited`, `comment_removed`, `dialog_cleared`, `dialog_muted`, `dialog_removed`, `dialog_unmuted`, `message_callback`, `message_created`, `message_edited`, `message_removed`, `user_added`, `user_removed`.

Ключевые для нас:

```
bot_started      { update_type, timestamp, chat_id: number, user: User,
                   payload?: string|null, user_locale?: string }
message_created  { update_type, timestamp, message: Message, user_locale?: string|null }
message_callback { update_type, timestamp,
                   callback: { timestamp, callback_id: string, payload?: string, user: User },
                   message?: Message|null, user_locale?: string|null }
bot_stopped      { update_type, timestamp, chat_id, user, payload?, user_locale? }
```

`bot_started` — именно то событие, в котором приходит start-payload диплинка ([prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare)). Чтобы оно доходило, тип **обязательно** нужно указать в `update_types` при подписке (либо не указывать `update_types` вовсе).

### 1.5 Отправка сообщений

`POST /messages` ([docs-api](https://dev.max.ru/docs-api)).

Адресат задаётся **query-параметрами**, не телом **[SDK]** (`src/core/network/api/modules/messages/types.ts`):

```
query: { user_id?: number, chat_id?: number, disable_link_preview?: boolean }
body:  { text?: string|null,
         attachments?: AttachmentRequest[]|null,
         link?: { type: MessageLinkType, mid: string }|null,
         notify?: boolean,
         format?: MessageTextFormat|null }
```

Ответ: `{ message: Message }`. Прочие методы того же модуля: `GET /messages` (выборка по `chat_id`/`message_ids`/`from`/`to`/`count`), `DELETE /messages?message_id=…`, `GET /me` (информация о боте), `POST /uploads` (получение URL для загрузки файла).

Обёртки официального клиента: `bot.api.sendMessageToUser(userId, text)` и `bot.api.sendMessageToChat(chatId, text)` ([js](https://dev.max.ru/docs/chatbots/bots-coding/js)).

Лимитов на длину `text`, размер вложений и частоту отправки конкретному пользователю в документации не нашлось — **[?]**.

### 1.6 Кнопки и inline-клавиатура

Кнопки передаются во вложении: `attachments[]` с `type: "inline_keyboard"` и матрицей `payload.buttons[][]` ([docs-api](https://dev.max.ru/docs-api)).

Лимиты (цитата, [docs-api](https://dev.max.ru/docs-api)):

> «Inline-клавиатура позволяет разместить под сообщением бота до `210` кнопок, сгруппированных в `30` рядов — до `7` кнопок в каждом (до `3`, если это кнопки типа `link`, `open_app`, `request_geo_location` или `request_contact`)».

Типы кнопок **[SDK]** (`src/core/network/api/types/keyboard.ts`) — точные JSON-поля:

```
{ "type": "callback",            "text": string, "payload": string }
{ "type": "link",                "text": string, "url": string }
{ "type": "clipboard",           "text": string, "payload": string }
{ "type": "message",             "text": string }
{ "type": "request_contact",     "text": string }
{ "type": "request_geo_location","text": string, "quick"?: boolean }
{ "type": "open_app",            "text": string,
  "web_app"?: string|null, "contact_id"?: number|null, "payload"?: string|null }
```

**Кнопка открытия мини-приложения — `open_app`.** Это наш основной вход в мини-приложение из чата. Хелпер SDK: `Keyboard.button.openApp(text, webApp?, contactId?, payload?)`; документация SDK описывает её так: «откроется окно с мини-приложением бота, ссылка на которого указана в параметре `webApp`» ([docs/04-keyboard.md](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/docs/04-keyboard.md)).

Неочевидные моменты по `open_app`, которые надо проверить эмпирически на стенде:

- все три поля (`web_app`, `contact_id`, `payload`) помечены как опциональные — не задокументировано, какая комбинация обязательна; предположительно `web_app` (URL мини-приложения) либо `contact_id` (id бота, чьё мини-приложение открыть) — **[?]**;
- как именно `payload` кнопки `open_app` доходит до мини-приложения — приезжает ли он в `start_param` или отдельным полем — в документации не описано — **[?]**. Это критично для F-01: если `payload` не долетает, вход по коду придётся делать только через диплинк `?startapp=`.
- в справочнике API кнопка описана одной строкой «Открывает мини-приложение внутри чат-бота», без схемы полей — расхождение уровня детализации между [docs-api](https://dev.max.ru/docs-api) и типами SDK.

Есть также кнопка `chat` в хелперах SDK (`button.chat(text, chatTitle, { chat_description?, start_payload?, uuid? })`, [docs/04-keyboard.md](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/docs/04-keyboard.md)), но соответствующего типа нет в `keyboard.ts` — **противоречие внутри самого SDK**, использовать не рекомендую.

### 1.7 Диплинки

В MAX **две разные схемы диплинков**, и их легко перепутать — они ведут в разные места и имеют разные лимиты.

| Схема | Куда ведёт | Формат | Лимит payload | Где приходит | Источник |
|---|---|---|---|---|---|
| Бот | диалог с ботом | `https://max.ru/<botName>?start=<payload>` | **128 символов** | `Update` с `update_type: "bot_started"`, поле `payload` | [prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare) |
| Мини-приложение | мини-приложение бота | `https://max.ru/<botName>?startapp=<payload>` | **512 символов** | `window.WebApp.initDataUnsafe.start_param` | [webapps/introduction](https://dev.max.ru/docs/webapps/introduction) |

Поведение при нарушении ограничений:

- `?start=`: «Если `payload` превышает 128 символов, он не будет передан боту» — то есть переход состоится, а payload молча потеряется ([prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare));
- `?startapp=`: допустимые символы — `A-Z`, `a-z`, `0-9`, `_`, `-`; некорректный payload «вырезается» из URL ([webapps/introduction](https://dev.max.ru/docs/webapps/introduction)).

**Следствие для нашего кода присоединения к лекции.** Код должен укладываться в алфавит `[A-Za-z0-9_-]` — то есть Base64url без padding, никакой кириллицы, точек, двоеточий и знака `=`. Один общий формат кода тогда безопасно работает в обеих схемах (128 символов — более жёсткая граница, на неё и ориентируемся).

Отдельно есть системный диплинк шаринга: `https://max.ru/:share?text=<message>` (iOS, Android, web; на desktop «в разработке»), требует URL-кодирования текста ([webapps/introduction](https://dev.max.ru/docs/webapps/introduction)).

---

## 2. Мини-приложение (MAX Bridge)

Источники: [Подключение мини-приложения](https://dev.max.ru/docs/webapps/introduction), [MAX Bridge](https://dev.max.ru/docs/webapps/bridge), [FAQ — Мини-приложения](https://dev.max.ru/help/miniapps).

### 2.1 Подключение библиотеки

```html
<script src="https://st.max.ru/js/max-web-app.js"></script>
```

([bridge](https://dev.max.ru/docs/webapps/bridge)). После загрузки скрипта появляется глобальный объект `window.WebApp`.

Существенно для F-01/F-02:

- **npm-пакета для Bridge в документации нет** — только CDN-скрипт. Соответственно, нет ни типов TypeScript, ни версионирования пакета: типизацию `window.WebApp` придётся описывать у себя в `web/` вручную.
- URL скрипта не версионируется (`max-web-app.js` без тега версии) — обновление библиотеки на стороне MAX прилетает пользователям автоматически, зафиксировать версию нельзя.
- Мини-приложение работает **только внутри чат-бота**, самостоятельно не запускается: «подключить дополнительные сервисы к MAX, управлять ими и запускать можно только с помощью чат-бота» ([FAQ](https://dev.max.ru/help/miniapps)).
- Одновременно открыто только одно мини-приложение: «при открытии нового мини-приложения текущее закроется» ([FAQ](https://dev.max.ru/help/miniapps)).

### 2.2 initData и initDataUnsafe

- `window.WebApp.initData` — **строка**, URL-encoded набор стартовых параметров. Именно её отправляем на бэкенд для валидации ([bridge](https://dev.max.ru/docs/webapps/bridge)).
- `window.WebApp.initDataUnsafe` — тот же набор, уже разобранный в объект. Документация прямо указывает, что он **не пригоден для валидации** (ему нельзя доверять на сервере) ([bridge](https://dev.max.ru/docs/webapps/bridge)).

Поля `initDataUnsafe` ([bridge](https://dev.max.ru/docs/webapps/bridge)):

```
query_id      string
ip?           string
auth_date     number          // unix-время в секундах
hash          string
user          { id: number, first_name: string, last_name: string,
                username: string, language_code: string, photo_url: string }
chat          { id: number, type: 'DIALOG' | 'CHAT' | 'CHANNEL' }
start_param   string
```

**Противоречие в документации.** Страница [webapps/introduction](https://dev.max.ru/docs/webapps/introduction) называет `initDataUnsafe.start_param` «объектом `WebAppStartParam`», а справочник [bridge](https://dev.max.ru/docs/webapps/bridge) описывает `start_param` как строку и определения типа `WebAppStartParam` не содержит вовсе. Пример там же однозначен: для `https://max.ru/<bot>?startapp=someData` значение равно `someData`, то есть строка. Рекомендация: на фронте писать код, устойчивый к обоим вариантам (проверять `typeof`), и уточнить у организаторов.

### 2.3 Платформы и версия

- `window.WebApp.platform` → `'ios' | 'android' | 'desktop' | 'web'`;
- `window.WebApp.version` → формат `<год>.<номер сборки>.<патч>`, например `25.9.16`; **не участвует в hash-валидации**;
- `window.WebApp.deviceName` → например `iPhone 16, iOS 26.5`.

Все три метода добавлены в июле 2026 ([История изменений платформы](https://dev.max.ru/docs/changelog-platform)), то есть на старых клиентах их может не быть — проверять на `undefined`.

Поддерживаемые платформы: iOS, Android, Web, Desktop (последняя — с ограничениями, см. 2.6) ([webapps/introduction](https://dev.max.ru/docs/webapps/introduction)).

### 2.4 Методы, полезные нашему мини-приложению

Все сигнатуры — из [bridge](https://dev.max.ru/docs/webapps/bridge).

**Навигация:**
```
WebApp.BackButton.show()
WebApp.BackButton.hide()
WebApp.BackButton.isVisible            // boolean, по умолчанию false
WebApp.BackButton.onClick(cb: () => void)
WebApp.BackButton.offClick(cb: () => void)
```
Кнопки `MainButton` в справочнике **нет** — в отличие от Telegram. Основное действие рисуем своей вёрсткой.

**Контекст запуска и размеры:**
```
WebApp.getLaunchContext(): Promise<{ entryPoint: 'tabbar' | 'default' }>
   // не поддерживается до Android 26.19.2 и iOS 26.20.0
WebApp.getViewportSize(): Promise<{ height: string, width: string }>
```
Обратите внимание: `getViewportSize` — **асинхронный** и возвращает `height`/`width` **строками**, а не числами. Событий изменения вьюпорта в справочнике нет — **[?]**; для реакции на поворот экрана придётся опираться на обычный `resize`/`visualViewport` браузера.

**Подтверждение закрытия** (нужно, чтобы студент не потерял незасчитанный ответ на опрос):
```
WebApp.enableClosingConfirmation()
WebApp.disableClosingConfirmation()
```

**Сканер кода** — прямой путь «навёл камеру на QR с экрана лектора → попал в лекцию»:
```
WebApp.openCodeReader(fileSelect = true): Promise<string>
   // fileSelect = true  — камера + галерея
   // fileSelect = false — только камера
```

**Тактильная обратная связь** (подтверждение отправки ответа):
```
WebApp.HapticFeedback.impactOccurred(style, disableVibrationFallback?)
   // style: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid'
WebApp.HapticFeedback.notificationOccurred(type, disableVibrationFallback?)
   // type: 'error' | 'success' | 'warning'
WebApp.HapticFeedback.selectionChanged(disableVibrationFallback?)
```
Не поддерживается на desktop и web.

**Шаринг:**
```
WebApp.shareMaxContent({ text?, link? })                       // требует предшествующего клика пользователя
WebApp.shareMaxContent({ mid: string, chatType: 'DIALOG'|'CHAT' })
WebApp.shareContent({ text?, link? })                          // не поддерживается в web
```
При шаринге медиа по `mid` параметры `text`/`link` игнорируются ([webapps/introduction](https://dev.max.ru/docs/webapps/introduction)).

**Ссылки:**
```
WebApp.openLink(url: string)      // внешний браузер, нужен предшествующий клик пользователя
WebApp.openMaxLink(url: string)   // открывает https://max.ru/<url> внутри MAX новой панелью
```

**Хранилища:**
```
WebApp.DeviceStorage.setItem/getItem/removeItem/clear
WebApp.SecureStorage.setItem/getItem/removeItem/clear   // лимит 10 ключей на пользователя на бота
```
Оба **не поддерживаются на web и desktop**. Практический вывод: хранить сессию студента в `SecureStorage` нельзя — она отвалится на веб-клиенте. Единственный надёжный носитель состояния — наш бэкенд плюс `initData` при каждом запуске.

**Файлы:**
```
WebApp.downloadFile(url: string, file_name: string)
   // требует HTTPS и предшествующего клика; ошибки: invalid_params, request_timeout
   // не работает: скачивание через href, не-HTTPS ссылки, браузерный контекст
```

**Прочее (нам вряд ли нужно, но есть):** `requestContact()` (не поддерживается в web; ошибки `user_refused_provide_phone_number`, `request_error`), `BiometricManager` (init/authenticate/updateBiometricToken; не поддерживается на desktop и web), `requestScreenMaxBrightness()` / `restoreScreenBrightness()` (30 секунд), `ScreenCapture.enableScreenCapture()` / `disableScreenCapture()`, `NfcManager` (только Android).

### 2.5 Требования к URL мини-приложения

([webapps/introduction](https://dev.max.ru/docs/webapps/introduction), [FAQ](https://dev.max.ru/help/miniapps))

- максимум **1024 символа**;
- только **HTTPS**;
- допустимые символы: латиница, цифры, точка `.`, дефис `-`;
- пробелы запрещены; URL должен быть валиден;
- в качестве хостинга документация упоминает VK Cloud, GitHub Pages, Yandex Cloud;
- при статичном URL обновление кода подхватывается пользователями автоматически; смена URL требует ручного изменения в кабинете партнёра ([FAQ](https://dev.max.ru/help/miniapps)).

### 2.6 Известные ограничения

Подтверждено документацией:

| Ограничение | Платформы | Источник |
|---|---|---|
| `DeviceStorage`, `SecureStorage` недоступны | web, desktop | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| `HapticFeedback` недоступен | web, desktop | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| `BiometricManager` недоступен | web, desktop | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| `shareContent()` недоступен | web | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| `requestContact()` недоступен | web | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| `NfcManager` | только Android | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| `getLaunchContext()` недоступен | Android < 26.19.2, iOS < 26.20.0 | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| Диплинк `:share` | на desktop «в разработке» | [webapps/introduction](https://dev.max.ru/docs/webapps/introduction) |
| Одновременно открыто одно мини-приложение | все | [FAQ](https://dev.max.ru/help/miniapps) |
| `downloadFile` не работает в браузерном контексте и по не-HTTPS | web | [bridge](https://dev.max.ru/docs/webapps/bridge) |
| Внешние ссылки открываются только через `openLink` и требуют клика | все | [bridge](https://dev.max.ru/docs/webapps/bridge) |

**Не подтверждено и требует проверки** (было в постановке задачи, в документации не найдено):

- **размер окна мини-приложения на desktop/web** — фиксированная ли ширина, есть ли минимальные размеры, что происходит при ресайзе. Ни одна из прочитанных страниц (`introduction`, `bridge`, `help/miniapps`) этого не описывает. Есть только `getViewportSize()` как способ узнать размер в рантайме — **[?]**;
- **загрузка файлов из мини-приложения** (`<input type="file">`, drag-n-drop, доступ к камере через `getUserMedia`) — документация описывает только *скачивание* (`downloadFile`) и чтение QR (`openCodeReader`); про аплоад ничего нет — **[?]**. Для нашего сценария (студент прикладывает фото решения) это блокирующая неизвестность.

---

## 3. Валидация initData на бэкенде

Источник: [Валидация данных](https://dev.max.ru/docs/webapps/validation).

Документация даёт 10 шагов. Ниже — их изложение словами и псевдокодом. Готовый Java-класс намеренно не приводится: это задача B-02.

### 3.1 Алгоритм словами

1. **Получить сырые данные.** Документация описывает извлечение фрагмента из `USER_URL` — данных после символа `#`, где лежит параметр `WebAppData`. На практике фронтенд просто берёт готовую строку `window.WebApp.initData` и передаёт её на бэкенд — разбор фрагмента за нас уже сделал Bridge. Убедиться, что каждый параметр встречается ровно один раз.
2. **Разобрать в пары.** Разбить строку по `&`, затем каждую пару по первому `=`, получив массив `[['key','value'], ...]`.
3. **Изъять `hash`.** Проверить, что ключ `hash` присутствует **ровно один раз**. Сохранить его значение отдельно и удалить пару из массива.
4. **URL-декодировать значения**, если это не произошло автоматически при разборе. Это самое частое место ошибок (см. 3.4).
5. **Отсортировать** массив по ключам в алфавитном порядке (a → z).
6. **Собрать `launch_params`** — строку вида `key1=value1\nkey2=value2`, разделитель — символ перевода строки `\n` (LF, не CRLF).
7. **Вывести секретный ключ:** `secret_key = HMAC_SHA256(key = "WebAppData", message = BOT_TOKEN)`. Внимание на порядок аргументов: ключом является **константная строка `WebAppData`**, а подписываемым сообщением — **токен бота**.
8. **Вычислить подпись:** `signature = HMAC_SHA256(key = secret_key, message = launch_params)`.
9. **Перевести подпись в hex-строку** (нижний регистр).
10. **Сравнить** полученную hex-строку с сохранённым на шаге 3 значением `hash`. Совпало — данные подлинные.

### 3.2 Псевдокод

```
function validateInitData(initData: string, botToken: string, maxAgeSeconds: int) -> Result:

    pairs := []
    for each chunk in split(initData, "&"):
        k, v := splitOnFirst(chunk, "=")
        pairs.append( (urlDecode(k), urlDecode(v)) )

    assert countOfKey(pairs, "hash") == 1        // иначе -> INVALID
    receivedHash := valueOf(pairs, "hash")
    pairs := removeKey(pairs, "hash")

    sortByKeyAscending(pairs)

    launchParams := join( [ k + "=" + v for (k,v) in pairs ], "\n" )

    secretKey := HMAC_SHA256(key = utf8("WebAppData"), message = utf8(botToken))
    signature := HMAC_SHA256(key = secretKey,          message = utf8(launchParams))
    computed  := toLowerHex(signature)

    if not constantTimeEquals(computed, receivedHash):
        return INVALID_SIGNATURE

    // проверки сверх подписи
    authDate := parseLong(valueOf(pairs, "auth_date"))     // unix-время в СЕКУНДАХ
    now      := currentUnixSeconds()
    if now - authDate > maxAgeSeconds:  return EXPIRED
    if authDate - now > clockSkew:      return INVALID     // дата из будущего

    user := parseJson(valueOf(pairs, "user"))
    return OK(userId = user.id, startParam = valueOf(pairs, "start_param"))
```

### 3.3 Что проверять помимо `hash`

- **`auth_date` — срок жизни.** Поле приходит как unix-время в секундах ([validation](https://dev.max.ru/docs/webapps/validation)). **Конкретного TTL документация не задаёт** — **[?]**. Подпись сама по себе бессрочна, поэтому без проверки возраста украденная строка `initData` работает вечно. Рекомендация для B-02: принимать `initData` не старше 24 часов (как отраслевой дефолт), а выданную по ней собственную сессию держать отдельно; значение вынести в конфиг и уточнить у организаторов.
- **Дата из будущего** — отсекать с небольшим допуском на расхождение часов.
- **`user.id`** — привязка к нашей учётной записи студента; доверять только значению из проверенной строки, а не из `initDataUnsafe`, пришедшего с фронта.
- **`start_param`** — после проверки подписи трактовать как обычный недоверенный пользовательский ввод: валидировать по алфавиту `[A-Za-z0-9_-]`, ограничивать длину, искать код лекции в своей БД, а не декодировать «на веру».
- **Повторные использования.** `query_id` присутствует в данных; механизм одноразовости в документации не описан — **[?]**. Защиту от replay строим сами: обмениваем `initData` на нашу короткоживущую сессию один раз при входе, дальше работаем по своей сессии.

### 3.4 Типичные ошибки

| Ошибка | Симптом |
|---|---|
| Перепутан порядок аргументов HMAC на шаге 7 (подписывают `"WebAppData"` токеном вместо токена строкой `"WebAppData"`) | подпись никогда не сходится |
| `hash` не удалён из набора перед сборкой `launch_params` | подпись никогда не сходится |
| Сортировка не по ключу, а по всей паре, либо сортировка после сборки строки | сходится только случайно |
| Двойное или отсутствующее URL-декодирование (особенно у поля `user`, это JSON с `%7B`, `%22` и кириллицей) | сходится только для латиницы без спецсимволов |
| Разделитель `\r\n` вместо `\n` | подпись не сходится |
| Сравнение hex в разном регистре или обычным `equals` | ложные отказы либо тайминг-атака |
| Учитывают `version` при подсчёте подписи | подпись не сходится: «версия не участвует в hash-валидации» ([bridge](https://dev.max.ru/docs/webapps/bridge)) |
| Валидируют `initDataUnsafe`, а не `initData` | защиты нет вовсе — объект приходит с клиента |
| Подпись проверена, а `auth_date` — нет | бессрочно валидный токен |

Официальные примеры кода на странице валидации есть для **TypeScript, Python, Go и Java** ([validation](https://dev.max.ru/docs/webapps/validation)) — при реализации B-02 стоит сверить свою реализацию с тамошним Java-примером.

---

## 4. Публикация: бот и мини-приложение

Источники: [Создание и модерация чат-бота](https://dev.max.ru/docs/chatbots/bots-create/create), [webapps/introduction](https://dev.max.ru/docs/webapps/introduction), [FAQ](https://dev.max.ru/help/miniapps), [Правила размещения](https://dev.max.ru/docs/legal/rules).

### 4.1 Предусловие: профиль на платформе для партнёров

Бота нельзя создать от физлица. Нужен верифицированный профиль организации, ИП или самозанятого на платформе MAX для партнёров ([prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare), [bots-create/create](https://dev.max.ru/docs/chatbots/bots-create/create)).

Квоты по числу ботов ([bots-create/create](https://dev.max.ru/docs/chatbots/bots-create/create)):

- организация или ИП — **5 ботов**;
- самозанятый — **2 бота**.

Это организационный риск №1 для хакатона: у команды должен быть доступ к уже верифицированному профилю, верификация «за вечер» не делается.

### 4.2 Создание бота

Шаги ([bots-create/create](https://dev.max.ru/docs/chatbots/bots-create/create)):

1. Войти в профиль на платформе для партнёров.
2. Раздел «Чат-боты» → «Создать».
3. Заполнить карточку бота.
4. Отправить на модерацию.

Требования к карточке:

- **имя** — 1–59 символов, латиница/кириллица/цифры, эмодзи запрещены;
- **описание** — до 200 символов; без ненормативной лексики и контента 18+;
- **логотип** — 500×500 px, до 5 МБ, соотношение 1:1, форматы `.jpg`, `.jpeg`, `.png`;
- **никнейм** генерируется автоматически по шаблону `idИНН_bot` (для бизнеса) или `se(orgid)_bot` (для самозанятых).

Последнее важно для F-01: **никнейм бота не выбирается произвольно**, а значит диплинк `https://max.ru/<botName>?startapp=…` будет содержать сгенерированный технический идентификатор вида `id7701234567_bot`. Красивого короткого адреса для QR-кода на слайде по умолчанию не будет; возможность смены никнейма в документации не описана — **[?]**.

### 4.3 Модерация

- Срок: **до 48 часов по рабочим дням** ([bots-create/create](https://dev.max.ru/docs/chatbots/bots-create/create)).
- Уведомления о смене статуса приходят личным сообщением от бота «MAX для бизнеса».
- Статусы: **«На модерации»** (настройки менять нельзя), **«Опубликован»**, **«Нужны исправления»** (правим и отправляем повторно).
- Пользователи получают доступ к боту **только после успешной модерации**.

Риск для хакатона: до 48 часов рабочих дней означает, что бота надо заводить **до** начала соревнования, иначе демо не состоится. Если конкурс идёт с пятницы, срок фактически растягивается на понедельник.

### 4.4 Подключение мини-приложения

([webapps/introduction](https://dev.max.ru/docs/webapps/introduction), [FAQ](https://dev.max.ru/help/miniapps))

1. Мини-приложение подключается **к уже созданному боту**, отдельной сущности «мини-приложение» с собственной модерацией в документации нет.
2. Платформа MAX для партнёров → «Чат-боты» → выбрать бота → ⋮ → «Настройки».
3. Вставить URL мини-приложения в поле ссылки (требования к URL — см. 2.5).
4. Выбрать тип кнопки запуска: **«Открыть», «Запустить», «Играть»** или **без названия**.

После подключения в чате с ботом появляется заметная кнопка быстрого запуска сервиса.

Проходит ли смена URL мини-приложения повторную модерацию и сколько это занимает — не описано — **[?]**.

### 4.5 Права администрирования и правила площадки

Из [Правил размещения чат-ботов и мини-приложений](https://dev.max.ru/docs/legal/rules):

- Компания вправе проводить модерацию приложений на соответствие лицензионному соглашению, Правилам и специальным документам, **как до размещения, так и после**, а также на наличие запрещённого контента.
- Приложение может быть приостановлено без объяснения причин, если оно «не соответствует цели и назначению Сервиса, нарушает общепризнанные нормы этики, морали и приличия, создаёт угрозы Пользователям».
- Разработчик управляет метаданными приложения: название, описание, иконка, никнейм; содержимое обложек не должно нарушать права пользователей и третьих лиц и вводить их в заблуждение.
- **Персональные данные:** разработчик обязан обеспечить правовые основания для сбора и последующей обработки, надлежащее уведомление пользователя о получении персональных данных, а также сохранить пользователю свободную возможность удалить аккаунт и данные по запросу. Для нас это прямое требование: экран согласия при первом входе студента и реализованное удаление данных.
- Соответствие законодательству РФ обязательно.

Чего в Правилах **нет** (перепроверено отдельно): конкретных сроков модерации и процедуры апелляции, требований к URL, перечня запрещённого контента по категориям, описания ролей и прав администраторов приложения, ограничений на число ботов, возрастных требований. Ограничения по правам администрирования, о которых спрашивала постановка задачи, в официальной документации отсутствуют — **[?]**.

---

## 5. Официальные SDK

Организация на GitHub: [github.com/max-messenger](https://github.com/max-messenger). Лицензии и языки сверены через GitHub API.

| Пакет / репозиторий | Язык | Лицензия | Назначение |
|---|---|---|---|
| [`@maxhub/max-bot-api`](https://www.npmjs.com/package/@maxhub/max-bot-api) — [max-bot-api-client-ts](https://github.com/max-messenger/max-bot-api-client-ts) | TypeScript | **MIT** | Основной клиент Bot API. Установка: `npm install --save @maxhub/max-bot-api` ([js](https://dev.max.ru/docs/chatbots/bots-coding/js)) |
| [max-bot-api-client-go](https://github.com/max-messenger/max-bot-api-client-go) | Go | **Apache-2.0** | Клиент Bot API на Go |
| [maxbot](https://github.com/max-messenger/maxbot) | Go | Apache-2.0 | Go-фреймворк для ботов (август 2026, [changelog](https://dev.max.ru/docs/changelog-platform)) |
| [max-botapi-python](https://github.com/max-messenger/max-botapi-python) | Python | **MIT** | «Библиотека для разработки чат-ботов с помощью API мессенджера MAX» |
| [demo-bot-go](https://github.com/max-messenger/demo-bot-go) | Go | Apache-2.0 | Демо-бот, показывает возможности Bot API по сценариям (сентябрь 2026) |
| [max-bot-example-todolist](https://github.com/max-messenger/max-bot-example-todolist) | Go | Apache-2.0 | Пример приложения |
| [`@maxhub/max-ui`](https://github.com/max-messenger/max-ui) | TypeScript | см. ниже | React-библиотека компонентов для мини-приложений |

**Официального SDK для Java/Kotlin у MAX нет.** Для нашего Spring Boot-монолита это означает: либо ходить в Bot API напрямую HTTP-клиентом, либо (как и задумано в архитектуре проекта) вынести бота отдельным Node-процессом в `adapters/` на `@maxhub/max-bot-api` по образцу `adapters/telegram/telegram-adapter.mjs`. Второй вариант предпочтителен: официальный клиент закрывает webhook, проверку секрета и типы событий.

Возможности `@maxhub/max-bot-api`, релевантные B-01 ([README и docs/](https://github.com/max-messenger/max-bot-api-client-ts)):

- режимы long polling и webhook (встроенный сервер, `bot.createWebhook()`, `bot.webhookCallback()` для своего сервера);
- сессии и пошаговые сценарии; по умолчанию сессии хранятся **только в памяти процесса** и теряются при перезапуске — можно подключить SQLite для одного процесса или Redis для нескольких инстансов;
- хелперы клавиатур (`Keyboard.inlineKeyboard`, `Keyboard.button.*`);
- обработчики событий `bot.on('<update_type>', ...)` и `bot.command('<cmd>', ...)`.

### 5.1 `@maxhub/max-ui` отдельно

Источники: [dev.max.ru/ui](https://dev.max.ru/ui), [max-messenger/max-ui](https://github.com/max-messenger/max-ui), `package.json` репозитория.

- Назначение: «библиотека React-компонентов для создания мини-приложений в MAX, сторонних суперприложений, а также standalone-приложений».
- Установка: `npm i @maxhub/max-ui`.
- Подключение: `import { MaxUI } from '@maxhub/max-ui'` + `import '@maxhub/max-ui/dist/styles.css'`, приложение оборачивается в провайдер `MaxUI`.
- **Версия: `0.5.0`** (из `package.json` ветки `main`). Мажорной версии ещё нет — API может меняться без гарантий обратной совместимости.
- **Лицензия: `MIT`** — указана полем `"license": "MIT"` в `package.json`. **Внимание:** файла `LICENSE` в корне репозитория нет, и GitHub не определяет лицензию для этого репозитория (в отличие от `max-bot-api-client-ts`, где MIT распознан). Формально это расхождение; если юридическая чистота лицензии важна, нужно запросить подтверждение.
- **Версия React: строгий пин `react: "19.2.8"` и `react-dom: "19.2.8"` в `peerDependencies`.** Это принципиальное расхождение с документацией: страница [dev.max.ru/ui](https://dev.max.ru/ui) заявляет «React 18+», тогда как `package.json` требует ровно 19.2.8. Наш `web/` на Vite нужно проверить на совместимость **до** того, как команда заложится на MAX UI; при несовпадении версии установка упрётся в конфликт peer-зависимостей.
- Единственная runtime-зависимость: `@radix-ui/react-slot`; поддержка TypeScript; полиморфные компоненты через паттерн `asChild`; адаптация под iOS/Android.
- Состав: Avatar, Button/IconButton/ToolButton/CellAction, ячейки (CellSimple, CellHeader, CellInput, CellList), типографика, лейаут (Container, Flex, Grid), формы (Input, Switch, Textarea), утилиты (Counter, Dot, Spinner, SearchInput, Panel, EllipsisText, Ripple), композиции (Profile).
- Дизайн-гайдлайны в Figma: [MAXUI-Figma.fig](https://github.com/max-messenger/max-ui/blob/main/MAXUI-Figma.fig) (добавлены в августе 2026, [changelog](https://dev.max.ru/docs/changelog-platform)).

---

## 6. Страницы, прочитанные при подготовке

| Страница | Результат |
|---|---|
| [/docs/chatbots/bots-coding/prepare](https://dev.max.ru/docs/chatbots/bots-coding/prepare) | прочитана, содержательна |
| [/docs/chatbots/bots-coding/library/js](https://dev.max.ru/docs/chatbots/bots-coding/library/js) | **прочитать не удалось**: при двух обращениях страница отдавала только навигационное меню без содержимого (вероятно, контент рендерится на клиенте). Эквивалентный материал получен со страницы [/docs/chatbots/bots-coding/js](https://dev.max.ru/docs/chatbots/bots-coding/js) и из README/`docs/` репозитория SDK |
| [/docs/chatbots/bots-coding/js](https://dev.max.ru/docs/chatbots/bots-coding/js) | прочитана, содержательна |
| [/docs/chatbots/bots-create/create](https://dev.max.ru/docs/chatbots/bots-create/create) | прочитана, содержательна |
| [/docs/webapps/introduction](https://dev.max.ru/docs/webapps/introduction) | прочитана, содержательна |
| [/docs/webapps/bridge](https://dev.max.ru/docs/webapps/bridge) | прочитана, содержательна (основной справочник по методам) |
| [/docs/webapps/validation](https://dev.max.ru/docs/webapps/validation) | прочитана, содержательна |
| [/docs/legal/rules](https://dev.max.ru/docs/legal/rules) | прочитана; по многим техническим вопросам молчит |
| [/docs-api](https://dev.max.ru/docs-api) | прочитана частично: это интерактивный справочник, полная схема `open_app` через текстовое извлечение не далась |
| [/help/miniapps](https://dev.max.ru/help/miniapps) | прочитана, содержательна |
| [/docs/changelog-platform](https://dev.max.ru/docs/changelog-platform) | прочитана |
| [/ui](https://dev.max.ru/ui) | прочитана, содержательна |
| npmjs.com/package/@maxhub/max-ui | **недоступна**: HTTP 403. Данные о версии, лицензии и peer-зависимостях взяты из `package.json` в GitHub-репозитории |

---

## 7. Открытые вопросы

Сгруппированы по приоритету. Все — следствие отсутствия данных в официальной документации, а не невнимательного чтения.

### Блокирующие (без ответа нельзя зафиксировать архитектуру)

1. **Кнопка `open_app`: какая комбинация полей обязательна?** В типах SDK `web_app`, `contact_id` и `payload` все опциональны, в справочнике API схемы нет. Нужен рабочий пример JSON-вложения `inline_keyboard` с кнопкой `open_app`.
2. **Доходит ли `payload` кнопки `open_app` до мини-приложения и в каком поле?** Если он не приезжает в `start_param`, то единственный способ передать код лекции — диплинк `?startapp=`, и сценарий «кнопка под сообщением бота» придётся перестроить.
3. **Загрузка файлов из мини-приложения.** Работает ли `<input type="file">`, доступ к камере через `getUserMedia`, есть ли ограничения по размеру и типам на iOS/Android/desktop. Документация описывает только скачивание и чтение QR.
4. **Размер и поведение окна мини-приложения на desktop и web.** Фиксированные ли размеры, минимальные/максимальные значения, реакция на ресайз, есть ли событие изменения вьюпорта помимо ручного опроса `getViewportSize()`.
5. **Рекомендуемый TTL для `auth_date`.** Официального значения нет. Нужна позиция платформы, иначе выбираем сами (предлагаем 24 часа) и фиксируем в конфиге.

### Важные (влияют на надёжность и эксплуатацию)

6. **Политика доставки вебхуков:** таймаут ожидания ответа, ожидаемый HTTP-код, число и интервал повторов, поведение при длительной недоступности (отключается ли подписка). Требования к порту.
7. **Детализация лимита 30 rps:** на бота, на токен или на IP; какой код возвращается при превышении; есть ли `Retry-After`; отдельные лимиты на рассылку одному пользователю.
8. **Одноразовость `initData` / `query_id`.** Есть ли на стороне MAX защита от повторного использования, или её целиком строим у себя.
9. **Лимиты сообщений:** максимальная длина `text`, поддерживаемые значения `format` (Markdown/HTML?), размеры вложений.
10. **Есть ли способ «прогреть» диалог:** может ли бот писать студенту до того, как тот нажал «Старт» (в Telegram — нельзя). От этого зависит, можно ли рассылать уведомления всем участникам лекции или только тем, кто запустил бота.

### Организационные (к организаторам хакатона)

11. **Доступ к верифицированному профилю партнёра.** Без организации/ИП/самозанятого бота не создать; верификация занимает время. Предоставляют ли организаторы готовый профиль и бота?
12. **Модерация до 48 рабочих часов** — есть ли ускоренный трек для участников хакатона; считается ли бот «опубликованным» для жюри, если он на модерации.
13. **Никнейм бота** генерируется автоматически (`idИНН_bot` / `se(orgid)_bot`). Можно ли получить читаемый никнейм — от этого зависит вид QR-кода и ссылки на слайде лектора.
14. **Повторная модерация при смене URL мини-приложения** — проходит ли, сколько занимает. Критично, если демо-стенд переезжает между хостами.
15. **Лицензия `@maxhub/max-ui`.** В `package.json` — MIT, файла `LICENSE` в репозитории нет, GitHub лицензию не распознаёт. Нужно подтверждение, если библиотека пойдёт в продукт.
16. **Версия React для `@maxhub/max-ui`.** Документация обещает React 18+, `peerDependencies` требует ровно `19.2.8`. Какой вариант верен.
17. **`start_param`: строка или объект `WebAppStartParam`?** Две страницы документации противоречат друг другу (раздел 2.2).
18. **Права администрирования бота и мини-приложения:** можно ли добавить второго администратора, какие роли существуют, как передать бота другому сотруднику. В Правилах и документации не описано вовсе.
19. **Тестовое окружение.** Есть ли песочница/staging для мини-приложений без прохождения модерации, или все проверки идут только на боевом клиенте.
