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
| Separate execution threads | `JSThread` and `JSThreadEndpoint` hide Node threads, initialization data, native messaging, and teardown; Browlet owns worker startup and task admission |
| Transferable channels | `JSMessageChannel`/`JSMessagePort` retain native queues and peer connections across isolates; thread startup and sends accept explicit endpoint/ArrayBuffer transfer lists |
| Buffers and collection iterators | Native length-mode query and callback iterators are available with the corresponding V8 patches |
| Shared-buffer allocation | Destination-realm objects share the existing backing store through the addon or stock Node's temporary MessagePort path |
| Object-brand checks | Native WeakRef and patched FinalizationRegistry predicates; captured-intrinsic fallbacks where unavailable |

These foundations enabled Fetch. Finishing every engine hook is not a
prerequisite for returning to HTML. Script records, browser security, and full
Agent semantics are not implied by native queue/context support.

## Next consumers

### Optimized Promise-job snapshots

The intermittent native crash reproduced during the 2-3 November consolidations
was reduced to a standalone async completion and repaired on 4 November in
`f9a21bb8`. Promise enqueue now captures the context identities and job kind it
uses, without requesting unused script metadata. Callback registration retains
its metadata capture. No engine patch or expected-failure classification was
needed for this repair.

The [Experimental report](../../node-compat/experimental/optimized-job-snapshot/README.md)
links the reproducer, old/new results on the same engine, focused six-runtime
validation, three native suites, and passing rejection/registration follow-ups.
The [evidence archive](../../node-compat/experimental/optimized-job-snapshot/evidence/2026-11-04/README.md)
retains exact commands, binary identities, terminal captures, and the original
JSON reporter's misleading success flag after a worker crash. The precise
engine-internal cause remains unproven; the bounded repair removes our unused
query rather than establishing that all stack inspection is safe.

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

Custom hooks expose the incumbent and retained VM compilation at registration.
The addon resolves its private import-loader identity; JS Engine passes the code
object without exposing the opaque metadata to HTML. HTML associates classic and
source-text compilations with their records, saves that script in each JobCallback,
and restores its context around invocation, including exception cleanup. Missing
metadata uses the modeled stack; foreign/unassociated code does not inherit its
script. This observes registration, including after module await, without tracking
every arbitrary V8 frame or module continuation on the HTML stack.

An opt-in native function entry now captures the incumbent before the JavaScript
helper behind a Web IDL operation runs. `Window.postMessage()` uses it on all addon
bases; stock Node retains its attribution limit. The host scopes the observation
on its modeled stack without inventing ScriptOrModule provenance. Other platform
surfaces, implicit author calls, and complete callback/job restoration still need
their own consumers and regressions; this is not arbitrary frame interception.

### Inline event-handler compilation

HTML §8.1.8.1's [current-value algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#getting-the-current-value-of-the-event-handler)
needs realm-owned FunctionBody parsing, target-realm syntax errors, an explicit
document/form/element scope chain where applicable, source locations, and null
ScriptOrModule identity. `JSRealm.compileFunction(body, parameters, options)` now
uses public V8 `CompileFunction`/`SetName` on addon contexts and Node's
`vm.compileFunction` on stock contexts. Its pending signature review marks the
extraction of compilation from HTML's larger algorithm. It bypasses eval policy,
preserves live object scopes and unscopables, and gives syntax errors the selected
realm. The addon registry reports null HTML ScriptOrModule identity for these
functions; explicit Node-shaped import callbacks still receive the function.
Proxy scopes use the addon's validated declaration/eval factory because V8's
direct compiler rejects them. It preserves exact named source, live lookup and
receivers without a persistent self binding. The private compilation call restores
author eval policy; the captured scope owns import metadata and its lifetime.
Stock Node cannot retain the function name in source text; the approved expected
failure is recorded in [LIMITATIONS](../LIMITATIONS.md#runtime-selection). The
[HTML handler owner](../browlet/scripting/ROADMAP.md#html-8181-event-handler-idl-invocation)
retains raw values, lifecycle, policy checks, and callback Binding integration.
Element/Document scope integration is connected. Form-owner discovery and precise
exception-source extraction remain owning HTML dependencies. No Node/V8 patch was added.

### Promise rejection lifecycle

Pip's rejection bridge is integrated on all addon bases. The executing context
selects the environment through realm hook installation, and captured compilation
metadata identifies the rejecting/handling script when available. Native
`isPromiseHandled()` and `getPromiseResult()`
read slots without installing reactions. HTML schedules notification at its
checkpoint and delivers `unhandledrejection`/`rejectionhandled` as global tasks.
Internal sandboxes and unrelated Node contexts retain Node's reporting.

Stock Node still lacks these facilities; its integration assertions are approved
expected failures. Ordinary calls between retained scripts now select the
executing function's compiled code for classic muting. Compilation identity is
independent of dynamic-import support and survives adapter reloads. Missing
metadata keeps the modeled running-script lookup; unrecognized code selects no
HTML script. This is not complete attribution across arbitrary async resumptions
or security-token boundaries. Job callback restoration remains separate.
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
preserves Node's own imports. JS Engine forwards these options, and HTML registers
its loader when `realm.supportsDynamicImport` is true. The callback's Module or namespace result is normalized on
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
JSRealm compilation forwards the optional initializer, and
`realm.supportsImportMeta` exposes its availability for that context. HTML now
registers its exact source-text record's `HostGetImportMetaProperties` operation,
supplying `url` and `resolve` lazily. Stock VM modules and custom/compat pass the
integration tests; official compat bases preserve ordinary compilation without
the unavailable initializer and retain the approved expected failures.

HTML's static `HostLoadImportedModule` now connects module maps, specifier
resolution, Fetch, import attributes, and supplied-graph linking. The modeled
graph loader retains pending/visited state and successful dependency records;
its `InternalPromise` completion enters the existing HTML graph algorithms. HTML's
`HostGetSupportedImportAttributes` now declares `"type"` support; the VM API and
addon preserve parsed attributes for the host's loading checks. Static loading
rejects unsupported keys; the dynamic callback rejects unsupported keys after
native argument evaluation and attribute-value conversion have completed.
Import metadata needs no active-script reconstruction: its initializer
retains the module record even when called after top-level await.
Dynamic-import routing now retains the exact Script/Module referrer or uses a
realm fallback, then loads, links, and waits for evaluation through internal
promises. A native Promise for the engine Module crosses the Node callback boundary;
Node owns the final namespace conversion. Host-created Function/eval code with
Node metadata continues to use Node's loader, even with a Window-owned constructor.
`JSRealm.compileWebAssemblyModule()` now connects the addon's retained Wasm record
to HTML parsing and the existing supplied-graph linker. A host instance factory
allows HTML to apply callback lifecycle without JS Engine knowing browser policy.
Stock Node has no public Wasm VM class and still rejects this operation explicitly.
HTML now connects static and dynamic source-phase URL imports. The optional
`getSource` callback supplies its projected Module while `.source` retains the
private native backing; default addon behavior stays unchanged. Source imports
do not traverse dependencies or evaluate. Deferred imports and object-valued
source-to-record lookup remain separate dependencies. Static source imports
work on every addon base; dynamic source imports also require the existing
Node dynamic-import forwarding export (currently custom/compat).
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
Wasm parsing and string-compilation policy remain separate integration work.
The browser clock is connected for ordinary Windows within the limits below.
Preserve Node's own dispatch and each
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
official addon bases retain approved expected failures for its absence.
`JSRealm.setModifyCodeGenerationFromStringsCallback()` anchors installation to a
captured intrinsic in the retained context. Window composition now installs
Binding-owned TrustedScript extraction for `HostGetCodeForEval`; native eval keeps
its lexical scope and function identity. HTML now connects CSP source-list checks
and reporting through the same callback; its earlier Trusted Types validation is
still unfinished. Do not infer full HTML inputs from source prefixes. See the
[HTML audit](../browlet/scripting/ROADMAP.md#html-816-javascript-host-hook-audit)
and [native contract](../../node-compat/README.md#string-compilation-and-source-extraction).

Temporal's addon callback is an internal, synchronous, nonthrowing clock returning
signed 64-bit bigint nanoseconds. This follows the native clock boundary in the
browser implementations; it does not supply general JavaScript exception
propagation. Violating the callback contract is a fatal internal error, with no
fabricated reading. Context ownership, removal, collection, signed timestamps,
and native-method identity are covered by the maintained tests. See the
[clock contract and browser evidence](../../node-compat/README.md#temporal-clock).
`JSRealm` exposes the existing setter using a captured intrinsic as its context
anchor. HTML installs its environment-owned wall-clock calculation for Windows
in every isolation mode, including live precision selection,
nanosecond rounding, and the full Temporal Instant clamp. Default global
descriptors are read through the realm's captured Reflect intrinsic: collecting
Temporal's lazy descriptor through Node's Reflect initialized Node-owned methods,
which read Node's clock despite installation on the Window context.
The regression verifies namespace and function prototypes on stock and addon
backends where Temporal is enabled. HTML tests cover borrowing and navigation.
The [VM-only follow-up](../../node-compat/experimental/temporal-callback/README.md#lazy-initialization-and-realm-ownership)
also reproduces wrong-realm initialization of `Date.prototype.toTemporalInstant`
when Node inspects its lazy descriptor, even after Temporal's global was initialized
correctly. `JSRealm` now initializes both known lazy Temporal properties through
its captured `reflectGetOwnPropertyDescriptor` during construction, before Node
can inspect them. No additional VM script, native bridge, or prototype traversal
is needed. Regressions cover host inspection and page-visible Instant identity;
Node 24 retains its approved disabled-Temporal availability failures. The raw
Node reproducers remain ordinary failures, alongside passing realm-owned Reflect
controls, to distinguish the upstream behavior from Browlet's correction.
Concrete isolation uses the live Document activity and Permissions Policy checks,
including reports; registration does not query policy before Document attachment.
The HTML tests cover allowed, denied, report-only, and retained inactive clocks.
The full Temporal
Instant range exceeds the callback's accepted signed-int64 result. See the
[HTML clock audit](../browlet/scripting/ROADMAP.md#8165-temporal-clock-calculation-and-installation-boundary).
Do not bypass the policy query or silently replace the specified clamp with int64.

Eric approved retaining demonstrated gaps as expected failures during adoption,
without expanding this work into further engine patches. Mutable Wasm global
live bindings and v128 export initialization remain expected failures. The addon
now repairs native-global identity through JavaScript re-exports using a guarded
private-layout hack on reviewed Windows x64 engines; unreviewed builds retain
that third limitation. Keep the Node-only controls, which still reproduce all three.
Likewise retain the four [string-compilation hook failures](../../node-compat/experimental/compile-strings/README.md):
eval/Function distinction, original parameter boundaries, TrustedScript argument
identity, and the implicit untrusted empty body. These now run as approved expected
failures in the maintained [gap suite](../../node-compat/test/code-generation-gaps.test.cjs).
Keep specification expectations, record the responsible boundary, and revisit
them with the relevant consumer or upstream API change. Wasm's assertions
and their Node-only controls run in the maintained
[gap suites](../../node-compat/test/wasm-gaps.test.cjs). The
[addon contract](../../node-compat/README.md#webassembly-modules) records the
generated-module mechanism and its limits; ordinary imports, functions, immutable
globals, memory/tables, cycles, top-level await, and collection have passing tests.

Implement these with their consuming feature, rather than adding inert hooks:

| Missing boundary | Consumer and completion condition |
| --- | --- |
| `HostEnsureCanCompileStrings` | CSP source-list checks/reporting are connected; preceding Trusted Types validation retains the four documented engine-input gaps |
| `HostEnqueueFinalizationRegistryCleanupJob` | Context exception reporters repair the confirmed cleanup reporting defect on addon bases; stock mode and the official fallback's abort flag retain expected failures. V8 retains queued cleanup and cell ownership; broader HTML integration has no separate demonstrated author-visible scheduling failure. Require behavioral evidence before adding an engine handoff; see the [HTML audit](../browlet/scripting/ROADMAP.md#81662-finalizationregistry-cleanup-scheduling) |
| Kept-object cleanup control | Native checkpoints already clear kept objects; resolve HTML's [ordering and Agent isolation questions](../browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint) |
| `HostSystemUTCEpochNanoseconds` | Windows install the HTML clock in every isolation mode through the existing setter; custom/compat is required and timestamps must fit the native int64 range |
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

Generic/timeout hooks are isolate-wide but can decline individual jobs with
`false`. HTML uses that result for unrelated Node/VM realms; V8 retains native
notification delivery and its original cancelable timeout task. The
[ownership regression](../../test/browlet/scripting/atomics-ownership.test.ts)
requires ordinary progress with Browlet installed on every runtime base.
Browser-origin access checks and
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
