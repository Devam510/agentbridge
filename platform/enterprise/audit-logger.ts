/**
 * audit-logger.ts
 * SOC2-aligned audit trail generator.
 * WHY: Enterprise buyers need immutable, exportable proof of who did what, and when.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface AuditEvent {
  timestamp: string;
  tenantId: string;
  actor: string; // User ID, Agent ID, or System
  action: string;
  resource: string;
  ipAddress?: string;
  status: 'success' | 'failure';
}

const AUDIT_DIR = path.resolve(__dirname, 'audit');

if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

/**
 * Append an immutable audit event to the tenant's daily audit log.
 */
export function logAuditEvent(event: Omit<AuditEvent, 'timestamp'>): void {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const logFile = path.join(AUDIT_DIR, `audit_${event.tenantId}_${dateStr}.log`);

  const fullEvent: AuditEvent = {
    timestamp: now.toISOString(),
    ...event,
  };

  // Append-only. In SOC2 prod, this goes to WORM (Write Once Read Many) storage like S3 Object Lock.
  fs.appendFileSync(logFile, JSON.stringify(fullEvent) + '\n', 'utf-8');
}

/**
 * Export a tenant's audit trail to CSV format for compliance requests.
 */
export function exportAuditCsv(tenantId: string, dateStr: string): string {
  const logFile = path.join(AUDIT_DIR, `audit_${tenantId}_${dateStr}.log`);
  
  if (!fs.existsSync(logFile)) {
    throw new Error('Audit log not found for the specified tenant and date');
  }

  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  
  // CSV Header
  let csv = 'Timestamp,TenantId,Actor,Action,Resource,IpAddress,Status\n';

  for (const line of lines) {
    try {
      const e = JSON.parse(line) as AuditEvent;
      csv += `${e.timestamp},${e.tenantId},${e.actor},${e.action},${e.resource},${e.ipAddress || 'N/A'},${e.status}\n`;
    } catch {
      // Skip corrupted
    }
  }

  return csv;
}
