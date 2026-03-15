import type { WebSocket } from 'ws';
import type { OpenCrocConfig } from '../types.js';

export interface CrocAgent {
  id: string;
  name: string;
  role: 'parser' | 'analyzer' | 'tester' | 'healer' | 'planner' | 'reporter';
  sprite: string;
  status: 'idle' | 'working' | 'thinking' | 'done' | 'error';
  currentTask?: string;
  tokensUsed: number;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: 'model' | 'controller' | 'api' | 'dto' | 'module';
  status: 'idle' | 'testing' | 'passed' | 'failed';
  fields?: string[];
  module?: string;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface ProjectInfo {
  name: string;
  backendRoot: string;
  adapter: string;
  stats: {
    modules: number;
    models: number;
    endpoints: number;
    relations: number;
  };
  graph: KnowledgeGraph;
  agents: CrocAgent[];
}

const DEFAULT_AGENTS: CrocAgent[] = [
  { id: 'parser-croc',   name: '解析鳄',  role: 'parser',   sprite: 'parser',   status: 'idle', tokensUsed: 0 },
  { id: 'analyzer-croc', name: '分析鳄',  role: 'analyzer', sprite: 'analyzer', status: 'idle', tokensUsed: 0 },
  { id: 'tester-croc',   name: '测试鳄',  role: 'tester',   sprite: 'tester',   status: 'idle', tokensUsed: 0 },
  { id: 'healer-croc',   name: '修复鳄',  role: 'healer',   sprite: 'healer',   status: 'idle', tokensUsed: 0 },
  { id: 'planner-croc',  name: '规划鳄',  role: 'planner',  sprite: 'planner',  status: 'idle', tokensUsed: 0 },
  { id: 'reporter-croc', name: '汇报鳄',  role: 'reporter', sprite: 'reporter', status: 'idle', tokensUsed: 0 },
];

export class CrocOffice {
  private config: OpenCrocConfig;
  private cwd: string;
  private clients: Set<WebSocket> = new Set();
  private agents: CrocAgent[];
  private cachedGraph: KnowledgeGraph | null = null;

  constructor(config: OpenCrocConfig, cwd: string) {
    this.config = config;
    this.cwd = cwd;
    this.agents = DEFAULT_AGENTS.map((a) => ({ ...a }));
  }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  broadcast(type: string, payload: unknown): void {
    const msg = JSON.stringify({ type, payload });
    for (const client of this.clients) {
      try {
        client.send(msg);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  getAgents(): CrocAgent[] {
    return this.agents;
  }

  getAgent(id: string): CrocAgent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  updateAgent(id: string, update: Partial<CrocAgent>): void {
    const agent = this.agents.find((a) => a.id === id);
    if (agent) {
      Object.assign(agent, update);
      this.broadcast('agent:update', this.agents);
    }
  }

  getConfig(): OpenCrocConfig {
    return this.config;
  }

  getCwd(): string {
    return this.cwd;
  }

  /** Build knowledge graph from project source code */
  async buildKnowledgeGraph(): Promise<KnowledgeGraph> {
    if (this.cachedGraph) return this.cachedGraph;

    this.updateAgent('parser-croc', { status: 'working', currentTask: 'Scanning project structure...' });

    try {
      const { resolve: resolvePath } = await import('node:path');
      const { glob } = await import('glob');

      const backendRoot = resolvePath(this.cwd, this.config.backendRoot);
      const nodes: KnowledgeGraphNode[] = [];
      const edges: KnowledgeGraphEdge[] = [];
      const moduleSet = new Set<string>();

      // Scan for models
      const modelFiles = await glob('**/models/**/*.{ts,js}', {
        cwd: backendRoot,
        ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/index.*'],
      });

      for (const file of modelFiles) {
        const parts = file.split('/');
        const moduleName = parts.length >= 3 ? parts[parts.length - 3] : 'default';
        const fileName = parts[parts.length - 1].replace(/\.(ts|js)$/, '');
        const nodeId = `model:${fileName}`;

        moduleSet.add(moduleName);
        nodes.push({
          id: nodeId,
          label: fileName,
          type: 'model',
          status: 'idle',
          module: moduleName,
        });
      }

      // Scan for controllers
      const controllerFiles = await glob('**/controllers/**/*.{ts,js}', {
        cwd: backendRoot,
        ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/index.*'],
      });

      for (const file of controllerFiles) {
        const parts = file.split('/');
        const moduleName = parts.length >= 3 ? parts[parts.length - 3] : 'default';
        const fileName = parts[parts.length - 1].replace(/\.(ts|js)$/, '').replace('.controller', '');
        const nodeId = `controller:${fileName}`;

        moduleSet.add(moduleName);
        nodes.push({
          id: nodeId,
          label: `${fileName} (ctrl)`,
          type: 'controller',
          status: 'idle',
          module: moduleName,
        });

        // Link controller to its model
        const modelNode = nodes.find((n) => n.type === 'model' && n.label.toLowerCase() === fileName.toLowerCase());
        if (modelNode) {
          edges.push({ source: nodeId, target: modelNode.id, relation: 'uses' });
        }
      }

      // Add module nodes
      for (const mod of moduleSet) {
        const moduleNodeId = `module:${mod}`;
        nodes.push({
          id: moduleNodeId,
          label: mod,
          type: 'module',
          status: 'idle',
        });

        // Link models/controllers to their module
        for (const n of nodes) {
          if (n.module === mod && n.type !== 'module') {
            edges.push({ source: moduleNodeId, target: n.id, relation: 'contains' });
          }
        }
      }

      this.cachedGraph = { nodes, edges };
      this.updateAgent('parser-croc', { status: 'done', currentTask: `Found ${nodes.length} nodes` });
      return this.cachedGraph;

    } catch (err) {
      this.updateAgent('parser-croc', { status: 'error', currentTask: String(err) });
      return { nodes: [], edges: [] };
    }
  }

  invalidateCache(): void {
    this.cachedGraph = null;
  }

  async getProjectInfo(): Promise<ProjectInfo> {
    const graph = await this.buildKnowledgeGraph();
    const stats = {
      modules: graph.nodes.filter((n) => n.type === 'module').length,
      models: graph.nodes.filter((n) => n.type === 'model').length,
      endpoints: graph.nodes.filter((n) => n.type === 'api' || n.type === 'controller').length,
      relations: graph.edges.length,
    };

    return {
      name: this.config.backendRoot.split('/').pop() || 'project',
      backendRoot: this.config.backendRoot,
      adapter: typeof this.config.adapter === 'string' ? this.config.adapter : 'custom',
      stats,
      graph,
      agents: this.agents,
    };
  }
}
