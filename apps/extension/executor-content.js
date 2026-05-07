/**
 * executor-content.js — Universal DOM Action Engine
 *
 * Phase 8A: Bulletproof Element Finder (Shadow DOM, iframes, visibility, retry loops)
 * Phase 8B: New Action Types (hover, pressKey, selectOption, checkBox, etc.)
 * Phase 8E: Password & Credentials Handling
 * Phase 12: Module 11 Telemetry, Module 13 Auto-Login
 */

// We attach to window so background.js can call it via executeScript without message passing
window.AgentBridgeExecutor = (function() {
  
  async function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Module 11: Telemetry — emit step events to the Live Dashboard
  async function emitTelemetry(type, target, status) {
    try {
      await fetch('http://localhost:3001/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, target, status,
          url: window.location.href,
          timestamp: Date.now(),
        }),
      });
    } catch { /* telemetry is non-critical */ }
  }

  // Module 13: Auto-Login — fetch credentials from vault and fill login form
  async function performLogin(site) {
    try {
      const res = await fetch(`http://localhost:3001/api/vault/get?site=${encodeURIComponent(site)}`);
      if (!res.ok) return { loginFailed: `No credentials stored for ${site}` };
      const { username, password } = await res.json();

      // Find and fill username field
      const usernameEl = await findEl('username|email|phone|login', 'input');
      if (usernameEl) {
        await scrollTo(usernameEl);
        usernameEl.focus();
        usernameEl.value = username;
        usernameEl.dispatchEvent(new Event('input', { bubbles: true }));
        usernameEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await wait(300);

      // Find and fill password field
      const passwordInputs = document.querySelectorAll('input[type="password"]');
      const passwordEl = Array.from(passwordInputs).find(el => isVisibleAndEnabled(el));
      if (passwordEl) {
        passwordEl.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(passwordEl, password);
          passwordEl.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          passwordEl.value = password;
        }
      }

      await wait(300);

      // Click submit/sign-in button
      const submitEl = await findEl('sign in|login|log in|continue|submit', 'button');
      if (submitEl) {
        submitEl.click();
        await wait(2000);
      }

      return { loggedIn: site };
    } catch (err) {
      return { loginFailed: err.message };
    }
  }

  // ─── Phase 8A: Bulletproof Element Finder ─────────────────────────────────

  function isVisibleAndEnabled(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  // Recursive shadow DOM search
  function querySelectorAllDeep(selector, root = document) {
    const results = Array.from(root.querySelectorAll(selector));
    const allNodes = Array.from(root.querySelectorAll('*'));
    for (const node of allNodes) {
      if (node.shadowRoot) {
        results.push(...querySelectorAllDeep(selector, node.shadowRoot));
      }
    }
    return results;
  }

  function findElSync(target, preferRole) {
    if (!target) return null;
    const targets = String(target).split('|').map(t => t.trim());
    
    for (const tgt of targets) {
      const tgtLow = tgt.toLowerCase();
      
      // 1. ARIA label
      let elements = querySelectorAllDeep(`[aria-label="${tgt}"]`).concat(querySelectorAllDeep(`[aria-label*="${tgt}"]`));
      let el = elements.find(isVisibleAndEnabled);
      if (el) return el;
      
      // 2. Buttons, roles, links, list items
      const candidates = querySelectorAllDeep('button, [role="button"], [role="menuitem"], [role="tab"], [jsname], input[type="submit"], input[type="button"], a, li');
      el = candidates.find(b => b.textContent.trim().toLowerCase() === tgtLow && isVisibleAndEnabled(b))
        || candidates.find(b => b.textContent.trim().toLowerCase().includes(tgtLow) && isVisibleAndEnabled(b));
      if (el) return el;
      
      // 3. Labels
      const labels = querySelectorAllDeep('label');
      const label = labels.find(l => l.textContent.trim().toLowerCase().includes(tgtLow) && isVisibleAndEnabled(l));
      if (label) {
        if (label.htmlFor) { 
          el = querySelectorAllDeep(`#${label.htmlFor}`).find(isVisibleAndEnabled); 
          if (el) return el; 
        }
        el = Array.from(label.querySelectorAll('input, textarea, select')).find(isVisibleAndEnabled); 
        if (el) return el;
      }
      
      // 4. Inputs
      const inputs = querySelectorAllDeep(`input[placeholder*="${tgt}"], textarea[placeholder*="${tgt}"], input[name="${tgt}"]`);
      el = inputs.find(isVisibleAndEnabled);
      if (el) return el;
      
      // 5. ContentEditables (Phase 9A)
      const editables = querySelectorAllDeep('[contenteditable="true"], [role="textbox"]');
      el = editables.find(e => isVisibleAndEnabled(e) && (
        (e.getAttribute('aria-label') || '').toLowerCase().includes(tgtLow) ||
        (e.getAttribute('aria-placeholder') || '').toLowerCase().includes(tgtLow) ||
        (e.textContent || '').toLowerCase().includes(tgtLow)
      ));
      if (el) return el;
      
      // 6. Raw CSS
      try { 
        el = querySelectorAllDeep(tgt).find(isVisibleAndEnabled); 
        if (el) return el;
      } catch {}
    }
    return null;
  }

  // Phase 10: Auto-scrolling for virtualized lists
  function getScrollableContainers() {
    const containers = [];
    if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
      containers.push(window);
    }
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      if (el.scrollHeight > el.clientHeight) {
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          containers.push(el);
        }
      }
    }
    return containers;
  }

  // Retry loop for SPA dynamic rendering + Auto-scrolling + Self-Healing fallback
  async function findEl(target, preferRole, retries = 8, delay = 600) {
    for (let i = 0; i < retries; i++) {
      const el = findElSync(target, preferRole);
      if (el) return el;
      
      // Phase 10: Active Search Scrolling if not found
      if (i > 0) {
        const scrollables = getScrollableContainers();
        for (const container of scrollables) {
          if (container === window) {
            window.scrollBy({ top: 400, behavior: 'smooth' });
          } else {
            container.scrollBy({ top: 400, behavior: 'smooth' });
          }
        }
      }
      
      await wait(delay);
    }

    // Module 3: Self-Healing — Ask the backend to find a new selector
    try {
      const domain = window.location.hostname.replace(/^www\./, '');
      const domSnapshot = document.body?.innerHTML?.slice(0, 8000) ?? '';
      const healRes = await fetch('http://localhost:3001/api/healer/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: target, domSnapshot, screenshotBase64: '', domain }),
      });
      if (healRes.ok) {
        const { selector } = await healRes.json();
        if (selector && selector !== target) {
          const healed = document.querySelector(selector);
          if (healed && isVisibleAndEnabled(healed)) {
            console.warn(`[AgentBridge] Self-healed: "${target}" → "${selector}"`);
            return healed;
          }
        }
      }
    } catch { /* healing is non-critical */ }

    return null;
  }

  async function scrollTo(el) {
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await wait(300);
    }
  }

  // ─── Phase 8B & 8E: Action Implementations ─────────────────────────────────

  async function performClick(target) {
    const el = await findEl(target, 'button');
    if (el) {
      await scrollTo(el);
      // Module 8: Try synthetic React click first (100x faster for SPAs)
      if (window.__AgentBridgeStateInjector) {
        window.__AgentBridgeStateInjector.syntheticClick(el);
      } else {
        el.click();
      }
      await wait(600);
      return { clicked: target };
    }
    return { clickFailed: target };
  }

  async function performFill(target, value) {
    let el = await findEl(target, 'input');
    
    // Fallback: If target wasn't found by specific match, just find the first visible contenteditable
    if (!el && (target.toLowerCase() === 'message' || target.toLowerCase() === 'chat' || target.toLowerCase() === 'reply')) {
      const editables = querySelectorAllDeep('[contenteditable="true"], [role="textbox"]');
      el = editables.find(isVisibleAndEnabled);
    }
    
    if (el) {
      await scrollTo(el);
      el.focus();
      await wait(100);
      
      if (el.isContentEditable) {
        // Phase 9A: ContentEditable path
        el.textContent = '';
        el.focus();
        document.execCommand('insertText', false, value);
        if (!el.textContent) {
          el.textContent = value;
          el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
      } else {
        // Phase 8E: Native setter bypasses React synthetic events
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, value);
        } else {
          el.value = value;
        }
        
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      }
      
      await wait(200);
      return { filled: target };
    }
    return { fillFailed: target };
  }

  async function performSelectOption(target, value) {
    const el = await findEl(target, 'input');
    if (el) {
      await scrollTo(el);
      if (el.tagName === 'SELECT') {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } else {
        el.click(); // Open custom dropdown
        await wait(500);
        const options = querySelectorAllDeep('[role="option"], li, .option');
        const option = options.find(o => o.textContent.trim().toLowerCase().includes(value.toLowerCase()) && isVisibleAndEnabled(o));
        if (option) {
          await scrollTo(option);
          option.click();
        } else {
          return { selectFailed: `Option ${value} not found` };
        }
      }
      return { selected: value, in: target };
    }
    return { selectFailed: target };
  }

  async function performCheckBox(target, checkedStr) {
    const el = await findEl(target, 'input');
    if (el) {
      await scrollTo(el);
      const shouldBeChecked = checkedStr === 'true' || checkedStr === true;
      if (el.checked !== shouldBeChecked) {
        el.click();
      }
      return { checkBox: target, checked: shouldBeChecked };
    }
    return { checkBoxFailed: target };
  }

  // Phase 9B: Dynamic navigation fallback
  async function performFindAndNavigate(intent) {
    const links = querySelectorAllDeep('a[href], [role="link"]');
    const intentLow = intent.toLowerCase();
    
    // Exact match first
    let match = links.find(l => l.textContent.trim().toLowerCase() === intentLow && isVisibleAndEnabled(l));
    
    // Partial match
    if (!match) {
      match = links.find(l => l.textContent.toLowerCase().includes(intentLow) && isVisibleAndEnabled(l));
    }
    
    if (match) {
      await scrollTo(match);
      match.click();
      await wait(2000);
      return { navigatedVia: 'link', text: match.textContent.trim(), url: window.location.href };
    }
    return { notFound: intent };
  }

  async function performHover(target) {
    const el = await findEl(target);
    if (el) {
      await scrollTo(el);
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(500);
      return { hovered: target };
    }
    return { hoverFailed: target };
  }

  async function performPressKey(key) {
    // Dispatch to active element
    const el = document.activeElement || document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true }));
    await wait(300);
    return { pressedKey: key };
  }

  async function performWaitForElement(target, msStr) {
    const ms = parseInt(msStr) || 5000;
    const retries = Math.ceil(ms / 500);
    const el = await findEl(target, null, retries, 500);
    if (el) return { found: target };
    return { notFound: target };
  }

  function performRead() {
    return {
      title: document.title,
      url: window.location.href,
      content: document.body.innerText.substring(0, 3000),
    };
  }

  // ─── Main Executor Sequence ───────────────────────────────────────────────

  async function executeSequence(actions) {
    let lastResult = { title: document.title, url: window.location.href };

    for (const action of actions) {
      // Module 11: Emit telemetry before each action so Live Dashboard shows progress
      emitTelemetry(action.type, action.target || '', 'running');

      if (action.type === 'wait') {
        await wait(action.ms || 500);
      } else if (action.type === 'click') {
        lastResult = await performClick(action.target);
        emitTelemetry('click', action.target, lastResult.clickFailed ? 'error' : 'success');
      } else if (action.type === 'fill') {
        lastResult = await performFill(action.target, action.value);
        emitTelemetry('fill', action.target, 'success');
      } else if (action.type === 'login') {
        // Module 13: Auto-login using credentials from the Credential Vault
        lastResult = await performLogin(action.target);
        emitTelemetry('login', action.target, lastResult.loginFailed ? 'error' : 'success');
      } else if (action.type === 'selectOption') {
        lastResult = await performSelectOption(action.target, action.value);
      } else if (action.type === 'checkBox') {
        lastResult = await performCheckBox(action.target, action.value);
      } else if (action.type === 'hover') {
        lastResult = await performHover(action.target);
      } else if (action.type === 'pressKey') {
        lastResult = await performPressKey(action.target);
      } else if (action.type === 'waitForElement') {
        lastResult = await performWaitForElement(action.target, action.value);
      } else if (action.type === 'findAndNavigate') {
        lastResult = await performFindAndNavigate(action.target);
      } else if (action.type === 'submit') {
        const form = document.querySelector('form');
        if (form) { form.submit(); await wait(800); }
        emitTelemetry('submit', 'form', 'success');
      } else if (action.type === 'read') {
        lastResult = performRead();
      }
      
      // Append current context
      lastResult.title = document.title;
      lastResult.url = window.location.href;
    }
    return lastResult;
  }

  return { executeSequence };
})();
