# Selectlet

A TypeScript CSS selector engine for JavaScript DOM implementations.

Selectlet provides selector APIs such as `matches()`, `closest()`, `querySelector()`, and `querySelectorAll()` for DOM environments outside browser engines. It is developed against Playwright oracle tests for Chromium, Firefox, and WebKit, including translated WPT cases.

## Installation

```sh
npm install selectlet
```

## Usage

### ESM

```js
import { createSelectlet } from "selectlet";

const sx = createSelectlet(document);

const items = sx.select(".item[data-active]");
const first = sx.first("main article");
const ok = sx.matches(":is(button, input)", element);
const closest = sx.closest("section", element);
```

### CommonJS

```js
const { createSelectlet } = require("selectlet");

const sx = createSelectlet(document);

const items = sx.select(".item");
```

### Browser/global build

The browser build exposes `createSelectlet` on the global object.

```html
<script src="selectlet.js"></script>
<script>
  const sx = createSelectlet(document);
  const buttons = sx.select("button");
</script>
```

## API

```ts
const sx = createSelectlet(document, options);
```

```ts
type Selectlet = {
  version: string;
  context: SelectletContext;

  byId(id: string, source?: QuerySource): Element | null;
  byTag(tag: string, source?: QuerySource): ElementList;
  byTagNs(ns: string | null, local: string, source?: QuerySource): ElementList;
  byClass(cls: string, source?: QuerySource): ElementList;

  matches(sel: string, el: Element): boolean;
  select(sel: string, source?: QuerySource): ElementList;
  first(sel: string, source?: QuerySource): Element | null;
  closest(sel: string, el: Element): Element | null;

  registerPseudo(name: string, predicate: CustomPseudoPredicate): void;
};
```

`QuerySource` may be a `Document`, `Element`, or `DocumentFragment`.

By default, multi-element APIs return arrays. With `NODE_LIST` enabled, they return a NodeList-like indexed object.

## DOM operations

`SelectletContext` holds an engine's query state and caches; it replaces the old
`Snapshot` class and `snapshot` property. Pass an existing host owner with
`createSelectlet(document, { env })`. `SelectletEnvironment` requires
`userAgent.dom`, and Browlet's environment satisfies that contract directly.
An explicit `env` takes precedence over `dom`. Selectlet currently needs no
execution facilities. The optional `errors.syntax` adapter remains an API-boundary
choice, separate from DOM ownership.

Selectlet and Stylelet accept the same `dom` option, typed as `DOMOperations`.
The default `standardDOM` uses ordinary browser and jsdom platform APIs. Hosts
with different node representations supply their own operations; Selectlet
returns the original objects and never reads their fields directly.

Compatible hosts can reuse the default operations and replace individual ones:

```js
import { createSelectlet, standardDOM } from 'selectlet';

const sx = createSelectlet(document, {
  dom: {
    ...standardDOM,
    hasCustomState: (element, name) => states.get(element)?.has(name) === true
  }
});
```

Here `states` is the host's map of elements to their custom states; the public DOM
does not expose that lookup. A complete implementation provider supplies tree,
attribute, document, control, and media operations. Optional `cachedIds`,
`cachedClasses`, `collectionArray`, `walkElements`, and `treeVersion` operations
retain fast host lookup paths. The exported `DOMOperations` type documents their
contracts. Supply an increasing `treeVersion` only when it covers every mutation
relevant to selector caches.

## Status

Selectlet is under active development, with ongoing Playwright/WPT conformance and selector API performance work.

## License

MIT
