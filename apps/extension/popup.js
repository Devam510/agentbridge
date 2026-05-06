// popup.js — External script for AgentBridge popup (MV3 CSP compliant)
// WHY: Chrome MV3 blocks ALL inline <script> tags via Content Security Policy.
// Fix: extract all JS here and reference via <script src="popup.js">

const statusEl = document.getElementById('status');
const pbar = document.getElementById('pbar');
const urlEl = document.getElementById('current-url');
const bridgeBtn = document.getElementById('bridge-btn');
const connBadge = document.getElementById('conn-badge');
const connDot = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');

// Live connection status polling
function updateBadge(status) {
  connBadge.className = 'connection-badge ' + status;
  connDot.className = 'dot' + (status === 'executing' ? ' pulse' : '');
  connLabel.textContent =
    status === 'connected'  ? '🟢 Connected'  :
    status === 'executing'  ? '⚙️ Executing'  :
    '🔴 Offline';
}

async function refreshStatus() {
  try {
    const res = await fetch('http://localhost:3001/api/health/extension/status');
    if (res.ok) {
      const data = await res.json();
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (bg) => {
        if (bg?.status === 'executing') { updateBadge('executing'); }
        else if (data.connected)        { updateBadge('connected'); }
        else                            { updateBadge('disconnected'); }
      });
    } else { updateBadge('disconnected'); }
  } catch { updateBadge('disconnected'); }
}
setInterval(refreshStatus, 3000);
refreshStatus();

async function checkCompanion() {
  try {
    const res = await fetch('http://localhost:3001/health');
    if (res.ok) {
      statusEl.textContent = 'Ready to bridge this site';
      bridgeBtn.disabled = false;
      return true;
    }
  } catch {
    statusEl.textContent = 'Companion app not running. Please install it.';
    statusEl.className = 'status err';
    bridgeBtn.disabled = true;
    bridgeBtn.textContent = '❌ Offline';
    return false;
  }
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url || 'Unknown';
  urlEl.textContent = url;
  checkCompanion();
});

document.getElementById('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:3000/dashboard' });
});

bridgeBtn.addEventListener('click', async () => {
  bridgeBtn.disabled = true;
  statusEl.className = 'status';

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const url = tabs[0]?.url;
    if (!url) {
      statusEl.textContent = 'Could not get tab URL';
      statusEl.className = 'status err';
      bridgeBtn.disabled = false;
      return;
    }

    const steps = ['Crawling…', 'Mapping capabilities…', 'Generating MCP server…', 'Deploying to Companion…'];
    for (let i = 0; i < steps.length; i++) {
      statusEl.textContent = steps[i];
      pbar.style.width = `${((i + 1) / steps.length) * 100}%`;
      await new Promise(r => setTimeout(r, 800));
    }

    chrome.runtime.sendMessage({ type: 'BRIDGE_SITE', url }, (response) => {
      if (response?.success) {
        statusEl.textContent = '✅ Bridge installed! Restart Claude.';
        statusEl.className = 'status ok';
        pbar.style.width = '100%';
      } else {
        statusEl.textContent = response?.error || 'Bridge failed';
        statusEl.className = 'status err';
      }
      bridgeBtn.disabled = false;
    });
  });
});
