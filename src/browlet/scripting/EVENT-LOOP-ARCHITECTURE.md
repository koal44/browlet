# Event-loop architecture

Browlet follows HTML's [Agent/event-loop model](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops).
This note defines ownership for tasks, checkpoints, rendering, and asynchronous
delivery. The [scripting roadmap](ROADMAP.md) owns unfinished algorithms;
[project architecture](../../ARCHITECTURE.md) owns subsystem composition.

## Browlet's decision

Each Agent owns one unique EventLoop. Several loops can share a Node isolate
and thread; a loop is not a Window, Document, realm, or browsing context.
The EventLoop owns task queues, per-source queue associations, the current task,
the microtask/checkpoint boundary, and Window rendering-opportunity state.

A Task retains steps, source, associated Document or null, and the settings used
by script evaluation. A task with a Document is runnable only while that Document
is fully active. Task queues are insertion-ordered sets: blocked tasks remain
while selection finds the first runnable task in a chosen queue. Queue selection
may vary, but cannot reorder runnable work within a source.

Globals, elements, and settings route work to a loop; they do not acquire its
queues. The host supplies wake-ups, time, and background effects. HTML still
selects the task destination and defines ordering. Rendering opportunities enter
the same loop; style/layout/display must not introduce a second author-visible
scheduler.

DOM dispatch is synchronous unless the causing algorithm explicitly queues it.
Event-handler attributes are listener/callback state, not a scheduling mechanism.

## Task turns and routing

The loop coalesces host wake-ups and runs one deterministic turn: choose/remove
a runnable task, install it, execute with cleanup, checkpoint, and request another
host turn while runnable work remains. A future bounded batch must still perform
the checkpoint after each task. "Continually run" does not require a blocking loop.

Shared time is sampled in processing-model order. Task-start, long-task-reporting,
and task-end hooks leave Long Tasks/Long Animation Frames to their owners.
Rendering's independent producer records an opportunity and queues the ordered
update pipeline; the host refresh source does not run author callbacks directly.

`env.exec.queueTask(source, steps, options?)` queues work for the execution owner
using the shared source keys in Infra. `scripting/tasks.ts` maps those keys to HTML
source identities. `Realm.queueGlobalTask()` captures the global's associated
Document and routes through its Agent. Options carry timer nesting metadata.
Low-level queueing can instead select an explicit loop and Document.
The future element wrapper must route through the element's relevant global,
not its current node document after adoption. Avoid implied-loop/Document calls.

Fetch has an explicit callback destination, which can differ from the body
stream's owner. `JSEnvironment.queueNetworkingTask()` selects a parallel queue
or the composed global-task route; it does not move HTML scheduling into JS Engine.
Work performed in parallel re-enters the intended owner's task before touching
realm-bound state.

The global-scope mixin owns GlobalTimers. Its active-time waits and execution's
`timer` task delivery serve both AbortSignal.timeout and Window function timers.
Retaining an old Window's callback retains its owner across navigation.

Browser-owned Reporting tasks instead use later Node host turns and yield to
runnable work on that UserAgent's started HTML loops. They survive Document task
removal. Delivery bookkeeping uses host Promises; Fetch body processing uses the
UserAgent's sandbox loop. ReportingObserver callbacks stay on their global's loop.

## Callback and script entries

The backup incumbent settings stack belongs to the EventLoop. Web IDL brackets
callbacks with HTML script/callback preparation and cleanup using the callback's
relevant and stored incumbent settings respectively.

Browlet mirrors entries it controls. Direct Realm.evaluate supplies a temporary
task when necessary, records its settings on that task, and checkpoints after
the last mirrored entry exits. Custom engine hooks capture callback registration,
bracket invocation, and place Promise jobs in HTML microtask tasks. Handlerless
jobs still have a queue/task even when their specification realm is null.

Generic jobs use the JavaScript engine task source. Timeout jobs reach that
source through active-time waits. Node Promise jobs keep their original queues;
mixed Node/HTML Atomics.waitAsync remains outside the generic/timeout integration.
These hooks do not supply formal Script records or arbitrary active-script restoration.

The parser's conditional pre-script checkpoint is separate from its later
stylesheet/readiness wait. The current adapter requests that checkpoint and
resumes synchronous handlers in the same task; asynchronous continuations return
through networking tasks. Complete script preparation and readiness remain with
[the parser](../html/parser/ROADMAP.md).

## Host commands and callback completion

[PageEvaluation](../automation/evaluation.ts) queues external commands and
callback results on the automation task source, brackets page execution, and
installs result observation before cleanup checkpoints. It copies values across
the boundary and returns a native Node Promise to the host.

Host callback work stays on Node's queue. Completion queues an HTML task, waking
an idle page normally. Navigation removes pending bridge tasks, rejects outstanding
evaluations, and discards late results. Parser/low-level Realm.evaluate calls do
not replace this host-command boundary.

## Runtime integration and accommodations

The native backend and stock fallback have different capabilities. Keep their
observable limits in [LIMITATIONS.md](../../LIMITATIONS.md#scheduling-and-callback-context).
These anchors retain the ownership and replacement conditions for source markers.

### `node-v8-execution-contexts`

Node does not expose V8's full execution-context stack. Cleanup checkpoints when
the mirrored stack empties within a controlled task or script entry. A nested
checkpoint clears HTML's current task, so the loop separately tracks whether an
outer task turn is still running. A null task alone cannot identify an uncontrolled
engine entry. Incumbent selection uses mirrored script/backup-incumbent evidence,
then the explicit entry settings.

Custom job hooks add native job association but do not justify deleting this
mirror or its direct-host-entry fallback. Complete Script records, transparent
host-function handling, and uncontrolled-entry evidence first. Use
[callback lifecycle tests](../../../test/browlet/scripting/callback-lifecycle.test.ts)
for the supported boundary; an ordinary script function is not a substitute
for the bound-platform-callback case where the backup stack is decisive.

### `node-v8-microtask-queue`

One JSMicrotaskQueue supplies enqueue and checkpoint for all realms of an Agent.
The native backend creates an explicit V8 queue, preserving Promise/queueMicrotask
FIFO without a second queue. Native queue support and custom job interception
are independent facilities.

Stock Node uses the isolate's ambient queue, so unrelated host work and other
Browlet loops are not isolated. Retain that limitation until the stock baseline
provides the complete create/enqueue/checkpoint surface. HTML task bookkeeping
and reentrancy guards remain necessary on either backend.

### `node-v8-checkpoint`

The [native checkpoint](../../../node-compat/addon/vm.cc) calls V8's
`PerformCheckpoint()`, which drains the selected queue and calls
`ClearKeptObjects()`. HTML retains checkpoint guards and post-processing.
Two questions remain for the engine integration investigation:

- How can HTML's rejected-promise notification and IndexedDB cleanup precede
  the clear when the native checkpoint bundles it with the drain?
- Can one HTML Agent's checkpoint release kept-object protection belonging to
  another Agent's unfinished work? V8 keeps that state on the shared heap;
  separate microtask queues alone do not establish isolation.

No observable Browlet failure has been established for the second question.
Resolve these before completing the checkpoint tails; adding another clear
does not resolve either question. The native implementation is in Node's
`deps/v8/src/execution/microtask-queue.cc`, with kept-object state in
`deps/v8/src/heap/heap.cc`.

Stock Node uses private process._tickCallback,
which can also run next-tick and rejection bookkeeping. A nested V8 checkpoint
can refuse to drain while Node continues rejection reporting, producing premature
unhandled/late-handled observations across realms.

Do not hide that artifact with process-wide hooks, suppressed rejection events,
or changed Web IDL conversion. Remove the private fallback when a supported
complete queue primitive replaces it. Preserve the HTML checkpoint algorithm.
[Runtime tests](../../../test/js-engine/runtime.test.ts) and
[task tests](../../../test/browlet/scripting/tasks.test.ts) cover queue isolation,
FIFO, nested checkpoints, stock contamination, and parser/Streams rejection cases.

## Engine comparison

These are source observations, not interchangeable ownership models.

| Engine | Ordinary work and lifecycle | Checkpoints/rendering |
| --- | --- | --- |
| WebKit | EventLoop tasks tagged by TaskSource and grouped by EventLoopTaskGroup; group state gates delivery | Loop owns microtasks; Page/display scheduling supplies rendering |
| Blink | Frame/worker TaskType queues and scheduler runners; execution-context lifecycle gates work | Its EventLoop class handles microtasks; agent-group schedulers reconnect host task boundaries; compositor/PageAnimator drive rendering |
| Gecko | XPCOM event targets/runnables and TaskController; DOM and scheduler checks share lifecycle work | CycleCollectedJSContext observes thread task boundaries; nsRefreshDriver supplies refresh work |

WebKit is closest structurally: queueing coalesces a wake-up and the loop runs
bounded work with a checkpoint after each task. Its single task vector, origin
lookup, and task-group lifecycle are substitutions, not required Browlet designs.
Browlet adopts a coalesced rendering producer but retains HTML's rendering-task route.

Blink explicitly documents its split between frame-level ordinary queues and
the HTML model. Copying GetTaskRunner without its agent-group/checkpoint machinery
would break our ownership. Gecko's Document::Dispatch is likewise routing through
general thread scheduling, not evidence for a Document-owned queue.

All three preserve direct versus queued dispatch. Inspect the caller's preceding
post/queue operation before treating an event as asynchronous. Browser task groups,
frame throttling, and safe-script runners also must not become additional lifecycle
authorities alongside Browlet's task-associated Document check.

## Reference snapshot

The retained comparison used:

- WHATWG HTML `source`, especially §§8.1.3.3, 8.1.4.4, and 8.1.7–8.1.8.
- Blink `1136757f47c7e2b6cc593f871a5d79fc0e9834b4`:
  `platform/scheduler/public/event_loop.h`, frame task runners,
  Document::GetTaskRunner, DOM event queues, and rendering scheduling.
- Gecko `d92a7ec0e622782fe62529bb3a4809780da01d6c`:
  nsThread, TaskController, SchedulerGroup, CycleCollectedJSContext,
  nsRefreshDriver, and direct/queued event dispatchers.
- WebKit `713192fabebfdd2955aa596c262c33bfbf3d50be`:
  EventLoop, WindowEventLoop, TaskSource, Microtasks, task groups,
  rendering-update scheduling, and direct/queued event helpers.

Recheck current engine source before relying on a low-level detail. Adopt a
browser pattern only after identifying the surrounding scheduler/lifecycle
invariants that make it work there.
