import * as fs from 'fs';
import * as path from 'path';
import {
  Project,
  SyntaxKind,
  type CallExpression,
  type SourceFile,
  Node,
  type PropertyAccessExpression,
  type Decorator,
  type MethodDeclaration,
  type ObjectLiteralExpression,
} from 'ts-morph';
import type { ApiEndpoint } from '../types.js';

export interface ControllerParser {
  parseFile(filePath: string): Promise<ApiEndpoint[]>;
  parseDirectory(dirPath: string): Promise<ApiEndpoint[]>;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

const METHOD_MAP: Record<string, string> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH',
};

const NEST_HTTP_DECORATORS = new Set(['get', 'post', 'put', 'delete', 'patch']);

/**
 * Parse a single Controller file and extract API endpoints.
 */
export function parseControllerFile(filePath: string): ApiEndpoint[] {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return [];

  try {
    const project = new Project({ compilerOptions: { strict: false } });
    const sourceFile = project.addSourceFileAtPath(absolutePath);

    const endpoints: ApiEndpoint[] = [];
    endpoints.push(...extractRouterCalls(sourceFile));
    endpoints.push(...extractBaseCrudRoutes(sourceFile));
    endpoints.push(...extractNestControllerRoutes(sourceFile));

    return deduplicateEndpoints(endpoints);
  } catch {
    return [];
  }
}

/**
 * Parse all Controller files in a directory.
 */
export function parseControllerDirectory(dirPath: string): ApiEndpoint[] {
  const absoluteDir = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDir)) return [];

  const files = fs.readdirSync(absoluteDir).filter((f) =>
    f.endsWith('.ts') &&
    !f.endsWith('.test.ts') &&
    !f.endsWith('.spec.ts') &&
    f !== 'index.ts',
  );

  const endpoints: ApiEndpoint[] = [];
  for (const file of files) {
    endpoints.push(...parseControllerFile(path.join(absoluteDir, file)));
  }
  return deduplicateEndpoints(endpoints);
}

function extractRouterCalls(sourceFile: SourceFile): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

    const propAccess = expr as PropertyAccessExpression;
    const methodName = propAccess.getName().toLowerCase();
    if (!HTTP_METHODS.has(methodName)) continue;

    const objectText = propAccess.getExpression().getText().trim();
    if (!isRouterLike(objectText)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;

    const routePath = resolveRoutePath(args[0], sourceFile);
    if (!routePath) continue;

    endpoints.push({
      method: METHOD_MAP[methodName],
      path: routePath,
      pathParams: extractPathParams(routePath),
      queryParams: [],
      bodyFields: [],
      responseFields: [],
      relatedTables: [],
      description: extractDescription(call),
    });
  }
  return endpoints;
}

function isRouterLike(text: string): boolean {
  return text === 'router' || text === 'this.router';
}

function extractBaseCrudRoutes(sourceFile: SourceFile): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  let isBaseCrud = false;
  for (const cls of sourceFile.getClasses()) {
    const heritage = cls.getExtends();
    if (heritage?.getText().includes('BaseCrudController')) {
      isBaseCrud = true;
      break;
    }
  }
  if (!isBaseCrud) return endpoints;

  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  let resourcePath: string | null = null;

  for (const call of calls) {
    const exprText = call.getExpression().getText();
    if (
      (exprText === 'super.registerRoutes' || exprText.endsWith('.registerRoutes')) &&
      !exprText.includes('Custom')
    ) {
      const args = call.getArguments();
      if (args.length >= 2) resourcePath = extractStringLiteral(args[1]);
    }
  }
  if (!resourcePath) return endpoints;

  const basePath = `/v1/:tenantId/${resourcePath}`;
  const crudRoutes: Array<{ method: string; path: string; desc: string }> = [
    { method: 'GET', path: basePath, desc: `List ${resourcePath}` },
    { method: 'GET', path: `${basePath}/:id`, desc: `Get ${resourcePath} by ID` },
    { method: 'POST', path: basePath, desc: `Create ${resourcePath}` },
    { method: 'PUT', path: `${basePath}/:id`, desc: `Update ${resourcePath}` },
    { method: 'DELETE', path: `${basePath}/:id`, desc: `Delete ${resourcePath}` },
    { method: 'POST', path: `${basePath}/batch-delete`, desc: `Batch delete ${resourcePath}` },
  ];

  for (const route of crudRoutes) {
    endpoints.push({
      method: route.method,
      path: route.path,
      pathParams: extractPathParams(route.path),
      queryParams: [],
      bodyFields: [],
      responseFields: [],
      relatedTables: [],
      description: route.desc,
    });
  }
  return endpoints;
}

function extractNestControllerRoutes(sourceFile: SourceFile): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];

  for (const cls of sourceFile.getClasses()) {
    const controllerDecorator = cls.getDecorators().find((d) => d.getName().toLowerCase() === 'controller');
    if (!controllerDecorator) continue;

    const controllerBasePath = normalizeRoutePath(extractDecoratorPath(controllerDecorator, sourceFile) ?? '');

    for (const methodDecl of cls.getMethods()) {
      const requestMapping = extractRequestMapping(methodDecl, sourceFile);
      if (requestMapping) {
        const fullPath = joinRoutePath(controllerBasePath, normalizeRoutePath(requestMapping.path));
        endpoints.push({
          method: requestMapping.method,
          path: fullPath,
          pathParams: extractPathParams(fullPath),
          queryParams: [],
          bodyFields: [],
          responseFields: [],
          relatedTables: [],
          description: extractMethodDescription(methodDecl),
        });
        continue;
      }

      const httpDecorator = methodDecl.getDecorators().find((d) => NEST_HTTP_DECORATORS.has(d.getName().toLowerCase()));
      if (!httpDecorator) continue;

      const methodName = httpDecorator.getName().toLowerCase();
      const method = METHOD_MAP[methodName];
      if (!method) continue;

      const methodPath = normalizeRoutePath(extractDecoratorPath(httpDecorator, sourceFile) ?? '');
      const fullPath = joinRoutePath(controllerBasePath, methodPath);

      endpoints.push({
        method,
        path: fullPath,
        pathParams: extractPathParams(fullPath),
        queryParams: [],
        bodyFields: [],
        responseFields: [],
        relatedTables: [],
        description: extractMethodDescription(methodDecl),
      });
    }
  }

  return endpoints;
}

/**
 * Infer related database table names from Service file imports.
 */
export function inferRelatedTables(servicePaths: string[]): string[] {
  const tables = new Set<string>();
  for (const sp of servicePaths) {
    const absolutePath = path.resolve(sp);
    if (!fs.existsSync(absolutePath)) continue;
    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*models[^'"]*['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const names = match[1].split(',').map((s) => s.trim());
        for (const name of names) {
          const cleanName = name.replace(/\s+as\s+\w+/, '').trim();
          if (cleanName) tables.add(pascalToSnake(cleanName));
        }
      }
    } catch {
      // skip
    }
  }
  return Array.from(tables);
}

function resolveRoutePath(node: Node, sourceFile: SourceFile): string | null {
  const kind = node.getKind();
  if (kind === SyntaxKind.StringLiteral) return node.getText().slice(1, -1);
  if (kind === SyntaxKind.TemplateExpression || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return resolveTemplateLiteral(node, sourceFile);
  }
  if (kind === SyntaxKind.Identifier) {
    return resolveVariableValue(sourceFile, node.getText().trim());
  }
  return null;
}

function extractDecoratorPath(decorator: Decorator, sourceFile: SourceFile): string | null {
  const args = decorator.getArguments();
  if (args.length === 0) return '';

  const firstArg = args[0];
  if (firstArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return extractPathFromObjectLiteral(firstArg as ObjectLiteralExpression, sourceFile);
  }

  return resolveRoutePath(firstArg, sourceFile);
}

function extractPathFromObjectLiteral(node: ObjectLiteralExpression, sourceFile: SourceFile): string | null {
  const pathProp = node.getProperty('path');
  if (!pathProp || !Node.isPropertyAssignment(pathProp)) return null;
  const initializer = pathProp.getInitializer();
  if (!initializer) return null;
  return resolveRoutePath(initializer, sourceFile);
}

function extractRequestMapping(
  methodDecl: MethodDeclaration,
  sourceFile: SourceFile,
): { method: string; path: string } | null {
  const decorator = methodDecl.getDecorators().find((d) => d.getName().toLowerCase() === 'requestmapping');
  if (!decorator) return null;

  const args = decorator.getArguments();
  if (args.length === 0) return null;
  const firstArg = args[0];
  if (firstArg.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;

  const obj = firstArg as ObjectLiteralExpression;
  const methodProp = obj.getProperty('method');
  let method = 'GET';
  if (methodProp && Node.isPropertyAssignment(methodProp)) {
    const init = methodProp.getInitializer();
    const methodText = init?.getText() || '';
    const normalized = methodText
      .replace(/['"`]/g, '')
      .split('.')
      .pop()
      ?.toUpperCase();
    if (normalized && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(normalized)) {
      method = normalized;
    }
  }

  const pathValue = extractPathFromObjectLiteral(obj, sourceFile) ?? '';
  return { method, path: pathValue };
}

function normalizeRoutePath(routePath: string): string {
  const cleaned = routePath.trim();
  if (!cleaned || cleaned === '/') return '';
  return `/${cleaned.replace(/^\/+|\/+$/g, '')}`;
}

function joinRoutePath(basePath: string, childPath: string): string {
  const joined = `${basePath}${childPath}`.replace(/\/+/g, '/');
  return joined || '/';
}

function extractMethodDescription(methodDecl: MethodDeclaration): string {
  const docs = methodDecl.getJsDocs();
  if (docs.length > 0) {
    const desc = docs[0].getDescription().trim();
    if (desc) return desc;
  }
  return '';
}

function resolveTemplateLiteral(node: Node, sourceFile: SourceFile): string {
  let result = node.getText().slice(1, -1);
  result = result.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const resolved = resolveVariableValue(sourceFile, expr.trim());
    return resolved || `{${expr.trim()}}`;
  });
  return result;
}

function resolveVariableValue(sourceFile: SourceFile, varName: string): string | null {
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getName() === varName) {
      const init = decl.getInitializer();
      if (!init) continue;
      const t = init.getText().trim();
      if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))
        return t.slice(1, -1);
      if (t.startsWith('`') && t.endsWith('`'))
        return resolveTemplateLiteral(init, sourceFile);
    }
  }
  return null;
}

function extractPathParams(routePath: string): string[] {
  const params: string[] = [];
  const regex = /:(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(routePath)) !== null) params.push(match[1]);
  return params;
}

function extractDescription(call: CallExpression): string {
  let current: Node = call;
  while (
    current.getParent() &&
    current.getParent()!.getKind() !== SyntaxKind.SourceFile &&
    current.getParent()!.getKind() !== SyntaxKind.Block
  ) {
    current = current.getParent()!;
  }
  const fullText = current.getFullText();
  const leadingText = fullText.substring(0, fullText.indexOf(current.getText()));
  const jsdocMatch = leadingText.match(/\/\*\*[\s\S]*?\*\s+(.+?)(?:\n|\*\/)/);
  if (jsdocMatch) return jsdocMatch[1].replace(/^\*\s*/, '').trim();
  const lineMatch = leadingText.match(/\/\/\s*(.+)/);
  if (lineMatch) return lineMatch[1].trim();
  return '';
}

function extractStringLiteral(node: Node): string | null {
  const t = node.getText().trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))
    return t.slice(1, -1);
  return null;
}

function pascalToSnake(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function deduplicateEndpoints(endpoints: ApiEndpoint[]): ApiEndpoint[] {
  const seen = new Map<string, ApiEndpoint>();
  for (const ep of endpoints) {
    const key = `${ep.method}:${ep.path}`;
    if (!seen.has(key)) {
      seen.set(key, ep);
    } else {
      const existing = seen.get(key)!;
      const merged = new Set([...existing.relatedTables, ...ep.relatedTables]);
      existing.relatedTables = Array.from(merged);
      if (!existing.description && ep.description) existing.description = ep.description;
    }
  }
  return Array.from(seen.values());
}

export function createControllerParser(): ControllerParser {
  return {
    async parseFile(filePath: string) {
      return parseControllerFile(filePath);
    },
    async parseDirectory(dirPath: string) {
      return parseControllerDirectory(dirPath);
    },
  };
}
