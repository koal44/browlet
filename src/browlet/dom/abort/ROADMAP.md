# Abort roadmap

DOM [§3](https://dom.spec.whatwg.org/#aborting-ongoing-activities) has
controller/signal projection, composition, EventTarget integration, onabort,
and active-time timeout delivery. Worker exposure and retention evidence remain
below.

## Current contract

`AbortSignalImpl` exposes add/remove-algorithm operations to converted internal
consumers. Its platform object does not expose them. Signal abort sets source
and dependent reasons first, runs/clears internal algorithms, then fires abort.
Consumers reject with that stored reason and own their own cancellation/cleanup.

AbortController retains its same-object signal and aborts idempotently.
AbortSignal.any preserves the first already-aborted source's reason and flattens
dependent sources. Default errors use `env.exec.DOMException`, supplied by
Binding's original interface constructor independently of the writable global
property. Borrowed `abort()` methods select their invoking environment for the
default error; internal calls default to the signal's owning environment.

EventTarget's converted signal registers listener removal as an internal abort
algorithm and removes it when listener cleanup no longer needs it. Removal
precedes the public abort event. Streams and Fetch consume the same internal
contract; their cancellation algorithms do not belong to DOM.

## Realm choice

`SPEC_CLASH(abort-default-reason-realm)`: [DOM's signal-abort algorithm](https://dom.spec.whatwg.org/#abortsignal-signal-abort)
creates a default AbortError; [Web IDL](https://webidl.spec.whatwg.org/#js-creating-throwing-exceptions)
creates it in the current realm. For `otherWindow.AbortController.prototype.abort.call(controller)`,
that is the method's realm, while the controller and signal keep their own realm.
Playwright checks on 2026-09-28 found Chromium 149.0.7827.55 follows the method
realm; Firefox 151.0 and WebKit 26.5 use the signal's realm. Borrowing the reason
getter does not change those results.

Browlet follows Web IDL/Chromium. Binding supplies the method's environment to
the abort algorithm, which creates one reason shared by the source and its
dependents. Explicit reasons keep their original identity.

## HTML delivery and retention

AbortSignal.timeout's declaration composes the owning global's active-time wait
with Realm.queueGlobalTask on the timer task source. GlobalTimers and the running
event loop now supply those operations. It retains the original Window owner
across WindowProxy retargeting. DOM does not schedule a separate Node timer.

The global-owned timer closure retains the signal until completion. Dependent
signal relationships use ordered weak references; a private per-global retention
set keeps non-aborted dependents alive while they have sources and a listener or
abort algorithm. It releases them when that condition ends. The set belongs to
the per-realm Window object, so proxy reuse does not move it to a new Window.

The onabort property uses HTML's ordinary IDL-handler core: replacement preserves
listener order, null/legacy non-object assignment removes it, and reactivation
adds it later. Content-attribute compilation and special global error/beforeunload
handlers remain scripting work.

## Remaining integration

- Install the declared interfaces with real worker globals, active-time suspension,
  termination, and worker-owned retention. Reuse the existing global lifecycle.
- Keep dependent-signal and timeout retention topology explicit. Deterministic GC
  evidence is unavailable; ordinary behavior tests do not prove collection timing.
  Do not add flaky collection tests or use finalization to drive cancellation.
- New APIs register their specified abort steps through DOM §3.3. Browser teardown
  and Fetch group disposal remain with those owners, not a generic DOM promise helper.

## Validation

[Abort tests](../../../../test/browlet/dom/abort.test.ts) cover projected APIs,
composition, ordering, reasons, listener cleanup, and actual timer-task delivery.
[Timer tests](../../../../test/browlet/scripting/timers.test.ts) cover active-time
suspension, ordering, clearing, and navigation/lifecycle behavior. Window timeout
delivery is no longer a provisional missing prerequisite.
