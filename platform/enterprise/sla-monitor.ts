/**
 * sla-monitor.ts
 * Tracks bridge availability for enterprise SLAs.
 * WHY: Enterprise plans require 99.9% uptime SLA monitoring and alerts.
 */

export interface SlaRecord {
  bridgeId: string;
  totalChecks: number;
  failedChecks: number;
  uptimePercent: number;
}

// In-memory mock for MVP. In prod this uses a time-series DB (Prometheus/DataDog).
const slaDatabase: Record<string, SlaRecord> = {};

export function recordSlaPing(bridgeId: string, isHealthy: boolean): SlaRecord {
  if (!slaDatabase[bridgeId]) {
    slaDatabase[bridgeId] = { bridgeId, totalChecks: 0, failedChecks: 0, uptimePercent: 100 };
  }

  const record = slaDatabase[bridgeId];
  record.totalChecks++;
  
  if (!isHealthy) {
    record.failedChecks++;
  }

  record.uptimePercent = ((record.totalChecks - record.failedChecks) / record.totalChecks) * 100;

  return record;
}

export function checkSlaViolation(bridgeId: string, targetUptime: number = 99.0): boolean {
  const record = slaDatabase[bridgeId];
  if (!record) return false;
  
  // Only trigger violation if we have a reasonable sample size (e.g. > 10 checks)
  // For testing, we just check immediately
  return record.uptimePercent < targetUptime;
}
