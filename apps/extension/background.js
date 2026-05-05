/**
 * background.js — AgentBridge Extension Service Worker (MV3)
 * WHY: Service workers handle message passing, command polling, and real browser execution.
 * Phase 7: Universal executor — reads actions from Companion and runs them on live tabs.
 */

const API_BASE = 'http://localhost:3001';

// ─── Keep-Alive (MV3 Service Worker must be kept awake) ──────────────────────
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
  const hostname = new URL(targetUrl).hostname;
  const existing = await chrome.tabs.query({ url: `*://${hostname}/*` });
  if (existing.length > 0) {
    // Tab already exists — bring it to focus and navigate it
    await chrome.tabs.update(existing[0].id, { url: targetUrl, active: false });
    return existing[0].id;
  }
  // No existing tab — open a new one in the background
  const tab = await chrome.tabs.create({ url: targetUrl, active: false });
  return tab.id;
}

// ─── Wait for a tab to finish loading ────────────────────────────────────────
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tab load timeout')), 20000);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ─── Execute DOM actions on a tab via content script ─────────────────────────
async function executeActionsOnTab(tabId, actions) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_SEQUENCE', actions }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready — inject it first then retry
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['executor-content.js'],
        }, () => {
          chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_SEQUENCE', actions }, (retryResponse) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(retryResponse);
            }
          });
        });
      } else {
        resolve(response);
      }
    });
  });
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
      // 1. Get or create a tab for the target
      const tabId = await getOrCreateTab(task.targetUrl);

      // 2. Wait for the page to fully load (event-driven, not fixed timer)
      await waitForTabLoad(tabId);

      // 3. Small buffer for SPA hydration
      await new Promise(r => setTimeout(r, 800));

      // 4. Execute the action sequence via the content script
      const actions = task.actions || [{ type: 'read', target: 'page' }];
      const executionResult = await executeActionsOnTab(tabId, actions);

      // 5. Fallback: if content script failed, do a raw page text extraction
      if (!executionResult || !executionResult.success) {
        const fallback = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            title: document.title,
            content: document.body.innerText.substring(0, 6000),
            url: window.location.href,
          }),
        });
        result = { success: true, data: fallback[0].result };
      } else {
        result = executionResult;
      }
    } catch (execErr) {
      result = { success: false, error: execErr.message };
    }

    // 6. Report result back to the Companion App
    await fetch(`${API_BASE}/api/extension/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, result }),
    });

    self.agentStatus = result.success ? 'idle' : 'error';
    console.log('[AgentBridge] Task complete:', task.id, result.success ? '✅' : '❌');

  } catch (err) {
    // Companion app might be down or request timed out — silent ignore
    console.warn('[AgentBridge] Poll error:', err.message);
  } finally {
    self.isPolling = false;
    // Immediately re-poll to stay responsive
    setTimeout(pollCompanionApp, 500);
  }
}

// Start everything
pingHealth();
pollCompanionApp();
