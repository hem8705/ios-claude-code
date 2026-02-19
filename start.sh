#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PORT=4242
TTYD_PORT=4243
TTYD_HOST="127.0.0.1"
TMUX_SESSION="claude"

# ---- helpers ----
info() { echo "  --> $*"; }
ok()   { echo "  [ok] $*"; }
warn() { echo "  [!]  $*"; }
die()  { echo "  [x]  $*" >&2; exit 1; }

# ---- check deps ----
command -v node &>/dev/null || die "node not found -- run install.sh first"
command -v ttyd &>/dev/null || die "ttyd not found -- run install.sh first"
command -v tmux &>/dev/null || die "tmux not found -- run install.sh first"

# ---- kill existing processes on our ports ----
info "Freeing ports ${SERVER_PORT} and ${TTYD_PORT}..."
for PORT in $SERVER_PORT $TTYD_PORT; do
  PIDS=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    ok "Killed process(es) on :$PORT"
  fi
done
sleep 0.5

# ---- tmux session ----
info "Setting up tmux session '${TMUX_SESSION}'..."
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  ok "Tmux session '${TMUX_SESSION}' already exists"
else
  tmux new-session -d -s "$TMUX_SESSION"
  ok "Created tmux session '${TMUX_SESSION}'"
fi

# ---- start ttyd ----
info "Starting ttyd on ${TTYD_HOST}:${TTYD_PORT}..."
nohup ttyd \
  --port "$TTYD_PORT" \
  --interface "$TTYD_HOST" \
  --writable \
  tmux attach-session -t "$TMUX_SESSION" \
  > /tmp/ttyd.log 2>&1 &
TTYD_PID=$!

# Wait for ttyd to become ready (up to 5s)
for i in $(seq 1 10); do
  if lsof -ti tcp:$TTYD_PORT &>/dev/null; then
    ok "ttyd running (pid $TTYD_PID)"
    break
  fi
  sleep 0.5
  if [ $i -eq 10 ]; then
    warn "ttyd may not have started -- check /tmp/ttyd.log"
  fi
done

# ---- start node server ----
info "Starting Claude Dev server on 0.0.0.0:${SERVER_PORT}..."
cd "$SCRIPT_DIR"
nohup node server.js > /tmp/claude-dev.log 2>&1 &
SERVER_PID=$!
sleep 0.8

if ! kill -0 $SERVER_PID 2>/dev/null; then
  cat /tmp/claude-dev.log >&2
  die "server.js failed to start"
fi
ok "Node server running (pid $SERVER_PID)"

# ---- print URL ----
echo ""
echo "  Claude Dev is running!"
echo ""
echo "  Local:  http://localhost:${SERVER_PORT}"

TS_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
if [ -n "$TS_IP" ]; then
  echo "  Phone:  http://${TS_IP}:${SERVER_PORT}"
  echo ""
  echo "  Open on iPhone: http://${TS_IP}:${SERVER_PORT}"
  echo "  Then: Share -> Add to Home Screen"
else
  warn "Tailscale not running or not connected."
  warn "Run 'tailscale up' then check 'tailscale ip -4' for your phone URL."
fi

echo ""
echo "  Logs:  tail -f /tmp/claude-dev.log"
echo "         tail -f /tmp/ttyd.log"
echo ""
echo "  Stop:  kill $SERVER_PID $TTYD_PID"
echo ""
