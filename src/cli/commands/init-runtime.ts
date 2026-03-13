import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '../load-config.js';
import { generatePlaywrightConfig } from '../../runtime/playwright-config-generator.js';
import { generateGlobalSetup } from '../../runtime/global-setup-generator.js';
import { generateGlobalTeardown } from '../../runtime/global-teardown-generator.js';
import { generateAuthSetup } from '../../runtime/auth-setup-generator.js';

export interface InitRuntimeOptions {
  output?: string;
  force?: boolean;
}

function writeIfNotExists(filePath: string, content: string, force: boolean): boolean {
  if (existsSync(filePath) && !force) {
    console.log(chalk.yellow(`  ⊘ ${filePath} already exists (use --force to overwrite)`));
    return false;
  }
  const dir = resolve(filePath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  console.log(chalk.green(`  ✓ ${filePath}`));
  return true;
}

export async function initRuntime(opts: InitRuntimeOptions): Promise<void> {
  console.log(chalk.cyan.bold('\n  🐊 OpenCroc — Initialize Playwright Runtime\n'));

  const { config, filepath } = await loadConfig();
  console.log(chalk.gray(`  Config: ${filepath}`));

  const outDir = resolve(opts.output || '.');
  const force = opts.force ?? false;
  const hasAuth = !!config.runtime?.auth?.loginUrl;

  let written = 0;

  console.log(chalk.cyan('\n  Generating runtime files...\n'));

  if (writeIfNotExists(join(outDir, 'playwright.config.ts'), generatePlaywrightConfig(config), force)) written++;
  if (writeIfNotExists(join(outDir, 'global-setup.ts'), generateGlobalSetup(config), force)) written++;
  if (writeIfNotExists(join(outDir, 'global-teardown.ts'), generateGlobalTeardown(config), force)) written++;

  if (hasAuth) {
    if (writeIfNotExists(join(outDir, 'auth.setup.ts'), generateAuthSetup(config), force)) written++;
  }

  console.log('');
  if (written > 0) {
    console.log(chalk.green(`  ✓ Generated ${written} runtime file(s) in ${outDir}\n`));
  } else {
    console.log(chalk.yellow(`  No files written. Use --force to overwrite existing files.\n`));
  }
}
