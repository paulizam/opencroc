import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../load-config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../pipeline/index.js', () => ({
  createPipeline: vi.fn(),
}));

import { dashboard } from './dashboard.js';
import { loadConfig } from '../load-config.js';
import { createPipeline } from '../../pipeline/index.js';
import type { PipelineRunResult } from '../../types.js';

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedCreatePipeline = vi.mocked(createPipeline);

function makeMockResult(overrides?: Partial<PipelineRunResult>): PipelineRunResult {
  return {
    modules: ['default'],
    erDiagrams: new Map(),
    chainPlans: new Map(),
    generatedFiles: [],
    validationErrors: [],
    duration: 100,
    ...overrides,
  };
}

describe('dashboard command', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencroc-dashboard-test-'));
    mockedLoadConfig.mockResolvedValue({
      config: { backendRoot: './backend' },
      filepath: '/tmp/opencroc.config.ts',
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs pipeline when no input is provided', async () => {
    const run = vi.fn().mockResolvedValue(makeMockResult());
    mockedCreatePipeline.mockReturnValue({ run });

    await dashboard({ output: tempDir });

    expect(mockedLoadConfig).toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, 'opencroc-dashboard.html'))).toBe(true);
  });

  it('builds dashboard from input json', async () => {
    const inputPath = path.join(tempDir, 'opencroc-report.json');
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        modules: ['default'],
        erDiagrams: { default: { tables: 1, relations: 0 } },
        chainPlans: { default: { chains: 1, totalSteps: 1 } },
        generatedFiles: [],
        validationErrors: [],
        duration: 50,
      }),
      'utf-8',
    );

    await dashboard({ input: inputPath, output: tempDir });

    expect(fs.existsSync(path.join(tempDir, 'opencroc-dashboard.html'))).toBe(true);
    expect(mockedLoadConfig).not.toHaveBeenCalled();
  });

  it('sets exit code when input json is invalid', async () => {
    const inputPath = path.join(tempDir, 'bad.json');
    fs.writeFileSync(inputPath, 'not-json', 'utf-8');
    const codeBefore = process.exitCode;

    await dashboard({ input: inputPath, output: tempDir });

    expect(process.exitCode).toBe(1);
    process.exitCode = codeBefore;
  });
});
