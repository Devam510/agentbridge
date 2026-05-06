/**
 * llm-analyzer.ts
 * Sends crawl data to OpenAI and extracts a structured capability map.
 * WHY: LLMs understand intent from UI context — they can infer "create_deal" 
 * from a form with fields "Name", "Stage", "Value" better than regex can.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { SiteCrawlResult } from '../crawler/site-crawler.js';
import { CapabilitySchema, CapabilityMap, CapabilityMapSchema } from './capability-map.js';

// Raw LLM response before validation
const LLMCapabilityResponseSchema = z.object({
  targetName: z.string(),
  capabilities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      parameters: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          type: z.string(),
          required: z.boolean(),
          enum: z.array(z.string()).optional(),
          example: z.string().optional(),
        }),
      ),
      returns: z.object({
        description: z.string(),
        type: z.string(),
      }),
      riskLevel: z.string(),
      requiresAuth: z.boolean(),
      sourceType: z.string(),
      sourceLocation: z.string(),
    }),
  ),
});

function buildPrompt(crawlResult: SiteCrawlResult): string {
  // Build a compact summary of crawl data — avoid sending full HTML
  const pageSummaries = crawlResult.pages.slice(0, 10).map((p) => ({
    url: p.page.url,
    title: p.page.title,
    sections: p.page.sections.slice(0, 5).map((s) => s.heading),
    forms: p.forms.map((f) => ({
      purpose: f.purpose,
      fields: f.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.options,
      })),
      submitText: f.submitButtonText,
    })),
    actions: p.actions
      .filter((a) => a.riskLevel !== 'safe' || a.type === 'button')
      .slice(0, 10)
      .map((a) => ({ text: a.text, risk: a.riskLevel })),
  }));

  return `You are analyzing a web application to extract its capabilities for AI agent use.

Target URL: ${crawlResult.baseUrl}

Here is the crawled structure of the application:
${JSON.stringify(pageSummaries, null, 2)}

Your task:
1. Identify all meaningful capabilities an AI agent can perform on this software
2. Group them by category (e.g., "contacts", "deals", "reports")
3. For each capability, define the parameters an agent needs to provide
4. Classify risk: "safe" (read/search), "moderate" (create/update), "destructive" (delete/cancel)

Rules:
- Use snake_case for capability IDs (e.g., "contacts.create", "deals.move_stage")
- Parameter types must be one of: string, number, boolean, array, object
- Risk must be one of: safe, moderate, destructive
- SourceType must be one of: form, button, api, inferred
- Do NOT include login/signup capabilities
- Do NOT include navigation-only capabilities
- DO infer non-obvious capabilities from UI patterns

Respond with valid JSON only, matching this structure:
{
  "targetName": "Name of the software",
  "capabilities": [
    {
      "id": "category.action",
      "name": "Human readable name",
      "description": "What this does and when to use it",
      "category": "category",
      "parameters": [
        { "name": "param", "description": "what it is", "type": "string", "required": true }
      ],
      "returns": { "description": "what is returned", "type": "object" },
      "riskLevel": "safe|moderate|destructive",
      "requiresAuth": true,
      "sourceType": "form|button|api|inferred",
      "sourceLocation": "url or selector"
    }
  ]
}`;
}

/**
 * Analyze crawl results using LLM and return a validated capability map.
 * Throws if the LLM response cannot be parsed or validated.
 */
export async function analyzeWithLLM(
  crawlResult: SiteCrawlResult,
  bridgeId: string,
): Promise<CapabilityMap> {
  const openAiKey = process.env.OPENAI_API_KEY;
  const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  let rawContent = '';

  if (!openAiKey && !grokKey && !groqKey) {
    console.warn('\n⚠️ No API Key found. Falling back to heuristic/mock generation mode.');
    // Generate a free deterministic fallback based on the crawl results directly.
    const capabilities = [];
    
    // Add a basic page reader capability
    capabilities.push({
      id: 'general.read_page',
      name: 'Read Main Page',
      description: 'Reads content from the main page',
      category: 'general',
      parameters: [],
      returns: { description: 'Page contents', type: 'object' },
      riskLevel: 'safe',
      requiresAuth: false,
      sourceType: 'inferred',
      sourceLocation: crawlResult.pages[0]?.page.url || crawlResult.baseUrl,
    });

    // Parse forms heuristically
    if (crawlResult.pages[0]?.forms) {
      crawlResult.pages[0].forms.forEach((form, i) => {
        capabilities.push({
          id: `data.submit_form_${i}`,
          name: form.purpose || 'Submit Form',
          description: `Submit form: ${form.purpose}`,
          category: 'data',
          parameters: form.fields.map(f => ({
            name: f.name,
            description: f.label || `Field ${f.name}`,
            type: f.type === 'number' ? 'number' : f.type === 'checkbox' ? 'boolean' : 'string',
            required: f.required
          })),
          returns: { description: 'Submission result', type: 'object' },
          riskLevel: 'moderate',
          requiresAuth: false,
          sourceType: 'form',
          sourceLocation: crawlResult.pages[0].page.url,
        });
      });
    }

    const mockResponse = {
      targetName: 'Local App (Mocked)',
      capabilities
    };
    rawContent = JSON.stringify(mockResponse);
    
  } else {
    // LLM mode
    const isGrok = !!grokKey;
    const isGroq = !!groqKey;
    
    let baseURL = undefined;
    let apiKey = openAiKey;
    let model = 'gpt-4o';

    if (isGroq) {
      baseURL = 'https://api.groq.com/openai/v1';
      apiKey = groqKey;
      model = 'llama-3.3-70b-versatile';
    } else if (isGrok) {
      baseURL = 'https://api.x.ai/v1';
      apiKey = grokKey;
      model = 'grok-beta';
    }

    const client = new OpenAI({ apiKey, baseURL });
    
    const prompt = buildPrompt(crawlResult);

    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a software analyst that extracts structured capabilities from web applications for AI agent use. Always respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      rawContent = response.choices[0]?.message?.content ?? '';
      if (!rawContent) {
        throw new Error('LLM returned empty response');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`LLM API call failed: ${message}`);
    }
  }

  // Parse and validate LLM response (or mock)
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`LLM returned invalid JSON. Raw: ${rawContent.slice(0, 200)}`);
  }

  const validated = LLMCapabilityResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`LLM response failed schema validation: ${validated.error.message}`);
  }

  // Validate each capability with the strict Capability schema
  const validCapabilities = validated.data.capabilities
    .map((cap) => CapabilitySchema.safeParse(cap))
    .filter((r) => r.success)
    .map((r) => (r as { success: true; data: z.infer<typeof CapabilitySchema> }).data);

  const categories = [...new Set(validCapabilities.map((c) => c.category))];

  const capabilityMap: CapabilityMap = {
    bridgeId,
    targetUrl: crawlResult.baseUrl,
    targetName: validated.data.targetName,
    generatedAt: new Date().toISOString(),
    capabilities: validCapabilities,
    categories,
    siteNavMap: crawlResult.siteNavMap,
  };

  // Final validation of complete map
  return CapabilityMapSchema.parse(capabilityMap);
}
