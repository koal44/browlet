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
  and Fetch supplies automatic resource entries.
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
- `legacy-navigation.ts` supplies Navigation Timing §8's `PerformanceTiming`,
  `PerformanceNavigation`, and their Window-only Performance attributes. The
  timestamp view reads existing Document/Fetch measurements as whole epoch
  milliseconds. The type/count view uses the Document's legacy classification
  and existing redirect data; neither introduces another timeline.
- `timeline.ts` supplies the PerformanceEntry implementation/declaration and
  per-type buffer tuples. Performance owns its global's buffer map and implements
  the three synchronous queries and shared observer-delivery task. `observer.ts`
  owns registration, buffered replay, and record retrieval; `observer-entry-list.ts`
  owns queries over a delivered batch. Entry queueing and initial navigation-ID
  association are present. Resource production and Document navigation
  delivery are connected; Window advertises those two entry types. Other globals
  advertise resource only, and registry rows do not advertise unfinished producers.
- Realm-created Events, navigation timing records, and Document load timing
  use this shared clock and the relevant Window's time origin. Each new Window
  realm gets one stable, replaceable `Performance` platform object.
- `navigation.ts` supplies `PerformanceNavigationTimingImpl`, its Window-only
  interface, and the navigation type enum. It retains live load/unload records,
  overrides Resource Timing's redirect/worker getters and PerformanceEntry's
  duration, and retains supplied restoration diagnostics. Confidence calculation
  is present, with an explicit unfinished host measurement hook.
  `Document.createNavigationTimingEntry()` selects controller-backed or fallback inputs;
  Performance constructs and buffers the real entry before loader callbacks.
  Fetch timing/body sizes and Document milestones stay live. Destination metadata
  and redirect exposure are selected independently. Load completion notifies
  observers without inserting a second entry into the timeline.
  Without a FetchController, entries retain response metadata and the Document's
  navigation start; unavailable fetch phases and transfer size remain zero.
  Initial about:blank intentionally has no entry, following HTML/WebKit; later
  explicit navigations to about:blank use the shared Document factory and have one.

[Navigation Timing §5](https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry)
associates the entry with a Document and creates it using that Document's realm,
URL, load/unload timing, and restoration information.

The entry model belongs here because it produces Performance Timeline data.
Browsing/navigation owns when creation happens and supplies navigation state.
Performance owns entry construction and buffering.
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
no-controller fallback, but remains open. The approved fallback below now supplies
that entry. Prior network timing for supplied responses and synthetic-loader
completion observations still need their producers; no measurements are invented.

The automatic-creation and delivery slices below connect navigation-specific
construction, exposure selection, buffering, available diagnostic allocation,
and load-event queuing. The target history state's diagnostic handoff is now connected below.
HTML does not pass Navigation Timing's cacheMode or Critical-CH
restart arguments. The raw Fetch cache classification is retained for that
consumer; Critical-CH restart measurement has no producer yet. Previous-Document
unload timestamps likewise retain their unfinished lifecycle producer. The
reviewed grouped input shape is documented at the Performance factory.

## Navigation Timing: automatic creation

Document creation now retains one `navigationTimingEntry` and
inserts it into the destination Performance buffer before Early Hints callbacks.
Queries project that same entry throughout loading; timestamps, byte counts,
and Document milestones continue to update through retained records. Creation
does not notify observers. Load completion now queues observer delivery after
`loadEventEnd` without inserting the already-buffered entry again.

`Performance.createNavigationTimingEntry(document, inputs, allowTransferSize)` owns allocation and
buffering. Its reviewed signature groups Navigation Timing §5's inputs
into the existing `NavigationTimingInit`, including response status and selected
MIME/Server-Timing metadata. The fallback slice adds the final transfer-exposure
flag, described below. Resource construction also receives the selected
Server-Timing fields separately, as reviewed, avoiding
copies of live Fetch records or writes to the initiating client's header list.
Both interfaces remain ordinary Binding
projections; no new realm or UserAgent factory hook is involved.

`SPEC_CLASH(navigation-timing-destination-exposure)` follows HTML's full-timing
handoff and Chromium/Firefox: the destination sees its own response status, body
sizes, request/response timings, and Server-Timing even after a foreign redirect.
The redirect count/start/end still use HTML's independent gate above. WebKit
hides most final-response details as well after such redirects. Blink's
[`DocumentLoader`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/loader/document_loader.cc)
explicitly marks the response timing-allowed for its own Document. Browlet
minimizes MIME metadata for the destination and uses its secure-context status
for Server-Timing, leaving the initiating client's metadata unchanged.

`SPEC_GAP(navigation-fetch-completion)` repairs the live controller handoff:
[Fetch finale](https://fetch.spec.whatwg.org/#fetch-finale) captures body-end time
but assigns it only within optional Resource Timing reporting. A navigation
with no such report therefore retained zero indefinitely. The regression first
observed zero instead of `100.5`; navigation now records completion at body end
using Fetch's existing coarsening precision. Ordinary resource report-time
coarsening and entry-realm conversion are unchanged.

The browser-only `node-compat/experimental/navigation-timing-creation.mjs` probe
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All expose one stable
entry during parsing, update its completion data, and deliver that same entry
once after load. Chromium/Firefox expose final-response details after foreign
redirects; WebKit suppresses detailed phases, byte sizes, and Server-Timing.
All retain zero redirect history without permission. WebKit lacks the
tested public responseStatus/contentType fields; that is distinct from its
timing/size observations. Findings are retained beside the probe.

Remaining owners are explicit in code: missing producer timing for supplied and synthetic responses;
previous-Document unload and origin filtering;
Critical-CH restart measurements; and the confidence measurement hook. The
target-history diagnostic handoff is now connected below. MIME support policy remains
the existing UserAgent dependency (with its previously approved text/plain
expected failure); JSON minimization exercises the destination selection without
pretending that policy is complete. Fetch completion, real HTTP loading, realm
identity, metadata isolation, and available diagnostic capture have regressions.

Validation: 323 cases pass with the one existing approved MIME-support expected
failure on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without the addon.
The 112 import-hierarchy cases also pass. TypeScript/generated declarations,
type contracts, changed-file ESLint, import boundaries, and whitespace checks
pass. The package builds with the same seven existing circular-import warnings;
ESM, CJS, and platform-declaration artifact checks pass. Experimental commit
`d3e6730` retains the browser probe and findings. No new failure classifications
or native changes were needed.

## Navigation Timing: load-event delivery

`Document.queueNavigationTimingEntry()` forwards its retained entry to the
existing Performance observer queue after `loadEventEnd` and complete-loading
bookkeeping. The entry keeps its creation-time navigation ID. No new task source,
scheduler, or promise is needed. `supportedEntryTypes` now includes navigation
for Window; the retained frozen array and its realm ownership are unchanged.

- `SPEC_CLASH(navigation-timing-double-insertion)`: [Navigation Timing creates and
  buffers the entry early](https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry),
  then its load-time queue delegates to [Performance Timeline's navigation queue](https://w3c.github.io/performance-timeline/#dfn-queue-a-navigation-performanceentry),
  whose generic operation inserts it again. All three browsers retain one entry.
  Creation owns storage; completion only selects observers and queues delivery.
- `SPEC_CLASH(navigation-timing-buffered-replay)`: follow Timeline, Chromium,
  and Firefox. A buffered observer can receive the live entry before load, receive
  it again at completion, and request a later buffered replay. WebKit suppresses
  completion and later replays once that observer has seen the navigation entry.
  A fresh observer still receives it. Observer buffers can therefore contain the
  same live entry twice while the global timeline contains it only once.

Eric approved both choices. The browser-only
`node-compat/experimental/navigation-timing-delivery.mjs` probe held a subresource
until early replay finished, then released load and requested another replay.
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 all delivered to ordinary
and load-listener observers after load/pageshow, with populated `loadEventEnd`,
stable entry identity, and one timeline entry. Blink's
[`Performance::NotifyNavigationTimingToObservers`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance.cc)
notifies without reinserting; Gecko's
[`PerformanceMainThread::QueueNavigationTimingEntry`](https://github.com/mozilla-firefox/firefox/blob/main/dom/performance/PerformanceMainThread.cpp)
queues its retained entry; WebKit's
[`Performance`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Performance.cpp)
tracks whether each observer has already seen navigation timing.

The focused regressions first observed zero completion callbacks instead of one
and two timeline entries instead of one. They now cover load-listener microtasks,
early/coalesced/later buffered delivery, captured navigation IDs, dropped-count
metadata, `takeRecords()`, and disconnection. The streamed HTTP loader regression
also observes the retained entry after load with completion data populated.

The provisional loader still needs HTML's separate parser tasks, deferred scripts
and load delays, initial `pageshow`, and BiDi load-complete notification. Its source
explicitly retains those steps and their ordering before timing delivery. This
slice supplies neither those lifecycle producers nor missing producer timing,
previous-Document unload measurements, Critical-CH, or confidence host instrumentation.
The target-history diagnostic handoff is now connected below.

Validation: the 335-case Performance, Document creation/lifecycle, navigation
params, streamed loader, and Fetch timing suite passes on all six runtimes.
Each addon run has 334 passes and the existing MIME-support expected failure;
each stock run has 331 passes and that same failure plus the three existing
native-global expected failures. The microtask-order test uses the established
`runInHostTask()` helper to enter outside Vitest's own Promise job; its strict
ordering assertion is unchanged. TypeScript/generated declarations, type
contracts, changed-file ESLint, import boundaries, and whitespace checks pass.
The package builds with the same seven existing circular-import warnings; ESM,
CJS, and platform-declaration artifacts pass. Experimental commit `c2fe081`
retains the browser probe and findings. No native changes or new failure
classifications were needed.

## Navigation Timing: creation without a Fetch controller

HTML §7.5.1 now creates an entry even when `NavigationParams.fetchController`
is null. This covers srcdoc, javascript: string replacements, and supplied/local
responses that reach the shared Document factory. The fallback `FetchTimingInfo`
retains the Document's navigation start and leaves unavailable fetch phases zero.
The entry uses the Document URL and keeps supplied body sizes, cache classification,
service-worker timing, status, MIME/Server-Timing metadata, and live Document milestones.
It is buffered before loader callbacks and uses the existing load/observer delivery.

Eric approved two continuing differences:

- `SPEC_CLASH(navigation-timing-fallback)` follows the fallback in
  [HTML PR #12890](https://github.com/whatwg/html/pull/12890), still open at
  `7e3de40d78d297fb14eeada4fcef660603b29026`. Chromium/Firefox create synthetic
  entries; WebKit omits them. Firefox names them `document` and keeps responseEnd
  zero. Chromium uses the Document URL and measures completion in its loader.
  Browlet uses the URL and retains zero for unavailable completion timing.
- `SPEC_CLASH(navigation-timing-fallback-transfer)` suppresses transferSize when
  there are no transport measurements, matching Chromium/Firefox's synthetic
  entries. Resource Timing's ordinary formula would invent at least 300 bytes
  for an uncached supplied response. Supplied body sizes and cache classification
  remain independent; a missing controller does not imply a cache hit.

The Performance factory receives a final `allowTransferSize` flag and passes it
to the entry's existing exposure flag. This reviewed arrangement adds no state
or host hook; the flag controls the public estimate, not Fetch or transport behavior.

The browser-only `node-compat/experimental/navigation-timing-fallback.mjs` probe
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It compares initial
and explicit about:blank, srcdoc, javascript: replacement, and a network control.
For srcdoc/javascript:, Chromium/Firefox deliver the retained entry after load;
WebKit creates no entry or notification. All three expose the network control.
Blink's [DocumentLoader](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/loader/document_loader.cc)
records response completion separately from Fetch; WebKit's
[DocumentLoader](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/DocumentLoader.cpp)
creates navigation timing only when it has a main resource.

The focused regressions first observed no entry before Early Hints callbacks.
They now cover zero phases, live supplied response data across cache modes,
destination realm identity, actual srcdoc params, and local-route observer delivery.
The old-Window retention test now expects the new Window's navigation entry while
still forbidding leakage of the old Window's entries.

Remaining dependencies are explicit: original fetch timing from object/embed/multipart supplied-response
producers; and synthetic-loader response-completion observations. Load-event
completion does not substitute for responseEnd. The earlier unload, Critical-CH,
confidence measurement, and full-loader dependencies remain. The target-history
diagnostic handoff is now connected below.

Validation: the 340-case Performance, Document creation/lifecycle, navigation
params, loader, and Fetch timing suite passes on all six runtimes. Each addon run
has 339 passes and the existing MIME-support expected failure; each stock run
has 336 passes and the same four existing expected failures. TypeScript/generated
declarations, type contracts, changed-file ESLint, import boundaries, and whitespace
checks pass. The package builds with the seven existing circular-import warnings;
ESM, CJS, and platform-declaration artifacts pass. Experimental commit `d53ce3b`
retains the browser probe and findings. No new failure classifications or native
changes were needed.

### Initial about:blank is a separate creation path

`SPEC_CLASH(initial-blank-navigation-timing)` keeps the initial Document's entry
unset, following HTML/WebKit. This corrects the earlier roadmap's missing-producer
TODO: [Navigation Timing issue #155](https://github.com/w3c/navigation-timing/issues/155)
closed with that interpretation. HTML's §7.3.2.1 operation does not invoke the
entry factory; §7.5.1 explicitly excludes initial about:blank Documents.
[HTML issue #7031](https://github.com/whatwg/html/issues/7031) distinguishes that
initial creation from a later navigation that can reuse its Window.

The existing fallback probe on Chromium 156.0.8078.4 and Firefox 157.0 observes
one initial entry; WebKit 27.2 observes none. The historical issue recorded older
Chromium behavior, so its conclusion must not be presented as today's Chromium
result. [WPT PR #30295](https://github.com/web-platform-tests/wpt/pull/30295) proposes
the no-entry expectation but remains open. Eric approved following HTML/WebKit.

The regressions cover top-level, embedded, and creator-owned initial Documents,
empty buffered observation, and one entry after explicit about:blank navigation
reuses the initial Window and Performance. The old initial Document retains no
entry. This is a documented behavior choice, with no runtime change.

Validation: 104 creation, browsing-context, and delivery cases pass on each of
Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, with and without the addon.
TypeScript/generated declarations, type contracts, changed-file ESLint, import
boundaries, and whitespace checks pass. There are no new failure classifications.
Experimental commit `7e0d0ae` retains the upstream clarification beside the probe.

Performance's Worker exposure is already declared. It becomes observable when Browlet gains
`WorkerGlobalScope`; no second clock or Worker-specific `Performance`
implementation should be introduced then.

## Navigation Timing: entry foundation

The [Navigation Timing draft](https://w3c.github.io/navigation-timing/) at
`48c0048` was refreshed on 5 November 2026. This slice implements the core entry
in §§3.1–3.3.1: the interface, enum, inherited JSON, and live getters. The constructor
reuses the existing input shape (now named `NavigationTimingInit`), accepts prepared public data and the
retained diagnostic implementation, and does not execute §5's Document creation
or buffering algorithm. All init fields are consumed. The automatic-creation
factory now replaces the temporary input record with `navigationTimingEntry`;
no second timing record or scheduler is introduced.

`startTime` is zero; `duration` follows `loadEventEnd`, remaining zero while the
load event runs. Document milestones are already relative to the incoming
Document's time origin and are returned directly. Fetch timestamps are on the
shared clock and use Resource Timing's conversion. A zero selected redirect
count hides both redirect timestamps without changing the retained Fetch record.
The entry captures its Performance navigation ID before any later queueing.

Live Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 agree on the retained
entry, zero start time, unfinished duration during load, final duration equal to
loadEventEnd, interface inheritance, illegal author construction, and the full
URL name including its fragment. All three allocate borrowed `toJSON()` results
in the method's realm and preserve navigation duration through a borrowed
PerformanceEntry getter. The reproducible browser-only probe and findings are
`node-compat/experimental/navigation-timing-entry.mjs` and
`NAVIGATION-TIMING-ENTRY.md`.

- `SPEC_CLASH(navigation-timing-worker-clock)`: the draft's worker overrides
  return Service Workers' shared timestamps without conversion. Convert available
  observations once in the entry's realm, as approved by Eric. Chromium/WebKit's
  controlled-page probes expose small Document-relative times; Firefox reports
  workerStart zero in this probe. A null worker record uses the inherited
  Resource Timing getters; a supplied zero observation remains zero.
- `SPEC_CLASH(navigation-timing-reasons-identity)`: retain the specified diagnostic
  object in the entry's realm, as approved by Eric. Chromium's history-restoration
  probe returns a new non-null object on each read; Firefox/WebKit do not expose
  the API. The source agrees:
  [Blink's getter](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_navigation_timing.cc)
  rebuilds from its DocumentLoader. Binding projects the supplied implementation;
  entry getters do not create diagnostics or re-read current history state.

Remaining dependencies are deliberate:

- **Confidence measurements:** the interface and randomization are implemented
  [below](#navigation-timing-confidence). Host instrumentation remains explicit;
  without a real assessment the getter returns null.
- **Document integration:** controller-backed and fallback creation, response exposure,
  nullable diagnostic allocation, single insertion, and load-time observer
  delivery are connected; Window advertises navigation. Initial about:blank has no
  entry by the approved choice above. Supplied/synthetic responses still need their
  missing timing measurements. History population must supply the incoming target
  entry's diagnostics before activation.
- **Lifecycle measurements:** readiness and the provisional `finishLoading()`
  route already record Document-relative times. Full parser scheduling and unload
  production remain elsewhere. Unload integration must preserve origin/redirect
  privacy and update the record retained by an already-created entry; HTML's
  later assignment to `previousDocumentUnloadTiming` needs attention at that
  handoff. Critical-CH restart measurement still has no producer. Do not synthesize
  these observations in getters.
- **Other contributions:** Server Timing now uses the final navigation response.
  Legacy `performance.timing` and `performance.navigation` are implemented below. Prerender's
  `activationStart` is a separate contribution and requires its own lifecycle.

Validation covers 17 new Navigation Timing cases and 53 existing Resource/Server
Timing cases on all six supported runtimes. All 70 pass in each run. The tests
exercise real binding projection, live records, redirect hiding, zero sentinels,
borrowed getter/JSON realms, diagnostic identity, inherited metrics, and early
navigation-ID capture. The broader Node 26/addon Performance, Document creation,
navigation params, loader, and loading-status run has 272 passes and the one
previously approved MIME-support expected failure. No new failures are classified
or skipped. Generated declarations, TypeScript, type contracts, changed-file ESLint,
and the import audit pass. The Browlet package builds with its seven existing
circular-dependency warnings; ESM, CJS, and declaration artifact checks pass.

## Navigation Timing: legacy PerformanceTiming

Navigation Timing [§8.1](https://w3c.github.io/navigation-timing/#sec-performance-timing)
and §8.3's `performance.timing` attribute are implemented. Performance retains one
Window-owned object. Its getters follow that Window's associated Document, including
initial-Window reuse, without copying Fetch or load records. Shared-clock Fetch
observations and Document-relative milestones convert to epoch milliseconds once;
the combined value is truncated, preserving zero for absent observations.
Connection phases use the legacy fallback chain, and DNS is excluded from the
connection interval. An absent TLS handshake remains zero.

`domLoading` is the only new measurement: §7.5.1 records it after establishing
the new Document's Window association and before initialization callbacks;
later readiness changes retain the first loading observation. The specification
explicitly permits implementation-specific Document creation points here.
The existing HTML load record continues to own the other milestones.
`performance.toJSON()` now includes the retained `timing` object through ordinary
Web IDL default JSON, as all three browser probes do. Borrowed getters use the
receiver; JSON allocates in the called method's realm.

The 2026-11-06 probe used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
Eric approved these choices:

- `SPEC_GAP(legacy-timing-detached)` / `SPEC_CLASH(legacy-timing-detached)`:
  no removal lifetime rule is written. Retain the Document's recorded timestamps,
  like Firefox/WebKit; Chromium's getters return zero after iframe removal.
- `SPEC_CLASH(legacy-timing-unavailable-fetch)`: initial about:blank still has
  no modern navigation entry. Expose its time origin and any recorded Document
  milestones, leaving unavailable Fetch phases zero. Chromium uses zero for
  absent network phases; Firefox/WebKit substitute epoch values, even for TLS
  without a connection. Missing loader measurements remain absent, not estimates.
- `SPEC_CLASH(legacy-timing-redirect-privacy)`: follow §8.1 and Chromium's strict
  same-origin rule for both redirect and unload timestamps. Timing-Allow-Origin
  does not relax this legacy gate. In a page-initiated foreign redirect returning
  to the original origin with TAO on every response, WebKit exposes redirect
  times and Firefox exposes preceding same-origin unload times. The modern
  navigation entry's separately approved exposure rules are unchanged.

Evidence is reproducible in Experimental's `legacy-performance-timing.mjs`.
Source counterparts are Blink `core/timing/performance_timing.cc`, Gecko
`dom/performance/PerformanceTiming.cpp`, and WebKit `page/PerformanceTiming.cpp`.
The current upstream Navigation Timing source is `48c0048` (2026-11-02);
HTML is `5955a33` (2026-11-05), both refreshed before implementation.

**Remaining owners:** HTML's initial about:blank loading milestones, full parser
scheduling, previous-Document unload capture/privacy, and synthetic/supplied-response
measurements still belong to their existing lifecycle/loader dependencies. The
legacy getters do not fill them in. WorkerGlobalScope's common global-API forwarding
remains a §10.3 dependency; the legacy interface and partial member are Window-only.
The following legacy type/count slice completes §8's public surface.

Validation: all 14 new cases pass in each of the six Node 24.19.0, 26.8.1,
and custom 27.0.0-pre stock/addon configurations. The affected 22-file run has
354 cases: 353 passes plus the existing MIME-support expected failure on stock
and custom/addon; official-addon runs also retain the existing `import.meta`
expected failure (352 passes, two expected failures). Matching addons were rebuilt
for all three bases, and all three complete native suites pass. TypeScript,
generated declarations, type contracts, changed-file ESLint, import audit, and
whitespace checks pass. The Browlet build retains its seven existing circular
dependency warnings; ESM, CJS, and platform-declaration artifact checks pass.
No new expected failures or skips were introduced.

## Navigation Timing: legacy PerformanceNavigation

Navigation Timing [§8.2](https://w3c.github.io/navigation-timing/#sec-performance-navigation)
and §8.3's `performance.navigation` attribute are implemented. Performance retains
one Window-owned view of its associated Document. It exposes the four constants,
read-only type/count, and default JSON through the existing bindings. Borrowed
getters use the receiver; JSON allocates in the method's realm. The interface and
partial member are absent from Worker globals.

§7.5.1 initializes `Document.legacyNavigationType` from the supplied navigation
timing type. The legacy field is separate because a fragment can change it while
the modern entry still describes the original load. Redirect counts reuse the
existing navigation entry, gated by the Document's foreign-redirect flag. Initial
about:blank exposes type 0/count 0 without requiring a modern entry; supplied
responses still cannot invent missing redirect history. Initial-Window reuse
retains the legacy object's identity while changing its associated Document.

The 2026-11-06 probe used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
Eric approved these choices:

- `SPEC_CLASH(legacy-navigation-fragment-type)`: ordinary fragment commits reset
  the legacy type to navigate, like Chromium/WebKit; Firefox retains the load
  type. Canceled and intercepted fragments do not reset it. All three browsers
  retain the load type across History state updates, same-document History
  traversal, and intercepted push/reload commits.
- `SPEC_GAP(legacy-navigation-detached)` / `SPEC_CLASH(legacy-navigation-detached)`:
  the specification supplies no removal rule. Retain the Document's values, like
  Firefox and Browlet's legacy timestamp view. Chromium/WebKit reset type/count
  after losing the frame.
- `SPEC_CLASH(legacy-navigation-redirect-count)`: follow the specified strict
  same-origin gate and Chromium/Firefox. Foreign redirect counts remain zero
  despite Timing-Allow-Origin; WebKit exposes TAO-authorized counts. Same-origin
  counts survive `no-referrer` in all three browsers.
- `SPEC_CLASH(legacy-navigation-restored-type)`: a retained Document keeps its
  legacy classification, matching Chromium's verified persisted-pageshow runs.
  Gecko's `nsDOMNavigationTiming::NotifyRestoreStart()` instead changes it to
  back-forward. Firefox/WebKit fetched a new Document in our probe, so those runs
  establish fresh-history-load type 2, not their retained-Document behavior.
  Newly created history Documents receive type 2 in Browlet as well.

Reproduce with Experimental's `legacy-performance-navigation.mjs`; its
`LEGACY-PERFORMANCE-NAVIGATION.md` records the results and bfcache verification.
Source counterparts are [Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_navigation.cc),
[Gecko](https://github.com/mozilla/gecko-dev/blob/master/dom/performance/PerformanceNavigation.cpp),
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/PerformanceNavigation.cpp).
Navigation Timing source `48c0048` was refreshed before this slice.

**Remaining owners:** the earlier timestamp/loader dependencies remain explicit;
this view adds no measurements. The timing detour can now return to HTML §7.5.1
steps 17–20, beginning with Refresh. Full parser/lifecycle measurements, original
transport data for supplied responses, Critical-CH, prerender, soft-navigation
detection, and the confidence host assessment remain with their named owners.

Validation: 18 new cases plus the extended cancellation, interception, and worker
checks pass. The affected 25-file run has 425 cases in each of the six Node
24.19.0, 26.8.1, and custom 27.0.0-pre stock/addon configurations: 424 passes and
the existing MIME-support expected failure. No new failures were classified or
skipped. The matching addons rebuilt for check-in A were reused. TypeScript,
generated declarations, type contracts, changed-file ESLint, import hierarchy,
and whitespace checks pass. The package build retains its seven existing circular
dependency warnings; ESM, CJS, and platform-declaration artifact checks pass.

## Navigation Timing: confidence

The confidence getter in §3.3 and the interface/enum in §§3.3.2–3.3.3 are now
implemented. Before the Document is interactive, the getter returns null without
requesting a measurement or consuming randomness. Afterward it asks
`UserAgent.getUnderlyingNavigationTimingConfidence(entry)` for the unrandomized
assessment. That explicit host-measurement dependency currently returns null.
It must eventually assess **that navigation's interval**, not conditions when an
author happens to read the getter. No startup heuristic or default high/low answer
is introduced. The draft permits transient startup/load/pressure observations
and prohibits static hardware/profile characteristics.

Once an assessment exists, the entry creates and retains one
`PerformanceTimingConfidenceImpl` in its own realm. Browlet uses a fixed 50%
noise trigger: half the time it keeps the assessment, and half the time it
substitutes a fair random high/low answer. Up to two native cryptographic coin tosses
implement that distribution without a configurable random source. The result
is never randomized again, including across JSON calls. Default Web IDL JSON
supplies the two readonly fields and the called method's allocation realm.

Eric approved these continuing draft conflicts:

- `SPEC_CLASH(navigation-confidence-nullability)`: follow the getter's null return
  and Chromium's observable behavior rather than the draft's nonnullable IDL.
- `SPEC_CLASH(navigation-confidence-json)`: apply the default JSON algorithm
  required by the prose, adding the `[Default]` annotation missing from its IDL.
- `SPEC_CLASH(navigation-confidence-lifetime)`: assign the newly created object
  to the retained field that the getter checks but never writes. This honors the
  once-per-entry note. Chromium retains randomized scalar values but creates a
  fresh confidence object on every read; Browlet retains the object too.

The 5 November browser probe confirms Chromium's illegal author constructor,
readonly fields, entry-realm confidence object, method-realm JSON, and stable
randomized values across fresh objects. Its observed trigger rate is 0.4994798.
The result arrives asynchronously after interactive, sometimes after the first
post-load timer; its child frame returns null. Firefox/WebKit do not expose this
API in the tested builds. The reproducible probe remains in Experimental.

Chromium's [navigation request](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/navigation_request.cc)
selects low confidence when browser startup is incomplete. Its
[interactive notification](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/render_frame_host_impl.cc)
randomizes the stored assessment for the primary main frame; the
[randomization helper](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/randomized_confidence_utils.cc)
derives the noise rate from its configured privacy parameter. Browlet has no
equivalent startup signal. These are separate host-policy choices, not a reason
to mark the first top-level load as startup. The [upstream design discussion](https://github.com/w3c/navigation-timing/pull/210)
also confirms the transient-only constraint and entry-realm allocation.
Extractlet captured that discussion with the warning
`[xlet: commit status checks not loaded; load on GitHub]`; the discussion and
source text used here were available.

Automatic controller-backed navigation-entry creation, filtering, buffering,
and observer delivery are now connected. Confidence availability still requires
the explicitly unfinished UserAgent measurement producer.

Validation: 12 confidence cases cover unavailable and delayed assessments,
each randomization branch, retained identity, readonly projection, JSON, and
borrowed getter/method realms. The 82 Navigation/Resource/Server Timing cases
pass on all six supported runtimes. The broader Node 26/addon run passes 284
tests with the existing MIME-support expected failure unchanged. TypeScript,
type contracts, generated declarations, changed-file ESLint, and the import audit
pass. The Browlet build retains its seven existing circular-dependency warnings;
ESM, CJS, and platform-declaration artifact checks pass. No new failure
classifications or skips were introduced.

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
  Navigation Timing also supplies entry creation and load-time observer delivery;
  remaining lifecycle measurements are listed in its integration audit above.
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

`supportedEntryTypes` advertises connected producers: Fetch supplies resource and
controller-backed Document loading supplies navigation for Window. Registry names
alone do not qualify. The internal tests provide completed producer
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
- Producers that expose entries before queueing must capture the ID earlier.
  Navigation Timing now does so; directly constructed User Timing marks and
  other delayed measurements still need their producer integration. Queueing
  preserves captured values.
- Resource Timing's producer, secondary buffer, and buffer-full event are present,
  as is controller-backed Navigation Timing. Window advertises both entry types.
  User/Visibility and other timing producers remain absent. Event Timing admission
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
`resource`, alongside `navigation` for Window. Unfinished producers remain unadvertised.

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
and the remaining Navigation Timing lifecycle measurements remain separate dependencies.

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
- Navigation Timing now initializes metrics from the final response headers
  during Document creation, selecting the destination's secure-context status.
  Trailer delivery remains with Fetch's unfinished transport hook.
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

## Restoration diagnostics handoff

HTML §7.2.8 supplies `NotRestoredReasonsImpl` and recursive creation from history
records in the lower `browsing/navigation/diagnostics/` folder. Navigation Timing's
[entry-creation algorithm](https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry)
creates the diagnostic object with the entry and retains that object;
`PerformanceNavigationTiming.notRestoredReasons` returns the retained value.
It must not re-read the current Document/history entry on every getter call.

History population supplies the target `DocumentState.notRestoredReasons` through
the existing `NavigationParams`, after Fetch redirects and MIME preparation, just
before loading the Document. Only a top-level traversable supplies diagnostics;
child states contain raw collection records and yield null for their own entries.
The Document forwards this nullable input to Performance's creation operation as
an additional final argument. Performance
constructs and retains the public implementation in the new entry's realm before
Early Hints commit or parser callbacks. It never reads the departing entry.

`SPEC_GAP(navigation-timing-history-input)`: [Navigation Timing creation](https://w3c.github.io/navigation-timing/#dfn-create-the-navigation-timing-entry)
reads the incoming Document's diagnostics, but [HTML's accessor](https://html.spec.whatwg.org/multipage/nav-history-apis.html#concept-document-nrr)
requires its node navigable's active entry. During §7.5.1 creation the incoming
Document is still inactive, and the accessor returns null. Neither specification
passes the target history state through this interval. The explicit input closes
that handoff without activating the Document early or adding retained Document
state. Null remains null; the approved retained-object and frozen-array identity
rules are unchanged. Fetch's existing redirect reset replaces the DocumentState
and drops its diagnostics before this handoff, leaving neighboring entries alone.

The extended browser-only `node-compat/experimental/navigation-timing-entry.mjs`
probe on 5 November 2026 confirms Chromium 156.0.8078.4 exposes the history return's
diagnostics already in its first parser script, then through DOMContentLoaded and
load. Firefox 157.0 and WebKit 27.2 do not expose the attribute. Blink's
[`PerformanceNavigationTiming::notRestoredReasons()`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/timing/performance_navigation_timing.cc)
reads its loader/frame's retained diagnostics and excludes child frames; it does
not depend on HTML's incoming-Document accessor. Its fresh-object behavior remains
the separately approved `navigation-timing-reasons-identity` disagreement.

The focused regression first failed with null instead of the incoming record in
the loader callback. Coverage now includes that callback boundary, the departing
Document remaining active, null and child records, owning realms, masked children,
frozen arrays and retained identity, real Fetch delivery, and redirect resets.

Validation: all 109 focused history-population, redirect, and Navigation Timing
creation cases pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and without
the addon, with no expected failures. TypeScript/generated declarations, type
contracts, changed-file ESLint, import boundaries, and whitespace checks pass.
The Browlet package builds with the seven existing circular-import warnings;
ESM, CJS, and platform-declaration artifact checks pass.

Resource Timing entries and generic entry queueing are available. `Document.buildNotRestoredReasonsForDocumentState()`
now collects the unfiltered Document tree, including shadow-tree containers.
`TopLevelTraversable.buildNotRestoredReasons()` completes origin masking and
retains the root's generic `masked` detail for hidden blockers. Unloading/cache
eviction must invoke that builder before destroying the documents whose
diagnostics are needed; raw collected records are not public timing data.
Those lifecycle producers, cache decisions, and the unfinished inline/error-page
loaders remain explicit dependencies. The new handoff covers the shared response
Document factory and does not implement those producers.

`SPEC_GAP(navigation-timing-null-reasons)`: the refreshed Navigation Timing source
at `48c0048` (refreshed 4 November 2026) invokes HTML's creation operation with nullable Document diagnostics,
although that operation requires a non-null backing record and a realm. It
does not describe the null case or pass that realm. Retain null when there is
no record, matching Chromium's ordinary-navigation result; otherwise allocate
in the new entry's realm. Firefox/WebKit do not expose the attribute. The
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
| `timeline.ts`, `observer.ts`, `observer-entry-list.ts` | Entries, buffers, queries, queueing, and observer delivery present; resource and navigation producers are connected | Performance Timeline |
| `navigation.ts`, `confidence.ts` | Controller-backed and fallback entry creation/exposure/buffering/delivery, target-history diagnostic handoff, and confidence calculation present; missing producer/unload measurements, diagnostic lifecycle callers, and host measurements remain | Navigation Timing and HTML §3.1.5 |
| `resource.ts`, `performance.ts` | Entries, buffers, overflow delivery, and Fetch production/exposure handoff present | Resource Timing and Fetch |
| `server.ts` | Header parsing and retained metrics on resource and navigation entries present; trailers remain | Server Timing |
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
   Navigation-entry initialization is connected; trailer delivery remains explicit.
4. Connect Navigation Timing to actual loader/navigation/unload records when
   those lifecycles exist; do not manufacture missing lifecycle timestamps.
   Controller-backed and fallback creation retain the entry, response data, live
   milestones, and destination exposure. Load-event observer delivery is connected.
   Initial about:blank deliberately has no entry. Missing supplied/synthetic timing and the remaining
   lifecycle producers stay explicit.

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
are present. Navigation Timing's entry/getter foundation and confidence calculation
are present, as are controller-backed/fallback creation, buffering, and load-event
observer delivery. Legacy `performance.timing` and `performance.navigation` are
present; the remaining lifecycle inputs are tracked above. Initial about:blank
intentionally has no modern entry. The confidence host
measurement policy remains an explicit dependency, returning null until available.

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
