/**
 * background.js — AgentBridge Extension Service Worker (MV3)
 * Root-cause fix: Chrome closes message channels for long-running content script operations.
 * Solution: Use chrome.scripting.executeScript (returns a Promise) instead of 
 * chrome.tabs.sendMessage for sequences that take longer than ~5 seconds.
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
    handleBridgeSite(message.url).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }
  if (message.type === 'GET_STATUS') {
    sendResponse({ status: self.agentStatus || 'idle', connected: self.companionConnected || false });
    return false;
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
  } catch {
    self.companionConnected = false;
  }
}

// ─── Tab Hijacking: Get or create a tab for a given URL ──────────────────────
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

// ─── Wait for tab to finish loading ──────────────────────────────────────────
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tab load timeout after 20s')), 20000);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    // Check if already loaded
    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

// ─── Execute actions via chrome.scripting.executeScript ──────────────────────
// WHY: We use executeScript instead of sendMessage because Chrome's message channel
// closes after ~5s for async responses. executeScript returns a Promise that
// waits for the full execution — no channel timeout issue.
async function executeActionsOnTab(tabId, actions) {
  // First ensure the content script is injected
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['executor-content.js'],
    });
  } catch (_) {
    // Already injected — ignore error
  }

  // Execute actions via injected function (not messaging)
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (actionsJson) => {
      const actions = JSON.parse(actionsJson);

      // Inline action executor (mirrors executor-content.js logic)
      // WHY: We inline it here because chrome.scripting.executeScript
      // can't call functions defined in content scripts.

      async function wait(ms) {
        return new Promise(r => setTimeout(r, ms));
      }

      function findEl(target, role) {
        if (!target) return null;
        const t = String(target).toLowerCase().trim();

        // Try pipe-separated fallbacks
        const targets = t.split('|').map(x => x.trim());
        for (const tgt of targets) {
          let el = document.querySelector(`[aria-label="${tgt}"]`)
            || document.querySelector(`[aria-label*="${tgt}"]`);
          if (el) return el;

          if (!role || role === 'button') {
            const btns = [...document.querySelectorAll('button, [role="button"], [jsname]')];
            el = btns.find(b => b.textContent.trim().toLowerCase().includes(tgt));
            if (el) return el;
          }

          const labels = [...document.querySelectorAll('label')];
          const label = labels.find(l => l.textContent.trim().toLowerCase().includes(tgt));
          if (label) {
            if (label.htmlFor) { el = document.getElementById(label.htmlFor); if (el) return el; }
            el = label.querySelector('input, textarea, select'); if (el) return el;
          }

          el = document.querySelector(`input[placeholder*="${tgt}"]`)
            || document.querySelector(`textarea[placeholder*="${tgt}"]`)
            || document.querySelector(`input[name="${tgt}"]`);
          if (el) return el;

          try { el = document.querySelector(tgt); } catch {}
          if (el) return el;
        }
        return null;
      }

      let lastResult = null;
      for (const action of actions) {
        if (action.type === 'wait') {
          await wait(action.ms || 1000);

        } else if (action.type === 'navigate') {
          window.location.href = action.target;
          await wait(3000); // Give page time to start loading

        } else if (action.type === 'click') {
          const el = findEl(action.target, 'button');
          if (el) {
            el.click();
            await wait(500);
            lastResult = { clicked: action.target, url: window.location.href };
          } else {
            lastResult = { clickFailed: action.target, url: window.location.href };
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
            lastResult = { filled: action.target };
          }

        } else if (action.type === 'read') {
          lastResult = {
            title: document.title,
            url: window.location.href,
            content: document.body.innerText.substring(0, 3000),
          };
        }
      }

      return lastResult || { title: document.title, url: window.location.href };
    },
    args: [JSON.stringify(actions)],
  });

  const result = results?.[0]?.result;
  return { success: true, data: result };
}

// ─── Main Execution Loop ──────────────────────────────────────────────────────
async function pollCompanionApp() {
  if (self.isPolling) return;
  self.isPolling = true;

  try {
    const res = await fetch(`${API_BASE}/api/extension/poll`);
    if (!res.ok) return;

    const task = await res.json();
    if (!task || !task.id) return;

    console.log('[AgentBridge] Executing task:', task.id, task.capability?.name);
    self.agentStatus = 'executing';

    let result;
    try {
      const actions = task.actions || [{ type: 'read', target: 'page' }];

      // Get or create a tab for the target URL
      const targetUrl = (task.targetUrl || '').trim() || 'https://www.google.com';
      const tabId = await getOrCreateTab(actions[0]?.target || targetUrl);

      // Wait for initial page load
      await waitForTabLoad(tabId);
      await new Promise(r => setTimeout(r, 500));

      // Execute actions via chrome.scripting (not sendMessage — avoids channel timeout)
      result = await executeActionsOnTab(tabId, actions);

    } catch (execErr) {
      console.error('[AgentBridge] Execution error:', execErr.message);
      result = { success: false, error: execErr.message };
    }

    // Report result back to companion
    await fetch(`${API_BASE}/api/extension/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, result }),
    });

    self.agentStatus = result.success ? 'idle' : 'error';
    console.log('[AgentBridge] Task complete:', task.id, result.success ? '✅' : '❌');

  } catch (err) {
    console.warn('[AgentBridge] Poll error:', err.message);
  } finally {
    self.isPolling = false;
    setTimeout(pollCompanionApp, 500);
  }
}

// Start
pingHealth();
pollCompanionApp();
