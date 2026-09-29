import type { Architecture } from '@codebase-copilot/shared';
import { describe, expect, it } from 'vitest';
import { DATA_NODE_ID, layoutArchitecture, shortLabel } from './architecture-graph';

const architecture: Architecture = {
  components: [
    { id: 'src/routes', role: 'source', files: ['a', 'b'], symbolCount: 3, routeCount: 4 },
    { id: 'src/services', role: 'source', files: ['c'], symbolCount: 2, routeCount: 0 },
    { id: '(tests)', role: 'test', files: ['t'], symbolCount: 0, routeCount: 0 },
  ],
  dependencies: [
    { from: 'src/routes', to: 'src/services', count: 3, examples: [] },
    { from: '(tests)', to: 'src/routes', count: 1, examples: [] },
  ],
  integrations: [
    {
      name: 'Prisma',
      kind: 'database',
      packages: ['@prisma/client'],
      declaredIn: [],
      usedBy: [
        { component: 'src/services', count: 2, examples: [] },
        { component: '(tests)', count: 1, examples: [] },
      ],
    },
    {
      name: 'Stripe',
      kind: 'payments',
      packages: ['stripe'],
      declaredIn: ['package.json'],
      usedBy: [{ component: '(tests)', count: 1, examples: [] }],
    },
  ],
  dataModels: [{ name: 'User', source: 'prisma', file: 'prisma/schema.prisma', line: 1 }],
  envVars: [],
};

describe('layoutArchitecture', () => {
  it('shows application components, their integrations and the data model', () => {
    const { nodes, edges } = layoutArchitecture(architecture);
    expect(nodes.map((n) => n.id)).toEqual([
      'component:src/routes',
      'component:src/services',
      'integration:Prisma',
      DATA_NODE_ID,
    ]);
    expect(edges.map((e) => [e.kind, e.source, e.target, e.count])).toEqual([
      ['imports', 'component:src/routes', 'component:src/services', 3],
      ['uses', 'component:src/services', 'integration:Prisma', 2],
      ['stores', 'integration:Prisma', DATA_NODE_ID, 1],
    ]);
    expect(nodes[0]).toMatchObject({ label: 'src/routes', detail: '2 files · 4 routes' });
  });

  it('includes tests and their integrations when asked', () => {
    const { nodes, edges } = layoutArchitecture(architecture, { showSupporting: true });
    expect(nodes.map((n) => n.id)).toContain('component:(tests)');
    expect(nodes.map((n) => n.id)).toContain('integration:Stripe');
    expect(edges).toHaveLength(6);
  });

  it('lays nodes out top to bottom along imports', () => {
    const { nodes } = layoutArchitecture(architecture);
    const y = (id: string) => nodes.find((n) => n.id === id)!.y;
    expect(y('component:src/routes')).toBeLessThan(y('component:src/services'));
    expect(y('component:src/services')).toBeLessThan(y('integration:Prisma'));
  });

  it('shortens deep paths', () => {
    expect(shortLabel('src/app/routes/auth')).toBe('routes/auth');
    expect(shortLabel('.')).toBe('(top-level files)');
    expect(shortLabel('lib')).toBe('lib');
  });
});
