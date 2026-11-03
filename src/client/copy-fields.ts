import type { AdminBarHandle } from './admin-bar.ts';
import { annotatedElements, sourceFor } from './source-map.ts';
import { beginBoundEdit } from './editors/binding.ts';
import { openDrawer } from './editors/drawer.ts';
import { openSourcePopup } from './editors/source-popup.ts';
import { beginMarkupEdit } from './editors/markup.ts';
import { footButton, styled, toast } from './ui.ts';
import * as api from './api.ts';
import * as state from './state.ts';

/** A searchable path to shared values, hidden messages and copy attributes. */
export function initCopyFields(bar: Pick<AdminBarHandle, 'register'>) {
  bar.register({ id: 'atx-copy-fields', label: 'Copy fields', icon: 'file', place: 'menu', onSelect: show });
  function show() {
    if (state.savePhase() === 'saving' || state.savePhase() === 'dirty') return;
    const shell = openDrawer('Copy fields', { isDirty: () => false, discardMessage: '' });
    const search = styled('input', 'atx-history-select'); search.placeholder = 'Find copy…'; search.type = 'search'; search.setAttribute('aria-label', 'Find copy');
    const list = styled('div', 'atx-history-list'); shell.body.append(search, list);
    const seen = new Set<string>(); const rows: Array<{ label: string; open(): void }> = [];
    function add(key: string, label: string, open: () => void) { if (!seen.has(key)) { seen.add(key); rows.push({ label, open }); } }
    for (const el of document.querySelectorAll<HTMLElement>('[data-dev-edit-file][data-dev-edit-path]')) {
      const label = el.dataset.devEditLabel ?? el.textContent?.trim().slice(0, 90) ?? el.tagName;
      add(`${el.dataset.devEditFile}#${el.dataset.devEditPath}`, label, () => { shell.teardown(); void beginBoundEdit(el); });
    }
    for (const el of annotatedElements()) {
      const src = sourceFor(el)!; if (src.file.includes('/node_modules/')) continue;
      for (const attribute of ['placeholder', 'title', 'aria-label', 'alt']) {
        const value = el.getAttribute(attribute); if (!value) continue;
        add(`${src.file}:${src.loc}:${attribute}`, `${attribute} · ${value}`, () => {
          shell.teardown();
          openSourcePopup({ title: attribute, label: el.tagName.toLowerCase(), value,
            save: async next => {
              state.setSavePhase('saving');
              try { await api.saveCopyAttribute({ ...src, tag: el.tagName.toLowerCase(), attribute, original: value, value: next }); state.setSavePhase('saved'); return null; }
              catch (e) { state.setSavePhase('error'); return e instanceof Error ? e.message : 'Save failed.'; }
            },
          });
        });
      }
      const text = el.textContent?.trim();
      if (!el.closest('[hidden]') || !text || !/^(P|SPAN|H[1-6]|LABEL|A|BUTTON|EM)$/.test(el.tagName)) continue;
      add(`${src.file}:${src.loc}:text`, `Hidden · ${text.slice(0, 100)}`, () => {
        shell.teardown(); void (async () => {
          try {
            const classification = await api.classify({ ...src, tag: el.tagName.toLowerCase() });
            if (classification.kind === 'markup' && classification.markup) { beginMarkupEdit(el, src, classification.markup.html, () => { void api.open(src); }); return; }
            if (classification.kind !== 'text') throw Error(classification.reason ?? 'Use the shared source field for this value.');
            const original = el.textContent ?? '';
            openSourcePopup({ title: 'Hidden message', label: text.slice(0, 100), value: original,
              save: async value => {
                state.setSavePhase('saving');
                try { await api.apply({ ...src, tag: el.tagName.toLowerCase(), ops: [{ targetType: 'text', original, newText: value }] }); state.setSavePhase('saved'); return null; }
                catch (e) { state.setSavePhase('error'); return e instanceof Error ? e.message : 'Save failed.'; }
              },
            });
          } catch (e) { toast(e instanceof Error ? e.message : 'Could not open message.', 'err'); }
        })();
      });
    }
    function render() {
      list.replaceChildren();
      for (const row of rows.filter(r => r.label.toLowerCase().includes(search.value.toLowerCase()))) {
        const button = footButton(row.label, 'ghost', row.open); button.classList.add('atx-copy-field'); list.append(button);
      }
    }
    search.addEventListener('input', render); render();
    shell.foot.append(footButton('Close', 'outline', shell.close)); search.focus();
  }
}
