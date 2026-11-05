# Timing

Shared time measurements for events, timers, navigation, transport, and the
[Performance API](../browlet/performance/ROADMAP.md). Consumers enter through `index.ts`.
This foundation has no runtime dependency on DOM events, browser environments,
or the Performance interface.

- `clock.ts` owns wall and monotonic clocks, unsafe/coarsened moments, and
  durations. A moment retains its clock identity; arithmetic requires compatible
  clocks. Each consumer shares the same wall and monotonic clock objects.
  High Resolution Time's `coarsenTime()` calculation lives beside these values
  and serves both Fetch and the clock/moment implementation.
- `high-resolution-time.ts` owns relative/shared time and the estimated monotonic
  Unix epoch. Its functions read the supplied environment's time origin and
  isolation boolean, without importing that owner's implementation.
  It also declares `DOMHighResTimeStamp` and `EpochTimeStamp` using Web IDL Core.
- `environment.ts` declares the owner's timing state and operations. Browlet's
  existing environment exposes those methods by forwarding to the shared
  algorithms. It selects the navigation or worker time origin and computes the
  isolation permission. Callers use that environment directly; there is no
  separate timing object or per-environment copy of the shared epoch estimate.

`crossOriginIsolatedCapability` is HTML's specified boolean name. It selects
the precision allowed for an observation; it is not an injected service object.
The current coarsening implementation uses 100 microseconds normally and 5
microseconds when the boolean is true.

The subsystem depends on Infra and Web IDL Core and sits below Fetch in the
import hierarchy. Its TypeScript project records only those dependencies.
It does not depend on the browser, Fetch, DOM, or Performance implementations.
The project retains Node's ambient typings for the existing host clock primitives;
it adds no Node runtime import.

Public Performance objects consume this foundation alongside DOM event
machinery. Performance retains its environment and obtains timing from that same
owner. Timing does not collect performance entries, dispatch events, or own
task scheduling. Preserve one shared monotonic coordinate system across these
consumers; coarsen raw readings before exposing timestamps to author code.

Environment operations retain `UnsafeMoment`, `Moment`, and `Duration` values.
Fetch retains numeric shared-clock observations until a timing entry converts
them; it no longer needs a relative-time conversion on its environment contract.
Already-coarsened observations use `relativeHighResolutionCoarseTime()` so
conversion does not apply the precision limit twice.

Tests live in `test/timing/`; the Performance API's projected behavior
remains in `test/browlet/performance/`. Outstanding entry families and browser
integration are tracked in the [performance roadmap](../browlet/performance/ROADMAP.md).
