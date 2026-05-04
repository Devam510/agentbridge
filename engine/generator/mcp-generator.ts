/**
 * mcp-generator.ts
 * Generates a production-ready MCP server from a CapabilityMap.
 * WHY: The MCP server is the product — it's what agents actually call.
 * We generate TypeScript code from the capability map as the source of truth.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CapabilityMap, Capability, Parameter } from '../inferrer/capability-map.js';

function toFunctionName(id: string): string {
  // "deals.move_stage" → "dealsMoveStage"
  return id
    .replace(/\./g, '_')
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Converts capability ID to a valid MCP tool name.
 * Claude Desktop requires: ^[a-zA-Z0-9_-]{1,64}$  (no dots allowed)
 * "general.read_page" → "general_read_page"
 */
function toToolName(id: string): string {
  return id.replace(/\./g, '_').slice(0, 64);
}

function zodTypeFromParam(param: Parameter): string {
  if (param.enum && param.enum.length > 0) {
    return `z.enum([${param.enum.map((e) => `'${e}'`).join(', ')}])`;
  }
  switch (param.type) {
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'array':
      return 'z.array(z.string())';
    case 'object':
      return 'z.record(z.unknown())';
    default:
      return 'z.string()';
  }
}

function generateParamShape(params: Parameter[]): string {
  if (params.length === 0) return '{}';

  const fields = params.map((p) => {
    const zodType = zodTypeFromParam(p);
    const withDescription = `${zodType}.describe('${p.description.replace(/'/g, "\'")}')  `;
    return `    ${p.name}: ${p.required ? withDescription : `${withDescription}.optional()`},`;
  });

  return `{\n${fields.join('\n')}\n  }`;
}

function generateToolCode(cap: Capability, index: number, bridgeId: string): string {
  const shape = generateParamShape(cap.parameters);
  // Tool name must match ^[a-zA-Z0-9_-]{1,64}$ — dots not allowed by Claude Desktop
  const toolName = toToolName(cap.id);

  return `
  // Tool ${index + 1}: ${cap.name} | Risk: ${cap.riskLevel} | Source: ${cap.sourceType}
  server.tool(
    '${toolName}',
    ${shape},
    async (params) => {
      const start = Date.now();
      let success = false;
      let executionPath: 'api' | 'browser' | 'error' = 'error';
      try {
        const result = await executor.execute({
          capabilityId: '${cap.id}',
          params: params as Record<string, unknown>,
          riskLevel: '${cap.riskLevel}',
        });
        success = true;
        executionPath = (result as any).executionPath ?? 'browser';
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: String(err) }] };
      } finally {
        // Record every real agent action for the dashboard
        await recordAction({
          agentId: 'claude-desktop',
          bridgeId: '${bridgeId}',
          capabilityId: '${cap.id}',
          executionPath,
          latencyMs: Date.now() - start,
          success,
        }).catch(() => { /* non-fatal */ });
      }
    },
  );`;
}

function generateServerCode(capMap: CapabilityMap): string {
  return `/**
 * AgentBridge MCP Server — ${capMap.targetName}
 * Generated at: ${capMap.generatedAt}
 * Target: ${capMap.targetUrl}
 * Capabilities: ${capMap.capabilities.length}
 * 
 * AUTO-GENERATED — do not edit manually.
 * To regenerate: npx agentbridge create ${capMap.targetUrl}
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BridgeExecutor } from '../../engine/executor/browser-executor.js';
import { recordAction } from '../../platform/metering/meter.js';

const server = new McpServer({
  name: '${capMap.bridgeId}',
  version: '1.0.0',
});

const executor = new BridgeExecutor({
  targetUrl: '${capMap.targetUrl}',
  capabilityMap: ${JSON.stringify(capMap, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n')},
});

// ============================================================
// TOOLS (${capMap.capabilities.length} capabilities)
// ============================================================
${capMap.capabilities.map((cap, i) => generateToolCode(cap, i, capMap.bridgeId)).join('\n')}

export { server };

// Start the server (local stdio mode only)
async function main(): Promise<void> {
  if (process.env.CLOUD_MODE === 'true') {
    // In cloud mode, the mcp-proxy will handle transport
    return;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentBridge MCP Server running for: ${capMap.targetName}');
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
`;
}

/**
 * Write the generated MCP server to disk.
 * Creates the bridge directory if it doesn't exist.
 */
export async function generateMCPServer(
  capMap: CapabilityMap,
  outputDir: string,
): Promise<string> {
  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  const serverPath = path.join(outputDir, 'server.ts');
  const code = generateServerCode(capMap);

  fs.writeFileSync(serverPath, code, 'utf-8');

  // Write capability map as JSON for runtime use
  const mapPath = path.join(outputDir, 'capabilities.json');
  fs.writeFileSync(mapPath, JSON.stringify(capMap, null, 2), 'utf-8');

  return serverPath;
}
