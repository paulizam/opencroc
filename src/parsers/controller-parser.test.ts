import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { parseControllerFile, parseControllerDirectory } from './controller-parser.js';

function withTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencroc-controller-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('controller-parser', () => {
  it('parses Express router endpoints', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'user.controller.ts');
      fs.writeFileSync(file, `
        import { Router } from 'express';
        const router = Router();

        router.get('/users/:id', () => {});
        router.post('/users', () => {});
      `);

      const endpoints = parseControllerFile(file);
      expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
        'GET /users/:id',
        'POST /users',
      ]);
      expect(endpoints[0].pathParams).toEqual(['id']);
    });
  });

  it('parses NestJS @Controller + HTTP decorators', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'user.controller.ts');
      fs.writeFileSync(file, `
        import { Controller, Get, Post } from '@nestjs/common';

        @Controller('users')
        class UserController {
          @Get()
          list() {}

          @Get(':id')
          detail() {}

          @Post()
          create() {}
        }
      `);

      const endpoints = parseControllerFile(file);
      expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
        'GET /users',
        'GET /users/:id',
        'POST /users',
      ]);
      expect(endpoints[1].pathParams).toEqual(['id']);
    });
  });

  it('parses NestJS RequestMapping object syntax', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'order.controller.ts');
      fs.writeFileSync(file, `
        import { Controller, RequestMapping, RequestMethod } from '@nestjs/common';

        const ROOT = 'orders';

        @Controller({ path: ROOT })
        class OrderController {
          @RequestMapping({ method: RequestMethod.PATCH, path: ':id/status' })
          updateStatus() {}
        }
      `);

      const endpoints = parseControllerFile(file);
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].method).toBe('PATCH');
      expect(endpoints[0].path).toBe('/orders/:id/status');
      expect(endpoints[0].pathParams).toEqual(['id']);
    });
  });

  it('parses mixed controller directory files', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'express.controller.ts'), `
        const router = { get: (_path: string, _handler: () => void) => undefined };
        router.get('/health', () => {});
      `);
      fs.writeFileSync(path.join(dir, 'nest.controller.ts'), `
        import { Controller, Get } from '@nestjs/common';

        @Controller('metrics')
        class MetricsController {
          @Get('summary')
          summary() {}
        }
      `);

      const endpoints = parseControllerDirectory(dir);
      expect(endpoints.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
        'GET /health',
        'GET /metrics/summary',
      ]);
    });
  });
});
