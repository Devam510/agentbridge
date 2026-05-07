/**
 * platform/marketplace/catalog.ts — Module 9: Action Marketplace
 *
 * WHY: A local catalog of shareable automations. Users can publish their
 * recorded and verified automations, and others can install them with one click.
 * This creates the network effect that makes AgentBridge a platform, not just a tool.
 */

import * as fs from 'fs';
import * as path from 'path';

const CATALOG_FILE = path.resolve('./platform/marketplace/catalog.json');

export interface MarketplaceItem {
  id: string;
  name: string;           // "Post to LinkedIn"
  description: string;
  site: string;           // "linkedin.com"
  targetUrl: string;
  category: string;       // "social", "productivity", "finance", etc.
  author: string;
  successRate: number;    // 0–1, based on routing graph data
  installCount: number;
  actions: object[];      // The action sequence
  publishedAt: string;
  version: string;
}

function loadCatalog(): MarketplaceItem[] {
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      return JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveCatalog(catalog: MarketplaceItem[]): void {
  const dir = path.dirname(CATALOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
}

export function listMarketplaceItems(category?: string): MarketplaceItem[] {
  const catalog = loadCatalog();
  if (category) return catalog.filter(i => i.category === category);
  return catalog.sort((a, b) => b.installCount - a.installCount);
}

export function publishToMarketplace(
  item: Omit<MarketplaceItem, 'id' | 'publishedAt' | 'installCount' | 'version'>
): MarketplaceItem {
  const catalog = loadCatalog();
  
  // Check if an item for this site+name already exists — update it
  const existingIdx = catalog.findIndex(i => i.site === item.site && i.name === item.name);
  
  if (existingIdx >= 0) {
    const existing = catalog[existingIdx];
    const updated: MarketplaceItem = {
      ...existing,
      ...item,
      version: bumpVersion(existing.version),
      publishedAt: new Date().toISOString(),
    };
    catalog[existingIdx] = updated;
    saveCatalog(catalog);
    return updated;
  }

  const newItem: MarketplaceItem = {
    ...item,
    id: Math.random().toString(36).substring(2, 10),
    publishedAt: new Date().toISOString(),
    installCount: 0,
    version: '1.0.0',
  };

  catalog.push(newItem);
  saveCatalog(catalog);
  return newItem;
}

export function installFromMarketplace(id: string): MarketplaceItem | null {
  const catalog = loadCatalog();
  const item = catalog.find(i => i.id === id);
  if (!item) return null;

  // Increment install count
  item.installCount += 1;
  saveCatalog(catalog);

  return item;
}

function bumpVersion(version: string): string {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}
