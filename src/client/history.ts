import type { HistoryView } from '../shared/history.ts';
import type { AdminBarHandle } from './admin-bar.ts';
import { historyRequest } from './api.ts';
import { openDrawer } from './editors/drawer.ts';
import { footButton, styled, toast } from './ui.ts';
import * as state from './state.ts';

export function initHistory(bar: Pick<AdminBarHandle, 'register' | 'refresh'>) {
  let view: HistoryView | undefined;
  let busy = false;
  const blocked = () => busy || state.savePhase() === 'saving' || state.savePhase() === 'dirty';
  async function refresh() {
    try { view = await historyRequest<HistoryView>(''); bar.refresh(); }
    catch (e) { console.warn('Source history unavailable:', e); }
  }
  async function move(action: 'undo' | 'redo' | 'jump', id?: string) {
    if (!view || blocked()) return;
    busy = true; bar.refresh();
    try { view = await historyRequest<HistoryView>('/move', { action, id, revision: view.revision }); }
    catch (e) { toast(e instanceof Error ? e.message : 'History failed.', 'err'); }
    finally { busy = false; await refresh(); }
  }
  bar.register({ id: 'atx-undo', label: 'Undo', title: 'Undo saved change (Ctrl/⌘ Z)', icon: 'undo', compact: true, disabled: () => blocked() || !view?.canUndo, onSelect: () => { void move('undo'); } });
  bar.register({ id: 'atx-redo', label: 'Redo', title: 'Redo saved change (Ctrl/⌘ Shift Z)', icon: 'redo', compact: true, disabled: () => blocked() || !view?.redo.length, onSelect: () => { void move('redo'); } });
  bar.register({ id: 'atx-history', label: 'History', title: 'Saved history and Git checkpoints', icon: 'history', compact: true, onSelect: () => { void show(); } });
  state.onSavePhase(p => { bar.refresh(); if (p === 'saved') void refresh(); });
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'z' || e.composedPath().some(n => n instanceof HTMLElement && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)))) return;
    if (blocked()) return; e.preventDefault(); void move(e.shiftKey ? 'redo' : 'undo');
  });
  window.addEventListener('focus', () => { void refresh(); });
  void refresh();

  async function show() {
    if (blocked()) return;
    await refresh(); if (!view) return;
    const shell = openDrawer('History', { isDirty: () => false, discardMessage: '', width: 'min(540px, 100vw)' });
    const status = styled('p', 'atx-history-status'); status.setAttribute('role', 'status');
    const list = styled('div', 'atx-history-list');
    const heading = styled('h3', 'atx-history-heading'); heading.textContent = 'Saved changes';
    shell.body.append(heading, status, list);
    const nodes = view.nodes;
    for (const node of nodes) {
      const row = styled('div', 'atx-history-row'); row.style.marginInlineStart = `${Math.min(node.depth, 6) * 12}px`;
      const button = footButton(node.id === view.cursor ? `✓ ${node.label}` : node.label, node.id === view.cursor ? 'secondary' : 'ghost', () => {});
      button.dataset.historyNode = node.id; button.disabled = node.id === view.cursor;
      if (node.id === view.cursor) button.setAttribute('aria-current', 'step');
      button.title = [node.at, ...node.files].join('\n');
      button.addEventListener('click', async () => { shell.teardown(); await move('jump', node.id); });
      row.append(button); list.append(row);
    }
    const gitHeading = styled('h3', 'atx-history-heading'); gitHeading.textContent = 'Git checkpoints';
    const select = styled('select', 'atx-history-select'); select.setAttribute('aria-label', 'Git checkpoint');
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose a commit…'; select.append(empty);
    const preview = styled('div', 'atx-history-preview');
    const restore = footButton('Restore source', 'default', () => {}); restore.disabled = true; restore.id = 'atx-checkpoint-restore';
    type Preview = { sha: string; revision: number; changes: Array<{ file: string; kind: string }> };
    let reviewed: Preview | undefined;
    try {
      const commits = await historyRequest<Array<{ sha: string; subject: string }>>('/checkpoints');
      for (const c of commits) { const option = document.createElement('option'); option.value = c.sha; option.textContent = `${c.sha.slice(0, 7)} · ${c.subject}`; select.append(option); }
      if (!commits.length) { empty.textContent = 'No Git commits available'; select.disabled = true; }
    } catch (e) { status.textContent = String(e); }
    select.addEventListener('change', async () => {
      const sha = select.value; restore.disabled = true; preview.replaceChildren(); reviewed = undefined;
      if (!sha) return;
      status.textContent = 'Reading checkpoint…';
      try {
        const result = await historyRequest<Preview>('/preview', { sha });
        if (select.value !== sha) return;
        reviewed = result;
        status.textContent = result.changes.length ? `${result.changes.length} source files · undo available after restoring` : 'Source already matches this checkpoint.';
        for (const c of result.changes) { const line = styled('div', 'atx-history-file'); line.textContent = `${c.kind} · ${c.file}`; preview.append(line); }
        restore.disabled = !result.changes.length;
      } catch (e) { status.textContent = e instanceof Error ? e.message : 'Checkpoint failed.'; }
    });
    restore.addEventListener('click', async () => {
      if (!reviewed) return;
      restore.disabled = true; busy = true; bar.refresh(); status.textContent = 'Restoring…';
      try { view = await historyRequest<HistoryView>('/restore', { sha: reviewed.sha, revision: reviewed.revision }); shell.teardown(); }
      catch (e) { status.textContent = e instanceof Error ? e.message : 'Restore failed.'; restore.disabled = false; }
      finally { busy = false; await refresh(); }
    });
    shell.body.append(gitHeading, select, preview);
    const close = footButton('Close', 'outline', () => {}); close.addEventListener('click', shell.close); shell.foot.append(close, restore);
  }
}
