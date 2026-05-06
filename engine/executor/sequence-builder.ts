/**
 * sequence-builder.ts
 * WHY: Translates a capability + params into an ordered list of DOM actions.
 * Phase 8C: Smart Sequence Builder (Intent-Based).
 * Generates robust action sequences for Login, Create, Delete, Search, and read-only.
 */

import { Capability, CapabilityMap } from '../inferrer/capability-map.js';

export interface DOMAction {
  type: 'navigate' | 'click' | 'fill' | 'selectOption' | 'checkBox' | 'hover' | 'pressKey' | 'waitForElement' | 'read' | 'submit' | 'wait' | 'findAndNavigate';
  target?: string;
  value?: string;
  ms?: number;
}

export interface ActionSequence {
  actions: DOMAction[];
  confirmationHints: string[];
  targetUrl: string;
}

// ─── Intent Detectors ────────────────────────────────────────────────────────

function isLoginCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /login|sign in|auth|authenticate|log in|signin/.test(name);
}

function isCreateCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /create|add|new|insert|post|publish/.test(name);
}

function isUpdateCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /update|edit|modify|patch|put|save/.test(name);
}

function isDeleteCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /delete|remove|destroy|trash|clear/.test(name);
}

function isSearchCapability(cap: Capability): boolean {
  const name = (cap.name + ' ' + cap.id).toLowerCase();
  return /search|find|query|lookup/.test(name);
}

function isWriteCapability(cap: Capability): boolean {
  return isCreateCapability(cap) || isUpdateCapability(cap) || isDeleteCapability(cap) || isLoginCapability(cap);
}

// ─── Google Calendar Specific ────────────────────────────────────────────────

function buildGoogleCalendarCreateUrl(params: Record<string, unknown>): string {
  const title = encodeURIComponent(String(params.title || params.name || ''));
  const desc = encodeURIComponent(String(params.description || ''));

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

// ─── Intent URL Resolver (Phase 9B) ──────────────────────────────────────────

function resolveUrl(capability: Capability, capMap: CapabilityMap | undefined, baseUrl: string): string {
  const intentLow = (capability.name + ' ' + capability.id).toLowerCase();
  
  // 1. Check if we have a siteNavMap
  if (capMap?.siteNavMap) {
    for (const [intentKey, mappedUrl] of Object.entries(capMap.siteNavMap)) {
      if (intentLow.includes(intentKey)) {
        // If mappedUrl is absolute
        if (mappedUrl.startsWith('http')) return mappedUrl;
        // If mappedUrl is relative, join it
        try { return new URL(mappedUrl, baseUrl).href; } catch { return baseUrl; }
      }
    }
  }
  
  // 2. Fall back to capability's sourceLocation
  if (capability.sourceLocation) {
    const loc = capability.sourceLocation.trim();
    if (loc.startsWith('http')) return loc;
    try { return new URL(loc, baseUrl).href; } catch { return `${baseUrl}${loc}`; }
  }
  
  // 3. Fall back to baseUrl
  return baseUrl;
}

// ─── Main Builder ────────────────────────────────────────────────────────────

export function buildActionSequence(
  capability: Capability,
  params: Record<string, unknown>,
  baseUrl: string,
  capabilityMap?: CapabilityMap
): ActionSequence {
  const actions: DOMAction[] = [];
  const confirmationHints: string[] = [];
  const capId = capability.id.toLowerCase();
  const capName = capability.name.toLowerCase();

  // 1. Google Calendar Fast Path
  if (baseUrl.includes('calendar.google.com') && isCreateCapability(capability)) {
    const createUrl = buildGoogleCalendarCreateUrl(params);
    actions.push({ type: 'navigate', target: createUrl });
    actions.push({ type: 'waitForElement', target: 'Save', value: '10000' });
    actions.push({ type: 'click', target: 'Save' });
    actions.push({ type: 'wait', ms: 1500 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('saved', 'created', 'success');
    return { actions, confirmationHints, targetUrl: createUrl };
  }

  // Phase 9B: Smart URL Discovery
  const targetUrl = resolveUrl(capability, capabilityMap, baseUrl);

  actions.push({ type: 'navigate', target: targetUrl });
  
  if (targetUrl === baseUrl) {
    const intent = capability.name.split(' ')[0] || capability.id;
    actions.push({ type: 'findAndNavigate', target: intent });
  }
  
  // Helper to fill parameters safely
  const pushParamFills = () => {
    for (const param of capability.parameters) {
      const value = params[param.name];
      if (value === undefined || value === null) continue;
      
      const fieldTarget = param.description || param.name;
      actions.push({ type: 'waitForElement', target: fieldTarget, value: '3000' });
      
      if (param.type === 'boolean') {
        actions.push({ type: 'checkBox', target: fieldTarget, value: String(value) });
      } else if ((param.enum && param.enum.length > 0) || fieldTarget.toLowerCase().includes('select') || fieldTarget.toLowerCase().includes('dropdown') || fieldTarget.toLowerCase().includes('country')) {
        actions.push({ type: 'selectOption', target: fieldTarget, value: String(value) });
      } else {
        actions.push({ type: 'fill', target: fieldTarget, value: String(value) });
      }
    }
  };

  // 2. Intent-Based Routing
  
  if (isLoginCapability(capability)) {
    pushParamFills();
    actions.push({ type: 'click', target: 'Log in|Login|Sign in|Continue|Submit|Next' });
    actions.push({ type: 'wait', ms: 2000 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('logged in', 'dashboard', 'success', 'welcome');

  } else if (isDeleteCapability(capability)) {
    // Navigate, maybe search, click target, click delete, click confirm
    // We assume the target element is passed in params.id or params.name
    const targetName = params.id || params.name || params.target;
    if (targetName) {
      actions.push({ type: 'waitForElement', target: String(targetName), value: '5000' });
      actions.push({ type: 'click', target: String(targetName) });
      actions.push({ type: 'wait', ms: 500 });
    }
    actions.push({ type: 'click', target: 'Delete|Remove|Trash|Clear' });
    actions.push({ type: 'wait', ms: 500 });
    actions.push({ type: 'click', target: 'Confirm|Yes|OK|Delete' });
    actions.push({ type: 'wait', ms: 1000 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('deleted', 'removed', 'success');

  } else if (isCreateCapability(capability) || isUpdateCapability(capability) || capability.sourceType === 'form') {
    pushParamFills();
    actions.push({ type: 'wait', ms: 300 });
    const capAction = capability.name.split(' ')[0]; // e.g. "Create"
    actions.push({ type: 'click', target: [capAction, 'Save', 'Submit', 'Create', 'Add', 'Update', 'Done', 'Next'].join('|') });
    actions.push({ type: 'wait', ms: 1500 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('saved', 'created', 'updated', 'success');

  } else if (isSearchCapability(capability)) {
    pushParamFills();
    // Sometimes search is triggered by Enter
    actions.push({ type: 'pressKey', target: 'Enter' });
    // Also try clicking search button just in case
    actions.push({ type: 'click', target: 'Search|Find|Go' });
    actions.push({ type: 'wait', ms: 1500 });
    actions.push({ type: 'read', target: 'page' });
    confirmationHints.push('results', 'found');

  } else if (capability.sourceType === 'button') {
    actions.push({ type: 'waitForElement', target: capability.name, value: '5000' });
    actions.push({ type: 'click', target: capability.name });
    actions.push({ type: 'wait', ms: 1000 });
    actions.push({ type: 'read', target: 'page' });

  } else {
    // Safe read-only: wait for basic hydration, then read page
    actions.push({ type: 'wait', ms: 1500 });
    actions.push({ type: 'read', target: 'page' });
  }

  return { actions, confirmationHints, targetUrl };
}
