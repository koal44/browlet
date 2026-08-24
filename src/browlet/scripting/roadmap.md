# Scripting roadmap

## Present

- `agents.ts`: the agent/agent-cluster concepts currently required by Window
  realms (HTML §8.1.2).
- `realm.ts` and `environment.ts`: realm execution and environment settings
  counterparts (HTML §8.1.3).
- `environment.ts` also supplies Window script settings reached from HTML
  §7.2.2.5; Window does not carry a second settings-object implementation.
- `event-loop.ts`: the event loop uniquely owned by each agent; only the
  currently exercised microtask-delegation skeleton exists.

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

Fetch records and transport can be implemented before this scheduler is
complete. Observable Fetch completion cannot: processing a non-blocking
resource and touching realm-bound objects has to re-enter through an
environment-specific task destination.

DOM's synchronous event dispatch does not wait for this scheduler.
`AbortSignal.timeout()` does: it is an early concrete consumer of "run steps
after a timeout", relevant-global active time, and a task queued on the timer
task source. Keep those facilities generic to HTML rather than adding a DOM
timer path.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| `parallel-queue.ts` when first consumed | Serialized ordering for algorithm steps that run in parallel with event-loop work | HTML §2.1.1 |
| existing `agents.ts` | Obtain worker/worklet agents with the specified new/shared agent-cluster and `[[CanBlock]]` rules | HTML §8.1.2.2 |
| existing `environment.ts` | Complete Window, worker, and worklet environment/settings algorithms, scripting enablement, secure-context integration, policy, and execution readiness | HTML §8.1.3; HTML §§10.2.6.2 and 11.3.1.3; Secure Contexts |
| `script.ts` | Script records and shared script state | HTML §8.1.4 |
| `classic-script.ts` | Creating/fetching/running classic scripts | HTML §§8.1.4.1–8.1.4.5 |
| `module-script.ts` | JavaScript module scripts and module graph fetching | HTML §§8.1.4.1–8.1.5 |
| `module-map.ts` | Module map and fetch coordination shared by settings objects and module host hooks | HTML §§8.1.3 and 8.1.6 |
| `error-reporting.ts` | `ErrorEvent`, `PromiseRejectionEvent`, runtime error reporting, and rejected-promise notification | HTML §§8.1.4.6–8.1.4.7 |
| `event-handlers.ts` | Event-handler records, IDL/content attributes, compilation, Window/element targeting, and the global handler mixins | HTML §8.1.8 |
| `structured-data/` | Structured serialization, transfer, target-realm reconstruction, and `structuredClone()`; see its narrower roadmap | HTML §2.7 |
| `callback-context.ts` only if realm hooks outgrow environment.ts | Preparing/cleaning callback execution | HTML §8.1.4.4 and Web IDL callback integration |
| `host-hooks.ts` | ECMAScript host hooks used by HTML | HTML §8.1.6 |
| existing `event-loop.ts` | Tasks, task queues/sources, global/element task helpers, microtask checkpoints, rendering opportunities, worker/worklet loop restrictions, and loop teardown | HTML §8.1.7; HTML §§10.2.2 and 11.3.1.1 |
| existing `agents.ts` and `event-loop.ts` | MutationObserver pending state, signal-slot state, single-microtask suppression, and checkpoint delivery | DOM §§4.2.2 and 4.3; HTML §8.1.7 |
| `scheduler-host.ts` when the loop first runs autonomously | Narrow host wake-up, monotonic-clock, and parallel-work capabilities without delegating HTML ordering to Node | HTML §§2.1.1 and 8.1.7; High Resolution Time |
| `global-scope.ts` | `WindowOrWorkerGlobalScope`, base64 utilities, `reportError()`, and global API contributions | HTML §§8.2–8.3 |
| `timers.ts` | Ordered timer map, nesting/clamping, active-time timeout steps, timer-task queuing, and clear operations; also consumed by `AbortSignal.timeout()` | HTML §8.7; DOM §3.2 |
| `microtasks.ts` only if it outgrows event-loop.ts | The `queueMicrotask()` API and checkpoint integration | HTML §8.8 |
| `animation-frame.ts` | `AnimationFrameProvider`, callback identity, cancellation, and rendering-opportunity delivery | HTML §8.12 |

Dynamic markup insertion and DOM parsing are mapped under `html/parser/` and
`dom/parsing/`; sanitization, Navigator, and image objects have their own
roadmaps. Dialogs and printing require an embedder/UI capability and can wait
until an observable consumer exists.

## Delivery order

1. Replace the microtask-only skeleton with task records, task sources,
   Document activity gating, explicit global/element queuing, and a deterministic
   test driver. Node supplies wake-ups; tests must not depend on wall-clock races.
2. Connect script/callback preparation, cleanup, runtime errors, rejected
   promises, MutationObservers, and custom element reactions at checkpoints.
3. Run classic parser-inserted scripts through the loader and parser before
   adding the module/import-map graph.
4. Give Fetch and every asynchronous browser subsystem an explicit task
   destination, then add timers and rendering opportunities on the same loop.
5. Implement the remaining global utilities only when their owning subsystem
   exists; they are not prerequisites for the lifecycle spine.

Blink divides these responsibilities among `core/execution_context`,
`core/script`, and scheduler code. Browlet should preserve that conceptual
separation while keeping the number of TypeScript files proportional to real
behavior.

## Removal condition

Burn this file once scripts, host hooks, and the event loop implement the full
lifecycle used by Browlet's loader and Window APIs, and the remaining Section 8
families have implemented source or narrower surviving roadmaps.
