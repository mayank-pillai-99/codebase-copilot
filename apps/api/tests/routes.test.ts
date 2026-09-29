import { beforeAll, describe, expect, it } from 'vitest';
import { createCodeParser, type CodeLanguage, type CodeParser } from '../src/indexing/parser';
import { analyzeFile, type ParsedRoute } from '../src/indexing/routes';

let parser: CodeParser;
beforeAll(async () => {
  parser = await createCodeParser();
});

const routesOf = (source: string, path = 'src/server.ts', language: CodeLanguage = 'typescript') =>
  analyzeFile(parser, source, language, path).routes;
const summary = (routes: ParsedRoute[]) =>
  routes.map((r) => `${r.method} ${r.path} → ${r.handlerName ?? '<inline>'}`);

describe('express-style routes', () => {
  it('detects app/router method calls with named, member, wrapped and inline handlers', () => {
    const routes = routesOf(`
import { getUser } from './users.controller';
const app = express();
const router = Router();
function listPayments(req, res) {}

app.get('/users/:id', authenticate, getUser);
router.post('/payments', payments.create);
router.delete('/payments/:id', asyncHandler(removePayment));
app.put(\`/profile\`, (req, res) => res.send('ok'));
router.get('/payments', listPayments);
app.all('*', notFound);
`);
    expect(summary(routes)).toEqual([
      'GET /users/:id → getUser',
      'POST /payments → payments.create',
      'DELETE /payments/:id → removePayment',
      'PUT /profile → <inline>',
      'GET /payments → listPayments',
      'ANY * → notFound',
    ]);
    // Only the same-file handler is linked at this stage.
    expect(routes.map((r) => r.handlerSymbolIndex !== null)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(routes[0]).toMatchObject({ framework: 'express-style', startLine: 7, endLine: 7 });
  });

  it('detects Fastify routes with an options argument', () => {
    expect(
      summary(routesOf(`app.get('/health', { schema }, async () => ({ ok: true }));`)),
    ).toEqual(['GET /health → <inline>']);
  });

  it('follows router.route() chains', () => {
    const routes = routesOf(`
router.route('/books/:id').get(getBook).put(updateBook);
`);
    expect(summary(routes)).toEqual(['PUT /books/:id → updateBook', 'GET /books/:id → getBook']);
  });

  it('ignores HTTP client calls and non-route lookups', () => {
    const routes = routesOf(`
axios.get('/api/users', config);
this.http.post('/api/orders', body);
cache.get('/users');
map.get(key, fallback);
url.get('relative', handler);
`);
    expect(routes).toEqual([]);
  });
});

describe('Next.js routes', () => {
  const nextRoute = `
export async function GET(request: Request) { return Response.json([]); }
export async function POST(request: Request) {}
function helper() {}
export const dynamic = 'force-dynamic';
`;

  it('maps App Router route files to one route per exported method', () => {
    const routes = routesOf(nextRoute, 'src/app/api/(admin)/users/[id]/route.ts');
    expect(summary(routes)).toEqual(['GET /api/users/[id] → GET', 'POST /api/users/[id] → POST']);
    expect(routes.every((r) => r.framework === 'nextjs-app' && r.handlerSymbolIndex !== null)).toBe(
      true,
    );
  });

  it('maps a root route handler to /', () => {
    expect(summary(routesOf(nextRoute, 'app/route.ts'))).toEqual(['GET / → GET', 'POST / → POST']);
  });

  it('only treats route.ts inside an app directory as a Next.js route', () => {
    expect(routesOf(nextRoute, 'src/lib/route.ts')).toEqual([]);
  });

  it('maps Pages Router API files to their default export', () => {
    const source = 'export default async function handler(req, res) { res.json({}) }';
    expect(summary(routesOf(source, 'pages/api/users/index.js', 'javascript'))).toEqual([
      'ANY /api/users → handler',
    ]);
    expect(summary(routesOf(source, 'src/pages/api/users/[id].ts'))).toEqual([
      'ANY /api/users/[id] → handler',
    ]);
  });
});
