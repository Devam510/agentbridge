/**
 * state-injector-content.js — Module 8: Synthetic State Injection
 *
 * WHY: For React/Vue apps, we can bypass slow UI animations entirely by
 * dispatching actions directly to the app's internal state layer.
 * This makes automation 100x faster than visual clicking.
 *
 * SECURITY: This is injected as a content script — it can ONLY access
 * the page's JavaScript runtime in its own sandboxed context. It cannot
 * read other tabs, the user's passwords, or any Chrome APIs.
 */

(function () {
  if (window.__AgentBridgeStateInjectorActive) return;
  window.__AgentBridgeStateInjectorActive = true;

  /**
   * Attempt to find the React Fiber root for an element.
   * WHY: React stores its internal state in a property like __reactFiber$xxx.
   */
  function getReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    return key ? el[key] : null;
  }

  /**
   * Walk up the React fiber tree to find a node that has an onClick handler.
   */
  function findFiberWithHandler(fiber, handlerName = 'onClick') {
    let node = fiber;
    let depth = 0;
    while (node && depth < 20) {
      const props = node.memoizedProps;
      if (props && typeof props[handlerName] === 'function') {
        return { node, handler: props[handlerName] };
      }
      node = node.return;
      depth++;
    }
    return null;
  }

  /**
   * Synthetic click via React fiber — bypasses CSS animations and re-renders.
   * Falls back gracefully to native click if fiber not found.
   */
  function syntheticClick(el) {
    const fiber = getReactFiber(el);
    if (fiber) {
      const found = findFiberWithHandler(fiber, 'onClick');
      if (found) {
        try {
          // Create a minimal synthetic event to satisfy React's event system
          found.handler({ type: 'click', target: el, currentTarget: el, preventDefault: () => {}, stopPropagation: () => {} });
          return { method: 'synthetic', success: true };
        } catch (e) {
          // Fall through to native click
        }
      }
    }
    // Native fallback
    el.click();
    return { method: 'native', success: true };
  }

  /**
   * Fill a React-controlled input by dispatching a native input event
   * alongside setting the value via the React descriptor setter.
   */
  function syntheticFill(el, value) {
    const fiber = getReactFiber(el);

    if (fiber && el.tagName && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      try {
        // React uses Object.getOwnPropertyDescriptor to track value changes
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        const setter = el.tagName === 'INPUT' ? nativeInputValueSetter : nativeTextareaSetter;

        if (setter) {
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { method: 'synthetic', success: true };
        }
      } catch (e) {
        // Fall through to execCommand
      }
    }

    // ContentEditable fallback
    if (el.isContentEditable) {
      el.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, value);
      return { method: 'execCommand', success: true };
    }

    // Last resort
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { method: 'direct', success: true };
  }

  // Expose the API to the page so executor-content.js can access it
  window.__AgentBridgeStateInjector = { syntheticClick, syntheticFill, getReactFiber };

  console.log('[AgentBridge] State Injector ready on', window.location.href);
})();
