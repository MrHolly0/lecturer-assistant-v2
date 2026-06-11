# Lecturer Assistant v2 — целевая архитектура и дорожная карта переписывания

> Статус: утверждённый план (рабочий документ)
> Дата: 2026-06-11
> Архив v1: [ROADMAP.md](ROADMAP.md), [ROADMAP_PROFILE.md](ROADMAP_PROFILE.md), [ASSISTANT_TZ.md](ASSISTANT_TZ.md) — устаревшие рабочие файлы времён латания v1; не исполняются и не поддерживаются. Всё нужное из них перенесено в этот документ; ссылки на них ниже — только исторический контекст («откуда взялось требование»).

---

## TL;DR

Переписываем продукт с нуля в **новом репозитории** как **модульный монолит (core) + отдельные процессы-адаптеры каналов (Telegram, VK, …) + единый веб-фронт**. Старый продукт продолжает работать у препода до пилота v2.

Главные изменения относительно v1:

1. **Канал доставки — плагин, а не сердце системы.** Telegram-бот перестаёт быть god-классом внутри сервиса лекций; появляется Channel SPI, под который пишутся адаптеры (TG, VK, веб-клиент студента, дальше — что угодно).
2. **Личность студента ≠ chatId Telegram.** Вводится `Person` + привязанные `ChannelIdentity`. Один студент может прийти из VK, из Telegram или из браузера — история едина.
3. **Появляются пользователи, роли и курсы.** Продукт многопользовательский: вуз → курсы → группы → студенты. Авторизация с первого дня.
4. **Все интеракции — один движок.** Тест, «один вопрос в аудиторию», опрос удовлетворённости, светофор понимания — это `Activity` с разными шаблонами, а не три параллельные подсистемы.
5. **Аналитика — событийная.** Всё пишется в append-only event store (xAPI-совместимый формат) с первого дня; дашборды — настраиваемые проекции над событиями, а не захардкоженные страницы.
6. **Никакого доменного состояния в памяти.** Диалоги бота, сессии тестов, live-опросы — всё персистентно, рестарт любого процесса ничего не теряет.

Объём: **10 фаз (0–9), ~14–16 недель** командой 2–3 человека. Каждая фаза заканчивается работающим демо.

### Как пользоваться этим документом

- Это **архитектурное ТЗ + дорожная карта**: что строим, из чего, в каком порядке и как проверяем готовность. Стартовать можно с фазы 0 без дополнительных документов.
- Здесь зафиксировано то, что **дорого менять потом**: границы модулей, модель данных, Channel SPI, формат событий, NFR, технологические решения (§3.1). Детализация до уровня эндпоинтов и DDL сознательно не здесь — по правилу «контракт раньше кода» (§12.7) она рождается в начале каждой фазы: OpenAPI-спека и Flyway-миграции и есть рабочее ТЗ фазы.
- Чек-лист фазы = беклог фазы; DoD = критерий перехода к следующей. Порядок задач внутри фазы — на усмотрение команды; решения из §3.1 меняются только через ADR.

---

## Содержание

1. [Диагноз v1: почему переписываем](#1-диагноз-v1-почему-переписываем)
2. [Цели и не-цели](#2-цели-и-не-цели)
3. [Целевая архитектура](#3-целевая-архитектура)
4. [Модули ядра](#4-модули-ядра)
5. [Channel SPI: мультиканальная доставка](#5-channel-spi-мультиканальная-доставка)
6. [Interaction Engine: тесты, опросы, поллы](#6-interaction-engine-тесты-опросы-поллы)
7. [Аналитика](#7-аналитика)
8. [Фронтенд](#8-фронтенд)
9. [Дорожная карта по фазам](#9-дорожная-карта-по-фазам)
10. [Миграция с v1](#10-миграция-с-v1)
11. [Тестирование и качество](#11-тестирование-и-качество)
12. [Правила, чтобы не понадобился v3](#12-правила-чтобы-не-понадобился-v3)
13. [Финальный приёмочный сценарий](#13-финальный-приёмочный-сценарий)
14. [Решения и открытые вопросы](#14-решения-и-открытые-вопросы)

---

## 1. Диагноз v1: почему переписываем

Не для самобичевания, а чтобы каждая болячка получила архитектурный ответ в v2. Каждый пункт проверен по текущему коду.

### 1.1 Бот вшит в доменный сервис

`lecture-broadcasting-service` одновременно: ведёт жизненный цикл лекций, держит WebSocket для фронта, ходит в три других сервиса REST-клиентами **и** содержит Telegram-бота на 1485 строк ([LectureBroadcastingBot.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/bot/LectureBroadcastingBot.java)). Добавить VK = ещё один такой же класс и дублирование всей логики диалогов. Блокировка Telegram в стране = продукт мёртв.

### 1.2 Доменное состояние живёт в памяти бота

14 `ConcurrentHashMap` внутри бота (строки 90–105): `pendingPasswordJoin`, `pendingProfileFlow`, `examSessions`, `studentCurrentSlide`, `questionTimers`… Рестарт сервиса посреди лекции теряет: все начатые тесты, все диалоги ввода профиля, позиции студентов. Горизонтальное масштабирование невозможно в принципе.

### 1.3 Идентичность студента = Telegram chatId

`chatId (Long)` протёк во все сервисы: `ExamSubmission.chatId` в quiz-service, `userId = chatId` в analytics-service, `Student.chatId` в broadcasting. Студент без Telegram не существует для системы. Сменил аккаунт — потерял историю.

### 1.4 Нет пользователей, ролей и авторизации

Ни в одном `pom.xml` нет spring-security/jwt. Все API открыты любому, кто знает адрес ([IDORSecurityTest.java](e2e-tests/src/test/java/ru/university/qatest/IDORSecurityTest.java) это и проверял). «Один препод» захардкожен в саму модель: у `Lecture` нет владельца, нет курсов, нет групп — только плоский список лекций.

### 1.5 Две параллельные модели тестов и две модели событий

- quiz-service: старая модель `Quiz/SlideQuestion/SlideRating/UserResponse` **и** новая `Exam/ExamQuestion/ExamOption/ExamSubmission/ExamAnswer` живут одновременно.
- Опрос удовлетворённости прикручен как `ExamType.SURVEY` — костыль поверх экзаменов; при этом светофор (`ComprehensionSignal`) и пост-лекционный опрос (`PostLectureResponse`) — третья и четвёртая подсистемы со своими таблицами в **другом** сервисе.
- analytics-service: `ActivityLog` и `XapiEvent` — два конкурирующих механизма событий.

### 1.6 Распил на микросервисы прошёл не по доменным швам

Гейтвей вынужден маршрутизировать `/api/exams/**` → broadcasting, `/exams/**` → quiz, `/lectures/*/exams` → quiz, `/lectures/**` → broadcasting. Это симптом: границы сервисов не совпадают с границами домена. Межсервисные вызовы — синхронный `RestTemplate` без ретраев и circuit breaker: лёг quiz-service — падает рассылка теста в боте. Типы ID расползлись (Long у лекций, UUID у экзаменов; UUID/Long баг в аналитике уже ловили).

### 1.7 Лекция-материал и лекция-событие слиплись

Сущность `Lecture` — это и контент (название, привязка к слайдам), и состояние трансляции (`status`, `currentSlide`). Прочитать один материал двум потокам в разные дни = создать две «лекции» и дважды загрузить слайды. Истории проведений нет.

### 1.8 Фронт: страницы-монолиты и localStorage

`LivePresentationPage.tsx` — 1902 строки, `TestsPage.tsx` — 1522, `StatisticsPage.tsx` — 1134. Настройки лекции хранились в localStorage (чинили в [ROADMAP.md](ROADMAP.md) №6), опрос вопросов студентов — polling раз в 5 секунд. Каждая новая фича расширяет монстра.

### 1.9 Доставка не переживёт 150 студентов

Рассылка слайда = цикл `sendPhoto` по студентам без очереди, приоритетов и учёта лимитов Telegram (~30 msg/s на бота, 1 msg/s на чат). На 150 студентах смена слайда займёт 5+ секунд при идеальной сети, а при флуд-лимите бот ловит 429 и сообщения теряются. Метрики доставки уже делали ([DeliveryMetricsService.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/service/DeliveryMetricsService.java)) — но самой очереди нет.

### 1.10 Что в v1 «хорошо» и поедет в v2

Не всё плохо — есть проверенные компоненты, переносим идеи и местами код:

| Актив v1 | Где лежит | Судьба в v2 |
|---|---|---|
| Парсеры PDF/PPTX | [PdfParserService.java](content-service/src/main/java/ru/university/contentservice/parser/PdfParserService.java), [PptxParserService.java](content-service/src/main/java/ru/university/contentservice/parser/PptxParserService.java) | Перенос почти как есть в модуль `content` |
| GIFT импорт/экспорт | [GiftParser.java](quiz-service/src/main/java/ru/university/quizservice/service/GiftParser.java), [GiftExporter.java](quiz-service/src/main/java/ru/university/quizservice/service/GiftExporter.java) + тесты | Перенос в `interaction` (банк вопросов) |
| Логика скоринга экзаменов | [ExamService.java](quiz-service/src/main/java/ru/university/quizservice/service/ExamService.java) | Референс для `interaction.grading` |
| UX-сценарии бота (join, профиль, прохождение теста, оценка слайда) | [LectureBroadcastingBot.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/bot/LectureBroadcastingBot.java) | Спецификация диалоговых флоу (код не тащим) |
| Светофор, Q&A, пост-опрос — продуктовые требования | [ASSISTANT_TZ.md](ASSISTANT_TZ.md), entities в broadcasting-service | Требования переносятся, реализация новая |
| xAPI-формат событий | [analytics-service/.../xapi/](analytics-service/src/main/java/ru/university/analyticsservice/xapi/) | База формата event store |
| Проектор через BroadcastChannel + рисование | [ProjectionPage.tsx](react-app/src/pages/ProjectionPage.tsx), [DrawingOverlay.tsx](react-app/src/features/DrawingOverlay.tsx) | Перенос паттерна и компонента |
| UI-kit (shadcn, ~50 компонентов) | [react-app/src/shared/](react-app/src/shared) | Перенос как есть |
| Tех. мониторинг Prometheus+Grafana | [docker-compose.yml](docker-compose.yml), [monitoring/](monitoring), дашборды JSON | Переезжает с минимальными правками |
| E2E и нагрузочный каркас | [e2e-tests/](e2e-tests) (`LectureLoadSimulation`, `IDORSecurityTest`) | Паттерны переносим в новый e2e |
| Ручной опыт эксплуатации | [USER_MANUAL.md](USER_MANUAL.md), [BUGS.md](BUGS.md) | Чек-лист регрессий и UX-решений |

---

## 2. Цели и не-цели

### 2.1 Продуктовые цели

- **П1. Мультиарендность вуза.** Несколько преподавателей, у каждого курсы, группы, студенты; админ вуза управляет пользователями. Продукт ставится on-prem в вузе одной командой `docker compose up`.
- **П2. Аудитория 150 человек на живой сессии** без деградации: слайды, светофор, вопросы, опросы.
- **П3. Мультиканальность.** Студент подключается из Telegram, VK или просто браузера (QR → веб-страница). Блокировка одного мессенджера не останавливает лекцию. Добавление нового канала — это новый адаптер, без изменения ядра.
- **П4. Гибкие интеракции.** Препод может: запустить готовый тест целиком; выбрать пару вопросов; кинуть N случайных; собрать одиночный вопрос за 10 секунд прямо во время лекции; запустить опрос удовлетворённости по шаблону; всё это — во время или после занятия.
- **П5. Аналитика как главный модуль.** Реалтайм-дашборд сессии + накопительная аналитика курса/группы/студента; виджеты настраиваются преподом; экспорт CSV/XLSX. Тревожные сигналы по студентам.
- **П6. Полноценное рабочее пространство лектора**: материалы, заметки, проектор-режим, рисование, история проведений, Q&A.

### 2.2 Технические цели (NFR)

| # | Требование | Метрика приёмки |
|---|---|---|
| Т1 | Доставка смены слайда в веб-канал | p95 ≤ 2 с при 150 подключённых |
| Т2 | Доставка смены слайда в Telegram | p95 ≤ 5 с при 150 получателях (file_id-кэш) |
| Т3 | Рестарт любого процесса во время лекции | сессия, диалоги, начатые тесты не теряются |
| Т4 | Отказ внешнего канала (TG API недоступен) | ядро и остальные каналы работают; сообщения копятся в outbox и доезжают |
| Т5 | Авторизация | все API закрыты; доступ по ролям; IDOR-тесты зелёные |
| Т6 | Once-only ответы | повторный сабмит ответа идемпотентен |
| Т7 | Наблюдаемость | техметрики в Prometheus, бизнес-события в event store, structured logs с trace id |
| Т8 | Установка | один `docker compose up -d` + `.env`; **всё** в контейнерах, включая фронт и конвертер презентаций — ничего не запускается руками; миграции применяются сами (Flyway) |
| Т9 | Запуск с ноутбука | compose-профиль `tunnel` даёт публичный URL без сервера и настройки сети |
| Т10 | Аудитория без интернета | презентер и проектор работают на локальном кэше дека; интерактив доступен в пределах локальной сети (standalone-режим, §3.4) |

### 2.3 Не-цели (фиксируем, чтобы не расползтись)

- **Без ИИ** — вся «ассистентность» на алгоритмах и правилах. Но event store и модульность проектируем так, чтобы ИИ-модуль был добавляемым (потребитель событий + генератор рекомендаций).
- **Не LMS.** Не заменяем Moodle: нет домашек, ведомостей, учебных планов. Есть экспорт, чтобы оценки переносились руками/файлом.
- **Без нативных мобильных приложений.** Студенту хватает мессенджера и мобильного веба (PWA).
- **Без видеотрансляции.** Мы синхронизируем слайды и интерактив, не стримим видео.
- **Не копия v1.** Фичи v1 попадают в v2 только через продуктовые требования (§1.10), а не переносом кода «как было».

---

## 3. Целевая архитектура

### 3.1 Ключевые решения (и почему)

| Область | Решение | Почему |
|---|---|---|
| Топология | **Модульный монолит `core`** + отдельные процессы-адаптеры каналов + SPA | Команда 2–3 человека. v1 показал: 5 сервисов = перекрёстные REST-клиенты, рассинхрон типов, дублирование моделей. Монолит с жёсткими границами модулей (ArchUnit) даёт ту же дисциплину без сетевой боли. Адаптеры выносим в процессы, потому что у них реально другой жизненный цикл (рестарт при смене токена, падение внешнего API, потенциально другой хостинг) |
| Язык/фреймворк | Java 21 + Spring Boot 3.x (Maven) | Компетенция команды, перенос парсеров и скоринга почти бесплатный |
| Границы модулей | Пакеты `ru.university.assistant.<module>` + ArchUnit-тесты на запрет импортов между внутренностями модулей; общение модулей — только публичные API-классы и доменные события | Дёшево, проверяется в CI; Spring Modulith — опционально, если зайдёт |
| БД | **Один PostgreSQL, одна база, схема на модуль** (`iam`, `content`, `live`, `interaction`, `analytics`, `channel`), Flyway с `V1__` | Изолированные БД v1 не дали ничего, кроме невозможности JOIN и транзакций. Схемы дают изоляцию имён, но позволяют FK там, где это оправдано |
| Идентификаторы | **UUIDv7 везде** в домене; внешние ID каналов — только в `channel_identities` | Сквозная типобезопасность; больше никогда `UUID.fromString("1")` |
| Межмодульная связь | Синхронно — Java-вызовы публичных фасадов; асинхронно — **доменные события через transactional outbox в Postgres** | Никаких Kafka/RabbitMQ на старте: лишняя операционка. Интерфейс `EventBus` абстрагирован — брокер подключаем, когда реально упрёмся |
| Связь core ↔ адаптеры | REST (internal API key) + поллинг outbox-очереди адаптером (long-poll, fallback интервал 300 мс) | Просто, отлаживаемо, переживает рестарты обеих сторон. LISTEN/NOTIFY — оптимизация потом |
| Реалтайм фронта | WebSocket (STOMP) для лектора/проектора; SSE для студенческого веб-клиента | SSE проще проксировать и авто-реконнектится; STOMP уже знаком по v1 |
| Auth | Spring Security + JWT (access 15 мин / refresh httpOnly cookie), bcrypt; роли `ADMIN`, `LECTURER`, `ASSISTANT`, `STUDENT`; интерфейс `IdentityProvider`, поверх него позже OAuth-вход Яндекс ID / VK ID | Вузовский SSO студенческой команде никто не выдаст — не планируем. Альтернатива «входа без пароля» — Яндекс/VK OAuth, после пилота |
| API | REST `/api/v1/**`, OpenAPI-спека в репо — **contract-first**, генерация TS-типов (`openapi-typescript`) для фронта | Убирает класс багов «фронт ждёт другое поле» |
| Файлы | Интерфейс `BlobStorage`: локальная ФС (по умолчанию) / S3-совместимое (MinIO) | Вузу хватит тома; облако — конфигом |
| Деплой | `docker-compose.prod.yml`: `core`, `telegram-adapter`, `vk-adapter`, `postgres`, `converter` (LibreOffice), `caddy` (TLS + статика фронта + reverse proxy), `prometheus`, `grafana`. Профили: `prod` (сервер), `standalone` (ноутбук без интернета, §3.4), `tunnel` (+cloudflared — публичный URL с ноутбука) | Отдельный gateway-сервис больше не нужен — его работу делает Caddy. Фронт собирается в образ на CI: больная мозоль v1 «vite руками» исключается by design |
| Репозиторий | **Новый** (`lecturer-assistant-v2`), монорепо | Чистая история, чистый CI; старый репо живёт до конца миграции |

### 3.2 Топология

```
                ┌──────────────────────────── ВУЗ / docker compose ────────────────────────────┐
                │                                                                               │
   Лектор ──────┤  ┌─────────┐      ┌────────────────────── core (Spring Boot) ─────────────┐  │
   (браузер)    │  │  Caddy  │ ───▶ │                                                        │  │
   Проектор ────┤  │ TLS,    │      │  iam │ org │ content │ live │ interaction │ qa │       │  │
   (браузер/    │  │ статика,│      │  feedback │ analytics │ channel-hub │ shared           │  │
    Electron)   │  │ proxy   │      │                          │                             │  │
   Студент-веб ─┤  └─────────┘      │   Postgres ◀─ Flyway     │ outbox (per channel)        │  │
   (QR → /s/…)  │                   └──────────────────────────┼─────────────────────────────┘  │
                │                                              │ REST + long-poll               │
                │                  ┌───────────────────┐   ┌───┴───────────────┐                │
                │                  │  telegram-adapter │   │    vk-adapter     │  … N адаптеров │
                │                  └─────────┬─────────┘   └────────┬──────────┘                │
                │                            │                      │                           │
                └────────────────────────────┼──────────────────────┼───────────────────────────┘
                                             ▼                      ▼
                                      Telegram Bot API        VK Callback API
```

- **core** — единственный владелец БД и домена. Адаптеры stateless (кроме кэша file_id), их можно убивать и перезапускать.
- **Студенческий веб-канал** — встроен в core (SSE + REST), это «нулевой адаптер», который всегда доступен и не зависит от внешних API.
- Electron остаётся тонкой обёрткой над проектор-страницей (низкий приоритет, см. фазу 9).

### 3.3 Доменная модель (ядро)

Сводный словарь. Детали таблиц — в модулях (§4).

| Сущность | Смысл | Ключевые связи |
|---|---|---|
| `Person` | Человек (любая роль) | 1—N `ChannelIdentity`, M—N `Course` через membership |
| `ChannelIdentity` | Привязка person к каналу (`telegram:123456`, `vk:789`, `web:cookie`) | unique(channel_type, external_id) |
| `Course` | Дисциплина/поток у конкретного лектора | владелец-`Person`, N групп, N лекций, банк вопросов |
| `StudyGroup` | Учебная группа (БВТ-21-1) | M—N студентов |
| `SlideDeck` / `Slide` / `SlideNote` | Презентация и её слайды (контент, версионируемый) | принадлежит курсу |
| `Lecture` | Лекция-материал: тема, дек, материалы | принадлежит курсу |
| `LectureSession` | **Проведение** лекции: дата, статус, join-код, текущий слайд, лог слайдов | N participants, N activity runs |
| `SessionParticipant` | Участие person в сессии (когда вошёл/вышел, через какой канал) | |
| `Question` (bank) | Вопрос банка курса: тип, варианты, теги, сложность | M—N `ActivityDefinition` |
| `ActivityDefinition` | Шаблон интеракции: QUIZ / QUICK_POLL / SURVEY | N runs |
| `ActivityRun` | Запуск активности на сессии (или после неё): окно, стратегия выборки, аудитория | N responses |
| `ActivityResponse` / `ResponseAnswer` | Прохождение активности участником и ответы по вопросам | |
| `StudentQuestion` (Q&A) | Вопрос студента лектору + апвоуты + ответ | сессия |
| `ComprehensionSignal` | Светофор понимания по слайду | сессия, слайд |
| `EventRecord` | Append-only событие (xAPI-совместимое) — пишут ВСЕ модули | |
| `DialogState` | Персистентное состояние диалога с пользователем в канале | channel_identity |
| `OutboxMessage` | Очередь исходящей доставки per канал | |

**Главные развязки относительно v1:**
- `Lecture` (контент) ≠ `LectureSession` (событие). Один материал — много проведений, у каждого своя аналитика.
- `Person` ≠ `ChannelIdentity`. Канал — способ доступа, не личность.
- `Question` живёт в банке курса, а не внутри теста; тест — это выборка из банка (или ad-hoc вопрос, который автоматически попадает в банк с тегом `ad-hoc`).

### 3.4 Режимы деградации: сеть и мессенджеры

Продукт работает в аудитории, где сеть — самое слабое звено. Проектируем не «авось», а явные режимы:

| Сценарий | Что отвалилось | Ответ архитектуры |
|---|---|---|
| D1. Мессенджер заблокирован или лёг (TG/VK) | один канал | Веб-канал (§5.4) всегда доступен — QR на проекторе ведёт в браузер; недоставленное копится в outbox и доезжает, когда канал оживёт. Это базовый кейс, ради него каналы и вынесены в адаптеры |
| D2. Лёг наш сервер, интернет в аудитории есть | всё | Standalone-режим на ноутбуке лектора (ниже) + ежедневный бэкап БД (`deploy/backup.sh`). Лекция проводится, аналитика остаётся в локальной БД |
| D3. В аудитории нет интернета вообще | всё внешнее | **Показ не страдает:** презентер прекэширует весь дек при старте сессии (service worker), смена слайдов и рисование — optimistic-local, проектор синхронизируется через BroadcastChannel без сети. Интерактив — только в пределах локальной сети (ниже) |
| D4. Никакой сети и 150 человек | интерактив | Честно: интерактива нет. Лекция идёт (D3), вопросы голосом. Это предел разумного без спецоборудования |

**Standalone-режим** (`docker compose --profile standalone up` на ноутбуке):

- core + postgres + статика поднимаются локально; QR показывает LAN-URL (`http://192.168.x.x/s/{код}`) — студенческий веб-клиент работает в локальной сети без интернета;
- раздача сети — слабое место, цифры честные: hotspot с ноутбука держит ~10 устройств (лимиты ОС и Wi-Fi-адаптера) — хватает на семинар, не на поток. Для аудитории — карманный роутер или своя точка доступа без аплинка (нормальный AP — 50–100 клиентов, на 150 человек — две). В кампусном Wi-Fi часто включена изоляция клиентов — тогда свой AP обязателен;
- адаптеры мессенджеров в этом режиме не стартуют; появился интернет — Telegram-адаптер просто включается (long polling, публичный IP не нужен);
- синхронизацию standalone → сервер **не делаем** (решение 2026-06-11): standalone-инсталляция самодостаточна, её аналитика живёт в её БД.

**Режим «локально, но с интернетом»** — профиль `tunnel`: cloudflared пробрасывает публичный https-URL на ноутбук без покупки сервера и настройки роутера. Нужен только студентам-вебу: Telegram-адаптер работает по long polling из-за NAT без всяких туннелей.

---

## 4. Модули ядра

Для каждого модуля: ответственность, основные таблицы (схема Postgres), публичный API, что смотреть в v1.

### 4.1 `shared` — общее ядро

- Базовые типы (`PersonId`, `SessionId` — typed UUID-обёртки), время (везде `Instant`, UTC), ошибки (RFC 7807 problem+json), `EventBus` (publish в outbox + in-process подписчики), `BlobStorage`, пагинация, аудит-поля (`created_at`, `updated_at`).
- ArchUnit-правила: модуль X не импортирует `internal`-пакеты модуля Y; контроллеры не трогают репозитории чужих модулей; entity не покидают модуль (наружу — только DTO).

### 4.2 `iam` — пользователи и доступ

**Таблицы (`iam.*`):** `persons` (id, display_name, email?, password_hash?, role, status), `channel_identities` (person_id, channel_type, external_id, display_hint, linked_at), `refresh_tokens`, `invitations` (код приглашения лектора/студента, scope, expires_at).

**API:** регистрация по приглашению, login/refresh/logout, CRUD пользователей (ADMIN), привязка канала по коду (`POST /api/v1/identity/link {code}` из адаптера).

**Провайдеры входа:** фаза 1 — email+пароль (по приглашению админа/лектора). После пилота — кнопки «Войти через Яндекс ID / VK ID» поверх того же `IdentityProvider` (spring-security-oauth2-client, провайдеры включаются конфигом). Вузовский SSO/LDAP не планируем — студенческой команде его не выдадут; если вуз когда-нибудь дозреет, это просто ещё одна реализация интерфейса, ядро не меняется.

**Уровни идентификации студента** (настройка на курсе/сессии, обобщение `requireStudentProfile` из v1):
1. `EPHEMERAL` — вошёл по join-коду без имени (открытая лекция); Person создаётся временный, история не накапливается.
2. `PROFILE` — канал привязан + ФИО и группа заполнены (диалог как в v1, см. флоу профиля в боте).
3. `ACCOUNT` — полноценный аккаунт с email (нужен для веб-кабинета студента; необязателен на старте).

**Смотреть в v1:** [ROADMAP_PROFILE.md](ROADMAP_PROFILE.md) (валидации ФИО/группы, подводные камни), `BannedUser` → в v2 бан на уровне курса/сессии (`iam.bans`).

### 4.3 `org` — курсы и группы

**Таблицы (`org.*`):** `courses` (owner_person_id, title, archived), `course_members` (course_id, person_id, role: LECTURER/ASSISTANT/STUDENT), `study_groups` (course_id, name), `group_members`.

**API:** CRUD курсов, приглашения (ссылка/код на курс или группу), загрузка ростера группы (XLSX/CSV).

**Ростер группы (деканатский список).** Лектор загружает список группы (колонки: ФИО, опционально № зачётки). Таблица `org.roster_entries` (group_id, full_name, normalized_name, matched_person_id?, source_row). Принцип: студент **всегда вводит ФИО сам** (в боте или вебе), ростер — для сверки и исправления опечаток:

1. нормализация ввода и ростера (нижний регистр, `ё→е`, дефисы/двойные пробелы, порядок «Фамилия Имя»);
2. точное совпадение → берётся каноническое ФИО из ростера (опечатки в регистре/пробелах правятся молча), запись привязывается к person;
3. нечёткое совпадение (Левенштейн ≤2 на токен, один кандидат) → подтверждение: «Иванов Сергей, БВТ-21-1 — это вы?»;
4. кандидатов несколько или ноль → сохраняем как ввёл + флаг «вне списка»; лектор видит таких в панели группы и привязывает вручную (или принимает как есть).

Один roster_entry привязывается максимум к одному person; конфликт повторной привязки решает лектор. Реализация — фаза 7.

**Правило доступа:** всё в системе (лекции, сессии, активности, аналитика) принадлежит курсу; проверка прав — членство в курсе с нужной ролью. Это единая точка авторизации вместо «у лекции нет владельца» из v1.

### 4.4 `content` — материалы

**Таблицы (`content.*`):** `slide_decks` (course_id, title, version, source_file_ref), `slides` (deck_id, idx, image_ref, text_extract), `slide_notes`, `attachments` (произвольные файлы к лекции).

**Конвейер импорта — НЕ перенос v1-парсеров.** Парсеры v1 ([PdfParserService.java](content-service/src/main/java/ru/university/contentservice/parser/PdfParserService.java), [PptxParserService.java](content-service/src/main/java/ru/university/contentservice/parser/PptxParserService.java)) неуниверсальны: POI-рендер PPTX теряет шрифты, SmartArt, нестандартные раскладки — «не всё парсят» уже подтверждено практикой. Конвейер v2:

1. `PPTX/PPT/ODP → PDF` — **LibreOffice headless** в отдельном контейнере `converter` (родной рендер офисных форматов, переживает почти всё);
2. `PDF → PNG` постранично — poppler (`pdftoppm`) + извлечение текста (`pdftotext`) для аналитики и поиска;
3. загруженный напрямую PDF проходит только шаг 2.

После импорта — обязательный предпросмотр всех слайдов («что-то съехало → поправьте исходник или загрузите PDF»). Регрессия: golden-набор реальных презентаций препода (выгрузить из хранилища v1) прогоняется в CI. Тесты v1-парсеров переносим как базу кейсов; [FileStorageService.java](content-service/src/main/java/ru/university/contentservice/storage/FileStorageService.java) адаптируется под `BlobStorage`.

**Новое:** версии дека (повторная загрузка файла = новая версия, старые сессии ссылаются на свою), лимиты размера, фоновая обработка загрузки (таблица `content.import_jobs` + статус, чтобы фронт показывал прогресс — в v1 загрузка была синхронной и подвисала на больших PDF).

### 4.5 `live` — лекционные сессии

Сердце «работы в аудитории».

**Таблицы (`live.*`):** `lectures` (course_id, title, deck_id, default_settings jsonb), `sessions` (lecture_id, status, join_code, current_slide_idx, started_at, ended_at, settings jsonb — анонимность Q&A, требуемый уровень идентификации, разрешённые каналы), `session_participants` (session_id, person_id, channel_type, joined_at, left_at, kicked), `slide_log` (session_id, slide_idx, entered_at) — хронометраж для аналитики.

**State machine сессии:** `SCHEDULED → LIVE ⇄ PAUSED → ENDED → ARCHIVED`. Переходы публикуют события (`session.started`, `session.slide_changed`, `session.ended`…) — их слушают channel-hub (рассылка), analytics (запись), interaction (автозапуск опроса после `ENDED`).

**Live-обмен:** WebSocket-хаб для лектора и проектора (`/ws/session/{id}`: смена слайда, аннотации, агрегаты светофора, счётчики Q&A и активностей — пуш, никакого polling). Проектор-вью получает то же по WS **плюс** локальный BroadcastChannel-режим, как в v1 ([ProjectionPage.tsx](react-app/src/pages/ProjectionPage.tsx)) — работает даже без сети до сервера.

**Восстановление:** всё состояние сессии в БД; F5 лектора, рестарт core, переподключение студентов — сессия продолжается. In-memory только то, что можно потерять (открытые WS).

**Смотреть в v1:** [LectureService.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/service/LectureService.java) (жизненный цикл, join-логика), [WebSocketConfig.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/websocket/WebSocketConfig.java), баг со смещением слайда из-за QR-слайда (FIX_PLAN s1) — в v2 нумерация слайдов единая, без виртуальных слайдов.

### 4.6 `qa` — вопросы лектору

Перенос требований из [ASSISTANT_TZ.md](ASSISTANT_TZ.md) фича 2 + задачи 4, 8, 9 из [ROADMAP.md](ROADMAP.md), которые в v1 уже частично сделаны (`StudentQuestionEntity`, `QuestionUpvote` + Flyway V6).

**Таблицы (`qa.*`):** `questions` (session_id, author_person_id, text, anonymous, status: PENDING/ANSWERED/DISMISSED/ARCHIVED, answer_text, answered_via: PRIVATE/BROADCAST), `upvotes`.

**Поведение:** студент задаёт вопрос из любого канала; лектор видит очередь (сортировка по апвоутам) в live-панели по WS; ответ — лично автору (+ всем апвоутнувшим) или вещанием; статусы видны студенту («лектор увидел / ответил»). Анонимность — настройка сессии поверх профиля.

### 4.7 `feedback` — светофор и быстрые сигналы

Перенос фичи 1 из [ASSISTANT_TZ.md](ASSISTANT_TZ.md) (в v1 — `ComprehensionSignal`, `ComprehensionService`).

**Таблицы (`feedback.*`):** `comprehension_signals` (session_id, person_id, slide_idx, value: GREEN/YELLOW/RED, upsert по (session, person, slide)).

Агрегат по текущему слайду пушится лектору по WS. Кнопки светофора доступны студенту постоянно: в вебе — на экране, в мессенджерах — закреплённая клавиатура.

> Светофор и Q&A сознательно **не** засунуты в Activity Engine: у них нет жизненного цикла «запуск → окно → результаты», это постоянно доступные механики сессии. Общее у них с активностями одно — события в event store.

### 4.8 `interaction` — Activity Engine

Подробно в §6.

### 4.9 `channel` — хаб каналов

Подробно в §5.

### 4.10 `analytics` — событийная аналитика

Подробно в §7.

---

## 5. Channel SPI: мультиканальная доставка

Центральный ответ на «бот вшит в сервис».

### 5.1 Контракты

```java
// ── Outbound: core → канал ──────────────────────────────────────────────
/** Канало-независимое сообщение. Рендерится из доменного интента. */
record OutboundMessage(
    UUID id,                    // идемпотентность
    UUID channelIdentityId,     // кому
    Priority priority,          // P0_INTERACTIVE > P1_ACTIVITY > P2_SLIDE > P3_BULK
    Content content,            // text | image(ref) | document(ref)
    List<List<Button>> keyboard,// inline-кнопки: text + callback payload
    ReplyMode replyMode,        // NEW | EDIT_LAST(threadKey) — «обновить сообщение со слайдом»
    String threadKey            // группировка: "slide", "activity:{runId}", "qa:{qId}"
) {}

/** Что умеет канал — ядро подстраивает рендеринг. */
record ChannelCapabilities(
    boolean inlineButtons, boolean editMessage, boolean images,
    int maxTextLength, int maxButtonsPerRow
) {}

// ── Inbound: канал → core ───────────────────────────────────────────────
record InboundEvent(
    String channelType,         // "telegram" | "vk" | "web" | ...
    String externalUserId,      // chatId / vk id / web session id
    Kind kind,                  // COMMAND | TEXT | CALLBACK
    String text,                // текст или payload callback'а
    Instant occurredAt
) {}
```

**Адаптер** (отдельный процесс) обязан уметь ровно четыре вещи:
1. Поллить свой outbox в core: `GET /internal/v1/channels/{type}/outbox?wait=25s` (long-poll, батч до 100).
2. Отправлять в свой мессенджер с учётом **своих** лимитов, докладывать результат: `POST /internal/v1/channels/{type}/delivery-reports` (delivered/failed + причина).
3. Нормализовать входящие апдейты в `InboundEvent` и слать в core: `POST /internal/v1/channels/{type}/inbound`.
4. Отдавать `ChannelCapabilities` при регистрации.

Вся доменная логика (что ответить, какой диалог запустить) — в core. Адаптер тупой: транспорт + лимиты + маппинг форматов. Поэтому VK-адаптер — это ~500 строк, а не второй бот на 1485.

### 5.2 Delivery pipeline в core

```
доменное событие (session.slide_changed)
  → ChannelFanoutService: кому? (участники сессии) → какой intent?
  → MessageRenderer(capabilities): OutboundMessage per получатель
  → таблица channel.outbox (статус QUEUED)
  → адаптер забирает по приоритету → шлёт → report → DELIVERED/FAILED(retry n/3 c backoff) → DLQ
```

- **Идемпотентность:** `OutboundMessage.id` — адаптер не отправит дважды.
- **Rate limits:** token bucket в адаптере TG: 25 msg/s глобально, 1 msg/s на чат; при 429 — пауза по `retry_after`. Приоритеты: ответ на нажатие кнопки (P0) обгоняет рассылку слайдов (P2).
- **file_id-кэш (Telegram):** слайд загружается один раз (`channel.tg_file_cache`: blob_ref → file_id), остальные 149 отправок — мгновенные по file_id. Это и есть выполнение Т2 (≤5 с на 150 получателей).
- **EDIT_LAST:** смена слайда редактирует предыдущее сообщение со слайдом (v1 уже хранил `lastSlideMessageId` — теперь это колонка `channel.thread_refs`, а не HashMap).
- **Метрики:** перенести идеи [DeliveryMetricsService.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/service/DeliveryMetricsService.java) и [TelegramTrafficInterceptor.java](lecture-broadcasting-service/src/main/java/ru/university/lecturebroadcasting/bot/TelegramTrafficInterceptor.java): latency p95, throughput, error rate, очередь — в Prometheus, дашборд из [dashboard_telegram_latency.json](dashboard_telegram_latency.json) адаптировать.

### 5.3 Диалоги (state machines вместо HashMap)

Таблица `channel.dialog_states` (channel_identity_id PK, flow_type, step, payload jsonb, expires_at). Flow-движок в core: `JoinFlow` (код → пароль? → профиль? → подключение), `ProfileFlow` (ФИО → группа, валидации из [ROADMAP_PROFILE.md](ROADMAP_PROFILE.md) задача 2; при загруженном ростере — сверка и канонизация ФИО по §4.3), `QuestionFlow`, `ActivityFlow` (прохождение теста). UX-эталон — текущий бот: команды/кнопки `/join`, `/current`, `/question`, `/profile`, `/help` сохраняем, чтобы студентам v1 ничего не переучивать.

Любое входящее сообщение обрабатывается так: активный диалог? → шаг диалога; иначе команда? → хендлер; иначе — контекстная подсказка. Рестарт core/адаптера не теряет диалог (Т3).

### 5.4 Подключение студента к сессии

1. Лектор стартует сессию → join-код (короткий, ротируемый) + QR на экране (QR генерится локально — урок задачи 10 из [ROADMAP.md](ROADMAP.md)).
2. QR ведёт на `https://…/s/{joinCode}` — **веб-канал**: вход мгновенный, дальше предложение «продолжить в Telegram/VK» (deep-link `t.me/bot?start={code}` — привязывает ChannelIdentity к тому же Person).
3. Либо студент сразу пишет боту `/join КОД`.
4. Сессия может ограничивать каналы и требовать уровень идентификации (§4.2).

### 5.5 Roadmap каналов

| Канал | Фаза | Примечание |
|---|---|---|
| Web (встроенный) | 5 | always-on, эталон SPI |
| Telegram | 4 | паритет с v1, long polling (webhook — опция конфигом) |
| EchoAdapter (тестовый) | 4 | CLI/REST-заглушка для дев-среды и контрактных тестов без токенов |
| VK | 8 | приоритет №2 после Telegram; Long Poll / Callback API, лимит ~20 msg/s |
| MAX / WhatsApp / Discord | не планируются | MAX не даёт публичного Bot API; WhatsApp и Discord заблокированы в РФ. SPI оставляет дверь открытой — появится возможность, пишется адаптер без правок ядра (чек-лист `docs/how-to-add-channel.md`) |

---

## 6. Interaction Engine: тесты, опросы, поллы

Один движок вместо четырёх подсистем v1 (Exam, ExamType.SURVEY, SlideQuestion/SlideRating, live-poll из планов).

### 6.1 Модель

**Банк вопросов (`interaction.questions`):** course_id, type (`SINGLE` | `MULTI` | `OPEN` | `SCALE_1_5` | `TEXT_FEEDBACK`), text, options jsonb (для SINGLE/MULTI: текст + correct), tags text[], difficulty, source (`MANUAL` | `GIFT_IMPORT` | `AD_HOC`), archived.

**GIFT — переписываем парсер, а не переносим.** v1-парсер ([GiftParser.java](quiz-service/src/main/java/ru/university/quizservice/service/GiftParser.java)) спотыкался на реальных файлах. Требования к новому:

- разбор по формальной грамматике GIFT (спека Moodle), а не регулярками: экранирование (`\:` `\=` `\#` `\~` `\{` `\}`), комментарии `//`, многострочные вопросы, заголовки `::название::`, форматы `[html]`/`[markdown]`, веса `~%50%`, фидбек `#…`;
- типы: SINGLE/MULTI, TRUE/FALSE, SHORTANSWER; NUMERICAL и MATCHING — поддержать или дать **внятную ошибку** «тип не поддерживается, строка N» (v1 портил молча);
- каждая ошибка парсинга — с номером строки и фрагментом; частично-валидный файл импортируется с отчётом «28/30, две ошибки: …»;
- round-trip тест (export → import = эквивалентный банк) + golden-набор реальных GIFT-файлов ([E2E_Exam.gift](E2E_Exam.gift) + файлы препода из quiz_db) в CI;
- [GiftParserTest.java](quiz-service/src/test/java/ru/university/quizservice/service/GiftParserTest.java) и [GiftExporter.java](quiz-service/src/main/java/ru/university/quizservice/service/GiftExporter.java) — стартовая база кейсов.

**Определение (`interaction.activity_definitions`):** course_id, kind (`QUIZ` | `QUICK_POLL` | `SURVEY`), title, config jsonb:
- QUIZ: список question_ids **или** selection-правило, тайминги (на тест/на вопрос), показывать ли результат студенту, граница оценки;
- QUICK_POLL: один вопрос (из банка или созданный на лету — он же сохраняется в банк с тегом `ad-hoc`), длительность окна;
- SURVEY: набор шкал/полей; **шаблон «Удовлетворённость» поставляется из коробки** (оценка 1–5, темп COMFORTABLE/FAST/TOO_FAST, открытый комментарий — ровно фича 6 из [ASSISTANT_TZ.md](ASSISTANT_TZ.md), уже обкатанная в v1 как `PostLectureResponse`).

**Запуск (`interaction.activity_runs`):** definition_id, session_id?, opened_at, closes_at?, status (`OPEN` → `CLOSED` → `RELEASED`), selection (`ALL` | `RANDOM_N{n}` | `MANUAL{ids}`), audience (`SESSION` | `GROUP{id}` | `PERSONS{ids}`), anonymous, materialized_question_ids (зафиксированная выборка — чтобы RANDOM_N был одинаков для всех и воспроизводим).

**Ответы:** `activity_responses` (run_id, person_id, started_at, completed_at) + `response_answers` (question_id, selected jsonb / open_text, auto_score, manual_score, max_score). Уникальность (run_id, person_id) — guard от двойного прохождения (в v1 чинили руками в боте).

### 6.2 Жизненный цикл и сценарии препода

| Сценарий | Как делается |
|---|---|
| «Полный тест после лекции» | QUIZ definition со всеми вопросами → run с `closes_at` = +30 мин, audience = SESSION |
| «Кинуть 3 случайных вопроса сейчас» | существующий QUIZ → run c `RANDOM_N{3}`, окно 5 минут |
| «Быстро спросить аудиторию» | кнопка «Быстрый вопрос» в live-панели: текст + варианты → QUICK_POLL run одним действием (≤10 секунд на создание; требование задачи 1 из [ROADMAP.md](ROADMAP.md)) |
| «Удовлетворённость» | системный SURVEY-шаблон; вручную или автозапуск на событие `session.ended` (настройка сессии) |
| «Пересдача для одного студента» | run с audience = PERSONS{...} (замена `/api/exams/launch-to-user` из v1) |

Скоринг: SINGLE/MULTI — авто (правила переноса из [ExamService.java](quiz-service/src/main/java/ru/university/quizservice/service/ExamService.java)); OPEN — ручная оценка в UI; SCALE/TEXT_FEEDBACK — не оцениваются, агрегируются.

`RELEASED` — отдельный шаг «опубликовать разбор студентам» (фича 3 из [ASSISTANT_TZ.md](ASSISTANT_TZ.md)): каждому в его канал — что верно/неверно + «так ошиблись N% группы», **без** правильных ответов; повторный release — конфликт (409).

### 6.3 Доставка и live-результаты

Запуск run → событие `activity.opened` → channel-hub рассылает prompt всем целевым участникам в их каналы (inline-кнопки в TG/VK, форма в вебе). Каждый ответ → событие `activity.answered` → WS-пуш лектору: «37/120 ответили, распределение по вариантам, % правильных» (требование задачи 2 из [ROADMAP.md](ROADMAP.md)). Закрытие — по таймеру или кнопкой.

---

## 7. Аналитика

### 7.1 Event store — единственный источник правды

Таблица `analytics.events` (append-only, партиционирование по месяцу):

```json
{
  "id": "0190…uuid7",
  "actor":   {"personId": "…", "role": "STUDENT"},
  "verb":    "answered",
  "object":  {"type": "activity_question", "id": "…"},
  "context": {"courseId": "…", "sessionId": "…", "groupId": "…",
              "slideIdx": 14, "activityRunId": "…", "channel": "telegram"},
  "result":  {"correct": true, "score": 1, "durationMs": 8400},
  "occurredAt": "2026-09-01T10:14:08Z"
}
```

Формат xAPI-совместимый — наработки v1 переносимы ([XapiEvent.java](analytics-service/src/main/java/ru/university/analyticsservice/xapi/entity/XapiEvent.java), [XapiEventService.java](analytics-service/src/main/java/ru/university/analyticsservice/xapi/service/XapiEventService.java)). Словарь verbs фиксируем в `docs/events.md`: `joined`, `left`, `slide_viewed`, `signaled_comprehension`, `asked`, `upvoted`, `answered`, `completed`, `rated`, `session_started`, `slide_changed`, `activity_opened`, … Пишут все модули через `EventBus` (в одной транзакции с доменным изменением — outbox гарантирует консистентность).

> **Разделение:** продуктовая аналитика (для препода) живёт в продукте на event store. Prometheus/Grafana — только техметрики (latency, очереди, JVM). В v1 это смешивалось — преподу предлагали смотреть Grafana.

### 7.2 Проекции

Подписчики событий ведут материализованные агрегаты (пересоздаваемые с нуля прогоном по events — это страховка от багов в агрегации):

- `proj_attendance` — посещаемость: session × person × канал × время;
- `proj_slide_engagement` — по слайдам: время на слайде (из slide_log), светофор, вопросы;
- `proj_scores` — результаты: person × run × score (+ percentile);
- `proj_student_summary` — карточка студента: участие, средний балл, тренд, тревожные флаги (правила из фичи 5 [ASSISTANT_TZ.md](ASSISTANT_TZ.md): 3 сессии подряд <50%, пропуск 2+ активностей, нисходящий тренд);
- `proj_group_summary` — срез по группам (требование задачи 7 из [ROADMAP_PROFILE.md](ROADMAP_PROFILE.md)).

### 7.3 Дашборды препода

**Live-дашборд сессии** (в презентер-вью, WS): присутствие, светофор текущего слайда, очередь вопросов, прогресс активной activity.

**Аналитика курса** (страница): набор **виджетов**, который препод собирает сам — `lecturer_dashboard_configs` (person_id, course_id, layout jsonb: какие виджеты, порядок, параметры). Каталог виджетов v2.0:

| Виджет | Источник |
|---|---|
| Посещаемость по сессиям (тренд) | proj_attendance |
| Понимание по слайдам конкретной сессии | proj_slide_engagement |
| Результаты активности (распределение, по вопросам) | proj_scores |
| Сравнение групп | proj_group_summary |
| Топ непонятных тем (теги вопросов с худшим % правильных) | proj_scores × question tags |
| Удовлетворённость (динамика по сессиям) | SURVEY-агрегаты |
| Студенты риска | proj_student_summary |
| Воронка Q&A (задано/отвечено/в архиве) | qa events |

Каждый виджет: фильтры (период, группа, сессия) + **экспорт CSV** (UTF-8 BOM — урок задачи 13 из [ROADMAP.md](ROADMAP.md)); сводный экспорт XLSX по курсу. Карточка студента — отдельная страница (фича 5 [ASSISTANT_TZ.md](ASSISTANT_TZ.md)) + `/mystats` студенту в канале (фича 4).

**Смотреть в v1:** [StatisticsPage.tsx](react-app/src/pages/StatisticsPage.tsx) и [StatsPanel.tsx](react-app/src/features/StatsPanel.tsx) — как референс уже придуманных представлений; [ClarityMetricsService.java](analytics-service/src/main/java/ru/university/analyticsservice/xapi/service/ClarityMetricsService.java); грабли UUID/Long из `ActivityLog` — в v2 невозможны по построению (§3.1, UUIDv7 везде).

---

## 8. Фронтенд

### 8.1 Стек и структура

React 18 + Vite + TypeScript, **TanStack Query** (серверное состояние) + лёгкий клиентский стор (zustand) для live-сессии, типы API — генерация из OpenAPI (`openapi-typescript`). UI-kit shadcn переносится из [react-app/src/shared/](react-app/src/shared) как есть, вместе с темой из [react-app/src/styles/](react-app/src/styles) — **дизайн берём из v1, а не изобретаем** (§8.3).

```
web/src/
├── app/        # роутер, провайдеры, сгенерированный api-клиент, ws/sse-клиенты
├── shared/     # ui-kit (перенос), lib, hooks
├── entities/   # course, lecture, session, activity, person — типы + query-хуки
├── features/   # slide-control, drawing-overlay, qa-panel, comprehension-widget,
│               # activity-launcher, question-bank-editor, dashboard-widgets/…
├── pages/      # тонкие композиции (≤300 строк, иначе ревью не проходит)
│   ├── lecturer/   # курсы, материалы, банк, сессии, аналитика, настройки
│   ├── presenter/  # live-вью лектора + projection-вью (BroadcastChannel)
│   └── student/    # /s/{joinCode} — мобильный веб-клиент студента
└── widgets/    # сборные блоки дашбордов
```

Запреты, выученные на v1: никакого localStorage для доменных данных (только UI-предпочтения); никакого polling там, где есть WS/SSE; страница не ходит в `fetch` напрямую — только через entity-хуки.

### 8.2 Три рабочих места

1. **Кабинет лектора** — курсы, материалы, банк вопросов, конструктор активностей, аналитика, настройки.
2. **Презентер + проектор** — режим аудитории: слайды, рисование ([DrawingOverlay.tsx](react-app/src/features/DrawingOverlay.tsx) переносится), заметки, live-панели (светофор, Q&A, активности), отдельное окно проектора (паттерн [ProjectionPage.tsx](react-app/src/pages/ProjectionPage.tsx)); горячие клавиши; beforeunload-guard (задача 11 v1-roadmap); таймер слайда (задача 17).
3. **Студенческий веб-клиент** `/s/{code}` — мобильный, лёгкий (отдельный entry-чанк ≤200 КБ): текущий слайд (SSE), светофор, «задать вопрос», прохождение активностей, опционально «продолжить в мессенджере». PWA-манифест.

**Десктоп-запуск: PWA (решено 2026-06-11).** Требование «кабинет лектора открывается с ярлыка, без запоминания ссылок» закрывает PWA-установка: страница `/install` с кнопкой и короткой инструкцией → у препода иконка и отдельное окно как у обычного приложения, обновления автоматические, офлайн-кэш дека уже есть (§3.4), окно проектора — `window.open` + Window Management API (Chrome) для второго экрана. Почему не Tauri: это новый для команды тулчейн (Rust) плюс подпись бинарей — неподписанный exe пугает Windows SmartScreen, а сертификата кода у студенческой команды нет; обновления тоже пришлось бы возить самим. Tauri остаётся запасным вариантом на случай, если вуз потребует классический установщик. Electron из v1 не тащим: 150 МБ рантайма ради ярлыка.

### 8.3 Дизайн и UX: источник — v1, не выдумывать

v1-фронт — готовая дизайн-система и экраны, уже принятые преподом. Правило для любого экрана v2: **сначала открыть аналог в v1 и взять его композицию и стиль**; отступление — осознанное решение на ревью, а не «я так вижу». Своя палитра, свои шрифты, свой CSS-фреймворк — нельзя.

**Тема и стиль (переносится как есть, с первого экрана фазы 1):**

- CSS-токены: [react-app/src/styles/theme.css](react-app/src/styles/theme.css) — готовая светлая + тёмная тема shadcn: primary `#030213`, радиус `0.625rem`, oklch-палитра, цвета графиков `--chart-1..5`, токены сайдбара. Остальное из [react-app/src/styles/](react-app/src/styles) — tailwind, шрифты;
- стек стилей: **Tailwind + shadcn/ui** (как в v1);
- компоненты: [react-app/src/shared/](react-app/src/shared) — ~50 готовых shadcn-компонентов (button, card, dialog, tabs, table, chart, sheet, sidebar, sonner…) копируются в `web/src/shared/ui`;
- готовые фичи: [DrawingOverlay.tsx](react-app/src/features/DrawingOverlay.tsx) (рисование), [SlideNotesPanel.tsx](react-app/src/features/SlideNotesPanel.tsx), [StatsPanel.tsx](react-app/src/features/StatsPanel.tsx), [MainLayout.tsx](react-app/src/features/MainLayout.tsx) (каркас с сайдбар-навигацией).

**Паритет экранов — минимум, который обязан существовать в v2 (чтобы ни одно «окошко» не потерялось):**

| Референс v1 | Что это | Куда в v2 |
|---|---|---|
| [HomePage.tsx](react-app/src/pages/HomePage.tsx) | входной дашборд | `pages/lecturer` |
| [MyLecturesPage.tsx](react-app/src/pages/MyLecturesPage.tsx) | список лекций | `pages/lecturer` |
| [UploadPresentationPage.tsx](react-app/src/pages/UploadPresentationPage.tsx) | загрузка презентации с прогрессом | `pages/lecturer` (материалы) |
| [LectureSettingsPage.tsx](react-app/src/pages/LectureSettingsPage.tsx) | настройки доступа, анонимности, каналов | `pages/lecturer` (настройки сессии) |
| [LivePresentationPage.tsx](react-app/src/pages/LivePresentationPage.tsx) | **главный экран**: слайд по центру, сайдбар вопросов, список студентов, светофор, QR, запуск активностей | `pages/presenter` — та же композиция, но разобранная на features (страница ≤300 строк) |
| [ProjectionPage.tsx](react-app/src/pages/ProjectionPage.tsx) | **режим проектора**: отдельное окно, только слайд + аннотации, BroadcastChannel | `pages/presenter/projection` — обязателен с фазы 3 |
| [TestsPage.tsx](react-app/src/pages/TestsPage.tsx) | конструктор тестов, запуск, результаты, ручная оценка | `pages/lecturer` (активности) |
| [StatisticsPage.tsx](react-app/src/pages/StatisticsPage.tsx) | аналитика: выбор лекции, таблицы результатов, срезы | `pages/lecturer` (аналитика) |

UX-механики, выстраданные в v1 и обязательные в v2: проектор открывается отдельным окном кнопкой из презентера; live-панели обновляются пушем без перезагрузки страницы; QR крупно на проекторе; тосты (sonner) вместо `alert`; диалоги (alert-dialog) вместо `window.confirm`; мобильная вёрстка студенческих экранов.

**Чего из v1-фронта НЕ брать:** монолитные страницы на 1900 строк, localStorage для доменных данных, polling, прямые `fetch` из страниц — анти-паттерны §12. Берём внешний вид и поведение, а не структуру кода.

---

## 9. Дорожная карта по фазам

Правила работы — как в [ROADMAP.md](ROADMAP.md): ветка на фазу (`v2/phase-N-…`), Conventional Commits на русском, **без `Co-Authored-By`** (политика проекта), PR в `master` нового репо после DoD фазы. Каждая фаза = работающее демо. Оценки — для 2–3 человек; «нед» = календарная неделя при параллельной работе.

> События в event store пишутся **с фазы 3**, хотя аналитика-UI появляется в фазе 7. Это принципиально: к моменту постройки дашбордов уже есть месяцы данных и не надо ничего «дособирать».

### Фаза 0 — Каркас (≈1 нед)

Цель: пустой, но «производственный» скелет, на который дальше только наращиваем.

- [x] Новый репозиторий `lecturer-assistant-v2`, монорепо-структура: `core/`, `adapters/telegram/`, `web/`, `e2e/`, `deploy/`, `docs/`.
- [x] `core`: Spring Boot 3.x, Java 21, пакеты-модули `iam|org|content|live|qa|feedback|interaction|channel|analytics|shared` + ArchUnit-тест границ.
- [x] Postgres + Flyway `V1__init.sql` (схемы), один `docker-compose.dev.yml` (postgres + hot-reload профиль); каркас профилей `prod` / `standalone` / `tunnel` (cloudflared).
- [x] OpenAPI-каркас, генерация TS-типов в `web/` по `npm run gen:api`.
- [x] CI (GitHub Actions): build + tests + arch-tests + docker images.
- [x] `docs/adr/` — ADR-001 «модульный монолит + адаптеры» (зафиксировать этот документ решением).
- [x] Spotless/Checkstyle + ESLint/Prettier.

**DoD:** `docker compose up` поднимает core+postgres+web-заглушку; CI зелёный; ArchUnit падает на нарушении границ (проверено намеренным нарушением).

### Фаза 1 — IAM + орг-структура (≈2 нед)

- [x] `persons`, роли, регистрация по приглашению, login (JWT+refresh), logout, смена пароля.
- [x] `channel_identities` (модель + linking-коды; адаптеров ещё нет).
- [x] Курсы, членства, группы; приглашение студента (код/ссылка).
- [x] Бан-лист на курс (идею `BannedUser` v1 — сюда).
- [x] Spring Security: все `/api/v1/**` закрыты, матрица ролей в одном месте (`docs/permissions.md`).
- [x] Web: login, layout, список курсов, страница курса (участники/группы), админка пользователей (минимум). Дизайн — из v1 с первого экрана (§8.3): tailwind + shadcn + `theme.css`, каркас по [MainLayout.tsx](react-app/src/features/MainLayout.tsx).
- [x] Testcontainers-интеграционные тесты auth + прав.

**DoD:** лектор регистрируется по приглашению админа, создаёт курс, генерит код для студентов; чужой курс недоступен (тест); IDOR-сценарии из [IDORSecurityTest.java](e2e-tests/src/test/java/ru/university/qatest/IDORSecurityTest.java) переписаны на v2 и зелёные.

### Фаза 2 — Контент (≈1.5 нед)

- [ ] `BlobStorage` (FS + конфиг под S3), `slide_decks/slides/slide_notes/attachments`.
- [ ] Конвейер импорта §4.4: контейнер `converter` (LibreOffice headless) + poppler; фоновые `import_jobs` с прогрессом; предпросмотр после импорта.
- [ ] Golden-набор реальных презентаций (выгрузить из v1) в CI; тесты v1-парсеров — как база кейсов.
- [ ] Версионирование дека (перезагрузка файла = новая версия).
- [ ] Лекции (CRUD, привязка дека, материалы).
- [ ] Web: страница материалов курса, загрузка с прогрессом, просмотр дека, заметки к слайдам (перенос [SlideNotesPanel.tsx](react-app/src/features/SlideNotesPanel.tsx)).

**DoD:** PDF 50 МБ импортируется ≤30 с фоном с видимым прогрессом; golden-набор PPTX (включая «проблемные» файлы v1) рендерится без потерь; слайды отдаются с кэш-заголовками; повторная загрузка создаёт версию 2, версия 1 читаема.

### Фаза 3 — Live Session Engine (≈2 нед)

- [ ] `sessions` + FSM + join-коды; `session_participants`; `slide_log`.
- [ ] WS-хаб `/ws/session/{id}` (auth по JWT): slide_changed, annotations, агрегаты.
- [ ] **Event store + EventBus + outbox** (схема `analytics.events`) — и первые события: `session.*`, `slide_*`, `participant.*`.
- [ ] Презентер-вью (тонкий! композиция features), проектор-вью (WS + BroadcastChannel), рисование (перенос DrawingOverlay), заметки, таймер слайда, beforeunload-guard.
- [ ] Офлайн-каркас презентера (§3.4 D3): service worker прекэширует дек при старте сессии; смена слайда и рисование — optimistic-local, сервер догоняет.
- [ ] Восстановление: F5/рестарт core при живой сессии.

**DoD:** лекция стартует, два окна (презентер+проектор) синхронны; `kill -9` core посреди сессии → после старта сессия в том же состоянии; обрыв сети у лектора на 2 минуты не останавливает показ (локальный кэш + BroadcastChannel), после реконнекта состояние досинхронизировано; в `analytics.events` корректная хронология.

### Фаза 4 — Channel SPI + Telegram (≈2 нед)

- [ ] `channel.outbox` + delivery worker + приоритеты + retry/DLQ; `dialog_states` + flow-движок (Join/Profile/Question flows).
- [ ] Internal API для адаптеров (long-poll outbox, inbound, delivery-reports) + API-key auth.
- [ ] **EchoAdapter** (REST-заглушка) + контрактные тесты SPI.
- [ ] **telegram-adapter**: long polling, rate limiter (25/s глобально, 1/s на чат, обработка 429), file_id-кэш, маппинг клавиатур; команды/кнопки — паритет с v1 (`/join`, `/current`, `/prev`, `/question`, `/rate`, `/profile`, `/help`).
- [ ] Привязка identity: deep-link `?start={code}`, QR на экране сессии.
- [ ] Метрики доставки в Prometheus + перенос Grafana-дашборда латентности.

**DoD:** студент в TG проходит: join по коду → профиль (ФИО+группа) → получает слайды (EDIT_LAST) → задаёт вопрос → получает ответ. Слайд доезжает 150 тестовым чатам ≤5 с (нагрузочный скрипт с фейковым TG API). Рестарт адаптера и core по отдельности — ничего не теряется.

### Фаза 5 — Веб-канал студента (≈1 нед)

- [ ] `/s/{joinCode}`: SSE-поток сессии, текущий слайд, светофор, Q&A, ephemeral-вход.
- [ ] Уровни идентификации на сессии (EPHEMERAL/PROFILE) + «продолжить в Telegram».
- [ ] Светофор + Q&A end-to-end во всех каналах (web+TG) с live-агрегатами у лектора.
- [ ] PWA-манифест, мобильная вёрстка.

**DoD:** студент **без Telegram** полноценно участвует; 150 одновременных SSE-клиентов (k6) — p95 доставки слайда ≤2 с; светофор обновляется у лектора ≤1 с.

### Фаза 6 — Interaction Engine (≈2.5 нед)

- [ ] Банк вопросов + теги + редактор в вебе; GIFT — новый парсер по грамматике, round-trip и golden-тесты (§6.1).
- [ ] `activity_definitions/runs/responses` + стратегии выборки (ALL/RANDOM_N/MANUAL) + audience.
- [ ] Прохождение: web-форма + ActivityFlow в каналах (inline-кнопки, таймеры вопросов).
- [ ] Авто-скоринг, ручная оценка OPEN, страница результатов run.
- [ ] QUICK_POLL: создание из live-панели ≤10 с, live-распределение ответов по WS, «закрыть и показать правильный».
- [ ] SURVEY: системный шаблон удовлетворённости, автозапуск на `session.ended` (настройка), агрегаты.
- [ ] `RELEASED`: разбор студентам в их каналы (без правильных ответов, с «% группы ошиблись так же»).

**DoD:** все 5 сценариев §6.2 проходят вживую; двойной сабмит невозможен; рестарт core посреди теста у 150 студентов не ломает прохождение.

### Фаза 7 — Аналитика + ростер (≈2–2.5 нед)

- [ ] Проекции (§7.2) + rebuild-механизм (`re-run по events`).
- [ ] Live-дашборд сессии (присутствие, светофор, прогресс активности) — собрать в презентер-вью.
- [ ] Страница аналитики курса: каталог виджетов + конструктор (layout в `lecturer_dashboard_configs`).
- [ ] Карточка студента + тревожные сигналы; срез по группам; `/mystats` в каналах.
- [ ] Ростер группы (§4.3): загрузка XLSX/CSV, нормализация, матчинг в ProfileFlow (точный / нечёткий с подтверждением / «вне списка»), панель привязки у лектора.
- [ ] Экспорт: CSV (BOM) на каждом виджете, сводный XLSX по курсу.

**DoD:** препод собирает свой дашборд из ≥8 виджетов, фильтрует по группе, выгружает CSV в Excel без кракозябр; удаление проекций + rebuild даёт идентичные цифры; студент с опечаткой в фамилии после подтверждения получает каноническое ФИО из ростера, «вне списка» виден лектору.

### Фаза 8 — VK + закалка + миграция (≈2 нед)

- [ ] **vk-adapter** (Callback API, свои лимиты) — лакмус SPI: если потребовались правки ядра, фиксируем их и дописываем `docs/how-to-add-channel.md`.
- [ ] Нагрузочный прогон полного сценария (k6 + фейковые адаптеры): 150 студентов, 40 слайдов, 2 квиза, светофор — по метрикам Т1–Т4.
- [ ] Security-pass: rate limit на join/inbound, аудит логов, secrets, OWASP-чеклист, повтор IDOR-сьюта.
- [ ] Миграция данных v1 (§10) + прогон на копии прод-БД.
- [ ] Документация: установка (`deploy/README`), руководство препода (обновить [USER_MANUAL.md](USER_MANUAL.md)), how-to-add-channel.

**DoD:** финальный приёмочный сценарий (§13) пройден на стейдже с мигрированными данными.

### Фаза 9 — Пилот и хвосты (≈1 нед + календарное ожидание)

- [ ] Пилот на реальной лекции «нашего» препода (его курс мигрирован).
- [ ] Сбор обратной связи, баг-фиксы, тюнинг лимитов.
- [ ] Десктоп-запуск: PWA — манифест кабинета лектора, страница `/install`, проверка установки на Windows/macOS (§8.2). Electron v1 — в архив.
- [ ] Прогон standalone-режима (§3.4): ноутбук + локальная точка доступа, лекция без интернета.
- [ ] Решение о выводе v1 из эксплуатации (старый репо — read-only архив).

---

## 10. Миграция с v1

Скрипт `tools/migrate-v1/` (Java или Python, читает 4 базы v1, пишет в v2 через staging-таблицы):

| v1 (база.таблица) | v2 | Примечания |
|---|---|---|
| broadcasting.lecture | org.courses (один «Курс по умолчанию» на препода) + live.lectures | статус/current_slide не переносятся — это были «сессии» |
| content.slide_sequence/slide + файлы | content.slide_decks/slides (версия 1) | blob-ы копируются в BlobStorage |
| content.slide_note | content.slide_notes | |
| broadcasting.student | iam.persons (role=STUDENT) + channel_identities(telegram, chatId) | realName/groupName → display_name + group_members |
| broadcasting.lecture_participant | не переносится | история посещений уйдёт в события legacy-импортом (опция) |
| quiz.exam/exam_question/exam_option | interaction.questions (в банк курса) + activity_definitions(QUIZ) | SURVEY-экзамены → SURVEY definitions |
| quiz.exam_submission/exam_answer | interaction.activity_responses/response_answers | связка через chatId → person |
| quiz.quiz/slide_question/slide_rating | **не мигрируем** (подтверждено 2026-06-11) | вопросы при необходимости переедут переимпортом GIFT-файлов в новый банк |
| broadcasting.student_question / comprehension_signal / post_lecture_response | qa.questions / feedback.comprehension_signals / SURVEY responses | привязка к синтетической «сессии-импорту» |
| analytics.activity_logs + xapi_events | analytics.events (verb-маппинг) | опционально, флагом `--with-history` |

Порядок: фаза 8, прогон на копии, сверка контрольных сумм (кол-во вопросов, сабмишенов, студентов), потом боевой прогон в день перехода. Старый бот в день X отвечает на любое сообщение: «Мы переехали: вот ссылка/новый бот» (одно сообщение, дальше молчит).

---

## 11. Тестирование и качество

| Уровень | Инструмент | Что покрывает | Когда в CI |
|---|---|---|---|
| Unit | JUnit 5 | скоринг, выборки RANDOM_N, парсер GIFT, рендереры сообщений | каждый PR |
| Архитектура | ArchUnit | границы модулей, запрет entity наружу | каждый PR |
| Интеграция модуля | Testcontainers (PG) | репозитории, flows, outbox, проекции | каждый PR |
| Контракт SPI | EchoAdapter + контракт-сьют | «любой адаптер ведёт себя одинаково» | каждый PR |
| E2E | Playwright (web) + REST-сценарии | сквозные сценарии лектор+студент | nightly + перед merge фазы |
| Нагрузка | k6 + фейковый TG API | Т1–Т4 (150 студентов) | перед DoD фаз 4/5/8 |
| Security | повтор IDOR-сьюта v1 + zap-baseline | авторизация, заголовки | nightly |

Паттерны брать из [e2e-tests/](e2e-tests) (`E2ELecturerFlowTest`, `LectureLoadSimulation`, `ContentServiceContractTest`). Прод-наблюдаемость: Prometheus + Grafana переносятся из v1 ([monitoring/](monitoring), [grafana-provisioning/](grafana-provisioning)) — дашборды JVM/доставки/латентности актуальны почти без правок.

---

## 12. Правила, чтобы не понадобился v3

Чек-лист на каждое ревью (повесить в PR-шаблон нового репо):

1. **Канал — это адаптер.** В ядре нет ни одного `import telegram.*`/`vk.*`. Появился — ревью не пройдено.
2. **Никакого доменного состояния в памяти.** Любая Map с lifetime > запроса — это таблица. (Кэши — можно, с инвалидацией.)
3. **Личность — `Person`, всегда.** `external_id` канала не покидает модуль `channel`.
4. **Одно понятие — одна модель.** Новая «разновидность опроса» = конфиг ActivityDefinition, а не новая таблица-близнец.
5. **Сначала событие, потом фича.** Любое новое действие пользователя сразу пишет event (даже если виджета под него ещё нет).
6. **Страница ≤300 строк, сервис-класс ≤400.** Больше — декомпозиция до merge.
7. **Контракт раньше кода.** Меняешь API — сначала OpenAPI-спека и регенерация типов.
8. **Миграции только вперёд.** Flyway, никакого `ddl-auto=update` (v1 наступал).
9. **Фича-флаги вместо веток-долгожителей.** Недоделанное — выключено конфигом, ветки живут ≤1 фазы.
10. **ADR на каждое архитектурное решение** — 10 строк в `docs/adr/`, чтобы через полгода не спорить заново.

---

## 13. Финальный приёмочный сценарий

Прогоняется на пилоте (фаза 9), всё в один заход:

1. Админ вуза создаёт лектора; лектор логинится, создаёт курс «Алгоритмы», группы БВТ-21-1/2, приглашает студентов ссылкой.
2. Лектор грузит PPTX (40 слайдов) и GIFT-файл (30 вопросов) в банк; собирает QUIZ «Срез по сортировкам» (10 случайных из тега `sort`).
3. Стартует сессию; на проекторе QR. 150 студентов заходят: ~100 в Telegram, ~50 по QR в браузер (часть «как будто с заблокированной телегой»), новички вводят ФИО+группу один раз.
4. Лекция: слайды доезжают (web ≤2 с, TG ≤5 с), студенты жмут светофор, лектор видит агрегат и live-вопросы, отвечает одному лично и одному вещанием, рисует на слайде — видно на проекторе.
5. Посреди лекции лектор кидает QUICK_POLL за 10 секунд; на экране live-распределение ответов; закрывает с показом правильного.
6. **Рестарт core посреди активного теста** — студенты продолжают отвечать, ничего не потеряно (демонстрируем честно).
7. Финал: сессия завершается → авто-SURVEY удовлетворённости; лектор публикует разбор QUIZ (release).
8. Аналитика: дашборд курса — посещаемость, понимание по слайдам, сравнение групп, студенты риска; карточка отстающего студента; экспорт CSV открывается в Excel; студент в боте смотрит `/mystats`.
9. В Grafana — латентности доставки и очередь outbox без аномалий за всю лекцию.

Сценарий пройден целиком → v2.0 объявляется релизом, v1 — в архив.

---

## 14. Решения и открытые вопросы

Зафиксировано 2026-06-11:

1. **Вузовский SSO — не делаем.** Студенческой команде его не выдадут. Своя авторизация (email+пароль) с фазы 1; «вход без пароля» — OAuth Яндекс ID / VK ID после пилота (§4.2).
2. **Хостинг — не покупаем заранее.** Обязательные режимы: запуск с ноутбука с публичным URL (профиль `tunnel`) и установка на любой сервер одним `docker compose up`. 100% контейнеризация, включая фронт и конвертер (Т8–Т9) — «vite руками», как в v1, исключён. Сервер купим к пилоту, конфиг не изменится.
3. **Каналы: Telegram (№1), VK (№2), всё.** MAX — нет публичного Bot API; WhatsApp и Discord — заблокированы в РФ. SPI оставляет дверь открытой (§5.5).
4. **Брендирование под вуз — отложено.** Переменные темы в web заложены, наполнение — когда дойдём.
5. **Легаси-модель `Quiz/SlideQuestion` — не мигрируем.** Реальная боль была не в данных, а в надёжности GIFT и парсеров презентаций; закрыто новым GIFT-парсером (§6.1) и конвейером LibreOffice (§4.4).
6. **Десктоп и офлайн.** Electron заменяется PWA-установкой (опция Tauri по итогам пилота, §8.2); поведение при падении сети/мессенджеров описано режимами D1–D4 (§3.4).

Дополнено второй итерацией (тот же день):

7. **Ростер группы из Excel — делаем, фаза 7.** Уточнённая механика: студент **всегда вводит ФИО сам**, деканатский список используется для сверки — опечатки исправляются на каноническое имя из списка (нечёткий матчинг с подтверждением), «вне списка» разруливает лектор. Спецификация — §4.3.
8. **Синхронизацию standalone → сервер — не делаем.** Standalone самодостаточен. Фокус продукта: кабинет лектора + боты в мессенджерах (+ веб-канал студента как часть приложения).
9. **Десктоп-запуск — PWA, решено** (§8.2). Tauri — запасной вариант, только если вуз потребует классический установщик; Electron в архив.
10. **Дизайн фронта — из v1, не выдумывать** (§8.3): тема `theme.css`, shadcn-компоненты из `react-app/src/shared/` и композиция экранов переносятся, включая режим проектора отдельным окном. Свои палитры/шрифты запрещены.

Открытых вопросов не осталось. Новые архитектурные решения — через ADR в `docs/adr/` (правило §12.10).
