# Navigation API roadmap

This component owns Window's Navigation and its realm-owned entry objects.
The higher [navigation coordinator](../navigation/ROADMAP.md) owns the underlying
session-history records, navigation, and traversal. Window owns Navigation's
lifetime; replacing the author-facing `window.navigation` property does not
replace that implementation.

## First slice: entries and read access

Audited HTML `404b3eb` (30 October 2026), on 31 October. This slice implements
[core infrastructure](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-core),
the first algorithm in §7.2.6.4 (initialization for a new Document),
[NavigationHistoryEntry](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationhistoryentry),
and the read-only entry-list operations from §7.2.6.6. It does not complete
§7.2.6.4 or §7.2.6.6.

- Navigation owns an initially empty entry list and current index -1. Entries
  and events are disabled for inactive, initial about:blank, or opaque-origin
  Documents. The relevant global supplies the current associated Document.
- `entries()` returns a fresh Web IDL sequence containing stable entry platform
  objects; `currentEntry`, `canGoBack`, and `canGoForward` read that same list.
- Each entry retains one session-history record. Its URL, key, ID, index,
  same-Document predicate, and freshly deserialized state follow §7.2.6.5.
  An inactive entry exposes empty strings, -1, false, and undefined as specified.
  Another Document's URL is hidden for stored request referrer policies
  `no-referrer` and `origin`, including when that Document has been evicted.
- Session-history records now own independent random UUID keys/IDs and
  Navigation API state, initially storage-serialized undefined. This is separate
  from classic `history.state`, whose stored serialization/restoration remains
  unfinished. The existing replacement commit carries the old position key;
  the replacement has a new ID. Reload/session-restore preservation needs those
  later algorithms.
- Navigable can find its own retained list, including nested histories, and
  select the contiguous same-origin range around the greatest history step at
  or before the target. This is not a flattening of joint history. Same-origin
  comparison does not honor `document.domain` relaxation.
- The existing synchronous top-level commit initializes the new Document's
  Navigation after activation and before Browlet's parser scripts run. Initial
  Window reuse is safe because initial about:blank has no exposed entries.
  The full traversal queue and child-history producers remain absent.
- Navigation's four event-handler attributes and entry `ondispose` use the
  existing EventHandlerMap. This first slice supplied author dispatch; the next
  slice below adds state-change and reactivation-disposal producers.

### Decisions and browser evidence

`SPEC_CLASH(navigation-entry-zero)`: the
[session-history selection algorithm](https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-session-history-entries-for-the-navigation-api)
scans backward with `i > 0`, excluding the first entry. Its contiguous-entry
description and §7.2.6.6 require including it. Chromium 156.0.8078.4, Firefox
157.0, and WebKit 27.2 all expose both `/first` and `/second` after two same-origin
cross-document loads. Gecko's `nsSHistory::WalkContiguousEntries()` explicitly
uses `i >= 0`. Eric approved including index zero; the source retains the marker.

`SPEC_GAP(navigation-entry-state-realm)`: `getState()` calls
[StructuredDeserialize](https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize)
without its required target realm. All three tested browsers allocate in the
called method's realm: a parent's borrowed method applied to a child's entry
returns parent-realm objects, while the child's own method returns child-realm
objects. Eric approved this behavior. Binding supplies the method environment
to the implementation; activity still depends on the receiver's Document.
No new native or caller-realm machinery is needed.

The browser-only reproduction is `node-compat/experimental/navigation-entries.mjs`
in the independent experimental repository. It also confirms inactive-entry
sentinels after iframe removal and stable keys/IDs for earlier entries.
Browlet regressions remain enabled in `test/browlet/browsing/navigation-entries.test.ts`.

Validation: 23 new tests. The seven affected History/Navigation/lifecycle suites
contain 140 cases: official addon runs pass all 140, and each stock runtime has
137 passes plus the three existing native-global expected failures. Custom/addon
coverage is included in the full unit run: 606 files, 17,693 passes, 22 existing
expected failures, 18 skips, and one TODO. The first full run alongside the matrix
had three timeouts; those suites and the separate full rerun passed unchanged.
Type checks, generated declarations, touched-file ESLint, import rules, and diff
whitespace checks pass.

## Second slice: state changes and reactivation

Audited the same HTML revision on 31 October 2026. This slice completes
[`updateCurrentEntry()`](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigation-updatecurrententry)
from §7.2.6.6, brings in its
[`NavigationCurrentEntryChangeEvent`](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationcurrententrychangeevent)
dependency (§7.2.7.1), and implements the
[reactivation entry update](https://html.spec.whatwg.org/multipage/nav-history-apis.html#update-the-navigation-api-entries-for-reactivation)
from §7.2.6.4.

- `updateCurrentEntry()` checks for a current entry, storage-serializes state,
  stores it on that captured entry, and synchronously fires a trusted
  `currententrychange` with null `navigationType`. It leaves URL, entry identity,
  and classic History state unchanged. Required-dictionary conversion, receiver
  checks, and exception realization remain ordinary Web IDL binding work.
- Author state getters can replace the current entry or recursively update its
  state. HTML retains the entry captured before serialization; the outer update
  and event use that entry even if it is no longer current. There is no second
  activity or current-entry check. A serialization failure leaves state unchanged
  and sends no event. The event belongs to the receiver's environment; borrowing
  another Window's method changes the realm of a new thrown exception.
- Reactivation matches session-history record identity, preserves matching
  NavigationHistoryEntry objects, creates newly visible ones, and updates the
  list and index immediately. Removed entries receive trusted `dispose` events
  in old-list order from a queued navigation-and-traversal task. This uses the
  existing HTML task source through `env.queueTask()`; no new event loop is added.
- The §7.4.6 history-reactivation/bfcache caller remains absent. It must supply
  the same-origin session-history list and update Navigation before firing
  `pageshow`; disposal runs afterward. Tests supply that caller's inputs and
  `pageshow` explicitly and verify real task-source and inactive-Document gating.
  They do not demonstrate an implemented bfcache or traversal pipeline.
- Same-document entry changes remain explicitly blocked before mutation in
  `updateEntriesForSameDocumentNavigation()`. The complete operation also needs
  the ongoing method tracker's committed notification before author callbacks,
  captured ongoing event/tracker state, current-entry-change followed by disposal,
  intercept commit handlers, and script preparation/cleanup to prevent intervening
  microtask checkpoints. Existing execution facilities cover the last dependency;
  the third slice below supplies tracker settlement, while NavigateEvent state
  and the same-document integration remain missing.

### Browser evidence and teardown dependency

The browser-only `node-compat/experimental/navigation-updates.mjs` probe covers
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on trusted
event defaults, required-state conversion (including rejecting explicit
undefined), captured-entry behavior when a state getter calls `replaceState()`,
and checking an already inactive Navigation before reading serialized data.

Removing an iframe from a state getter is a separate lifecycle case. Firefox and
WebKit return normally without notifying listeners; they also suppress manual
`dispatchEvent()` on the retained Navigation afterward, including a newly added
parent-realm listener. Gecko's `DOMEventTargetHelper::DisconnectFromOwner()`
disconnects its listener manager during global teardown. Chromium's renderer
crashed twice in the same probe; that is observed failure evidence, not a rule
to emulate. The current algorithm follows HTML's captured-entry sequence without
inventing a post-serialization exception. Document/child-navigable destruction
and Navigation EventTarget teardown still need a lifecycle audit and integration;
the present browser evidence does not establish a special updateCurrentEntry guard.
See HTML's [Document destruction](https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document)
and the navigation coordinator's existing destruction dependencies. Retaining an
inactive Document in a unit fixture is not equivalent to destroying its global.

Validation: 25 new tests pass on all six runtime configurations. The 11 affected
Navigation/History/lifecycle/EventTarget/task suites contain 204 cases per
configuration, with the three existing native-global expected failures retained
on stock runtimes. Generated declarations, type contracts, TypeScript, touched-file
ESLint, import rules, and diff whitespace checks pass.

## Third slice: navigate/reload preparation and method trackers

Audited HTML `404b3eb` on 31 October 2026. This slice covers `navigate()` and
`reload()` in [§7.2.6.7](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-initiating-navigations),
their result helpers, and the method-tracker setup, commit, finish, rejection, and
cleanup operations from §7.2.6.8. Traversal methods and ongoing NavigateEvent
abortion remain later slices.

- The new IDL includes NavigationOptions, NavigationNavigateOptions,
  NavigationReloadOptions, NavigationResult, and NavigationHistoryBehavior.
  Binding owns URL/dictionary conversion and synchronous conversion errors.
  Implementation methods return two distinct typed promises for algorithm errors;
  a thrown state getter retains its original exception identity.
- `navigate()` parses against the receiver's API base in UTF-8, rejects invalid
  and JavaScript URLs, checks the forced-replacement rule for explicit `push`,
  serializes state, and then checks activity and unloading. The new Document
  predicate implements the complete forced-replacement rule: JavaScript URLs or
  initial about:blank. Incomplete loading and identical URLs are later navigation
  history-handling decisions, not additions to this predicate.
- `reload()` preserves the current entry's stored state when the state member is
  absent or undefined; otherwise it storage-serializes the supplied value. Both
  methods retain `info` unchanged and pass the same serialized state and tracker
  into the owning Navigable operation. The associated Document supplies the source;
  Location's cross-origin source attribution is not reused here.
- The former opaque tracker brand has moved from the navigation coordinator to
  `method-tracker.ts` as a concrete internal class. It retains the specified
  Navigation/key/info/state/entry/pending fields and two typed InternalPromises,
  with their resolving functions held privately. It is not a platform interface.
  Creation uses the existing binding-aware `env.InternalPromise`; no new promise
  or native machinery is introduced. `finished` is marked handled immediately;
  early-error result promises are deliberately not marked handled.
- Commit notification installs state before resolving `committed`; traversal's
  null serialized-state field leaves existing state untouched. The optional
  serialized-state retention is cleared after installation. Completion resolves
  with the captured committed entry, even if the current entry has since changed.
  Rejection attempts both promises, leaving an already fulfilled `committed`
  intact. Cleanup clears the ongoing tracker or removes its upcoming traversal key.
- Navigation owns the ongoing tracker and ordered upcoming-traversal map.
  Navigate/reload setup starts pending unless entries/events are disabled;
  disabled trackers intentionally retain unsettled promises. Upcoming traversal
  setup starts non-pending. A request still pending after the Navigable handoff
  produces fresh AbortError results, as specified.

### Approved browser differences

`node-compat/experimental/navigation-initiation.mjs` probes Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. Eric approved the following choices; each has a
source-side marker.

- `SPEC_CLASH(navigation-result-realms)`: with a borrowed method, HTML allocates
  early-error promises in the method realm and tracker promises in the receiver
  realm. Firefox matches these tested cases. Chromium uses the receiver realm
  for both kinds of promises; WebKit uses the method realm for both. Browlet
  follows HTML for promises and new exceptions, preserving existing thrown objects.
  Chromium's SyntaxError is receiver-owned, but its DataCloneError is method-owned.
  Result dictionaries keep Binding's existing receiver allocation, matching
  Chromium/WebKit; Firefox allocates the dictionary in the method realm.
- `SPEC_CLASH(navigation-initial-push-order)`: HTML, Firefox, and WebKit reject an
  initial-about:blank `push` before reading serialized data. Blink's
  `NavigationApi::navigate()` serializes before its initial-empty-document branch.
  Browlet follows HTML's ordering.
- `SPEC_CLASH(navigation-inactive-serialization)`: HTML and Chromium serialize
  before rejecting an inactive Document with InvalidStateError. For a destroyed
  iframe in the probe, Firefox returns an empty result dictionary without reading
  state; it does not return fulfilled promises. Gecko's early-error helper can
  return without filling the result when no current global exists. WebKit's
  `Navigation::serializeState()` rejects a missing frame with DataCloneError before
  reading state. Browlet follows the written order; destruction integration remains
  the separate lifecycle dependency recorded above.

### Remaining producers and specification gap

Valid requests still throw at `Navigable.navigate()` or `reload()` because those
owners are explicitly unfinished. Tests control that boundary to exercise real
conversion, promises, state, and realm ownership; they do not establish successful
document-initiated navigation or reload. Full navigation must supply:

- Navigate-event acceptance: clear pending, register the ongoing tracker, preserve
  upcoming traversal identity, and invoke commit/finish/reject at the specified
  points. Same-document entry commits remain blocked until event/intercept handling
  and script batching are present. Transition, focus/scroll flags, and abort-event
  propagation are still absent.
- Actual fetching, cancellation, navigation/traversal queues, history commits, and
  unload/reload effects. Cross-document loads, non-navigating 204/205 responses,
  attachment downloads, and non-intercepted reloads must leave the original method
  promises unsettled; implementing the tracker does not supply those branches.
- The new Document `unloadCounter` check has no automatic producer yet. The
  beforeunload/unload algorithms must increment and decrement it around their
  callbacks. Tests set the counter directly to verify the consumer.

`SPEC_GAP(navigation-null-tracker-result)`: HTML declares the tracker-derived
result helper's input nullable but supplies only tracker field dereferences.
All specified callers in this slice provide a real tracker. Browlet retains the
nullable signature and throws an InternalError for null instead of inventing an
author-visible result. Revisit if a future caller legitimately supplies null.

Validation: all 29 new tests pass across Node 24.19.0, Node 26.8.1, and custom
Node, with and without the addon. The 12 affected suites contain 233 cases per
configuration: all pass with the addon, while stock retains the three existing
native-global expected failures. Direct implementation fixtures explicitly drain
their Window's microtask queue; author-facing early-error tests run through
`Browlet.evaluate()`. Generated declarations, type contracts, TypeScript,
touched-file ESLint, import rules, and diff whitespace checks pass.

## Fourth slice: traversal method preparation

Audited HTML `404b3eb` on 31 October 2026. This completes the method preparation
in [§7.2.6.7](https://html.spec.whatwg.org/multipage/nav-history-apis.html#performing-a-navigation-api-traversal):
`traverseTo()`, `back()`, `forward()`, and their shared traversal algorithm.
History movement remains blocked at its explicitly unfinished owners.

- Binding converts the DOMString key and optional NavigationOptions before
  implementation selection. The methods use the retained entry index and
  session-history keys, not author overrides of `entries()` or `traverseTo()`.
  Missing keys, unavailable directions, inactive Documents, and unloading reject
  both result promises with the specified InvalidStateError.
- Traversal to the current key returns two distinct fulfilled promises containing
  the receiver's current entry, without an event, snapshot, or tracker. This
  branch precedes pending-request lookup. A duplicate upcoming key instead reuses
  that tracker's promises and original `info`; later dictionary getters still run,
  and every invocation returns a fresh result dictionary. Info is not serialized.
- `SourceSnapshotParams` in `navigation/source-snapshot.ts` captures the source
  Document's activation, active sandbox set, download permission, Fetch client,
  and cloned policy container. Its nullable Document input also supplies the
  unrestricted browser-UI case. This navigation-owned foundation is shared by
  the Navigation API and navigation coordinator without loading either consumer.
  Policy copying uses the existing container's clone.
- The prepared traversal callback reads the navigable's current history list
  when executed, rather than retaining a target entry selected before queueing.
  A missing or already-active destination queues InvalidStateError. Otherwise it
  supplies the committed target step, captured source, initiating navigable, and
  `none` involvement to history application. Beforeunload cancellation queues
  AbortError; disallowed initiators queue SecurityError. These failures use the
  receiver's navigation-and-traversal task source and realm, then clean up the
  tracker. Navigate-event cancellation and successful application retain their
  own event/commit/finish responsibilities; this callback does not settle them.
- If an unfinished snapshot/queue owner throws before accepting the work, the
  newly registered tracker is removed before propagating that internal failure.
  Regression tests first observed an unreachable pending request otherwise.

### Browser evidence and delayed failures

The browser-only `node-compat/experimental/navigation-traversal.mjs` probe covers
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on no event
for the current entry, distinct committed/finished promises, fresh dictionaries
for duplicate requests, reuse of both pending promises, and retention of the first
info value after converting subsequent options.

The existing `SPEC_CLASH(navigation-result-realms)` also covers the no-op branch:
HTML's ordinary resolved promises use the method realm, as WebKit does; Chromium
and Firefox use the receiver realm. Browlet keeps the approved HTML promise-realm
rule. Early errors and tracked traversals have the same realm differences recorded
in the previous slice. Dictionaries retain Binding's receiver allocation.

`SPEC_CLASH(navigation-delayed-traversal-rejection)` records Eric's approved guard
against obsolete queued failures. [HTML issue #12176](https://github.com/whatwg/html/issues/12176)
and [proposed correction #12177](https://github.com/whatwg/html/pull/12177) remain
open. Gecko's traversal completion callback checks whether its tracker has already
been handled. Directly following HTML reproduced a stronger failure in Browlet:
a delayed rejection cleaned up a newer tracker under the old key. All four queued
failure paths retain regressions. At task execution, Browlet now requires the
exact tracker to remain ongoing or registered under its key. Mere key presence
is insufficient. This protects cleanup; it does not implement traversal cancellation.

### Unfinished execution owners

Ordinary requests to a different entry currently stop at Window's explicit
`hasTransientActivation()` dependency (§6.4). Capture is implemented, but activation
timestamps, expiry, notification, and consumption are not. Once that input exists,
`Traversable.appendSessionHistoryTraversalSteps()` still throws: the §7.3.2 parallel
queue, algorithm set, draining, and synchronous-navigation queue jumping are absent.
`Traversable.applyTraverseHistoryStep()` separately declares all inputs and all four
outcomes but throws until §7.4.6 supplies permission/cancellation checks, Document
restoration, history application, and event/tracker notifications. The existing
SessionHistoryTraversalQueue remains an identity placeholder. Tests control these
three owner boundaries and execute the prepared callback; they do not establish
working traversal. Source snapshots still need their later navigation, delta
traversal, and closing consumers. Child destruction and ongoing-navigation abortion
must eventually settle outstanding traversal trackers under §7.2.6.8.

Validation: all 38 new tests pass on Node 24.19.0, Node 26.8.1, and custom Node,
with and without the addon. The 14 affected suites contain 271 cases per runtime:
all pass with the addon; stock retains the same three native-global expected
failures. TypeScript, generated declarations, type contracts, touched-file ESLint,
import rules, and whitespace checks pass.

## Fifth slice: transition and destination objects

Audited HTML `404b3eb` on 31 October 2026, matching the live standard's
30 October update. This slice implements the transition surface in
[§7.2.6.8](https://html.spec.whatwg.org/multipage/nav-history-apis.html#ongoing-navigation-tracking)
and its required
[NavigationDestination dependency (§7.2.6.10.3)](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigationdestination-interface).
It stops before ongoing-event cancellation and automatic transition production.

- `Navigation.transition` initially returns null and has no activity check.
  NavigationTransition retains the navigation type, original from-entry, shared
  destination, and distinct committed/finished promises. Its full Window-exposed,
  nonconstructible interface is declared, including `to` and `committed`.
- Both transition promises belong to the owning environment and are marked
  handled when created. They settle with undefined, independently of method
  trackers' entry-valued promises. Rejecting after commit preserves the fulfilled
  committed promise. Settlement methods do not fire events or clear Navigation's
  transition; those operations belong to the event algorithms and their ordering.
- NavigationDestination owns URL, optional traversal entry, serialized state,
  and the original same-document classification. Its getters use that retained
  state. Key/ID/index delegate to the entry's implementation algorithms, including
  their activity checks and live index lookup; author shadows cannot replace them.
  A null entry exposes empty key/ID and index -1. Destination URL and state remain
  readable after the source Document becomes inactive. Each state read deserializes
  a fresh graph. Later entry-state changes do not change the captured state.
- Destination URL/state remain writable by the precommit controller implemented below.
  Interception must not rewrite the original same-document classification.
  Implementations retain their existing owning environment; projection, getter
  brand checks, and promise-valued getter rejection remain ordinary Binding work.

### Browser evidence

`node-compat/experimental/navigation-transition.mjs` compares Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three retain the same promises
in the transition's realm when getters are borrowed, fulfill them with undefined,
and clear the active transition after success. They also deserialize destination
state into the called method's realm, return fresh values, and retain that state
after iframe removal.

`SPEC_GAP(navigation-destination-state-realm)`: like NavigationHistoryEntry,
HTML omits StructuredDeserialize's required target realm. Browlet applies the
existing method-realm rule, confirmed in all three browsers for this interface.
`SPEC_CLASH(navigation-transition-destination)`: HTML, Chromium, and WebKit expose
`NavigationTransition.to`; Firefox's tested interface omits it. Browlet implements
the specified member. The probe separately captures the event's destination so
that Firefox's missing member does not conceal its destination behavior.

### Remaining ongoing-navigation dependencies

| Requirement | Current owner and missing connection |
| --- | --- |
| Transition creation | §7.2.6.10.4 inner event firing must create it only after event dispatch when interception state is not `none`, retaining the current entry and the event's exact destination. No production caller exists yet. |
| Transition commit and completion | `commit a NavigateEvent` must resolve committed after entry/URL mutation. Handler completion must fire navigatesuccess before resolving finished and clearing the active transition. The retained object's settlement operations are implemented; these producers and their ordering are not. |
| Ongoing event and focus/scroll state | Added in the sixth slice, with initial values and cancellation resets. Event firing must install the event/initialize state; focusing steps must update the focus flag; interception and history application must consume the scroll flag. |
| Abort the ongoing navigation / abort a NavigateEvent | Implemented in the sixth slice below. Event, loading, and traversal producers still need to invoke them. Error extraction still lacks source-location diagnostics as recorded in the scripting roadmap. |
| Inform the API about aborting navigation | Implemented in the seventh slice: the caller supplies its event loop (or null for parallel work); the active Window's loop runs the notification immediately or receives a navigation-and-traversal task. The notification repeatedly aborts because callbacks can start another navigation. Production callers remain unconnected below. |
| Child navigable destruction | The seventh slice supplies the notification: inform about abortion, then snapshot upcoming traversal values and reject each with a fresh owner-realm AbortError. Actual child destruction does not yet invoke it. |
| Destination creation and updates | Event firing must supply traversal entry/state or null-entry serialized state, URL, and original document classification. The precommit controller now updates this same object; its creation/delivery by event firing remains unfinished. |

Tests supply transition/destination values at the unfinished event-producer
boundary, then exercise the real projected interfaces. They do not demonstrate
working interception, automatic cancellation, or history movement.

Validation: all 17 new tests and all 135 cases across the eight affected
Navigation suites pass on Node 24.19.0, Node 26.8.1, and custom Node, both stock
and with the addon. No expected failures are needed in these suites. Generated
declarations, TypeScript, type contracts, touched-file ESLint, import rules,
and diff whitespace checks pass.

## Sixth slice: ongoing-event state and cancellation

Audited HTML `404b3eb`, matching the live 30 October 2026 standard. Implements
[abort the ongoing navigation and abort a NavigateEvent](https://html.spec.whatwg.org/multipage/nav-history-apis.html#abort-the-ongoing-navigation)
from §7.2.6.8, with the concrete event data required from §7.2.6.10.1.

- Navigation retains its ongoing event and the focus-changed and
  suppress-normal-scroll-restoration flags. Aborting the ongoing navigation resets
  both flags, creates one owner-realm AbortError if none is supplied, and sets the
  event's canceled flag while dispatching, even for a noncancelable event.
- NavigateEvent owns its environment and has the specified constructor,
  NavigateEventInit dictionary, and all eleven readonly attributes. Required
  destination/signal and nullable FormData/Element inputs cross normal Web IDL
  conversion; their implementations remain internal. Author construction retains
  the supplied signal and leaves the internal controller null. Trusted event
  production must supply its own controller and that controller's matching signal.
- Event allocation already uses registered Binding construction dependencies.
  `EventImplConstructor` now describes an Event-producing class without requiring
  every subclass to share EventImpl's timestamp parameter. NavigateEvent receives
  its owning environment through the existing constructor declaration.
- Aborting the event clears the ongoing event, rejects/cleans its original method
  tracker, signals its controller, extracts error details, and fires a trusted
  `navigateerror` ErrorEvent. It then rejects the captured transition and clears
  it only if it is still current. Already-fulfilled commit promises stay fulfilled.
  No API tracker or intercepted transition is required to deliver the error event.
  Supplied JavaScript rejection values retain identity; an undefined reason stays
  undefined in the results/error event while DOM supplies the signal's default
  AbortError. Existing error diagnostics still default filename/line/column.

### Reentrancy choice and browser evidence

`SPEC_GAP(navigation-abort-tracker-name)`: HTML checks the ongoing tracker but then
refers to an unbound `apiMethodTracker`. Browlet interprets that as the tracker
belonging to the navigation being aborted.

`SPEC_CLASH(navigation-abort-reentrancy)`: HTML reads that tracker after signaling
abort and extracting diagnostics, and reads the transition after firing
`navigateerror`. Each step can invoke author code which starts another navigation.
A literal implementation rejected or cleared the replacement in all three focused
Browlet regressions: abort listener, navigateerror listener, and reason-to-string
conversion. Eric approved preserving the original navigation's cleanup: reject
the original tracker before callbacks (as Gecko does), capture the original
transition, and leave a replacement transition/event/tracker alone. No change to
the tracker's cleanup contract or new event-loop mechanism is needed.

`node-compat/experimental/navigation-abort.mjs` probes an intercepted navigation
whose handler rejects, then starts another intercepted navigation from either
notification. Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 all abort the
signal before firing navigateerror, use the same rejection reason, and reject the
original transition when there is no reentry. With reentry:

| Callback starting the new navigation | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| `navigateerror` listener | Original transition remains pending; replacement transition rejects despite its successful navigation | Same | Same |
| AbortSignal listener | Renderer crashes in the tested build | Original transition remains pending; replacement transition rejects despite successful navigation | Two error events; replacement method's finished promise remains pending and its transition rejects |

Source inspection supports the ordering differences: Blink's
[`NavigateEvent::Abort`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/navigation_api/navigate_event.cc)
signals before clearing the ongoing event and calling `NavigationApi::DidAbort`;
Gecko's [`Navigation::AbortNavigateEvent`](https://searchfox.org/mozilla-central/source/dom/navigation/Navigation.cpp)
rejects the tracker before signaling; WebKit's
[`Navigation::abortOngoingNavigation`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Navigation.cpp)
signals, clears the event, fires navigateerror, then rejects the tracker. All
three look up the transition after author callbacks. The probe records failures
against the chosen cleanup rule; it is not acceptance coverage for Browlet's
unfinished interception producer.

### Explicit stopping point

- This foundation initially stopped before `intercept()` and `scroll()`.
  The interception slice below now supplies their validation, options/callbacks,
  state, and handler registration. The subsequent controller slice supplies its
  operations. Commit, finish, actual scrolling/focus, and controller delivery
  remain explicit dependencies.
- §7.2.6.8's Navigable notification entry points are supplied by the seventh slice
  below. Neither path is connected to actual navigable destruction, stop, or
  navigation supersession yet.
- Event firing must initialize the controller/signal, flags, tracker, and
  transition, then consume event cancellation. Stop/loading, history, traversal,
  and navigation supersession must call the cancellation algorithms. Focusing and
  history application still supply/consume the focus/scroll state. No end-to-end
  interception, stop, destruction, or navigation cancellation is claimed here.

Tests exercise real event construction/dispatch, interface projection, and promise
settlement, supplying only the unfinished navigate-event producer's state. The
reentrancy cases failed before the cleanup change and remain ordinary regressions.

Validation: all 13 new tests and all 196 cases across the nine Navigation and
three affected Event/Abort suites pass on Node 24.19.0, Node 26.8.1, and custom
Node, both stock and with the addon. No expected failures are needed. Generated
declarations, TypeScript, type contracts, touched-file ESLint, import rules, and
diff whitespace checks pass. The separate browser probe exits nonzero for the
documented browser divergences and Chromium renderer crash.

## Seventh slice: Navigable abortion and child-destruction notifications

Audited HTML `404b3eb`, matching the live 30 October 2026 standard. Completes
the two remaining notification algorithms in
[§7.2.6.8](https://html.spec.whatwg.org/multipage/nav-history-apis.html#inform-the-navigation-api-about-aborting-navigation).

`Navigable.informNavigationAPIAboutAbortingNavigation()` compares the explicitly
supplied caller event loop with the active Window's owning loop. On that loop it
runs synchronously; otherwise it queues a global task on the navigation-and-traversal
source, associated with that Window's Document. The queued steps select the
navigable's active Window and Navigation when they run. They then keep that
Navigation while repeatedly aborting its ongoing event until none remains.
The existing global-task machinery retains Document activity gating.

Both notification methods have a pending `SPEC_MISMATCH`: HTML takes only a
navigable; the instance methods additionally require `callerEventLoop: EventLoop | null`.
Null denotes parallel work. This is the caller's execution site, not necessarily
the destination's environment. Callers must supply that fact from their own
algorithm entry. Inferring it from `currentlyRunningTask` would lose synchronous
notification after a checkpoint clears the task, and inspecting a destination
loop's stack cannot establish which loop the caller is currently executing on.
No ambient current-loop registry or change to script-entry tracking is introduced.

`informNavigationAPIAboutChildNavigableDestruction()` first invokes that abortion
notification, then selects the active Window's Navigation, snapshots its upcoming
traversal tracker values, and rejects each tracker with a distinct AbortError
allocated in that Navigation's realm. A tracker's committed/finished results share
that error. The snapshot happens after synchronous abortion callbacks, including
requests they have added or completed. HTML queues only the ongoing-event
notification for an off-loop caller; the pending traversal rejection remains in
the current call. This implementation preserves that ordering.

The repetition is deliberate: [WHATWG HTML #11579](https://github.com/whatwg/html/issues/11579)
consolidated the loop so all abortion callers handle navigations begun by author
callbacks. Gecko's `Navigation::InnerInformAboutAbortingNavigation` and WebKit's
`Navigation::abortOngoingNavigationIfNeeded` both use it. The previous slice's
per-event cleanup protects a replacement long enough for this enclosing loop to
abort that replacement separately, with its own signal/error and promise rejection.

### Browser call paths and execution ownership

Source inspection on 1 November 2026 used the local Blink `1136757f47` (3 July),
Gecko `d92a7ec0e622` (2 July), and WebKit `713192fa` (26 August) snapshots. These
are implementation evidence, not a new live-browser timing comparison.

- [Gecko's docshell entry point](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/docshell/base/nsDocShell.cpp#L13232)
  takes no loop argument. It obtains the active Window's Navigation, enters its
  JS global, and calls `InnerInformAboutAbortingNavigation(JSContext*)`.
  Its comment explicitly leaves HTML's step 1 unexplained/unimplemented; it does
  not derive a current loop from Document state. Callers include the ongoing
  navigation setter, docshell destruction, and `Document::Open`. Navigate-event
  firing also calls Navigation's inner helper directly.
- [WebKit's Navigation helpers](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Navigation.cpp#L1617)
  take no loop argument. `FrameLoader::stopLoading`, `stopForUserCancel`, and
  `frameDetached` reach them through the frame's Document and Window. Event
  dispatch calls the abort helper directly. Document's `isContextThread()` is
  the main-thread check; these helpers contain no per-Navigable caller-loop state.
- [Blink's cancellation helper](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigation_api.cc#962)
  takes a cancellation reason, not a loop. FrameLoader's stop, cancellation, and
  beforeunload-failure paths call it through the Window. It also rejects pending
  traversals when the frame is detached. Browser-originated `StopLoading` reaches
  FrameLoader through LocalFrameMojoHandler, whose receiver is bound to the
  frame's task runner. Realm selection uses the retained Window's ScriptState.

Browlet already has the destination loop through
`navigable.activeDocument.env.responsibleEventLoop` (and through the active
Window's environment, as this implementation uses). The document state passed
to Navigable's constructor is only the initial history entry; use the active
document after navigation. That ownership path does not identify where a call is
executing. In particular, iframe removal executes in the container Document,
which can belong to another Agent than the child Document being notified.
Clearing `contentNavigable` also removes the child's container backlink before
notification. The removing element still knows its node Document, however, so
the caller can use that environment to establish the handoff. Losing the child's
backlink does not demonstrate that the notification method needs a parameter.

The browser-style alternative is to establish owner-loop execution at the
navigation/frame scheduling boundary and expose a no-argument local notification
helper. That requires auditing the real callers' synchronous versus queued
handoffs; substituting the destination's own loop as the caller would always pick
the synchronous branch. The explicit caller parameter remains provisional.
No current-loop field is added to Navigable or Document.

### Deferred decision: caller-loop parameter

`TODO(navigation-abort-caller-loop)`: on 1 November, Eric and Ged deferred the
signature decision until production callers can demonstrate the required
handoffs. The current parameter is a tested implementation, not a proven
necessity or an accepted permanent API. Keep its `SPEC_MISMATCH` markers pending.

Reopen this decision when connecting the first production caller below. Trace
the caller's existing Document/environment and scheduling boundary before
propagating another loop argument. In particular, evaluate routing iframe
removal through the container's owning Document and invoking a no-argument
notification helper after any required handoff.

Keep the current behavioral assertions as a baseline, then exercise real callers
for synchronous notification, another Agent's child removal, and any actual
parallel entry. Preserve event/promise ordering, task Document association and
activity gating, reentrant cancellation, and the child notification's ordering
between ongoing abortion and pending-traversal rejection. The present tests
supply execution information directly; they do not prove that callers must pass
it as an argument. Compare a parameter-free arrangement against the same
observable requirements before removing the parameter. If it remains necessary,
identify the concrete caller that cannot establish the handoff through existing
ownership. Resolve the markers with Eric after that comparison.

### Remaining production callers

| Caller | Missing work and required handoff |
| --- | --- |
| Push/replace/reload navigate-event firing (§7.2.6.10.4) | The existing explicit stub must notify before accepting a new event/tracker and before checking disabled entries/events. History push/replace already reaches that stub. Navigation/Location, fragment navigation, reload, and other navigation producers must establish execution on the affected Window before event firing. |
| [Download the hyperlink](https://html.spec.whatwg.org/multipage/links.html#downloading-hyperlinks) (§4.6.5) | For a non-browser-UI request that proceeds after its download navigate event, notify the subject element's node navigable before the parallel download work. Its node Document supplies the local environment. Hyperlink activation/download and download-event production remain unfinished. |
| Child navigable destruction (§7.3.3) | Iframe/legacy-frame removal must clear content navigable, invoke the child notification, then destroy documents/descendants, remove nested history, update traversal history, and notify BiDi. The removing container's Document supplies the caller loop; the child's active Document supplies the destination loop. They can differ. |
| Setting the ongoing navigation (§7.4.2.5) | Navigable still lacks its navigation-ID/`traversal`/null state and setter. The setter must notify before changing a different value. Navigation startup can originate in a different Document; the `javascript:` navigation path is explicitly queued to the target Window. Fragment navigation and stop-loading also call this setter. Preserve the distinction between invoking it and the history algorithms' direct state assignments. |
| `window.stop()`, browser stop, and `Document.open()` | `WindowImpl.stop()` already reaches the explicit `stopLoading()` stub. HTML's document-open steps reach it conditionally when ongoing navigation is a navigation ID; stop-loading then invokes the ongoing-navigation setter. Gecko additionally notifies from `Document::Open` without such an ID, citing unresolved [HTML #12247](https://github.com/whatwg/html/issues/12247). Audit that behavior with document-open/stop; do not silently add an unconditional call. |

Tests exercise actual task queues, event dispatch, realm-owned errors, and promise
settlement while supplying the unfinished event producer's state. They do not
demonstrate automatic navigation cancellation or iframe teardown. Tests cover both
caller-loop branches, notification after a checkpoint clears the current task,
the live event at deferred delivery, Document activity gating, reentrant abortion,
per-tracker error identity, and child-notification ordering.

Validation: all 11 new cases and all 207 tests across the nine Navigation and
three affected Event/Abort suites pass on Node 24.19.0, Node 26.8.1, and custom
Node, both stock and with the addon. No expected failures are needed. TypeScript,
type contracts, touched-file ESLint, import rules, and diff whitespace checks pass.

## Eighth slice: NavigationActivation

Audited [§7.2.6.9](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-activation-interface)
against HTML `404b3eb` (30 October 2026), on 1 November, alongside the activation
step of [update document for history step application](https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application).
NavigationActivation owns the previous and activation-time entries and the
navigation type. It is nonconstructible, with ordinary readonly Web IDL attributes;
Binding supplies receiver checks, stable identity, and receiver-realm projection.
`Navigation.activation` begins null. The existing top-level cross-document
commit now captures its previous active entry and initializes activation after
the destination entry list, before parser scripts run. It uses the resolved
push/replace type without changing the history-step method's signature.

The producer reuses a listed predecessor, or creates an unlisted entry for
an eligible same-origin replacement in the destination realm. Initial about:blank
and cross-origin predecessors are hidden. Replaced entries retain URL/state
access through NavigationHistoryEntry's existing activity and referrer-policy
rules. `activation.entry` is a retained entry, not a getter for the latest
`navigation.currentEntry`. Same-document history changes leave the activation
alone; the update operation mutates the retained activation object when supplied
history-reactivation inputs. The actual traversal/reactivation caller is still absent.

`NavigationImpl.updateActivation(navigationType, previousEntryForActivation?)`
extracts step 7 from the larger document history-application algorithm, an
arrangement Eric accepted on 1 November. Navigation owns the
state and relevant environment; the caller supplies the navigation type and
previous entry. Missing previous entry, null type, and non-reload same-document
updates leave activation unchanged. The current entry must be initialized first.

### Remaining producers

| Dependency | Required work |
| --- | --- |
| Full history-step application (§7.4.6.2) | Supply the previous active entry and resolved NavigationType. Audit HTML's ordering of activation before the later reactivation entry-list reconciliation: a newly visible predecessor might not yet be in the retained list. Preserve the old Document's initial-about:blank flag until replacement selection; an evicted unlisted predecessor currently throws explicitly rather than guessing that flag. The synchronous top-level new-Document commit is only one producer. |
| Reload and traversal | Navigable's explicit unfinished operations must deliver their own `reload`/`traverse` types and restored entry state. A host same-URL load currently resolves to `replace`; it is not evidence of reload support. |
| Same-document entry updates (§7.2.6.4) | The unfinished mutation/event producer must preserve the activation and its retained endpoints even if they leave the list. State updates to a retained session-history record remain visible through that entry. |
| `pageswap` (§7.2.7.4, §7.4.6.2) | Its event, outgoing-document lifecycle, redirect-chain same-origin check, and View Transition integration are unfinished. It creates a **separate** activation in the outgoing Document's realm, with `from` equal to its current entry and a destination selected by navigation type; it must not mutate `navigation.activation`. |
| Request referrer policy and history eviction | The existing entry getters consume retained policy; source-snapshot policy capture and complete Document eviction/restoration remain navigation-coordinator dependencies. |

The browser-only reproduction is
`node-compat/experimental/navigation-activation.mjs`. It distinguishes actual
bfcache restoration from a newly loaded Document, and uses full Chromium because
the headless shell disables bfcache. The tested builds are Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. Eric approved the following three behavior choices
on 1 November; the corresponding source markers remain searchable.

- `SPEC_CLASH(navigation-activation-inactive)`: an inactive Navigation returns its
  retained activation in HTML, Firefox, and WebKit, but null in Chromium. Browlet
  retains the object as specified; its entry objects still expose inactive sentinels.
- `SPEC_CLASH(navigation-activation-disabled)`: for an opaque-origin Document,
  Chromium and WebKit return null activation.
  Firefox creates one with no current entry; reading its `entry` crashed the
  tested build. HTML's producer can assign null, while the attribute IDL is
  nonnullable. Browlet does not create/update an activation while entries are
  disabled. This leaves a new Navigation's activation null, while preserving any
  previously created activation when its Document becomes inactive.
- `SPEC_CLASH(navigation-activation-clear-from)`: HTML's update steps leave the old
  `from` unchanged when no eligible predecessor
  is found, contradicting its null-from description. A verified Chromium bfcache
  restoration clears it; Gecko's `CreateNavigationActivationFrom()` also resets
  it. WPT's `activation-after-bfcache-cross-origin-clears-from.html` requires the
  reset. Browlet explicitly assigns null in that case, including an unlisted
  same-origin predecessor separated from this contiguous history range.
- `SPEC_CLASH(navigation-activation-identity)`: retained-object identity follows
  HTML and the observed Chromium bfcache
  restoration. Gecko updates its existing object; the inspected WebKit source
  replaces it. Firefox/WebKit did not restore from bfcache in this probe, so their
  probe results do not establish retained-object identity on restoration.

Sources: Gecko's
[`CreateNavigationActivationFrom()`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/navigation/Navigation.cpp#L2229),
Blink's
[`UpdateActivation()`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigation_api.cc#106),
WebKit's
[`setActivation()` and reactivation update](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Navigation.cpp#L281),
and the
[retained-from WPT regression](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/testing/web-platform/tests/navigation-api/navigation-activation/activation-after-bfcache-cross-origin-clears-from.html).
These browser source snapshots are older than the tested binaries; live results
above establish only the cases the probe actually reached. The probe's optional
`--read-opaque-entry` flag retains the Firefox crash reproduction separately from
its normal comparison run.

The 23 production tests in `test/browlet/browsing/navigation-activation.test.ts`
cover the real top-level commit/parser path, listed and unlisted predecessors,
state retention, readonly attributes, borrowed getters and receiver realms,
inactive/disabled behavior, same-document stability, and retained-object updates.
Reload and reactivation cases supply inputs at the implementation boundary;
they do not demonstrate a functioning traversal or bfcache lifecycle.

Validation: all 23 activation cases pass on Node 24.19.0, Node 26.8.1, and custom
Node, with and without the addon. The seven affected Navigation/History/loading
suites pass 111 tests on each addon run; stock runs have 108 passes and the same
three existing native-global expected failures. Generated declarations, type
checks/contracts, touched-file ESLint, import rules, and diff whitespace checks pass.

Custom-runtime provenance: the shared Node build now has main's boolean-returning
Atomics scheduling hooks. This branch's old custom addon failed to load before
tests began. The successful custom-addon run uses the matching ignored native
artifact copied from main (`256eb42c`, including `761b0090`), with this worktree's
JavaScript adapter and Navigation implementation. No native source was changed
here. Bring in main's callback update before rebuilding this branch's custom
addon against that engine; an old-signature addon rebuild alone is insufficient.

## NavigateEvent interception registration (§7.2.6.10.1)

Audited HTML `404b3eb` on 1 November. This slice supplies the
[`intercept()` and `scroll()` methods and shared checks](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigateevent-interface),
interception state, precommit/postcommit callback lists, focus/scroll choices,
and classic History state storage. The existing constructor attributes and
abortion continue using the same event owner.

- Bindings convert the options dictionary before the algorithm runs, including
  its alphabetical member-read order and callback/enum validation. The owner
  Document must be fully active, the event trusted, and cancellation unset, in
  that order. Borrowing a method does not change the event's owning Document.
- `intercept()` then requires interception permission and active dispatch.
  Precommit handlers additionally require a cancelable event. Calls accumulate
  callbacks without invoking them; omitted options preserve earlier choices,
  and explicit focus/scroll options replace the previous value. HTML's optional
  console warnings for overwritten choices are deliberately not emitted.
- `scroll()` accepts only the committed state after the shared checks. It does
  not require event dispatch or `canIntercept`, and an explicit call is allowed
  with `scroll: 'manual'`. It reaches an explicit unfinished scroll operation;
  it does not mark the event scrolled without performing the missing effects.
- The precommit callback references `NavigationPrecommitController`, so its
  nonconstructible interface, event ownership, and typed `redirect`/`addHandler`
  entry points were introduced as a foundation. Their operations are now
  implemented by the §7.2.6.10.2 slice below; event production is still missing.

`SPEC_CLASH(navigation-precommit-cancelable)`: HTML's explanatory prose says
`SecurityError` when a precommit handler is supplied to a noncancelable event;
the numbered algorithm says `InvalidStateError`. Browlet follows the algorithm.
A child-frame traversal reproduces `InvalidStateError` in Chromium 156.0.8078.4
and Firefox 157.0. WebKit 27.2 does not read the precommit dictionary member in
the tested default configuration, so its acceptance is missing feature support,
not evidence for a competing exception. WebKit's enabled source implementation
also throws `InvalidStateError`.

Source evidence: [Blink intercept](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigate_event.cc#124),
[Gecko Intercept](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/events/NavigateEvent.cpp#L143),
and [WebKit intercept](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/NavigateEvent.cpp#L125).
Those snapshots predate the tested binaries. The reproducible browser-only probe
is `node-compat/experimental/navigation-intercept.mjs`; it also checks untrusted
and canceled events, outside-dispatch calls, precommit scrolling, and dictionary
conversion order. Production tests use real bindings and dispatch, supplying the
trusted event at the unfinished production boundary.

### Remaining effects and scheduling dependencies

| Dependency | Required work |
| --- | --- |
| Event production (§7.2.6.10.4) | Initialize destination, flags, signal/controller, user involvement, classic History state, and ongoing Navigation state. Compute interception/cancellation eligibility, including URL rewrite and cross-document traversal restrictions. The History handoff still throws explicitly. |
| Precommit controller (§7.2.6.10.2) | Operations are implemented below. §7.2.6.10.4 must create it in the event's realm, deliver it to precommit handlers, and advance event state when committing/finishing. |
| Precommit/commit/finish (§7.2.6.10.4–5) | Invoke the converted callbacks, await their promises, handle reentrancy/cancellation, commit URL/history and trackers, settle the transition, dispatch success/error, and drive loading/accessibility feedback. Registered callbacks are not yet executed by a navigation producer. |
| Focus and scroll (§7.2.6.10.5) | Supply autofocus/focus-change and sequential-navigation state; restore traversal scroll data or consult the Document's indicated part for beginning/fragment scroll, with CSSOM View effects. The scroll operation remains an explicit throwing boundary. |
| Engine wake-up integration | Before implementing asynchronous handler completion, integrate Vin's main event-loop/addon work and test idle progress without a manual rescue checkpoint. Keep queue notification in JS Engine/node-compat, not NavigateEvent. |

Vin review: main `2746a1bf` adds Promise-settlement wake-ups after the Atomics and
WebAssembly completion work. Activation and this synchronous registration slice
need no adjustment. Vin is still investigating three raw Node/Window callback
handoffs on official Node addons (Node Promise reaction, custom species, and a
late `.then(windowCallback)` on an already fulfilled Window Promise). These are
experimental ordinary failures, not Navigation expected failures. Future handler
completion must demonstrate the binding-owned callback path works with that
integration; it must not duplicate scheduler work or assume a settlement hook
observes every reaction enqueue. The previous custom-addon artifact provenance
above remains applicable; this slice changes no addon or event-loop code.

Validation: the 20 new interception cases and five affected Navigation suites
(87 cases total) pass on Node 24.19.0, Node 26.8.1, and custom Node, with and
without the addon. No new expected failures were introduced. Generated types,
type checking, touched-file ESLint, import rules, and diff whitespace checks pass.

## NavigationPrecommitController operations (§7.2.6.10.2)

Audited HTML `404b3eb` on 1 November. The
[`redirect()` and `addHandler()` algorithms](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationprecommitcontroller)
now operate on the controller's retained NavigateEvent.

- Both methods require a trusted, uncanceled event with an active owning
  Document, then the `intercepted` state. They do not require event dispatch:
  precommit handlers run after dispatch and can continue asynchronously before
  commit. `redirect()` additionally rejects reload/traverse navigations.
- Bindings convert USVString/dictionary/callback inputs before the algorithms.
  Redirect parses using the controller's Document base and UTF-8, then uses the
  existing URL-rewrite permission predicate. It updates navigation type,
  storage-serialized destination/tracker state, destination URL, and info in the
  specified order. Absent or explicitly undefined state/info are preserved;
  supplied null values replace them. Info retains identity; state is cloned.
- Redirect changes the destination record, not the current Document URL or
  session history. `addHandler()` appends an already converted postcommit
  callback without invoking it. Existing bindings own callback adaptation and
  borrowed-method exception realms; neither method adds scheduling machinery.

Eric approved both continuing conflicts below. The source carries the same
searchable markers.

| Conflict | Evidence and Browlet choice |
| --- | --- |
| `SPEC_CLASH(navigation-redirect-history-order)` | HTML, Firefox 157.0, and inspected WebKit source change `navigationType` before serializing state. A clone failure therefore retains the new type, while URL/state/info remain unchanged. Chromium 156.0.8078.4 changes the type after successful serialization. Browlet follows HTML. A nested redirect from a state getter can also determine the final type under HTML; Chromium's outer call replaces it afterward. |
| `SPEC_CLASH(navigation-redirect-reentrancy)` | HTML looks up the ongoing tracker after state serialization. A getter starting a new navigation causes Chromium and Firefox to overwrite that new navigation's state with the old redirect's state. Browlet captures the original tracker before serialization and updates it only if still registered. The old event's destination still receives its own serialized result; no new tracker is adopted, and a removed/replaced tracker remains untouched. |

The focused regression first reproduced the replacement tracker containing
`{ value: 'old' }` instead of `{ replacement: true }` under the direct HTML
translation, then passed with the identity guard. Because navigate-event
production is unfinished, that test substitutes only the tracker replacement;
the browser probe performs the actual reentrant navigation and confirms the
wrong replacement entry state at commit.

Browser reproduction: `node-compat/experimental/navigation-precommit.mjs`.
Chromium 156.0.8078.4 and Firefox 157.0 also use UTF-8 for a redirect query in a
Windows-1252 Document. WebKit 27.2 does not expose the precommit controller in
its tested default configuration; no live WebKit behavior is inferred from
the older source. Sources:
[Blink Redirect](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigate_event.cc#274),
[Gecko controller](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/navigation/NavigationPrecommitController.cpp#L42),
[WebKit controller](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/NavigationPrecommitController.cpp#L53),
and [WPT redirect options](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/testing/web-platform/tests/navigation-api/precommit-handler/precommitHandler-redirect-options.html).

Remaining integration is §7.2.6.10.4 event firing: create the controller in the
event's realm, pass it through the callback binding, and drive precommit/commit,
failure, and handler completion. The producer must supply the trusted event's
Navigation target and its tracker registration; tests supply these through real
dispatch at that unfinished boundary. Event state must eventually reject
retained controllers after commit/finish. Actual URL/history updates and
scroll/focus effects remain with their existing owners. The asynchronous
completion path still needs the Vin integration recorded above and idle-progress
coverage; these synchronous operations do not resolve that dependency.

Blink additionally rejects explicit push redirection in its
[trivial-history contexts](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/local_frame.cc#679):
prerendered Documents and fenced-frame trees. Neither lifecycle exists here;
their specifications need an audit when introduced. This is not a prerequisite
or an extra restriction for ordinary Documents in this HTML slice.

Validation: 23 controller tests cover conversion/order, URL and type checks,
state/info retention, clone failures, nested redirects, tracker replacement,
borrowed methods, inactive owners, and handler registration. The old throwing
controller-boundary test is replaced by these behavior tests. All six affected
Navigation suites pass 109 tests on each Node 24.19.0, Node 26.8.1, and custom
configuration, with and without the addon; no new expected failures were needed.
Generated declarations, type checking, ESLint, import rules, and whitespace checks
pass. The custom addon uses the previously recorded matching main artifact.

## Requirement and dependency inventory

The [introduction](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-api-intro)
describes the eventual API, not just this slice. Its examples and the complete
Navigation IDL are accounted for below.

| Requirement | Status and owner |
| --- | --- |
| Own-navigable entries, contiguous same-origin visibility, current index and back/forward availability | Implemented readers/selection; real nested-history creation still belongs to §7.3/§7.4. |
| Window-owned replaceable Navigation; EventTarget identity and handler attributes | Implemented. |
| `NavigationType` values and their meanings | Declared; push/replace correspond to resolved history handling, reload and traverse retain distinct categories. |
| Initialization for a new Document | Implemented and connected to the existing top-level commit. The complete §7.4.6 history application must provide the same inputs. |
| Reactivation | §7.2.6.4 reconciliation and deferred disposal implemented. The §7.4.6 bfcache/history-traversal caller and its `pageshow` ordering remain unconnected. |
| Same-document entry changes | Explicit unfinished entry point in §7.2.6.4: push/replace/traverse list mutation, tracker committed notification before author callbacks, current-entry-change before disposal, intercept commit handlers, and script preparation/cleanup suppressing intervening microtask checkpoints. |
| Entries falling off a capped history list | HTML itself leaves disposal unspecified ([#8620](https://github.com/whatwg/html/issues/8620)); Browlet has no history-size cap. Revisit when implementing eviction, rather than silently discarding entries. |
| Request-policy URL hiding | Getter implemented. `createHistoryEntry()` still needs navigation's source-snapshot request referrer/policy capture; the destination response policy is not a substitute. Tests supply this retained state directly. |
| `updateCurrentEntry()` and its required-state dictionary | Implemented §7.2.6.6, with storage serialization and trusted `NavigationCurrentEntryChangeEvent` (§7.2.7.1). |
| Navigation lifetime during Document destruction | Destruction/global teardown must account for Navigation's EventTarget and queued disposal tasks. Reentrant serialization exposes this missing lifecycle integration; browser evidence is recorded above. |
| `navigate`, `reload`; options and NavigationResult | §7.2.6.7 preparation and results implemented; valid effects still stop at explicit Navigable dependencies. |
| Method trackers and committed/finished lifecycle | §7.2.6.8 state, setup, settlement, event abortion, and Navigable abort/child-destruction notifications implemented. Their navigation/traversal/destruction producers remain explicit above. |
| `traverseTo`, `back`, `forward` | §7.2.6.7 selection, no-op success, deduplication, source capture, and queued failure handling implemented. Traversal activation and traversal queue/history application remain explicit dependencies. |
| `transition` | §7.2.6.8 nullable attribute, NavigationTransition state/getters, promise settlement, and event-abortion cleanup implemented. Production, success/commit, and lifecycle integration remain explicit above. |
| `activation` | §7.2.6.9 interface, retained state, and update operation implemented; top-level new-Document commits populate it. Full history/reactivation/reload and separate pageswap production remain explicit above. |
| `navigate` firing, cancellation and exceptions to firing | Ongoing-event state and abort/error delivery implemented. Pending §7.2.6.10: event firing, location-bar and other-Window cross-document exclusions; restricted cancellation for child/cross-origin traversals and repeated canceled traversals; user involvement. The existing History handoff still throws at its explicit unfinished event operation. |
| Interception and asynchronous completion | NavigationDestination's §7.2.6.10.3 interface and NavigateEvent constructor/data, shared checks, intercept registration, scroll validation, and precommit-controller operations are implemented. Event production and the rest of §7.2.6.10 remain pending: cross-origin interception restrictions, hash/download discrimination, controller delivery, handler execution/completion, committed versus finished ordering, success events, loading UI, and scroll/focus effects. |

Next area: §7.2.6.10.4 navigate-event firing, beginning with a bounded preparation
and event-production slice. §7.2.6.10.3 NavigationDestination is already covered.
Precommit/commit, scrolling/focus, and complete navigation effects remain
explicit until their own algorithms are audited.
