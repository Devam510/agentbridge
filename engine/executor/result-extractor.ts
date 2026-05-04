/**
 * result-extractor.ts
 * Extracts structured result data from a page after an action is executed.
 * WHY: Agents need structured output, not raw HTML.
 * We extract the confirmation/result and return clean JSON.
 */

import { Page } from 'playwright';

export interface ExtractionResult {
  success: boolean;
  data: Record<string, unknown>;
  rawText: string;
  pageTitle: string;
  url: string;
}

/**
 * Extract result data from the current page state.
 * Called after a form submission or button click to get the outcome.
 */
export async function extractResult(page: Page): Promise<ExtractionResult> {
  const url = page.url();
  const pageTitle = await page.title().catch(() => '');

  const extracted = await page
    .evaluate(() => {
      // Look for common success/error indicators
      const successSelectors = [
        '[role="alert"]',
        '[class*="success"]',
        '[class*="notification"]',
        '[class*="toast"]',
        '[class*="banner"]',
        '[class*="confirmation"]',
      ];

      const errorSelectors = [
        '[class*="error"]',
        '[class*="alert-danger"]',
        '[role="alert"][class*="error"]',
      ];

      let resultText = '';
      let isError = false;

      // Check for error indicators first
      for (const sel of errorSelectors) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) {
          resultText = el.textContent.trim();
          isError = true;
          break;
        }
      }

      // Check for success indicators
      if (!resultText) {
        for (const sel of successSelectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) {
            resultText = el.textContent.trim();
            break;
          }
        }
      }

      // Try to extract structured data from page (common result patterns)
      const idMatch = document.body.innerHTML?.match(/id["\s:=]+([a-z0-9_-]{8,})/i);
      const extractedId = idMatch?.[1] ?? null;

      return {
        resultText: resultText.slice(0, 500),
        isError,
        extractedId,
        headings: Array.from(document.querySelectorAll('h1, h2'))
          .map((h) => h.textContent?.trim())
          .filter(Boolean)
          .slice(0, 3),
      };
    })
    .catch(() => ({ resultText: '', isError: false, extractedId: null, headings: [] }));

  const data: Record<string, unknown> = {
    status: extracted.isError ? 'error' : 'success',
    message: extracted.resultText || 'Action completed',
    url,
  };

  if (extracted.extractedId) {
    data.id = extracted.extractedId;
  }

  return {
    success: !extracted.isError,
    data,
    rawText: extracted.resultText,
    pageTitle,
    url,
  };
}
