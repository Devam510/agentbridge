/**
 * platform/companion/vault.ts — Module 13: Credential Vault
 *
 * WHY: Uses the OS native keychain (Windows Credential Manager via keytar)
 * to store credentials securely. Passwords are NEVER stored in plain text,
 * NEVER logged, and NEVER returned over the network.
 *
 * Security guarantees:
 * - keytar uses AES-256 encryption backed by the OS secure storage
 * - Passwords are only fetched in-memory and passed directly to the executor
 * - The /api/vault/get endpoint returns username ONLY, never the password
 */

import keytar from 'keytar';

const SERVICE_NAME = 'AgentBridge';

export interface VaultEntry {
  site: string;
  username: string;
  // password is never returned externally
}

/**
 * Save a credential to the OS keychain.
 * Password is stored with Windows Credential Manager (AES-256).
 */
export async function saveCredential(site: string, username: string, password: string): Promise<void> {
  const key = `${SERVICE_NAME}::${site}`;
  await keytar.setPassword(key, username, password);
}

/**
 * Retrieve a credential for internal use ONLY (never expose over network).
 * Returns null if not found.
 */
export async function getCredential(site: string): Promise<{ username: string; password: string } | null> {
  const key = `${SERVICE_NAME}::${site}`;
  // Find all accounts for this service+site key
  const credentials = await keytar.findCredentials(key);
  if (!credentials || credentials.length === 0) return null;
  const cred = credentials[0];
  return { username: cred.account, password: cred.password };
}

/**
 * List all saved sites (returns usernames only — passwords never included).
 */
export async function listVaultEntries(): Promise<VaultEntry[]> {
  // keytar.findCredentials searches by service name
  // We use a prefix pattern to list all AgentBridge entries
  // Note: keytar doesn't support wildcard search, so we maintain a site index
  const indexPath = './platform/companion/vault-index.json';
  const fs = await import('fs');
  const path = await import('path');

  let sites: string[] = [];
  try {
    if (fs.existsSync(indexPath)) {
      sites = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch {}

  const entries: VaultEntry[] = [];
  for (const site of sites) {
    const cred = await getCredential(site);
    if (cred) {
      entries.push({ site, username: cred.username });
    }
  }
  return entries;
}

/**
 * Save a site to the vault index (needed because keytar doesn't support listing).
 */
export async function addToVaultIndex(site: string): Promise<void> {
  const indexPath = './platform/companion/vault-index.json';
  const fs = await import('fs');

  let sites: string[] = [];
  try {
    if (fs.existsSync(indexPath)) {
      sites = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch {}

  if (!sites.includes(site)) {
    sites.push(site);
    fs.writeFileSync(indexPath, JSON.stringify(sites, null, 2));
  }
}

/**
 * Delete a credential from the vault.
 */
export async function deleteCredential(site: string): Promise<boolean> {
  const cred = await getCredential(site);
  if (!cred) return false;
  const key = `${SERVICE_NAME}::${site}`;
  const deleted = await keytar.deletePassword(key, cred.username);

  // Remove from index
  const indexPath = './platform/companion/vault-index.json';
  const fs = await import('fs');
  try {
    if (fs.existsSync(indexPath)) {
      const sites: string[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      fs.writeFileSync(indexPath, JSON.stringify(sites.filter(s => s !== site), null, 2));
    }
  } catch {}

  return deleted;
}
