# Устанавливаемый пакет macOS

Основной продукт остаётся сайтом и мини-приложением MAX. DMG содержит стабильное
`Lecturer Projector.app`, а не архив исходников. Первый запуск предлагает установку
в `~/Applications`. Системные права администратора для этого пути не нужны.
Регистрация запуска при входе выполняется отдельно, только по действию пользователя.

## Сборка

На Mac с Xcode, Swift 6, .NET 10 и Python 3.8+:

```sh
sh projector-agent/scripts/build-macos.sh arm64 0.2.0 development
sh projector-agent/scripts/build-macos.sh x86_64 0.2.0 development
PYTHONDONTWRITEBYTECODE=1 python3 projector-agent/macos/packaging/check-package.py
```

Результат в `projector-agent/packages/osx-arm64` или `osx-x64`:

- `*-development.dmg`: устанавливаемое приложение для разработки, без Developer ID
  и notarization. Не предлагать в публичном каталоге и не отключать Gatekeeper.
- `*-development-update.zip`: полный host payload, не установщик и не подписанный
  release envelope. Он применяется только как встроенный seed или в изолированных тестах.
- Соседний JSON: хеши, размеры, схема bootstrap и честные флаги непроверенных условий.

Команды сборки не устанавливают приложение, не запускают его GUI, не регистрируют
автозапуск, не записывают Keychain и не меняют дисплеи. Исполняются только нативные
self-test с временными файлами. Под macOS Intel/Apple Silicon необходим отдельный пакет.

Managed-сборки .NET упакованы внутрь single-file Mach-O apphost, а не оставлены
неподписанными DLL в `Contents/MacOS`. Native self-extraction отключён. Runtime/host
packs берутся из официальных NuGet пакетов в изолированном pack root, даже если SDK
установлен менеджером пакетов. `otool` проверяет каждый Mach-O и запрещает абсолютные
зависимости от Homebrew или других каталогов машины сборки. В development host и
bootstrap также проходят coherent ad-hoc signing и strict/deep verification;
это проверка целостности, которая не заменяет Developer ID или notarization.

Для production нужны уже предоставленные оператором переменные:

```text
PROJECTOR_MAC_SIGN_IDENTITY  Developer ID Application: …
PROJECTOR_MAC_NOTARY_PROFILE  существующий профиль notarytool
PROJECTOR_TRUST_FILE  абсолютный путь к JSON с public P-256 SPKI release keys
```

После этого используется третий аргумент `production`. Скрипт подписывает Mach-O
изнутри наружу, нотарифицирует и staple-проверяет host, bootstrap app и DMG,
проверяет codesign и Gatekeeper. Сбой любого gate завершает сборку с ошибкой.
Private keys, PAT и секреты Apple не входят в bundle. Наличие кода для подписи
не означает, что production сборка уже выпущена или испытана.

Для .NET apphosts используется только entitlement `allow-jit`, необходимый для
обычного JIT runtime; native Swift bootstrap и host его не получают. Library validation
и защита от внедрения через DYLD остаются включёнными. Это соответствует текущей
[инструкции Microsoft](https://learn.microsoft.com/en-us/dotnet/core/deploying/macos).
Сборка и notarization следуют [порядку Apple](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Стабильный вход и обновления

```text
~/Applications/Lecturer Projector.app/
  Contents/MacOS/ProjectorBootstrap
  Contents/MacOS/launcher/Projector.Launcher
  Contents/Resources/{bootstrap.json,seed.zip}

~/Library/Application Support/LecturerProjector/
  instance.lock
  origin.txt                         # адрес учреждения, не credential
  device-credentials/                # 0700; revocable token files 0600
  display-recovery.json              # сохраняется до проверенного возврата
  install/
    current.json
    versions/<version>-<digest>/Lecturer Projector Host.app/
    staging/ health/ update-transaction.json …
```

Ключ подключения хранит host в отдельном файле с доступом только текущего пользователя.
В bootstrap и URL его нет. Stable bundle
никогда не перезаписывается текущими online host updates и не регистрирует version slot
в Login Items. Host вызывает его ограниченные CLI `--login-status`, `--enable-login`,
`--disable-login`. Внутри стабильного bundle выполняется `SMAppService.mainApp`.
Текущее разрешение macOS является источником состояния, а не сохранённый Boolean.
Документация: [SMAppService.mainApp](https://developer.apple.com/documentation/servicemanagement/smappservice/mainapp).

Bootstrap вызывает общий `Projector.Launcher bootstrap <root> <seed.zip> <bootstrap.json>`.
При первой установке тот проверяет размер, SHA-256, ограниченный ZIP, платформу и отсутствие активного
показа/процесса/незавершённого обновления. Первичная активация не запускает host.
Обычный запуск с актуальным `current.json` не активирует seed и не меняет pointer:
поэтому журнал восстановления дисплеев не блокирует доступ к меню возврата.
Он не откатывает online update до старого встроенного seed. Перед запуском
production host Swift проверяет его подпись и Team ID относительно стабильного приложения.
Последующие загрузки используют отдельные подписанные release envelopes и health
транзакцию. Само по себе содержимое ZIP или current.json не является release подписью.

## Отдельный пульт и демонстрация

Версия 0.2.0 открывает компактный `NSPanel` с изолированным `WKWebView`, без системной
строки заголовка и traffic-light кнопок. Сайт передаёт только привязанный к одному
устройству/курсу/занятию control grant. JWT аккаунта и cookie браузера не передаются.
Навигация ограничена точным HTTPS origin и маршрутом пульта; scope URL сверяется с
отдельными полями нативной команды. `FOCUS_PRIVATE_REMOTE` возвращает закрытый пульт,
не меняя окно проектора. Парное подключение выполняется через `lecturer-projector://pair`
с ограниченным одноразовым кодом и локальным подтверждением адреса учреждения.

Демонстрация использует ScreenCaptureKit после системного разрешения записи экрана.
При выборе целого экрана фильтр исключает всё приложение помощника: пульт, публичное
окно проектора и последующие служебные диалоги. При выборе окна собственное приложение
нельзя выбрать источником. Это исключение действует для нашего захвата, не обещает
невидимость в сторонних программах записи и не скрывает служебные вкладки браузера.

Перед публикацией JPEG-предпросмотр остаётся локальным. После подтверждения AVAssetWriter
кодирует H264/fMP4 до 1920×1080/15fps, включая неподвижный кадр. Очередь HTTPS ограничена,
не отправляет cookies, не следует redirect и использует только scoped header. JPEG служит
резервом и кадром для запроса в MAX. Ничего не записывается на диск. Пауза удаляет очередь;
продолжение создаёт новый epoch. Потеря lease, отключение дисплея или закрытие пульта
останавливают нативную демонстрацию, сохраняя само занятие.

Явный запуск более нового DMG предлагает обновить стабильное приложение. Перед заменой
проверяются блокировки активного процесса, показа и восстановления. Новый sealed seed
может обновить старую версию host; более новый online host не заменяется старым seed.

`--capture-self-test` проверяет ограничения URL/scope и настоящий H264 encoder/decoder
на синтетических буферах без доступа к экрану, сети, Keychain или настройкам дисплеев.
Он не заменяет проверку системного разрешения записи экрана и физического HDMI.

## Удаление и диагностика

В меню LA есть экспорт JSON без токенов, origin, кодов подключения и содержания занятия.
Удаление явно подтверждается пользователем. Если есть журнал восстановления экранов
или обновления, сначала требуется разобраться с ним; файлы не уничтожаются молча.
После нейтрализации host завершает coordinator, освобождает singleton и проходит общий
`uninstall-check`. Затем отключается подключение/Keychain, в Корзину перемещаются stable app
и его install root. Устройство предлагается также отозвать на сайте. Исходная конфигурация
дисплеев не восстанавливается автоматически при логине или удалении.

## Что обязательно испытать отдельно

Signed install/upgrade/uninstall, фактическую регистрацию Login Items и запуск после
reboot, Keychain access на обеих архитектурах и macOS 14/15/26, восстановление после
сбоев и физический HDMI. Сборка под архитектуру и self-test не доказывают эти сценарии.
