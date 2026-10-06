# Known limitations

This catalog records observable constraints shared across engine, binding, and
browser integration. It is not an inventory of every unimplemented API:
[PRIORITY.md](PRIORITY.md) and owner roadmaps cover that work. The linked tests
retain the required behavior, including approved expected failures. Runtime
results depend on the selected base and available capabilities; this catalog
does not claim a fresh test run on every backend.

## Runtime selection

Plain Node has no compatibility addon. Official Node plus the addon supplies
explicit queues and native global/context allocation. A custom Node build with
the relevant V8 patches supplies additional operations, including job hooks
and native callback iterators. Test capabilities, not just the `custom` label.
[Node compatibility](../node-compat/README.md) owns builds and supported bases;
[JS Engine](js-engine/README.md) owns their common runtime contract.

## Realm identity and global objects

- **`node-v8-object-realms`:** Native `getRealm` and `getFunctionRealm` use
  creation contexts and stamped realm references when available. Plain Node
  instead uses known associations plus prototype/evaluation evidence; changed
  function prototypes and callable Proxy traps can defeat exact constructor
  realm selection. Replace that fallback when exact lookup is available on all
  supported paths, preserving cross-realm construction and callback tests.
  Sources: [runtime](js-engine/runtime.ts), [constructor tests](../test/web-idl/constructor-realm.test.ts),
  [callback tests](../test/web-idl/callback.test.ts).
- **`node-vm-global-proxy`:** Plain Node cannot reuse Browlet's modeled
  WindowProxy as the VM's actual top-level `this`. Its JavaScript proxy must
  also relax forwarded nonconfigurable descriptors across retargeting. The
  native context/allocation path resolves these two mismatches. Remove the
  modeled proxy/descriptor accommodations only when that path is required.
  Sources: [JSRealm](js-engine/realm.ts), [Window binding tests](../test/browlet/dom-binding.test.ts),
  [navigation tests](../test/browlet/browsing/document-lifecycle.test.ts).
- **Browser origin security remains unfinished on every backend.** A native
  WindowProxy and Node's shared security token provide identity and embedder
  access, not same-/cross-origin policy. The Web IDL security hook is currently
  a no-op. Retained-realm access, nested contexts, Location checks, and complete
  named properties await the [Window roadmap](browlet/browsing/window/ROADMAP.md).
  Native global detachment cancels queued V8 jobs; HTML must perform its required
  checkpoint before detaching, as the current top-level path does.

## Scheduling and callback context

- **`node-v8-microtask-queue` / `node-v8-checkpoint`:** Without explicit queues,
  all event loops share Node's ambient queue and use private `_tickCallback()`.
  It can drain unrelated jobs, next-ticks, and rejection machinery, including
  premature unhandled-rejection reporting during nested checkpoints. The
  explicit backend gives each configured HTML loop its own queue. Retire the
  ambient queue/checkpoint substitute together when unsupported runtimes are
  dropped. [Event-loop notes](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-microtask-queue)
  retain the affected tests and exact replacement conditions.
- **`node-v8-execution-contexts`:** Custom job hooks capture controlled Promise
  callback/job boundaries; official engines lack those hooks. Neither exposes
  the entire execution stack or supplies HTML Script records. The mirrored
  entries/incumbent fallback remain necessary for unobserved calls until script
  integration and host-entry handling are complete. See the
  [callback lifecycle record](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts)
  and [tests](../test/browlet/scripting/callback-lifecycle.test.ts).
- **Custom generic/timeout hooks are isolate-wide.** They cannot decline an
  individual job. `Atomics.waitAsync` in an unrelated Node/VM realm while those
  Browlet hooks are installed is unsupported; HTML realms use their task and
  active-time timeout paths. Revisit with a host-hook routing/fallback contract.
- **Direct host calls are not HTML tasks.** Calling a projected API from Node
  does not itself establish a checkpoint boundary. Use the
  [automation entry](browlet/automation/README.md) for page commands; a broader
  embedder contract must define direct-call/Promise interoperability. Do not
  hide this by checkpointing after every Web IDL operation.
- **Internal sandboxes provide execution, with browser client settings stubbed.**
  Their binding uses the full BrowletEnvironment contract, but origin, base
  URL, creation URL, policy, module, ancestry, time-origin, and Window/Worker
  global-scope queries throw explicitly. They remain suitable for internal
  allocations and clientless work such as Reporting uploads. Public APIs that
  need those settings require a Window or another complete environment.
  Sources: [environments](browlet/scripting/environment.ts),
  [sandbox tests](../test/browlet/scripting/sandbox.test.ts).

## Promise observation

`node-v8-promise-reactions` covers the captured intrinsic `then` fallback, which
bypasses author replacement of `then` but still observes `constructor`/`@@species`.
Native observation on the supported Node 26/custom paths avoids those accesses;
the older Node 24 native implementation still consults `constructor`. The
backend-sensitive expectations are in [engine Promise tests](../test/js-engine/promises.test.ts)
and [Web IDL Promise tests](../test/web-idl/promise.test.ts).

Even the native API creates an unreachable derived Promise rather than exposing
the exact no-result-capability form of `PerformPromiseThen`. Browlet also marks a
Promise handled by attaching a reaction; the addon does not expose V8's existing
`MarkAsHandled` API. Replace these substitutes with exact engine operations;
preserve typed settlement, exception identity, handled state, and queue ownership.
Implementation: [runtime observation](js-engine/runtime.ts) and [Web IDL promises](web-idl/values/promise.ts).

## Buffers and engine internal slots

- **Shared view length mode:** Native length-tracking inspection distinguishes
  auto-length from fixed views. Without it, a reversible resize probe works for
  resizable ArrayBuffers, but a growable SharedArrayBuffer cannot shrink back.
  Ambiguous shared views are reconstructed as fixed. Retire the inference path
  when native inspection is universally available. See [buffers](js-engine/buffers.ts)
  and [structured-data tests](../test/browlet/scripting/structured-data/deserialize.test.ts).
- **`SPEC_CLASH(webidl-buffer-source-byte-length)`:** Buffer/view length helpers
  report current intrinsic lengths rather than the raw `[[ByteLength]]` slot.
  Detached/out-of-bounds typed arrays return zero; DataViews request TypeError.
  This follows the needs of current consumers while Web IDL's definition remains
  under discussion. The [engine contract](js-engine/ROADMAP.md#buffer-source-byte-length)
  records the specification and browser evidence; [buffer tests](../test/js-engine/buffers.test.ts)
  cover resizing and detachment. Recovering old fixed-view lengths is not a
  current requirement.
- **Transfer eligibility:** There is no non-destructive query for
  `[[ArrayBufferDetachKey]]`. V8's `IsDetachable()` is not equivalent; the actual
  transfer remains authoritative. Add the correct query before claiming the
  separate predicate. See [JSRealm](js-engine/realm.ts) and the
  [engine roadmap](js-engine/ROADMAP.md).
- **Error internals:** `node-v8-error-stack` reads the known own stack accessor
  or data property, not an exposed `[[Stack]]`. V8's own-property layout differs
  from the proposed inherited stack accessor, whose test runs only when the
  engine provides it. Error.isError availability also varies by runtime.
  Error and DOMException serialization preserve readable stack strings;
  replaced stack accessors are not invoked. Native formatting can still run
  author name/message getters or Error.prepareStackTrace. Failed formatting
  leaves the stack unavailable and serialization writes an empty string.
  Preserve [DOMException tests](../test/browlet/dom-exception.test.ts)
  and serialization behavior when adopting exact primitives.
- **Unrecognized exotics:** The patched backend exposes exact Array, String,
  and RegExp String iterator brands, including iterators with added properties.
  Without those predicates, the decorated-iterator regression in
  [serialization tests](../test/browlet/scripting/structured-data/serialize.test.ts)
  remains an expected failure. `node-v8-exotic-object-slots` probes other
  propertyless values through native cloning; decorated iterator helpers and
  other unrecognized exotics still cannot be inspected safely without author effects.

## Web IDL boundaries

- **Collection iterator branding:** With the patched engine's iterator factory,
  native Map/Set `next()` recognizes generated iterators. Otherwise proxy shells
  preserve ordinary iteration, prototypes, and live results but fail borrowed
  native `next()` brand checks. Retire the fallback when the native factory is
  required. See [JSRealm](js-engine/realm.ts) and
  [collection tests](../test/web-idl/collection.test.ts).
- **`SPEC_GAP(webidl-symbol-selection)`:** Web IDL's
  [distinguishability table](https://webidl.spec.whatwg.org/#dfn-distinguishable)
  admits Symbol/string overloads and unions, but both the
  [overload](https://webidl.spec.whatwg.org/#dfn-overload-resolution-algorithm)
  and [union](https://webidl.spec.whatwg.org/#es-union) selection algorithms omit
  a Symbol branch. Browlet selects a declared symbol branch for a primitive
  JavaScript Symbol before coercing fallbacks. Nullable and union branches use
  the same prepared candidates; boxed Symbols retain object/conversion rules.
  This completes the type distinction without claiming browser precedent:
  Chromium, Firefox, and WebKit's inspected IDL declarations had no consumers,
  and [Blink rejects the type during binding generation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/bindings/scripts/bind_gen/blink_v8_bridge.py).
  Revisit when the specification supplies selection rules. The
  [overload](../test/web-idl/overload.test.ts) and
  [conversion](../test/web-idl/conversion.test.ts) regressions cover this choice.
- **CSSOM projection:** CSSStyleSheet and related platform interfaces remain
  incomplete; `adoptedStyleSheets` is temporarily `any`, bypassing its eventual
  interface brand check. Direct CSSOM APIs currently allocate exceptions in the
  owning environment; method-realm selection awaits their member bindings.
  [Style integration](browlet/style/ROADMAP.md#next-boundary-change)
  owns projection, restoring `ObservableArray<CSSStyleSheet>`, and removing the
  temporary Infra observable-array factory.

One owning world per implementation and preservation of genuine `object`/`any`
values are intentional [binding contracts](web-idl/README.md), not missing APIs.

## HTML integration gates

The [loader](browlet/loader/ROADMAP.md) now consumes streamed Fetch responses,
including response CSP and basic decoding/abort. The synchronous source-text
route also remains. Neither establishes full HTML navigation, encoding restart,
script readiness, Link/preload processing, load-event ordering, or public timing
entries. Fragment and `javascript:` navigation still need their specified paths.

Nested/auxiliary creation stops at explicit missing creator-state and ancestry
helpers. Policy inheritance, child navigation, history disposal, and storage-shed
cloning remain with [browsing](browlet/browsing/ROADMAP.md) and
[navigation](browlet/browsing/navigation/ROADMAP.md). Custom-element registry
identity is present; reactions and upgrade behavior remain with
[custom elements](browlet/html/custom-elements/ROADMAP.md). Fetch's remaining
work and provisional consumer hooks stay in its [single roadmap](fetch/ROADMAP.md).
