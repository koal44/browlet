# Workers roadmap

HTML §10 workers are not a prerequisite for Browlet's first single-Window
lifecycle, but they are an early proof of the execution boundaries established
by `scripting/`, `loader/`, and `communication/`. They must reuse those
boundaries instead of creating a worker-specific scheduler, script loader, or
structured-clone implementation.

## Current stopping point

The document-order review has reached **§10.2.6.3, the dedicated Worker
interface**. §§10.1–10.2.6.2 have been reviewed with dependencies recorded below;
this does not mean the processing model is fully connected. The dedicated global,
environment composition, real isolate, initial-script handoff, execution,
termination, and error reporting have focused coverage. Public `new Worker()`
still rejects successful startup until environment/shared-service composition
connects those pieces.

The hidden dedicated-worker channel and author-created MessagePorts now cross
real isolates, including pending HTML deliveries and further endpoint transfers.
Current implementation work follows those §9/§10 dependencies; an ordered audit
of both chapters will follow once their production connections are in place.
SharedWorker construction/discovery (§10.2.6.4),
concurrent hardware (§10.2.7), and the §10.3 API review still follow. In particular,
`importScripts()` remains an explicit stub; WorkerLocation was brought forward,
while WorkerNavigator still lacks its contributing APIs.

The [communication integration sweep](../communication/ROADMAP.md#worker-integration-checkpoint)
tracks the remaining worker connections in §9 separately from its earlier local
realm implementation.

BroadcastChannel now uses worker closing/suspendability checks, and cooperative
dedicated/shared worker shutdown closes locally owned EventSources after the final
checkpoint. Focused tests cover both worker kinds. Cross-isolate channel discovery
and remote Fetch cancellation remain shared-service transport dependencies.

The current §9.4 transfer slice promotes a local endpoint pair to native transport
only when a message crosses isolates. Its interface-owned transfer record carries
the handle and pending HTML queue; receipt installs the queue disabled, in the
receiving realm. Nested transferred ports/buffers, repeated transfers, both-end
transfer, direct worker-to-worker delivery, and failure/termination cleanup have
real-isolate coverage. This does not connect public startup or a SharedWorker
manager, transport other transferable interfaces, or supply remote owner monitoring.

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
- **§10.3.2 WorkerNavigator:** stable identity and shared
  [NavigatorID](../navigator/ROADMAP.md#client-identification) are implemented.
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
microtasks can finish; cooperative loop shutdown is now connected below. This
is not forced termination or native thread teardown. Setting the flag directly,
as later lifetime algorithms do, does not itself erase old tasks.

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

The separate-isolate backend now lives in JS Engine's `threads.ts`. `JSThread`
and `JSThreadEndpoint` hide native threads, ports, and initialization data, preserving
the current executable, backend environment, and Node startup options. They report
native failure/exit and can terminate blocked execution. They have no HTML Agent
or readiness policy.

`WorkerThread` in `integration/host/worker-thread.ts` owns the browser setup
acknowledgement and reloads the current Browlet bundle (`index.mjs` or
`index.cjs`) in the new isolate. Callers supply no executable path. Private
startup data inside JS Engine identifies the exact bundle that should start its worker runtime;
ordinary imports inside other Node workers or another installed copy remain
ordinary imports. This trusted host entry is separate from the author's
worker-script URL. It reports readiness only when the inside runtime finishes
host setup, not at Node's earlier `online` event.
`WorkerThreadRuntime` creates the dedicated/shared agent and EventLoop inside the
isolate and queues incoming commands as tasks. Native termination does not yet
implement HTML's termination algorithm or the public Worker interface. The control channel
uses Node cloning for host data. It does not implement HTML structured cloning,
transferable ports, or author `message` events. Lifecycle tests redirect only
the native loader to a trusted source fixture to create an engine realm, exercise
tasks/checkpoints, prove creator progress during a blocked worker script, and
cover failure/exit/cancellation.
Their TypeScript-loader startup cost is not a measurement of a packaged worker.

`integration/host/worker-thread.ts` registers its module URL and browser setup
steps once with `JSThread.initialize()`. JS Engine owns file-URL conversion,
the native startup envelope and marker check, and the host turn after module
evaluation. Thread construction supplies only data and a receiver; the browser
adapter imports no Node modules and never handles a filesystem entry path.
There is no eval, extra worker
bundle, private package mapping, or new public export. Each isolate loads its
own JavaScript definitions; importing the package does not construct another
Browlet, Window, or UserAgent. The native thread primitives remain in JS Engine.
The full package costs some extra loading; the existing worker environment's
shared Web IDL assembly already brings in most of that graph.
Build with `node scripts/build.mjs browlet` before running artifact tests. They
relocate the published files (including special characters in the path), load
both parent formats, and cover both worker kinds, cancellation, the explicit
missing settings/service boundary, and unrelated workers importing the library.
Source lifecycle tests keep their explicit TypeScript fixture; raw source startup
still requires a suitable loader rather than a fallback to a different artifact.

The remaining startup boundary is connecting the creator environment snapshot,
restored policy values, and cluster identity to UserAgent services. The runtime
owns its execution agent and local cluster membership; it leaves UserAgent services and the complete
WorkerGlobalScope to that integration.
The current outside-environment object cannot simply be sent to another isolate.
The production entry deliberately stops at host readiness. It keeps its control
channel alive but rejects commands until startup can connect that endpoint to
`createWorkerEnvironment()` with transported settings and services. Existing
UserAgent agent allocation still creates loops on its own thread.
Connecting script fetching to that host, channel entanglement/enablement, shared
connection delivery, execution readiness, automatic suspension/termination, and
cleanup remain pending. Worker timer advancement must follow running/suspended
time. The WindowOrWorkerGlobalScope resource mixin exists internally, but its
worker API forwarding is still a §10.3 dependency. No addon or Node/V8 patch was made.

The next §10.2.4 slice supplies `WorkerEnvironment.fetchScript(outsideEnv,
credentials, onComplete)`, extracting the processing model's fetching portion.
It uses the existing classic/module worker fetchers, reserves the inside client
for the root, installs its final URL and policy container, initializes worker
CSP, checks COEP inheritance, and derives the worker's isolation capability.
The global's embedder policy uses the selected container, including inherited
local/Blob policies. Shared workers choose logical isolation, consistent with
Window startup; this does not claim physical isolation. Dedicated workers also
require the owner's capability and lose it for data URLs.

The module worker entry now forwards the existing custom-fetch hook through its
root and descendants. Descendants take the normal Fetch path without replacing
the global's root URL or policies. The returned script/graph is parsed and linked,
but not executed. The processing-model caller still owns failure events,
environment discarding, port setup, execution readiness, and evaluation.
The separate-isolate bootstrap remains at its explicit transport boundary.

`SPEC_CLASH(worker-rejected-response-url)`: the response hook replaces a rejected
response with a network error, then uses that response for COEP reporting and
the data-URL check. Network errors have no URL. Keep the original response for
the remaining checks and return a network error to the script loader afterward.
An incoming network error bypasses initialization because it has no response
settings to install. Tests retain simultaneous CSP/COEP rejection and reporting.

The transport review found that opaque-origin/agent identities contained
Symbols, while owner and UserAgent references point at live objects. Author
structured serialization does not provide remote access to those objects.
Chromium likewise separates copied settings from service connections:
[`GlobalScopeCreationParams`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/workers/global_scope_creation_params.h)
contains origin/cluster inputs and remote Blob-store/browser-service endpoints;
`DedicatedWorker` captures a `FetchClientSettingsObjectSnapshot`. Reuse Browlet's
serialization where its value contracts apply, but preserve shared-service and
owner identity through a deliberate host transport. No copying of UserAgent
stores, replacement UserAgent, or generic remote-object registry was added.

`WorkerThread.captureCreatorEnvironment()` captures a plain
`CreatorEnvironmentSnapshot` before creating the isolate. The thread retains
the live `creatorEnv` and exact original owner locally, and sends its
`creatorEnvSnapshot` to `WorkerThreadRuntime`.
It carries creation/base/top-level URLs, origin/top-level origin, security and
ancestry flags, isolation capability, creator identity, and policy data. This
snapshot is not an Environment or a Fetch client; reporting and shared-service connections
must be supplied before it can drive either worker composition or script fetching.

The transport uses existing `URLRecord` and `Origin` records, including tuple
hosts/domains. `copyURL()` and `copyOrigin()` detach mutable paths and host data,
so later changes to the live creator do not change the retained snapshot. URLs
cross as records without serialization/reparsing; their cached Blob registrations
are omitted because they refer to live environments. Opaque origins now own UUID
identity strings instead of Symbols: copies preserve equality through native cloning,
while ordinary origin serialization still returns `"null"`. `AgentCluster` owns
its portable ID, and the environment retains its existing ID. There is no weak
identity table or separate UserAgent/agent/owner token. The retained owner reference
prevents navigation in one Window environment from changing the worker's owner.

The inside dedicated agent joins a local cluster representation with the inherited
ID, keying, and isolation mode. A shared agent gets a new origin-keyed cluster
with mode `none`; response processing may subsequently update that mode. A nested
dedicated worker captures its creator's current cluster ID rather than minting a
new identity for that representation. Membership sets hold only local agents.
Identity does not provide remote-object access or native memory isolation.

This matches the responsibility split in current browser sources:
Chromium's [GlobalScopeCreationParams](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/workers/global_scope_creation_params.h)
copies existing SecurityOrigin and agent-cluster identity; its
[DedicatedWorkerMessagingProxy](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/workers/dedicated_worker_messaging_proxy.h)
owns startup/control. Firefox's [WorkerLoadInfo](https://github.com/mozilla-firefox/firefox/blob/main/dom/workers/WorkerLoadInfo.h)
carries general principal data and a cluster ID, while WorkerPrivate retains the
parent worker. WebKit's [WorkerThread](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/workers/WorkerThread.h)
and [WorkerMessagingProxy](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/workers/WorkerMessagingProxy.cpp)
separate copied parameters from parent/child lifetime management. Their existing
origin representations preserve opaque identity; Browlet does so at Origin's
owner rather than defining another worker-specific origin type.

Shared-service connections and remote lifetime updates remain unfinished.
Blob URLs carry records without cached registrations; resolving them
still requires the original UserAgent's store. HTML structured serialization contains
local AgentCluster references and requires a destination binding; it still needs
its own cross-isolate transport. No Node or V8 change was required.

Thread tests cover both worker kinds receiving the snapshot, navigation/post-send
mutation, opaque equality/separation, IPv6 values, absent top-level values, Blob
URL records crossing without their cached registration, and real isolate → isolate
nested startup through WorkerThread. Nested tests compose
a real worker environment using fixture-local services, since remote services do
not exist yet. They check inherited clusters (including a shared parent), fresh
data-worker origins, unchanged top-level partitions, and exact local ownership;
they do not claim that the public Worker constructor or remote service transport
is implemented. Origin tests also preserve public `"null"` serialization.

The next startup slice transports the creator's policy container. PolicyContainer,
CSPList, and ContentSecurityPolicy own `toSnapshot()`/`fromSnapshot()`; the
host channel carries plain values and reconstructs local implementations.
PolicyContainer restores its CSP list directly. HTML sandbox flags live in
`policy/sandbox/`; source matching belongs to CSP and is reused by Permissions Policy. CSP's
current directives, original reporting text, warnings, source, disposition, order,
and inherited `self` origin remain distinct. Re-parsing the original text would
lose changes made to parsed policies. COEP's enforced/report-only settings and
endpoint names, referrer policy, and both integrity policies are preserved too.
Snapshot capture and reconstruction each detach mutable lists and origin records.

`WorkerThreadRuntime.creatorPolicyContainer` is the creator's policy data,
not the worker response's selected policy container. The same-isolate response
selection path remains unchanged. Cross-isolate tests reconstruct and evaluate
directives in both worker kinds after creator mutation/navigation. The existing
nested data-worker fixture now applies the real local-policy inheritance algorithm
before creating its child, preserving inherited CSP `self` despite the data
worker's new origin. Fixture-local services still supply that composition;
these tests do not claim production script fetching or public Worker startup.

Reporting endpoint names do not supply report delivery, and a policy snapshot
does not resolve Blob registrations or provide cookies/storage. The shared-service
transport, remote ownership/lifetime, and Fetch client connection remain explicit
dependencies at the production startup boundary. No Node/V8 or add-on changes.

The next §10.2.4 slice supplies the **initial script Fetch response handoff**.
`WorkerThread.fetchScript(request)` accepts a normally prepared HTML script
request in the creator isolate. Existing Fetch owns origin/CSP checks, redirects,
credentials, cookies, caches, and captured Blob registrations there. Its body
streams use the UserAgent's existing sandbox execution owner, and its callbacks
use Fetch's parallel queue, so an inactive creator Document cannot stall body
consumption or delivery. The request retains its real client; it is not a Fetch
client reconstructed from the creator snapshot.

Only the consumed script response crosses the private channel: unfiltered URL
history, status, headers, failure state, and body bytes. This is not general
Fetch-response serialization; it carries no live streams, controllers, or timing
resources. Blob creator policies are captured through the existing UserAgent
factory before cached Blob entries are removed from transported URLs. Network
errors do not attempt Blob policy inheritance. The receiving runtime rebuilds
response metadata and policy implementations and invokes its supplied consumer
on the worker's networking task source. Termination or unexpected isolate exit
cancels a pending fetch; a late completion cannot send into a stopped worker.

Both endpoints now use one private `WorkerThreadProtocol` for startup data and
the two message directions. JS Engine contains the untyped native transport
boundary; Browlet has explicit cases for each message kind and rejects unknown
kinds with `assertNever`. Receivers trust the typed message object rather than
guarding against null or validating entire response snapshots. Nested payloads
remain data, not control messages.

JS Engine owns `NodePromise` and exposes one internal thread completion with a
private implementation result. Native termination Promises stay at that backend
boundary. The worker host chains its local cleanup onto the engine completion;
`terminate()` returns the same completion as `closed`, including rejection if
termination or cleanup fails. Readiness and cleanup reactions run on the creating
isolate's host queue without advancing a page or child event loop. No Promise or
resolver crosses the isolate boundary.

The protocol and lifecycle follow-up passes 40 worker cases in each of the six
supported runtime configurations (240 passes), including termination rejection
and cleanup failure propagation, plus all 18 rebuilt CJS/ESM bootstrap artifact
tests. Typecheck, focused ESLint, import checks, and diff checks pass.

This is a transport building block, **not connected public worker startup**.
The production bootstrap still has no script-response consumer or composed
WorkerEnvironment. The startup caller must supply the reserved inside-client
identity and prepared request, then connect response policy initialization,
parsing/evaluation, failure cleanup, and execution readiness. Local non-Blob
policy inheritance must still use the captured owner policies; Blob responses
must use the transported Blob creator policies. Module descendant requests,
nested-worker service forwarding, reporting, and remote lifetime management
remain separate dependencies. No copied UserAgent or replacement stores are
created, and no Node/V8 or add-on change is needed.

Real-isolate regressions cover both worker kinds, cookies sent and stored in the
creator's store, redirected responses, CSP rejection before network dispatch,
Blob revocation and retained policy values, absent/failed bodies, networking-task
delivery without creator-loop advancement, and fetch cancellation on both forced
termination and unexpected worker failure. Script bytes are not executed.

Validation: 35 thread/snapshot/handoff cases and 19 existing worker-fetch cases
pass in each of the six supported runtime configurations (324 passes). All 14
rebuilt CJS/ESM bootstrap artifact cases pass, along with typecheck, focused
ESLint, import checks, and diff checks. The build retains its existing cycle
warnings; these runs produce no shutdown warning.

Validation: all eight policy snapshot/transport cases pass across the six runtime
configurations. The full 31-case thread/snapshot suite passes on Node 26/compat,
as do 60 policy/worker-fetch cases and 14 rebuilt CJS/ESM bootstrap artifact cases.
Typecheck, focused ESLint, import-boundary checks, build, and diff checks pass.
The build retains its existing circular warnings; worker tests exit without the
earlier shutdown warning.

Validation: the initial 23-test thread/snapshot suite passed on Node 24.19.0,
Node 26.8.1, and the custom build, each with and without the add-on (138 passes).
After the naming and URL-record follow-up, all 11 affected snapshot/transport
tests pass across those six configurations (66 passes). The rebuilt, relocated
CJS/ESM bootstrap again has 14 passing artifact tests. Earlier broader URL/origin,
browsing-context, agent, and same-cluster checks had 412 passes and one existing
expected failure for Window Atomics.wait. Typecheck, ESLint, import boundaries,
and the package build pass; the build retains its existing circular warnings.

The earlier official-Node runs' intermittent `Timeout terminating forks worker`
warning came from the source fixture's tsx disk-cache I/O. On Node 26/compat,
402 background writes were still pending at the fixture's first command; hundreds
of cache-file handles remained after the native worker terminated. Vitest's stop
handshake completed promptly, but Windows process destruction took over ten
seconds. The fixture now disables only tsx's disk cache before loading source,
retaining its in-memory cache. Production workers load the package bundle and do
not use tsx. No engine/add-on changes, timeout increases, or test reclassification
were needed. The 11 affected cases then exited about 29 ms after the process kill.
All 24 thread tests now pass and exit without warnings across the six runtime
configurations (144 passes). Focused ESLint and diff checks pass. Investigation
probes and measured controls are in the experimental repository's
`worker-shutdown/FINDINGS.md`.

The script-fetch tests use real worker composition, Fetch, CSP/COEP, script parsing, and
module linking, replacing only HTTP I/O. They cover redirects, local inheritance,
sandbox allow/deny/report-only/meta behavior, failed responses, nested-worker
capability inputs, module credentials, and root-policy retention across descendants.
They exercise this consumer on the current thread, not a completed worker launcher.

**Initial script execution and port activation (HTML §10.2.4):**
`WorkerEnvironment.runScript(script, outsidePort, insidePort)` extracts the
successful onComplete steps 9–14 from run-a-worker. From the initial script's
completion task it marks execution readiness, uses the existing classic/module
runner, and enables the outside port. Dedicated workers also enable their inside
port; shared workers instead queue a trusted `connect` MessageEvent with that
port as both source and the sole frozen ports entry. Module evaluation, including
top-level await, does not delay activation. Normal script error reporting remains
with the existing runner, and `close()` suppresses further worker tasks.

`WorkerEnvironment.completeScriptFetch(script, worker, outsidePort)` now supplies
the preceding completion steps. Null scripts and `errorToRethrow` queue an ordinary
trusted `error` at the outside target on its original port's environment, discard
the unready worker environment, and stop. Successful loads reuse the dedicated
global's hidden port or create a shared connection port, entangle it with the
outside port, and call `runScript()`. WorkerLocation already reads the final response URL.

The outside target currently uses the existing EventTarget base because the
concrete Worker/SharedWorker classes have not been implemented. Their startup
caller must supply the corresponding original outside port and associate the
outside object with the global. Owner-derived closing/suspension monitoring and
the ServiceWorkerContainer client message queue also remain dependencies. The
separate-isolate bootstrap still has no composed WorkerEnvironment or connected
script-response consumer; these helpers do not replace that integration or thread teardown.

Executing real worker source exposed a bare-global receiver gap: `onmessage = ...`
reached Binding with Node's underlying global proxy instead of the projected worker
global. The existing global platform-object proxy now redirects that exact receiver
when its object is also globalThis. Explicit author receivers and WindowProxy's
separate forwarding are preserved; the raw top-level `this` identity limitation
remains. No engine or add-on change is required.

Nine new regressions cover activation ordering through script cleanup and its
microtasks, shared connection identity and explicit port start, runtime error
reporting, top-level await, close, and bare versus explicit global receivers.
All nine pass in the six runtime configurations. The wider 80-case worker/Binding/
Window matrix has no ordinary failures; stock runtimes retain 25 existing expected
Window-access failures per runtime.

Ten completion regressions cover dedicated/shared network and parse failures,
error task ownership and event shape, port setup, actual classic/module fetching
through execution, and module syntax/link failures before readiness. The outside
target is a real projected EventTarget, not a provisional Worker API. All 38
completion, execution, and fetching cases pass across the six runtime configurations
(228 passes). Type checking, focused ESLint, import boundaries, and diff checks pass.

**Cooperative shutdown (HTML §§8.1.7.3 and 10.2.4):** The worker event-loop tail
now recognizes a closing dedicated/shared worker after all task queues are empty
and the final checkpoint has finished. Disabled port queues still count as queued
work. The destroyed loop rejects further tasks and microtasks; resumed spinning
tasks use the same closing rule as newly queued tasks. `close()` wakes an idle
loop so this tail runs even when it removed the last queued task.

`WorkerGlobalImpl.finishRunning()` extracts run-a-worker's final three steps:
clear its timers, disentangle its external ports (including a peer in transit),
and empty its owner set. Outgoing messages already queued on other loops remain
deliverable. Local-only channels are not in HTML's list of the worker's ports.
The final task and its microtasks retain these resources until they finish.
It also closes locally owned EventSources, canceling requests and retry timers;
the [communication roadmap](../communication/ROADMAP.md#92-eventsource) records
HTML's omission of that cleanup and Blink's matching context-destruction behavior.

This supplies cooperative HTML-loop cleanup. Forced termination uses the separate
outside execution owner described below. Natural native isolate teardown must
still be connected when startup owns the
composed environment. Owner-derived closing/suspension monitoring, worker timer
advancement, rendering, and the Service Workers processing model remain explicit
dependencies. Future lifetime monitors must wake the loop after changing closing
state; no polling or owner observer registry is introduced here.

Nine regressions exercise script/microtask completion, old and disabled queues,
idle and external-checkpoint closure, late tasks/microtasks/spinning continuations,
and external ports in transit alongside local-only channels. They use real worker
environments and bindings with controlled host turns. All 242 selected worker,
task, timer, idle-period, pause, and spinning cases pass in the six runtime
configurations (1,452 passes). Type checking, focused ESLint, import boundaries,
and diff checks pass. No engine or add-on change is required.

**Termination messaging (HTML §10.2.4):** `MessagePortImpl.clearOutgoingMessages()`
extracts terminate-a-worker's fourth step for the dedicated global's implicit
inside port. It removes pending deliveries from the entangled endpoint, including
disabled queues, tasks moved to another realm, and messages retained during port
transfer. Other channels sharing the same task source and incoming messages are
untouched. A delivery already running on the outside loop can finish.

This operation does not disconnect the channel or stop the worker. Ordinary
`close()` and cooperative shutdown continue to preserve already-sent messages.
The separate-isolate host owns the outside port directly and clears its queue
through `clearMessageQueue()`, using the same endpoint cancellation. It does not
need a reference to the inside global across the isolate boundary.

Seven new regressions cover enabled/disabled queues, unrelated and incoming
messages, transferred and in-transit peers, a running delivery, a disconnected
peer, and the dedicated worker's actual hidden port before cooperative cleanup.
All 103 selected messaging, lifetime, execution, global-scope, and shutdown cases
pass in the six runtime configurations (618 passes, no failures). No engine or
add-on change is required.

**Native worker termination connection (HTML §§8.1.4.5 and 10.2.4):**
`WorkerThread` retains the dedicated outside Worker and its original port as local
initialization state; neither is cloned into the worker. `terminate()` stops
admitting host messages, requests native interruption directly, and clears the
outside delivery queue before returning its existing internal completion. Native
exit disposes the inside agent, queues, and heap without running author
catch/finally or a final microtask checkpoint. Host exit handling cancels the
initial fetch and disentangles the outside port. Natural exit preserves queued
outside messages. Shared workers use the same native interruption; their future
connection manager must own cleanup of all their outside connections.

A regression exposed that canceling Fetch before requesting native interruption
could throw and prevent the stop entirely. Fetch cleanup now runs after native
exit; its error rejects the completion, and finally still releases the outside
port. Termination remains idempotent, including while startup is blocked.

Real-isolate fixtures compose worker environments and run both HTML classic and
module scripts in infinite loops. Shared flags confirm that catch, finally,
pending Promise reactions, and error handlers do not run. Real outside port queues
cover immediate cancellation, unrelated deliveries, disconnection even when
Fetch cleanup fails, and preservation of deliveries on natural exit. The fixture
still supplies local services explicitly; it does not stand in for production
cross-isolate UserAgent services or structured MessagePort transport.

All 86 selected native-thread, messaging, and worker-shutdown cases pass on Node
24.19.0, Node 26.8.1, and the custom build, each with and without the add-on (516
passes, no failures). Type checking, focused ESLint, import boundaries, and diff
checks pass.

The public Worker constructor's startup call (§10.2.6.3), production inside
environment composition, shared-service and port transport, and automatic natural
thread teardown remain pending. `Agent.abortRunningScript()` still does not
interrupt a Window sharing the caller's Node thread. No engine or add-on change
is required for this worker-specific path.

### Runtime errors and AbstractWorker (HTML §§10.2.5–10.2.6.1)

Reviewed §10.2.5 against the existing §8.1.4.6 reporter. Classic-script runtime
and parse errors, and module evaluation failures, reach the worker global's
trusted, cancelable ErrorEvent. The shared HTML handler machinery already
supplies the five-argument `WorkerGlobalScope.onerror` callback and cancels on
true; ordinary event listeners can use `preventDefault()`. Classic-script
muting and the per-global recursion guard remain in the common reporter.
The stale TODO claiming that special onerror handling was missing is removed.

§10.2.6.1 now has a real `AbstractWorkerMixin` and its Web IDL declaration.
Outside-object `onerror` uses the ordinary EventHandler contract: one event
argument, with false canceling the event. The existing ServiceWorker identity
includes this mixin as required by the Service Workers specification. This adds
the handler surface only; registration, worker execution, and service-worker
error delivery remain separate dependencies. The upcoming Worker and
SharedWorker implementations must include the same mixin.

Tests exercise both dedicated and shared worker globals through real settings,
bindings, and script runners. They cover local dispatch/cancellation, parse and
module failures, muted errors, recursion suppression, and shared-worker console
reporting. AbstractWorker tests use the existing ServiceWorker includer and
cover callback arguments, cancellation, receiver checks, replacement, and removal.
No private Binding fixture, native thread, add-on change, or engine patch is
needed for these local behaviors.

All 47 selected tests pass on Node 24.19.0, Node 26.8.1, and the custom build,
each with and without the add-on (282 passes). The two previously approved
script-selection skips remain unchanged in each configuration.

Remaining dependencies are explicit rather than treating §10.2.5 as complete:

- Dedicated errors now have diagnostic transport, outside Worker delivery, and
  live-owner propagation as described below. Production startup must connect the
  dedicated global's `reportErrorToOwner` to its runtime before author execution;
  an unconnected reporter still fails explicitly.
- Propagation must continue through terminated parents while suppressing their
  handlers. Port disentanglement and the outside execution association now exist;
  the error route that consumes them does not yet exist.
- Error filename/line/column extraction remains the existing §8.1.4.6 diagnostic
  metadata dependency. These tests do not claim source-position attribution.
- The public worker `reportError()` API still belongs to the pending
  WindowOrWorkerGlobalScope inclusion/forwarding. Script runners already use
  the common environment reporter independently of that public API.

### Worker settings audit (HTML §10.2.6.2)

Reviewed [script settings for workers](https://html.spec.whatwg.org/multipage/workers.html#script-settings-for-workers)
in document order. The setup introduced for §10.2.4 already supplies this
section; no additional runtime behavior is needed in the settings object.

| Requirement | Existing owner |
| --- | --- |
| Realm, retained execution context, and HostDefined settings | `createWorkerEnvironment()` composes the realm/global, and `BrowletEnvironment` attaches itself to that realm. |
| Origin | Composition creates a fresh opaque origin for `data:` workers; otherwise it retains the creator's origin. |
| Module map, API base URL, policy container, and isolation capability | `WorkerEnvironment` reads the worker global, including changes installed from the initial Fetch response. |
| Cross-site ancestry | Composition captures the creator's ancestry flag and treats `data:` workers as cross-site. Nested workers inherit that decision. |
| Time origin | The getter coarsens the original creation reading using the current worker isolation capability. |
| Environment identity and initial state | A fresh ID, the script creation URL, null top-level creation URL, null target browsing context, and null active service worker come from the environment base. |
| Top-level origin | Dedicated workers inherit it. Shared workers use the first creator's value as the implementation-defined policy, retaining it after that creator navigates. |

Expanded settings tests cover same-site and cross-site frame ancestry, including
scheme differences, nested workers, and a `data:` worker whose top-level creator
has no cross-site ancestor. Earlier settings fixtures have no active navigable,
so their creator is conservatively cross-site and did not cover the false path.
The creator-replacement regression now covers shared workers too. Existing
response-fetch tests verify that redirects replace both worker URL fields and
install policies without changing the captured origin.

The 37 settings and response-fetch cases pass on Node 24.19.0, Node 26.8.1,
and the custom build, each with and without the add-on (222 passes, no failures).

The accepted `SPEC_GAP(worker-setup-url)` remains: HTML reads the global URL before
the processing model assigns it. Setup provisionally uses the request URL, and
response initialization replaces it before execution. Separate-isolate setup
still needs the creator snapshot connected to UserAgent/reporting services and
the production global, as recorded above; these local settings tests do not
claim that startup integration. Service-worker settings remain with their own
standard.

### Dedicated Worker outside object (HTML §10.2.6.3, first slice)

Read the complete [dedicated Worker interface](https://html.spec.whatwg.org/multipage/workers.html#dedicated-workers-and-the-worker-interface).
`WorkerImpl` now supplies the ordinary EventTarget implementation, a strongly
retained hidden outside port, both `postMessage()` overloads, and the
AbstractWorker/MessageEventTarget mixins. Assigning `onmessage` does not enable
that port: initial-script completion remains responsible for queue enablement.
Web IDL declares Worker, WorkerOptions, WorkerType, and the specified exposure
to Window, DedicatedWorker, and SharedWorker globals.

Constructor initialization applies the existing TrustedScriptURL compliant-string
algorithm with the Worker sink name, then the relevant environment's encoding
URL parser and SyntaxError DOMException. Web IDL owns argument, union, dictionary,
and enum conversion. As with the dedicated global's inside port, implementation
allocation creates the disabled, disconnected outside port; this precedes URL
checks internally without exposing or registering a connection.

Successful public construction still stops at the missing production run-a-worker
connection. After valid input, `initialize()` throws there. Termination now uses
the native execution association described below; production startup must install
it before returning the public Worker.

Tests project internally allocated outside implementations through ordinary
Binding and connect real ports/settings in separate local agents. They cover
cloning, both transfer overloads, delivery targets, queue enablement, messageerror,
outside error-handler cancellation, cross-realm receivers, constructor conversions,
Trusted Types, malformed URLs, and initial-script message delivery through
`completeScriptFetch()`. These tests do not claim separate-isolate startup or
treat the startup stub as required browser behavior.

All 49 selected interface, global, and script-completion tests pass on Node
24.19.0, Node 26.8.1, and the custom build, with and without the add-on (294
passes, no failures or skips). Type checking, focused ESLint, import boundaries,
and diff checks pass. No Node, V8, or add-on changes are needed for this slice.

Still required before §10.2.6.3 is complete:

- Connect the production isolate's creator snapshot to its WorkerEnvironment
  and the creator UserAgent's shared services, retaining the outside Worker/host
  association. Constructor options and the parsed URL must reach that startup.
- Transport the hidden MessagePort channel across isolates, including messages
  sent immediately after construction, before the initial script has loaded.
- Connect the inside global's error reporter during production startup. Live-owner
  propagation is implemented below; the terminated-parent route remains pending.

Stay at this startup boundary before moving to §10.2.6.4 SharedWorker discovery.

### Outside execution association and terminate (HTML §10.2.6.3)

`WorkerThreadInit.worker` replaces its bare `outsidePort` input. A dedicated
Worker supplies its own creator environment and hidden port. The host retains
that outside object locally, and installs the reciprocal `WorkerImpl.thread`
only after native creation succeeds. Shared and agent-only fixtures still supply
`creatorEnv` directly; no implementation objects cross the startup channel.

Public `terminate()` forwards to this host and returns undefined. The existing
host path interrupts even blocked execution, clears pending outside deliveries,
and completes Fetch/port cleanup independently of the creator's event loop.
Exit releases the association even if Fetch cleanup throws. Calling terminate
again is harmless; calling it after natural exit preserves messages sent before
the worker closed. Host completion and failure remain on the internal `closed`
promise, separate from the public return value.

The real-isolate lifecycle tests now use projected Workers. Classic and module
runners, blocked startup, repeated calls, cross-realm method borrowing, native
termination failure, Fetch cleanup failure, and natural/failed exit exercise the
public operation. These are still fixture-composed inside environments, not
successful public `new Worker()` calls. Production startup, service/message
transport, and the error-delivery connection remain the dependencies above.

All 62 affected interface and native-thread cases pass on Node 24.19.0, Node
26.8.1, and the custom build, with and without the add-on (372 passes, no failures
or skips). Type checking, focused ESLint, import boundaries, and diff checks pass.

### Dedicated error delivery across isolates (HTML §§8.1.4.6, 10.2.5)

The dedicated global's `reportErrorToOwner` is a narrow host delivery callback,
installed before execution. After local dispatch leaves an error uncanceled,
the common environment reporter sends its diagnostic attributes with `error`
set to null. `WorkerThreadRuntime.reportError()` copies only message, filename,
line, and column onto the private channel; no exception value or platform object
crosses isolates. The receiving `WorkerThread` uses its retained outside Worker.

`WorkerImpl.reportError()` queues the required DOM-manipulation task. The
outside Worker receives a trusted, cancelable ErrorEvent in its own realm. If
uncanceled, the creator global receives the same diagnostics with `error: null`.
`BrowletEnvironment.reportErrorInformation()` is the extracted dispatch portion
of reporting: local callers retain `reportException()`, including extraction,
script muting, and original-value console reporting. Transported reports enter
with their existing attributes instead of re-extracting a fabricated exception.
The existing recursion guard and five-argument global handler still apply.

Real-isolate tests cover classic/module exceptions, local cancellation, outside
handler cancellation, muting, diagnostic preservation, and a live nested-worker
chain. A thrown function remains available to the inside handler and never
reaches native structured cloning. Fixtures supply existing environment
composition while the production shared-service startup remains unfinished.

This does not finish propagation through terminated parent workers. The host
channel is parent-local; a surviving owner route must outlive the parent's
isolate and suppress its handlers. Native source-position extraction is also
still pending; supplied locations survive transport, but ordinary extracted
reports retain the existing empty filename and zero line/column.
No Node, V8, or add-on changes are needed.

All 93 selected worker and common error-reporting cases pass on Node 24.19.0,
Node 26.8.1, and the custom build, with and without the add-on (558 passes).
The two previously approved script-selection skips remain unchanged in each
configuration. Type checking, focused ESLint, import boundaries, and diff checks pass.

### Structured data across isolates (HTML §2.7 startup dependency)

The hidden port needs portable serialization records before it can carry author
messages. Records and transfer holders now retain the existing agent-cluster ID,
instead of the live cluster and its agents. Receiving checks compare that ID to
the target cluster's ID, including the preflight before transfer consumption.

Real dedicated/shared isolates test ordinary graphs, transferred ArrayBuffers,
shared memory, and Wasm Modules through HTML serialization and reconstruction.
Dedicated workers accept their inherited restriction; shared workers reject it.
Fixtures supply the existing worker environment composition and isolation state.
No Node, V8, or add-on change is needed.

This established the serialization prerequisite. The subsequent channel slices
connect hidden and author MessagePorts; production environment/shared-service
composition and successful public `new Worker()` startup remain unfinished.
Continue these dependencies before moving to SharedWorker discovery.

All seven new cases pass in all six runtime configurations. The broader
154-case selection retains its two existing iterator/length-tracking expected
failures where those native capabilities are unavailable; custom/addon passes
all 154 cases. Type checking, focused ESLint, import boundaries, and diff checks pass.

### Transferable native channels (HTML §10.2.6.3 startup dependency)

JS Engine's `JSMessageChannel` and `JSMessagePort` now supply the missing native
transport. Ports wrap their native backing and expose native transfer handles.
The handle type aliases Node's MessagePort; JS Engine owns its operations.
Thread startup and both directions of thread/channel sends accept
explicit endpoint/ArrayBuffer transfer lists. Native queues and peer connections
survive transfer; two worker isolates can communicate without a creator relay.
The old owner removes its receiver before moving a handle. The receiving owner
wraps it locally and chooses when to install its host receiver.

The HTML requirements come from [§10.2.4's port setup](https://html.spec.whatwg.org/multipage/workers.html#run-a-worker)
and [§9.4.4's transfer-receiving and post-message steps](https://html.spec.whatwg.org/multipage/web-messaging.html#message-ports).
The latter move queued HTML tasks to the receiving port's initially disabled
queue, then deserialize and fire events when those tasks run. Native messages
waiting for a host receiver are a separate queue; preserving them does not move
HTML tasks that have already been queued. Removing a native listener is an
internal handoff operation, not an HTML operation to disable a started port.

Real-isolate tests cover queued messages before/during/after transfer, repeated
transfer of an active endpoint, nested endpoint and ArrayBuffer transfer,
failed-send ownership, direct worker-to-worker traffic, and peer closure after
normal close or native termination. No add-on, Node, or V8 change is needed.

All ten channel cases, the thread type contract, and the 59 existing worker
cases pass in all six configurations (420 passes, no failures or skips).
Type checking, focused ESLint, import boundaries, and diff checks pass.

This primitive is connected to the implicit dedicated-worker channel below and
to the author-port handoff described in the current stopping point.

### Dedicated worker message channel across isolates

`WorkerThread.connectMessagePort()` creates a native channel, transfers its inside
endpoint on the private control channel, and associates the other endpoint with
the retained outside Worker's hidden MessagePort. This can happen before native
readiness, retaining messages posted immediately after construction. The inside
runtime holds its endpoint until environment composition calls
`connectMessagePort()`; either the endpoint or the global can arrive first.
The startup caller must run the initial script before enabling the queues.
Connection does not imply HTML execution readiness.

`MessagePortImpl.entangleRemote()` supplies the corresponding remote connection.
HTML still serializes synchronously and queues every delivery on the receiving
environment, selecting its realm, activity checks, MessageEvent target, and
microtask checkpoint. ArrayBuffer transfer holders move through the native pipe;
the detached author buffer is not retained or exposed there. Both HTML queues
remain disabled until explicitly started, even while the host pipe is receiving.

Native closure releases the hidden endpoint's global retention while preserving
already queued HTML deliveries. Forced termination disconnects host delivery
before clearing the outside queue, preventing native in-flight records from
refilling it. Cooperative close preserves previously sent messages.

Real-isolate tests cover messages posted before startup, queue activation,
FIFO/checkpoints, synchronous cloning and transfer, receiving-realm identity,
trusted targets, messageerror, termination,
and delivery before cooperative exit. Fixtures supply the existing environment
composition; they do not supply a production shared UserAgent service transport.
No add-on, Node, or V8 change is needed.

Author-created MessagePorts subsequently gained native handle handoff and pending
HTML task migration, described in the current stopping point and communication
roadmap. Public Worker startup, remote owner monitoring, and shared services remain
unfinished; this is not yet an end-to-end public `new Worker()` test.

Validation covers Node 24.19.0, Node 26.8.1, and custom Node 27, stock and add-on.
The eight new cases pass; the broader communication/lifetime/worker selection
retains only its four existing stock-Node incumbent-attribution expected failures.
The early-startup correction was retested separately on configurations whose
broader run preceded it. Type checking, focused lint, and import checks pass.

## Present

- `service-worker.ts` supplies a non-constructible, secure-context ServiceWorker
  identity for MessageEventSource and includes AbstractWorker's error handler.
  Its registration, state, messaging, and automatic error delivery remain
  unfinished; this is separate from the global scope.
- `BrowletEnvironment.fetchClassicWorkerScript()` supplies request setup, the custom fetch
  hook, response validation, UTF-8 decoding, and classic-script creation.
  `WorkerEnvironment.fetchScript()` now supplies its startup response hook; the
  separate-isolate processing-model caller remains pending. See the
  [script-fetching audit](../scripting/ROADMAP.md#html-8142-fetching-scripts).
- `fetchModuleWorkerScriptGraph()` now fetches the root and delegates descendant
  loading/linking, retaining the outside fetch client and target worker settings.
  `WorkerEnvironment.fetchScript()` supplies the response hook and tests real
  parsing/linking; worker startup still needs to call it. Classic `importScripts()` fetching remains
  an explicit stub until synchronous pause can be supplied.
- `WorkerEnvironment.completeScriptFetch()` handles failed-load notification/discard
  and successful port setup, then calls `runScript()` for execution and activation;
  public startup still needs to connect these steps on composed environments.
- `WorkerGlobalImpl.finishRunning()` releases timers, external ports, local EventSources, and owners
  after the closing worker's event loop has emptied and finished its checkpoint.
  Native thread teardown and forced termination are still separate dependencies.
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
  exists on `BrowletEnvironmentBase`; `completeScriptFetch()` invokes it on failure,
  while the separate-isolate startup caller remains unimplemented.
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
  from entering the worker queues. The event-loop tail now performs cooperative
  resource cleanup after the current task and microtasks finish. Termination
  additionally aborts the running script and clears the dedicated worker's pending
  outside messages. `WorkerThread.terminate()` supplies native interruption and
  outside-port cleanup; startup must supply the outside Worker when its public
  constructor and production environment/transport are connected.
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
| `abstract-worker.ts` | Shared outside-object error-handler implementation and declaration | HTML §10.2.6.1 |
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
