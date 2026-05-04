/**
 * aggregator.ts
 * Processes raw meter logs into daily/monthly usage summaries.
 * WHY: Dashboards and billing systems need fast summaries, not raw logs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MeterEvent } from './meter.js';

export interface UsageSummary {
  date: string;
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  apiCalls: number;
  browserCalls: number;
  avgLatencyMs: number;
  uniqueAgents: number;
  actionsByBridge: Record<string, number>;
  topCapabilities: Array<{ capabilityId: string; count: number }>;
}

const LOG_DIR = path.resolve(__dirname, 'logs');

/**
 * Aggregate a specific day's meter log into a summary.
 */
export function aggregateDailyUsage(dateStr: string): UsageSummary {
  const logFile = path.join(LOG_DIR, `meter-${dateStr}.jsonl`);
  
  const summary: UsageSummary = {
    date: dateStr,
    totalActions: 0,
    successfulActions: 0,
    failedActions: 0,
    apiCalls: 0,
    browserCalls: 0,
    avgLatencyMs: 0,
    uniqueAgents: 0,
    actionsByBridge: {},
    topCapabilities: [],
  };

  if (!fs.existsSync(logFile)) {
    return summary;
  }

  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  
  let totalLatency = 0;
  const agentSet = new Set<string>();
  const capabilityCounts: Record<string, number> = {};

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as MeterEvent;
      
      summary.totalActions++;
      if (event.success) summary.successfulActions++;
      else summary.failedActions++;

      if (event.executionPath === 'api') summary.apiCalls++;
      if (event.executionPath === 'browser') summary.browserCalls++;

      totalLatency += event.latencyMs;
      agentSet.add(event.agentId);

      // Bridge aggregation
      summary.actionsByBridge[event.bridgeId] = (summary.actionsByBridge[event.bridgeId] || 0) + 1;

      // Capability aggregation
      capabilityCounts[event.capabilityId] = (capabilityCounts[event.capabilityId] || 0) + 1;
    } catch {
      // Ignore malformed lines
    }
  }

  summary.uniqueAgents = agentSet.size;
  if (summary.totalActions > 0) {
    summary.avgLatencyMs = Math.round(totalLatency / summary.totalActions);
  }

  // Sort capabilities by count
  summary.topCapabilities = Object.entries(capabilityCounts)
    .map(([capabilityId, count]) => ({ capabilityId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return summary;
}
