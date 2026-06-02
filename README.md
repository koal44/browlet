# selectlet

A TypeScript CSS selector engine for JavaScript DOM implementations.

`selectlet` is a re-engineered fork of `nwsapi` focused on browser-aligned behavior, faster conformance iteration, and implementation-level optimization hooks. It is designed for DOM implementations that need selector APIs such as `matches()`, `closest()`, `querySelector()`, and `querySelectorAll()` outside a browser engine.

The project is pre-1.0 and under active development. The public API and package shape may still change.

## Why

Selector engines for DOM implementations are difficult to maintain because correctness, browser compatibility, and performance interact in awkward ways. `selectlet` tries to make that work more explicit:

* typed parser, planner, and runtime stages;
* browser-oracle scenario tests across Chromium, Firefox, and WebKit;
* focused jsdom/WPT-style conformance scenarios;
* inspectable debug output for candidate plans and compiled matchers;
* host capability hooks for faster access to DOM implementation internals.

The goal is not only to run selectors quickly, but to make selector behavior easier to test, debug, and evolve.

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

By default, multi-element APIs return arrays. If `NODE_LIST` is enabled, they return a NodeList-like indexed object.

## Capabilities

`selectlet` can run against ordinary DOM APIs, but DOM implementations may pass capability hooks to avoid wrapper overhead or expose internal indexes.

Examples include fast ID/class lookup, direct attribute access, namespace/local-name access, and tree-version hooks for cache invalidation.

A jsdom-style integration can provide internal accessors like this:

```js
const sx = createSelectlet(documentImpl, {
  errors: {
    syntax: err => DOMException.create(documentImpl._globalObject, [
      err.message,
      "SyntaxError"
    ])
  },

  caps: {
    tree: {
      treeVersion: node => {
        return node.nodeType === 1 ? node._ownerDocument?._version : node._version;
      }
    },

    doc: {
      cachedIds: (doc, id) => doc._byIdCache.getAll(id),

      designMode: doc => {
        const wrapper = idlUtils.wrapperForImpl(doc);
        return typeof wrapper?.designMode === "string"
          ? wrapper.designMode
          : undefined;
      }
    },

    el: {
      getId: el => {
        const entry = el._attributesByNameMap.get("id");
        return entry ? entry[0]._value : "";
      },

      getClass: el => {
        const entry = el._attributesByNameMap.get("class");
        return entry ? entry[0]._value : "";
      },

      getLocalName: el => el._localName,
      getNamespaceURI: el => el._namespaceURI,

      getAttribute: (el, name) => {
        const attr = attrByName(el, name);
        return attr ? attr._value : null;
      },

      getAttributeNS: (el, namespace, localName) => {
        const attr = attrByNameNS(el, namespace, localName);
        return attr ? attr._value : null;
      },

      hasAttribute: (el, name) => attrByName(el, name) !== null,
      hasAttributeNS: (el, namespace, localName) => attrByNameNS(el, namespace, localName) !== null
    }
  }
});
```

Capabilities are intended mainly for DOM implementation authors. Ordinary browser-style use does not require them.

## Optimization model

`selectlet` separates selector parsing from candidate planning and compiled runtime checks.

Candidate plans can seed from IDs, classes, tags, or tree walks. Predicate tests are cost-ordered before compilation. Structural checks such as `:nth-child()` and `:nth-of-type()` can use runtime caches when the host provides a stable tree-version capability.

The engine also includes experimental frontier planning for complex selectors. A selective left prefix can be used to narrow the later candidate lookup context, and compiled matchers can skip already-proven selector prefixes during verification.

These optimizations are still evolving, but the architecture is designed to make planning decisions inspectable and testable.

## Status

`selectlet` is currently under active development.

Known areas still being worked on include:

* additional CSS scoping and shadow DOM selectors such as `:host` and `::slotted()`;
* broader frontier planning and cost modeling;
* deeper jsdom style-system integration;
* compatibility polish for some edge-case parser behavior;
* public API and package-shape stabilization.

The current focus is jsdom-style DOM implementation integration, conformance work, and performance experiments.

## Development

The repository includes browser-oracle scenario tests, jsdom-oriented scenarios, and performance scenarios. See `package.json` for the current build and test scripts.

```sh
npm test
npm run build
```

## License

MIT
