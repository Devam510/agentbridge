/**
 * executor-content.js — Universal DOM Action Engine
 * WHY: Injected into any page to perform read/write/click/fill actions on behalf of Claude.
 * Works on ANY website without site-specific code.
 */

// Listen for action commands from the background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXECUTE_ACTION') {
    executeAction(message.action)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }

  if (message.type === 'EXECUTE_SEQUENCE') {
    executeSequence(message.actions)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * Execute a sequence of DOM actions in order.
 * Returns the result of the last action.
 */
async function executeSequence(actions) {
  let lastResult = null;
  for (const action of actions) {
    lastResult = await executeAction(action);
  }
  return lastResult;
}

/**
 * Execute a single DOM action.
 * action = { type, target, value }
 */
async function executeAction(action) {
  switch (action.type) {
    case 'click':    return performClick(action.target);
    case 'fill':     return performFill(action.target, action.value);
    case 'select':   return performSelect(action.target, action.value);
    case 'read':     return performRead(action.target);
    case 'navigate': return performNavigate(action.target);
    case 'submit':   return performSubmit(action.target);
    case 'wait':     return performWait(action.ms || 1000);
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

// ─── SMART ELEMENT FINDER ────────────────────────────────────────────────────
// Uses a fallback chain to find elements on ANY website

function findElement(target, role) {
  if (!target) return null;
  const t = target.toLowerCase().trim();

  // Strategy 1: ARIA label exact or partial match
  let el = document.querySelector(`[aria-label="${target}"]`)
    || document.querySelector(`[aria-label*="${t}"]`);
  if (el) return el;

  // Strategy 2: Button/link by visible text content
  if (!role || role === 'button' || role === 'link') {
    const buttons = [...document.querySelectorAll('button, [role="button"], a')];
    el = buttons.find(b => b.textContent.trim().toLowerCase().includes(t));
    if (el) return el;
  }

  // Strategy 3: Input by its associated <label> text
  if (!role || role === 'input') {
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(l => l.textContent.trim().toLowerCase().includes(t));
    if (label && label.htmlFor) {
      el = document.getElementById(label.htmlFor);
      if (el) return el;
    }
    // Label wrapping an input
    if (label) {
      el = label.querySelector('input, textarea, select');
      if (el) return el;
    }
  }

  // Strategy 4: Input by placeholder text
  if (!role || role === 'input') {
    el = document.querySelector(`input[placeholder*="${t}"]`)
      || document.querySelector(`textarea[placeholder*="${t}"]`);
    if (el) return el;
  }

  // Strategy 5: Input by name attribute
  el = document.querySelector(`input[name="${target}"]`)
    || document.querySelector(`input[name*="${t}"]`);
  if (el) return el;

  // Strategy 6: Raw CSS selector (last resort)
  try { el = document.querySelector(target); } catch {}
  return el;
}

// ─── ACTION IMPLEMENTATIONS ──────────────────────────────────────────────────

async function performClick(target) {
  // Support pipe-separated fallback list: "Save|Submit|Create"
  const targets = (target || '').split('|').map(t => t.trim()).filter(Boolean);
  for (const t of targets) {
    const el = findElement(t, 'button');
    if (el) {
      el.click();
      await new Promise(r => setTimeout(r, 500));
      return { clicked: t, pageTitle: document.title, url: window.location.href };
    }
  }
  throw new Error(`Click target not found: "${target}"`);
}

async function performFill(target, value) {
  const el = findElement(target, 'input');
  if (!el) throw new Error(`Input field not found: "${target}"`);
  el.focus();
  el.value = '';
  // Use native input events so React/Vue/Angular frameworks detect the change
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { filled: target, value };
}

async function performSelect(target, value) {
  const el = findElement(target, 'input');
  if (!el) throw new Error(`Select/dropdown not found: "${target}"`);
  if (el.tagName === 'SELECT') {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Handle custom dropdowns: click to open, then click the option
    el.click();
    await new Promise(r => setTimeout(r, 300));
    const options = [...document.querySelectorAll('[role="option"], li, .option')];
    const option = options.find(o => o.textContent.trim().toLowerCase().includes(value.toLowerCase()));
    if (option) option.click();
  }
  return { selected: target, value };
}

function performRead(target) {
  if (!target || target === 'page' || target === 'all') {
    // Read the whole page content
    return {
      title: document.title,
      url: window.location.href,
      content: document.body.innerText.substring(0, 8000),
      headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()),
    };
  }
  // Read a specific element
  const el = findElement(target);
  if (!el) throw new Error(`Read target not found: "${target}"`);
  return {
    text: el.innerText || el.textContent,
    html: el.innerHTML.substring(0, 2000),
    url: window.location.href,
  };
}

async function performNavigate(url) {
  window.location.href = url;
  return { navigated: url };
}

async function performSubmit(target) {
  let form = null;
  if (target) {
    form = findElement(target);
    if (!form) form = document.querySelector('form');
  } else {
    form = document.querySelector('form');
  }
  if (!form) throw new Error('No form found to submit');
  form.submit();
  return { submitted: true };
}

function performWait(ms) {
  return new Promise(r => setTimeout(r, ms));
}
