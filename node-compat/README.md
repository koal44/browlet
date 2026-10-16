# Node compatibility

Browlet uses this native addon to control microtask checkpoints, identify the
realm of an object, and preserve the global proxy across navigation. HTML owns
the scheduling and browser policy applied through those engine facilities.

Stock Node runs through JS Engine's fallback paths. On supported official Node
builds, the addon supplies explicit queues, native contexts and globals, realm
lookup, and Promise observation. The [V8 patch set](../vendor/_patches/node-v8.patch)
adds callback/job hooks, native collection iterators, and further object, iterator,
and buffer-view inspection. The patch includes engine regressions and records its
upstream Node revision. [Known limitations](../src/LIMITATIONS.md) describes
the observable constraints of each runtime.

## Code and regressions

| Area | Implementation and evidence |
| --- | --- |
| Contexts, globals, and microtask queues | [vm.cc](addon/vm.cc), [JavaScript adapters](addon/vm.cjs); [queue tests](test/capabilities.test.cjs), [browser global tests](../test/browlet/browsing/native-global.test.ts) |
| Realm identity and lookup | [realm.cc](addon/realm.cc); [realm tests](test/capabilities.test.cjs) |
| Promise observation | [promise.cc](addon/promise.cc); [Promise tests](test/capabilities.test.cjs) |
| Callback and job hooks | [host-hooks.cc](addon/host-hooks.cc), [JavaScript adapter](addon/host-hooks.cjs); [native hook tests](test/host-hooks.test.cjs), [HTML Promise jobs](../test/browlet/scripting/promise-jobs.test.ts) |
| Native property interception | [property-delegate.cc](addon/property-delegate.cc), [JavaScript adapters](addon/property-delegate.cjs); [property tests](test/html-dda.test.cjs) |
| Native value inspection and iteration | [iterators.cc](addon/iterators.cc), [array-buffer.cc](addon/array-buffer.cc); [iterator predicates](test/iterator-predicates.test.cjs), [buffer views](test/array-buffer.test.cjs), [collection iterators](test/collection-iterator.test.cjs) |
| Object-brand predicates | [object-types.cc](addon/object-types.cc); [brand tests](test/object-types.test.cjs) |
| Callable, undetectable objects | [html-all-collection.cc](addon/html-all-collection.cc); [native object tests](test/html-dda.test.cjs) |

[addon.cc](addon/addon.cc) registers the native modules;
[index.cjs](addon/index.cjs) loads the binary and assembles the JavaScript API.
Context and queue handles retain their shared lifetime owner in `vm.cc`.
Factories that allocate in a context use `GetContext()` with the opaque callback
data returned by `InitializeVm()`; they do not access the handle's stored state.

The [native addon suite](test/) also covers lifetime, garbage collection, and runtime selection.

## Contexts, globals, and optional facilities

`createMicrotaskQueue()` supplies enqueue/checkpoint operations.
`createContextHandle()` creates a native V8 context registered with Node;
`runInContext()` evaluates there. These are not `node:vm` Contextify objects.
The supported options are queue selection, `reuseGlobalProxyFrom`, and
`globalPrototypeChain`; evaluation accepts filename, lineOffset, and
`displayErrors: false`. Unsupported options fail explicitly. Dynamic-import
callbacks, vm.Script interoperability, timeouts, and automatic afterEvaluate
checkpoints remain outside this API.

A handle separates its stable realm reference from its reusable global proxy.
Detachment allows that proxy to transfer once to a fresh context. Retaining the
realm reference keeps the old realm alive; `.global` is not its identity.
`getRealm(object)` reports creation context, while `getFunctionRealm(callable)`
follows bound/proxy targets without traps and rejects revoked callable proxies.

`globalPrototypeChain` preallocates an immutable global proxy/target and ordered
`mutable`, `immutable`, or `delegated` prototype layers. Reuse requires the same
layout. Web IDL populates them; `setPropertyDelegate()` attaches named-property
behavior and `setGlobalObject()` selects the Window target. Node's shared VM
security token permits embedder access; it does not implement browser cross-origin policy.

| Optional operation | Availability and contract |
| --- | --- |
| `isWeakRef(value)` | Available with the addon on every supported base. Uses V8's existing `Value::IsWeakRef()` without reading properties or dereferencing the target; proxies and prototype impostors return false. No engine patch is required. |
| `isFinalizationRegistry(value)` | Requires `Value::IsFinalizationRegistry()`. Checks the native brand without reading properties or changing registered entries; proxies and prototype impostors return false. JS Engine retains its captured-`unregister` fallback where unavailable. |
| `createHTMLDDA(context, call)` | Available with the addon on every supported base. Allocates a callable, non-constructible object with native `[[IsHTMLDDA]]` behavior in the supplied context. Invokes `call` with an undefined receiver and the original arguments; preserves its result or exception. |
| `setPropertyHandlers(object, handlers)` | Attaches property algorithms to a native object allocated with interceptors. Accepts `has`, `get`, `set`, `getOwnPropertyDescriptor`, `defineProperty`, `deleteProperty`, and `ownKeys`; the addon translates descriptors and keys into V8's query/index protocols. |
| `observePromise(promise, realmAnchor, fulfilled?, rejected?)` | Native `Promise::Then` in the observer's realm. Node 26/custom bypass author `then`, `constructor`, and species; Node 24 still consults `constructor`. A derived Promise is allocated and discarded by Browlet. |
| `createCollectionIterator(context, kind, next)` | Requires `CollectionIterator::New`. Produces native Map/Set-branded iterators; the callback owns result conversion/allocation, V8 owns iteration lifecycle. |
| `isLengthTrackingArrayBufferView(view)` | Requires `ArrayBufferView::IsLengthTracking()`. Reads auto/fixed length without mutation, including shared, detached, and out-of-bounds views. |
| `isArrayIterator(value)`, `isStringIterator(value)`, `isRegExpStringIterator(value)` | Require the corresponding V8 `Value` predicates. Inspect the native brand without reading properties or advancing the iterator; proxies and prototype impostors return false. |
| `setHostHooks(hooks)` | Requires the five V8 interception APIs below. Header detection controls whether the addon exports it. |

Callback iterators have no table-backed entries for native debugger/Node previews.

An HTMLDDA object must itself be exposed; an outer JavaScript Proxy loses its
falsiness, `typeof "undefined"`, and loose equality with null/undefined. Set its
platform prototype before exposure. Collection lookup and argument/result
conversion remain in HTML and Web IDL, not the addon. Without this native
capability, Browlet omits `Document.prototype.all`. The
[nodes roadmap](../src/browlet/dom/nodes/ROADMAP.md#htmlallcollection) records its
remaining enumeration-order conflict with Web IDL.

Use direct property handlers for HTMLDDA, not `setPropertyDelegate()`'s ordinary
object forwarding. On V8, that forwarding's `Reflect.set()` can create a physical
property on the native receiver while deletion targets the separate delegate.
The direct handlers' `has`, `getOwnPropertyDescriptor`, `set`, `defineProperty`,
and `deleteProperty` receive a final `hasOwn` boolean for physical properties,
excluding intercepted properties. Mutation handlers return `undefined` to let V8
perform the ordinary operation; false rejects it. Web IDL intercepts collection
properties and lets V8 retain ordinary accessors and their original receivers.
An optional `getPropertyAttributes` supplies V8's lookup flags independently of
the public descriptor (default: `getOwnPropertyDescriptor`). Web IDL uses this
to permit named-property assignment on a separate receiver while its public
descriptor stays read-only and replacement on the collection remains rejected.
The [property regressions](test/html-dda.test.cjs) cover both paths. The older
global/prototype delegate adapter is unchanged. These interceptors are not a
complete Proxy API: Node 26+ supplies the holder rather than the original
property-access receiver; global handlers receive undefined. The collection path
does not use that receiver argument.

## Host hooks

The hooks correspond to ECMAScript's [job operations](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-jobs).
One `setHostHooks()` installation owns the isolate until Node environment teardown;
reinstallation throws `ERR_HOST_HOOKS_INSTALLED`. Workers have independent state.
Each callback is optional; omitted enqueue hooks leave that job kind with V8.

| Callback | Contract |
| --- | --- |
| `makeJobCallback(callback, registration)` | Return `{ callback, hostDefined }`, retaining the original callback. Each reaction/thenable registration captures separately; FinalizationRegistry captures at construction. |
| `callJobCallback(record, receiver, args)` | Invoke the captured callback using the exact retained record; return its result or propagate its exception. |
| `enqueuePromiseJob(job, realm, enqueue)` | Schedule the single-use job, or return `false` to leave it on its original queue. The specification realm can be null; `enqueue` includes a snapshot and reaction/thenable kind. |
| `enqueueGenericJob(job, realm)` | Schedule a single-use generic job; currently Atomics.waitAsync notification delivery. |
| `enqueueTimeoutJob(job, realm, milliseconds)` | Schedule no earlier than the delay; currently Atomics.waitAsync deadlines. Calling a cancelled timeout once is harmless. |

Registration/enqueue snapshots contain current, entered, and incumbent realm
references plus opaque `hostDefinedOptions`. The addon does not interpret script
metadata. Make defaults to `{ callback, hostDefined: undefined }`, call to
`Reflect.apply`; either can be supplied independently.

Jobs take no arguments and must run asynchronously in the required order.
They retain the original V8 job and restore its saved continuation when called;
calling twice throws. A Promise job's creation realm identifies its queue even
when the specification realm is null. Returning `false` delegates immediately:
do not also schedule that job. Generic/timeout hooks cannot decline a job.

Make/enqueue callbacks must not throw: invalid records and exceptions reach
Node's uncaught-exception machinery. Call-hook exceptions follow the original
Promise or registry path. Private async-context state preserves application ALS;
recursive capture of the host's own work is suppressed. Pre-installation work
keeps its original callback path. Teardown clears native hooks/references.

[JS Engine](../src/js-engine/runtime.ts) translates references to registered realms.
[HTML](../src/browlet/scripting/host-hooks.ts) retains incumbent settings and owns
callback cleanup, microtask tasks, generic tasks, and active-time timeouts.
Ordinary Node Promise jobs remain on Node's queues. Unrelated Node/VM
Atomics.waitAsync is unsupported while HTML's generic/timeout hooks are installed.
Script records and restoration remain [engine/HTML work](../src/js-engine/ROADMAP.md).

When changing routing, verify unrelated Node progress and runner shutdown as well
as page results. Earlier ambient-owner routing captured runtime diagnostics and
prevented shutdown. Existing isolate Promise hooks and application ALS must keep
working; [host-hooks.test.cjs](test/host-hooks.test.cjs) uses fresh workers to test
independent installations.

## Build and run

Copy [.env.example](../.env.example) to `.env` and select the runtime:

```ini
NODE_BASE=24.19.0
NODE_RUNTIME=compat
# Required only for the custom base:
# CUSTOM_NODE_SOURCE=C:/path/to/node
```

`NODE_BASE` accepts `24.19.0`, `26.8.1`, or `custom`. `NODE_RUNTIME=compat`
loads the matching addon; `stock` disables it. Shell settings override `.env`,
and explicit command options override both. The defaults are `24.19.0/compat`.

The launcher uses the selected cached official runtime or configured custom executable.

```sh
npm run install:node -- --base 24.19.0
npm run build:node-compat -- --base 24.19.0
npm run test:unit
npm run test:node-compat
# Run a focused suite:
node scripts/with-node.mjs vitest run --project=unit test/js-engine
```

The [installer](../scripts/install-node.mjs) downloads official runtimes and
headers, plus import libraries on Windows. It verifies pinned hashes and reuses
the cache on Windows and Linux x64.
Building the addon requires:

- **Windows x64:** Visual Studio's Desktop development with C++ workload. Standalone
  Build Tools is sufficient. The build uses an x64 developer prompt, `VSINSTALLDIR`,
  or `vswhere`.
- **Linux x64:** A C++20 compiler such as GCC or Clang. The build uses `c++` by
  default; set `CXX` to select another compiler executable.

For stock mode, omit the addon build and select `NODE_RUNTIME=stock`.

For `custom`, first [build Node](../BUILDING.md#v8-patches) in `CUSTOM_NODE_SOURCE`, then run
`npm run build:node-compat -- --base custom`. Rebuild the addon after an engine
rebuild, even when the reported Node version is unchanged.

Each base has its own `addon/build/<base>/node-compat.node` and `node.json`.
The loader checks version, ABI, platform, and architecture; those checks cannot
prove a custom executable matches its current source. Missing inputs fail
explicitly instead of selecting another base. `addon/build/compile_commands.json`
tracks the most recent addon build for editor tooling.

The [launcher](../scripts/with-node.mjs) reports the selected executable/addon,
sets subprocess PATH and `BROWLET_NODE_ADDON`, checks compatibility, and preserves
exit status. Unit, artifact, WPT, oracle, and performance commands use it.
Playwright's browser engines are independent of its Node host.

## Runtime test matrix

Three bases, each with the addon disabled or enabled, give six configurations.
Package test commands run **one selected configuration**; `test:all` does not
sweep this matrix.

CI covers both official versions on Windows and Linux, with stock and compat unit
and artifact tests plus native addon tests. Custom Node/V8 builds are tested locally.

| Base | `stock` | `compat` |
| --- | --- | --- |
| `24.19.0` | Official Node fallback paths | Native queues/globals; older Promise-observation limit |
| `26.8.1` | Official Node fallback paths | Native queues/globals and newer Promise observation |
| `custom` | Patched engine without the addon bridge | Native integration plus available V8 extensions |

`custom/stock` still contains engine patches. It does not connect addon-mediated
hooks to Browlet. Check capabilities individually: a custom build can be stale
or lack a patch, and explicit queues do not imply job-hook support.

For changes to realm ownership, scheduling, native capabilities, or fallback
behavior, run the affected suites in all six configurations. Use the full unit
suite for broad integration changes. Documentation and pure algorithms do not
need a matrix sweep. Run type contracts once, then repeat the launcher command
with each base/runtime pair; append paths for focused checks:

```powershell
npm run test:types
node scripts/with-node.mjs --base custom --runtime compat vitest run --project=unit
```

Addon changes also need the native suite on each supported base:

```powershell
node scripts/with-node.mjs --base custom --runtime compat node --expose-gc --experimental-vm-modules --test "node-compat/test/*.cjs"
```

Custom Node builds compile the patched V8 engine, which the native addon tests
exercise. V8's own `deps/v8/test/cctest` suite is separate from Node's `cctest`
executable and uses a GN/Ninja build with `depot_tools`; Node provides
`tools/make-v8.sh` and `tools/test-v8.bat` for that setup.

Capability-dependent tests use `itPassesWith(...)` from
[`test/test-runtime.ts`](../test/test-runtime.ts), or its small `node:test`
counterpart in [`test/support/test-runtime.cjs`](test/support/test-runtime.cjs).
Both execute the required assertions on unsupported paths as approved expected
failures; unexpected passes fail the run and require review. The native helper
labels these cases `[expected failure]` because `node:test` has no strict
expected-failure mode. Do not use capability-based skips or local replacements
for this policy.

Compat preflight independently requires the addon's baseline operations, so a
missing required export cannot silently turn its tests into expected failures.
Exposure assertions use the selected runtime's contract, rather than copying
the implementation's capability flag. Engine-patch capabilities remain optional
and are checked individually. Ordinary asynchronous completion remains required
on every backend.
