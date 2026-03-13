import * as fs from 'fs';
import * as path from 'path';
import {
  Project,
  type ClassDeclaration,
  type PropertyDeclaration,
} from 'ts-morph';
import type { BackendAdapter, TableSchema, FieldSchema, ForeignKeyRelation, RouteEntry } from '../types.js';

// TypeORM decorator → field type mapping
const TYPEORM_TYPE_MAP: Record<string, string> = {
  'PrimaryGeneratedColumn': 'BIGINT',
  'PrimaryColumn': 'BIGINT',
  'CreateDateColumn': 'DATE',
  'UpdateDateColumn': 'DATE',
  'DeleteDateColumn': 'DATE',
  'VersionColumn': 'INTEGER',
};

const TYPEORM_COLUMN_TYPE_MAP: Record<string, string> = {
  'varchar': 'STRING',
  'text': 'TEXT',
  'int': 'INTEGER',
  'integer': 'INTEGER',
  'bigint': 'BIGINT',
  'float': 'FLOAT',
  'double': 'DOUBLE',
  'decimal': 'DECIMAL',
  'boolean': 'BOOLEAN',
  'bool': 'BOOLEAN',
  'date': 'DATEONLY',
  'datetime': 'DATE',
  'timestamp': 'DATE',
  'json': 'JSON',
  'jsonb': 'JSONB',
  'enum': 'ENUM',
  'uuid': 'UUID',
};

function tsTypeToFieldType(tsType: string): string {
  const t = tsType.toLowerCase().trim();
  if (t === 'string') return 'STRING';
  if (t === 'number') return 'INTEGER';
  if (t === 'boolean') return 'BOOLEAN';
  if (t === 'date') return 'DATE';
  return 'STRING';
}

function classNameToTableName(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function extractDecoratorStringArg(decoratorText: string): string | undefined {
  const match = decoratorText.match(/\(\s*['"]([^'"]+)['"]\s*\)/);
  return match?.[1];
}

function extractDecoratorObjectArg(decoratorText: string): Record<string, string> {
  const result: Record<string, string> = {};
  const objMatch = decoratorText.match(/\(\s*\{([^}]*)\}\s*\)/);
  if (!objMatch) return result;
  const body = objMatch[1];
  const pairs = body.matchAll(/(\w+)\s*:\s*['"]([^'"]*)['"]/g);
  for (const pair of pairs) {
    result[pair[1]] = pair[2];
  }
  // Also match non-string values like nullable: true
  const boolPairs = body.matchAll(/(\w+)\s*:\s*(true|false)/g);
  for (const pair of boolPairs) {
    result[pair[1]] = pair[2];
  }
  return result;
}

export function parseTypeORMFile(filePath: string): TableSchema | null {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return null;

  const project = new Project({ compilerOptions: { strict: false } });
  const sourceFile = project.addSourceFileAtPath(absolutePath);

  const classes = sourceFile.getClasses();
  for (const cls of classes) {
    const entityDecorator = cls.getDecorator('Entity');
    if (!entityDecorator) continue;

    const tableName = extractDecoratorStringArg(entityDecorator.getText())
      || extractDecoratorObjectArg(entityDecorator.getText()).name
      || classNameToTableName(cls.getName() || 'unknown');

    const fields = extractTypeORMFields(cls);
    return { tableName, className: cls.getName(), fields };
  }
  return null;
}

function extractTypeORMFields(cls: ClassDeclaration): FieldSchema[] {
  const fields: FieldSchema[] = [];

  for (const prop of cls.getProperties()) {
    const field = parseTypeORMProperty(prop);
    if (field) fields.push(field);
  }
  return fields;
}

function parseTypeORMProperty(prop: PropertyDeclaration): FieldSchema | null {
  const decorators = prop.getDecorators();
  if (decorators.length === 0) return null;

  const name = prop.getName();
  let type = 'STRING';
  let primaryKey = false;
  let allowNull = true;
  let unique = false;

  for (const dec of decorators) {
    const decName = dec.getName();
    const decText = dec.getText();

    if (decName === 'PrimaryGeneratedColumn' || decName === 'PrimaryColumn') {
      primaryKey = true;
      type = TYPEORM_TYPE_MAP[decName] || 'BIGINT';
      allowNull = false;
      const argType = extractDecoratorStringArg(decText);
      if (argType === 'uuid') type = 'UUID';
      if (argType === 'increment') type = 'BIGINT';
    }

    if (decName === 'Column') {
      const objArgs = extractDecoratorObjectArg(decText);
      if (objArgs.type && TYPEORM_COLUMN_TYPE_MAP[objArgs.type]) {
        type = TYPEORM_COLUMN_TYPE_MAP[objArgs.type];
      } else {
        const simpleType = extractDecoratorStringArg(decText);
        if (simpleType && TYPEORM_COLUMN_TYPE_MAP[simpleType]) {
          type = TYPEORM_COLUMN_TYPE_MAP[simpleType];
        }
      }
      if (objArgs.nullable === 'false') allowNull = false;
      if (objArgs.unique === 'true') unique = true;

      // Fall back to TS type annotation
      if (type === 'STRING') {
        const tsType = prop.getType().getText();
        type = tsTypeToFieldType(tsType);
      }
    }

    if (decName in TYPEORM_TYPE_MAP) {
      type = TYPEORM_TYPE_MAP[decName];
    }

    if (decName === 'CreateDateColumn' || decName === 'UpdateDateColumn' || decName === 'DeleteDateColumn') {
      allowNull = true;
    }
  }

  // Skip properties without any recognized TypeORM decorator
  const recognizedDecorators = ['Column', 'PrimaryGeneratedColumn', 'PrimaryColumn',
    'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn',
    'ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany', 'JoinColumn', 'JoinTable'];
  const hasRecognized = decorators.some((d) => recognizedDecorators.includes(d.getName()));
  if (!hasRecognized) return null;

  // Skip relation-only properties (no Column)
  const isRelationOnly = decorators.every((d) =>
    ['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany', 'JoinColumn', 'JoinTable'].includes(d.getName()),
  );
  if (isRelationOnly) return null;

  return { name, type, allowNull, primaryKey, unique };
}

export function parseTypeORMAssociations(filePath: string): ForeignKeyRelation[] {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return [];

  const project = new Project({ compilerOptions: { strict: false } });
  const sourceFile = project.addSourceFileAtPath(absolutePath);

  const relations: ForeignKeyRelation[] = [];
  for (const cls of sourceFile.getClasses()) {
    const entityDecorator = cls.getDecorator('Entity');
    if (!entityDecorator) continue;

    const sourceTable = extractDecoratorStringArg(entityDecorator.getText())
      || classNameToTableName(cls.getName() || 'unknown');

    for (const prop of cls.getProperties()) {
      const rel = extractRelationFromProperty(prop, sourceTable);
      if (rel) relations.push(rel);
    }
  }
  return relations;
}

function extractRelationFromProperty(
  prop: PropertyDeclaration,
  sourceTable: string,
): ForeignKeyRelation | null {
  const decorators = prop.getDecorators();

  for (const dec of decorators) {
    const decName = dec.getName();
    const decText = dec.getText();

    if (decName === 'ManyToOne') {
      const targetClass = extractRelationTarget(decText);
      if (!targetClass) continue;
      const targetTable = classNameToTableName(targetClass);
      const fkField = findJoinColumnField(decorators) || `${prop.getName()}_id`;
      return {
        sourceTable, sourceField: fkField,
        targetTable, targetField: 'id',
        cardinality: 'N:1',
      };
    }

    if (decName === 'OneToMany') {
      const targetClass = extractRelationTarget(decText);
      if (!targetClass) continue;
      const targetTable = classNameToTableName(targetClass);
      return {
        sourceTable, sourceField: 'id',
        targetTable, targetField: `${classNameToTableName(sourceTable)}_id`,
        cardinality: '1:N',
      };
    }

    if (decName === 'OneToOne') {
      const targetClass = extractRelationTarget(decText);
      if (!targetClass) continue;
      const targetTable = classNameToTableName(targetClass);
      return {
        sourceTable, sourceField: 'id',
        targetTable, targetField: `${classNameToTableName(sourceTable)}_id`,
        cardinality: '1:1',
      };
    }
  }
  return null;
}

function extractRelationTarget(decoratorText: string): string | null {
  // @ManyToOne(() => User, ...) or @ManyToOne(type => User, ...)
  const match = decoratorText.match(/\(\s*(?:\(\)\s*=>|type\s*=>|\w+\s*=>)\s*(\w+)/);
  return match?.[1] || null;
}

function findJoinColumnField(decorators: ReturnType<PropertyDeclaration['getDecorators']>): string | null {
  for (const dec of decorators) {
    if (dec.getName() === 'JoinColumn') {
      const args = extractDecoratorObjectArg(dec.getText());
      if (args.name) return args.name;
    }
  }
  return null;
}

export function parseTypeORMDirectory(dir: string): TableSchema[] {
  const absoluteDir = path.resolve(dir);
  if (!fs.existsSync(absoluteDir)) return [];

  const files = fs.readdirSync(absoluteDir).filter((f) =>
    f.endsWith('.ts') &&
    !f.endsWith('.test.ts') &&
    !f.endsWith('.spec.ts') &&
    f !== 'index.ts',
  );

  const schemas: TableSchema[] = [];
  for (const file of files) {
    try {
      const schema = parseTypeORMFile(path.join(absoluteDir, file));
      if (schema) schemas.push(schema);
    } catch {
      // skip
    }
  }
  return schemas;
}

export function parseTypeORMAssociationsFromDir(dir: string): ForeignKeyRelation[] {
  const absoluteDir = path.resolve(dir);
  if (!fs.existsSync(absoluteDir)) return [];

  const files = fs.readdirSync(absoluteDir).filter((f) =>
    f.endsWith('.ts') &&
    !f.endsWith('.test.ts') &&
    !f.endsWith('.spec.ts') &&
    f !== 'index.ts',
  );

  const relations: ForeignKeyRelation[] = [];
  for (const file of files) {
    try {
      relations.push(...parseTypeORMAssociations(path.join(absoluteDir, file)));
    } catch {
      // skip
    }
  }
  return relations;
}

export function createTypeORMAdapter(): BackendAdapter {
  return {
    name: 'typeorm',

    async parseModels(dir: string): Promise<TableSchema[]> {
      return parseTypeORMDirectory(dir);
    },

    async parseAssociations(file: string): Promise<ForeignKeyRelation[]> {
      // TypeORM embeds relations in entity files, so parse the directory
      const dir = path.dirname(file);
      return parseTypeORMAssociationsFromDir(dir);
    },

    async parseControllers(dir: string): Promise<RouteEntry[]> {
      // Controller parsing is framework-agnostic (Express/Koa router patterns)
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
