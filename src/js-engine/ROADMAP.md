# JS Engine roadmap

Current contracts live in the [README](README.md); backend constraints live in
[LIMITATIONS.md](../LIMITATIONS.md). This roadmap tracks missing engine facilities
and their first platform consumers. Follow [project priority](../PRIORITY.md)
when scheduling that work.

## Scope and completed foundations

The source inventory begins with HTML's [JavaScript dependencies](https://html.spec.whatwg.org/multipage/infrastructure.html#dependencies)
and [host hooks](https://html.spec.whatwg.org/multipage/webappapis.html#javascript-specification-host-hooks).
The earlier audit at HTML revision `24c5e48bf66e` classified all 146 imported
ECMA-262 terms plus adjacent TC39 proposals. Use that source for the full list;
ordinary evaluation, grammar, intrinsics, and object operations remain V8 work.
Only terms requiring a new embedding boundary belong in this plan.

| Foundation | Current state |
| --- | --- |
| Agent microtask queues | Explicit queues shared by an Agent's realms; plain Node retains the ambient fallback |
| Context/global lifecycle | Native Window allocation, immutable prototypes, stable proxy identity, and navigation reuse are integrated |
| Realm facts | Native object and ordinary/bound/proxy function lookup; bounded evidence on plain Node |
| Promise and job hooks | Custom engine/addon captures registrations and supplies make/call plus Promise, generic, and timeout enqueue; HTML consumes all five |
| Portable execution | Implementations retain `env`; internal Promise continuations keep their owner and Node work keeps its native queue |
| Buffers and collection iterators | Native length-mode query and callback iterators are available with the corresponding V8 patches |

These foundations enabled Fetch. Finishing every engine hook is not a
prerequisite for returning to HTML. Script records, browser security, and full
Agent semantics are not implied by native queue/context support.

## Next consumers

### Classic scripts and host entry

Integrate HTML Script records with `ParseScript`/`ScriptEvaluation`, settings, source
metadata, errors, and `GetActiveScriptOrModule`. The existing `JSRealm.evaluate()`
entry and parser ScriptHandler do not constitute the formal classic-script
pipeline. [Scripting](../browlet/scripting/ROADMAP.md) owns that pipeline;
[loader](../browlet/loader/ROADMAP.md) owns fetching and resource lifetime.

Custom hooks expose incumbent registration and opaque script metadata. Connect
those to actual Script records and restore them around callbacks. The existing
HTML stack mirrors controlled entries, not every arbitrary V8 frame.

A separate unresolved boundary is the JavaScript helper behind a Web IDL
operation: browsers enter a built-in function without adding an author script
frame, while Browlet's helper can become the topmost script-having realm.
Investigate a genuine built-in entry or transparent host-frame treatment.
Preserve borrowed/cross-realm, bound/proxy, native-entry, and reentrant cases;
constructor correctness alone does not settle incumbent/script selection.

### Promise rejection lifecycle

Add `HostPromiseRejectionTracker`, per-global rejected-promise state,
`unhandledrejection`, and `rejectionhandled` after script/settings ownership is
established. Node's process-wide rejection events do not supply HTML's required
per-realm context. Test unrelated Node rejections and runner shutdown as well
as page events; routing diagnostics onto an HTML queue previously prevented exit.

### Modules and dynamic import

Connect engine module parse/link/evaluate with HTML module maps, Fetch, import
attributes, `import.meta`, and classic/worker/module consumers. Fetch now exists;
module records, resolution policy, and script integration remain the dependencies.
Wire `HostLoadImportedModule`, `HostGetImportMetaProperties`, and
`HostGetSupportedImportAttributes` through that pipeline.
Include JSON, text, and synthetic modules when their specified consumers arrive.

The addon still lacks context-level dynamic-import callbacks. Re-enable the
approved skipped case in [capabilities.test.cjs](../../node-compat/test/capabilities.test.cjs)
when that contract exists. Node's existing `Promise.resolve(...).then(eval)`
module tests do not prove backup-incumbent restoration: they also pass without
our hook patches.

## Other engine hooks and facts

Implement these with their consuming feature, rather than adding inert hooks:

| Missing boundary | Consumer and completion condition |
| --- | --- |
| `HostEnsureCanAddPrivateElement` | WindowProxy/Location private-field policy; V8 must recognize the actual platform identities |
| `HostEnsureCanCompileStrings` | CSP checks for eval/Function-family compilation; existing CSP algorithms need an engine interception point, not just a coarse VM switch |
| `HostGetCodeForEval` | TrustedScript extraction when Trusted Types and its engine hook are available |
| `HostEnqueueFinalizationRegistryCleanupJob` | HTML cleanup tasks and script bracketing; capturing a registry callback does not control collection or cleanup scheduling |
| Kept-object cleanup control | Native checkpoints already clear kept objects; resolve HTML's [ordering and Agent isolation questions](../browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint) |
| `HostSystemUTCEpochNanoseconds` | Temporal's relevant-settings clock; the current host clock does not install this engine hook |
| Active function and arbitrary execution stack | Custom-element construction and script context; only controlled entries/NewTarget are currently visible |
| Exact Promise primitives | Patch V8 to expose reaction attachment without a result Promise, then use it in the addon's `observePromise`; expose the existing `MarkAsHandled` API and remove constructor/species fallbacks |
| Buffer and exotic internal slots | Non-destructive detach-key checks, detached-view length, and exact exotic/Error state needed by structured data |

For the last two rows, preserve the tests and replacement conditions in the
[limitations catalog](../LIMITATIONS.md), rather than inventing stronger answers
from the existing probes. Broaden the inventory for a new Web IDL or platform
consumer only when it introduces an additional engine requirement.

## Agent and isolation coupling

HTML's Agent/AgentCluster objects correctly own browser state, but they do not
configure V8 Agent Records. `canBlock` and `signifier` currently describe intended
properties without enforcing them in the engine. A Window VM can still call
`Atomics.wait()`. Cluster checks protect Browlet algorithms but cannot prevent
arbitrary sharing of a native SharedArrayBuffer through an exposed host value.
Native queues solve scheduling separation, not those execution/memory controls.

Establish actual isolate/worker topology and engine controls with Workers and
cross-origin isolation. Do not add inert lock-free fields. The earlier audit
also found HTML's agent initialization omitted ECMAScript's `[[IsLockFree8]]`;
recheck that upstream discrepancy when implementing the Agent coupling.

Generic/timeout hooks are isolate-wide and cannot reject individual jobs.
Supporting unrelated Node/VM Atomics.waitAsync while HTML installs these hooks
needs an explicit routing/fallback contract. Browser-origin access checks and
nested contexts remain with [Window](../browlet/browsing/window/ROADMAP.md).

## Retained investigation evidence

The independent experimental repository retains the
[incumbent signal matrix](../../node-compat/experimental/node-promise-hooks/signal-matrix.md).
It rejected current-context, entered-context, fixed-frame-depth, and untrusted
cross-token lookup as general incumbent signals. The adopted candidate compares
the newest debuggable script frame with BackupIncumbentScope, then falls back to
the entered/microtask context. Application ALS must survive capture unchanged.
These results establish a bounded substrate, not completed HTML Script records.

The regular Node checkout's `v8-patches` branch holds the active engine changes.
`browlet-node-compat-history` and `codex/promise-job-handles` preserve earlier
experiments; their callback APIs are not interchangeable with the active addon.
Do not revive ambient ownership or saved-context inference as a substitute for
the job's actual queue owner.

## Acceptance

For each new boundary, identify the normative consumer, engine versus host
responsibility, required capability, observable limitation, and focused tests.
A host-hook-shaped function that V8 never calls is not an implementation.
Exercise registration and execution across realms, ordinary page completion,
unrelated Node progress, teardown, and applicable fallback paths.

Use [engine tests](../../test/js-engine/), [native tests](../../node-compat/test/),
and [HTML Promise-job tests](../../test/browlet/scripting/promise-jobs.test.ts)
for their respective layers. Keep unsupported expectations visible until an
approved capability or owner integration closes them.
