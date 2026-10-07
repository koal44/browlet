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

Supply a document from a browser or DOM implementation:

```js
import { Stylelet } from 'stylelet';

const styles = new Stylelet(document);
const sheet = styles.createStyleSheet();
sheet.replaceSync('.item { color: green; }');

styles.documentScope.setAdoptedStyleSheets([sheet]);
```

Use `styles.getComputedStyle(element)` to read the resulting declaration.
Asynchronous `sheet.replace(text)` returns an `InternalPromise<CSSStyleSheetImpl>`;
consume it with `.observe(fulfilled, rejected)`.

The package builds TypeScript declarations, ESM and CommonJS exports, and
`dist/stylelet.js`, which exposes `Stylelet` as a browser global.

## Host integration

Pass host options as the second argument to `new Stylelet(document, options)`:

| Option | Contract and default |
| --- | --- |
| `dom` | `DOMOperations`, shared with Selectlet. Defaults to `standardDOM` for browser and jsdom nodes. |
| `URL` | `StyleletURLConstructor`: accepts input and an optional base string, returns an object with `href`, and throws on invalid input. Defaults to the native URL constructor. |
| `decodeText` | Complete-input `(bytes, fallbackEncoding) => string` decoding with BOM override and replacement handling. Defaults to the native TextDecoder adapter. |
| `exec` | `StyleletExecution`: Promise allocation, background work, task delivery, and DOM exceptions. Defaults to native Promises, timers, and DOMException. |

Alternatively, pass `{ env }` with an existing `StyleletEnvironment`; it takes
precedence over the other options. The environment contains `userAgent.dom`,
`userAgent.URL`, `userAgent.decodeText`, and `exec`. Browlet supplies this directly.
For direct implementation construction, use `createStyleletEnvironment(options)`
or `defaultStyleletEnvironment`.

DOM operations preserve host node identities. Hosts using Stylelet's declaration
implementation can supply `dom.inlineStyle` to reuse that state. URL providers
resolve stylesheet bases and computed resource URLs; CSSOM exposes serialized
strings. Native timers and TextDecoder are required only when their default
providers are used.

Custom execution providers distinguish `exec.runInParallel()` from result delivery
through `exec.queueTask('dom-manipulation', steps)`. Cancellation uses
`TaskHandle.remove()`. To choose the Promise continuation queue, subclass the
exported `InternalPromise`, override `observeNative()`, and supply it as `exec.Promise`.
`defaultStyleletExecution` supplies the standalone implementation. The package also
exports `DOMOperations`, `TimerHost`, `TaskHandle`, `Encoding`, `EncodingCapability`,
and the `DOMException`/`DOMExceptionConstructor` contracts for host providers.

## CSSOM binding

The package exposes CSSOM implementations, including stylesheets, declarations,
rules, and media lists. Stylesheet construction takes a `StyleletContext`;
declaration and media-list constructors take the environment last.

`styleletIDLDefinitions` supplies Web IDL declarations that a host can assemble
with its own interfaces. The host binding owns platform objects, mixins, Promise
projection, and exceptions. CSSOM projection remains unfinished.

## License

MIT
