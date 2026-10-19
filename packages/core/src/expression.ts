import { parseExpressionAt } from 'acorn';
import { FlowError } from './model';
type Ast = { type: string; end: number; name?: string; value?: unknown; operator?: string; computed?: boolean; object?: Ast; property?: Ast; left?: Ast; right?: Ast; argument?: Ast; test?: Ast; consequent?: Ast; alternate?: Ast };
type Closure = (scope: Record<string, unknown>) => unknown;
const blocked = new Set(['__proto__', 'constructor', 'prototype', 'caller', 'callee', 'arguments']);
/** Compile a deliberately small expression language into bounded closures. */
export function compileExpression(source: string): Closure {
  if (source.length > 2048) throw new FlowError('EXPRESSION_LIMIT', 'Expression exceeds 2048 characters');
  let ast: Ast;
  try { ast = parseExpressionAt(source, 0, { ecmaVersion: 2022 }) as Ast; }
  catch { throw new FlowError('INVALID_EXPRESSION', 'Expression syntax is invalid'); }
  if (source.slice(ast.end).trim()) throw new FlowError('INVALID_EXPRESSION', 'Only one expression is allowed');
  let count = 0;
  const visit = (node: Ast, depth = 0): Closure => {
    if (++count > 256 || depth > 32) throw new FlowError('EXPRESSION_LIMIT', 'Expression is too complex');
    const child = (n: Ast | undefined) => { if (!n) throw new FlowError('INVALID_EXPRESSION', 'Missing operand'); return visit(n, depth + 1); };
    switch (node.type) {
      case 'Literal': if (node.value !== null && !['string', 'number', 'boolean'].includes(typeof node.value)) break; return () => node.value;
      case 'Identifier': if (!['$json', '$execution', '$itemIndex'].includes(node.name!)) break; return scope => scope[node.name!];
      case 'MemberExpression': {
        const object = child(node.object);
        const property: Closure = node.computed ? child(node.property) : () => node.property?.name;
        return scope => {
          const value = object(scope); const key = property(scope);
          if (typeof key !== 'string' && typeof key !== 'number') throw new FlowError('EXPRESSION_ACCESS', 'Property must be a string or index');
          if (blocked.has(String(key))) throw new FlowError('EXPRESSION_ACCESS', 'Prototype access is forbidden');
          if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
          return (value as Record<string, unknown>)[key];
        };
      }
      case 'UnaryExpression': {
        const operand = child(node.argument);
        if (node.operator === '!') return s => !operand(s);
        if (node.operator === '-') return s => -Number(operand(s));
        if (node.operator === '+') return s => Number(operand(s));
        break;
      }
      case 'LogicalExpression': {
        const l = child(node.left), r = child(node.right);
        if (node.operator === '&&') return s => l(s) && r(s);
        if (node.operator === '||') return s => l(s) || r(s);
        if (node.operator === '??') return s => l(s) ?? r(s);
        break;
      }
      case 'ConditionalExpression': { const t = child(node.test), a = child(node.consequent), b = child(node.alternate); return s => t(s) ? a(s) : b(s); }
      case 'BinaryExpression': {
        const l = child(node.left), r = child(node.right);
        switch (node.operator) {
          case '===': return s => l(s) === r(s);
          case '!==': return s => l(s) !== r(s);
          case '>': return s => Number(l(s)) > Number(r(s));
          case '>=': return s => Number(l(s)) >= Number(r(s));
          case '<': return s => Number(l(s)) < Number(r(s));
          case '<=': return s => Number(l(s)) <= Number(r(s));
          case '+': return s => { const a = l(s), b = r(s); return typeof a === 'string' || typeof b === 'string' ? String(a) + String(b) : Number(a) + Number(b); };
          case '-': return s => Number(l(s)) - Number(r(s));
          case '*': return s => Number(l(s)) * Number(r(s));
          case '/': return s => Number(l(s)) / Number(r(s));
          case '%': return s => Number(l(s)) % Number(r(s));
        }
      }
    }
    throw new FlowError('EXPRESSION_FORBIDDEN', `${node.type} is not permitted`);
  };
  return visit(ast);
}
/** Recursively resolve expression values without exposing ambient globals. */
export function resolveValue(value: unknown, scope: Record<string, unknown>, depth = 0): unknown {
  if (depth > 20) throw new FlowError('EXPRESSION_LIMIT', 'Parameter nesting exceeds 20 levels');
  if (typeof value === 'string' && value.startsWith('=')) return compileExpression(value.slice(1))(scope);
  if (Array.isArray(value)) return value.map(v => resolveValue(v, scope, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    if (blocked.has(k)) throw new FlowError('EXPRESSION_ACCESS', 'Prototype keys are forbidden');
    return [k, resolveValue(v, scope, depth + 1)];
  }));
  return value;
}
