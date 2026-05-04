/**
 * remapper.ts
 * Automatically repairs broken capabilities by re-crawling the specific area.
 * WHY: Self-healing systems shouldn't require humans. If a form moves, we find it.
 */

import { Capability, CapabilityMap } from '../inferrer/capability-map.js';
import { crawlSite } from '../crawler/site-crawler.js';
import { analyzeWithLLM } from '../inferrer/llm-analyzer.js';

export interface RemapResult {
  success: boolean;
  repairedCapability?: Capability;
  errorMessage?: string;
}

/**
 * Attempts to repair a broken capability by performing a localized re-crawl.
 */
export async function remapCapability(
  bridgeId: string,
  brokenCapability: Capability, 
  fullMap: CapabilityMap
): Promise<RemapResult> {
  // We re-crawl a limited scope: starting near where the capability used to be.
  // If it moved completely, a wider re-crawl is needed.
  try {
    const targetUrl = brokenCapability.sourceLocation.startsWith('http')
      ? brokenCapability.sourceLocation
      : `${fullMap.targetUrl}${brokenCapability.sourceLocation}`;
      
    // Shallow crawl (max 2 pages) starting from the broken location
    const crawlResult = await crawlSite(targetUrl, { maxPages: 2, headless: true });
    
    // Pass the crawl result to LLM, but ask specifically to find the broken intent
    // (We reuse analyzeWithLLM for now, which gives us a full map of the local area)
    const partialMap = await analyzeWithLLM(crawlResult, bridgeId);
    
    // Look for a capability that matches the intent (same category and similar parameters)
    // Heuristic: matching category and at least 50% of required parameters overlap
    const requiredParams = brokenCapability.parameters.filter(p => p.required).map(p => p.name);
    
    let bestMatch: Capability | undefined = undefined;
    let highestScore = 0;

    for (const cap of partialMap.capabilities) {
      if (cap.category !== brokenCapability.category) continue;

      const capRequiredParams = cap.parameters.filter(p => p.required).map(p => p.name);
      
      // Calculate overlap score
      const overlap = capRequiredParams.filter(p => requiredParams.includes(p)).length;
      const score = requiredParams.length === 0 ? 1 : overlap / requiredParams.length;

      // Ensure risk levels roughly match to avoid accidental destructive escalation
      if (score > highestScore && cap.riskLevel === brokenCapability.riskLevel) {
        highestScore = score;
        bestMatch = cap;
      }
    }

    if (bestMatch && highestScore >= 0.5) {
      // Keep original ID to not break agents, but update the underlying mapping
      return {
        success: true,
        repairedCapability: {
          ...bestMatch,
          id: brokenCapability.id, // Preserve ID
          name: brokenCapability.name, // Preserve original name
        }
      };
    }

    return {
      success: false,
      errorMessage: 'Could not find a replacement capability matching the required intent.',
    };

  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
