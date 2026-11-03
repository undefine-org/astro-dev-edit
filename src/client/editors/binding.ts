import { bindingRequest } from '../api.ts';
import { openSourcePopup } from './source-popup.ts';
import * as state from '../state.ts';
import { toast } from '../ui.ts';
export async function beginBoundEdit(el: HTMLElement): Promise<void> {
  const file = el.dataset.devEditFile; const path = el.dataset.devEditPath;
  if (!file || !path) return;
  const token = state.begin({ kind: 'busy' });
  try {
    const field = await bindingRequest<{ value: string }>('read', { file, path });
    state.releaseIf(token);
    openSourcePopup({ title: el.dataset.devEditLabel ?? 'Shared copy', label: `${file} · ${path}`, value: field.value,
      save: async value => {
        state.setSavePhase('saving');
        try { await bindingRequest('apply', { file, path, original: field.value, value }); state.setSavePhase('saved'); return null; }
        catch (e) { state.setSavePhase('error'); return e instanceof Error ? e.message : 'Save failed.'; }
      },
    });
  } catch (e) { state.releaseIf(token); toast(e instanceof Error ? e.message : 'Could not read source field.', 'err'); }
}
