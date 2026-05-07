/**
 * browser-executor.ts
 * Executes agent commands against real software via browser automation.
 * WHY: Phase 7 — routes to Chrome Extension via Companion App instead of local Playwright.
 * This allows execution in the user's real authenticated browser session.
 */

import { executeHybrid } from './hybrid-router.js';
import { Capability, CapabilityMap } from '../inferrer/capability-map.js';
import { buildActionSequence } from './sequence-builder.js';
import { recordSuccess, queryGraph } from '../routing-graph/agentic-router.js';

export interface ExecuteOptions {
  capabilityId: string;
  params: Record<string, unknown>;
  riskLevel: 'safe' | 'moderate' | 'destructive';
}

export interface ExecuteResult {
  success: boolean;
  data: Record<string, unknown>;
  capabilityId: string;
  executionPath: 'api' | 'browser' | 'error';
  latencyMs: number;
  errorMessage?: string;
}

/**
 * BridgeExecutor handles executing any capability against the target software.
 * This is the runtime engine that the generated MCP server uses.
 */
export class BridgeExecutor {
  private targetUrl: string;
  private capabilityMap: CapabilityMap;

  private apiCredentials?: Record<string, string>;

  constructor(options: { targetUrl: string; capabilityMap: CapabilityMap; apiCredentials?: Record<string, string> }) {
    this.targetUrl = options.targetUrl;
    this.capabilityMap = options.capabilityMap;
    this.apiCredentials = options.apiCredentials;
  }

  /**
   * Execute a capability by ID with the given params.
   * Automatically picks the best execution path.
   */
  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    const start = Date.now();
    const { capabilityId, params } = options;

    // Find the capability in our map
    const capability = this.capabilityMap.capabilities.find((c) => c.id === capabilityId);
    if (!capability) {
      return {
        success: false,
        data: {},
        capabilityId,
        executionPath: 'error',
        latencyMs: Date.now() - start,
        errorMessage: `Capability not found: ${capabilityId}`,
      };
    }

    // Validate params against capability definition
    const paramError = this.validateParams(capability, params);
    if (paramError) {
      return {
        success: false,
        data: {},
        capabilityId,
        executionPath: 'error',
        latencyMs: Date.now() - start,
        errorMessage: `Invalid params: ${paramError}`,
      };
    }

    // Execute via hybrid router (API -> Browser fallback)
    try {
      const result = await executeHybrid({
        capability,
        params,
        targetUrl: this.targetUrl,
        apiCredentials: this.apiCredentials,
        browserExecutorFn: this.executeBrowser.bind(this),
      });

      return {
        ...result,
        capabilityId,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        data: {},
        capabilityId,
        executionPath: 'error',
        latencyMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Validate that required params are present and correctly typed.
   */
  private validateParams(
    capability: Capability,
    params: Record<string, unknown>,
  ): string | null {
    for (const param of capability.parameters) {
      if (param.required && !(param.name in params)) {
        return `Missing required parameter: ${param.name}`;
      }

      const value = params[param.name];
      if (value === undefined) continue;

      // Type check
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== param.type && param.type !== 'object') {
        return `Parameter "${param.name}" should be ${param.type}, got ${actualType}`;
      }

      // Enum check
      if (param.enum && !param.enum.includes(String(value))) {
        return `Parameter "${param.name}" must be one of: ${param.enum.join(', ')}`;
      }
    }
    return null;
  }

  private async executeBrowser(
    capability: Capability,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; data: Record<string, unknown>; errorMessage?: string }> {
    try {
      // Phase 7: Build a structured action sequence and send it to the Chrome Extension
      const sequence = buildActionSequence(capability, params, this.targetUrl, this.capabilityMap);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000); // 50s timeout

      const response = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability,
          params,
          targetUrl: this.targetUrl,
          actions: sequence.actions,
          confirmationHints: sequence.confirmationHints,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.errorMessage || `Extension bridge returned ${response.status}`);
      }

      const result = await response.json();

      // Module 6: If successful, record to the Agentic Routing Graph
      if (result?.success !== false) {
        try {
          const domain = new URL(this.targetUrl).hostname.replace(/^www\./, '');
          recordSuccess(capability.name, domain, sequence.actions);
        } catch { /* non-critical */ }
      }

      return result;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          success: false,
          data: {},
          errorMessage: 'The AgentBridge Chrome Extension did not respond in time. Make sure the extension is installed, your browser is open, and you are logged into the website.',
        };
      }
      return {
        success: false,
        data: {},
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Clean up browser resources.
   * Call this when the executor is no longer needed.
   */
  async cleanup(): Promise<void> {
    // No local browser resources — extension handles cleanup
  }
}
