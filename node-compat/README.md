# Node compatibility

The maintained native backend for Browlet's JS Engine integration. The addon
supplies explicit microtask queues, reusable context handles, native global
allocation, realm lookup, and Promise observation on supported official Node
builds. Additional V8 patches expose job hooks, collection iterators, and buffer
view inspection. HTML owns the policy applied through those facilities.

## Source and build ownership

| Location | Responsibility |
| --- | --- |
| [addon/](addon/) | Native implementation and JavaScript entry; `vm.cc` owns contexts/queues, `property-delegate.cc` global forwarding, and `host-hooks.*` callback/job integration |
| [test/](test/) | Standalone capability, lifetime, GC, and host-hook regressions |
| [build-node.mjs](../scripts/build-node.mjs) | Official dependency preparation and addon compilation |
| `CUSTOM_NODE_SOURCE` | Regular Node checkout: engine patches on `v8-patches`, engine builds there |
| `experimental/` | Independent, ignored Git repository for probes and findings; not a build dependency |
| `.cache/`, `addon/build/`, `results/` | Ignored official dependencies, addon outputs, and temporary investigation results |

Keep Node source and engine builds in the regular checkout, not under Browlet.
The custom base uses its `out/Release/node.exe`, `node.lib`, and source headers
directly. The older `browlet-node-compat-history` branch is reference material.
Each repository has its own index; addon and engine changes are separate work.

## Build and run on Windows x64

Copy [.env.example](../.env.example) to `.env` and choose the defaults:

```ini
NODE_BASE=24.19.0
NODE_RUNTIME=compat
# Required only for the custom base:
# CUSTOM_NODE_SOURCE=C:/path/to/node
```

`NODE_BASE` accepts `24.19.0`, `26.8.1`, or `custom`. `NODE_RUNTIME=compat`
loads the matching addon; `stock` disables it. Shell settings override `.env`,
and explicit command options override both. The defaults are `24.19.0/compat`.

```powershell
npm.cmd run build:node -- --base 24.19.0
npm.cmd run test:unit
npm.cmd run test:node-compat
# One-off selection and a focused suite:
node scripts/with-node.mjs --base 26.8.1 --runtime compat vitest run --project=unit test/js-engine
```

Building requires Visual Studio's Desktop development with C++ workload.
The build uses an existing x64 developer prompt, `VSINSTALLDIR`, or `vswhere`.
It downloads missing official runtimes, headers, and import libraries, verifies
pinned hashes, and reuses the cache. Windows x64 is the supported target.

For `custom`, first build Node in `CUSTOM_NODE_SOURCE`, then run
`npm.cmd run build:node -- --base custom`. This compiles only the addon;
changing the base never builds the engine. Rebuild the addon after an engine
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
npm.cmd run test:types
node scripts/with-node.mjs --base custom --runtime compat vitest run --project=unit
```

Addon changes also need the native suite on each supported base:

```powershell
node scripts/with-node.mjs --base custom --runtime compat node --expose-gc --experimental-vm-modules --test "node-compat/test/*.cjs"
```

Record passed, failed, and unavailable runs per configuration. Capability-gated
Vitest tests use `itPassesWith(...)` to retain required assertions as approved
expected failures on unsupported paths; unexpected passes require review.
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
behavior and `setGlobalObject()` selects the Window target. This avoids the old
post-creation immutability patch. Node's shared VM security token permits embedder
access; it does not implement browser cross-origin policy.

| Optional operation | Availability and contract |
| --- | --- |
| `observePromise(promise, realmAnchor, fulfilled?, rejected?)` | Native `Promise::Then` in the observer's realm. Node 26/custom bypass author `then`, `constructor`, and species; Node 24 still consults `constructor`. A derived Promise is allocated and discarded by Browlet. |
| `createCollectionIterator(context, kind, next)` | Requires `CollectionIterator::New`. Produces native Map/Set-branded iterators; the callback owns result conversion/allocation, V8 owns iteration lifecycle. |
| `isLengthTrackingArrayBufferView(view)` | Requires `ArrayBufferView::IsLengthTracking()`. Reads auto/fixed length without mutation, including shared, detached, and out-of-bounds views. |
| `setHostHooks(hooks)` | Requires the five V8 interception APIs below. Header detection controls whether the addon exports it. |

Callback iterators have no table-backed entries for native debugger/Node previews.

Use operation availability rather than a version label. [Known limitations](../src/LIMITATIONS.md)
owns the observable fallback constraints. Native global acceptance lives in
[native-global.test.ts](../test/browlet/browsing/native-global.test.ts) and the
Document lifecycle tests; the standalone suite also checks retained-context GC.

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
