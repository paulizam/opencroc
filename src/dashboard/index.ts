import type { PipelineRunResult } from '../types.js';

export interface DashboardData {
  generatedAt: string;
  durationMs: number;
  modules: string[];
  totals: {
    modules: number;
    tables: number;
    relations: number;
    chains: number;
    steps: number;
    files: number;
    errors: number;
    warnings: number;
  };
  moduleCards: Array<{
    module: string;
    tables: number;
    relations: number;
    chains: number;
    steps: number;
  }>;
  files: Array<{ filePath: string; module: string; chain: string }>;
  issues: Array<{ severity: string; module: string; field: string; message: string }>;
}

export interface DashboardOutput {
  filename: string;
  content: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function number(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function buildDashboardDataFromPipeline(result: PipelineRunResult): DashboardData {
  const moduleCards = result.modules.map((mod) => {
    const er = result.erDiagrams.get(mod);
    const plan = result.chainPlans.get(mod);
    return {
      module: mod,
      tables: er?.tables.length ?? 0,
      relations: er?.relations.length ?? 0,
      chains: plan?.chains.length ?? 0,
      steps: plan?.totalSteps ?? 0,
    };
  });

  const totals = {
    modules: result.modules.length,
    tables: moduleCards.reduce((s, m) => s + m.tables, 0),
    relations: moduleCards.reduce((s, m) => s + m.relations, 0),
    chains: moduleCards.reduce((s, m) => s + m.chains, 0),
    steps: moduleCards.reduce((s, m) => s + m.steps, 0),
    files: result.generatedFiles.length,
    errors: result.validationErrors.filter((e) => e.severity === 'error').length,
    warnings: result.validationErrors.filter((e) => e.severity === 'warning').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    durationMs: result.duration,
    modules: [...result.modules],
    totals,
    moduleCards,
    files: result.generatedFiles.map((f) => ({ filePath: f.filePath, module: f.module, chain: f.chain })),
    issues: result.validationErrors.map((e) => ({
      severity: e.severity,
      module: e.module,
      field: e.field,
      message: e.message,
    })),
  };
}

export function buildDashboardDataFromReportJson(input: unknown): DashboardData {
  const src = (input ?? {}) as Record<string, unknown>;
  const modules = Array.isArray(src.modules) ? src.modules.map((m) => String(m)) : [];
  const er = (src.erDiagrams ?? {}) as Record<string, { tables?: unknown; relations?: unknown }>;
  const plans = (src.chainPlans ?? {}) as Record<string, { chains?: unknown; totalSteps?: unknown }>;
  const files = Array.isArray(src.generatedFiles)
    ? src.generatedFiles.map((f) => {
      const row = f as Record<string, unknown>;
      return {
        filePath: String(row.filePath ?? ''),
        module: String(row.module ?? ''),
        chain: String(row.chain ?? ''),
      };
    })
    : [];

  const rawIssues = Array.isArray(src.validationErrors) ? src.validationErrors : [];
  const issues = rawIssues.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      severity: String(row.severity ?? 'warning'),
      module: String(row.module ?? 'unknown'),
      field: String(row.field ?? 'unknown'),
      message: String(row.message ?? ''),
    };
  });

  const moduleCards = modules.map((mod) => ({
    module: mod,
    tables: number(er[mod]?.tables),
    relations: number(er[mod]?.relations),
    chains: number(plans[mod]?.chains),
    steps: number(plans[mod]?.totalSteps),
  }));

  return {
    generatedAt: new Date().toISOString(),
    durationMs: number(src.duration),
    modules,
    totals: {
      modules: modules.length,
      tables: moduleCards.reduce((s, m) => s + m.tables, 0),
      relations: moduleCards.reduce((s, m) => s + m.relations, 0),
      chains: moduleCards.reduce((s, m) => s + m.chains, 0),
      steps: moduleCards.reduce((s, m) => s + m.steps, 0),
      files: files.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    },
    moduleCards,
    files,
    issues,
  };
}

export function generateVisualDashboardHtml(data: DashboardData): string {
  const moduleCardHtml = data.moduleCards
    .map(
      (m) => `<article class="module-card reveal">
  <h3>${escapeHtml(m.module)}</h3>
  <div class="meta">${m.tables} tables · ${m.relations} relations</div>
  <div class="bars">
    <div class="bar"><span>Chains</span><strong>${m.chains}</strong></div>
    <div class="bar"><span>Steps</span><strong>${m.steps}</strong></div>
  </div>
</article>`,
    )
    .join('\n');

  const fileRows = data.files
    .slice(0, 20)
    .map(
      (f) => `<tr><td><code>${escapeHtml(f.filePath)}</code></td><td>${escapeHtml(f.module)}</td><td>${escapeHtml(f.chain)}</td></tr>`,
    )
    .join('\n');

  const issueRows = data.issues
    .map(
      (i) => `<tr class="${escapeHtml(i.severity)}"><td>${escapeHtml(i.severity)}</td><td>${escapeHtml(i.module)}</td><td>${escapeHtml(i.field)}</td><td>${escapeHtml(i.message)}</td></tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenCroc Visual Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
    :root {
      --bg: #f4efe6;
      --ink: #18222c;
      --card: #fff8ef;
      --line: #d8c7b4;
      --accent: #0b7a75;
      --accent-2: #f26a2e;
      --ok: #2f7d32;
      --warn: #b7791f;
      --err: #c0392b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 15% 10%, #f9e2c5 0%, transparent 32%),
        radial-gradient(circle at 85% 0%, #d3efe4 0%, transparent 28%),
        var(--bg);
      min-height: 100vh;
    }
    .wrap { max-width: 1160px; margin: 0 auto; padding: 24px 18px 40px; }
    .hero {
      border: 2px solid var(--line);
      border-radius: 18px;
      background: linear-gradient(130deg, #fff8ef 0%, #f8f2ea 45%, #f3ece3 100%);
      padding: 22px;
      box-shadow: 0 12px 24px rgba(24, 34, 44, 0.08);
      position: relative;
      overflow: hidden;
    }
    .hero::after {
      content: '';
      position: absolute;
      right: -42px;
      top: -38px;
      width: 160px;
      height: 160px;
      border-radius: 50%;
      background: conic-gradient(from 50deg, #f26a2e 0deg, #f7a35a 90deg, #0b7a75 220deg, #f26a2e 360deg);
      opacity: 0.14;
    }
    h1 { margin: 0; font-size: clamp(1.6rem, 3vw, 2.5rem); letter-spacing: -0.03em; }
    .subtitle { margin-top: 8px; font-size: 0.95rem; opacity: 0.82; }
    .kpi-grid {
      margin-top: 16px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      background: #fffdf9;
    }
    .kpi .label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
    .kpi .value { font-size: 1.45rem; font-weight: 700; margin-top: 4px; }
    .kpi.error .value { color: var(--err); }
    .kpi.warning .value { color: var(--warn); }
    .kpi.files .value { color: var(--accent); }

    .section-title {
      margin: 24px 0 10px;
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #344250;
    }

    .module-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .module-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: var(--card);
      box-shadow: 0 8px 16px rgba(24, 34, 44, 0.06);
    }
    .module-card h3 { margin: 0 0 6px; font-size: 1.05rem; }
    .module-card .meta { font-size: 0.85rem; opacity: 0.78; }
    .bars { margin-top: 10px; display: grid; gap: 8px; }
    .bar { display: flex; justify-content: space-between; border-top: 1px dashed var(--line); padding-top: 7px; }

    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      background: #fffdf9;
      font-family: 'IBM Plex Mono', 'Consolas', monospace;
      font-size: 0.82rem;
    }
    thead { background: #efe5d8; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eadfce; }
    tbody tr:last-child td { border-bottom: none; }
    tr.error td:first-child { color: var(--err); font-weight: 700; }
    tr.warning td:first-child { color: var(--warn); font-weight: 700; }

    code {
      font-family: 'IBM Plex Mono', 'Consolas', monospace;
      background: #f5ece0;
      border: 1px solid #eadfce;
      border-radius: 6px;
      padding: 1px 5px;
    }

    .reveal { opacity: 0; transform: translateY(12px); animation: rise .55s ease forwards; }
    .module-card.reveal:nth-child(2) { animation-delay: .06s; }
    .module-card.reveal:nth-child(3) { animation-delay: .12s; }
    .module-card.reveal:nth-child(4) { animation-delay: .18s; }
    .module-card.reveal:nth-child(5) { animation-delay: .24s; }
    @keyframes rise {
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 700px) {
      .wrap { padding: 14px 12px 28px; }
      .hero { padding: 16px; }
      table { font-size: 0.76rem; }
      th, td { padding: 7px 8px; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero reveal">
      <h1>OpenCroc Visual Dashboard</h1>
      <p class="subtitle">Pipeline finished in ${data.durationMs}ms · Generated ${escapeHtml(data.generatedAt)}</p>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">Modules</div><div class="value">${data.totals.modules}</div></div>
        <div class="kpi"><div class="label">Tables</div><div class="value">${data.totals.tables}</div></div>
        <div class="kpi"><div class="label">Relations</div><div class="value">${data.totals.relations}</div></div>
        <div class="kpi"><div class="label">Chains</div><div class="value">${data.totals.chains}</div></div>
        <div class="kpi"><div class="label">Steps</div><div class="value">${data.totals.steps}</div></div>
        <div class="kpi files"><div class="label">Files</div><div class="value">${data.totals.files}</div></div>
        <div class="kpi error"><div class="label">Errors</div><div class="value">${data.totals.errors}</div></div>
        <div class="kpi warning"><div class="label">Warnings</div><div class="value">${data.totals.warnings}</div></div>
      </div>
    </section>

    <h2 class="section-title">Module Health</h2>
    <section class="module-grid">
      ${moduleCardHtml || '<article class="module-card">No module data</article>'}
    </section>

    <h2 class="section-title">Generated Files (Top 20)</h2>
    <section>
      <table>
        <thead><tr><th>File</th><th>Module</th><th>Chain</th></tr></thead>
        <tbody>${fileRows || '<tr><td colspan="3">No files generated</td></tr>'}</tbody>
      </table>
    </section>

    <h2 class="section-title">Validation Issues</h2>
    <section>
      <table>
        <thead><tr><th>Severity</th><th>Module</th><th>Field</th><th>Message</th></tr></thead>
        <tbody>${issueRows || '<tr><td colspan="4">No validation issues</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

export function generateVisualDashboard(result: PipelineRunResult): DashboardOutput {
  const data = buildDashboardDataFromPipeline(result);
  return {
    filename: 'opencroc-dashboard.html',
    content: generateVisualDashboardHtml(data),
  };
}
