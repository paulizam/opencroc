import { describe, it, expect } from 'vitest';
import type { PipelineRunResult } from '../types.js';
import {
  buildDashboardDataFromPipeline,
  buildDashboardDataFromReportJson,
  generateVisualDashboard,
  generateVisualDashboardHtml,
} from './index.js';

function makeMockResult(): PipelineRunResult {
  const erDiagrams = new Map();
  erDiagrams.set('default', {
    tables: [{ tableName: 'users', fields: [] }, { tableName: 'roles', fields: [] }],
    relations: [{ sourceTable: 'users', sourceField: 'role_id', targetTable: 'roles', targetField: 'id', cardinality: 'N:1' as const }],
    mermaidText: 'erDiagram',
  });

  const chainPlans = new Map();
  chainPlans.set('default', {
    chains: [{ name: 'user-crud', module: 'default', steps: [] }],
    totalSteps: 4,
  });

  return {
    modules: ['default'],
    erDiagrams,
    chainPlans,
    generatedFiles: [{ filePath: 'tests/default/user.spec.ts', content: '', module: 'default', chain: 'user-crud' }],
    validationErrors: [{ module: 'default', field: 'api-chain', message: 'Cycle warning', severity: 'warning' }],
    duration: 321,
  };
}

describe('dashboard module', () => {
  it('builds dashboard data from pipeline result', () => {
    const data = buildDashboardDataFromPipeline(makeMockResult());
    expect(data.totals.modules).toBe(1);
    expect(data.totals.tables).toBe(2);
    expect(data.totals.relations).toBe(1);
    expect(data.totals.steps).toBe(4);
  });

  it('builds dashboard data from report json format', () => {
    const data = buildDashboardDataFromReportJson({
      modules: ['default'],
      erDiagrams: { default: { tables: 2, relations: 1 } },
      chainPlans: { default: { chains: 1, totalSteps: 4 } },
      generatedFiles: [{ filePath: 'tests/default/user.spec.ts', module: 'default', chain: 'user-crud' }],
      validationErrors: [{ severity: 'error', module: 'default', field: 'backendRoot', message: 'Missing path' }],
      duration: 150,
    });
    expect(data.totals.errors).toBe(1);
    expect(data.totals.files).toBe(1);
    expect(data.durationMs).toBe(150);
  });

  it('generates a full HTML document', () => {
    const data = buildDashboardDataFromPipeline(makeMockResult());
    const html = generateVisualDashboardHtml(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('OpenCroc Visual Dashboard');
    expect(html).toContain('Generated Files (Top 20)');
  });

  it('escapes HTML-sensitive values', () => {
    const data = buildDashboardDataFromReportJson({
      modules: ['<script>alert(1)</script>'],
      erDiagrams: { '<script>alert(1)</script>': { tables: 0, relations: 0 } },
      chainPlans: { '<script>alert(1)</script>': { chains: 0, totalSteps: 0 } },
      generatedFiles: [],
      validationErrors: [],
      duration: 10,
    });
    const html = generateVisualDashboardHtml(data);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('generates dashboard output with default filename', () => {
    const out = generateVisualDashboard(makeMockResult());
    expect(out.filename).toBe('opencroc-dashboard.html');
    expect(out.content).toContain('OpenCroc Visual Dashboard');
  });
});
