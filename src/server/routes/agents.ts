import type { FastifyInstance } from 'fastify';
import type { CrocOffice } from '../croc-office.js';

export function registerAgentRoutes(app: FastifyInstance, office: CrocOffice): void {
  // GET /api/agents — list all croc agents
  app.get('/api/agents', async () => {
    return office.getAgents();
  });

  // GET /api/agents/:id — get specific agent
  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = office.getAgent(req.params.id);
    if (!agent) {
      reply.code(404).send({ error: 'Agent not found' });
      return;
    }
    return agent;
  });

  // POST /api/scan — trigger project scan (parser croc)
  app.post('/api/scan', async (_req, reply) => {
    if (office.isRunning()) {
      reply.code(409).send({ error: 'A task is already running' });
      return;
    }
    // Run async — don't await, respond immediately
    office.runScan().catch(() => { /* errors handled in runScan */ });
    return { ok: true, message: 'Scan started' };
  });

  // POST /api/pipeline — trigger full pipeline (all crocs)
  app.post('/api/pipeline', async (_req, reply) => {
    if (office.isRunning()) {
      reply.code(409).send({ error: 'A task is already running' });
      return;
    }
    office.runPipeline().catch(() => { /* errors handled in runPipeline */ });
    return { ok: true, message: 'Pipeline started' };
  });

  // POST /api/reset — reset all agents to idle
  app.post('/api/reset', async () => {
    office.resetAgents();
    return { ok: true };
  });

  // GET /api/status — overall status
  app.get('/api/status', async () => {
    return {
      running: office.isRunning(),
      agents: office.getAgents(),
    };
  });

  // GET /api/files — generated test files from last pipeline run
  app.get('/api/files', async () => {
    const files = office.getGeneratedFiles();
    return files.map(f => ({
      filePath: f.filePath,
      module: f.module,
      chain: f.chain,
      lines: f.content.split('\n').length,
      size: f.content.length,
    }));
  });

  // GET /api/files/:index — get content of a specific generated file
  app.get<{ Params: { index: string } }>('/api/files/:index', async (req, reply) => {
    const files = office.getGeneratedFiles();
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= files.length) {
      reply.code(404).send({ error: 'File not found' });
      return;
    }
    return files[idx];
  });

  // GET /api/pipeline/result — last pipeline result summary
  app.get('/api/pipeline/result', async () => {
    const result = office.getLastPipelineResult();
    if (!result) return { ok: false, message: 'No pipeline has been run yet' };
    return {
      ok: true,
      modules: result.modules,
      erDiagramCount: result.erDiagrams.size,
      chainCount: [...result.chainPlans.values()].reduce((s, p) => s + p.chains.length, 0),
      totalSteps: [...result.chainPlans.values()].reduce((s, p) => s + p.totalSteps, 0),
      filesGenerated: result.generatedFiles.length,
      validationErrors: result.validationErrors.length,
      duration: result.duration,
    };
  });
}
