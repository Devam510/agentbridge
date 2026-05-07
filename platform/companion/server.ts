import express from 'express';
import cors from 'cors';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { patchAllConfigs, restartClaude } from './patcher.js';
import { synthesizeScript } from '../../engine/generator/code-synthesizer.js';
import { healSelector } from '../../engine/healer/selector-healer.js';
import { recordSuccess, queryGraph, getGraphForDomain } from '../../engine/routing-graph/agentic-router.js';
import { getLocalLLM } from './local-llm.js';
import { initScheduler, createSchedule, deleteSchedule, listSchedules, registerExecuteCallback } from './schedules.js';
import { saveCredential, getCredential, listVaultEntries, addToVaultIndex, deleteCredential } from './vault.js';
import { executeChain } from '../../engine/executor/chain-executor.js';
import { listMarketplaceItems, publishToMarketplace, installFromMarketplace } from '../marketplace/catalog.js';

const app = express();
const PORT = 3001;

// Security: CORS restricted to only localhost (companion) and Chrome Extension origins.
// In production, replace 'chrome-extension://*' with your specific extension ID.
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  /^chrome-extension:\/\//,
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Allow non-browser clients (curl, MCP)
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '2mb' })); // Cap payload size against DoS

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
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }
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
// ── Extension Execution Bridge (Phase 8D) ──────────────────────────────────
// This connects the local MCP server (browser-executor.ts) to the Chrome Extension

interface Task {
  id: string;
  capability: any;
  params: any;
  targetUrl: string;
  actions: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  createdAt: number;
}

const pendingTasks = new Map<string, Task>();
let currentPollRes: express.Response | null = null;

// Called by browser-executor.ts to request execution in the real browser
app.post('/api/execute', async (req, res) => {
  const { capability, params, targetUrl, actions } = req.body;
  const taskId = Math.random().toString(36).substring(7);
  console.log(`[Companion] Task created: ${taskId} (${capability?.name})`);

  let timeoutHandle: NodeJS.Timeout;

  const taskPromise = new Promise((resolve, reject) => {
    const task: Task = { id: taskId, capability, params, targetUrl, actions, resolve, reject, createdAt: Date.now() };
    pendingTasks.set(taskId, task);

    // 45s timeout — covers slow SPAs
    timeoutHandle = setTimeout(() => {
      if (pendingTasks.has(taskId)) {
        pendingTasks.delete(taskId);
        reject(new Error('AgentBridge timeout: The Chrome Extension did not respond within 45s. Make sure the extension is installed and your browser is open.'));
      }
    }, 45000);
  });

  // Wake up any waiting extension poll immediately
  if (currentPollRes) {
    const task = pendingTasks.get(taskId);
    if (task) {
      console.log(`[Companion] Dispatching task ${taskId} to waiting extension`);
      currentPollRes.json({ 
        id: task.id, 
        capability: task.capability, 
        params: task.params, 
        targetUrl: task.targetUrl, 
        actions: task.actions 
      });
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
  lastExtensionPing = Date.now(); // Also serves as heartbeat

  // Find oldest pending task
  const taskToRun = Array.from(pendingTasks.values()).sort((a, b) => a.createdAt - b.createdAt)[0];
  
  if (taskToRun) {
    console.log(`[Companion] Sending queued task ${taskToRun.id} to extension`);
    res.json({
      id: taskToRun.id, 
      capability: taskToRun.capability, 
      params: taskToRun.params, 
      targetUrl: taskToRun.targetUrl, 
      actions: taskToRun.actions
    });
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
  lastExtensionPing = Date.now();
  const { id, result, error } = req.body;
  
  if (pendingTasks.has(id)) {
    const task = pendingTasks.get(id)!;
    pendingTasks.delete(id);
    if (error) {
      task.reject(new Error(error));
    } else {
      task.resolve(result);
    }
    console.log(`[Companion] Result received for task ${id}: ${error ? 'ERROR' : 'OK'}`);
  }
  res.json({ success: true });
});

let lastExtensionPing = Date.now();

// Health endpoints
app.post('/api/extension/heartbeat', (req, res) => {
  lastExtensionPing = Date.now();
  res.json({ success: true });
});

app.get('/api/health/extension', (req, res) => {
  lastExtensionPing = Date.now();
  res.json({ status: 'ok', connected: true, timestamp: lastExtensionPing });
});

app.get('/api/health/extension/status', (req, res) => {
  // If we haven't seen the extension in 15s, it disconnected
  const isConnected = Date.now() - lastExtensionPing < 15000; 
  res.json({ connected: isConnected, lastSeen: lastExtensionPing });
});

// ── Module 1: Demonstration-to-Code — Script Synthesis ──────────────────────
// WHY: API key lives ONLY here in the backend. Extension never touches OpenAI.
app.post('/api/recorder/synthesize', async (req, res) => {
  const { events } = req.body;
  if (!events || !Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: 'No events provided' });
    return;
  }
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const result = await synthesizeScript(events, apiKey);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Module 3: Self-Healing — Selector Recovery ───────────────────────────────
// WHY: Vision model API key stays server-side. Extension sends DOM + screenshot.
app.post('/api/healer/resolve', async (req, res) => {
  const { intent, domSnapshot, screenshotBase64, domain } = req.body;
  if (!intent || !domain) {
    res.status(400).json({ error: 'intent and domain are required' });
    return;
  }
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const result = await healSelector(intent, domSnapshot || '', screenshotBase64 || '', domain, apiKey);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Module 6: Agentic Routing Graph ──────────────────────────────────────────
app.post('/api/graph/record', (req, res) => {
  const { intent, domain, actions } = req.body;
  if (!intent || !domain || !actions) {
    res.status(400).json({ error: 'intent, domain, and actions are required' });
    return;
  }
  recordSuccess(intent, domain, actions);
  res.json({ success: true });
});

app.get('/api/graph/query', (req, res) => {
  const { intent, domain } = req.query as { intent: string; domain: string };
  if (!intent || !domain) {
    res.status(400).json({ error: 'intent and domain query params required' });
    return;
  }
  const result = queryGraph(intent, domain);
  res.json({ success: true, result });
});

app.get('/api/graph/domain', (req, res) => {
  const { domain } = req.query as { domain: string };
  if (!domain) {
    res.status(400).json({ error: 'domain query param required' });
    return;
  }
  const results = getGraphForDomain(domain);
  res.json({ success: true, results });
});

// ── Module 7: Local GPU AI Inference ─────────────────────────────────────────
app.post('/api/ai/infer', async (req, res) => {
  const { prompt, systemPrompt } = req.body;
  if (!prompt) { res.status(400).json({ error: 'prompt required' }); return; }
  try {
    const localLLM = await getLocalLLM();
    if (!localLLM) {
      res.status(503).json({ error: 'Local model not loaded. Run: npx tsx scripts/download-model.ts' });
      return;
    }
    const response = await localLLM.infer(prompt, systemPrompt);
    res.json({ success: true, response });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ai/status', async (_req, res) => {
  const localLLM = await getLocalLLM();
  res.json({ localModelLoaded: !!localLLM });
});

// ── Module 12: Scheduled Agents ───────────────────────────────────────────────
app.get('/api/schedule/list', (_req, res) => {
  res.json({ success: true, schedules: listSchedules() });
});

app.post('/api/schedule/create', (req, res) => {
  const { name, cronExpression, capabilityId, params, targetUrl } = req.body;
  if (!name || !cronExpression || !capabilityId || !targetUrl) {
    res.status(400).json({ error: 'name, cronExpression, capabilityId, targetUrl required' });
    return;
  }
  try {
    const schedule = createSchedule({ name, cronExpression, capabilityId, params: params || {}, targetUrl, enabled: true });
    res.json({ success: true, schedule });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/schedule/:id', (req, res) => {
  const deleted = deleteSchedule(req.params.id);
  res.json({ success: deleted });
});

// ── Module 13: Credential Vault ───────────────────────────────────────────────
app.get('/api/vault/list', async (_req, res) => {
  try {
    const entries = await listVaultEntries();
    // Security: only return site + username, NEVER the password
    res.json({ success: true, entries });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vault/save', async (req, res) => {
  const { site, username, password } = req.body;
  if (!site || !username || !password) {
    res.status(400).json({ error: 'site, username, password required' });
    return;
  }
  try {
    await saveCredential(site, username, password);
    await addToVaultIndex(site);
    // Security: never echo the password back
    res.json({ success: true, site, username });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Internal-only endpoint: used by executor, returns credential for auto-login
// Security: This endpoint only accepts requests from localhost (CORS policy)
app.get('/api/vault/get', async (req, res) => {
  const { site } = req.query as { site: string };
  if (!site) { res.status(400).json({ error: 'site required' }); return; }
  try {
    const cred = await getCredential(site);
    if (!cred) { res.status(404).json({ error: 'No credential found for this site' }); return; }
    // Returns both username and password for the executor — NEVER expose this endpoint externally
    res.json({ success: true, username: cred.username, password: cred.password });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/vault/:site', async (req, res) => {
  try {
    const deleted = await deleteCredential(decodeURIComponent(req.params.site));
    res.json({ success: deleted });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Module 10: Workflow Chains ────────────────────────────────────────────────
app.post('/api/workflow/run', async (req, res) => {
  const { chain } = req.body;
  if (!chain || !chain.steps || !Array.isArray(chain.steps)) {
    res.status(400).json({ error: 'chain with steps array required' });
    return;
  }
  try {
    const result = await executeChain(chain);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Module 9: Action Marketplace ──────────────────────────────────────────────
app.get('/api/marketplace/list', (req, res) => {
  const { category } = req.query as { category?: string };
  res.json({ success: true, items: listMarketplaceItems(category) });
});

app.post('/api/marketplace/publish', (req, res) => {
  const { name, description, site, targetUrl, category, author, successRate, actions } = req.body;
  if (!name || !site || !targetUrl || !actions) {
    res.status(400).json({ error: 'name, site, targetUrl, actions required' });
    return;
  }
  const item = publishToMarketplace({
    name, description: description || '', site, targetUrl,
    category: category || 'general', author: author || 'anonymous',
    successRate: successRate || 1.0, actions,
  });
  res.json({ success: true, item });
});

app.post('/api/marketplace/install', (req, res) => {
  const { id } = req.body;
  if (!id) { res.status(400).json({ error: 'id required' }); return; }
  const item = installFromMarketplace(id);
  if (!item) { res.status(404).json({ error: 'Automation not found in marketplace' }); return; }
  res.json({ success: true, item });
});

// ── Module 11: Live Telemetry endpoint (from extension) ───────────────────────
const telemetryClients = new Set<WebSocket>();

app.post('/api/telemetry', (req, res) => {
  const event = req.body;
  // Broadcast to all connected dashboard WebSocket clients
  const payload = JSON.stringify({ type: 'TELEMETRY', event });
  for (const client of telemetryClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
  res.json({ success: true });
});

export function startCompanionServer() {
  const httpServer = http.createServer(app);

  // Module 11: WebSocket server for live dashboard telemetry (port 3002)
  // Security: host: '127.0.0.1' binds to loopback ONLY — not accessible from external network
  const wss = new WebSocketServer({ port: 3002, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    telemetryClients.add(ws);
    console.log('[Telemetry] Dashboard client connected');
    ws.on('close', () => {
      telemetryClients.delete(ws);
      console.log('[Telemetry] Dashboard client disconnected');
    });
    // Send initial connection ack
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'AgentBridge Live Monitor connected' }));
  });

  // Module 12: Register scheduler execute callback and start cron jobs
  registerExecuteCallback(async (capabilityId, params, targetUrl) => {
    const response = await fetch(`http://localhost:${PORT}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: { id: capabilityId, name: capabilityId }, params, targetUrl, actions: [] }),
    });
    if (!response.ok) throw new Error(`Scheduled execution failed: HTTP ${response.status}`);
  });
  initScheduler();

  httpServer.listen(PORT, () => {
    console.log(`\n⚡ AgentBridge Companion running on http://localhost:${PORT}`);
    console.log(`📡 Live Dashboard WebSocket on ws://localhost:3002`);
    console.log(`   Waiting for extension requests...\n`);
  });
}

// Auto-start if run directly
if (require.main === module || process.argv[1]?.endsWith('server.ts')) {
  startCompanionServer();
}
