import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * POST /api/install
 * Automatically patches claude_desktop_config.json with the new bridge.
 * Detects OS and finds the correct config path automatically.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { bridgeName, endpoint } = body;

  if (!bridgeName || !endpoint) {
    return NextResponse.json({ error: 'bridgeName and endpoint are required' }, { status: 400 });
  }

  // Find Claude Desktop config paths to try, in priority order
  const configPaths = getClaudeConfigPaths();

  let configPath: string | null = null;
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    // Try to create it at the first candidate path
    configPath = configPaths[0];
    const dir = path.dirname(configPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return NextResponse.json({
        error: 'Claude Desktop config not found and could not be created.',
        tried: configPaths,
        manualConfig: buildManualConfig(bridgeName, endpoint),
      }, { status: 404 });
    }
  }

  let config: any = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      return NextResponse.json({ error: 'Config file has invalid JSON. Please fix it first.' }, { status: 400 });
    }
  }

  if (!config.mcpServers) config.mcpServers = {};

  // Add the new bridge entry
  config.mcpServers[bridgeName] = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/client-sse', '--url', `${endpoint}/sse`],
    env: {},
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  return NextResponse.json({
    message: `✅ Bridge "${bridgeName}" installed! Restart Claude Desktop to connect.`,
    configPath,
    bridgeName,
  });
}

function getClaudeConfigPaths(): string[] {
  const home = os.homedir();
  const platform = os.platform();

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    // MSIX/Windows Store install path (highest priority on Windows)
    const packagesDir = path.join(localAppData, 'Packages');
    const msisPaths: string[] = [];
    try {
      const dirs = fs.readdirSync(packagesDir).filter(d => d.startsWith('Claude_'));
      for (const d of dirs) {
        msisPaths.push(path.join(packagesDir, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
      }
    } catch { /* packages dir may not exist */ }

    return [
      ...msisPaths,
      path.join(appData, 'Claude', 'claude_desktop_config.json'),
    ];
  }

  if (platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    ];
  }

  // Linux
  return [
    path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
  ];
}

function buildManualConfig(bridgeName: string, endpoint: string) {
  return {
    mcpServers: {
      [bridgeName]: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/client-sse', '--url', `${endpoint}/sse`],
        env: {},
      },
    },
  };
}
