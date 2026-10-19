import { describe, it, expect, vi } from 'vitest';
import { compileExpression, resolveValue } from './expression';
import { validateGraph, type Graph } from './model';
import { Vault } from './vault';
import { execute } from './engine';
const node = (id: string, type: Graph['nodes'][number]['type'], parameters = {}): Graph['nodes'][number] => ({ id, type, name: id, parameters, position: { x: 0, y: 0 } });
const graph = (...nodes: Graph['nodes']): Graph => ({ nodes, edges: nodes.slice(1).map((n, i) => ({ id: String(i), source: nodes[i]!.id, target: n.id })) });
const options = () => ({ id: 'run', input: [{ amount: 20 }], signal: new AbortController().signal, checkpoint: vi.fn(), http: vi.fn(async () => ({ ok: true })) });
describe('graph validation', () => {
  it('orders a valid graph', () => expect(validateGraph(graph(node('a', 'manual'), node('b', 'merge'))).order).toEqual(['a', 'b']));
  it('rejects malformed graphs', () => expect(() => validateGraph({})).toThrow('array'));
  it('rejects duplicates', () => expect(() => validateGraph(graph(node('a', 'manual'), node('a', 'set')))).toThrow('unique'));
  it('rejects missing targets', () => { const g = graph(node('a', 'manual')); g.edges.push({ id: 'e', source: 'a', target: 'x' }); expect(() => validateGraph(g)).toThrow('missing'); });
  it('rejects duplicate edges', () => { const g = graph(node('a', 'manual'), node('b', 'merge')); g.edges.push(g.edges[0]!); expect(() => validateGraph(g)).toThrow('unique'); });
  it('rejects cycles', () => { const g = graph(node('a', 'manual'), node('b', 'merge')); g.edges.push({ id: 'loop', source: 'b', target: 'a' }); expect(() => validateGraph(g)).toThrow('acyclic'); });
  it('rejects multiple roots and misplaced triggers', () => {
    expect(() => validateGraph({ nodes: [node('a', 'manual'), node('b', 'manual')], edges: [] })).toThrow('Exactly one');
    expect(() => validateGraph(graph(node('a', 'manual'), node('b', 'webhook')))).toThrow('incoming');
  });
});
describe('sandbox', () => {
  const scope = { $json: { x: 4, name: 'Ada', list: [2] }, $itemIndex: 3, $execution: { id: 'e' } };
  it.each([
    ['$json.x + 2', 6], ['$json.name + "!"', 'Ada!'], ['$json.x - 2', 2], ['$json.x * 2', 8], ['$json.x / 2', 2], ['$json.x % 3', 1],
    ['$json.x > 2', true], ['$json.x >= 4', true], ['$json.x < 5', true], ['$json.x <= 4', true], ['$json.x === 4', true], ['$json.x !== 5', true],
    ['!$json.x', false], ['-$json.x', -4], ['+$json.x', 4], ['$json.x && true', true], ['$json.x || false', 4], ['$json.missing ?? 5', 5],
    ['$json.x ? "yes" : "no"', 'yes'], ['null ? 1 : 2', 2], ['$json.list[0]', 2], ['$json.missing.x', undefined], ['$itemIndex', 3],
  ])('evaluates %s', (s, value) => expect(compileExpression(s)(scope)).toEqual(value));
  it.each(['process.exit()', 'globalThis', 'new Date()', '(()=>1)()', '$json.constructor', '$json["__proto__"]', '$json.x = 1', '$json.x; 1', '/abc/', '$json.x ** 2', 'typeof $json', 'delete $json.x'])('rejects escape %s', s => expect(() => compileExpression(s)(scope)).toThrow());
  it('limits source and nesting', () => {
    expect(() => compileExpression('1'.repeat(2049))).toThrow('2048');
    expect(() => compileExpression('!'.repeat(40) + 'true')).toThrow('complex');
    expect(() => compileExpression('(')).toThrow('syntax');
    expect(() => compileExpression('$json[true]')(scope)).toThrow('Property');
  });
  it('resolves nested data and prevents prototype injection', () => {
    expect(resolveValue({ a: ['=$json.x', null] }, scope)).toEqual({ a: [4, null] });
    expect(() => resolveValue(JSON.parse('{"__proto__":1}'), scope)).toThrow('Prototype');
    expect(() => resolveValue({}, scope, 21)).toThrow('nesting');
  });
});
describe('vault', () => {
  const vault = new Vault('ab'.repeat(32));
  it('authenticates identity and nonce', () => { const c = vault.encrypt('a', 'secret'); expect(vault.decrypt('a', c)).toBe('secret'); expect(c).not.toBe(vault.encrypt('a', 'secret')); expect(() => vault.decrypt('b', c)).toThrow('decrypted'); expect(() => vault.decrypt('a', 'bad')).toThrow(); });
  it('fails fast without a valid key', () => expect(() => new Vault('short')).toThrow('32 bytes'));
});
describe('engine', () => {
  it('transforms and filters data', async () => {
    const r = await execute(graph(node('a', 'manual'), node('b', 'set', { fields: { total: '=$json.amount * 2' } }), node('c', 'filter', { condition: '=$json.total > 30' })), options());
    expect(r.snapshot.outputs.c).toEqual([{ amount: 20, total: 40 }]);
  });
  it('filters false and supports replacement', async () => {
    const r = await execute(graph(node('a', 'webhook'), node('b', 'set', { keepInput: false, fields: { x: 1 } }), node('c', 'filter', { condition: false })), options()); expect(r.snapshot.outputs.b).toEqual([{ x: 1 }]); expect(r.snapshot.outputs.c).toEqual([]);
  });
  it('persists wait cursor and resumes without replay', async () => {
    const g = graph(node('a', 'manual'), node('b', 'wait', { seconds: 0 }), node('c', 'merge')); const o = options(); const r = await execute(g, o);
    expect(r.status).toBe('waiting'); expect(r.snapshot.cursor).toBe(2);
    const resumed = await execute(g, { ...o, snapshot: r.snapshot }); expect(resumed.status).toBe('success'); expect(resumed.snapshot.traces).toHaveLength(3);
  });
  it('dispatches HTTP with deterministic idempotency', async () => { const o = options(); await execute(graph(node('a', 'manual'), node('b', 'http', { url: 'https://example.com' })), o); expect(o.http).toHaveBeenCalledWith({ url: 'https://example.com' }, o.signal, 'run:b:0'); });
  it('records errors and validates parameters', async () => {
    for (const n of [node('b', 'set'), node('b', 'wait', { seconds: -1 }), node('b', 'fail')]) {
      const o = options(); await expect(execute(graph(node('a', 'manual'), n), o)).rejects.toThrow(); expect(o.checkpoint).toHaveBeenCalled();
    }
  });
  it('obeys cancellation and item/output budgets', async () => {
    const o = options(); const c = new AbortController(); c.abort(); await expect(execute(graph(node('a', 'manual')), { ...o, signal: c.signal })).rejects.toThrow();
    await expect(execute(graph(node('a', 'manual')), { ...o, input: Array.from({ length: 10001 }, () => ({})) })).rejects.toThrow('10,000');
    await expect(execute(graph(node('a', 'manual')), { ...o, input: [{ data: 'x'.repeat(4 * 1024 * 1024) }] })).rejects.toThrow('4 MiB');
  });
  it('sanitizes unexpected node failures', async () => { const o = options(); o.http.mockRejectedValue(new Error('secret')); await expect(execute(graph(node('a', 'manual'), node('b', 'http')), o)).rejects.toThrow(); expect(JSON.stringify(o.checkpoint.mock.calls)).not.toContain('secret'); });
});
