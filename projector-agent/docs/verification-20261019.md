# Проверка помощника — 19.10.2026

## Установочные development-пакеты

Дополнение после начального source-протокола ниже:

- Общие политики, updater и bootstrap: **41 check PASS** на macOS ARM64; Windows
  cross-build после добавления host preflight: 0 ошибок / 0 предупреждений.
- macOS 0.1.1 ARM64 и Intel: реальные DMG, `hdiutil verify`, `codesign --verify --deep --strict`,
  проверка отсутствия внешних package-manager dylib dependencies — PASS.
- ARM64: реальная распаковка self-contained launcher/seed во временную папку, coordinator,
  повторная установка, совместимость .NET FileShare и native flock, active-show/recovery guards,
  сохранение journal и подпись уже распакованного host — PASS.
- Windows install/reinstall/upgrade/downgrade/uninstall и runtime preflight, а также Mac Intel
  runtime execution включены в CI. Результаты конкретного CI запуска записываются отдельно;
  наличие workflow само по себе не означает его успеха.
- Java verify266/266, web66/66, MAX adapter25/25, real isolated API8групп, public MAX
  resume9/9 — PASS перед упаковкой. Custom Select в мастере и helper controls:
  desktop/mobile, keyboard и light/dark fixture19/19 — PASS.

В этой машине не выполнялись: установка в пользовательские Applications/Programs,
регистрация автозапуска, Keychain/DPAPI запись или смена конфигурации экранов.
Developer ID/notarization, Windows Authenticode и физическая HDMI-матрица остаются
проверками публичного выпуска. Public release catalog пуст. В Git только публичный
metadata trust; закрытый ключ в приложение не входит.

## Начальная проверка исходников (история)

Сведения о пустом trust и отсутствующей упаковке ниже относятся к исходной сборке до дополнения.

Среда: macOS ARM64, .NET SDK 10.0.401, Swift 6.4 / текущий Xcode SDK.

| Проверка | Результат |
|---|---|
| `dotnet build .../Projector.Windows.csproj --no-restore` | PASS, cross-target, 0 errors / 0 warnings |
| `dotnet build .../Projector.Updater.csproj --no-restore` | PASS, 0 errors / 0 warnings |
| `dotnet build .../Projector.Launcher.csproj` | PASS, 0 errors / 0 warnings |
| `dotnet run .../Projector.Checks.csproj` | PASS, 34 checks |
| `dotnet run .../Projector.Agent.csproj -- --self-test` | PASS, no mutation/network |
| `swift build ... --scratch-path /private/tmp/...` | PASS; только warnings о недоступном SwiftPM user cache, без source warnings |
| Native Mac `--journal-self-test` | PASS, pending/valid/corrupt journal, zero display API calls and unchanged file bytes |
| Java21 P-256/P1363 envelope → C# fixture verifier | PASS, exact payload, SPKI public key, UPDATE artifact |
| Native Mac `--preflight` | PASS, `mutation:false`; sandbox вернул `screens:[]`, hardware conclusion отсутствует |
| Updater со source embedded trust | ожидаемый безопасный отказ `RELEASE_SIGNING_NOT_PROVISIONED` |
| `sh -n scripts/build-macos.sh` / `node --check scripts/sign-release.mjs` | PASS |
| `git diff --check` | PASS |
| `git check-ignore` bin/obj/.build/packages/runtime | PASS |

34 checks включают URI isolation + ограниченный projectionViewToken в hash, restore guards
после manual/hotplug, normal-update deferral, P-256 signature tampering, metadata expiry/replay,
version/platform/protocol/minimumOS, size/hash, ZIP traversal/reserved names, external target,
physical-test dependency, command idempotency, policy/lease/update denials. На macOS/Linux
также создаются два синтетических ZIP и **реальные subprocess**: initial install, 0.1→0.2,
active-show lock deferral, wrong nonce → rollback process, unsafe previous → quarantine.
Дополнительно: SDK query-purpose constants, actual decompressed bytes budget,
exact-envelope network retry/backoff, checkpoint-last retry, committed-stage restart,
no reinstall loop, stage expiry, CHECK_UPDATE semantics, interrupted extraction retry,
preflight authenticated readiness, refusal before old-process exit and expired preflight.
Это не mock «успех запуска», но и не реальный Windows/macOS installer/hardware test.

Native код сопрягается с outbound poll v1. `release` согласован с backend как отдельный
nullable signed envelope `{keyId,payload,signature}`, не Installer DTO. Сигнал/подключение
запускает проверку/загрузку в фоне; idle-only native handoff запускает отдельный updater,
который повторно проверяет metadata/ZIP, атомарно публикует verified slot, сохраняет
journal и только затем выдаёт preflight receipt. Старый host остаётся на связи до receipt;
expired/damaged package или early failure сохраняют его процесс. Далее updater ждёт
завершения старого процесса без kill,
меняет atomic pointer, запускает новый native host и ждёт receipt после успешного
совместимого authenticated poll. Поддерживаются allowed rollback и unsafe quarantine.
Локальный stop оставляет polling доступным для security updates, а не отключает устройство.

Не выполнялись: установка/автозапуск/удаление, Keychain/DPAPI запись, переключение режимов
дисплеев, физический HDMI, updater на двух настоящих подписанных native версиях, CI runners
и выпуск. Production trust пуст и release catalog пуст; download не рекламируется.
Обновление autostart packaging на macOS, OS signing/notarization и crash recovery UI
остаются gates первого installable release. Матрица — `hardware-tests.md`.

Final review: monotonic 12 s lease budget независим от UTC, проверки backwards clock/future lease; primary target оставлен fail closed с отдельной диагностикой/manual fallback.

Review corrections: QDC_ONLY_ACTIVE_PATHS=0x2 / QDC_ALL_PATHS=0x1 сверены с SDK;
остальные interop flags названы SDK names и проверены с wingdi.h. macOS prepare читает
существующий disk journal до первого CG call и запрещает перезапись valid/corrupt/pending
состояния. Оба OS controller сохраняют original до APPLY и applied только после snapshot.
Partial apply без applied fingerprint требует manual recovery. Production signing/HDMI
по-прежнему не выполнены.
