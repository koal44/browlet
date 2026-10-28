# Node compatibility

Browlet uses this native addon to control microtask checkpoints, identify the
realm of an object, and preserve the global proxy across navigation. HTML owns
the scheduling and browser policy applied through those engine facilities.

Stock Node runs through JS Engine's fallback paths. On supported official Node
builds, the addon supplies explicit queues, native contexts and globals, realm
lookup, Promise observation, and rejection tracking. The [V8 patch set](../vendor/_patches/node-v8.patch)
adds callback/job hooks, native collection iterators, and further object, iterator,
and buffer-view inspection. The single patch snapshots the complete `v8-patches`
branch, including the Temporal clock hook and Node's code-generation, import.meta,
and dynamic-import forwarding exports. Some facilities still await addon/HTML
integration. It includes engine regressions and records its upstream Node revision.
[Known limitations](../src/LIMITATIONS.md) describes
the observable constraints of each runtime.

## Code and regressions

| Area | Implementation and evidence |
| --- | --- |
| Contexts, globals, and microtask queues | [vm.cc](addon/vm.cc), [JavaScript adapters](addon/vm.cjs); [queue tests](test/capabilities.test.cjs), [browser global tests](../test/browlet/browsing/native-global.test.ts) |
| Retained classic scripts | [vm.cc](addon/vm.cc), [JavaScript adapters](addon/vm.cjs); [compilation, execution, and lifetime tests](test/retained-scripts.test.cjs) |
| Source-text and synthetic modules | [vm-modules.cc](addon/vm-modules.cc), [module classes](addon/vm-modules.cjs); [Node API comparisons](test/vm-api.test.cjs), [native linking and lifetime tests](test/modules.test.cjs) |
| Dynamic-import callbacks | [vm-imports.cc](addon/vm-imports.cc), [loader registration](addon/vm-imports.cjs); [routing, queue, and lifetime tests](test/dynamic-import.test.cjs) |
| Realm identity and lookup | [realm.cc](addon/realm.cc); [realm tests](test/capabilities.test.cjs) |
| Promise observation | [promise.cc](addon/promise.cc); [Promise tests](test/capabilities.test.cjs) |
| Promise rejection tracking and slot reads | [promise.cc](addon/promise.cc); [native lifecycle/Node forwarding tests](test/promise-rejections.test.cjs), [HTML event integration](../test/browlet/scripting/promise-rejection-integration.test.ts) |
| Callback and job hooks | [host-hooks.cc](addon/host-hooks.cc), [JavaScript adapter](addon/host-hooks.cjs); [native hook tests](test/host-hooks.test.cjs), [HTML Promise jobs](../test/browlet/scripting/promise-jobs.test.ts) |
| Temporal context clock | [temporal.cc](addon/temporal.cc); [clock, lifetime, and contract tests](test/temporal.test.cjs) |
| Native property interception | [property-delegate.cc](addon/property-delegate.cc), [JavaScript adapters](addon/property-delegate.cjs); [property tests](test/html-dda.test.cjs) |
| Native value inspection and iteration | [iterators.cc](addon/iterators.cc), [array-buffer.cc](addon/array-buffer.cc); [iterator predicates](test/iterator-predicates.test.cjs), [buffer views](test/array-buffer.test.cjs), [collection iterators](test/collection-iterator.test.cjs) |
| Object-brand predicates | [object-types.cc](addon/object-types.cc); [brand tests](test/object-types.test.cjs) |
| Callable, undetectable objects | [html-all-collection.cc](addon/html-all-collection.cc); [native object tests](test/html-dda.test.cjs) |

[addon.cc](addon/addon.cc) registers the native modules;
[index.cjs](addon/index.cjs) loads the binary and assembles the JavaScript API.
Context and queue handles retain their shared lifetime owner in `vm.cc`.
Factories that allocate in a context use `GetContext()` with the opaque callback
data returned by `InitializeVm()`; they do not access the handle's stored state.
`vm-modules.cc` owns its module branding and templates separately, retaining only
that opaque VM data for context lookup.

The [native addon suite](test/) also covers lifetime, garbage collection, and runtime selection.

## Contexts, globals, and optional facilities

`setPromiseRejectionTracker(context, tracker)` installs a synchronous
`tracker(promise, operation)` for code executing in that context; operation is
`'reject'` or `'handle'`. Passing undefined clears it. `isPromiseHandled()` and
`getPromiseResult()` read native slots without reactions or author property access;
the result query rejects pending promises. These are baseline addon operations
on all three bases, independent of the patched job hooks.

The context retains its callback through GC-traced state. Reusing a global proxy
does not move the callback to the replacement context. Node's default handler
receives unregistered-context notifications and matching late-handler updates
across the Node/Browlet boundary. Cleanup restores Node's handler. Independently
replacing the same isolate callback with another addon is unsupported: V8 has
no getter for a previous replacement. Tracker callbacks must not throw; failures
use Node's fatal-exception reporting. HTML owns muting, notification timing,
event dispatch, and console reporting.

`createMicrotaskQueue()` supplies enqueue/checkpoint operations.
`createContextHandle()` creates a native V8 context registered with Node;
`runInContext()` evaluates there. These are not `node:vm` Contextify objects.
The supported options are queue selection, `reuseGlobalProxyFrom`,
`globalPrototypeChain`, and `importModuleDynamically`; evaluation accepts filename,
lineOffset, and `displayErrors: false`, plus the optional import callback described below.
Unsupported options fail explicitly. Interoperability with Node's own contextified objects, timeouts, and automatic afterEvaluate
checkpoints remain outside this API.

The addon exports a supported subset of Node's VM object API:

| API | Contract |
| --- | --- |
| `new Script(source, { filename, lineOffset, displayErrors: false, importModuleDynamically })` | Compiles without a context or execution; `.runInContext(handle)` binds the retained code to an existing context. Compilation errors originate in the host realm; HTML realizes them in its selected realm. The optional import callback requires the forwarding export below. |
| `new SourceTextModule(source, { context, identifier, lineOffset, importModuleDynamically, initializeImportMeta })` | Compiles in the supplied addon context. `.moduleRequests` exposes frozen requests with specifiers, attribute records, and phases. The optional callbacks require their respective Node forwarding exports below. |
| `source.linkRequests(dependencies)`; `source.instantiate()` | Supply dependencies in request order for each source module, then instantiate from the root. Instantiation links the graph without running it. |
| `new SyntheticModule(names, callback, { context, identifier })` | Creates an already instantiated module, like current Node. Evaluation calls the callback with `this.setExport(name, value)` available; exports retain identity and remain mutable. The callback's return value is ignored. |
| `module.evaluate()` | Returns the engine's completion Promise without a checkpoint. Admission errors instead reject a host Promise, as Node does. |
| `module.context`, `.identifier`, `.status`, `.error`, `.namespace` | Expose the retained context and current engine state. Namespace exports are live bindings; `.error` requires an errored module. |

These classes use addon context handles, not Node's private Contextify state.
JS Engine selects Node's classes for stock contexts and the addon classes for
addon contexts. The public free-function compile/link/evaluate handle API is
replaced; those operations remain private native implementation details.
Module loading remains the host's responsibility. HTML's default-export helper
uses `SyntheticModule`; the addon itself supports arbitrary named exports.

This is not the complete `node:vm` API. Modules require an explicit context;
async `link(linker)`, cached data, timeouts, column offsets,
and display-error annotation remain unsupported. Unknown options are rejected.
The public linker accepts evaluation-phase modules and source-phase
WebAssemblyModule dependencies. No operation performs
an automatic checkpoint. GC-traced fields retain module/context state without
per-module native roots, and evaluation releases synthetic callbacks.

Static modules require no Node/V8 patch. Stock JS Engine uses Node's VM module
API and requires `--experimental-vm-modules` plus its synchronous linking API
(present on all supported runtime bases). Unit tests enable that flag; addon
modules themselves do not need it. HTML dependency fetching, import.meta,
`HostLoadImportedModule`, and connecting HTML's Wasm parser remain separate work. The
[promoted module tests](test/modules.test.cjs) preserve Pip's lifetime and engine
behavior cases through the private bridge. The synthetic evaluation callback
retains its handle until assigning the export; the lifetime test checks collection
after that callback. [Public API tests](test/vm-api.test.cjs) cover the matching
Node call path, callback collection, and live exports. Remaining probes stay in
`experimental/module-records/`.

### WebAssembly modules

`new WebAssemblyModule(bytes, { context, identifier })` is an addon extension:
Node does not expose a corresponding public VM class. It shares the Module
lifecycle and `moduleRequests`, `linkRequests(dependencies)`, `instantiate()`,
`evaluate()`, and namespace access with SourceTextModule. The host supplies
dependencies; it does not use Node's filesystem/package loader.

```js
const wasm = new compat.WebAssemblyModule(bytes, { context, identifier: 'answer.wasm' });
const root = new compat.SourceTextModule(
  'import { answer } from "./answer.wasm"; export default answer();', { context });
wasm.linkRequests([]);
root.linkRequests([wasm]);
root.instantiate();
const completion = root.evaluate();
queue.runMicrotasks(); // The host owns the checkpoint, as for other modules.
```

Compilation retains a realm-owned `WebAssembly.Module` in `.source`. `.instance`
is undefined until evaluation instantiates Wasm; compilation and linking never
run its start function. A source-phase dependency takes the same WebAssemblyModule
object but returns only its compiled source, without linking or executing its
dependencies. `.moduleRequests` includes only the Wasm imports, with empty
attributes and evaluation phase. The internal instantiation helper is hidden.

The implementation captures Wasm constructors and accessors at context creation,
before author code can replace them. It generates a source-text module and a
private synthetic leaf; V8 supplies ordering, cycles, top-level await, linking
errors, and the evaluation Promise. Direct Wasm-to-Wasm imports retain original
global, memory, and table identities. The source uses the draft's string builtin
compile options and rejects reserved names. All retained state is GC-traced;
there are no new native roots, isolate callbacks, or engine patches for static
Wasm graphs. `vm-wasm.cjs` owns the translation, while `vm-modules.cjs` owns the
public module identity and linking.

Three requirements from the [ESM integration draft](https://webassembly.github.io/esm-integration/js-api/index.html#execute-module)
remain approved expected failures:

| Requirement | Current limitation |
| --- | --- |
| Mutable globals stay live in JavaScript bindings | The JavaScript export keeps its initial value after Wasm changes the global. |
| `v128` exports stay uninitialized | Reading the export returns undefined instead of throwing ReferenceError. Other exports work. |
| Mutable globals re-exported through JavaScript retain their Wasm binding | A consuming Wasm module receives the JavaScript value and fails with LinkError. Direct Wasm imports work. |

[Wasm regressions](test/wasm.test.cjs) exercise ordinary functionality and lifetime.
[Gap tests](test/wasm-gaps.test.cjs) preserve the required behavior and reject
unexpected passes. The [Node-only controls](test/wasm-node-gaps.test.cjs) reproduce
the same three failures without loading the addon. No binding emulation or
additional V8 patch is proposed for these gaps. Deferred imports,
`import(moduleObject)`, module-source reflection, and `WebAssembly.namespaceInstance()`
remain outside this slice. JS Engine/HTML's Wasm parser and automatic loading
are still explicit dependencies, ready to consume this bridge during integration.

### Dynamic imports

With the Node forwarding export in the [combined patch](../vendor/_patches/node-v8.patch),
`Script`, `SourceTextModule`, `runInContext()`, and `createContextHandle()` accept Node's
`importModuleDynamically(specifier, referrer, attributes, phase)` option.
The referrer is the public Script, SourceTextModule, or context handle for its
respective callback. Attributes are a null-prototype record, and the supported
phases are `'evaluation'` and `'source'`.
For evaluation, the callback returns a Module or module namespace, optionally
through a Promise.
For source imports it returns a WebAssemblyModule, optionally through a Promise;
the bridge returns that module's retained `.source` without instantiating it.
The host owns resolution, loading, linking, and waiting for evaluation, including
top-level await. Returning a Module does not evaluate it automatically.

The import Promise belongs to the executing context. Callback exceptions and
rejections retain identity; asynchronous result conversion uses that context's
queue. The addon never checkpoints it. Compilation metadata or context state and
a weak association keep the callback and public referrer alive while code can still import; otherwise
their cycles are collectible. This deliberately retains the public referrer to
satisfy Node's callback contract, unlike the experimental raw-handle API.

An explicit script/module callback takes precedence. When compilation metadata
is absent, the importing context supplies its fallback callback, including for
indirect eval invoked by a Promise reaction. Foreign metadata remains Node's
responsibility, even when the generated code executes in an addon context.
The fallback belongs to the context, so reusing its global proxy neither copies
the old callback nor changes the loader of retained functions from the old realm.

The addon forwards unrelated Node/VM requests to Node and restores its handler at
environment cleanup. Another addon's competing replacement of the isolate-wide
callback is unsupported. Official Node 24/26 do not export the forwarding handler,
so supplying the option there fails explicitly; the integration tests remain
approved expected failures. The build checks headers for the export, independently
of the job-hook patches. Ordinary Node VM import callbacks still work there.

The regression for identical `Function` bodies finds the first script's loader
reused on Node 26 and custom Node, including through Node's own VM API. Node 24
passes its control. Disabling V8's compilation cache makes both custom paths pass;
production retains caching and the regression is an approved expected failure.
Direct and indirect eval routing pass. Source and deferred phases and HTML
loading integration remain unfinished.

### import.meta initialization

`SourceTextModule` accepts Node's `initializeImportMeta(meta, module)` constructor
option. V8 creates a null-prototype object on first access and caches it after
successful initialization. The callback receives the public module object;
its return value is ignored. Thrown values retain identity, and a later access
retries initialization with a fresh object. No checkpoint is performed.
Without an initializer, addon modules receive an empty object. The addon does
not supply HTML's `url` or `resolve`; those belong to the later host-hook audit.

After graph instantiation, each module's namespace privately retains its
initializer and public referrer. Exported functions can therefore initialize
metadata after the host drops its module reference. Discarded cycles collect
without native persistent roots. Initialization runs the supplied callback as
an ordinary function, so objects it creates belong to that function's realm.

The isolate callback forwards unrelated modules to
`node::HostInitializeImportMetaObjectCallback`, preserving Node file/data metadata
and VM initializers, and restores Node's callback at environment cleanup.
Another addon's competing callback replacement is unsupported. The forwarding
export is already in the [combined patch](../vendor/_patches/node-v8.patch);
the build detects it independently of dynamic imports. Official Node 24/26 lack
it and reject the option explicitly. Their initializer cases are approved
expected failures; ordinary modules and Node's own metadata checks pass.

The [regressions](test/import-meta.test.cjs) cover lazy identity, cyclic graphs,
realm ownership, retry and rejection, nested Node entry, dynamic-import
coexistence, callback lifetime, collection, and worker teardown.

### String compilation and source extraction

`setModifyCodeGenerationFromStringsCallback(realmReference, callback)` registers
one callback for an existing context. Pass `context.realm` for an addon context,
or `getRealm(object)` for an object from a Node VM context. The callback receives
V8's `(source, isCodeLike)` inputs: a string result supplies replacement source,
`false` blocks compilation, and `undefined` delegates unchanged. Other results
throw TypeError. This combines the engine interception needed by
`HostEnsureCanCompileStrings` and `HostGetCodeForEval`; it is not their complete
HTML contract. HTML policy and actual TrustedScript recognition remain deferred.

Registration forces cached and uncached eval/Function compilation through the
callback. Ordinary Script/module compilation is unaffected. Allowed or extracted
source still goes through Node's permission and generated-source-map handling;
the callback cannot override a Node context's disabled-code policy. Native eval
retains direct lexical scope, and ordinary objects remain unchanged when the
host supplies no source. V8 can consult the callback more than once for an object.

Registering again replaces the callback. Passing `undefined` removes it and
restores the context's original V8 string-compilation flag. Private context state
retains callbacks without native roots, survives retained functions, and stays
with the original context when its global proxy is reused. Context/callback
cycles collect. Unregistered contexts delegate to Node, and environment cleanup
restores Node's isolate callback. Competing addon callback replacement is unsupported.

This facility requires the Node `ModifyCodeGenerationFromStrings` forwarding
export already in the combined patch. The build checks it independently; the
setter is unavailable on official Node 24/26. Their functional cases are approved
expected failures. The [functional suite](test/code-generation.test.cjs) covers
scope, permissions, source maps, exceptions, reentrancy, replacement/removal,
collection, proxy reuse, queues, and teardown. The [gap suite](test/code-generation-gaps.test.cjs)
retains four approved expected failures even on custom Node:

- Distinguishing eval from Function when their source text is identical.
- Recovering original Function parameter boundaries.
- Recognizing original TrustedScript Function arguments after stringification.
- Rejecting the implicit untrusted empty body of `Function()` despite its CodeLike flag.

No native TrustedScript branding or additional engine patches are introduced.

### Temporal clock

`setTemporalHostSystemUTCEpochNanosecondsCallback(realmReference, callback)` installs
one internal clock for a context. Pass `context.realm`, or `getRealm(object)` for
an object from a Node VM context. The callback receives no arguments and returns
Unix-epoch nanoseconds as a signed 64-bit `bigint`. Registering again replaces it;
passing `undefined` removes it and restores V8's platform clock for that context.
Other contexts and Date clocks are unaffected. Native Temporal methods retain
their identity and use their own realm's clock when borrowed.

The callback is synchronous and **must not throw**. V8's native API returns
`int64_t` without an exception result. Chromium's native callbacks read and coarsen
time after selecting precision during context initialization; Firefox reads its
native Date clock, and WebKit reads its native nanosecond clock. These paths do
not invoke author JavaScript. Browser sources:
[Chromium](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_initializer.cc),
[Firefox](https://searchfox.org/mozilla-central/source/js/src/builtin/temporal/TemporalNow.cpp),
[WebKit](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/ISO8601.cpp).

The [experimental probe](experimental/temporal-callback/README.md) demonstrates
why returning a placeholder timestamp after a JavaScript exception is unsafe:
author code can continue past the Temporal call. The maintained bridge treats
a thrown exception, a non-bigint result, or an out-of-range result as a fatal
internal contract violation and terminates the process. It does not promise an
author-catchable clock exception or substitute an uncoarsened timestamp.
Invalid registration arguments still throw ordinary TypeErrors.

Private context state retains callbacks without native roots and stays with the
original context across global-proxy reuse. Replacement/removal releases the old
callback; discarded context/callback cycles collect. The
[regressions](test/temporal.test.cjs) cover these lifetimes, signed endpoints,
all Temporal.Now clock readers, explicit queues, and worker teardown.

The build detects V8's context setter, already present in the combined patch.
Official Node 24/26 headers lack it, and Node 24 leaves Temporal disabled by
default. Their clock tests remain approved expected failures. HTML's
`HostSystemUTCEpochNanoseconds` hookup,
environment precision selection, and millisecond-to-nanosecond conversion remain
for the host-hook audit. Resolve policy prerequisites before installing an
infallible clock; recheck that ownership after navigation work is integrated.

### Context lifetime

A handle separates its stable realm reference from its reusable global proxy.
Detachment allows that proxy to transfer once to a fresh context. Retaining the
realm reference keeps the old realm alive; `.global` is not its identity.
`getRealm(object)` reports creation context, while `getFunctionRealm(callable)`
follows bound/proxy targets without traps and rejects revoked callable proxies.

`SPEC_CLASH(detached-context-promise-assimilation)`: follow Chromium and Firefox:
host `await`/`Promise.resolve()` can remain pending for Promises from a detached
context. V8 clears the old context's microtask queue; direct observation through
a host callback and work in the replacement context still run. WebKit instead
resolves the adopted Promises. This is an ordinary passing lifecycle regression
on all addon bases, not an expected failure. See the
[browser evidence](../src/js-engine/ROADMAP.md#detached-context-promise-delivery).

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
| `cloneSharedArrayBuffer(buffer, context)` | Allocates a new buffer object in the destination context over the existing shared backing store, preserving growth. Uses public V8 APIs; no engine patch is needed. |
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
