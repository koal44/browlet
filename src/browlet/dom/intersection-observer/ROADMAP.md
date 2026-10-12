# Intersection Observer roadmap

HTML §2.5.7 uses a provisional implementation in `observer.ts`. It supplies
internal construction and registration state, not viewport-driven observation.
Do not replace geometry with immediate callbacks or infer intersections from
DOM membership.

Intersection Observer is a separate specification; the DOM Standard does not
define or mention it. This folder groups the API with the node implementations
whose registration state it maintains. The current HTML caller is Document,
which supplies the full `BrowletEnvironment` retained by the observer. Its home
under DOM follows that document/node integration rather than specification boundaries.
Rendering and HTML scheduling supply the still-missing integration.

## Present scaffold

- `IntersectionObserverImpl(callback, options, env)` retains its owning
  environment, internal callback, and a snapshot of the complete construction
  inputs, including separate margin values and a separate threshold array.
  Internal `IntersectionObserverOptions` already contain parsed margins as
  Stylelet's `BoxSides<CanonicalLengthPercentageLiteral>`, in top/right/bottom/left
  order. The side type reuses Stylelet's dimension-percentage type with pixel
  lengths; CSS margin's broader `auto`, relative lengths, and math values do not belong in
  this representation. Author margin parsing, threshold validation/sorting, and
  visibility-delay normalization remain explicit TODOs.
- `observe(target)`, `unobserve(target)`, and `disconnect()` maintain both the
  observer's ordered targets and each Element's registration list. Duplicate
  observations preserve history; removal leaves other observers intact.
- `enqueueEntry()`, `takeRecords()`, and the per-observer `notify()` steps retain,
  drain, and deliver explicit entries. Notification clears its batch before
  callback invocation. Unobserve/disconnect do not discard pending entries.
  No production caller computes entries or schedules notifications yet.
- HTML supplies typed margins, the other dictionary defaults, and an internal
  callback directly. Future Web IDL bindings own author conversion, callback adaptation/exception reporting,
  and platform projection. The author constructor must parse its dictionary's
  margin strings before using the internal options. This avoids converting
  already-known internal lengths/percentages to strings and parsing them again.
  No author-facing observer API is registered yet.

**Pending shape review:** `IntersectionObserverEntryImpl` is currently a partial
type containing only `target` and `isIntersecting`, which HTML consumes. Its
`SPEC_MISMATCH` marks that temporary representation. The entry implementation
still needs `time`, `rootBounds`, `boundingClientRect`, `intersectionRect`,
`isVisible`, and `intersectionRatio`, including real Geometry Interfaces values;
these are not filled with fabricated zero rectangles.

## Remaining implementation

Margin parsing must reuse Stylelet's component-value parser, token consumers,
and absolute-length resolution rather than add a second CSS tokenizer or unit
converter. The observer's grammar is narrower than the CSS margin property:
only absolute length dimensions and percentages, with its own empty-input rule.
Stylelet currently has the four margin longhands, but no margin shorthand.
Its shared `BoxSides<T>` representation is provisional: introduced to support
HTML lazy loading without a broader CSS box-value review. Revisit its shape and
shared parsing helpers during that work. The observer retains percentages until
intersection computation supplies the clipping rectangle's width. Its numeric
values can go through Stylelet's `tryResolveLengthPercentage()` with that reference size.
This operation does not depend on CSS cascade or layout's resolution of `auto`.

Implement the [Intersection Observer algorithms](https://w3c.github.io/IntersectionObserver/#algorithms)
with real [rendering geometry](../../rendering/ROADMAP.md), including viewport
and scroll-container clipping. Use the existing
`updateIntersectionObservations` phase in `WindowRenderingProducer` and HTML task
delivery; do not add a separate rendering loop. Initial entries, threshold
transitions, root/scroll margins, visibility and delay processing (including
registration `lastUpdateTime`), Document task coalescing and observer selection,
pending-initial-target rendering, and document/adoption/teardown integration
remain work here. Existing registrations survive adoption on the target itself;
that alone does not settle observation across document/rendering lifecycles.

HTML's internal observer use is the intent of
[IntersectionObserver issue 464](https://github.com/w3c/IntersectionObserver/issues/464).
The specification still lacks dedicated low-level hooks. Its suggested dynamic
lazy-loading margin also conflicts with immutable observer options; see
[issue 428](https://github.com/w3c/IntersectionObserver/issues/428). Browlet
captures its configured margin when each document creates its observer.

The HTML consumer tests now use this real scaffold for registrations and
resumption ordering, including the approved batch-continuation rule. Tests supply
explicit entries and call notification directly. Observer tests also cover
independent registrations, removal/reobservation, queue draining, notification
reentrancy, and adopted targets. They provide no evidence of geometry, task
scheduling, author API conformance, or actual resource loading.

Remove this roadmap when complete initialization, entries, binding, rendering
input, task delivery, and lifecycle tests replace the remaining provisional work.
