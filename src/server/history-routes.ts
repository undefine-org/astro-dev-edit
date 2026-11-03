import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SourceHistory } from './history.ts';
import type { Route } from './router.ts';
const exec = promisify(execFile);
const MAX = 32 * 1024 * 1024;
async function git(root: string, args: string[]) {
  return (await exec('git', ['-C', root, ...args], { maxBuffer: MAX, timeout: 15000, encoding: 'utf8' })).stdout;
}
export async function checkpoints(root: string) {
  try {
    const result = await git(root, ['log', '--all', '-30', '--format=%H%x00%s%x00%aI']);
    return result.trim().split('\n').filter(Boolean).map(line => {
      const [sha, subject, at] = line.split('\0'); return { sha, subject, at };
    });
  } catch { return []; }
}
export async function checkpointFiles(history: SourceHistory, sha: string): Promise<Record<string, string>> {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Choose an exact Git commit.');
  await git(history.root, ['cat-file', '-e', `${sha}^{commit}`]);
  const listing = await git(history.root, ['ls-tree', '-rz', '--full-tree', sha, '--', ...history.roots]);
  const files: Record<string, string> = {}; let bytes = 0;
  for (const line of listing.split('\0').filter(Boolean)) {
    const tab = line.indexOf('\t'); const [mode, type, object] = line.slice(0, tab).split(' '); const file = line.slice(tab + 1);
    if (!history.eligible(file)) continue;
    if (mode !== '100644' || type !== 'blob') throw Error('Checkpoint contains a symbolic link or executable source file.');
    const content = await git(history.root, ['cat-file', 'blob', object]); bytes += Buffer.byteLength(content);
    if (bytes > MAX || Object.keys(files).length >= 3000) throw Error('Checkpoint source exceeds the snapshot limit.');
    files[file] = content;
  }
  return files;
}
export function createHistoryRoutes(history: SourceHistory, refreshPreview?: () => void): Route[] {
  const request = (body: unknown) => {
    const b = body as { revision?: number; sha?: string; id?: string; action?: string };
    if (!b || !Number.isSafeInteger(b.revision) || b.revision! < 0) throw Error('A current history revision is required.');
    return b as { revision: number; sha: string; id?: string; action: 'undo' | 'redo' | 'jump' };
  };
  return [
    { method: 'GET', path: '/history', label: 'history', handler: async () => ({ status: 200, body: await history.view() }) },
    { method: 'POST', path: '/history/move', label: 'history move', handler: async body => {
      const b = request(body); if (!['undo', 'redo', 'jump'].includes(b.action)) throw Error('Unknown history action.');
      const result = await history.move(b.action, b.revision, b.id); refreshPreview?.();
      return { status: 200, body: result };
    } },
    { method: 'GET', path: '/history/checkpoints', label: 'Git checkpoints', handler: async () => ({ status: 200, body: await checkpoints(history.root) }) },
    { method: 'POST', path: '/history/preview', label: 'checkpoint preview', handler: async body => {
      const b = body as { sha?: string }; const files = await checkpointFiles(history, b?.sha ?? '');
      const view = await history.view(); const current = await history.scan();
      const changes = [];
      for (const file of new Set([...Object.keys(current), ...Object.keys(files)])) {
        const value = files[file]; const after = value === undefined ? null : await history.object(value);
        if ((current[file] ?? null) !== after) changes.push({ file, kind: value === undefined ? 'delete' : current[file] ? 'change' : 'add' });
      }
      return { status: 200, body: { revision: view.revision, sha: b.sha, changes } };
    } },
    { method: 'POST', path: '/history/restore', label: 'checkpoint restore', handler: async body => {
      const b = request(body); const files = await checkpointFiles(history, b.sha);
      const subject = (await git(history.root, ['show', '-s', '--format=%s', b.sha])).trim();
      const result = await history.restore(files, b.revision, { sha: b.sha, subject }); refreshPreview?.();
      return { status: 200, body: result };
    } },
  ];
}
