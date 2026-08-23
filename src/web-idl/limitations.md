# Web IDL implementation limitations

This file records deliberate approximations and host-dependent gaps that are
easy to lose while the binding grows. Revisit an item when its referenced host
machinery or Web IDL feature is implemented.

## Host and ECMAScript internal slots

- **Associated realms:** ECMAScript does not expose an object's `[[Realm]]`.
  Browlet currently maintains a shared weak association for globals,
  intrinsics, created functions, and evaluated objects, then falls back to the
  active realm for unknown objects. Replace this with HTML section 8.1 realm
  and environment-settings machinery when that layer exists.
- **Callback lifecycle:** Browlet's prepare/cleanup hooks model callback nesting,
  but script preparation, environment settings, and exception reporting are
  placeholders for HTML sections 8.1.4 and 8.1.5.
- **Security checks:** The Web IDL call sites exist, but Browlet's hook is a
  no-op until HTML's cross-origin `WindowProxy` and `Location` behavior exists.
- **Constructor realm fallback:** A non-object `newTarget.prototype` currently
  stops with an explicit error. Completing that path requires ECMAScript's
  `GetFunctionRealm` behavior and the corresponding target-realm binding from
  the host. The expected-failure contract covers the cross-realm fallback.
- **DOMException error internals:** The supported Node.js runtime predates the
  standardized inherited `Error.prototype.stack` accessor and `Error.isError`.
  Constructing `DOMException` through the realm's native `Error` gives it the
  engine's error data, but V8 currently exposes `stack` as an own property and
  provides no public `Error.isError` observation. Expected-failure tests record
  both host gaps; do not emulate them by weakening the platform-object model.

## Buffer sources

- **Detached view byte length:** Web IDL reads a buffer view's internal
  `[[ByteLength]]`, while JavaScript's public view accessors return zero or
  throw after detachment. The original length cannot be recovered for an
  arbitrary incoming detached view without a native host capability.
- **Transferability predicate:** JavaScript provides no non-destructive way to
  inspect `[[ArrayBufferDetachKey]]`. The binding can authoritatively perform a
  transfer, but cannot expose the Web IDL "is transferable" predicate for an
  arbitrary incoming buffer without a native host capability. Tracking only
  buffers created by Browlet would be useful but insufficient by itself.

## Promises

- **Promise reactions:** JavaScript exposes `Promise.prototype.then`, not
  `PerformPromiseThen` with a caller-supplied or omitted capability. Reactions
  therefore create unreachable derived promises in a few internal algorithms.
  They can also consult an author-overridden `constructor` or `@@species`,
  whereas `PerformPromiseThen` would not.
- **Handled flag:** JavaScript does not expose `[[PromiseIsHandled]]` directly.
  Attaching a rejection reaction marks the original promise handled while also
  creating one unreachable fulfilled promise and sharing the same observable
  `constructor`/`@@species` limitation.

These substitutions preserve settlement, realm, conversion, and handled-state
behavior for ordinary promises. The expected-failure tests record the
remaining author-property observability; revisit them if the host eventually
provides the underlying ECMAScript operations. Known future consumers include
Web IDL async iterators and HTML navigation, module, and service-worker promise
reactions; exact unhandled-rejection tracking and APIs that mark promises
handled depend on the same inaccessible machinery.

## Overload resolution

- **Symbol values:** Web IDL declares `symbol` distinguishable from string
  types, but its overload resolution ladder has no branch for selecting a
  `symbol` overload from a JavaScript Symbol value. The expected-failure test
  records this dormant specification gap without inventing a binding rule.

## Collection iterators

- **Native iterator internal slots:** JavaScript cannot run
  `CreateIteratorFromClosure` with `%MapIteratorPrototype%` or
  `%SetIteratorPrototype%`. Maplike and setlike iterators therefore use proxy
  shells with the correct realm prototype, class string, inherited surface,
  live ordering, conversions, and iterator results. Ordinary `iterator.next()`
  and normal iterator-protocol consumers such as `for...of`, spread, and
  `Array.from()` are conforming. The limitation is observable only when code
  explicitly applies the realm's native iterator-prototype `next` function to
  one of these shells, or when native host code performs the equivalent brand
  check. No current Selectlet caller does so; the only normative references to
  these intrinsics in the local web-platform specifications are Web IDL's
  iterator-creation steps themselves. Replace the shell if the host eventually
  provides iterator creation with a supplied closure.

## Platform integration

Browlet-specific realm, Window, and WindowProxy integration gaps are tracked in
[Browlet's limitations](../browlet/limitations.md). Generic global platform
objects and named-properties prototype objects are implemented here, including
immutable prototype behavior, member placement, property visibility, and
legacy Window aliases.

- **Serializable platform objects:** Declarative definitions preserve the
  `[Serializable]` extended attribute, but Browlet does not yet expose HTML's
  structured-clone machinery or dispatch to interface serialization and
  deserialization steps. The `DOMException` expected-failure test records the
  missing public contract. Implement this at HTML's structured serialization
  boundary rather than special-casing cloning in the Web IDL binding.

Observable array exotic objects and their specialized attribute behavior are
implemented. CSSOM's `adoptedStyleSheets` declaration remains temporarily typed
as `any`, however, until `CSSStyleSheet` itself is projected as a Web IDL
platform interface and its observable-array element brand check can be applied.
Until then, Stylelet consumes the shared proxy factory directly. The intended
boundary is for Stylelet to own only a neutral backing collection and its
semantic mutation steps, while the host Web IDL binding owns the author-facing
proxy. Move the proxy factory into Web IDL and remove the shared module when
CSSStyleSheet is bound.

Synchronous pair iterators are implemented. Value iterators and interfaces with
an indexed getter use the realm's actual Array iteration methods as required.
