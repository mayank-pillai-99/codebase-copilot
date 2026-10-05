'use client';

import type { Architecture } from '@codebase-copilot/shared';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DATA_NODE_ID,
  layoutArchitecture,
  NODE_HEIGHT,
  NODE_WIDTH,
  type MapEdge,
  type MapNode,
} from '@/lib/architecture-graph';
import { codeHref } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { useMediaQuery } from '@/lib/use-media-query';

type Selection =
  | { type: 'component'; id: string }
  | { type: 'integration'; name: string }
  | { type: 'data' }
  | { type: 'edge'; edge: MapEdge }
  | null;

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

function Box({ data, selected }: NodeProps<Node<{ node: MapNode; selected: boolean }>>) {
  const { node } = data;
  const tone =
    node.type === 'integration'
      ? 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950'
      : node.type === 'data'
        ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
        : node.role === 'source'
          ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
          : 'border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/60';
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={`flex flex-col justify-center rounded-lg border px-3 text-left shadow-sm ${tone} ${
        selected || data.selected ? 'ring-2 ring-brand-500' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <span className="truncate font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        {node.type === 'component'
          ? node.label
          : node.type === 'integration'
            ? node.name
            : node.label}
      </span>
      <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {node.type === 'component'
          ? node.detail
          : node.type === 'integration'
            ? `external · ${node.kind}`
            : 'from the schema and ORM code'}
      </span>
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { box: Box };

export function ArchitectureMap({
  snapshotId,
  architecture,
}: {
  snapshotId: string;
  architecture: Architecture;
}) {
  const [showSupporting, setShowSupporting] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const theme = useTheme();
  // Phones get a list instead of the canvas, whose boxes would be too small to read.
  const wide = useMediaQuery('(min-width: 768px)', true);
  const details = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!wide && selection) details.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [wide, selection]);
  const select = (mapNode: MapNode) =>
    setSelection(
      mapNode.type === 'component'
        ? { type: 'component', id: mapNode.componentId }
        : mapNode.type === 'integration'
          ? { type: 'integration', name: mapNode.name }
          : { type: 'data' },
    );
  const layout = useMemo(
    () => layoutArchitecture(architecture, { showSupporting }),
    [architecture, showSupporting],
  );

  const selectedNodeId =
    selection?.type === 'component'
      ? `component:${selection.id}`
      : selection?.type === 'integration'
        ? `integration:${selection.name}`
        : selection?.type === 'data'
          ? DATA_NODE_ID
          : null;

  const nodes: Node<{ node: MapNode; selected: boolean }>[] = layout.nodes.map((node) => ({
    id: node.id,
    type: 'box',
    position: { x: node.x, y: node.y },
    data: { node, selected: node.id === selectedNodeId },
    draggable: false,
    connectable: false,
  }));
  const edges: Edge[] = layout.edges.map((edge) => {
    const active = selection?.type === 'edge' && selection.edge.id === edge.id;
    // With a box selected, its own connections stand out and the rest fade back.
    const connected =
      selectedNodeId !== null && (edge.source === selectedNodeId || edge.target === selectedNodeId);
    const focus = active || connected;
    const faded = (selectedNodeId !== null || selection?.type === 'edge') && !focus;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: focus && edge.kind !== 'stores' ? String(edge.count) : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      zIndex: focus ? 1 : 0,
      style: {
        strokeWidth: focus ? 2 : 1.25,
        strokeDasharray: edge.kind === 'uses' ? '5 4' : edge.kind === 'stores' ? '2 3' : undefined,
        stroke: focus ? 'var(--color-brand-600)' : undefined,
        opacity: faded ? 0.15 : 1,
      },
      data: { edge },
    };
  });

  const supportingCount = architecture.components.filter((c) => c.role !== 'source').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Folders of code, the imports between them, and the external services they use. Built from
          the parsed code, not written by AI. Click anything to see the evidence.
        </p>
        {supportingCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={showSupporting}
              onChange={(e) => {
                setShowSupporting(e.target.checked);
                setSelection(null);
              }}
            />
            Show tests, examples and tooling
          </label>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MapList
          nodes={layout.nodes}
          selectedId={selectedNodeId}
          onSelect={select}
          className="md:hidden"
        />
        <div className="hidden h-[28rem] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 md:block lg:h-[36rem] dark:border-zinc-800 dark:bg-zinc-950">
          {!wide ? null : layout.nodes.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
              No application code to map. Try showing tests, examples and tooling.
            </p>
          ) : (
            <ReactFlow
              key={String(showSupporting)}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              colorMode={theme}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.2}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => select((node.data as { node: MapNode }).node)}
              onEdgeClick={(_, edge) =>
                setSelection({ type: 'edge', edge: (edge.data as { edge: MapEdge }).edge })
              }
              onPaneClick={() => setSelection(null)}
            >
              <Background gap={24} size={1} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
        <aside
          ref={details}
          className="flex min-w-0 scroll-mt-20 flex-col gap-4 md:max-h-[36rem] md:overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <Details
            snapshotId={snapshotId}
            architecture={architecture}
            selection={selection}
            onSelect={setSelection}
          />
        </aside>
      </div>
    </div>
  );
}

function Details({
  snapshotId,
  architecture,
  selection,
  onSelect,
}: {
  snapshotId: string;
  architecture: Architecture;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const fileLink = (file: string, line?: number, text?: ReactNode) => (
    <Link
      href={codeHref(snapshotId, file, line)}
      className="font-mono text-xs break-all text-brand-700 hover:underline dark:text-brand-400"
    >
      {text ?? (line ? `${file}:${line}` : file)}
    </Link>
  );

  if (selection?.type === 'component') {
    const component = architecture.components.find((c) => c.id === selection.id);
    if (!component) return null;
    const out = architecture.dependencies.filter((d) => d.from === component.id);
    const into = architecture.dependencies.filter((d) => d.to === component.id);
    const uses = architecture.integrations.filter((i) =>
      i.usedBy.some((u) => u.component === component.id),
    );
    return (
      <>
        <Heading
          title={component.id}
          subtitle={`${component.files.length} files · ${component.symbolCount} symbols · ${component.routeCount} routes`}
        />
        <LinkList
          title="Imports from"
          items={out.map((d) => ({
            key: d.to,
            content: (
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onSelect({ type: 'component', id: d.to })}
              >
                <span className="font-mono text-xs">{d.to}</span>{' '}
                <span className="text-zinc-500">({d.count})</span>
              </button>
            ),
          }))}
        />
        <LinkList
          title="Imported by"
          items={into.map((d) => ({
            key: d.from,
            content: (
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onSelect({ type: 'component', id: d.from })}
              >
                <span className="font-mono text-xs">{d.from}</span>{' '}
                <span className="text-zinc-500">({d.count})</span>
              </button>
            ),
          }))}
        />
        <LinkList title="Uses" items={uses.map((i) => ({ key: i.name, content: i.name }))} />
        <LinkList
          title="Files"
          items={component.files.map((file) => ({ key: file, content: fileLink(file) }))}
        />
      </>
    );
  }

  if (selection?.type === 'integration') {
    const integration = architecture.integrations.find((i) => i.name === selection.name);
    if (!integration) return null;
    return (
      <>
        <Heading
          title={integration.name}
          subtitle={`External ${integration.kind} · ${integration.packages.join(', ')}`}
        />
        {integration.usedBy.map((use) => (
          <LinkList
            key={use.component}
            title={`Imported in ${use.component} (${use.count})`}
            items={use.examples.map((e) => ({
              key: `${e.file}:${e.line}`,
              content: fileLink(e.file, e.line),
            }))}
          />
        ))}
        {integration.declaredIn.length > 0 && (
          <LinkList
            title="Declared in"
            items={integration.declaredIn.map((f) => ({ key: f, content: fileLink(f) }))}
          />
        )}
      </>
    );
  }

  if (
    selection?.type === 'data' ||
    (selection?.type === 'edge' && selection.edge.kind === 'stores')
  ) {
    return (
      <>
        <Heading title="Data model" subtitle="Models found in schema files and ORM code" />
        <LinkList
          title="Models"
          items={architecture.dataModels.map((m) => ({
            key: `${m.file}:${m.name}`,
            content: fileLink(m.file, m.line, `${m.name} (${m.source})`),
          }))}
        />
      </>
    );
  }

  if (selection?.type === 'edge') {
    const { edge } = selection;
    if (edge.kind === 'imports') {
      const dependency = architecture.dependencies.find(
        (d) => `imports:${d.from}->${d.to}` === edge.id,
      );
      if (!dependency) return null;
      return (
        <>
          <Heading
            title={`${dependency.from} → ${dependency.to}`}
            subtitle={`${dependency.count} import ${dependency.count === 1 ? 'statement' : 'statements'}`}
          />
          <LinkList
            title={dependency.count > dependency.examples.length ? 'Examples' : 'Imports'}
            items={dependency.examples.map((e) => ({
              key: `${e.file}:${e.line}`,
              content: (
                <span className="flex flex-col">
                  {fileLink(e.file, e.line)}
                  <span className="font-mono text-[11px] text-zinc-500">
                    from &apos;{e.specifier}&apos;
                  </span>
                </span>
              ),
            }))}
          />
        </>
      );
    }
    if (edge.kind === 'uses') {
      const integration = architecture.integrations.find(
        (i) => `integration:${i.name}` === edge.target,
      );
      const component = edge.source.replace(/^component:/, '');
      const use = integration?.usedBy.find((u) => u.component === component);
      if (!integration || !use) return null;
      return (
        <>
          <Heading title={`${component} → ${integration.name}`} subtitle={`${use.count} imports`} />
          <LinkList
            title="Imports"
            items={use.examples.map((e) => ({
              key: `${e.file}:${e.line}`,
              content: fileLink(e.file, e.line),
            }))}
          />
        </>
      );
    }
    return null;
  }

  const declaredOnly = architecture.integrations.filter((i) => i.usedBy.length === 0);
  return (
    <>
      <Heading title="How to read this" subtitle="Everything here comes from the parsed code." />
      <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-zinc-600 dark:text-zinc-400">
        <li>Boxes are folders; arrows point from the importer to what it imports, with a count.</li>
        <li>Purple boxes are external services, found from imports of known packages.</li>
        <li>
          Imports are resolved by path, so edges are exact; they show structure, not runtime calls.
        </li>
      </ul>
      {declaredOnly.length > 0 && (
        <LinkList
          title="Declared in package.json but not imported"
          items={declaredOnly.map((i) => ({ key: i.name, content: `${i.name} (${i.kind})` }))}
        />
      )}
      <LinkList
        title={`Environment variables (${architecture.envVars.length})`}
        items={architecture.envVars.map((env) => ({
          key: env.name,
          content: (
            <span className="flex flex-col">
              <span className="font-mono text-xs">{env.name}</span>
              {env.usages[0] && fileLink(env.usages[0].file, env.usages[0].line)}
            </span>
          ),
        }))}
        empty="None read through process.env or import.meta.env."
      />
    </>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-mono text-sm font-semibold break-all">{title}</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
    </div>
  );
}

function LinkList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { key: string; content: ReactNode }[];
  empty?: string;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.key} className="min-w-0">
              {item.content}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The map as a tappable list, for screens too narrow for the canvas: top layers first. */
function MapList({
  nodes,
  selectedId,
  onSelect,
  className,
}: {
  nodes: MapNode[];
  selectedId: string | null;
  onSelect: (node: MapNode) => void;
  className: string;
}) {
  if (nodes.length === 0) {
    return (
      <p className={`text-sm text-zinc-500 dark:text-zinc-400 ${className}`}>
        No application code to map. Try showing tests, examples and tooling.
      </p>
    );
  }
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <ul className={`flex flex-col gap-2 ${className}`}>
      {ordered.map((node) => {
        const selected = node.id === selectedId;
        const external = node.type !== 'component';
        return (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => onSelect(node)}
              aria-pressed={selected}
              className={`flex w-full min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition ${
                selected
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-950/40'
                  : external
                    ? 'border-violet-200 bg-violet-50/60 dark:border-violet-900/60 dark:bg-violet-950/30'
                    : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
              }`}
            >
              <span className="truncate font-mono text-sm font-medium">
                {node.type === 'component'
                  ? node.label
                  : node.type === 'integration'
                    ? node.name
                    : node.label}
              </span>
              <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {node.type === 'component'
                  ? node.detail
                  : node.type === 'integration'
                    ? `external service · ${node.kind}`
                    : 'data models'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
