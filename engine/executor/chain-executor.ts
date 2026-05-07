/**
 * engine/executor/chain-executor.ts — Module 10: Workflow Chain Executor
 *
 * WHY: Sequentially executes a multi-step WorkflowChain, passing shared context
 * between steps. If any step fails, it reports the failure with full context
 * so the user knows exactly which step broke.
 */

import { WorkflowChain, ChainContext, resolveStepParams, mergeToContext } from './workflow-chain.js';

export interface ChainExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  context: ChainContext;
  failedStep?: string;
  errorMessage?: string;
}

/**
 * Executes a workflow chain by calling /api/execute for each step sequentially.
 * WHY: Re-uses the existing executor infrastructure — no new execution engine needed.
 */
export async function executeChain(
  chain: WorkflowChain,
  companionUrl = 'http://localhost:3001'
): Promise<ChainExecutionResult> {
  let context: ChainContext = {};
  let completedSteps = 0;

  console.log(`[ChainExecutor] Starting chain: "${chain.name}" (${chain.steps.length} steps)`);

  for (const step of chain.steps) {
    const resolvedParams = resolveStepParams(step, context);
    console.log(`[ChainExecutor] Step ${completedSteps + 1}/${chain.steps.length}: "${step.name}" on ${step.site}`);

    try {
      const response = await fetch(`${companionUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: { id: step.capabilityId, name: step.name },
          params: resolvedParams,
          targetUrl: step.targetUrl,
          actions: [], // Let the executor build the sequence from capabilityId
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ errorMessage: `HTTP ${response.status}` }));
        throw new Error(err.errorMessage || `Step failed with HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result?.success === false) {
        throw new Error(result.errorMessage || 'Step returned failure');
      }

      // Merge step output into shared context for subsequent steps
      if (result?.data && typeof result.data === 'object') {
        context = mergeToContext(context, result.data as Record<string, unknown>);
      }

      completedSteps++;
      console.log(`[ChainExecutor] ✅ Step ${completedSteps} completed`);

    } catch (err: any) {
      console.error(`[ChainExecutor] ❌ Step "${step.name}" failed:`, err.message);
      return {
        success: false,
        completedSteps,
        totalSteps: chain.steps.length,
        context,
        failedStep: step.name,
        errorMessage: err.message,
      };
    }
  }

  console.log(`[ChainExecutor] ✅ Chain "${chain.name}" completed all ${completedSteps} steps`);
  return {
    success: true,
    completedSteps,
    totalSteps: chain.steps.length,
    context,
  };
}
