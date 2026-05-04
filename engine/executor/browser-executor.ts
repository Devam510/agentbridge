/**
 * browser-executor.ts
 * Executes agent commands against real software via browser automation.
 * WHY: When no native API exists, we fall back to deterministic browser execution.
 * Uses mapped selectors from our capability map — NOT fragile vision models.
 */

import { Page } from 'playwright';
import { launchBrowser, BrowserSession } from '../crawler/browser-launcher.js';
import { fillForm } from './form-filler.js';
import { extractResult, ExtractionResult } from './result-extractor.js';
import { executeHybrid } from './hybrid-router.js';
import { Capability, CapabilityMap } from '../inferrer/capability-map.js';

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
  private session: BrowserSession | null = null;
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

  /**
   * Execute a capability via browser automation.
   * Navigates to the source page and interacts with the mapped form/button.
   */
  private async executeBrowser(
    capability: Capability,
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; data: Record<string, unknown>; errorMessage?: string }> {
    // Get or create a browser session
    if (!this.session) {
      this.session = await launchBrowser({ headless: true, timeout: 30000 });
    }

    const page: Page = this.session.page;

    try {
      // Navigate to the capability's source location
      const targetPage = capability.sourceLocation.startsWith('http')
        ? capability.sourceLocation
        : `${this.targetUrl}${capability.sourceLocation}`;

      await page.goto(targetPage, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(500);

      let result: ExtractionResult;

      if (capability.sourceType === 'form') {
        // Build a synthetic form definition from the capability
        const syntheticForm = {
          id: capability.id,
          action: targetPage,
          method: 'POST' as const,
          purpose: 'create' as const,
          fields: capability.parameters.map((p) => ({
            name: p.name,
            label: p.description,
            type: p.type === 'number' ? 'number' : p.type === 'boolean' ? 'checkbox' : 'text',
            placeholder: '',
            required: p.required,
            options: p.enum,
          })),
          submitButtonText: 'Submit',
        };

        const fillResult = await fillForm(page, {
          form: syntheticForm,
          data: params as Record<string, string | number | boolean>,
          submit: true,
        });

        result = await extractResult(page);

        if (!fillResult.success) {
          return { success: false, data: {}, errorMessage: fillResult.errorMessage };
        }
      } else if (capability.sourceType === 'button') {
        // Click the action button
        const buttonSelector = `button:has-text("${capability.name.slice(0, 30)}")`;
        await page.locator(buttonSelector).first().click({ timeout: 5000 });
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
        result = await extractResult(page);
      } else {
        // 'api' or 'inferred' — navigate and extract
        result = await extractResult(page);
      }

      return { success: result.success, data: result.data };
    } catch (err) {
      return {
        success: false,
        data: {},
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    // Note: session stays open for reuse across multiple executions
    // Call cleanup() when done with the executor
  }

  /**
   * Clean up browser resources.
   * Call this when the executor is no longer needed.
   */
  async cleanup(): Promise<void> {
    if (this.session) {
      await this.session.close();
      this.session = null;
    }
  }
}
