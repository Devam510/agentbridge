/**
 * create.ts
 * CLI command: agentbridge create <url>
 * Orchestrates: crawl → analyze → generate MCP server + docs
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { crawlSite } from '../../engine/crawler/site-crawler.js';
import { analyzeWithLLM } from '../../engine/inferrer/llm-analyzer.js';
import { generateMCPServer } from '../../engine/generator/mcp-generator.js';
import { generateDocs } from '../../engine/generator/doc-generator.js';

dotenv.config();

function slugify(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/\./g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  } catch {
    return 'bridge';
  }
}

export const createCommand = new Command('create')
  .description('Create an agent-native bridge for any software')
  .argument('<url>', 'URL of the software to bridge (e.g. https://app.hubspot.com)')
  .option('--name <name>', 'Custom name for the bridge')
  .option('--max-pages <number>', 'Max pages to crawl (default: 20)', '20')
  .option('--headless <bool>', 'Run browser headlessly (default: true)', 'true')
  .option('--output <dir>', 'Output directory for bridge files', './bridges')
  .action(async (url: string, options: Record<string, string>) => {
    console.log('\n' + chalk.bold.cyan('⚡ AgentBridge') + ' — Making software agent-native\n');

    // Validate URL
    try {
      new URL(url);
    } catch {
      console.error(chalk.red(`✗ Invalid URL: ${url}`));
      process.exit(1);
    }

    // Check OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.log(chalk.yellow('⚠️ OPENAI_API_KEY not set. Using free mock/heuristic mode.'));
      console.log(chalk.gray('  To get accurate results, add your key to .env'));
    }

    const bridgeId = (options.name as string | undefined) ?? slugify(url);
    const maxPages = parseInt(options.maxPages as string, 10);
    const headless = options.headless !== 'false';
    const outputDir = path.resolve(options.output as string, bridgeId);

    // ── Step 1: Crawl ───────────────────────────────────────
    const crawlSpinner = ora(`Crawling ${chalk.cyan(url)} (max ${maxPages} pages)...`).start();
    let crawlResult;

    try {
      crawlResult = await crawlSite(url, { maxPages, headless });
      crawlSpinner.succeed(
        chalk.green(`Crawled ${crawlResult.pagesVisited} pages`) +
          (crawlResult.errors.length > 0
            ? chalk.yellow(` (${crawlResult.errors.length} errors)`)
            : ''),
      );
    } catch (err) {
      crawlSpinner.fail(chalk.red(`Crawl failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }

    // ── Step 2: Analyze capabilities ────────────────────────
    const analyzeSpinner = ora('Analyzing capabilities with AI...').start();
    let capMap;

    try {
      capMap = await analyzeWithLLM(crawlResult, bridgeId);
      analyzeSpinner.succeed(
        chalk.green(`Found ${capMap.capabilities.length} capabilities`) +
          chalk.gray(` across ${capMap.categories.length} categories`),
      );
    } catch (err) {
      analyzeSpinner.fail(chalk.red(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }

    // ── Step 3: Generate MCP server ─────────────────────────
    const generateSpinner = ora('Generating MCP server...').start();

    try {
      const serverPath = await generateMCPServer(capMap, outputDir);
      await generateDocs(capMap, outputDir);

      generateSpinner.succeed(chalk.green('Bridge generated!'));

      // Print summary
      console.log('\n' + chalk.bold('📦 Bridge Summary'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`  ${chalk.bold('Target:')}      ${capMap.targetName}`);
      console.log(`  ${chalk.bold('Bridge ID:')}   ${bridgeId}`);
      console.log(`  ${chalk.bold('Capabilities:')} ${capMap.capabilities.length}`);
      console.log(`  ${chalk.bold('Categories:')}  ${capMap.categories.join(', ')}`);
      console.log(chalk.gray('─'.repeat(50)));

      // Capability breakdown by risk
      const safe = capMap.capabilities.filter((c) => c.riskLevel === 'safe').length;
      const moderate = capMap.capabilities.filter((c) => c.riskLevel === 'moderate').length;
      const destructive = capMap.capabilities.filter((c) => c.riskLevel === 'destructive').length;

      console.log(`  ${chalk.green('✓')} Safe:        ${safe}`);
      console.log(`  ${chalk.yellow('!')} Moderate:    ${moderate}`);
      console.log(`  ${chalk.red('✕')} Destructive: ${destructive}`);
      console.log(chalk.gray('─'.repeat(50)));

      console.log('\n' + chalk.bold('📁 Output Files'));
      console.log(`  ${chalk.cyan(path.relative(process.cwd(), serverPath))}    — MCP server`);
      console.log(`  ${chalk.cyan(path.relative(process.cwd(), path.join(outputDir, 'openapi.json')))}  — OpenAPI spec`);
      console.log(`  ${chalk.cyan(path.relative(process.cwd(), path.join(outputDir, 'agent-card.json')))} — A2A Agent Card`);
      console.log(`  ${chalk.cyan(path.relative(process.cwd(), path.join(outputDir, 'capabilities.json')))} — Capability map`);

      console.log('\n' + chalk.bold('🚀 Next Steps'));
      console.log(`  1. ${chalk.cyan(`npx agentbridge test ${bridgeId}`)}   — Test all capabilities`);
      console.log(`  2. ${chalk.cyan(`npx agentbridge deploy ${bridgeId}`)} — Deploy bridge`);
      console.log('');
    } catch (err) {
      generateSpinner.fail(
        chalk.red(`Generation failed: ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exit(1);
    }
  });
