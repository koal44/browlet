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

UserAgent allocates Window, worker, and worklet Agents using a private loop
factory. Worker/worklet allocations remain provisional and
do not create independently executing workers. Bindings constructs the sandbox
Agent and its EventLoop. `EventLoopInit` supplies the host-turn callback
and optional subsystem accounting hooks at construction. The loop creates its
engine microtask queue and imports the shared clock directly. There is no separate
start phase, and `runTaskTurn()` needs no configuration. Tests that need manual
turns supply controlled wake-ups in their fixtures. Realms require an explicit Agent.

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

`env.queueTask(source, steps, options?)` queues work for the execution owner
using the shared source keys in Infra. `scripting/tasks.ts` maps those keys to HTML
source identities. `BrowletRealm.queueGlobalTask()` captures the global's associated
Document and routes through its Agent. Options carry timer nesting metadata.
Low-level queueing can instead select an explicit loop and Document.
The future element wrapper must route through the element's relevant global,
not its current node document after adoption. Avoid implied-loop/Document calls.

Fetch has an explicit callback destination, which can differ from the body
stream's owner. Fetch's `queueFetchTask()` selects a parallel queue or calls
`env.queueGlobalFetchTask()`, implemented on BrowletEnvironment to route through
the destination global's BrowletRealm.
Work performed in parallel re-enters the intended owner's task before touching
realm-bound state.

The global-scope mixin owns GlobalTimers. Its active-time waits and execution's
`timer` task delivery serve both AbortSignal.timeout and Window function timers.
Retaining an old Window's callback retains its owner across navigation.
UserAgent supplies the Node `TimerHost` from `integration/node.ts`; the mixin
receives it through `env.userAgent.timerHost` and retains its own timer state.
Infra owns the shared contract: `scheduleTimeout(milliseconds, steps)` returns a
`TaskHandle` whose `remove()` cancels the wake-up. Native wake-ups may be bounded;
GlobalTimers rechecks its active-time deadline before completing the wait.

Browser-owned Reporting tasks instead use later Node host turns and yield to
runnable work on that UserAgent's HTML loops. They survive Document task
removal. Delivery bookkeeping uses host Promises; Fetch body processing uses the
UserAgent's sandbox loop. ReportingObserver callbacks stay on their global's loop.

## Callback and script entries

The backup incumbent settings stack belongs to the EventLoop. Web IDL brackets
callbacks with HTML script/callback preparation and cleanup using the callback's
relevant and stored incumbent settings respectively.

Browlet models entries it controls with explicit `JSExecutionContext` records.
Every realm retains one context; settings return that same identity. Direct
`BrowletRealm.evaluate()` supplies a temporary task when necessary, pushes the
retained context followed by a script context, and checkpoints after the last
context exits. Entry selection finds the most recent retained context; incumbent
selection finds the topmost ScriptOrModule or uses the backup stack. Per-entry
task associations stay separate because nested entries reuse the retained context.
Active-script lookup uses the topmost non-null ScriptOrModule's HostDefined,
without incumbent skip counters. Direct evaluation still supplies null HostDefined;
the creating/calling algorithms must attach the HTML script, and job hooks must
later preserve it across asynchronous entry.

The environment owns its binding-aware promises, allocation functions, and task
delivery directly; its associated `JSRealm` owns the Node/V8 context used for
evaluation. Neither is the modeled execution-context record. HTML's per-global
state is held by global implementations under `BrowletGlobalObject`, not by the
settings object or by EventTarget generally.
Custom engine hooks capture callback registration,
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

## Execution-context consumers

The HTML source inventory distinguishes context records from engine frames and
from the environment's execution facilities. The [scripting roadmap](ROADMAP.md)
records implementation status; this inventory describes the consumers to preserve.

| Record state | HTML use |
| --- | --- |
| Realm | Retained settings context, entry/current/incumbent selection, and captured job contexts |
| Function | Set to null in the context created by HostMakeJobCallback; HTML otherwise does not inspect this field in the audited source |
| ScriptOrModule | Find the topmost script-having context and follow its HostDefined to the HTML script |
| Incumbent skip counter | Initially zero on each context; adjusted around callbacks and consulted by incumbent selection |

Window, worker, and worklet setup retain the realm's context. Script preparation
pushes that identity beneath the evaluated script's context and records settings
on the current task; cleanup pops the matching entry and checkpoints when the
stack empties. Ordinary JavaScript calls do not each invoke HTML preparation.

| Derived answer | Consumers and distinctions |
| --- | --- |
| Current realm/settings | SharedArrayBuffer serialization policy; HTML/Image/Audio/Option construction; cross-origin Window/Location checks, frameElement, and access reporting; module resolution/import without a referrer; importScripts and pause timing. Capture the intended settings before parallel work. |
| Entry settings | window.open source/base selection, Location access, document.open origin checks, origin extraction, and download request clients |
| Incumbent settings | postMessage source/default origin, Location navigation source and activation, window.close checks, and JobCallback capture |
| Active script | Topmost non-null ScriptOrModule, independent of incumbent skip counters. JobCallback and string-timer capture preserve script provenance and fetch options for later imports. |
| Running script | The running context's ScriptOrModule: rejected-Promise tracking and exception reporting consult its settings and muted-errors state |
| Relevant realm | Platform-object ownership, supplied by Web IDL rather than selected from this stack |

`import.meta` receives its module record directly. `document.currentScript` is
Document/script-element state, not an alias for ScriptOrModule.

The remaining consumers have distinct effects:

- HostMakeJobCallback captures incumbent settings and active-script provenance
  separately. HostCallJobCallback restores the captured context inside callback
  preparation/cleanup. Promise and finalization jobs need both scheduling and
  callback provenance; supplying a queue alone does not establish the latter.
- Navigation API entry-list/commit algorithms and Document reveal bracket work
  with script preparation to control checkpoints between handlers and rendering.
- The HTML parser checkpoints before custom-element construction when the stack
  is empty, and at script end tags when permitted by speculative-parser state.
- Event-handler compilation directly pushes/pops the retained realm context;
  the resulting function's ScriptOrModule is null, avoiding accidental inheritance
  from the script that triggered compilation.
- Host-initiated serialization must establish entry before invoking author
  accessors. An ordinary synchronous author API call already has that entry.
- Spinning the event loop requires saving/restoring context identities across a
  real suspension. Copying the modeled array cannot suspend native frames, and
  clearing it cannot implement script abortion or suppress author finally blocks.

The [runtime boundary](#node-v8-execution-contexts) retains the limits of manually
supplied records and the unresolved callback-observer translation. Actual script
termination remains unsupported; see [the killing-scripts audit](ROADMAP.md#html-8145-killing-scripts).

## Host commands and callback completion

BiDi command completion uses `userAgent.HostPromise`, keeping protocol
continuations off the target page's queue. Awaiting an author Promise is a
separate, unfinished runtime operation: it must suspend and resume the script
context for cleanup before command processing continues on the host.

[PageEvaluation](../automation/evaluation.ts) retains a temporary local evaluator
that queues external commands and callback results on the automation task source,
brackets page execution, and installs result observation before cleanup checkpoints.
It copies values across the boundary and returns a native Node Promise to the host.
This remains separate from the BiDi command algorithms until retained-script
execution, protocol values, and Await's context suspension/resumption are connected.

Host callback work stays on Node's queue. Completion queues an HTML task, waking
an idle page normally. Navigation removes pending bridge tasks, rejects outstanding
evaluations, and discards late results. Parser/low-level `BrowletRealm.evaluate()` calls do
not replace this host-command boundary.

## Runtime integration and accommodations

The native backend and stock fallback have different capabilities. Keep their
observable limits in [LIMITATIONS.md](../../LIMITATIONS.md#scheduling-and-callback-context).
These anchors retain the ownership and replacement conditions for source markers.

### `node-v8-execution-contexts`

Node does not expose V8's full execution-context stack. Cleanup checkpoints when
the modeled stack empties within a controlled task or script entry. A nested
checkpoint clears HTML's current task, so the loop separately tracks whether an
outer task turn is still running. A null task alone cannot identify an uncontrolled
engine entry. Incumbent selection follows the model's script/backup-incumbent
records and asserts that backup settings exist when required. Callback capture
uses its binding environment for direct Node-host calls when both modeled stacks
are empty; the specification lookup itself has no fallback.

The [callback lifecycle tests](../../../test/browlet/scripting/callback-lifecycle.test.ts)
exercise selection and restoration with explicit records. The A-to-B bound-listener
investigation is skipped by agreement: its ordinary JavaScript `createFunction`
observer is not an established substitute for the native API in HTML's examples.
Revisit with the actual example pages and platform APIs when supported, rather
than treating that probe as a settled conformance failure. Manually supplying
records does not establish automatic tracking of author/built-in calls. Custom
job hooks cover their own boundaries; full Script records and active-script
restoration also remain unfinished. Continue through the later script-processing
and host-hook algorithms. New Node/V8 work stays parked.

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
