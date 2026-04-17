#!/bin/bash
# ============================================================
#  AGENTIC CLAW — One-Click macOS Installer
#  Run: bash install.sh
#  Or:  curl -fsSL <url>/install.sh | bash
# ============================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
AMBER='\033[0;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

INSTALL_DIR="$HOME/Applications/AgenticClaw"
DESKTOP_APP="$HOME/Desktop/AgenticClaw.app"
APP_SUPPORT="$HOME/.agentic-claw"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║       AGENTIC CLAW — Mission Control         ║"
  echo "  ║       Polymarket Trading Intelligence        ║"
  echo "  ║       Powered by Mirofish AI Predictions     ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo -e "${NC}"
}

step() { echo -e "\n${CYAN}▶${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${AMBER}⚠${NC}  $1"; }
err()  { echo -e "\n${RED}✗ ERROR:${NC} $1\n"; exit 1; }

banner

# ─── Step 1: Check macOS ─────────────────────────────────────
step "Checking system..."
if [[ "$OSTYPE" != "darwin"* ]]; then
  err "This installer is for macOS only."
fi
MACOS_VER=$(sw_vers -productVersion)
ok "macOS $MACOS_VER"

# ─── Step 2: Check Node.js ───────────────────────────────────
step "Checking Node.js..."
NODE_BIN=""
for p in "/usr/local/bin/node" "/opt/homebrew/bin/node" "/usr/bin/node" "$(command -v node 2>/dev/null)"; do
  if [ -x "$p" ]; then NODE_BIN="$p"; break; fi
done

if [ -z "$NODE_BIN" ]; then
  warn "Node.js not found."
  echo ""
  echo -e "  ${DIM}Agentic Claw requires Node.js 18+.${NC}"
  echo -e "  ${DIM}Install options:${NC}"
  echo -e "  ${DIM}  Option A:  brew install node${NC}"
  echo -e "  ${DIM}  Option B:  Visit https://nodejs.org${NC}"
  echo ""
  read -r -p "  Install via Homebrew now? [y/N] " INSTALL_NODE
  if [[ "$INSTALL_NODE" =~ ^[Yy]$ ]]; then
    if ! command -v brew &>/dev/null; then
      echo "  Installing Homebrew first..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew install node
    NODE_BIN=$(command -v node)
  else
    err "Node.js required. Please install and re-run install.sh"
  fi
fi

NODE_VER=$("$NODE_BIN" -e "console.log(process.version)" 2>/dev/null)
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1 | tr -d 'v')
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "Node.js $NODE_VER is old. Recommend Node 18+."
fi
ok "Node.js $NODE_VER at $NODE_BIN"
NPM_BIN="$(dirname "$NODE_BIN")/npm"
ok "npm at $NPM_BIN"

# ─── Step 3: Install dependencies ────────────────────────────
step "Installing dependencies..."
cd "$SCRIPT_DIR"
"$NPM_BIN" install --production --quiet
ok "Dependencies installed"

# ─── Step 4: Create app support directory ────────────────────
step "Setting up app data..."
mkdir -p "$APP_SUPPORT"
cp -R "$SCRIPT_DIR/server" "$APP_SUPPORT/"
cp -R "$SCRIPT_DIR/frontend" "$APP_SUPPORT/"
cp "$SCRIPT_DIR/package.json" "$APP_SUPPORT/"
cp -R "$SCRIPT_DIR/node_modules" "$APP_SUPPORT/"
ok "App data at $APP_SUPPORT"

# ─── Step 5: Create .env config ──────────────────────────────
cat > "$APP_SUPPORT/.env" <<ENV
PORT=3747
POLYMARKET_API=https://gamma-api.polymarket.com
MIROFISH_API=https://api.mirofish.ai/v1
SIMULATE_TRADES=true
LOG_LEVEL=info
ENV
ok ".env config created"

# ─── Step 6: Build macOS .app bundle ─────────────────────────
step "Building macOS app bundle..."

APP="$DESKTOP_APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

# Copy resources into the app bundle
cp -R "$APP_SUPPORT/server" "$APP/Contents/Resources/"
cp -R "$APP_SUPPORT/frontend" "$APP/Contents/Resources/"
cp "$APP_SUPPORT/package.json" "$APP/Contents/Resources/"
cp -R "$APP_SUPPORT/node_modules" "$APP/Contents/Resources/"

# Copy Info.plist
if [ -f "$SCRIPT_DIR/app-bundle/AgenticClaw.app/Contents/Info.plist" ]; then
  cp "$SCRIPT_DIR/app-bundle/AgenticClaw.app/Contents/Info.plist" "$APP/Contents/"
else
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>AgenticClaw</string>
  <key>CFBundleIdentifier</key><string>com.agentic-claw.mission-control</string>
  <key>CFBundleName</key><string>Agentic Claw</string>
  <key>CFBundleDisplayName</key><string>Agentic Claw</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
fi

# Write the main executable launcher
NODE_ESCAPED="${NODE_BIN//\//\\/}"
cat > "$APP/Contents/MacOS/AgenticClaw" <<LAUNCHER
#!/bin/bash
# Agentic Claw launcher
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
APP_CONTENTS="\$(dirname "\$SCRIPT_DIR")"
RESOURCES="\$APP_CONTENTS/Resources"
LOG="\$HOME/.agentic-claw/launcher.log"
mkdir -p "\$HOME/.agentic-claw"
exec 1>>"\$LOG" 2>&1

NODE="${NODE_BIN}"
PORT=3747

echo ""
echo "=== Agentic Claw Launch: \$(date) ==="

# Check if server is already running
if lsof -i :\$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Server already running"
  open "http://localhost:\$PORT"
  osascript -e 'display notification "Mission Control already running" with title "Agentic Claw"' 2>/dev/null || true
  exit 0
fi

# Start server in Terminal
SERVER_CMD="cd '\$HOME/.agentic-claw' && '\$NODE' server/index.js 2>&1 | tee -a '\$HOME/.agentic-claw/server.log'; echo 'Server stopped. Press Enter.'; read"

if [ -d "/Applications/iTerm.app" ] || [ -d "/Applications/iTerm2.app" ]; then
  osascript <<OSAS
    tell application "iTerm2"
      activate
      set w to (create window with default profile)
      tell current session of w
        write text "\$SERVER_CMD"
      end tell
    end tell
OSAS
else
  osascript <<OSAS
    tell application "Terminal"
      activate
      do script "\$SERVER_CMD"
    end tell
OSAS
fi

# Wait for ready
echo "Waiting for server..."
for i in \$(seq 1 30); do
  sleep 0.5
  curl -s "http://localhost:\$PORT/api/health" >/dev/null 2>&1 && break
done

open "http://localhost:\$PORT"
osascript -e 'display notification "Mission Control is online — port 3747" with title "Agentic Claw" subtitle "Opening in browser"' 2>/dev/null || true
echo "Launch complete."
LAUNCHER

chmod +x "$APP/Contents/MacOS/AgenticClaw"
ok "App bundle created at $APP"

# ─── Step 7: Create launch script ────────────────────────────
step "Creating launch script..."
cat > "$APP_SUPPORT/start.sh" <<'STARTSH'
#!/bin/bash
cd "$HOME/.agentic-claw"
NODE=$(command -v node 2>/dev/null || echo "/usr/local/bin/node")
PORT=3747

if lsof -i :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Server already running on port $PORT"
  open "http://localhost:$PORT"
  exit 0
fi

echo "Starting Agentic Claw..."
"$NODE" server/index.js &
SERVER_PID=$!
echo $SERVER_PID > "$HOME/.agentic-claw/server.pid"

sleep 2
open "http://localhost:$PORT"
echo "Server started (PID $SERVER_PID). Mission Control at http://localhost:$PORT"
wait $SERVER_PID
STARTSH

cat > "$APP_SUPPORT/stop.sh" <<'STOPSH'
#!/bin/bash
PORT=3747
PID=$(lsof -i :$PORT -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$PID" ]; then
  kill "$PID"
  echo "Agentic Claw stopped (PID $PID)"
else
  echo "Agentic Claw is not running"
fi
STOPSH

chmod +x "$APP_SUPPORT/start.sh" "$APP_SUPPORT/stop.sh"
ok "start.sh and stop.sh created at $APP_SUPPORT"

# ─── Done! ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   ✅  INSTALLATION COMPLETE!                 ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}📦 App:${NC}    $DESKTOP_APP"
echo -e "  ${BOLD}📁 Data:${NC}   $APP_SUPPORT"
echo -e "  ${BOLD}🌐 URL:${NC}    http://localhost:3747"
echo ""
echo -e "  ${BOLD}Launch options:${NC}"
echo -e "  ${DIM}  • Double-click AgenticClaw.app on your Desktop${NC}"
echo -e "  ${DIM}  • Run: bash ~/.agentic-claw/start.sh${NC}"
echo ""

read -r -p "  Launch Agentic Claw now? [Y/n] " LAUNCH
if [[ ! "$LAUNCH" =~ ^[Nn]$ ]]; then
  open "$DESKTOP_APP"
fi

echo ""
echo -e "${DIM}  Log file: $APP_SUPPORT/launcher.log${NC}"
echo ""
