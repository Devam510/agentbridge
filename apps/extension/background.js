/**
 * background.js — AgentBridge Extension Service Worker (MV3)
 *
 * KEY ARCHITECTURE FIX:
 *   Navigation (chrome.tabs.update) and DOM actions (executeScript) MUST be separate.
 *   WHY: `window.location.href = url` inside executeScript destroys the script context,
 *   so any actions after a navigate action never execute.
 *   Solution: process actions in the background script sequentially —
 *   navigate/wait in background.js, DOM actions via executeScript.
 */

const API_BASE = 'http://localhost:3001';

// ─── Keep-Alive ───────────────────────────────────────────────────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    pingHealth();
    if (!self.isPolling) pollCompanionApp();
  }
});

// ─── Messages from popup.html ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'BRIDGE_SITE') {
    handleBridgeSite(message.url).then(sendResponse).catch(err =>
      sendResponse({ success: false, error: err.message })
    );
    return true;
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ status: self.agentStatus || 'idle', connected: self.companionConnected || false });
  }
});

async function handleBridgeSite(url) {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const bridgeName = hostname.replace(/\./g, '-');
  const createRes = await fetch(`${API_BASE}/api/bridge/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, bridgeName }),
  });
  if (!createRes.ok) throw new Error(`Bridge generation failed: ${createRes.status}`);
  const { endpoint } = await createRes.json();
  const installRes = await fetch(`${API_BASE}/api/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bridgeName, endpoint }),
  });
  if (!installRes.ok) throw new Error('Config installation failed');
  return { success: true, bridgeName, endpoint };
}

// ─── Health Ping ──────────────────────────────────────────────────────────────
async function pingHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health/extension`);
    self.companionConnected = res.ok;
  } catch { self.companionConnected = false; }
}

// ─── Get or create a tab for a URL (tab hijacking) ───────────────────────────
async function getOrCreateTab(targetUrl) {
  const hostname = new URL(targetUrl.trim()).hostname;
  const existing = await chrome.tabs.query({ url: `*://${hostname}/*` });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { url: targetUrl, active: false });
    return existing[0].id;
  }
  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  return tab.id;
}

// ─── Wait for a tab to finish loading ────────────────────────────────────────
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tab load timeout')), timeoutMs);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === 'complete') { clearTimeout(timer); resolve(); }
      else chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

// ─── Run DOM-only actions on a tab via executeScript ─────────────────────────
// WHY: executeScript returns a Promise — no message channel, no timeout issue.
// IMPORTANT: Only pass non-navigate, non-wait actions here.
async function runDomActionsOnTab(tabId, domActions) {
  if (!domActions || domActions.length === 0) {
    // Default: read the page
    domActions = [{ type: 'read', target: 'page' }];
  }

  // Inject content script first (idempotent)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['executor-content.js'] });
  } catch (_) { /* already injected */ }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (actionsJson) => {
      const actions = JSON.parse(actionsJson);

      function findEl(target, preferRole) {
        if (!target) return null;
        const targets = String(target).split('|').map(t => t.trim());
        for (const tgt of targets) {
          const tgtLow = tgt.toLowerCase();
          // 1. aria-label exact / partial
          let el = document.querySelector(`[aria-label="${tgt}"]`)
                || document.querySelector(`[aria-label*="${tgt}"]`);
          if (el) return el;
          // 2. Buttons/roles with matching text
          const candidates = [...document.querySelectorAll(
            'button, [role="button"], [jsname], input[type="submit"], input[type="button"]'
          )];
          el = candidates.find(b => b.textContent.trim().toLowerCase() === tgtLow)
            || candidates.find(b => b.textContent.trim().toLowerCase().includes(tgtLow));
          if (el) return el;
          // 3. Label → input
          const labels = [...document.querySelectorAll('label')];
          const label = labels.find(l => l.textContent.trim().toLowerCase().includes(tgtLow));
          if (label) {
            if (label.htmlFor) { el = document.getElementById(label.htmlFor); if (el) return el; }
            el = label.querySelector('input, textarea, select'); if (el) return el;
          }
          // 4. Input placeholder / name
          el = document.querySelector(`input[placeholder*="${tgt}"]`)
            || document.querySelector(`textarea[placeholder*="${tgt}"]`)
            || document.querySelector(`input[name="${tgt}"]`);
          if (el) return el;
          // 5. CSS selector fallback
          try { el = document.querySelector(tgt); } catch {}
          if (el) return el;
        }
        return null;
      }

      let lastResult = { title: document.title, url: window.location.href };

      for (const action of actions) {
        if (action.type === 'wait') {
          await new Promise(r => setTimeout(r, action.ms || 500));

        } else if (action.type === 'click') {
          const el = findEl(action.target, 'button');
          if (el) {
            el.click();
            await new Promise(r => setTimeout(r, 800));
            lastResult = { clicked: action.target, title: document.title, url: window.location.href };
          } else {
            lastResult = { clickFailed: action.target, title: document.title, url: window.location.href };
          }

        } else if (action.type === 'fill') {
          const el = findEl(action.target, 'input');
          if (el) {
            el.focus();
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(el, action.value);
            else el.value = action.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            lastResult = { filled: action.target };
          }

        } else if (action.type === 'submit') {
          const form = document.querySelector('form');
          if (form) { form.submit(); await new Promise(r => setTimeout(r, 800)); }

        } else if (action.type === 'read') {
          lastResult = {
            title: document.title,
            url: window.location.href,
            content: document.body.innerText.substring(0, 3000),
          };
        }
      }

      return lastResult;
    },
    args: [JSON.stringify(domActions)],
  });

  return { success: true, data: results?.[0]?.result };
}

// ─── Main sequential action processor ────────────────────────────────────────
// WHY this separation matters:
//   navigate → must use chrome.tabs.update (changes page, destroys any running script)
//   wait     → setTimeout in background (between nav and DOM work)
//   DOM      → batched and sent to executeScript AFTER page is stable
async function processActionSequence(actions, targetUrl) {
  let tabId = null;
  const domActions = [];

  for (const action of actions) {
    if (action.type === 'navigate') {
      // Flush any queued DOM actions on the current tab first
      if (tabId && domActions.length > 0) {
        await runDomActionsOnTab(tabId, [...domActions]);
        domActions.length = 0;
      }
      // Navigate using browser API (NOT window.location.href in a script)
      tabId = await getOrCreateTab(action.target.trim());
      await waitForTabLoad(tabId);
      await new Promise(r => setTimeout(r, 2000)); // Wait for SPA hydration

    } else if (action.type === 'wait') {
      // Flush DOM actions first, then wait
      if (tabId && domActions.length > 0) {
        await runDomActionsOnTab(tabId, [...domActions]);
        domActions.length = 0;
      }
      await new Promise(r => setTimeout(r, action.ms || 1000));

    } else {
      // Queue DOM action (click, fill, read, submit)
      domActions.push(action);
    }
  }

  // Flush remaining DOM actions
  if (tabId && domActions.length > 0) {
    return await runDomActionsOnTab(tabId, domActions);
  }

  // If no DOM actions at end, just read the current page state
  if (tabId) {
    return await runDomActionsOnTab(tabId, [{ type: 'read', target: 'page' }]);
  }

  return { success: false, error: 'No tab was opened' };
}

// ─── Polling Loop ─────────────────────────────────────────────────────────────
async function pollCompanionApp() {
  if (self.isPolling) return;
  self.isPolling = true;

  try {
    const res = await fetch(`${API_BASE}/api/extension/poll`);
    if (!res.ok) return;

    const task = await res.json();
    if (!task || !task.id) return;

    console.log('[AgentBridge] Task received:', task.id, task.capability?.name);
    self.agentStatus = 'executing';

    let result;
    try {
      const actions = task.actions || [{ type: 'read', target: 'page' }];
      const targetUrl = (task.targetUrl || '').trim() || 'https://www.google.com';
      result = await processActionSequence(actions, targetUrl);
    } catch (execErr) {
      console.error('[AgentBridge] Execution error:', execErr.message);
      result = { success: false, error: execErr.message };
    }

    // Report result to companion
    await fetch(`${API_BASE}/api/extension/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, result }),
    });

    self.agentStatus = result?.success ? 'idle' : 'error';
    console.log('[AgentBridge] Task done:', task.id, result?.success ? '✅' : '❌', result);

  } catch (err) {
    console.warn('[AgentBridge] Poll error:', err.message);
  } finally {
    self.isPolling = false;
    setTimeout(pollCompanionApp, 500);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
pingHealth();
pollCompanionApp();
