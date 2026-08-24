# Abort roadmap

DOM §3 is the first wholly missing part of the Sections 1-3 audit. It has a
synchronous DOM core that can be implemented before the HTML event loop, plus
one static method whose timing and task delivery deliberately belong to HTML.

## Planned source

| Planned source | Contract | Specification |
| --- | --- | --- |
| `abort-controller.ts` | `AbortController`, its same-object signal, and idempotent `abort(reason)` | DOM §3.1, `#interface-abortcontroller` |
| `abort-signal.ts` | `AbortSignal` state, static `abort()`/`any()`, `throwIfAborted()`, internal abort algorithms, dependent-signal composition, and abort-event ordering | DOM §3.2, `#interface-AbortSignal` |
| `retention.ts` only if it cannot stay local | Conditional strong retention for observed dependent signals and pending timeout signals | DOM §3.2.1, `#abort-signal-garbage-collection` |

Both interfaces need declarative Web IDL definitions and realm-specific
projection. Default `AbortError` and `TimeoutError` values must be
`DOMException` objects from the current/relevant realm. `AbortSignal.any()`
must return a dependent signal in the current realm, preserve the first
already-aborted source's reason, and flatten dependent sources as specified.

## Internal abort contract

Expose narrow implementation-facing operations to add and remove an abort
algorithm. Signaling abort must set source and dependent reasons first, then
run and clear each signal's internal algorithms, and only then fire its public
`abort` event. Promise-based consumers reject with the stored reason, but each
consumer owns that promise and its cleanup; DOM should not grow a generic
"abort a promise" utility.

`EventTarget.addEventListener()` is the first consumer. Its current native
`AbortSignal.addEventListener('abort', ...)` shortcut has the wrong ownership
and ordering. After the Browlet interface exists:

- declare `AddEventListenerOptions.signal` as `AbortSignal`, not `object`;
- accept Browlet platform signals through Web IDL branding rather than Node's
  ambient `AbortSignal`;
- register listener removal as an internal abort algorithm; and
- remove that algorithm when listener cleanup makes it unnecessary.

Fetch, streams, loaders, and other APIs later consume the same internal
contract without moving their cancellation behavior into this directory.

## HTML-owned pieces

`AbortSignal.timeout(milliseconds)` must use the signal's relevant global,
HTML's "run steps after a timeout" active-time semantics, and a global task on
the timer task source. A direct `setTimeout()` would produce the wrong
lifecycle, suspension, task-source, and realm behavior. Implement the method
once `scripting/event-loop.ts` and `scripting/timers.ts` provide that narrow
capability; retain the signal from its global while the observable timeout is
pending.

The `onabort` event-handler IDL attribute depends on HTML's generic event
handler machinery. Ordinary `addEventListener('abort', ...)` behavior and the
abort event itself do not need to wait for that HTML contribution.

## Retention

Source-to-dependent relationships are weak in the specification, but a live,
non-aborted dependent signal with an abort listener or abort algorithm must be
kept alive while it still has source signals. Begin with the smallest explicit
retention manager that can add and release strong references as observation
changes. Keep it local to abort machinery unless another standard establishes
the same lifecycle contract. If Node cannot expose a deterministic observable
GC test, document that limitation beside the implementation instead of adding
a flaky test.

DOM §3.3 (`#abortcontroller-api-integration`) supplies the contract by which
Fetch, streams, and other hosts register abort algorithms. Do not put those
consumer algorithms into this directory.

Blink's `core/dom/abort_controller.*`, `abort_signal.*`, and composition
manager are useful decomposition evidence; Browlet can begin with two modules
until composition warrants a third.

## Delivery order

1. Write public, realm-based tests for controller identity, reason defaults,
   idempotence, `throwIfAborted()`, static `abort()`, and ordering of internal
   algorithms before the abort event.
2. Implement controller/signal state and dependent composition, including
   `AbortSignal.any()` and conditional retention.
3. Replace EventTarget's native signal shortcut and its implementation-spy
   tests with behavioral integration coverage.
4. Add `onabort` with HTML's event-handler machinery.
5. Add `AbortSignal.timeout()` through the HTML scheduler and timer task
   source, with realm-native `TimeoutError` coverage.

## Removal condition

Burn this file after abort composition, EventTarget integration, timeout, and
the observable retention contract are implemented or have an explicit tested
host limitation.
