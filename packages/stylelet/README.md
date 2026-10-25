# Stylelet

A TypeScript CSS style engine for JavaScript DOM implementations.

Stylelet brings together CSS parsing, CSSOM, the cascade, inheritance, custom
properties, and computed values. It operates on a document supplied by its host.

## Development status

Stylelet is unfinished and not yet published on npm. Its API and specification
coverage are still changing. Follow Browlet's
[source setup](https://github.com/koal44/browlet/blob/main/BUILDING.md#build-from-source)
and build the package from the repository root:

```sh
npm run build -- stylelet
```

## Usage

Supply a document and its host environment from a DOM implementation running in Node:

```js
import { Stylelet } from 'stylelet';

const styles = Stylelet.create(document, { env });
const sheet = styles.createStyleSheet();
sheet.replaceSync('.item { color: green; }');

styles.documentScope.adoptedStyleSheets.push(sheet);
```

Use `styles.getComputedStyle(element)` to read the resulting declaration.
Asynchronous `sheet.replace(text)` returns an `InternalPromise<CSSStyleSheetImpl>`;
consume it with `.observe(fulfilled, rejected)`.

The package targets Node 22.19 or newer and builds TypeScript declarations,
ESM and CommonJS exports. It does not provide a browser-global bundle.

## Host integration

`StyleletOptions` requires `{ env }`. `StyleletEnvironment` extends
`FetchEnvironment`: the consumer supplies execution, request/security state,
transport, and shared networking services. Stylelet does not construct a default
runtime. Browlet supplies its existing environment directly.

Hosts that retain their own document TreeScope can pass it to `new Stylelet(scope)`
when queries first need an engine. `Stylelet.create(document, { env })` creates
the context, scope, and engine together for other hosts.

The Stylelet additions are `userAgent.dom`, `userAgent.blobURLStore`, optional
`userAgent.systemColors`, and `getAssociatedDocument()`. Configure these on the
supplied environment. Direct CSSOM implementation construction and
`StyleletContext` also require that environment.

DOM operations preserve host node identities. Hosts using Stylelet's declaration
implementation can supply `dom.inlineStyleBlock` to reuse that state. Stylelet imports
its URL parser and Encoding decoder directly. Sheets retain `URLRecord`s;
CSSOM exposes serialized strings. URL parsing consults the owning UserAgent's
Blob URL store supplied by the host.

`fetchStyleResource(url, ruleOrDeclaration, destination, corsMode, env, processResponse)`
uses the included Fetch implementation and the owning `StyleletEnvironment`.
The result is a cancellable
`FetchController`, or `null` for an invalid URL. `UrlValue` retains and applies CSS
request modifiers. This operation does not start automatic stylesheet imports
or manage HTML events and blockers.

`CSSStyleSheetImpl.loadImports()` coordinates recursive imports through a supplied
fetch callback. The host supplies document-dependent request setup and parsed
sheet results, and handles completion, cancellation, events, and blockers.
Browlet provides that integration in its style subsystem using `DocumentImpl`.

Custom execution providers distinguish `exec.runInParallel()` from result delivery
through `exec.queueTask('dom-manipulation', steps)`. Cancellation uses
`TaskHandle.remove()`. To choose the Promise continuation queue, subclass the
exported `InternalPromise`, override `observeNative()`, and supply it as `exec.Promise`.
`StyleletExecution` uses Fetch's full execution contract. The package also
exports `DOMOperations`, `TimerHost`, `TaskHandle`, `Encoding`,
and the `DOMException`/`DOMExceptionConstructor` contracts for host providers.

`ColorRgba` maps lowercase CSS color names, including `transparent`, to packed
`0xRRGGBBAA` values. `absoluteColorFromRgba()` creates an independent `AbsoluteColor`
with legacy sRGB byte components and alpha (`is8Bit`), without constructing an engine.

## CSSOM binding

The package exposes CSSOM implementations, including stylesheets, declarations,
rules, and media lists. Stylesheet construction takes a `StyleletContext`;
declaration and media-list constructors take the environment last.

`styleletIDLDefinitions` supplies Web IDL declarations that a host can assemble
with its own interfaces. The host binding owns platform objects, mixins, Promise
projection, and exceptions. CSSOM projection remains unfinished.

## License

MIT
