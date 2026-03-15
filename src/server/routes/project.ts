import type { FastifyInstance } from 'fastify';
import type { CrocOffice } from '../croc-office.js';

export function registerProjectRoutes(app: FastifyInstance, office: CrocOffice): void {
  // GET /api/project — full project info + knowledge graph
  app.get('/api/project', async () => {
    return office.getProjectInfo();
  });

  // GET /api/project/graph — knowledge graph only
  app.get('/api/project/graph', async () => {
    return office.buildKnowledgeGraph();
  });

  // POST /api/project/refresh — invalidate cache and re-scan
  app.post('/api/project/refresh', async () => {
    office.invalidateCache();
    const graph = await office.buildKnowledgeGraph();
    office.broadcast('graph:update', graph);
    return { ok: true, nodes: graph.nodes.length, edges: graph.edges.length };
  });
}
