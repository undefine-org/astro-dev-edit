import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, realpath, rename, unlink, open } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { flattenGroup, type HistoryGroup, type HistoryNode, type HistoryState, type HistoryView } from '../shared/history.ts';

const EXTENSIONS = new Set(['.astro', '.md', '.mdx', '.ts', '.tsx', '.js', '.jsx', '.json', '.jsonc', '.yaml', '.yml', '.css', '.svg']);
const MAX_FILE = 4 * 1024 * 1024;
const MAX_SNAPSHOT = 32 * 1024 * 1024;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

/** A persistent memento tree. No replay of arbitrary code, no Git index writes.
 * One journal protects each multi-file transition; recovery finishes it after a
 * crash, or refuses if someone subsequently changed a touched file. */
export class SourceHistory {
  private tail: Promise<unknown> = Promise.resolve();
  private storage: string;
  constructor(readonly root: string, readonly roots: readonly string[] = ['src', 'public']) {
    this.root = resolve(root);
    this.storage = join(this.root, '.astro-dev-edit-history');
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.tail.then(async () => {
      await this.privateDir();
      const lock = join(this.storage, 'writer.lock');
      let handle;
      for (let attempt = 0; attempt < 200; attempt++) {
        try { handle = await open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); break; }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const owner = Number(await readFile(lock, 'utf8').catch(() => '0'));
          if (owner > 0) {
            try { process.kill(owner, 0); }
            catch (err) { if ((err as NodeJS.ErrnoException).code === 'ESRCH') { await unlink(lock).catch(() => {}); continue; } }
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      if (!handle) throw Error('Another source editor is busy. Try again.');
      try { return await fn(); } finally { await handle.close(); await unlink(lock); }
    }); this.tail = task.catch(() => {}); return task;
  }
  eligible(file: string): boolean {
    const p = file.split(sep).join('/');
    return !p.startsWith('/') && !p.split('/').some(x => !x || x === '.' || x === '..' || x.startsWith('.')) &&
      this.roots.some(r => p.startsWith(r.replace(/\/$/, '') + '/')) && EXTENSIONS.has(extname(p).toLowerCase());
  }
  private async target(file: string, create = false): Promise<string> {
    if (!this.eligible(file)) throw Error('History only changes source files inside the configured content roots.');
    let at = this.root;
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) {
      at = join(at, parts[i]);
      try { if ((await lstat(at)).isSymbolicLink()) throw Error('History does not follow symbolic links.'); }
      catch (e) { if (!missing(e)) throw e; if (create && i < parts.length - 1) await mkdir(at); }
    }
    const parent = await realpath(dirname(at)).catch(e => { if (missing(e)) return dirname(at); throw e; });
    if (!parent.startsWith(this.root + sep)) throw Error('History path escapes the project.');
    return at;
  }
  private async privateDir() {
    await mkdir(this.storage, { recursive: true, mode: 0o700 });
    if ((await lstat(this.storage)).isSymbolicLink() || await realpath(this.storage) !== this.storage) throw Error('History storage must be a private project directory.');
    await mkdir(join(this.storage, 'objects'), { mode: 0o700, recursive: true });
    if ((await lstat(join(this.storage, 'objects'))).isSymbolicLink()) throw Error('Invalid history object store.');
  }
  private async save(path: string, value: string, mode = 0o600) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    const handle = await open(tmp, 'wx', mode);
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, path);
  }
  async object(value: string): Promise<string> {
    if (Buffer.byteLength(value) > MAX_FILE) throw Error('Source file exceeds the 4 MB history limit.');
    await this.privateDir();
    const id = hash(value); const p = join(this.storage, 'objects', id);
    try { await readFile(p); } catch (e) { if (!missing(e)) throw e; await this.save(p, value); }
    return id;
  }
  private async value(id: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid history object.');
    const s = await readFile(join(this.storage, 'objects', id), 'utf8');
    if (hash(s) !== id) throw Error('History object failed its checksum.');
    return s;
  }
  async current(file: string): Promise<string | null> {
    const p = await this.target(file);
    try { const s = await readFile(p, 'utf8'); if (Buffer.byteLength(s) > MAX_FILE) throw Error('Source file is too large.'); return s; }
    catch (e) { if (missing(e)) return null; throw e; }
  }
  async scan(): Promise<Record<string, string>> {
    const files: Record<string, string> = {}; let bytes = 0;
    const walk = async (dir: string) => {
      for (const entry of await readdir(join(this.root, dir), { withFileTypes: true }).catch(e => { if (missing(e)) return []; throw e; })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const name = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(name);
        else if (entry.isFile() && this.eligible(name)) {
          const content = (await this.current(name))!; bytes += Buffer.byteLength(content);
          if (bytes > MAX_SNAPSHOT || Object.keys(files).length >= 3000) throw Error('Source history snapshot is too large.');
          files[name] = await this.object(content);
        }
      }
    };
    for (const root of this.roots) await walk(root.replace(/\/$/, ''));
    return files;
  }
  private async state(): Promise<HistoryState> {
    await this.privateDir();
    await this.recover();
    try {
      const state = JSON.parse(await readFile(join(this.storage, 'state.json'), 'utf8')) as HistoryState;
      if (state.version !== 1 || !state.nodes.some(n => n.id === state.cursor)) throw Error('History state is invalid.');
      return state;
    } catch (e) {
      if (!missing(e)) throw e;
      const files = await this.scan();
      const state: HistoryState = { version: 1, revision: 0, cursor: 'root', nodes: [{ id: 'root', parent: null, at: new Date().toISOString(), label: 'Starting source', group: { label: 'Starting source' }, files }] };
      await this.save(join(this.storage, 'state.json'), JSON.stringify(state)); return state;
    }
  }
  private async recover() {
    const path = join(this.storage, 'pending.json');
    let journal: { state: HistoryState; changes: ReturnType<typeof flattenGroup> };
    try { journal = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (missing(e)) return; throw e; }
    // Validate ALL files and objects before touching any. A restart never
    // tramples external work that arrived after the interrupted transition.
    for (const c of journal.changes) {
      const current = await this.current(c.file); const id = current === null ? null : hash(current);
      if (id !== c.before && id !== c.after) throw Error(`Interrupted history conflicts with newer work in ${c.file}.`);
      if (c.after) await this.value(c.after);
    }
    for (const c of journal.changes) {
      const p = await this.target(c.file, c.after !== null);
      if (c.after === null) await unlink(p).catch(e => { if (!missing(e)) throw e; });
      else await this.save(p, await this.value(c.after), 0o644);
    }
    await this.save(join(this.storage, 'state.json'), JSON.stringify(journal.state));
    await unlink(path);
  }
  private async transition(state: HistoryState, group: HistoryGroup): Promise<void> {
    const changes = flattenGroup(group);
    const seen = new Set<string>();
    for (const c of changes) {
      if (seen.has(c.file)) throw Error('A transaction must coalesce changes to the same file.'); seen.add(c.file);
      const content = await this.current(c.file);
      if ((content === null ? null : hash(content)) !== c.before) throw Error(`${c.file} changed outside the editor. Save a checkpoint before continuing.`);
      if (c.after) await this.value(c.after);
    }
    await this.save(join(this.storage, 'pending.json'), JSON.stringify({ state, changes }));
    await this.recover();
  }
  private async synchronize(state: HistoryState): Promise<HistoryState> {
    const files = await this.scan(); const previous = state.nodes.find(n => n.id === state.cursor)!;
    if (JSON.stringify(Object.entries(files).sort()) === JSON.stringify(Object.entries(previous.files).sort())) return state;
    // External edits are a named boundary, not silently mixed into Undo.
    const changes = [...new Set([...Object.keys(files), ...Object.keys(previous.files)])].filter(f => files[f] !== previous.files[f]).map(file => ({ file, before: previous.files[file] ?? null, after: files[file] ?? null }));
    const node: HistoryNode = { id: randomUUID(), parent: state.cursor, at: new Date().toISOString(), label: 'Changes outside editor', group: { label: 'Changes outside editor', changes }, files };
    const next = { ...state, revision: state.revision + 1, cursor: node.id, nodes: [...state.nodes, node] };
    await this.save(join(this.storage, 'state.json'), JSON.stringify(next)); return next;
  }
  async view(): Promise<HistoryView> { return this.run(async () => this.describe(await this.synchronize(await this.state()))); }
  private describe(state: HistoryState): HistoryView {
    const byId = new Map(state.nodes.map(n => [n.id, n]));
    const depth = (n: { parent: string | null }): number => n.parent ? 1 + depth(byId.get(n.parent)!) : 0;
    return { revision: state.revision, cursor: state.cursor, canUndo: byId.get(state.cursor)!.parent !== null,
      redo: state.nodes.filter(n => n.parent === state.cursor).map(n => n.id),
      nodes: state.nodes.map(({ files: _files, group, ...n }) => ({ ...n, files: flattenGroup(group).map(c => c.file), depth: depth(n) })) };
  }
  async write(file: string, content: string, before: string | null): Promise<void> {
    return this.run(async () => {
      const state = await this.synchronize(await this.state());
      const actual = await this.current(file);
      if (actual !== before) throw Error('The source changed before saving.');
      if (actual === content) return;
      const after = await this.object(content);
      await this.append(state, { label: `Edit ${file.split('/').pop()}`, changes: [{ file, before: before === null ? null : await this.object(before), after }] });
    });
  }
  private async append(state: HistoryState, group: HistoryGroup, git?: HistoryNode['git']) {
    const files = { ...state.nodes.find(n => n.id === state.cursor)!.files };
    for (const c of flattenGroup(group)) { if (c.after === null) delete files[c.file]; else files[c.file] = c.after; }
    const node: HistoryNode = { id: randomUUID(), parent: state.cursor, label: group.label, at: new Date().toISOString(), group, files, ...(git ? { git } : {}) };
    const next = { ...state, revision: state.revision + 1, cursor: node.id, nodes: [...state.nodes, node] };
    await this.transition(next, group); return this.describe(next);
  }
  async move(action: 'undo' | 'redo' | 'jump', revision: number, id?: string): Promise<HistoryView> {
    return this.run(async () => {
      const state = await this.synchronize(await this.state());
      if (state.revision !== revision) throw Error('History changed. Refresh before trying again.');
      const current = state.nodes.find(n => n.id === state.cursor)!;
      const children = state.nodes.filter(n => n.parent === current.id);
      const targetId = action === 'undo' ? current.parent : action === 'redo' ? id ?? children.at(-1)?.id : id;
      const target = state.nodes.find(n => n.id === targetId);
      if (!target || (action === 'redo' && target.parent !== current.id)) throw Error('That history step is not available.');
      const group: HistoryGroup = { label: action, changes: [...new Set([...Object.keys(current.files), ...Object.keys(target.files)])]
        .filter(f => current.files[f] !== target.files[f]).map(file => ({ file, before: current.files[file] ?? null, after: target.files[file] ?? null })) };
      const next = { ...state, revision: state.revision + 1, cursor: target.id };
      await this.transition(next, group); return this.describe(next);
    });
  }
  async restore(files: Record<string, string>, revision: number, git: NonNullable<HistoryNode['git']>): Promise<HistoryView> {
    return this.run(async () => {
      const state = await this.synchronize(await this.state());
      if (state.revision !== revision) throw Error('History changed. Review the checkpoint again.');
      const before = state.nodes.find(n => n.id === state.cursor)!.files;
      const target: Record<string, string> = {};
      for (const [file, value] of Object.entries(files)) { if (!this.eligible(file)) throw Error('Checkpoint includes an unsupported path.'); target[file] = await this.object(value); }
      const children = [...new Set([...Object.keys(before), ...Object.keys(target)])].filter(f => before[f] !== target[f]).map(file => ({ label: file, changes: [{ file, before: before[file] ?? null, after: target[file] ?? null }] }));
      if (!children.length) return this.describe(state);
      return this.append(state, { label: `Git · ${git.subject}`, children }, git);
    });
  }
}
