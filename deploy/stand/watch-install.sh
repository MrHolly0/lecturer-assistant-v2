#!/usr/bin/env sh
# Ставит сторожа стенда (watch.sh) как фоновую задачу launchd текущего пользователя.
#   sh deploy/stand/watch-install.sh            — установить: проверка каждые 5 минут + не давать
#                                                 системе засыпать (caffeinate)
#   sh deploy/stand/watch-install.sh --no-sleep-guard   — только проверка, без caffeinate
#   sh deploy/stand/watch-install.sh status     — состояние обеих задач и последние строки журнала
#   sh deploy/stand/watch-install.sh remove     — снять обе задачи и удалить их файлы
# Пишет два файла в ~/Library/LaunchAgents; ничего больше на системе не меняет.
# Запускать из того клона репозитория, в котором живёт стенд (пути берутся от расположения скрипта).
# Сторож не разбудит спящий Mac: если система уснула, проверки не выполняются. Поэтому
# нужен caffeinate или отключённый сон в «Экономии энергии». Крышка ноутбука при работе от
# сети без внешнего монитора усыпляет систему в любом случае.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
WATCH_LABEL=ru.lecturer-assistant.stand-watch
AWAKE_LABEL=ru.lecturer-assistant.stand-awake
DOMAIN_TARGET="gui/$(id -u)"

load() { launchctl bootstrap "$DOMAIN_TARGET" "$AGENTS/$1.plist" 2>/dev/null || launchctl kickstart -k "$DOMAIN_TARGET/$1"; }
unload() { launchctl bootout "$DOMAIN_TARGET/$1" 2>/dev/null || true; }

case "${1:-install}" in
  remove)
    unload "$WATCH_LABEL"; unload "$AWAKE_LABEL"
    rm -f "$AGENTS/$WATCH_LABEL.plist" "$AGENTS/$AWAKE_LABEL.plist"
    echo "Снято: проверка и защита от сна."
    exit 0
    ;;
  status)
    for l in "$WATCH_LABEL" "$AWAKE_LABEL"; do
      if launchctl print "$DOMAIN_TARGET/$l" >/dev/null 2>&1; then echo "$l: загружена"; else echo "$l: не загружена"; fi
    done
    tail -5 "$ROOT/deploy/stand/check.log" 2>/dev/null || echo "журнала пока нет"
    exit 0
    ;;
esac

[ -f "$ROOT/.env" ] || { echo "Нет $ROOT/.env — сначала sh deploy/stand/init-env.sh" >&2; exit 1; }
mkdir -p "$AGENTS"

cat > "$AGENTS/$WATCH_LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$WATCH_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$ROOT/deploy/stand/watch.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$ROOT/deploy/stand/watch.out</string>
  <key>StandardOutPath</key><string>$ROOT/deploy/stand/watch.out</string>
</dict>
</plist>
EOF
unload "$WATCH_LABEL"; load "$WATCH_LABEL"
echo "Установлено: проверка стенда каждые 5 минут, журнал $ROOT/deploy/stand/check.log"

if [ "${1:-}" != "--no-sleep-guard" ]; then
  cat > "$AGENTS/$AWAKE_LABEL.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AWAKE_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/caffeinate</string><string>-i</string><string>-s</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
  unload "$AWAKE_LABEL"; load "$AWAKE_LABEL"
  echo "Установлено: система не уходит в сон, пока подключено питание (caffeinate -i -s)."
fi
echo "Снять: sh deploy/stand/watch-install.sh remove"
