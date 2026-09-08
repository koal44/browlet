# Node compatibility

Native support for Browlet's engine backend. The first addon ports shared
microtask queues and detachable/reusable context handles onto stock Node
24.19.0 and 26.8.1, including the context/queue lifetime fix. Post-creation immutable
prototypes remain unavailable through the addon. A custom engine containing our
V8 patches also enables the five host hooks described below.

| Facility | Stock Node | Stock + addon | Original source patches |
| --- | --- | --- | --- |
| Explicit shared microtask queues | No | Yes | Yes |
| Context handles and reusable global proxies | No | Yes | Yes |
| Make an existing global's prototype immutable | No | No | Yes |
| Allocate an immutable global and prototype chain | No JS API | Opt-in prototype | Not needed by original route |

## Build and run on Windows x64

`npm.cmd run build:node` prepares the selected Node base and compiles
the addon. Missing official executables, headers and import libraries are
downloaded and checked against pinned release hashes. Rebuilds reuse these
cached files; header archives are deleted after extraction.

Building requires Visual Studio's Desktop development with C++ workload. The
build reuses an x64 developer prompt, honors VSINSTALLDIR, or discovers the
installed C++ tools with vswhere. VsDevCmd initializes the compiler and Windows
SDK environment.

```powershell
# Override the configured base for this build:
npm.cmd run build:node -- --base 24.19.0
```

Copy `.env.example` to `.env` and set the defaults there:

```ini
NODE_BASE=24.19.0
NODE_RUNTIME=compat
# Required only for the custom base:
# CUSTOM_NODE_SOURCE=C:/path/to/node
```

| Setting | Choices | Meaning |
| --- | --- | --- |
| `NODE_BASE` | `custom`, `24.19.0`, `26.8.1` | Which Node executable and development files to use |
| `NODE_RUNTIME` | `compat`, `stock` | Enable the addon, or run the selected base alone |
| `CUSTOM_NODE_SOURCE` | Absolute source-directory path | The single location for the custom engine, headers and import library |

Both the addon compiler and all test commands read these settings. The shell
environment overrides `.env`; explicit launcher/compiler options take precedence.
Without settings, the defaults are Node 24.19.0 and `compat`. An explicit addon
build compiles for the selected base regardless of `NODE_RUNTIME`.

Run tests normally; their internal launcher reports the actual Node version and
paths, and puts that executable first on subprocess PATH.
`compat` supplies the internal `BROWLET_NODE_ADDON` module path to Browlet;
`stock` removes it. You do not configure a separate addon path. For the custom
base, `stock` still runs your custom engine, just without this addon.
Unit, artifact, WPT, oracle and performance test commands all use this selection.
Browser engines remain independent of the Node process running Playwright.

```powershell
npm.cmd run test:unit
npm.cmd run test:artifact
npm.cmd run test:node-compat
# Test-runner arguments are forwarded unchanged:
npm.cmd run test:unit -- test/js-engine/node-runtime.test.ts
```

The C++ code selects the callback API using `NODE_MAJOR_VERSION` from the target
headers. To prepare and target Node 26:

```powershell
npm.cmd run build:node -- --base 26.8.1
# One-off overrides without editing .env:
node scripts/with-node.mjs --base 26.8.1 node --expose-gc --experimental-vm-modules --test "node-compat/test/*.cjs"
node scripts/with-node.mjs --base 26.8.1 --runtime stock vitest run --project=unit
```

Each base has its own output directory under `addon/build/`: `24.19.0/`,
`26.8.1/`, or `custom/`. Each successful build writes `node-compat.node` and a
`node.json` recording its target version, native module ABI, architecture and
platform. The loader checks those against the running Node and reports how to
rebuild on a mismatch. Switching bases does not overwrite another base's addon.
Missing runtimes, development files or addons produce errors; there is no
fallback to a different base. Windows x64 is the supported build target.
Other official releases have not been validated. No dependency on experimental/
is needed to build.

The build generates addon/build/compile_commands.json with the actual compiler,
headers, SDK paths and C++20 options. The repository's VS Code C/C++ settings
use that database for each source file, following the most recent successful
addon build. Machine-specific paths stay in ignored build output. Rebuild after
changing the installed compiler or target headers.

## Node engine work

Edit and build Node/V8 in the regular checkout named by `CUSTOM_NODE_SOURCE`.
Do not create Node checkouts or engine builds under node-compat or .cache.
The custom base uses `out/Release/node.exe`, `out/Release/node.lib`, and the
headers in `src`, `deps/v8/include` and `deps/uv/include` directly from that
checkout. Nothing is copied or linked into Browlet's cache.

After building the Node engine there, build only the addon here:

```powershell
npm.cmd run build:node -- --base custom
# With NODE_BASE=custom in .env:
npm.cmd run test:node-compat
npm.cmd run test:unit
```

The addon build checks that the executable and headers agree on Node version
and native module ABI. Rebuild the addon whenever you rebuild the custom engine:
two custom builds can report the same version while containing different V8
changes. These checks do not establish that an engine binary matches the current
Git checkout. Changing `NODE_BASE` never builds the Node engine automatically.

Compile the experimental probe against the regular checkout and run it with
that checkout's executable;
see experimental/node-promise-hooks/engine-capture.md for the commands.

The active engine patches are on `v8-patches` in that checkout. The addon build
detects the required hook APIs in the target headers; selecting `custom` alone
does not imply that the engine supplies them.

## Host hooks

The addon also supplies `observePromise(promise, realmAnchor, onFulfilled?,
onRejected?)` on supported bases. `realmAnchor` is a function from the observer's
realm. Native `v8::Promise::Then` installs the reactions there. Node 26.8.1 and
the custom engine bypass author `then`, `constructor`, and `@@species`
properties. Node 24.19.0 still consults `constructor` and fails the new capability
regression; the addon does not work around that older engine behavior. The
operation returns V8's derived promise; Browlet's internal observation boundary
discards that result.

`supportsHostHooks` reports whether the addon was built with the required V8
APIs. Official Node 24.19.0 and 26.8.1 support the existing context/queue APIs but
return false here. Calling `setHostHooks()` on those bases throws
`ERR_HOST_HOOKS_UNAVAILABLE`.

`setHostHooks(hooks)` installs any combination of the following callbacks and
returns nothing. The configuration lasts until the owning Node environment
shuts down; there is no public removal or replacement operation. One installation
owns the isolate; another installation throws `ERR_HOST_HOOKS_INSTALLED`.
Workers are independent.

On the custom engine, `withContinuationData(data, steps)` temporarily enters saved
continuation data to inspect it through Node's existing AsyncLocalStorage API.
Use the Promise enqueue snapshot's `continuationData`; do not inspect or invent
Node's internal representation. Inspection is synchronous and restores the
previous data on return or throw. Job execution restores its own saved data
independently, so inspection neither consumes nor runs the job.
The names follow the five targeted ECMAScript operations in
[Jobs and Host Operations to Enqueue Jobs](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-jobs).

| Callback | Contract |
| --- | --- |
| `makeJobCallback(callback, registration)` | Return a record `{ callback, hostDefined }` with the original callback. Each callable reaction slot and thenable registration gets its own call to make. A FinalizationRegistry captures once at construction. |
| `callJobCallback(record, receiver, args)` | Invoke `record.callback` with the supplied receiver and argument array; return its result or propagate its exception. The retained record is exactly the object returned by make. |
| `enqueuePromiseJob(job, realm, enqueue)` | Take ownership of scheduling a single-use Promise job, or return `false` to leave it on its original V8 queue. `realm` is null for a reaction without a callable handler. `enqueue` also supplies the enqueue-time snapshot and `kind`, either `reaction` or `thenable`. |
| `enqueueGenericJob(job, realm)` | Schedule a single-use generic job. Currently this receives Atomics.waitAsync notification delivery. |
| `enqueueTimeoutJob(job, realm, milliseconds)` | Schedule a single-use timeout job no earlier than the supplied delay. Currently this receives Atomics.waitAsync deadlines. A cancelled timeout may still be called once and does nothing. |

Every callback is optional. Make defaults to `{ callback, hostDefined: undefined }`;
call defaults to `Reflect.apply`. Omitting an enqueue callback leaves that kind
of scheduling with V8. The internal make/call adapters share registration data,
but the public callbacks can be supplied independently:

```js
const compat = require('./node-compat/addon/index.cjs');
compat.setHostHooks({
  makeJobCallback(callback, registration) {
    return { callback, hostDefined: registration };
  },
  callJobCallback(record, receiver, args) {
    // Host setup and finally cleanup can surround this call.
    return Reflect.apply(record.callback, receiver, args);
  },
});
```

Registration and Promise-enqueue snapshots contain `current`, `entered`,
`incumbent`, and `hostDefinedOptions`, captured before entering the host's JS.
The first three are realm references (or null when absent). The last is an array
of V8's opaque script metadata; the addon does not interpret Node's loader identity.

Promise-enqueue snapshots also contain `continuationData`, the opaque data saved
on that job. It can differ from the enqueuer's current continuation. Reading it
does not enter the saved continuation. The V8 handoff uses `PromiseJob.Run()`,
`GetContinuationData()`, and `GetContext()`; the addon retains the handle through
the callable `job` supplied to JavaScript.

`getRealm(object)` returns the stable reference for an object's creation realm.
Each context handle also exposes `.realm`. References have a read-only `.global`
property and remain distinct when successive contexts reuse one global proxy.
Use the reference itself as the identity, not `.global`. A Node vm sandbox is
usually created outside its context; use an object evaluated inside that context
when obtaining its realm. Retaining a reference keeps that realm alive.

Enqueue hooks must schedule asynchronously, preserving the required ordering
and timeout delay. Call the supplied job with no arguments. Promise jobs can be
placed on the maintained queue's `enqueueMicrotask(job)` or wrapped for host
setup/cleanup; running them does not enqueue the same job through the hook again.
The host owns queue selection and checkpoints. No raw queue pointer is exposed.
Returning `false` from the Promise enqueue hook delegates that job to the
engine-selected queue immediately; do not also schedule it yourself. This lets
an HTML embedder leave unrelated Node and VM Promise jobs alone. Generic and
timeout hooks always transfer scheduling to the host and ignore the return
value. Their installation applies to every realm in the isolate.
The host may retain jobs until ready to run them; calling an already-run job throws.

Make and enqueue callbacks must not throw. Invalid make records and exceptions
from these callbacks are reported through Node's uncaught-exception machinery;
without a handler the process exits with failure. Call-hook exceptions follow
the underlying Promise or FinalizationRegistry callback path. Make/call records
use private AsyncLocalStorage state alongside the application's existing ALS.
Recursive make calls for the host's own capture work are suppressed. Work that
predates installation invokes its original callback without a custom call hook.
Environment teardown clears the engine callbacks and releases their native
references. Tests use fresh workers for independent configurations.

`test/host-hooks.test.cjs` exercises this public API. Browlet now installs
all five hooks through `src/browlet/scripting/host-hooks.ts` on a
supported custom engine. It retains incumbent settings and applies callback
and script cleanup through HTML microtask tasks. Generic jobs enter the HTML
JavaScript engine task source; timeout jobs use the global's fully-active time
before entering that same task source. These two HTML handlers require an HTML
realm; Atomics.waitAsync in ordinary Node/VM realms is unsupported while they
are installed. Active-script restoration and module loading remain separate
adoption work. HTML job integration tests require the custom engine; official
Node plus the addon still lacks these hooks.

## Scope

The addon exports createMicrotaskQueue(), createContextHandle(), runInContext()
and isContext(). Its contexts are native V8 contexts registered with Node,
not node:vm Contextify objects. NodeRuntime routes evaluation through the
selected backend; node:vm itself is not modified.

This supports Browlet's current context creation and script evaluation needs,
not the entire vm API. Baseline context options are microtaskQueue and
reuseGlobalProxyFrom; the opt-in globalPrototypeChain is described below.
Evaluation supports filename, lineOffset and
displayErrors: false. Timeouts, code-generation controls, dynamic-import
callbacks, vm.Script interoperability and automatic afterEvaluate checkpoints
are not implemented. Unsupported options are rejected. Existing HTML
WindowProxy/origin accommodations remain; host-hook adoption is described above.

The standalone suite retains two cases from the retired Node proxy-reuse
experiments: collecting the old realm while the replacement remains live
passes; indirect eval selecting its realm's dynamic-import callback is skipped
until createContextHandle supports importModuleDynamically. Re-enable that
acceptance case with the [module-loading integration](../src/js-engine/ROADMAP.md);
it does not require implementing the entire vm API.

The addon does not replace V8's existing isolate Promise hook. Node's
context registration preserves its Promise hooks; tests cover hooks installed
after context creation and ALS transport. Each worker owns its native state.

## Native global integration

`createContextHandle({ globalPrototypeChain: [...] })` preallocates an immutable
global proxy, a separate immutable per-context global target (`globalObject`),
and the requested `prototypeChain`. The nonempty layout lists prototype layers
from nearest to furthest; each is `mutable`, `immutable`, or `delegated`
(immutable with native property callbacks). Reuse requires the same layout.
These are host construction APIs, not replacements for arbitrary JS objects.

For Window, the chain is Window.prototype -> WindowProperties ->
EventTarget.prototype -> Object.prototype. Web IDL populates the allocated
objects. `setPropertyDelegate(object, delegate)` connects the named-properties
layer to Web IDL's existing algorithms. `setGlobalObject(handle, globalObject)`
connects native global access to the per-Window target after NodeRealm transfers
the initial global properties. The implementation keeps `WindowImpl.prototype`;
the native proxy can be reused without rewriting either Window's binding record.

**Node 24 limitation:** detached-context callbacks need the deprecated
`PropertyCallbackInfo::Holder()` solely to retrieve the original creation
context. With `HolderV2()` in the tested Node 24.19.0, an old closure's unqualified
`document` lookup instead reaches the new Window after proxy reuse. The native
code never passes the hidden holder to JavaScript. The Node 26 build uses
`HolderV2()` and passes the same detached-global regression. That build also
uses the holder for prototype delegation because property callbacks no longer
expose `This()`; this covers Browlet's named-properties delegate, not arbitrary
accessor delegates that depend on the access receiver. `SetImmutableProto()`
itself remains a supported creation-time API; no Node or V8 source patch is used.

The integration test is
`test/browlet/browsing/native-global.test.ts`. It covers real Window and
EventTarget bindings, the exact visible prototype chain, named properties,
property operations and strict failures, stable receiver records, and old
global reads/writes after reuse. The ordinary browser bootstrap and navigation
now use this allocation when the addon is enabled. Document-lifecycle tests
cover actual global-this identity, immutable prototypes, proxy reuse, and old
closures retaining their original Window state. Plain Node keeps its existing
fallback. Cross-origin access checks, history traversal, and a native mutable
global mode remain separate work. Property forwarding adds JS/native calls and
has not been benchmarked.

## Files and local state

- addon/: one native backend and its JS entry point. addon.cc registers the
  binary; vm.cc owns queues, contexts and their shared lifetime management.
  property-delegate.cc contains the opt-in global/prototype property callbacks.
  host-hooks.cc dispatches engine hooks; host-hooks.cjs retains callback records.
  Add distinct features in their own C++ source files and initialize them from
  addon.cc. Separate binaries are useful for independently loadable components,
  not required for separate features or upstream commits.
- test/: standalone behavior and GC regressions plus a quick startup check.
- ../scripts/build-node.mjs: verified dependency preparation and addon compilation.
- experimental/: an ignored, independent Git repository for investigation.
- .cache/node-v24.19.0/: Node 24 headers, Release/node.lib and node.exe.
- .cache/node-v26.8.1/: Node 26 headers, Release/node.lib and node.exe.
  These are replaceable dependencies prepared by `build:node`,
  not Node source checkouts. Download archives and duplicate libraries are
  discarded after preparation.
- results/: ignored logs and JSON reports, grouped under addon/,
  node-promise-hooks/, supported-global/ and node-version-check/. The last two
  retain evidence from retired source copies; their useful implementation
  changes are already in the maintained addon. These are disposable run outputs,
  not build inputs. Keep raw failure logs while investigating an unresolved bug;
  the maintained tests and experimental notes hold the lasting findings.

The original Promise investigation is now experimental/node-promise-hooks/.
Its imported Git baseline is b1bcdfb. The older accumulated Node work is retained
on browlet-node-compat-history, rebased onto origin/main at 6f41e4156. Its first
four commits end at fa65b0f98 (equivalent to the original 1ce916938): three
features and a lifetime fix. The following three commits preserve the earlier
Promise callback-state and native-function experiments. All seven patches were
verified unchanged by git range-diff after the rebase.
The unused patch exports and their temporary
verification checkout have been removed; this build consumes neither.

The previously shared proxy-reuse branch is preserved as annotated tag
archive/vm-global-proxy-reuse at 4e82339b8 in the Node repository (the closed
PR #65477 tip). The useful GC and dynamic-import cases from the retired
experiments now live in test/capabilities.test.cjs above.

| Original Node commit | Addon status |
| --- | --- |
| a53496abb: shared microtask queues | Ported in vm.cc |
| ad6ce57a1: reusable context handles | Ported in vm.cc |
| f2decfdd9: post-creation immutable prototypes | Replaced for Window by the creation-time integration above; the arbitrary-object operation is not ported |
| 1ce916938: retain handles with their contexts | Included in vm.cc, covered by the retained-Promise GC test |

The standalone addon suite covers queues, contexts, native global allocation,
and their lifetimes. Browlet uses
one itCompatPasses helper: an explicit-queue backend runs compatibility
expectations normally. Window global prototype-immutability and unforgeable
descriptor tests now pass under the addon. The unsupported context dynamic-import
callback test is explicitly skipped until module-loading integration. Addon tests
are not full Browlet or HTML conformance. The Stream rejection regression observes process events in its
Vitest worker, reusing the loaded Browlet modules. It uses the ordinary unit
timeout and restores its event listeners after the check.
