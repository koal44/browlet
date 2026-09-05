# Node compatibility

Native support for Browlet's engine backend. The first addon ports shared
microtask queues and detachable/reusable context handles onto stock Node
24.19.0, including the context/queue lifetime fix. Post-creation immutable
prototypes remain unavailable through the addon.

| Facility | Stock Node | Stock + addon | Original source patches |
| --- | --- | --- | --- |
| Explicit shared microtask queues | No | Yes | Yes |
| Context handles and reusable global proxies | No | Yes | Yes |
| Make an existing global's prototype immutable | No | No | Yes |

## Build and run on Windows x64

Preparation verifies the official Node 24.19.0 headers and import library;
it does not replace the installed Node executable. Building requires Visual
Studio's Desktop development with C++ workload. The build reuses an x64
developer prompt, honors VSINSTALLDIR, or discovers the installed C++ tools
with vswhere. VsDevCmd initializes the compiler and Windows SDK environment.

```powershell
& node-compat/scripts/prepare-node.ps1
& node-compat/scripts/build-addon.cmd
node --expose-gc --test node-compat/test/capabilities.test.cjs
npm.cmd run with-node -- --runtime addon test:unit
```

`addon` selects the stock executable through `BROWLET_STOCK_NODE` and supplies
the absolute `BROWLET_NODE_ADDON` module path to Browlet. `stock` selects plain
Node. `compat` remains an optional route to a separately built source-patched
executable; that older binary is not part of this addon baseline. An addon build
must match the chosen runtime's native ABI; this baseline is tested on Windows
x64, Node 24.19.0. No dependency on experimental/ is needed to build.

The build generates addon/build/compile_commands.json with the actual compiler,
headers, SDK paths and C++20 options. The repository's VS Code C/C++ settings
use that database for each source file. Machine-specific paths stay in ignored build
output. Rebuild after changing the installed compiler or header directory.

## Scope

The addon exports createMicrotaskQueue(), createContextHandle(), runInContext()
and isContext(). Its contexts are native V8 contexts registered with Node,
not node:vm Contextify objects. NodeRuntime routes evaluation through the
selected backend; node:vm itself is not modified.

This supports Browlet's current context creation and script evaluation needs,
not the entire vm API. Context options are microtaskQueue and
reuseGlobalProxyFrom; evaluation supports filename, lineOffset and
displayErrors: false. Timeouts, code-generation controls, dynamic-import
callbacks, vm.Script interoperability and automatic afterEvaluate checkpoints
are not implemented. Unsupported options are rejected. Existing HTML
WindowProxy/origin accommodations and Promise host-hook gaps remain.

The addon does not replace V8's isolate Promise hook or overwrite CPED. Node's
context registration preserves its Promise hooks; tests cover hooks installed
after context creation and ALS transport. Each worker owns its native state.

## Files and local state

- addon/: one native backend and its JS entry point. addon.cc registers the
  binary; vm.cc owns queues, contexts and their shared lifetime management.
  Add distinct features in their own C++ source files and initialize them from
  addon.cc. Separate binaries are useful for independently loadable components,
  not required for separate features or upstream commits.
- test/: standalone behavior and GC regressions plus a quick startup check.
- scripts/: verified header preparation and addon compilation.
- experimental/: an ignored, independent Git repository for investigation.
- .cache/: downloaded headers and node.lib, extracted build inputs, and local
  test output. It can be recreated with prepare-node.ps1.

The original Promise investigation is now experimental/node-promise-hooks/.
Its imported Git baseline is b1bcdfb. The original four Node commits remain on
the Node checkout's browlet-compatible-node branch at 1ce916938. They comprise
three features and a lifetime fix. The unused patch exports and their temporary
verification checkout have been removed; this build consumes neither.

| Original Node commit | Addon status |
| --- | --- |
| a53496abb: shared microtask queues | Ported in vm.cc |
| ad6ce57a1: reusable context handles | Ported in vm.cc |
| f2decfdd9: post-creation immutable prototypes | Not ported; creation-time alternative investigated in experimental/immutable-prototype/ |
| 1ce916938: retain handles with their contexts | Included in vm.cc, covered by the retained-Promise GC test |

The standalone addon suite covers the two implemented features. Browlet uses
one itCompatPasses helper: an explicit-queue backend runs compatibility
expectations normally. The addon therefore has a known failing Window global
prototype-immutability test. A passing addon suite is not full Browlet or HTML
conformance. The intermittent subprocess-test timeout is still under
investigation; reducing workers has not established a fix.
