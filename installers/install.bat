@echo off
setlocal EnableDelayedExpansion

echo =======================================================
echo ⚡ AgentBridge Companion Installer (Windows)
echo =======================================================
echo.

:: 1. Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Node.js not found. Installing via winget...
    winget install OpenJS.NodeJS -e --silent
    if %ERRORLEVEL% NEQ 0 (
        echo [X] Failed to install Node.js. Please install it manually from https://nodejs.org
        pause
        exit /b 1
    )
    echo [OK] Node.js installed.
    :: Refresh env vars (basic workaround without restarting)
    set "PATH=%PATH%;C:\Program Files\nodejs"
) else (
    echo [OK] Node.js is already installed.
)

:: 2. Setup Companion Directory
set "APP_DIR=%LOCALAPPDATA%\AgentBridge"
if not exist "%APP_DIR%" (
    echo [+] Creating AgentBridge directory...
    mkdir "%APP_DIR%"
)

:: For this MVP installer, we will just download the pre-compiled server script directly.
:: In production, this would pull a zip release from GitHub.
echo [+] Downloading Companion App...
set "SERVER_URL=https://raw.githubusercontent.com/AgentBridge/agentbridge/main/platform/companion/server.js"
:: (Simulated: since this is local dev, we will copy the built files if they exist)
if exist "%~dp0..\platform\companion\server.ts" (
    echo [~] Dev mode detected: compiling local companion...
    call npx esbuild "%~dp0..\platform\companion\server.ts" --bundle --platform=node --outfile="%APP_DIR%\server.js"
) else (
    :: Fallback to curl
    curl -sL "%SERVER_URL%" -o "%APP_DIR%\server.js"
)

:: 3. Create startup VBS wrapper (to hide the console window)
echo [+] Setting up background service...
set "VBS_FILE=%APP_DIR%\run.vbs"
echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_FILE%"
echo WshShell.Run "node """ ^& "%APP_DIR%\server.js" ^& """", 0, False >> "%VBS_FILE%"

:: 4. Add to Windows Startup Registry
echo [+] Registering auto-start on login...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "AgentBridgeCompanion" /t REG_SZ /d "wscript.exe \"%VBS_FILE%\"" /f >nul

:: 5. Start immediately
echo [+] Starting Companion...
wscript.exe "%VBS_FILE%"

echo.
echo =======================================================
echo ✅ Installation Complete!
echo =======================================================
echo The AgentBridge Companion is now running in the background.
echo Opening the Chrome Web Store to install the Browser Extension...
echo.
timeout /t 3 >nul

:: Open Chrome extension page
start "" "https://chrome.google.com/webstore"

pause
