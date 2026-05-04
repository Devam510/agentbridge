/**
 * change-detector.ts
 * Detects if a capability's UI source location has changed or broken.
 * WHY: Software UIs change constantly. We need to detect when a selector breaks
 * before an agent tries to use it.
 */

import { Page } from 'playwright';
import { Capability } from '../inferrer/capability-map.js';

/**
 * Node.js-safe CSS identifier escaper.
 * WHY: CSS.escape() is a browser-only Web API — crashes in Node.js/MCP server context.
 */
function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, '\\$1');
}

export interface ChangeDetectionResult {
  isBroken: boolean;
  reason?: string;
}

/**
 * Checks if a specific capability's UI mapping is still valid.
 */
export async function detectChange(page: Page, capability: Capability, targetUrl: string): Promise<ChangeDetectionResult> {
  // If it's an API, UI changes don't matter directly for the route, 
  // but the API endpoint itself might 404 (handled during execution/health check)
  if (capability.sourceType === 'api') {
    return { isBroken: false }; 
  }

  try {
    const targetPage = capability.sourceLocation.startsWith('http')
      ? capability.sourceLocation
      : `${targetUrl}${capability.sourceLocation}`;

    // Navigate to the source page
    const response = await page.goto(targetPage, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Check if page 404s
    if (response && response.status() >= 400 && response.status() !== 401 && response.status() !== 403) {
      return { isBroken: true, reason: `Page returned status ${response.status()}` };
    }

    // Give it a moment to render
    await page.waitForTimeout(500);

    if (capability.sourceType === 'form') {
      // Form detection: verify all required inputs exist
      for (const param of capability.parameters) {
        if (!param.required) continue;
        
        // Same logic as form-filler selector strategy
        const selectors = [
          `[name="${cssEscape(param.name)}"]`,
          `#${cssEscape(param.name)}`,
        ];

        let found = false;
        for (const selector of selectors) {
          const isVisible = await page.locator(selector).first().isVisible({ timeout: 1000 }).catch(() => false);
          if (isVisible) {
            found = true;
            break;
          }
        }

        if (!found) {
          return { isBroken: true, reason: `Required form field '${param.name}' is no longer visible` };
        }
      }
    } else if (capability.sourceType === 'button') {
      // Button detection: verify button exists
      const buttonSelector = `button:has-text("${capability.name.slice(0, 30)}")`;
      const isVisible = await page.locator(buttonSelector).first().isVisible({ timeout: 2000 }).catch(() => false);
      if (!isVisible) {
        return { isBroken: true, reason: `Button matching '${capability.name}' is no longer visible` };
      }
    }

    return { isBroken: false };
  } catch (err) {
    return { isBroken: true, reason: `Navigation or check failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
