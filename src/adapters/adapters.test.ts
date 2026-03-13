import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createSequelizeAdapter } from './sequelize.js';
import { parseTypeORMFile, parseTypeORMAssociations, createTypeORMAdapter } from './typeorm.js';
import {
  parsePrismaSchema,
  prismaModelsToSchemas,
  prismaModelsToRelations,
  createPrismaAdapter,
} from './prisma.js';
import { createAdapter, detectAdapter, resolveAdapter } from './registry.js';
import {
  parseDrizzleFile,
  parseDrizzleDirectory,
  createDrizzleAdapter,
} from './drizzle.js';

const FIXTURES = join(__dirname, '__fixtures__');

// ===== Sequelize Adapter =====
describe('createSequelizeAdapter', () => {
  it('creates adapter with name "sequelize"', () => {
    const adapter = createSequelizeAdapter();
    expect(adapter.name).toBe('sequelize');
  });

  it('parseModels returns empty for non-existent dir', async () => {
    const adapter = createSequelizeAdapter();
    const result = await adapter.parseModels('/nonexistent');
    expect(result).toEqual([]);
  });
});

// ===== TypeORM Adapter =====
describe('TypeORM parser', () => {
  const fixtureFile = join(FIXTURES, 'typeorm-entities.ts');

  it('parses @Entity class into TableSchema', () => {
    const schema = parseTypeORMFile(fixtureFile);
    expect(schema).not.toBeNull();
    expect(schema!.tableName).toBe('users');
    expect(schema!.className).toBe('User');

    const idField = schema!.fields.find((f) => f.name === 'id');
    expect(idField).toBeDefined();
    expect(idField!.primaryKey).toBe(true);

    const usernameField = schema!.fields.find((f) => f.name === 'username');
    expect(usernameField).toBeDefined();
    expect(usernameField!.type).toBe('STRING');
    expect(usernameField!.unique).toBe(true);
  });

  it('extracts @ManyToOne / @OneToMany relations', () => {
    const relations = parseTypeORMAssociations(fixtureFile);
    expect(relations.length).toBeGreaterThan(0);

    const userToPost = relations.find(
      (r) => r.sourceTable === 'users' && r.targetTable === 'post',
    );
    // User has @OneToMany to Post
    expect(userToPost).toBeDefined();
    expect(userToPost!.cardinality).toBe('1:N');
  });

  it('returns null for non-existent file', () => {
    expect(parseTypeORMFile('/nonexistent.ts')).toBeNull();
  });
});

describe('createTypeORMAdapter', () => {
  it('creates adapter with name "typeorm"', () => {
    const adapter = createTypeORMAdapter();
    expect(adapter.name).toBe('typeorm');
  });
});

// ===== Prisma Adapter =====
describe('Prisma parser', () => {
  const schemaContent = readFileSync(join(FIXTURES, 'schema.prisma'), 'utf-8');

  it('parses model blocks from schema', () => {
    const models = parsePrismaSchema(schemaContent);
    expect(models).toHaveLength(3);
    expect(models.map((m) => m.name)).toEqual(['User', 'Post', 'Tag']);
  });

  it('extracts @@map table names', () => {
    const models = parsePrismaSchema(schemaContent);
    expect(models[0].tableName).toBe('users');
    expect(models[1].tableName).toBe('posts');
  });

  it('converts models to TableSchema with correct fields', () => {
    const models = parsePrismaSchema(schemaContent);
    const schemas = prismaModelsToSchemas(models);

    const userSchema = schemas.find((s) => s.tableName === 'users');
    expect(userSchema).toBeDefined();
    expect(userSchema!.fields.find((f) => f.name === 'id')?.primaryKey).toBe(true);
    expect(userSchema!.fields.find((f) => f.name === 'email')?.unique).toBe(true);
    expect(userSchema!.fields.find((f) => f.name === 'name')?.allowNull).toBe(true);
  });

  it('extracts @relation as ForeignKeyRelation', () => {
    const models = parsePrismaSchema(schemaContent);
    const relations = prismaModelsToRelations(models);

    const postToUser = relations.find(
      (r) => r.sourceTable === 'posts' && r.targetTable === 'users',
    );
    expect(postToUser).toBeDefined();
    expect(postToUser!.sourceField).toBe('authorId');
    expect(postToUser!.targetField).toBe('id');
    expect(postToUser!.cardinality).toBe('N:1');
  });

  it('skips list fields (like posts Post[])', () => {
    const models = parsePrismaSchema(schemaContent);
    const schemas = prismaModelsToSchemas(models);
    const userSchema = schemas.find((s) => s.tableName === 'users');
    expect(userSchema!.fields.find((f) => f.name === 'posts')).toBeUndefined();
  });
});

describe('createPrismaAdapter', () => {
  it('creates adapter with name "prisma"', () => {
    const adapter = createPrismaAdapter();
    expect(adapter.name).toBe('prisma');
  });
});

// ===== Drizzle Adapter =====
describe('Drizzle parser', () => {
  const fixtureFile = join(FIXTURES, 'drizzle-schema.ts');

  it('parses 3 pgTable definitions from fixture', () => {
    const { schemas } = parseDrizzleFile(fixtureFile);
    expect(schemas).toHaveLength(3);
    expect(schemas.map((s) => s.tableName).sort()).toEqual(['posts', 'tags', 'users']);
  });

  it('extracts primary key field correctly', () => {
    const { schemas } = parseDrizzleFile(fixtureFile);
    const users = schemas.find((s) => s.tableName === 'users');
    expect(users).toBeDefined();
    const id = users!.fields.find((f) => f.name === 'id');
    expect(id?.primaryKey).toBe(true);
    expect(id?.type).toBe('INTEGER');
  });

  it('marks unique fields', () => {
    const { schemas } = parseDrizzleFile(fixtureFile);
    const users = schemas.find((s) => s.tableName === 'users');
    const email = users!.fields.find((f) => f.name === 'email');
    expect(email?.unique).toBe(true);
  });

  it('marks notNull fields as non-nullable', () => {
    const { schemas } = parseDrizzleFile(fixtureFile);
    const posts = schemas.find((s) => s.tableName === 'posts');
    const title = posts!.fields.find((f) => f.name === 'title');
    expect(title?.allowNull).toBe(false);
    const content = posts!.fields.find((f) => f.name === 'content');
    expect(content?.allowNull).toBe(true);
  });

  it('extracts FK relation from .references()', () => {
    const { relations } = parseDrizzleFile(fixtureFile);
    const fk = relations.find(
      (r) => r.sourceTable === 'posts' && r.targetTable === 'users',
    );
    expect(fk).toBeDefined();
    expect(fk!.sourceField).toBe('author_id');
    expect(fk!.targetField).toBe('id');
    expect(fk!.cardinality).toBe('N:1');
  });

  it('returns empty for non-existent file', () => {
    const result = parseDrizzleFile('/nonexistent/schema.ts');
    expect(result.schemas).toEqual([]);
    expect(result.relations).toEqual([]);
  });

  it('parseDrizzleDirectory returns empty for nonexistent dir', () => {
    const result = parseDrizzleDirectory('/nonexistent');
    expect(result.schemas).toEqual([]);
  });
});

describe('createDrizzleAdapter', () => {
  it('creates adapter with name "drizzle"', () => {
    const adapter = createDrizzleAdapter();
    expect(adapter.name).toBe('drizzle');
  });

  it('parseModels returns empty for non-existent dir', async () => {
    const adapter = createDrizzleAdapter();
    const result = await adapter.parseModels('/nonexistent');
    expect(result).toEqual([]);
  });
});

// ===== Registry =====
describe('adapter registry', () => {
  it('createAdapter returns correct adapter by name', () => {
    expect(createAdapter('sequelize').name).toBe('sequelize');
    expect(createAdapter('typeorm').name).toBe('typeorm');
    expect(createAdapter('prisma').name).toBe('prisma');
    expect(createAdapter('drizzle').name).toBe('drizzle');
  });

  it('createAdapter throws for unknown name', () => {
    expect(() => createAdapter('mongoose')).toThrow('Unknown adapter');
  });

  it('detectAdapter defaults to sequelize for empty dir', () => {
    expect(detectAdapter('/nonexistent')).toBe('sequelize');
  });

  it('resolveAdapter accepts a BackendAdapter object', () => {
    const custom = { name: 'custom', parseModels: async () => [], parseAssociations: async () => [], parseControllers: async () => [] };
    const result = resolveAdapter(custom, '.');
    expect(result.name).toBe('custom');
  });

  it('resolveAdapter creates adapter from string name', () => {
    const result = resolveAdapter('typeorm', '.');
    expect(result.name).toBe('typeorm');
  });
});
