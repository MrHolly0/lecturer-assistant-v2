# Выпуск помощника: текущие границы и обязательные gates

19 октября 2026. Есть установочные development-пакеты; **публичный подписанный выпуск ещё не открыт**.

## Стек

Общие политики/протокол/обновлятор — .NET 10, нативные окна Windows — WinForms+WebView2,
macOS — Swift AppKit+WKWebView с приватными pipes до coordinator. Системная privileged
служба и слушающий LAN/localhost порт не требуются. Процесс работает в пользовательском
графическом сеансе. Цели: Windows 10 22H2 / 11 x64/ARM64, macOS 14+ Intel/ARM.
Версия API не является доказательством поддержки конкретного драйвера/сборки ОС.

Официальные основания:

- [SetDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setdisplayconfig):
  supplied temporary config без SAVE_TO_DATABASE, VALIDATE до APPLY, требования console session.
- [QueryDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-querydisplayconfig):
  активные/возможные пути: QDC_ONLY_ACTIVE_PATHS=0x2, QDC_ALL_PATHS=0x1.
  Числа сверены с официальным [Windows SDK wingdi.h](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/wingdi.h),
  включая SDC_USE_SUPPLIED_DISPLAY_CONFIG=0x20, VALIDATE=0x40, APPLY=0x80,
  SAVE_TO_DATABASE=0x200, SOURCE=1, PIXELFORMAT_32BPP=4 и device-info types1/2.
  Эти query purpose и неперсистентные apply flags защищены отдельной pure проверкой.
  Нельзя подменять полный снимок вызовом DisplaySwitch.exe.
- [WebView2](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/webview2):
  свой профиль и ограничения навигации; SDK 1.0.4191.47 закреплён в проекте.
- [CoreGraphics](https://developer.apple.com/documentation/coregraphics/cgconfiguredisplaymirrorofdisplay(_:_:_:)):
  настройка зеркалирования, затем session scope и проверяемый возврат.
- [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice):
  macOS 13+ API, при этом minimum всего нашего пакета — macOS 14 из-за общего runtime.
- [.NET на Windows](https://learn.microsoft.com/en-us/dotnet/core/install/windows),
  [.NET на macOS](https://learn.microsoft.com/en-us/dotnet/core/install/macos):
  сверять поддерживаемые ОС перед выпуском; runtime входит в наши self-contained пакеты.

## Состояние обновлятора

Работают проверка, staging и source prototype полной транзакции замены/перезапуска. Команда `Projector.Updater stage` получает подписанный
конверт, проверяет embedded key, OS/arch, protocol, freshness, возрастающий sequence,
версию, ограниченный GitHub Release URL, размер/SHA-256. Распаковка свежего проверенного ZIP выполняется при транзакции install.
Алгоритм подписи — ECDSA P-256/SHA-256, SPKI public key base64, IEEE P1363 signature64bytes.
Подписаны **исходные байты** payload base64, повторная сериализация не используется.

`trusted-keys.json` содержит публичный P-256 anchor для закреплённого GitHub-репозитория.
Private key хранится отдельно от Git, backend и приложений. Сборка с пустым trust
по-прежнему возвращает RELEASE_SIGNING_NOT_PROVISIONED. Без настроенного оператором каталога backend выдаёт
release:null. CHECK_UPDATE при nonnull envelope и embedded trust подтверждает лишь
UPDATE_CHECK_REQUESTED; отсутствующая metadata — RELEASE_FEED_NOT_PUBLISHED.
Установка подтверждается отдельным health, не ACK команды. Версия и updater
присутствуют с первого исходного пакета. Автоматический source path включается только при
реальном signed envelope в `release` и запуске из установленного stable launcher.
В текущем каталоге такого релиза нет, поэтому сайт не предлагает скачивание и online
update. Development DMG собраны отдельно для испытаний. Windows EXE предусмотрен
скриптом и native CI; локальная эмуляционная упаковка на Mac не дала установщик.

Недостаёт перед первым публичным подписанным release:

1. Отдельный доверенный signing build с публичным GitHub Releases репозиторием,
   embedded public keys и OS-signing. Private keys живут у release operator/secret store,
   не у backend/агента. Не встраивать PAT. Для private repo нужен отдельный artifact broker.
2. Подписанные Windows installer/upgrade/uninstall и macOS Developer ID+notarization.
   Signing metadata не заменяет подпись приложения ОС и не обходит MDM/Gatekeeper.
3. Испытать native handoff на установленных signed пакетах. В source уже есть:
   idle-only request → fresh metadata/expiry/package recheck → neutral → updater повторяет
   проверку → unique temporary extraction → atomic publication immutable slot → journal
   → one-time preflight receipt → old-process identity/exit wait без kill
   → atomic `current.json` → process restart
   → одноразовый health nonce → подтверждение только после authenticated protocol poll.
   Show lock запрещает replacement во время показа, независимо от UI. Тайм-аут или неверный
   nonce запускает прежний allowed slot; previous ниже minimumVersion не активируется.
   Failed candidate получает собственный authenticated stop request и должен безопасно выйти.
   До preflight receipt старый native host продолжает работать и polling; early error,
   expired metadata или невалидный ZIP не завершают его. Preflight отказ обрабатывается
   отдельным source состоянием PREFLIGHT_CANCELLED_OLD_HOST_KEPT, без duplicate rollback.
4. Crash/uncompleted transaction оставляет journal и блокирует stable launcher с
   UPDATE_RECOVERY_REQUIRED. Автоматического удаления journal или слепого продолжения нет.
   Нужны OS-specific installer recovery UI и физические тесты сбоя во всех фазах.
5. Real native end-to-end: два подписанных пакета 0.1→0.2, потеря сети, неполная загрузка,
   неверная подпись, истёкшая metadata, недостаток места/права, занятые файлы, ошибка launch
   и запрет установки MDM. Pure/process checks уже покрывают два synthetic zip с реальными
   subprocess, show deferral, healthy commit, wrong nonce rollback и unsafe quarantine.
6. [Физическая матрица](hardware-tests.md), crash recovery и краткие утечки при hotplug.

## Layout и запуск прототипа транзакции

```text
<per-user-root>/
  launcher/Projector.Launcher[.exe]   # стабильный entrypoint для startup
  current.json                      # atomically selected verified slot
  versions/<version>-<digest>/      # immutable extracted package, own updater inside
  staging/                          # downloaded signed envelope + hash-checked zip
  accepted-release.json             # highest accepted metadata sequence/version
  health/                           # one-time challenge receipts and own-process stop
  show.lock                         # held while test/show active
  update-transaction.json           # present until health-confirmed commit/rollback
  quarantine-<slot>.json            # rejected candidate; never automatic retry
```

`Projector.Updater stage` сохраняет signed envelope и ZIP; `install` повторно проверяет
подпись/expiry/hash и только затем выполняет транзакцию. Скачивание того же envelope
после временной ошибки повторяется с monotonic backoff30→60→120→240→300s. Replay checkpoint
commit выполняется последним после готового descriptor/package; незавершённый staging
не превращает нужный retry в replay. Checkpoint и текущая версия предотвращают reinstall loop.
ZIP ограничен реальным decompressed byte count, а не только declared sizes.
Uncommitted extraction dirs очищаются под update lock; unreferenced старый partial final
slot из прежнего interrupted installer отодвигается и заменяется только freshly verified bytes. Health callback не принимает
произвольный HTTP endpoint и не запускает shell-команду: entrypoint берётся из signed
metadata внутри verified version slot. Production agent пишет receipt только после
первого успешного scoped device poll и compatible minimumVersion. Нормальный запуск
через `Projector.Launcher <root>` не считается успешным обновлением сам по себе.

Native Windows startup ссылается на stable launcher, а не путь старого version slot.
macOS bootstrap — стабильный `Lecturer Projector.app`, к которому привязан SMAppService.
Host вызывает только ограниченные команды управления login item этого bundle.
Регистрация включается человеком; build и package smoke не меняют Login Items.
Фактический reboot/login на подписанном пакете остаётся отдельной проверкой.

CI создаёт Windows `*-setup-unsigned.exe`, отдельный update ZIP и Mac
`*-development.dmg` / update ZIP как Actions artifacts, без GitHub Release publication.
На Windows проверяются install/reinstall/upgrade, отказ downgrade, show lock и uninstall;
на Mac — реальная временная seed-установка, coordinator, flock и подпись извлечённого host.
Тесты не открывают native UI и не меняют автозапуск, credentials или конфигурацию экранов.

## Ротация и rollback

Trust dictionary позволяет одновременно встроить старый и новый keyId. Сначала выпуск
подписывается доверенным старым ключом и содержит новый public key; следующий релиз
может использовать новый ключ. Удаление старого ключа — отдельный последующий signed
релиз и server minimumVersion. Metadata ограничена 14 днями; sequence строго возрастает,
checkpoint сохраняет максимальные принятые sequence/version. Это не защита от пользователя
с полным доступом к своему диску, который меняет бинарник или системное время.
Компрометация root signing key требует отдельно спланированного recovery, не загрузки
нового доверенного ключа из произвольного backend JSON.

Пример полей payload (значения при выпуске вычисляются для готового zip):

```json
{
  "sequence": 1,
  "version": "0.2.0",
  "platform": "MACOS_ARM64",
  "minimumOsVersion": "14.0",
  "protocolVersion": 1,
  "publishedAt": "2026-10-19T10:00:00Z",
  "expiresAt": "2026-10-26T10:00:00Z",
  "url": "https://github.com/OWNER/REPOSITORY/releases/download/projector-v0.2.0/mac-arm64.zip",
  "size": 12345,
  "sha256": "64_HEX_CHARACTERS",
  "entryPoint": "Lecturer Projector Host.app/Contents/MacOS/ProjectorMac",
  "artifactType": "UPDATE"
}
```

Offline `scripts/sign-release.mjs` создаёт конверт с операторским P-256 ключом.
Его нельзя запускать на недоверенном PR runner с production private key.

## Wire metadata: согласованный прямой envelope

`poll.release` — nullable **отдельный** DTO, не каталожный Installer:

```json
{"keyId":"release-2026","payload":"BASE64_OF_EXACT_UTF8_MANIFEST","signature":"BASE64_OF_64_BYTE_P1363_SIGNATURE"}
```

В `payload` находится показанный выше manifest, в том числе подписанный GitHub asset URL.
`AgentUpdates` получает envelope по device poll после CHECK_UPDATE/при подключении,
проверяет embedded trust и скачивает только hash-checked asset из pinned repository.
Backend не получает private signing key и не может назначить произвольный update URL.
Пустой каталог передаёт `release:null`; тогда helper не обещает обновление. Каталожный
Installer `{platform,version,url,sha256,size}` предназначен для первой установки и имеет
другой тип. Signed envelope дополнительно проверяется при install, не только stage.

## Cross-language signature check

Выполнена локальная проверка Java21 `SHA256withECDSAinP1363Format` → C# verifier:
P-256 SPKI public key, exact base64 UTF8 payload, 64-byte signature — PASS.
Временные fixture/keypair не добавляются в репозиторий. В тестовом harness есть CLI
`--verify-fixture <envelope.json> <public-trust.json>`; production helper не принимает
пользовательский public-key config и продолжает использовать только embedded trust.
Подписанный `artifactType: INSTALLER` не допускается в updater (UPDATE default для
совместимости payload первого формата). Каталожный installer имеет отдельный путь.


## Подготовка ключа выпуска

Оператор один раз выполняет `scripts/provision-release-key.mjs PRIVATE.pem PUBLIC-TRUST.json OWNER/REPOSITORY KEY_ID`.
Private PEM хранится вне репозитория с правами 0600; публичный trust можно включить в
сборку через `PROJECTOR_TRUST_FILE`. Инструмент отказывается молча заменять существующий
anchor при потере private key. Нужна отдельная резервная копия ключа у оператора.
`sign-release.mjs` подписывает готовые байты metadata. Это подпись обновления, она
не заменяет Authenticode, Developer ID или notarization. Не передавать private key PR/CI runner.
