/**
 * executor-content.js — Universal DOM Action Engine
 * 
 * Phase 8A: Bulletproof Element Finder (Shadow DOM, iframes, visibility, retry loops)
 * Phase 8B: New Action Types (hover, pressKey, selectOption, checkBox, etc.)
 * Phase 8E: Password & Credentials Handling
 */

// We attach to window so background.js can call it via executeScript without message passing
window.AgentBridgeExecutor = (function() {
  
  async function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
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
      
      // 5. Raw CSS
      try { 
        el = querySelectorAllDeep(tgt).find(isVisibleAndEnabled); 
        if (el) return el;
      } catch {}
    }
    return null;
  }

  // Retry loop for SPA dynamic rendering
  async function findEl(target, preferRole, retries = 6, delay = 500) {
    for (let i = 0; i < retries; i++) {
      const el = findElSync(target, preferRole);
      if (el) return el;
      await wait(delay);
    }
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
      el.click();
      await wait(800);
      return { clicked: target };
    }
    return { clickFailed: target };
  }

  async function performFill(target, value) {
    const el = await findEl(target, 'input');
    if (el) {
      await scrollTo(el);
      el.focus();
      
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
      if (action.type === 'wait') {
        await wait(action.ms || 500);
      } else if (action.type === 'click') {
        lastResult = await performClick(action.target);
      } else if (action.type === 'fill') {
        lastResult = await performFill(action.target, action.value);
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
      } else if (action.type === 'submit') {
        const form = document.querySelector('form');
        if (form) { form.submit(); await wait(800); }
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
