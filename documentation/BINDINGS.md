# Keeping derived copy in its source

Literal template text still needs no annotation. When a displayed value comes
from another source, add a dev-only binding to its existing HTML element:

```astro
<p {...import.meta.env.DEV && {
  'data-dev-edit-file': 'src/data/products.ts',
  'data-dev-edit-path': `products[handle=${product.handle}].mood`,
  'data-dev-edit-label': 'Product mood (shared)',
}}>{product.mood}</p>
```

The field editor reads the authoritative string and replaces exactly its string
literal. It does not replace the rendered template, evaluate code, or infer
which repeated value you meant. Paths support properties, numeric array indexes
and stable keyed items, for example `products[handle=first].steps[1]`.

Bindings can also point into `.astro` frontmatter: `sentence`, an array field,
or the literal default of a destructured prop. This permits editing a complete
sentence that the template splits into word spans, retaining its rendering.
Use a label to indicate shared scope. An instance override should bind its own
source field rather than the global default.

Sources must be `.astro`, `.ts` or `.js` under the existing content roots. The
TypeScript parser finds literal fields; computed values, spreads, duplicate
keys, duplicate array identities and stale values are refused. These saves pass
through the same persistent source history as ordinary inline saves.

Keep the attributes conditional on `import.meta.env.DEV` so no editor metadata
is emitted by the production build. No content migration is required.
