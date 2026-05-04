/**
 * action-runner.ts
 * Clicks buttons and navigates pages via browser automation.
 * WHY: Not all agent actions go through forms — many are single-button clicks
 * (e.g., "Archive deal", "Mark as complete", "Export CSV").
 */

import { Page } from 'playwright';
import { MappedAction } from '../crawler/action-mapper.js';
import { extractResult, ExtractionResult } from './result-extractor.js';

export interface RunActionOptions {
  action: MappedAction;
  targetBaseUrl: string; // used to block navigation outside domain
  confirmationRequired?: boolean; // if true, wait for a confirmation dialog
}

export interface ActionRunResult {
  success: boolean;
  result: ExtractionResult | null;
  errorMessage?: string;
  finalUrl: string;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Execute a single mapped action (button click or action link).
 * Validates domain before navigating — never follows links to external sites.
 */
export async function runAction(page: Page, options: RunActionOptions): Promise<ActionRunResult> {
  const { action, targetBaseUrl } = options;
  const baseDomain = extractDomain(targetBaseUrl);

  try {
    if (action.type === 'link' && action.href) {
      // Validate destination is on same domain
      const destDomain = extractDomain(action.href);
      if (destDomain && destDomain !== baseDomain) {
        return {
          success: false,
          result: null,
          errorMessage: `Blocked: Cannot navigate to external domain ${destDomain}`,
          finalUrl: page.url(),
        };
      }

      await page.goto(action.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } else {
      // Click button by selector
      const el = page.locator(action.selector).first();
      const isVisible = await el.isVisible({ timeout: 5000 }).catch(() => false);

      if (!isVisible) {
        // Fallback: try finding by text
        const byText = page.locator(`button:has-text("${action.text.slice(0, 30)}")`).first();
        const textVisible = await byText.isVisible({ timeout: 3000 }).catch(() => false);

        if (!textVisible) {
          return {
            success: false,
            result: null,
            errorMessage: `Element not found: "${action.text}" (selector: ${action.selector})`,
            finalUrl: page.url(),
          };
        }

        await byText.click({ timeout: 5000 });
      } else {
        await el.click({ timeout: 5000 });
      }

      // Handle confirmation dialogs (e.g., "Are you sure you want to delete?")
      if (options.confirmationRequired) {
        await page.waitForTimeout(500);
        const confirmBtn = page
          .locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("OK")')
          .first();
        const confirmVisible = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (confirmVisible) {
          await confirmBtn.click({ timeout: 3000 });
        }
      }

      // Wait for page to settle
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
    }

    const result = await extractResult(page);
    return { success: result.success, result, finalUrl: page.url() };
  } catch (err) {
    return {
      success: false,
      result: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      finalUrl: page.url(),
    };
  }
}

/**
 * Navigate to a URL within the allowed domain.
 * Throws if navigation would leave the target domain.
 */
export async function navigateTo(
  page: Page,
  url: string,
  targetBaseUrl: string,
): Promise<void> {
  const baseDomain = extractDomain(targetBaseUrl);
  const destDomain = extractDomain(url);

  if (destDomain && destDomain !== baseDomain) {
    throw new Error(`Navigation blocked: ${url} is outside target domain ${baseDomain}`);
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
}
