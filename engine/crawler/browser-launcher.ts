/**
 * browser-launcher.ts
 * Manages Playwright browser lifecycle.
 * WHY: Centralizing browser management ensures we never leak browser instances.
 */

import { Browser, BrowserContext, chromium, Page } from 'playwright';

export interface BrowserLaunchOptions {
  headless?: boolean;
  timeout?: number;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

/**
 * Launch a sandboxed browser session.
 * Always call session.close() when done to prevent memory leaks.
 */
export async function launchBrowser(options: BrowserLaunchOptions = {}): Promise<BrowserSession> {
  const { headless = true, timeout = 30000 } = options;

  const browser = await chromium.launch({
    headless,
    // Sandbox mode — no access to local filesystem from within browser
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
    ],
  });

  const context = await browser.newContext({
    // Block local file:// access from within pages
    bypassCSP: false,
    javaScriptEnabled: true,
    // Do not persist any cookies or storage between sessions
    storageState: undefined,
  });

  context.setDefaultTimeout(timeout);
  context.setDefaultNavigationTimeout(timeout);

  const page = await context.newPage();

  const close = async (): Promise<void> => {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  };

  return { browser, context, page, close };
}
