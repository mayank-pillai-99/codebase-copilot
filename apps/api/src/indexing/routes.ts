import type { Node } from 'web-tree-sitter';
import {
  descendants,
  extractFile,
  isStaticString,
  stringValue,
  type CodeLanguage,
  type CodeParser,
  type ParsedFile,
  type ParsedSymbol,
} from './parser';

export type RouteFramework = 'express-style' | 'nextjs-app' | 'nextjs-pages';

export interface ParsedRoute {
  method: string;
  path: string;
  framework: RouteFramework;
  /** As written: "getUser", "users.getUser"; null for inline handlers. */
  handlerName: string | null;
  /** Same-file symbol when the handler is defined here; cross-file handlers are resolved later. */
  handlerSymbolIndex: number | null;
  startLine: number;
  endLine: number;
}

export interface AnalyzedFile extends ParsedFile {
  routes: ParsedRoute[];
}

/** Parses once and runs every per-file analysis on the same tree. */
export function analyzeFile(
  parser: CodeParser,
  source: string,
  language: CodeLanguage,
  path: string,
): AnalyzedFile {
  return parser.withTree(source, language, (root) => {
    const parsed = extractFile(root);
    return {
      ...parsed,
      routes: [
        ...detectExpressStyleRoutes(root, parsed.symbols),
        ...detectNextRoutes(path, parsed.symbols),
      ],
    };
  });
}

const HTTP_METHODS: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  del: 'DELETE',
  options: 'OPTIONS',
  head: 'HEAD',
  all: 'ANY',
};

// HTTP *clients* share the method names (axios.get('/users', config)); they aren't routes.
const HTTP_CLIENTS = new Set([
  'axios',
  'http',
  'https',
  'got',
  'ky',
  'superagent',
  'request',
  'fetch',
  '$http',
  'httpClient',
  'this.http',
  'this.httpClient',
]);

/**
 * Express, Fastify, Koa-router and similar: `app.get('/path', ...handlers)` and
 * `router.route('/path').post(handler)`. Heuristic by design: any receiver name is
 * accepted, but the path must be a static string starting with "/" and the last
 * argument must look like a handler.
 */
export function detectExpressStyleRoutes(root: Node, symbols: ParsedSymbol[]): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  for (const call of descendants(root, 'call_expression')) {
    const callee = call.childForFieldName('function');
    if (callee?.type !== 'member_expression') continue;
    const method = HTTP_METHODS[callee.childForFieldName('property')?.text ?? ''];
    const receiver = callee.childForFieldName('object');
    if (!method || !receiver) continue;
    if (HTTP_CLIENTS.has(receiver.text.replace(/\s+/g, ''))) continue;

    const args = (call.childForFieldName('arguments')?.namedChildren ?? []).filter(
      (a) => a.type !== 'comment',
    );

    let path: string;
    let handlers: Node[];
    const chainedPath = routeChainPath(receiver);
    if (chainedPath !== null) {
      path = chainedPath;
      handlers = args;
    } else {
      const [first, ...rest] = args;
      if (!first || !isStaticString(first)) continue;
      path = stringValue(first);
      handlers = rest;
    }
    if (!path.startsWith('/') && path !== '*') continue;

    const handler = handlers.at(-1);
    if (!handler || !looksLikeHandler(handler)) continue;

    routes.push({
      method,
      path,
      framework: 'express-style',
      ...handlerInfo(handler, symbols),
      startLine: call.startPosition.row + 1,
      endLine: call.endPosition.row + 1,
    });
  }
  return routes;
}

/** `router.route('/users/:id')` returns the path when `node` is such a call. */
function routeChainPath(node: Node): string | null {
  // Walk down .get(...).post(...) chains to the .route('/x') call.
  let current: Node | null = node;
  while (current?.type === 'call_expression') {
    const fn = current.childForFieldName('function');
    if (fn?.type !== 'member_expression') return null;
    if (fn.childForFieldName('property')?.text === 'route') {
      const arg = current.childForFieldName('arguments')?.namedChildren[0];
      return arg && isStaticString(arg) ? stringValue(arg) : null;
    }
    current = fn.childForFieldName('object');
  }
  return null;
}

function looksLikeHandler(node: Node): boolean {
  if (['arrow_function', 'function_expression', 'function'].includes(node.type)) return true;
  if (node.type === 'member_expression') return true;
  if (node.type === 'call_expression') return true; // asyncHandler(fn), controller.bind(...)
  if (node.type === 'identifier') {
    return !/^(config|options|opts|params|headers|body|data|payload)$/i.test(node.text);
  }
  return false;
}

function handlerInfo(
  handler: Node,
  symbols: ParsedSymbol[],
): Pick<ParsedRoute, 'handlerName' | 'handlerSymbolIndex'> {
  if (['arrow_function', 'function_expression', 'function'].includes(handler.type)) {
    return { handlerName: null, handlerSymbolIndex: null };
  }
  // asyncHandler(getUser) → getUser
  const target =
    handler.type === 'call_expression'
      ? (handler.childForFieldName('arguments')?.namedChildren.at(-1) ?? handler)
      : handler;
  const name = target.text.replace(/\s+/g, '');
  if (target.type !== 'identifier' && target.type !== 'member_expression') {
    return { handlerName: name.slice(0, 120), handlerSymbolIndex: null };
  }
  const local = symbols.find((s) => s.parentIndex === null && s.name === name);
  return { handlerName: name, handlerSymbolIndex: local?.index ?? null };
}

const NEXT_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Next.js App Router `app/**\/route.ts` (one route per exported HTTP-method function)
 * and Pages Router `pages/api/**` (default export handles every method).
 */
export function detectNextRoutes(filePath: string, symbols: ParsedSymbol[]): ParsedRoute[] {
  const appMatch = filePath.match(/(?:^|\/)app\/((?:.+\/)?)route\.[cm]?[jt]sx?$/);
  if (appMatch) {
    const urlPath = toUrlPath(appMatch[1] ?? '');
    return symbols
      .filter((s) => s.exported && s.parentIndex === null && NEXT_METHODS.has(s.name))
      .map((s) => ({
        method: s.name,
        path: urlPath,
        framework: 'nextjs-app' as const,
        handlerName: s.name,
        handlerSymbolIndex: s.index,
        startLine: s.startLine,
        endLine: s.endLine,
      }));
  }

  const pagesMatch = filePath.match(/(?:^|\/)pages\/api\/(.+)\.[cm]?[jt]sx?$/);
  if (pagesMatch) {
    const handler = symbols.find((s) => s.isDefault && s.parentIndex === null);
    if (!handler) return [];
    const urlPath = `/api/${pagesMatch[1]}`.replace(/\/index$/, '');
    return [
      {
        method: 'ANY',
        path: urlPath,
        framework: 'nextjs-pages',
        handlerName: handler.name,
        handlerSymbolIndex: handler.index,
        startLine: handler.startLine,
        endLine: handler.endLine,
      },
    ];
  }
  return [];
}

/** "api/(admin)/users/[id]/" → "/api/users/[id]" (route groups and @slots aren't in URLs). */
function toUrlPath(directory: string): string {
  const segments = directory
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  return `/${segments.join('/')}`;
}
