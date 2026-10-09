# Browser timing

Shared time measurements for events, timers, navigation, transport, and the
[Performance API](../performance/ROADMAP.md). Consumers enter through `index.ts`.
This foundation has no runtime dependency on DOM events, browser environments,
or the Performance interface.

- `clock.ts` owns wall and monotonic clocks, unsafe/coarsened moments, and
  durations. A moment retains its clock identity; arithmetic requires compatible
  clocks. Host clock readings and Infra's precision calculation are shared here.
- `high-resolution-time.ts` owns relative/shared time and the estimated monotonic
  Unix epoch. `EnvironmentTiming` reads its owner's time origin and isolation
  capability through a small structural view, without importing that owner.
  It also declares `DOMHighResTimeStamp` and `EpochTimeStamp` using Web IDL Core.

Public Performance objects consume this foundation alongside DOM event
machinery. Timing does not collect performance entries, dispatch events, or own
task scheduling. Preserve one shared monotonic coordinate system across these
consumers; coarsen raw readings before exposing timestamps to author code.

Tests live in `test/browlet/timing/`; the Performance API's projected behavior
remains in `test/browlet/performance/`. Outstanding entry families and browser
integration are tracked in the [performance roadmap](../performance/ROADMAP.md).
