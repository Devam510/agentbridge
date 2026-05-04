import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { getCloudBridge } from './bridge-registry.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Track active transports by bridgeId
// In a real multi-tenant cloud, we would need to track sessions,
// but for this MVP, one transport per bridge is enough.
const activeTransports = new Map<string, SSEServerTransport>();

app.get('/b/:bridgeId/sse', async (req: Request, res: Response) => {
  const bridgeId = req.params.bridgeId as string;
  
  // Verify bridge is registered
  const record = getCloudBridge(bridgeId);
  if (!record || record.status !== 'active') {
    res.status(404).send('Bridge not found or inactive');
    return;
  }

  try {
    // Dynamically import the bridge's server file
    const bridgePath = path.resolve(__dirname, 'hosted-bridges', bridgeId, 'server.ts');
    
    if (!fs.existsSync(bridgePath)) {
      res.status(404).send('Bridge code not found');
      return;
    }

    // Load the module (with CLOUD_MODE so it doesn't start stdio)
    process.env.CLOUD_MODE = 'true';
    const bridgeModule = await import(`file://${bridgePath}`);
    const server = bridgeModule.server;

    if (!server) {
      res.status(500).send('Bridge does not export an MCP server instance');
      return;
    }

    // Set up SSE Transport
    const transport = new SSEServerTransport('/b/' + bridgeId + '/message', res as any);
    activeTransports.set(bridgeId, transport);

    // Connect the bridge's server to the SSE transport
    await server.connect(transport);
    
    console.log(`[Cloud] Bridge ${bridgeId} SSE connection established`);

    // Handle disconnect
    req.on('close', () => {
      console.log(`[Cloud] Bridge ${bridgeId} SSE connection closed`);
      activeTransports.delete(bridgeId);
    });

  } catch (error) {
    console.error(`[Cloud] Error loading bridge ${bridgeId}:`, error);
    res.status(500).send('Internal error loading bridge');
  }
});

app.post('/b/:bridgeId/message', async (req: Request, res: Response) => {
  const bridgeId = req.params.bridgeId as string;
  const transport = activeTransports.get(bridgeId);
  
  if (!transport) {
    res.status(404).send('No active SSE connection for this bridge');
    return;
  }

  // Handle incoming JSON-RPC messages from Claude
  try {
    await transport.handlePostMessage(req as any, res as any);
  } catch (err) {
    console.error(`[Cloud] Error handling message for ${bridgeId}:`, err);
    res.status(500).send('Message handling error');
  }
});

export function startCloudProxy() {
  app.listen(PORT, () => {
    console.log(`[Cloud] AgentBridge MCP Proxy running on http://localhost:${PORT}`);
  });
}

// Auto-start if run directly
if (require.main === module) {
  startCloudProxy();
}
