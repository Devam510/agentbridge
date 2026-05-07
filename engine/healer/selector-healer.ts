/**
 * engine/healer/selector-healer.ts — Module 3: Self-Healing Automation Network
 *
 * WHY: When an automation fails because a website's UI changed, this module
 * captures the page state and asks an LLM Vision model to find the new selector.
 * Fixes are cached globally so ALL users benefit immediately.
 * API keys are ONLY handled here — never exposed in the extension.
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

const CACHE_FILE = path.resolve('./engine/healer/selector-cache.json');

interface SelectorCacheEntry {
  intent: string;
  selector: string;
  confidence: number;
  healedAt: string;
  domain: string;
}

// Load the global selector cache from disk
function loadCache(): Record<string, SelectorCacheEntry> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

// Persist cache to disk
function saveCache(cache: Record<string, SelectorCacheEntry>): void {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Cache key: domain + intent
function cacheKey(domain: string, intent: string): string {
  return `${domain}::${intent.toLowerCase().trim()}`;
}

export function getCachedSelector(domain: string, intent: string): string | null {
  const cache = loadCache();
  const entry = cache[cacheKey(domain, intent)];
  return entry?.selector ?? null;
}

export async function healSelector(
  intent: string,
  domSnapshot: string,
  screenshotBase64: string,
  domain: string,
  apiKey?: string
): Promise<{ selector: string; healed: boolean }> {
  // 1. Check cache first
  const cached = getCachedSelector(domain, intent);
  if (cached) {
    return { selector: cached, healed: false };
  }

  if (!apiKey) {
    throw new Error('No OpenAI API key for self-healing. Set OPENAI_API_KEY in .env.');
  }

  const client = new OpenAI({ apiKey });

  // 2. Truncate DOM to avoid token limits (keep first 8000 chars)
  const truncatedDom = domSnapshot.slice(0, 8000);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a web automation expert. Given a DOM snapshot and a target intent, return ONLY a valid CSS selector or aria-label that matches the element. Return a JSON object: { "selector": "...", "type": "css|aria|text" }',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `The automation is looking for: "${intent}".\nHere is the current DOM (truncated):\n${truncatedDom}\n\nReturn the best CSS selector to target this element.`,
          },
          ...(screenshotBase64 ? [{
            type: 'image_url' as const,
            image_url: { url: `data:image/webp;base64,${screenshotBase64}`, detail: 'low' as const },
          }] : []),
        ],
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  let selector = intent; // fallback
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
    selector = parsed.selector || intent;
  } catch {}

  // 3. Save to global cache
  const cache = loadCache();
  cache[cacheKey(domain, intent)] = {
    intent,
    selector,
    confidence: 0.9,
    healedAt: new Date().toISOString(),
    domain,
  };
  saveCache(cache);

  return { selector, healed: true };
}
