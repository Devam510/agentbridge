import * as fs from 'fs';
import * as path from 'path';
import { registerCloudBridge } from './bridge-registry.js';

const HOSTED_DIR = path.resolve(__dirname, 'hosted-bridges');

export interface DeployResult {
  bridgeId: string;
  endpoint: string;
  status: string;
}

/**
 * Deploys a locally generated bridge to the "cloud".
 * In prod, this bundles and uploads to serverless functions.
 * For now, it copies to the hosted-bridges directory and registers it.
 */
export async function deployToCloud(bridgeId: string, userId: string = 'demo-user', tenantId: string = 'tenant-1'): Promise<DeployResult> {
  // Find local bridge
  const projectRoot = path.resolve(__dirname, '../../');
  const sourceDir = path.join(projectRoot, 'bridges', bridgeId);
  
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Bridge ${bridgeId} not found locally. Run create/generate first.`);
  }

  // Create cloud destination
  const destDir = path.join(HOSTED_DIR, bridgeId);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Copy files
  const files = fs.readdirSync(sourceDir);
  for (const file of files) {
    fs.copyFileSync(
      path.join(sourceDir, file),
      path.join(destDir, file)
    );
  }

  // Register in DB
  const record = registerCloudBridge(bridgeId, userId, tenantId);

  return {
    bridgeId: record.bridgeId,
    endpoint: record.endpoint,
    status: record.status
  };
}
