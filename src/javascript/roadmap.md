# JavaScript embedding roadmap

This roadmap records the boundary between the JavaScript engine, its embedder,
and the web-platform specifications implemented by Browlet. It begins with the
ECMAScript dependencies imported by HTML, then can absorb concrete consumers
from Web IDL, DOM, Streams, Fetch, and later specifications as they appear.

The goal is not to reimplement ECMAScript §9 in TypeScript. The goal is to
stop treating all ECMAScript references alike:

- language evaluation and engine-owned state remain with V8;
- supported JavaScript operations use captured, realm-correct intrinsics;
- facts or hooks exposed by the embedder enter through the JavaScript runtime;
- unavailable engine facilities receive one bounded accommodation or one
  explicit limitation; and
- HTML retains the agent, realm-counterpart, script, task, and event-loop
  policy which consumes those facilities.

Do not add a runtime operation merely because HTML links to an ECMAScript
abstract operation. First prove that Browlet, rather than V8, must invoke or
observe it. Names for any new runtime surface are a design decision to review
before implementation; this inventory does not preselect TypeScript method
names.

## Source inventory

The audit is seeded from HTML §2.1.9's
[JavaScript dependencies](https://html.spec.whatwg.org/multipage/infrastructure.html#dependencies).
At local WHATWG HTML revision `24c5e48bf66e`, that block declares 146 ECMA-262
terms. The full source contains only three substantive direct ECMA-262 links
outside the block: a repeated `TypeError` link and explanatory links to
`NewPromiseReactionJob` and `NewPromiseResolveThenableJob`. Section 2.1.9 is
therefore the canonical inventory rather than merely a sample.

The same dependency subsection adds six named terms from adjacent TC39
proposals: `HostEnsureCanCompileStrings`, `HostGetCodeForEval`,
`CreateTextModule`, `HostSystemUTCEpochNanoseconds`, `nsMaxInstant`, and
`nsMinInstant`. It also requires ECMA-402 without enumerating individual
operations. Those dependencies belong in the audit when their first HTML
consumer arrives.

### Status vocabulary

| Status | Meaning |
| --- | --- |
| **Delegated** | V8 performs the operation while evaluating JavaScript; Browlet neither needs nor should reproduce it. |
| **Available** | A supported JavaScript or Node API can supply the required behavior, usually through captured per-realm intrinsics. |
| **Bounded** | Browlet can preserve the behavior for entries or objects it controls, but cannot observe the complete engine state. |
| **Unavailable** | Stock Node exposes neither the required fact nor the engine-to-host interception point. |
| **Deferred** | The first web-platform consumer or a supported Node substrate is not present yet. |

“Unavailable” is not permission to invent a result. The consuming
specification must either remain unimplemented, expose a tested limitation, or
use an accommodation whose narrower contract is stated explicitly.

### Runtime profiles

Availability is no longer one undifferentiated Node answer:

| Facility | Browlet-compatible Node | Stock Node |
| --- | --- | --- |
| Microtask queue | An explicit V8 queue with `enqueueMicrotask()` and `runMicrotasks()`, created once per HTML EventLoop and shared by all realms of its Agent | The isolate's one ambient queue, entered through `queueMicrotask()` and drained through the `_tickCallback()` accommodation |
| Context and reusable VM global proxy | `vm.createContextHandle()` returns an opaque handle and stable `globalProxy`; detachment retires the handle, and passing that handle once as `reuseGlobalProxyFrom` creates a fresh Realm and backing global with the same proxy identity. `vm.makePrototypeImmutable()` seals the current backing global after projection. Handle contexts use Node's ordinary principal token for embedder access, not browser origin policy. | A fresh private VM global is bridged to Browlet's modeled global graph. |

The explicit queue and `ContextHandle` substrates are implemented in the
compatible-Node branch. Queue ownership still is not
`HostEnqueuePromiseJob`: V8 does not give Browlet each job closure, its Realm
Record, or the callback preparation boundary. `ContextHandle` supplies
context/proxy identity, explicit detach/reattach, and post-projection
immutable-prototype ordering. It deliberately retains Node VM's principal-token
accessibility so JavaScript embedder code can configure the context; it does
not implement WindowProxy origin policy or V8 cross-origin access callbacks.
V8 also cancels jobs still queued for a detached Realm. The current slice is
Browlet adoption: expose the correct Web IDL global through the stable proxy,
checkpoint before navigation replacement, and complete
`[[PreventExtensions]]`, same- and cross-origin access, old-Realm behavior, and
navigation tests.

`vm.makePrototypeImmutable()` currently patches Node's vendored V8 by adding
`v8::Object::SetImmutableProto()`. Its upstream path begins in V8; Node can
expose it without carrying a V8 patch only after the V8 revision rolls into
Node. Treat the local API as a behavioral prototype: if V8 settles on a
different contract, adapt the compatible-Node layer rather than preserving the
experimental shape.

## Working boundary matrix

### Observable engine facts

| ECMAScript term | Principal HTML consumer | Current Browlet treatment | Status |
| --- | --- | --- | --- |
| realm, current realm, `GetFunctionRealm` | HTML §§2.7, 7.2.1, 8.1.3, and 8.1.6.6.4 | `NodeRealm` owns known realms; `NodeRuntime` records object-to-realm evidence and the active `evaluate()` realm. It cannot read arbitrary objects' `[[Realm]]`. | **Bounded** |
| active function object and NewTarget | HTML customized built-in element construction | Browlet-created functions receive `newTarget`; the active function object of arbitrary V8 execution is inaccessible. | **Bounded**, consumer deferred |
| JavaScript execution context, its stack, and the running context | HTML §§8.1.3–8.1.4 and job callbacks | `EventLoop` mirrors only script/callback entries Browlet controls. It cannot inspect V8's stack or prove an unseen Promise job has exited. | **Bounded** (`node-v8-execution-contexts`) |
| `GetActiveScriptOrModule` | HTML §8.1.4.1 active script and module loading | No supported Node API exposes an arbitrary execution context's `ScriptOrModule`. | **Unavailable** |
| agent and surrounding agent | HTML §§8.1.2, 8.1.4.4, 8.1.7, and timers | Browlet has a useful host-side `Agent` representative, but it does not configure the underlying V8 Agent Record. | **Bounded** |
| agent cluster and candidate execution | HTML §8.1.2 and structured data | Browlet enforces its cluster identity in HTML algorithms, but Node's actual shared-memory boundary remains the isolate/worker topology. | **Bounded** |

### Host hooks supplied by HTML

HTML §8.1.6 says user-agent hosts must provide these implementations. They are
engine-to-host calls, not globals which Browlet can invoke or monkey-patch.

| Hook | What HTML owns | Node/Browlet status |
| --- | --- | --- |
| `InitializeHostDefinedRealm` | Creates a realm with host-selected global object/global-this and records its HTML counterpart | **Bounded:** Compatible Node now exposes an opaque context handle, separately stable global proxy, explicit detach/reattach, and post-projection prototype sealing. `NodeRealm` consumes that handle, but HTML navigation does not yet reuse it and Web IDL still exposes Browlet's modeled proxy behind the VM proxy. The compatible path uses Node's principal token for embedder access; HTML origin policy, cross-origin callbacks, and the complete WindowProxy/navigation lifecycle remain Browlet work. Stock Node retains the bridge. Neither profile installs the complete HTML hook. |
| `HostEnsureCanAddPrivateElement` | Rejects private fields on `WindowProxy` and `Location` | **Unavailable:** V8 calls Node's host implementation and knows nothing about Browlet's platform-object identities. |
| `HostEnsureCanCompileStrings` | Applies CSP to `eval`/Function-family string compilation | **Unavailable:** a VM context can disable string generation coarsely, but Browlet cannot install HTML's per-compilation policy hook. CSP is deferred. |
| `HostGetCodeForEval` | Extracts code from `TrustedScript` or returns no-code | **Unavailable:** Node does not expose the proposal hook. Trusted Types is deferred. |
| `HostPromiseRejectionTracker` | Maintains each HTML global's rejected-promise state and queues `rejectionhandled` | **Unavailable:** Node's process-wide rejection reporting does not provide HTML's per-realm script/settings information. |
| `HostSystemUTCEpochNanoseconds` | Obtains the relevant settings object's wall clock for Temporal | **Deferred/unavailable:** Browlet has a host clock for its own APIs, but cannot install Temporal's engine hook; the supported Node baseline does not currently provide this integration. |
| `HostMakeJobCallback` | Captures incumbent settings and active-script context in a JobCallback Record | **Unavailable for native jobs:** Web IDL stores its own callback context, but that is a parallel callback boundary, not this Promise-job hook. |
| `HostCallJobCallback` | Restores that context around the eventual `Call` | **Unavailable for native jobs:** Browlet can bracket callbacks it invokes, not callbacks invoked inside V8's Promise machinery. |
| `HostEnqueuePromiseJob` | Places every Promise job in the HTML microtask queue and prepares/cleans up its realm settings around execution | **Unavailable as a host hook:** compatible VM contexts place Promise jobs on their EventLoop's explicit queue, while stock contexts use the ambient queue, but V8 gives Browlet neither the job closure nor its Realm Record. Queue selection and checkpoint control do not supply the callback lifecycle. |
| `HostEnqueueGenericJob` | Queues jobs such as `Atomics.waitAsync` completion on the JavaScript-engine task source | **Unavailable:** Node owns native generic-job delivery. |
| `HostEnqueueTimeoutJob` | Routes ECMAScript timeout jobs through HTML active-time and task machinery | **Unavailable:** Browlet's own timers do not intercept engine-created timeout jobs. |
| `HostEnqueueFinalizationRegistryCleanupJob` | Queues registry cleanup as an HTML task and brackets script execution | **Unavailable:** collection and cleanup scheduling remain V8/Node-owned. |
| `HostGetImportMetaProperties` | Supplies `import.meta.url` and `import.meta.resolve` | **Deferred/partial substrate:** Node VM module callbacks can cover controlled modules, but the supported Browlet baseline has no module-script pipeline. |
| `HostGetSupportedImportAttributes` | Declares the host's supported import attributes | **Deferred/partial substrate:** requires the module pipeline and its fetch policy. |
| `HostLoadImportedModule` | Resolves and fetches HTML module graphs | **Deferred/partial substrate:** controlled VM compilation can accept callbacks, but Browlet still needs Fetch, module maps, and script records. |

`HostEnqueuePromiseJob` applies to jobs created wholly by author code as well
as jobs caused by a platform API. HTML does not ask for an informational
notification: it supplies the scheduling and script-lifecycle implementation
for the job. Controlling Web IDL callback invocation therefore cannot cover an
author's `.then()`, `async`/`await`, or thenable assimilation.

### Agent correspondence

Keeping an HTML-facing `Agent` and `AgentCluster` is browser-aligned. Blink,
for example, has an explicit Agent object joining a V8 isolate, a scheduler
event loop, an agent-cluster key, and a V8 microtask queue. Gecko and WebKit
likewise connect their HTML execution objects to engine-owned job queues. They
do not obtain an ambient JavaScript `Agent` object from author code.

Browlet's current model is incomplete at the coupling point:

- `Agent.eventLoop`, Window membership, cluster allocation, origin-keyedness,
  and cross-origin isolation are useful HTML-owned state.
- `Agent.canBlock` and `Agent.signifier` currently state the intended
  ECMAScript properties but do not alter V8's `[[CanBlock]]` or install an
  `[[AgentSignifier]]` on VM realms.
- The current queue-integration slice gives each Browlet Agent an explicit
  queue under compatible Node and passes it to all of that Agent's VM contexts.
  Stock Node Agents share the isolate's ambient queue, so a fallback checkpoint
  for one modeled Agent can still drain work belonging to another.
- The mismatch is already observable: Node permits `Atomics.wait()` in a VM
  context used for a Window realm, whereas HTML creates Window agents with
  `[[CanBlock]]` false.
- Browlet's cluster identity prevents cross-cluster operations in algorithms
  it owns, such as structured serialization. It cannot stop author code from
  sharing the same native `SharedArrayBuffer` across two modeled clusters if
  integration exposes that value directly.

ECMA-262's current Agent Record also has `[[IsLockFree8]]`. The current HTML
“create an agent” algorithm initializes `[[IsLockFree1]]`,
`[[IsLockFree2]]`, and `[[LittleEndian]]`, but omits `[[IsLockFree8]]`. Treat
that as an upstream HTML/ECMAScript integration discrepancy. Do not add inert
lock-free fields to Browlet; V8 remains authoritative for
`Atomics.isLockFree()` until an actual engine-agent integration exists.

jsdom is a useful negative comparison. It does not model production Agents or
AgentClusters, uses Node VM contexts for realms, sends `queueMicrotask()` to
Node, and directly calls generated Web IDL callbacks. Its WPT expectations
explicitly retain failures for missing callback-realm and microtask-checkpoint
behavior. That is less machinery, but it avoids rather than solves this
boundary.

### Other abstract operations

Most imported operations do not belong on an embedding interface.

| Family | Browlet rule | Current status |
| --- | --- | --- |
| Calls, construction, properties, descriptors, equality, and primitive conversion | Use native syntax, `Reflect`, `Object.hasOwn`, or the captured realm intrinsic where HTML must explicitly perform the operation. | **Available/delegated**; selected shared operations live in `abstract-operations.ts`. |
| Built-in function and ordinary object creation | Use realm-owned function/object creation only where a specification must choose the realm, prototype, name, length, or constructibility. | **Available** for current Web IDL uses through `JavaScriptRealm`; not a complete reimplementation of the ECMA operations. |
| ArrayBuffer/view inspection, copying, and detachment | Keep Web IDL/HTML policy above bounded engine-slot probes and realm intrinsics. | **Available/bounded** in `array-buffer-primitives.ts` and Web IDL buffer-source operations. |
| `ParseScript` and `ScriptEvaluation` | Let V8 parse and execute, while HTML owns Script records, settings, fetch metadata, and error policy. | **Bounded/deferred:** `NodeRealm.evaluate()` is not yet the formal HTML classic-script pipeline. |
| Module parse/link/evaluate operations | Let the engine own module records and evaluation; HTML owns fetching, module maps, and host metadata. | **Deferred:** Node's VM module APIs are not part of Browlet's supported baseline yet. |
| `NewPromiseReactionJob` and `NewPromiseResolveThenableJob` | V8 creates these jobs; HTML mentions them to explain the job and realm delivered to its host hook. | **Delegated**, but delivery to HTML is **unavailable**. |
| `ClearKeptObjects`, `CleanupFinalizationRegistry`, and `RunJobs` | These require coordination with engine job/checkpoint state, not TypeScript copies. | **Unavailable for direct control**; Node/V8 performs its own lifecycle. |
| RegExp parsing/execution | Use captured RegExp intrinsics when an HTML algorithm must avoid author overrides. | **Available**, first consumer deferred. |

## Complete HTML §2.1.9 inventory

Every imported ECMA-262 term appears below exactly once. Grouping is for audit
routing only; it does not imply one implementation module per row.

| Family | Imported terms |
| --- | --- |
| Execution and agent model | active function object; agent; agent cluster; candidate execution; current realm; forward progress; JavaScript execution context; JavaScript execution context stack; realm; running JavaScript execution context; surrounding agent |
| Language and object-model rules | automatic semicolon insertion; clamping; early error; invariants of the essential internal methods; abstract closure; immutable prototype exotic object; NewTarget |
| Job model | JobCallback Record |
| Well-known symbols | Well-Known Symbols; `%Symbol.hasInstance%`; `%Symbol.isConcatSpreadable%`; `%Symbol.toPrimitive%`; `%Symbol.toStringTag%` |
| Intrinsics | Well-Known Intrinsic Objects; `%Array.prototype%`; `%Error.prototype%`; `%EvalError.prototype%`; `%Function.prototype%`; `%Object.prototype%`; `%Object.prototype.valueOf%`; `%RangeError.prototype%`; `%ReferenceError.prototype%`; `%SyntaxError.prototype%`; `%TypeError.prototype%`; `%URIError.prototype%` |
| Grammar productions | FunctionBody; Module; Pattern; Script |
| Language types | BigInt; Boolean; Number; String; Symbol; Object |
| Specification types | Completion Record; List; Record; Property Descriptor |
| Script and module records/methods | ModuleRequest Record; Script Record; Synthetic Module Record; Cyclic Module Record; Source Text Module Record; Evaluate; Link; LoadRequestedModules |
| Ordinary calls, objects, properties, and conversion | ArrayCreate; Call; Construct; CreateBuiltinFunction; CreateDataProperty; DefinePropertyOrThrow; EnumerableOwnProperties; OrdinaryFunctionCreate; Get; HasOwnProperty; IsAccessorDescriptor; IsCallable; IsConstructor; IsDataDescriptor; NormalCompletion; OrdinaryGetPrototypeOf; OrdinarySetPrototypeOf; OrdinaryIsExtensible; OrdinaryPreventExtensions; OrdinaryGetOwnProperty; OrdinaryDefineOwnProperty; OrdinaryGet; OrdinarySet; OrdinaryDelete; OrdinaryOwnPropertyKeys; OrdinaryObjectCreate; SameValue; SetImmutablePrototype; ThrowCompletion; ToBoolean; ToString; ToUint32; IsLooselyEqual; IsStrictlyEqual |
| Buffer operations | CopyDataBlockBytes; CreateByteDataBlock; DetachArrayBuffer; IsArrayBufferViewOutOfBounds; IsDetachedBuffer; IsSharedArrayBuffer; TypedArrayCreate |
| Script/module operations | CreateDefaultExportSyntheticModule; FinishLoadingImportedModule; NewObjectEnvironment; ParseJSONModule; ParseModule; ParseScript; ScriptEvaluation; SetSyntheticModuleExport |
| Job and lifecycle operations | ClearKeptObjects; CleanupFinalizationRegistry; GetActiveScriptOrModule; GetFunctionRealm; NewPromiseReactionJob; NewPromiseResolveThenableJob; RunJobs |
| RegExp operations | RegExpBuiltinExec; RegExpCreate |
| Host hooks | HostCallJobCallback; HostEnqueueFinalizationRegistryCleanupJob; HostEnqueueGenericJob; HostEnqueuePromiseJob; HostEnqueueTimeoutJob; HostEnsureCanAddPrivateElement; HostGetSupportedImportAttributes; HostLoadImportedModule; HostMakeJobCallback; HostPromiseRejectionTracker; InitializeHostDefinedRealm; HostGetImportMetaProperties |
| Built-ins, syntax, and engine features | Atomics; `Atomics.waitAsync`; Date; FinalizationRegistry; RegExp; SharedArrayBuffer; SyntaxError; TypeError; RangeError; WeakRef; `eval()`; `WeakRef.prototype.deref()`; `[[IsHTMLDDA]]`; `import()`; `import.meta`; `typeof`; `delete`; The TypedArray Constructors |

The adjacent proposal inventory is: `HostEnsureCanCompileStrings`,
`HostGetCodeForEval`, `CreateTextModule`, `HostSystemUTCEpochNanoseconds`,
`nsMaxInstant`, and `nsMinInstant`.

## Delivery order

Treat each item below as one vertical engine/host problem. Do not implement all
host hooks as a family merely because ECMA-262 names them together. Preserve or
add the behavioral probes relevant to an item while investigating that item;
the probes are evidence, not a separate grab-bag phase.

1. **Microtask-queue integration — complete.** Land and verify
   `JavaScriptMicrotaskQueue` with explicit and ambient backends. Under
   compatible Node, create one explicit queue per HTML EventLoop
   and use it for every associated Realm, HTML microtask enqueue, and
   checkpoint. Preserve stock Node as an explicitly tested ambient fallback
   rather than mixing the two backends.
2. **Context/global-proxy integration — current.** The compatible-Node
   `ContextHandle` substrate is implemented and `NodeRealm` consumes it: opaque
   context ownership, stable proxy identity, explicit detach/reattach, and
   post-projection immutable prototype. Integrate that lifecycle into HTML
   Realm/navigation without coupling it to microtask-queue selection. Treat the
   shared Node principal token as an embedder-access accommodation, not browser
   origin policy. Add the distinct Web IDL global exposure target, checkpoint
   before navigation reuses the proxy, and resolve `[[PreventExtensions]]`,
   same- and cross-origin handlers, old-Realm behavior, and navigation tests
   before production adoption.
3. **Promise-job embedding.** Investigate `HostMakeJobCallback`,
   `HostCallJobCallback`, and `HostEnqueuePromiseJob` together with the supplied
   job realm, `GetFunctionRealm`, the active script needed by callback creation,
   and controlled execution-context preparation and cleanup. Per-Agent queue
   ownership is substrate for this work, not completion of these hooks. Do not
   add a callable imitation of a hook which V8 never invokes.
4. **Classic-script execution.** Integrate `ParseScript`, `ScriptEvaluation`,
   Script Records, the current realm, the running execution context, and
   `GetActiveScriptOrModule` for scripts Browlet creates and executes. Revisit
   `InitializeHostDefinedRealm` where that pipeline needs the formal HTML
   realm/settings/global correspondence. Do not claim visibility into arbitrary
   V8 execution.
5. **Promise rejection lifecycle.** Investigate
   `HostPromiseRejectionTracker`, per-global rejected-promise state,
   `unhandledrejection`, and `rejectionhandled` after the Promise-job and script
   settings boundaries are understood.
6. **Module execution with Fetch.** Add `ParseModule`, `Link`, `Evaluate`,
   `LoadRequestedModules`, `HostLoadImportedModule`,
   `HostGetImportMetaProperties`, `HostGetSupportedImportAttributes`, and the
   JSON, text, and synthetic-module operations as one module-fetching pipeline,
   not as an engine framework in advance.
7. **Independent facilities with their first consumers.** Defer private-element
   policy, dynamic-code policy, finalization cleanup, generic jobs,
   ECMAScript-created timeout jobs, Temporal's clock hook, effective Agent
   controls, and native shared-memory boundaries until the corresponding
   platform feature is being implemented.
8. Repeat the dependency scan for Web IDL and then the low-level external
   specifications on the execution path. Add only terms which create a new
   engine boundary; do not duplicate ordinary ECMAScript vocabulary already
   classified here.

After the explicit queue, `ContextHandle` integration, and first Promise-job
host-hook boundary are stable, return to Priority 4 Fetch. The later entries
activate with their concrete consumers; they are not a requirement to finish
all of ECMAScript embedding before Fetch begins.

Before naming or adding a runtime operation, review whether it reports an
engine fact, invokes the engine, supplies an engine-to-host hook, or merely
contains a Node accommodation. Those directions are distinct even when one
HTML algorithm uses all of them.

For every working row, retain the ECMA anchor, normative HTML consumer, stock
and Browlet-compatible Node/V8 capability, Browlet treatment, fidelity, test
evidence, and the event which would permit removal of an accommodation. A
host-hook-shaped TypeScript API that V8 never calls is not progress; a narrow
backend contract with an honest unsupported result can still clarify the
architecture.
