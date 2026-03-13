import type { BackendAdapter } from '../types.js';
import { parseModuleModels } from '../parsers/model-parser.js';
import { parseAssociationFile } from '../parsers/association-parser.js';
import { parseControllerDirectory } from '../parsers/controller-parser.js';
import type { TableSchema, ForeignKeyRelation, RouteEntry } from '../types.js';

export function createSequelizeAdapter(): BackendAdapter {
  return {
    name: 'sequelize',

    async parseModels(dir: string): Promise<TableSchema[]> {
      return parseModuleModels(dir);
    },

    async parseAssociations(file: string): Promise<ForeignKeyRelation[]> {
      return parseAssociationFile(file);
    },

    async parseControllers(dir: string): Promise<RouteEntry[]> {
      const endpoints = parseControllerDirectory(dir);
      return endpoints.map((ep) => ({
        method: ep.method,
        path: ep.path,
        handler: '',
        controllerClass: '',
      }));
    },
  };
}
