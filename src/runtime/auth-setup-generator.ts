import type { OpenCrocConfig } from '../types.js';

/**
 * Generate auth.setup.ts content for Playwright.
 * Creates an authentication setup project that stores state for reuse.
 */
export function generateAuthSetup(config: OpenCrocConfig): string {
  const rt = config.runtime ?? {};
  const pw = config.playwright ?? {};
  const auth = rt.auth ?? {};
  const baseURL = pw.baseURL || '';
  const storageStatePath = auth.storageStatePath || 'playwright/.auth/user.json';

  const lines: string[] = [];

  lines.push(`import { test as setup, expect } from '@playwright/test';`);
  lines.push(`import * as fs from 'fs/promises';`);
  lines.push(`import * as path from 'path';`);
  lines.push('');

  lines.push(`const authFile = '${storageStatePath}';`);
  lines.push('');

  if (auth.loginUrl) {
    // API-based authentication
    lines.push(`setup('authenticate', async ({ request }) => {`);
    lines.push(`  const loginUrl = process.env.AUTH_LOGIN_URL || '${auth.loginUrl}';`);
    lines.push(`  const username = process.env.AUTH_USERNAME || '${auth.username || 'admin'}';`);
    lines.push(`  const password = process.env.AUTH_PASSWORD || '${auth.password || ''}';`);
    lines.push('');
    lines.push(`  // API login`);
    lines.push(`  const response = await request.post(loginUrl, {`);
    lines.push(`    data: { username, password },`);
    lines.push(`  });`);
    lines.push(`  expect(response.ok()).toBeTruthy();`);
    lines.push('');
    lines.push(`  const body = await response.json();`);
    lines.push(`  const token = body.data?.token || body.token || '';`);
    lines.push(`  console.log('[auth.setup] Login successful, token obtained:', !!token);`);
    lines.push('');
    lines.push(`  // Save storage state with auth cookie/localStorage`);
    lines.push(`  await fs.mkdir(path.dirname(authFile), { recursive: true });`);
    lines.push('');
    lines.push(`  // Build storage state JSON`);
    lines.push(`  const baseURL = process.env.BASE_URL || '${baseURL || 'http://localhost:3000'}';`);
    lines.push(`  const origin = new URL(baseURL).origin;`);
    lines.push(`  const storageState = {`);
    lines.push(`    cookies: [],`);
    lines.push(`    origins: [`);
    lines.push(`      {`);
    lines.push(`        origin,`);
    lines.push(`        localStorage: [`);
    lines.push(`          { name: 'token', value: token },`);
    lines.push(`        ],`);
    lines.push(`      },`);
    lines.push(`    ],`);
    lines.push(`  };`);
    lines.push('');
    lines.push(`  await fs.writeFile(authFile, JSON.stringify(storageState, null, 2));`);
    lines.push(`  console.log(\`[auth.setup] Storage state saved → \${authFile}\`);`);
    lines.push(`});`);
  } else {
    // Browser-based authentication (placeholder)
    lines.push(`setup('authenticate', async ({ browser }) => {`);
    lines.push(`  const context = await browser.newContext();`);
    lines.push(`  const page = await context.newPage();`);
    lines.push('');
    lines.push(`  // TODO: Implement your login flow here`);
    lines.push(`  // await page.goto('/login');`);
    lines.push(`  // await page.fill('[name=username]', 'admin');`);
    lines.push(`  // await page.fill('[name=password]', 'password');`);
    lines.push(`  // await page.click('button[type=submit]');`);
    lines.push(`  // await page.waitForURL('/dashboard');`);
    lines.push('');
    lines.push(`  await fs.mkdir(path.dirname(authFile), { recursive: true });`);
    lines.push(`  await context.storageState({ path: authFile });`);
    lines.push(`  console.log(\`[auth.setup] Storage state saved → \${authFile}\`);`);
    lines.push('');
    lines.push(`  await context.close();`);
    lines.push(`});`);
  }

  lines.push('');

  return lines.join('\n');
}
