/**
 * capability-map.ts
 * Data model for a structured capability — what an agent can DO with a piece of software.
 * WHY: A consistent schema lets us generate MCP tools, OpenAPI specs, and docs
 * from the same source of truth.
 */

import { z } from 'zod';

// Zod schema for a single parameter
export const ParameterSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  required: z.boolean(),
  enum: z.array(z.string()).optional(), // for select/radio fields
  example: z.string().optional(),
});

// Zod schema for a single capability
export const CapabilitySchema = z.object({
  id: z.string(), // e.g. "deals.create"
  name: z.string(), // e.g. "Create Deal"
  description: z.string(), // human + agent readable description
  category: z.string(), // e.g. "deals", "contacts", "reports"
  parameters: z.array(ParameterSchema),
  returns: z.object({
    description: z.string(),
    type: z.enum(['object', 'array', 'string', 'boolean', 'void']),
  }),
  riskLevel: z.enum(['safe', 'moderate', 'destructive']),
  requiresAuth: z.boolean(),
  sourceType: z.enum(['form', 'button', 'api', 'inferred']),
  sourceLocation: z.string(), // URL or selector where this was found
});

// Zod schema for the full capability map
export const CapabilityMapSchema = z.object({
  bridgeId: z.string(),
  targetUrl: z.string(),
  targetName: z.string(),
  generatedAt: z.string(),
  capabilities: z.array(CapabilitySchema),
  categories: z.array(z.string()),
  siteNavMap: z.record(z.string()).optional(),
});

export type Parameter = z.infer<typeof ParameterSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilityMap = z.infer<typeof CapabilityMapSchema>;
