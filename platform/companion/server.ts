import express from 'express';
import cors from 'cors';
import { patchAllConfigs, restartClaude } from './patcher.js';

const app = express();
const PORT = 3001;

// Allow any origin for now (in production, restrict to chrome-extension://...)
app.use(cors());
app.use(express.json());

// ── Health Check ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'AgentBridge Companion is running.' });
});

// ── Install Bridge ─────────────────────────────────────────────────────────
app.post('/api/install', (req, res) => {
  const { bridgeName, endpoint } = req.body;

  if (!bridgeName || !endpoint) {
    res.status(400).json({ error: 'bridgeName and endpoint are required' });
    return;
  }

  try {
    const entry = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/client-sse', '--url', `${endpoint}/sse`],
      env: {},
    };

    const patchedPaths = patchAllConfigs(bridgeName, entry);
    if (patchedPaths.length === 0) {
      res.status(404).json({ error: 'No AI clients (Claude/Cursor/Windsurf) found to patch.' });
      return;
    }

    restartClaude();

    res.json({
      success: true,
      message: `Bridge "${bridgeName}" installed in ${patchedPaths.length} clients!`,
      patchedPaths,
      bridgeName,
    });
  } catch (err: any) {
    console.error('Install error:', err);
    res.status(500).json({ error: err.message || 'Internal server error during installation.' });
  }
});

import * as childProcess from 'child_process';
import * as path from 'path';

// ── Bridge Creation (Mock for MVP) ─────────────────────────────────────────
app.post('/api/bridge/create', (req, res) => {
  const { url, bridgeName } = req.body;
  if (!url) { return res.status(400).json({ error: 'url required' }); }
  const name = bridgeName || new URL(url).hostname.replace(/^www\./, '').replace(/\./g, '-');
  res.json({ bridgeName: name, endpoint: 'local', status: 'queued' });
});

// ── Generate & Install (Zero-Friction Flow) ────────────────────────────────
app.post('/api/bridge/generate-and-install', (req, res) => {
  const { url } = req.body;
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const bridgeName = hostname.replace(/\./g, '-');

    // 1. Run local CLI generator
    console.log(`\nGenerating bridge for ${url}...`);
    childProcess.execSync(
      `npx tsx "${path.resolve('./cli/index.ts')}" create "${url}" --name "${bridgeName}"`,
      { stdio: 'pipe' }
    );

    // 2. Patch configs using absolute paths
    const serverPath = path.resolve('./bridges', bridgeName, 'server.ts');
    const tsxPath = require.resolve('tsx/cli');
    const entry = {
      command: 'node',
      args: [tsxPath, serverPath],
      env: {},
    };

    const patchedPaths = patchAllConfigs(bridgeName, entry);
    if (patchedPaths.length === 0) {
      res.status(404).json({ error: 'No AI clients found to patch.' });
      return;
    }

    restartClaude();

    res.json({
      success: true,
      message: `Bridge generated and installed in ${patchedPaths.length} clients!`,
      bridgeName,
    });
  } catch (err: any) {
    console.error('Generate & Install error:', err);
    res.status(500).json({ error: err.message || 'Error generating bridge.' });
  }
});
// ── Extension Execution Bridge (Phase 7) ──────────────────────────────────
// This connects the local MCP server (browser-executor.ts) to the Chrome Extension

interface Task {
  id: string;
  capability: any;
  params: any;
  targetUrl: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

const pendingTasks: Task[] = [];
let currentPollRes: express.Response | null = null;

// Called by browser-executor.ts to request execution in the real browser
app.post('/api/execute', async (req, res) => {
  const { capability, params, targetUrl, actions } = req.body;
  const taskId = Math.random().toString(36).substring(7);
  console.log(`[Companion] Task created: ${taskId} (${capability?.name})`);

  let timeoutHandle: NodeJS.Timeout;

  const taskPromise = new Promise((resolve, reject) => {
    const task: Task = { id: taskId, capability, params, targetUrl, resolve, reject };
    pendingTasks.push(task);

    // 45s timeout — covers slow SPAs like Google Calendar
    timeoutHandle = setTimeout(() => {
      const idx = pendingTasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        pendingTasks.splice(idx, 1);
        reject(new Error('AgentBridge timeout: The Chrome Extension did not respond within 45s. Make sure the extension is installed and your browser is open.'));
      }
    }, 45000);
  });

  // Wake up any waiting extension poll immediately
  if (currentPollRes) {
    const task = pendingTasks.find(t => t.id === taskId);
    if (task) {
      console.log(`[Companion] Dispatching task ${taskId} to waiting extension`);
      currentPollRes.json({ ...task, actions });
      currentPollRes = null;
    }
  }

  try {
    const result = await taskPromise;
    clearTimeout(timeoutHandle!);
    console.log(`[Companion] Task ${taskId} completed successfully`);
    res.json(result);
  } catch (err: any) {
    clearTimeout(timeoutHandle!);
    console.error(`[Companion] Task ${taskId} failed: ${err.message}`);
    res.status(504).json({ success: false, errorMessage: err.message });
  }
});

// Called by the Chrome Extension to wait for new commands
app.get('/api/extension/poll', (req, res) => {
  if (pendingTasks.length > 0) {
    const task = pendingTasks[0];
    console.log(`[Companion] Sending queued task ${task.id} to extension`);
    res.json(task);
  } else {
    // Long-poll: hang until a task arrives
    currentPollRes = res;
    req.on('close', () => {
      if (currentPollRes === res) currentPollRes = null;
    });
  }
});

// Called by the Chrome Extension to return the execution result
app.post('/api/extension/result', (req, res) => {
  const { id, result, error } = req.body;
  const taskIndex = pendingTasks.findIndex(t => t.id === id);
  if (taskIndex !== -1) {
    const task = pendingTasks[taskIndex];
    pendingTasks.splice(taskIndex, 1);
    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }
    console.log(`[Companion] Result received for task ${id}: ${error ? 'ERROR' : 'OK'}`);
  }
  res.json({ success: true });
});

// Health endpoint for extension status
let lastExtensionPing = 0;
app.get('/api/health/extension', (req, res) => {
  lastExtensionPing = Date.now();
  res.json({ status: 'ok', connected: true, timestamp: lastExtensionPing });
});

app.get('/api/health/extension/status', (req, res) => {
  const isConnected = Date.now() - lastExtensionPing < 10000; // connected if pinged within 10s
  res.json({ connected: isConnected, lastSeen: lastExtensionPing });
});

export function startCompanionServer() {
  app.listen(PORT, () => {
    console.log(`\n⚡ AgentBridge Companion running silently on http://localhost:${PORT}`);
    console.log(`   Waiting for extension requests...\n`);
  });
}

// Auto-start if run directly
if (require.main === module || process.argv[1]?.endsWith('server.ts')) {
  startCompanionServer();
}
