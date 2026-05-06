@echo off
echo Starting AgentBridge Companion Server...
cd /d "%~dp0"
start "AgentBridge Companion" npx tsx platform\companion\server.ts
timeout /t 2 >nul
echo AgentBridge Companion started on http://localhost:3001
