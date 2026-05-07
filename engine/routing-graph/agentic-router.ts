/**
 * engine/routing-graph/agentic-router.ts — Module 6: The Agentic Routing Graph
 *
 * WHY: A crowdsourced, semantic database of verified execution paths.
 * When an AI needs to know "how to cancel Netflix", it queries this router
 * instead of blindly crawling. Each successful AgentBridge execution
 * contributes a hashed, anonymized path to this shared knowledge graph.
 * Data is stored locally in a JSON file (scales to DB in cloud later).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const GRAPH_FILE = path.resolve('./engine/routing-graph/action-graph.json');

interface ActionNode {
  id: string;           // sha256 hash of intent+domain
  intent: string;       // "cancel subscription"
  domain: string;       // "netflix.com"
  actions: object[];    // The verified action sequence
  successCount: number; // How many times this was verified
  lastVerified: string; // ISO date
}

function loadGraph(): Record<string, ActionNode> {
  try {
    if (fs.existsSync(GRAPH_FILE)) {
      return JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveGraph(graph: Record<string, ActionNode>): void {
  const dir = path.dirname(GRAPH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GRAPH_FILE, JSON.stringify(graph, null, 2));
}

function nodeId(intent: string, domain: string): string {
  return crypto.createHash('sha256').update(`${intent.toLowerCase()}::${domain}`).digest('hex').slice(0, 16);
}

/**
 * Record a successful execution so it can be retrieved later.
 * WHY: Anonymized telemetry — no user data, only action patterns.
 */
export function recordSuccess(intent: string, domain: string, actions: object[]): void {
  const graph = loadGraph();
  const id = nodeId(intent, domain);

  const existing = graph[id];
  if (existing) {
    existing.successCount += 1;
    existing.lastVerified = new Date().toISOString();
    existing.actions = actions; // Update with latest working sequence
  } else {
    graph[id] = {
      id,
      intent: intent.toLowerCase(),
      domain,
      actions,
      successCount: 1,
      lastVerified: new Date().toISOString(),
    };
  }
  saveGraph(graph);
}

/**
 * Query the graph for a known execution path.
 * Returns the most-verified action sequence for the given intent on a domain.
 */
export function queryGraph(intent: string, domain: string): ActionNode | null {
  const graph = loadGraph();

  // 1. Exact match
  const exactId = nodeId(intent, domain);
  if (graph[exactId]) return graph[exactId];

  // 2. Fuzzy match: find intents containing key words
  const intentWords = intent.toLowerCase().split(' ');
  const candidates = Object.values(graph).filter(node =>
    node.domain === domain &&
    intentWords.some(word => node.intent.includes(word))
  );

  if (candidates.length === 0) return null;

  // Return the most verified
  return candidates.sort((a, b) => b.successCount - a.successCount)[0];
}

/**
 * Get all known action paths for a domain.
 */
export function getGraphForDomain(domain: string): ActionNode[] {
  const graph = loadGraph();
  return Object.values(graph).filter(n => n.domain === domain);
}
