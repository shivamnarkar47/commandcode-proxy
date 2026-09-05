#!/usr/bin/env bash
# start.sh — Background service wrapper for commandcode-proxy (Linux/macOS)
# Usage: scripts/start.sh {start|stop|status|restart}
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.commandcode-proxy.pid"
LOG_FILE="$ROOT_DIR/commandcode-proxy.log"
PORT="${PORT:-18731}"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid=$(cat "$PID_FILE")
  kill -0 "$pid" 2>/dev/null
}

start() {
  if is_running; then
    echo "already running (PID $(cat "$PID_FILE"))"
    return 0
  fi
  nohup bun run src/proxy.ts --port "$PORT" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "started (PID $(cat "$PID_FILE")), log: $LOG_FILE"
}

stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "stopped"
  else
    echo "not running"
    rm -f "$PID_FILE"
  fi
}

status() {
  if is_running; then
    echo "running (PID $(cat "$PID_FILE"))"
  else
    echo "not running"
  fi
}

restart() {
  stop
  sleep 1
  start
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  status)  status ;;
  restart) restart ;;
  *)
    echo "Usage: $0 {start|stop|status|restart}"
    exit 1 ;;
esac
