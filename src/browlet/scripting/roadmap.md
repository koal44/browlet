# Scripting roadmap

## Present

- `agents.ts`: the agent/agent-cluster concepts currently required by Window
  realms (HTML §8.1.2).
- `realm.ts` and `environment.ts`: realm execution and environment settings
  counterparts (HTML §8.1.3).
- `environment.ts` also supplies Window script settings reached from HTML
  §7.2.2.5; Window does not carry a second settings-object implementation.
- `event-loop.ts`: the event loop uniquely owned by each agent, including task
  queues, deterministic task turns, currently-running-task state, task timing
  hooks, checkpoint coordination, coalesced host wake-ups, and the explicit
  Node operations that request a later turn and bridge a V8 checkpoint.
- `global-scope.ts`: the composed `WindowOrWorkerGlobalScope` state and HTML
  §8.8 `queueMicrotask()` API, routed through the relevant realm's agent-owned
  event loop.
- `tasks.ts`: explicit global-task routing and the five generic task-source
  identities from HTML §8.1.7.4; each event loop owns their queue associations.
- `rendering-opportunity.ts`: the independently driven Window rendering
  producer, rendering task source, document filtering seams, and spec-ordered
  update pipeline.

## Architecture decision

Before changing task, microtask, rendering, or asynchronous-event ownership,
read [the event-loop architecture note](./event-loop-architecture.md). Blink,
Gecko, and WebKit place similar observable behavior behind materially different
internal boundaries. Browlet intentionally follows HTML's agent-owned semantic
event loop and puts host scheduling beneath it; copying an engine's routing
surface without its scheduler and lifecycle model would create an inconsistent
hybrid.

## Section 8 execution constraints

- An event loop belongs to an agent, not a realm or Window. Multiple event
  loops may be cooperatively scheduled on one Node thread, but each agent's
  queues and currently-running-task state remain distinct.
- A task carries steps, a task source, an associated Document where
  applicable, and the settings objects used by script evaluation. Document
  association is semantic: tasks for a Window Document are runnable only
  while that Document is fully active.
- Task sources preserve ordering within a source. They are not one universal
  FIFO queue; the scheduler can choose among task queues without reordering a
  source.
- Work which could block runs in parallel over realm-neutral records. Any
  result that creates, converts, or mutates JavaScript-visible objects must
  return through a task queued for the target global and its responsible event
  loop. This is the boundary Fetch, loaders, messaging, and workers must use.
- Scripting-enabled, secure-context, and cross-origin-isolated answers derive
  from the environment, policy, and agent cluster. Realm exposure checks must
  not preserve independent constructor flags that can disagree with those
  sources once the lifecycle supplies them.
- The microtask queue is separate from task queues. A microtask checkpoint also
  coordinates rejected-promise reporting, MutationObserver delivery, custom
  element reactions, and JavaScript kept-object cleanup. Calling Node's
  `queueMicrotask()` is therefore a host wake-up mechanism, not the complete
  HTML checkpoint algorithm.
- Default `vm.Context`s share Node's microtask queue, but `node:vm` has no
  public synchronous checkpoint. Until an explicit shareable queue reaches the
  supported Node baseline, keep a feature-detected `process._tickCallback()`
  bridge isolated in the Node scheduler host. It is a deprecated private hook
  that drains Node's ambient queue rather than a Browlet-owned queue: unrelated
  host or dependency promise jobs, work from another Browlet instance in the
  same isolate, next-tick callbacks, and promise-rejection machinery can run
  during the checkpoint. It is therefore only a provisional compatibility
  bridge for a controlled single-scheduler host, not an isolation boundary or
  the definition of Browlet's checkpoint semantics. Preserve cross-realm FIFO
  and contamination-limit tests around the bridge. The private hook also
  cannot force a nested drain while V8 is already performing a microtask
  checkpoint, so the Browlet scheduler must enter task turns from a Node task
  boundary rather than a Promise or microtask callback. Synchronously advanced
  test clocks do not create that boundary; preserve that integration case as
  an expected failure rather than claiming ordinary fake-timer compatibility.
  Fail explicitly when the hook is unavailable, and replace it once a public
  capability exists.
  Revisit this bridge after timers, Fetch completion, parser-blocking scripts,
  load events, and same-agent multi-realm behavior provide representative
  downstream tests, but before calling the Document execution lifecycle
  stable. At that review, evaluate candidate hosts or workarounds against the
  accumulated ordering and isolation tests, then either replace the bridge or
  record the smallest explicit compatibility downgrade Browlet can support.
  `microtaskMode: 'afterEvaluate'` is not a fallback because it gives each
  context a separate queue.
- DOM §4 assigns each similar-origin Window agent a
  mutation-observer-microtask-queued flag, pending mutation observers, and
  signal slots. Keep that state on `WindowAgent`; DOM owns record/slot
  notification semantics, while the event loop schedules and performs the one
  checkpoint delivery. This is the first concrete consumer with which to
  replace the current microtask-delegation skeleton.
- The Window event-loop processing model eventually owns rendering
  opportunities and animation-frame callbacks. Style/layout/rendering should
  plug into that opportunity; they must not start a competing frame scheduler.
- Dedicated workers obtain a new true-`[[CanBlock]]` agent in the creator's
  agent cluster; shared workers obtain a true-`[[CanBlock]]` agent in a new
  origin-keyed cluster; worklet globals obtain false-`[[CanBlock]]` agents in
  the creator's cluster. Each agent still owns a distinct event loop.
- Worker and worklet environment settings are ordinary settings-object
  specializations whose module map, base URL, origin, policy, isolation, and
  time-origin answers come from their global and creator. Do not make the
  global scope itself a substitute settings object.

## Section 8.1.7 definition audit

The existing agent boundary is sound: every `Agent` owns one unique
`EventLoop`, `EnvironmentSettingsObject.responsibleEventLoop` follows its
realm's agent, and agent classes distinguish Window, worker, and worklet
loops without equating an event loop with an implementation thread. The
authoritative fully-active-Document predicate now supplies the task
runnability rule.

The provisional event-loop surface must be replaced with the remaining
definition-level state before it runs tasks:

- A task is a record containing steps, a task-source identity, a `Document` or
  null, and the set of environment settings objects used by script evaluation.
- A task queue is an insertion-ordered set, not a dequeue-only FIFO. A blocked
  task stays in place while the loop selects the first runnable task from a
  chosen queue.
- A task source is only a logical identity. Its association with a concrete
  task queue belongs to each event loop; the source itself must not own a
  process-global queue.
- The event loop needs its owning agent/kind, its task queues and source
  associations, its currently-running task, and its performing-checkpoint
  flag. Window-loop render and idle timestamps can enter with their first
  rendering or idle-period consumer; High Resolution Time already supplies
  their value domain.
- `WindowAgent.windowObjects` is the beginning of the same-loop-Windows
  relation. Window destruction must eventually remove entries before rendering
  or idle-period code relies on it.
- The conceptual microtask queue must preserve ordering between Promise jobs
  and `queueMicrotask()` jobs. Do not add a second TypeScript queue alongside
  V8's Promise queue. Queueing and synchronous checkpointing instead enter
  through explicit event-loop options, with the documented Node checkpoint
  limitation until Node exposes an explicit shareable queue.

The low-level `queue a task` operation should require an explicit event loop
and `Document` in Browlet code. The specification itself warns that implied
event loops and implied Documents are ambiguous; callers should normally use
the global- or element-task wrappers that derive both from a relevant global.
The global wrapper exists. Add the element wrapper with its first production
caller, after platform-object creation-realm identity is available through a
cycle-safe seam. Deriving it from an element's current node document would be
wrong after cross-document adoption.

Fetch records and transport can be implemented before this scheduler is
complete. Observable Fetch completion cannot: processing a non-blocking
resource and touching realm-bound objects has to re-enter through an
environment-specific task destination.

DOM's synchronous event dispatch does not wait for this scheduler.
`AbortSignal.timeout()` does: it is an early concrete consumer of "run steps
after a timeout", relevant-global active time, and a task queued on the timer
task source. `timers.ts` now provides that per-global ordered active-time map,
and function-based Window timers add shared IDs, nesting/clamping, repetition,
and clearing above it. Keep those facilities generic to HTML rather than
adding a DOM timer path.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `agents.ts` | Obtain worker/worklet agents with the specified new/shared agent-cluster and `[[CanBlock]]` rules | HTML §8.1.2.2 |
| existing `environment.ts` | Complete Window, worker, and worklet environment/settings algorithms, scripting enablement, secure-context integration, policy, and execution readiness | HTML §8.1.3; HTML §§10.2.6.2 and 11.3.1.3; Secure Contexts |
| `script.ts` | Script records and shared script state | HTML §8.1.4 |
| `classic-script.ts` | Creating/fetching/running classic scripts | HTML §§8.1.4.1–8.1.4.5 |
| `module-script.ts` | JavaScript module scripts and module graph fetching | HTML §§8.1.4.1–8.1.5 |
| `module-map.ts` | Module map and fetch coordination shared by settings objects and module host hooks | HTML §§8.1.3 and 8.1.6 |
| `error-reporting.ts` | `ErrorEvent`, `PromiseRejectionEvent`, runtime error reporting, and rejected-promise notification | HTML §§8.1.4.6–8.1.4.7 |
| existing `event-handlers.ts` | Extend the ordinary IDL-handler core with content-attribute compilation, Window/element targeting, special error/beforeunload processing, and the global handler mixins | HTML §8.1.8 |
| `structured-data/` | Structured serialization, transfer, target-realm reconstruction, and `structuredClone()`; see its narrower roadmap | HTML §2.7 |
| `callback-context.ts` only if realm hooks outgrow environment.ts | Preparing/cleaning callback execution | HTML §8.1.4.4 and Web IDL callback integration |
| `host-hooks.ts` | ECMAScript host hooks used by HTML | HTML §8.1.6 |
| existing `event-loop.ts` and `tasks.ts` | Remaining worker/worklet loop restrictions and loop teardown around the implemented tasks, routing, and checkpoints | HTML §8.1.7; HTML §§10.2.2 and 11.3.1.1 |
| existing `agents.ts` and `event-loop.ts` | MutationObserver pending state, signal-slot state, single-microtask suppression, and checkpoint delivery | DOM §§4.2.2 and 4.3; HTML §8.1.7 |
| existing `global-scope.ts` | Complete `WindowOrWorkerGlobalScope` origin, security, base64, `reportError()`, image, and structured-clone contributions | HTML §§8.2–8.3 |
| existing `timers.ts`, `global-scope.ts`, and future script-policy owners | Add worker suspension; timer-handler timing; scripting-disabled checks; and the `TrustedScript`/CSP/classic-script string-handler branch to the implemented Window function-timer core | HTML §8.7; Trusted Types; CSP |
| `animation-frame.ts` | `AnimationFrameProvider`, callback identity, cancellation, and rendering-opportunity delivery | HTML §8.12 |

Dynamic markup insertion and DOM parsing are mapped under `html/parser/` and
`dom/parsing/`; sanitization, Navigator, and image objects have their own
roadmaps. Dialogs and printing require an embedder/UI capability and can wait
until an observable consumer exists.

## Deferred processing-model tails

The remaining tail of HTML §8.1.7.3 is not one implementation slice. Preserve
the following distinct prerequisites and introduce each operation with its
first real consumer:

| Tail | Existing substrate | Missing prerequisite or consumer | Entry point |
| --- | --- | --- | --- |
| Window idle periods | Window inventory, high-resolution/coarsened time, rendering opportunities, and the last-render-opportunity time | A no-runnable-task iteration path; the §8.7 ordered timer map and estimated deadlines; animation-frame callback maps; refresh-rate/next-render prediction; `requestIdleCallback()` and `IdleDeadline`; reliable removal of destroyed Windows from the same-loop set | After timers, animation frames, and the Request Idle Callback consumer exist |
| Worker rendering and shutdown | Worker agent kinds and an ordinary agent-owned `EventLoop` | Real worker globals, realms, and settings; the closing flag; queue rejection/discard; event-loop destruction; the `run a worker` continuation; worker animation-frame callbacks and rendering | With the first complete dedicated-worker lifecycle |
| `await a stable state` | Microtask queuing and the checkpoint boundary | A continuation contract which suspends work running in parallel, runs its synchronous section as a microtask on the correct loop, and then resumes parallel work; current image, media, and text-track consumers are absent | With the first image/media consumer; this does not require execution-context-stack capture |
| `spin the event loop` | Currently-running-task/source state, task queuing, and checkpointing | Suspension and later resumption of an arbitrary task or microtask; copy/empty/restore access to the JavaScript execution-context stack; migration of a spinning microtask to a task queue; parser-script consumers | Lower concrete parser algorithms into explicit continuations unless the host eventually exposes a faithful general primitive |
| `pause` | High-resolution time and rendering seams | A synchronous blocking/embedder contract that keeps browser UI responsive while preventing that event loop from running tasks; modal UI consumers; pause-duration reporting | With dialogs, printing, synchronous fetching, or another real embedder-controlled consumer |

Do not add only the state fields which make these algorithms look present.
For example, an idle timestamp without deadline-bearing timers and idle
callbacks is not an idle-period implementation, and a worker closing boolean
without queue suppression and event-loop teardown is not worker shutdown.

## Delivery order

1. Replace the definition skeleton with the `Task` record, insertion-ordered
   task queues, per-loop task-source associations, the reciprocal Agent/EventLoop
   relation, currently-running-task state, and checkpoint reentrancy state.
   Add the generic DOM-manipulation, user-interaction, networking, navigation/
   traversal, rendering, microtask, and existing timer source identities, but
   do not yet run them.
2. Implement explicit low-level task queuing plus the global-task wrapper.
   Add the element wrapper with a real caller and creation-realm lookup; do not
   substitute the element's mutable node-document association. Queue wake-up
   is a host notification only. Test source ordering, per-loop association,
   inactive-Document retention, and selection of the first runnable task
   without wall-clock races; defer the discouraged implied event-loop and
   implied-Document paths until a real caller requires them.
3. Add a deterministic one-iteration driver: choose a queue by an injectable
   policy, remove its oldest runnable task, set and clear the currently-running
   task in `try`/`finally`, run its steps, and reach the microtask-checkpoint
   boundary through a required hook. It is not a blocking `while (true)`.
4. The checkpoint's reentrancy guard is `EventLoop` state, while the
   feature-detected `_tickCallback()` bridge is an explicit Node operation in
   `event-loop.ts`. The HTML checkpoint receives that operation without
   knowing its mechanism. Cross-realm FIFO behavior is covered; the
   ambient-queue contamination limit remains a runtime constraint rather than
   behavior Browlet can isolate or normalize.
   Rejected-promise notification, IndexedDB cleanup, `ClearKeptObjects`, and
   checkpoint timing remain named hooks until their owning subsystems exist.
5. Let the injected turn-request operation schedule one later runtime task,
   while the event loop coalesces wake-ups and requests another turn only
   while runnable work remains. Sample unsafe shared start/end times in spec
   order and expose named
   task-start, long-task-reporting, and task-end hooks. The hook owners remain
   absent until Long Animation Frames and Long Tasks enter; idle-period,
   worker-shutdown, and rendering work remain outside this slice.
6. Let a replaceable Window rendering producer observe opportunities
   independently, set the event loop's render-opportunity time, and queue
   rendering-source tasks. Run the update algorithm as an ordered pipeline on
   that loop. Missing CSSOM View, Web Animations, Fullscreen, Canvas,
   animation-frame, ResizeObserver/layout, focus, View Transition,
   IntersectionObserver, timing, display, and top-layer owners remain absent
   named hooks rather than no-op implementations.
7. Connect script/callback preparation and cleanup, runtime-error reporting,
   rejected promises, MutationObservers, custom-element reactions, and slot
   signaling to that checkpoint as their owning phases arrive. Introduce the
   deferred processing-model tails according to the prerequisites above rather
   than giving them false synchronous implementations.
8. Preserve the current ordinary §8.1.8 IDL event-handler core used by
   `onabort`. Add body/frameset target redirection after their element and
   active-Document integration exists; add raw content-attribute compilation
   with classic scripts, CSP, Trusted Types, and DOM attribute-change steps;
   add special `error` and `beforeunload` processing with their event and
   reporting/navigation owners. Synthetic pointer-event firing waits for the
   PointerEvent and input-device model.
9. Give Fetch and every asynchronous browser subsystem an explicit task
   destination, then add timers on the same loop. Timers are the first
   follow-up consumer and complete `AbortSignal.timeout()`.
10. Run classic parser-inserted scripts through the loader and parser before
   adding the module/import-map graph. Implement remaining global utilities
   only when their owning subsystem exists.

The browser comparison and the reasons for Browlet's ownership decision are
recorded in [the event-loop architecture note](./event-loop-architecture.md).
Keep the number of TypeScript files proportional to real behavior, but do not
flatten the agent/event-loop, host-scheduler, document-lifecycle, rendering,
and synchronous-event boundaries merely because an engine realizes them using
different physical subsystems.

## Removal condition

Burn this file once scripts, host hooks, and the event loop implement the full
lifecycle used by Browlet's loader and Window APIs, and the remaining Section 8
families have implemented source or narrower surviving roadmaps.
