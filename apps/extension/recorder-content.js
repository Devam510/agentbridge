/**
 * recorder-content.js — Module 1: Demonstration-to-Code Engine
 *
 * WHY: Injected into the page when "Record" mode is active.
 * Listens to all user interactions (clicks, keystrokes, fills, scrolls)
 * and streams them back to the background script for code generation.
 */

(function () {
  if (window.__AgentBridgeRecorderActive) return; // Idempotent
  window.__AgentBridgeRecorderActive = true;

  const events = [];

  function capture(type, data) {
    const entry = {
      type,
      url: window.location.href,
      timestamp: Date.now(),
      ...data,
    };
    events.push(entry);
    chrome.runtime.sendMessage({ type: 'RECORDER_EVENT', event: entry });
  }

  // Resolve a human-readable, stable selector for an element
  function getSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return `#${el.id}`;
    if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
    if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
    if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
    if (el.textContent?.trim() && el.textContent.trim().length < 40) {
      return `${el.tagName.toLowerCase()}:contains("${el.textContent.trim()}")`;
    }
    return el.tagName.toLowerCase();
  }

  // Click listener
  document.addEventListener('click', (e) => {
    const sel = getSelector(e.target);
    capture('click', { selector: sel, text: e.target.textContent?.trim()?.slice(0, 60) });
  }, true);

  // Fill/input listener — only fires after the user leaves the field
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      capture('fill', {
        selector: getSelector(el),
        value: el.type === 'password' ? '{{PASSWORD}}' : el.value,
        inputType: el.type || el.tagName.toLowerCase(),
      });
    }
  }, true);

  // ContentEditable input listener
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.isContentEditable) {
      capture('fill', {
        selector: getSelector(el),
        value: el.textContent?.trim()?.slice(0, 200),
        inputType: 'contenteditable',
      });
    }
  }, true);

  // Navigation (URL change via History API — SPAs)
  const originalPush = history.pushState.bind(history);
  history.pushState = function (...args) {
    originalPush(...args);
    capture('navigate', { url: window.location.href });
  };

  window.addEventListener('popstate', () => {
    capture('navigate', { url: window.location.href });
  });

  // Expose events list so the background script can collect them
  window.__AgentBridgeRecorderEvents = events;

  console.log('[AgentBridge] Recorder active on', window.location.href);
})();
