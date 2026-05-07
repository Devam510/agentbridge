/**
 * engine/generator/code-synthesizer.ts — Module 1: Demonstration-to-Code Engine
 *
 * WHY: Takes a list of recorded user interaction events and calls an LLM to
 * produce a clean, robust, production-grade Playwright TypeScript automation script.
 * All API keys are handled ONLY in this backend module — never in the extension.
 */

import OpenAI from 'openai';

interface RecordedEvent {
  type: 'click' | 'fill' | 'navigate' | 'scroll';
  url: string;
  timestamp: number;
  selector?: string;
  text?: string;
  value?: string;
  inputType?: string;
}

export interface SynthesisResult {
  script: string;
  filename: string;
  summary: string;
}

/**
 * Deduplicates consecutive fill events on the same selector
 * (keeps the last value since intermediate keystrokes aren't meaningful).
 */
function deduplicateEvents(events: RecordedEvent[]): RecordedEvent[] {
  const cleaned: RecordedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const curr = events[i];
    const next = events[i + 1];
    // Skip fill events that are immediately followed by another fill on the same selector
    if (curr.type === 'fill' && next?.type === 'fill' && curr.selector === next.selector) {
      continue;
    }
    cleaned.push(curr);
  }
  return cleaned;
}

function buildPrompt(events: RecordedEvent[]): string {
  const eventList = events.map((e, i) =>
    `Step ${i + 1}: [${e.type.toUpperCase()}] selector="${e.selector || e.url}" value="${e.value || ''}" text="${e.text || ''}"`
  ).join('\n');

  return `
You are an expert Playwright automation engineer. 
Given the following recorded user interaction steps, generate a complete, production-ready TypeScript Playwright script.

RULES:
- Use \`page.locator()\` with best-effort stable selectors (prefer aria-label, data-testid, text, then CSS).
- Add \`await page.waitForLoadState('networkidle')\` after every navigation.
- Add \`await expect(locator).toBeVisible({ timeout: 10000 })\` before every click/fill.
- Extract any hardcoded values (usernames, messages) as typed function parameters.
- Add a top-level async function called \`runAutomation(page: Page)\`.
- Add proper error handling with try/catch.
- Do NOT use \`page.goto()\` for SPA navigations detected mid-session — use \`page.waitForURL()\` instead.
- Add a short JSDoc comment above the function explaining what this automation does.

RECORDED STEPS:
${eventList}

Respond with ONLY the TypeScript code. No markdown, no explanation.
`.trim();
}

export async function synthesizeScript(
  events: RecordedEvent[],
  apiKey?: string
): Promise<SynthesisResult> {
  if (!apiKey) {
    throw new Error('No OpenAI API key provided for script synthesis. Set OPENAI_API_KEY in .env.');
  }

  const cleaned = deduplicateEvents(events);
  if (cleaned.length === 0) {
    throw new Error('No events recorded. Please record at least one user interaction.');
  }

  const client = new OpenAI({ apiKey });
  const prompt = buildPrompt(cleaned);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are an expert Playwright automation engineer. Respond with TypeScript code only.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
  });

  const script = response.choices[0]?.message?.content ?? '';
  if (!script) throw new Error('LLM returned empty script');

  // Derive a filename from the starting domain
  const startUrl = cleaned[0]?.url ?? 'automation';
  let filename = 'automation';
  try {
    filename = new URL(startUrl).hostname.replace(/^www\./, '').replace(/\./g, '_');
  } catch {}

  return {
    script,
    filename: `${filename}_automation.spec.ts`,
    summary: `Generated automation script with ${cleaned.length} steps starting at ${startUrl}`,
  };
}
