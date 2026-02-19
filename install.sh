#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_LABEL="com.claude.mobiledev"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
START_SH="$SCRIPT_DIR/start.sh"

# ---- helpers ----
info() { echo "  --> $*"; }
ok()   { echo "  [ok] $*"; }
warn() { echo "  [!]  $*"; }
die()  { echo "  [x]  $*" >&2; exit 1; }

echo ""
echo "Claude Dev -- install"
echo "======================================="
echo ""

# ---- homebrew ----
if ! command -v brew &>/dev/null; then
  die "Homebrew not found. Install it first: https://brew.sh"
fi
ok "Homebrew found"

# ---- node ----
if command -v node &>/dev/null; then
  ok "node $(node --version) already installed"
else
  info "Installing node via Homebrew..."
  brew install node
  ok "node installed"
fi

# ---- ttyd ----
if command -v ttyd &>/dev/null; then
  ok "ttyd already installed"
else
  info "Installing ttyd via Homebrew..."
  brew install ttyd
  ok "ttyd installed"
fi

# ---- tmux ----
if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V) already installed"
else
  info "Installing tmux via Homebrew..."
  brew install tmux
  ok "tmux installed"
fi

# ---- tailscale (optional) ----
if command -v tailscale &>/dev/null; then
  ok "tailscale found (access from phone will work)"
else
  warn "tailscale not found -- you can still use local network access"
  warn "Install: https://tailscale.com/download/mac"
fi

# ---- make scripts executable ----
chmod +x "$START_SH"
chmod +x "$SCRIPT_DIR/install.sh"
ok "Scripts are executable"

# ---- launchd plist ----
info "Creating launchd plist for auto-start on login..."

LOG_OUT="/tmp/claude-dev-launchd.log"
LOG_ERR="/tmp/claude-dev-launchd-err.log"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${START_SH}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <false/>

  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>

  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
PLIST

ok "Plist written to $PLIST_PATH"

# ---- load the plist ----
info "Loading launchd agent..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
ok "LaunchAgent loaded -- will start automatically on next login"

echo ""
echo "Installation complete!"
echo ""
echo "  Start now:    bash $START_SH"
echo "  Auto-start:   on every login (via launchd)"
echo "  Disable auto: launchctl unload $PLIST_PATH"
echo "  Launchd logs: $LOG_OUT"
echo ""
echo "======================================="
echo ""
