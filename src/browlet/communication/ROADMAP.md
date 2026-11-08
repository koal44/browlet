# Communication roadmap

HTML §9 is not part of the minimum single-Document lifecycle, but its channel
machinery becomes foundational as soon as Browlet adds child navigables or
workers. It is also the first public consumer that must prove structured
transfer and cross-agent task delivery together.

## Worker integration checkpoint

The §9 APIs were implemented for local realms. The §10 integration sweep on
2026-11-05 distinguishes those algorithms from their cross-isolate dependencies:

- **MessageEvent and Window messaging:** implementation, Binding, local port
  transfer, and Window handler attributes are connected. Earlier notes saying
  `Window.onmessage` is missing are obsolete.
- **MessagePort / dedicated workers:** the hidden inside/outside channel now
  carries HTML serialization records across isolates. Delivery remains on HTML
  task queues, including disabled startup queues, target-realm reconstruction,
  microtask checkpoints, messageerror, and shutdown cleanup. Author-created
  ports also move between isolates, carrying pending HTML deliveries and nested
  ports/buffers. Configured dedicated startup now establishes this transport
  automatically before returning to its creator, retaining immediate messages.
  Production queue enablement and public Worker startup still require owner
  monitoring and initial script execution.
- **BroadcastChannel:** worker eligibility uses the existing closing/suspendable
  checks. The UserAgent-owned registry is still local; discovery, delivery, and
  cleanup across isolates require the shared-service transport.
- **EventSource:** cooperative worker shutdown closes owned sources after the
  final checkpoint, aborting local requests and canceling retries. Shared-service
  Fetch routing and remote cancellation after forced termination remain deferred.
- **ServiceWorker and AudioWorklet:** their actual lifecycles and communication
  remain dependencies of their respective specifications.

This is a connection inventory, not a second completed review of every §9
algorithm. Follow dependencies between §§9 and 10 during implementation, then
audit both chapters in document order once connected. Revisit worker exposure
and cleanup at their production owners and retain local-realm regressions.

## §9.1 MessageEvent

[MessageEventImpl](message-event.ts) implements the constructor, initialization
dictionary, attributes, legacy initializer, and DOM's `createEvent('MessageEvent')`.
The internal origin retains origin-record identity; author-provided strings are
not parsed as origins. Delivery algorithms supply the required origin record
through the internal constructor or `setOrigin()`.

The implementation retains a snapshot of implementation ports.
Its FrozenArray attribute type selects projection and freezing in the event's
realm, reusing the snapshot until legacy initialization replaces it.
Construction does not clone the payload, transfer ports, or send a message.

Dependencies brought forward:

- [MessagePort](message-port.ts) supplies EventTarget identity, messaging, and
  transfer under §9.4 below. It has no public constructor.
- [ServiceWorker](../workers/service-worker.ts) supplies EventTarget identity for
  MessageEventSource, with secure Window/Worker exposure and no public constructor.
  Registration, lifecycle, messaging, and its remaining interface are unfinished.
- WindowProxy uses the existing browsing-context handle. Worker and AudioWorklet
  globals remain dependencies for exercising those exposure environments.

Focused tests cover defaults and conversions, all three source identities,
port snapshots and receiver-realm projection, dispatch-time legacy initialization,
the legacy factory, and origin extraction. Actual message delivery remains with
the APIs below.

## §9.2 EventSource

[EventSourceImpl](event-source.ts) implements the interface, streaming UTF-8 line
parser, remote-event tasks, reconnect delay and Last-Event-ID, and close/failure
handling. Fetch owns CORS, credentials, redirects, HTTP transport, and cancellation.
The existing decoder and timer host supply incremental decoding and retry timing.
DOM's internal `dispatch()` is now callable so messages can be created before
queuing and retain their trusted flag when delivered.

Dependencies and remaining limits:

- The global's existing cleanup collection holds active EventSources.
  Permanent Document destruction and cooperative dedicated/shared worker shutdown
  close connections and cancel pending retries.
  Navigation's invocation of destruction remains a browsing-lifecycle dependency.
- Window and Worker exposure work. Shared-service Fetch routing and remote
  cancellation after forced termination remain worker integration dependencies.
- Active sources are conservatively retained until close or permanent cleanup.
  Listener-sensitive collection and abort-on-GC are not implemented.

Two specification discrepancies are marked in the source:

- `eventsource-empty-last-event-id`: the reconnect steps set a header only for a
  nonempty ID, but the reset example requires an empty ID to remove any previous
  header. Browlet removes it.
- `eventsource-reconnect-last-event-id`: the parser's empty-buffer initialization
  would erase an ID after reconnecting, whereas the dispatch text says it remains
  until changed by the server. Browlet carries it forward, as Blink does in
  `EventSource::DidReceiveResponse()` when constructing the next parser.

Reconnection starts from body-reader completion rather than Fetch's transport-end
callback, so all consumed messages are queued before the disconnect notification.
[Tests](../../../test/browlet/communication/event-source.test.ts) exercise real
Fetch with controlled transport/clock inputs, plus an actual HTTP redirect and
stream. They cover fragmented UTF-8 and line endings, parsing, credentials/CORS,
final-response origin, event ordering, retry headers, closure, and document cleanup.

`SPEC_GAP(worker-eventsource-shutdown)`: HTML's
[worker shutdown tail](https://html.spec.whatwg.org/multipage/workers.html#run-a-worker)
does not mention EventSource disposal; the
[forcible-close text](https://html.spec.whatwg.org/multipage/server-sent-events.html#forcibly-close-an-eventsource)
explicitly covers permanent Document removal. Browlet reuses `close()` when the
worker loop ends, matching Blink's
[`ContextDestroyed()`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/modules/eventsource/event_source.cc#368).
[Worker shutdown tests](../../../test/browlet/workers/shutdown.test.ts) cover open
and unanswered requests, pending retries, late transport callbacks, final-checkpoint
ordering, and preservation of the creator's independent source.

## §9.3 Cross-document messaging

[Window.postMessage()](../browsing/window/window.ts) implements both overloads and
forwards to [the posting steps](window-messaging.ts). Serialization and transfer
run synchronously; delivery uses the target realm's posted-message task source.
Target-origin matching runs at delivery, before reconstruction. Deserialization
failure dispatches `messageerror`; successful delivery dispatches a trusted
`message` with the sender's WindowProxy, origin, cloned data, and frozen ports.

The environment exposes the existing serialize/deserialize-with-transfer
operations. Binding keeps the deserialized message graph projected but resolves
the separate transferred-values list to implementations, so delivery can select
MessagePort implementations without depending on Binding Context. Window consumes
communication algorithms; communication only imports Window types.

Dependencies and remaining limits:

- **Incumbent attribution:** controlled script entries and stored callback
  incumbents work. Native `postMessage()` entry now captures the author caller
  before Binding runs and scopes it in `JSExecutionContext.incumbentEnv`. The
  A-to-B-to-C regression reports B on all addon bases. Reentry and throwing-conversion
  tests prove restoration to the enclosing caller; stock Node retains the approved
  attribution failure and its reentry variant. The observation has no
  ScriptOrModule and does not complete Promise job provenance. See the
  [runtime attribution notes](../scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts).
  Direct Node calls without any HTML entry likewise have no incumbent;
  use `Browlet.evaluate()` for host commands.
- **WindowProxy:** the invoked method's environment selects the incumbent
  lookup, independently of the target receiver. Borrowing a sender-realm method
  proves delivery across distinct agents. Ordinary cross-origin property access
  still needs WindowProxy to select Chapter 7's caller-bound descriptor helpers;
  Binding's invocation checks are now installed. The current
  proxy returns target-bound methods; without native capture, calls across
  distinct agents can leave incumbent lookup on an empty target stack. Cross-origin dispatch/access is
  not secured by `targetOrigin` filtering. The exotic methods remain Chapter 7 work.
- **Navigation:** existing top-level navigation tests prove queued messages
  remain attached to the old target Window and source proxies retain their
  identity after navigation. Nested-document activity now follows Chapter 7's
  retained container ancestry. Nested navigation and container policy setup remain
  unfinished; this implementation does not replace that machinery.
- **Ports:** MessagePort and ArrayBuffer transfer work. Transferred ports retain
  queued messages and are projected in the receiving Window's realm.
- **Handlers:** `addEventListener`, Window's `onmessage`/`onmessageerror`, and
  their WindowEventHandlers composition are connected. EventSource's own
  handlers are independent.

[Focused tests](../../../test/browlet/communication/window-messaging.test.ts)
cover overload conversion, origin/default/opaque checks, serialization timing,
ArrayBuffer transfer, receiver-realm objects, cluster rejection, FIFO delivery,
stored callback incumbents, inactive documents, and top-level navigation. Shared
memory rejection supplies the existing serialization capability directly in its
fixture; it does not establish completed Window isolation-policy setup.

## §9.4 Channel messaging

[MessageChannel](message-channel.ts) creates entangled
[MessagePorts](message-port.ts). Both postMessage overloads serialize immediately,
then deliver trusted message/messageerror events through the receiving port's
queue. Queues begin disabled; start() or assigning onmessage enables delivery.
[MessageEventTarget](message-event-target.ts) owns the reusable handler attributes.

Unshipped ports share one FIFO task source per event loop. Task readiness keeps
disabled queues in place, so enabling ports in a different order does not reorder
their messages. Shipping either end gives both ends independent task sources.
Transfer moves queued messages to a disabled receiving port, associates them with
its Document, and reconstructs their data in its realm. A stable endpoint record
owns the peer relationship and pending messages. Transfer removes it from the
old port immediately, then installs it on the receiving port. While in flight,
messages accumulate without a runnable task. This keeps both-end transfers paired
and prevents the old object from consuming messages or closing the moved channel.

Worker lifetime ownership uses `isEntangledOutsideGlobal()` to inspect the
connection without requiring a receiving object. A null remote endpoint means
disconnected; a remote endpoint with no port is in transit and still connected.
That end currently belongs to the transport, so the local port remains in the
worker's list. Receipt establishes the peer's current global; if both ends now
belong to the same global, neither is in its worker-port list. Closing the local
end during transfer disconnects the channel, and receipt cannot revive it.
No previous owner is retained. See the [§10.2.3 review](../workers/ROADMAP.md#document-order-review).

Cross-isolate sends promote local pairs to native channels only when necessary.
The transferred endpoint carries ordered pending HTML deliveries separately from
its native handle, whose queue retains messages not yet received by the host.
Receipt queues the saved deliveries before resuming host reception, without
enabling the HTML queue. A later local or cross-isolate transfer repeats this
handoff; author objects never expose native handles. Endpoint IDs preserve peer
identity for the doomed-target transfer check. Private owner notifications update
the last known peer environment; an unknown/in-transit owner remains external.
These notifications are not the unfinished remote worker-owner monitor.

The [real-isolate tests](../../../test/browlet/workers/thread.test.ts) cover
disabled queues, FIFO/checkpoints, source detachment, receiving-realm/event port
identity, repeated transfers, nested port/buffer queues, both endpoints moving,
worker-created ports, direct communication between two workers, clone failure,
and shutdown. Ordinary local channels continue using their existing task path.
Other transferable interfaces need their own portable resource handling; this
does not supply stream transfer or shared UserAgent discovery.

The eight new real-isolate cases pass on Node 24.19.0, Node 26.8.1, and custom
Node 27, both stock and with the add-on. The 66 existing local-channel/lifetime
cases and eight hidden-worker-channel cases also pass. Type checking, focused
ESLint, import boundaries, and diff checks pass; no engine/add-on change is needed.

`clearOutgoingMessages()` supplies the dedicated-worker termination queue step
(HTML §10.2.4). It clears only the currently entangled endpoint's pending deliveries,
including messages in transit, without altering connection or enabled state.
Other ports on the unshipped shared task source and incoming messages remain
queued. The separate-isolate `WorkerThread` host owns the outside port directly
and uses `clearMessageQueue()` at termination, followed by disentanglement on
native exit. Both operations share endpoint cancellation. The public Worker
constructor must supply that port when connecting startup; ordinary port close
and cooperative worker shutdown must preserve pending deliveries.

The 2026-11-04 source comparison supports keeping channel state separate from
live peer objects: Chromium moves a message-pipe descriptor into `MessagePortChannel`
and clears the initial peer pointer; Firefox transfers port identifiers through
its background service; WebKit retains channel identifiers and pending-transfer
state after detaching the old object from its context. These are transport
architecture observations, not a browser timing oracle for worker termination.
Sources: [Chromium `Disentangle()`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/messaging/message_port.cc#170),
[Firefox `CloneAndDisentangle()`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/messagechannel/MessagePort.cpp#L630),
and [WebKit `lenientDisentangle()`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/dom/MessagePort.cpp#L233).

Binding resolves ports in transfer lists for source/target identity checks; the
message graph and other transferable values retain their JavaScript representation.
The shared detached marker now lives in Scripting's lower-level transferable
module, so close() and structured transfer use the same state.

Entangled ports are retained by their relevant global and released when
disentangled. Document destruction invokes that cleanup and removes its tasks.
The [current specification](https://html.spec.whatwg.org/multipage/web-messaging.html#ports-and-garbage-collection)
permits global retention. Unlike the older local HTML snapshot, it does not
require close events or GC-triggered disentanglement. Pending tasks are retained
conservatively until delivery, transfer, or Document destruction.

Local channels communicate across Browlet's modeled agents without native pipes;
cross-isolate handoff uses the endpoint transport described above. AudioWorklet
execution remains its owner's work. §9.3 owns the separate incumbent integration.

The dedicated worker's unexposed endpoints now also support a native connection
through `entangleRemote()`. This is an implementation equivalent of entangling
ports that cannot hold references to one another across isolates. Ordinary
MessagePort transfer now supplies the separate author-endpoint handoff.
See the [worker channel slice](../workers/ROADMAP.md#dedicated-worker-message-channel-across-isolates).

[Tests](../../../test/browlet/communication/message-channel.test.ts) cover queue
activation, shared FIFO order, microtask checkpoints, payload/port identity,
both-end and repeated transfer, queued-task migration between agents/documents,
errors, closure, and global cleanup. Window messaging has an end-to-end port test.

## §9.5 BroadcastChannel

[BroadcastChannel](broadcast-channel.ts) serializes once and queues independent
target-realm reconstructions on the DOM manipulation task source. Discovery uses
the existing non-storage StorageKey operation and equality, exact channel names,
and eligible globals: fully active Documents, or workers that are neither closing
nor suspendable. It excludes the sender and preserves creation order within each
agent. Close suppresses queued deliveries; reconstruction failures
produce messageerror with the captured source origin.

Each UserAgent owns a weak, creation-ordered channel registry. Separate UserAgents
cannot communicate through it. Globals strongly retain open channels with message
or messageerror listeners; EventTarget's existing change hook handles removal,
once, abort signals, and handler attributes. Closing releases that retention and
discovery. Queued tasks retain their destinations until delivery or Document
destruction removes those tasks; inactive Documents follow normal task gating.

Window and composed worker realms in one isolate are supported. Sender eligibility
is checked before serialization and the closed-channel error. Destination discovery
also excludes ineligible workers. Closing workers discard queued deliveries through their
existing task-queue cleanup. Cross-isolate discovery/delivery still needs the
shared UserAgent service. StorageKey currently compares origins, including opaque
identity; additional browser privacy partitioning remains Storage policy work.
No Node/V8 changes or new cloning/binding adapters are needed.

[Tests](../../../test/browlet/communication/broadcast-channel.test.ts) cover
author-code delivery, storage/UserAgent isolation, target-realm identity, ordering,
serialization reentrancy, activity, closure, messageerror, and listener retention.
Dedicated/shared worker cases cover their own task loops, target-realm values,
suspendability and recovery, closure, and the distinction between suspendability
and simply lacking an active Document owner.

## Constraints to preserve early

- Sending serializes synchronously in the sender's script context; delivery
  deserializes later in the target realm. No communication API may retain and
  expose the sender's JavaScript object directly.
- Delivery is a task on the destination's responsible event loop. Cross-agent
  algorithms must always name the destination global or event loop instead of
  relying on HTML's ambiguous implied-loop concept.
- Window messaging captures the incumbent sender, its origin, and corresponding
  WindowProxy, but checks the target Window's origin when the queued task runs.
  Navigation between send and delivery can therefore discard a message.
  The A-to-B-to-C regression above passes with native entry and remains an
  expected failure on stock Node; callback/built-in entry cases are separate. The investigation on
  `research/html-agent-execution` is deferred evidence, not a prerequisite patch
  to adopt before this consumer.
- A MessagePort owns a movable port-message task source. Transferring a port
  moves its pending delivery tasks and reconstructs the endpoint in the target
  realm; the queue cannot be a closure permanently bound to the original
  wrapper.
- Port and channel liveness depends on listeners, pending tasks, close state,
  and Document/worker lifetime. JavaScript finalization cannot be used for
  deterministic behavior, so explicit lifecycle cleanup must carry the
  contract and any unobservable GC refinements can remain best-effort.

## Planned ownership

| Planned source | Contract | Specification |
| --- | --- | --- |
| `message-event.ts` | MessageEvent initialization, source identity, payload, ports, and origin extraction | HTML §9.1 |
| `event-source.ts` | `EventSource`, UTF-8 event-stream parsing, Fetch streaming, reconnection, remote-event tasks, and abort/close | HTML §9.2 |
| `window-messaging.ts` | Window `postMessage()`, incumbent settings, target-origin checks, WindowProxy source identity, and posted-message tasks | HTML §9.3 |
| `message-channel.ts` | `MessageChannel` construction and endpoint identity | HTML §9.4.2 |
| `message-event-target.ts` | Shared messaging handler attributes | HTML §9.4.3 |
| `message-port.ts` | `MessagePort`, entanglement, task sources, transfer/receiving steps, start/close, and lifecycle cleanup | HTML §§9.4.4–9.4.6 |
| `broadcast-channel.ts` | Storage-key-scoped channel discovery, per-agent ordering, target-realm delivery, eligibility, close, and liveness | HTML §9.5; Storage |

Co-locate declarations with their implementations and Window/worker contributions
with their primary constructs. `StructuredSerializeOptions` belongs to the shared structured-data declaration,
not to one transport. `MessageEvent` is HTML-owned even though WebSockets,
workers, EventSource, and several later specifications reuse it. Generic DOM
event code must not absorb either interface.

## Chapter 9 review order

Follow the chapter from its beginning, preserving explicit dependencies on
later sections and the parallel browsing/scripting work.

1. **§9.1 MessageEvent.** Implemented with the dependency stubs listed above.
2. **§9.2 Server-sent events.** Implemented with the lifetime and Worker limits above.
3. **§9.3 Cross-document messaging.** Posting/delivery implemented with the
   incumbent, WindowProxy, handler, and port dependencies above.
4. **§9.4 Channel messaging.** Implemented for existing Window realms and modeled
   agents. Worker/AudioWorklet integration and actual cross-thread delivery remain.
5. **§9.5 Broadcasting.** Implemented for local Window/worker realms using existing
   storage keys and worker lifetime checks. Shared-service transport remains.

The WebSockets interface has moved to the separate WebSockets Standard. It may
reuse `MessageEvent`, but it is not owned by this directory.

Blink similarly keeps ports/channels in `core/messaging`, MessageEvent in its
shared event layer, and EventSource/BroadcastChannel as later modules. Browlet's
smaller `communication/` domain may collect those HTML §9 owners while keeping
Fetch, generic events, structured data, and scheduling behind their existing
boundaries.

## Removal condition

Burn this file once message events, ports, Window messaging, EventSource, and
broadcast channels have implemented source or narrower surviving roadmaps.
