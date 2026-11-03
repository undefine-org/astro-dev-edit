import { parse } from '@babel/parser';
import { readFile } from 'node:fs/promises';
import { extname, relative, sep } from 'node:path';
import { validateEditablePath } from './paths.ts';
import type { OptionsResolver } from './options.ts';
import type { Route } from './router.ts';
import type { TextWriter } from './text-writes.ts';

type Node = { type: string; start?: number | null; end?: number | null; [key: string]: any };
type Part = string | number | { key: string; value: string };
function parts(path: string): Part[] {
  const result: Part[] = []; let rest = path;
  while (rest) {
    const member = /^\.?([A-Za-z_$][\w$]*)/.exec(rest);
    if (member) { result.push(member[1]); rest = rest.slice(member[0].length); continue; }
    const index = /^\[(\d+)\]/.exec(rest);
    if (index) { result.push(Number(index[1])); rest = rest.slice(index[0].length); continue; }
    const key = /^\[([A-Za-z_$][\w$]*)=([^\]\r\n]+)\]/.exec(rest);
    if (key) { result.push({ key: key[1], value: key[2] }); rest = rest.slice(key[0].length); continue; }
    throw Error('Unsupported source field path.');
  }
  if (!result.length || result.some(p => typeof p === 'string' && ['__proto__', 'prototype', 'constructor'].includes(p))) throw Error('Invalid source field path.');
  return result;
}
const unwrap = (node: Node): Node => ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node.type) ? unwrap(node.expression) : node;
const name = (node: Node) => node.type === 'Identifier' ? node.name : node.type === 'StringLiteral' ? node.value : undefined;
function property(node: Node, key: string): Node {
  node = unwrap(node);
  if (node.type !== 'ObjectExpression' && node.type !== 'ObjectPattern') throw Error('Source path does not name a literal object.');
  // An override via spread or a duplicate key would make the owner uncertain.
  if (node.properties.some((p: Node) => p.type !== 'ObjectProperty' || p.computed)) throw Error('Source object has computed keys or spreads.');
  const matches = node.properties.filter((p: Node) => name(p.key) === key);
  if (matches.length !== 1) throw Error('Source field is missing or ambiguous.');
  const value = matches[0].value;
  return value.type === 'AssignmentPattern' ? value.right : value;
}
export function stringField(source: string, file: string, path: string): { start: number; end: number; value: string } {
  let code = source; let offset = 0;
  if (file.endsWith('.astro')) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!match) throw Error('Astro source has no frontmatter.');
    code = match[1]; offset = source.indexOf('\n') + 1;
  }
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const pathParts = parts(path); const first = pathParts.shift();
  if (typeof first !== 'string') throw Error('Source path must start with a variable.');
  const candidates: Node[] = [];
  for (const raw of ast.program.body) {
    const statement = (raw.type === 'ExportNamedDeclaration' ? raw.declaration : raw) as Node | null;
    if (statement?.type !== 'VariableDeclaration') continue;
    for (const declaration of statement.declarations) {
      if (declaration.id.type === 'Identifier' && declaration.id.name === first && declaration.init) candidates.push(declaration.init);
      else if (declaration.id.type === 'ObjectPattern' && declaration.id.properties.some((p: Node) => p.type === 'ObjectProperty' && name(p.key) === first)) candidates.push(property(declaration.id, first));
    }
  }
  if (candidates.length !== 1) throw Error('Source variable is missing or ambiguous.');
  let node = unwrap(candidates[0]);
  for (const part of pathParts) {
    node = unwrap(node);
    if (typeof part === 'string') node = property(node, part);
    else {
      if (node.type !== 'ArrayExpression' || node.elements.some((e: Node | null) => !e || e.type === 'SpreadElement')) throw Error('Source array is not a literal list.');
      if (typeof part === 'number') { if (!node.elements[part]) throw Error('Source array item is missing.'); node = node.elements[part]; }
      else {
        const matches = node.elements.filter((e: Node) => { try { const v = property(e, part.key); return v.type === 'StringLiteral' && v.value === part.value; } catch { return false; } });
        if (matches.length !== 1) throw Error('Source array key is missing or ambiguous.');
        node = matches[0];
      }
    }
  }
  node = unwrap(node);
  if (node.type !== 'StringLiteral' || node.start == null || node.end == null) throw Error('Only literal string fields are editable.');
  return { start: offset + node.start, end: offset + node.end, value: node.value };
}
export function patchField(source: string, file: string, path: string, original: string, value: string): string {
  const field = stringField(source, file, path);
  if (field.value !== original) throw Error('The source field changed. Reopen it before editing.');
  // A JS string literal, not template code. Keep the surrounding file intact.
  const quote = source[field.start];
  const escaped = value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(new RegExp(quote, 'g'), '\\' + quote);
  return source.slice(0, field.start) + quote + escaped + quote + source.slice(field.end);
}
export function createBindingRoutes(deps: { root: string; optionsResolver: OptionsResolver; writeText: TextWriter }): Route[] {
  async function source(body: unknown) {
    const b = body as { file?: string; path?: string; original?: string; value?: string };
    if (!b || typeof b.file !== 'string' || typeof b.path !== 'string' || b.path.length > 1000) throw Error('A source file and field path are required.');
    const options = (await deps.optionsResolver.resolve()).options;
    const file = await validateEditablePath(deps.root, options.contentRoots, ['.astro', '.ts', '.js'], b.file);
    if (!['.astro', '.ts', '.js'].includes(extname(file))) throw Error('Unsupported bound source type.');
    return { b, file, text: await readFile(file, 'utf8') };
  }
  return [
    { method: 'POST', path: '/binding/read', label: 'source field', maxBytes: 16 * 1024, handler: async body => {
      const { b, file, text } = await source(body); const field = stringField(text, file, b.path!);
      return { status: 200, body: { value: field.value, file: relative(deps.root, file).split(sep).join('/'), path: b.path } };
    } },
    { method: 'POST', path: '/binding/apply', label: 'source field save', maxBytes: 256 * 1024, handler: async body => {
      const { b, file, text } = await source(body);
      if (typeof b.original !== 'string' || typeof b.value !== 'string') throw Error('Original and replacement text are required.');
      const next = patchField(text, file, b.path!, b.original, b.value);
      stringField(next, file, b.path!); // Validate the new source before writing it.
      await deps.writeText(file, next, text); return { status: 200, body: { ok: true } };
    } },
  ];
}
