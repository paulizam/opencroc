/*
 * @Author: wangchunji
 * @Date: 2026-03-15 23:22:51
 * @LastEditors: wangchunji
 * @LastEditTime: 2026-03-16 00:12:45
 * @Description: 
 */
import { describe, expect, it, vi } from 'vitest';
import { createExecutionCoordinator } from './coordinator.js';

describe('createExecutionCoordinator', () => {
  it('parses metrics from successful output', async () => {
    const execSync = vi.fn().mockReturnValue('3 passed\n0 failed\n1 skipped\n');
    const coordinator = createExecutionCoordinator({ execSync });

    const result = await coordinator.run({
      cwd: '/tmp',
      testFiles: ['a.spec.ts'],
    });

    expect(result.metrics).toEqual({
      passed: 3,
      failed: 0,
      skipped: 1,
      timedOut: 0,
    });
    expect(result.mode).toBe('auto');
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('parses failed output and returns categorized hints', async () => {
    const execSync = vi.fn().mockImplementation(() => {
      const err = new Error('failed') as Error & { stdout?: string; stderr?: string };
      err.stdout = '1 passed\n2 failed\n';
      err.stderr = 'timeout while waiting\nendpoint error';
      throw err;
    });
    const categorizeFailure = vi.fn((line: string) => ({ category: line.includes('timeout') ? 'timeout' : 'unknown', confidence: 0.8 }));
    const coordinator = createExecutionCoordinator({ execSync, categorizeFailure });

    const result = await coordinator.run({
      cwd: '/tmp',
      testFiles: ['a.spec.ts', 'b.spec.ts'],
      mode: 'managed',
    });

    expect(result.mode).toBe('managed');
    expect(result.metrics.failed).toBe(2);
    expect(result.failureHints.length).toBeGreaterThan(0);
    expect(categorizeFailure).toHaveBeenCalled();
  });

  it('falls back to failed=testFiles.length when metrics are missing', async () => {
    const execSync = vi.fn().mockImplementation(() => {
      const err = new Error('boom') as Error & { stdout?: string; stderr?: string };
      err.stdout = '';
      err.stderr = 'process exited';
      throw err;
    });
    const coordinator = createExecutionCoordinator({ execSync });

    const result = await coordinator.run({
      cwd: '/tmp',
      testFiles: ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'],
      mode: 'reuse',
    });

    expect(result.metrics).toEqual({
      passed: 0,
      failed: 3,
      skipped: 0,
      timedOut: 0,
    });
  });

  it('passes provided env to playwright process', async () => {
    const execSync = vi.fn().mockReturnValue('1 passed\n');
    const coordinator = createExecutionCoordinator({ execSync });
    const env = { BASE_URL: 'http://localhost:3000', AUTH_USERNAME: 'admin' };

    await coordinator.run({
      cwd: '/tmp',
      testFiles: ['a.spec.ts'],
      env,
    });

    expect(execSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        env,
      }),
    );
  });
});
