/**
 * form-filler.ts
 * Fills and submits forms via browser automation.
 * WHY: Forms are the primary write mechanism in human software.
 * Deterministic automation (not vision models) — we use exact selectors from our map.
 */

import { Page } from 'playwright';
import { DetectedForm } from '../crawler/form-detector.js';

/**
 * Node.js-safe CSS identifier escaper.
 * WHY: CSS.escape() is a browser-only Web API — crashes in Node.js/MCP server context.
 * This replicates the same escaping logic using pure JavaScript.
 */
function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, '\\$1');
}

export interface FillFormOptions {
  form: DetectedForm;
  data: Record<string, string | number | boolean>;
  submit?: boolean; // default true
}

export interface FormFillResult {
  success: boolean;
  submittedData: Record<string, string | number | boolean>;
  errorMessage?: string;
  resultText?: string; // text extracted from page after submit
}

/**
 * Fill a form with agent-provided data and optionally submit it.
 * Sanitizes all inputs before typing — never injects raw user strings as selectors.
 */
export async function fillForm(page: Page, options: FillFormOptions): Promise<FormFillResult> {
  const { form, data, submit = true } = options;
  const submittedData: Record<string, string | number | boolean> = {};

  try {
    for (const field of form.fields) {
      const value = data[field.name] ?? data[field.label];
      if (value === undefined) continue;

      // Sanitize value — convert to string, trim, cap length
      const sanitized = String(value).trim().slice(0, 1000);
      submittedData[field.name] = sanitized;

      // Locate field by name, id, or label — never by raw CSS injection
      const selectors = [
        `[name="${cssEscape(field.name)}"]`,
        `#${cssEscape(field.name)}`,
        field.placeholder ? `[placeholder="${cssEscape(field.placeholder)}"]` : null,
      ].filter(Boolean) as string[];

      let filled = false;
      for (const selector of selectors) {
        try {
          const el = page.locator(selector).first();
          const isVisible = await el.isVisible({ timeout: 2000 }).catch(() => false);
          if (!isVisible) continue;

          if (field.type === 'select') {
            await el.selectOption({ label: sanitized });
          } else if (field.type === 'checkbox') {
            const shouldCheck = sanitized === 'true' || sanitized === '1';
            if (shouldCheck) await el.check();
            else await el.uncheck();
          } else {
            await el.fill(sanitized);
          }

          filled = true;
          break;
        } catch {
          continue;
        }
      }

      if (!filled) {
        // Non-fatal — log but continue
        console.warn(`[FormFiller] Could not fill field: ${field.name}`);
      }
    }

    if (submit && form.submitButtonText) {
      // Find and click submit button
      const submitSelectors = [
        `button[type="submit"]`,
        `input[type="submit"]`,
        `button:has-text("${form.submitButtonText.slice(0, 30)}")`,
        `button:not([type])`,
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const btn = page.locator(selector).first();
          const isVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
          if (!isVisible) continue;

          await btn.click();
          // Wait for navigation or response
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => undefined);
          submitted = true;
          break;
        } catch {
          continue;
        }
      }

      if (!submitted) {
        return { success: false, submittedData, errorMessage: 'Submit button not found' };
      }
    }

    // Extract result text from page
    const resultText = await page
      .evaluate(() => {
        const alerts = document.querySelectorAll('[role="alert"], .success, .error, .notification');
        const texts = Array.from(alerts)
          .map((el) => el.textContent?.trim())
          .filter(Boolean);
        return texts.join(' ') || document.title;
      })
      .catch(() => '');

    return { success: true, submittedData, resultText };
  } catch (err) {
    return {
      success: false,
      submittedData,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
