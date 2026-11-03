import { parseExpression } from '@babel/parser';
import type { AstNode } from './astro.ts';
/** The visible branch of a literal conditional can be edited without changing
 * the condition or its other state. A non-literal branch remains unsupported. */
export function conditionalStrings(source: string, element: AstNode): Array<{ value: string; from: number; to: number; quote: string }> | null {
  const children = element.children;
  if (children?.length !== 1 || children[0].type !== 'expression') return null;
  const parts = children[0].children;
  if (parts?.length !== 1 || parts[0].type !== 'text' || !parts[0].position || !parts[0].value) return null;
  const code = parts[0].value; const start = parts[0].position.start;
  const from = source.split('\n').slice(0, start.line - 1).reduce((n, line) => n + line.length + 1, 0) + start.column - 1;
  if (source.slice(from, from + code.length) !== code) return null;
  try {
    const node = parseExpression(code, { plugins: ['typescript'] });
    if (node.type !== 'ConditionalExpression') return null;
    const values = [node.consequent, node.alternate];
    if (!values.every(n => n.type === 'StringLiteral' && n.start != null && n.end != null)) return null;
    return values.map(n => ({ value: (n as { value: string }).value, from: from + n.start!, to: from + n.end!, quote: source[from + n.start!] }));
  } catch { return null; }
}
