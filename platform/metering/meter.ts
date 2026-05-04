/**
 * meter.ts
 * Records every action taken by an agent for usage tracking and billing.
 * WHY: We need an append-only log of all actions to aggregate usage.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MeterEvent {
  eventId: string;
  timestamp: string;
  agentId: string;
  bridgeId: string;
  capabilityId: string;
  executionPath: 'api' | 'browser' | 'error';
  latencyMs: number;
  success: boolean;
  // SECURITY: Intentionally omitting PII or actual data payloads (S3B.4)
}

// Logs stored next to this file: platform/metering/logs/
const LOG_DIR = path.resolve(__dirname, 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Record an action into the daily meter log.
 * Thread-safe append operation.
 */
export async function recordAction(event: Omit<MeterEvent, 'eventId' | 'timestamp'>): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const logFile = path.join(LOG_DIR, `meter-${dateStr}.jsonl`);

  const fullEvent: MeterEvent = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: now.toISOString(),
    ...event,
  };

  // Append-only write (S3B.3)
  // Using synchronous append for simplicity in this engine demo,
  // but in prod this would be sent to an event stream like Kafka/Kinesis.
  fs.appendFileSync(logFile, JSON.stringify(fullEvent) + '\n', 'utf-8');
}
