# Undefine astro-dev-edit fork

- Preserve the upstream MIT license and author attribution.
- Keep changes dev-only and source-owned. No editor runtime, metadata or write
  endpoints may ship in an Astro production build.
- Commit semantic increments with `git commit -s` and push each completed feature
  to origin. Before updating a consuming site's pin, verify the public commit is
  available. Use immutable public HTTPS archive URLs, never a local path.
- Run `npm run typecheck` and `npm test` for source changes. Test writes on a
  disposable copied site. Never add customer source or history blobs here.
- History is a persistent branching memento tree with nested transactions.
  Keep old redo branches; guard source checksums, revisions and path roots.
  Git checkpoint restores must remain undoable and leave HEAD/index untouched.
- Preserve phone and desktop usability. Keep the editing surface small;
  secondary tools belong in the launcher menu or a focused inspector.
