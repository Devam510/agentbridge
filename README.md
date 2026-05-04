<div align="center">
  <img src="https://raw.githubusercontent.com/AgentBridge/agentbridge/main/docs/assets/logo.png" alt="AgentBridge Logo" width="120" />
  <h1>AgentBridge</h1>
  <p><strong>Make any software agent-native in 5 minutes.</strong></p>
  <p>Instantly connect Claude Desktop, Cursor, and Windsurf to ANY website using your live browser session.</p>

  <a href="#the-problem">The Problem</a> •
  <a href="#the-solution">The Solution</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a>
</div>

---

## 🛑 The Problem

AI coding agents (like Claude Desktop, Cursor, and Windsurf) are incredibly smart but trapped in their local environment. If you want your AI assistant to read a Google Doc, schedule a Google Calendar event, or pull data from an internal dashboard, you hit a wall:
1. **No APIs:** 90% of the software you use doesn't have an official API.
2. **Authentication Hell:** If an API does exist, setting up OAuth, API keys, and enterprise permissions just to read a document takes hours.
3. **Siloed Agents:** Your AI agents can't see the context of the tools you are already logged into on your browser.

## 🚀 The Solution

**AgentBridge** bypasses official APIs entirely. It automatically crawls any website and uses AI to generate a **Model Context Protocol (MCP)** server on the fly. 

Instead of dealing with API keys, AgentBridge proxies the AI's requests through a lightweight **Browser Extension**. This gives your AI agents native control over *any* website by securely utilizing your **already-logged-in browser session**.

If you can do it in your browser, your AI can now do it too.

## ✨ Key Features

- **🪄 1-Click Generation:** Paste any URL. AgentBridge uses an LLM to scan the DOM and automatically generate custom MCP tools (e.g., `create_calendar_event`).
- **🔌 Zero-Friction Install:** The local companion app automatically discovers and patches your Claude Desktop, Cursor, and Windsurf configuration files so you never have to edit JSON manually.
- **🔑 Zero Authentication:** Uses your live Chrome/Brave browser session. No OAuth, no passwords, no tokens.
- **🛡️ Secure & Visible:** The AI performs actions directly in your browser, giving you 100% visibility over what it is doing.

---

## 🛠️ How It Works

1. **The Generator:** Our CLI uses an LLM (like GPT-4) to read the source code of a website, map out buttons/forms, and generate custom tools.
2. **The Companion App:** A tiny background service that auto-connects your generated bridges to your IDEs.
3. **The Browser Extension:** When Claude wants to execute a tool, it sends the command to the extension, which physically clicks the buttons and reads the data using your active session.

---

## 📥 Installation

### 1. Download the Companion App
For AgentBridge to automatically connect your AI agents, you need the background Companion App running:
* **Windows:** Download and double-click `install.bat` (Registers to run automatically on startup).
* **Mac/Linux:** Download and run `install.sh` (Registers via `launchd`).

### 2. Install the Browser Extension
* Clone this repository.
* Open your browser and go to `chrome://extensions/`
* Enable **Developer Mode**.
* Click **Load Unpacked** and select the `apps/extension` folder.

### 3. Setup API Keys
AgentBridge requires an LLM to intelligently map out websites and generate tools.
```bash
cp .env.example .env
```
Add your `OPENAI_API_KEY` to the `.env` file.

---

## 💻 Usage

### Generating a New Bridge
You can use the CLI to generate a bridge for any website:
```bash
npx agentbridge create https://googlecalendar.com --name googlecalendar-com
```

### Auto-Connecting to IDEs
To instantly inject the newly created bridge into Claude Desktop, Cursor, and Windsurf:
```bash
npx agentbridge add googlecalendar-com --restart
```

### Using the Web Dashboard
Alternatively, you can use our visual dashboard to generate and connect bridges with 1-click!
```bash
cd platform/dashboard
npm install
npm run dev
```
Visit `http://localhost:3000` to access the visual bridge builder.

---

## 🏗️ Tech Stack
* **Engine:** Node.js, TypeScript, Model Context Protocol (MCP)
* **Generator:** Puppeteer, OpenAI API
* **Companion:** Express (Local API)
* **Extension:** Chrome Manifest V3
* **Dashboard:** Next.js (React)

## 🤝 Contributing
Pull requests are welcome! If you find a website that the generator struggles with, please open an issue so we can improve the heuristic engine.
