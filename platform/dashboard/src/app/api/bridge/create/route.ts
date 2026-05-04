import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/bridge/create
 * Called by the browser extension to generate a bridge for a given URL.
 * In prod this queues a real crawl job. For now it registers the bridge immediately.
 */
export async function POST(req: NextRequest) {
  const { url, bridgeName } = await req.json();
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  const name = bridgeName || new URL(url).hostname.replace(/^www\./, '').replace(/\./g, '-');
  const endpoint = `https://mcp.agentbridge.io/b/${name}`;

  // In production: queue a crawl job, generate MCP server, deploy to cloud
  // For this MVP: respond immediately with the endpoint so the extension can install
  return NextResponse.json({ bridgeName: name, endpoint, status: 'queued' });
}
