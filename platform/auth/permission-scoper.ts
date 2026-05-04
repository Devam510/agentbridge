/**
 * permission-scoper.ts
 * Checks if a specific API key has permission to execute a capability.
 * WHY: We need fine-grained control over what agents can do (e.g. read-only vs destructive).
 */

import { AgentKeyRecord } from './key-manager.js';
import { Capability } from '../../engine/inferrer/capability-map.js';

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates if the given key record contains a scope that grants access to the capability.
 */
export function checkPermission(record: AgentKeyRecord, capability: Capability): ScopeCheckResult {
  if (record.revoked) {
    return { allowed: false, reason: 'Key is revoked.' };
  }

  if (new Date() > new Date(record.expiresAt)) {
    return { allowed: false, reason: 'Key is expired.' };
  }

  const requiredId = capability.id; // e.g. "deals.create"
  const category = capability.category; // e.g. "deals"
  const risk = capability.riskLevel; // "safe", "moderate", "destructive"

  // Check scopes
  let hasScope = false;
  for (const scope of record.scopes) {
    if (scope === '*') {
      hasScope = true;
      break;
    }
    
    // Wildcard category matching (e.g. "deals.*")
    if (scope.endsWith('.*')) {
      const scopeCategory = scope.split('.')[0];
      if (scopeCategory === category) {
        hasScope = true;
        break;
      }
    }

    // Risk-based scopes (e.g. "risk:safe")
    if (scope.startsWith('risk:')) {
      const scopeRisk = scope.split(':')[1];
      if (scopeRisk === risk) {
        hasScope = true;
        break;
      }
    }

    // Exact match
    if (scope === requiredId) {
      hasScope = true;
      break;
    }
  }

  if (!hasScope) {
    return { 
      allowed: false, 
      reason: `Key scopes [${record.scopes.join(', ')}] do not permit access to capability '${requiredId}'.` 
    };
  }

  return { allowed: true };
}
