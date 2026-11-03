import { expect, it } from 'vitest';
import { applyCopyAttribute } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';
it('patches an escaped placeholder without touching other input attributes', async () => {
  const source = '<input type="email" placeholder="Your email" />';
  const result = await applyCopyAttribute(source, { loc: locOf(source, 'input'), tag: 'input', attribute: 'placeholder', original: 'Your email', value: 'Work & home email' });
  expect(result).toEqual({ ok: true, newSource: '<input type="email" placeholder="Work &amp; home email" />' });
});
it('refuses event handlers, generated attributes and stale text', async () => {
  const source = '<input placeholder={hint} />';
  expect((await applyCopyAttribute(source, { loc: '1:2', tag: 'input', attribute: 'onclick', original: '', value: 'run()' })).ok).toBe(false);
  expect((await applyCopyAttribute(source, { loc: '1:2', tag: 'input', attribute: 'placeholder', original: 'Hint', value: 'New' })).ok).toBe(false);
});
