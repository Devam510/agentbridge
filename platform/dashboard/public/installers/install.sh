#!/bin/bash
set -e

echo "======================================================="
echo "⚡ AgentBridge Companion Installer (Mac/Linux)"
echo "======================================================="
echo ""

# 1. Check for Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[!] Node.js not found."
    if command -v brew >/dev/null 2>&1; then
        echo "[+] Installing Node.js via Homebrew..."
        brew install node
    else
        echo "[-] Please install Node.js manually from https://nodejs.org"
        exit 1
    fi
else
    echo "[OK] Node.js is already installed."
fi

# 2. Setup Companion Directory
APP_DIR="$HOME/.agentbridge"
echo "[+] Creating AgentBridge directory at $APP_DIR..."
mkdir -p "$APP_DIR"

# For this MVP, we copy the dev file or download it
SERVER_URL="https://raw.githubusercontent.com/AgentBridge/agentbridge/main/platform/companion/server.js"
if [ -f "./platform/companion/server.ts" ]; then
    echo "[~] Dev mode detected: compiling local companion..."
    npx esbuild "./platform/companion/server.ts" --bundle --platform=node --outfile="$APP_DIR/server.js"
else
    echo "[+] Downloading Companion App..."
    curl -sL "$SERVER_URL" -o "$APP_DIR/server.js"
fi

# 3. Add to OS Startup
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "[+] Registering launchd service for macOS..."
    PLIST_PATH="$HOME/Library/LaunchAgents/com.agentbridge.companion.plist"
    
    cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentbridge.companion</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(command -v node)</string>
        <string>$APP_DIR/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>$APP_DIR/error.log</string>
    <key>StandardOutPath</key>
    <string>$APP_DIR/out.log</string>
</dict>
</plist>
EOF

    # Load and start
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load "$PLIST_PATH"
    echo "[+] Service started."

else
    echo "[-] Linux startup registration not implemented in this MVP. Run node ~/.agentbridge/server.js manually."
fi

echo ""
echo "======================================================="
echo "✅ Installation Complete!"
echo "======================================================="
echo "The AgentBridge Companion is now running in the background."
echo "Opening the Chrome Web Store to install the Browser Extension..."
echo ""
sleep 2

# Open Chrome extension page
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "https://chrome.google.com/webstore"
else
    xdg-open "https://chrome.google.com/webstore" 2>/dev/null || true
fi
