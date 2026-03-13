import type { OpenCrocConfig } from '../types.js';

/**
 * Generate playwright.config.ts content based on OpenCroc config.
 */
export function generatePlaywrightConfig(config: OpenCrocConfig): string {
  const pw = config.playwright ?? {};
  const rt = config.runtime ?? {};
  const outDir = config.outDir || './opencroc-output';

  const baseURL = pw.baseURL ? `'${pw.baseURL}'` : "process.env.BASE_URL || 'http://localhost:3000'";
  const timeout = pw.timeout ?? 30_000;
  const workers = pw.workers ?? (null as number | null); // null → use expression
  const retries = pw.retries ?? (null as number | null);
  const actionTimeout = pw.actionTimeout ?? 10_000;
  const navigationTimeout = pw.navigationTimeout ?? timeout;
  const storageState = rt.auth?.storageStatePath || 'playwright/.auth/user.json';

  const hasAuth = !!(rt.auth?.loginUrl);

  const lines: string[] = [];
  lines.push(`import { defineConfig, devices } from '@playwright/test';`);
  lines.push('');
  lines.push('export default defineConfig({');
  lines.push(`  testDir: '${outDir}',`);
  lines.push(`  testMatch: ['**/*.spec.ts', '**/*.test.ts'],`);
  lines.push(`  fullyParallel: false,`);
  lines.push(`  forbidOnly: !!process.env.CI,`);
  lines.push(`  retries: ${retries !== null ? retries : 'process.env.CI ? 1 : 0'},`);
  lines.push(`  workers: ${workers !== null ? workers : 'process.env.CI ? 4 : 2'},`);
  lines.push(`  timeout: ${timeout},`);
  lines.push(`  globalSetup: './global-setup.ts',`);
  lines.push(`  globalTeardown: './global-teardown.ts',`);
  lines.push(`  reporter: [['list'], ['html', { open: 'never' }]],`);
  lines.push(`  use: {`);
  lines.push(`    baseURL: ${baseURL},`);
  lines.push(`    trace: 'retain-on-failure',`);
  lines.push(`    screenshot: 'only-on-failure',`);
  lines.push(`    video: 'retain-on-failure',`);
  lines.push(`    actionTimeout: ${actionTimeout},`);
  lines.push(`    navigationTimeout: ${navigationTimeout},`);
  lines.push(`  },`);

  // Projects
  lines.push(`  projects: [`);

  if (hasAuth) {
    lines.push(`    {`);
    lines.push(`      name: 'setup',`);
    lines.push(`      testMatch: '**/auth.setup.ts',`);
    lines.push(`      use: { ...devices['Desktop Chrome'] },`);
    lines.push(`    },`);
    lines.push(`    {`);
    lines.push(`      name: 'chromium',`);
    lines.push(`      testIgnore: ['**/*.setup.ts'],`);
    lines.push(`      dependencies: ['setup'],`);
    lines.push(`      use: {`);
    lines.push(`        ...devices['Desktop Chrome'],`);
    lines.push(`        storageState: '${storageState}',`);
    lines.push(`      },`);
    lines.push(`    },`);
    lines.push(`    {`);
    lines.push(`      name: 'chromium-no-auth',`);
    lines.push(`      testMatch: '**/login-flow.test.ts',`);
    lines.push(`      testIgnore: ['**/*.setup.ts'],`);
    lines.push(`      use: { ...devices['Desktop Chrome'] },`);
    lines.push(`    },`);
  } else {
    lines.push(`    {`);
    lines.push(`      name: 'chromium',`);
    lines.push(`      use: { ...devices['Desktop Chrome'] },`);
    lines.push(`    },`);
  }

  // Extra projects from config
  if (rt.extraProjects) {
    for (const proj of rt.extraProjects) {
      lines.push(`    {`);
      lines.push(`      name: '${proj.name}',`);
      lines.push(`      testMatch: '${proj.testMatch}',`);
      if (proj.dependencies?.length) {
        lines.push(`      dependencies: [${proj.dependencies.map((d) => `'${d}'`).join(', ')}],`);
      }
      if (proj.useAuth !== false && hasAuth) {
        lines.push(`      use: {`);
        lines.push(`        ...devices['Desktop Chrome'],`);
        lines.push(`        storageState: '${storageState}',`);
        lines.push(`      },`);
      } else {
        lines.push(`      use: { ...devices['Desktop Chrome'] },`);
      }
      lines.push(`    },`);
    }
  }

  lines.push(`  ],`);
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}
