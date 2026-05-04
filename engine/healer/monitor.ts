/**
 * monitor.ts
 * Periodic health checker for bridges.
 * Orchestrates change-detector and remapper.
 */

import * as fs from 'fs';
import * as path from 'path';
import { launchBrowser, BrowserSession } from '../crawler/browser-launcher.js';
import { detectChange } from './change-detector.js';
import { remapCapability } from './remapper.js';
import { CapabilityMapSchema, CapabilityMap } from '../inferrer/capability-map.js';

export interface MonitorReport {
  bridgeId: string;
  totalCapabilities: number;
  brokenCapabilities: number;
  healedCapabilities: number;
  failedToHeal: number;
  alerts: string[];
}

export async function checkBridgeHealth(
  bridgeId: string, 
  bridgeDir: string
): Promise<MonitorReport> {
  const capMapPath = path.join(bridgeDir, 'capabilities.json');
  
  if (!fs.existsSync(capMapPath)) {
    throw new Error(`Bridge ${bridgeId} not found at ${bridgeDir}`);
  }

  const rawMap = JSON.parse(fs.readFileSync(capMapPath, 'utf-8'));
  const capMap: CapabilityMap = CapabilityMapSchema.parse(rawMap);

  const report: MonitorReport = {
    bridgeId,
    totalCapabilities: capMap.capabilities.length,
    brokenCapabilities: 0,
    healedCapabilities: 0,
    failedToHeal: 0,
    alerts: [],
  };

  let session: BrowserSession | null = null;

  try {
    session = await launchBrowser({ headless: true, timeout: 30000 });
    const page = session.page;

    let hasChanges = false;
    const newCapabilities = [];

    for (const cap of capMap.capabilities) {
      // 1. Detect Change
      const detection = await detectChange(page, cap, capMap.targetUrl);
      
      if (detection.isBroken) {
        report.brokenCapabilities++;
        report.alerts.push(`Capability ${cap.id} is BROKEN: ${detection.reason}`);

        // 2. Attempt Remap
        const remapResult = await remapCapability(bridgeId, cap, capMap);
        
        if (remapResult.success && remapResult.repairedCapability) {
          report.healedCapabilities++;
          report.alerts.push(`Capability ${cap.id} was successfully HEALED.`);
          newCapabilities.push(remapResult.repairedCapability);
          hasChanges = true;
        } else {
          report.failedToHeal++;
          report.alerts.push(`Capability ${cap.id} FAILED TO HEAL: ${remapResult.errorMessage}`);
          // Keep the old one (maybe it was a transient error, or we let the agents fail gracefully later)
          newCapabilities.push(cap); 
        }
      } else {
        // Unbroken
        newCapabilities.push(cap);
      }
    }

    if (hasChanges) {
      // 3. Save new mapping if changes occurred
      capMap.capabilities = newCapabilities;
      fs.writeFileSync(capMapPath, JSON.stringify(capMap, null, 2), 'utf-8');
      
      // We would also trigger a regeneration of server.ts and docs here if needed
      // (For now, we just update capabilities.json)
      report.alerts.push('capabilities.json has been updated.');
    }

  } catch (err) {
    report.alerts.push(`Monitor failed with error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (session) {
      await session.close();
    }
  }

  return report;
}
