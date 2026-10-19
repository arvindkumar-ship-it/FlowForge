import { FlowError, validateGraph, type Graph, type Item, type Snapshot } from './model';
import { resolveValue } from './expression';
export type HttpExecutor = (parameters: Record<string, unknown>, signal: AbortSignal, idempotencyKey: string) => Promise<Item>;
export type EngineResult = { status: 'success' | 'waiting'; snapshot: Snapshot; waitUntil?: number };
/** Execute a pinned DAG, checkpointing after every completed node. */
export async function execute(graph: Graph, options: { id: string; input: Item[]; signal: AbortSignal; snapshot?: Snapshot; checkpoint: (s: Snapshot) => void; http: HttpExecutor }): Promise<EngineResult> {
  const { order } = validateGraph(graph);
  const snapshot: Snapshot = structuredClone(options.snapshot ?? { cursor: 0, outputs: {}, traces: [] });
  const started = Date.now();
  for (; snapshot.cursor < order.length; snapshot.cursor++) {
    options.signal.throwIfAborted();
    if (Date.now() - started > 60_000) throw new FlowError('EXECUTION_TIMEOUT', 'Execution exceeded one minute');
    const node = graph.nodes.find(n => n.id === order[snapshot.cursor])!;
    const parents = graph.edges.filter(e => e.target === node.id);
    const input = parents.length ? parents.flatMap(e => snapshot.outputs[e.source] ?? []) : options.input;
    if (input.length > 10_000) throw new FlowError('ITEM_LIMIT', 'Node input exceeds 10,000 items');
    const nodeStart = Date.now(); let output: Item[] = [];
    try {
      if (node.type === 'manual' || node.type === 'webhook' || node.type === 'merge' || node.type === 'wait') output = input;
      else if (node.type === 'fail') throw new FlowError('NODE_FAILED', 'Workflow stopped by Fail node');
      else for (const [index, item] of input.entries()) {
        options.signal.throwIfAborted();
        const p = resolveValue(node.parameters, { $json: item, $execution: { id: options.id }, $itemIndex: index }) as Record<string, unknown>;
        if (node.type === 'set') {
          if (!p.fields || typeof p.fields !== 'object' || Array.isArray(p.fields)) throw new FlowError('INVALID_FIELDS', 'Set node needs a fields object');
          output.push(p.keepInput === false ? p.fields as Item : { ...item, ...p.fields as Item });
        } else if (node.type === 'filter') { if (p.condition) output.push(item); }
        else if (node.type === 'http') output.push(await options.http(p, options.signal, `${options.id}:${node.id}:${index}`));
      }
      if (Buffer.byteLength(JSON.stringify(output)) > 4 * 1024 * 1024) throw new FlowError('OUTPUT_LIMIT', 'Node output exceeds 4 MiB');
      snapshot.outputs[node.id] = output;
      snapshot.traces.push({ nodeId: node.id, startedAt: nodeStart, duration: Date.now() - nodeStart, items: output.length, status: 'success' });
      if (node.type === 'wait') {
        const seconds = Number(node.parameters.seconds ?? 1);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400 * 30) throw new FlowError('INVALID_WAIT', 'Wait must be between 0 and 30 days');
        snapshot.cursor++; options.checkpoint(snapshot);
        return { status: 'waiting', snapshot, waitUntil: Date.now() + seconds * 1000 };
      }
      options.checkpoint({ ...snapshot, cursor: snapshot.cursor + 1 });
    } catch (error) {
      snapshot.traces.push({ nodeId: node.id, startedAt: nodeStart, duration: Date.now() - nodeStart, items: 0, status: 'error', error: error instanceof FlowError ? error.message : 'Node execution failed' });
      options.checkpoint(snapshot); throw error;
    }
  }
  return { status: 'success', snapshot };
}
