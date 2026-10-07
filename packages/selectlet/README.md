# Selectlet

A TypeScript CSS selector engine for JavaScript DOM implementations.

Works with browser and jsdom documents, or a host's own node representation
through a DOM adapter. Queries return the original elements.

## Installation

```sh
npm install selectlet
```

## Usage

```js
import { createSelectlet } from 'selectlet';

const selectors = createSelectlet(document);

const items = selectors.select('main .item');
const first = selectors.first('main .item');

if (first) {
  const active = selectors.matches('[data-active]', first);
  const parent = selectors.closest('main', first);
}
```

`select()` returns an array by default; `first()` and `closest()` return an
element or `null`. Queries default to the supplied document. Pass a document,
element, or document fragment as the second argument to `select()` or `first()`
to change the query scope.

`byId(id, source?)`, `byTag(tag, source?)`, `byTagNs(namespace, localName, source?)`,
and `byClass(className, source?)` provide direct lookups. `byId()` returns an element
or `null`; the others return the configured collection type.

Use `selectors.registerPseudo(name, predicate)` to register a custom pseudo-class.
The name excludes the leading `:`; the predicate receives an element and returns
a boolean. Its type is exported as `CustomPseudoPredicate`.

The package includes TypeScript declarations, ESM and CommonJS exports, and a
browser build at `dist/selectlet.js` that exposes `createSelectlet` globally.

## Configuration

Pass options through `createSelectlet(document, { config })`:

| Option | Default | Effect |
| --- | --- | --- |
| `NODE_LIST` | `false` | Return a NodeList-like indexed object instead of an array. |
| `MUTATE_IDS` | `false` | Allow temporary ID changes during duplicate-ID lookup; observable by mutation observers. |
| `CACHE_WATERMARK` | `1024` | Soft limit on selector and regex caches; `0` disables automatic clearing. |

`selectors.context` exposes the engine's `SelectletContext`, including query state
and caches. The separate `errors.syntax` option adapts syntax errors at the API boundary.

## Host integration

Selectlet and Stylelet share the exported `DOMOperations` contract. The default
`standardDOM` uses ordinary browser and jsdom properties. Supply `dom` for a
different node representation, or override individual operations:

```js
import { createSelectlet, standardDOM } from 'selectlet';

const states = new WeakMap();
const selectors = createSelectlet(document, {
  dom: {
    ...standardDOM,
    hasCustomState: (element, name) => states.get(element)?.has(name) === true,
  },
});
```

A complete provider supplies tree, attribute, document, control, and media
operations. Optional `cachedIds`, `cachedClasses`, `collectionArray`, and
`walkElements` operations preserve fast host lookups. Supply an increasing
`treeVersion` only if it covers every mutation relevant to selector caches.

An existing `SelectletEnvironment` can be passed as `{ env }`; its `userAgent.dom`
takes precedence over `dom`. Browlet supplies this environment directly. Selectlet
requires no execution facilities.

## Status

Selectlet is under active development. Its tests include WPT-derived cases and
comparisons with Chromium, Firefox, and WebKit through Playwright.

## License

MIT
