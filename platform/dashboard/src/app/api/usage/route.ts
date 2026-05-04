import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Re-implementing basic aggregation here for Next.js to avoid monorepo TS config issues
const LOG_DIR = path.resolve(process.cwd(), '../../platform/metering/logs');

export async function GET() {
  if (!fs.existsSync(LOG_DIR)) {
    return NextResponse.json({
      totalActions: 0,
      successfulActions: 0,
      failedActions: 0,
      apiCalls: 0,
      browserCalls: 0,
      avgLatencyMs: 0,
      uniqueAgents: 0,
      topCapabilities: [],
      recentEvents: []
    });
  }

  const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
  
  let totalActions = 0;
  let successfulActions = 0;
  let failedActions = 0;
  let apiCalls = 0;
  let browserCalls = 0;
  let totalLatency = 0;
  const agentSet = new Set<string>();
  const capabilityCounts: Record<string, number> = {};
  const recentEvents: any[] = [];

  // Parse just the last 7 days of logs for the dashboard
  for (const file of files.slice(0, 7)) {
    const lines = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8').split('\n').filter(Boolean);
    
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i]);
        
        totalActions++;
        if (event.success) successfulActions++;
        else failedActions++;

        if (event.executionPath === 'api') apiCalls++;
        if (event.executionPath === 'browser') browserCalls++;

        totalLatency += event.latencyMs || 0;
        agentSet.add(event.agentId);

        capabilityCounts[event.capabilityId] = (capabilityCounts[event.capabilityId] || 0) + 1;

        if (recentEvents.length < 10) {
          recentEvents.push(event);
        }
      } catch {
        // ignore malformed
      }
    }
  }

  const topCapabilities = Object.entries(capabilityCounts)
    .map(([capabilityId, count]) => ({ capabilityId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return NextResponse.json({
    totalActions,
    successfulActions,
    failedActions,
    apiCalls,
    browserCalls,
    avgLatencyMs: totalActions > 0 ? Math.round(totalLatency / totalActions) : 0,
    uniqueAgents: agentSet.size,
    topCapabilities,
    recentEvents
  });
}
