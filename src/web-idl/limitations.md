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
  `GetFunctionRealm` behavior from the host.

## Buffer sources

- **Transferability predicate:** JavaScript provides no non-destructive way to
  inspect `[[ArrayBufferDetachKey]]`. The binding can authoritatively perform a
  transfer, but cannot expose the Web IDL "is transferable" predicate for an
  arbitrary incoming buffer without a native host capability. Tracking only
  buffers created by Browlet would be useful but insufficient by itself.

## Promises

- **Promise reactions:** JavaScript exposes `Promise.prototype.then`, not
  `PerformPromiseThen` with a caller-supplied or omitted capability. Reactions
  therefore create unreachable derived promises in a few internal algorithms.
- **Handled flag:** JavaScript does not expose `[[PromiseIsHandled]]` directly.
  Attaching a rejection reaction marks the original promise handled while also
  creating one unreachable fulfilled promise.

These Promise substitutions preserve the relevant observable settlement,
realm, conversion, and unhandled-rejection behavior; revisit them if the host
eventually provides the underlying ECMAScript operations.

## Collection iterators

- **Native iterator internal slots:** JavaScript cannot run
  `CreateIteratorFromClosure` with `%MapIteratorPrototype%` or
  `%SetIteratorPrototype%`. Maplike and setlike iterators therefore use proxy
  shells with the correct realm prototype, class string, inherited surface,
  live ordering, conversions, and iterator results. Ordinary `iterator.next()`
  is conforming, but explicitly applying the realm's native iterator-prototype
  `next` function to one of these shells fails its inaccessible native brand
  check. Replace the shell if the host eventually provides iterator creation
  with a supplied closure.

## Platform integration

Global platform objects and their named-properties prototype objects are
implemented, including immutable prototype behavior, member placement,
property visibility, and legacy Window aliases. `projectGlobalObject()` returns
the public global proxy separately from its implementation target. Browlet does
not project `Window` through that path yet: Node's VM establishes its own
`globalThis` before Web IDL runs, and it cannot be retroactively replaced with
the proxy. HTML section 8.1 realm construction must eventually adopt the public
global object while constructing the realm and place the separate
`WindowProxy` in the global-this binding. Until that host integration exists,
the generic Web IDL behavior is testable but Browlet's Window remains on its
provisional direct projection.

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
