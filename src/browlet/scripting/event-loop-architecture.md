# Event-loop architecture

This note records how Browlet interprets HTML §§8.1.3.3, 8.1.4.4, and
8.1.7–8.1.8, and how that interpretation differs from the internal
organization of Blink, Gecko, and WebKit. Read it before moving task queues,
microtask checkpoints, rendering updates, or asynchronous event dispatch
between modules.

The implementation comparison is evidence, not an invitation to combine the
most convenient-looking fragment from each engine. Each engine's routing,
lifecycle, scheduling, and rendering layers form a coherent whole. Copying one
layer without its surrounding invariants can produce an architecture which no
engine—and, more importantly, no specification—actually has.

## Browlet's decision

Browlet follows the specification's **semantic ownership model**:

- Each `Agent` owns one unique `EventLoop`. An event loop is not a thread, a
  `Window`, a `Document`, a realm, or a browsing context.
- The `EventLoop` owns ordinary task queues, each task source's association
  with a queue, the currently running task, the microtask queue/checkpoint
  boundary, and the scheduling state for window rendering opportunities.
- A `Task` carries its source, its associated `Document` or null, its steps,
  and its script-evaluation settings set. A Window task's `Document`
  association supplies the fully-active runnability rule.
- A global, element, `Document`, or environment settings object can route work
  to the responsible event loop. Routing does not transfer ownership of the
  queue to that object.
- A scheduler host may wake an event loop, provide time, run realm-neutral
  parallel work, and bridge to the JavaScript engine's microtask checkpoint.
  It does not choose Browlet's semantic task destination or define HTML task
  and microtask ordering.
- Rendering is an event-loop phase whose concrete display wake-up can be
  supplied by a rendering host. Style, layout, and display code must not
  create an independent author-observable scheduler.
- DOM event dispatch is synchronous unless the algorithm which causes an
  event explicitly queues a task. Event-handler attributes are listener state
  and callback semantics, not a task-delivery mechanism.

This separates two questions that production engines frequently answer in the
same subsystem:

1. **Which HTML event loop semantically owns this work, and in what order may
   it run?** Browlet answers this from agents, task sources, task records, and
   document lifecycle.
2. **How does the host arrange to run that event loop efficiently?** A
   replaceable host scheduler answers this without becoming the HTML model.

Keeping those questions separate is especially important on Node. Several
Browlet event loops can be cooperatively hosted by one isolate and thread, and
the current microtask checkpoint bridge has weaker isolation than the semantic
model. Host limitations must remain visible adapter limitations rather than
quietly redefining `EventLoop`.

## Normative model

HTML §8.1.7 makes an event loop unique to an agent while expressly allowing
multiple window event loops to be cooperatively scheduled on one
implementation thread. It then assigns the loop:

- one or more task queues, which are insertion-ordered sets rather than
  dequeue-only FIFOs;
- a per-loop association from every task source to a task queue;
- a currently running task;
- a distinct microtask queue and checkpoint reentrancy flag; and
- for Window loops, render- and idle-opportunity timing state.

The processing model chooses an implementation-defined queue, removes its
first runnable task, runs it, performs a microtask checkpoint, and later
considers rendering and idle work. This grants broad scheduling freedom
without permitting tasks from one source to be reordered.

“Continually run” describes that semantic repetition; it does not require a
blocking language-level loop. WebKit makes this especially concrete:
queueing work coalesces a wake-up, `WindowEventLoop` arms a zero-delay one-shot
timer, and the callback runs a bounded batch before rescheduling remaining
work. Its worker loop similarly posts a specially classified host task.
Blink and Gecko route through different scheduler and thread abstractions, but
also rely on host event pumps rather than a literal `while (true)`.

Browlet exposes one deterministic task turn. Its event loop coalesces wake-ups
and asks a scheduler host to invoke the next turn from a later host task while
runnable work remains. The host may eventually support batching under a
fairness or time budget, but it must preserve Browlet's per-source ordering and
perform the semantic checkpoint after every task. The task turn takes that
checkpoint as a required capability; it does not silently use Node's ambient
end-of-turn behavior as an approximation.

The same host supplies unsafe shared time because the processing model samples
it immediately before removing the chosen task and after its checkpoint. The
event loop preserves that ordering and exposes task-start, long-task-reporting,
and task-end seams. Long Animation Frames and Long Tasks own the eventual hook
implementations; the scheduler host does not manufacture those subsystems.

The `Document` field on a task is semantic rather than a queue-storage hint. A
task is runnable when that field is null or its document is fully active. This
is why a generic host callback is not, by itself, a complete HTML task record.

The queuing wrappers are routing algorithms:

- `queue a global task` obtains the global's relevant agent and associated
  `Document`, then queues on that agent's event loop;
- `queue an element task` obtains the element's relevant global and delegates
  to the global wrapper; and
- low-level `queue a task` accepts the resolved event loop and document.

The standard warns against relying on implied event loops and documents. In
Browlet, a low-level queuing call should therefore require both values. The
element wrapper waits for its first production caller and a cycle-safe way to
obtain platform-object creation-realm identity. It must remain a thin adapter
from the element's relevant global to the global wrapper; using the element's
current node document instead would be wrong after adoption and would falsely
suggest that `Document` owns a task queue.

HTML §8.1.8 is adjacent but orthogonal. It defines `onfoo` handler storage,
content-attribute compilation, handler targets, and callback processing.
`dispatchEvent()` and most internal event firing synchronously invoke DOM's
dispatch algorithm. An event becomes asynchronous only where its owning
algorithm says to queue a task; user-input events, for example, use the user
interaction task source. “Event” and “event-loop task” are not synonyms.

### Callback and script entries

HTML §8.1.3.3 assigns the backup incumbent settings object stack to the event
loop. Web IDL §§3.11–3.12 surround each callback invocation with HTML's
script- and callback-preparation algorithms, using the callback's relevant
settings object and its stored incumbent settings object respectively.
`EventLoop` therefore owns this stack; it is not Realm-static or
process-global.

HTML §8.1.4.4 manipulates ECMAScript's execution-context stack, which Node does
not expose. Browlet mirrors only entries it controls. `Realm.evaluate()` is an
explicit host entry: it supplies a temporary task when necessary, records the
settings object on that task, and checkpoints after its last mirrored entry
exits. A Web IDL callback entered from an engine-owned Promise job still gets
its relevant realm and backup incumbent bookkeeping, but Browlet does not
invent a task or infer that V8's unseen stack is empty. This is the
`node-v8-execution-contexts` accommodation recorded below.

This boundary is enough for FileReader's callback-to-promise sequencing, but
it is not a substitute for HTML §8.1.4.1 Script records or the §8.1.6.2
`HostEnqueuePromiseJob` hook. In particular, Browlet cannot reconstruct an
arbitrary function execution context's hidden `ScriptOrModule` component.
Tests of stored incumbents must use the bound-platform-callback case for which
the backup stack is decisive, rather than pretending that an ordinary author
function has no script-having context.

## Runtime accommodations

These entries use the project-wide `ACCOMMODATION(identifier)` convention from
[the subsystem architecture](../../subsystem-architecture.md#accommodations-limitations-and-deviations).
They identify runtime-shaped implementation boundaries, not additional HTML
algorithms. Specification-required event-loop state remains unmarked.

### `node-v8-execution-contexts`

**Intended behavior:** HTML §§8.1.3.3 and 8.1.4.4 inspect ECMAScript execution
contexts while choosing an incumbent settings object and deciding whether
script cleanup has emptied the stack. HTML §8.1.6.2 associates Promise jobs
with their HTML microtask tasks.

**Unavailable primitive:** Node does not expose V8's execution-context stack,
the `ScriptOrModule` component of arbitrary entries, or
`HostEnqueuePromiseJob`.

**Accommodation:** `EventLoop` mirrors the realm and script entries Browlet
controls. A nullable task on a mirrored realm entry distinguishes a visible
Browlet task from an engine-owned entry. Cleanup checkpoints only for the
former. Direct `Realm.evaluate()` calls without a current task receive a
temporary host-entry task, and incumbent selection falls back to the explicit
entry settings when neither a mirrored script entry nor the backup incumbent
stack supplies one.

**Consequence:** Callbacks entered by arbitrary V8 code still receive their
stored and relevant settings, but Browlet cannot reconstruct the entire stack
or infer that an unseen stack is empty. This is also recorded as the callback
lifecycle limitation in [Web IDL limitations](../../web-idl/limitations.md).

**Affected code and tests:** Script preparation, cleanup, incumbent selection,
and direct evaluation entry live in [`event-loop.ts`](./event-loop.ts) and
[`realm.ts`](./realm.ts). Their controlled behavior is exercised by
[`callback-lifecycle.test.ts`](../../../test/browlet/unit/scripting/callback-lifecycle.test.ts).

**Replacement condition:** A supported Node API or direct V8 embedding must
expose execution entries and Promise-job association. At that point reevaluate
the mirrored stack, the nullable task and cleanup gate, the temporary
host-entry task, and the incumbent fallback together; do not leave those
pieces behind independently.

### `node-v8-microtask-queue`

**Intended behavior:** HTML §8.1.7 associates a microtask queue with each event
loop and identifies the queued microtask as the currently running task while
its steps execute.

**Unavailable primitive:** Node does not expose a shareable, explicitly owned
V8 microtask queue which Browlet can associate with one HTML event loop. The
default VM contexts use V8's ambient queue.

**Accommodation:** `EventLoop.queueMicrotask()` uses the ambient
`queueMicrotask()`, retains Browlet's `Task` in the closure, and marks the HTML
checkpoint flag while that callback runs. Browlet does not create a second
JavaScript queue whose ordering could diverge from Promise jobs.

**Consequence:** Promise and microtask FIFO ordering uses V8's real queue, but
work from unrelated code or another Browlet event loop in the same isolate is
not isolated. A public drain operation alone would not remove this
accommodation.

**Affected code and tests:** The boundary is
[`EventLoop.queueMicrotask()`](./event-loop.ts). Task identity and reentrant
checkpoint suppression are covered by [`tasks.test.ts`](../../../test/browlet/unit/scripting/tasks.test.ts).

**Replacement condition:** Node must expose suitable microtask-queue ownership
or Browlet must use a direct V8 embedder. Replace the ambient enqueue operation
and its callback bookkeeping as one unit while retaining HTML's event-loop
checkpoint flag.

### `node-v8-checkpoint`

**Intended behavior:** HTML §8.1.7.3 drains the event loop's microtask queue
inside a non-reentrant checkpoint, then performs the remaining HTML
post-checkpoint phases.

**Unavailable primitive:** Node exposes no supported synchronous operation for
draining the shared V8 microtask queue.

**Accommodation:** The Node scheduler supplies
`performNodeMicrotaskCheckpoint()` through `EventLoopOptions`. That one
provider feature-detects and invokes the private `process._tickCallback()`;
the HTML checkpoint knows only the injected operation.

**Consequences:** `_tickCallback()` also drains ambient next-tick work and runs
Node's promise-rejection bookkeeping. While V8 is already performing a
checkpoint, it refuses a nested V8 drain, but `_tickCallback()` can continue to
rejection reporting. Node can consequently report a rejected Promise returned
by a Streams callback before a cross-realm promise-resolution job marks it
handled, then emit `PromiseRejectionHandledWarning` later. Do not install a
process-wide `async_hooks` heuristic, suppress rejection events, or change Web
IDL promise conversion to hide this artifact.

**Affected code and tests:** The private hook is isolated at the bottom of
[`event-loop.ts`](./event-loop.ts). Cross-realm draining and the ambient,
nested, fake-clock, and adopted-rejection limitations are recorded in
[`tasks.test.ts`](../../../test/browlet/unit/scripting/tasks.test.ts). HTML
§13.2.6.4 separately requires a conditional, explicit pre-script checkpoint
before its conditional wait for style sheets and script readiness. The current
parser conflates those boundaries; its replacement belongs to the
[parser script-runner plan](../html/parser/roadmap.md), not to this Node bridge.

**Replacement condition:** Replace only the injected Node checkpoint provider
when a supported synchronous operation becomes available. Delete
`performNodeMicrotaskCheckpoint()`, `getTickCallback()`, and their cached
private function together. Preserve HTML's checkpoint algorithm and its
reentrancy guard. Faithful §8.1.6.2 integration may separately remove the
execution-context accommodation above.

## Engine comparison

| Axis | HTML | WebKit | Blink | Gecko |
| --- | --- | --- | --- | --- |
| Ordinary task owner | Agent's event loop | `EventLoop`, with work grouped by `EventLoopTaskGroup` | Per-frame/worker scheduler queues; Blink explicitly says this violates the spec model | XPCOM thread/event-target queues and `TaskController`; no central HTML-shaped loop object |
| Task categories | Source-to-queue association per loop | `TaskSource` enum on each `EventLoopTask`; one task vector | `TaskType` selects frame scheduler queues and runners | Many DOM paths dispatch generic `nsIRunnable` objects; scheduling infrastructure supplies priorities/targets |
| Document lifecycle | Task is runnable only if its associated document is fully active | Task-group state suspends, resumes, or discards context work | Frame/execution-context scheduler lifecycle controls deferral, throttling, and shutdown | Document/global lifecycle and event-target/runnable checks are distributed across DOM and XPCOM |
| Microtasks | Separate queue on the same event loop; checkpoint after a task | `MicrotaskQueue` is owned by the `EventLoop`; checkpoint occurs while running event-loop tasks | Blink `EventLoop` currently manages microtasks only; ordinary tasks live elsewhere | SpiderMonkey jobs are drained by `CycleCollectedJSContext` from the thread task boundary |
| Rendering | Window event-loop rendering opportunity | `Page`/rendering-update scheduler coordinates display refresh; `WindowEventLoop` tracks upcoming rendering for idle work | compositor `BeginFrame`, frame scheduler, and `PageAnimator` coordinate lifecycle updates | `nsRefreshDriver` coordinates refresh-driven style/layout/animation work |
| Direct event dispatch | Synchronous DOM dispatch | `EventTarget::dispatchEvent()` directly invokes listeners | `EventTarget::DispatchEvent()` directly invokes listeners | `EventTarget::DispatchEvent()` enters `EventDispatcher` directly |
| Queued event dispatch | Owning algorithm queues a task on a named source | Queue helpers create an event-loop task with a `TaskSource` | `EventQueue` posts through an execution context's task runner and `TaskType` | `AsyncEventDispatcher` posts an XPCOM runnable or waits until script is safe |

No engine is a literal transcription of the processing model. WebKit is the
closest structural comparison, Blink documents an intentional split, and
Gecko expresses the same observable boundaries through a general application
event loop. That difference determines how their source must be read.

## WebKit: the closest structural comparison

WebKit's `WebCore::EventLoop` owns ordinary tasks and a microtask queue. Each
`EventLoopTask` records a `TaskSource` and belongs weakly to an
`EventLoopTaskGroup`. Queueing appends the task to the loop and asks the
concrete loop to schedule a host wake-up. `EventLoop::run()` executes runnable
group tasks and performs a microtask checkpoint after each one.

This validates the core Browlet split: a host timer or run-loop callback can
wake a spec-shaped event loop without owning its tasks. It also provides useful
patterns for keeping a target alive until a task runs and for canceling or
suspending work with its execution context.

WebKit nevertheless makes deliberate implementation substitutions:

- It uses one task vector, noting that HTML permits the user agent to choose
  arbitrary queues. Browlet should preserve source-to-queue associations
  because they make ordering and scheduling policy explicit and testable.
- It represents document runnability through task-group lifecycle instead of
  storing HTML's `Document` field directly on every task.
- A single host wake-up can run several tasks until a deadline, rather than
  mirroring one written processing-model iteration.
- `WindowEventLoop` instances are found through an origin-derived global map.
  Browlet already models the specification's browsing-context-group and agent
  ownership, so it must not replace that relation with WebKit's lookup scheme.
- Rendering is implemented by `Page` and a display-linked rendering-update
  scheduler. The event loop coordinates with that system, but does not contain
  all style/layout/display code.

`RenderingUpdateScheduler` usefully demonstrates the host-facing producer:
it coalesces display-refresh or fallback-timer requests before triggering a
`Page` rendering update. WebKit then calls `Page::updateRendering()` through
that page/embedder path rather than queueing HTML's rendering-source task on
`WindowEventLoop`. Browlet adopts the independently driven, coalesced producer
but intentionally does not copy that routing substitution. A rendering
opportunity records time and queues a task; the agent-owned event loop remains
the only authority which runs the ordered update pipeline.

WebKit's node helper illustrates a routing seam, not ownership:
`Node::queueTaskKeepingNodeAlive()` reaches the node's document, obtains that
document's event loop, and queues a source-tagged task while retaining the
node. Its convenience route does not give the document a private queue.

For events, `EventTarget::dispatchEvent()` immediately builds the path and
invokes listeners. Separate helpers such as
`ActiveDOMObject::queueTaskToDispatchEventInternal()` create an event-loop task
whose steps later call `dispatchEvent()`. Preserve this two-stage distinction.

## Blink: an explicit semantic split

Blink's `scheduler::EventLoop` header is unusually candid. It says HTML gives
the event loop ordinary task queues, but Blink processes ordinary tasks at
frame granularity and calls that an intentional specification violation. The
class consequently manages microtasks, while `FrameSchedulerImpl` maps a
`TaskType` to a concrete main-thread task queue and task runner.

The common routing chain is:

1. feature or element code asks a `Document` or execution context for a task
   runner of a `TaskType`;
2. `LocalDOMWindow` routes through its `LocalFrame` when attached;
3. `FrameSchedulerImpl` selects or creates the task queue and runner; and
4. detached or test contexts fall back to an agent-group default runner.

This architecture supports Chromium's frame-level priorities, throttling,
input responsiveness, renderer lifecycle, and compositor integration. It is
not evidence that a document or frame semantically owns HTML tasks. They are
routing and policy domains in Blink's alternative scheduler model.

Copying Blink's `GetTaskRunner()` shape into Browlet would be particularly
dangerous. It would split ordinary-task ownership into document/frame runners
while leaving microtasks on the agent event loop, but Browlet does not have
Blink's scheduler hierarchy to reconnect those halves. The result would look
like Blink locally while having neither Blink's holistic guarantees nor the
specification's single semantic owner.

Blink reconnects its own halves deliberately: main-thread and worker
schedulers perform microtask checkpoints at their host task boundaries, and
the main-thread path delegates to the appropriate agent-group schedulers. A
copied frame runner without that checkpoint and agent-group integration would
not be a smaller Blink architecture; it would be a broken fragment of one.

Blink remains valuable evidence for **policy below the boundary**:

- mapping categories to scheduler queues;
- throttling and deferring work for inactive frames;
- cancellation during execution-context destruction;
- yielding around rendering and input; and
- deciding when a host callback should wake a loop.

Those policies should plug into Browlet's scheduler host or queue-selection
policy. They must not redefine `Agent.eventLoop`.

Blink also preserves the event distinction. Direct `DispatchEvent()` calls
listeners synchronously. Its asynchronous `EventQueue` asks the execution
context for a typed task runner, posts a callback, and dispatches only when the
callback runs. Seeing `DispatchEvent()` in Blink source therefore does not tell
us whether the surrounding specification algorithm was synchronous; the call
site and any preceding scheduler post do.

## Gecko: a distributed application event loop

Gecko does not expose one central object shaped like HTML's `EventLoop`.
Ordinary work is generally represented by `nsIRunnable` and processed by the
XPCOM thread/event-target infrastructure. On the main thread,
`TaskController` participates in runnable selection. `Document::Dispatch()` is
currently only a route through `SchedulerGroup::Dispatch()`, which dispatches
to the current thread from the main thread or to the main thread otherwise.

The HTML task boundary is recovered through observers around runnable
processing. `nsThread::ProcessNextEvent()` calls `BeforeProcessTask()`, runs the
selected runnable, and then calls `AfterProcessTask()`.
`CycleCollectedJSContext::AfterProcessTask()` performs the microtask
checkpoint, processes stable-state work, and performs deferred cleanup.
Rejected-promise and IndexedDB work is attached to that checkpoint machinery.

This is a coherent embedding of web semantics into Firefox's general event
system, but its types do not preserve HTML's conceptual records one-for-one:

- a generic runnable is not evidence that task-source identity is irrelevant;
- dispatching through a document is not evidence that the document owns the
  destination queue;
- the main OS/application thread is not the same concept as a Window agent's
  event loop; and
- checkpoint behavior attached to `nsThread` relies on Gecko's script
  observer and SpiderMonkey integration.

Rendering is similarly separate in implementation. `nsRefreshDriver`
coordinates refresh-driven animations, style/layout, and related observers,
while main-thread scheduling and idle-period code coordinate around refresh
timing. Browlet can use that as evidence for a rendering-host boundary, but
must retain one author-observable ordering authority at the Window event loop.

Gecko's event APIs again show the required distinction. Direct dispatch enters
`EventDispatcher` synchronously. `AsyncEventDispatcher::PostDOMEvent()` posts
itself to the current thread, while `RunDOMEventWhenSafe()` either dispatches
immediately or defers through Gecko's safe-script runner. Those APIs combine
HTML task concerns with Gecko-specific script-safety rules; they should not be
collapsed into one Browlet `fireEvent()` operation.

## Translation rules for future source reading

When comparing a Browlet change to browser code, translate the engine construct
back to its semantic role before changing ownership:

- Blink `TaskRunner`/`TaskType`, Gecko event target/runnable, and WebKit
  `EventLoop`/`TaskSource` can all represent the host delivery of an HTML task.
  Their classes are not equivalent ownership boundaries.
- `Document::GetTaskRunner()`, `Document::Dispatch()`, and
  `document.eventLoop()` are routes from document-bound work. None means “the
  document owns the event loop.”
- Blink frame queues and Gecko's main-thread queue are implementation
  scheduling domains. They are not substitutes for Browlet's per-agent loop.
- WebKit task groups, Blink execution-context lifecycle, Gecko runnable/script
  safety, and HTML's task-associated `Document` all suppress invalid work, but
  they do so at different layers. Browlet needs one authoritative lifecycle
  predicate, not several copied mechanisms which can disagree.
- A browser's renderer tick, refresh driver, or compositor callback supplies a
  rendering opportunity. It must eventually enter the same semantic ordering
  model as tasks and microtasks; it must not become a second DOM scheduler.
- A direct call named `dispatchEvent` is synchronous. Look for an earlier
  task-runner post, runnable dispatch, or event-loop queue operation before
  calling it an asynchronous event.
- Work performed “in parallel” is realm-neutral. It re-enters JavaScript-visible
  state by queueing a global task on the target agent's event loop. Do not let a
  worker pool, Promise callback, or Node callback mutate platform objects
  directly merely because an engine has a convenient cross-thread API.

## Failure modes to reject

The following hybrids are internally inconsistent:

- agent-owned microtasks plus document- or frame-owned ordinary tasks, without
  Blink's scheduler hierarchy joining their checkpoints;
- HTML task records at one entry point and untyped host callbacks at another,
  allowing task-source order and fully-active-document checks to be bypassed;
- both task-associated-document runnability and a separately copied task-group
  suspension authority, with no invariant keeping them equal;
- a rendering timer which invokes author callbacks independently of the Window
  event loop's task and microtask boundaries;
- an event API which sometimes dispatches synchronously and sometimes queues
  implicitly based on the target type; and
- one process-global queue or checkpoint shared by several Browlet instances
  being treated as if it were an isolated per-agent event loop.

When a production-engine pattern appears to solve a local problem more
elegantly, first identify the other subsystems that make that pattern sound in
that engine. Adopt the policy or capability only if it can sit below Browlet's
semantic boundary; otherwise record the divergence instead of moving the
boundary.

## Reference snapshot

This analysis used the following local source snapshots:

- WHATWG HTML `source`, especially §§8.1.7–8.1.8;
- Chromium/Blink `1136757f47c7e2b6cc593f871a5d79fc0e9834b4`, especially
  `platform/scheduler/public/event_loop.h`, frame scheduler task runners,
  `Document::GetTaskRunner()`, and DOM event queues;
- Firefox/Gecko `d92a7ec0e622782fe62529bb3a4809780da01d6c`, especially
  `nsThread`, `TaskController`, `SchedulerGroup`, `CycleCollectedJSContext`,
  `nsRefreshDriver`, and the event dispatchers; and
- WebKit `713192fabebfdd2955aa596c262c33bfbf3d50be`, especially
  `EventLoop`, `WindowEventLoop`, `TaskSource`, `Microtasks`, rendering-update
  scheduling, and direct/queued event helpers.

Re-check current source before relying on a low-level engine detail. The
Browlet ownership decision above is intentional; a future engine refactor is
new evidence to evaluate, not an automatic reason to follow it.
