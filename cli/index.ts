#!/usr/bin/env node
/**
 * cli/index.ts
 * Main CLI entry point for AgentBridge.
 * Usage: npx agentbridge <command>
 */

import { Command } from 'commander';
import { createCommand } from './commands/create.js';
import { testCommand } from './commands/test.js';
import { deployCommand } from './commands/deploy.js';
import { addCommand } from './commands/add.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('agentbridge')
  .description(
    chalk.bold.cyan('AgentBridge') +
      ' — Make any software agent-native in 5 minutes\n' +
      chalk.gray('  Docs: https://agentbridge.com/docs'),
  )
  .version('0.1.0');

// Register commands
program.addCommand(createCommand);
program.addCommand(testCommand);
program.addCommand(deployCommand);
program.addCommand(addCommand);

// Friendly error for unknown commands
program.on('command:*', (operands: string[]) => {
  console.error(chalk.red(`\nUnknown command: ${operands[0]}`));
  console.error(chalk.gray('Run agentbridge --help to see available commands\n'));
  process.exit(1);
});

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length < 3) {
  program.help();
}
