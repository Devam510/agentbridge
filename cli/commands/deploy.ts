/**
 * deploy.ts
 * CLI command: agentbridge deploy <bridge-name>
 * Deploys a generated bridge locally (dev) or to cloud (prod).
 * WHY: Generating the bridge is step 1. Agents need it running at an accessible URL.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { deployToCloud } from '../../platform/cloud/bridge-deployer.js';

export const deployCommand = new Command('deploy')
  .description('Deploy a generated bridge so agents can connect to it')
  .argument('<bridge-name>', 'Name of the bridge to deploy')
  .option('--output <dir>', 'Bridge output directory', './bridges')
  .option('--port <number>', 'Local port to run on', '3000')
  .option('--mode <mode>', 'Deploy mode: local | cloud', 'local')
  .option('--cloud', 'Deploy to cloud (AgentBridge hosted)')
  .action(async (bridgeName: string, options: Record<string, any>) => {
    console.log('\n' + chalk.bold.cyan('⚡ AgentBridge Deploy') + '\n');

    const outputDir = path.resolve(options.output, bridgeName);
    const serverPath = path.join(outputDir, 'server.ts');

    // Validate bridge exists
    if (!fs.existsSync(serverPath)) {
      console.error(chalk.red(`✗ Bridge not found: ${serverPath}`));
      console.error(chalk.gray(`  Run: npx agentbridge create <url> --name ${bridgeName}`));
      process.exit(1);
    }

    const mode = options.mode;
    const port = parseInt(options.port, 10);

    if (mode === 'local') {
      console.log(chalk.bold('Mode: Local (stdio MCP server)'));
      console.log(chalk.gray(`Bridge: ${bridgeName}`));
      console.log(chalk.gray(`Server: ${serverPath}`));
      console.log(chalk.gray('─'.repeat(50)));

      console.log('\n' + chalk.bold('🚀 Starting bridge...\n'));

      // Resolve tsx binary — prefer local, fall back to npx
      const tsxBin = path.resolve('node_modules', '.bin', 'tsx');
      const tsxExists = fs.existsSync(tsxBin) || fs.existsSync(tsxBin + '.cmd');
      const runnerDisplay = tsxExists ? tsxBin : 'npx tsx';

      console.log(chalk.gray(`Run this command to connect your MCP client:`));
      console.log(
        chalk.cyan(`\n  ${runnerDisplay} ${path.relative(process.cwd(), serverPath)}\n`),
      );

      console.log(chalk.bold('📋 Claude Desktop config:'));
      console.log(chalk.gray('─'.repeat(50)));
      const mcpConfig = {
        mcpServers: {
          [bridgeName]: {
            command: 'npx',
            args: ['tsx', path.relative(process.cwd(), serverPath)],
            env: {},
          },
        },
      };
      console.log(JSON.stringify(mcpConfig, null, 2));
      console.log(chalk.gray('─'.repeat(50)));

      console.log(chalk.bold('\n📋 Cursor / Windsurf config:'));
      console.log(chalk.gray('─'.repeat(50)));
      const cursorConfig = {
        mcp: {
          servers: {
            [bridgeName]: {
              command: 'npx',
              args: ['tsx', path.relative(process.cwd(), serverPath)],
            },
          },
        },
      };
      console.log(JSON.stringify(cursorConfig, null, 2));
      console.log(chalk.gray('─'.repeat(50)));

      // WHY: MCP stdio servers are launched BY the client (Claude Desktop / Cursor),
      // not standalone. Spawning them ourselves gives them an empty stdin → immediate EOF → exit.
      // The correct UX is to print the config and let the user paste it into their MCP client.
      console.log(chalk.green('\n✅ Bridge is ready to connect!\n'));
      console.log(chalk.bold('How to use:'));
      console.log(chalk.gray('  1. Copy the config above for your MCP client'));
      console.log(chalk.gray('  2. Paste it into Claude Desktop → Settings → Developer → MCP Servers'));
      console.log(chalk.gray('     OR into Cursor → Settings → MCP'));
      console.log(chalk.gray('  3. Restart your MCP client — it will launch the bridge automatically'));
      console.log(chalk.gray('\n  The MCP client manages the bridge process lifecycle via stdio.'));
      console.log(chalk.gray('  To test manually: ' + chalk.cyan(`npx tsx ${path.relative(process.cwd(), serverPath)}`)));
      console.log();
    } else if (mode === 'cloud' || options.cloud) {
      console.log(chalk.bold('Mode: Cloud (AgentBridge Hosted MCP)'));
      console.log(chalk.gray(`Deploying bridge: ${bridgeName}`));
      
      const spinner = ora('Bundling and deploying to cloud...').start();
      try {
        const result = await deployToCloud(bridgeName);
        spinner.succeed(`Successfully deployed ${bridgeName} to the cloud`);
        
        console.log(chalk.bold('\n🌐 Cloud Endpoint:'));
        console.log(chalk.cyan(`  ${result.endpoint}`));
        
        console.log(chalk.bold('\n📋 Claude Desktop Config (SSE):'));
        console.log(chalk.gray('─'.repeat(50)));
        const cloudConfig = {
          mcpServers: {
            [bridgeName]: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/client-sse', '--url', `${result.endpoint}/sse`],
              env: {}
            }
          }
        };
        console.log(JSON.stringify(cloudConfig, null, 2));
        console.log(chalk.gray('─'.repeat(50)));
        
        console.log(chalk.green('\n✅ Cloud Bridge is live!'));
        console.log(chalk.gray(`Make sure the proxy is running: npx tsx platform/cloud/mcp-proxy.ts`));
      } catch (err: any) {
        spinner.fail(`Cloud deployment failed: ${err.message}`);
      }
    } else {
      console.error(chalk.red(`✗ Unknown mode: ${mode}. Use: local | cloud`));
      process.exit(1);
    }
  });
