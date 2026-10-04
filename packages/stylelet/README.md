# Stylelet

Stylelet is a TypeScript CSS style engine for JavaScript DOM implementations. It contains the repository's CSS syntax, values, CSSOM, cascade, inheritance, custom-property, and computed-value work.

## Installation

```sh
npm install stylelet
```

## Usage

```js
import { Stylelet } from 'stylelet';

const styles = new Stylelet(document);
const sheet = styles.createStyleSheet();
```

## Host integration

```js
import { styleletIDLDefinitions } from 'stylelet';
```

`styleletIDLDefinitions` is Stylelet's declaration-only Web IDL contribution.
A DOM host can assemble it with its own interfaces and bind the resulting
CSSOM mixins to that host's platform objects.

`StyleletOptions` accepts `env`, `dom`, `URL`, `decodeText`, and `exec`. The shared `DOMOperations` contract
also serves Selectlet: engines use these operations for all access to host nodes,
preserving their identities without requiring fields or methods on them.
Omitting `dom` selects `standardDOM` for browser or jsdom platform objects;
representations without standard DOM access need a complete provider. Both exports are
available from `stylelet`. Hosts using Stylelet's declaration implementation can
supply `inlineStyle` to reuse that state directly.

`exec` accepts `StyleletExecution`
for promises, deferred execution, and DOM exceptions; omitting it selects
`defaultStyleletExecution`, using the native Promise queue, timers, and DOMException.
Infra owns the standalone scheduling provider and its native timer adapter.
Cancellation uses `TaskHandle.remove()` without exposing browser timer IDs or Node
timer objects. Importing Stylelet does not require ambient timers; a host can supply
its own `exec` or `env`. Native timers are required when the default execution
schedules work. `TimerHost` and `TaskHandle` are exported from `stylelet`.
`exec.DOMException`
supplies the host's constructor using Web IDL Core's `DOMExceptionConstructor`
and `DOMException` contracts, re-exported from `stylelet`. CSSOM platform projection remains unfinished.
Stylesheet result delivery uses `exec.queueTask('dom-manipulation', steps)` separately from
`exec.runInParallel()`. These options compose a standalone environment.

A host with an existing owner can use `new Stylelet(document, { env })`.
That environment is retained directly and takes precedence over the standalone options.
`StyleletEnvironment` requires `userAgent.dom`, `userAgent.URL`, `userAgent.decodeText`, and `exec`; Browlet satisfies this
view with its existing Environment, UserAgent, and composed execution object.
`StyleletContext` and its CSSOM objects retain that same environment. Stylelet
and RealmExecution share Infra's `AsyncExecution` contract for Promise creation
and background work; Stylelet has no dependency on the engine package.

`URL` accepts a `StyleletURLConstructor`: construction takes an input string and
an optional base string, returns a `StyleletURL` with `href`, and throws for invalid
input. Standalone composition defaults to the captured native URL constructor;
Browlet supplies its own implementation. The same provider resolves stylesheet
bases and computed resource URLs. Low-level value callers supply it as `context.URL`
when computing nonempty, nonlocal URLs. URL strings are resolved before CSS
serialization; these internal objects are not exposed through CSSOM.

`decodeText(bytes, fallbackEncoding)` supplies complete-input text decoding with
BOM override and replacement handling. `Encoding` and `EncodingCapability` are
exported for hosts implementing this contract. Browlet uses its Encoding
implementation; standalone hosts default to the native decoder adapter. CSS
chooses its fallback using Encoding Core's shared label lookup. Importing
Stylelet does not require ambient TextDecoder; using the native adapter does.

Stylelet exports its stylesheet, declaration, and media-list implementations.
Stylesheet construction takes the existing context, which supplies `env`.
Declaration and media-list constructors take the environment last.
For standalone construction, use `createStyleletEnvironment(options)` or
`defaultStyleletEnvironment`.
`CSSStyleSheetImpl.replace()` returns an internal
`InternalPromise<CSSStyleSheetImpl>`; use `.observe(fulfilled, rejected)` when consuming
it directly. Platform promise and exception projection belong to the host binding.

The exported `InternalPromise` class supplies static creation and instance
observation. Custom hosts can subclass it, override `observeNative()`, and supply
the constructor as `exec.Promise` to select their continuation queue without
loading JSRealm, JSRuntime, Node VM integration, or the compatibility add-on.

Stylelet is under active development. Its public surface and implemented specification coverage are not yet complete.

## License

MIT
