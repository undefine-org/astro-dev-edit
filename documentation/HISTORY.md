# Source history

This fork stores source edits locally in `.astro-dev-edit-history/`. Ignore that
directory in the consuming site's Git repository. It is denied by the dev
server, including Vite's raw-file routes, and never added to production output.

The toolbar has Undo, Redo and History. Ctrl/Command Z and Shift Z operate on
saved source when focus is outside a text field. While typing, the browser's
own text undo remains available. History survives browser and dev-server restarts.

Undo followed by a new edit creates a branch; the previous redo path remains in
History. Redo follows the most recent child by default, and History can select
any retained node. Each source save is one transaction. Groups can contain child
groups, so a Git restoration involving multiple files remains one undo step.

## Git checkpoints

History lists recent commits from the local Git repository. Choose a commit to
review the source files it would add, change or delete, then Restore source.
Restoration itself is undoable. It does not switch the branch, change HEAD,
stage files, commit, push, install dependencies, or alter the Git index.

The scope is supported text source files under `src/` and `public/`; repository
configuration, dependencies and binary assets remain outside that source
snapshot. Symbolic links and executable source entries are refused. This is a
source checkpoint, not a deployment or a full Git worktree checkout.

Outside edits become a named history boundary. A stale browser revision is
refused so that another tab or a code editor cannot be overwritten silently.

## Why this representation

We compared these primary implementations and references:

- [Neovim undo trees and persistent undo](https://github.com/neovim/neovim/blob/master/runtime/doc/undo.txt): branches retain alternatives after editing an earlier state.
- [Slate history batches and inverse operations](https://github.com/ianstormtaylor/slate/blob/main/packages/slate-history/src/with-history.ts): batches form coherent undo units, but the operations assume an editor-owned document model.
- [CodeMirror transaction history](https://codemirror.net/docs/guide/): changes describe document transactions, useful when the editor owns the text buffer.
- [Git restore](https://git-scm.com/docs/git-restore): file restoration can be separate from moving a branch or index.

We chose a parent-linked tree of immutable **mementos** with nested change groups.
A node contains its parent, label, timestamp, grouped before/after file hashes,
and a map from source paths to content hashes. File contents are SHA-256 objects
shared across nodes; the cursor is separate. This avoids replaying offset-based
patches against files that a code editor or Astro may have changed. There is no
collaborative document model requiring OT or CRDT here.

Writes serialize and verify the exact expected source. A flushed pending journal
precedes a multi-file transition; restarting completes that transition only if
every touched file still matches its before or after checksum. A conflict stops
recovery. The cursor advances only through the journal. Independent editor
processes use a local writer lock. No history is erased automatically.

Limits: 4 MB per source file, 32 MB and 3,000 files per snapshot. Metadata grows
with saved steps; blob contents are deduplicated. Settings and credentials are
not tracked. The source writer and server gates still apply to every edit.
