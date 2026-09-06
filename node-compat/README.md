# Node compatibility

Native support for Browlet's engine backend. The first addon ports shared
microtask queues and detachable/reusable context handles onto stock Node
24.19.0 and 26.8.1, including the context/queue lifetime fix. Post-creation immutable
prototypes remain unavailable through the addon.

| Facility | Stock Node | Stock + addon | Original source patches |
| --- | --- | --- | --- |
| Explicit shared microtask queues | No | Yes | Yes |
| Context handles and reusable global proxies | No | Yes | Yes |
| Make an existing global's prototype immutable | No | No | Yes |
| Allocate an immutable global and prototype chain | No JS API | Opt-in prototype | Not needed by original route |

## Build and run on Windows x64

Preparation verifies the official executable, headers and import library for
the selected version. Building the addon requires Visual
Studio's Desktop development with C++ workload. The build reuses an x64
developer prompt, honors VSINSTALLDIR, or discovers the installed C++ tools
with vswhere. VsDevCmd initializes the compiler and Windows SDK environment.

```powershell
# Prepare once; ordinary addon rebuilds reuse these files.
& node-compat/scripts/prepare-node.ps1 -Version 24.19.0
& node-compat/scripts/build-addon.cmd --base 24.19.0
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
npm.cmd run test:unit -- test/js-engine/unit/node-runtime.test.ts
```

The C++ code selects the callback API using `NODE_MAJOR_VERSION` from the target
headers. To prepare and target Node 26:

```powershell
& node-compat/scripts/prepare-node.ps1 -Version 26.8.1
& node-compat/scripts/build-addon.cmd --base 26.8.1
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

Preparation is separate from compilation. Rerun it when setting up a version
or restoring removed development files. It verifies the pinned release hashes
and extracts headers using a temporary archive, which it then deletes.

## Node engine work

Edit and build Node/V8 in the regular checkout named by `CUSTOM_NODE_SOURCE`.
Do not create Node checkouts or engine builds under node-compat or .cache.
The custom base uses `out/Release/node.exe`, `out/Release/node.lib`, and the
headers in `src`, `deps/v8/include` and `deps/uv/include` directly from that
checkout. Nothing is copied or linked into Browlet's cache.

After building the Node engine there, build only the addon here:

```powershell
& node-compat/scripts/build-addon.cmd --base custom
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

The duplicate node-capture worktree and its old build have been removed. Its
two V8 commits are preserved on v8-patches, rebased onto
6f41e4156 as 5872d7a4a and 9c176d2fd. The 2026-09-05 rebuild includes the
FinalizationRegistry capture continuation and passes the Promise and
FinalizationRegistry acceptance suites. See
experimental/node-promise-hooks/finalization-registry.md for the results and
the remaining cross-security-token script-metadata limitation.

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
WindowProxy/origin accommodations and Promise host-hook gaps remain.

The standalone suite retains two cases from the retired Node proxy-reuse
experiments: collecting the old realm while the replacement remains live
passes; indirect eval selecting its realm's dynamic-import callback is an
ordinary failing test. It currently fails because createContextHandle rejects
importModuleDynamically, before callback routing can be tested. Keep that
acceptance case for future module-loading integration; it does not require
implementing the entire vm API.

The addon does not replace V8's isolate Promise hook or overwrite CPED. Node's
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
`test/browlet/unit/browsing/native-global.test.ts`. It covers real Window and
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
  Add distinct features in their own C++ source files and initialize them from
  addon.cc. Separate binaries are useful for independently loadable components,
  not required for separate features or upstream commits.
- test/: standalone behavior and GC regressions plus a quick startup check.
- scripts/: verified header preparation and addon compilation.
- experimental/: an ignored, independent Git repository for investigation.
- .cache/node-v24.19.0/: Node 24 headers, Release/node.lib and node.exe.
- .cache/node-v26.8.1/: Node 26 headers, Release/node.lib and node.exe.
  These are replaceable dependencies prepared by scripts/prepare-node.ps1,
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
callback remains an ordinary failing standalone test. Addon tests are not full Browlet or HTML
conformance. The Stream rejection regression observes process events in its
Vitest worker, reusing the loaded Browlet modules. It uses the ordinary unit
timeout and restores its event listeners after the check.
