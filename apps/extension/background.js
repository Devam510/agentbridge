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

// ─── Module 1: Recorder State ────────────────────────────────────────────────
self.isRecording = false;
self.recordedEvents = [];

// ─── Keep-Alive ───────────────────────────────────────────────────────────────
// periodInMinutes: 0.33 is ~20 seconds
chrome.alarms.create('keepAlive', { periodInMinutes: 0.33 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    pingHealth();
    if (!self.isPolling) pollCompanionApp();
  }
});

// ─── Lifecycle Events (Phase 8D) ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[AgentBridge] Extension installed/updated. Starting loops.');
  pingHealth();
  if (!self.isPolling) pollCompanionApp();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[AgentBridge] Browser started. Starting loops.');
  pingHealth();
  if (!self.isPolling) pollCompanionApp();
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

  // Module 1: Recorder messages
  if (message.type === 'RECORDER_START') {
    self.isRecording = true;
    self.recordedEvents = [];
    // Inject recorder into active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['recorder-content.js'],
        }).catch(() => {});
      }
    });
    sendResponse({ success: true });
    return true;
  }
  if (message.type === 'RECORDER_STOP') {
    self.isRecording = false;
    const events = self.recordedEvents || [];
    self.recordedEvents = [];
    // Send events to companion server for synthesis
    fetch(`${API_BASE}/api/recorder/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    }).then(r => r.json()).then(data => sendResponse(data)).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (message.type === 'RECORDER_EVENT' && self.isRecording) {
    self.recordedEvents = self.recordedEvents || [];
    self.recordedEvents.push(message.event);
  }
  if (message.type === 'GET_RECORDING_STATUS') {
    sendResponse({ isRecording: self.isRecording || false, eventCount: (self.recordedEvents || []).length });
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

// ─── Health Ping & Heartbeat ──────────────────────────────────────────────────
async function pingHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/health/extension`);
    self.companionConnected = res.ok;
  } catch { self.companionConnected = false; }
}

async function sendHeartbeat() {
  try {
    await fetch(`${API_BASE}/api/extension/heartbeat`, { method: 'POST' });
  } catch { /* ignore heartbeat errors */ }
}

// Send heartbeat every 5 seconds while SW is awake
setInterval(sendHeartbeat, 5000);

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
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    // Phase 10: DO NOT REJECT on timeout! SPAs like Instagram might never fire 'complete'.
    // We have retry loops in executor-content.js to handle slow-loading elements anyway.
    const timer = setTimeout(() => {
      console.warn(`[AgentBridge] Tab load timed out after ${timeoutMs}ms. Proceeding anyway.`);
      resolve();
    }, timeoutMs);
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

  // Inject content scripts first (idempotent)
  // Module 8: state-injector-content.js must load before executor-content.js
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['state-injector-content.js'] });
  } catch (_) { /* already injected */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['executor-content.js'] });
  } catch (_) { /* already injected */ }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (actionsJson) => {
      const actions = JSON.parse(actionsJson);
      if (window.AgentBridgeExecutor) {
        return await window.AgentBridgeExecutor.executeSequence(actions);
      }
      return { error: 'AgentBridgeExecutor not found in page context' };
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
