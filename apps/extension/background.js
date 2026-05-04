/**
 * background.js — AgentBridge Extension Service Worker (MV3)
 * WHY: Service workers handle message passing and API calls from the popup.
 */

const API_BASE = 'http://localhost:3000';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'BRIDGE_SITE') {
    handleBridgeSite(message.url).then(sendResponse).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  }
});

async function handleBridgeSite(url) {
  // Derive bridge name from hostname
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const bridgeName = hostname.replace(/\./g, '-');

  // Call the AgentBridge web portal API to create the bridge
  const createRes = await fetch(`${API_BASE}/api/bridge/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, bridgeName }),
  });

  if (!createRes.ok) {
    throw new Error(`Bridge generation failed: ${createRes.status}`);
  }

  const { endpoint } = await createRes.json();

  // Install into Claude Desktop via the installer API
  const installRes = await fetch(`${API_BASE}/api/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bridgeName, endpoint }),
  });

  if (!installRes.ok) {
    throw new Error('Config installation failed');
  }

  return { success: true, bridgeName, endpoint };
}
