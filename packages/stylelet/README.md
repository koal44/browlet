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

`StyleletOptions` accepts `env`, `dom`, and `exec`. The shared `DOMOperations` contract
also serves Selectlet: engines use these operations for all access to host nodes,
preserving their identities without requiring fields or methods on them.
Omitting `dom` selects `standardDOM` for browser or jsdom platform objects;
representations without standard DOM access need a complete provider. Both exports are
available from `stylelet`. Hosts using Stylelet's declaration implementation can
supply `inlineStyle` to reuse that state directly.

`exec` accepts `StyleletExecution`
for promises, deferred execution, and DOM exceptions; omitting it selects
`defaultStyleletExecution`, using the native Promise queue, timers, and DOMException.
Stylesheet result delivery uses `exec.style.queueTask()` separately from
`exec.runInParallel()`. These options compose a standalone environment.

A host with an existing owner can use `new Stylelet(document, { env })`.
That environment is retained directly and takes precedence over `dom` and `exec`.
`StyleletEnvironment` requires `userAgent.dom` and `exec`; Browlet satisfies this
view with its existing Environment, UserAgent, and composed execution object.
`StyleletContext` and its CSSOM objects retain that same environment. Stylelet
and RealmExecution share Infra's `AsyncExecution` contract for Promise creation
and background work; Stylelet has no dependency on the engine package.

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
