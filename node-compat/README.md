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
| Realm-owned function bodies | [vm.cc](addon/vm.cc), [JavaScript adapter](addon/vm.cjs); [scope, identity, import, and lifetime tests](test/function-compilation.test.cjs) |
| Source-text and synthetic modules | [vm-modules.cc](addon/vm-modules.cc), [module classes](addon/vm-modules.cjs); [Node API comparisons](test/vm-api.test.cjs), [native linking and lifetime tests](test/modules.test.cjs) |
| Dynamic-import callbacks | [vm-imports.cc](addon/vm-imports.cc), [loader registration](addon/vm-imports.cjs); [routing, queue, and lifetime tests](test/dynamic-import.test.cjs) |
| Realm identity and lookup | [realm.cc](addon/realm.cc); [realm tests](test/capabilities.test.cjs) |
| Promise observation | [promise.cc](addon/promise.cc); [Promise tests](test/capabilities.test.cjs) |
| Promise rejection tracking and slot reads | [promise.cc](addon/promise.cc); [native lifecycle/Node forwarding tests](test/promise-rejections.test.cjs), [HTML event integration](../test/browlet/scripting/promise-rejection-integration.test.ts) |
| Callback and job hooks | [host-hooks.cc](addon/host-hooks.cc), [JavaScript adapter](addon/host-hooks.cjs); [native hook tests](test/host-hooks.test.cjs), [HTML Promise jobs](../test/browlet/scripting/promise-jobs.test.ts) |
| Temporal context clock | [temporal.cc](addon/temporal.cc); [clock, lifetime, and contract tests](test/temporal.test.cjs) |
| Native property interception | [property-delegate.cc](addon/property-delegate.cc), [JavaScript adapters](addon/property-delegate.cjs); [property tests](test/html-dda.test.cjs) |
| Realm-selected exotic objects | [exotic-object.cc](addon/exotic-object.cc); [caller, descriptors, receiver, and lifetime tests](test/exotic-object.test.cjs), [Location integration](../test/browlet/browsing/window/location-exotic.test.ts) |
| Native value inspection and iteration | [iterators.cc](addon/iterators.cc), [array-buffer.cc](addon/array-buffer.cc); [iterator predicates](test/iterator-predicates.test.cjs), [buffer views](test/array-buffer.test.cjs), [collection iterators](test/collection-iterator.test.cjs) |
| Object-brand predicates | [object-types.cc](addon/object-types.cc); [brand tests](test/object-types.test.cjs), [Wasm Global tests](test/wasm-global-type.test.cjs) |
| Callable, undetectable objects | [html-all-collection.cc](addon/html-all-collection.cc); [native object tests](test/html-dda.test.cjs) |
| Thread suspension | [threads.cc](addon/threads.cc); [real-isolate execution and shutdown tests](../test/js-engine/thread-suspension.test.ts) |

[addon.cc](addon/addon.cc) registers the native modules;
[index.cjs](addon/index.cjs) loads the binary and assembles the JavaScript API.
Context and queue handles retain their shared lifetime owner in `vm.cc`.
Factories that allocate in a context use `GetContext()` with the opaque callback
data returned by `InitializeVm()`; they do not access the handle's stored state.
`vm-modules.cc` owns its module branding and templates separately, retaining only
that opaque VM data for context lookup.

The [native addon suite](test/) also covers lifetime, garbage collection, and runtime selection.

## Contexts, globals, and optional facilities

`createThreadControl()` allocates an outside-owned token before Node starts a
worker. The matching child calls `attachThreadControl()` once. `suspendThread()`
requests a public V8 interrupt whose native wait retains the executing stack;
`resumeThread()` wakes it without requiring a worker message callback.
`isThreadSuspended()` reports entry into the wait, and `releaseThreadControl()`
retires the outside ownership after exit or failed construction.
The attached isolate can call `preventThreadSuspension()` before closing to
disable pending and future suspension permanently. It shares the registry lock
with outside requests, so this transition cannot race a late suspension.
`getThreadElapsedTime()` reads a private monotonic clock from inside the attached
isolate. It excludes accepted suspension periods from request through resume,
including an idle isolate's pending interrupt. Repeated requests do not reset
the start, and ignored requests after closing do not stop time. It samples the
clock and accumulated suspension under one lock; author performance time is
unrelated. HTML supplies this clock to its existing timer scheduler.

`stopThread()` sets V8 termination before waking the wait, including controlled
descendants. JS Engine calls it before Node's `Worker.terminate()` and during an
owner's JavaScript exit event, since Node joins children before native cleanup
hooks. Registry access and isolate teardown share a lock; tokens are not reused.
The wait runs no JavaScript and also blocks private host messages. Raw Node
termination cannot release it; a foreign native owner must coordinate shutdown
through these controls. HTML owns task admission, eligibility, and timer
accounting separately. This uses public APIs on all three supported
addon bases, with no Node/V8 patch or private-layout access.

`compileFunction(body, parameters, options)` follows Node's function-compilation
shape, with `parsingContext` required to be an attached addon context handle.
Supported options are `contextExtensions`, `filename`, `lineOffset`,
`columnOffset`, and `importModuleDynamically`. The additional `name` option sets
the retained function source name, without a named-expression self binding.
Cached data and other options are rejected. Compilation does not execute the
body, apply eval policy, or run a checkpoint. Public V8 APIs supply this on all
three bases; no Node/V8 patch was added.

V8 rejects JavaScript Proxy scope extensions. For these scopes, the addon uses a
validated declaration inside actual `with` environments, captures the function,
and deletes its temporary declaration binding. This preserves exact named source
and live lookup without a named-expression self binding. Nonempty names on this
path must be valid declaration identifiers. A private native entry uses the
realm's retained pristine eval intrinsic and restores the string-compilation
allowance after the trusted factory returns or throws. Author bodies and Proxy
traps do not run during compilation; later calls use the cached function directly.
Proxy-scoped functions without explicit import loaders share a compilation
identity, allowing V8 to reuse identical compiler factories without retaining
individual functions. Each returned function keeps its own scopes and realm.
Explicit loaders retain separate registrations. The captured scope owns that
registration so V8's eval cache cannot retain
discarded functions, loader callbacks, or contexts through the metadata registry.
The result converter remains available until pending imports complete, even when
their originating function has already been collected.

Compilation metadata identifies these functions as having no HTML ScriptOrModule.
An explicit import loader receives the compiled function as its referrer; absent
that loader, imports use the context fallback. As for the other VM operations,
imports require the already maintained forwarding export on the custom build.

`setPromiseRejectionTracker(context, tracker)` installs a synchronous
`tracker(promise, operation, compiledCode)` for code executing in that context;
operation is `'reject'` or `'handle'`. Compiled code is the retained Script or
SourceTextModule, `undefined` without metadata, or `null` for unrecognized code.
Passing undefined as the tracker clears it. `isPromiseHandled()` and
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

`isWebAssemblyModule()` uses V8's existing type predicate on all three bases,
without enumerating exports or running author code. It requires no engine patch.

`isWebAssemblyGlobal()` also works on all three addon bases, without reading the
Global's value or invoking author code. It uses V8's private instance-type
helpers and a type tag sampled in a fresh context. The hack, version dependency,
and alternatives are documented beside the implementation in `object-types.cc`.
Without the addon, JS Engine uses the public Wasm import/re-export probe described
in `built-in-primitives.ts`. Both paths support the Global Binding adapter.

`createMicrotaskQueue(requestCheckpoint?)` supplies enqueue/checkpoint operations.
The optional internal callback requests a deferred checkpoint after an outer
engine call completes in a context using that queue, including native registry
cleanup, or when a Promise owned by that context settles. The latter covers
internal Atomics completions and resolvers called from Node. Notifications
coalesce until `runMicrotasks()` finishes; the callback must not drain jobs or
run author code, since settlement notification precedes reaction enqueueing.
Unregistered and detached contexts do not notify it.
The registration follows the queue's lifetime, and context/callback cycles remain
collectable. This is a conservative completion signal, not notification of every
job arrival: a Node-owned Promise can enqueue a Window callback without settling
a Window Promise. Such raw handoffs remain outside the supported automation bridge.
JS Engine omits it when installed native Promise-job hooks already wake HTML.

The first observed queue installs one observer through Node's public
[`promiseHooks.onSettled()`](https://nodejs.org/api/v8.html#promisehooksonsettledsettled)
multiplexer. It coexists with application/Node hooks rather than replacing them.
Node retains the observer for its environment's lifetime; it owns no queues and
ignores unregistered Promise owners. Registration uses existing Node APIs, with
no `.then()` observation, Promise/Atomics replacement, or polling timer. This supplies
ordinary completion progress on official addon bases; HTML generic/timeout task
ownership and active-time waiting still require the custom enqueue hooks.

The observer first makes a non-mutating native metadata query: does this Promise's
queue need a checkpoint notification? The query must never invoke JavaScript or
throw. Older V8 can nevertheless surface a pending module exception at that native
return, so the adapter catches it and retries the same query once. A second failure
propagates. The actual notification and its callbacks stay outside that catch.
Already-requested or running checkpoints need no second native call. This keeps
notification synchronous without retained settlement batches or scheduling Promises.
The workaround is isolated in `RegisterModuleSettlementWorkaround` in `vm.cc`
and `observeSettlementsWithModuleWorkaround` in `vm.cjs`, linked to the same
upstream fix. Remove those paired pieces when all supported engines include it;
the ordinary checkpoint notification logic remains independent of the workaround.

The custom engine also carries the
[upstream V8 module-evaluation fix](https://github.com/v8/v8/commit/1cdea338fd59d4700b1b311feb76e6a57c679844)
described in [BUILDING.md](../BUILDING.md#v8-patches). Without it, a native call
inside a Promise settlement hook can report a module's evaluation failure twice.
The failure reproduces on official Node 26.8.1 with public Node APIs and no addon;
the query guard prevents this observer from exposing it. The maintained engine
patch includes a Node regression. An unrelated hook that throws before our observer
can still have its exception misreported as the module error on official Node 26;
bare Node reproduces that limitation. This workaround does not repair other hooks.
Maintained addon regressions cover Node/addon module rejection identities, nested
Promise creation, genuine callback/hook errors, timeout termination, native tracing,
and synchronous/coalesced queue wakeups on every supported addon base.

`createContextHandle()` creates a native V8 context registered with Node;
`runInContext()` evaluates there. These are not `node:vm` Contextify objects.
The supported options are queue selection, `reuseGlobalProxyFrom`,
`globalPrototypeChain`, `globalAccess`, and `importModuleDynamically`; evaluation accepts filename,
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
modules themselves do not need it. Automatic HTML dependency loading,
`HostLoadImportedModule`, and connecting HTML's Wasm parser remain separate work. The
[promoted module tests](test/modules.test.cjs) preserve Pip's lifetime and engine
behavior cases through the private bridge. The synthetic evaluation callback
retains its handle until assigning the export; the lifetime test checks collection
after that callback. [Public API tests](test/vm-api.test.cjs) cover the matching
Node call path, callback collection, and live exports. Remaining probes stay in
`experimental/module-records/`.

### WebAssembly Module cloning

`cloneWebAssemblyModule(module, context)` creates a fresh Module in an attached
destination context through public V8 `GetCompiledModule()` / `FromCompiledModule()`.
It shares compiled code and preserves compile options, without consulting author
properties, invoking a constructor, or reapplying compilation policy. It rejects
non-Modules, proxies, and unusable contexts. HTML owns storage and agent-cluster
restrictions; this primitive does not enforce browser policy.

[The cloning tests](test/wasm-clone.test.cjs) verify native creation-realm identity,
ignored author properties, and invalid inputs/contexts. They also use the addon
as an ownership oracle for the public Node MessagePort path used in stock mode.

### Native WebAssembly completion

`setWasmAsyncCompletionCallback(context, schedule)` hands asynchronous native
Wasm Promise resolution to that context's host. `schedule(complete, promise)`
identifies the original native Promise so concurrent operations can select
different task sources without resolving or observing their results. It must not
throw; retain `complete` for the owning task, or discard it when delivery is no
longer appropriate. It resolves/rejects once, including synchronous `then` lookup,
without running a checkpoint. A detached context makes it inert. Passing
`undefined` removes the scheduler for future completions; already handed-off
completions remain owned by their queued task.

This uses V8's existing `SetWasmAsyncResolvePromiseCallback` on every supported
base, without a Node/V8 patch. HTML installs it through JS Engine and uses its
existing task/checkpoint machinery. Compilation, instance creation, and result
identity remain V8-owned. Registering it does not replace the Wasm author API.

The isolate-wide dispatcher preserves V8's default resolution for unregistered
contexts, including ordinary Node and VM code. V8 exposes no getter/reset for
this callback: another embedder's replacement cannot be chained. Addon reloads
share the dispatcher; final environment cleanup restores default behavior.
Callbacks and pending results have traced JavaScript ownership, with no native
registry retaining their contexts. [Tests](test/wasm-completion.test.cjs) cover
deferred success/error delivery, Promise identity, thenables, context separation, native defaults,
detachment, collection, and worker teardown.

### WebAssembly imported function conversion

`createWebAssemblyImportCall(module, importIndex, callback, instanceConstructor)`
returns a lazy callable that finishes native result conversion before returning.
The index follows native `Module.imports()`, including visible non-function imports.
JS Engine supplies the instantiating realm's captured Instance constructor;
HTML enters and exits the original callback's script/settings scope around the call.

[wasm-functions.cc](addon/wasm-functions.cc) uses public V8 APIs to copy a compiled
Module's bytes and compile generated import/re-export bridges. The narrow
[metadata reader](addon/wasm-functions.cjs) preserves the complete type section,
including recursive groups and indexed reference types. V8 still owns conversion
and type validation. A weak Module cache retains metadata and compiled bridges by
signature; each callback gets its own lazily instantiated bridge. That adds a Wasm
round trip. Callback identities and foreign realms are not retained by the cache.

The internal bridge compiler does not apply author byte-compilation policy to
an already compiled Module. It neither changes that policy nor enables reflection
flags or replaces engine callbacks. The constructor and exports accessor are
captured, and converted multi-value results use a private iterable so later
native conversion cannot invoke an author-replaced Array iterator after cleanup.

The reader handles standard function/struct/array types, subtypes, recursive
groups, references, and all five import kinds. Known unsupported proposal
encodings include shared-everything, descriptor, continuation, and string-view
types, plus exact-function imports. The corresponding V8 proposals are disabled
by default on all three supported bases. Extend the reader before enabling them
or adopting a runtime that enables them by default; this is not a prerequisite
for the next JS API section. Ordinary shared memories and memory64 already work.
Custom page-size limits are future compatibility work: the current V8 decoder
does not accept that encoding. This is a list of known limits, not a claim of
exhaustive proposal coverage. Unsupported encodings raise an error on first
adapted invocation rather than silently shortening the callback scope.
Stock mode has no Module-byte access and retains the documented result-scope gap.
See [native regression tests](test/wasm-functions.test.cjs) and
[HTML callback tests](../test/browlet/webassembly/exported-functions.test.ts).

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

The optional `getSource()` host callback supplies the object exposed by both
static and dynamic source imports. Browlet uses ordinary Binding projection of
its retained WasmModuleImpl, preserving platform identity and hiding the native
backing. Without the callback, imports return `.source` as before. The private
linker accepts source objects, while still rejecting evaluation handles; the
public linker continues to require WebAssemblyModule dependencies.

The optional `createInstance(module, imports)` host callback replaces only native
instantiation during evaluation and must return the native Instance. Compilation
and linking never invoke it; throws reject evaluation unchanged. Browlet uses it
to enter the exact HTML Wasm record and apply its existing imported-callback/result
conversion adapter. Without it, the bridge retains its captured native constructor.

The optional `getExports()` callback runs after instantiation and supplies the
public export object for JavaScript namespace bindings. Browlet uses it to project
Memory, Table, and Tag implementations. Direct Wasm dependencies keep the native
exports, and global bindings still follow the existing value-extraction rules and
documented limitations. Without this callback the bridge exposes native exports.

`getWebAssemblyNamespaceInstance(namespace)` retrieves that same native Instance
from an actual bridge-owned namespace. It returns `null` for other objects or
foreign namespaces, and `undefined` for a recognized record before an Instance
exists. Linking registers the association even when a parent subsequently fails;
no export inspection, Proxy traps, or additional instantiation occurs. A weak map
keeps the record alive while its namespace remains reachable. The browser binding
owns the corresponding TypeError and the provisional pre-execution ReferenceError.
This does not recognize namespaces created by Node's separate filesystem loader.

The implementation captures Wasm constructors and accessors at context creation,
before author code can replace them. It generates a source-text module and a
private synthetic leaf; V8 supplies ordering, cycles, top-level await, linking
errors, and the evaluation Promise. Direct Wasm-to-Wasm imports retain original
global, memory, and table identities. The source uses the draft's string builtin
compile options and rejects reserved names. All retained state is GC-traced;
there are no new native roots, isolate callbacks, or engine patches for static
Wasm graphs. `vm-wasm.cjs` owns the translation, while `vm-modules.cjs` owns the
public module identity and linking.

JavaScript re-exports now preserve the original Wasm Global on reviewed builds.
`vm-modules.cjs` retains the supplied dependency records after linking and assigns
one optional resolver from [vm-module-bindings.cjs](addon/vm-module-bindings.cjs).
That companion owns the capability check and graph search for a Wasm export with
the same resolved binding. Aliases, cycles, and star exports use V8's resolution;
equal values or `export const copy = input` do
not qualify. `vm-wasm.cjs` supplies the recovered native Global at instantiation,
including through Browlet's existing HTML adapter. There is no context-wide
registry, source parser, additional public API, or change to Node's own loader.
Removing that resolver assignment and its import restores namespace-value imports;
`vm-wasm.cjs` already handles an absent resolver. Replacing the private predicate
with a public engine API would leave the rest of the linker unchanged.

**HACK:** [vm-module-bindings.cc](addon/vm-module-bindings.cc) reads private
JSModuleNamespace, Module, and ObjectHashTable layouts to compare binding Cells.
It never reads or writes a Cell's value, retains a raw pointer, or runs author
code. The predicate is compiled only for reviewed header versions on Windows x64
without pointer compression, and additionally checks the actual V8 version when
loaded. The reviewed engines are:

| Node build | V8 version |
| --- | --- |
| 24.19.0 | 13.6.233.17-node.51 |
| 26.8.1 | 14.6.202.34-node.28 |
| Custom 27.0.0-pre | 14.6.202.34-node.29 |

There is no startup self-test. Unknown versions/build configurations omit the
predicate and keep the previous re-export limitation. These pins are not an ABI
guarantee: a custom change to those layouts without a version change can still
crash the process. Review the named V8 source layouts and rerun the regressions
before extending the guard. A public binding-identity API could replace the
private reads. Lookup currently scans candidate exports and their export tables;
large-graph performance has not been established.

Two requirements from the [ESM integration draft](https://webassembly.github.io/esm-integration/js-api/index.html#execute-module)
remain approved expected failures on every addon base:

| Requirement | Current limitation |
| --- | --- |
| Mutable globals stay live in JavaScript bindings | The JavaScript export keeps its initial value after Wasm changes the global. |
| `v128` exports stay uninitialized | Reading the export returns undefined instead of throwing ReferenceError. Other exports work. |

[Wasm regressions](test/wasm.test.cjs) exercise ordinary functionality and lifetime;
[re-export regressions](test/wasm-reexports.test.cjs) cover identity, prelinked
graphs, garbage collection, invalid inputs, workers, and the disabled fallback.
[Gap tests](test/wasm-gaps.test.cjs) preserve the required behavior and reject
unexpected passes; the re-export assertion is an ordinary passing test on reviewed
builds and remains an expected failure elsewhere. The [Node-only controls](test/wasm-node-gaps.test.cjs)
still reproduce all three original failures in Node's independent loader.
No Node/V8 patch is needed for this change. HTML parsing, URL loading, source
imports, module-source reflection, and `WebAssembly.namespaceInstance()` are
connected. Deferred imports and object-valued `import(moduleObject)` remain
explicitly deferred in the [Wasm roadmap](../src/browlet/webassembly/ROADMAP.md).

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
the bridge returns its `getSource()` result (or retained `.source`) without instantiating it.
The host owns resolution, loading, linking, and waiting for evaluation, including
top-level await. Returning a Module does not evaluate it automatically.

The import Promise belongs to the executing context. Callback exceptions and
rejections retain identity; asynchronous result conversion uses that context's
queue. The addon never checkpoints it. Compilation metadata or context state and
a weak association keep the callback and public referrer alive while code can still import; otherwise
their cycles are collectible. This deliberately retains the public referrer to
satisfy Node's callback contract, unlike the experimental raw-handle API.

The Node environment owns one VM registry on every addon base, independently of
the optional import router and its cleanup hook. Every retained Script and
SourceTextModule receives a weak compilation identity, even without an import
callback. Reloading the JavaScript adapters reuses that registry and the router.
Each loader retains its original module-result converter, so old, pending, and
new imports keep the correct module identity checks after a reload. The native
reload regression clears all JavaScript adapters from the require cache while
keeping the binary loaded, then exercises script, module, and context loaders.
Registration and compiled-code lookup share that retained registry. Job-hook and
rejection regressions confirm that old and new compiled code remains identifiable
after reload. V8's compilation cache can also retain those identities and their
public referrers; collection tests flush the cache before checking discarded cycles.

An explicit script/module callback takes precedence. When compilation metadata
is absent or contains only our compilation identity, the importing context
supplies its fallback callback, including for
indirect eval invoked by a Promise reaction. Foreign metadata remains Node's
responsibility, even when the generated code executes in an addon context.
The fallback belongs to the context, so reusing its global proxy neither copies
the old callback nor changes the loader of retained functions from the old realm.

Promise rejection notifications capture the current compilation metadata through
V8's public API before entering the JavaScript tracker. The third callback
argument is the retained Script/SourceTextModule, `undefined` for absent metadata,
or `null` for unrecognized code. This works on official Node 24/26 and custom Node
without a new engine patch. It does not intercept arbitrary function entry.

The addon forwards unrelated Node/VM requests to Node and restores its handler at
environment cleanup. Another addon's competing replacement of the isolate-wide
callback is unsupported. Official Node 24/26 do not export the forwarding handler,
so supplying the option there fails explicitly; the integration tests remain
approved expected failures. `supportsDynamicImport` reports this forwarding
capability to JS Engine; HTML omits unavailable callbacks while preserving ordinary
compilation on those bases. The build checks headers for the export, independently
of the job-hook patches. Ordinary Node VM import callbacks still work there.

The regression for identical `Function` bodies finds the first script's loader
reused on Node 26 and custom Node, including through Node's own VM API. Node 24
passes its control. Disabling V8's compilation cache makes both custom paths pass;
production retains caching and the regression is an approved expected failure.
Direct and indirect eval routing pass. HTML now connects evaluation-phase imports
to its resolver, Fetch, module map, and graph loader, including top-level await.
Its callback returns an evaluated Module through a native Promise; graph operations
use `env.InternalPromise`. HTML also connects Wasm parsing and source-phase URL
imports: source records skip dependency traversal, linking, and evaluation, and
the bridge projects their public Module only at the import boundary. Static
source imports work on all addon bases; dynamic source imports require the same
forwarding export as ordinary dynamic imports. Stock Node has no public Wasm VM
class. Deferred imports and object-valued `import(moduleObject)` remain separate.

### import.meta initialization

`SourceTextModule` accepts Node's `initializeImportMeta(meta, module)` constructor
option. V8 creates a null-prototype object on first access and caches it after
successful initialization. The callback receives the public module object;
its return value is ignored. Thrown values retain identity, and a later access
retries initialization with a fresh object. No checkpoint is performed.
Without an initializer, addon modules receive an empty object. The addon does
not supply HTML's `url` or `resolve`; HTML now supplies those through this callback.

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
The exported `supportsImportMeta` boolean reports whether the native forwarding
operation exists. JS Engine uses it for addon contexts; HTML omits the initializer
on unsupported bases so ordinary compilation still works with empty metadata.
Stock VM contexts use Node's own initializer and do not need this addon export.

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
HTML contract. Window composition supplies Binding-owned TrustedScript recognition
and CSP source-list checks/reporting. The preceding Trusted Types validation still
needs the unavailable engine inputs listed below; it does not enforce
`require-trusted-types-for` or default-policy checks on eval/Function.

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

### Wasm compilation policy

`setAllowWasmCodeGenerationCallback(realmReference, callback)` registers a
synchronous, nonthrowing `() => boolean` policy decision for a context. Pass
`context.realm` or an object created in a Node VM context. `true` permits native
compilation; `false` lets V8 produce CompileError. Node's exported
`AllowWasmCodeGenerationCallback` runs first, so registration cannot enable Wasm
in a Node context created with `codeGeneration: { wasm: false }`.

This uses public Node/V8 APIs on all three bases, with no engine patch. Unregistered
contexts retain Node's behavior. Registration replaces the callback; `undefined`
removes it. Private context state survives global-proxy reuse without retaining
discarded context cycles. Environment cleanup restores Node's isolate callback;
competing addons replacing that callback are unsupported.

V8 calls the hook for Module construction, byte compilation/instantiation, and
streaming compilation. It does not gate validation or instantiation of retained
modules. Browlet's HTML Wasm parser uses the same native constructor. Module
cloning and the addon's private imported-function conversion bridge do not compile
new author bytes and remain usable under a restrictive policy.

The callback has no source input: CSP §4.5.1 needs only the owning realm. It must
return a boolean and must not throw; V8 has no exception-result channel here.
A contract violation is an internal fatal error, never silent permission to
compile. Browlet's callback queues violation reporting without invoking author
handlers synchronously. [Tests](test/wasm-code-generation.test.cjs) cover policy
changes, native APIs, Node isolation/permissions, collection, proxy reuse, and
worker teardown. Stock mode checks Browlet's own entry points but cannot intercept
direct calls to captured native functions.

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
default. Their clock tests remain approved expected failures. JS Engine exposes
the setter on `JSRealm`; HTML installs its environment-owned clock for Windows
in every isolation mode. The HTML regressions cover live coarsened readings,
allowed/denied/report-only Permissions Policy, borrowed native methods, and
retained clocks after navigation or detachment. Registration does not query the
Document before attachment; native reads use its live policy and activity checks.
See the [HTML clock audit](../src/browlet/scripting/ROADMAP.md#8165-temporal-clock-calculation-and-installation-boundary).
The signed-int64 native range (roughly 1677–2262) remains an accepted limit;
HTML's wider Instant clamp is unchanged. This connection adds no native code.

### Context lifetime

A handle separates its stable realm reference from its reusable global proxy.
Detachment allows that proxy to transfer once to a fresh context. Retaining the
realm reference keeps the old realm alive; `.global` is not its identity.
Detachment preserves that context's existing embedder security token, so retained
functions can still access the reused proxy. Without restoration, Node 26 resets
the token and rejects that access. This neither changes HTML origin checks nor
restores the detached context's microtask queue.
`getRealm(object)` reports creation context, while `getFunctionRealm(callable)`
follows bound/proxy targets without traps and rejects revoked callable proxies.

`SPEC_CLASH(detached-context-promise-assimilation)`: follow Chromium and Firefox:
host `await`/`Promise.resolve()` can remain pending for Promises from a detached
context. V8 clears the old context's microtask queue; direct observation through
a host callback and work in the replacement context still run. WebKit instead
resolves the adopted Promises. This is an ordinary passing lifecycle regression
on all addon bases, not an expected failure. See the
[browser evidence](../src/js-engine/ROADMAP.md#detached-context-promise-delivery).

### Native global property storage

`globalPrototypeChain` preallocates an immutable global proxy and ordered
`mutable`, `immutable`, or `delegated` prototype layers. Reuse requires the same
layout. Web IDL populates them; `setPropertyDelegate()` attaches named-property
behavior. Ordinary contexts share Node's VM security token; contexts opting into
`globalAccess` instead keep distinct tokens and receive host access checks.

The context's `globalObject` is a stable host view of V8's actual ordinary global
storage, not a second property store. Host definitions and script declarations
therefore describe the same properties. The host view stays with its original
context when `globalProxy` moves to a replacement. Ordinary author reads/writes
use V8's dispatch, preserving explicit receivers and Binding's receiver checks.
`setGlobalObject(handle, object, indexedProperties)` accepts that allocated view
and optionally supplies live indexed descriptors, mutation callbacks, and keys.
The indexed contract requires `getOwnPropertyDescriptor`, `set`, `defineProperty`,
`deleteProperty`, and `ownKeys`. Mutation callbacks handle every array index,
including absent indices, and return their success boolean. Indexed reads,
descriptors, and presence checks consult the supplied callbacks; enumeration merges their keys
without duplicates. Host storage reflection excludes these synthetic indices;
getters run outside that reflection scope so nested child access remains live.

For a different explicit receiver, V8 uses the interceptor's property attributes
instead of its setter. A read-only supported index rejects that write, but an absent
index can create a property on the receiver. HTML/Firefox/WebKit reject both;
Chromium permits receiver writes. This `window-indexed-set-receiver` limitation
does not affect ordinary indexed assignment, definition, or deletion.

Native global delegates query own properties on their original store after proxy
reuse. Node 24 requires the original native holder for this query as well as for
delegate selection; its public holder follows the replacement Window. The focused
`global-object.test.cjs` regression checks both old-only and replacement-only names.

`registerGlobalGetter(handle, getter)` records the original global IDL getter
function. After detachment, that context's interceptor invokes registered
attributes through the original host view for bare global lookup. It does not
replace getters or cache results. Explicit lookup on the reused public proxy and
borrowed calls keep their supplied receivers. This preserves original-Window
ownership under `SPEC_CLASH(retained-window-attributes)`; browser evidence and the
specification rationale live in the [Window roadmap](../src/browlet/browsing/window/ROADMAP.md#native-window-property-storage-and-receivers).

Original-global capture is private to `global-object.cc`. A temporary native
property and retained reader capture the native accessor holder before and after
`DetachGlobal()`: Node 24 exposes the hidden original global (never returned to
JavaScript), while Node 26/custom expose its permanent API proxy after detachment.
The native callback must actually run; own-property collisions, lexical shadows,
and lexical TDZ cause selection of another name. The temporary property is removed
before returning. Capture and detachment are synchronous, with no author callback
between preparation and completion. All ownership state is V8-traced, with no
per-context strong native root. The native tests cover name collisions, TDZ,
live retained state, and collection after reuse. This is a version-sensitive
public-V8-API technique, not an engine patch or a general exposed capture API.

### Native global access checks

`createContextHandle({ globalPrototypeChain, globalAccess: true })` creates an
access-checked native global. Reuse requires the same guarded layout.
`setGlobalAccess(globalProxy, select)` attaches a context-owned selector. It gets
the actual accessing realm reference before entering host code, including borrowed
Reflect calls. Only the exact Node composition context bypasses policy. An
unregistered or unconnected caller is never silently granted host access.

Allowed operations use V8's ordinary global store. Denied access uses the selected
Get/Set, descriptor, and key handlers. Foreign definition/deletion and
prototype/extensibility mutations bypass those handlers; the selected `deny()`
throws the host's exception. Browlet supplies HTML origin checks and caller-owned
DOMExceptions through JS Engine; native code does not implement HTML policy.

The public handler's `ownKeys()` returns all keys, including array-index strings.
The JavaScript addon adapter splits that list into V8's named and indexed
enumerators; callers do not supply a separate `indices()` handler.

`global-access.cc` owns the isolate-wide failed-access callback. Addon loads share
its registration count, and the last environment cleanup removes it. Selectors
live in context extras and collect with their contexts. Pending exceptions survive;
unrelated targets retain V8's default denial. V8 exposes no getter for a previous
callback, so another embedder cannot independently own this hook in the same
isolate. Production uses one maintained addon library per isolate.

Distinct tokens also require Promise observation to attach reactions in the
Promise's context while retaining the observer's queue. Native forwarding then
enters the callback's own context, so a host reaction can allocate in another
guarded Window without inheriting the observer's access restrictions.
`global-access.test.cjs` covers realm selection, validation, guarded reuse,
collection, repeated addon initialization, worker teardown, and Promise delivery.
The HTML integration follows Chromium's foreign receiver and mutation choices;
see the [Window audit](../src/browlet/browsing/window/ROADMAP.md#native-window-access-guard).
Same-origin COOP reporting remains separate work. Indexed mutations now use the
owner callbacks above, with the explicit-receiver limitation recorded there.

**Node 24 Promise workaround:** the first successful guarded-context creation
initializes a JavaScript workaround in [vm.cjs](addon/vm.cjs). It briefly replaces
and restores `Promise.prototype.then` in a disposable VM realm, invalidating V8's
isolate-wide `PromiseThenLookupChain` protector. Host and Window intrinsic
functions/descriptors remain unchanged. Ordinary addon loading, unguarded
contexts, failed context creation, and Node 26/custom do not activate it. Further
guarded contexts reuse that state; each worker initializes independently.

Without this workaround, a guarded Window's Function using a Node-owned loader
rejects its import with `TypeError: no access`, and rejecting loaders can leak
unhandled rejections. The [isolated probe](experimental/window-guard/node24-import.cjs)
narrows this to V8's native `JSPromise::Resolve` fast path. In
[Node 24.19.0](https://github.com/nodejs/node/blob/v24.19.0/deps/v8/src/objects/objects.cc),
it selects the current context's `promise_then()` when adopting an intrinsic
Promise from another realm. [Node 26.8.1](https://github.com/nodejs/node/blob/v26.8.1/deps/v8/src/objects/objects.cc)
selects that Promise prototype's creation context instead. This is independent
of Holder/HolderV2, native Promise observation, and the Window guard selector.
The native success/rejection and HTML Node-owned import assertions now run
normally on every supported base. Official addon bases still lack the separate
HTML dynamic-import forwarding export; their existing expected failures remain.

Node's module-evaluation repair in [24.9.0](https://github.com/nodejs/node/releases/tag/v24.9.0)
returns an outer-context Promise for `module.evaluate()` with `afterEvaluate`.
It is present in 24.19.0 and does not fix this V8 path: both 24.9.0 and 24.19.0
retain the wrong-realm optimization. Remove the workaround after backporting
[V8 commit 626b689](https://github.com/v8/v8/commit/626b689e9a9845b584fbbdd0917fb19cdc43f1f4)
and validating the affected Node releases. No Node/V8 source or native behavior
is changed by this workaround.

Invalidation lasts for the isolate's lifetime and affects host application code
as well as Browlet. The [experiment](experimental/promise-then-workaround/README.md)
measured roughly 27% extra time in a tight host `Promise.all` loop, 10% in Promise
adoption, and 16% in cross-realm adoption, with about 1.3 ms initial setup. Browlet
DOM/async workloads showed no clear slowdown within measured variation. The
workaround preserves access checks; it trades this optimization cost for correct
import completion and rejection delivery until the engine fix is available.

### Other addon operations

| Optional operation | Availability and contract |
| --- | --- |
| `isWeakRef(value)` | Available with the addon on every supported base. Uses V8's existing `Value::IsWeakRef()` without reading properties or dereferencing the target; proxies and prototype impostors return false. No engine patch is required. |
| `isFinalizationRegistry(value)` | Requires `Value::IsFinalizationRegistry()`. Checks the native brand without reading properties or changing registered entries; proxies and prototype impostors return false. JS Engine retains its captured-`unregister` fallback where unavailable. |
| `createHTMLDDA(context, call)` | Available with the addon on every supported base. Allocates a callable, non-constructible object with native `[[IsHTMLDDA]]` behavior in the supplied context. Invokes `call` with an undefined receiver and the original arguments; preserves its result or exception. |
| `setPropertyHandlers(object, handlers)` | Attaches property algorithms to a native object allocated with interceptors. Accepts `has`, `get`, `set`, `getOwnPropertyDescriptor`, `defineProperty`, `deleteProperty`, and `ownKeys`; the addon translates descriptors and keys into V8's query/index protocols. |
| `observePromise(promise, realmAnchor, fulfilled?, rejected?)` | Native `Promise::Then` in the backing Promise's context; forwarding functions retain the observer's queue and enter each callback's own context. Node 26/custom bypass author `then`, `constructor`, and species; Node 24 still consults `constructor`. A derived Promise is allocated and discarded by Browlet. |
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
The [property regressions](test/html-dda.test.cjs) cover both paths. Prototype
forwarding remains separate from the global-storage view above. These interceptors are not a
complete Proxy API: Node 26+ supplies the holder rather than the original
property-access receiver; global handlers receive undefined. The collection path
does not use that receiver argument.

## Native function entry

### Exotic object access

`createExoticObject(realmAnchor, selectHandlers)` creates an extensible,
noncallable Proxy with native handler lookup. V8 supplies the accessing context
while resolving each trap, before calling its JavaScript function. The selector
receives the existing realm reference; this is the current realm, not the
incumbent or outermost entry. Borrowed Reflect methods therefore select their
own realm. A stable intrinsic prototype is a suitable allocation anchor; a
reused global proxy is not. Allocation also works after the original context
handle is detached.

The native target holds no author properties. Its descriptor and key
interceptors expose the same selected view for Proxy invariant checking,
allowing foreign views to hide nonconfigurable properties or return a distinct
callable. The host owns the sole ordinary property store and every policy
decision. Supply all noncallable Proxy handlers; descriptor/key handlers must
be pure views and ownKeys must return an array. Never expose or mutate the
private target passed to handlers. Native internal fields trace the selector
and its storage without persistent roots. This facility uses public V8 APIs
on all supported addon bases; no new Node/V8 patch is required.

### Incumbent-sensitive functions

`createFunctionWithIncumbent(context, steps)` creates a nonconstructible native
function in the supplied context. It calls `steps(incumbent, receiver, args)`
after capturing V8's incumbent realm reference, before any JavaScript binding
frame can obscure the author caller. Return values and exceptions pass through.
This uses public V8 APIs on all supported addon bases; no engine patch is needed.

JS Engine maps the reference to a registered realm. Browlet's opt-in Web IDL
`captureIncumbent` binding currently serves `Window.postMessage()`. HTML scopes
the observation on its own stack; the addon neither supplies ScriptOrModule
records nor traces every author call. Stock Node keeps the existing JavaScript
factory and its approved attribution failures. See
[function-entry tests](test/function-entry.test.cjs) and the
[HTML stack boundary](../src/browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts).

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
| `enqueueGenericJob(job, realm)` | Schedule a single-use generic job, or return `false` for V8's original delivery; currently Atomics.waitAsync notification delivery. |
| `enqueueTimeoutJob(job, realm, milliseconds)` | Schedule no earlier than the delay, or return `false` for V8's original timer; currently Atomics.waitAsync deadlines. Calling an accepted but cancelled timeout once is harmless. |

Registration/enqueue snapshots contain current, entered, and incumbent realm
references plus opaque `hostDefinedOptions`. Registration additionally resolves
the addon's retained import-loader identity to `compiledCode`: a compiled
`Script`/`SourceTextModule`, null for unrecognized metadata, or undefined when
the native snapshot has no metadata. The VM adapter owns this weak association;
HTML script records and fallback policy remain outside the addon. Compilations
without an import callback do not acquire this identity. Make defaults to
`{ callback, hostDefined: undefined }`, call to
`Reflect.apply`; either can be supplied independently.

Jobs take no arguments and must run asynchronously in the required order.
They retain the original V8 job and restore its saved continuation when called;
calling twice throws. A Promise job's creation realm identifies its queue even
when the specification realm is null. Returning `false` delegates immediately:
do not also schedule that job. Declined generic/timeout callables are invalidated;
V8 keeps the original operation, native timer range, and cancellation identity.
These two return contracts require the current combined V8 patch and a rebuilt
custom engine/addon pair.

Make/enqueue callbacks must not throw: invalid records and exceptions reach
Node's uncaught-exception machinery. Call-hook exceptions follow the original
Promise or registry path. Private async-context state preserves application ALS;
recursive capture of the host's own work is suppressed. Pre-installation work
keeps its original callback path. Teardown clears native hooks/references.

Callback registration captures the executing script's host-defined options along
with the context identities. Promise enqueue snapshots retain only the context
identities and job kind; scheduling does not consume script metadata there.
Collecting that unused metadata at enqueue caused a native fatal during hot async
completion on the custom engine. Keep the lookup at registration; the native
host-hook regression covers the failing completion shape.

[JS Engine](../src/js-engine/runtime.ts) translates references to registered realms.
[HTML](../src/browlet/scripting/host-hooks.ts) retains incumbent settings plus the
modeled active-script context and owns callback cleanup, microtask tasks, generic
tasks, and active-time timeouts.
Ordinary Node Promise jobs remain on Node's queues. HTML declines unrelated
Node/VM Atomics.waitAsync jobs, preserving native timeout and notification delivery.
Script attribution beyond modeled entries and module continuations remain
[engine/HTML work](../src/js-engine/ROADMAP.md).

### Native cleanup error reporting

`setExceptionReporter(context, reporter | undefined)` installs an internal
reporter for uncaught engine errors in that context. HTML installs
`env.reportException` once the realm's environment and global are ready.
V8's entered/microtask context identifies the registry's realm, including when
the cleanup callback belongs to another realm. The callback receives the
original thrown value; it is retained by the context, with no additional native
root or global-proxy lookup. Passing `undefined` restores Node reporting.
Reporters should not throw; an internal failure returns to Node's handler.

- **Custom Node:** `node::SetContextExceptionReporter` routes the engine message
  before Node's process handlers and exempts registered contexts from its abort
  policy. This is a Node-only addition in the combined patch; no V8 change is
  needed. `process._fatalException` stays untouched.
- **Official Node 24/26:** the compatibility layer intercepts the private
  `process._fatalException` entry and selects the context-owned reporter using
  public V8 APIs. It delegates unregistered contexts and Promise rejection
  reports to the original handler. Node's explicit
  `--abort-on-uncaught-exception` flag runs before this fallback, so a cleanup
  throw can still abort the process. This accepted limitation is a strict
  expected failure, not a reason to disable Node's process-wide abort policy.
- **Stock mode:** without the addon, native cleanup errors still reach Node.
  The real Window regression is an approved stock-only expected failure.

The [native regressions](test/exception-reporting.test.cjs) cover registry versus
callback ownership, primitive throws, reporter removal/collection/failure, Node
monitor and primary capture handlers, async context, and both abort-policy
paths. The [Window regression](../test/browlet/scripting/finalization-errors.test.ts)
checks exact error identity, cancelable dispatch, and `unregister()` before the
next cleanup callback. Node errors remain on Node's normal path.

FinalizationRegistry capture/call support does not include
`HostEnqueueFinalizationRegistryCleanupJob`. V8 still schedules and runs whole
registry cleanups; our call hook receives individual held values after their
cells have been removed. It cannot defer the cleanup operation or select its
HTML task. The [HTML audit](../src/browlet/scripting/ROADMAP.md#81662-finalizationregistry-cleanup-scheduling)
records the distinct registry/callback realm roles and the adopted exception
reporting repair. Guarded queue-completion notifications also repair idle cleanup
reaction progress. An absent HTML task record alone does not justify a new V8 API.

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
