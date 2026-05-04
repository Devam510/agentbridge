import * as fs from 'fs';
import * as path from 'path';

export interface CloudBridgeRecord {
  bridgeId: string;
  userId: string;
  tenantId: string;
  deployedAt: string;
  status: 'active' | 'paused' | 'error';
  endpoint: string;
  version: string;
}

const REGISTRY_PATH = path.resolve(__dirname, 'registry.db.json');

function loadRegistry(): Record<string, CloudBridgeRecord> {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

function saveRegistry(db: Record<string, CloudBridgeRecord>) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export function registerCloudBridge(
  bridgeId: string, 
  userId: string, 
  tenantId: string,
  version: string = '1.0.0'
): CloudBridgeRecord {
  const db = loadRegistry();
  
  const record: CloudBridgeRecord = {
    bridgeId,
    userId,
    tenantId,
    deployedAt: new Date().toISOString(),
    status: 'active',
    endpoint: `https://mcp.agentbridge.io/b/${bridgeId}`,
    version
  };

  db[bridgeId] = record;
  saveRegistry(db);
  
  return record;
}

export function getCloudBridge(bridgeId: string): CloudBridgeRecord | null {
  const db = loadRegistry();
  return db[bridgeId] || null;
}

export function listUserBridges(userId: string): CloudBridgeRecord[] {
  const db = loadRegistry();
  return Object.values(db).filter(b => b.userId === userId);
}
