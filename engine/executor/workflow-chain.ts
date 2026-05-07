/**
 * engine/executor/workflow-chain.ts — Module 10: Cross-Site Orchestration
 *
 * WHY: Defines the schema and executor for multi-step, cross-site workflows.
 * Each step's output is mapped into the next step's input parameters,
 * enabling powerful automation chains like:
 * "Read Gmail → Extract invoice → Fill Quickbooks → Notify Slack"
 */

export interface ChainStep {
  id: string;
  name: string;
  site: string;          // e.g., "gmail.com"
  targetUrl: string;     // e.g., "https://mail.google.com"
  capabilityId: string;
  params: Record<string, unknown>;
  // Maps output keys from previous step to input param keys for this step
  // e.g., { "invoice_number": "fill_value" } means: use previous step's "invoice_number" output as "fill_value" param here
  paramMapping?: Record<string, string>;
}

export interface WorkflowChain {
  id: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  createdAt: string;
}

// Shared context that accumulates outputs across steps
export type ChainContext = Record<string, unknown>;

/**
 * Resolves a step's params by merging in mapped outputs from the shared context.
 * WHY: This allows dynamic data flow between steps without hardcoding values.
 */
export function resolveStepParams(
  step: ChainStep,
  context: ChainContext
): Record<string, unknown> {
  const resolved = { ...step.params };

  if (step.paramMapping) {
    for (const [contextKey, paramKey] of Object.entries(step.paramMapping)) {
      if (context[contextKey] !== undefined) {
        resolved[paramKey] = context[contextKey];
      }
    }
  }

  return resolved;
}

/**
 * Merges step result data into the shared context for use by subsequent steps.
 */
export function mergeToContext(context: ChainContext, result: Record<string, unknown>): ChainContext {
  return { ...context, ...result };
}
