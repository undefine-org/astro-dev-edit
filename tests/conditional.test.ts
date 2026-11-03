import { expect, it } from 'vitest';
import { classifyAstro, applyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';
it('changes only the visible literal branch of a conditional label', async () => {
 const source = `<button><span>{launched ? 'Add to bag' : 'Reserve'}</span></button>`;
 const loc = locOf(source, '{launched');
 expect((await classifyAstro(source, loc, 'span')).kind).toBe('expression');
 expect(await applyAstro(source, {loc,tag:'span',targetType:'expression',original:'Reserve',newText:'Reserve a bottle'})).toEqual({ok:true,newSource:source.replace("'Reserve'", "'Reserve a bottle'")});
});
it('refuses computed branches and ambiguous current state labels', async () => {
 const computed=`<span>{launched ? computed : 'Reserve'}</span>`;
 expect((await classifyAstro(computed,locOf(computed,'{launched'),'span')).kind).toBe('dynamic');
 const duplicate=`<span>{launched ? 'Same' : 'Same'}</span>`;
 expect((await applyAstro(duplicate,{loc:locOf(duplicate,'{launched'),tag:'span',targetType:'expression',original:'Same',newText:'Next'})).ok).toBe(false);
});
