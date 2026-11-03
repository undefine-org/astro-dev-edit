import { expect, it } from 'vitest';
import { patchField, stringField } from '../src/server/bindings.ts';
it('edits a keyed, nested TypeScript string without changing code or duplicate text elsewhere', () => {
  const source = `export const products: Product[] = [{ handle: 'one', mood: 'Calm', steps: ['Same', 'Other'] }, { handle: 'two', mood: 'Calm' }];`;
  const next = patchField(source, 'products.ts', 'products[handle=two].mood', 'Calm', "It's bright\nand calm");
  expect(next).toBe(source.replace("handle: 'two', mood: 'Calm'", "handle: 'two', mood: 'It\\'s bright\\nand calm'"));
  expect(stringField(next, 'products.ts', 'products[handle=two].mood').value).toBe("It's bright\nand calm");
  expect(stringField(source, 'products.ts', 'products[handle=one].steps[1]').value).toBe('Other');
});
it('binds an Astro frontmatter sentence and a destructured prop default', () => {
  const source = `---\nconst sentence = 'Word by word.';\nconst { button = 'Join' } = Astro.props;\n---\n<p>{sentence.split(' ').map(w => <span>{w}</span>)}</p>`;
  expect(patchField(source, 'index.astro', 'sentence', 'Word by word.', 'Read the sentence.')).toBe(source.replace("sentence = 'Word by word.'", "sentence = 'Read the sentence.'"));
  expect(stringField(source, 'Signup.astro', 'button').value).toBe('Join');
});
it('refuses duplicate keys, arbitrary code, ambiguous array identities and stale source', () => {
  expect(() => stringField(`const x = [{ id:'a', text:'One' },{ id:'a',text:'Two' }];`, 'x.ts', 'x[id=a].text')).toThrow('ambiguous');
  expect(() => stringField(`const x = { text:'One', ...other };`, 'x.ts', 'x.text')).toThrow('spreads');
  expect(() => stringField(`const x = getText();`, 'x.ts', 'x')).toThrow('literal string');
  expect(() => patchField(`const x = 'new';`, 'x.ts', 'x', 'old', 'next')).toThrow('changed');
});
