import { describe, it, expect } from 'vitest';
import { CrocOffice } from './croc-office.js';

describe('CrocOffice', () => {
  const config = { backendRoot: './test-fixtures' };

  it('should initialize with default agents', () => {
    const office = new CrocOffice(config, process.cwd());
    const agents = office.getAgents();
    expect(agents).toHaveLength(6);
    expect(agents[0].id).toBe('parser-croc');
    expect(agents[0].status).toBe('idle');
  });

  it('should get agent by id', () => {
    const office = new CrocOffice(config, process.cwd());
    const agent = office.getAgent('tester-croc');
    expect(agent).toBeDefined();
    expect(agent!.name).toBe('测试鳄');
    expect(agent!.role).toBe('tester');
  });

  it('should return undefined for unknown agent', () => {
    const office = new CrocOffice(config, process.cwd());
    expect(office.getAgent('unknown')).toBeUndefined();
  });

  it('should update agent status', () => {
    const office = new CrocOffice(config, process.cwd());
    office.updateAgent('parser-croc', { status: 'working', currentTask: 'Parsing models...' });
    const agent = office.getAgent('parser-croc');
    expect(agent!.status).toBe('working');
    expect(agent!.currentTask).toBe('Parsing models...');
  });

  it('should invalidate cache', () => {
    const office = new CrocOffice(config, process.cwd());
    office.invalidateCache();
    // Should not throw
  });

  it('should return project info', async () => {
    const office = new CrocOffice(config, process.cwd());
    const info = await office.getProjectInfo();
    expect(info.backendRoot).toBe('./test-fixtures');
    expect(info.adapter).toBe('custom');
    expect(info.stats).toBeDefined();
    expect(info.agents).toHaveLength(6);
    expect(info.graph).toBeDefined();
  });
});
