import * as fs from 'fs';
import * as path from 'path';
import type { BackendAdapter, TableSchema, FieldSchema, ForeignKeyRelation, RouteEntry } from '../types.js';

// Prisma scalar → generic field type mapping
const PRISMA_TYPE_MAP: Record<string, string> = {
  'String': 'STRING',
  'Int': 'INTEGER',
  'BigInt': 'BIGINT',
  'Float': 'FLOAT',
  'Decimal': 'DECIMAL',
  'Boolean': 'BOOLEAN',
  'DateTime': 'DATE',
  'Json': 'JSON',
  'Bytes': 'BLOB',
};

interface PrismaModel {
  name: string;
  fields: PrismaField[];
  tableName?: string;
}

interface PrismaField {
  name: string;
  type: string;
  isOptional: boolean;
  isList: boolean;
  isId: boolean;
  isUnique: boolean;
  isUpdatedAt: boolean;
  defaultValue?: string;
  relation?: { name?: string; fields?: string[]; references?: string[] };
  nativeType?: string;
  mapName?: string;
}

/**
 * Parse a .prisma schema file into models.
 */
export function parsePrismaSchema(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const modelRegex = /model\s+(\w+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const fields = parsePrismaFields(body);
    const mapDirective = body.match(/@@map\(["']([^"']+)["']\)/);
    models.push({
      name: modelName,
      fields,
      tableName: mapDirective?.[1],
    });
  }
  return models;
}

function parsePrismaFields(body: string): PrismaField[] {
  const fields: PrismaField[] = [];
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'));

  for (const line of lines) {
    const field = parsePrismaFieldLine(line);
    if (field) fields.push(field);
  }
  return fields;
}

function parsePrismaFieldLine(line: string): PrismaField | null {
  // field_name Type? @attributes
  const match = line.match(/^(\w+)\s+(\w+)(\[\])?\??/);
  if (!match) return null;

  const name = match[1];
  const rawType = match[2];
  const isList = !!match[3];
  const isOptional = line.includes('?');

  const field: PrismaField = {
    name,
    type: rawType,
    isOptional,
    isList,
    isId: /@id\b/.test(line),
    isUnique: /@unique\b/.test(line),
    isUpdatedAt: /@updatedAt\b/.test(line),
  };

  // @default(...)
  const defaultMatch = line.match(/@default\(([^)]+)\)/);
  if (defaultMatch) field.defaultValue = defaultMatch[1];

  // @map("...")
  const mapMatch = line.match(/@map\(["']([^"']+)["']\)/);
  if (mapMatch) field.mapName = mapMatch[1];

  // @db.VarChar(255) etc.
  const nativeMatch = line.match(/@db\.(\w+(?:\([^)]*\))?)/);
  if (nativeMatch) field.nativeType = nativeMatch[1];

  // @relation(...)
  const relMatch = line.match(/@relation\(([^)]*)\)/);
  if (relMatch) {
    field.relation = parseRelationDirective(relMatch[1]);
  }

  return field;
}

function parseRelationDirective(content: string): PrismaField['relation'] {
  const rel: NonNullable<PrismaField['relation']> = {};

  const nameMatch = content.match(/(?:name:\s*)?["']([^"']+)["']/);
  if (nameMatch) rel.name = nameMatch[1];

  const fieldsMatch = content.match(/fields:\s*\[([^\]]+)\]/);
  if (fieldsMatch) {
    rel.fields = fieldsMatch[1].split(',').map((s) => s.trim());
  }

  const refsMatch = content.match(/references:\s*\[([^\]]+)\]/);
  if (refsMatch) {
    rel.references = refsMatch[1].split(',').map((s) => s.trim());
  }

  return rel;
}

function modelNameToTableName(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

export function prismaModelsToSchemas(models: PrismaModel[]): TableSchema[] {
  return models.map((model) => {
    const tableName = model.tableName || modelNameToTableName(model.name);
    const fields: FieldSchema[] = [];

    for (const f of model.fields) {
      // Skip relation fields (other model types or lists)
      if (f.isList) continue;
      if (!PRISMA_TYPE_MAP[f.type] && !f.relation) continue;
      // Skip pure relation references (no scalar counterpart)
      if (!PRISMA_TYPE_MAP[f.type] && f.relation && !f.relation.fields) continue;

      const fieldType = PRISMA_TYPE_MAP[f.type] || 'STRING';
      fields.push({
        name: f.mapName || f.name,
        type: fieldType,
        allowNull: f.isOptional,
        primaryKey: f.isId,
        unique: f.isUnique,
        defaultValue: f.defaultValue,
      });
    }

    return { tableName, className: model.name, fields };
  });
}

export function prismaModelsToRelations(models: PrismaModel[]): ForeignKeyRelation[] {
  const relations: ForeignKeyRelation[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    const sourceTable = model.tableName || modelNameToTableName(model.name);

    for (const field of model.fields) {
      if (!field.relation?.fields || !field.relation?.references) continue;

      const targetModel = models.find((m) => m.name === field.type);
      const targetTable = targetModel
        ? (targetModel.tableName || modelNameToTableName(targetModel.name))
        : modelNameToTableName(field.type);

      const sourceField = field.relation.fields[0];
      const targetField = field.relation.references[0];

      const key = `${sourceTable}|${sourceField}|${targetTable}|${targetField}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Determine cardinality: field with @relation + fields is the "many" side
      const isList = field.isList;
      relations.push({
        sourceTable,
        sourceField,
        targetTable,
        targetField,
        cardinality: isList ? '1:N' : 'N:1',
      });
    }
  }
  return relations;
}

export function parsePrismaFile(filePath: string): { schemas: TableSchema[]; relations: ForeignKeyRelation[] } {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return { schemas: [], relations: [] };

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const models = parsePrismaSchema(content);
  return {
    schemas: prismaModelsToSchemas(models),
    relations: prismaModelsToRelations(models),
  };
}

function findPrismaSchemaFile(dir: string): string | null {
  // Look for schema.prisma in dir, dir/prisma, or project root/prisma
  const candidates = [
    path.join(dir, 'schema.prisma'),
    path.join(dir, 'prisma', 'schema.prisma'),
    path.join(dir, '..', 'prisma', 'schema.prisma'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function createPrismaAdapter(): BackendAdapter {
  return {
    name: 'prisma',

    async parseModels(dir: string): Promise<TableSchema[]> {
      const schemaFile = findPrismaSchemaFile(dir);
      if (!schemaFile) return [];
      const { schemas } = parsePrismaFile(schemaFile);
      return schemas;
    },

    async parseAssociations(file: string): Promise<ForeignKeyRelation[]> {
      // For Prisma, associations are in the schema file itself
      const schemaFile = findPrismaSchemaFile(path.dirname(file)) || file;
      const { relations } = parsePrismaFile(schemaFile);
      return relations;
    },

    async parseControllers(dir: string): Promise<RouteEntry[]> {
      const { parseControllerDirectory } = await import('../parsers/controller-parser.js');
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
