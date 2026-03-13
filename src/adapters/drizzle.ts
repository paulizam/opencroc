import * as fs from 'fs';
import * as path from 'path';
import {
  Project,
  SyntaxKind,
  Node,
  type SourceFile,
  type CallExpression,
  type ObjectLiteralExpression,
  type PropertyAccessExpression,
} from 'ts-morph';
import type { BackendAdapter, TableSchema, FieldSchema, ForeignKeyRelation, RouteEntry } from '../types.js';

// Drizzle column constructor name → generic field type
const DRIZZLE_TYPE_MAP: Record<string, string> = {
  // integer family
  int: 'INTEGER',
  integer: 'INTEGER',
  serial: 'INTEGER',
  smallint: 'INTEGER',
  tinyint: 'INTEGER',
  mediumint: 'INTEGER',
  bigint: 'BIGINT',
  bigserial: 'BIGINT',
  // float / decimal
  real: 'FLOAT',
  float: 'FLOAT',
  doublePrecision: 'FLOAT',
  double: 'FLOAT',
  numeric: 'DECIMAL',
  decimal: 'DECIMAL',
  // string
  varchar: 'STRING',
  char: 'STRING',
  nvarchar: 'STRING',
  text: 'TEXT',
  // boolean
  boolean: 'BOOLEAN',
  bool: 'BOOLEAN',
  // date / time
  date: 'DATE',
  datetime: 'DATE',
  timestamp: 'DATE',
  timestamptz: 'DATE',
  time: 'TIME',
  // json
  json: 'JSON',
  jsonb: 'JSON',
  // binary / misc
  blob: 'BLOB',
  bytea: 'BLOB',
  uuid: 'STRING',
};

const TABLE_FUNCTIONS = new Set(['pgTable', 'mysqlTable', 'sqliteTable']);

interface DrizzleColumn {
  varName: string;
  sqlName: string;
  type: string;
  isPrimary: boolean;
  isNotNull: boolean;
  isUnique: boolean;
  defaultValue?: string;
  referencesExpr?: string;
}

interface DrizzleTable {
  varName: string;
  tableName: string;
  columns: DrizzleColumn[];
}

function findTableCalls(sourceFile: SourceFile): DrizzleTable[] {
  const tables: DrizzleTable[] = [];
  const varDecls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);

  for (const decl of varDecls) {
    const init = decl.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.CallExpression) continue;

    const call = init as CallExpression;
    const funcName = call.getExpression().getText().trim();
    if (!TABLE_FUNCTIONS.has(funcName)) continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    // 1st arg: SQL table name
    const nameArg = args[0];
    if (nameArg.getKind() !== SyntaxKind.StringLiteral) continue;
    const tableName = nameArg.getText().slice(1, -1);

    // 2nd arg: column definitions object
    const colsArg = args[1];
    if (colsArg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

    const columns = parseColumnObject(colsArg as ObjectLiteralExpression);
    tables.push({ varName: decl.getName(), tableName, columns });
  }

  return tables;
}

function parseColumnObject(obj: ObjectLiteralExpression): DrizzleColumn[] {
  const columns: DrizzleColumn[] = [];
  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const varName = prop.getName();
    const val = prop.getInitializer();
    if (!val) continue;
    const col = parseColumnChain(val, varName);
    if (col) columns.push(col);
  }
  return columns;
}

function parseColumnChain(expr: Node, varName: string): DrizzleColumn | null {
  // Flatten method chain from root outward: root call → chained calls
  const chain: CallExpression[] = [];
  let current: Node = expr;

  while (current.getKind() === SyntaxKind.CallExpression) {
    chain.unshift(current as CallExpression);
    const callee = (current as CallExpression).getExpression();
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      current = (callee as PropertyAccessExpression).getExpression();
    } else {
      break;
    }
  }

  if (chain.length === 0) return null;

  // Root call determines the column type: e.g. varchar('col_name', { length: 255 })
  const root = chain[0];
  const rootFuncName = root.getExpression().getText().trim().split('.').pop() ?? '';
  const drizzleType = DRIZZLE_TYPE_MAP[rootFuncName];
  if (!drizzleType) return null;

  const rootArgs = root.getArguments();
  const sqlName =
    rootArgs.length > 0 && rootArgs[0].getKind() === SyntaxKind.StringLiteral
      ? rootArgs[0].getText().slice(1, -1)
      : varName;

  const col: DrizzleColumn = {
    varName,
    sqlName,
    type: drizzleType,
    isPrimary: false,
    isNotNull: false,
    isUnique: false,
  };

  // Walk remaining chain for modifiers
  for (let i = 1; i < chain.length; i++) {
    const call = chain[i];
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const methodName = (callee as PropertyAccessExpression).getName();

    switch (methodName) {
      case 'primaryKey':
        col.isPrimary = true;
        col.isNotNull = true;
        break;
      case 'notNull':
        col.isNotNull = true;
        break;
      case 'unique':
        col.isUnique = true;
        break;
      case 'default':
      case 'defaultNow': {
        const args = call.getArguments();
        col.defaultValue = args.length > 0 ? args[0].getText() : 'now()';
        break;
      }
      case 'references': {
        const args = call.getArguments();
        if (args.length > 0) col.referencesExpr = args[0].getText();
        break;
      }
    }
  }

  return col;
}

function resolveRelations(tables: DrizzleTable[]): ForeignKeyRelation[] {
  const relations: ForeignKeyRelation[] = [];
  const varToTableName = new Map<string, string>();
  const varColToSqlCol = new Map<string, string>();

  for (const t of tables) {
    varToTableName.set(t.varName, t.tableName);
    for (const c of t.columns) {
      varColToSqlCol.set(`${t.varName}.${c.varName}`, c.sqlName);
    }
  }

  for (const t of tables) {
    for (const col of t.columns) {
      if (!col.referencesExpr) continue;
      // Extract target from arrow function: () => targetTable.targetCol
      const arrowMatch = col.referencesExpr.match(/=>\s*(\w+)\.(\w+)/);
      if (!arrowMatch) continue;
      const targetVarName = arrowMatch[1];
      const targetColVarName = arrowMatch[2];
      const targetTable = varToTableName.get(targetVarName);
      if (!targetTable) continue;
      const targetCol = varColToSqlCol.get(`${targetVarName}.${targetColVarName}`) ?? targetColVarName;

      relations.push({
        sourceTable: t.tableName,
        sourceField: col.sqlName,
        targetTable,
        targetField: targetCol,
        cardinality: 'N:1',
      });
    }
  }

  return relations;
}

export function parseDrizzleFile(filePath: string): { schemas: TableSchema[]; relations: ForeignKeyRelation[] } {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return { schemas: [], relations: [] };

  try {
    const project = new Project({ compilerOptions: { strict: false } });
    const sourceFile = project.addSourceFileAtPath(absolutePath);
    const tables = findTableCalls(sourceFile);

    const schemas: TableSchema[] = tables.map((t) => ({
      tableName: t.tableName,
      className: t.varName,
      fields: t.columns.map((c): FieldSchema => ({
        name: c.sqlName,
        type: c.type,
        allowNull: !c.isNotNull && !c.isPrimary,
        primaryKey: c.isPrimary,
        unique: c.isUnique,
        defaultValue: c.defaultValue,
      })),
    }));

    return { schemas, relations: resolveRelations(tables) };
  } catch {
    return { schemas: [], relations: [] };
  }
}

export function parseDrizzleDirectory(dirPath: string): { schemas: TableSchema[]; relations: ForeignKeyRelation[] } {
  const absoluteDir = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDir)) return { schemas: [], relations: [] };

  const files = fs.readdirSync(absoluteDir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts') && f !== 'index.ts',
  );

  const allSchemas: TableSchema[] = [];
  const allRelations: ForeignKeyRelation[] = [];
  for (const file of files) {
    const result = parseDrizzleFile(path.join(absoluteDir, file));
    allSchemas.push(...result.schemas);
    allRelations.push(...result.relations);
  }
  return { schemas: allSchemas, relations: allRelations };
}

export function createDrizzleAdapter(): BackendAdapter {
  return {
    name: 'drizzle',

    async parseModels(dir: string): Promise<TableSchema[]> {
      return parseDrizzleDirectory(dir).schemas;
    },

    async parseAssociations(dir: string): Promise<ForeignKeyRelation[]> {
      return parseDrizzleDirectory(dir).relations;
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
