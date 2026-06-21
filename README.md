# selectlet

A TypeScript CSS selector engine for JavaScript DOM implementations.

`selectlet` provides selector APIs such as `matches()`, `closest()`, `querySelector()`, and `querySelectorAll()` for DOM environments outside browser engines. It is developed against browser-oracle tests for Chromium, Firefox, and WebKit, including translated WPT cases and jsdom integration scenarios.

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

  byId(id: string, ctx?: QueryContext): Element | null;
  byTag(tag: string, ctx?: QueryContext): ElementList;
  byTagNs(ns: string | null, local: string, ctx?: QueryContext): ElementList;
  byClass(cls: string, ctx?: QueryContext): ElementList;

  matches(sel: string, el: Element): boolean;
  select(sel: string, ctx?: QueryContext): ElementList;
  first(sel: string, ctx?: QueryContext): Element | null;
  closest(sel: string, el: Element): Element | null;

  registerPseudo(name: string, predicate: CustomPseudoPredicate): void;
};
```

`QueryContext` may be a `Document`, `Element`, or `DocumentFragment`.

By default, multi-element APIs return arrays. With `NODE_LIST` enabled, they return a NodeList-like indexed object.

## DOM implementation hooks

`selectlet` can use DOM-internal hooks for lower wrapper overhead and faster implementation-owned lookup paths.

```js
const sx = createSelectlet(documentImpl, {
  errors: {
    syntax: err => createSyntaxError(err)
  },

  caps: {
    tree: {
      treeVersion: node => getTreeVersion(node)
    },

    doc: {
      cachedIds: (doc, id) => getElementsByIdFromCache(doc, id)
    },

    el: {
      getId: el => getInternalId(el),
      getClass: el => getInternalClass(el),
      getLocalName: el => getInternalLocalName(el),
      getNamespaceURI: el => getInternalNamespace(el),
      getAttribute: (el, name) => getInternalAttribute(el, name),
      hasAttribute: (el, name) => hasInternalAttribute(el, name)
    }
  }
});
```

## Status

`selectlet` is under active development. The selector engine supports document, element, and `ShadowRoot` query contexts, with coverage for scoped shadow-DOM selector behavior such as `:host`, `:host-context()`, `::part()`, and `::slotted()`.

Current work is focused on browser/WPT conformance coverage, jsdom integration, selector API performance, and early style/CSSOM infrastructure.

## Development

```sh
npm test
npm run build
```

The repository includes unit tests, browser-oracle scenario tests, jsdom-oriented scenarios, and benchmark tests. See `package.json` for the current scripts.

## License

MIT
