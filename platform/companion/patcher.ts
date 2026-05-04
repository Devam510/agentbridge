import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as childProcess from 'child_process';

// ── Known pre-built integrations ──────────────────────────────────────────
export const KNOWN_SERVICES: Record<string, { entry: object; note?: string }> = {
  github: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
    note: 'Set your GitHub token: https://github.com/settings/tokens/new (scopes: repo, read:user)',
  },
  filesystem: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', os.homedir()],
    },
  },
  brave: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' },
    },
    note: 'Set your Brave Search API key: https://api.search.brave.com',
  },
  slack: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    },
    note: 'Create a Slack app at https://api.slack.com/apps and get a bot token',
  },
  postgres: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'],
    },
    note: 'Replace the connection string with your actual Postgres URL',
  },
  sqlite: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite', path.join(os.homedir(), 'database.db')],
    },
    note: 'Replace the path with your actual SQLite database file',
  },
  memory: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
  puppeteer: {
    entry: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
};

export function findClaudeConfigPath(): string | null {
  const home = os.homedir();
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

    // MSIX (Windows Store) install — scan Packages dir for Claude_*
    const packagesDir = path.join(localAppData, 'Packages');
    try {
      if (fs.existsSync(packagesDir)) {
        const dirs = fs.readdirSync(packagesDir).filter(d => d.startsWith('Claude_'));
        for (const d of dirs) {
          candidates.push(path.join(packagesDir, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
        }
      }
    } catch { /* Packages dir may not exist */ }

    // Standard installer path
    candidates.push(path.join(appData, 'Claude', 'claude_desktop_config.json'));
  } else if (platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  } else {
    // Linux
    candidates.push(path.join(home, '.config', 'Claude', 'claude_desktop_config.json'));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // If none found, return first candidate (we'll create it)
  return candidates[0] || null;
}

export function findCursorConfigPath(): string | null {
  const home = os.homedir();
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    // Common path for Cline/Roo-Cline in Cursor
    candidates.push(path.join(appData, 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    // Native Cursor MCP path
    candidates.push(path.join(appData, 'Cursor', 'User', 'workspaceStorage', 'mcp.json'));
  } else if (platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
  } else {
    candidates.push(path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || null;
}

export function findWindsurfConfigPath(): string | null {
  const home = os.homedir();
  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Windsurf', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    candidates.push(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'));
  } else if (platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
    candidates.push(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'));
  } else {
    candidates.push(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0] || null;
}

export function patchAllConfigs(serverName: string, entry: object): string[] {
  const paths = [
    findClaudeConfigPath(),
    findCursorConfigPath(),
    findWindsurfConfigPath()
  ].filter(Boolean) as string[];

  const patched: string[] = [];
  for (const configPath of paths) {
    try {
      patchConfig(configPath, serverName, entry);
      patched.push(configPath);
    } catch (err) {
      console.warn(`Failed to patch ${configPath}:`, err);
    }
  }
  return patched;
}

export function patchConfig(configPath: string, serverName: string, entry: object): void {
  let config: any = { mcpServers: {} };

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      throw new Error('Claude Desktop config has invalid JSON. Fix it first with: npx agentbridge doctor');
    }
  }

  if (!config.mcpServers) config.mcpServers = {};

  // Fix Windows `npx` vs `npx.cmd` issue for Claude Desktop
  const entryClone = JSON.parse(JSON.stringify(entry));
  if (os.platform() === 'win32' && entryClone.command === 'npx') {
    entryClone.command = 'npx.cmd';
  }

  config.mcpServers[serverName] = entryClone;

  // Create directory if needed
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function restartClaude(): void {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      childProcess.execSync('taskkill /IM claude.exe /F', { stdio: 'ignore' });
      setTimeout(() => {
        childProcess.exec('start "" claude', { stdio: 'ignore' } as any);
      }, 1000);
    } else if (platform === 'darwin') {
      childProcess.execSync('pkill -f "Claude"', { stdio: 'ignore' });
      setTimeout(() => {
        childProcess.exec('open -a Claude', { stdio: 'ignore' } as any);
      }, 1000);
    }
  } catch { /* Claude may not be running, that's fine */ }
}
