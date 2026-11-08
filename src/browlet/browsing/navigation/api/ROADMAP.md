# Navigation API roadmap

This component owns Window's Navigation and its realm-owned entry objects.
The higher [navigation coordinator](../ROADMAP.md) owns the underlying
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
- The §7.4.6.2 Document reactivation caller now refreshes entries and activation
  before `pageshow`; disposal runs afterward. Selective form reset, visibility
  transitions, and the full bfcache/traversal coordinator remain explicit in the
  [retained-Document audit](../ROADMAP.md#html-7462-retained-document-reactivation).
  The tests do not demonstrate an implemented end-to-end bfcache pipeline.
- Same-document entry changes are implemented by
  `updateEntriesForSameDocumentNavigation()`: list mutation, tracker notification
  before author callbacks, captured event/tracker state, current-entry-change,
  disposal, and postcommit handlers within script preparation/cleanup. The
  postcommit slice below records ordering, completion, and remaining §7.4 callers.

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

Ordinary `Navigable.navigate()` now reaches event firing: cancellation rejects the
accepted tracker, and pending precommit interception stops ordinary loading.
Accepted non-intercepted requests now pass quota and queued unload checks before
the explicit recursive-abortion/population dependencies;
immediate interception now commits URL/History/Navigation state through §7.4.4,
then queues the explicit §7.4.6 history-application dependency.
Reload now selects state, fires the same event operation, marks reloadPending,
and queues the explicit reload history-application dependency. The earlier method tests control the navigation
boundary to exercise conversion, promises, state, and realm ownership; the
[ordinary caller tests](../ROADMAP.md#ordinary-navigate-event-caller) exercise its
new production connection. Full navigation must still supply:

- Navigate-event acceptance: clear pending, register the ongoing tracker, preserve
  upcoming traversal identity, and invoke commit/finish/reject at the specified
  points. These operations, same-document entry updates, transitions, focus/scroll
  policy, and abort propagation are implemented in the subsequent slices below.
  History and ordinary navigation call event preparation; later lifecycle
  producers and completion effects remain unfinished.
- Actual fetching, cancellation, navigation/traversal queues, history commits, and
  unload/reload effects. Cross-document loads, non-navigating 204/205 responses,
  attachment downloads, and non-intercepted reloads must leave the original method
  promises unsettled; implementing the tracker does not supply those branches.
- The beforeunload producer now balances the Document `unloadCounter` around
  dispatch and prompt handling. Full unloading remains its later owner; direct
  method tests still set the counter to isolate the consumer.

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
- `SourceSnapshotParams` in `navigation/state/source-snapshot.ts` captures the source
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
- If source snapshot capture or the host scheduler throws before accepting the work, the
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

Ordinary requests to a different entry now capture Window transient activation.
Timestamps, expiry, predicates, and consumption are implemented; input/automation
and close-watcher notification remain with HTML §6.4.2.
`Traversable.appendSessionHistoryTraversalSteps()` now runs through the browser-owned
§7.4.1.3 parallel queue. Its serial drain waits for a returned internal completion
promise; synchronous-navigation queue jumping still needs §7.4.6.1 history application.
`Traversable.applyTraverseHistoryStep()` separately declares all inputs and all four
outcomes through internal completion. It now checks permission/cancellation and
then rejects at the unfinished population/activation boundary. Navigation waits
for this result before queuing its existing failure handling; commit/finish still
requires restoration, history updates, and event/tracker notifications. Tests control these
three owner boundaries and execute the prepared callback; they do not establish
working traversal. Navigation startup and delta traversal now consume source
snapshots too; Window closing authorization remains unfinished. The shared
applyTraverseHistoryStep accepts null snapshot/initiator for browser-UI delta
requests; Navigation API traversal continues supplying its concrete source.
Child destruction and ongoing-navigation abortion now notify Navigation through
the §7.2.6.8 operations, with recursive teardown and stop-loading still unfinished.

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
| Transition creation | §7.2.6.10.4 inner event firing now creates it after event dispatch when interception state is not `none`, retaining the current entry and the event's exact destination. |
| Transition commit and completion | `commit a NavigateEvent` now resolves committed after its owner effect returns; entry/URL mutation remains unfinished. Handler completion must fire navigatesuccess before resolving finished and clearing the active transition. The settlement operation exists; its success producer remains unfinished. |
| Ongoing event and focus/scroll state | Added in the sixth slice, with initial values and cancellation resets. Event firing installs the event and initializes state; focusing steps must update the focus flag; interception and history application must consume the scroll flag. |
| Abort the ongoing navigation / abort a NavigateEvent | Implemented in the sixth slice below. Event, loading, and traversal producers still need to invoke them. Error extraction still lacks source-location diagnostics as recorded in the scripting roadmap. |
| Inform the API about aborting navigation | Implemented in the seventh slice: the caller supplies its event loop (or null for parallel work); the active Window's loop runs the notification immediately or receives a navigation-and-traversal task. The notification repeatedly aborts because callbacks can start another navigation. Production callers remain unconnected below. |
| Child navigable destruction | The seventh slice supplies the notification: inform about abortion, then snapshot upcoming traversal values and reject each with a fresh owner-realm AbortError. Actual child destruction does not yet invoke it. |
| Destination creation and updates | Event firing supplies traversal entry/state or null-entry serialized state, URL, and original document classification. The precommit controller updates this same object and is delivered during precommit execution. |

The original interface tests supply transition/destination values directly.
Later firing and precommit tests cover their automatic creation and cancellation;
history movement remains unfinished.

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
No current-loop field is added to Navigable or Document. The ordinary-navigation
producer now joins History at this Window-local entry point: its same-Agent call
or queued target-Agent handoff precedes event preparation. This does not yet prove
that iframe removal, parallel work, and all other producers can drop the argument.

### Deferred decision: caller-loop parameter

`TODO(navigation-abort-caller-loop)`: on 1 November, Eric and Ged deferred the
signature decision until production callers can demonstrate the required
handoffs. The current parameter is a tested implementation, not a proven
necessity or an accepted permanent API. Keep its `SPEC_MISMATCH` markers pending.

History and ordinary navigation now establish owner-loop execution before their
local notification. Reopen the broader decision when connecting removal and
parallel lifecycle callers. Trace their existing Document/environment and scheduling boundary before
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
| Push/replace/reload navigate-event firing (§7.2.6.10.4) | History, ordinary Navigation/Location, fragment navigation, and reload now reach preparation and abort the previous navigation before disabled-entry and activity checks. This Window-local entry obtains the loop from its own environment; no loop argument was added to History, reload, or the firing operation. Cross-Agent lifecycle handoffs remain under their owning algorithms. |
| [Download the hyperlink](https://html.spec.whatwg.org/multipage/links.html#downloading-hyperlinks) (§4.6.5) | For a non-browser-UI request that proceeds after its download navigate event, notify the subject element's node navigable before the parallel download work. Its node Document supplies the local environment. Hyperlink activation/download and download-event production remain unfinished. |
| Child navigable destruction (§7.3.1.6) | `UserAgent.destroyChildNavigable()` now reaches the coordinator, which clears content navigable and invokes the child notification using the container Document's loop. Recursive Document teardown, traversal queuing, BiDi delivery, and automatic iframe/object/embed/frame removal remain unfinished. Tests cover shared/separate Agent notification, but off-loop abortion remains gated by the detached Document's activity; resolve delivery with teardown before connecting removal. |
| Setting the ongoing navigation (§7.4.2.5) | Navigable owns its navigation-ID/`traversal`/null state and setter, re-audited in document order. It notifies before changing a different value. Startup reaches it after the target-Agent handoff and uses the executing target environment. Queued javascript: admission clears the matching ID on that Window's loop. Explicit host/parallel calls queue notification. Fragment interception records its ID directly under the approved clash. Stop-loading and history's direct assignments remain unfinished; the caller-loop decision stays open for the remaining producers. |
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
history-reactivation inputs. `Document.reactivate()` now supplies those inputs
after refreshing the list; the full traversal coordinator remains unfinished.

`NavigationImpl.updateActivation(navigationType, previousEntryForActivation?)`
extracts step 7 from the larger document history-application algorithm, an
arrangement Eric accepted on 1 November. Navigation owns the
state and relevant environment; the caller supplies the navigation type and
previous entry. Missing previous entry, null type, and non-reload same-document
updates leave activation unchanged. The current entry must be initialized first.

### Remaining producers

| Dependency | Required work |
| --- | --- |
| Full history-step application (§7.4.6.2) | The Document history-update/reactivation caller now refreshes entries before activation and pageshow; `SPEC_CLASH(history-reactivation-navigation-order)` records the approved correction and browser evidence in the [navigation audit](../ROADMAP.md#html-7462-retained-document-reactivation). The coordinator must still supply the previous active entry and NavigationType. Preserve the previous Document's initial-about:blank flag until replacement selection; an evicted unlisted predecessor still throws rather than guessing that flag. |
| Reload and traversal | Navigable's explicit unfinished operations must deliver their own `reload`/`traverse` types and restored entry state. A host same-URL load currently resolves to `replace`; it is not evidence of reload support. |
| Same-document entry updates (§7.2.6.4) | Entry updates preserve the activation and its retained endpoints even if they leave the list. State updates to a retained session-history record remain visible through that entry. Full §7.4 history application remains unconnected. |
| `pageswap` (§7.2.7.4, §7.4.6.2) | The event interface is implemented; outgoing-document lifecycle, redirect-chain same-origin checks, and View Transition integration remain unfinished. Its producer creates a **separate** activation in the outgoing Document's realm, with `from` equal to its current entry and a destination selected by navigation type; it must not mutate `navigation.activation`. |
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
[retained-from WPT regression](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/testing/web-platform/tests/navigation/api/navigation-activation/activation-after-bfcache-cross-origin-clears-from.html).
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
| Event production (§7.2.6.10.4) | Preparation, dispatch, tracker acceptance, and eligibility checks are implemented below. History is connected; other navigation/lifecycle callers remain unfinished. |
| Precommit controller (§7.2.6.10.2) | Operations, realm-owned delivery, and commit-state invalidation are implemented below. |
| Precommit/commit/finish (§7.2.6.10.4–5) | Callback execution, synchronous URL/history commit, entry updates, settlement, and manual focus/scroll finishing are implemented. Queued joint-history application and loading/accessibility feedback remain unfinished. |
| Focus and scroll (§7.2.6.10.5) | Policy decisions and effect selection are implemented below. Shared autofocus/focus state, sequential navigation, indicated-part selection, saved scroll data, and CSSOM View effects remain explicit dependencies. |
| Engine wake-up integration | Vin's event-loop/addon work is integrated. Same-Agent cross-Window callbacks and idle progress through the supported host bridge are tested without rescue checkpoints. The raw cross-Agent host probe remains separate. |

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
and [WPT redirect options](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/testing/web-platform/tests/navigation/api/precommit-handler/precommitHandler-redirect-options.html).

The later §7.2.6.10.4 execution slice now creates and delivers the controller
through Binding, waits for precommit handlers, and processes their failure.
The commit slice now advances event state and rejects later use of retained
controllers. Postcommit completion and §7.4.4 synchronous URL/history updates
are now implemented; queued history application and automatic scroll/focus
effects remain unfinished at their existing owners. The precommit slice below
records the integrated scheduling baseline and its idle-progress coverage.

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

## Navigate-event preparation (§7.2.6.10.4)

Audited the complete [firing section](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigate-event-firing)
against HTML `404b3eb` (also the live 30 October version). This bounded slice
implemented its three preparation algorithms and the shared inner algorithm's
disabled-entry return. The following slice adds shared dispatch and cancellation.

- Traversal selects an entry by session-history record identity. Only an entry
  present in this Navigation supplies destination state; absent entries get
  serialized null, independently of whether their Document is the same one.
- Push/replace/reload aborts ongoing navigation first, including reentrant
  replacement events. It then drops the supplied tracker if entries became
  disabled, rechecks Document activity, and prepares the destination with
  separate Navigation and classic History state. Disabled trackers remain
  unsettled as specified; they are not accepted into ongoing navigation.
- Downloads prepare a cross-document push destination with serialized null
  and the exact filename, including an empty string. The following slice moves
  abortion before preparation, with an approved browser/spec conflict below.
- All three create trusted events through the owner's existing event factory
  and retain the destination's environment for projection. Form entries and
  source elements remain concrete inputs for the shared firing algorithm.

The first real abortion caller is now History push/replace. Its Document owns
Navigation and supplies the loop through that environment. Tests execute the
projected History methods and observe synchronous abortion before preparation
and URL/history update. They also cover deactivation by an abort listener.
This supports the existing-owner arrangement for this caller; it does not settle
the provisional Navigable signature for child destruction or parallel producers.
The deferred decision above remains open, with no new ambient execution state.

The full firing section was read. Its dependencies, updated by the next slice, are:

| Dependency | Owner and required behavior |
| --- | --- |
| Shared event initialization and dispatch | Implemented through cancellation and intercepted-transition creation. FormData adopts the supplied entry list; form submission does not yet produce it. |
| History-action activation and browser visual transitions | Window owns history-action timestamps, the predicate, and consumption (§6.4); input/automation notification and transient/sticky activation remain absent. Browlet displays no cached history rendering, so the event's visual flag is false. Introducing that UI requires its presentation state; a current/active history entry alone is insufficient. |
| Interception and precommit | Implemented: owner-realm transition/controller creation, adapted callback execution, waiting for all results, and failure routing. Vin's scheduling integration is included, with supported host-bridge idle-progress tests. |
| Commit and same-document entries | Commit, synchronous Document URL/history updates, tracker notification, currententrychange, disposal, and captured-handler invocation are implemented. Queued joint-history application and traversal resumption remain explicit unfinished owners. |
| Postcommit completion and failure | Handler invocation, wait-for-all, activity/abortion guards, tracker/transition settlement, and success/error delivery are implemented. Nonintercepted and manually managed intercepted completion work; automatic focus/scroll effects remain unfinished. |
| Navigation producers | General navigation, fragments, reload, traversal/history application, and hyperlink download must call the appropriate preparation entry point, respecting exclusions for browser-UI and another Window's cross-document navigation. Only classic History is connected so far. |

Preparation tests isolate inner firing and URL/history effects; separate §7.4.4
tests now connect both. Preparation tests alone do not establish dispatched-event or completed
navigation conformance. The disabled-event cases use the real inner early return.
No new browser disagreement or callable-shape change was introduced.

Validation: the 16 new preparation tests and 48 existing History/abortion tests
pass on Node 24.19.0, Node 26.8.1, and custom Node, each with and without the addon.
No expected failures were added. Generated declarations, TypeScript/type
contracts, ESLint, import rules, and whitespace checks pass. Custom validation
reused the matching main artifact documented above; no engine/addon was rebuilt.

## Navigate-event dispatch and cancellation (§7.2.6.10.4)

The shared firing algorithm now accepts its method tracker (including selection
from the upcoming traversal map), initializes all event data, and dispatches
through DOM. URL rewriting and same-document status determine interception;
top-level status, user involvement, and history-action activation determine
traversal cancellation. Hash-change detection excludes classic History state.
AbortController/signal and FormData are created for the event owner; FormData
adopts the original entry list instead of copying it.

Cancellation consumes history activation when appropriate, aborts the signal,
rejects the tracker, and delivers navigateerror. A replacement installed by
nested dispatch survives the outer event's return. An intercepted event creates
its transition after dispatch, with the existing handled promises. The stopping
point of that slice was precommit-handler execution and `NavigateEventImpl.commit()`.
The following slices implement precommit execution and commit coordination;
entry/history effects still throw explicit unfinished-operation errors. No successful
navigation or postcommit completion is simulated. The shared firing algorithm
is therefore not complete, even though its canceled-request branch is usable
by real History calls.

History activation uses Window-owned timestamps and methods; Document's new
shadow-inclusive descendant-navigable helper supplies consumption across nested
and cross-origin active Windows. This differs from the light-tree child list used
for Window indexed access. Input notification, automation, close-watcher
notification remain in the [interaction inventory](../../../interaction/ROADMAP.md).
Transient/sticky queries and the UserActivation interface are implemented.

Eric approved these two choices, recorded alongside their source branches:

| Conflict | Evidence and chosen behavior |
| --- | --- |
| `SPEC_CLASH(navigation-download-abort-order)` | Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 abort an ongoing intercepted navigation before dispatching a download event, including a canceled download. HTML §4.6.5 places the notification after an allowed event, which cannot satisfy shared firing's no-ongoing-event assertion. Browlet aborts before download preparation, including reentrant replacements. The focused regression first threw `A navigate event is already ongoing`, then passed with this ordering. |
| `SPEC_CLASH(navigation-destination-default-state)` | HTML explicitly defaults destination state to serialized null. Chromium/Firefox return undefined for History and download events; WebKit returns undefined for downloads but the classic History state for pushState. Browlet keeps HTML's null and separate state systems. Explicit Navigation API state remains unchanged. |

Browser probe: `node-compat/experimental/navigation-event-firing.mjs`, run after
page load from a page script, so automation's evaluation gesture does not affect
`userInitiated`. All three agree on programmatic History/fragment cancellation,
hash-change discrimination, and signal abortion. The download ordering relates
to [HTML #11802](https://github.com/whatwg/html/issues/11802) and its
[caller-side repair #11983](https://github.com/whatwg/html/pull/11983);
Gecko's `Navigation::FireDownloadRequestNavigateEvent` explicitly aborts first.
The eventual hyperlink producer still needs an audit of accepted-download
cleanup and the specified later notification; this canceled-request fix does not
complete that lifecycle. Traversal's actual abortion handoff likewise belongs to
its unfinished history-application caller.

Tests exercise real projected History cancellation, event/destination/signal
realms, form-list adoption, tracker selection/rejection, reentrancy, restricted
traversal cancellation, and transition creation. Only unfinished commit is
substituted when a test needs to inspect an accepted event. Activation tests
provide timestamps and child associations at the missing producer boundaries;
they cover shadow trees, nesting, other origins, and detached/retired Windows.
The following precommit slice adds asynchronous execution and idle-progress
coverage after integrating Vin's scheduling work.

Validation: all 147 tests in the eight affected History, Navigation, and activation
suites pass on Node 24.19.0, Node 26.8.1, and custom Node, each with and without
the addon; there are no expected failures in this selection. Generated declarations,
type checks/contracts, touched-file ESLint, import rules, and diff whitespace
checks pass. The custom-addon run reused the matching artifact described above
(SHA-256 `91A11D6287A2D0283A286F215B26399D67D112F94B1A90B2C19E83EABDA14808`);
no engine or addon was rebuilt.

## Precommit execution and failure (§7.2.6.10.4)

The shared firing algorithm now creates one owner-realm controller and invokes
every converted precommit callback after event dispatch. Binding supplies
argument projection, return conversion, and Promise rejection for synchronous
throws. The implementation observes those results directly on the Navigation
owner's queue: Web IDL's [wait for all](https://webidl.spec.whatwg.org/#wait-for-all)
runs completion in the last input reaction, without a `Promise.all().then()`
aggregate reaction. All handlers are invoked before observations are installed;
one rejection does not prevent later handlers from running. Only the first
rejection reaches failure processing.

Fulfillment hands the captured tracker to `NavigateEventImpl.commit()`. That
operation ignores inactive or aborted events before the commit coordination
described below. Failure likewise checks activity and abortion, requires the
ongoing event, and uses the existing abort operation to reject tracker/transition
promises, signal abortion, and fire `navigateerror`. Precommit failure does not
invoke finishing, as specified. Postcommit failure now reaches the implemented
`finish(false)` policy; automatic focus reset remains a §6.6 dependency. Late completion after a
replacement navigation leaves the replacement untouched.

Eric approved these two conflicts, also marked at callback invocation:

| Conflict | Evidence and chosen behavior |
| --- | --- |
| `SPEC_CLASH(navigation-precommit-receiver)` | HTML omits a callback receiver, so Web IDL supplies undefined; Firefox 157.0 agrees. Chromium 156.0.8078.4 supplies the NavigateEvent. Browlet follows HTML/Firefox, including a strict callback created in another Window. |
| `SPEC_CLASH(navigation-precommit-rejection-timing)` | Web IDL's callback-exception algorithm creates a rejected Promise and converts it to the declared return type; [JS-to-Promise conversion](https://webidl.spec.whatwg.org/#js-to-promise) wraps it in a new capability. Those adoption steps put Browlet's error after a microtask queued just after the request. Chromium/Firefox deliver the error before that microtask. Browlet retains the written conversion and its established Binding behavior, without a Navigation shortcut. |

Browser evidence is reproducible in
`node-compat/experimental/navigation-precommit-execution.mjs`. Chromium and
Firefox agree that all callbacks run, share one controller, see the transition,
and preserve the rejection reason across signal/error/result delivery. WebKit
27.2 has precommit disabled, so this probe establishes no live WebKit result.
Blink's `NavigateEvent::MaybeCommitImmediately()` explicitly passes the event to
`Invoke`; Gecko's `Navigation::InnerNavigateEventFiringAlgorithm()` calls the
handler without a receiver. The older WebKit source also omits that receiver.
The initial timing expectation reproduced the browser order, failed against
the written Web IDL conversion, and was updated only after the choice above.

The ten focused tests cover direct History rejection, invocation/microtask order,
waiting for every handler, the captured tracker, first-rejection selection,
same-Agent cross-Window controller ownership/redirect, late completions,
inactive owners, and idle fulfillment/rejection through `exposeFunction()`.
Accepted-event tests substitute only the unfinished commit effect; rejection
tests use actual dispatch and cleanup. Idle tests read host-visible data without
evaluating page code or forcing a checkpoint.

This branch was rebased onto Vin's folded `6abe4e9c` scheduling work. All 15
reviewed commits were preserved (range-diff shows only surrounding context in
the Navigation entry commit). Matching ignored addon artifacts were copied from
main after verifying identical native source; no engine or addon was rebuilt.

An exploratory test injected live callbacks between two independent Browlet
Agents from Node. On official Node 24/26 with the addon, invocation succeeded,
but its completion stayed queued until a rescue checkpoint. Current custom Node
delivers the rejection without rescue; Node 24 without the addon rejects the
callback's event-loop ownership earlier. This is separate from a page's
cross-Window callback in one Agent. Eric approved retaining the ordinary failing reproduction as
`node-compat/experimental/navigation-precommit-cross-agent.mts`, outside the
production slice. Its required idle-progress assertion remains failing rather
than asserting the stall as correct. See the adjacent Experimental findings;
the direct host cross-Agent contract remains open.

Validation: all 157 tests in the nine affected History, Navigation, and activation
suites pass on Node 24.19.0, Node 26.8.1, and custom Node, each with and without
the addon. No expected failures are used in this selection. Generated declarations,
type checks/contracts, touched-file ESLint, import rules, and diff whitespace
checks pass. The separate Experimental probe retains its required idle-progress
assertion and exits nonzero on the two official addon runtimes.

The subsequent slices below supply commit coordination, retained-controller
invalidation, same-document entries, and postcommit handlers. §7.4.4 now supplies
synchronous URL/history effects. Queued history application, automatic focus,
scrolling effects, and loading UI remain unfinished.
Destruction and navigation producers still need to invoke the existing abortion
notifications. None is filled in by the successful precommit handoff tests.

## Navigate-event commit coordination (§7.2.6.10.4)

`NavigateEventImpl.commit()` implements the
[commit algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#commit-a-navigate-event)
around its unfinished owner operations. It checks Document activity and abortion,
captures the original transition, and prepares the owning environment to run
script. This holds the modeled context across author callbacks; cleanup runs in
`finally`, including when an unfinished dependency throws. No new scheduling or
engine mechanism was needed.

Interception advances to committed before selecting its effect:

| Navigation type | Connected owner operation and remaining dependency |
| --- | --- |
| push / replace | `DocumentImpl.updateURLAndHistory()` receives the current destination URL, classic History serialized state, and navigation type. §7.4.4 commits synchronous effects and queues finalization. Absent classic state is serialized null here, clearing it as all three browsers do (`SPEC_CLASH(intercepted-navigation-classic-state)`); the helper's omitted-state behavior remains unchanged for other callers. |
| reload | `NavigationImpl.updateEntriesForSameDocumentNavigation()` receives the navigable's active entry. The subsequent slices implement entry/tracker/currententrychange/disposal/handlers and finishing policy. Automatic focus/scroll effects remain dependencies. |
| traverse | Suppress normal scroll restoration, map user initiation to activation/none, and append traversal work. The callback returns `Traversable.resumeTraverseHistoryStep()` completion with the destination step. The queue waits; resumption disables cancellation and uses null source/initiator. Population/activation remain explicit dependencies, and the original traversal's cancellation checks are not repeated. |

After the effect returns, commit resolves the original transition's committed
promise. A nonintercepted cross-document request releases its method tracker
without settling its results; same-document and intercepted requests retain it
for entry-update/completion producers. An unintercepted request leaves URL/history
effects to its caller. The postcommit slice below supplies the success producer;
automatically managed focus/scroll still depends on its unfinished effects.

Eric approved two source-marked choices, reproduced by
`node-compat/experimental/navigation-commit.mjs`:

| Conflict | Evidence and chosen behavior |
| --- | --- |
| `SPEC_CLASH(navigation-commit-reentrancy)` | A currententrychange listener starts a replacement with a pending precommit handler. HTML's late lookup and Firefox 157.0 resolve the replacement transition even though its URL and method result have not committed. Chromium 156.0.8078.4 keeps it pending. Browlet captures the original transition before callbacks, preserving that result while retaining HTML's later settlement point. The tested WebKit 27.2 build has precommit disabled, so it supplies no result for this case. |
| `SPEC_CLASH(navigation-transition-commit-order)` | All three browsers run currententrychange and intercept handlers before queued microtasks. For a transition observer registered by currententrychange, Firefox delivers the observer after an intercept-handler microtask; Chromium/WebKit deliver it before that microtask. Browlet follows HTML/Firefox: resolve after the history-update call and its callbacks return. |

The source arrangements explain that timing: Blink's
[`NavigationApi::UpdateForNavigation()`](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigation_api.cc#L272)
resolves the transition before currententrychange; Gecko's
[`CommitNavigateEvent()`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/navigation/Navigation.cpp#L614)
uses HTML's later lookup; WebKit's
[`setupInterceptionState()`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Navigation.cpp#L1210)
resolves before its separate interception-handler processing. These are different
implementation arrangements, not evidence that Chromium uses Browlet's capture.

Seventeen focused tests cover branch inputs, active-vs-current entry selection,
queued traversal resumption, scroll suppression, method-tracker ownership,
script context across real bound event callbacks, cleanup after dependency
failures, original-transition protection, and activity/abortion guards. A public
precommit-fulfillment test now observes the real commit state and the retained
controller's InvalidStateError from both redirect and addHandler. Tests substitute
only the entry/history effect or traversal queue when checking downstream
ordering; separate cases retain each unfinished dependency's throwing boundary.
These tests do not establish completed URL mutation, traversal, or postcommit
handler execution.

Validation: the 17 commit tests and 157 existing Navigation/History/activation
tests pass on Node 24.19.0, Node 26.8.1, and custom Node, each with and without
the addon. No expected failures or skips were added. Generated declarations,
type contracts, touched-file ESLint, import checks, and diff whitespace checks
pass. This slice uses the matching artifacts retained from the rebase; no addon
or engine was rebuilt. The independent cross-Agent Experimental probe remains
with Vin and was not changed as part of this work.

## Same-document entry updates and postcommit handlers (§§7.2.6.4, 7.2.6.10.4)

`NavigationImpl.updateEntriesForSameDocumentNavigation()` now implements the
[entry-update algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#update-the-navigation-api-entries-for-a-same-document-navigation).
Push removes forward entries and appends a new entry; replace creates a new
entry at the current index; traverse selects an existing entry by session-history
identity; reload retains the entry list and index. Removed entries receive trusted
dispose events in list order. The method tracker receives its committed entry and
serialized state before any author callback.

The operation captures the ongoing event and tracker, prepares the owning
environment to run script, then fires currententrychange, disposal events, and
the captured event's handlers. Cleanup runs in `finally`. Callbacks may start a
replacement navigation; the original handlers still run, as HTML and all three
browsers require, but their later completion observes the aborted signal and
leaves the replacement alone.

`runInterceptCommitHandlers()` implements the
[handler steps](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigate-event-intercept-commit-handler-steps).
Binding has already adapted the callbacks and their Promise results. Invoke all
handlers before observing results, then use direct InternalPromise observations
for Web IDL's wait-for-all; no aggregate Promise adds a reaction. An empty list
uses one resolved Promise. Only the first rejection reaches the existing failure
operation. Success checks activity and abortion, clears the ongoing event,
finishes it, settles the captured method tracker, fires navigatesuccess, and
settles the original transition without clearing a replacement.

The browser-only `node-compat/experimental/navigation-postcommit.mjs` probe ran
against Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved the
ordering and original-transition choices; thrown-handler conversion retains the
previously approved Web IDL rule used for precommit callbacks.

| Source marker | Evidence and chosen behavior |
| --- | --- |
| `SPEC_CLASH(navigation-postcommit-dispose-order)` | HTML, Firefox, and WebKit deliver currententrychange, dispose, then handlers. Chromium invokes handlers between currententrychange and dispose. Follow HTML. |
| `SPEC_CLASH(navigation-postcommit-handler-receiver)` | HTML/Web IDL, Firefox, and WebKit use undefined for a strict handler's receiver. Chromium supplies the NavigateEvent. Follow HTML and the existing callback machinery. |
| `SPEC_CLASH(navigation-postcommit-empty-timing)` | HTML's explicit resolved Promise places completion after microtasks queued in entry/disposal callbacks, before one queued after the request. Chromium/Firefox agree. WebKit delivers success before the entry/disposal microtasks. Retain the specified resolved Promise. |
| `SPEC_CLASH(navigation-postcommit-rejection-timing)` | All three browsers report a thrown handler's error before the after-request microtask. Web IDL's exception-to-Promise conversion and subsequent return-type conversion put it afterward in Browlet. Retain the shared Binding conversion, as approved for precommit, without a Navigation-specific shortcut. |
| `SPEC_CLASH(navigation-success-reentrancy)` | A navigatesuccess listener starts an intercepted replacement whose handler remains pending. HTML's late transition lookup and all three tested browsers leave the original transition unfinished, fulfill the replacement prematurely, and clear navigation.transition. Capture the original transition before finishing/callbacks, settle that transition, and clear only that same registration. |
| `SPEC_GAP(navigation-entry-update-without-event)` | HTML captures the nullable ongoing event but unconditionally passes it to handler steps requiring an event. Blink and Gecko guard the call. Browlet likewise performs entry updates and events without inventing a NavigateEvent or success notification when none exists. The §7.4.6 history-application caller still needs integration coverage, including restored Documents whose latest entry changes. |

Source evidence explains the browser differences:
[Blink NavigationApi](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigation_api.cc)
invokes handlers before disposal, and
[NavigateEvent](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigate_event.cc)
supplies the event receiver. [Gecko Navigation](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/navigation/Navigation.cpp)
uses disposal before handlers, no explicit callback receiver, and the resolved
empty-list Promise. [WebKit Navigation](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Navigation.cpp)
also omits the receiver but passes the empty list directly to its settlement
observer. All three success paths look up the transition after author callbacks.

This slice initially supplied `NavigateEventImpl.finish()`'s state-only early steps:
nonintercepted events need no focus/scroll effects; an intercepted precommit
failure can become finished; repeated or invalid early finishing is rejected.
The scroll/focus slice below completes the finishing policy around explicit
automatic-effect dependencies. Manually managed intercepted success/failure now
uses that real finishing operation.

Tests exercise real bindings, trusted event ordering and identities, list mutation,
state installation before callbacks, captured-event reentrancy, transition
protection, all-handler completion, first rejection, inactive completion, a
same-Agent foreign-Window Promise, and idle progress through the supported host
bridge. They isolate the §7.4 URL/history effect; the later scroll/focus slice
removes their finishing substitute by using manual policies. The §7.4.4 suite
now connects real synchronous URL/history updates and interception. Separate
assertions retain the actual queued history-application, traversal, focus, and
scrolling dependencies. The independent cross-Agent host probe stays with
Vin and is unchanged.

Validation: 204 tests across 13 Navigation/History/activation suites pass on
Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with and without the
addon. This includes 22 new entry-update/postcommit tests. No expected failures
or skips were added. Generated declarations, TypeScript/contracts, touched-file
ESLint, import rules, and diff whitespace checks pass. The matching artifacts
retained from the main rebase were used; no addon or engine rebuild was needed.

## Scroll and focus policy (§7.2.6.10.5)

The [finishing algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigateevent-finish)
now calls the focus-reset decision first, processes scrolling only on fulfillment,
and then marks the event finished. Nonintercepted and failed-precommit early
returns retain their specified behavior. Repeated finishing remains invalid.

`potentiallyResetFocus()` consumes and clears Navigation's focus-change flag
before honoring that flag or the manual focus choice. Null and after-transition
both request the missing automatic focus operation. `potentiallyProcessScrollBehavior()`
skips an already-scrolled event and the manual choice; null and after-transition
request processing. Public `scroll()` bypasses the automatic/manual decision.
Processing sets the scrolled state before invoking its effect, as HTML specifies,
including when the still-unfinished effect throws. It never silently claims that
the viewport moved.

The remaining requirements are accounted for at these source boundaries:

| Requirement | Current owner and explicit dependency |
| --- | --- |
| Automatic focus reset | `NavigateEventImpl.potentiallyResetFocus()` stops after the implemented guards. HTML §6.6 must select the Document's autofocus delegate, fall back to body/document element, run focusing steps with the viewport fallback, and move the sequential focus navigation starting point. `interaction/focus.ts` has only a minimal area type; focus chains, inertness, shadow delegation, actual focus events, and viewport focus are not implemented. |
| Author/user focus changes | HTML's focus update steps must set `NavigationImpl.focusChangedDuringOngoingNavigation`. The field and consumer exist, but there is no real producer yet; tests supply that state explicitly. A separate Navigation-only activeElement would contradict the shared focus model. |
| Traversal scroll | `processScrollBehavior()` calls the navigable's active entry's `restoreScrollPositionData()`, independently of its current traversal entry, History's mode, and normal-restoration suppression. The user-scroll guard is implemented; actual saved positions, restorable regions, user-input/reset production, optional retries, and scroll anchoring remain explicit dependencies. `SPEC_CLASH(history-explicit-scroll-manual)` records WebKit's extra manual-mode check; the [§7.4.6.5 audit](../ROADMAP.md#html-7465-persisted-history-entry-state) records the browser probe. |
| Beginning versus fragment | `Document.indicatedPart` implements §7.4.6.4's HTML selection; other document types still require their MIME fragment rules. Null selects `scrollToBeginning()`; an element or the top sentinel selects `scrollToFragment()`. |
| Beginning scroll | `Document.scrollToBeginning()` awaits CSSOM View §3.1: viewport/scrolling-area beginning edges, current position and ongoing smooth scroll, and the root element supplied to the scroll operation. This is not invariably the numeric position (0, 0). |
| Fragment scroll | `Document.scrollToFragment()` updates retained target state for null/top/element. Ancestor revealing, CSSOM View scrolling into view, focusing with a viewport fallback, and the sequential starting point remain explicit dependencies. Manual **focus reset** does not suppress fragment scrolling's separate focusing step. |
| Callback reentrancy from automatic focus | Focus/blur listeners and their navigation/detachment effects need integration tests when the shared focus producer exists. This slice does not simulate those callbacks or claim their lifecycle ordering is complete. |

The standalone browser probe `node-compat/experimental/navigation-scroll-focus.mjs`
ran five cases on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All agree:
manual focus/scroll preserves the current button and offset for fulfilled and
rejected handlers; rejection does not perform automatic scroll; a handler's focus
change survives default focus reset; explicit scroll still reaches and focuses
the fragment under manual automatic policies. Second scroll and post-finish
scroll throw InvalidStateError. These cases require no new SPEC_CLASH choice.
The ordinary finishing/skip branches also match
[Blink](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigate_event.cc),
[Gecko](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/events/NavigateEvent.cpp),
and [WebKit](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/NavigateEvent.cpp).
Their full autofocus/layout implementations remain evidence for those future
owner audits, not behavior implemented by this slice.

The 22 finishing/selection tests cover state transitions, flag consumption,
manual/default policies, focus-before-scroll, failure skipping scroll, active-entry
selection, and explicit dependency failures. All 12 postcommit tests now use the
real finishing operation with manual choices, including idle fulfillment/rejection
and same-Agent cross-Window callbacks. They still isolate the §7.4 URL/history
effect; its real synchronous implementation is covered by the §7.4.4 suite.
No focus or viewport behavior is faked as production support.

Validation: all 226 selected tests across 14 suites pass on Node 24.19.0,
Node 26.8.1, and custom Node 27.0.0-pre, with and without the addon. Typechecking,
type-contract tests, touched-file lint, repository import checks, and whitespace
checks pass. No expected failures or skips were added, and no addon or engine
build was required.

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
| Same-document entry changes | §7.2.6.4 list mutation, tracker committed notification before callbacks, currententrychange, disposal, captured postcommit handlers, and script preparation/cleanup implemented. Intercepted reload and §7.4.4 synchronous URL/history updates reach this operation; traversal application remains unfinished. |
| Entries falling off a capped history list | HTML itself leaves disposal unspecified ([#8620](https://github.com/whatwg/html/issues/8620)); Browlet has no history-size cap. Revisit when implementing eviction, rather than silently discarding entries. |
| Request-policy URL hiding | Getter implemented. `createHistoryEntry()` still needs navigation's source-snapshot request referrer/policy capture; the destination response policy is not a substitute. Tests supply this retained state directly. |
| `updateCurrentEntry()` and its required-state dictionary | Implemented §7.2.6.6, with storage serialization and trusted `NavigationCurrentEntryChangeEvent` (§7.2.7.1). |
| Navigation lifetime during Document destruction | Destruction/global teardown must account for Navigation's EventTarget and queued disposal tasks. Reentrant serialization exposes this missing lifecycle integration; browser evidence is recorded above. |
| `navigate`, `reload`; options and NavigationResult | §7.2.6.7 preparation and results implemented; valid effects still stop at explicit Navigable dependencies. |
| Method trackers and committed/finished lifecycle | §7.2.6.8 state, setup, settlement, event abortion, and Navigable abort/child-destruction notifications implemented. Their navigation/traversal/destruction producers remain explicit above. |
| `traverseTo`, `back`, `forward` | §7.2.6.7 selection, no-op success, deduplication, source capture, and queued failure handling implemented. Traversal activation and traversal queue/history application remain explicit dependencies. |
| `transition` | §7.2.6.8 attribute, state/getters, event production, commit/abort, and postcommit settlement implemented, including original-transition protection. Manual interception commits synchronous URL/history changes and finishes; automatic focus/scroll, queued history application, and lifecycle integration remain explicit above. |
| `activation` | §7.2.6.9 interface, retained state, and update operation implemented; new-Document commits and Document reactivation populate it. Full traversal coordination, retained-Document form/visibility dependencies, and reload completion remain explicit. |
| `navigate` firing, cancellation and exceptions to firing | Preparation, shared dispatch, tracker acceptance, and cancellation are implemented, including restricted traversal cancellation and history-action consumption. History and ordinary navigation are connected producers; the latter applies its source/target/initial-document/scheme exclusions. Other lifecycle producers, input activation, and completion dependencies remain above. |
| Interception and asynchronous completion | Destination/event interfaces, interception registration, hash/download discrimination, transition creation, scroll validation, precommit controller/execution, synchronous URL/history commit, postcommit handlers/settlement, and finishing policy are implemented. Queued history application, loading UI, and automatic focus/scroll effects remain unfinished. |

The [§§7.2.7.1–3 event audit](../events/ROADMAP.md) confirms the existing
NavigationCurrentEntryChangeEvent and adds PopStateEvent and HashChangeEvent.
PageSwapEvent, PageRevealEvent, and PageTransitionEvent interfaces are also
implemented, with their View Transition, history-application, and rendering
dependencies explicit in that audit. Window's page-transition firing method is
used by the Document reactivation caller, with form/visibility and cache-retention
dependencies kept explicit in the retained-Document audit.
BeforeUnloadEvent's interface and legacy factory are also implemented; §8.1.8
handler processing and the unload-prompt producer remain separate dependencies.
The [§7.2.8 NotRestoredReasons interfaces](../ROADMAP.md#html-728-notrestoredreasons)
are implemented, with lifecycle collection and Navigation Timing still explicit.
Next area in document order: §7.3 navigables. Automatic focus remains
HTML §6.6 work; joint-history application, scrolling, traversal, and lifecycle producers
remain in §7.3/§7.4 and CSSOM View, with the boundaries above kept explicit.
