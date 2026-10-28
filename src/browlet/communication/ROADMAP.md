# Communication roadmap

HTML §9 is not part of the minimum single-Document lifecycle, but its channel
machinery becomes foundational as soon as Browlet adds child navigables or
workers. It is also the first public consumer that must prove structured
transfer and cross-agent task delivery together.

## §9.1 MessageEvent

[MessageEventImpl](message-event.ts) implements the constructor, initialization
dictionary, attributes, legacy initializer, and DOM's `createEvent('MessageEvent')`.
The internal origin retains origin-record identity; author-provided strings are
not parsed as origins. Delivery algorithms supply the required origin record
through the internal constructor or `setOrigin()`.

The implementation retains a snapshot of implementation ports.
[The binding](../integration/web-idl/message-event.ts) projects and freezes that
snapshot in the event's realm, reusing it until legacy initialization replaces it.
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

- The global's existing cleanup collection now holds actual EventSources.
  Permanent Document destruction closes connections and cancels pending retries.
  Navigation's invocation of destruction remains a browsing-lifecycle dependency.
- Window exposure works. Worker exposure is declared but awaits Worker globals
  and their shutdown integration.
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
  incumbents work. The A-to-B-to-C fixture is an approved expected failure:
  it reports A while expecting B. It uses real Web IDL `postMessage()`, unlike
  the earlier synthetic observer, but enters through low-level realm evaluation.
  Its translation of the HTML execution path and expected sender remain under
  review. Binding supplies C's method environment; the modeled stack retains A.
  Recheck the fixture and author-to-Binding-to-incumbent propagation before
  choosing a fix; this is not a conclusion that native integration is required. See the
  [runtime attribution notes](../scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts).
  Direct Node calls without any HTML entry likewise have no incumbent;
  use `Browlet.evaluate()` for host commands.
- **WindowProxy:** the invoked method's environment selects the incumbent
  lookup, independently of the target receiver. Borrowing a sender-realm method
  proves delivery across distinct agents. Ordinary cross-origin property access
  still needs WindowProxy to select Chapter 7's caller-bound descriptor helpers;
  Binding's invocation checks are now installed. The current
  proxy returns target-bound methods; across distinct agents this can leave
  incumbent lookup on an empty target stack. Cross-origin dispatch/access is
  not secured by `targetOrigin` filtering. The exotic methods remain Chapter 7 work.
- **Navigation:** existing top-level navigation tests prove queued messages
  remain attached to the old target Window and source proxies retain their
  identity after navigation. Nested-document activity now follows Chapter 7's
  retained container ancestry. Nested navigation and container policy setup remain
  unfinished; this implementation does not replace that machinery.
- **Ports:** MessagePort and ArrayBuffer transfer work. Transferred ports retain
  queued messages and are projected in the receiving Window's realm.
- **Handlers:** use `addEventListener('message', ...)` or `messageerror`.
  Window's `onmessage`/`onmessageerror` await the WindowEventHandlers mixin and
  global-handler composition; EventSource's own handlers are independent.

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

Worker and AudioWorklet exposure is declared; actual globals, worker channels,
shutdown, and cross-thread transport remain their owners' work. This implementation
communicates across Browlet's modeled agents in one isolate. No Node/V8 changes
or messaging stubs were added. It does not resolve §9.3's incumbent-attribution gap.

[Tests](../../../test/browlet/communication/message-channel.test.ts) cover queue
activation, shared FIFO order, microtask checkpoints, payload/port identity,
both-end and repeated transfer, queued-task migration between agents/documents,
errors, closure, and global cleanup. Window messaging has an end-to-end port test.

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
  The A-to-B-to-C expected failure above preserves the unresolved attribution test;
  callback/built-in entry cases are separate. The investigation on
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
5. **§9.5 Broadcasting.** Build BroadcastChannel on storage keys, multi-global
   lifetime, and delivery eligibility.

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
