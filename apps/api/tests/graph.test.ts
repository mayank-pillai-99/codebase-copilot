import { beforeAll, describe, expect, it } from 'vitest';
import { buildCodeGraph, type CodeGraph, type SourceFile } from '../src/indexing/graph';
import { createCodeParser, type CodeParser } from '../src/indexing/parser';

let parser: CodeParser;
beforeAll(async () => {
  parser = await createCodeParser();
});

function repo(files: Record<string, string>): SourceFile[] {
  return Object.entries(files).map(([path, content]) => {
    const isCode = /\.[cm]?[jt]sx?$/.test(path);
    return {
      path,
      content,
      kind: isCode ? 'CODE' : 'CONFIG',
      language: isCode
        ? path.endsWith('.tsx')
          ? 'tsx'
          : path.endsWith('.ts')
            ? 'typescript'
            : 'javascript'
        : 'json',
    };
  });
}

function name(graph: CodeGraph, ref: { path: string; index: number } | null) {
  if (!ref) return null;
  return `${ref.path}:${graph.files.get(ref.path)!.symbols[ref.index]!.qualifiedName}`;
}

function callsFrom(graph: CodeGraph, path: string) {
  return graph.calls
    .filter((c) => c.path === path)
    .map((c) => `${c.calleeText} → ${name(graph, c.target) ?? 'unresolved'}`);
}

describe('buildCodeGraph', () => {
  const graph = () =>
    buildCodeGraph(
      repo({
        'src/services/payment.service.ts': `
import { db } from '../lib/db';
export class PaymentService {
  static fromEnv() { return new PaymentService(); }
  async charge(amount: number) { this.validate(amount); return db.insert(amount); }
  private validate(amount: number) {}
}
export function formatAmount(n: number) { return n.toFixed(2); }
export default PaymentService;
`,
        'src/services/index.ts': `
export * from './payment.service';
export { default as Payments } from './payment.service';
`,
        'src/lib/db.ts': `export const db = { insert: (x: unknown) => x };`,
        'src/utils.ts': `export function log(msg: string) {}`,
        'src/routes/payments.ts': `
import { Router } from 'express';
import { PaymentService, formatAmount, Payments } from '../services';
import * as utils from '../utils';
import legacy from './legacy';

export const router = Router();
async function createPayment(req, res) {
  const service = PaymentService.fromEnv();
  await service.charge(req.body.amount);
  utils.log(formatAmount(1));
  new Payments();
  legacy();
  unknownGlobal();
}
router.post('/payments', createPayment);
router.get('/payments/format', utils.log);
`,
      }),
      parser,
    );

  it('resolves imports to files, following index files, and records packages', () => {
    const imports = graph()
      .imports.filter((i) => i.fromPath === 'src/routes/payments.ts')
      .map((i) => [
        i.specifier,
        i.toPath ?? (i.external ? `pkg:${i.packageName}` : 'unresolved'),
        i.importedNames,
      ]);
    expect(imports).toEqual([
      ['express', 'pkg:express', ['Router']],
      ['../services', 'src/services/index.ts', ['PaymentService', 'formatAmount', 'Payments']],
      ['../utils', 'src/utils.ts', ['*']],
      ['./legacy', 'unresolved', ['default']],
    ]);
  });

  it('resolves calls through re-exports, namespaces, static methods, this and constructors', () => {
    expect(callsFrom(graph(), 'src/routes/payments.ts')).toEqual([
      'Router → unresolved',
      'PaymentService.fromEnv → src/services/payment.service.ts:PaymentService.fromEnv',
      // service is a local variable; its type isn't known without type inference.
      'service.charge → unresolved',
      'utils.log → src/utils.ts:log',
      'formatAmount → src/services/payment.service.ts:formatAmount',
      'Payments → src/services/payment.service.ts:PaymentService', // new Payments()
      'legacy → unresolved',
      'unknownGlobal → unresolved',
      'router.post → unresolved',
      'router.get → unresolved',
    ]);
    expect(callsFrom(graph(), 'src/services/payment.service.ts')).toEqual([
      'PaymentService → src/services/payment.service.ts:PaymentService', // new PaymentService()
      'this.validate → src/services/payment.service.ts:PaymentService.validate',
      'db.insert → unresolved',
      'n.toFixed → unresolved',
    ]);
  });

  it('links route handlers defined locally or imported through a namespace', () => {
    const routes = graph().routes.map(
      (r) => `${r.method} ${r.urlPath} → ${name(graph(), r.handler)}`,
    );
    expect(routes).toEqual([
      'POST /payments → src/routes/payments.ts:createPayment',
      'GET /payments/format → src/utils.ts:log',
    ]);
  });

  it('survives re-export cycles', () => {
    const cyclic = buildCodeGraph(
      repo({
        'a.ts': `export * from './b';`,
        'b.ts': `export * from './a';`,
        'main.ts': `import { missing } from './a'; missing();`,
      }),
      parser,
    );
    expect(callsFrom(cyclic, 'main.ts')).toEqual(['missing → unresolved']);
  });

  it('reports parse progress per code file', () => {
    const progress: string[] = [];
    buildCodeGraph(
      repo({ 'a.ts': 'export {}', 'b.ts': 'export {}', 'package.json': '{}' }),
      parser,
      (d, t) => progress.push(`${d}/${t}`),
    );
    expect(progress).toEqual(['1/2', '2/2']);
  });
});
