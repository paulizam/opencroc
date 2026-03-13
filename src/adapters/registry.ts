import * as fs from 'fs';
import * as path from 'path';
import type { BackendAdapter } from '../types.js';
import { createSequelizeAdapter } from './sequelize.js';
import { createTypeORMAdapter } from './typeorm.js';
import { createPrismaAdapter } from './prisma.js';

const ADAPTER_FACTORIES: Record<string, () => BackendAdapter> = {
  sequelize: createSequelizeAdapter,
  typeorm: createTypeORMAdapter,
  prisma: createPrismaAdapter,
};

/**
 * Create an adapter by name.
 */
export function createAdapter(name: string): BackendAdapter {
  const factory = ADAPTER_FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown adapter: "${name}". Available: ${Object.keys(ADAPTER_FACTORIES).join(', ')}`);
  }
  return factory();
}

/**
 * Auto-detect the ORM adapter from project structure.
 *
 * Detection order:
 * 1. Prisma — if `prisma/schema.prisma` exists
 * 2. TypeORM — if any .ts file has `@Entity` decorator
 * 3. Sequelize — default fallback (`.init()` pattern)
 */
export function detectAdapter(backendRoot: string): string {
  const root = path.resolve(backendRoot);

  // Check for Prisma
  const prismaLocations = [
    path.join(root, 'prisma', 'schema.prisma'),
    path.join(root, 'schema.prisma'),
    path.join(root, '..', 'prisma', 'schema.prisma'),
  ];
  for (const loc of prismaLocations) {
    if (fs.existsSync(loc)) return 'prisma';
  }

  // Check for TypeORM — scan models directory for @Entity
  const modelsDir = path.join(root, 'models');
  if (fs.existsSync(modelsDir)) {
    try {
      const files = fs.readdirSync(modelsDir, { recursive: true });
      for (const file of files) {
        const filePath = path.join(modelsDir, String(file));
        if (!filePath.endsWith('.ts')) continue;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (/@Entity\s*\(/.test(content)) return 'typeorm';
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  // Default to Sequelize
  return 'sequelize';
}

/**
 * Resolve adapter: if a string name is given, create it; if already a BackendAdapter, use it.
 * If 'auto', detect from project structure.
 */
export function resolveAdapter(
  adapterOrName: string | BackendAdapter | undefined,
  backendRoot: string,
): BackendAdapter {
  if (typeof adapterOrName === 'object' && adapterOrName !== null) {
    return adapterOrName;
  }
  const name = adapterOrName === 'auto' || !adapterOrName
    ? detectAdapter(backendRoot)
    : adapterOrName;
  return createAdapter(name);
}
