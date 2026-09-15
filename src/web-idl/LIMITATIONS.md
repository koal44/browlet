# Web IDL implementation limitations

This file records deliberate approximations and host-dependent gaps that are
easy to lose while the binding grows. Revisit an item when its referenced host
machinery or Web IDL feature is implemented.

## Host and ECMAScript internal slots

- **Associated realms — `node-v8-object-realms` accommodation:** ECMAScript
  does not expose an object's `[[Realm]]`. The lower JS Engine project
  maintains an isolate-scoped weak
  association for globals, intrinsics, created functions, and evaluated
  objects, then falls back to the active evaluation realm for unknown objects.
  HTML's environment-settings layer owns callback context and controlled
  script entries, but it cannot recover arbitrary objects' internal realm.
  Replace the associations and fallback together if a future runtime API or
  direct V8 embedding exposes that slot; borrowed-operation and callback realm
  tests must continue to determine the result. The accommodation lives in
  [`runtime.ts`](../js-engine/runtime.ts), below Web IDL; integrated
  realm behavior is covered by
  [`file-api.test.ts`](../../test/browlet/file-api.test.ts) and
  callback conversion covered by
  [`callback.test.ts`](../../test/web-idl/callback.test.ts).
- **Callback lifecycle — `node-v8-execution-contexts` accommodation:** Browlet
  implements the HTML §8.1.3.3 backup incumbent stack and the §8.1.4.4
  preparation, cleanup, task settings-set, and checkpoint boundary for entries
  it controls, including Promise callbacks/jobs on the custom engine. Node
  does not expose the complete execution-context stack or HTML Script records;
  official engines also lack the Promise job hooks. Arbitrary V8
  entries therefore cannot be mirrored, and exception reporting remains future
  HTML §8.1.5 work. The affected code and replacement boundary are recorded in
  [the event-loop architecture](../browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts).
- **Security checks:** The Web IDL call sites exist, but Browlet's hook is a
  no-op until HTML's cross-origin `WindowProxy` and `Location` behavior exists.
- **Constructor realm fallback:** A non-object `newTarget.prototype` selects
  the interface prototype from the constructor's associated realm. Exact realm
  lookup for bound functions and callable proxies depends on the add-on's
  `getFunctionRealm` operation. Plain stock Node's fallback can select the wrong
  realm after a function's prototype changes or consult a proxy's prototype trap.
  [`constructor-realm.test.ts`](../../test/web-idl/constructor-realm.test.ts)
  covers the ordinary fallback and marks cases requiring exact lookup by capability.
- **DOMException error internals:** Constructing `DOMException` through the
  realm's native `Error` gives it the engine's error data, but V8 currently
  exposes `stack` as an own property rather than through the standardized
  inherited `Error.prototype.stack` accessor. Some supported Node.js versions
  also predate `Error.isError`; the binding uses that operation when the host
  provides it. Capability-sensitive tests record both host behaviors without
  weakening the platform-object model.

## Buffer sources

- **Growable SharedArrayBuffer view length:** The custom engine and addon expose
  the fixed-versus-auto length mode. Backends without that query expose only
  a view's current numeric length. Ordinary
  resizable ArrayBuffers permit a reversible intrinsic resize probe; growable
  SharedArrayBuffers cannot shrink back after an equivalent probe. An
  ambiguous fixed-at-end or auto-length shared view therefore remains fixed
  when structured data reconstructs it on those backends.
- **Detached view byte length:** Web IDL and HTML require a buffer view's
  internal `[[ByteLength]]`, while JavaScript's public view accessors return
  zero or throw after detachment. The original length cannot be recovered for
  an arbitrary incoming detached view without native engine support.
- **Transferability predicate:** JavaScript provides no non-destructive way to
  inspect `[[ArrayBufferDetachKey]]`. The engine's transfer operation is
  authoritative, but the Web IDL "is transferable" predicate needs a separate
  engine query. V8's `IsDetachable()` reports a different flag. This query is
  deferred; it does not require a new dependency in implementation constructors.

## Promises

- **Promise reactions:** `JSRealm.observePromise()` uses native
  `v8::Promise::Then` when the addon is available. Node 26.8.1 and the custom
  engine bypass author `then`, `constructor`, and `@@species` properties.
  V8's public API still allocates an unreachable derived
  promise; it does not expose the exact no-result-capability form of
  `PerformPromiseThen`. Web IDL separately settles its typed result capability.
  Node 24.19.0's older implementation of the native API still consults
  `constructor`; its regression remains an expected failure on that base.
  Plain stock Node retains the captured `Promise.prototype.then` fallback,
  including its constructor and species observability; ordinary asynchronous
  operations still complete.
- **Handled flag:** JavaScript does not expose `[[PromiseIsHandled]]` directly.
  Attaching a rejection reaction marks the original promise handled while also
  creating one unreachable fulfilled promise.

These substitutions preserve settlement, realm, conversion, and handled-state
behavior for ordinary promises. Capability-sensitive regressions preserve
the constructor-observability and queue-isolation requirements. Current
consumers include Web IDL async iterators; HTML navigation, module, and service-worker promise
reactions; exact unhandled-rejection tracking and APIs that mark promises
handled depend on the same inaccessible machinery.

## Overload resolution

- **Symbol values:** Web IDL declares `symbol` distinguishable from string
  types, but its overload resolution ladder has no branch for selecting a
  `symbol` overload from a JavaScript Symbol value. The expected-failure test
  records this dormant specification gap without inventing a binding rule.

## Collection iterators

- **Native iterator internal slots:** `JSRealm.createCollectionIterator()`
  uses the add-on's `createCollectionIterator` operation when available. Without
  it, JavaScript cannot run `CreateIteratorFromClosure` with
  `%MapIteratorPrototype%` or `%SetIteratorPrototype%`, so the engine supplies
  proxy shells with the correct realm prototype, class string, inherited
  surface, live ordering, conversions, and iterator results. Ordinary
  `iterator.next()` and iterator-protocol consumers use that fallback. Applying
  the realm's native iterator-prototype `next` function to a shell still fails
  its native brand check. Capability-sensitive cases in
  [`collection.test.ts`](../../test/web-idl/collection.test.ts) retain that
  distinction.

## Platform integration

Browlet-specific realm, Window, and WindowProxy integration gaps are tracked in
[Browlet's limitations](../browlet/LIMITATIONS.md). Generic global platform
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
Until then, Stylelet consumes the temporary proxy factory in
`infra/observable-array.ts` directly. The remaining projection work and the
factory's removal condition are tracked in the
[style integration roadmap](../browlet/style/ROADMAP.md#next-boundary-change).

Synchronous pair iterators are implemented. Value iterators and interfaces with
an indexed getter use the realm's actual Array iteration methods as required.
