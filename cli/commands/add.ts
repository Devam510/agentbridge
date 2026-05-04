/**
 * add.ts
 * CLI command: agentbridge add <service-or-url>
 *
 * WHY: Normal users should NEVER have to manually edit JSON config files.
 * This command does everything:
 *   1. Finds the correct Claude Desktop config path (works on Win/Mac/Linux, MSIX or standard)
 *   2. Generates or looks up the MCP server entry for the given service
 *   3. Patches the config file safely (parses JSON, adds entry, writes back)
 *   4. Tells the user to restart Claude Desktop — and offers to do it for them
 *
 * Usage:
 *   npx agentbridge add github
 *   npx agentbridge add notion
 *   npx agentbridge add https://any-website.com
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { KNOWN_SERVICES, patchAllConfigs, restartClaude } from '../../platform/companion/patcher.js';

// ── Main command ───────────────────────────────────────────────────────────
export const addCommand = new Command('add')
  .description('Add any service or website to Claude, Cursor, and Windsurf — no JSON editing required')
  .argument('<service>', 'Service name (github, notion, slack…) or any URL (https://…)')
  .option('--name <name>', 'Custom name for this bridge')
  .option('--restart', 'Automatically restart Claude Desktop after installing')
  .option('--token <token>', 'API token for services that require authentication')
  .action(async (service: string, options: Record<string, any>) => {

    console.log('\n' + chalk.bold.cyan('⚡ AgentBridge Add') + '\n');

    const isUrl = service.startsWith('http://') || service.startsWith('https://');
    const serviceKey = service.toLowerCase().replace(/[^a-z0-9]/g, '');
    const known = KNOWN_SERVICES[serviceKey];

    if (known) {
      // ── Known service: use pre-built entry ────────────────────────────
      const serverName = options.name || serviceKey;
      const entry = JSON.parse(JSON.stringify(known.entry)); // deep clone

      // Inject token if provided
      if (options.token && (entry as any).env) {
        const envKeys = Object.keys((entry as any).env);
        if (envKeys.length > 0) {
          (entry as any).env[envKeys[0]] = options.token;
        }
      }

      const installSpinner = ora(`Installing ${chalk.bold(service)} bridge…`).start();
      try {
        const patchedPaths = patchAllConfigs(serverName, entry);
        if (patchedPaths.length === 0) {
          installSpinner.fail('Could not find any AI client config (Claude/Cursor/Windsurf) to patch.');
          process.exit(1);
        }
        installSpinner.succeed(`${chalk.green('✅')} ${chalk.bold(service)} installed in ${patchedPaths.length} clients`);
      } catch (err: any) {
        installSpinner.fail(err.message);
        process.exit(1);
      }

      if (known.note) {
        console.log('\n' + chalk.yellow('⚠️  Action required:'));
        console.log(chalk.gray('  ' + known.note));

        // Check for empty token
        const entryEnv = (entry as any).env || {};
        const emptyKeys = Object.entries(entryEnv).filter(([, v]) => v === '').map(([k]) => k);
        if (emptyKeys.length > 0 && !options.token) {
          console.log('\n' + chalk.bold('Set your token with:'));
          console.log(chalk.cyan(`  npx agentbridge add ${service} --token YOUR_TOKEN_HERE`));
          console.log(chalk.gray('  This re-runs and updates the config automatically.\n'));
        }
      }

    } else if (isUrl) {
      // ── Unknown URL: run crawler + generator ──────────────────────────
      const hostname = new URL(service).hostname.replace(/^www\./, '');
      const serverName = options.name || hostname.replace(/\./g, '-');

      console.log(chalk.gray(`\nBridging: ${service}`));
      console.log(chalk.gray(`Server name: ${serverName}\n`));

      const crawlSpinner = ora('Crawling website…').start();
      try {
        // Run the existing create CLI to generate bridge
        const outputDir = path.resolve('./bridges', serverName);
        childProcess.execSync(
          `npx tsx "${path.resolve('./cli/index.ts')}" create "${service}" --name "${serverName}"`,
          { stdio: 'pipe' }
        );
        crawlSpinner.succeed('Bridge generated');

        // Patch config to use the local server
        const serverPath = path.join(outputDir, 'server.ts');
        const tsxPath = require.resolve('tsx/cli');
        const entry = {
          command: 'node',
          args: [tsxPath, serverPath],
          env: {},
        };

        const patchedPaths = patchAllConfigs(serverName, entry);
        if (patchedPaths.length === 0) {
           console.log(chalk.red('Could not find any AI client config to patch.'));
           process.exit(1);
        }
        console.log(chalk.green(`✅ Bridge installed as "${serverName}" in ${patchedPaths.length} clients`));
      } catch (err: any) {
        crawlSpinner.fail(`Could not generate bridge: ${err.message}`);
        console.log(chalk.gray('Try: npx agentbridge create ' + service + ' --name ' + serverName));
        process.exit(1);
      }

    } else if (fs.existsSync(path.resolve('./bridges', service))) {
      // ── Local Bridge: install directly ────────────────────────────────
      const serverName = options.name || service;
      const installSpinner = ora(`Installing local bridge ${chalk.bold(service)}…`).start();
      
      const serverPath = path.resolve('./bridges', service, 'server.ts');
      const tsxPath = require.resolve('tsx/cli');
      const entry = {
        command: 'node',
        args: [tsxPath, serverPath],
        env: {},
      };

      try {
        const patchedPaths = patchAllConfigs(serverName, entry);
        if (patchedPaths.length === 0) {
          installSpinner.fail('Could not find any AI client config to patch.');
          process.exit(1);
        }
        installSpinner.succeed(`${chalk.green('✅')} Bridge installed as "${serverName}" in ${patchedPaths.length} clients`);
      } catch (err: any) {
        installSpinner.fail(err.message);
        process.exit(1);
      }

    } else {
      // Unknown service name
      console.log(chalk.red(`✗ Unknown service or URL: "${service}"\n`));
      console.log(chalk.bold('Available pre-built services:'));
      Object.keys(KNOWN_SERVICES).forEach(k => {
        console.log(chalk.gray(`  agentbridge add ${k}`));
      });
      console.log(chalk.gray(`\nOr pass a URL to auto-generate a bridge:`));
      console.log(chalk.cyan(`  npx agentbridge add https://${service}.com`));
      process.exit(1);
    }

    // Step 3: Restart or prompt
    if (options.restart) {
      const restartSpinner = ora('Restarting AI clients…').start();
      restartClaude();
      restartSpinner.succeed('Clients restarted…');
    } else {
      console.log('\n' + chalk.bold('Last step:'));
      console.log(chalk.gray('  Quit and reopen Claude Desktop/Cursor/Windsurf — your bridge will connect automatically.\n'));
      console.log(chalk.dim('  Tip: Add --restart to this command to do it automatically next time.'));
    }

    console.log();
  });
