import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../load-config.js', () => ({
  loadConfig: vi.fn(),
}));

import { initRuntime } from './init-runtime.js';
import { loadConfig } from '../load-config.js';

const mockedLoadConfig = vi.mocked(loadConfig);

const TMP = join(__dirname, '..', '..', '..', '.test-tmp-init-runtime');

function cleanup(): void {
  rmSync(TMP, { recursive: true, force: true });
}

describe('init-runtime command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    cleanup();
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('generates playwright.config.ts, global-setup.ts, global-teardown.ts', async () => {
    mockedLoadConfig.mockResolvedValue({
      config: {
        backendRoot: './backend',
        outDir: './e2e-output',
        playwright: { baseURL: 'http://localhost:5000' },
      },
      filepath: '/fake/config.json',
    });

    await initRuntime({ output: TMP });

    expect(existsSync(join(TMP, 'playwright.config.ts'))).toBe(true);
    expect(existsSync(join(TMP, 'global-setup.ts'))).toBe(true);
    expect(existsSync(join(TMP, 'global-teardown.ts'))).toBe(true);
    // No auth config → no auth.setup.ts
    expect(existsSync(join(TMP, 'auth.setup.ts'))).toBe(false);

    const pwConfig = readFileSync(join(TMP, 'playwright.config.ts'), 'utf-8');
    expect(pwConfig).toContain("baseURL: 'http://localhost:5000'");
  });

  it('generates auth.setup.ts when auth is configured', async () => {
    mockedLoadConfig.mockResolvedValue({
      config: {
        backendRoot: './backend',
        runtime: {
          auth: { loginUrl: '/api/login', username: 'admin', password: 'pass' },
        },
      },
      filepath: '/fake/config.json',
    });

    await initRuntime({ output: TMP });

    expect(existsSync(join(TMP, 'auth.setup.ts'))).toBe(true);
    const authContent = readFileSync(join(TMP, 'auth.setup.ts'), 'utf-8');
    expect(authContent).toContain('/api/login');
  });

  it('does not overwrite existing files without --force', async () => {
    mockedLoadConfig.mockResolvedValue({
      config: { backendRoot: '.' },
      filepath: '/fake/config.json',
    });

    writeFileSync(join(TMP, 'playwright.config.ts'), 'original', 'utf-8');

    await initRuntime({ output: TMP });

    const content = readFileSync(join(TMP, 'playwright.config.ts'), 'utf-8');
    expect(content).toBe('original');
  });

  it('overwrites files with --force', async () => {
    mockedLoadConfig.mockResolvedValue({
      config: { backendRoot: '.', playwright: { baseURL: 'http://overwrite:9000' } },
      filepath: '/fake/config.json',
    });

    writeFileSync(join(TMP, 'playwright.config.ts'), 'original', 'utf-8');

    await initRuntime({ output: TMP, force: true });

    const content = readFileSync(join(TMP, 'playwright.config.ts'), 'utf-8');
    expect(content).toContain('http://overwrite:9000');
  });
});
