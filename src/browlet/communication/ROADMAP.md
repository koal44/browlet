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

- [MessagePort](message-port.ts) supplies EventTarget identity and the declared
  Window/Worker/AudioWorklet exposure. Entanglement, messaging, transfer steps,
  start/close, and MessageEventTarget remain for §9.4. It has no public constructor.
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
  When this API exists, test A calling a function from B which posts to C:
  C must observe B as `event.source`, with the sender's corresponding origin.
  Include callback/built-in entry cases and retain expected failures for missing
  runtime attribution. The investigation on `research/html-agent-execution`
  is deferred evidence, not a prerequisite patch to adopt before this consumer.
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
| `message-port.ts` | `MessagePort`, `MessageEventTarget`, entanglement, port task sources, transfer/receiving steps, start/close, and lifecycle cleanup | HTML §§9.4.3–9.4.5 |
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
3. **§9.3 Cross-document messaging.** Add Window `postMessage()` with nested
   navigables and cross-navigation WindowProxy/origin tests.
4. **§9.4 Channel messaging.** Implement MessageChannel/MessagePort over
   structured data and event-loop task sources. Prove port transfer, queued-task
   migration, target-realm wrappers, and Document destruction before using ports
   as the dedicated-worker channel.
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
