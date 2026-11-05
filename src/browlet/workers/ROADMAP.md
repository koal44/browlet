# Workers roadmap

HTML §10 workers are not a prerequisite for Browlet's first single-Window
lifecycle, but they are an early proof of the execution boundaries established
by `scripting/`, `loader/`, and `communication/`. They must reuse those
boundaries instead of creating a worker-specific scheduler, script loader, or
structured-clone implementation.

## Document-order review

The first slice reviews HTML §10.1 in full: scope, classic/module examples,
shared workers, shared state and ports, nested-worker delegation, library
workers, and the tutorials. These are non-normative examples of the later
algorithms, not additional implemented Worker APIs. The §10.2 introduction and
§10.2.1 distinguish the outside Worker object from the inside global and retain
Service Workers as a separate specification owner.

§10.2.1.1 now has the common implementation state and Web IDL declaration:
creation type/name, initially null URL, owner set, policies, empty module map,
initially false cross-origin-isolated capability, `self`, stable `location` and
`navigator`, and all six event handlers. The existing HTML callback machinery
now applies the five-argument, true-cancels `onerror` rule to worker globals.
This supports ordinary projection of an internally supplied global; it does not
yet compose an executing worker global or provide `new Worker()`.

Dependencies encountered in this first interface:

- **§10.3.3 WorkerLocation:** implemented its read-only URL getters and
  stringifier as a small dependency. It reads the associated worker's script
  URL, never a creator Window's Location. Startup must assign the final response
  URL before author code can observe it.
- **§10.3.2 WorkerNavigator:** identity and declaration only. NavigatorID,
  NavigatorLanguage, NavigatorOnLine, and NavigatorConcurrentHardware remain
  explicit dependencies of §§8.10 and 10.2.7. Worker Permissions/Storage
  contributions still need navigator integration; settings composition is now available below.
- **§10.3.1 importScripts():** declared, with an explicit throwing implementation
  stub. Trusted Types checks, synchronous fetch/pause, and ordered evaluation
  remain pending. This does not supply even a partial loading algorithm.
- **§§10.2.4–10.2.6 startup/settings:** realm/global/settings composition now exists
  as described below. The processing-model caller must still populate response
  URL/policies/capability and start execution. WindowOrWorkerGlobalScope API
  forwarding, automatic error/rejection delivery, connectivity/language event
  producers, and the execution backend remain pending.

Tests use production Binding and real realm facilities with sandbox settings to
exercise this interface's object and callback behavior. They do not simulate
worker startup or claim an independent isolate. No Node/V8 changes are needed
for this slice. The later API sections will still be reviewed in place, including
the dependencies implemented or identified here.

§10.2.1.2 now supplies DedicatedWorkerGlobalScope's global declaration,
replaceable `name`, both `postMessage()` overloads, MessageEventTarget mixin,
and `close()`. Its hidden inside port is retained by the implementation and
delivers incoming `message`/`messageerror` events to the global. Sending uses
MessagePort's existing conversion, cloning, and transfer path. Assigning the
global's `onmessage` does not start the port; startup enables delivery after
the initial script runs.

The hidden port is allocated during global construction rather than later in
`run a worker`; it remains disconnected and disabled. Startup must reuse it,
entangle the outside endpoint, and enable it at the specified point. This
keeps the global's required endpoint explicit without a nullable forwarding path.

The small §10.2.2 dependency is also connected: worker globals start with
`closing = false`; `close()` clears every task queue on the worker's loop and
sets that flag. EventLoop discards subsequent tasks for dedicated/shared/service
worker agents whose attached global is closing. The current task and its
microtasks can finish; this is not termination or thread teardown. Setting the
flag directly, as later lifetime algorithms do, does not itself erase old tasks.

Tests project a real dedicated global and use separate agent queues for its
hidden port and a manually supplied peer. Automatic startup,
outside Worker construction, WindowOrWorkerGlobalScope API composition, and
cross-thread transport remain dependencies. Startup must set `agent.globalScope`
before author execution; that association now has a concrete implementation type.
No Node/V8 change or execution-backend choice is needed here.

§10.2.1.3 now supplies SharedWorkerGlobalScope's global declaration, replaceable
`name`, `onconnect`, and the inherited close-a-worker operation. Its handler map
retains all common worker handlers. Unlike dedicated workers, it has no global
`postMessage`, `onmessage`, or hidden inside port: each connection supplies its
own MessagePort through a `connect` event.

Construction requires the constructor storage key, constructor URL, credentials,
and extended-lifetime option. The constructor URL remains separate from the
worker's final response URL; the storage key comes from the creating environment,
including when the script URL itself has an opaque origin. These fields supply
the later matching/lifetime algorithms; they do not implement those algorithms.
The extended-lifetime option alone does not schedule or retain anything.

Tests project a real shared global, dispatch explicit connection events with
real MessagePorts, verify independent communication, and exercise inherited
error handlers and queue closure. SharedWorker construction/discovery, automatic
`connect` event queuing and independent execution still belong
to §§10.2.4 and 10.2.6.4. The shared agent now requires this concrete global type.

§10.2.2 has also been reviewed in full. The existing worker queue closure above
covers its closing-flag rule for both dedicated and shared globals; setting the
flag alone preserves old tasks, whereas `close()` also clears them. Worker
event-loop creation still belongs to `run a worker`, and event/callback/network
producers must use that worker's queues. Window, worklet, and internal sandbox
agents do not use this WorkerGlobalScope closing check.

§10.2.3 has been read in full; its initial ownership definitions are implemented:

- `WorkerGlobalImpl.ports` returns a fresh list of this global's endpoints
  connected beyond this global, including peers in transit. It reuses the existing
  resource registry, includes the dedicated worker's hidden inside port, and
  excludes disconnected ports and channels whose two ends belong to this worker. It follows explicit
  close/disentangle, re-entanglement, and transfers before and after receipt.
- `WorkerGlobalImpl.getRelevantOwner(env)` selects the creating Window's
  current associated Document or the creating worker global. It does not flatten
  nested owners to their Documents or filter out inactive Documents. Startup and
  SharedWorker connection algorithms still need to add the result to `ownerSet`.

Transfer detaches the sending object before a receiving object exists, but the
endpoint remains connected. `MessagePortImpl.isEntangledOutsideGlobal()` keeps
the local port in the worker's list while the peer is in transit, then uses the
receiving environment once available. It does not need a peer-object lookup or
an extra owner registry. When both endpoints are in transit, neither belongs to
a global. Tests cover receipt in the same or different globals, messages queued
before/during/after transfer, closing the detached sender, and closing the
remaining endpoint during transfer. [Browser source evidence](../communication/ROADMAP.md)
also separates channel state from receiving objects. Cross-thread transport is
still a later dependency; these checks exercise the current same-isolate transport.

The existing resource registry strongly retains entangled ports, as permitted by
[MessagePort garbage collection](https://html.spec.whatwg.org/multipage/web-messaging.html#ports-and-garbage-collection).
Optional GC-driven release is not introduced here; lifetime decisions
must use actual entanglement rather than assume JavaScript wrapper collection.
Tests use real Binding, ports, and Window Documents, with manually supplied
worker identities/resource mixins. They do not create executing workers.

The next §10.2.3 slice implements the two timeout policies and the
**extended-lifetime** and **actively-needed** decisions:

- `WorkerOwnerSet` retains the usual Set operations and records when its last
  owner leaves. Redundant removals do not restart that period; adding an owner
  ends it. An initially empty set is timed from creation, before startup supplies
  its first owner.
- `Document.nonFullyActiveSince` records the current continuous inactive period,
  using the existing activity notifications, including ancestor changes. Becoming
  fully active clears the timestamp. Both durations use the UserAgent's shared
  monotonic clock; lifetime bookkeeping does not coarsen time for author exposure.
- `SharedWorkerGlobalImpl.isInExtendedLifetime()` implements the opt-in and
  strict timeout checks. A directly owning fully active Document prevents
  extension even if another owner could qualify. Only shared owners can convey
  extension; dedicated workers can still be actively needed through their owners.
- `WorkerGlobalImpl.isActivelyNeeded()` follows active Documents and extended
  workers transitively. Both traversals visit each worker once so ownership
  cycles cannot retain themselves without an eligible owner.

The between-loads policy defaults to 5 seconds, HTML's example. The extension
defaults to 5 minutes, within HTML's example range and matching the duration in
the [Chromium lifetime change](https://chromium.googlesource.com/chromium/src/+/19b97282baa04d68bf310032eccf853670038adf).
`UserAgent.extendedLifetimeSharedWorkerTimeout` reads
`serviceWorkerWithoutClientsTimeout` rather than maintaining a separate value
that could exceed the Service Worker ceiling. **That is a policy dependency,
not implemented Service Worker lifetime enforcement:** the future Service Worker
controller must consume the same limit. Its enforcement is a source TODO.

`SPEC_CLASH(shared-worker-extension-restart)`: HTML measures how long the owner
set has been empty or a Document has been non-fully-active. Browlet follows each
current uninterrupted period, so reconnection/reactivation followed by another
loss starts a new period. Chromium's change above explicitly keeps an already
running destruction/freezing timer's original deadline across those transitions.
These are different policies; the tests retain the HTML results. This comparison
is source evidence, not an end-to-end browser timing measurement.

Tests cover exact expiration, changed policy values, repeated removals and
notifications, reconnect/reactivation, inactive owners joining later, active
Document precedence, nested owners, cycles, and ancestor-induced inactivity.
They use real navigation activity and worker globals, but still do not start
executing workers or schedule shutdown.

The remaining §10.2.3 predicates are now implemented:

- `isProtected()` first requires active need. Shared workers are then protected;
  other workers need an extension, an external port, or outstanding work.
- `isPermissible()` accepts an owner or an extension. An ownerless shared worker
  also gets the between-loads grace period while this UserAgent has any navigable
  whose active Document is not completely loaded. The timeout limit is inclusive.
  Existing group/agent/Window membership supplies this query, including loading
  children beneath inactive ancestors; replaced Documents and other UserAgents
  do not count. No additional navigable registry is introduced.
- `isSuspendable()` requires permissible state without active need. These are
  predicates only; they neither suspend execution nor set the closing flag.

`SPEC_GAP(worker-outstanding-activity)`: HTML does not define "outstanding timers,
database transactions, or network connections" rigorously; its source contains
an explicit TODO to do so. The implementation counts uncanceled public timers
through callback delivery, other algorithmic timeout waits, Fetch requests until
their end-of-body task marks them done, and EventSources through reconnection.
Canceled public timers, completed fetches, and idle pooled sockets do not count.
The timer/Fetch owners expose queries over their existing state.

IndexedDB transactions and WebSocket/WebTransport connections remain explicit
source TODOs: those subsystems do not yet supply worker-owned activity. Their
future implementations must connect activity lifetimes, not just cleanup lists.
Worker timer advancement still needs the running/suspended worker clock hookup.
Tests cover queued/canceled timers, Fetch completion, a real EventSource retry
interval, ports in transit, inactive owners/cycles, loading children, exact grace
expiration, and reconnection. They use manual worker settings, not worker startup.

§10.2.4 has now been read through its processing and termination algorithms.
This slice implements the opening realm/global/settings setup, including its
§10.2.6.2 dependency. `createWorkerEnvironment()` accepts an already selected
dedicated/shared agent and the creator's settings, requested URL, creation-time
reading, and creation options. It returns the inside settings with execution
readiness still false. This extracted helper implements only the setup portion
of `run a worker`; its caller owns the remaining processing-model steps.

`WorkerEnvironment` owns the captured origin, cookie ancestry, and original time
reading. It reads the API base URL, module map, policy container, and isolation
capability from its global, and coarsens the creation time using that capability.
It has separate global resource state, including its Fetch group and timers.
Composition installs the declared dedicated/shared global, attaches it to its
agent, adds its initial Document/worker owner, and installs the usual realm host
hooks and WebAssembly integration. No additional binding protocol is introduced.

Two setup choices deserve review:

- `SPEC_GAP(worker-setup-url)`: §10.2.6.2 reads the worker URL before §10.2.4's
  fetch hook initializes it. We provisionally use the requested URL; that hook
  must replace both the global URL and environment creation URL with the final
  response URL before author execution. Blink similarly uses a separate
  [`script_url` creation parameter](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/workers/global_scope_creation_params.h)
  for initial state and
  [origin selection](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/workers/worker_global_scope.cc),
  then initializes the public global URL after fetching. This is source evidence,
  not a claim that a browser exposes the provisional URL to worker code.
- HTML explicitly leaves a shared worker's top-level origin implementation-defined.
  We capture its first creator's top-level origin, matching the required dedicated
  worker rule. This supplies existing Fetch/permission partition consumers; it does
  not add a new storage-key dimension or change shared-worker matching. Secure
  context state likewise comes from the first owner. Data URLs instead get a
  fresh opaque origin and force cross-site ancestry, while preserving that owner's
  secure-context decision.

Tests cover dedicated/shared identity and exposure, nested ownership, creator
navigation, data origins, security inheritance, response-state changes, precision,
and callback delivery on the worker loop. They compose real realms on the current
thread and do not start workers through author constructors.

The next boundary is the execution backend and remaining `run a worker` steps.
Existing agent allocation still creates loops on the host thread. Separate-isolate
startup needs creator/owner identity and UserAgent services transported explicitly;
the current outside-environment object cannot simply be sent to another isolate.
Script fetching and its response hook, channel entanglement/enablement, shared
connection delivery, execution readiness, automatic suspension/termination, and
cleanup remain pending. Worker timer advancement must follow running/suspended
time. The WindowOrWorkerGlobalScope resource mixin exists internally, but its
worker API forwarding is still a §10.3 dependency. No Node/V8 patch was made.

## Present

- `service-worker.ts` supplies a non-constructible, secure-context ServiceWorker
  identity for MessageEventSource. Its registration, state, messaging, and
  AbstractWorker members remain unfinished; this is separate from the global scope.
- `BrowletEnvironment.fetchClassicWorkerScript()` supplies request setup, the custom fetch
  hook, response validation, and UTF-8 decoding up to the explicitly unfinished
  classic-script creation method. Its tests use existing Window settings to
  exercise the fetch-client/target-settings boundary; worker startup and
  production callers remain absent. See the
  [script-fetching audit](../scripting/ROADMAP.md#html-8142-fetching-scripts).
- `fetchModuleWorkerScriptGraph()` now fetches the root and delegates descendant
  loading/linking, retaining the outside fetch client and target worker settings.
  Its constructors and module-record operations remain explicit dependencies;
  worker startup still needs to call it. Classic `importScripts()` fetching remains
  an explicit stub until synchronous pause can be supplied.
- `WorkerGlobalImpl` supplies the common state and declared surface above.
  `DedicatedWorkerGlobalImpl`
  implements the §7.1.4 owner-policy check and inheritance reports; the base
  exempts non-dedicated workers. Its dedicated-global surface and projection are
  implemented as described above; automatic startup remains unfinished.
- `SharedWorkerGlobalImpl` supplies the shared-global surface, creation fields,
  and extended-lifetime decision described above. Matching, connection delivery,
  and automatic lifetime monitoring remain with their later algorithms.
- The §7.1.7 policy initializer clones a sole document/worker owner's container
  for local non-Blob workers and otherwise uses the browser's response factory,
  including Blob creator inheritance. Policy initialization explicitly requires
  the startup-assigned URL and retains the owner set. Tests use partial globals with real construction
  environments; they do not implement worker startup or public Worker APIs.
- `service-worker-global-scope.ts` implements the DOM legacy-listener warning
  hook and inherits the common worker state. Error reporting,
  rejected-promise notification, and import-map consumers remain unwired.
  Full service workers are owned by the Service Workers specification, not HTML §10.
- The common, dedicated, and shared globals have Web IDL declarations; none has
  a registered global startup path. The source interfaces are HTML's
  [WorkerGlobalScope](https://html.spec.whatwg.org/multipage/workers.html#workerglobalscope),
  [DedicatedWorkerGlobalScope](https://html.spec.whatwg.org/multipage/workers.html#dedicatedworkerglobalscope),
  and [SharedWorkerGlobalScope](https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope),
  and Service Workers'
  [ServiceWorkerGlobalScope](https://w3c.github.io/ServiceWorker/#serviceworkerglobalscope-interface).
  Remaining global declarations will live beside their implementations, with the
  specified exposure, inheritance, members, and mixins. The internal
  embedder-policy check is not an IDL operation.
- `UserAgent.handleFetch()` is the provisional Fetch interception entry. With
  no registrations or active workers, it returns a host-owned Promise of null
  so Fetch continues to the network. Replace it with Service Workers' Handle
  Fetch algorithm when registration, worker execution, and FetchEvent delivery
  exist; retain host-owned completion independently of a page's task queue.
  Select interception before invoking `prepareRequest()` once, before body
  consumption. The no-worker path must not create an unused upload branch.
- `UserAgent` allocates dedicated/shared/service worker agent records
  and their clusters according to HTML §8.1.2. Dedicated/shared agents record
  true `[[CanBlock]]`; service worker agents record false. The current loop
  factory uses the existing host thread. Realm/settings composition now accepts
  those agents, but no production worker startup or independent execution exists.

## Execution and lifetime constraints

- A dedicated worker gets a new agent in its creator's agent cluster. A shared
  worker gets a new origin-keyed agent cluster. Every worker still owns a
  distinct worker event loop; neither arrangement means sharing the creator's
  queues or realm.
- Creating a worker establishes the agent, realm, `WorkerGlobalScope`, worker
  environment settings object, and inside/outside `MessagePort` pair around a
  Fetch-backed classic script or module graph. Fetch and script parsing may do
  realm-neutral work in parallel, but success and failure return through named
  tasks on the appropriate outside or worker global.
- If worker startup fails before execution readiness, run the inside
  environment's `discard()` steps. The Service Workers client discarded flag
  exists on `BrowletEnvironmentBase`; this startup caller remains unimplemented.
- Startup must obtain and install the response's embedder policy, then call
  `workerGlobalScope.checkEmbedderPolicy(outsideEnv, response)` before script
  execution. False requires a network error and failed-startup cleanup. The
  check reports through the outside environment, including for nested workers;
  it does not require the new worker to have a reporting queue yet. See the
  [COEP audit](../browsing/policy/ROADMAP.md#html-714-cross-origin-embedder-policies).
- After assigning the worker URL and owner set, startup must call
  `initializePolicyContainer(response, env)` with the new worker's environment.
  Worker settings must expose that same global-owned container. The separate
  global embedder-policy initialization/check above remains required, including
  for local workers whose container is inherited.
- `WorkerGlobalScope` owns its URL, type, name, owner set, policy container,
  embedder policy, module map, cross-origin-isolated capability, and closing
  flag. `WorkerLocation` and `WorkerNavigator` are stable worker-global objects,
  not aliases for their Window counterparts.
- A worker's owner is the creating `Document`, or the creating
  `WorkerGlobalScope` for a nested worker. Active-needed, protected,
  permissible, and suspendable state derives transitively from those owners,
  fully-active Documents, entangled ports, timers, database transactions, and
  network connections. JavaScript wrapper reachability alone is insufficient.
- HTML §8.1.3.5 takes secure-context status from the first owner's relevant
  settings. Populate the environment's fixed decision during worker setup;
  the worker script URL alone is not the classification input.
- Closing discards already-queued tasks and sets a flag that prevents new tasks
  from entering the worker queues. Termination additionally aborts the running
  script and clears the dedicated worker's pending outside messages. These are
  different lifecycle operations.
- Dedicated-worker messaging is the implicit entangled port. Shared workers
  receive one port per connection and are discovered by storage key, URL, and
  name through a serialized shared-worker manager. That manager is not a
  process-wide name-only registry.
- Worker realms must be projected with their Web IDL global names
  (`Worker` plus `DedicatedWorker` or `SharedWorker`). Exposure must continue to
  flow through Web IDL rather than ad hoc constructor installation.

## Planned ownership

| Planned source | Contract | Specification |
| --- | --- | --- |
| `worker-global-scope.ts` | Common worker-global state, `self`/`location`/`navigator`, event handlers, closing, and `importScripts()` | HTML §§10.2.1.1, 10.2.2, and 10.3 |
| `dedicated-worker-global-scope.ts` | Name, implicit inside port, `postMessage()`, `close()`, and `MessageEventTarget` behavior | HTML §10.2.1.2 |
| `shared-worker-global-scope.ts` | Name, constructor identity fields, extended lifetime, `close()`, and connection events | HTML §10.2.1.3 |
| `worker.ts` | `Worker`, options/type declarations, outside port, construction, messaging, and explicit termination | HTML §10.2.6.3 |
| `shared-worker.ts` | `SharedWorker`, options, exposed port, and connection to an existing or new shared global | HTML §10.2.6.4 |
| `shared-worker-manager.ts` | Serialized storage-key/URL/name discovery, option compatibility, and connection dispatch | HTML §10.2.6.4; Storage |
| `lifetime.ts` if the algorithms outgrow the global-scope modules | Owner/port discovery and active-needed, protected, permissible, suspendable, close, and termination decisions | HTML §§10.2.2–10.2.3 |
| `processing-model.ts` | Agent/realm/settings creation, worker-script fetching and execution, queue enablement, monitoring, and teardown | HTML §§10.2.4–10.2.5 |
| `worker-location.ts` | Immutable URL view over a worker global's final response URL | HTML §10.3.3 |

Declarations accompany their implementations; partial contributions stay with
their primary constructs. Worker settings extend `browlet/environment/environment.ts`; worker-agent acquisition
uses `UserAgent`; `WorkerNavigator` and its shared capability
mixins belong under `navigator/`. Keeping those owners explicit prevents the
worker processing model from turning into a second browser kernel.

Worker messaging consumes `communication/message-port.ts` and
`scripting/structured-data/`. The outside port queue stays disabled until the
worker script has loaded; shared-worker `connect` events and all cross-agent
messages are queued through the destination event loop.

Node `worker_threads` can eventually supply an execution backend, but it must
not define public identity, task ordering, lifetime, or error propagation.
Blink similarly separates worker globals and messaging proxies from execution
threads, script loading, and storage-backed shared-worker discovery.

## Delivery order

Proceed in document order with bounded slices: common/dedicated/shared globals,
event loops, lifetime, processing, errors, creation/settings, concurrent hardware,
then worker APIs. Follow small dependencies when needed and identify unfinished
owners at their call sites. This is not a fixed partition: a section may need
investigation before implementation, or several small sections may fit together.

The execution backend and shared UserAgent services need deliberate review at
the processing-model boundary. In particular, `importScripts()` must be able to
wait synchronously while its fetch continues independently. The current agent
allocators and native worker-initialization tests do not by themselves supply
that HTML worker runtime.

## Removal condition

Burn this file after dedicated/shared workers have tested realm, messaging,
event-loop, owner-derived lifetime, and termination behavior, and
service-worker work has its own specification roadmap.
