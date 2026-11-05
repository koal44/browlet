# Performance and timing roadmap

[Shared timing](../../timing/README.md) supplies the clocks and time calculations
used by both Fetch and Browlet.
This folder owns the Performance API and its entry families, which consume
that timing alongside browser events and lifecycle observations.

## Present

- [`timing/clock.ts`](../../timing/clock.ts) owns the wall and monotonic clocks,
  unsafe and coarsened moments,
  clock-neutral durations, and their arithmetic. Unsafe moments coarsen into
  Moments; arithmetic returns new values and never moves an existing moment.
  High Resolution Time and Fetch's connection timestamps share the stateless
  `coarsenTime()` calculation in Timing. Fetch's transport already supplies
  connection observations; Resource Timing entries consume prepared observations,
  while automatic timing production remains deferred.
- [`timing/high-resolution-time.ts`](../../timing/high-resolution-time.ts) owns the
  estimated monotonic Unix epoch, relative and shared time, and environment-settings
  time origins. It selects the
  isolation capability passed to `UnsafeMoment.coarsen()`, and owns the
  `DOMHighResTimeStamp` and `EpochTimeStamp` declarations through Web IDL Core.
- `performance.ts` owns the `Performance` implementation and declaration.
  The `WindowOrWorkerGlobalScope` mixin in
  [`global-scope.ts`](../environment/global-scope.ts) owns its retained
  instance and the `performance` declaration contribution (High Resolution Time §§5–8).
  Resource Timing contributes its buffer-control partial from `resource.ts`;
  the methods, secondary buffer, overflow task, and event-handler state remain
  on PerformanceImpl. Resource storage runs once, independently of observer delivery.
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
`Document.createNavigationTimingEntry()`: navigation-specific construction,
lifecycle timestamps and exposure filtering, load-event queuing, and retained
restoration diagnostics. PerformanceEntry/ResourceTiming construction, realm
ownership, timestamp conversion, and Timeline delivery are now available.
HTML does not pass Navigation Timing's cacheMode or Critical-CH
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
- Resource/Navigation Timing: the slices below supply the resource entry,
  conversion, overflow protocol, and Fetch production/privacy filtering.
  Navigation Timing's entry/lifecycle integration remains unfinished.
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

`supportedEntryTypes` advertises only completed producers: Fetch integration
below adds resource, while registry names alone do not qualify. The internal tests provide completed producer
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
- The slices below complete Resource Timing's producer, secondary buffer, and
  buffer-full event; supportedEntryTypes now includes resource. Navigation/User/
  Visibility and other timing producers remain absent. Event Timing admission
  still throws.
- Worker construction/exposure needs integration with Pip's Worker machinery;
  the non-Window regression uses a real sandbox, not a pretend Worker global.
  Developer warnings and the recommended scheduling priority remain open.

The Resource Timing entry foundation below follows this slice. Its Fetch inputs,
privacy filtering, and buffering remain before returning to Navigation Timing/HTML §7.5.1.

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

## Resource Timing entry foundation

This bounded slice implements the [Resource Timing interface](https://w3c.github.io/resource-timing/#sec-performanceresourcetiming)
(§3.3), the render-blocking enum, and §4's entry setup/timestamp conversion.
The clean local Resource Timing reference was refreshed to `b689926` on
5 November 2026; Fetch's clean reference was also checked against upstream.
[`resource.ts`](resource.ts) owns `PerformanceResourceTimingImpl`, its complete
primary IDL, and the enum. The entry inherits PerformanceEntry and uses existing
Binding projection and default JSON; authors cannot construct it directly.

The constructor performs entry setup and retains timing/body records. Its cache
input uses Fetch's `CacheUsage | ''`; the extra, explicitly supplied
`allowTransferSize` flag carries the approved transfer-size exposure decision,
including the CORS body-access check added by Fetch integration below.
The owning environment is last. Construction neither queues an entry nor
advertises a working producer. Base start/end timestamps are initialized once;
the resource getters retain the specified references to timing and body records.
Navigation Timing will still need its own lifecycle-sensitive entry behavior.

Shared Fetch timestamps become relative only in the entry's environment.
Zero remains an absent observation; conversion does not coarsen a timestamp a
second time or clamp negative differences. Borrowed getters still read the
receiver's measurements, while default JSON allocation uses the method's realm.
The entry exposes cache delivery classification, byte sizes, interim/final
headers, status/content metadata, protocol bytes, render-blocking, and worker
router observations from supplied records. Worker exposure is declared; this
slice does not implement a worker/service-worker timing producer.

### Decisions and evidence

The browser-only probe `node-compat/experimental/resource-timing-entry.mjs`
uses an HTTP server, real fetches, cross-origin no-CORS responses without TAO,
and another Window's JSON method. It ran on Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. Eric approved these choices:

- `SPEC_GAP(resource-timing-absent-records)`: Fetch permits null connection and
  service-worker timing records; Resource Timing's getters dereference them.
  Return zero/empty strings when the record is absent. All three engines hide
  connection timing/protocol details on the no-TAO response; Chromium/WebKit
  expose zero/empty router fields when there is no service worker. Firefox
  does not expose the router fields. This does not synthesize cache/reused-socket
  timings; those require Fetch's normalization before entry creation.
- `SPEC_CLASH(resource-timing-transfer-exposure)`: The written formula adds
  300 bytes even for a response whose details were hidden; Fetch's specified
  handoff no longer carries the permission that distinguishes this case.
  All three engines return zero for the no-TAO response. Keep the separate flag
  and return zero when false. A permitted empty network response still returns
  300; local cache returns zero and validated cache returns 300. Body/status
  visibility remains a separate Fetch/CORS responsibility.
- `SPEC_CLASH(resource-timing-router-names)`: Keep the specification/WebKit
  `workerMatchedRouterSource` and `workerFinalRouterSource` names. Chromium
  instead exposes `workerMatchedSourceType` and `workerFinalSourceType`;
  Firefox exposes neither pair. No aliases are added.
- `SPEC_CLASH(resource-timing-router-clock)`: [Service Workers' Handle Fetch](https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm)
  records shared-clock router timestamps; Resource Timing returns them directly.
  Convert them to the entry's relative clock. This nonzero conversion is source
  evidence from [Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_resource_timing.cc)
  and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/PerformanceResourceTiming.cpp),
  not a live intercepted service-worker measurement. The live no-worker cases
  verify zero preservation.
- `SPEC_CLASH(resource-timing-end-clock)`: Fetch makes completion relative in
  its reporting callback, then Resource Timing subtracts the owner's origin
  again. Keep the completion timestamp coarsened on the shared clock until
  entry conversion. The focused regression observed `20.543...` instead of
  `100.5` before the fix. Live browser entries have comparable start/end values
  relative to their page's clock.

The audit also corrected `FetchTimingInfo.createOpaque()`: Fetch explicitly
retains end time and render-blocking in addition to start time. The previous
implementation and its old test dropped both. Corrected expectations first
failed with end time zero and render-blocking false, then passed after preserving
those fields. Overall opaque duration now survives hiding connection/worker
details, as the live browser entries demonstrate.

Cached protocol identity was an integration question in
[Resource Timing issue #419](https://github.com/w3c/resource-timing/issues/419).
Our entry decodes the supplied connection record; it does not independently
erase or reconstruct cache protocol data. In this probe Chromium returned an
empty cached protocol while Firefox retained `http/1.1`; WebKit did not show
a zero-transfer cache hit. The Fetch integration below now selects current-fetch
cache timestamps and an empty protocol, with that disagreement documented.

### Explicit stopping point and validation

The slices below connect `BrowletEnvironment.markResourceTiming()`, audit
Fetch's body/status/TAO filtering, forward the exposure flag, and normalize cache
observations. They also supply the `Performance` partial, secondary buffer, and
buffer-full task/event. `supportedEntryTypes` now includes `resource`.
The Server Timing slice below adds its header parser, filtered metric values,
and the resource partial. Service-worker recording, early navigation-ID
capture, and Navigation Timing's lifecycle/diagnostic integration remain explicit
owner dependencies.

`resource.test.ts` adds 14 real-binding tests for construction, inherited JSON,
all getter families, byte/protocol/cache inputs, absent/opaque records, reference
retention, and borrowed-realm conversion. Together with existing Performance,
Fetch timing, and declaration validation tests, all 89 pass on Node 24.19.0,
26.8.1, and custom 27.0.0-pre, with and without the addon. The standalone Fetch
suite passes all 1,233 tests. No failures are reclassified or skipped.
The broader Browlet Fetch integration run passes 444 tests with its four existing
expected failures. Its older opaque-timing expectation also required end time
zero; that now checks the retained shared-clock completion. Generated declarations,
TypeScript/declaration contracts, changed-file ESLint, import hierarchy, and
whitespace checks pass.

## Resource Timing buffer controls

[Resource Timing §3.4](https://w3c.github.io/resource-timing/#sec-extensions-performance-interface)
now contributes `clearResourceTimings()`, `setResourceTimingBufferSize()`, and
`onresourcetimingbufferfull` to Performance. The separate partial stays beside
the Resource Timing declaration; implementation state and methods stay on
PerformanceImpl. The existing resource tuple owns the limit (initially 250),
and its entry-list length supplies the specified current size. No duplicate
counter is needed. `canAddResourceTimingEntry()` is a pure capacity check;
Timeline's `isFull()` also counts drops, so it cannot substitute for this check.

Clearing removes only retained resource entries. It preserves the chosen limit,
the cumulative dropped-entry count, other timing families, and pending observer
records. Lowering the limit never evicts existing entries. Web IDL handles
`unsigned long` conversion before the method runs. Borrowed methods mutate the
receiver's Performance. The handler uses the existing HTML EventHandlerMap;
automatic buffer-full delivery is completed in the overflow slice below.

The browser-only probe `node-compat/experimental/resource-timing-buffers.mjs` ran
on 5 November 2026 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
All three agree on retention after shrinking, clearing without clearing pending
observer records or marks, retaining the resized limit after clearing, method
arity/missing-argument errors, and numeric conversion (including negative and
wrapping values). Synthetic handler dispatch uses Performance as receiver and
target. Conversion cases use separate globals so an earlier pending overflow
task cannot repopulate a later case's buffer. Source ownership agrees with
[Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance.cc),
[Gecko](https://github.com/mozilla-firefox/firefox/blob/main/dom/performance/Performance.cpp),
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Performance.cpp).
These controls require no new SPEC_CLASH decision.

Dependencies and subsequent completion:

- The overflow slice below implements `PerformanceImpl.addResourceTimingEntry()`,
  including the secondary FIFO, task/event, draining, and no-progress discard.
  It resolves insertion ownership and the pending-flag reset. Neither resizing
  nor clearing alone dispatches that event, clears pending secondary entries,
  or resets the pending flag.
- The Fetch integration below completes `BrowletEnvironment.markResourceTiming()`:
  filtering/exposure handoff, cache/connection normalization, entry construction,
  and resource-specific insertion. Generic `queueEntry()` alone is not this
  protocol. `supportedEntryTypes` now includes resource.
- The Server Timing slice below supplies header metrics. Worker producer integration
  and Navigation Timing's real lifecycle inputs remain separate dependencies.

Validation: 20 new buffer-control tests bring the Performance suite to 99 cases;
all pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without the
addon. The tests seed prepared entries, then exercise real bindings, observer
delivery, receiver ownership, conversion, and the shared handler machinery.
Generated declarations, type contracts, TypeScript, changed-file ESLint, and
the full import-hierarchy audit pass. The 53 declaration-validation tests, Browlet
package build, and three artifact checks also pass. No failures are reclassified
or skipped.

## Resource Timing overflow and buffer-full delivery

Resource Timing §3.4 now admits entries directly while space exists and no
overflow task is pending. Otherwise it retains them in a per-global secondary
FIFO and queues one task on the existing Performance Timeline task source.
The task fires `resourcetimingbufferfull` when space is still unavailable,
then lets handler changes determine how many entries can move into the primary
buffer. It repeats while making progress and discards remaining entries on
no progress. A local cursor consumes the FIFO without repeatedly shifting it;
list lengths supply both specified counts. The pending flag stays set during
callbacks, so reentrant arrivals cannot overtake older entries. Task discard
releases the secondary list and flag without changing retained primary entries.

The producer's two calls have separate responsibilities: `queueEntry(entry)`
assigns a navigation ID and queues observers; `addResourceTimingEntry(entry)`
retains resource storage. Promotion never notifies observers a second time.
The resource insertion regression first failed with `['one']` instead of `[]`
after Timeline queueing alone, proving the old generic retention was still active.

Eric approved the following choices after the browser-only
`node-compat/experimental/resource-timing-overflow.mjs` probe on 5 November 2026
(Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2):

- `SPEC_CLASH(resource-timing-double-insertion)`: Resource Timing's
  [mark operation](https://w3c.github.io/resource-timing/#mark-resource-timing)
  calls both Timeline queueing and Resource Timing insertion, while Timeline
  also specifies storage. Only Resource Timing stores resource entries, as
  browsers do. [Timeline issue #128](https://github.com/w3c/performance-timeline/issues/128)
  records removal of an older buffer-control parameter; it does not resolve
  the present conflicting insertion steps.
- `SPEC_CLASH(resource-timing-secondary-drop-count)`: Count each diversion to
  secondary storage once, matching Chromium, even when later rescued or when
  capacity has grown while the task is pending. This measures primary-buffer
  admission, not observer loss. It is not recomputed during promotion/discard.
- `SPEC_CLASH(resource-timing-overflow-observer-delivery)`: Queue observers
  before overflow handling, following the specification and Chromium/Gecko.
  WebKit defers secondary entries until its full-buffer task; reentrant entries
  discarded for no progress can miss its observer entirely.
  [Resource Timing issue #367](https://github.com/w3c/resource-timing/issues/367)
  confirms that observer queueing belongs in the earlier mark operation.
- `SPEC_CLASH(resource-timing-full-event-rearm)`: Always release the pending
  flag, including after the algorithm's early no-progress abort. Chromium and
  Firefox notify again on a later overflow; WebKit requires clear/resize.
  [Issue #231](https://github.com/w3c/resource-timing/issues/231) rejects suppressing
  repeated events because authors may intentionally ignore earlier overflows.
- `SPEC_CLASH(resource-timing-full-event-bubbles)`: Use a trusted,
  non-bubbling, non-cancelable event targeting Performance, as specified and
  observed in Chromium/WebKit. Firefox sets bubbles to true. Existing DOM
  dispatch and HTML handlers supply this behavior without a new event class.

The probe uses synchronous XHR to create adjacent measurements. Firefox spins
a nested event loop during those requests, so its batch boundaries are not
evidence of ordinary synchronous overflow dispatch. The repeated-overflow and
event-flag results are observed directly; early observer queueing is also
confirmed in [Gecko's source](https://github.com/mozilla-firefox/firefox/blob/main/dom/performance/Performance.cpp).
[Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance.cc)
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Performance.cpp)
provide the insertion, counter, and pending-task evidence.

The 14 new regressions use prepared measurements with real Binding, DOM event,
observer, and HTML task delivery. They cover capacity, coalescing, flags/identity,
growth/clear rescue, pending-order retention, cumulative counts, reentrancy,
handler exceptions, repeated overflow, task discard, and per-global ownership.
The preceding clear-buffer regression now invokes both producer steps before
clearing, retaining its proof that storage is removed but observer records survive.

All 113 Performance tests pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre,
with and without the addon. Generated declarations, TypeScript, declaration
contracts, changed-file ESLint, full import-hierarchy audit, and whitespace
checks pass. The Browlet package builds with its existing circular-import
warnings, and all three artifact checks pass. No failures were reclassified or skipped.

The Fetch integration below completes real production, including TAO/CORS
exposure, cache/connection normalization, and entry construction at
`markResourceTiming()`. Server Timing is supplied below; Navigation Timing remains a later slice.

## Fetch-produced Resource Timing

Fetch completion now calls the owning environment's existing
`markResourceTiming()` seam. The environment serializes the requested URL and
adapts Fetch's absent cache classification; its retained Performance constructs
the entry, queues observers, and inserts it through the resource overflow
protocol. A response therefore produces one retained entry and the same
realm-owned object in observer delivery. `supportedEntryTypes` advertises
`resource`. Other producer names remain unadvertised.

The final implementation-only boolean is now named `allowTransferSize`: it
carries both TAO and CORS permission. The timing record independently preserves
TAO-authorized phases, including for opaque responses whose body/status stay
private. This is the previously approved permission handoff extended to the
current Resource Timing body-access rule; the callable arrangement has been
reviewed. Fetch still selects the reporting
environment, and parallel consumers must explicitly request timing delivery.
HTTP(S) completion produces entries; data/blob fetches do not.

### Filtering and cache decisions

- `SPEC_CLASH(resource-timing-body-cors)`: follow [Resource Timing §3.5](https://w3c.github.io/resource-timing/#sec-cross-origin-resources)
  and Fetch's filtered responses. Readable CORS responses expose body sizes
  without TAO; opaque responses expose no body sizes/status/content metadata.
  Transfer size requires both permissions. Our Chromium build uses the older
  TAO size gate; Firefox exposes CORS-readable sizes and WebKit restricts sizes
  to same-origin resources. Chromium's [current shipping discussion](https://groups.google.com/a/chromium.org/g/blink-dev/c/1gYbepDdytU)
  proposes the CORS rule and discusses compatibility risk. This separates
  permission to see timing from permission to inspect response contents.
- `SPEC_GAP(resource-timing-cache-phases)`: a local HTTP-cache hit has no new
  connection observations in Fetch, but Resource Timing dereferences them.
  Fetch now supplies a fresh connection record with DNS/connect and request
  phases at this fetch's start, no TLS/protocol, and response start at cache
  materialization. It resets interim-response timing so a redirect cannot
  leak a preceding hop's interim response into the cached destination.
  [Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_resource_timing.cc),
  [Gecko](https://github.com/mozilla-firefox/firefox/blob/main/dom/performance/PerformanceTiming.cpp),
  and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/PerformanceResourceTiming.cpp)
  use current-fetch fallbacks for missing phases. The getters still preserve
  zero for other absent records; this normalization belongs to the cache path.
- `SPEC_CLASH(resource-timing-cache-protocol)`: local hits keep protocol empty,
  matching Chromium's observed result. Firefox retains the original protocol;
  WebKit made another network request in this probe. [Issue #419](https://github.com/w3c/resource-timing/issues/419)
  remains open. Validated hits retain their actual validation connection and
  report 300 transferred bytes; local hits report zero, with cached body sizes.
- `SPEC_CLASH(fetch-reused-http-tls)`: Fetch's connection-reuse clamping
  replaces even a zero TLS timestamp. Preserve zero for plain HTTP, as all
  three browsers do, while clamping an actual TLS connection's timestamp.
  The focused regression first returned 20 instead of zero.
- `SPEC_CLASH(fetch-error-timing-permission)`: main fetch grants timing
  permission even to network errors; the finale's note says those errors
  should become opaque. Keep the permission false, matching Chromium.
  Firefox exposes partial failed-request phases; WebKit did not emit a
  failed-request entry in the probe. The regression first exposed a protocol,
  request timestamp, and fabricated 300-byte transfer size after socket failure.

The explicit browser-only probe is
`node-compat/experimental/resource-timing-fetch.mjs`, run on 5 November 2026
with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It uses actual HTTP,
gzip, redirects, TAO/CORS combinations, fresh cache hits, and socket failure.
It retains ordinary diagnostic failures and exits nonzero when no entry
arrives: Chromium did not complete the no-store opaque-body cases within the
deadline, and WebKit emitted no failed-request entry. Those missing observations
are not treated as successful conformance results. Production tests use a
null-body opaque response for automatic completion, and an internal body consumer
to verify filtering of nonempty opaque measurements. Consuming/canceling bodies
and cache-independent draining of inaccessible bodies remain Fetch lifecycle
responsibilities; this handoff does not manufacture completion early.

### Explicit dependencies and validation

`UserAgent.supportsMIMEType()` still has its explicit content-handler-policy
TODO and returns false. JavaScript/JSON/XML/SVG minimization works independently;
the real CORS regression exercises JSON. Eric approved retaining the strict
`text/plain` contentType expectation as an expected failure until that owner is
implemented; the required assertion is not replaced by the current empty result.
The Server Timing slice below supplies parsing and the resource partial over
Fetch's existing filtering. Worker producer acceptance, service-worker timestamps, early navigation-ID capture,
and Navigation Timing lifecycle integration remain separate dependencies.

Validation: the 183 focused Performance, Fetch-handoff, and connection-timing
cases run on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without the
addon: 182 pass and the one approved MIME expectation remains an expected failure.
The broader Node 26/addon Fetch/Performance run passes 1,784 tests with that same
expected failure; all 44 loader integration tests pass. TypeScript and generated
declarations, type contracts, changed-file ESLint, and the full import-hierarchy
audit pass. The package builds with the same seven existing circular-import
warnings; ESM, CJS, and platform-declaration artifact checks all pass.

## Server Timing

`server.ts` supplies `PerformanceServerTimingImpl`, its parser, and Server Timing's
partial declaration on `PerformanceResourceTiming`. Metrics have a name, duration,
and description; they are not `PerformanceEntry` objects and cannot be constructed
by authors. The resource implementation retains parsed metrics in its own environment.
The existing FrozenArray and default-JSON bindings handle projection, borrowed
getters, nested metric values, and method-realm JSON allocation without new adapters.

Fetch already retains comma-split Server-Timing values from the final response for
secure clients and clears them when timing permission fails. The resource constructor
consumes that filtered list independently of the body/transfer-size permission.
No new Fetch behavior is required. Repeated physical headers and metric names are
preserved; cached responses retain their header metrics. Authentication's existing
strict token/quoted-string reader moves into shared HTTP syntax for both parsers.
It rejects unfinished quotes rather than accepting Fetch's partial quoted value.

### Approved parsing, identity, and exposure decisions

- `SPEC_CLASH(server-timing-parsing)`: follow the [header grammar and error-handling prose](https://w3c.github.io/server-timing/#the-server-timing-header-field).
  The draft's detailed parser never stores parsed parameters, collects non-token
  names, and crosses a missing value's semicolon. Use token names, case-insensitive
  parameter names, and the first occurrence even when its value is missing or invalid.
  Skip junk after tokens; ignore unknown parameters; discard unterminated quoted
  values as all three browsers do. Recover at semicolons within a metric and process
  each Fetch-split metric independently. Chromium/WebKit can stop the whole header
  at an invalid metric or empty parameter; Firefox recovers but can promote a
  malformed metric's parameter into a new metric name. Browlet does neither.
  Chromium/Firefox skip junk after a metric name; WebKit stops before its parameters.
  WebKit also retained only the last repeated physical header in the probe.
  [Issue #42](https://github.com/w3c/server-timing/issues/42) discussed tolerant error
  recovery; [PR #87](https://github.com/w3c/server-timing/pull/87) introduced Fetch's
  per-metric handoff, but the current parser still contains these omissions.
- `SPEC_CLASH(server-timing-duration)`: reuse the [specified HTML floating-point parser](https://w3c.github.io/server-timing/#dom-performanceservertiming-duration),
  which accepts finite numeric prefixes and quoted surrounding ASCII whitespace,
  returns zero for overflow, and normalizes negative zero. WebKit accepts `12x`,
  incomplete exponents, and surrounding whitespace; Chromium/Firefox return zero
  for those cases. Firefox returns zero for `1e400`; Chromium/WebKit return Infinity.
  All three preserve negative zero. Negative finite durations are retained; these
  server-supplied numbers are not client timestamps and are not coarsened.
- `SPEC_CLASH(server-timing-identity)`: parse the completed resource's headers once
  and retain both the metrics and list. All browsers retain metric identity; Firefox
  also retains the frozen array, while Chromium/WebKit create a fresh frozen array.
  The draft reparses into fresh metrics on every getter call. Receiver-owned arrays
  and metrics, method-owned JSON objects, and nested platform metrics in resource
  JSON match the browser probes and existing Binding ownership rules.
- `SPEC_CLASH(server-timing-cross-origin)`: honor TAO for foreign metrics, including
  opaque responses whose body/status remain private, as Chromium/Firefox do.
  WebKit keeps foreign metrics hidden even with TAO, a stricter policy the specification
  permits. Capture still requires a secure requesting global, as Fetch specifies.
  Every redirect hop must pass timing permission; only final-response metrics appear.

The browser-only probe `node-compat/experimental/server-timing.mjs` ran on
5 November 2026 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Every
case received a resource entry. Parser source corroboration:
[Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/network/http_parsers.cc),
[Gecko](https://github.com/mozilla-firefox/firefox/blob/main/netwerk/protocol/http/nsServerTiming.cpp),
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/ServerTimingParser.cpp).

### Explicit dependencies

- HTTP trailers are not delivered by the transport. Fetch's header-capture point
  has an explicit TODO to retain Server-Timing trailers before resource entry
  publication; the example in Server Timing does not make that path implemented.
- Navigation Timing must initialize metrics when final response headers are ready.
  Its early entry must not freeze an initial empty list; the resource constructor
  calls out this lifecycle dependency. The public navigation entry is still absent.
- Worker exposure is declared, but actual worker-produced entry acceptance and
  service-worker response/timing production remain with those lifecycle owners.
- No separate observer type or buffer is added: server metrics belong to the
  resource/navigation entry, not the global Performance Timeline on their own.

Validation: 48 new parser, binding, and real-HTTP tests cover malformed input,
numeric recovery, identities/realms, JSON, TAO/CORS, insecure clients, redirects,
and cached headers. The focused Performance, Fetch-timing, and authentication
suite has 243 passing tests plus the existing approved MIME expected failure
on all six runtime configurations. The broader Node 26/addon Performance/HTTP
run has 4,071 passing tests and that same expected failure. TypeScript, generated
declarations, type contracts, changed-file ESLint, and import boundaries pass.
The Browlet package builds with the same seven existing circular-import warnings;
ESM, CJS, and platform-declaration artifact checks pass. No new failures are
classified or skipped.

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
on which to install a getter stub until navigation-entry creation exists.
Resource Timing entries and generic entry queueing are available. `Document.buildNotRestoredReasonsForDocumentState()`
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
| `resource.ts`, `performance.ts` | Entries, buffers, overflow delivery, and Fetch production/exposure handoff present | Resource Timing and Fetch |
| `server.ts` | Header parsing and retained PerformanceServerTiming values on resource entries present; trailers and navigation lifecycle remain | Server Timing |
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

The shared `src/timing/` subsystem sits below Fetch and Browlet, with its own
TypeScript project and `test/timing/` suite. It owns the clock objects, moments,
durations, High Resolution Time algorithms, and `coarsenTime()` formerly in
Infra. `TimingEnvironment` describes the existing owner's time origin, HTML
isolation boolean, and timing operations. Browlet's environment forwards these
operations to the shared algorithms; Performance and the other consumers call
that environment directly. The separate `EnvironmentTiming` object is removed,
along with the unused `currentRelativeTimestamp()` and `currentMonotonicTime()`
methods. The shared epoch estimate stays in Timing. Fetch's unused numeric
relative-time adapter is removed from its environment contract and fixtures;
its completion regression still requires a shared-clock timestamp. The Timing
operations retain their moment/duration types and single-coarsening rule.
`getTimeOriginTimestamp(env)` always uses the shared epoch estimate. Its tests
set clock readings before loading Timing in a fresh process, exercising production
initialization and later wall-clock adjustments without a production override.
Timing imports Infra and Web IDL Core, without importing browser environments,
events, or Performance. `browlet/performance/` retains the Window/Worker-facing
API and its scheduling and event dependencies. Stylelet can consume the shared
Timing subsystem if needed without depending on public Performance objects.

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
   This is implemented by the Fetch integration above, including the real HTTP
   entry/observer regression and cache/exposure decisions. The MIME support
   policy and worker-producer acceptance remain explicit owner dependencies.
3. Server-Timing header parsing and resource-entry projection are present.
   Trailer delivery and navigation-entry initialization remain explicit dependencies.
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

The agreed consolidation point is completion of this Performance/Timing detour,
after the Resource Timing buffers and Fetch delivery, Server Timing, and
Navigation Timing integration pass their exit checks. Return to HTML §7.5.1
then. The shared Timing extraction precedes those remaining slices; it changes
ownership and imports without changing clock behavior or completing a producer.
The buffer-management API, secondary-buffer insertion, and automatic buffer-full
task/event, Fetch production/exposure handoff, and Server Timing header metrics
are present. The next bounded slice starts Navigation Timing's entry/lifecycle work.

Shared Timing extraction and environment-ownership validation: 157 timing,
Fetch-timing, Performance, Temporal, timer, event-loop-pause, and input cases
run on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without the addon.
Existing runtime-dependent expected failures remain; custom/addon passes all
157. The broader Node 26/addon run covers all standalone Fetch tests and the
affected browser clock consumers: 1,675 pass, with 14 existing expected failures
and the existing callback-incumbent skip unchanged. The extraction's 112
import-hierarchy tests pass; generated declarations, type contracts, TypeScript,
changed-file ESLint, and full import-hierarchy audit pass after the ownership
change. The Browlet package and artifact checks cover the extracted code.
Clock/coarsening behavior and the tests' observable assertions are preserved;
no new failure classifications or skips were introduced.

## Removal condition

Burn this file once the shared clock, Performance surface, and all timing
families reached by implemented Browlet behavior have explicit source owners
and cross-realm behavioral tests.
