# Матрица физических испытаний — ещё не выполнена

Сборка и unit checks не доказывают вывод на HDMI. Для каждой строки сохранить ОС/build,
CPU/GPU/драйвер, модель дока/проектора, topology before/applied/after и фактический результат.
В журнал не включать вопросы, ответы, access token или другие пользовательские данные.

| ОС/архитектура | Build | Статус |
|---|---|---|
| Windows 10 22H2 x64 | выбрать реальный школьный ПК | не проверено |
| Windows 11 x64 | выбрать реальный школьный ПК | не проверено |
| Windows 11 ARM64 | выбрать устройство | не проверено |
| macOS 14 Intel / ARM | выбрать устройства | не проверено |
| macOS 15 Intel / ARM | выбрать устройства | не проверено |
| macOS 26 Intel / ARM | выбрать поддерживаемые устройства | не проверено |

## Сценарий для каждой поддерживаемой конфигурации

1. Один ноутбук + HDMI: Duplicate, Extend, external-only. В простое агент ничего не меняет.
2. Явная подготовка: снимок → temporary independent output → **проверка кода на физическом
   проекторе** → staff подтверждение → чистая публичная сцена. Менять ноутбук по ошибке нельзя.
3. Проектор без staff вопросов, заметок, draft, правильных ответов и staff cookies.
4. Pause/QR/slide/drawing/session-ended продолжают использовать существующую публичную сцену.
5. Remote stop, policy revoke, invalid/expired grant, blocked account, утрата прав,
   HTTP401, offline дольше12s → нейтральный вывод; автоматического возврата Duplicate нет.
6. Локальный stop не завершает занятие; вернуть экраны можно после скрытия staff UI.
7. Normal restore: только совпадающая applied fingerprint; original geometry/modes/mirror
   возвращаются. Несовпадающая/hotplug конфигурация не перезаписывается.
8. Ручное перемещение экранов, DPI/resolution/rotation, другой HDMI/док, 3+дисплея,
   разные scaling, RDP, sleep/wake, выключенный проектор — повторная проверка/безопасный отказ.
9. Kill coordinator → native neutral. Kill nativehost/падение ОС → записать реальное
   поведение, проверить восстановление по журналу и отсутствие раскрытия staff UI.
   Отдельно прервать между save-original и APPLY, после APPLY перед save-applied:
   original должен сохраниться, повторная prepare обязана отказаться. При неизвестном
   applied snapshot — только ручной возврат, без перезаписи изменённой конфигурации.
   Здесь пока **нет доказанной crash-safe автоматизации**; это release blocker.
10. Login item/HKCU startup только явно, отключение уважается, после reboot нет новой
    загрузки installer, нет автоматического capture/show. Удаление убирает startup и creds.
11. SDK/runtime missing, app-signature revoked, MDM deny, permissions denied → понятная
    диагностика и путь сайта, без обходов/скрытых установок.
12. Обновление: download/check допускаются в showing; install/restart только после stop.
    Health reconnect новойверсией; невернаяподпись/архитектура/rollback/expiredmanifest,
    diskfull/readonly/restartfailure → безопасный отказ, никаких fake success.
    Обрыв сети при staging — exact same signed envelope повторяется после backoff;
    expiry во время лекции не завершает старый host. Kill extraction до journal не
    оставляет final slot, блокирующий повторную установку. Updater preflight отказ
    сохраняет старый host; receipt проверяется до его выхода.

Случайные краткие desktop flashes при переключении Windows/macOS нельзя считать
устранёнными без записи физического выхода и повторяемого результата.

## Выполнено локально 19.10.2026

- .NET core/coordinator и updater компилируются на macOS ARM64.
- Pure checks покрывают URI isolation, manual/hotplug restore guards, update deferral,
  signature tampering, freshness/replay/version/platform/protocol, hashes/ZIP traversal,
  external target, physical-test dependency, idempotency, lease/policy/update refusal.
- Swift AppKit/WKWebView source компилируется на текущем SDK; `--preflight` выполняет
  только enumeration. В sandbox вернул screens:[] — это не доказательство отсутствия
  HDMI у пользователя и не hardware test.
- Windows source cross-compilation завершилась без ошибок и предупреждений; запуск WinForms на Windows,
  physical modes и installer/signing всё ещё не проверены.
- 34 checks: дополнительно два synthetic ZIP с настоящими subprocess, atomic pointer,
  defer while showing, health nonce rollback и quarantine unsafe previous.
- Настройки дисплеев, startup, Keychain/DPAPI и пользовательский desktop не изменялись.

## Известный отказ при проекторе, назначенном основным экраном

`isPrimary` — флаг ОС, а не доказательство, где сидит преподаватель. Текущий native
прототип консервативно не выбирает primary target, даже если это физический проектор.
Он возвращает `PRIMARY_TARGET_REQUIRES_MANUAL_SETUP`; локальное меню объясняет:
«Основной экран: выберите проектор в браузерном мастере». Не определять устройство
по одному этому флагу и не обходить нейтральный тест. Проверить отдельно ноутбук secondary /
проектор primary: ожидается понятный отказ автоматического пути и браузерный мастер
с явным выбором/физическим подтверждением, без утверждения «проектор не подключён».

## Ограничение lease независимо от часов

Каждый authenticated protocol poll получает monotonic timestamp. Для active output
действует максимум 12 секунд от этого timestamp, даже если UTC на ПК ушло назад или
сервер прислал чрезмерно далёкий leaseUntil. Меньший срок сохраняется. Watchdog проверяет
состояние каждые 500 ms; задержка обработки native UI/неотвечающий процесс остаётся частью
физического crash/hang gate. Отдельные pure проверки с управляемыми часами покрывают
backwards wall clock, future deadline, короткий срок, clear и отсутствие остановок idle.
