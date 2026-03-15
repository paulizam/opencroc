import { describe, it, expect, vi } from 'vitest';

describe('serve command', () => {
  it('should export serve function', async () => {
    const mod = await import('./serve.js');
    expect(typeof mod.serve).toBe('function');
  });

  it('should fail without config', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('./serve.js');

    // serve will try to load config from cwd — since we don't have one, it should error
    await mod.serve({ port: '0' });

    expect(process.exitCode).toBe(1);
    logSpy.mockRestore();
    process.exitCode = undefined;
  });
});
