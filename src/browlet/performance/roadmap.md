# Performance and timing roadmap

High Resolution Time is an early browser foundation rather than a late
observability feature. Browlet already carries time origins and
`DOMHighResTimeStamp` values through realms, events, navigation, and Document
loading; this directory should replace those scattered clock decisions with
one realm-aware timing contract.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `clock.ts` | Shared monotonic clock, coarsening, isolation-sensitive resolution, and host clock capability | High Resolution Time §§2–3 and §9 |
| `time-origin.ts` | Time-origin timestamps, timestamp types, unsafe shared current time, relative time, and duration conversion | High Resolution Time §§3–6 |
| `performance.ts` | `Performance`, `now()`, `timeOrigin`, `toJSON()`, and the global `performance` attribute | High Resolution Time §§7–8 |
| `timeline.ts` | `PerformanceEntry`, buffers, observers, and entry delivery | Performance Timeline |
| `navigation.ts` | Document navigation and unload timing entries sourced from lifecycle records | Navigation Timing and HTML §3.1.5 |
| `resource.ts` | Fetch/loader timing info and resource entries | Resource Timing and Fetch |
| `user.ts` | Marks, measures, detail cloning, and buffer management | User Timing |
| `event.ts` only after trusted input dispatch exists | Event timing, interaction grouping, and first-input entries | Event Timing |
| `visibility.ts` | `VisibilityStateEntry` creation and timeline exposure sourced from HTML's Document visibility transitions | HTML §6.2 and Performance Timeline |
| `paint.ts` only after rendering exists | Paint timing entries and first-paint notifications | Paint Timing |
| `element.ts` and contentful-paint producers only after layout/paint exists | Element and contentful-paint observations sourced from rendered output | Element Timing and Largest Contentful Paint |
| `long-task.ts` and `long-animation-frame.ts` only after scheduling/rendering exists | Main-thread attribution and long-frame/task entries | Long Tasks and Long Animation Frames |
| `web-idl.ts` | Performance interfaces and global-scope contributions | The corresponding timing specifications |

The host supplies a monotonic clock primitive; it does not supply Browlet's
public `Performance` objects. All consumers must share the same time-origin and
coarsening implementation so event timestamps, navigation records, timers,
and performance entries remain comparable.

The scripting event loop consumes this clock for task timing, rendering
opportunities, and animation-frame timestamps. Performance records those
effects; it does not own a competing scheduler or animation-frame queue.

Worker settings derive a coarsened time origin from the worker creation time
and cross-origin-isolated capability. Base worklet settings deliberately expose
no time origin. The shared timing contract must preserve that difference rather
than assuming every realm has a Window-like `performance` surface.

High Resolution Time is not an HTML-owned subsystem and does not belong in
`html/`. It remains inside Browlet because its time origins and public
`Performance` objects are properties of environment settings and Window/Worker
globals. This differs from Fetch, whose records and algorithms form an
independently reusable platform project. If another package later needs a
clock, pass the narrow monotonic-clock capability first; extract a host-neutral
clock package only after a second real owner appears. Stylelet animation code,
for example, must not depend on Browlet's public `Performance` objects.

Treat the timing family as three layers: High Resolution Time supplies clocks,
moments, coarsening, and time origins; Performance Timeline supplies entries,
buffers, and observers; Navigation, Resource, User, Event, Paint, Element, and
long-task specifications are producers over those foundations. This ordering
keeps each timestamp comparable without turning `performance/` into the owner
of Fetch, input, rendering, or scheduling.

## Removal condition

Burn this file once the shared clock, Performance surface, and all timing
families reached by implemented Browlet behavior have explicit source owners
and cross-realm behavioral tests.
