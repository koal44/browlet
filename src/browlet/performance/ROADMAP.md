# Performance and timing roadmap

[Shared timing](../timing/README.md) supplies the early browser foundation.
This folder owns the Performance API and its entry families, which consume
that timing alongside browser events and lifecycle observations.

## Present

- [`timing/clock.ts`](../timing/clock.ts) owns the wall and monotonic clocks,
  unsafe and coarsened moments,
  clock-neutral durations, and their arithmetic. Unsafe moments coarsen into
  Moments; arithmetic returns new values and never moves an existing moment.
  High Resolution Time and Fetch's connection timestamps share the stateless
  `coarsenTime()` calculation in Infra. Fetch's transport already supplies
  connection observations; public timing entries remain deferred.
- [`timing/high-resolution-time.ts`](../timing/high-resolution-time.ts) owns the
  estimated monotonic Unix epoch, relative and shared time, and environment-settings
  time origins. It selects the
  isolation capability passed to `UnsafeMoment.coarsen()`, and owns the
  `DOMHighResTimeStamp` and `EpochTimeStamp` declarations through Web IDL Core.
- `performance.ts` owns the `Performance` implementation and declaration.
  The `WindowOrWorkerGlobalScope` mixin in
  [`global-scope.ts`](../environment/global-scope.ts) owns its retained
  instance and the `performance` declaration contribution (High Resolution Time §§5–8).
- `timeline.ts` supplies the PerformanceEntry implementation/declaration and
  per-type buffer tuples. Performance owns its global's buffer map and implements
  the three synchronous queries and shared observer-delivery task. `observer.ts`
  owns registration, buffered replay, and record retrieval; `observer-entry-list.ts`
  owns queries over a delivered batch. Entry queueing and initial navigation-ID
  association are present. Timing producers remain unfinished; registry rows do
  not advertise producer support.
- Realm-created Events, navigation timing records, and Document load timing
  use this shared clock and the relevant Window's time origin. Each new Window
  realm gets one stable, replaceable `Performance` platform object.
- `navigation.ts` provisionally defines `NavigationTimingRecord`.
  `Document.createNavigationTimingEntry()` retains live Fetch timing, body
  information, selected redirect counts, response worker/cache inputs, and
  Document load/unload milestones for network navigation. This is
  internal input storage, not a projected PerformanceNavigationTiming entry.
  Source-only navigation without a FetchController creates no placeholder entry.

[Navigation Timing §5](https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry)
associates the entry with a Document and creates it using that Document's realm,
URL, load/unload timing, and restoration information.

The entry model belongs here because it produces Performance Timeline data.
Browsing/navigation owns when creation happens and supplies navigation state.
Performance will own entry construction and buffering.
Browser examples are Blink's
[`WindowPerformance::CreateNavigationTimingInstance`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/window_performance.cc),
Gecko's [`PerformanceMainThread::CreateNavigationTimingEntry`](https://github.com/mozilla-firefox/firefox/blob/main/dom/performance/PerformanceMainThread.cpp),
and WebKit's [`Performance::addNavigationTiming`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Performance.cpp).
The inspected jsdom checkout implements High Resolution Time's
[Performance surface](https://github.com/jsdom/jsdom/blob/main/lib/jsdom/living/hr-time/Performance-impl.js)
but no navigation timing entry.

### HTML §7.5.1 timing input selection

The controller-backed path now applies HTML's redirect-count selection before
loader callbacks. Same-origin redirect chains retain the request count. Other
chains require every redirect's Timing-Allow-Origin values to authorize the
destination origin, plus either a null request client or a referrer other than
no-referrer. It uses Fetch's existing `isNavigationTimingBlocked()` operation;
the separate Resource Timing `timingAllowPassed` flag does not select this count.
The count is captured once, while Fetch timing, body sizes, service-worker
timing, and Document milestones retain their live records. Raw HTTP status and
cache classification are inputs, not exposure-filtered public values.

`SPEC_CLASH(navigation-redirect-count)` follows HTML, as approved by Eric. Live
Chromium 156.0.8078.4 and WebKit 27.2 expose cross-origin redirect counts when
all redirect responses opt in and a referrer exists; Firefox 157.0 retains zero.
WebKit also returns zero for same-origin no-referrer chains, unlike HTML,
Chromium, and Firefox. Chromium's
`PerformanceNavigationTiming::ComputeExposeCrossOriginRedirectTiming()` requires
a referrer even when there is no initiating client; HTML explicitly exempts
that case. Host-initiated Playwright navigation returned zero in all three
engines, but that probe alone does not establish their internal request-client
state. Missing TAO at any hop and foreign no-referrer author navigation remain
hidden in all three. The browser-only probe is
`node-compat/experimental/document-navigation-timing.mjs`.

`SPEC_CLASH(html-navigation-response-timing)` also covers the duplicate entry
creation in current HTML, its out-of-scope locals, and the removed response
timing field. Browlet selects controller timing and the params' navigation type
once. [HTML PR #12890](https://github.com/whatwg/html/pull/12890) proposes that
correction, supplies the omitted cache/restart arguments, and adds a
no-controller fallback, but remains open. This slice preserves the existing
no-controller boundary: Chromium/Firefox exposed one srcdoc entry in the probe
(with differing name/end-time data), while WebKit exposed none. The fallback
and any recovery of prior network timing for supplied responses need a separate
choice; no public entry or synthetic Fetch timestamps are introduced here.

The remaining consumer dependencies are explicit in
`Document.createNavigationTimingEntry()`: PerformanceEntry/ResourceTiming
construction and realm ownership, relative timestamps and exposure filtering,
Timeline buffers/observers and load-event queuing, and retained restoration
diagnostics. HTML does not pass Navigation Timing's cacheMode or Critical-CH
restart arguments. The raw Fetch cache classification is retained for that
consumer; Critical-CH restart measurement has no producer yet. Previous-Document
unload timestamps likewise retain their unfinished lifecycle producer. The
current input record is deliberately not an implementation of the Navigation
Timing §5 callable signature.

Worker exposure is already declared. It becomes observable when Browlet gains
`WorkerGlobalScope`; no second clock or Worker-specific `Performance`
implementation should be introduced then.

## Performance Timeline: entries, buffers, and synchronous queries

The first detour slice supplies the entry/query pieces of §§2–3 and implements §§5.4–5.6 of the
[Performance Timeline draft](https://w3c.github.io/performance-timeline/).
The clean local source was fast-forwarded to `65cbbeb` on 5 November 2026.
The [Timing Entry Names Registry](https://w3c.github.io/timing-entrytypes-registry/#registry)
supplies each buffer's capacity and synchronous-query visibility. These are
metadata for known types, not a supported-producer list.

`PerformanceEntryImpl` retains name/type/start/end fields and computes duration
from the producer's end time, including the specified zero sentinel. Binding
supplies readonly platform getters, interface checks, stable identity, and default
toJSON. The queueing audit below removes the draft's incorrectly added `id` and
uses the newer Soft Navigations amendment for `navigationId`: entries start at
zero, and queueing supplies the Window association unless a producer captured it
earlier. No production timing producer creates these base entries yet.

Each global's existing retained `PerformanceImpl` owns its buffer map. Tuples
are `PerformanceEntryBuffer` instances, initialized on first internal use.
Unallocated buffers are empty; queries never allocate them. Eric approved this
ownership and lazy tuple lookup. Replacing the public
`window.performance` value does not replace the retained owner or its buffers.

Queries return fresh arrays, preserve each entry's identity, sort by startTime,
match names/types exactly, and exclude registry-hidden types. Filtering never
reorders stored entries. `isFull()` implements §5.6 and increments the dropped
count only when called for a full buffer; queueing first applies the producer's
admission algorithm, as required by the refreshed draft.

Browser-only observations are reproducible in
`node-compat/experimental/performance-timeline-foundation.mjs`. Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2 agree on ordinary filtering,
chronological sorting, fresh arrays, repeated entry identity, and unknown-type
empty results. Their borrowed default toJSON methods all allocate in the method's
realm, matching Web IDL and Browlet's existing implementation.

- `SPEC_CLASH(performance-query-result-realm)`: Eric approved retaining the
  existing Binding result convention. Borrowed query methods return arrays in
  the receiver's realm, matching Chromium/WebKit; Firefox uses the method realm.
  The entries themselves retain their owning realm.
- `SPEC_GAP(performance-timeline-unknown-type)`: §5.4 dereferences the absent tuple
  for an unknown type without specifying a missing-key case. All three engines
  return an empty result. Browlet does likewise; this also handles known but
  unpopulated buffers.
- The initial identifier audit found unset IDs, a null Worker ID conflicting
  with nonnullable IDL, and a dependency on a completed navigation entry. The
  queueing audit below resolves this through the upstream correction and newer
  Soft Navigations model, replacing that pending gap with the approved clashes.

Explicit remaining dependencies:

- The slices below supply queueEntry(), registration, buffered replay, and task
  delivery. Event Timing's admission algorithm and actual producer integrations
  remain unfinished. The obsolete per-entry counter/most-recent-entry link in
  §§5.1–5.2 and 5.7 is superseded as described below.
- Resource/Navigation Timing: real producer subclasses, time conversion and
  privacy filtering, insertion/completion hooks, and Resource Timing's secondary
  buffer/full-buffer event. Existing raw Fetch/navigation records are unchanged.
- User Timing and other producers remain absent. Test fixtures supply completed
  internal entry fields and retained buffers through real Browlet bindings;
  they do not simulate observer delivery or claim producer acceptance coverage.

The slices below supply observer construction, observation options, record
retrieval, buffered replay, task delivery, and generic entry queueing. Actual
producer integration remains separate.

Validation: 14 new binding/implementation cases plus the existing Performance
and clock suites give 35 passing tests in each of six configurations: Node
24.19.0, 26.8.1, and custom 27.0.0-pre, with and without the addon. Generated
platform declarations, TypeScript, declaration contracts, changed-file ESLint,
import hierarchy, and whitespace checks pass. No expected failures or skips
were added. The first run caught an incorrect test assumption about borrowed
default toJSON; Web IDL and all three browser probes confirmed the existing
method-realm result, so only that expectation changed.

## PerformanceObserver registration and record retrieval

This slice implements the non-delivery parts of Performance Timeline §4:
construction, option validation, persistent single/multiple observation mode,
registration replacement/accumulation, disconnect(), takeRecords(), and the
PerformanceObserverEntryList interface. The global's retained Performance owns
an ordered Set of observers alongside its buffers. Each observer retains its
callback, options list, and pending entries. The options start empty and come
from observe(), not construction; disconnect() clears them and removes the
observer from the Set. A later registration appends that observer at the end.
This replaces the specification's separate { observer, options list } record,
as reviewed and accepted by Eric. Gecko also stores its
options directly on PerformanceObserver, while Blink/WebKit store their type
filters there. Binding handles callback conversion, result projection, errors,
and the static supportedEntryTypes getter's realm.

All these implementations retain their actual BrowletEnvironment owner.
PerformanceObserverType names the lifetime single/multiple choice. The converted
PerformanceObserverInit dictionary accepts arbitrary DOMStrings because
unsupported names must be ignored. observe() retains that converted dictionary
after filtering its entryTypes or checking its type against supportedEntryTypes;
the author-supplied object and array are unaffected. PerformanceEntryType still
constrains entries, buffer creation, and the supported-types list, without making
the input dictionary generic.

Global queries and observer batches share one matching operation. Global queries
append matches directly into one result array and sort once, avoiding the
specification's redundant per-buffer sorts and intermediate result arrays.
Observer-list queries also sort only their final result. Stable ordering of
equal timestamps, fresh result arrays, and stored buffer order are preserved.
Observer batches include observer-only types;
takeRecords() transfers the pending list without sorting and Binding returns a
fresh author array. Entry identity and ownership remain unchanged.

`supportedEntryTypes` is deliberately empty in production: knowing a registry
name does not supply its producer. The internal tests provide completed producer
metadata and pending entries to exercise registration and projection, without
simulating entry queueing. The delivery slice below implements supported buffered
subscriptions over retained records. Unsupported buffered subscriptions return normally.

Eric approved these choices after the browser-only
`node-compat/experimental/performance-observer.mjs` probe on Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2:

- `SPEC_CLASH(performance-observer-mixed-options)`: Follow the specified TypeError
  when entryTypes is combined with buffered, including false. All three browsers
  ignore buffered in this form. [PR #164's discussion](https://github.com/w3c/performance-timeline/pull/164#discussion_r406503907)
  explicitly identifies Chromium's behavior as needing correction; its follow-up
  added a compatibility counter. Blink still warns instead of throwing.
- `SPEC_CLASH(performance-observer-mode)`: Keep the observation mode after an
  unsupported request and disconnect(), matching the algorithm and Chromium/Firefox.
  WebKit's `PerformanceObserver::observe()` gates its mode check on `m_registered`,
  which disconnect clears and an unsupported request never sets.
- `SPEC_CLASH(performance-observer-empty-types)`: Follow observe() and all three
  browsers: an empty type list returns without registration. The dictionary prose's
  MUST NOT be empty conflicts with that explicit algorithm. The request still
  chooses multiple mode and sets requires-dropped-entries.
- `SPEC_CLASH(performance-observer-supported-types)`: Retain the specified per-global
  frozen array using existing FrozenArray projection. Chromium retains its frozen
  value; Firefox returns fresh mutable arrays, and WebKit returns fresh frozen
  arrays. [Issue #212](https://github.com/w3c/performance-timeline/issues/212)
  identifies `[SameObject]` as invalid for this attribute. Omit that annotation
  from the executable declaration while preserving the source IDL snippet and
  the processing model's identity guarantee. No Binding change is needed.
- The previously approved `SPEC_CLASH(performance-query-result-realm)` also applies
  to takeRecords() and observer-list queries: Chromium/WebKit use the receiver's
  realm, Firefox the borrowed method's realm. The static getter uses its own realm.

Remaining dependencies are explicit in source:

- The queueing slice below inserts into both kinds of buffers and supplies
  initial navigation association. Event Timing's should-add-entry operation
  still throws; other registry rows return true.
- Recommended developer warnings for unsupported or empty requests remain TODOs.
- No type is added to supportedEntryTypes until its real producer and delivery
  integration work. Resource/Navigation Timing and other producer specifications
  retain their existing boundaries.

Buffered replay and §5.3 observer-task delivery are covered by the slice below.

Validation: all 43 Performance tests (19 new observer cases) pass on Node 24.19.0,
26.8.1, and custom 27.0.0-pre, each with and without the addon. Generated declarations,
TypeScript, declaration contracts, changed-file ESLint, import hierarchy, and
whitespace checks pass. No new expected failures or skips were introduced.
The later dictionary simplification was rechecked with all 43 tests on Node
24.19.0, with and without the addon, plus TypeScript and changed-file ESLint.

## Buffered replay and observer delivery

Performance Timeline §4.2 now appends eligible retained entries to an observer's
pending buffer. §5.3 uses one coalesced `performance-timeline` task per global,
owned by its retained Performance. The task clears its queued flag and snapshots
observer membership, then drains each live batch before invoking that observer.
An empty batch skips only that observer, matching all three browsers. Reentrant
observation can queue the next task; disconnect/re-observe can replace a later
observer's pending batch without adding duplicate registrations. Discarding the
Document-associated task also releases the queued flag.

Binding already supplies the observer callback's receiver/argument projection,
exception reporting, and HTML callback microtask checkpoints. Delivery uses those
facilities directly. The entry list retains the observer's environment; its
entries preserve their original identity. The callback options dictionary is
converted in the callback's realm.

Eric approved these choices after the browser-only
`node-compat/experimental/performance-observer-delivery.mjs` probe on 5 November
2026, using Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2:

- `SPEC_CLASH(performance-observer-callback-options)`: Supply the specified third
  argument, including the cumulative dropped count on the first nonempty delivery
  after observe(), as Chromium does. Firefox/WebKit omit the argument. Later
  deliveries receive an empty dictionary until observe() requests the count again.
- `SPEC_GAP(performance-observer-duplicate-counts)`: Count each observed type once,
  matching Chromium's repeated-resource-type probe and its type-mask implementation.
  The specification does not say whether duplicate names repeat the count. An
  unallocated lazy buffer contributes zero; reporting does not reset its count.
- `SPEC_CLASH(performance-observer-buffered-order)`: Follow the specified append
  order, leaving chronological sorting to getEntries*(). With backdated marks and
  two replays, takeRecords() retains `late, early, late, early`. Firefox appends
  sorted batches; Chromium/WebKit also merge those batches chronologically.
- `SPEC_GAP(performance-observer-list-realm)`: Keep the list in the observer's realm,
  matching Firefox/WebKit. The allocation step omits its realm; Chromium uses the
  callback's realm. Existing entry identity is unaffected.

The probe also confirmed `SPEC_CLASH(performance-observer-disconnect-records)`:
the already implemented, specified clearing of pending records agrees with
Chromium/WebKit. Gecko clears the options but retains pending records, so
disconnect followed by buffered re-observation duplicates those pending entries.
No behavior change was needed for that case.

Sources: [task algorithm](https://w3c.github.io/performance-timeline/#queue-the-performanceobserver-task),
[entry-type registry](https://w3c.github.io/timing-entrytypes-registry/#registry),
[Blink delivery](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_observer.cc),
[Blink drop counts](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance.cc),
[Gecko](https://github.com/mozilla-firefox/firefox/blob/main/dom/performance/PerformanceObserver.cpp),
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/PerformanceObserver.cpp).

Remaining dependencies are explicit in source:

- The queueing slice below completes buffer insertion and resolves the old ID
  conflict. Producer creation and capture of navigation IDs before queueing remain
  separate work.
- The current registry specifies unconditional admission except for event and
  first-input. Their Event Timing admission operation still throws, including its
  durationThreshold and global-buffer rules.
- The task uses the HTML event loop. Its recommended low-priority/idle preference
  awaits the event loop's queue-selection policy; the task-source declaration names it.
- Developer warnings and actual producer integrations remain unfinished. No type
  is advertised in supportedEntryTypes until its producer and queueing work exist.

Validation: 11 new delivery cases bring the Performance suite to 54 tests. Coverage
includes real HTML-loop delivery, callback checkpoints/exceptions, cross-Window
realms, repeated replay, empty batches, cumulative counts, reentrancy, and discarded
tasks. Fixtures supply completed records while exercising real bindings and scheduling;
they do not claim producer coverage. Initial failures were incorrect fixture access
to the environment's event loop and Document, corrected to their actual owners.
All 54 tests pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without
the addon. Generated declarations, TypeScript, declaration contracts, changed-file
ESLint, import hierarchy, and whitespace checks pass. No new expected failures or
skips were introduced.

## Entry queueing and navigation-ID foundation

Performance Timeline §5.1 now selects each interested observer once, applies its
producer-specific admission rule, appends accepted pending records, and retains
eligible entries subject to the global buffer limit. A full global buffer counts
a drop without suppressing observer delivery. Ineligible entries do not count as
drops. The algorithm then uses the existing coalesced delivery task, including
when there are no registered observers. Queries retain their existing sorting
and entry-identity behavior. A mismatched internal Performance/entry owner throws
before either entry state or buffers change.

The identifier audit changed the planned §§5.2/5.7 implementation. In
[issue #218](https://github.com/w3c/performance-timeline/issues/218#issuecomment-2733441685),
the original editor confirms `PerformanceEntry.id` was added incorrectly; it
also conflicts with Element Timing's string-valued id. [PR #219](https://github.com/w3c/performance-timeline/pull/219)
proposes removal. Its later discussion points to the newer, separate
[WICG Soft Navigations draft](https://wicg.github.io/soft-navigations/), which
defines navigation IDs without the completed-navigation-entry dependency.

As of 5 November 2026, the Soft Navigations document remains a Draft Community
Group Report, not a W3C Standard or Standards Track document. Chrome's
[implementation guide](https://developer.chrome.com/docs/web-platform/soft-navigations)
reports default support from Chrome 151. Shipping support does not establish
cross-browser agreement or a schedule for incorporating its HTML integration hooks.
The numeric-id removal remains a proposed correction to the Timeline draft;
Browlet deliberately removes its recently added declaration now.

Eric approved both corrections:

- `SPEC_CLASH(performance-entry-id)`: Remove the numeric id from the implementation,
  executable IDL, generated platform types, and default JSON. All three browser
  probes omit it. The original primary IDL excerpt remains verbatim as evidence
  of the continuing draft conflict; no per-entry counter is implemented.
- `SPEC_CLASH(performance-entry-navigation-id)`: Use Soft Navigations §§2.1–2.3.
  The retained Performance owns one initial random integer from 100 through 10000
  for its Window; non-Window owners use zero. Entries initially carry zero and
  queueing fills that value without replacing an earlier producer association.
  The navigationId declaration is a separate partial interface beside the primary.
  The old special navigation-entry queue and Document most-recent-entry link are
  not needed for this model. This numeric ID is separate from HTML's string
  navigation ID and Navigation API entry identifiers.

The browser-only `node-compat/experimental/performance-entry-queueing.mjs` probe
ran on 5 November 2026 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
None exposes id. Chromium exposes the same nonzero navigationId during parsing,
after load, and on a directly constructed PerformanceMark; a fresh about:blank
Window also has an ID, and Worker marks use zero. Firefox/WebKit do not expose
navigationId. All three deliver a resource entry when the global resource buffer
has capacity zero; Chromium also reports one dropped entry. Blink's
[base Performance](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance.h)
returns zero outside Window, and its
[ID generator](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_timeline_entry_id_generator.h)
uses independently initialized Window values. These observations do not establish
interoperability for soft-navigation detection or ID advancement.

Explicit remaining dependencies:

- Soft Navigations detection, interaction/paint attribution, emission, navigation
  counts, and ID advancement remain unfinished. The currentNavigationId field
  names that boundary. A URL update alone must not advance it.
- Producers that expose entries before queueing, including Navigation Timing and
  directly constructed User Timing marks, must capture the ID earlier. Delayed
  measurements may also need an earlier ID; queueing preserves those captured
  values. The entry field names this integration dependency.
- Resource/Navigation/User/Visibility and other timing producers remain absent;
  supportedEntryTypes stays empty. Event Timing admission still throws. Resource
  Timing's secondary buffer and buffer-full event remain its owner's work.
- Worker construction/exposure needs integration with Pip's Worker machinery;
  the non-Window regression uses a real sandbox, not a pretend Worker global.
  Developer warnings and the recommended scheduling priority remain open.

Next bounded slice: Resource Timing's entry foundation, then its Fetch inputs,
privacy filtering, and buffering, before returning to Navigation Timing/HTML §7.5.1.

Validation: 11 new queueing cases bring the Performance suite to 65 tests. The
numeric-id regression failed on `'id' in entry` before the fix. Coverage includes
matching/deduplication, capacity-independent delivery, admission before drop counting,
captured IDs, zero outside Window, and retained-Window ownership. Tests supply
completed measurements and only substitute Event Timing's missing admission rule;
queueing, bindings, and scheduling are real. The sandbox deliberately lacks exposed
interfaces, so its JSON check borrows the real Window binding. No production Worker
exposure is claimed by that test.
All 65 tests pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without
the addon. Generated declarations, TypeScript, declaration contracts, changed-file
ESLint, import hierarchy, and whitespace checks pass. No new expected failures or
skips were introduced.

## Restoration diagnostics dependency

HTML §7.2.8 now supplies `NotRestoredReasonsImpl` and its recursive creation from
history records. The missing consumer is Navigation Timing's
[entry-creation algorithm](https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry):
create the diagnostic object while creating the entry and retain that object;
`PerformanceNavigationTiming.notRestoredReasons` returns the retained value.
It must not re-read the current Document/history entry on every getter call.

The existing `Document.createNavigationTimingEntry()` is still a provisional
input recorder. Its source and `NavigationTimingRecord` explicitly mark this
missing creation step. There is no projected PerformanceNavigationTiming entry
on which to install a getter stub until Resource Timing and navigation-entry
creation exist. Generic entry queueing is available. `Document.buildNotRestoredReasonsForDocumentState()`
now collects the unfiltered Document tree, including shadow-tree containers.
`TopLevelTraversable.buildNotRestoredReasons()` completes origin masking and
retains the root's generic `masked` detail for hidden blockers. Unloading/cache
eviction must invoke that builder before destroying the documents whose
diagnostics are needed; raw collected records are not public timing data.

`SPEC_GAP(navigation-timing-null-reasons)`: the refreshed Navigation Timing source
at `48c0048` (refreshed 4 November 2026) invokes HTML's creation operation with nullable Document diagnostics,
although that operation requires a non-null backing record and a realm. It
does not describe the null case or pass that realm. Resolve the null case with
browser evidence when implementing this consumer; allocation belongs to the
new entry's realm. No behavior choice or placeholder public entry is introduced
by the diagnostic-interface slice. The
[HTML audit](../browsing/navigation/ROADMAP.md#html-728-notrestoredreasons) records
the separate collection conflicts and remaining reason producers.

## Initial visibility dependency

`Document.setInitialVisibilityState()` now retains the state supplied by
navigable initialization or history activation. HTML §6.2 also requires it to
queue a `VisibilityStateEntry` with that state and timestamp **0**, even if the
state did not change. Its source explicitly marks this missing step. Initial
assignment does not fire `visibilitychange`.

`VisibilityStateEntry` creation and its lifecycle caller are still absent; the base
entry, queueing, buffers/queries, and observer delivery now exist. Do not replace the required
timestamp with the current clock or treat the Document's stored state as a delivered entry.
Subsequent visibility changes need a separate entry with the Document's current
high-resolution time. The [navigable audit](../browsing/navigation/ROADMAP.md#html-73-and-731-navigable-foundations)
records the remaining visibility producers.

## Missing timing families

Classic-script creation now retains the Long Animation Frames `originalSourceURL`
before compilation. The remainder of
[record classic script creation time](https://w3c.github.io/long-animation-frames/#record-classic-script-creation-time)
still needs document frame timing info, a pending script entry, and lifecycle
reporting. The TODO remains in the constructor; source attribution alone
does not implement this timing algorithm.
Classic/module `run()` also mark their execution-start hooks as unfinished;
they need the same frame timing and pending-script entry machinery. Reading a
clock alone would not implement those hooks.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `timeline.ts`, `observer.ts`, `observer-entry-list.ts` | Entries, buffers, queries, queueing, and observer delivery present; actual producers remain | Performance Timeline |
| `navigation.ts` | Document navigation and unload timing entries sourced from lifecycle records | Navigation Timing and HTML §3.1.5 |
| `resource.ts` | Fetch/loader timing info and resource entries | Resource Timing and Fetch |
| `server.ts` | Server-Timing parsing and PerformanceServerTiming values exposed through resource entries | Server Timing |
| `user.ts` | Marks, measures, detail cloning, and buffer management | User Timing |
| `event.ts` only after trusted input dispatch exists | Event timing, interaction grouping, and first-input entries | Event Timing |
| `visibility.ts` | `VisibilityStateEntry` creation and timeline exposure sourced from HTML's Document visibility transitions | HTML §6.2 and Performance Timeline |
| `paint.ts` only after rendering exists | Paint timing entries and first-paint notifications | Paint Timing |
| `element.ts` and contentful-paint producers only after layout/paint exists | Element and contentful-paint observations sourced from rendered output | Element Timing and Largest Contentful Paint |
| `long-task.ts` and `long-animation-frame.ts` only after scheduling/rendering exists | Main-thread attribution and long-frame/task entries | [Long Tasks editor's draft](https://w3c.github.io/longtasks/) and [Long Animation Frames editor's draft](https://w3c.github.io/long-animation-frames/) |

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

The shared `timing/` foundation remains inside Browlet. It supplies environment
time origins without importing DOM events or the public `Performance` object;
`performance/` supplies the Window/Worker-facing API. This differs from Fetch,
whose records and algorithms form an
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

## Fetch and navigation integration

This section owns the timing integration gate linked from the
[Fetch roadmap](../../fetch/ROADMAP.md#owner-integration-gates). Existing clocks remain the
foundation; collecting raw Fetch timestamps does not complete entry delivery.

Reference specifications and their local checkout paths:

| Specification | Local source | Role |
| --- | --- | --- |
| [Performance Timeline](https://w3c.github.io/performance-timeline/) | `w3c-performance-timeline/index.bs` | Entry/observer infrastructure and delivery |
| [Resource Timing](https://w3c.github.io/resource-timing/) | `w3c-resource-timing/index.bs` | Mark resource timing, resource entries, buffers, and exposure |
| [Navigation Timing](https://w3c.github.io/navigation-timing/) | `w3c-navigation-timing/index.bs` | Navigation entries and lifecycle-derived values |
| [Server Timing](https://w3c.github.io/server-timing/) | `w3c-server-timing/index.bs` | Header metrics and PerformanceServerTiming |
| Fetch / HTML | `whatwg-fetch/fetch.bs`, `whatwg-html/source` | Timing production, filtering, response completion, and navigation lifecycle |

1. Performance Timeline entry queueing, initial navigation association, Web IDL
   projection, and observer task delivery are present. Connect actual producers
   without exposing registry names as implemented features prematurely.
2. Connect Fetch's timing/body information and `mark resource timing` to
   Resource Timing. Preserve time-origin conversion, timing-allow filtering,
   redirect/cache information, protocol data, and encoded/decoded sizes.
   Fetch 8A now calls `BrowletEnvironment.markResourceTiming()`; it is explicitly
   provisional until Resource Timing's entry creation/filtering exists. The environment's
   `relativeHighResolutionTime()` already uses the real High Resolution Time
   implementation. Replace the recording no-op when implementing this step.
3. Implement Server-Timing parsing and its resource-entry projection when
   exposing those metrics. Keeping raw header bytes in Fetch is only an input.
4. Connect Navigation Timing to actual loader/navigation/unload records when
   those lifecycles exist; do not manufacture missing lifecycle timestamps.
   Replace the provisional retained record with the real entry, preserving
   time-origin conversion, exposure restrictions, and Timeline delivery. The
   loader test already verifies that later Fetch byte counts reach the record.

**Exit proof:** real Fetch completion creates the expected resource entry;
cross-origin restrictions, redirects, cache results, byte sizes, buffering,
and observer delivery have focused tests. Navigation tests exercise real
lifecycle transitions and the applicable exposure restrictions. Test
Server-Timing parsing separately from its filtered public projection.

These producers do not require completing User, Event, Paint, or the other
timing families first. Their later gates remain in the table above.

## Removal condition

Burn this file once the shared clock, Performance surface, and all timing
families reached by implemented Browlet behavior have explicit source owners
and cross-realm behavioral tests.
