/**
 * registration.ts
 * Programmatic registration endpoint logic for agents.
 * WHY: Zero-human setup. Agents hit POST /auth/register, pass tests, get API key.
 */

import { generateKey, GeneratedKey } from './key-manager.js';

export interface RegistrationRequest {
  agentName: string;
  requestedScopes?: string[];
  ownerEmail?: string;
}

export interface RegistrationResponse {
  success: boolean;
  message?: string;
  key?: string;
  keyId?: string;
  scopes?: string[];
  expiresAt?: string;
}

// Simple in-memory rate limiting for MVP
// In prod, use Redis
const rateLimits: Record<string, { count: number; windowStart: number }> = {};
const MAX_REGS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(ipAddress: string): boolean {
  const now = Date.now();
  const record = rateLimits[ipAddress];

  if (!record) {
    rateLimits[ipAddress] = { count: 1, windowStart: now };
    return true;
  }

  if (now - record.windowStart > HOUR_MS) {
    // Reset window
    rateLimits[ipAddress] = { count: 1, windowStart: now };
    return true;
  }

  if (record.count >= MAX_REGS_PER_HOUR) {
    return false;
  }

  record.count++;
  return true;
}

/**
 * Handle a registration request from an agent.
 */
export function registerAgent(
  req: RegistrationRequest,
  clientIp: string
): RegistrationResponse {
  // 1. Input Validation (Protection against basic injections/abuse)
  if (!req.agentName || typeof req.agentName !== 'string' || req.agentName.trim().length === 0) {
    return { success: false, message: 'Invalid agentName' };
  }
  
  if (req.agentName.length > 100) {
    return { success: false, message: 'agentName too long' };
  }

  // 2. Rate Limiting
  if (!checkRateLimit(clientIp)) {
    return { success: false, message: 'Rate limit exceeded: Too many registrations from this IP' };
  }

  // 3. Scope assignment logic
  // By default, we grant risk:safe. Destructive requires explicit approval in a real app.
  // For this engine demo, we just accept requested scopes but filter them.
  let grantedScopes = ['risk:safe'];
  if (req.requestedScopes && Array.isArray(req.requestedScopes)) {
    // Only allow requested scopes if they don't ask for wildcard or destructive directly
    const safeRequests = req.requestedScopes.filter(s => s !== '*' && s !== 'risk:destructive');
    if (safeRequests.length > 0) {
      grantedScopes = safeRequests;
    }
  }

  // 4. Key Generation
  const result: GeneratedKey = generateKey(req.agentName.trim(), grantedScopes, 30);

  // 5. Audit Logging (simulated)
  console.log(`[AUDIT] Agent Registered: ${result.record.id} | IP: ${clientIp} | Scopes: ${grantedScopes.join(', ')}`);

  return {
    success: true,
    key: result.key,
    keyId: result.record.id,
    scopes: result.record.scopes,
    expiresAt: result.record.expiresAt,
  };
}
