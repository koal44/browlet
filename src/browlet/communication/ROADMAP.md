# Communication roadmap

HTML §9 is not part of the minimum single-Document lifecycle, but its channel
machinery becomes foundational as soon as Browlet adds child navigables or
workers. It is also the first public consumer that must prove structured
transfer and cross-agent task delivery together.

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
| `message-event.ts` | `MessageEvent`, initialization, origin serialization, source identity, and transferred-port arrays | HTML §9.1 |
| `window-messaging.ts` | Window `postMessage()`, incumbent settings, target-origin checks, WindowProxy source identity, and posted-message tasks | HTML §9.3 |
| `message-channel.ts` | `MessageChannel` construction and endpoint identity | HTML §9.4.2 |
| `message-port.ts` | `MessagePort`, `MessageEventTarget`, entanglement, port task sources, transfer/receiving steps, start/close, and lifecycle cleanup | HTML §§9.4.3–9.4.5 |
| `event-source.ts` | `EventSource`, UTF-8 event-stream parsing, Fetch streaming, reconnection, remote-event tasks, and abort/close | HTML §9.2 |
| `broadcast-channel.ts` | Storage-key-scoped channel discovery, per-agent ordering, target-realm delivery, eligibility, close, and liveness | HTML §9.5; Storage |
| `web-idl.ts` | Communication interfaces, dictionaries, mixins, overloads, exposure, and Window/worker contributions | HTML §9 |

`StructuredSerializeOptions` belongs to the shared structured-data declaration,
not to one transport. `MessageEvent` is HTML-owned even though WebSockets,
workers, EventSource, and several later specifications reuse it. Generic DOM
event code must not absorb either interface.

## Delivery order

1. Implement `MessageEvent` and a same-agent MessageChannel/MessagePort path
   over `scripting/structured-data/` and the real event-loop task-source model.
2. Prove port transfer, queued-task migration, target-realm wrappers, and
   Document destruction before using ports as the dedicated-worker channel.
3. Add Window `postMessage()` with nested navigables and cross-navigation
   WindowProxy/origin tests.
4. Add EventSource after Fetch provides streaming bodies, cancellation, and a
   networking task destination; its retry delay consumes the scheduler rather
   than inventing a timer loop.
5. Add BroadcastChannel after storage keys and multi-global lifetime exist.

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
