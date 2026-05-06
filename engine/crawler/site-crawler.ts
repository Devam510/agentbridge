/**
 * site-crawler.ts
 * Orchestrates crawling of a full site — multiple pages, up to a depth limit.
 * WHY: A single page doesn't show all capabilities. We need to discover all sections.
 */

import { launchBrowser } from './browser-launcher.js';
import { analyzePage, AnalyzedPage } from './page-analyzer.js';
import { detectForms, DetectedForm } from './form-detector.js';
import { mapActions, MappedAction } from './action-mapper.js';

export interface CrawledPageData {
  page: AnalyzedPage;
  forms: DetectedForm[];
  actions: MappedAction[];
}

export interface SiteCrawlResult {
  baseUrl: string;
  crawledAt: string;
  pagesVisited: number;
  pages: CrawledPageData[];
  errors: string[];
  siteNavMap: Record<string, string>;
}

export interface CrawlOptions {
  maxPages?: number;       // default 20
  maxDepth?: number;       // default 2
  headless?: boolean;
  timeout?: number;        // per-page timeout ms
  allowedDomains?: string[]; // restrict to these domains only
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isSameDomain(url: string, baseDomain: string): boolean {
  return extractDomain(url) === baseDomain;
}

/**
 * Crawl a website starting from baseUrl.
 * Discovers pages by following navigation links.
 * Respects domain boundaries — never crawls external sites.
 */
export async function crawlSite(
  baseUrl: string,
  options: CrawlOptions = {},
): Promise<SiteCrawlResult> {
  const {
    maxPages = 20,
    maxDepth = 2,
    headless = true,
    timeout = 15000,
  } = options;

  const baseDomain = extractDomain(baseUrl);
  const allowedDomains = options.allowedDomains ?? [baseDomain];

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
  const results: CrawledPageData[] = [];
  const errors: string[] = [];

  const session = await launchBrowser({ headless, timeout });

  try {
    while (queue.length > 0 && visited.size < maxPages) {
      const { url, depth } = queue.shift()!;

      // Normalize URL — remove hash fragments
      const normalizedUrl = url.split('#')[0];
      if (visited.has(normalizedUrl)) continue;
      visited.add(normalizedUrl);

      // Safety check: only crawl allowed domains
      const urlDomain = extractDomain(normalizedUrl);
      if (!allowedDomains.includes(urlDomain)) continue;

      try {
        await session.page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded',
          timeout,
        });

        // Wait briefly for JS to render
        await session.page.waitForTimeout(500);

        const [pageData, forms, actions] = await Promise.all([
          analyzePage(session.page),
          detectForms(session.page),
          mapActions(session.page),
        ]);

        results.push({ page: pageData, forms, actions });

        // Enqueue navigation links if we haven't hit depth limit
        if (depth < maxDepth) {
          const navLinks = pageData.links
            .filter((l) => l.isNavigation && isSameDomain(l.href, baseDomain))
            .map((l) => ({ url: l.href, depth: depth + 1 }))
            .filter((l) => !visited.has(l.url.split('#')[0]));

          queue.push(...navLinks.slice(0, 5)); // max 5 new links per page
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`[${normalizedUrl}] ${message}`);
      }
    }
  } finally {
    // Always close — prevents memory leaks
    await session.close();
  }

  if (results.length === 0 && errors.length > 0) {
    throw new Error(`Failed to crawl the website. Make sure the URL is correct and accessible. Details: ${errors[0]}`);
  }

  // Build siteNavMap from all pages' navigation links
  const siteNavMap: Record<string, string> = {};
  const intentKeywords = {
    'message': ['message', 'dm', 'chat', 'inbox', 'send', 'direct'],
    'settings': ['settings', 'account', 'preferences', 'profile'],
    'notifications': ['notifications', 'alerts'],
    'search': ['search', 'find', 'discover', 'explore'],
    'create': ['create', 'add', 'new', 'compose', 'post'],
    'home': ['home', 'feed', 'timeline', 'dashboard']
  };

  for (const pageData of results) {
    for (const link of pageData.page.links) {
      if (!link.isNavigation) continue;
      const text = link.text.toLowerCase();
      
      for (const [intent, keywords] of Object.entries(intentKeywords)) {
        if (!siteNavMap[intent] && keywords.some(k => text.includes(k))) {
          siteNavMap[intent] = link.href;
        }
      }
    }
  }

  return {
    baseUrl,
    crawledAt: new Date().toISOString(),
    pagesVisited: visited.size,
    pages: results,
    errors,
    siteNavMap,
  };
}
