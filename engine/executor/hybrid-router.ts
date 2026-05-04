/**
 * hybrid-router.ts
 * Intelligently routes executions between API and Browser automation.
 * Implements the fallback chain: API -> Browser -> Escalate.
 * WHY: This provides the "best of both worlds" — speed of API, fallback reliability of browser.
 */

import { Capability } from '../inferrer/capability-map.js';
import { executeApi, ApiExecuteResult } from './api-executor.js';

export interface RouteDecision {
  primaryPath: 'api' | 'browser';
  fallbackAllowed: boolean;
  reason: string;
}

export interface HybridExecutionOptions {
  capability: Capability;
  params: Record<string, unknown>;
  targetUrl: string;
  apiCredentials?: Record<string, string>;
  // The browser execution function to call if we route to browser
  browserExecutorFn: (cap: Capability, p: Record<string, unknown>) => Promise<{ success: boolean; data: Record<string, unknown>; errorMessage?: string }>;
  // Callback to log routing decisions for audit
  onRouteDecision?: (decision: RouteDecision) => void;
}

export interface HybridExecutionResult {
  success: boolean;
  data: Record<string, unknown>;
  executionPath: 'api' | 'browser' | 'error';
  errorMessage?: string;
  fallbackUsed: boolean;
}

/**
 * Determine the primary execution path based on capability metadata.
 */
export function determineRoute(capability: Capability): RouteDecision {
  if (capability.sourceType === 'api') {
    return { primaryPath: 'api', fallbackAllowed: true, reason: 'Capability explicitly marked as API' };
  }
  
  // If we know it's a form or button, browser is the primary path.
  // We don't want to blindly guess an API endpoint if we know it's a UI element,
  // though in an advanced version we might try to sniff the API calls the form makes.
  if (capability.sourceType === 'form' || capability.sourceType === 'button') {
    return { primaryPath: 'browser', fallbackAllowed: false, reason: 'UI element mapped (form/button)' };
  }

  // If inferred, we can try API first if the path looks like an API
  if (capability.sourceLocation.includes('/api/') || capability.sourceLocation.includes('/v1/')) {
    return { primaryPath: 'api', fallbackAllowed: true, reason: 'Inferred endpoint looks like API path' };
  }

  return { primaryPath: 'browser', fallbackAllowed: false, reason: 'Default fallback to browser' };
}

/**
 * Execute using the Hybrid Execution Engine (API with Browser fallback).
 */
export async function executeHybrid(options: HybridExecutionOptions): Promise<HybridExecutionResult> {
  const decision = determineRoute(options.capability);
  
  if (options.onRouteDecision) {
    options.onRouteDecision(decision);
  }

  if (decision.primaryPath === 'api') {
    // Try API
    const apiResult = await executeApi({
      capability: options.capability,
      params: options.params,
      targetUrl: options.targetUrl,
      apiCredentials: options.apiCredentials,
    });

    if (apiResult.success) {
      return {
        ...apiResult,
        executionPath: 'api',
        fallbackUsed: false,
      };
    }

    // API Failed. Should we fallback?
    // Don't fallback on 401/403 (auth errors) or 400 (bad request), as browser will likely fail too.
    const isAuthError = apiResult.statusCode === 401 || apiResult.statusCode === 403;
    const isBadRequest = apiResult.statusCode === 400;
    
    if (decision.fallbackAllowed && !isAuthError && !isBadRequest) {
      if (options.onRouteDecision) {
        options.onRouteDecision({
          primaryPath: 'browser',
          fallbackAllowed: false,
          reason: `API execution failed (${apiResult.statusCode}). Falling back to Browser.`,
        });
      }
      
      const browserResult = await options.browserExecutorFn(options.capability, options.params);
      return {
        ...browserResult,
        executionPath: 'browser',
        fallbackUsed: true,
      };
    }

    // No fallback, or fallback prevented
    return {
      success: false,
      data: {},
      executionPath: 'api',
      errorMessage: apiResult.errorMessage,
      fallbackUsed: false,
    };
  }

  // Primary path is browser
  const browserResult = await options.browserExecutorFn(options.capability, options.params);
  return {
    ...browserResult,
    executionPath: 'browser',
    fallbackUsed: false,
  };
}
