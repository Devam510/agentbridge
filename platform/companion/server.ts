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
