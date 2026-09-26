# Scripting roadmap

HTML [§8](https://html.spec.whatwg.org/multipage/webappapis.html) owns Agents,
settings, script execution, scheduling, global utilities, and timers.
The Window scheduling kernel, controlled script/callback entries, function
timers, and reached Fetch/Streams/Reporting consumers are implemented.
Formal Script records, modules, remaining checkpoint work, and other global
lifecycles remain open.

[Project priority](../../PRIORITY.md) orders cross-subsystem work.
[Event-loop architecture](EVENT-LOOP-ARCHITECTURE.md) owns scheduling boundaries;
[JS Engine](../../js-engine/ROADMAP.md) owns missing runtime primitives.
Do not restart the completed task/timer foundation when adding these consumers.

## Present

| Source | Current responsibility |
| --- | --- |
| `agents.ts` | Agent/cluster records, Window inventory, and one EventLoop per Agent |
| `environment.ts`, `realm.ts` | Early EnvironmentRecord state, full settings, relevant/incumbent ownership, and controlled script/callback entry |
| `event-loop.ts`, `tasks.ts` | Task records, source/queue associations, fully-active gating, deterministic turns, checkpoints, incumbent stack, timing hooks, and coalesced wake-ups |
| `host-hooks.ts` | Custom-engine make/call hooks plus Promise, generic, and timeout job delivery |
| `global-scope.ts`, `timers.ts` | Composed global state, reached utilities, microtasks, active-time waits, and Window function timers |
| `rendering-opportunity.ts` | Independent opportunity producer and ordered rendering pipeline seams |
| [Structured data](structured-data/ROADMAP.md) | Graph serialization/deserialization, ArrayBuffer transfer, and the Window structuredClone API |

`createWindowEnvironment()` composes the same Window/realm/execution boundary
for initial browsing and navigation. EnvironmentRecord supplies security,
navigation state, network partitioning, and the UserAgent before a realm exists.
Full environments inherit that state and add the actual realm, exec, and global.
Workers/worklets must use their own specified origin, policy, isolation, and
time-origin inputs rather than substitute the global for its settings object.

Settings satisfy narrow subsystem contracts. Browser-owned work can retain its
UserAgent independently of a live Document. BiDi hooks live on that UserAgent,
with explicit scoped inputs and provisional no-session results.

## Remaining implementation

| Owner | Missing contract |
| --- | --- |
| Script records/classic scripts | Formal script state, creation/fetch/run algorithms, active-script restoration, scripting-disabled checks, and runtime errors |
| Module scripts/maps | Parse/link/evaluate, graph fetching, import maps/attributes, dynamic import, and host hooks |
| Error reporting | ErrorEvent, PromiseRejectionEvent, muted-error handling, source locations, and rejection tracking |
| Event handlers | Content-attribute compilation, Window/body/frameset targeting, global handler mixins, and special error/beforeunload behavior |
| DOM checkpoint consumers | WindowAgent's mutation-observer flag/set, signal slots, custom-element reactions, and owner-defined delivery |
| Task routing/lifecycle | Element-task wrapper using the relevant global, worker restrictions, and complete loop teardown |
| Global utilities/timers | Origin/base64/reportError/image APIs and isolation exposure; worker suspension; handler timing; TrustedScript/CSP/classic-script string timers |
| Rendering/idle | AnimationFrameProvider, real rendering hooks, idle callbacks, deadlines, and lifecycle cleanup |
| Workers/worklets | Real globals/settings, required Agent/cluster selection, execution readiness, termination, and engine enforcement |

Secure-context exposure, structured cloning, Fetch, and function timers already
have their reached Window implementations. Origin/base64 and the other global
utilities above still need public implementations, even where their underlying
records or primitives exist.

The ordinary IDL-handler core used by onabort already exists. Extend it with the
actual HTML consumers above; event-handler storage is not a task scheduler.
Dynamic markup/parser, sanitization, Navigator, images, and speculation-rule
registration retain their own subsystem owners.

### Section 8.1.4 staging

Use bounded consumer slices within HTML's script algorithms:

1. **Classic-script records and creation (§§8.1.4.1–8.1.4.3).** Fetch, MIME,
   Encoding, referrer policy, integrity, and body transport now exist. Complete
   script preparation/readiness and the actual compiler/loader contract.
   The existing evaluation entry and parser ScriptHandler do not supply it.
2. **Calling scripts and errors (§§8.1.4.4–8.1.4.6).** Preserve implemented
   callback preparation/cleanup, task settings sets, and empty-stack checkpoints.
   Add formal active-script ownership, muted errors, ErrorEvent, and reliable
   source provenance. General termination needs an enforceable host primitive.
3. **Rejected promises (§8.1.4.7).** Obtain a faithful rejection host hook and
   per-global lifecycle. Node's process-wide events cannot supply that ownership.
4. **Modules/import maps (§8.1.4.8 and §§8.1.5–8.1.6).** Introduce module maps,
   engine linking/evaluation, fetching, registration, and dynamic-import hooks.
5. **Speculation rules (§8.1.4.9).** Add registration with the Document and
   loader policy that actually consume it.

The early controlled-entry subset is complete. Custom host hooks extend it,
but neither they nor native queues reveal every arbitrary V8 frame. Retain the
[execution-context limitation](../../LIMITATIONS.md#scheduling-and-callback-context)
until Script records and transparent host entry provide the missing evidence.

## Deferred processing-model tails

HTML [§8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)
has distinct remaining consumers:

The 2026-09-15 audit covered §§8.1.7.1–8.1.7.5 at HTML source
`24c5e48bf66ea61bc199ec6338c81258275ba9c6`; these are the retained follow-ups.

| Operation | Required next boundary |
| --- | --- |
| Window idle periods | No-runnable-task path, initial render/last-idle times, timer deadlines, animation-frame maps, refresh prediction, requestIdleCallback/IdleDeadline, and removal of destroyed Windows |
| Rendering | Production owners for the ordered hooks, child-document order, style/layout/display, animation callbacks, and observation delivery |
| Performance reporting | Real owners for task/long-task and checkpoint timing hooks |
| Worker rendering/shutdown | Actual globals, closing state, queue suppression/discard, run-a-worker continuation, and teardown |
| Await a stable state | Suspend parallel work, execute its synchronous section as a microtask on the right loop, then resume; first image/media consumer |
| Spin the event loop | Concrete continuation-based suspension/resumption for parser work; a general operation needs unavailable execution-stack capture |
| Pause | Embedder-controlled blocking/UI contract, pause-duration accounting, and a real modal or synchronous consumer |
| Checkpoint tails | Rejected promises, DOM notifications, and IndexedDB cleanup; resolve the native clear's [ordering and Agent isolation](EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint) |

Preserve a single queue for Promise jobs and HTML microtasks. Do not put a
TypeScript microtask queue beside V8's queue or claim a worker closing flag
implements shutdown. Worker/worklet Agent records alone also do not configure
V8's CanBlock or shared-memory isolation; those gates remain with the engine.

The element-task wrapper must use the element's relevant global/creation realm,
not its mutable node document after adoption. Add it with a real caller and a
cycle-safe route to existing binding ownership.

## Validation

Keep deterministic queue selection, inactive-Document retention, per-source order,
same-Agent cross-realm FIFO, checkpoint reentrancy, and cancellation coverage.
Callback tests must distinguish stored incumbent settings from an ordinary
author function's active script context. Automation tests cover host completion,
idle-page wake-ups, navigation cancellation, and unrelated Node progress.

Future consumers should prove their full lifecycle through the existing loop:
classic parser scripts before modules; DOM notification state before delivery;
worker teardown before claiming worker scheduling; rendering callbacks before
idle prediction. Backend constraints and their replacement conditions belong to
[the architecture note](EVENT-LOOP-ARCHITECTURE.md#runtime-integration-and-accommodations)
and [JS Engine](../../js-engine/README.md), rather than another completed-slice plan.
