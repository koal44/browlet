# Web IDL implementation limitations

This file records deliberate approximations and host-dependent gaps that are
easy to lose while the binding grows. Revisit an item when its referenced host
machinery or Web IDL feature is implemented.

## Host and ECMAScript internal slots

- **Associated realms — `node-v8-object-realms` accommodation:** ECMAScript
  does not expose an object's `[[Realm]]`. The lower JavaScript runtime
  maintains an isolate-scoped weak
  association for globals, intrinsics, created functions, and evaluated
  objects, then falls back to the active evaluation realm for unknown objects.
  HTML's environment-settings layer owns callback context and controlled
  script entries, but it cannot recover arbitrary objects' internal realm.
  Replace the associations and fallback together if a future runtime API or
  direct V8 embedding exposes that slot; borrowed-operation and callback realm
  tests must continue to determine the result. The accommodation lives in
  [`node-runtime.ts`](../javascript/node-runtime.ts), below Web IDL; integrated
  realm behavior is covered by
  [`file-api.test.ts`](../../test/browlet/unit/file-api.test.ts) and
  callback conversion covered by
  [`callback.test.ts`](../../test/web-idl/unit/callback.test.ts).
- **Callback lifecycle — `node-v8-execution-contexts` accommodation:** Browlet
  implements the HTML §8.1.3.3 backup incumbent stack and the §8.1.4.4
  preparation, cleanup, task settings-set, and checkpoint boundary for entries
  it controls. Node does not expose the complete execution-context stack,
  `ScriptOrModule`, or HTML §8.1.6.2 `HostEnqueuePromiseJob`; arbitrary V8
  entries therefore cannot be mirrored, and exception reporting remains future
  HTML §8.1.5 work. The affected code and replacement boundary are recorded in
  [the event-loop architecture](../browlet/scripting/event-loop-architecture.md#node-v8-execution-contexts).
- **Security checks:** The Web IDL call sites exist, but Browlet's hook is a
  no-op until HTML's cross-origin `WindowProxy` and `Location` behavior exists.
- **Constructor realm fallback:** A non-object `newTarget.prototype` currently
  stops with an explicit error. Completing that path requires ECMAScript's
  `GetFunctionRealm` behavior and the corresponding target-realm binding from
  the host. The expected-failure contract covers the cross-realm fallback.
- **DOMException error internals:** Constructing `DOMException` through the
  realm's native `Error` gives it the engine's error data, but V8 currently
  exposes `stack` as an own property rather than through the standardized
  inherited `Error.prototype.stack` accessor. Some supported Node.js versions
  also predate `Error.isError`; the binding uses that operation when the host
  provides it. Capability-sensitive tests record both host behaviors without
  weakening the platform-object model.

## Buffer sources

- **Growable SharedArrayBuffer view length:** Node exposes a view's current
  numeric length but not its internal fixed-versus-auto length mode. Ordinary
  resizable ArrayBuffers permit a reversible intrinsic resize probe; growable
  SharedArrayBuffers cannot shrink back after an equivalent probe. An
  ambiguous fixed-at-end or auto-length shared view therefore remains fixed
  when structured data reconstructs it.
- **Detached view byte length:** Web IDL and HTML require a buffer view's
  internal `[[ByteLength]]`, while JavaScript's public view accessors return
  zero or throw after detachment. The original length cannot be recovered for
  an arbitrary incoming detached view without a native host capability.
- **Transferability predicate:** JavaScript provides no non-destructive way to
  inspect `[[ArrayBufferDetachKey]]`. The binding can authoritatively perform a
  transfer, but cannot expose the Web IDL "is transferable" predicate for an
  arbitrary incoming buffer without a native host capability. Tracking only
  buffers created by Browlet would be useful but insufficient by itself.

## Promises

- **Promise reactions:** The JavaScript runtime's
  `installPromiseReactions()` operation uses `Promise.prototype.then` because
  JavaScript does not expose `PerformPromiseThen`. It approximates that
  operation's no-result-capability form, so every use creates an unreachable
  derived promise and can consult an author-overridden `constructor` or
  `@@species`. Web IDL separately settles its typed result capability where
  required.
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
  `[Serializable]` extended attribute, and Web IDL now provides a generic,
  realm-bound capability and internal-creation seam. Browlet registers the
  DOMException and QuotaExceededError steps through that seam and implements
  HTML's recursive serialization, transfer, target-realm deserialization, and
  public `structuredClone()` API. Remaining platform-transfer coverage belongs
  to Browlet's future MessagePort implementation, not to Web IDL.

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
