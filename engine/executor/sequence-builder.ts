/**
 * sequence-builder.ts
 * WHY: Translates a capability + params from Claude into an ordered list of DOM actions
 * that the Chrome Extension's executor-content.js can execute on any website.
 * This makes the system truly universal — no site-specific code needed.
 */

import { Capability } from '../inferrer/capability-map.js';

export interface DOMAction {
  type: 'navigate' | 'click' | 'fill' | 'select' | 'read' | 'submit' | 'wait';
  target?: string;
  value?: string;
  ms?: number;
}

export interface ActionSequence {
  actions: DOMAction[];
  confirmationHints: string[];  // What to look for to confirm success
  targetUrl: string;
}

/**
 * Build an ordered sequence of DOM actions for a given capability + params.
 * The sequence is sent to the Chrome Extension for execution.
 */
export function buildActionSequence(
  capability: Capability,
  params: Record<string, unknown>,
  baseUrl: string,
): ActionSequence {
  const actions: DOMAction[] = [];
  const confirmationHints: string[] = [];

  // Step 1: Navigate to the capability's source location
  const targetUrl = capability.sourceLocation.startsWith('http')
    ? capability.sourceLocation
    : `${baseUrl}${capability.sourceLocation}`;

  actions.push({ type: 'navigate', target: targetUrl });
  actions.push({ type: 'wait', ms: 1500 }); // Wait for SPA to hydrate

  if (capability.sourceType === 'form' || capability.sourceType === 'api') {
    // Step 2: Fill each parameter into its corresponding field
    for (const param of capability.parameters) {
      const value = params[param.name];
      if (value === undefined || value === null) continue;

      const stringValue = String(value);

      // Match param name/description to a field on the page
      const fieldTarget = param.description || param.name;

      if (param.type === 'boolean') {
        actions.push({ type: 'click', target: fieldTarget });
      } else {
        actions.push({ type: 'fill', target: fieldTarget, value: stringValue });
      }
    }

    // Step 3: Submit the form
    actions.push({ type: 'wait', ms: 300 });
    actions.push({ type: 'submit', target: undefined });
    confirmationHints.push('saved', 'created', 'added', 'success', 'done');

  } else if (capability.sourceType === 'button') {
    // For button-type capabilities, just click the action button
    actions.push({ type: 'click', target: capability.name });
    confirmationHints.push('deleted', 'removed', 'confirmed', 'success');

  } else {
    // For read/inferred capabilities, just extract page content
    actions.push({ type: 'read', target: 'page' });
  }

  return { actions, confirmationHints, targetUrl };
}
