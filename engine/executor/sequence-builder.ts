/**
 * sequence-builder.ts
 * WHY: Translates a capability + params into an ordered list of DOM actions.
 * Root cause fix: 'inferred' write capabilities were falling through to a read-only path.
 * Now uses intent detection (from capability name) to route correctly.
 * Also supports URL-parameter based creation for well-known services (Google Calendar).
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
  confirmationHints: string[];
  targetUrl: string;
}

// Detects write/mutate intent from capability name or id
function isWriteCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /create|add|update|edit|delete|remove|save|submit|send|post|put|patch/.test(name);
}

// Detects read-only intent
function isReadCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /search|find|get|list|read|fetch|view|show/.test(name);
}

/**
 * Build a URL-parameter based create URL for Google Calendar.
 * WHY: Google Calendar supports event creation via URL params — no form filling needed.
 * This is faster, more reliable, and doesn't depend on DOM structure.
 */
function buildGoogleCalendarCreateUrl(params: Record<string, unknown>): string {
  const title = encodeURIComponent(String(params.title || params.name || ''));
  const desc = encodeURIComponent(String(params.description || ''));

  // Convert ISO strings to Google Calendar date format (YYYYMMDDTHHmmss)
  const toGCalDate = (val: unknown): string => {
    if (!val) return '';
    const d = new Date(String(val));
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace(/[-:]/g, '').replace('.000', '');
  };

  const start = toGCalDate(params.start_time || params.start || params.date);
  const end = toGCalDate(params.end_time || params.end);
  const dates = start && end ? `${start}/${end}` : start ? `${start}/${start}` : '';

  let url = `https://calendar.google.com/calendar/r/eventedit?text=${title}`;
  if (dates) url += `&dates=${dates}`;
  if (desc) url += `&details=${desc}`;
  return url;
}

/**
 * Build an ordered sequence of DOM actions for a given capability + params.
 */
export function buildActionSequence(
  capability: Capability,
  params: Record<string, unknown>,
  baseUrl: string,
): ActionSequence {
  const actions: DOMAction[] = [];
  const confirmationHints: string[] = [];
  const capId = capability.id.toLowerCase();
  const capName = capability.name.toLowerCase();

  // ── Google Calendar: Create Event ─────────────────────────────────────────
  // Use URL-parameter API — no fragile DOM form filling needed
  if (baseUrl.includes('calendar.google.com') && /create/.test(capId + capName)) {
    const createUrl = buildGoogleCalendarCreateUrl(params);
    actions.push({ type: 'navigate', target: createUrl });
    actions.push({ type: 'wait', ms: 2000 });
    // Click "Save" — Google Calendar's save button has aria-label "Save"
    actions.push({ type: 'click', target: 'Save' });
    actions.push({ type: 'wait', ms: 1500 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('saved', 'created', 'success');
    return { actions, confirmationHints, targetUrl: createUrl };
  }

  // ── Navigate to the capability's source location ───────────────────────────
  const targetUrl = (capability.sourceLocation || baseUrl).trim().startsWith('http')
    ? (capability.sourceLocation || baseUrl).trim()
    : `${baseUrl}${capability.sourceLocation}`;

  actions.push({ type: 'navigate', target: targetUrl });
  actions.push({ type: 'wait', ms: 1500 });

  // ── Route by sourceType first, then fall back to intent detection ──────────
  if (capability.sourceType === 'form' || capability.sourceType === 'api') {
    // Fill each parameter into its corresponding form field
    for (const param of capability.parameters) {
      const value = params[param.name];
      if (value === undefined || value === null) continue;
      const fieldTarget = param.description || param.name;
      if (param.type === 'boolean') {
        actions.push({ type: 'click', target: fieldTarget });
      } else {
        actions.push({ type: 'fill', target: fieldTarget, value: String(value) });
      }
    }
    actions.push({ type: 'wait', ms: 300 });
    actions.push({ type: 'submit', target: undefined });
    confirmationHints.push('saved', 'created', 'added', 'success', 'done');

  } else if (capability.sourceType === 'button') {
    actions.push({ type: 'click', target: capability.name });
    confirmationHints.push('deleted', 'removed', 'confirmed', 'success');

  } else if (isWriteCapability(capability)) {
    // WHY: 'inferred' write capabilities were reading the page — this was the root cause bug.
    // Now we detect write intent and try to fill any available form fields.
    for (const param of capability.parameters) {
      const value = params[param.name];
      if (value === undefined || value === null) continue;
      const fieldTarget = param.description || param.name;
      actions.push({ type: 'fill', target: fieldTarget, value: String(value) });
    }
    actions.push({ type: 'wait', ms: 300 });
    // Try clicking a Save/Submit/Create button
    const saveButtonHints = ['Save', 'Submit', 'Create', 'Add', 'Confirm', 'Done'];
    const capAction = capability.name.split(' ')[0]; // e.g. "Create"
    actions.push({ type: 'click', target: [capAction, ...saveButtonHints].join('|') });
    actions.push({ type: 'wait', ms: 1000 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('saved', 'created', 'success', 'done');

  } else {
    // Safe read-only: extract page content
    actions.push({ type: 'read', target: 'page' });
  }

  return { actions, confirmationHints, targetUrl };
}
