import { z } from 'zod';
export const nodeTypes = ['manual', 'webhook', 'set', 'filter', 'http', 'wait', 'merge', 'fail'] as const;
export const graphSchema = z.object({
  nodes: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), type: z.enum(nodeTypes), name: z.string().min(1).max(100), parameters: z.record(z.string(), z.unknown()).default({}), position: z.object({ x: z.number().finite(), y: z.number().finite() }) })).min(1).max(200),
  edges: z.array(z.object({ id: z.string().max(150), source: z.string(), target: z.string() })).max(500),
});
export type Graph = z.infer<typeof graphSchema>;
export type Item = Record<string, unknown>;
export type Snapshot = { cursor: number; outputs: Record<string, Item[]>; traces: Trace[] };
export type Trace = { nodeId: string; startedAt: number; duration: number; items: number; status: 'success' | 'error'; error?: string };
/** A stable machine-readable application failure. */
export class FlowError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'FlowError'; }
}
/** Validate a DAG and return its stable topological ordering. */
export function validateGraph(input: unknown): { graph: Graph; order: string[] } {
  const result = graphSchema.safeParse(input);
  if (!result.success) throw new FlowError('INVALID_GRAPH', result.error.issues.map(i => i.message).join('; '));
  const graph = result.data;
  if (graph.nodes.some(n => ['__proto__', 'prototype', 'constructor'].includes(n.id))) throw new FlowError('RESERVED_NODE', 'Reserved node identifiers are forbidden');
  const ids = new Set(graph.nodes.map(n => n.id));
  if (ids.size !== graph.nodes.length) throw new FlowError('DUPLICATE_NODE', 'Node identifiers must be unique');
  const indegree = new Map(graph.nodes.map(n => [n.id, 0]));
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) throw new FlowError('MISSING_NODE', 'Connection refers to a missing node');
    if (edgeIds.has(e.id)) throw new FlowError('DUPLICATE_EDGE', 'Connection identifiers must be unique');
    edgeIds.add(e.id); indegree.set(e.target, indegree.get(e.target)! + 1);
  }
  const queue = graph.nodes.filter(n => indegree.get(n.id) === 0).map(n => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!; order.push(id);
    for (const e of graph.edges.filter(e => e.source === id)) {
      indegree.set(e.target, indegree.get(e.target)! - 1);
      if (!indegree.get(e.target)) queue.push(e.target);
    }
  }
  if (order.length !== ids.size) throw new FlowError('CYCLE', 'Workflows must be acyclic; use a bounded external trigger for repetition');
  const roots = graph.nodes.filter(n => !graph.edges.some(e => e.target === n.id));
  if (roots.length !== 1 || !['manual', 'webhook'].includes(roots[0]!.type)) throw new FlowError('INVALID_TRIGGER', 'Exactly one manual or webhook root is required');
  if (graph.nodes.some(n => ['manual', 'webhook'].includes(n.type) && n.id !== roots[0]!.id)) throw new FlowError('INVALID_TRIGGER', 'Triggers cannot have incoming connections');
  return { graph, order };
}
