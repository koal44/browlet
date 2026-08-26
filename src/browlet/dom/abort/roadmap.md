# Abort roadmap

DOM §3's synchronous core and public interface are present. Observable
`AbortSignal.timeout()` delivery is wired to provisional HTML-owned active-time
and task-queuing seams, which remain the only unfinished dependency.

## Present

| Source | Contract | Specification |
| --- | --- | --- |
| `abort-controller.ts` | `AbortController`, its same-object signal, and idempotent `abort(reason)` | DOM §3.1, `#interface-abortcontroller` |
| `abort-signal.ts` | `AbortSignal` state, static `abort()`/`any()`/`timeout()`, `throwIfAborted()`, `onabort`, internal abort algorithms, dependent-signal composition, and abort-event ordering | DOM §3.2, `#interface-AbortSignal` |
| `abort-algorithm.ts` | Cycle-free implementation seam used by EventTarget and future abortable APIs | DOM §§2.7 and 3.2 |
| `scripting/event-handlers.ts` | Ordinary event-handler IDL state, activation, replacement, deactivation, and callback processing used by `onabort` | HTML §8.1.8; DOM §3.2 |

Both interfaces have declarative Web IDL definitions and realm-specific
projection. Default `AbortError` values are `DOMException` objects from the
current/relevant realm. `AbortSignal.any()` returns a dependent signal in the
current realm, preserves the first already-aborted source's reason, and
flattens dependent sources as specified.

## Internal abort contract

`abort-algorithm.ts` exposes narrow implementation-facing operations to add
and remove an abort algorithm without creating an EventTarget/AbortSignal
module cycle. Signaling abort sets source and dependent reasons first, then
runs and clears each signal's internal algorithms, and only then fires its
public `abort` event. Promise-based consumers reject with the stored reason,
but each consumer owns that promise and its cleanup; DOM does not grow a
generic "abort a promise" utility.

`EventTarget.addEventListener()` is the first consumer. It now:

- declares `AddEventListenerOptions.signal` as `AbortSignal`, not `object`;
- accepts Browlet platform signals through Web IDL branding rather than Node's
  ambient `AbortSignal`;
- registers listener removal as an internal abort algorithm; and
- removes that algorithm when listener cleanup makes it unnecessary.

Fetch, streams, loaders, and other APIs later consume the same internal
contract without moving their cancellation behavior into this directory.

## HTML-owned pieces

`AbortSignal.timeout(milliseconds)` now creates the signal in the binding
realm and calls the HTML-owned "run steps after a timeout" and "queue a global
task" algorithms with the relevant global and timer task source. HTML §8.1.7
now supplies the real global-task destination and event-loop queue. The
remaining §8.7 seam deliberately fails until per-global active timers,
fully-active-time suspension, ordered completion, host wake-up, and production
event-loop startup exist; a direct Node `setTimeout()` would produce the wrong
lifecycle. The scheduled completion closure captures the signal, so the
eventual global-owned timer entry also supplies the required strong
reachability while delivery is pending.

The `onabort` event-handler IDL attribute uses HTML's ordinary event-handler
core. It preserves listener registration order across replacement, removes
its listener on null or legacy non-object assignment, restores it at the later
position on reactivation, and applies the ordinary false-return cancellation
rule. Content-attribute compilation and the special global error and
beforeunload handlers remain later HTML §8.1.8 work, not DOM §3 prerequisites.

## Retention

Source-to-dependent relationships use an ordered weak-reference collection.
A realm-partitioned retention registry keeps a live, non-aborted dependent
signal strongly reachable while it has source signals and an abort listener or
abort algorithm, then releases it when that condition ends. Node does not
provide a deterministic observable GC test, so the implementation preserves
the topology without adding a flaky collection test.

DOM §3.3 (`#abortcontroller-api-integration`) supplies the contract by which
Fetch, streams, and other hosts register abort algorithms. Do not put those
consumer algorithms into this directory.

Blink's `core/dom/abort_controller.*`, `abort_signal.*`, and composition
manager are useful decomposition evidence; Browlet can begin with two modules
until composition warrants a third.

## Remaining delivery

1. Implement HTML §8.7's active-time timer algorithm and start the owning
   agent's event loop in production behind the existing
   `AbortSignal.timeout()` seams. Global task routing and queue ownership are
   already implemented.
2. Replace the provisional scheduling-failure test with deterministic
   active-time, timer-task, realm-native `TimeoutError`, and retention coverage.

## Removal condition

Burn this file after abort composition, EventTarget integration, timeout, and
the observable retention contract are implemented or have an explicit tested
host limitation.
