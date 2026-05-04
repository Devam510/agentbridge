/**
 * page-analyzer.ts
 * Extracts structured information from a single page.
 * WHY: We need a consistent data model of what a page "is" before we can infer capabilities.
 */

import { Page } from 'playwright';

export interface PageLink {
  href: string;
  text: string;
  isNavigation: boolean; // likely a nav link vs a content link
}

export interface PageSection {
  heading: string;
  level: number; // h1=1, h2=2, etc.
  content: string;
}

export interface AnalyzedPage {
  url: string;
  title: string;
  description: string;
  links: PageLink[];
  sections: PageSection[];
  hasLoginForm: boolean;
  hasSearchBar: boolean;
  mainContent: string; // trimmed text content, max 2000 chars
}

/**
 * Analyze a single page that is already loaded in the browser.
 * Returns structured data — never raw HTML.
 */
export async function analyzePage(page: Page): Promise<AnalyzedPage> {
  const url = page.url();

  // Extract title and meta description
  const title = await page.title();
  const description = await page
    .locator('meta[name="description"]')
    .getAttribute('content')
    .catch(() => '');

  // Extract all navigation links
  const links = await page.evaluate((): PageLink[] => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const navAnchors = Array.from(
      document.querySelectorAll('nav a, header a, [role="navigation"] a'),
    );
    const navHrefs = new Set(navAnchors.map((a) => (a as HTMLAnchorElement).href));

    return anchors
      .map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a as HTMLElement).textContent?.trim().slice(0, 100) ?? '',
        isNavigation: navHrefs.has((a as HTMLAnchorElement).href),
      }))
      .filter((l) => l.href.startsWith('http') && l.text.length > 0)
      .slice(0, 50); // cap to 50 links
  });

  // Extract headings as sections
  const sections = await page.evaluate((): PageSection[] => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
    return headings.map((h) => ({
      heading: h.textContent?.trim() ?? '',
      level: parseInt(h.tagName.slice(1)),
      content: h.nextElementSibling?.textContent?.trim().slice(0, 300) ?? '',
    }));
  });

  // Detect login form
  const hasLoginForm = await page
    .locator('input[type="password"]')
    .count()
    .then((c) => c > 0)
    .catch(() => false);

  // Detect search bar
  const hasSearchBar = await page
    .locator('input[type="search"], input[placeholder*="search" i], input[name*="search" i]')
    .count()
    .then((c) => c > 0)
    .catch(() => false);

  // Main text content — trimmed, no scripts/styles
  const mainContent = await page.evaluate((): string => {
    const scripts = document.querySelectorAll('script, style, noscript');
    scripts.forEach((s) => s.remove());
    const text = document.body?.innerText ?? '';
    // Collapse whitespace and cap length
    return text.replace(/\s+/g, ' ').trim().slice(0, 2000);
  });

  return {
    url,
    title,
    description: description ?? '',
    links,
    sections,
    hasLoginForm,
    hasSearchBar,
    mainContent,
  };
}
