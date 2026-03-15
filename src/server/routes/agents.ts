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

  // POST /api/agents/:id/task — assign a task to an agent (M2: full implementation)
  app.post<{ Params: { id: string }; Body: { task: string } }>('/api/agents/:id/task', async (req, reply) => {
    const agent = office.getAgent(req.params.id);
    if (!agent) {
      reply.code(404).send({ error: 'Agent not found' });
      return;
    }

    office.updateAgent(req.params.id, {
      status: 'working',
      currentTask: req.body?.task || 'Processing...',
    });

    // M2 will implement actual task dispatch to LLM
    // For now, simulate work
    setTimeout(() => {
      office.updateAgent(req.params.id, {
        status: 'done',
        currentTask: 'Task completed',
      });
    }, 2000);

    return { ok: true, agent: req.params.id, task: req.body?.task };
  });
}
