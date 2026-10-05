import dagre from '@dagrejs/dagre';
import type { Architecture } from '@codebase-copilot/shared';

export type MapNode =
  | {
      id: string;
      type: 'component';
      componentId: string;
      role: Architecture['components'][number]['role'];
      label: string;
      detail: string;
      x: number;
      y: number;
    }
  | { id: string; type: 'integration'; name: string; kind: string; x: number; y: number }
  | { id: string; type: 'data'; label: string; x: number; y: number };

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: 'imports' | 'uses' | 'stores';
  count: number;
}

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 56;

const componentNodeId = (id: string) => `component:${id}`;
const integrationNodeId = (name: string) => `integration:${name}`;
export const DATA_NODE_ID = 'data-model';

/** Last two path segments keep labels short ("routes/auth" for src/app/routes/auth). */
export function shortLabel(componentId: string): string {
  if (componentId === '.') return '(top-level files)';
  return componentId.split('/').slice(-2).join('/');
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Lays out the architecture map with dagre (top to bottom, following imports).
 * Tests, examples and tooling are hidden unless `showSupporting` is set, so the
 * first view is the application itself.
 */
export function layoutArchitecture(
  architecture: Architecture,
  { showSupporting = false }: { showSupporting?: boolean } = {},
): { nodes: MapNode[]; edges: MapEdge[] } {
  const components = architecture.components.filter((c) => showSupporting || c.role === 'source');
  const visible = new Set(components.map((c) => c.id));

  const edges: MapEdge[] = architecture.dependencies
    .filter((d) => visible.has(d.from) && visible.has(d.to))
    .map((d) => ({
      id: `imports:${d.from}->${d.to}`,
      source: componentNodeId(d.from),
      target: componentNodeId(d.to),
      kind: 'imports',
      count: d.count,
    }));

  const integrations = architecture.integrations
    .map((i) => ({ ...i, usedBy: i.usedBy.filter((u) => visible.has(u.component)) }))
    // Declared-only integrations have no component to hang from; they're listed elsewhere.
    .filter((i) => i.usedBy.length > 0);
  for (const integration of integrations) {
    for (const use of integration.usedBy) {
      edges.push({
        id: `uses:${use.component}->${integration.name}`,
        source: componentNodeId(use.component),
        target: integrationNodeId(integration.name),
        kind: 'uses',
        count: use.count,
      });
    }
  }

  const hasData = architecture.dataModels.length > 0;
  if (hasData) {
    for (const integration of integrations.filter((i) => i.kind === 'database')) {
      edges.push({
        id: `stores:${integration.name}`,
        source: integrationNodeId(integration.name),
        target: DATA_NODE_ID,
        kind: 'stores',
        count: architecture.dataModels.length,
      });
    }
  }

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 20, ranksep: 48, marginx: 8, marginy: 8 });
  graph.setDefaultEdgeLabel(() => ({}));
  const ids = [
    ...components.map((c) => componentNodeId(c.id)),
    ...integrations.map((i) => integrationNodeId(i.name)),
    ...(hasData ? [DATA_NODE_ID] : []),
  ];
  for (const id of ids) graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const at = (id: string) => {
    const { x, y } = graph.node(id);
    return { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 };
  };

  const nodes: MapNode[] = [
    ...components.map((c) => ({
      id: componentNodeId(c.id),
      type: 'component' as const,
      componentId: c.id,
      role: c.role,
      label: c.role === 'source' ? shortLabel(c.id) : c.id,
      detail: [
        plural(c.files.length, 'file'),
        c.routeCount > 0 ? plural(c.routeCount, 'route') : null,
      ]
        .filter(Boolean)
        .join(' · '),
      ...at(componentNodeId(c.id)),
    })),
    ...integrations.map((i) => ({
      id: integrationNodeId(i.name),
      type: 'integration' as const,
      name: i.name,
      kind: i.kind,
      ...at(integrationNodeId(i.name)),
    })),
    ...(hasData
      ? [
          {
            id: DATA_NODE_ID,
            type: 'data' as const,
            label: plural(architecture.dataModels.length, 'data model'),
            ...at(DATA_NODE_ID),
          },
        ]
      : []),
  ];
  return { nodes, edges };
}
