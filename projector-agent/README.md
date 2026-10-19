# Необязательный помощник проектора

Это исходники отдельного пользовательского компонента. Основной продукт остаётся
сайтом и MAX mini-app. Помощник не заменяет кабинет преподавателя и не требует телефона.
**Пока нет подписанного установщика и испытаний физического HDMI: предлагать установку
пользователям нельзя.** Браузерный мастер остаётся рабочим запасным сценарием.

## Что реализовано

- .NET 10: общий ограниченный протокол исходящего HTTPS polling, одноразовое сопряжение,
  проверка lease независимо от HTTP timeout, запреты политик, повтор команд и смена экранов.
- Windows: WinForms tray, собственное WebView2-окно публичной сцены, отдельный профиль,
  DPAPI credentials, явно включаемый HKCU autostart. QueryDisplayConfig/SetDisplayConfig:
  сохранение снимка, проверка независимых путей, временное применение **без SAVE_TO_DATABASE**,
  охраняемый возврат исходного снимка.
- macOS: Swift AppKit menu bar, WKWebView с непостоянным хранилищем, Keychain, SMAppService
  для явно включаемого login item. CoreGraphics: независимый временный вывод, журнал и
  охраняемый возврат. .NET coordinator подключается приватными анонимными stdin/stdout pipes.
- Нейтральный код перед материалом. Сервер проверяет отдельное физическое подтверждение.
  Любое изменение топологии требует нового теста. Окно не ищется по заголовку.
- Отдельный updater с embedded trust, проверкой подписанного P-256 payload, срока/порядка,
  ОС/архитектуры/протокола, размера/SHA-256, безопасной загрузкой GitHub Release asset
  и ограниченной ZIP-распаковкой. Затем: immutable version slot → atomic current pointer →
  restart → health receipt после authenticated protocol poll → commit или rollback. Активный
  show lock откладывает replacement; отозванная предыдущая версия quarantined.
  Ошибки загрузки повторяются с задержкой 30 секунд → 5 минут. Старый host выходит
  только после отдельного authenticated preflight receipt: metadata/ZIP/journal готовы. Без встроенных
  production-ключей он **отказывает**. Backend release:null не изображает готовый релиз.
- CI собирает неподписанные пакеты по архитектурам; не публикует их как готовый продукт.

## Сборка и проверки

Нужен .NET SDK 10. Для native Mac также Xcode/Swift 6 и macOS 14+.

```sh
dotnet run --project projector-agent/tests/Projector.Checks/Projector.Checks.csproj
dotnet build projector-agent/src/Projector.Updater/Projector.Updater.csproj
dotnet build projector-agent/src/Projector.Launcher/Projector.Launcher.csproj
dotnet run --project projector-agent/src/Projector.Agent/Projector.Agent.csproj -- --self-test
swift build --package-path projector-agent/macos
# Только перечисление экранов, без окон, захвата и смены настроек:
projector-agent/macos/.build/debug/ProjectorMac --preflight
# Только временные journal fixtures, даже без чтения конфигурации дисплеев:
projector-agent/macos/.build/debug/ProjectorMac --journal-self-test
```

На соответствующем runner:

```sh
sh projector-agent/scripts/build-macos.sh arm64
sh projector-agent/scripts/build-macos.sh x86_64
```

```powershell
./projector-agent/scripts/build-windows.ps1 -Runtime win-x64
./projector-agent/scripts/build-windows.ps1 -Runtime win-arm64
```

Не запускать приложение автоматически в проверках. Подготовка экрана и автозапуск
меняются только после явного действия человека в локальном меню. В этом checkout
настройки экрана, startup и Keychain/DPAPI не изменялись.

## Граница безопасности при остановке

Серверный stop, отзыв доступа, истечение lease, потеря coordinator или смена экранов
немедленно заменяют материал нейтральной заставкой. Возврат Duplicate — **отдельное
локальное подтверждение после скрытия служебного окна**: иначе аудитория увидит вопросы
или правильные ответы в браузере преподавателя. Возврат выполняется только если
оборудование и конфигурация совпадают с сохранённой применённой конфигурацией.
Ручные изменения и hotplug не перезаписываются. Original записывается до OS APPLY,
затем добавляется проверенный applied snapshot. Если процесс погиб между этими фазами,
original остаётся на диске, а автоматический возврат запрещён: требуется ручная проверка.
Журнал сохраняется после аварийного
выхода для проверяемого восстановления при следующем запуске; слепого возврата при login нет.

**Не доказано:** автоматическое восстановление после kill/crash всего native host,
отсутствие краткого desktop flash при hotplug/смене режима ОС и физическая приватность
на разных драйверах. Нет claim «защита захвата», streaming IDE или невидимый пульт:
это отдельный медиатракт. Нужны испытания из [матрицы](docs/hardware-tests.md).

## Совместимость

В 34 checks включены настоящие subprocess двух синтетических пакетов: 0.1→0.2,
неверный nonce/rollback и quarantine отозванного предыдущего пакета. Это проверка
транзакции файлов/процессов, не замена испытанию OS installer на реальном компьютере.

Цели сборки, пока **не проверенная поддержка**: Windows 10 22H2 / 11 x64 и ARM64,
macOS 14/15/26 Intel и Apple Silicon. WebView2 Evergreen может отсутствовать на Windows;
это диагностируемая ошибка, а не автоматическая установка из неизвестного источника.
.NET и WebView2 имеют собственные сроки поддержки ОС; проверять их перед релизом.
Для старших ограничений учреждения/неподдерживаемых ОС использовать браузерный мастер.

Связь: [контракт сервера](../docs/projector-helper-protocol.md).
Выпуск и недостающие gates: [release.md](docs/release.md).
