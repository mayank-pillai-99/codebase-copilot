import type { TraceResponse } from '@codebase-copilot/shared';

/**
 * Decides where each traced function is drawn: under the first call that reaches it,
 * walking the tree depth-first in source order. Later calls to it point back instead
 * of repeating it. Returns the set of `${nodeId}:${callIndex}` keys that expand.
 * Computed up front so rendering stays pure.
 */
export function planTrace(trace: TraceResponse): Set<string> {
  const nodes = new Map(trace.nodes.map((n) => [n.id, n]));
  const expands = new Set<string>();
  const placed = new Set<string>();
  const root = trace.nodes[0];
  if (!root) return expands;

  const visit = (nodeId: string) => {
    placed.add(nodeId);
    const node = nodes.get(nodeId)!;
    node.calls.forEach((call, index) => {
      const child = call.target ? nodes.get(call.target) : undefined;
      // Only the breadth-first parent draws a node, so a callee reached from two places
      // appears where the trace first found it.
      if (child && child.parentId === nodeId && !placed.has(child.id)) {
        expands.add(`${nodeId}:${index}`);
        visit(child.id);
      }
    });
  };
  visit(root.id);
  return expands;
}
