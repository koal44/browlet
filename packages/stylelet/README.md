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

`StyleletOptions` accepts `document`, `element`, `tree`, and `exec`
capabilities directly. The DOM capabilities customize access to attributes,
document state, and tree mutation versions. `exec` accepts `ExecutionCaps`
for promises, deferred execution, and DOM exceptions; omitting it selects
`defaultExecutionCaps`, using the native Promise queue, timers, and DOMException.
The document's `StyleletContext` retains the selected execution facilities and normalized DOM
callbacks; it does not retain the options object.

Stylelet exports its stylesheet, declaration, and media-list implementations.
Stylesheet construction takes the existing context, which supplies `exec`.
Declaration and media-list constructors take execution capabilities last.
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
