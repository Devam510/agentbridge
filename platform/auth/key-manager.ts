/**
 * key-manager.ts
 * Generates, stores, and validates Agent API keys.
 * WHY: We need to issue keys programmatically. Keys must be stored securely (hashed).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface AgentKeyRecord {
  id: string; // Public identifier (prefix)
  hashedKey: string; // SHA-256 hash of the actual key
  agentName: string;
  createdAt: string;
  expiresAt: string;
  scopes: string[]; // e.g. ["deals.*", "contacts.read"]
  revoked: boolean;
}

export interface GeneratedKey {
  key: string; // The plaintext key (only shown once)
  record: AgentKeyRecord;
}

// In a real app, this is PostgreSQL/Redis. For this engine, we use a local JSON DB.
const DB_PATH = path.resolve(__dirname, 'keys.db.json');

function loadDB(): Record<string, AgentKeyRecord> {
  if (!fs.existsSync(DB_PATH)) {
    // Ensure dir exists
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    return {};
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function saveDB(db: Record<string, AgentKeyRecord>) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

/**
 * Generate a new API key for an agent.
 */
export function generateKey(agentName: string, scopes: string[] = ['*'], ttlDays: number = 30): GeneratedKey {
  // Format: ag_prefix_randomhex
  const prefix = 'ag_';
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const rawKey = `${prefix}${randomBytes}`;
  
  // Public ID (first 12 chars of the random part)
  const id = `key_${randomBytes.slice(0, 12)}`;

  // Hash the key using SHA-256
  const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

  const createdAt = new Date();
  const expiresAt = new Date();
  expiresAt.setDate(createdAt.getDate() + ttlDays);

  const record: AgentKeyRecord = {
    id,
    hashedKey,
    agentName,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    scopes,
    revoked: false,
  };

  const db = loadDB();
  db[id] = record;
  saveDB(db);

  return { key: rawKey, record };
}

/**
 * Validate a plaintext key. Returns the record if valid, null if invalid/expired.
 */
export function validateKey(rawKey: string): AgentKeyRecord | null {
  if (!rawKey.startsWith('ag_')) return null;

  const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');
  const db = loadDB();

  // Find the record matching the hash
  // (In a real DB, we'd index on hashedKey)
  const record = Object.values(db).find(r => r.hashedKey === hashedKey);

  if (!record) return null;
  if (record.revoked) return null;
  
  if (new Date() > new Date(record.expiresAt)) {
    // Expired
    return null;
  }

  return record;
}

/**
 * Revoke an existing key by ID.
 */
export function revokeKey(id: string): boolean {
  const db = loadDB();
  if (db[id]) {
    db[id].revoked = true;
    saveDB(db);
    return true;
  }
  return false;
}
