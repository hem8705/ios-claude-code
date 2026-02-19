# Claude Dev — Mobile Dev PWA

A self-hosted developer tool for iPhone. Browser terminal + file tree + git diff viewer, served from your Mac over Tailscale, installed as a fullscreen PWA with no browser chrome.

```
┌──────────────────────────────────────────┐
│  ☰  src/index.js          ±   >_         │  ← header
├──────────┬───────────────────────────────┤
│ Explorer │  Diff / Raw view              │
│          │  + 42  const app = ...        │
│ 📁 src   │  - 41  const a = ...         │
│   📜 app │                               │
│   📜 idx │                               │
│ 📁 test  ├───────────────────────────────┤
│          │  Terminal  (ttyd / tmux)      │
│          │  $ █                          │
└──────────┴───────────────────────────────┘
```

## Requirements

- macOS with [Homebrew](https://brew.sh)
- [Tailscale](https://tailscale.com/download/mac) installed and connected on both Mac and iPhone
- Node.js (installed by `install.sh` if missing)

---

## Quick Start

### 1. Install dependencies

```bash
cd /path/to/claude-mobile
bash install.sh
```

Installs `node`, `ttyd`, and `tmux` via Homebrew if missing, then registers a launchd agent so the server auto-starts on every login.

### 2. Set up Tailscale

1. Install [Tailscale for Mac](https://tailscale.com/download/mac) and sign in
2. Install [Tailscale for iPhone](https://tailscale.com/download/ios) and sign in with the **same account**
3. Verify both devices appear in your [Tailscale admin console](https://login.tailscale.com/admin/machines)

Check it's working:
```bash
tailscale ip -4
# e.g.: 100.x.x.x
```

### 3. Start the server

```bash
bash start.sh
```

Output:
```
  Local:   http://localhost:4242
  Phone:   http://100.x.x.x:4242
```

### 4. Add to iPhone Home Screen

1. Open **Safari** on iPhone (must be Safari — Chrome on iOS doesn't support PWA install)
2. Go to `http://100.x.x.x:4242`
3. Tap the **Share** button (box with arrow)
4. Tap **Add to Home Screen → Add**

The app opens fullscreen with no browser chrome.

---

## Usage

| Control | Action |
|---------|--------|
| ☰ top-left | Toggle file tree (drawer in portrait, panel in landscape) |
| Tap a file | Open in diff/raw viewer |
| **Diff** / **Raw** buttons | Switch view mode |
| ± header button | Quick-toggle diff ↔ raw |
| **>_** top-right | Show/hide terminal |
| Drag resize bar | Resize terminal panel height |
| ↺ terminal | Reload/reconnect terminal |
| ↺ tree | Refresh file listing |

### Terminal

Connects to a `tmux` session named `claude`. Sessions survive page reloads — long-running processes keep going. To use a different session name, edit `TMUX_SESSION` in `start.sh`.

### File Tree

Root defaults to the directory containing `server.js`. These are excluded:

```
node_modules  .git  dist  build  coverage  __pycache__
.next  .nuxt  out  .cache  .parcel-cache  vendor  .venv  venv  env
```

Max folder depth: 4.

### Diff Viewer

Shows `git diff HEAD -- <file>`. Falls back to raw file content if there's no diff. The **Raw** button always shows full content regardless of git status. Files over 500 KB are not loaded.

---

## Auto-Start on Login

`install.sh` registers a launchd agent:
```
~/Library/LaunchAgents/com.claude.mobiledev.plist
```

Manage it:
```bash
# Disable auto-start
launchctl unload ~/Library/LaunchAgents/com.claude.mobiledev.plist

# Re-enable
launchctl load ~/Library/LaunchAgents/com.claude.mobiledev.plist
```

Logs:
```bash
tail -f /tmp/claude-dev.log          # node server
tail -f /tmp/ttyd.log                # ttyd
tail -f /tmp/claude-dev-launchd.log  # launchd stdout
```

---

## Architecture

```
iPhone Safari PWA
       │
       │  Tailscale VPN (encrypted)
       ▼
server.js :4242  (Node, zero npm deps)
  ├── GET /              → index.html (SPA)
  ├── GET /manifest.json → PWA manifest
  ├── GET /sw.js         → service worker
  ├── GET /api/tree      → recursive file listing
  ├── GET /api/diff      → git diff + status JSON
  ├── GET /api/read      → raw file contents (≤500 KB)
  └── /terminal/*        → HTTP + WebSocket proxy
                                    ▼
                              ttyd :4243 (127.0.0.1 only)
                                    ▼
                           tmux session "claude"
```

| Port | Service | Bound to |
|------|---------|----------|
| 4242 | Claude Dev (Node) | 0.0.0.0 — reachable from phone |
| 4243 | ttyd terminal | 127.0.0.1 — internal only |

**Security:** No authentication. Tailscale is the security boundary — only devices on your Tailscale network can reach port 4242. Do not expose this to the public internet.

---

## Troubleshooting

**Terminal shows "502 Bad Gateway"**
ttyd isn't running. Re-run `bash start.sh` or check `tail -f /tmp/ttyd.log`.

**File tree is empty or wrong root**
The tree root is wherever `server.js` lives. Move the project next to your code, or symlink: `ln -s ~/myproject /path/to/claude-mobile/project`.

**PWA not going fullscreen / no "Add to Home Screen"**
Must use Safari. Chrome, Firefox, and other browsers on iOS cannot install PWAs.

**Tailscale URL not shown**
Run `tailscale ip -4` manually. If Tailscale isn't connected, open the Tailscale menu bar app and connect.

**Stale content after editing files**
Restart: `bash start.sh` (kills and restarts everything). Then in Safari: long-press reload or clear site data in Settings → Safari → Advanced → Website Data.
