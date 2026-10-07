# Node compatibility

Browlet uses this native addon to control microtask checkpoints, identify the
realm of an object, and preserve the global proxy across navigation. HTML owns
the scheduling and browser policy applied through those engine facilities.

Stock Node runs through JS Engine's fallback paths. On supported official Node
builds, the addon supplies explicit queues, native contexts and globals, realm
lookup, and Promise observation. The [V8 patch set](../vendor/_patches/node-v8.patch)
adds callback/job hooks, native collection iterators, and further iterator and
buffer-view inspection. The patch includes engine regressions and records its
upstream Node revision. [Known limitations](../src/LIMITATIONS.md) describes
the observable constraints of each runtime.

## Code and regressions

| Area | Implementation and evidence |
| --- | --- |
| Contexts, globals, and microtask queues | [vm.cc](addon/vm.cc), [property-delegate.cc](addon/property-delegate.cc); [queue and Promise tests](test/capabilities.test.cjs), [browser global tests](../test/browlet/browsing/native-global.test.ts) |
| Callback and job hooks | [host-hooks.cc](addon/host-hooks.cc); [native hook tests](test/host-hooks.test.cjs), [HTML Promise jobs](../test/browlet/scripting/promise-jobs.test.ts) |
| Native value inspection and iteration | [Iterator predicates](test/iterator-predicates.test.cjs), [buffer views](test/array-buffer.test.cjs), [collection iterators](test/collection-iterator.test.cjs) |

The [standalone suite](test/) also covers lifetime, garbage collection, and runtime selection.

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

Capability-gated Vitest tests use `itPassesWith(...)` to retain required assertions
as approved expected failures on unsupported paths; unexpected passes require review.
Ordinary asynchronous completion remains required on every backend.

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
| `observePromise(promise, realmAnchor, fulfilled?, rejected?)` | Native `Promise::Then` in the observer's realm. Node 26/custom bypass author `then`, `constructor`, and species; Node 24 still consults `constructor`. A derived Promise is allocated and discarded by Browlet. |
| `createCollectionIterator(context, kind, next)` | Requires `CollectionIterator::New`. Produces native Map/Set-branded iterators; the callback owns result conversion/allocation, V8 owns iteration lifecycle. |
| `isLengthTrackingArrayBufferView(view)` | Requires `ArrayBufferView::IsLengthTracking()`. Reads auto/fixed length without mutation, including shared, detached, and out-of-bounds views. |
| `isArrayIterator(value)`, `isStringIterator(value)`, `isRegExpStringIterator(value)` | Require the corresponding V8 `Value` predicates. Inspect the native brand without reading properties or advancing the iterator; proxies and prototype impostors return false. |
| `setHostHooks(hooks)` | Requires the five V8 interception APIs below. Header detection controls whether the addon exports it. |

Callback iterators have no table-backed entries for native debugger/Node previews.

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
