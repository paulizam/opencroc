import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../load-config.js';
import { createPipeline } from '../../pipeline/index.js';
import {
  buildDashboardDataFromReportJson,
  buildDashboardDataFromPipeline,
  generateVisualDashboardHtml,
} from '../../dashboard/index.js';

export interface DashboardCommandOptions {
  output?: string;
  input?: string;
}

export async function dashboard(opts: DashboardCommandOptions): Promise<void> {
  let dashboardHtml: string;

  if (opts.input) {
    const inputPath = path.resolve(opts.input);
    if (!fs.existsSync(inputPath)) {
      console.error(chalk.red(`Input report not found: ${inputPath}`));
      process.exitCode = 1;
      return;
    }

    const raw = fs.readFileSync(inputPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(chalk.red('Invalid JSON input. Please provide opencroc-report.json output.'));
      process.exitCode = 1;
      return;
    }

    const data = buildDashboardDataFromReportJson(parsed);
    dashboardHtml = generateVisualDashboardHtml(data);
    console.log(chalk.cyan(`Building visual dashboard from ${inputPath}...`));
  } else {
    let loaded;
    try {
      loaded = await loadConfig();
    } catch {
      console.error(chalk.red('No opencroc config found. Run `opencroc init` first.'));
      process.exitCode = 1;
      return;
    }

    const { config } = loaded;
    console.log(chalk.cyan('Running pipeline to build visual dashboard...'));
    const pipeline = createPipeline(config);
    const result = await pipeline.run();

    const data = buildDashboardDataFromPipeline(result);
    dashboardHtml = generateVisualDashboardHtml(data);
  }

  const outDir = opts.output ? path.resolve(opts.output) : path.resolve('./opencroc-output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'opencroc-dashboard.html');
  fs.writeFileSync(outPath, dashboardHtml, 'utf-8');
  console.log(chalk.green(`✔ visual dashboard → ${outPath}`));
}
