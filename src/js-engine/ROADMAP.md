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
| Shared-buffer allocation | Destination-realm objects share the existing backing store through the addon or stock Node's temporary MessagePort path |
| Object-brand checks | Native WeakRef and patched FinalizationRegistry predicates; captured-intrinsic fallbacks where unavailable |

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
HTML now defines script-state and partial parsed-record contracts, including
HostDefined, and active-script lookup over its modeled stack. `JSRealm.parseScript()`
compiles without execution using Node's `vm.Script` on stock contexts or a native
UnboundScript handle on addon contexts. Syntax failures belong to the target realm.
HTML retains the artifact on its Script Record and executes it through
`JSRealm.runScript()`, with modeled script-context entry and restoration.
Production script-element callers and complete source/active-script metadata
remain integration work; source evaluation does not recompile
retained artifacts.

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

Pip's rejection bridge is integrated on all addon bases. The executing context
selects `BrowletEnvironment.trackPromiseRejection(promise, operation)` through
the realm hook installation. Native `isPromiseHandled()` and `getPromiseResult()`
read slots without installing reactions. HTML schedules notification at its
checkpoint and delivers `unhandledrejection`/`rejectionhandled` as global tasks.
Internal sandboxes and unrelated Node contexts retain Node's reporting.

Stock Node still lacks these facilities; its integration assertions are approved
expected failures. Complete running-script attribution across uncontrolled
function calls and Promise jobs remains with the execution-context work; the
tracker uses the modeled running script when present, including classic muting.
Keep Node forwarding, collection, worker teardown, and job-hook coexistence tests
when extending this boundary. Another addon's replacement rejection callback
cannot be recovered through V8's public API.

### Modules and dynamic import

Source-text and default-export synthetic engine modules are integrated on all
three addon bases and on stock Node with its VM-modules flag. JSRealm exposes
compilation, requests, supplied-graph linking, evaluation, and namespaces. HTML
creates real records, projects CSS exports, and adapts native evaluation Promises
through `env.InternalPromise`. A dependency-free inline module completes HTML's
graph path. The engine tests cover cycles, live bindings, errors, pending/rejected
top-level await, realm ownership, collection, and teardown. The addon now exposes
the supported Node-shaped `Script`, `SourceTextModule`, and `SyntheticModule`
classes; the compatibility implementation needs no Node association patch.
The [supported surface](../../node-compat/README.md#contexts-globals-and-optional-facilities)
does not yet include Node's async linker or execution timeouts.

The addon accepts Node-shaped `importModuleDynamically` options on Script,
SourceTextModule, runInContext, and createContextHandle when Node exports its default import handler.
The forwarding export in the [combined patch](../../vendor/_patches/node-v8.patch)
preserves Node's own imports. This is an addon facility: JS Engine/HTML do not yet register
loaders through it. The callback's Module or namespace result is normalized on
the importing queue, without an automatic checkpoint. Tests preserve async/TLA
completion, callback exceptions, synthetic exports, referrer lifetime, collection,
and worker/Node/job-hook coexistence.

Official addon bases lack the export and retain approved expected failures.
Identical Function-created bodies also select the first script's loader on
Node 26/custom, including Node's VM API. Node 24 passes the control; custom passes
with the compilation cache disabled. Keep this as an approved expected failure
and investigate the engine separately, without disabling production caching.

The addon also accepts Node's `SourceTextModule` option
`initializeImportMeta(meta, module)`. V8 supplies lazy object creation, successful
caching, and retry after a thrown value. Private namespace state retains the
initializer and public module referrer while exported code is reachable; unused
cycles collect. The Node forwarding export already in the combined patch keeps
Node ESM and VM metadata working. Official addon bases reject the option and
retain approved expected failures. See the [callback contract and tests](../../node-compat/README.md#importmeta-initialization).
JS Engine/HTML do not yet register initializers; HTML's `url` and `resolve`
behavior remains for the host-hook audit.

Connect these operations with automatic HTML dependency loading, module maps,
Fetch, import attributes, `import.meta`, and classic/worker/module consumers.
Wire `HostLoadImportedModule`, `HostGetImportMetaProperties`, and
`HostGetSupportedImportAttributes` through that pipeline.
`LoadRequestedModules()` still throws for records with imports; Wasm ESM parsing
also remains explicit in HTML/JS Engine. The addon now supplies WebAssemblyModule
compilation, supplied-graph linking, execution, and source-phase access; connect
that bridge to the existing record/parser when resuming the HTML audit.
Module-specific active-script entry and restoration after
await need engine metadata/hooks: the current HTML runner supplies the retained
realm context, not a fictitious root-script context for every dependency.

The context callback supplies the fallback when importing code has no compilation
metadata. Explicit script/module callbacks take precedence; foreign metadata
still routes through Node. Context state retains the fallback independently of a
reusable global proxy. The replacement-realm indirect-eval regression in
[capabilities.test.cjs](../../node-compat/test/capabilities.test.cjs) is enabled.
These `Promise.resolve(...).then(eval)` cases do not prove backup-incumbent
restoration: they also pass without our job-hook patches.

### Detached-context Promise delivery

`SPEC_CLASH(detached-context-promise-assimilation)`: follow Chromium and Firefox;
adopting a detached realm's Promise can stay pending. The original expected-failure
classification assumed adoption should complete. Browser comparison did not
support treating that expectation as an established conformance requirement.
Eric accepted the Chromium/Firefox behavior on 2026-10-27; leave the runtime unchanged.

The 2026-10-27 Playwright probe retained an already fulfilled Promise and a
function returning a Promise from a same-origin iframe, then navigated that
iframe and waited for its replacement's load event. The WindowProxy stayed
identical. Both values resolved before navigation. After navigation:

| Browser | Parent `Promise.resolve()` of either old-realm Promise | Direct parent `.then()` callback | Replacement-realm Promise |
| --- | --- | --- | --- |
| Chromium 156.0.8078.4 | Pending after 150 ms | Fulfilled | Fulfilled |
| Firefox 157.0 | Pending after 150 ms | Fulfilled | Fulfilled |
| WebKit 27.2 | Fulfilled | Fulfilled | Fulfilled |

Chromium's `WindowProxy::ClearForNavigation()` calls `DisposeContext()` with
`kGlobalObjectIsDetached`; `LocalWindowProxy::DisposeContext()` calls
`ScriptState::DetachGlobalObject()`, which invokes V8's `Context::DetachGlobal()`.
V8 clears the old context's microtask queue, and `EnqueueMicrotask` drops the
thenable job when that queue is absent. Direct reactions use the live handler's
realm. This explains the observed distinction; it is not specific to imports.

The [native regression](../../node-compat/test/capabilities.test.cjs) now checks
pending adoption, direct host delivery, and the replacement context as ordinary
passing expectations on all three addon bases. Keep the browser difference
recorded; reconsider the choice if implementations converge. Navigation owns
the point of detachment, independently of import-loader routing.

## Other engine hooks and facts

Adopt Pip's completed native experiments in bounded slices. Retained classic
execution, source-text/synthetic modules, script/context dynamic-import callbacks,
import.meta initialization, the shared string-compilation/extraction bridge,
the per-context Temporal clock, and the Wasm module bridge are adopted. HTML
dynamic loading, import.meta properties, string-compilation policy, and the browser clock hookup remain separate
integration work. Preserve Node's own dispatch and each
experiment's lifetime tests. The Wasm bridge is an addon extension with the
existing Node-shaped module lifecycle; Node has no equivalent public VM class.
It remains below the JS Engine/HTML parser boundary. Static graphs require no
patch on any of the three addon bases. Dynamic source and evaluation imports use
the existing forwarding export, retaining official-base expected failures.

The addon exposes `setModifyCodeGenerationFromStringsCallback(realmReference, callback)`
with V8's `(source, isCodeLike)` inputs and string/false/undefined results.
Per-context private state supports replacement, removal, collection, and retained
functions across global-proxy reuse. Allowed/extracted code still passes Node's
checks and source-map handling. The forwarding export is in the existing patch;
official addon bases retain approved expected failures for its absence. JS Engine
and HTML do not register policies yet. Connect CSP and Binding-owned TrustedScript
recognition during the host-hook audit; do not infer full HTML inputs from source
prefixes. See the [contract and regressions](../../node-compat/README.md#string-compilation-and-source-extraction).

Temporal's addon callback is an internal, synchronous, nonthrowing clock returning
signed 64-bit bigint nanoseconds. This follows the native clock boundary in the
browser implementations; it does not supply general JavaScript exception
propagation. Violating the callback contract is a fatal internal error, with no
fabricated reading. Context ownership, removal, collection, signed timestamps,
and native-method identity are covered by the maintained tests. See the
[clock contract and browser evidence](../../node-compat/README.md#temporal-clock).
At the HTML hookup, connect the owning environment's wall clock and resolve
precision policy before registering the callback. Recheck the isolation-capability
getter after Ged's navigation work is integrated; the current branch still has an
explicit permissions-policy dependency. Do not silently bypass that dependency
inside the clock read.

Eric approved retaining demonstrated gaps as expected failures during adoption,
without expanding this work into further engine patches. Carry over the three
[Wasm failures](../../node-compat/experimental/module-records/WASM.md): mutable
global live bindings, v128 export initialization, and mutable globals re-exported
through JavaScript. Keep their Node-only controls, which reproduce all three.
Likewise retain the four [string-compilation hook failures](../../node-compat/experimental/compile-strings/README.md):
eval/Function distinction, original parameter boundaries, TrustedScript argument
identity, and the implicit untrusted empty body. These now run as approved expected
failures in the maintained [gap suite](../../node-compat/test/code-generation-gaps.test.cjs).
Keep specification expectations, record the responsible boundary, and revisit
them with the relevant consumer or upstream API change. Wasm's three assertions
and their Node-only controls now run in the maintained
[gap suites](../../node-compat/test/wasm-gaps.test.cjs). The
[addon contract](../../node-compat/README.md#webassembly-modules) records the
generated-module mechanism and its limits; ordinary imports, functions, immutable
globals, memory/tables, cycles, top-level await, and collection have passing tests.

Implement these with their consuming feature, rather than adding inert hooks:

| Missing boundary | Consumer and completion condition |
| --- | --- |
| `HostEnsureCanCompileStrings` | Connect CSP checks to the adopted interception callback; preserve the four documented engine-input gaps |
| `HostGetCodeForEval` | Connect Binding-owned TrustedScript identity/data to the adopted extraction callback |
| `HostEnqueueFinalizationRegistryCleanupJob` | HTML cleanup tasks and script bracketing; capturing a registry callback does not control collection or cleanup scheduling |
| Kept-object cleanup control | Native checkpoints already clear kept objects; resolve HTML's [ordering and Agent isolation questions](../browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint) |
| `HostSystemUTCEpochNanoseconds` | Connect the relevant environment's wall clock to the adopted nonthrowing Temporal callback; resolve precision policy before installation |
| Active function and arbitrary execution stack | Custom-element construction and script context; only controlled entries/NewTarget are currently visible |
| Exact Promise primitives | Patch V8 to expose reaction attachment without a result Promise, then use it in the addon's `observePromise`; expose the existing `MarkAsHandled` API and remove constructor/species fallbacks |
| Buffer and exotic internal slots | Non-destructive detach-key checks and exact exotic/Error state needed by structured data |

For the last two rows, preserve the tests and replacement conditions in the
[limitations catalog](../LIMITATIONS.md), rather than inventing stronger answers
from the existing probes. Broaden the inventory for a new Web IDL or platform
consumer only when it introduces an additional engine requirement.

## Private elements on host objects

`SPEC_CLASH(html-private-elements)`: Browlet leaves `HostEnsureCanAddPrivateElement`
unimplemented and does not enforce HTML's WindowProxy/Location rejection. This follows
Chromium 156.0.8078.4, which accepted private fields, methods, and accessors on
both objects in the 2026-10-26 probe. HTML requires TypeError; Firefox rejects
them.

A working prototype cost about 116 ms per million constructions with a JavaScript
callback versus 11 ms before; even the no-hook path added overhead. The engine
and addon prototypes are saved on `research/private-element-hook` branches in
their respective repositories, outside the active runtime. The independent
experimental repository retains the [probes and findings](../../node-compat/experimental/private-element-hook/RESULTS.md).
Revisit if an upstream facility provides an inexpensive host-object restriction.

## Buffer-source byte length

`SPEC_CLASH(webidl-buffer-source-byte-length)` follows current intrinsic lengths
instead of Web IDL's literal raw `[[ByteLength]]` access. Valid fixed views retain
their declared size; length-tracking views follow the current buffer size.
Detached or out-of-bounds typed arrays report zero. DataViews in those states
request a realm-neutral TypeError. Captured getters bypass author properties.

Web IDL's [byte-length definition](https://webidl.spec.whatwg.org/#buffersource-byte-length)
still reads the raw slot, which can be `auto` for length-tracking views; see
[issue 1385](https://github.com/whatwg/webidl/issues/1385). The 2026-10-05 Chromium,
Firefox, and WebKit probes agreed that detached input produces TypeError in
Streams, empty decoding, zero-count TextEncoder writes, and DataCloneError in
structured cloning. Those consumers need current storage state, not the old
fixed-view length. The [buffer tests](../../test/js-engine/buffers.test.ts) cover
growth, out-of-bounds views, recovery, and detachment; the integration regressions
cover the consuming API policies and error realms.

Revisit when the specification defines updated operations or a concrete consumer
needs stored metadata. Such metadata would require a distinct operation rather
than changing the current-length helpers to return obsolete sizes.

## Agent and isolation coupling

HTML's Agent/AgentCluster objects correctly own browser state, but they do not
configure V8 Agent Records. `canBlock` and `signifier` currently describe intended
properties without enforcing them in the engine. A Window VM can still call
`Atomics.wait()`. Cluster checks protect Browlet algorithms but cannot prevent
arbitrary sharing of a native SharedArrayBuffer through an exposed host value.
Native queues solve scheduling separation, not those execution/memory controls.

Agent lock-free and byte-order fields now report immutable observations of
this runtime; they do not configure it. They include ECMAScript's
`[[IsLockFree8]]`, which HTML's initialization list still omits. CandidateExecution
remains the engine's memory-model machinery rather than a fabricated host log.

Agent execution-control research is parked on `research/html-agent-execution` while the
[HTML §8 audit](../browlet/scripting/ROADMAP.md#html-811812-audit) proceeds.
Establish actual execution topology and engine controls with their consuming
features. The Window Atomics.wait regression in
[agents.test.ts](../../test/browlet/scripting/agents.test.ts) is an approved
expected failure; replace it with a normal test when enforcement exists.
Worker/worklet cluster allocation is bookkeeping, not a working worker backend.

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
