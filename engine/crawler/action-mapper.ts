/**
 * action-mapper.ts
 * Maps all interactive action elements on a page (buttons, action links).
 * WHY: Buttons represent ACTIONS agents can take. We need to know what actions exist
 * before generating tools for them.
 */

import { Page } from 'playwright';

export interface MappedAction {
  id: string;
  text: string;
  type: 'button' | 'link' | 'icon-button';
  selector: string; // CSS selector to locate this element
  href?: string; // if it's a link
  riskLevel: 'safe' | 'moderate' | 'destructive';
  // safe = read/navigate, moderate = create/update, destructive = delete/cancel
}

const DESTRUCTIVE_KEYWORDS = ['delete', 'remove', 'cancel', 'disable', 'revoke', 'terminate'];
const MODERATE_KEYWORDS = [
  'save',
  'update',
  'edit',
  'create',
  'add',
  'submit',
  'send',
  'publish',
  'post',
  'apply',
];

function inferRiskLevel(text: string): 'safe' | 'moderate' | 'destructive' {
  const lower = text.toLowerCase();
  if (DESTRUCTIVE_KEYWORDS.some((k) => lower.includes(k))) return 'destructive';
  if (MODERATE_KEYWORDS.some((k) => lower.includes(k))) return 'moderate';
  return 'safe';
}

/**
 * Map all clickable action elements on a page.
 * Does not click anything — read-only analysis.
 */
export async function mapActions(page: Page): Promise<MappedAction[]> {
  const actions = await page.evaluate(
    ({
      destructiveKeywords,
      moderateKeywords,
    }: {
      destructiveKeywords: string[];
      moderateKeywords: string[];
    }): Omit<MappedAction, 'riskLevel'>[] => {
      const results: Omit<MappedAction, 'riskLevel'>[] = [];

      // Find all buttons
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      buttons.forEach((btn, i) => {
        const text = btn.textContent?.trim() ?? btn.getAttribute('aria-label') ?? '';
        if (text.length === 0) return; // skip empty buttons

        const id = btn.id || `btn_${i}`;
        const selector = btn.id ? `#${btn.id}` : `button:nth-of-type(${i + 1})`;

        results.push({
          id,
          text: text.slice(0, 100),
          type: 'button',
          selector,
        });
      });

      // Find action links (not navigation — links with verbs)
      const actionVerbs = [...destructiveKeywords, ...moderateKeywords, 'view', 'open', 'export'];
      const links = Array.from(document.querySelectorAll('a[href]'));
      links.forEach((link, i) => {
        const text = link.textContent?.trim() ?? '';
        const lower = text.toLowerCase();
        if (!actionVerbs.some((v) => lower.includes(v))) return; // only action links

        const href = (link as HTMLAnchorElement).href;
        results.push({
          id: link.id || `action_link_${i}`,
          text: text.slice(0, 100),
          type: 'link',
          selector: link.id ? `#${link.id}` : `a[href="${href}"]`,
          href,
        });
      });

      return results.slice(0, 100); // cap at 100 actions per page
    },
    { destructiveKeywords: DESTRUCTIVE_KEYWORDS, moderateKeywords: MODERATE_KEYWORDS },
  );

  // Add risk level (done outside evaluate for clean separation)
  return actions.map((a) => ({
    ...a,
    riskLevel: inferRiskLevel(a.text),
  }));
}
