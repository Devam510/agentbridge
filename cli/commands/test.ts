/**
 * test.ts
 * CLI command: agentbridge test <bridge-name>
 * Tests all capabilities in a generated bridge against a real execution.
 * WHY: Agents need to know which capabilities are working before using them.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { CapabilityMapSchema } from '../../engine/inferrer/capability-map.js';
import { BridgeExecutor } from '../../engine/executor/browser-executor.js';

interface TestResult {
  capabilityId: string;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  latencyMs: number;
  errorMessage?: string;
  executionPath?: string;
}

export const testCommand = new Command('test')
  .description('Test all capabilities in a generated bridge')
  .argument('<bridge-name>', 'Name of the bridge to test')
  .option('--output <dir>', 'Bridge output directory', './bridges')
  .option('--only <category>', 'Only test capabilities in this category')
  .option('--dry-run', 'Check if bridge files exist without executing', false)
  .action(async (bridgeName: string, options: Record<string, string | boolean>) => {
    console.log('\n' + chalk.bold.cyan('⚡ AgentBridge Test') + '\n');

    const outputDir = path.resolve(options.output as string, bridgeName);
    const capMapPath = path.join(outputDir, 'capabilities.json');

    // Check bridge exists
    if (!fs.existsSync(capMapPath)) {
      console.error(chalk.red(`✗ Bridge not found: ${outputDir}`));
      console.error(chalk.gray(`  Run: npx agentbridge create <url> --name ${bridgeName}`));
      process.exit(1);
    }

    // Load capability map
    let capMap;
    try {
      const raw = JSON.parse(fs.readFileSync(capMapPath, 'utf-8')) as unknown;
      capMap = CapabilityMapSchema.parse(raw);
    } catch (err) {
      console.error(chalk.red(`✗ Invalid capability map: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }

    // Filter by category if requested
    let capabilities = capMap.capabilities;
    if (options.only) {
      capabilities = capabilities.filter((c) => c.category === options.only);
      if (capabilities.length === 0) {
        console.error(chalk.red(`✗ No capabilities found in category: ${String(options.only)}`));
        process.exit(1);
      }
    }

    console.log(chalk.bold(`Bridge: ${capMap.targetName}`));
    console.log(chalk.gray(`Target: ${capMap.targetUrl}`));
    console.log(chalk.gray(`Testing: ${capabilities.length} capabilities\n`));
    console.log(chalk.gray('─'.repeat(60)));

    if (options['dry-run']) {
      // Just verify files exist
      const files = ['server.ts', 'openapi.json', 'agent-card.json', 'capabilities.json'];
      let allExist = true;
      for (const file of files) {
        const exists = fs.existsSync(path.join(outputDir, file));
        console.log(`  ${exists ? chalk.green('✓') : chalk.red('✗')} ${file}`);
        if (!exists) allExist = false;
      }
      console.log(chalk.gray('─'.repeat(60)));
      console.log(allExist ? chalk.green('\n✅ All bridge files present\n') : chalk.red('\n❌ Missing files\n'));
      process.exit(allExist ? 0 : 1);
    }

    const results: TestResult[] = [];
    const executor = new BridgeExecutor({ targetUrl: capMap.targetUrl, capabilityMap: capMap });

    for (const cap of capabilities) {
      const spinner = ora({ text: `Testing: ${chalk.cyan(cap.id)}`, prefixText: '  ' }).start();

      // Build minimal test params (use examples or defaults)
      const testParams: Record<string, unknown> = {};
      for (const param of cap.parameters) {
        if (!param.required) continue;
        if (param.example) {
          testParams[param.name] = param.example;
        } else if (param.enum && param.enum.length > 0) {
          testParams[param.name] = param.enum[0];
        } else {
          switch (param.type) {
            case 'number':
              testParams[param.name] = 1;
              break;
            case 'boolean':
              testParams[param.name] = false;
              break;
            default:
              testParams[param.name] = `test_${param.name}`;
          }
        }
      }

      // Skip destructive capabilities in automated tests
      if (cap.riskLevel === 'destructive') {
        spinner.warn(chalk.yellow(`SKIP ${cap.id} — destructive (run manually)`));
        results.push({ capabilityId: cap.id, name: cap.name, status: 'skip', latencyMs: 0 });
        continue;
      }

      try {
        const result = await executor.execute({
          capabilityId: cap.id,
          params: testParams,
          riskLevel: cap.riskLevel,
        });

        if (result.success) {
          spinner.succeed(
            `${chalk.green('PASS')} ${cap.id}` +
              chalk.gray(` — ${result.latencyMs}ms via ${result.executionPath}`),
          );
          results.push({
            capabilityId: cap.id,
            name: cap.name,
            status: 'pass',
            latencyMs: result.latencyMs,
            executionPath: result.executionPath,
          });
        } else {
          spinner.fail(
            `${chalk.red('FAIL')} ${cap.id}` +
              chalk.gray(` — ${result.errorMessage ?? 'Unknown error'}`),
          );
          results.push({
            capabilityId: cap.id,
            name: cap.name,
            status: 'fail',
            latencyMs: result.latencyMs,
            errorMessage: result.errorMessage,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        spinner.fail(`${chalk.red('FAIL')} ${cap.id} — ${msg}`);
        results.push({ capabilityId: cap.id, name: cap.name, status: 'fail', latencyMs: 0, errorMessage: msg });
      }
    }

    await executor.cleanup();

    // Summary
    const passed = results.filter((r) => r.status === 'pass').length;
    const failed = results.filter((r) => r.status === 'fail').length;
    const skipped = results.filter((r) => r.status === 'skip').length;

    console.log('\n' + chalk.gray('─'.repeat(60)));
    console.log(chalk.bold('Test Summary'));
    console.log(`  ${chalk.green('✓ Passed:')}  ${passed}`);
    console.log(`  ${chalk.red('✗ Failed:')}  ${failed}`);
    console.log(`  ${chalk.yellow('○ Skipped:')} ${skipped} (destructive)`);
    console.log(chalk.gray('─'.repeat(60)));

    if (failed > 0) {
      console.log(chalk.red(`\n❌ ${failed} test(s) failed\n`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\n✅ All tests passed (${passed} pass, ${skipped} skip)\n`));
      process.exit(0);
    }
  });
