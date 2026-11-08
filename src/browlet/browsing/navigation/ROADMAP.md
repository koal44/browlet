# Navigation roadmap

This component owns browsing contexts, navigables, document creation, and
session history. It shares the `browsing/` family with `window/` and `policy/`;
outside consumers use its index, while its modules import each other directly.

## Present

- `browsing-context.ts` retains context/group relationships and creates the
  initial Window and about:blank document through the UserAgent's factory.
  Its nullable active Document is stored separately from the Window association;
  `Document.makeActive()` updates it before retargeting the WindowProxy.
  Creator/iframe inheritance and auxiliary-context creation are connected;
  the [§7.3.2.1 audit](#html-7321-creating-browsing-contexts) records the remaining consumers.
- `TopLevelTraversable.create()` registers the initialized entry and calls the
  UserAgent's provisional BiDi creation hook. `UserAgent.createFreshTopLevelTraversable()`
  adds the initial navigation request; that request still reaches `navigate()`'s
  explicit unfinished boundary.
- `UserAgent.createChildNavigable()` forwards to `Navigable.createChild()`,
  which prepares iframe child state and nested-history work;
  the final history update remains an explicit dependency.
  Iframe/object/frame `contentDocument` and
  `contentWindow` project the retained child through their existing bindings.
  Embed retains the same internal child association; its resource setup throws
  explicitly until Fetch, content selection, and navigation are connected.
- `UserAgent.destroyChildNavigable()` forwards to `Navigable.destroyChild()`.
  The coordinator detaches the child, notifies Navigation, requests recursive
  teardown, removes nested history, queues its update, and calls the provisional
  BiDi hook. `Document.destroyAndDescendants()` explicitly throws; automatic
  element removal remains unconnected until teardown and history queuing work.
- `TopLevelTraversable.destroy()`, `close()`, and `definitelyClose()` express
  top-level teardown and cancellation/unload coordination. Existing group removal
  and session-storage cleanup are connected, while cancellation, recursive
  unloading/destruction, and full history application remain throwing dependencies.
  UI removal and BiDi delivery retain explicit provisional UserAgent hooks.
- Document owns the ancestor, inclusive-ancestor, descendant, inclusive-descendant,
  and document-tree child collections. History-action activation consumption and
  COOP access-reporting ancestry use these shared algorithms.
- Navigable owns the direct child collection used by history selection, separately
  from Document's DOM walks. Traversable resolves a requested step to a retained
  step and selects changing/reloading, possible cross-document, and length/index-only
  navigables; applying their work remains the next coordinator boundary.
- `Navigable.findNavigableByTargetName()` searches the source subtree, its
  traversable, and then familiar contexts in the same group. `chooseNavigable()`
  uses it for existing named targets and coordinates new-target policy, activation
  consumption, COOP/noopener, creation, and sandbox bookkeeping. Activation lookup
  remains an explicit dependency; sandbox permission is implemented. Context
  familiarity checks active origins, live ancestry, and auxiliary openers. Named lookup limits that
  walk to the immediate opener; the
  [related-context audit](#html-7322-related-browsing-contexts) records its boundaries.
- `Navigable` prepares response policy inputs, selects the browsing context and
  Window/realm, and creates the destination document and history entry.
  Population prepares MIME and dispatches its admitted response through
  `loadDocument()`, retaining one reader across sniffing and consumption.
  `loadHTMLDocument()` starts HTML parsing with a supplied reader/script callback
  and coordinates completion or abortion; production setup remains explicit.
  Its bounded cross-document commit activates the entry; `Traversable` applies
  the history step and clears forward entries.
- `state/session-history.ts` models entries and nested histories for the active
  top-level traversable; `state/document-state.ts` retains their document/reload state.
- `diagnostics/` owns the §7.2.8 diagnostic implementations and backing records,
  below Document and Performance. Document collects and masks the records;
  TopLevelTraversable forwards to it. Performance captures available diagnostics
  when creating a navigation entry. Population forwards the target's masked
  diagnostics before activation; cache lifecycle producers remain separate dependencies.
- `events/` supplies PopStateEvent and HashChangeEvent and their declaration
  collection. Document's legacy event factory also creates HashChangeEvent.
  Automatic delivery remains history-application work; the
  [§§7.2.7.1–3 audit](events/ROADMAP.md) records the exact inputs, ordering, and
  browser differences.
- [History](../history/history.ts) supplies the Document-owned object, its
  attributes, and request preparation for its methods. This component owns the
  entry scroll mode and updates stored length/index through its existing
  top-level commit path. The lower [Navigation API](./api/navigation.ts)
  component supplies Window-owned identity, entry initialization and read access,
  and NavigationActivation. The top-level commit retains its previous active
  entry and initializes activation after the destination entry list, before
  parser scripts. Document history updates, retained-Document reactivation, and
  outgoing pageswap now have bounded producers, with form, visibility, unloading,
  and traversal completion dependencies recorded below and in the [API audit](./api/ROADMAP.md).
- `Traversable` owns its session-storage shed across Document replacements.
  Top-level creation clones the opener's top-level shed through the
  [Storage substrate](../../../storage/ROADMAP.md#storage-sheds), including
  the real auxiliary-context creation path.
  Final `UserAgent.removeTopLevelTraversable()` clears that traversable's session
  data after document teardown. Definite closing must reach this step only after
  queued unload cancellation and history/descendant destruction. Cancellation is
  implemented; teardown remains unfinished. Do not clear the session at close entry or Document destruction.
- `params.ts` carries response, policies, and timing. The destination is the
  Navigable receiving those inputs, so params need no reference back to it.
- Supplied responses reserve the destination environment and apply COOP before
  document creation. Required switches create a new context/group; report-only
  switches change its virtual identifier. The complete enforcement result can
  carry accumulated decisions across redirects. The [policy audit](../policy/ROADMAP.md#html-713-cross-origin-opener-policies)
  records reporting dependencies and the logical-isolation choice.
- `Navigable.checkResponseEmbedderPolicy()` implements COEP inheritance and
  owner-scoped reports. Supplied-response document creation calls it before
  changing contexts. The [COEP audit](../policy/ROADMAP.md#html-714-cross-origin-embedder-policies)
  records the missing child-creation lifecycle and Fetch navigation's CORP,
  policy-selection, and network-error-document consumers. A rejected response
  currently throws at the explicit network-error boundary.
- Response preparation now captures iframe referrer policy and combines iframe,
  node-Document, and response CSP sandbox flags. It installs response referrer
  and integrity policies and preserves Blob creator policies. Local non-Blob
  history entries retain the destination container. The
  [§§7.1.5–7.1.7 audit](../policy/ROADMAP.md#html-715-sandboxing) records
  selection precedence, clone rules, and remaining consumers.

The navigable survives changes of Document, Window, and environment. Preparing
a response can create a new environment while the old document remains active;
consumers use the created document's environment, not a stored environment on
the navigable. Initial about:blank creation still starts in `BrowsingContext`
before that document is used to initialize a navigable. The HTML response
handler uses the lower-level `loader/ResourceReader` to consume bytes and
`html/parser/HTMLDocumentParser` to parse them in the document's environment.

## HTML §7.2.5: History foundations

Audited the complete [History section](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-history-interface)
against HTML `404b3eb` (30 October 2026), on 31 October. This first implementation
slice stops before `go()`: it exposes `Window.history`, `History`,
`ScrollRestoration`, and the three attributes. History is an ordinary platform
object; it requires no new native integration.

`DocumentImpl.history` lazily retains its own implementation. Window's getter
selects its associated Document's object, so replacing the initial about:blank
Document creates a new History even when the Window/realm is reused. Activity
checks use History's relevant global's current associated Document, not a cached
owning-Document pointer. Borrowed accessors retain the receiver's environment.

The History state, length, and index slots begin at null, 0, and 0. Attribute
getters read stored state/length after checking full activity. State restoration
must later supply the deserialized value; the getter does not repeatedly clone
it. `scrollRestoration` reads/writes the active entry's mode, initially `auto`.
Web IDL performs enum conversion and ignores invalid enum strings before calling
the implementation, including on an inactive History. Actual scrolling is not
implemented by storing the mode.

`Traversable.getHistoryLengthAndIndex()` counts sorted distinct steps across
top-level and nested entry lists. Initial top-level creation seeds the first
length/index, and the existing synchronous push/replace commit updates the
destination's slots before activity notifications. The traversal queue and full
history-step application remain unfinished: updating nonchanging child Documents,
state restoration, events, and scroll/user-state restoration are later consumers.
The accessor does not substitute a live array length for the specified stored slot.

`SPEC_CLASH(history-inactive-state)` follows HTML's unconditional full-activity
check. In `node-compat/experimental/history-foundations.mjs`, a retained History
from a replaced initial Window returns cached null in Chromium 156.0.8078.4 and
WebKit 27.2, while Firefox 157.0 throws SecurityError. These are the observed
results on 31 October 2026, not a claim that Chromium/WebKit always return cached
state: the populated-state removal case behaves differently, including repeated
reads. Eric approved the HTML rule; source and regressions keep that choice.

The remaining passages were considered and retain these owners:

| Passage | Next implementation or dependency |
| --- | --- |
| `go`, `back`, `forward`, delta traverse | Request preparation is implemented below; actual traversal and reload remain explicit dependencies. |
| Shared push/replace steps | Preparation, the public methods, and navigate-event firing are implemented below. §7.4.4 now commits URL/History/Navigation state synchronously and queues finalization; §7.4.6 history application remains unfinished. |
| Can have its URL rewritten; URL table | Implemented on Document and covered by the complete example table: compare URL components, not security origins; HTTP(S), file, and other schemes have distinct path/query rules. |
| Optional state-entry limit | No quota is selected in this slice. If introduced, eviction must remove the entry after the Document's first entry, as specified. |
| Game and scroll-restoration examples | Require same-document updates, traversal/PopStateEvent, and scroll restoration. Exposing the foundation attributes does not make these examples functional. |

## HTML §7.2.5: Delta traversal requests

`go()`, `back()`, and `forward()` are ordinary `HistoryImpl` methods sharing
`deltaTraverse()`, exposed through automatic binding. Web IDL supplies the
signed-long conversion and zero default for `go`; back/forward supply -1/+1 directly, without calling an
author-replaceable `go`. The implementation checks its receiver's relevant
global's current Document for full activity, then consults the navigable's
implementation-defined blocking algorithm. A blocked request returns undefined.

A zero delta calls that Document's `Navigable.reload()` with its default inputs.
A nonzero delta calls `Traversable.traverseHistoryByDelta(delta, sourceDocument)`;
child History requests target their containing traversable, while reloading only
the child. Borrowed methods preserve the receiver Document and the method realm
for exceptions. Retained History objects follow the same activity and initial
Window-reuse rules as their attributes.

The §7.4.3 coordinators below now supply reload event/queuing and delta traversal's
source snapshot, retained initiator, and queued target selection. Supplying a
source denotes script involvement (`none`) and still requires Window transient
activation; omitting it denotes `browser UI` with null source/initiator. Target
selection and the out-of-range no-op occur inside the queue against then-current
distinct joint-history steps. The History entry point does not prefilter deltas
using its stored length. Applying the selected step still throws: §7.4.6 must
supply sandbox permission, cancellation/unloading, Document and state restoration,
history events, and scrolling.

`history-traversal.test.ts` exercises the projected API and observes requests at
these owner boundaries; it does not simulate successful history traversal or
reload. No native changes or new browser compatibility choices are required.

## HTML §7.2.5: Push/replace state preparation

`pushState()` and `replaceState()` are ordinary implementation methods sharing
`pushOrReplaceState()`. Binding converts the required unused string and optional
nullable USVString URL before entering the algorithm. Activity is checked before
`env.serializeForStorage()`; the existing storage serializer supplies a snapshot,
including cycles, rejects shared memory, and propagates state-getter exceptions.
The environment operation is composed at the Binding boundary, keeping its
context out of History. The Document URL and base are read after serialization,
which can execute author getters. Null and empty URLs bypass parsing entirely.

`DocumentImpl.canHaveURLRewritten()` compares scheme, credentials, host, and port,
then applies the HTTP(S), file, or other-scheme path/query rules. Origin equality
and `document.domain` do not grant rewrite permission. The tests include the
specification's full URL table, normalized hosts, and inherited/opaque origins.
The implementation-defined blocking policy runs only after serialization and
URL validation. History passes the same serialized record into the Navigation
event operation and, if that permits continuation, the URL/history update owner.

This preparation slice introduced
Window-owned `NavigationImpl`, exposed by the replaceable `Window.navigation` getter
and a nonconstructible EventTarget-derived IDL interface. Replacing the author
property does not change the internal owner. Initial Window reuse retains it;
new Windows receive new objects. Entry read access has since been added in the
[Navigation API slice](./api/ROADMAP.md). `firePushReplaceReloadNavigateEvent()` now
aborts previous navigation, handles disabled entries/events, and dispatches
the trusted event with its destination and tracker. Canceled History requests
return without updating URL/state. Precommit handlers run and can reject the
request. Navigate-event commit now holds the script context, selects its owner
operation, and settles its transition afterward. Navigation's same-document
entry/tracker/event updates and postcommit handler coordinator are implemented;
intercepted finishing now works with manual focus/scroll policies. Automatic
effects remain explicit dependencies. Accepted History changes now reach the
[§7.4.4 coordinator](#html-744-non-fragment-synchronous-navigations), which updates
URL/History/Navigation state and queues finalization. Full §7.4.6 application
still throws. Preparation tests isolate that later operation; the new URL/history
suite exercises real state changes and the finalization boundary.

The event operation keeps navigation type, destination URL, and same-document
status positional; all six optional spec inputs are grouped in
`PushReplaceReloadNavigateEventOptions`. Their documented defaults and concrete
types remain explicit. This options-record arrangement is reviewed; its
`SPEC_MISMATCH` marker is removed.

Browser-only probe: `node-compat/experimental/history-state.mjs`, run on
31 October 2026 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
Eric approved all three choices below; the markers also live in History's source.

- `SPEC_CLASH(history-state-serialization-order)`: follow the
  [shared algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#shared-history-push/replace-state-steps)
  and Firefox, checking full activity before state serialization. On an already
  inactive History, Chromium/WebKit instead execute state getters first and can
  throw their errors or DataCloneError before SecurityError. Blink's
  `core/frame/history.cc` serializes in the public methods before StateObjectAdded;
  Gecko's `dom/base/nsHistory.cpp` checks activity before delegating serialization.
  The intended early check is documented in [HTML #347](https://github.com/whatwg/html/issues/347)
  and its [editorial repair, #359](https://github.com/whatwg/html/pull/359): the
  blanket activity rule was easy to miss, so it was moved into each operation's
  steps. WebKit's `History.idl` instead declares a `SerializedScriptValue` input,
  causing Binding conversion to serialize before `History::stateObjectAdded()`
  checks activity. This explains the implementation ordering, but the research
  found no compatibility rationale for preserving that difference. Keep HTML's order.
- `SPEC_CLASH(history-state-url-encoding)`: follow HTML's encoding-parse operation
  and Firefox/WebKit. A windows-1252 Document produces `%E9` for `é` in a query;
  Chromium produces UTF-8 `%C3%A9`. The receiver's relevant environment determines
  parsing even when a different Window supplies the method.
  Blink's `History::UrlForState()` uses the two-argument KURL constructor, without
  a document-encoding override; Gecko passes `GetDocumentCharacterSet()` to
  `NS_NewURI()`, and WebKit uses `Document::encodingParseURL()`. HTML explicitly
  distinguishes [ordinary URL parsing from legacy encoding-aware parsing](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#resolving-urls).
  Chromium's own [windows-1252 History baseline](https://github.com/chromium/chromium/blob/main/third_party/blink/web_tests/external/wpt/html/infrastructure/urls/resolving-urls/query-encoding/windows-1252_include%3Dhistory-expected.txt)
  records both methods as FAIL: `%C3%A5` instead of `%E5` for `å`. This is evidence
  of a known conformance failure, not proof of why it remains unfixed. No deliberate
  compatibility exception was found; keep the specified Document encoding.
- `SPEC_GAP(history-state-detached-during-serialization)`: HTML checks activity
  before serialization, then dereferences the relevant Window's navigable without
  handling its disappearance. A getter removing its iframe causes all three
  browsers to throw SecurityError, with the getter read once, for both methods
  and null, empty, or nonempty URLs. Browlet guards that missing navigable with
  SecurityError at the later dereference; it does not add an earlier repeated
  activity check. Navigate-event reentrancy and its own activity checks remain
  part of the unfinished §7.2.6 dependency.
  Blink and WebKit's later checks naturally see the detachment after serialization.
  Gecko also rechecks the Document and principal after cloning in
  `nsDocShell::AddState()`, explicitly citing [Mozilla bug 634834](https://bugzilla.mozilla.org/show_bug.cgi?id=634834).
  That historical security fix concerns reentrant cross-origin navigation, rather
  than this exact iframe-removal case: an earlier check did not survive author
  code executing during serialization. It supports revalidation after that code.
  Keep the narrow missing-navigable guard; do not substitute it for the Navigation
  event algorithm's later lifecycle checks when those are implemented.

The rationale follow-up on 31 October 2026 leaves all three recommendations
unchanged. The mechanisms above are visible in the source; an intentional reason
to diverge is not inferred merely from present browser behavior. These are HTML
and Binding choices and require no engine workaround in Browlet.

All three browsers also preserve DataCloneError-before-URL-error ordering and
select the URL after a reentrant state getter changes it. Production tests cover
those orderings, cancellation and exception forwarding, storage-only restrictions,
and receiver/method realm selection. No state-entry quota is selected; the
optional eviction rule and the interactive examples remain accounted for above.

## Missing

Window's [§7.2.2.1 entry points](../window/ROADMAP.md#html-7221-opening-and-closing-windows)
now expose name/closed state and delegate `stop()` to `Navigable.stopLoading()`.
That operation is explicitly unfinished: it must use the unload counter and
ongoing-navigation state, preserve traversals, and abort the active Document
and its descendants. `isScriptClosable` implements the history/web-creation
predicate, but source snapshots, incumbent-context selection for familiarity,
sandbox navigation permission, and definite closing remain prerequisites for a
successful `Window.close()`.
Opening now coordinates feature processing, target selection, new/existing
branches, and return rules. `Navigable.chooseNavigable()` handles empty, `_self`,
`_parent`, and `_top` names and calls the existing-target lookup coordinator.
Named lookup applies sandbox permission but still needs source activation.
New-target selection now supplies popup policy, activation consumption,
COOP/noopener, and sandbox propagation. Both auxiliary and null-opener creation
now use their context factories; feature setup and navigation remain unfinished.
The empty-name branch applies to direct algorithm
callers; `Window.open()` normalizes its empty target to `_blank` first.

The opening flow calls operations on their existing owners:
`BrowsingContext.setUpFeatures()` for CSSOM View positioning/sizing,
`DocumentImpl.updateURLAndHistory()` for the new target's about:blank URL/history
update, and `Navigable.navigate()` for document-initiated navigation. That last
method now accepts the URL, source Document, and all remaining specification
inputs through `NavigateOptions`, defined beside Navigable. Navigation now consumes
those defaults through admission, event dispatch, snapshots, and history preparation.
The options arrangement is reviewed; its former `SPEC_MISMATCH` is removed. POST resources,
responses, serialized state, form entries, and source elements retain their
existing concrete types. `NavigationHistoryBehavior` includes `auto`, while
resolved commit/history-update inputs use `HistoryHandlingBehavior` (`push` or
`replace`). Feature setup still throws. Initial URL/history updates now reach
§7.4.4's synchronous commit and queued history-application dependency; navigation
retains the explicit recursive-abortion and history-entry population dependencies.

`NavigationAPIMethodTracker` is now owned by `../navigation/api/method-tracker.ts`;
the former opaque `navigation-api.ts` stub in this coordinator has been removed.
The class owns creation, commit notification, completion/rejection, and cleanup,
but navigation/event producers must still call those operations. The lower
`../navigation/api/` component now supplies Navigation's
Window-owned entry lists, NavigationHistoryEntry read access, and the unfinished
navigate-event entry point. Its [entry work](./api/ROADMAP.md) connects new-Document
initialization to the existing top-level commit, with shared session-history
keys/IDs/state and the contiguous same-origin selector. State updates now fire
current-entry-change events, and reactivation reconciliation queues disposal;
the §7.4.6.2 Document reactivation caller now supplies inputs before `pageshow`,
with form reset, visibility transitions, and the bfcache coordinator still explicit below.
`Navigation.navigate()`/`reload()` now prepare requests with serialized state and
real trackers. Its traversal methods also select/deduplicate destinations and
prepare queued history work and failure delivery. §7.2.6 supplies same-document
entry commits, event-driven acceptance/settlement, and finishing policy;
automatic focus/scroll effects remain unfinished. The full `navigate()` input
contract and tracker lifecycle do not make document-initiated navigation functional.

`SourceSnapshotParams`, in the shared `navigation/state/source-snapshot.ts` foundation,
captures all five source fields, including policy cloning and the null browser-UI
case. The non-null source still requires Window's unfinished transient activation.
Navigation API traversal, navigation startup, and delta traversal now use it;
Window closing authorization remains a later consumer. `Traversable.appendSessionHistoryTraversalSteps()` now
executes through the §7.4.1.3 queue. `applyTraverseHistoryStep()` exposes the §7.4.6
application contract, including all four history-step outcomes. It now checks
permission and cancellation, then stops before population/activation. The Navigation API roadmap records
its prepared callback, queued rejection rules, and approved obsolete-tracker guard.

Location's [href/assign/replace handoff](../window/ROADMAP.md#html-724-third-slice-href-assign-replace-and-navigation-handoff)
now calls that same `navigate()` entry with an entry-parsed URL, the incumbent
Window's associated Document, exceptions enabled, and automatic/replacement
history handling. Navigation still owns permissions, source snapshots, fetching,
and history effects. Window transient activation remains an explicit §6.4
dependency for writes before complete loading. Retained Locations target the live
relevant Document's node navigable when the old Window is inactive; this accepted
resolution of HTML's missing target rule is documented with Location.
Location's component setters use the same handoff with a parsed copy of the live
Document URL; the [component audit](../window/ROADMAP.md#html-724-fourth-slice-url-component-setters)
records their parsing and encoding rules.

Location's [reload handoff](../window/ROADMAP.md#html-724-fifth-slice-reload-preparation)
now checks its entry origin and calls the live Document's `Navigable.reload()`.
That operation accepts all optional spec inputs through `ReloadOptions`, beside
`NavigateOptions`: serialized Navigation API state (default null), user involvement
(default `none`), and API method tracker (default null). The options-record
translation is reviewed and accepted. The coordinator now
consumes those inputs: it selects the active entry's state unless supplied state
is non-null, fires the cancelable reload navigate event except for browser UI,
and forwards the tracker to existing event machinery. Cancellation or interception
returns before marking `reloadPending` or appending traversal work. Otherwise the
active state is marked and the traversable's queue calls
`applyReloadHistoryStep()` for unload cancellation. Request construction supplies
ordinary reload revalidation; dispatching population, unloading, replacement,
restoration, and Navigation entry/activation updates remain §7.4.6 work. The
[reload audit](#html-743-reload-coordination) records coverage and browser evidence.

HTML §7.2.6.8's Navigable notification operations are now implemented: callers
supply their executing event loop, or null for parallel work; abortion runs on
the active Window's loop or queues a global navigation-and-traversal task there.
It repeatedly cancels reentrant NavigateEvents. Child-destruction notification
also rejects a snapshot of pending traversal trackers. These helpers do not
implement `stopLoading()` or recursive child teardown. The ongoing-navigation
state and setter are implemented and re-audited under §7.4.2.5 below.
Their exact caller obligations and pending signature review are in the
[Navigation API audit](./api/ROADMAP.md#seventh-slice-navigable-abortion-and-child-destruction-notifications).
Revisit the provisional caller-loop parameter when wiring production callers;
the [deferred decision](./api/ROADMAP.md#deferred-decision-caller-loop-parameter)
requires comparing a parameter-free handoff through their existing Documents/environments.

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `../history/history.ts` and navigation owners | classic state restoration and synchronous URL/history effects are implemented; traversal/reload application remains unfinished | HTML §7.2.5 and §2.7 |
| existing `api/navigation.ts` | Navigation state, results/options, entries, ongoing navigation, activation, and focus/scroll policy are implemented; history effects, rendering, and lifecycle callers remain | HTML §7.2.6 |
| existing `api/navigation-transition.ts` and `api/navigation-destination.ts` | Transition/destination state, interfaces, and commit/completion promise settlement are implemented; owner effects remain explicit | HTML §§7.2.6.8 and 7.2.6.10.3 |
| existing `api/navigation-history-entry.ts` | Read interface, state, reactivation and same-document disposal implemented; full reload/session restoration remains | HTML §7.2.6 |
| existing `events/navigation-current-entry-change-event.ts` | Implemented for state and same-document entry updates; full history-application caller remains | HTML §7.2.7.1 |
| existing `api/navigate-event.ts` | Event dispatch, interception, precommit/commit/postcommit execution, synchronous URL/history effects, success/error, and finish policy are implemented; queued history application, automatic focus/scroll, and lifecycle producers remain | HTML §7.2.6 |
| `events/` | Interfaces through BeforeUnloadEvent, the legacy factory entries, and Window's page-transition firing method are implemented. Lifecycle callers and handler processing remain separate. | HTML §7.2.7 |
| `diagnostics/not-restored-reasons.ts` | Diagnostic interfaces, recursive creation, Document-tree collection/masking, and target-history Navigation Timing capture are implemented; lifecycle callers remain | HTML §7.2.8 and §7.4.6.2 |
| `traversal.ts` | Traversal queue, apply history step, back/forward/reload | HTML §§7.4.1, 7.4.3, and 7.4.6 |
| `state/` | Complete document/session-history state and persisted user state | HTML §§7.4.1–7.4.2 |

Existing modules still need fragment navigation, `javascript:` URLs,
download/POST handling, nested navigables, reload, traversal, unloading,
ongoing-navigation cancellation, and full history-step application (HTML
§7.4).

Failed/aborted navigation and cross-origin redirect replacement must run
`reservedEnv.discard()` before releasing the reserved environment. The operation
implements the Service Workers client discarded flag. Cross-origin redirects and
population failure now call it; the remaining aborted-navigation and worker-startup
consumers still need their lifecycle integration.

The Fetch navigation loop must obtain and enforce COOP for each top-level
response, preserve both accumulated switch flags, and supply whether the
preceding response initiated the navigation. The supplied-response adapter
starts from the active document and browser-UI source state; it cannot reconstruct
redirect policies from a final response alone. Sandboxed non-unsafe-none COOP
responses require network-error processing, currently an explicit guard.
Policy selection now implements history/srcdoc/initiator/response precedence,
but full navigation must capture source/target policies and supply its actual
history state. Inline-srcdoc creation must combine inherited CSP before selecting
its origin. Initial blank and auxiliary creator inheritance now run in context
creation; history reconstruction and navigation-source capture remain unfinished.

`isNavigationOrHistoryUpdateBlocked()` is HTML's implementation-defined
navigation/history throttle; Browlet currently chooses not to throttle. It is
not the sandbox navigation-permission check. Navigation/history application
still needs source/target/activation inputs at the unfinished history-application
callers. Target selection populates the context's `onePermittedSandboxedNavigator`,
and navigation permission consumes it. Activation, external handoff, dialogs,
and download dependencies remain explicit in the sandbox audit.

Document now retains the §3.1.5 `previousDocumentUnloadTiming` record with zero
defaults. The unloading/navigation algorithms must capture the old document's
unload-event start/end times and supply them to the destination document;
allocation of the record does not implement that producer.

Document implements [§3.1.3 ancestor-origin snapshots](../../html/ROADMAP.md#section-313-ancestor-origins).
Child navigation must populate the navigable/container association and capture
iframe referrer policy. The §7.1.6 policy-selection operation and current preparation
callers exist. Creation passes the known container document to
ancestry initialization before activation, or uses the embedder's node document
before an initial navigable exists. Do not substitute the parent navigable's
active document for the embedding element's node document.

Iframe, object, embed, and legacy frame implementations retain an initially-null
`contentNavigable`. Document's `getDocumentTreeChildNavigables()` collects these
associations in tree order for Window's §7.2.2.2 length getter, excluding shadow
trees and returning an empty list when the Document has no node navigable.
The setters maintain the reverse `Navigable.container` link for all four types,
including clearing, replacement, and reassociation. Document full activity follows
the actual container Document recursively; a child without a container is not
fully active. Container reassociation and ancestor activity changes now notify
child Documents recursively, including shadow-tree containers, so timers and
queued tasks can resume. Child creation/destruction must still populate and clear
these associations. `Navigable.activeWindowProxy`
provides the active document's stable proxy once that relationship exists;
the field and accessor alone do not create nested browsing contexts.
Browsing-context creation still accepts an iframe embedder; object/embed/frame creation
must extend those inputs when their lifecycles are introduced. Sandboxing and
iframe referrer-policy rules remain restricted to iframe containers. Response
preparation explicitly rejects object/embed/frame containers pending their sandbox
inheritance audit, rather than treating them as absent embedders. WindowProxy
numeric access additionally needs container insertion
order, which differs from the Document list's tree order; see the
[Window audit](../window/ROADMAP.md#html-7222-indexed-access).

The [resource metadata slice](../../html/ROADMAP.md#section-314-resource-metadata)
retains `Document.cookieURL` independently of the document and base URLs.
`NavigationParams.cookieURL` starts with the response URL. Initial blank creation
copies the creator's cookie URL once creator support exists; srcdoc navigation
must capture the embedder's cookie URL, and later blank navigation must capture
the initiator's. Supply those inputs with inherited origin/base/policy state,
including the cookie URL when sandboxing makes the origin opaque. That allows
the cookie accessor to throw rather than silently deny sandboxed srcdoc access.
Do not recover the URL from an origin or consult the live parent on each access.
History restoration must retain it when recreating a Document, while
push/replace-state and fragment changes leave it alone. See
[WHATWG HTML #332](https://github.com/whatwg/html/issues/332) and the approved
clashes in the metadata audit.

Navigation/form request construction must set Fetch's `isFormSubmission` for
GET and POST forms, so Upgrade Insecure Requests can distinguish cross-origin
forms from ordinary links. At both navigation-download and hyperlink-download
handoff, apply `response.isMixedDownload(sourceDocument.url, env)` to the full
response URL list before accepting the download. The policy algorithms and
reviewed upgrade choices are tracked in the [policy roadmap](../policy/ROADMAP.md#mixed-content-and-upgrade-insecure-requests).

All push, replace, traversal, reload, and cross-/same-document commits must
converge on the centralized session-history modification and history-step
algorithms. Public History or Navigation methods must not mutate the arrays
directly, even while only a single top-level traversable is supported.

Blink spreads this path across `core/frame` and `core/loader`; Browlet keeps
the state machine here while response acquisition and resource loading belong
in `loader/`.

## HTML §7.2.8: NotRestoredReasons

The [entire section](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-notrestoredreasons-interface)
was read, including both creation algorithms, every getter, backing-record
defaults, the reason catalogue, and Document's history-entry accessor. The local
HTML source at `404b3eb` agrees with the live standard dated 2026-10-30.

`NotRestoredReasonDetailsImpl` retains one detail record; `NotRestoredReasonsImpl`
retains its scalar backing record and recursively creates detail/child objects
from the supplied lists. These internal constructors perform HTML's creation
operations, with the owning environment supplying the realm. There is no author
constructor. Required nullable record fields express the initially-null slots;
creation takes an initialized backing record rather than exposing a temporary
object with a null backing slot.

The shared `NotRestoredReasonDetails` and `NotRestoredReasons` interfaces live
beside their implementations, and each implementation satisfies its interface.
Document/history data and implementation instances can therefore use the same
shape. The implementation retains a parsed URL; the declared Web IDL getter
serializes it. Recursive creation still allocates fresh detail/child identities
in the chosen realm, including when its input is another implementation.
`DocumentState` imports only the shared type; there is no separate state module.

`src`, `id`, `name`, and each detail's `reason` read their retained data. The
platform `url` getter returns null or serializes the implementation's URL.
Null lists remain null, empty lists
remain empty, and list membership is captured at creation. Binding projects and
caches the resulting frozen arrays in the receiver's realm on first access,
using the automatic FrozenArray attribute binding shared with MessageEvent's
retained ports array. Thus deferred
platform allocation cannot incorporate later backing-list additions or move
arrays into a borrowed getter's realm. This keeps platform allocation outside
the implementation and needs no new engine facility.

Both `[Default] toJSON()` operations use Web IDL's existing machinery. Each call
creates an ordinary object in the called method's realm, reads the declared
attributes rather than author-shadowed properties, and preserves nested platform
objects and frozen-array identities. `JSON.stringify()` subsequently invokes the
nested objects' JSON operations. It is distinct from recursively copying all
diagnostics into plain objects during `toJSON()` itself.

`Document.notRestoredReasons` is an internal accessor, not a new Document IDL
attribute. It selects the active top-level traversable's session-history record;
child, detached, and inactive Documents return null. It does not collect records
or populate a new entry. `DocumentState.notRestoredReasons` now has the recursive
record type instead of an opaque object and still starts at null.

### Browser evidence and approved choices

The browser-only probe is `node-compat/experimental/not-restored-reasons.mjs` in
the independent Experimental repository. It performs a real navigation/back
sequence with an unload blocker. On 2026-11-01, Chromium 156.0.8078.4 exposed both
nonconstructible interfaces and the Navigation Timing attribute. Firefox 157 and
WebKit 27.2 exposed neither interface nor the timing attribute in the tested builds.
The Chromium sample contained a `masked` detail and an empty children list; it
does not establish behavior for an observed nonempty child tree.

- `SPEC_CLASH(not-restored-reasons-array-identity)`: HTML creates each frozen
  array once and returns it. Chromium returns a different frozen array for each
  getter access. Browlet follows HTML, as approved.
- `SPEC_CLASH(not-restored-reasons-json)`: HTML's default operation retains those
  arrays and their nested platform values, with keys in IDL order
  (`src`, `id`, `name`, `url`, `reasons`, `children`). Chromium's custom operation
  produces mutable arrays and plain reason objects, and places `url` before
  `name`. Its source recursively converts children as well. Browlet follows
  HTML and the existing Web IDL default operation, as approved.

Blink's [implementation](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/timing/not_restored_reasons.cc)
and [IDL](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/timing/not_restored_reasons.idl)
explain those differences: vector-returning getters and a custom `toJSON` method.
Its IDL also uses DOMString for `src`/`url`, where HTML uses USVString. Browlet
keeps HTML's declarations; the backing contract requires a scalar source
string and a URL record. The §7.4.6.2 collector now enforces that scalar-string
contract on raw iframe source text when URL parsing fails; ID/name remain DOMStrings.

### Remaining producers and consumers

| Dependency | Current boundary and later work |
| --- | --- |
| Document blocking details | `makeUnsalvageable()` already records individual details and clears salvageability. Existing abort/destroy paths supply `fetch`, `parser-aborted`, and `websocket`; this slice does not change their triggers. |
| Mandatory reason producers | Failed history population records `navigation-failure`, and the top-level diagnostic builder records `masked` for hidden blockers. `lock` still needs Web Locks lifecycle integration; optional UA cache-policy producers remain separate. Having a string field does not implement those features. |
| Tree collection | `Document.buildNotRestoredReasonsForDocumentState()` implements HTML's [document-state builder](https://html.spec.whatwg.org/multipage/browsing-the-web.html#build-not-restored-reasons-for-document-state): capture URL and iframe metadata, clone blocking-detail membership, recurse through shadow-including child containers, and assign each active history state. See the §7.4.6.2 audits below for the approved collection, metadata, and shadow-tree corrections. |
| Cross-origin filtering | `TopLevelTraversable.buildNotRestoredReasons()` implements the [top-level builder](https://html.spec.whatwg.org/multipage/browsing-the-web.html#build-not-restored-reasons-for-a-top-level-traversable-and-its-descendants): collect, compare strict Document origins, hide foreign URL/reasons/children, and retain a generic masked blockage in the root report. Blockers anywhere behind a foreign ancestor count; same-origin descendants behind it remain unreachable through the filtered tree. |
| Cache lifecycle | Admission, eviction, unloading, restoration, and failed-history navigation must retain or replace diagnostic records at their specified steps. Interface creation does not provide a back/forward cache. |
| Navigation Timing | History population forwards the target DocumentState's masked diagnostics before activation and loader callbacks. The entry retains them in its own realm; child entries receive null and redirects drop the replaced state's diagnostics. See the [consumer contract](../../performance/ROADMAP.md#restoration-diagnostics-handoff). |

`SPEC_CLASH(not-restored-reasons-collection)` records three producer problems.
The §7.4.6.2 builders resolve all three as approved: initialize children as a list,
read each recursively collected history-state record instead of the child's
top-level-only accessor, and refresh the root snapshot after adding `masked`.
HTML adds that detail only after copying the root's blocking-detail list.
The following masking audit also records the hidden-subtree and shadow-tree
corrections needed to make collection and filtering agree.

The section's user-agent-specific reasons are optional cache-policy choices,
not additional conditions that this slice may silently impose. The entire
catalogue remains a dependency on the listed owners:

| Owner/policy area | Listed optional reason strings |
| --- | --- |
| Media, device, and user interaction | `audio-capture`, `idledetector`, `keyboardlock`, `mediastream`, `midi`, `modals`, `otpcredential`, `paymentrequest`, `pictureinpicturewindow`, `plugins`, `rtc`, `sensors`, `smartcardconnection`, `speechrecognition`, `storageaccess`, `video-capture`, `webhid`, `webshare`, `webxrdevice` |
| Network and cache policy | `outstanding-network-request`, `request-method-not-get`, `response-auth-required`, `response-cache-control-no-store`, `response-cache-control-no-cache`, `response-keep-alive`, `response-scheme-not-http-or-https`, `response-status-not-ok`, `rtc-used-with-cache-control-no-store`, `websocket-used-with-cache-control-no-store`, `webtransport`, `webtransport-used-with-cache-control-no-store` |
| Worker, messaging, database, and background lifecycle | `background-work`, `broadcastchannel-message`, `idbversionchangeevent`, `serviceworker-added`, `serviceworker-claimed`, `serviceworker-postmessage`, `serviceworker-version-activated`, `serviceworker-unregistered`, `sharedworker`, `sharedworker-message`, `sharedworker-with-no-active-client` |
| Navigation and browsing-context lifecycle | `navigating`, `navigation-canceled`, `non-trivial-browsing-context-group`, `unload-listener` |

The record keeps a string, matching DOMString, rather than a new closed enum.
The cache-policy audit must choose applicable optional conditions and supply the
listed reasons; implementing an interface does not enable those policies.

### Validation

The 17 focused tests cover nonconstructibility, null/empty distinctions, recursive
creation, URL serialization, captured list membership, retained backing scalars,
array freezing/identity, default JSON behavior, borrowed getters/methods, retired
realms, active top-level history selection, and the explicit collection/masking
dependency. The original 15 interface tests passed on Node 24.19.0, Node 26.8.1,
and custom Node 27.0.0-pre, with and without the addon. The shared-interface
revision also verifies creation from another implementation while preserving
fresh child/detail identities in the destination realm. Its Node 26/compat run
passes all 44 tests across the diagnostic, Document-destruction, Web IDL realm,
and sequence-conversion suites.
Generated declarations, typechecking, type contracts, touched-file lint, import
checks, and whitespace checks pass. No expected failures, skips, addon builds,
or engine changes were needed.

## HTML §7.3 and §7.3.1: Navigable foundations

Audited the [introduction and navigable definition/initialization](https://html.spec.whatwg.org/multipage/document-sequences.html#navigables)
against refreshed HTML `404b3eb` on 1 November 2026. This slice stops before
§7.3.1.1 (traversable navigables); it does not complete the traversal queue or
the child/top-level lifecycle algorithms.

The existing graph matches the introduction: a Navigable retains its identity
across Documents and browsing-context switches, each BrowsingContext retains
one WindowProxy, and Traversable owns joint history. The COOP switching path
already uses this distinction. Initial browsing-context creation precedes
Navigable construction, so the constructor also records their association.

| Requirement | Implementation and remaining dependency |
| --- | --- |
| Unique internal ID; nullable parent | Each Navigable gets a distinct Symbol and retains its parent. Nested histories use that identity. |
| Current and active entries | Separate storage is retained. Either entry can advance independently; active Document/context/WindowProxy/Window and target name derive from the active entry. |
| Mutation ownership | Current-entry changes belong to the traversable's history traversal queue; active-entry changes belong to the active Document's event loop. The queue now runs ordinary/tagged steps, but provisional local commits and history application still bypass the required queue/dispatch ownership. Field and operation comments retain those dependencies. |
| Closing/load-delay flags | Both start false. Closing is for top-level traversables; load delay is for children. Definite closing and child loading remain later lifecycle producers. |
| Navigation/history admission | The implementation-defined boolean query continues to permit all requests. It is not a substitute for sandbox/activation checks in their specified algorithms. |
| Active views and target name | Existing getters select the active entry and its browsing context/WindowProxy. `Document.makeActive()` retargets that proxy; the provisional commit already invokes it. |
| Node navigable | The operation now lives on Node, including Document by inheritance. It selects the current node Document's active navigable, independently of the node's connection to a tree; adoption and history replacement change the result. |
| Initial history entry | The constructor retains the supplied Document state and Document URL, sets current and active to the same entry, and leaves the step pending. The caller still assigns the history step. The non-null Document assertion is represented by `DocumentBackedState`. |
| Initial visibility | Document now stores the initially-hidden state and exposes `hidden`/`visibilityState`. Initialization selects the nearest traversable's system state before notifying activity observers. Traversable finishes this after its own fields are initialized. |

The two examples of current/active divergence are accounted for: the tests
advance the active entry independently and advance the current entry while
leaving all active views unchanged. Actual synchronous-navigation queue
handling and non-displayable, non-error responses are still §7.4 work. Likewise,
safe reads of the active Document from the traversal queue depend on that queue
and its same-Document synchronous-update rule; this slice adds no ambient loop
guess or substitute queue.

### Visibility dependency

The existing provisional history commit also calls
`Document.setInitialVisibilityState()` after `makeActive()`, as required by
[activate history entry](https://html.spec.whatwg.org/multipage/browsing-the-web.html#activate-history-entry).
Thus replacement Documents receive the state before parser scripts run.
Full history activation/restoration remains unfinished.

This is only the state-assignment part of HTML §6.2 initial visibility setup.
The method's TODO names the required `VisibilityStateEntry` with timestamp 0;
PerformanceEntry, Timeline buffers, and observer delivery now exist; the visibility
entry producer and its insertion into the Timeline remain unfinished.
The [Performance roadmap](../../performance/ROADMAP.md#initial-visibility-dependency)
owns that dependency. Initialization deliberately emits no visibilitychange event.

The traversable's existing host default is visible. A later §6.2 pass must
connect host visibility changes to tasks for inclusive descendant Documents,
the ordinary visibility-update algorithm, current-time performance entries,
Screen Orientation, View Transitions, Device Posture/Web NFC hooks, and bubbling
visibilitychange dispatch. Directly changing the internal system state does
not implement those effects. Document's `onvisibilitychange` remains an explicit
handler dependency; no duplicate event-handler machinery is introduced here.

### Validation

`navigation/navigable.test.ts` covers initial hidden state, visible top-level
initialization before activity callbacks, both inherited child visibility
states through two levels, replacement-document activation, disconnected and
adopted Node lookup, and independent current/active views. The existing
document-lifecycle suite covers pending entries, activity, context/proxy reuse,
and null-Document states. No browser disagreement or new runtime accommodation
was needed for this slice.

All seven new tests pass on Node 24.19.0, Node 26.8.1, and custom Node
27.0.0-pre, with and without the addon. Together with document-lifecycle, each
addon run passes 41 tests; each stock run passes 38 and retains the three
existing native-global expected failures. Generated declarations, typechecking,
type contracts, touched-file lint, import checks, and whitespace checks pass.
No addon or engine rebuild was needed.

## HTML §7.3.1.1: Traversable navigables

Audited the complete [traversable definition and lookup](https://html.spec.whatwg.org/multipage/document-sequences.html#traversable-navigables)
against HTML `404b3eb` on 1 November 2026. This is a state/lookup slice, stopping
before §7.3.1.2 (top-level traversables).

All six fields are accounted for. `currentSessionHistoryStep` starts at 0;
each traversable has its own initially-empty `sessionHistoryEntries` list and
`SessionHistoryTraversalQueue`; `runningNestedApplyHistoryStep` and
`isCreatedByWebContent` start false. The system visibility state retains
Browlet's visible default, with the initial Document assignment and missing
host-change integration described in the preceding audit. The existing
`Navigable.traversable` lookup starts at the input itself and walks parents
until it finds a Traversable. No replacement ancestor registry is needed.

The queue now holds the specified ordered `algorithmSet`. Items are callable
steps; synchronous navigation steps additionally carry `targetNavigable`.
This preserves their distinct role for history application's queue selection
without adding a second queue or changing the existing append signature.

The field now starts a queue using the initial Document's UserAgent, retaining
that browser owner rather than the Document or its event loop:

- [§7.4.1.3](https://html.spec.whatwg.org/multipage/browsing-the-web.html#starting-a-new-session-history-traversal-parallel-queue)
  now supplies serial in-parallel draining and both ordinary and tagged
  synchronous-navigation append operations. Returned internal completion promises
  keep the queue occupied until the current algorithm finishes.
- [Apply the history step](https://html.spec.whatwg.org/multipage/browsing-the-web.html#sync-navigations-jump-queue)
  must coordinate document-population/continuation waits and select eligible
  synchronous navigation steps from that same set, using the per-navigable wait
  set and `runningNestedApplyHistoryStep` guard. That flag's source comment now
  identifies its missing producer.
- Infra's `ParallelQueue` supplies ordinary private FIFO draining; it does not
  expose this selective removal or history-application coordination. Do not
  substitute it wholesale or bind a traversable's lifetime to its initial
  Document's event loop: the traversable spans Documents and descendant Agents.
- The broader responsibility to control its own and descendants' current and
  active entries still depends on §7.4 history application. Existing top-level
  commits remain provisional. Auxiliary creation must later mark web-created
  traversables; the existing flag alone does not implement window opening.

Focused coverage checks all six defaults, separate mutable entry/algorithm
collections across traversables, and inclusive lookup through child and
grandchild navigables. This adds no native integration or scheduling behavior.
Node 26.8.1/compat passes all 58 tests across the navigable, Navigation traversal,
and Navigation commit suites; stock Node 26 passes all nine navigable tests.
Typechecking, touched-file lint, import checks, and whitespace checks pass.
No new failure classifications or addon builds were needed.

## HTML §7.3.1.2: Top-level traversables

Audited the complete [top-level traversable subsection](https://html.spec.whatwg.org/multipage/document-sequences.html#top-level-traversables)
against HTML `404b3eb` on 1 November 2026, stopping before child navigables.
The definition, owner set, ancestor lookup, creation, and fresh-creation
algorithms are all accounted for.

`TopLevelTraversable` initializes with a null parent. `UserAgent` already owns
its own top-level set, and `Navigable.topLevelTraversable` walks to the outermost
ancestor. HTML currently permits only top-level traversables; the separate
Traversable base does not implement a new kind of embedded traversable.

### Creation and registration

The existing `TopLevelTraversable.create()` follows both context-selection
branches: a null opener creates a top-level context/group; a supplied opener
creates an auxiliary context in the opener's top-level group. It captures the resulting
Document, initiator origin, origin, target name, and about base URL in document
state; initializes the navigable; assigns step 0; and appends the initial entry.
The existing provisional History length/index initialization remains in place.
Queue startup and initial visibility's performance entry retain the preceding
audits' explicit dependencies.

For an opener, session storage is cloned from its **top-level** traversable,
including when the opener is a child. The existing Storage implementation and
focused clone test cover separate destination maps. The §7.3.2.1 follow-up supplies
creator origin/base URL, policy/referrer inheritance, opener/group relationships,
and the new Window environment. The clone test now uses the real factory;
`window.open()` still needs feature setup and navigation.

After registration, creation now calls
`UserAgent.webDriverBiDiNavigableCreated(traversable, openerNavigableForWebDriver)`.
The optional automation opener is kept separate from the actual browsing-context
opener, and omission becomes null. A failed context factory causes neither
traversable registration nor a creation notification. This uses the existing
UserAgent automation-hook arrangement; notification delivery remains provisional.

### Fresh creation

`UserAgent.createFreshTopLevelTraversable(url, postResource = null)` creates an
unnamed top-level traversable without an opener, then invokes its navigation
operation with the new traversable's own active Document as source and the
unchanged POST resource as `documentResource`. This preserves HTML's
self-initiated security checks. It does not mark the traversable as web-created.

The preparation algorithm is connected, but `Navigable.navigate()` still throws
at its explicit §7.4 dependency. Full source snapshot/security/Fetch/history
coordination must precede end-to-end use; this method does not call the
route-based convenience loader as a substitute. Tests replace only the
navigation operation to inspect the initialized owner, exact request inputs,
and creation-before-navigation ordering.

### BiDi contract conflict and missing consumer

Refreshed WebDriver BiDi to `f922e6a` (8 October 2026).
`SPEC_CLASH(bidi-navigable-created-inputs)` records that HTML passes a navigable
and optional opener, while [BiDi's current operation](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigable-created)
requires `(navigable, has planned navigation, opener navigable = null)`.
HTML supplies no planned-navigation boolean. The reviewed hook follows HTML's
call shape. No boolean or event timing is
chosen in this slice.

Before enabling that consumer, automation must reconcile the input contract,
retain original-opener state, apply scoped cache overrides, register context
identifiers, select subscribed sessions, and emit `browsingContext.contextCreated`
with the specified planned-navigation behavior. Merely accepting the hook call
does not provide those effects. The [automation notes](../../automation/README.md)
record this connection alongside the missing live-session machinery.

### Validation

The new six-test suite covers initialized registration before notification,
the distinct automation opener, user-agent ownership, context-factory failure,
and fresh navigation with omitted/null/POST resources. Existing lifecycle and
Storage tests cover the complete initial graph and opener storage cloning;
navigable coverage now checks top-level lookup through child/grandchild chains.
The four focused suites pass on Node 24.19.0, Node 26.8.1, and custom Node:
52 passing tests with the addon on each runtime; 49 passing tests and the three
existing native-global expected failures without it. Typechecking, type-contract
tests, touched-file lint, import checks, and whitespace checks pass. No new
failure classifications or addon builds were needed.

## HTML §7.3.1.3: Child navigables

Audited the complete [child navigables subsection](https://html.spec.whatwg.org/multipage/document-sequences.html#child-navigables)
against HTML `404b3eb`, also checked against the live 30 October 2026 edition.
This covers the container definitions, both content accessors, and child
creation. It stops before §7.3.1.4's Jake diagrams and §7.3.1.5's collections;
destruction belongs to §7.3.1.6.

### Containers and public access

Iframe, object, embed, and legacy frame retain a nullable `contentNavigable`.
Their setters maintain the reverse `Navigable.container` association and notify
Document activity. `Navigable.containerDocument` reads the container's current
node Document; `Document.containerDocument` first requires that Document to be
the active Document of its node navigable. A child's non-null `parent` identifies
its navigation ancestry independently of that DOM association.

`NodeImpl.isNavigableContainer()` checks the registered `ElementTag` and narrows
to those four implementation types. Document's child/descendant/activity walks
and Window's named lookup share that guard. It identifies the container kind,
independently of whether its `contentNavigable` is currently null.

Iframe, object, and frame expose `contentDocument` and `contentWindow` in their
implementations and Web IDL declarations. The Document getter uses the current
same-origin-domain relationship between the child and container Documents,
including domain relaxation and opaque-origin identity. It returns null without
a child or an accessible Document. The Window getter returns the active
WindowProxy handle without that origin filter; ordinary Binding projection
provides the public proxy and preserves its identity. No binding override or
new registry is needed. Borrowing another realm's getter does not substitute
that realm for the receiver's container.

Embed's child association is internal; its IDL has neither public getter. The
association participates in Document's child/descendant collections, Window's
indexed/named lookup, insertion ordering, and descendant-activity notification.
Its `setup()` method is an explicit throwing dependency for the element's
resource-processing algorithm.

Initial-null, retained identity, foreign access, origin-domain changes, Document
replacement, browsing-context replacement, association clearing, adoption, and
borrowed/invalid receivers are covered through real projected objects. The
fixtures explicitly attach children while creation is unfinished. Adoption and
association-clearing tests inspect these relationships, not completed DOM
removal/destruction algorithms. Live Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2 agree on null before creation/after removal, initial Window/Document
identity, and the same-origin borrowed getter.

### Creation preparation and explicit dependencies

`UserAgent.createChildNavigable(element)` is the entry point for element
algorithms, reached through their node Document's environment. It forwards to
the static factory without adding a runtime navigation import to Element or its
subclasses. Future callers are iframe/frame post-connection steps and
object/embed resource processing; ordinary insertion does not call it yet.

`Navigable.createChild(element)` selects the element's parent navigable and its
top-level browsing-context group, then calls `BrowsingContext.create(creator,
element, group)`. It captures the returned Document's origin as both initiator
and resulting origin, its about base URL, and the element's current target name;
initializes a child with that parent; and attaches it to the container.

The entry remains pending until the queued steps run. Those steps read the
parent's then-active Document state, find its **first** matching history entry,
copy that step, append a nested history with the child's identity and initial
entry, and call `Traversable.updateForNavigableCreationOrDestruction()`.
The BiDi creation hook follows queue submission and receives the child.
Tests exercise delayed parent-state selection, same-Document history entries,
grandchild group/queue ownership, and factory failure without attachment or
notification. Ordering tests control their initial Document, queue draining, and
final history application. A separate case uses the real creator/iframe factory
and confirms that its real queued insertion reaches unfinished history application.

The complete path is **not executable yet**:

- `BrowsingContext.create()` now supplies creator/group state, inherited
  origin/base/cookie/referrer/policy state, embedder environment ancestry,
  sandbox/Permissions Policy, and Window setup. Its embedder type remains
  iframe-only. `createChild()` explicitly rejects
  object, embed, and legacy frame until their context/policy inputs are supported.
- `appendSessionHistoryTraversalSteps()` now queues the child insertion. It assigns
  the parent's history step and appends the nested history before reaching the
  unfinished joint-history application on that later background turn.
- `updateForNavigableCreationOrDestruction()` now enters §7.4.6.1 with the
  current joint-history step without cancellation, null source/initiator/navigation
  type, and user involvement `none`. Population/activation still rejects explicitly;
  history lengths, Navigation API entries, and affected Documents must all be
  updated by that application.
- Element insertion, removal, `src`/`srcdoc` processing, object/embed resource
  selection, frame loading, and load-event propagation remain their element
  algorithms' consumers. No automatic call is installed while these lower
  dependencies fail. Destruction's Navigation API notification and caller-loop
  decision remain for §7.3.1.6, with real callers needed before removing its
  explicit loop input.
- Embed setup additionally needs its task source and stale-task cancellation,
  Fetch and MIME/content-handler selection, load-event delay/delivery, and the
  response-based replace navigation. Removal and display-no-plugin processing
  must destroy and clear its child. These are recorded beside `setup()` in
  `embedded/embed.ts`; retaining a child does not implement those producers.
- BiDi's original-opener state, cache overrides, live sessions, and event delivery
  remain unfinished. `bidi-navigable-created-inputs` still records HTML's missing
  planned-navigation flag; this pass does not choose its value or timing.

### Approved specification conflicts

`SPEC_CLASH(child-navigable-absent-name)` uses the empty string when `name` is
absent. Child creation says null, but HTML's [document state](https://html.spec.whatwg.org/multipage/browsing-the-web.html#she-bc-name)
requires a string initially empty, and all three tested browsers return an empty
`window.name`. Explicit empty and nonempty names retain their values.

`SPEC_CLASH(bidi-child-created-target)` sends the new child to the notification
hook. HTML's last creation step instead names the traversable, which would
announce the parent again. [BiDi's event trigger](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigable-created)
emits information about the supplied navigable, and
[WPT's child-creation tests](https://github.com/web-platform-tests/wpt/blob/master/webdriver/tests/bidi/browsing_context/context_created/context_created.py)
expect the newly created iframe. Eric approved both corrections on 1 November
2026. Browser observations are reproducible with
`node node-compat/experimental/child-navigables.mjs`; the probe remains in the
independent Experimental repository.

### Validation

The child suite has 32 passing tests on Node 24.19.0, Node 26.8.1, and custom
Node, each with and without the addon. Creation tests use the UserAgent entry.
Embed regressions cover association transfer/clearing, child lookup, and
shadow-tree descendant activity; they failed before the retained state and
collection integration were added. Together with navigable, top-level creation,
Document lifecycle, and related-Window coverage, 101 tests pass on Node 26 with
the addon. Typechecking, touched-file lint, import checks, and whitespace checks
pass. No addon/engine rebuild or new failure classification was needed.

This audit does not mark child creation/loading complete.

## HTML §7.3.1.4: Jake diagrams

[Jake diagrams](https://html.spec.whatwg.org/multipage/document-sequences.html#jake-diagrams)
introduce explanatory notation, with no new runtime algorithm or state. Columns
are joint history steps; rows are navigables; URLs identify entries; colors
distinguish Document identity, including multiple URLs for the same Document.
The highlighted column and cells denote the traversable's current step and each
navigable's current entry, not necessarily its independently active entry.
Absent cells show that a child does not belong to the Document at that step.

Our retained `SessionHistoryEntry`, `DocumentState`, and nested histories provide
those relationships. The example combines two child navigations, a same-document
fragment navigation, parent replacement, and traversal back to an earlier joint
step. Its complete execution still needs §7.4 history application and child
lifecycle work. The diagram's one-level nesting limit is only a presentation
limit; our navigable ancestry and collections are recursive.

## HTML §7.3.1.5: Related navigable collections

Audited the [complete subsection](https://html.spec.whatwg.org/multipage/document-sequences.html#related-navigable-collections)
against HTML `404b3eb`, matching the live 30 October 2026 edition.

| Document operation | Behavior |
| --- | --- |
| `getAncestorNavigables()` | Outermost ancestor first, ending with the immediate parent. |
| `getInclusiveAncestorNavigables()` | The same ancestors followed by the Document's node navigable. |
| `getDescendantNavigables()` | Shadow-including container order, recursively including each child's active Document; parents precede children. |
| `getInclusiveDescendantNavigables()` | The Document's node navigable followed by those descendants. |
| `getDocumentTreeChildNavigables()` | Ordinary DOM descendants only, without shadow trees or child Documents; empty when the Document has no node navigable. |

Each call returns a fresh list. None filters by origin or full activity.
A retained child Document can still have a node navigable and ancestry when an
ancestor is inactive. A replaced Document loses its node navigable, but its
descendant-only walk still inspects retained containers. Collection always uses
the active child Document, not an independently selected current history entry.
The spec's multi-process note needs no mirrored tree in Browlet's current shared
runtime; a future process boundary would need to preserve these relationships
and ordering explicitly.

Ancestor lookup requires a node navigable because HTML immediately dereferences
its parent. Eric also approved that precondition for inclusive descendants on
1 November 2026: all specified callers supply an active Document, and invalid
internal calls throw rather than emit HTML's mechanically possible leading null.
The result therefore remains `Navigable[]`; this is not a full-activity check.

History-action activation consumption now uses inclusive descendants and visits
the top-level Window first. Its new regression first observed the previous
child/grandchild/top ordering. COOP access reporting uses inclusive ancestors
instead of maintaining a separate parent walk. The existing child and Window
lookup consumers retain their respective tree boundaries.

Remaining consumers are explicit dependencies: page-visibility updates,
activation notification, autofocus, iframe attribute
processing, unload/close/navigation cancellation, and
NotRestoredReasons collection. Their owning stubs and roadmaps remain open;
these collection methods do not implement those operations or child startup.
Named-target selection and transient activation consumption now use these collections.
`SPEC_CLASH(iframe-ancestor-collection-input)` records a pending caller issue:
[shared iframe attribute processing](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#shared-attribute-processing-steps-for-iframe-and-frame-elements)
passes the element's node navigable to inclusive ancestors, but §7.3.1.5 defines
the collection on Document. Resolve the caller's input during that element audit;
the marker is also beside the unfinished iframe lifecycle in `iframe.ts`.

The collection tests cover multiple levels, all four container kinds, shadow
trees, list freshness, reordering, disconnection, inactive ancestry, replaced
Documents, and the approved preconditions. With activation, child navigation,
indexed/named Window access, and COOP reporting, Node 26/addon validation has
134 passes and the two existing indexed-mutation expected failures. The
collections, activation, child-navigation, and COOP suites also have 77 passes on
Node 26 without the addon. Typechecking, touched-file lint, import checks, and
whitespace checks pass. Next: §7.3.1.6, navigable destruction.

## HTML §7.3.1.6: Child navigable destruction

Read the [complete navigable-destruction subsection](https://html.spec.whatwg.org/multipage/document-sequences.html#garbage-collection-and-browsing-contexts)
against HTML `404b3eb`, matching the live 30 October 2026 edition. This bounded
slice implements the child coordinator; the top-level pass is recorded below.

`Navigable.destroyChild(container)` retains the specified container input, with
`UserAgent.destroyChildNavigable()` providing the same element-to-navigation
route as creation. It accepts all four container implementations. With no child,
it returns immediately. Otherwise it clears content navigable and its reverse
association before notifying Navigation. It requests recursive destruction of
the then-active child Document, removes the matching nested history from the
container's then-active parent Document state, queues a creation/destruction
history update, and notifies BiDi. The parent's current entry can differ from
its active entry; retained unrelated histories and list identity are preserved.
No matching nested history is a no-op for removal. Repeated destruction of the
now-empty container does nothing. Retained parent and WindowProxy identities
are not cleared by this coordinator.

### Explicit dependencies and stopping point

| Dependency | Current boundary |
| --- | --- |
| [Recursive Document destruction](https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document-and-its-descendants), §7.5.10 | New `Document.destroyAndDescendants(afterAllDestruction?)` throws. Its full contract requires parallel execution, inactive-document unsalvageability/NotRestoredReasons, child selection and recursive completion, then a task invoking `destroy()` and the optional continuation. Existing `destroy()` requires an owning task and handles only an active Document; retained inactive history ownership is still missing. |
| Teardown scheduling | Clearing the container makes its child Document not fully active. Existing global-task activity gating therefore blocks queued off-loop abortion and ordinary teardown tasks. Resolve the destruction-task lifecycle and notification ordering during §7.5.10; do not silently bypass activity checks here. |
| Session-history traversal | The queue executes appended work and waits for `updateForNavigableCreationOrDestruction()`. It selects the current joint-history step without cancellation, then rejects at the unfinished population/activation boundary. |
| [BiDi destruction](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigable-destroyed) | New `UserAgent.webDriverBiDiNavigableDestroyed()` is an explicit provisional hook. Live sessions, navigable-info serialization, parent-related event subscriptions, event delivery, and subscription pruning remain unfinished. |
| Element lifecycle | Iframe/legacy-frame removal, object fallback/resource changes, and embed removal/display-no-plugin must call their node Document's UserAgent. Source TODOs name the route and the missing startup/teardown/history work. DOM removal does not automatically invoke this unfinished coordinator. |

An unmocked call currently stops at recursive teardown after detachment and
Navigation notification. It does not remove history, enqueue an update, or
announce completed destruction. This is a dependency boundary, not an atomic
operation or a finished iframe-removal implementation.

### Caller-loop decision remains open

The coordinator obtains the caller loop from `container.nodeDocument.env`; its
own signature adds no loop parameter. The existing Navigation helper compares
that loop with the child's active Window loop. Shared-Agent notification aborts
synchronously, whereas another Agent queues abortion on the child's loop. Both
reject pending traversal trackers immediately, before document teardown.
Tests exercise those existing paths with real Navigation state and separate
Window owners. They do not settle the off-loop delivery problem after detachment.
Keep `TODO(navigation-abort-caller-loop)` and its pending signature markers until
automatic removal and recursive teardown establish an end-to-end handoff. A
parameter-free notification arrangement still needs comparison against that path.

### Validation

The 13 new coordinator tests and 24 existing Navigation-abort tests pass on all
six runtime configurations: Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre,
each with and without the addon. Node 26/addon also passes all 85 tests across
the coordinator, child creation/access, related collections, and document
lifecycle suites. The coordinator tests supply only the unfinished recursive
teardown and traversal queue, with targeted notification spies for ordering.
Separate tests use real notification state on shared and distinct Agents.
No new failure classifications or addon/engine rebuilds were needed.
Typechecking, touched-file ESLint, import-hierarchy checks, and whitespace checks pass.

## HTML §7.3.1.6: Top-level destruction and closing

The second pass covers the [remaining destruction and closing algorithms](https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-top-level-traversable),
including the permission to destroy a top-level traversable at any time and the
note distinguishing guarded close from definite closing. This completes the
subsection's audit and coordinators, not functional window closing.

| Operation | Implemented sequence and boundary |
| --- | --- |
| `TopLevelTraversable.destroy()` | Capture the active browsing context, request recursive destruction for each non-null history Document, remove the captured context from its group, notify UI removal, unregister the traversable/clear its session storage, then notify BiDi. `UserAgent.destroyTopLevelTraversable()` is the browser-owned entry; it does not apply script-closing permission checks. Recursive Document destruction still throws before removal can proceed. |
| `TopLevelTraversable.close()` | Return if `isClosing`; otherwise invoke definite closing. It does not itself set `isClosing`. |
| `TopLevelTraversable.definitelyClose()` | Check unloading cancellation for inclusive descendants, return on either cancellation result, then append traversal steps. Those steps select the then-active Document and browsing context, then unload with null replacement and destruction as the completion callback. The callback retains that context even if unloading destroys the Document. It deliberately does not repeat the `isClosing` guard. |
| `Navigable.checkIfUnloadingIsCanceled()` | §7.4.2.4 returns a browser-owned completion promise. It snapshots Documents, queues the optional top-level event pair before other checks, and shares prompt state across their Window tasks. Removed check tasks reject the internal wait. Prompt policy/UI and full teardown remain explicit dependencies. |
| `Document.unloadAndDescendants()` | Explicit §7.5.9 dependency with replacement Document, completion steps, and page-swap steps. Traversal-queue ownership, recursive child tasks/waits, page-swap delivery, and single-document unloading must be implemented together. |

`BrowsingContextGroup.remove()` already removes the UserAgent's empty group while
preserving groups that still have another context. `removeTopLevelTraversable()`
already clears retained session-storage maps, including views, without touching
another tab or local storage. Its contract now says teardown has been requested:
HTML starts recursive destruction in parallel and does not wait for all of it
before unregistering the traversable. Repeated Documents in history remain
per-entry requests; coordinating their destruction belongs to the recursive
teardown audit rather than an ad hoc deduplication here.

`UserAgent.removeTopLevelTraversableFromUI()` is an explicit no-op while Browlet
has no UI host. A future host must connect this removal effect. The existing
provisional BiDi hook remains unfinished. Window's public `close()` still stops
before its source snapshot, script-closability, incumbent-context familiarity
check, sandbox permission, and DOM-manipulation-task handoff; its source names `definitelyClose()` as
that task's destination. These checks are not replaced with unconditional close.

### Specification gaps and lifecycle choices

- `SPEC_GAP(top-level-destruction-order)`: HTML explicitly asks in what order to
  visit retained history entries. This coordinator requests destruction in list
  order without introducing another sort, snapshot, or completion-order promise.
  No browser oracle for internal history-Document destruction order was run;
  revisit observable ordering with the recursive teardown implementation.
- `SPEC_GAP(top-level-close-destroyed-document)`: §7.5.9's single-document unload
  can destroy an unsalvageable Document, clearing both its browsing context and
  the active entry's Document. Its completion then invokes top-level destruction,
  whose first step needs that active browsing context. The specification does
  not supply a retained-context handoff. Browlet captures the context when queued
  closing begins, before unloading, and retains it in the completion callback.
  The callback passes that context directly to `destroy()`. Its additional
  optional context argument defaults to the active browsing context for direct
  destruction; no separate helper or additional Navigable state is needed.
  Capturing inside the queued steps also uses the correct context if it changed
  after closing was requested. The regression runs real Document destruction
  before completion and verifies context/group removal, session-storage cleanup,
  and the UI/BiDi notifications.

Source inspection on 2 November 2026 used the existing local Blink
`1136757f47` (3 July), Gecko `d92a7ec0e622` (2 July), and WebKit `713192fa`
(26 August) snapshots. [Blink's ChromeClient](https://github.com/chromium/chromium/blob/1136757f47/third_party/blink/renderer/core/page/chrome_client_impl.cc#L531)
forwards closure through WebView, [Gecko's outer Window](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622/dom/base/nsGlobalWindowOuter.cpp#L6112)
retains its browsing context and closes through the tree owner, and
[WebKit's queued close](https://github.com/WebKit/WebKit/blob/713192fa/Source/WebCore/page/LocalDOMWindow.cpp#L1167)
retains the Window and asks its Page's Chrome to close. These are evidence for
browser/page ownership beyond the Document; they do not establish a browser
disagreement or require the same ownership representation in Browlet. No native
runtime changes are part of this slice.

### Validation

Eleven tests cover retained/null/repeated history Documents, capture before
teardown, context/group and storage isolation, cancellation, the closing guard,
shadow-tree descendants, queued Document/context selection, and completion after
real Document destruction.
The unfinished recursive teardown, cancellation, and unloading
are supplied only at those boundaries; their unmocked failures stay explicit.
Together with creation, storage lifetime, and Document destruction, all 28 tests
pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with and without
the addon. Typechecking, touched-file ESLint, import
checks, and whitespace checks pass. No new expected failures or runtime rebuilds.

Recursive teardown, prompt policy/UI, unloading, history application, and BiDi
integration remain explicit dependencies.

## HTML §7.3.1.7: Target names and existing-target lookup

Audited [navigable target names](https://html.spec.whatwg.org/multipage/document-sequences.html#navigable-target-names)
against HTML `404b3eb` (30 October 2026), checked against the live specification on
2 November. This slice covers the name definitions, the non-normative sandbox
summary, finding an existing target, and the existing-target branches of choosing
a navigable. It stops at the new-top-level request branch.

`Navigable.isValidTargetName()` and `isValidTargetNameOrKeyword()` express the
authoring definitions: nonempty names cannot start with `_` or contain both `<`
and an ASCII tab/newline; the latter also permits the four case-insensitive
keywords. These are authoring predicates, not runtime lookup restrictions or a
new document-conformance checker. `Window.name` assignment and named lookup do
not reject nonconforming names. Runtime names compare exactly, including case.
Blink's `_current` and fenced-frame `_unfencedTop` extensions are not HTML's four
keywords and are not introduced by this slice.

The sandbox summary's self, parent, top-level, named, and new-context outcomes
span target selection and navigation. Special target selection is not itself a
navigation permission check. The later `navigate()` permission check must enforce
the table's restrictions even after `_parent` or `_top` has selected a target.

`findNavigableByTargetName()` takes one source snapshot, searches self's inclusive
descendants and then the traversable's, filtering sandbox-blocked candidates
before comparing names. It then obtains the active top-level context's group,
skips that context, and searches the other contexts' inclusive descendants.
Each such candidate must pass familiarity first, then sandbox permission, then
exact name comparison. A miss returns null. The shared Document collections
supply active Documents, tree order, and shadow descendants; target names come
from each candidate's active history entry.

`chooseNavigable()` preserves empty/`_self` and parent-or-self selection; `_top`
selects the traversable, as specified. A non-`_blank` name uses the new lookup
and returns the existing target/window-type pair. `noopener` does not disable
this lookup in HTML's algorithm. `_blank` and lookup misses reach the new-target
branch, implemented in the follow-up below. `Window.open()` calls this operation
and applies its separate noopener return rule; its empty target is normalized to
`_blank`, unlike a direct empty-name algorithm call.

### Approved browser choices

All three choices were discussed and approved on 2 November 2026. HTML currently
permits them; the markers track browser disagreement, not a departure from a
single mandatory ordering.

| Marker | Browlet choice and evidence |
| --- | --- |
| `SPEC_CLASH(named-target-subtree-order)` | Search the caller subtree, then the whole traversable. The duplicate-frame probe selects the outer-tab match in Chromium/WebKit and the nearer-ancestor match in Firefox. [HTML #10848](https://github.com/whatwg/html/issues/10848) tracks choosing one order. |
| `SPEC_CLASH(named-target-sandbox-filter)` | Take HTML's optional rejection of sandbox-blocked candidates in both search loops. [HTML #10849](https://github.com/whatwg/html/issues/10849) proposes making it required. The live sandboxed-sibling probe opens a new window in Chromium/WebKit and throws `InvalidAccessError` in Firefox. That observable result does not establish which internal step rejects the candidate. |
| `SPEC_CLASH(named-target-group-order)` | Preserve the group's Set registration order, oldest first. The duplicate-popup probe selects oldest in Firefox/WebKit and newest in Chromium. [HTML #10850](https://github.com/whatwg/html/issues/10850) leaves the tie-break open; no focus history or sorting is added. |

The retained browser-only probe is `node-compat/experimental/navigable-target-names.mjs`.
Run it with `node node-compat/experimental/navigable-target-names.mjs`. It executes
`open()` in the requesting frame's realm. Tested builds: Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. The issue pages were read through Extractlet
without capture warnings; their older browser observations are not substituted
for these live results.

Local source snapshots support the tree-search distinction:
[Blink `1136757f47`, FrameTree](https://github.com/chromium/chromium/blob/1136757f47/third_party/blink/renderer/core/page/frame_tree.cc#L249),
[Gecko `d92a7ec0e622`, WindowGlobalChild](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622/dom/ipc/WindowGlobalChild.cpp#L884),
and [WebKit `713192fa`, FrameTree](https://github.com/WebKit/WebKit/blob/713192fa/Source/WebCore/page/FrameTree.cpp#L291).
These July/August sources are older than the tested builds. Blink and Gecko check
navigation permission during lookup; that WebKit search does not, and its other
pages come from a hash set. Do not infer permanent WebKit insertion ordering or
an identical early sandbox check from one current probe.

### Explicit dependencies and stopping point

- `SourceSnapshotParams` calls the existing `Window.hasTransientActivation()`
  boundary. HTML §6.4 activation duration and notification remain unfinished;
  lookup does not substitute false. The new-target follow-up implements consumption.
- `Navigable.isAllowedBySandboxingToNavigate(target, sourceSnapshotParams)` now
  implements the §7.4.2.4 predicate: ancestry, captured activation/flags, and
  the target's permitted creator. See the [sandbox permission audit](#html-7424-sandbox-navigation-permission)
  for browser conflicts. The snapshot is passed intact rather than recaptured
  from potentially changed source state per candidate.
- `BrowsingContext.isFamiliarWith(other)` implements HTML §7.3.2.2: active
  origins, the source's top-level context, the target's auxiliary opener chain,
  and its ancestor contexts. Other-group contexts are not searched, even if the
  predicate would consider them familiar. Named lookup uses
  `isFamiliarForNamedLookup()`'s approved one-opener restriction; see the
  [follow-up audit](#html-7322-related-browsing-contexts).
- The [new-target follow-up](#html-7317-new-target-selection) now supplies the
  choosing branch, its UserAgent settings, and activation consumption. Its
  missing creation/navigation dependencies remain separate from named lookup.
- `TopLevelTraversable.create()` supplies null-opener and auxiliary creation,
  registration, and opener session-storage cloning. Immediate
  replacement navigation, CSSOM View feature effects, and `Window.open()`'s
  queued history application remain their existing explicit dependencies;
  its synchronous URL/history update is now implemented in §7.4.4.

Production named opening is therefore still incomplete. Tests supply only
activation, with explicit child/group associations. Familiarity and sandbox
permission run through their implementations; tests of candidate ordering
still override individual predicates deliberately. The new lookup
requires no native changes. The follow-up below completes the subsection's
coordinator while preserving these prerequisites.

### Validation

The 31 target-name tests cover authoring syntax versus runtime names, special
keywords, duplicate-name ordering, live/shadow-tree lookup, one source snapshot,
sandbox and familiarity filtering, other-group exclusion, registration order,
explicit unfinished boundaries, and projected `Window.open()` returning the
selected child's WindowProxy. Together with the existing collection and opening
suites, all 95 tests pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre,
each with and without the addon. Typechecking, touched-file ESLint, import
hierarchy, and whitespace checks pass. No new expected failures or runtime rebuilds.

## HTML §7.3.1.7: New-target selection

The follow-up completes the [choosing algorithm](https://html.spec.whatwg.org/multipage/document-sequences.html#the-rules-for-choosing-a-navigable)
through its final return. The live HTML source still reports 30 October 2026,
matching local `404b3eb`. The algorithm's callable shape is unchanged.

`UserAgent.popupBlockerEnabled` defaults to true. `newNavigablePolicy` defaults
to `new` and can instead select `current` or `none`. These are browser-owned
settings, not a new callback or Host Port; they do not affect an already-found
target. No additional `BrowletConfig` API is introduced. With popup blocking
disabled, the new-target branch does not need the unfinished activation query;
named lookup still needs that query for its separate source snapshot.

| Stage | Implemented behavior |
| --- | --- |
| Block or redirect the request | First reject an unactivated request when popup blocking is enabled, then reject sandboxed auxiliary navigation. Only then apply the configured new/current/none choice. The current and none choices preserve `existing-or-none` and do not consume activation. Optional blocked-popup UI and console messages are deliberately omitted. |
| Consume activation | Before creating a target, call `Window.consumeUserActivation()`. It consumes across the source's top-level tree, including other origins and shadow descendants; preserves +Infinity for never-activated Windows; sets other last-activation timestamps to -Infinity; and leaves history-action timestamps untouched. A retained Window without a navigable returns without changing state. |
| Apply COOP | Enforced `same-origin` or `same-origin-plus-COEP`, with a source origin different from its environment's top-level origin, forces noopener, an empty name, and `new-with-no-opener`. Other values and report-only policy do not enter this branch. |
| Create the destination | `_blank` creates an unnamed target; preserve other names unless COOP forced separation. Pass null as opener for noopener, otherwise the source's active browsing context. Always pass the source navigable separately for BiDi provenance. The top-level factory owns registration and opener session-storage cloning. Explicit noopener alone retains `new-and-unrestricted`; `Window.open()` applies its separate null-return rule. |
| Retain sandbox and lifecycle state | With `sandboxed-navigation`, retain the creator as the new context's one permitted sandboxed navigator, including noopener (the §7.4.2.4 follow-up corrects HTML's omission). If propagation is requested, copy all source flags into the popup sandboxing set without sharing it. Mark the traversable created by web content, then return it and its window type. |

Consumption is a bounded dependency from HTML §6.4, using existing state and
collections. The sticky predicate now uses the same retained timestamp;
input/automation notification, transient duration and expiry,
and UserActivation exposure remain unfinished in the
[interaction owner](../../interaction/ROADMAP.md#history-action-activation-dependency).
This does not infer activation from a click or introduce a global activation bit.

### Browser evidence and approved choices

The browser-only probe `node-compat/experimental/navigable-new-targets.mjs` was
run on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It calls `open()`
inside the sandboxed frame's own realm and inspects new noopener windows both
at initial about:blank and after same-origin navigation. Playwright's launch
defaults allow popups; these probes do not measure browser popup-blocker defaults.

- `SPEC_CLASH(new-target-sandbox-rejection)`: HTML, Chromium, and WebKit return
  null when the source is sandboxed without `allow-popups`; Firefox throws
  `InvalidAccessError`. Browlet returns null, as approved on 2 November.
  [Gecko's WindowWatcher](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622/toolkit/components/windowwatcher/nsWindowWatcher.cpp#L988)
  explicitly returns `NS_ERROR_DOM_INVALID_ACCESS_ERR` for that flag.
  [Blink's creation path](https://github.com/chromium/chromium/blob/1136757f47/third_party/blink/renderer/core/page/create_window.cc#L346)
  reports to the console and returns null. This is a return-path difference,
  not a cross-origin access failure in the probe.
- `SPEC_CLASH(noopener-new-target-name)`: HTML, Chromium, and Firefox preserve
  a supplied name on a newly created noopener window; WebKit exposes an empty
  name even before navigation. Browlet preserves it, as approved on 2 November.
  The local [WebKit FrameLoader](https://github.com/WebKit/WebKit/blob/713192fa/Source/WebCore/loader/FrameLoader.cpp#L5114)
  passes the requested name and opener-suppression policy to its Chrome client;
  that excerpt alone does not explain where the tested port clears the name.

### Remaining dependencies and stopping point

Selection still reaches the unfinished `Window.hasTransientActivation()` when
popup blocking is enabled. `BrowsingContext.createAuxiliary()` now supplies
creator/opener/group inheritance for a non-null opener. Named lookup now uses
the §7.4.2.4 sandbox predicate, including the retained permitted creator.

`Window.open()` still needs CSSOM View feature setup and queued history
application or document-initiated navigation. Its synchronous about:blank
URL/history update is implemented in §7.4.4. Immediate navigation of a new
initial-about:blank target must eventually use replacement history, as the
section's note requires; selection does not navigate or simulate that effect.
BiDi delivery remains provisional. Full document sandbox inheritance belongs
to creation/navigation, beyond copying the popup flag set here.

This completes the §7.3.1.7 audit and selection coordinator, not functional popup
loading. The next section is §7.3.2, browsing contexts.

### Validation

Twenty-eight new selection tests and two consumption tests cover policy and
sandbox rejection, current/none choices, successful null-opener creation,
COOP-forced separation, naming, sandbox copying, BiDi provenance, storage-clone
coordination, and activation scope/ordering. The tests supply the unfinished
activation predicate; named lookup now uses real sandbox permission.
Following §7.3.2.1, both context factories and the consumption algorithm run
normally. Separate cases inject a creation failure to check its propagation and
exercise sandbox rejection through projected `Window.open()`.

Together with target lookup, top-level creation, existing activation, and opening
suites, all 129 tests pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre,
each with and without the addon. Typechecking, touched-file ESLint, import
hierarchy, and whitespace checks pass. No new expected failures or runtime rebuilds.

## HTML §7.3.2: Browsing-context foundations

Audited the [browsing-context preamble](https://html.spec.whatwg.org/multipage/document-sequences.html#windows)
against HTML `404b3eb` (30 October 2026), refreshed on 2 November. This slice
stops before §7.3.2.1's creation algorithms.

`BrowsingContext.activeDocument` now stores the specified nullable state and
starts at null, independently of WindowProxy initialization. `activeWindow`
continues to read the proxy's associated Window. Reusing the initial about:blank
Window can associate a replacement Document before activation; that preparation
must not replace the context's active Document. The existing
[make-active operation](https://html.spec.whatwg.org/multipage/browsing-the-web.html#make-active)
now assigns that state before retargeting the proxy and marking execution ready.
`finishLoading()` checks the stored active Document before producing load events.

`topLevelTraversable` follows the active Document's node navigable, rather than
the context's retained inverse navigable link. It requires an active Document
with a node navigable and throws InternalError when an internal caller violates
that precondition. Top-level opener storage cloning uses this accessor.
`topLevelBrowsingContext` still returns null without a fully active Document.
Navigation response preparation and COOP reporting retain their active-Document
preconditions; named-target lookup ignores contexts awaiting initial activation.

The rest of the preamble maps to these existing owners and explicit dependencies:

| Passage | Implementation or remaining dependency |
| --- | --- |
| WindowProxy and document sequence | BrowsingContext retains the proxy; navigation can replace Window/Document while the proxy persists. A navigable can retain multiple contexts across group switches. |
| Opener context/origin, popup and auxiliary flags, initial URL, virtual group ID | Existing fields have the specified null/false/0 defaults. Auxiliary identity remains distinct from opener presence; the §7.3.2.1 follow-up initializes it through `createAuxiliary()`. |
| Popup visibility and optional UI | `BarProp.visible` reads the popup flag. Position/size setup remains the throwing CSSOM View `setUpFeatures()` dependency; browser window/tab UI remains a provisional UserAgent host effect. |
| Virtual group ID | COOP enforcement already allocates and propagates report-only group identities; reporting delivery dependencies remain in the policy roadmap. |
| Document's nullable browsing context | Document construction initializes null, including DOMImplementation-created documents. `Document.destroy()` clears the association; recursive destruction and iframe removal callers remain unfinished. |
| Window reuse and initial history replacement | The current response path reuses a same-origin initial about:blank Window. Full navigation/history application must supply replacement handling; this slice does not complete those producers. |
| Prefer Document/navigable terminology | New behavior stays on those owners unless it needs the context's proxy, active-document slot, group, or agent selection. |

The §7.3.2.1 follow-up below supplies creator/iframe policy and environment
inheritance and auxiliary creation. The §7.3.2.2 follow-up implements context
familiarity in `browsing-context.ts`.

Regressions reproduced the fresh-context getter throwing instead of returning
null, premature active-Document replacement during Window reuse, and premature
load completion. Coverage also checks activation, child-to-top-level lookup,
and rejection of a retained context whose Document no longer has a navigable.

### Validation

The browsing checks and affected fixture suites cover 122 files and 2,719 cases
per configuration. Hand-built Window fixtures now call `Document.makeActive()`
instead of only retargeting their proxy, so they initialize the active Document
and execution readiness through the same operation as production.

| Configuration | Passing | Existing expected failures |
| --- | ---: | ---: |
| Node 24.19.0, Node 26.8.1, custom Node 27.0.0-pre; addon disabled | 2,636 each | 83 each |
| Node 24.19.0 and Node 26.8.1; addon enabled | 2,706 each | 13 each |
| Custom Node 27.0.0-pre; addon enabled | 2,711 | 8 |

All six runs pass. Typechecking, type contracts, touched-file ESLint, import
hierarchy, and whitespace checks also pass. No expected-failure classifications
changed, and no runtime or addon rebuild was needed.

## HTML §7.3.2.1: Creating browsing contexts

Audited [creating browsing contexts](https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-browsing-context)
against HTML `404b3eb` (30 October 2026), refreshed on 2 November. This includes
common creation, top-level creation, auxiliary creation, and origin determination;
it stops before §7.3.2.2's related-context algorithms.

### Creation and inheritance

| Specification requirements | Owner and result |
| --- | --- |
| Fresh context, creation time, creator origin/base/virtual ID | `BrowsingContext.create()` retains the creator origin and base URL records, obtains the top-level virtual ID, and requires that creator to have a fully active context. Retaining the base record preserves a captured Blob entry after revocation. |
| Creation sandbox flags, origin, Permissions Policy, similar-origin agent | The existing flag and policy factories run before Window allocation; `determineOrigin()` applies sandbox opacity before inheritance. The agent request uses `false` for origin-agent-cluster, as specified. |
| Realm, Window, global-this, environment | UserAgent's existing Window factory creates the realm and WindowProxy. Top-level creation URL comes from the embedder's relevant environment, then the creator's, then about:blank. Top-level origin comes from the embedder's relevant environment or the newly selected origin. |
| Initial Document and load timing | Existing initialization supplies HTML/`text/html`/quirks state, context, policy, independent active flags, coarsened navigation start, initial-blank state, inherited base, declarative-shadow-root permission, and a fresh custom-element registry. The reviewed cookie-URL inheritance choice remains intact. |
| Iframe policy and ancestor lists | The referrer-policy selector and Document ancestry algorithms run with the embedder's current node Document, including after adoption. Insecure-request upgrade inheritance also uses that Document; it does not substitute the element's original environment. |
| Creator referrer, policy container, COOP | The full creator URL is serialized; the policy container is cloned. A creator same-origin with its environment's top-level origin shares the top-level active Document's opener-policy object. A foreign creator retains the default opener policy. |
| Initial completion | URL assertions, post-load readiness, HTML/head/body population, activation, and complete-loading bookkeeping run in order. Container load-event delivery remains explicitly unfinished in `Document.completelyFinishLoading()`. |
| Top-level factory | `createTopLevel()` uses the existing new-group factory and returns its first context and Document. Common creation does not append a context to a group's top-level set. |
| Auxiliary factory | `createAuxiliary()` selects the opener's top-level traversable's active context/group, creates with the active opener Document, marks auxiliary status, appends group membership, and records opener identity/origin and the top-level virtual ID. |

`TopLevelTraversable.create()` now reaches the real auxiliary factory before
cloning the opener's top-level session-storage shed and registering the new
traversable. Selection/storage tests no longer supply a fake auxiliary factory.
Iframe child creation now reaches the traversal queue rather than failing at
creator inheritance; its remaining queue/history work is still visible.

### Origin determination and callable shape

`BrowsingContext.determineOrigin(url, sandboxFlags, sourceOrigin)` returns a
fresh opaque origin for sandboxed-origin or null URL, retains source identity
for srcdoc and matching about:blank URLs, and otherwise uses the URL origin.
Srcdoc requires a source origin. Shared identity preserves subsequent
`document.domain` changes; query/fragment handling and URL-origin fallback have
focused tests.

The reviewed URL input permits null. `SPEC_CLASH(origin-null-url-input)` records
why: HTML's header requires a URL, but its second step explicitly handles null.
Browlet implements that step; the pending signature-review marker is removed.
The already-reviewed iframe-only embedder type remains unchanged: HTML's
generic-element creation algorithm reaches sandbox flags defined only on iframe.
Object/embed/legacy-frame creation still throws at its explicit owner boundary.

### Initial about:blank referrer disagreement

`SPEC_CLASH(initial-blank-referrer)` follows HTML/Chromium, as Eric approved on
2 November: clone the creator's policy separately, but set the initial Document's
referrer to its full serialized URL, including the fragment. This is initial
Document state, not the network request referrer selected by Fetch.

The reproducible browser-only probe is
`node-compat/experimental/browsing-context-creation.mjs` in Experimental.
It creates an iframe with no src and `window.open('', '_blank')`, reads both
Documents synchronously, and compares default policy with a `no-referrer` meta
policy. For `https://creation.test/creator?query#fragment`, the observed results
were identical between those two policy variants:

| Browser | Initial iframe referrer | Initial popup referrer |
| --- | --- | --- |
| Chromium 156.0.8078.4 | Full creator URL, with fragment | Full creator URL, with fragment |
| Firefox 157.0 | Empty | Empty |
| WebKit 27.2 | Creator URL without fragment | Empty |

All three exposed about:blank, inherited the `/base/` base URL and creator
origin, and reported complete readiness. The no-referrer probe alone initially
suggested policy application in Firefox and WebKit popups; the default control
does not establish that explanation. These notes record the observed initial
Document behavior without claiming how later navigation computes its referrer.

### Remaining dependencies

- `Navigable.createChild()` still stops at the throwing traversal-queue append;
  its queued history update remains §7.4.6.1 work. No automatic iframe insertion,
  src/srcdoc loading, non-iframe loading, or container load-event producer is added.
- Later navigation must supply its source origin and final flags to
  `determineOrigin()`. `NavigationParams` now names that dependency beside its
  provisional URL-origin selection; it lacks the source snapshot needed for
  about:blank/srcdoc inheritance. Cookie/base/policy source capture and inline
  srcdoc CSP ordering remain later navigation work too.
- Popup restrictions are copied by target selection **after** initial creation;
  subsequent document creation must consume that context state. The one-permitted
  navigator is now consumed by the navigation-permission predicate.
- New Window creation does not complete `Window.open()`: activation lookup,
  CSSOM View features, queued history
  application, and navigation retain their explicit boundaries. BiDi delivery and
  browser UI remain provisional host effects.
- Existing engine/addon limitations and policy/report delivery dependencies are
  unchanged; this slice adds no native machinery or runtime-specific fallback.

### Validation

The 24 new creation/origin tests cover creator and iframe inheritance, policy
copying, COOP from a nested creator's top-level Document, adopted-element settings,
auxiliary group/opener ownership, source identity, sandbox precedence, null URLs,
and ordinary/Blob URL origins. The retained Blob-base regression now runs as an
ordinary passing test. Child creation also exercises the real factory up to the
remaining traversal-queue boundary, and target selection/storage use real
auxiliary creation.

The focused matrix runs 77 suites and 1,867 cases per configuration across
navigation, policy, opening, environments, storage sheds, and object URLs:

| Configuration | Passing | Existing expected failures |
| --- | ---: | ---: |
| Node 24.19.0, Node 26.8.1, custom Node 27.0.0-pre; addon disabled | 1,863 each | 4 each |
| The same three bases; addon enabled | 1,866 each | 1 each |

All six runs pass. Typechecking, type contracts, touched-file ESLint, import
hierarchy, and whitespace checks pass. No new expected failures, addon changes,
or runtime rebuilds were needed.

## HTML §7.3.2.2: Related browsing contexts

This audit covers [Related browsing contexts](https://html.spec.whatwg.org/multipage/document-sequences.html#nested-browsing-contexts)
in HTML source `404b3eb14a7a936dddefb2d78e224dbeb01d2358` (2026-10-30),
through familiarity and before §7.3.2.3's group algorithms.

| Requirement | Implementation and boundary |
| --- | --- |
| Ancestor browsing context | `BrowsingContext.isAncestorOf()` checks the descendant's full activity and maps its ancestor navigables to their current active contexts. It excludes self and retained inactive ancestry. |
| Top-level classification | `isTopLevel` checks whether the active Document's node navigable is a `Traversable`, as specified, rather than requiring `TopLevelTraversable`. HTML currently permits only top-level traversables, but deliberately defines this predicate more broadly. |
| Top-level context lookup | The existing `topLevelBrowsingContext` returns null without a fully active Document and otherwise follows the navigable tree to its outermost context. Tests cover retained contexts and ancestor replacement. |
| Prefer Document/navigable concepts | These context predicates stay with context-specific consumers. Existing tree traversal remains Document/navigable work; no reverse registry or second ancestry model is introduced. |
| Familiarity | `isFamiliarWith()` implements strict origin equality, the source's top-level context, the target's auxiliary opener chain, and same-origin ancestors of fully active target Documents. `isFamiliarForNamedLookup()` shares those conditions but limits named lookup to one opener. |

Familiarity is asymmetric and does not itself require group identity. Named
lookup independently limits candidates to the source's group. Direct origin
matches remain valid for retained active Documents that are no longer *fully*
active; only ancestry/top-level checks require full activity. Fresh contexts
without active Documents violate the familiarity operation's internal precondition
and throw `InternalError`.

### Specification choices and browser evidence

- `SPEC_CLASH(browsing-context-ancestor-direction)`: HTML's opening sentence
  reverses `potentialAncestor` and `potentialDescendant`; its steps test the
  descendant's ancestor list. Browlet follows those steps and ordinary ancestry.
- `SPEC_CLASH(familiarity-distant-target)`: retain HTML's direct same-origin
  match even across several opener links. Chromium/Firefox reuse such a target;
  WebKit's named lookup additionally restricts the opener relationship.
- `SPEC_CLASH(familiarity-document-domain)`: use strict origin equality. In the
  disowned-target probe, matching relaxed domains permit reuse in Chromium but
  not Firefox/WebKit. [HTML issue #3747](https://github.com/whatwg/html/issues/3747)
  discusses this exact distinction and the preference to ignore deprecated
  `document.domain` here. This does not change same-origin-domain checks elsewhere.
- `SPEC_CLASH(familiarity-opener-depth)`: limit named lookup to one opener,
  following the browsers rather than HTML's recursive familiarity rule.
  With A opening foreign B and B opening C, A is familiar with C under HTML;
  all three browsers instead create another window for the named lookup.
  [Gecko's documented algorithm](https://github.com/whatwg/html/issues/313#issuecomment-453648260)
  explicitly stops before the opener's opener and describes its accumulated
  security/compatibility constraints. This evidence prompted the approved
  revision from recursive named lookup. The regression now rejects C, but accepts
  it if B becomes same-origin with A. General `isFamiliarWith()` remains recursive;
  `Window.close()` must be audited before adopting this lookup-specific limit.
- `SPEC_GAP(familiarity-opener-termination)`: HTML recurses into a nullable opener
  and supplies no cycle termination. Window APIs can clear or cycle these links;
  all three browsers terminate and reject an unrelated target in those cases.
  Browlet stops at null or a repeated context, retaining origin/top-level/ancestor
  matches encountered. Checking each context's nonrecursive conditions before
  following its opener preserves finite-chain results and allows matches within
  cycles without recursion or rejecting the whole cycle in advance.

Live browser-only probe `node-compat/experimental/browsing-context-familiarity.mjs`,
2026-11-02: Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2. Each case uses
actual Window APIs, verifies the opener links, and waits for the foreign Document;
`Origin-Agent-Cluster: ?0` permits the domain-relaxation control. All three reuse
a direct foreign auxiliary target, reject it after opener removal, and reject
the unrelated opener cycle. The distant same-origin, foreign-chain, and relaxed
domain differences are recorded above. These are named-lookup observations,
not direct calls into a browser's private familiarity predicate.

Source inspection explains the lookup boundaries: Chromium `1136757f47`
(`FrameTree::FindFrameForNavigationInternal`, `LocalFrame::CanNavigate`) combines
navigation permission with origin-domain ancestor checks and one target opener;
Gecko `d92a7ec0e622` (`WindowGlobalChild::FindBrowsingContextWithName`,
`nsContentUtils::CanNavigate`) uses strict principals and limits opener recursion
to one link. WebKit `713192fa` (`FrameTree::find`, `isFrameFamiliarWith`) limits
other-page candidates to direct/shared opener relationships. The discussion in
[HTML issue #313](https://github.com/whatwg/html/issues/313) separates group
membership from origin/opener lookup checks; clearing an opener does not move
the context to another group. [Issue #5680](https://github.com/whatwg/html/issues/5680)
tracks auxiliary identity versus current opener presence. Browlet preserves the
existing distinction and follows the current HTML predicate for general familiarity.

The [WebKit change](https://github.com/WebKit/WebKit/commit/7b91738ddc761fee01c2c20cf7f65b3693e7a156)
introduced its additional relationship restriction in 2018 to enable process
swapping. Browlet retains the direct same-origin match allowed by HTML and the
other engines. HTML's [2023 opener change](https://github.com/whatwg/html/pull/8573)
replaced the disowned flag with null without adjusting familiarity's recursion;
its [2024 named-lookup rewrite](https://github.com/whatwg/html/pull/10818) also
reused that predicate unchanged. Neither change supplies a cycle rule or an
argument for transitive opener lookup.

### Remaining dependencies and validation

Named lookup still reaches `Window.hasTransientActivation()`'s explicit unfinished
boundary; `Navigable.isAllowedBySandboxingToNavigate()` is implemented.
`Window.close()` must select its incumbent context, take a source snapshot,
apply familiarity and sandbox permission, and queue the existing closing
coordinator; implementing the predicate does not complete that caller. Creation,
navigation/history, CSSOM View, and teardown dependencies remain as documented
above. The grouping audit follows below.

The 16 related-context tests cover live/retained ancestry, top-level classification,
strict and opaque origins, opener chains, disowned openers, cycles, and internal
preconditions. Named-target tests now use real familiarity by default and cover
both disowning and the one-opener named-lookup boundary independently of the
general familiarity algorithm.

All 11 focused suites pass across Node 24.19.0, Node 26.8.1, and custom Node
27.0.0-pre, each with and without the addon: 229 passing cases per addon run;
226 passing and the same three existing expected failures per fallback run.
Those failures concern native Window identity and prototype immutability, not
familiarity. Typechecking, type contracts, touched-file ESLint, import hierarchy,
and whitespace checks pass. No new expected failures or runtime changes.

After the approved opener-depth revision, the focused 93 cases pass on Node
26.8.1 with the addon. Typechecking, touched-file ESLint, and whitespace checks
pass. The revision changes a pure predicate, with no engine or binding changes.

## HTML §7.3.2.3: Groupings of browsing contexts

Audited against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30), from [groupings of browsing contexts](https://html.spec.whatwg.org/multipage/document-sequences.html#groupings-of-browsing-contexts)
through automatic context removal, stopping before §7.3.3's fully active Documents.

| Requirement | Owner and status |
| --- | --- |
| Nullable top-level group and user-agent group set | `BrowsingContext.group` starts null; `UserAgent.browsingContextGroupSet` owns registered groups. |
| Ordered top-level context membership | `BrowsingContextGroup.browsingContextSet` preserves insertion order. New groups contain their initial context; auxiliary creation appends to the opener's group. Child creation does not register a top-level context. |
| Weak ordered agent-cluster map | `AgentClusterMap` now holds weak values with structural origin/site keys. Lookup and iteration prune collected entries; recreating a collected entry places it last. Live agents, realms, or scheduled work can still retain their cluster. |
| Historical origin-to-key decisions | `HistoricalAgentClusterKeyMap` remains strong and only gains entries through the allocation algorithm. It survives cluster collection, preserving the first Origin-Agent-Cluster decision when a cluster is recreated. |
| Isolation modes | Groups default to `none`. Both `logical` and `concrete` select origin-keyed clusters. COOP/COEP processing selects `logical` for the required policy combination; the host does not provide physical isolation. Window capability requires `concrete` and the Permissions Policy check. Logical isolation grants no capability. See the [policy audit](../policy/ROADMAP.md). |
| New group and Document | `BrowsingContextGroup.create()` registers the group with its UserAgent, creates with null creator/embedder, appends the context, and returns the group and Document. |
| Append/remove primitives | Append maintains the reciprocal association. Remove clears that association, removes membership, and unregisters an empty group. Existing creation/destruction callers use these primitives; explicit destruction retains its documented teardown dependencies. |
| Automatic collection | `UserAgent.collectBrowsingContexts()` is an explicit throwing boundary for the final lifetime rule. Document lifetime tracking and WindowProxy collection eligibility remain unfinished; there is no automatic caller yet. |

The automatic rule needs **both** destruction of every Document referring to a
context and collection eligibility of its WindowProxy. A null active Document,
detached iframe, or empty current history entry does not establish those conditions.
The group's strong context membership currently also reaches the proxy. Completing
this rule therefore needs lifetime integration with Document destruction and the
WindowProxy owner, not merely a finalizer attached to the current object graph.
`Document.destroyAndDescendants()` and inactive-history teardown remain explicit
§7.5.10 dependencies. Weak cluster storage does not complete any of those paths.

The focused regression first failed because the group kept an otherwise
unreachable cluster alive. It now proves collection of real Window agents without
Windows, retaining both initial site-keyed and origin-keyed choices on recreation.
Additional coverage checks creation order, reciprocal membership, removal of the
last context, isolation between groups, and ordered live-cluster iteration.
These tests do not claim that a retired Window or native realm is collectible.

All nine focused suites pass across Node 24.19.0, Node 26.8.1, and custom Node
27.0.0-pre, each with and without the addon: 192 passing cases and one existing
expected failure per addon run; 188 passing and five existing expected failures
per fallback run. The shared failure is Window's blocking Atomics policy; the
fallback-only cases concern native Window identity/prototype behavior and
per-Agent microtask queues. No new expected failures or runtime changes.
Typechecking, type contracts, touched-file ESLint, import hierarchy, and
whitespace checks pass.

## HTML §7.3.3: Fully active Documents

Audited against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30), [fully active Documents](https://html.spec.whatwg.org/multipage/document-sequences.html#fully-active-documents),
stopping before §7.4's navigation and session history overview.

| Requirement | Owner and status |
| --- | --- |
| Active Document of a navigable | `NodeImpl.getNodeNavigable()` checks the active history entry's Document identity. A retained browsing context or the current entry alone does not establish activity. |
| Top-level or recursively active container | `Document.isFullyActive()` accepts an active top-level Document; otherwise it recurses through `Navigable.containerDocument`. That is the embedding element's actual node Document, which can differ from the parent navigable's replacement Document. The existing implementation needs no behavior change. |
| User interaction restriction | The future host input-targeting/delivery and WebDriver input paths must reject interaction with inactive child Documents. The shared predicate is ready; these consumers do not exist yet. This dependency is marked at the predicate and in the [interaction roadmap](../../interaction/ROADMAP.md). |
| Nested-document example | A → B-1 → C followed by replacement of B-1 with B-2 is covered directly: A and B-2 remain fully active, B-1 becomes inactive, and C remains its navigable's active Document while becoming not fully active. Restoring B-1 restores C's full activity. |

Existing consumers already include History, Location, Permissions Policy,
Navigation API checks, timers, and task runnability. `Task.isRunnable` defers
Document-associated tasks while full activity is false; this does not provide
input targeting or replace the rules for programmatic DOM event dispatch.
The activity-notification tree already includes shadow-tree containers and wakes
child loops after restoration, covered by `task-activity.test.ts`.

The new focused tests cover the specification's nested example, distinguish the
current entry from the active entry, and check retained Location/History access,
task runnability, and activity notifications across replacement/restoration.
An auxiliary top-level Document also remains fully active when its opener is
inactive. Fixtures prepare real context/Window/Document graphs and select entries
directly; they do not claim to implement iframe loading or history traversal.

Validation: the five focused suites pass on Node 26.8.1 with the addon, with
67 passing cases and no expected failures in that selection. Typechecking,
touched-file ESLint, and whitespace checks pass. No runtime behavior changed.

## HTML §7.4: Navigation and session history overview

Audited the [overview](https://html.spec.whatwg.org/multipage/browsing-the-web.html#history)
against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30). It introduces the following dependencies; it does not supply a
separate executable algorithm.

| Passage | Existing owner and missing connection |
| --- | --- |
| Navigate, fetch/populate an entry, and activate its Document | `Navigable.navigate()` remains the throwing coordinator. Supplied-response preparation and HTML loading exist, as does Browlet's local text route; they do not implement the full Fetch-navigation pipeline. |
| Back/forward can refetch or reactivate an entry | Entry URLs and nullable Document state retain the distinction. `traverseHistoryByDelta()` now captures and queues the request; `applyTraverseHistoryStep()` still needs Document population/reactivation, state restoration, and event delivery. |
| Linearize child histories into one traversable history | Nested histories and distinct-step counting exist. The traversal queue, creation/destruction history update, and full history application remain explicit dependencies. |
| Synchronize multiple navigables, event loops, and clusters | The serial queue can wait for an algorithm's completion; the intercepted-traversal resume boundary still throws. Document-population waits, synchronization, and queue jumping remain §7.4.6 work. |
| 204/205 and attachment responses preserve the active Document | Navigation response selection must handle these outcomes before creating or committing a Document. The `navigate()` stub now names them explicitly. Download navigate-event dispatch alone does not implement download response handling. |
| Location/Refresh/X-Frame-Options/CSP/COOP headers | Fetch redirect processing and policy components are available, but HTML navigation must coordinate redirects, snapshots, response selection, and X-Frame-Options enforcement. Document creation already applies CSP/COOP and context-group changes. HTTP Refresh parsing and load-relative scheduling exist; meta insertion and ordinary navigation's transient-activation dependency remain explicit. |
| Synchronous fragment and single-page navigation | §7.4.4 connects `Document.updateURLAndHistory()` for History/interception. Fragment navigation uses §7.4.6.2's existing-Document update, reaching the explicit persisted-state restoration boundary. Scrolling and queued joint-history application remain unfinished. |
| javascript: URLs, srcdoc, and beforeunload | URL/origin and inherited-state foundations exist, but special navigation paths remain unfinished. `checkIfUnloadingIsCanceled()` now coordinates queued beforeunload/navigate checks; prompt policy/UI, history application, and teardown still need their owners. |

## HTML §7.4.1.1: Session history entries

Audited [session history entries](https://html.spec.whatwg.org/multipage/browsing-the-web.html#session-history-entries)
through the scroll-restoration-mode definitions, stopping before §7.4.1.2's
Document state audit. `SessionHistoryEntry` now owns its initialization and
persistence operations as a class; capture, traversal, and History commits remain unfinished.

| Entry item or rule | Representation and status |
| --- | --- |
| Step | `number | 'pending'`, initialized to `pending`. Committing algorithms assign nonnegative steps; traversal-queue ownership is still pending. |
| URL | Required `URLRecord`, independent of the shared Document state. Construction takes the URL explicitly for entries created before loading and same-document entries with different URLs. |
| Document state / entry's Document | Retains the `DocumentState` object. The `document` getter reads `documentState.document`, including null after destruction; there is no duplicate cached Document field. |
| Classic History API state | `classicHistoryAPIState` starts with `env.serializeForStorage(null)`. §7.4.4 and both §7.4.6.2 Document-update branches call `Document.restoreHistoryObjectState()`; persisted-state restoration and the full traversal caller remain unfinished. |
| Navigation API state | Existing separate `navigationAPIState`, initialized with `env.serializeForStorage(undefined)`. Navigation entry/state consumers continue using this field rather than classic History state. |
| Navigation key and ID | Each new entry gets two fresh UUIDs. Replacement/key reuse remains the committing algorithm's responsibility. |
| Scroll-restoration mode | Existing `auto` default and `manual` alternative, exposed by History. The mode controls normal restoration; it does not itself measure or change scroll positions. Navigation's explicit scroll operation has its separate rules. |
| Scroll-position data | Explicit null-only `scrollPositionData` placeholder, pending viewport/region capture and a format that can survive Document recreation. `SPEC_MISMATCH` flags this provisional representation for review. |
| Persisted user state | Explicit `persistedUserState: null`. Optional form-value/directionality capture is not selected yet; no generic opaque record or speculative form model is introduced. |
| Serialized state and explanatory examples | The existing storage serializer/deserializer supplies cloning. Entry-local state remains separate even when entries share a Document. Refetching, reactivation, History-state updates, and popstate delivery must connect the examples in later slices. |

Construction has one required signature: `new SessionHistoryEntry(url, documentState, env)`.
`BrowletEnvironment.createSessionHistoryEntry(url, documentState)` forwards to it.
The environment supplies storage serialization at construction; the entry does not
retain that environment across Document destruction or repopulation. Both production
callers currently have a live Document and pass its URL and environment explicitly.
An entry prepared before loading instead supplies the destination URL and unpopulated
state directly, without inferring either input from a nonexistent Document.

`DocumentState` owns the shared state as a class, audited below in §7.4.1.2.
Its initializer retains a supplied Document without extracting navigation metadata.
`DocumentBackedState` remains the live-Document requirement for Navigable construction.

`entry.savePersistedState()` retains its throwing capture boundary. The
[§7.4.6.5 audit](#html-7465-persisted-history-entry-state) implements the
auto/manual and Navigation suppression gates in `restorePersistedState()` and
the user-scroll guard in `restoreScrollPositionData()`. Position capture and
actual restore attempts still throw. Capture needs restorable region identity
and measurements; restoration needs layout, input-produced user-scroll state,
optional retries as content loads, and scroll anchoring. Child navigable containers are excluded because
children restore through their own entries. The [rendering roadmap](../../rendering/ROADMAP.md#measured-dom-apis)
records that dependency. Optional form-state persistence should retain directionality;
restoring values must not dispatch input/change and must eventually respect
form-associated custom-element restoration callbacks.

The focused regression first failed because `classicHistoryAPIState` was absent.
Tests now cover defaults, unpopulated entries, independent URLs/UUIDs/state on a
shared Document state, cloning, and Document clearing/repopulation without losing
entry data. The class conversion also updates fixtures to create real entries,
preserving identity-sensitive tests that deliberately reuse keys and IDs.
The affected tests and related History state suite pass on Node 26.8.1 with the
addon: 40 suites, 561 passing cases and seven existing expected failures.
Typechecking, touched-file ESLint, import hierarchy, and whitespace checks pass.
No new browser compatibility choice or native change is involved.

## HTML §7.4.1.2: Document state

Audited [Document state](https://html.spec.whatwg.org/multipage/browsing-the-web.html#document-state)
against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30, upstream checked before this pass), through the latest-entry
definition. Centralized history modifications remain the next slice.

`new DocumentState()` creates unpopulated state with the specified defaults.
`DocumentState.create(document)` supplies the live-Document refinement required
by Navigable construction. Neither construction path captures navigation inputs
or marks the state populated. The state does not retain an environment across
Document destruction; the live Document owns its environment.

| State item | Owner and status |
| --- | --- |
| Document | Nullable live Document, initially null. Entries sharing the state observe its clearing or replacement through their `document` getter. Refetching versus cached reactivation still needs entry population and history application. |
| History policy container | Initially null. The existing local commit path retains the container when `PolicyContainer.requiresStorageInHistory()` requires it; full Fetch/history population remains unfinished. |
| Request referrer | Uses the existing Fetch representation: `undefined` for client, null for no-referrer, or a URL. Capturing the source request and replaying it during population remain explicit navigation dependencies. |
| Request referrer policy | Defaults to strict-origin-when-cross-origin and remains independent of the history policy container's policy for outgoing requests. `NavigationHistoryEntry.url` already consumes this request policy; navigation still needs its source-policy capture. |
| Initiator origin | Initially null. Initial context/child creation supplies the known origin; general navigation must retain the source initiator through its snapshot/population pipeline. |
| Origin | Initially null. Existing local creation retains the computed origin. Restoring about: Documents and comparing origins after repopulation, including clearing a changed-origin target name, remain explicit §7.4.2/§7.4.6 dependencies. |
| About base URL | Initially null. The local creation path retains `NavigationParams.aboutBaseURL`; full navigation must capture the initiator's base URL and restore it for about: Documents. |
| Nested histories | A fresh list per state, associating each child navigable's ID with its history entries. Existing child creation/destruction and history counting use it; identification across reloads is unresolved below. |
| Resource | Null, stored HTML for srcdoc, or a POST resource. Browlet's local text route retains its supplied HTML; that does not implement iframe srcdoc loading or POST capture/replay. |
| Reload pending | Initially false. Reload preparation and the traversal/population consumers remain unfinished at their existing boundaries. |
| Ever populated | Initially false, including when construction receives a live Document. The existing local history-entry creation path sets it after Document initialization; full population must manage it too. |
| Navigable target name | Initially empty. Creation, target lookup, and Window name updates already use it. Origin-changing repopulation must clear it. |
| Not restored reasons | Initially null. Document-tree collection, top-level origin masking, and platform projection are available; lifecycle callers and Navigation Timing remain unfinished. |

`state.evictDocument()` represents the optional cache-eviction request in this
section: no Document is a no-op, a fully active Document is rejected, and an
inactive Document is passed to `Document.destroyAndDescendants()`. That lifecycle
operation still throws until §7.5.10 supplies recursive teardown, inactive-history
ownership, and clearing of the retained Document. The request does not clear the
state before teardown. No automatic eviction caller or memory-pressure policy is
implemented; HTML deliberately leaves the choice of when to evict unspecified.

The [POST resource](https://html.spec.whatwg.org/multipage/browsing-the-web.html#post-resource)
type retains bytes or failure and the three permitted form content types. Its
source comment and `Navigable.navigate()` explicitly require stable bytes across
repeated reads, access only in parallel, and failure if the original bytes cannot
be recovered. Form submission/body capture (§4.10.22) and navigation replay
(§7.4.2) remain missing. No disk-backed resource abstraction is introduced before
those producers and consumers exist.

**SPEC_GAP(nested-history-reload-identity):** HTML itself leaves identification of
a child navigable across reloads unfinished immediately after the
[nested-history definition](https://html.spec.whatwg.org/multipage/browsing-the-web.html#nested-history).
The current symbol IDs associate retained live children with their histories;
they do not define how newly created children recover those associations after
a reload. The matching rule remains pending, and the `NestedHistory.id` field
marks the gap. No browser-specific matching rule is selected in this pass.

Contiguous same-document entries retain the same `DocumentState` object rather
than copying its fields. The shared-state entry tests cover clearing/repopulation,
and same-document fixtures now preserve that identity. History/interception's
§7.4.4 producer shares that state and maintains latestEntry. Fragment navigation
uses the separate §7.4.6.2 existing-Document update, with persisted-state restoration
and scrolling still unfinished.

`Document.latestEntry` now starts null. The existing provisional local commit
path sets it to the committed entry, and an inactive Document retains its own
pointer after replacement. Creating an entry alone does not change the pointer.
Synchronous URL/history updates and both §7.4.6.2 Document-update branches maintain it.
The active entry of a Navigable is not a substitute for
this Document-owned state. The new regression first failed because the field
was absent, then passed for two successive real local commits.

Validation: 79 affected/related suites pass on Node 26.8.1 with the addon,
with 1,336 passing cases and 11 existing expected failures. Typechecking,
touched-file ESLint, import hierarchy, and whitespace checks pass. The fixture
changes primarily replace the former factory and preserve real class instances;
no new expected failures, browser compatibility choices, or native changes.

## HTML §7.4.1.3: Centralized modifications of session history

Audited [centralized modifications](https://html.spec.whatwg.org/multipage/browsing-the-web.html#session-history-traversal-queue)
against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30), through both queue-jumping examples. The next slice is §7.4.1.4's
low-level history operations.

`SessionHistoryTraversalQueue` now owns the ordered algorithm set and its drain
in a dedicated module beside Navigable. Traversable initializes it with the
Document's UserAgent; the queue retains that browser owner and remains usable
after the Document becomes inactive or is cleared. It does not retain a Window
environment or enter an HTML event-loop task to perform background work.

| Requirement | Implementation and remaining dependency |
| --- | --- |
| Ordered algorithm set | Retains pending callable steps, removes the current item before running it, and preserves insertion order and set identity. Pending items remain accessible for later history application's selective removal. |
| Append traversal steps | Traversable forwards to the queue, which appends and requests a drain. Appends during execution follow existing pending work. |
| Append synchronous navigation steps | Each append creates a callable tagged with its target navigable without modifying the supplied callback. Tagged steps run in normal queue order unless history application explicitly selects them. |
| Start and run in parallel | Uses `UserAgent.runInParallel()`, sleeping when empty rather than implementing the specification's conceptual busy loop. Idle queues schedule no recurring work; a subsequent append wakes them. |
| Run one algorithm before the next | Synchronous steps run directly. A step can return an `InternalPromise` to retain queue ownership while waiting; the UserAgent's `HostPromise` observes completion and schedules resumption without interpreting its result. This queue adaptation and browser ownership were reviewed and accepted. History application and its queued callers now propagate their completion. |
| Queue jumping | §7.4.6.1's `runSynchronousNavigationSteps()` selects eligible tagged steps and retains `runningNestedApplyHistoryStep` through their completion. Its coordinator must still maintain the navigables-that-must-wait set and connect population/continuation processing. Tagged appends and population continuations must wake the suspended operation; its completion promise alone does not provide that notification. These remain explicit at the history-application boundary. |

Internal algorithm exceptions are surfaced on the executing background turn;
rejected completions are reported through the browser's parallel scheduler.
Neither is converted into a successful history application. A failed algorithm
does not leave the queue permanently occupied or discard later queued work.
These are internal failures, not a new author-facing cancellation outcome.

The existing callers now pass the former queue boundary. Child creation assigns
the child's step and inserts its nested history before reaching
`updateForNavigableCreationOrDestruction()`. Definite closing reaches
`Document.unloadAndDescendants()`. Navigation API traversal and intercepted
traversal reach `applyTraverseHistoryStep()` and `resumeTraverseHistoryStep()`.
The history operations now return completion after permission/cancellation checks;
admitted requests reject before population/activation. With the activation
dependency supplied, a Navigation request can therefore be accepted before its
unfinished history owner fails; the queue does not supply the missing tracker
commit/finish settlement. Tests retain each actual boundary and also exercise
real parallel delivery of an existing cancellation outcome to the Navigation
owner. Automatic element loading/removal and prompt policy/UI remain unfinished.

The two specification examples require later history application:

- `history.back(); location.href = '#foo'` needs the fragment's synchronous local
  entry update and queued central update to run before traversal unloads that
  Document. The latter must select eligible tagged work while population waits.
- When one child has already advanced during traversal and another is still
  loading, the first child's synchronous navigation must wait until the traversal
  changes the central history step. Its later append then uses that new step and
  clears forward history. The queue alone cannot determine this eligibility.

No fragment/history producer or automatic queue-jumping policy is substituted.
The queue tests cover pending-item removal without claiming to implement those
two examples. Existing local top-level commits remain provisional and do not
yet enforce queue ownership for every central-history mutation.

The new tests first failed at the old throwing append boundary and the absent
synchronous-navigation append method. They now cover serial ordering, reentrant
appends, idle wake-up, completion waits, independent traversables, per-append target
tags, selective removal, error recovery, and completion after Document retirement.
The seven affected suites' 127 cases pass across Node 24.19.0, Node 26.8.1, and
custom Node 27.0.0-pre, with and without the addon. The broader Node 26/addon
browsing run passes 122 suites and 2,654 cases, with four existing expected failures.
Typechecking, type contracts, touched-file ESLint, import hierarchy, and whitespace
checks pass. No new expected failures or native changes; existing matching addon
artifacts were used without rebuilding.

## HTML §7.4.1.4: Low-level operations on session history

Audited all four [low-level operations](https://html.spec.whatwg.org/multipage/browsing-the-web.html#low-level-operations-on-session-history)
against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30); the clean checkout was refreshed and already current.

| Operation | Implementation and audit result |
| --- | --- |
| Get session history entries | `Navigable.getSessionHistoryEntries()` already walks the ordered set of retained Document states and returns the original list for the navigable ID. It does not depend on a live Document or the active DOM tree. Missing retained history remains an internal invariant failure. |
| Get session history entries for the Navigation API | The existing method selects the greatest step at or before the target and the contiguous entries of the same strict origin on either side. Keep the approved `SPEC_CLASH(navigation-entry-zero)` correction: include index zero despite HTML's backward-loop condition. Existing entry-list tests retain origin boundaries, target-step gaps, and child histories. |
| Clear forward session history | `Traversable.clearForwardSessionHistory()` now removes greater steps from each retained list in place, then visits child lists reachable through the remaining entries. Lists shared by multiple entries are visited once. Histories reachable only through removed entries are left alone; this operation does not destroy their Documents or fire disposal events. |
| Get all used history steps | `Traversable.getAllUsedHistorySteps()` extracts the existing nested-list walk and numeric sort from `getHistoryLengthAndIndex()`. The latter now consumes it. It includes retained, unpopulated states and deduplicates shared steps and lists. The sorted, duplicate-free array representation of the specified ordered set was reviewed and accepted. |

The forward-clearing regression first retained child steps `[1, 4, 7]` when
clearing at step 3 required `[1]`. It now also covers grandchild lists, a child
history becoming empty, list identity, shared Document states, and histories
reachable only through removed entries. A local document-navigation regression
checks that this pruning runs through the existing commit path and excludes the
discarded child steps from `history.length`.

The specification requires queue ownership for history lookup, clearing, and
used-step collection. This remains an explicit dependency, not an enforced
assertion: initial creation and the provisional local commit still call them
synchronously. Navigate's population completion already queues finalization;
the local loader and §7.4.6 application must establish their proper call paths
before enforcement. Delta traversal and the used-step selector
will consume the new helper when their algorithms are implemented; full history
application, Document population, and queue-jumping wake-ups remain unfinished.
Inserted histories must have committed numeric steps; collecting or clearing
retained pending entries raises an internal error.

Validation: six focused tests and the related History, Navigation entry/traversal,
child/top-level creation, and Document lifecycle suites pass on Node 26.8.1 with
the addon: seven suites, 148 cases, no expected failures. Typechecking,
touched-file ESLint, import hierarchy, and whitespace checks pass. No scheduler,
binding, or native changes were needed.

## HTML §7.4.2.1: Navigation supporting concepts

Audited the navigation overview and all [supporting concepts](https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigation-supporting-concepts)
against local WHATWG HTML `404b3eb14a7a936dddefb2d78e224dbeb01d2358`
(2026-10-30), refreshed earlier in this session. This slice stops before
§7.4.2.2's navigate algorithm.

The overview distinguishes the `navigate` algorithm from reload/delta traversal
and non-fragment URL/history updates. Their existing separate entry points remain;
the supporting helpers do not complete any of those pipelines.

| Concept | Implementation and remaining dependency |
| --- | --- |
| Source snapshot and capture | Existing `SourceSnapshotParams` captures activation, active sandbox flags, download permission, the source Fetch client, and a cloned policy container. Null denotes browser UI, with unrestricted fresh defaults. Real Document capture still reaches the explicit §6.4 transient-activation boundary. |
| Target snapshot and capture | `Navigable.snapshotTargetParams()` now returns the creation sandbox flags and iframe referrer-policy keyword together. It uses the current active browsing context and the container's current node Document, including after adoption. The existing object/embed/frame sandbox-inheritance boundary remains explicit; §7.1.5 refers to an iframe flag set those containers do not define. |
| Capture before asynchronous work | `createNavigationParams()` can consume an earlier target snapshot. Its local-route default captures immediately. Final sandbox flags are copied before response CSP is added, so later iframe/ancestor changes and response preparation cannot mutate the saved snapshot. `navigate()` captures the source before its Agent handoff; target capture before parallel loading and onward propagation remain in its non-fragment continuation. |
| Navigation ID | `navigate()` now generates a UUID and supplies it to early cancellation and fragment dispatch. `NavigationParams.id` and Document's loading ID retain their inputs; connecting the generated value to ongoing-navigation and population remains §7.4.2.2 work. Local supplied-response navigation still uses null. |
| NavigationHistoryBehavior and history handling | Existing IDL/type declarations distinguish auto/push/replace from resolved push/replace. Push clears forward history; replacement retains the position. The beginning-navigation prefix now resolves auto with the specified URL/origin/browser-UI conditions. |
| Navigation must be a replace | `Document.navigationMustBeReplace()` already implements javascript: or initial about:blank. The provisional local resolver now calls that predicate instead of duplicating it. Equal URLs and not-completely-loaded Documents are context-dependent rules in later algorithms, not additional conditions in this predicate. |
| User navigation involvement | Existing values retain browser UI, activation, and none. New `EventImpl.getUserNavigationInvolvement()` checks for click and returns activation for trusted events, none otherwise. Calling it from an activation behavior remains the caller's precondition; dispatch tests exercise that route. Hyperlink/form activation consumers remain absent. This classification neither creates nor consumes Window transient activation. |

All navigation-param items have been considered:

| Inputs | Current boundary |
| --- | --- |
| id and navigable | ID slot as above; the receiving Navigable supplies the destination through the already accepted ownership arrangement. |
| request, response, fetch controller, commit early hints | Fields retain request/response/controller identity and the Document callback. Local routes supply a response with a URL and null request/controller. The §7.4.5 srcdoc factory supplies its synthetic response and null Fetch slots; the Fetch factory retains the live controller and body. Network-failure error Documents and actual Early Hints processing remain dependencies. |
| COOP enforcement result, reserved environment, opener policy | Supplied-response and Fetch preparation fill these before creating the Document. The Fetch producer retains the final reservation and accumulated enforcement result. The result is temporarily nullable during provisional local assembly; URL-scoped COOP reporting remains unfinished. |
| origin, policy container, final sandboxing flags, iframe referrer policy | Response policies and captured sandbox/referrer inputs are connected. The srcdoc factory uses retained origin, history/parent policy selection, captured flags/referrer policy, and retained base URL. The Fetch factory selects history/initiator/response policy at the end of its loop. Local cookie-URL inheritance and null-reserved-environment loader integration remain explicit dependencies. |
| navigation timing type, about base URL, user involvement | Existing slots carry their values to Document/history creation. Local routes default to navigate/browser UI. Full Navigation Timing projection, reload/traversal producers, and about: inheritance remain unfinished. |

HTML does not mutate a completed navigation-param record. Browlet's provisional
response path still assembles fields in stages; `params.ts` now explicitly names
the §7.4.5 dependency to finish assembly before consumption. This does not add a
second parameter record or change the accepted destination ownership. Existing
cookie URL and timing conveniences remain implementation inputs.

The target tests cover retained snapshots, independent popup flags, response-CSP
isolation, adoption, and the active-context precondition. Existing sandbox tests
now include embed at the unfinished non-iframe boundary. Event tests use real
activation dispatch, including author redispatch clearing trust. The existing
source-snapshot and must-replace tests remain enabled. No new browser disagreement
or expected failure was introduced.

Validation: eleven related navigation, policy, document-loader, and Event suites
pass on Node 26.8.1 with the addon: 291 cases, no expected failures. Typechecking,
touched-file ESLint, import hierarchy, and whitespace checks pass. No scheduler,
binding, or native changes were needed.

## HTML §7.4.2.2: Beginning navigation admission and handoff

The beginning of [navigate](https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate)
implements the step 1–24 orchestration against WHATWG HTML
`404b3eb14a7a936dddefb2d78e224dbeb01d2358` (2026-10-30). The live standard still
has that date. Step 15 selects the fragment operation; its implementation remains
a named, throwing §7.4.2.3.3 dependency. Step 21 queues javascript: navigation
through the admission checks below. Other URLs pass step 22's event gate and
step 23's container-initiated deferred-fetch quota reservation, then start the
parallel cancellation/history preparation below. Unload cancellation now queues
Document checks; prompt policy/UI and history population remain throwing owner dependencies. This does not enter the provisional
supplied-response loader or complete end-to-end navigation.

| Steps | Implementation and boundary |
| --- | --- |
| 1–6: source preparation and admission | Capture CSP form-submission classification, source policy/activation, initiator origin/base, and enforce the source/user-involvement assertions. Null source uses browser UI defaults; its javascript: case captures the destination origin. The §7.4.2.4 sandbox predicate now runs; rejection returns or throws SecurityError according to exceptionsEnabled. Transient activation still stops at its owner stub. An inactive source without a node navigable is an internal invariant failure; this slice does not invent a permission rule for it. |
| 7–8: identity and Agent handoff | Generate a UUID, retain the source-side values and a shallow copy of option argument values in navigate's local variables, then compare the explicit caller environment's Agent with the destination's. Same Agent continues synchronously; a different Agent or null caller queues on the active Window's navigation-and-traversal task source. No global current-Agent inference or engine changes were added. |
| 9–12: target admission | Read the active Document when continuation runs, report cancellation for its unload counter, stop an eligible iframe's existing lazy-load observer and clear resumption steps, then apply navigation throttling. The BiDi failure hook is provisional: subscription delivery and waiter resumption are unimplemented. |
| 13–14: history selection | Extend the existing resolveHistoryBehavior helper with requested history handling and user involvement. Auto compares against the active Document URL, with strict origin equality or browser UI permitting replacement. Explicit push/replace is preserved unless javascript: or initial about:blank mandates replacement. |
| 15: fragment dispatch | Require no resource, no supplied response, equality to the active history-entry URL excluding the fragment, and a non-null fragment. Forward resolved history, involvement, source element, serialized Navigation state, and the UUID to navigateToFragment. It throws until §7.4.2.3.3; the branch does not create a Document or set the child load-delay flag. |
| 16–20: target preparation and ongoing navigation | Set child load delay, capture sandbox/referrer policy before abortion callbacks, and report BiDi started. A traversal produces a canceled notification with the same UUID and returns without changing ongoing state. Otherwise invoke setOngoingNavigation with the generated UUID and the environment executing the target continuation. Both ordinary-URL and javascript: continuations receive the target snapshot; the approved missing-input correction is recorded below. |
| 21: javascript: dispatch | Create a synthetic FetchRequest with the URL, captured source client (including null), and captured policy container. Queue navigateToJavaScriptURL on the live active Window's navigation-and-traversal task source and return. This request never goes to Fetch. Preserve resolved history handling, initiator origin, user involvement, CSP type, initial insertion, navigation ID, and target snapshot. |
| 22: ordinary navigate-event dispatch | Require non-browser-UI involvement, live source/target same-origin-domain, a non-initial target Document, and a Fetch scheme. Use the active Window's existing Navigation event operation with resolved history handling, sameDocument false, source element, POST-only form entries, supplied or serialized-undefined Navigation state, and the method tracker. Cancellation or interception stops this continuation. |
| 23: deferred-fetch reservation | If the source is the non-null container's node Document, reserve quota for the destination URL's origin through Element.reserveDeferredFetchQuota(). The four container implementations retain the reservation; Document owns control-document selection and available-quota accounting, with FetchRequest supplying retained request length. |
| 24: parallel preparation | Schedule through UserAgent.runInParallel, collect live inclusive descendants, call the explicit unload check, and report cancellation for a blocked or superseded request. Queue recursive abortion on the active Window, prepare fresh DocumentState/SessionHistoryEntry inputs, assemble any supplied-response params, and call the throwing population owner. Its completion appends finalization to the traversable's queue. |

Eric approved the explicit caller environment. Navigation.navigate supplies its
method environment; Location supplies its already-selected incumbent environment;
window-open supplies its entry environment. Those Window call paths execute in
that Agent. Host-only fresh-traversable creation leaves the caller null. The
source Document still supplies initiator data, independently of the caller and
destination; the argument is not inferred from either Document. Existing modeled
entry/incumbent capture limitations remain in the binding owners. This does not
settle the separate abort-notification caller-loop review.

[Setting the ongoing navigation (§7.4.2.5)](https://html.spec.whatwg.org/multipage/browsing-the-web.html#set-the-ongoing-navigation)
now owns the unchanged-value early return, Navigation API abortion notification,
and subsequent assignment. Its invocation-selected environment supplies the loop;
null means host/parallel work. On the same loop, abort/error listeners observe the
old value; from another loop or parallel work, notification is queued and the new
value is assigned immediately. Navigation startup has already handed execution to
the target Agent, so it supplies the active Document's environment without another
task. Tests exercise real signal delivery and tracker/transition rejection, plus
target policy capture before a signal listener changes sandbox flags.

The state is public because later history algorithms also assign it directly,
without this setter's notification. Traversal has not yet connected those writes;
tests supply `traversal` explicitly. Fragment interception records its ID directly
under the approved `fragment-interception-abort` correction. Stop-loading still
needs its setter call; further navigation/history work
must connect the ID checks and resets. The existing local-route finalizer clears
the child load delay, but this prefix does not yet reach it through the specified
traversal queue. The current prefix can leave an ongoing ID and a child load delay
at its explicit continuation failure; it does not pretend a navigation has
completed. BiDi started/failed hooks still emit no protocol events.

The history regression first returned push instead of replace when the active
Document's URL differed from its retained entry. It now compares the specified
Document URL; fragment detection deliberately continues comparing the entry URL.
The local Browlet.navigate caller also now forwards its browser-UI classification:
an opaque-origin Document's same-URL visit previously grew history from one entry
to two; the retained public-path regression requires replacement at that position.
Tests also cover explicit history, browser UI origin exemption, synchronous
sandbox rejection and projected SecurityError, same-Agent different-Window calls,
real cross-Agent/host task delivery, source snapshot versus live target changes,
lazy-load ordering, cancellation UUIDs, fragment inputs, and the unfinished paths.
The two existing source-owner dependencies and fragment execution are supplied by
focused spies in orchestration tests; those tests do not claim those owners work.

The step 24 dependencies now have named calls and signatures. The parallel
preparation audit below records which operations still throw, the eventual wait
contract, and the supplied-response boundary. Frame policy checks, POST replay,
download/204/205 selection, and full history application remain unfinished.

The earlier admission slice's 23 beginning-navigation cases and related Navigation
API/Location initiation suites passed in all six runtime configurations (92 cases each), with
no expected failures. The broader Node 26.8.1/addon run passes nine suites and
273 cases. Typechecking, touched-file ESLint, import hierarchy, and whitespace
checks pass. Custom validation used the existing Node 27.0.0-pre executable in
the regular Node checkout and this worktree's existing addon; no build or engine
change was required.

The steps 16–20/ongoing-navigation follow-up adds 13 cases. Its beginning-navigation,
abortion, and target-snapshot suites pass all 65 cases on Node 24.19.0, 26.8.1,
and the existing custom Node 27.0.0-pre, each with and without the addon. Six
additional initiation/event/commit/Location suites pass all 128 cases on Node 26
with the addon. No expected failures were added. Typechecking, touched-file
ESLint, import hierarchy, and whitespace checks pass; no binaries were rebuilt.

### Ordinary navigate-event caller

Step 22 now connects the already implemented §7.2.6.10.4 event machinery. Its
origin gate compares the live source and target Documents after ongoing-navigation
abortion callbacks, not the captured initiator origin and not the destination URL's
origin. A same-origin source can therefore initiate a foreign-destination event;
that event remains cancelable but cannot be intercepted when URL rewriting is
forbidden. Browser-UI initiation, initial about:blank, and non-Fetch schemes skip
this event path. A supplied response does not bypass the gate.

The operation receives form entries only when documentResource is a POST resource,
including an empty entry list. GET/srcdoc do not expose formData. Absence or null
in the navigationAPIState option means serialize undefined here; serialized null
remains null. This differs from the event operation's default serialized null
used by History, so the caller supplies it explicitly. Tracker acceptance, info
identity, destination projection, AbortError rejection, and interception remain
owned by Navigation and Binding; the caller does not duplicate them.

Production tests exercise Location assign/replace cancellation and
Navigation.navigate state/info with both rejected promises. Pending precommit
interception stops ordinary loading. Immediate intercepted commit now reaches
Document.updateURLAndHistory's §7.4.4 implementation and queues finalization,
whose §7.4.6 history application remains unfinished. Accepted non-intercepted
events reach quota reservation and the parallel unload-cancellation coordinator. No Fetch,
unload, or new-Document completion is claimed. The target-Agent handoff is already
complete before event firing, so this producer uses the Window-local notification
path without a new environment/loop parameter. The broader caller-loop decision
remains open for other lifecycle producers.

The retained browser-only probe is
`node-compat/experimental/navigation-ordinary-event.mjs`. Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2 agree on the tested HTTP/foreign-destination/about:
events, undefined default state, Navigation API info/state and canceled promises,
GET versus POST form data, and initial-about:blank suppression.

`SPEC_CLASH(navigate-event-top-level-data)`: Eric approved HTML/Firefox/WebKit's
Fetch-scheme gate, including data:. Chromium's
[FrameLoader::StartNavigation](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/loader/frame_loader.cc)
blocks renderer-initiated top-level data: navigation with supported rendering MIME
types before reaching event dispatch, unless its embedder allows it. This is an
additional admission policy, not a different definition of Fetch schemes. Browlet
does not add that blocker in this slice. The probe cancels events, so it establishes
event visibility, not final data: loading behavior. Foreign-source and relaxed-domain
eligibility are covered by the written gate and focused implementation tests, not
claimed as observations from this live probe.

Validation: 139 ordinary-event, beginning-navigation, javascript-navigation,
Navigation initiation, and abortion tests pass on Node 24.19.0, 26.8.1, and the
existing custom Node 27.0.0-pre, each with and without the addon. Typechecking,
touched-file ESLint, import hierarchy, and whitespace checks pass. No new expected
failures, native changes, or builds were needed.

### Deferred-fetch quota at navigation

Beginning-navigation step 23 is implemented against Fetch §4.12.1 at `59afe34`
(2026-10-19), matching the live standard's revision. The existing Permissions
Policy parser/inheritance and Document feature checks supply both Fetch-defined
features. No replacement policy machinery or additional environment was added.

- `Element.reserveDeferredFetchQuota()` is restricted to `NavigableContainer`
  receivers. Each iframe/object/embed/legacy-frame implementation stores its
  own numeric reservation; ordinary elements acquire no quota field. Reservation
  clears the previous value first, tries 64 KiB with sufficient shared capacity,
  then tries the separate 8 KiB pool with its sixteen-descendant limit.
- `Document.getDeferredFetchControlDocument()` walks contiguous strict-origin
  ancestors; document.domain relaxation does not join quota pools. Available
  quota checks both policies, subtracts shadow-including container reservations
  and pending requests from shared Documents, and applies the 64 KiB destination
  origin cap. Sent/aborted records and independent foreign control Documents do
  not spend that pool. These queries require an active Document, as their
  navigation and future fetchLater callers do.
- `FetchRequest.totalRequestLength` counts the serialized initial URL without
  its fragment, serialized referrer, header bytes, and retained body length.
  It never consumes the stream. An unknown body length throws; future fetchLater
  body validation/buffering must establish that length before creating a record.
- `Document.potentiallyFreeDeferredFetchQuota()` releases a child's reservation
  once its final origin is strictly same-origin with its container Document.
  `createAndInitializeDocument()` now calls it. A focused regression also exposed
  a pre-existing child replacement failure: child contexts have no direct group
  association, so Window creation must select the top-level context's group.
  Both same-origin and foreign replacement cases retain that regression.

Recorded decisions and gaps:

- **SPEC_CLASH(deferred-fetch-minimal-disabled):** Follow Fetch's 640 KiB top-level
  pool when minimal delegation is disabled; with minimal enabled, 128 KiB is
  reserved and the ordinary pool is 512 KiB. Chromium's
  [GetReservedDeferredFetchQuota](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/fetch/fetch_later_util.cc)
  instead returns zero when minimal is disabled. Eric approved Fetch's rule.
- **SPEC_CLASH(deferred-fetch-reservation-check):** Follow Fetch's available-quota
  check before assigning 64 KiB. Chromium's `GetContainerDeferredFetchPolicyOnNavigation`
  checks inherited policy but omits that capacity check. Eric approved preserving
  the check. The retained internal regression fills eight normal reservations
  before the ninth falls back to minimal quota; this is source-comparison evidence,
  not a claim of a live nine-frame browser probe.
- **SPEC_GAP(deferred-fetch-reservation-origin):** Reservation calls available
  quota without its required origin-or-null argument. Pass null: this reserves
  shared capacity and is not itself a request to the navigation destination.
  A regression fills that destination's request allowance while leaving shared
  capacity available, and verifies that reservation still succeeds.
- **SPEC_GAP(deferred-fetch-request-length):** The length algorithm assumes a URL
  referrer and a body, despite allowing client/no-referrer and null body states.
  Use Request's existing serialization (`about:client` / empty string) and zero
  bytes for no body, matching Chromium's `CalculateRequestSize`. Unknown stream
  lengths remain an explicit failed precondition, not zero-cost requests.
- **SPEC_GAP(deferred-fetch-creation-navigable):** Fetch's release algorithm uses
  the new Document's node navigable before HTML has activated it. Resolve the
  destination through its already assigned browsing context; do not fall back to
  an ambient or currently executing Document. Fetch's origin-to-Document wording
  is read as comparison with that Document's origin, consistent with its note and
  Chromium's `ShouldClearDeferredFetchPolicy`.
- **SPEC_GAP(deferred-fetch-null-container):** In browser-UI top-level navigation,
  both source Document and container Document can be null. Require a real container
  before reservation; equality of those null inputs does not identify one.

The retained browser-only probe is
`node-compat/experimental/deferred-fetch-quota.mjs`. Chromium 156.0.8078.4 accepts
a small request under default policy and throws QuotaExceededError when the
response disables `deferred-fetch-minimal`. Firefox 157.0 and WebKit 27.2 do not
expose fetchLater in these builds. Each attempted request is aborted and the local
server observes zero deliveries; the probe tests admission, not eventual delivery.

Validation: 28 new quota/request-length tests pass. The selected 17-suite run
passes 486 tests with the addon on each of Node 24.19.0, 26.8.1, and the existing
custom Node 27.0.0-pre. Without the addon, each base passes 483 tests and retains
the same three existing native-global identity/prototype expected failures.
Typechecking, touched-file ESLint, import hierarchy, and whitespace checks pass.
No new expected failures, native changes, or binary builds were needed.

**Remaining dependencies:** `fetchLater()` / FetchLaterResult, body admission and
buffering, record creation, activation, and deferred-task priority/delivery remain
Fetch §4.12/§5.6 work. `FetchGroup` still throws on pending-record processing.
Quota release does not finish response loading, redirects, or Document activation.
Object/embed/legacy-frame loading still needs its existing child-creation and
policy integration. Step 24's parallel unload checks, abortion, retained state,
entry population and finalization are the next navigation slice; this step still
throws at that boundary and does not start a network request.

## HTML §7.4.2.3.2: Queued javascript: navigation admission

The [javascript: special case](https://html.spec.whatwg.org/multipage/browsing-the-web.html#javascript-protocol)
has been read in full against the same source revision; the live standard still
reports 2026-10-30. The first slice implemented navigate-to-javascript steps 1–4 after
the new step-21 dispatch. It asserts replacement, ignores a superseded ID, clears
the matching ongoing navigation through the existing abortion operation, and
checks the live active Document's origin using same-origin-domain. The origin
read follows abortion callbacks. This entry runs on the target Window's queued
task, so its environment supplies the executing loop without another argument.
The earlier Agent handoff and this javascript: task remain separate turns.

The policy slice implements step 5 through the source CSP list: form-action,
Trusted Types rewriting, inline matching, and violation reporting. Browser choices
and upstream evidence live in the [CSP audit](../policy/csp/ROADMAP.md#navigation-request-consumer).
Admitted requests now run through ClassicScript as described below. The following
dependencies remain explicit; passing admission/evaluation tests does not establish
string-result replacement or the earlier unfinished navigation callers:

| Dependency | Existing facilities and remaining work |
| --- | --- |
| [CSP navigation request check](https://w3c.github.io/webappsec-csp/#should-block-navigation-request) | Implemented and connected through the captured policy container and source client. Pre-navigation directives run before inline checks, both dispositions report, and the default Trusted Types policy may rewrite the request URL. Fetch request checks remain a different algorithm. Ordinary Fetch navigation invokes the navigation check before dispatch and before each HTTP(S) redirect, using the pending target rather than the previous request URL. |
| Evaluate a javascript: URL | `Navigable.evaluateJavaScriptURL()` serializes, strips the scheme, percent-decodes, UTF-8-decodes, creates/runs ClassicScript with default fetch options, and returns null for abrupt or non-string completions. It selects the live target Document's environment/API base URL after CSP callbacks and retains the runner's reporting/cleanup and scripting policy. Primitive strings now assemble replacement inputs and reach the explicit HTML-loading dependency. |
| Initial insertion without a replacement Document | Implemented selection after author callbacks: re-read the container and active Document, then fire load for an initial about:blank non-iframe child. Iframes call `HTMLIFrameElementImpl.runLoadEventSteps()`, an explicit throwing dependency for mute/load-in-progress flags, resource timing, and post-handler Permissions Policy reporting. Actual element insertion/loading and document.open() must supply that lifecycle state. A removed container receives no event. |
| String-result response and HTML loading | Implemented response/parameter assembly: UTF-8 bytes, text/html, live active Document URL/policy/COOP/about-base/cookie URL, CSP-derived sandbox flags, supplied origin/ID/involvement, and captured iframe policy. The one-argument loader call explicitly throws until response-reader setup, parser-script preparation, and creation/activation integration are supplied. Its existing supplied-reader/script-callback path remains usable. |
| Replacement history | Implemented after the loader returns: retain the live old entry URL and policy/referrer/name/about-base state, clone the history policy container when present, set origin/initiator origin and ever-populated, and append traversal work to finalize replacement. Fresh state clears the old resource/child histories and initializes fresh API state. Full finalization/history application still has its documented dependencies; tests supply the missing loader result and observe queued finalizer arguments. |

`SPEC_GAP(javascript-navigation-target-snapshot)`: the evaluation algorithm's
navigation-params assembly reads targetSnapshotParams. Neither evaluate-a-javascript-URL
nor navigate-to-javascript-URL receives it, and neither defines it. Beginning
navigation already captures this value. Eric approved forwarding that snapshot
as the final argument of both operations, before abortion, Trusted Types, and
script callbacks can change the iframe policy. No fresh read substitutes for it.
The browser probe below does not establish matching capture timing. HTML also
questions request-referrer-policy inheritance; the replacement entry follows its
specified copy of the old history metadata. The synthetic null request is a
separate choice from that retained metadata, recorded below.

Initial admission validation: 12 javascript: cases cover task association, captured policies and
arguments, null/foreign source clients, the extra target task, stale IDs, live
origin checks, domain relaxation, and the explicit CSP boundary. Together with
beginning-navigation and abortion, all 72 cases pass on Node 24.19.0, 26.8.1,
and the existing custom Node 27.0.0-pre, each with and without the addon. The
Navigation API, Location, and window-opening caller suites pass another 84 cases
on Node 26 with the addon. Typechecking, touched-file ESLint, import hierarchy,
and whitespace checks pass. No engine or addon changes or new expected failures
were needed.

The CSP follow-up now passes 61 navigation/policy cases on the same six runtimes,
including actual queued source-policy selection, source/target separation, browser-UI
null clients, form submissions, and a projected default-policy rewrite reaching
the then-unimplemented evaluation boundary. The wider CSP, Trusted Types, beginning-navigation,
and abortion set passes 603 tests on Node 26 with the addon. Typechecking,
touched-file ESLint, import hierarchy, and whitespace checks pass. No new expected
failures, engine changes, or addon builds were needed.

### Classic-script evaluation

`evaluateJavaScriptURL()` now executes in the live destination environment, even
when a Trusted Types callback changes the active Document. The URL's query and
fragment remain part of the serialized source. Decoding occurs once, removes an
initial UTF-8 BOM, and uses replacement for malformed UTF-8. The retained script
captures the target API base URL and default ScriptFetchOptions, without muted
errors or an external-script source URL. Script creation/running handles disabled
scripting, sandboxed scripts, inactive settings, execution contexts, error reporting,
and cleanup; navigation does not reproduce that machinery or use automation evaluation.

Abrupt completion and every non-string value return no Document. Boxed strings
are not coerced; empty primitive strings do require replacement and currently throw
at the same explicit dependency as nonempty strings. A non-string result leaves
the active entry and Document intact and initiates no Fetch. Initial-insertion
load handling follows evaluation, including script errors. Its iframe path stops
at the named owner dependency above; it does not substitute a plain load event.

`SPEC_CLASH(javascript-url-utf8-decoding)` follows HTML, Firefox 157.0, and WebKit
27.2: `%FF` becomes U+FFFD, `%C3%A9%FF` becomes `é` followed by U+FFFD, and `%E2%82`
becomes one replacement character. Chromium 156.0.8078.4 uses byte-for-byte
characters for the invalid escaped run instead (`ÿ`, `Ã©ÿ`, and U+00E2/U+0082).
Its `LocalDOMWindow::CheckAndGetJavascriptUrl` selects `kUtf8OrIsomorphic`; Gecko's
`JSURLInputStream::EvaluateScript` percent-decodes before `NS_ConvertUTF8toUTF16`.
Eric approved UTF-8 replacement. The retained browser-only probe is
`node-compat/experimental/javascript-navigation-evaluation.mjs`; all three browsers
also preserve the Document for boxed-string and thrown-string results, and agree
on valid UTF-8, invalid percent escapes, and the tested leading BOM.

Validation: all 110 queued-navigation, evaluation, beginning-navigation, and
abortion tests pass on Node 24.19.0, 26.8.1, and the existing custom Node
27.0.0-pre, each with and without the addon. The Node 26/addon selection including
CSP/Trusted Types navigation and classic-script creation/running/error reporting
passes 213 tests with two existing skips. Typechecking, touched-file ESLint,
import hierarchy, and whitespace checks pass. No new expected failures or
engine/addon changes were needed.

### String-result response and replacement history

The remaining evaluation steps now assemble the synthetic response and navigation
params, then call `loadHTMLDocument(params)`. Policy and response URL come from the
live Document after script execution, while origin, ID, user involvement, and the
target snapshot come from navigation. Only CSP-derived sandbox flags enter these
params; this algorithm does not merge the captured iframe sandbox flags. COOP is
inherited with both group-switch flags false. Request, Fetch controller, early
hints, and reserved environment retain HTML's null values.

Fetch owns byte-body creation through `FetchBody.fromBytes()`. The existing
UserAgent sandbox owns delivery so pending bytes do not become unrunnable when
the old Document becomes inactive. No second loader, host Fetch, or new environment
was introduced. The body preserves UTF-8 bytes for replay; delivery copies them
into its owning realm.

On a returned Document, navigate-to-javascript asserts the supplied origin,
reads the current active entry, builds fresh DocumentState/SessionHistoryEntry
objects, and appends the existing finalizer to the traversal queue. It retains
the old history URL rather than the evaluated javascript: URL. History policy is
cloned; old referrer metadata, about-base, and target name are retained. The old
resource and child histories are discarded. The finalizer now inserts into the
destination's retained history, including child lists. Its history application
still needs unloading, other affected Documents' updates, cached-Document
reactivation, and lifecycle/event delivery.

The real loader call still throws before Document creation. Its earlier
`ScriptHandler`/`ResourceReader` parameters are now optional so the specified call
can reach that explicit boundary; supplying both retains the reviewed byte-loader arrangement. Completion
requires selecting/reusing the response reader, parser-script preparation and
scripts-may-run gating, and auditing creation with a null reserved environment.
The current provisional response preparer would otherwise manufacture one and
reprocess inherited policy. These are loader/document-creation dependencies, not
successful replacement behavior hidden behind test substitutes.

Browser-only probe: `node-compat/experimental/javascript-navigation-replacement.mjs`,
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It retains an iframe from its
parent, changes referrerpolicy before navigation or during the evaluated script,
and inspects the replaced Document, referrer, ancestry, character set, and body.

- `SPEC_CLASH(javascript-replacement-referrer)`: Eric approved HTML/Firefox's null
  request and empty replacement `document.referrer`. Chromium/WebKit preserve
  the previous referrer. [Blink's DocumentLoader](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/loader/document_loader.cc)
  explicitly copies `referrer_` in `CreateWebNavigationParamsToCloneDocument`;
  [WebKit replaces through DocumentWriter](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/DocumentWriter.cpp) with the
  old owner Document. History request-referrer metadata remains separately retained.
- `SPEC_CLASH(javascript-result-encoding)`: Eric approved HTML/Chromium/WebKit's
  UTF-8. Firefox uses Windows-1252 for Latin-1-only results, including mapping U+0080
  to U+20AC. [Gecko's JSURLInputStream::EvaluateScript](https://searchfox.org/firefox-main/source/dom/jsurl/nsJSProtocolHandler.cpp) explicitly attributes the
  single-byte path to legacy image compatibility. All three replace lone
  surrogates with U+FFFD.
- Snapshot timing remains inconclusive: Chromium/WebKit preserve unmasked ancestry
  for all tested policy changes, while Firefox's replacement has an empty
  ancestorOrigins list even when its predecessor had a parent entry. Those results
  cannot distinguish when HTML's missing target snapshot should be captured.
- `SPEC_CLASH(javascript-about-blank-body)`: all three parse the replacement body
  when the old URL is about:blank. HTML's general loader instead takes a blanket
  empty-about:blank branch. The source marks this unresolved choice at the loader
  boundary; this slice does not enable that incorrect path for synthetic responses.

Browser source also checks lifetime changes during script/unload in ways this
algorithm does not fully describe: Blink checks frame survival and a newly started
provisional navigation; WebKit checks the frame after document replacement begins.
These are source observations, not new live-probe results or behavior adopted here.
Revisit removal/reentrant navigation with the real loader and finalizer.

Validation: 122 queued-navigation, evaluation, replacement, beginning-navigation,
and abortion tests pass on Node 24.19.0, 26.8.1, and the existing custom Node
27.0.0-pre, each with and without the addon. The existing supplied-reader HTML
loader and document-lifecycle suites pass another 41 tests on Node 26 with the
addon. Typechecking, touched-file ESLint, import hierarchy, and whitespace checks
pass. No new expected failures, engine changes, or addon builds were needed.

## HTML §7.4.2.2: Parallel navigation preparation

`navigate()` owns the full sequence: source admission, target-Agent handoff,
fragment/javascript: routing, ordinary event dispatch and quota reservation,
parallel cancellation checks, population, and queued finalization. Its local task
steps retain the source snapshots and copied options. `DocumentState.createForNavigation()`
constructs the pending state; the existing environment factory wraps it in a history
entry. `NavigationParams.fromSuppliedResponse()` constructs the supplied-response
params. Neither factory schedules nor advances navigation.
`BrowsingContext.obtainForNavigation()` owns context selection during Document
creation, with the destination Navigable passed explicitly rather than retained
in NavigationParams. This preserves the ordering of HTML `6d7788b` (2026-11-03), whose
navigate algorithm is unchanged from the audit above, without a chain of
begin/continue/preparation methods or a separate navigation object.

Step 24 of [navigate](https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate)
now runs through the UserAgent's existing parallel scheduler. It reads the active
Document's inclusive descendants when that work starts and asks
`UserAgent.checkIfUnloadingIsCanceled()`, which forwards to Navigable and returns
the browser-owned completion promise. After the checks settle, parallel steps
resume. Cancellation or a changed navigation ID
reports BiDi failure with the original ID/URL and returns before abortion,
history preparation, or population. The BiDi hook itself still has no sessions
or protocol delivery.

After approval, the active Window receives a navigation-and-traversal task that
calls `abortAndDescendants()` on the then-active Document. History preparation
does not wait for that task. Fresh state retains the selected referrer policy,
captured initiator origin, resource, and live target name. Local about: entries
also retain the captured base/origin. The pending entry initializes independent
History/Navigation state and does not replace either current or active history.
POST bodies are retained without being read here.

Supplied responses use their response URL, clone the live source policy, select
the parent policy for srcdoc, union CSP restrictions with the captured target
sandbox flags, determine the response origin, and initialize the specified COOP
result. Request, Fetch controller, early-hints callback, and reserved environment
stay null. This branch does not parse response policy headers through Browlet's
provisional local-route helper. The existing timing fallback and unfinished local
cookie-URL selection remain recorded on NavigationParams.

**SPEC_GAP(supplied-response-parent-policy):** HTML lists multipart response
processing among this branch's callers but dereferences the container Document
when selecting policies. A top-level multipart response has no container.
Browlet passes null for the absent parent policy, which
[policy selection](https://html.spec.whatwg.org/multipage/browsers.html#determining-navigation-params-policy-container)
already accepts. The focused top-level regression first failed at the new
container assertion; it now reaches population. Multipart parsing/delivery
remains separate; this is an input-contract correction, not live browser evidence
that multipart loading works.

Dependencies remain executable boundaries:

- **§7.4.2.4 unload cancellation:** the coordinator now snapshots Documents,
  queues beforeunload/navigate checks, shares prompt state, and resumes navigation
  and top-level closing through browser-owned completion. Prompt policy/UI and
  full teardown remain unfinished. Removed check tasks reject their internal wait. No event loop is blocked
  while waiting for another Document's check.
- **§7.5.11 recursive abortion:** Document.abortAndDescendants explicitly throws.
  The existing single-Document abort operation is insufficient: descendants need
  their own Window tasks and unsalvageability propagation. HTML leaves their
  ordering open; resolve that during the lifecycle audit.
- **§7.4.5 population:** Navigable.populateHistoryEntryDocument has the complete
  inputs, with optional arguments grouped into PopulateHistoryEntryOptions
  (pending callable-shape review). Source selection, srcdoc parameter assembly,
  queued ID rechecks, non-fetch routing, response policy checks, sandbox-blocked
  downloads, and 204/205 completion are implemented below. Fetch parameter
  creation, error Document creation, download admission/handling, and ordinary
  Document loading remain throwing boundaries. The completion callback
  appends finalization only after population finishes, rather than finalizing an
  unpopulated entry immediately.
- **§7.4.2.3.1/§7.4.6 finalization:** insertion into nested history and replacement
  identity are audited below. Full history application, unloading, reactivation,
  and other affected Documents' updates remain unfinished.

`parallel-navigation.test.ts` controls only the missing owners and scheduler
turns. It retains direct checks for the throwing dependencies, exercises the real
parallel scheduler and target-Agent task handoff, and covers cancellation IDs,
captured versus live state, POST non-consumption, supplied-response policies,
and queued completion. Existing event, admission, quota, and abortion regressions
now observe the asynchronous boundary instead of expecting the former immediate
continuation error.

Validation, repeated after the orchestration refactor: 203 cases in eight related navigation, quota, abortion, and
javascript: suites pass on Node 24.19.0, 26.8.1, and the existing custom Node
27.0.0-pre, each with and without the addon. There are no expected failures in
this selection. Typechecking, touched-file ESLint, import hierarchy, and
whitespace checks pass. No engine changes or addon rebuilds were needed.

The §7.4.2.3.1 finalization audit follows below.
The explicit §7.5.2 loader and §7.4.6 history-application dependencies above
remain necessary before javascript: replacement can complete end to end.

## Navigation ownership and local response preparation

`navigate()` retains scheduling, branch selection, population, and the completion
callback that queues finalization. Its value construction now belongs to
DocumentState and NavigationParams, and BrowsingContext owns obtaining a context
for a navigation response. The source-side conflict/gap markers moved with their
algorithms. The owner moves do not complete any of the remaining lifecycle steps.

The expanded COOP checks exposed a missing association after a context-group swap:
the new browsing context had no Navigable until history activation, but Document
creation already needs it for deferred-fetch quota release. Six existing COOP
cases and a focused new creation-time regression failed with
`Deferred fetch quota release requires a navigable`. Obtaining the replacement
now associates it with the existing destination before returning. The regression
also requires the original history entry and Document to remain active, and the
incoming Document's node navigable to remain null until activation.

`Navigable.#prepareResponsePolicy()` stays in place for now. It is called by
`createAndInitializeDocument()`, including the current `Browlet.navigate()` local
source route and the supplied-reader HTML loader. It fills the reserved environment,
COEP, policy container, and COOP result before those callers consume them. Deleting
it now would remove work those paths still require. It now returns before any
allocation or policy work when the caller supplies the final COOP enforcement
result. In particular, final synthetic params retain their null reservation.

Its replacement boundary is explicit:

- [§7.4.5 population](https://html.spec.whatwg.org/multipage/browsing-the-web.html#populating-a-session-history-entry)
  must select the appropriate params producer. In particular,
  [create navigation params by fetching](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching)
  owns the request/reserved client and policy/COOP decisions across redirects.
  The local source route must likewise supply completed inputs before Document
  creation, rather than depend on a late generic preparation call.
- [§7.5.1 Document creation](https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object)
  now consumes final params without replacing intentional null reserved
  environments. Without a reservation, OAC uses the shared incoming-Window
  security calculation; synthetic responses no longer depend on the fallback.
  The remaining Document initialization audit and actual loaders are still
  required before enabling those paths end to end.
- Once the producers and consumer meet that contract, remove the call and helper,
  keeping local-route, policy/group-switch, and inherited-policy/null-environment
  regressions. The policy checks remain at their producers; full history
  traversal is not itself a prerequisite for retiring this preparation helper.

Validation covers 419 cases across 16 navigation, lifecycle, policy, and local-loader
suites on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with and
without the addon. All 419 pass with the addon; each addon-disabled run has 416
passes and the same three existing expected failures. Typechecking, focused
ESLint, and the import-hierarchy audit pass. No new expected failures or native
changes were introduced.

## HTML §7.4.2.3.1: Cross-document finalization

Audited the [ending-navigation overview and usual cross-document case](https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation)
against WHATWG HTML `6d7788b` (2026-11-03), also checked against the published
standard. Finalization runs after population's completion, on the traversable's
session-history traversal queue. It inserts the entry before invoking history
application; it does not fetch or populate the Document itself.

| Requirement | Implementation and boundary |
| --- | --- |
| Queue ownership | `navigate()` and javascript: completion already append this work to the traversal queue. The provisional local loader still calls synchronously. The assertion remains an explicit source TODO until that caller and §7.4.6's Document-loop updates are connected. |
| Release load delay and handle no Document | Release the flag first. Null-document results, including canceled loads and 204/205 paths, return without accessing history or invoking application. Producing those results remains §7.4.5 work. |
| Reset target name | Preserve the existing strict-origin rule: clear on a cross-origin top-level load unless the incoming context is auxiliary with a live opener. Children retain their names. |
| Select history | Capture the active replacement entry, obtain this Navigable's own retained list, and use its traversable's joint step. Child and grandchild lists are no longer rejected or replaced by the top-level list. |
| Push | Clear forward history across retained lists; assign current joint step + 1 and append to the original target list. |
| Replace | Replace the active entry, retain its step, and apply the current joint step. Copy its Navigation API key only when the retained origins are non-null and same origin. Preserve the new entry's ID. Replacement does not clear forward history. |
| Apply the history step | Forward step, history handling, and user involvement to `Traversable.applyPushOrReplaceHistoryStep()`. The finalizer leaves activation to that operation. |

The initial regressions observed a foreign-origin replacement incorrectly
receiving its predecessor's key, and child push/replace throwing
`Nested navigable history is not implemented`. The corrected cases run through
the real traversal queue. Tests also cover grandchild lists, active versus current
entry selection, joint steps advanced by another frame, forward pruning, retained
opaque origins, domain relaxation, absent origins, name-reset conditions, and
projected Navigation keys. Separate integration cases retain the top-level
Document while the existing application machinery activates the incoming child.

The key correction follows all three inspected browser implementations; no new
browser disagreement was found for that rule. Blink's
[`DocumentLoader::SetHistoryItemStateForCommit`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/loader/document_loader.cc)
checks origin access before transferring the key. Gecko's
[`MaybeReuseNavigationKeyFromActiveEntry`](https://searchfox.org/mozilla-central/source/docshell/base/CanonicalBrowsingContext.cpp)
checks the old/new origin, including inherited about: URLs. WebKit's
[`HistoryController::updateCurrentItem`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/HistoryController.cpp)
retains the key only when the old/new URL origins match. This is source evidence,
not a new live browser probe.

The application method's provisional callable shape was reviewed and accepted:
after the specified step/history-handling/user-involvement inputs, it
still receives the chosen Navigable and entry, and returns void. §7.4.6 must
derive all affected entries from the step and return its specified result.
The current path activates only the supplied entry and initializes its Navigation
entries/activation. It does not yet unload old Documents, handle cached-Document
reactivation, update nonchanging Documents, dispatch lifecycle/history events, or
honor user involvement in those Document-loop operations. The source TODO and
existing throwing traversal/population owners retain these dependencies; this
slice does not claim complete traversal or end-to-end navigation.

Validation: all 22 new finalization cases pass in the six-runtime matrix. The
broader selection covers 496 cases in 23 navigation, history, policy, loader,
automation, messaging, and clock suites:

| Runtime | Passed | Existing expected failures |
| --- | ---: | ---: |
| Node 24.19.0 stock | 481 | 15 |
| Node 24.19.0 addon | 486 | 10 |
| Node 26.8.1 stock | 482 | 14 |
| Node 26.8.1 addon | 487 | 9 |
| Custom Node 27.0.0-pre stock | 482 | 14 |
| Custom Node 27.0.0-pre addon | 494 | 2 |

Typechecking, touched-file ESLint, import hierarchy, and whitespace checks pass.
No new expected failures, native changes, or addon rebuilds were needed.

The intervening javascript: algorithms were covered above; their explicit loader
and history-application dependencies remain open.

## HTML §7.4.2.3.3: Fragment navigation coordination

Audited [navigate to a fragment](https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-fragid)
against WHATWG HTML `6d7788b` (2026-11-03) and the published standard. This slice
implements the coordinator through its explicit Document, scrolling, and
same-document-finalization boundaries. It does not complete hash navigation end to end.

| Requirement | Implementation and boundary |
| --- | --- |
| Capture destination state | Capture the previous active entry's Navigation state before event callbacks, unless a supplied serialized value overrides it. Serialized undefined/null are explicit values; null as the operation's input means inheritance. |
| Fire the navigate event | Reuse `firePushReplaceReloadNavigateEvent()` with the history type, same-document flag, involvement, source element, destination URL/state, and method tracker. Its existing abortion, disabled-entry checks, cancellation, and interception remain authoritative. |
| Stop on cancellation/interception | Return without preparing an entry. A surviving intercepted event records the navigation ID directly, preserving its signal and tracker for later abortion. `window.stop()` and browser-UI cancellation remain unfinished callers. |
| Construct the entry | After callbacks, select the live active entry's DocumentState and scroll-restoration mode. Keep Navigation state captured before callbacks, create fresh classic History state (serialized null), and retain the predecessor's key only for replacement. The new entry keeps its fresh ID and pending step. |
| Synchronous script-visible updates | Push clears History state and computes index + 1 / length = index + 1; replace keeps the current index and length. Publish the Document URL and active entry, then call Document history application with length before index. Neither currentSessionHistoryEntry nor the joint step changes here. |
| Apply Document history state | `Document.updateForHistoryStepApplication()` has the complete §7.4.6.2 inputs. Its [existing-Document branch](#html-7462-existing-document-history-updates) now maintains latest entry, restores classic state, and produces Navigation/popstate/hashchange notifications. The [new-Document branch](#html-7462-new-document-history-initialization) initializes Navigation and permits parser scripts after its remaining persistence/scroll dependencies. Reactivation and actual BiDi delivery remain unfinished. |
| Scroll | Call `scrollToFragment()` on the live active Document after history callbacks. HTML target selection and retained `:target` state are implemented; ancestor revealing, viewport geometry, focus, and MIME-specific fragment rules remain explicit dependencies. Loading retries have their own scheduler and unfinished user-interest policy. |
| Queue reconciliation | Append tagged synchronous-navigation steps to the real traversal queue. `Traversable.finalizeSameDocumentNavigation()` now inserts/replaces entries and discards work from a replaced/destroyed DocumentState; see the following audit. Joint same-document history application still throws explicitly instead of resetting Navigation through the provisional new-Document path. |
| Automation | Call the new `UserAgent.webDriverBiDiFragmentNavigated()` only after finalization returns. The status carries the same navigation ID and URL with `complete`; subscribed sessions, waiters, and delivery remain a source-marked no-op dependency. |

### Fragment specification corrections and browser evidence

The preserved browser-only probe is
`node-compat/experimental/fragment-navigation.mjs`, run against Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-03. It uses actual
`navigation.navigate()`, Location hash changes, interception, result promises,
and History/Navigation state; no Browlet mock stands in for browser behavior.

| Rule | Chromium | Firefox | WebKit | Browlet choice |
| --- | --- | --- | --- | --- |
| Intercepted fragment while its handler waits | Signal remains live; committed fulfills, finished stays pending | Same | Same | Preserve the new event and record its navigation ID directly. |
| Next canceled navigation | Aborts the earlier interception; rejects both new results with AbortError | Same | Same | Reuse existing navigate-event abortion and tracker handling. |
| Supplied `info` / Navigation state | Same info object; supplied state in destination/current entry | Same | Same | Forward the existing tracker and serialized state. |
| Ordinary hash destination state | undefined | Previous Navigation state | undefined | Follow HTML/Firefox; committed entries inherit the state in all three. |
| Synchronous push | History length and Navigation index each increase by one; classic state becomes null | Same | Same | Pass length/index in the called algorithm's declared order. |
| Fragment replacement | Retains Navigation key and History length | Same | Same | Follow HTML. |

- `SPEC_CLASH(fragment-interception-abort)`: HTML step 5 invokes
  [set the ongoing navigation](https://html.spec.whatwg.org/multipage/browsing-the-web.html#set-the-ongoing-navigation),
  which aborts the newly intercepted event. That conflicts with the step's own
  cancellation note and every tested browser. Eric approved retaining the event
  and directly assigning the ID. Blink's
  [`DocumentLoader::CommitSameDocumentNavigation`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/loader/document_loader.cc)
  returns on interception, and Gecko's
  [`nsDocShell::HandleSameDocumentNavigation`](https://searchfox.org/mozilla-central/source/docshell/base/nsDocShell.cpp)
  returns when event firing says not to continue, without aborting the new event.
  [HTML #11579](https://github.com/whatwg/html/issues/11579) explains the earlier
  consolidation of abort paths and Blink's different ownership; it does not
  resolve this fragment-step contradiction.
- `SPEC_GAP(fragment-navigation-method-tracker)`: `navigate()` accepts the
  explicit tracker but neither forwards it to the fragment operation nor from
  there to event firing. The missing input would lose event.info and result
  settlement. The implementation adds the optional tracker last and forwards
  it unchanged; Gecko explicitly retrieves the tracker from its load state and
  supplies it to fragment event firing. This added input was reviewed and accepted.
  Omission or undefined defaults to null; there is no third tracker state.
- `SPEC_CLASH(fragment-destination-state)`: Eric approved HTML/Firefox's inherited
  destination state. Gecko explicitly selects the active entry's Navigation
  state before event firing. Blink's fragment dispatch does not supply that
  inherited state; WebKit's fragment call likewise omits its state argument.
  The probe separately verifies that each event actually fired, that its
  destination state was undefined where reported, and that the committed entry
  still inherited the state.
- `SPEC_CLASH(fragment-history-length-index)`: HTML's fragment call supplies
  index, then length, while
  [update document for history step application](https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application)
  declares length, then index. Follow the called operation's signature and the
  browser-observed counters; copying the call literally would swap them.

Tests cover projected Location cancellation, Navigation tracker delivery and
settlement, a retained pending interception and its later abortion, state capture
across callbacks, explicit undefined/null state, live entry selection, keys/IDs,
scroll mode, disabled Navigation events, length/index ordering, real tagged queue
delivery, and the explicit unfinished-owner stops. Document update, scrolling,
and finalization are substituted only in coordinator tests; one result test
connects the actual Navigation entry update at the unfinished Document boundary.
These fixtures do not claim that complete history application or scrolling works.

Validation: all 340 cases in 16 focused navigation, History, Location, and queue
suites pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with
and without the addon. This selection has no expected failures. Typechecking,
touched-file ESLint, the import-hierarchy audit, and whitespace checks pass.
Existing addon artifacts were used; no native changes or rebuilds were needed.

The adjacent finalization algorithm and §7.4.4 URL/history updates are covered
below. §7.4.6 Document updates and scrolling remain separate unfinished owners.

## HTML §7.4.2.3.3: Same-document finalization

Audited [finalize a same-document navigation](https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-same-document-navigation)
against WHATWG HTML `6d7788b` (2026-11-03). `Traversable` owns the operation;
its inputs retain the specification's order, with the traversable as `this`.

| Requirement | Implementation and boundary |
| --- | --- |
| Traversal queue | Fragment navigation and §7.4.4 URL/history updates append tagged steps. The finalizer runs on that queue; its ownership assertion remains a TODO alongside the other low-level history operations. |
| Check stale work | Preserve queued entries sharing the active DocumentState, even when a later same-document entry is already active. Return before history lookup for a different active DocumentState or a cleared Document. This is the approved correction described below. |
| Push | Obtain the destination's own retained history list, clear forward history across the traversable, assign the live joint step + 1, and append. Child/grandchild histories retain their own lists. |
| Replace | Replace the explicitly captured predecessor, preserve its step, and apply the live joint step. Do not clear forward history or select the newer active/current entry as the predecessor. A missing predecessor is an internal contract failure. |
| Apply even on replacement | Forward step, history handling, and user involvement to the existing application owner. Finalization does not change the active/current entry, Document URL, latest entry, or ongoing navigation ID, and does not reconstruct entry state or keys. |
| Same-document application | `applyPushOrReplaceHistoryStep()` explicitly throws before new-Document activation when the destination Document is already active. §7.4.6 must reconcile all affected Documents on their event loops without repeating synchronous notifications or rewinding a newer active entry. |

### Queued-entry conflict and evidence

`SPEC_CLASH(same-document-finalization-active-entry)`: HTML returns whenever the
queued entry is no longer the active entry. Two synchronous pushes therefore
drop the first entry; push followed by replace can drop the predecessor before
the replacement tries to find it. These are the open problems in
[HTML #10232](https://github.com/whatwg/html/issues/10232) and
[#10274](https://github.com/whatwg/html/issues/10274). Eric approved preserving
queued updates within the active DocumentState, while discarding work whose
Document has been replaced or destroyed.

The browser-only probe `node-compat/experimental/same-document-finalization.mjs`
ran on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on 2026-11-03.
All three preserve two immediate fragment pushes as two positions, and preserve
fragment push/replace and History push/replace as one new position containing
the replacement. Navigation entries and History length agree immediately and
after a task; back traversal reaches the first fragment after push/push and the
original URL after push/replace.

This validates the observable rapid-update requirement, not the browsers'
internal queue design or every unloading race. The stale-DocumentState guard
also has implementation precedent in
[Ladybird #11565](https://github.com/LadybirdBrowser/ladybird/pull/11565/changes):
it preserves queued same-document updates while rejecting work from a different
active DocumentState. Browlet does not adopt Ladybird's broader history service.

### Remaining dependencies and regression coverage

The initial application regression failed because the provisional helper called
`initializeEntriesForNewDocument()` for a same-document entry. The new explicit
stop prevents that reset, activation/visibility changes, and partial current-step
updates. It does not implement same-document history application. Document's
§7.4.6.2 update, fragment scrolling, and automatic history events remain separate
throwing boundaries. §7.4.4's URL/history coordinator now reaches this finalizer.

Full §7.4.6 must also account for nested history application while population or
Document tasks are pending. [HTML #12576](https://github.com/whatwg/html/issues/12576)
documents duplicate steps, premature forward pruning, and an older operation
rewinding the joint step when synchronous work jumps the queue. The source TODO
keeps that coordination explicit; this slice does not add speculative pending-step
registries. [HTML #12861](https://github.com/whatwg/html/issues/12861) separately
identifies history application overwriting a newer navigation's ID. This finalizer
leaves that ID untouched; the future application algorithm must preserve it too.

Tests cover root/child/grandchild insertion, live queue-time steps, replacement
with a later active entry, forward-history retention/pruning, all four queued
push/replace pairs, stale/destroyed state, missing predecessors, and the explicit
application stop. Fragment coordinator tests now also reach the real finalizer
and verify BiDi ordering. Those tests substitute the unfinished application
owner; they do not establish end-to-end hash navigation or nested §7.4.6 behavior.

Validation: the 169-case selection in nine finalization, fragment, lifecycle,
History, Navigation, and queue suites passes on all six runtime configurations.
Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre each pass all 169 cases
with the addon; each stock run passes 166 with three existing expected failures.
The 15 new cases pass everywhere. Typechecking, touched-file ESLint, import
hierarchy, and whitespace checks pass. Existing matching addon artifacts were
used; there were no native changes, rebuilds, or newly classified failures.

## HTML §7.4.2.3.4: Non-fetch schemes and external software

Audited the [non-fetch navigation params, document attempt, and external handoff](https://html.spec.whatwg.org/multipage/browsing-the-web.html#non-fetch-schemes-and-external-software)
against WHATWG HTML `6d7788b` and the published standard (2026-11-03).

| Requirement | Implementation and boundary |
| --- | --- |
| Non-fetch params | Retain nullable navigation ID, URL, target sandbox snapshot, source activation snapshot, initiator origin, navigation timing type, and user involvement. As with existing NavigationParams, the receiving Navigable supplies the destination rather than duplicating it in the record; this arrangement was reviewed and accepted. |
| Direct and redirected producers | §7.4.5 population assembles direct non-fetch inputs and calls the operation on the target's navigation-and-traversal task after its stale-ID check. It also accepts the Fetch factory's non-fetch redirect result, which retains the last fetch-scheme response's origin, not the final opaque/custom-scheme URL's origin or the destination Document's origin. |
| Select external or inline handling | `Navigable.attemptToCreateNonFetchSchemeDocument()` asks `UserAgent.shouldHandleURLExternally()`. That owner throws until host protocol support and §8.10.1.4 registered-handler selection are composed. Do not guess an external handler merely from an unfamiliar scheme. |
| External route | Call `UserAgent.handoffToExternalSoftware()` with the captured restrictions, activation, and origin; return null. A sandbox refusal does not fall through to inline creation. No Document, URL, or history mutation occurs here. |
| Handoff sandbox | Only non-top-level destinations are gated. Block when the custom-protocol flag is present and either the top-navigation-with-activation flag is present or captured source activation is false. Existing sandbox parsing supplies the allow-popups, allow-top-navigation, and allow-top-navigation-to-custom-protocols exceptions. The independent allow-downloads permission does not bypass this gate. |
| Resource and confirmation | Handoff accepts either the original URL or FetchResponse. Allowed work reaches `requestExternalSoftwareHandoff()`, an explicit throwing host boundary. It retains origin and activation for abuse checks and confirmation; without transient activation, prior user confirmation is required. No process launch or host configuration API is added. |
| Inline route | Forward navigation ID, timing type, and involvement to `Navigable.createDocumentForInlineContent()` and return its Document. That §7.5.7 owner throws pending opaque-origin/COOP setup, browsing-context selection, content/rendering, and parser-completion/iframe-load work. Choosing a registered web handler must instead navigate its handler URL. |

### Browser evidence and chosen behavior

Source inspection found the same core sandbox rule in Chromium's
[`ChromeContentBrowserClient` external protocol handling](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/chrome/browser/chrome_content_browser_client.cc),
Gecko's [`ExternalProtocolIsBlockedBySandbox`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/uriloader/exthandler/nsExternalHelperAppService.cpp),
and WebKit's [`frameSandboxAllowsOpeningExternalCustomProtocols`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebKit/UIProcess/WebPageProxy.cpp).
Gecko and WebKit also check popup/top-navigation flags directly; those exceptions
already clear Browlet's custom-protocol restriction during sandbox parsing.
This is source evidence, not a live external-application launch test. Product
preferences, enterprise policy, and platform handler availability remain host work.

`SPEC_CLASH(external-protocol-sandbox-teams)`: WebKit bypasses a failed sandbox
check for `msteams:` when the source host is `teams.live.com` or
`teams.microsoft.com` and site-specific quirks are enabled, through
[`Quirks::shouldAllowNavigationToCustomProtocolWithoutUserGesture`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Quirks.cpp).
Eric approved HTML's general rule without that exception. Both source and tests
retain the choice; there is no new site-quirk registry.

### Inline dependency and signature review

`SPEC_GAP(inline-document-response)`: §7.5.7 reads `response.URL` before defining
any response and receives neither a resource nor content input. Its subsequently
constructed empty response also has no specified URL. The missing resource/URL
contract must be resolved when that owner is audited, rather than borrowing the
active Document's URL or fabricating a successful error page here.

The inline stub also accepts a null navigation ID because non-fetch params and
population permit null, although §7.5.7 spells its input as a navigation ID.
That callable shape was reviewed and accepted. The operation remains throwing;
no inline-Document behavior is established by this accommodation.

The 25 focused cases cover parsed sandbox exceptions, captured versus live
activation/restrictions, top-level exemption, URL/response identity, initiating
origin forwarding, the Teams decision, inline metadata/result forwarding, and
the three explicit dependency stops. They substitute only handler selection,
the host handoff, and inline creation where needed; the routing and gate are real.

Validation: all 112 cases in five focused non-fetch, sandbox, beginning-navigation,
navigate-event, and target-snapshot suites pass on Node 24.19.0, Node 26.8.1, and
custom Node 27.0.0-pre, each with and without the addon. No expected failures in
this selection. Typechecking, touched-file ESLint, import hierarchy, and whitespace
checks pass. No native changes or rebuilds were needed.

Next in document order: **§7.4.2.4, preventing navigation**.

## HTML §7.4.2.4: Sandbox navigation permission

Audited [allowed by sandboxing to navigate](https://html.spec.whatwg.org/multipage/browsing-the-web.html#allowed-to-navigate)
against local HTML `6d7788b` and the published standard dated 2026-11-03.
`Navigable.isAllowedBySandboxingToNavigate()` now supplies the predicate already
called by navigation admission and named-target lookup. This bounded slice stops
before the section's unload-cancellation coordinator and beforeunload producer.

| Requirement | Implementation |
| --- | --- |
| Self and descendants | Permit immediately, independently of sandbox flags. Walk navigable parents, without requiring a live DOM collection. |
| Ancestor top-level target | Select the with-activation or without-activation flag using the supplied source snapshot. Other top-level destinations do not get this ancestor exception. |
| Other destinations | Apply sandboxed-navigation, with the permitted-creator exception for a top-level target. Do not add origin/familiarity checks to this sandbox-only predicate. |
| Captured inputs | Consume the supplied activation and flag set; do not recapture them from a current Window or Document. SourceSnapshotParams still owns capture and reaches the unfinished activation predicate. |
| Permitted creator | Compare active browsing contexts: HTML defines and populates the permission on those contexts even though this algorithm names navigables. Keep it independent of the mutable opener. |
| Noopener creation | Retain the sandboxed creator even when opener is null. Otherwise an allowed new window would fail its initial navigate admission. |

### Browser conflicts and approved choices

Eric approved these choices after the live browser-only probe
`node-compat/experimental/sandbox-navigation.mjs` on Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. The probe runs writes in the initiating frame's
realm. Its rejection cases report synchronous SecurityError; its noopener cases
also wait for the new page's destination URL. Playwright disables popup blocking.

| Marker | Choice and evidence |
| --- | --- |
| `SPEC_CLASH(sandbox-intermediate-ancestor)` | Block a sandboxed source from navigating an intermediate ancestor. All three browsers reject it; HTML's algorithm returns true, but its sandbox flag description and [target-name table](https://html.spec.whatwg.org/multipage/document-sequences.html#navigable-target-names) also say it is blocked. Top-navigation tokens do not authorize navigating the intermediate ancestor. |
| `SPEC_CLASH(sandbox-disowned-creator)` | Keep the original creator's permission after the popup sets opener to null, following HTML's stored creator and Firefox. Chromium/WebKit reject the same write, using their current opener relationship. |
| `SPEC_CLASH(sandbox-unrelated-popup-escape)` | Block unrelated existing popups even with allow-popups-to-escape-sandbox, following HTML/Firefox/WebKit. Chromium allows the write. [HTML #1218](https://github.com/whatwg/html/issues/1218#issuecomment-245917846) records agreement that this broader permission was unintended; escaping inherited restrictions is distinct from authority to navigate other windows. |
| `SPEC_CLASH(sandbox-noopener-creator)` | Set the permitted creator for noopener targets too. All three browsers navigate those new targets, with or without sandbox escape. [HTML #12297](https://github.com/whatwg/html/issues/12297) and [PR #12298](https://github.com/whatwg/html/pull/12298) identify the creation algorithm's missing assignment. The source's browsing context is retained internally; opener remains null. |

Source evidence: [Blink LocalFrame::CanNavigate](https://github.com/chromium/chromium/blob/1136757f47/third_party/blink/renderer/core/frame/local_frame.cc#L2088),
[Gecko BrowsingContext::IsSandboxedFrom](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622/docshell/base/BrowsingContext.cpp#L1555),
and [WebKit Document::canNavigateInternal](https://github.com/WebKit/WebKit/blob/713192fa/Source/WebCore/dom/Document.cpp#L5129).
These local sources predate the tested builds. Their origin, frame-busting, and
fenced-frame checks include separate policies beyond HTML's sandbox predicate;
this slice does not infer or implement those policies. Extractlet captured the
GitHub issue discussions without warnings.

### Remaining dependencies and checks

- `Window.hasTransientActivation()` still throws pending §6.4 input notification
  and expiry. Tests supply activation; the sandbox predicate and its callers run
  their actual code.
- `Navigable.checkIfUnloadingIsCanceled()` now queues Document checks and the
  optional traversal pair, sharing prompt state through browser-owned completion.
  The coordinator audit below records its asynchronous callable shape and the
  remaining prompt/lifecycle/history dependencies.
- `Document.fireBeforeUnload()` now supplies trusted dispatch with unload/termination
  counters and the activation/sandbox/request gates; see the producer audit below.
  User-agent anti-abuse policy and confirmation UI still throw; BiDi prompt hooks
  have no active sessions. The coordinator audit below records the approved
  correction for early cancellation before setting eventsFired.
- Full history application still needs to call this predicate with the initiating
  snapshot. Window.close, iframe/hyperlink loading, and the provisional supplied-
  response loader are not made complete by implementing navigation admission.

The new tests cover ancestor/descendant/sibling relationships, both activation
branches, captured-state reuse, popup ownership and escape, real named lookup,
and navigate's silent/error rejection. The noopener creator regression first
failed with a null permitted navigator, then passed after the creation correction.
Existing lookup/admission tests now use the real predicate unless deliberately
overriding a result to isolate caller ordering.

Validation: all 139 cases in the five sandbox-navigation, new-target-selection,
target-names, beginning-navigation, and sandbox-policy suites pass on Node
24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with and without the addon.
There are no expected failures in this selection. Typechecking, touched-file
ESLint, import hierarchy, and whitespace checks pass. No native changes or
addon rebuilds were needed.

## HTML §7.4.2.4: Beforeunload production

Audited the [steps to fire beforeunload](https://html.spec.whatwg.org/multipage/browsing-the-web.html#steps-to-fire-beforeunload)
against local HTML `6d7788b` and the published standard dated 2026-11-03.
`Document.fireBeforeUnload(unloadPromptShown)` returns the specified pair of
shown/canceled booleans. This slice implements the individual Document check;
automatic navigation and closing delivery still stop at the queued multi-Document
coordinator. It reuses §8.1.8 handler conversion and the existing event-loop pause.

| Specification work | Implementation and boundary |
| --- | --- |
| Increase unload and termination counters; fire the event; lower termination | The Document owns trusted BeforeUnloadEvent allocation and Window dispatch. Termination brackets dispatch only; the unload counter stays raised through prompt handling. Both counters are restored if an internal dependency throws. The existing Window.open gate now observes this real producer. |
| Admit a prompt | No previous prompt, no sandboxed-modals, sticky activation, and cancellation/nonempty returnValue are checked before the UserAgent's explicit anti-abuse policy. All events still dispatch when a prompt is suppressed. The sticky predicate uses the existing timestamp; input/automation activation production is still missing. |
| BiDi handling and host confirmation | Call user-prompt-opened with an empty message. Dismiss cancels, accept continues, and none enters the owning loop's pause around host confirmation. Then notify user-prompt-closed with the acceptance result. Author returnValue text never becomes the prompt message. |
| Decrease unload counter and return | Return the shown/canceled pair, retaining a previously shown prompt even when this Document asks for no new one. No multi-Document state, queue, or synchronous polling loop is introduced here. |

### Browser evidence and approved choice

The live browser-only probe `node-compat/experimental/before-unload-production.mjs`
ran on 2026-11-03 in Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
Each browser delivered a trusted, cancelable, nonbubbling, noncomposed event.
With a prior click, preventDefault(), a nonempty returnValue, and an empty-string
onbeforeunload return each caused a prompt; without prior activation none did.
With no cancellation request, none prompted, even after activation.

`SPEC_CLASH(beforeunload-document-target)` records the one disagreement with HTML:
all three browsers expose Document as event.target and Window as currentTarget;
HTML omits the legacy target override when firing at Window. Eric approved using
the existing DOM dispatch override to match browsers. The local implementations
confirm this explicitly: Blink's [Document::DispatchBeforeUnloadEvent](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/dom/document.cc)
passes Document to LocalDOMWindow dispatch, Gecko's [nsDocumentViewer](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/layout/base/nsDocumentViewer.cpp)
sets the Document target before dispatching on Window, and WebKit's
[FrameLoader](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/FrameLoader.cpp)
passes window.document() as the dispatch target. These source revisions predate
the installed browser builds; the live probe establishes their current behavior.

`SPEC_GAP(beforeunload-event-reference)` records HTML's undefined `event` variable
in its returnValue test after firing an event that returns only a boolean.
Retain the created event alongside dispatch's boolean result. This matches all
three implementations and preserves the distinction between cancellation and
a nonempty returnValue; handler conversion remains in its existing owner.

### Explicit remaining owners

- `UserAgent.shouldShowBeforeUnloadPrompt()` still throws pending the user-agent
  anti-abuse policy. Browser source adds its own eligibility rules; this slice
  does not turn those discretionary checks into unconditional approval.
- `UserAgent.requestUnloadConfirmation()` still throws pending a UI host port.
  The host must obtain a response synchronously inside `EventLoop.pauseUntil()`
  without running author code or relying on callbacks on the blocked thread.
  The coordinator must call the producer on the Document's actual task/loop.
- The [BiDi opened](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-user-prompt-opened)
  and [closed](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-user-prompt-closed)
  owner methods retain all specified inputs. With no active sessions the former
  returns none and the latter emits nothing. Session/user-context handler
  selection, subscription delivery, and automation configuration remain explicit TODOs.
- `Navigable.checkIfUnloadingIsCanceled()` now queues this producer and the optional
  top-level traverse event, shares prompt state, and resumes callers after completion.
  Its audit below records the early-cancellation correction and the remaining
  history/lifecycle integration.
- Input/automation activation notification, transient expiry, and the later
  unload lifecycle remain unfinished. This slice does not infer activation
  from synthetic events or implement unloading by firing beforeunload alone.

The six selected suites (beforeunload producer/interface/handlers, user activation,
event-loop pause, and Window opening) pass all 70 tests on Node 24.19.0, Node
26.8.1, and custom Node 27.0.0-pre, each with and without the addon. They exercise
trusted delivery and target identity, Window.open suppression, every prompt gate,
BiDi decisions, host acceptance/dismissal, deferred tasks and microtasks during
the wait, and counter restoration after internal failures. There are no expected
failures or skips in this selection; no native changes or addon rebuilds were needed.

## HTML §7.4.2.4: Unload-cancellation coordinator

Implemented [check if unloading is canceled](https://html.spec.whatwg.org/multipage/browsing-the-web.html#prompt-to-unload-a-document)
against local HTML `6d7788b`. The static Navigable operation retains the specified
inputs and receives its UserAgent last. `UserAgent.checkIfUnloadingIsCanceled()`
forwards the optional arguments and supplies that owner. Its HostPromise carries
the specified three status values across Window tasks without assigning the wait
to any one Document realm. This asynchronous result and owner were reviewed and
accepted; the public History/Navigation APIs gain no new promise here.

The operation snapshots active Documents before any task runs. If a traversable
and a different same-origin target entry are supplied, its beforeunload check
(when requested) and traverse navigate event run first, in one navigation-and-traversal
task. Cancellation returns before queuing the remaining checks. Otherwise, each
remaining Document receives its own task, shared prompt state advances in task
execution order, and completion waits for every check even if one cancels.
Internal dependency failures reject completion instead of stranding the wait or
turning failure into approval. Empty input completes without finding a Document.

The small §7.4.6 dependency `Navigable.getTargetHistoryEntry()` now selects the
greatest committed step at or before the requested step. Pending entries, an
absent candidate, incomplete traversal arguments, and missing recorded history
origins when a comparison is required remain explicit internal precondition
failures. Selecting the current entry skips that comparison. This does not
implement history application or introduce a second history store.

Navigation resumes its existing parallel body after completion, rechecks the
original navigation ID, and only then queues recursive abortion and starts history
preparation/population. Definite closing appends its existing teardown steps after
approval. Rejections reach the host error path. Neither caller blocks an HTML
event loop or polls for another Document to finish.

### Cancellation correction and browser evidence

`SPEC_CLASH(unload-cancellation-completion)` records HTML's early top-level exit
before setting eventsFired. The next step waits for that flag, so the literal
algorithm never returns canceled-by-beforeunload. Eric approved completing the
check with that status while suppressing the navigate event and remaining checks.
The implementation's queued completion settles even when its steps return early;
no separate completion flag or special polling loop is needed.

The browser-only `node-compat/experimental/unload-cancellation.mjs` probe ran on
2026-11-03 in Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. With an activated
page and a persistent canceling listener, all three retained the current page
after dismissing the prompt and allowed a subsequent back navigation after the
listener stopped canceling. This supports the finite cancellation outcome; it
does not establish identical Navigation API promise timing. Firefox rejected
navigation.back().finished with AbortError, while the sampled Chromium/WebKit
promises were still pending after 300 ms. Browser back also produced different
Playwright completion results, so the probe records URL, event, and retry results
separately from the automation request's result.

An additional `--once` variant preserves an admission-policy observation:
Chromium did not prompt when the canceling listener removed itself, whereas
Firefox/WebKit did. The user-agent prompt-admission policy remains unfinished;
this coordinator does not choose a new rule for that separate owner.

### Remaining dependencies and validation

- User-agent anti-abuse policy and confirmation UI still throw; BiDi prompt
  notifications/configuration still have no sessions. Input/automation activation
  production is unchanged. The already implemented producer remains their caller.
- Global tasks retain Document activity gating. A check can remain queued while
  its Document is inactive; teardown that discards such a task must release or
  cancel its waiting coordinator. That lifecycle connection is an explicit TODO
  at task creation, not an automatic success or an activity-bypass workaround.
- §7.4.6 history admission now calls the optional traversal form. Navigation
  and definite closing are also connected; Window.close authorization, recursive
  abortion/unloading, population, and final history application remain their
  explicit owner dependencies. This is not end-to-end navigation or closing.

The six selected coordinator, producer, parallel-navigation, closing, history-
selection, and traversal-queue suites cover queued cross-Agent execution, shared
prompt state, real bound beforeunload/navigate delivery and retry, early cancellation,
retained activity gating, rejection propagation, and navigation supersession.
All 89 tests pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre,
each with and without the addon. There are no expected failures or skips in
this selection. Typechecking, touched-file lint, import hierarchy, and whitespace
checks pass. No addon or engine changes were needed.

## HTML §7.4.2.5: Aborting navigation audit

The current HTML `6d7788b` section defines the ongoing-navigation ID/traversal/null
state and its three-step setter. Both already exist: an unchanged value returns,
otherwise Navigation is notified before the new value is assigned. Existing tests
cover no-op assignments, synchronous callback observation of the previous value,
queued notification from another Agent/parallel work, and real navigation startup.
No additional cancellation mechanism is introduced. History's direct traversal
assignments, stop-loading, and recursive Document abortion retain their owner TODOs.
The caller-loop review remains open for the unfinished stop/destruction handoffs.

The wider audit found three tests still asserting the old unload-check stub's
exception. They failed before correction. The abortion, cross-document-event,
and quota cases now run the queued coordinator with a canceling producer and
retain their original signal/event/quota assertions. No failures were skipped
or reclassified.

## HTML §7.4.3: Reload coordination

Implemented [reload](https://html.spec.whatwg.org/multipage/browsing-the-web.html#reload)
through its traversal-queue handoff. `Navigable.reload()` retains its existing
options-record signature and optional defaults. Location.reload, History.go(0),
and Navigation.reload all reach this same owner.

| Specification requirement | Implementation and boundary |
| --- | --- |
| Select Navigation and state | Use the active Window and active history entry, independently of the current entry. A null/omitted serialized state inherits stored state; a serialized null is a supplied state. |
| Fire the reload navigate event | Reuse the existing event operation with sameDocument false, the active entry URL, selected state, involvement, and tracker. Browser UI skips this early event. |
| Stop on cancellation/interception | Return without changing reloadPending or queuing history work. Real event machinery rejects canceled API trackers and retains pending precommit interception. |
| Mark and queue | After author callbacks return, mark the live active entry's DocumentState reloadPending and append ordinary traversal steps to this navigable's traversable. Child reloads mark only the child state but use the shared top-level queue. |
| Apply the reload history step | `Traversable.applyReloadHistoryStep(userInvolvement)` now checks the then-current joint step with cancellation enabled, null source/initiator, and navigation type reload. It returns internal completion to the queue. Request construction supplies ordinary reload revalidation; dispatching population of reloadPending entries, unloading, Document activation, and Navigation entry/activation updates remain unfinished. Successful cross-document reload must clear the old event/tracker without settling its promises; intercepted reload completion belongs to the existing interception path. |

### Browser evidence and chosen rule

`node-compat/experimental/reload-coordination.mjs` runs the three public entry
points from a load handler, outside automation's injected user-gesture evaluation.
On 2026-11-03, Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 all allowed
navigate-event cancellation before beforeunload or a new request, retained the
current Navigation state, and rejected both Navigation.reload promises with
AbortError. Supplied Navigation state/info reached the canceled event unchanged.

`SPEC_CLASH(history-zero-delta-reload)` records WebKit's different History.go(0)
path: its reload event exposes destination.sameDocument true and undefined state.
Its Location.reload and Navigation.reload use the ordinary cross-document flags
and stored/supplied state. Eric approved following HTML, Chromium, and Firefox:
all three entry points use the shared reload operation. The source marker sits
at event preparation; the browser probe retains the failing WebKit expectation.
Gecko's [nsDocShell::ReloadNavigable](https://searchfox.org/mozilla-central/source/docshell/base/nsDocShell.cpp)
explicitly follows the reload state-selection/event steps. WebKit's
[NavigationScheduler](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/NavigationScheduler.cpp)
routes zero-delta history through ScheduledHistoryNavigation separately from
Location's ScheduledRefresh. The probe establishes the observable difference;
these source paths explain the separate ownership, not an intentional standards exception.

The new focused suite exercises all three projected APIs, state/info/trackers,
interception, disabled Navigation events, browser-UI/activation involvement,
child ownership, and the explicit queued history-application error. No new IDL,
Binding adapter, host policy, native API, or engine change is required.

Validation: all 265 tests in the 13 selected reload, Location/History, initiation,
abortion, event/quota, unload, and queue suites pass on Node 24.19.0, 26.8.1,
and custom Node 27.0.0-pre, each stock and with the addon. There are no expected
failures or skips in this selection. Typechecking, touched-file lint, import
hierarchy, and whitespace checks pass. The separate browser-only probe retains
WebKit's documented mismatch as a failing expectation.

## HTML §7.4.3: Traversing history by a delta

Implemented [traverse the history by a delta](https://html.spec.whatwg.org/multipage/browsing-the-web.html#traverse-the-history-by-a-delta)
against local HTML `6d7788b`. History.go/back/forward already perform Web IDL
conversion, receiver activity checks, admission policy, and zero-delta reload
routing. Nonzero requests now reach `Traversable.traverseHistoryByDelta()`.

| Specification requirement | Implementation and boundary |
| --- | --- |
| Capture the request source | A supplied Document produces SourceSnapshotParams immediately and retains its node navigable as initiator, with involvement none. Its policy clone and activation value precede queued work. Source detachment does not silently replace the captured initiator. |
| Browser-UI source | An omitted Document passes null snapshot/initiator and browser-UI involvement, without consulting any Window's activation. It does not manufacture a SourceSnapshotParams(null). |
| Append traversal steps | Use the existing serial traversal queue with an ordinary, untagged algorithm. Request preparation does not read or prefilter against History.length. |
| Select the target | Read all distinct sorted steps, including retained nested histories, and the current joint step when the queued algorithm runs. Add delta to that step's index, not to its numeric step value. Earlier queued changes therefore affect selection. |
| Out-of-range target | Return from the queued algorithm without applying a step or changing any history entry. |
| Apply the step | Forward the selected step and captured inputs to applyTraverseHistoryStep and return its completion to keep the queue occupied. Delta requests do not interpret the status or synthesize History events. Permission and cancellation are implemented; population/activation remain explicit dependencies. |

The `applyTraverseHistoryStep()` snapshot and initiator parameters now allow null.
Its §7.4.6 prose signature omits those null alternatives, but §7.4.3 explicitly
passes them for browser UI, and the underlying apply-history-step operation
accepts both. This callable-type correction was reviewed and accepted;
parameter order and all four result statuses are retained. The chosen current
step must occur in the used-step list, matching getHistoryLengthAndIndex's existing
precondition; an inconsistent internal history throws rather than treating index
minus one as a real starting position. Pending entries retain getAllUsedHistorySteps's
existing precondition failure.

The new tests exercise projected History requests, nested/gapped history positions,
source capture before detachment, browser-UI null inputs, earlier queued changes,
sequential requests, out-of-range requests, child initiators, zero-delta ownership,
and the explicit activation/application dependencies. Application is observed at
its unfinished owner; these tests do not claim actual traversal or restoration.

Validation: all 103 tests in the seven delta, History/Navigation traversal, source
snapshot, history-operation, traversal-queue, and reload suites pass on Node
24.19.0, 26.8.1, and custom 27, each with the addon disabled and enabled.
Typechecking (including platform type contracts), focused lint, import hierarchy,
and whitespace checks also pass. No failures were reclassified.

Remaining dependencies are Window transient activation for script snapshots and
§7.4.6 Document population/reactivation/unloading, entry/History state updates,
Navigation trackers, history events, and scrolling. Sandbox permission and
beforeunload/navigate cancellation now run while retaining the traversal queue;
population continuations must retain that ownership too.
No new scheduler, native API, or browser-behavior choice is introduced here.

## HTML §7.4.4: Non-fragment synchronous navigations

Implemented the [URL and history update steps](https://html.spec.whatwg.org/multipage/browsing-the-web.html#url-and-history-update-steps)
against local HTML `6d7788b`. `Document.updateURLAndHistory()` retains the
reviewed instance-method signature and default replace/null inputs. History
push/replace and intercepted Navigation pushes/replacements now commit their
synchronous effects through this owner. No new IDL, binding adapter, scheduler,
or native facility is needed.

| Requirement | Implementation and boundary |
| --- | --- |
| Create the entry | Use the environment's existing factory; retain the active entry's DocumentState, scroll-restoration mode, and persisted user state. The latter is still null-only pending §7.4.6.5. New IDs and default Navigation state come from the factory. |
| Select replacement or push | Initial about:blank forces replacement. Replacement retains the old Navigation key; push updates the immediate History index/length estimate. Final joint-history values still belong to §7.4.6. |
| Restore supplied classic state | `Document.restoreHistoryObjectState()` implements the small §7.4.6.2 dependency: deserialize in this Document's environment, catch any exception as null, and store the cached History state. Omitted serialized data preserves both the old serialized record and cached object; serialized null explicitly clears state. |
| Update the Document | Call the existing setURL operation, then assign latestEntry and the active history entry. Current traversal entry and joint step remain unchanged until application. Base URL consumers use the new URL; the existing URL-display, visited-link-state, and speculative-load owners remain provisional. |
| Update Navigation | Reuse its same-document entry/trackers/currententrychange/disposal/handler machinery. Ordinary History changes do not synthesize popstate or hashchange and do not call updateForHistoryStepApplication. |
| Queue finalization | Append tagged synchronous navigation steps before entry-change callbacks, then call the existing finalizer with involvement none. It inserts/replaces entries before reaching the explicit same-document history-application error. |
| Notify automation | After finalization, call the new UserAgent.webDriverBiDiHistoryUpdated owner. It explicitly retains the missing live-session/subscription and browsingContext.historyUpdated delivery work, following the existing BiDi hook arrangement. |

### Browser evidence and approved choices

The browser-only `node-compat/experimental/url-history-update.mjs` probe ran on
2026-11-03 against Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
All three clone and cache classic state, inherit scrollRestoration, allocate a new
key for push and retain it for replacement, create a fresh ID, reset ordinary
History changes' Navigation state, and omit popstate/hashchange.

- `SPEC_CLASH(initial-blank-history-update)`: follow HTML, Chromium, and WebKit:
  both pushState calls on an initial about:blank child replace. Firefox replaces
  the first but adds an entry for the second. Blink's
  `DocumentLoader::UpdateForSameDocumentNavigation` explicitly cites HTML step 4
  for its initial-empty-document replacement rule.
- `SPEC_CLASH(intercepted-navigation-classic-state)`: all three browsers clear
  history.state on intercepted Navigation push and replace. HTML's commit steps
  pass a null classic state to §7.4.4, which preserves the previous state instead.
  The correction is at NavigateEvent.commit: serialize null when classic state
  is absent. Other §7.4.4 callers retain the specified omitted-state behavior.
  Blink's DocumentLoader stores its supplied state even when null; Gecko's
  nsDocShell::UpdateURLAndHistory likewise calls Document.SetStateObject(aData).
- `SPEC_CLASH(synchronous-history-update-reentrancy)`: HTML appends finalization
  after callbacks, allowing a nested push/replace to queue ahead of its pending
  predecessor. The production regression observed reversed pushes and a missing
  replacement predecessor error. Reserve the queue position before callbacks;
  entry insertion still happens only when the queue runs. All three browsers
  preserve the eventual order and back destination. Gecko updates its active
  history entry before Navigation notifications. WebKit can temporarily report
  the earlier History.length during nested push; Browlet retains HTML's immediate
  index/length updates and its eventual correct sequence.

### Remaining dependencies and coverage

This finishes the §7.4.4 coordinator, not end-to-end history traversal. §7.4.6 must
still reconcile joint history/current entries, wait for Document tasks, restore
persisted and scroll state, reactivate Documents, and deliver traversal events.
Its async completion must keep the traversal queue occupied and delay BiDi until
completion. The current explicit throw prevents a partial application from being
reported as success. Navigation admission retains §6.4 transient activation;
automatic interception focus/scroll retain §6.6 and CSSOM View. Tests supply only
those named dependencies when exercising the completed coordinator. Window.open
already calls this owner but still needs its earlier admission/feature setup;
iframe insertion and document.open lifecycle producers are separate work.

The focused suite covers real projected History and intercepted Navigation
updates, receiver-realm state/cycles, omitted versus serialized null,
deserialization failure, initial about:blank, nested currententrychange/dispose
updates, queued finalization/BiDi order, and the actual history-application error.
Existing commit and event tests now distinguish the implemented synchronous
operation from that queued dependency.

Validation: all 296 tests in 15 selected History, Navigation, Window.open,
fragment/finalization, and traversal-queue suites pass on Node 24.19.0, 26.8.1,
and custom 27.0.0-pre, each stock and with the addon. No expected failures or
skips occur in this selection. Generated declarations/type contracts,
touched-file lint, import hierarchy, and whitespace checks pass. Existing addon
builds were used without modification.

Next in document order: **§7.4.5, populating a session history entry**.

## HTML §7.4.5: population selection, srcdoc, and task delivery

This bounded pass implements the outer algorithm's source selection and delivery
to the target Window, plus the complete srcdoc parameter factory. It does not
load an ordinary response or commit a Document. The local HTML source is
`6d7788b` (2026-11-03); the controlling algorithms are
[attempt to populate](https://html.spec.whatwg.org/multipage/browsing-the-web.html#attempt-to-populate-the-history-entry's-document)
and [create srcdoc params](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-from-a-srcdoc-resource).

| Requirement | Implementation or explicit boundary |
| --- | --- |
| Parallel entry and supplied response assertion | The caller runs population through UserAgent parallel work; enforcing the parallel-entry assertion remains TODO alongside the history queue's assertions. NavigationParams requires a response, so a supplied object cannot have an absent response. |
| Source selection | Supplied params take precedence. Any string resource, including an empty string, selects srcdoc before the URL scheme. Fetch schemes select Fetch for a null resource, or for permitted POST replay whose body is not failure. Denied/failed POST replay leaves null params for the error-page branch. Non-fetch schemes assemble their separate params even when POST replay is unavailable. |
| Direct external-protocol inputs | Preserve the navigation ID, entry URL, target sandbox/source activation snapshots, stored initiator origin, timing type, and user involvement. Direct entries require their retained initiator origin; navigation entry creation already supplies it, including a fresh opaque origin for browser-UI navigation. |
| Fetch factory | NavigationParams.fromFetch constructs its request through SessionHistoryEntry.createNavigationRequest, reserves its incoming client through BrowletEnvironmentBase.createForNavigation, checks request CSP, and dispatches Fetch with parallel callbacks. Manual redirects repeat request/response checks, update history state, and replace cross-origin reservations. Admitted final responses assemble complete params and retain their live controller/body. Contained requests retain the initiating Document's origin, following browsers instead of HTML's broken scope-origin override (see below). The result is an InternalPromise of normal params, non-fetch params, null for failure, or undefined for cancellation. UserAgent-owned completion is independent of departing script readiness. ID changes wake the wait and abort Fetch; internal failures report through the host. |
| Task delivery and stale ID | After obtaining params, select the then-active Window and queue navigation-and-traversal work. Recheck the ongoing ID inside that task; stale work calls completion without processing or changing the entry. Tests replace the active Window while Fetch is pending and retain real HTML task delivery. |
| Non-fetch response | Call attemptToCreateNonFetchSchemeDocument on that task, save its nullable Document, and set everPopulated only for a returned Document. Preserve stored origin/history policy/referrer, then complete. External handler selection, launch/confirmation, and inline page creation retain their existing throwing owners. A Fetch-produced non-fetch result preserves its own redirect-origin input. |
| Srcdoc response | Build about:srcdoc, Content-Type text/html, and a UTF-8 body. The body uses the UserAgent's sandbox environment, independent of the departing Document's activity. Empty text and malformed-surrogate replacement are covered. |
| Srcdoc origin and policy | Use the retained origin and captured sandbox flags, creating an opaque origin when sandboxed. Clone the stored history policy when present, otherwise the container Document's policy. Preserve target flags exactly; this operation does not add a second CSP sandbox merge. A real container is required. |
| Remaining srcdoc slots | Supply a fresh opener policy and enforcement result, ID, iframe referrer policy, timing type, about base URL, and involvement. Request, controller, early hints, and reserved environment remain null. The destination remains the receiving Navigable under the previously accepted ownership arrangement. |
| Normal/null response processing | Run CSP navigation-response checking, COEP only for a nonnull reserved environment, and then X-Frame-Options. Null params or a failed check select the error branch. The provisional loader's policy preparation does not replace those checks. |
| Blocked/error response | Call the unfinished inline-content Document owner. Once it supplies a Document, mark navigation-failure unsalvageability, discard any reserved environment, and report BiDi failure for nonnull params. Synthetic params have no reservation to discard. Tests substitute only the unfinished Document creation to cover the remaining steps. |
| Downloads and empty responses | Classify Content-Disposition, check the source permission and final target sandbox flags, then ask the UserAgent's unfinished download-admission owner. Denied downloads and 204/205 complete without a Document; allowed downloads reach the unfinished handle-as-download owner. Attachment handling precedes 204/205. Conflicting disposition fields retain an explicit response-rejection boundary. |
| Document loading and retained state | Prepare the resource's MIME type, then resume on the destination task, recheck the navigation ID, and call Navigable.loadDocument(params, sourceSnapshotParams, initiatorOrigin, resource). Dispatch is implemented; actual §7.5 loaders remain explicit dependencies. Store its nullable result. For a returned Document, set everPopulated, save its origin, and retain the params' policy container when the Document URL requires history storage. Non-fetch/error pages keep the old origin and policy. Resolve a client referrer from a real request, then complete without activating or committing the entry. Synthetic null requests with unresolved referrers still throw pending their specification-gap audit. |

The srcdoc factory has an explicit cookie-URL inheritance TODO tied to HTML
issue #332 and §7.5.1. Before its response can reach document creation, that
metadata and the null reserved environment must survive the loader correctly.
The older `#prepareResponsePolicy()` path still fills a reserved environment;
its previously documented removal condition remains in force. Iframe insertion,
srcdoc attribute processing, parsing, and history reactivation are separate
producers/consumers, not completed by assembling these params.

The new `history-population.test.ts` suite covers selection and POST non-consumption,
actual target tasks, delayed Fetch and Window replacement, stale completion,
non-fetch handoff/metadata, internal failures, and srcdoc bytes/policy isolation.
Tests substitute the unfinished Fetch or external-effect owner where needed;
they also retain assertions that the real unfinished boundaries throw.

Validation: eight affected suites exercise 157 cases on Node 24.19.0, 26.8.1,
and custom 27.0.0-pre, each stock and with the addon. All 157 pass with the
addon; stock runs have 154 passing and the same three existing expected native
Window identity/prototype failures. All new population tests pass on all six
configurations. Typechecking, touched-file lint, import hierarchy, and whitespace
checks pass. Existing matching addon builds were used without changes.

Response admission, failed responses, downloads, the ordinary Document-loading
handoff/retained-state tail, and Fetch request construction are connected below.
Initial reservation, redirect replacement, and the Fetch/redirect loop are connected
below, including final Fetch params and MIME dispatch. Actual §7.5 loaders remain explicit dependencies.

### Response admission: X-Frame-Options

This bounded slice implements
[X-Frame-Options checking](https://html.spec.whatwg.org/multipage/document-lifecycle.html#the-x-frame-options-header).
`Navigable.checkResponseFrameOptions(response, cspList)` uses the existing Fetch
header splitter and live container-Document ancestry. It ignores top-level
navigation, honors enforced frame-ancestors precedence, rejects conflicting
recognized tokens and DENY, and checks every ancestor for SAMEORIGIN. Invalid
values and the legacy ALLOWALL/ALLOW-FROM forms follow HTML's recovery rules.
Report-only CSP does not suppress XFO. An empty or blocking enforced
frame-ancestors directive does suppress XFO, but CSP must enforce that directive
independently before this check runs.

The signature derives the comparison origin from the response URL instead of
accepting HTML's separate destination-origin argument. Absent CSP means no policies
under the existing PolicyContainer representation. A response URL is required
only when SAMEORIGIN needs it; navigation response assembly already supplies one.
The callable arrangement is reviewed; its `SPEC_MISMATCH` is removed. The browser
behavior below retains its continuing `SPEC_CLASH` separately.

Population now runs CSP before COEP and XFO, preserving enforced frame-ancestors
precedence. Passing these checks selects download admission, 204/205 completion,
or the explicit Document-loading boundary; it does not enter the provisional loader.

[CSP navigation-response checking](https://w3c.github.io/webappsec-csp/#should-block-navigation-response)
creates response-policy violations with a null global because the incoming
Document does not exist yet. Its matcher, null-global reporting, and list-level
aggregation are now implemented. Substituting the departing or embedding
Document would give the report the wrong ownership; neither supplies policies
or reporting state for synthetic null-request inputs. HTML now calls this checker
from response population; actual error-page and ordinary Document creation remain unfinished.
The clean CSP checkout was refreshed on 2026-11-03 and remained at `251d288`.

The browser-only `node-compat/experimental/navigation-frame-options.mjs` probe
ran 15 cases in Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three
agree on DENY, same-origin admission, duplicate tokens, trailing-empty conflicts,
ignoring wholly invalid values, ALLOWALL mixed-value conflicts, all-ancestor
checks, enforced frame-ancestors precedence, and lack of report-only precedence.
An empty enforced frame-ancestors overrides XFO but independently blocks in CSP.

Eric approved both choices on 2026-11-03; their source-side markers remain:

| Conflict | Evidence and chosen behavior |
| --- | --- |
| `x-frame-options-sandbox-origin` | HTML supplies the incoming Document's destination origin, which becomes opaque under sandboxing. All three tested browsers instead allow SAMEORIGIN when the response URL and ancestors share an origin, even though the child's postMessage origin is `"null"`. Gecko compares the response URI with ancestor principals; WebKit constructs its comparison origin from the response URL. Browlet follows browsers for destination-origin selection and strictly checks every ancestor. This means same origin, not merely same site; document.domain relaxation is ignored. |
| `x-frame-options-quoted-values` | HTML uses Fetch's quote-aware header splitter. Chromium likewise treats `"INVALID,SAMEORIGIN,INVALID"` as one invalid value and allows it; Firefox/WebKit split literal commas and reject the resulting conflict. Browlet uses the existing Fetch splitter, following HTML/Chromium. |

Source evidence: Chromium's
[XFO parser](https://github.com/chromium/chromium/blob/main/services/network/public/cpp/x_frame_options_parser.cc)
uses HttpResponseHeaders enumeration; Gecko's
[FramingChecker](https://github.com/mozilla-firefox/firefox/blob/main/dom/security/FramingChecker.cpp)
uses literal comma splitting and the response URI; WebKit's
[parser](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/HTTPParsers.cpp)
and [FrameLoader](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/FrameLoader.cpp)
explain its corresponding behavior. These are source observations plus live
probes, not a claim that the specifications have adopted those choices.

`frame-options.test.ts` covers the header matrix, CSP precedence, all ancestors,
scheme/host/port comparisons, final redirect URL, document.domain, opaque ancestors,
sandboxed destinations, departing child origins, and container adoption. These
tests exercise the checker. `history-population.test.ts` separately covers its
ordered use after CSP and COEP on the target's navigation-and-traversal task.

Validation: 47 focused checks and 94 adjacent population/COEP checks pass on
Node 26.8.1 stock and compat. Typecheck, touched-file lint, import hierarchy,
and diff checks pass. This adds a pure policy algorithm; no runtime or addon
behavior changed, so the six-runtime matrix was not repeated for this slice.

### Response admission: frame-ancestors foundation

The policy-level frame-ancestors response check is implemented.
`ContentSecurityPolicy.getViolatedNavigationResponseDirective()` checks live
ancestor origins, preserves the CSP list's self origin, and exempts local
responses, source-side checks, and top-level targets. Report-only policies still
produce violation identities for the reporting step. Eric approved
origin-only matching and rejection of opaque ancestors; the corresponding
SPEC_CLASH/SPEC_GAP evidence is in the
[CSP audit](../policy/csp/ROADMAP.md#navigation-response-foundation).

`CSPList.isNavigationResponseBlocked()` now completes CSP §4.2.5: report every
violating response policy, blocking only enforcing policies and preserving later
reports after a block. It uses the completed null-global violation/reporting path.
The source-policy loop is currently a no-op: frame-ancestors allows source checks,
and no other directive overrides the default Allowed response check. Synthetic
null-request responses need no borrowed source policies, as recorded by
`SPEC_GAP(csp-navigation-response-null-request)` in the CSP owner.
The checker retains all specification
inputs (the response list becomes `this`) plus the browser owner, with nullable
requests for HTML's synthetic responses. The callable changes are reviewed and accepted.
Population now calls this entry point before COEP and XFO; Document loading remains unfinished.

The browser probes found material report-payload differences, so the reporting
follow-up is separate from the matching algorithm. Its decisions include protected
and blocked URLs, HTTP status, referrer, report request identity/credentials,
incoming Reporting-Endpoints, and synthetic null-request handling. These are
recorded in the CSP owner roadmap and source. The reporting slice now captures the
final response URL/status, leaves the referrer empty, initializes incoming endpoints,
and uses browser-owned delivery without an existing Window. Real Fetch tests exposed
and repaired the CSP no-cors/error conflict and null-client keepalive accounting.
These checks now feed the failed-response branch below. This remains HTML §7.4.5;
§7.5 has not started.

### Response admission and failed responses

The queued population task now short-circuits CSP, COEP, and X-Frame-Options in
specification order. Report-only violations continue through the later checks;
enforced frame-ancestors suppresses XFO only after CSP has evaluated it. COEP runs
only when the params carry a reserved environment. The CSP navigation type is
captured at invocation, before Fetch or queued task delivery.

Null or rejected params call `createDocumentForInlineContent()` with a null
navigation ID, as HTML requires. That §7.5.7 owner still throws: opaque error-page
creation, content/response inputs, browsing-context selection, and parser completion
remain dependencies. Once it supplies a Document, population marks it unsalvageable
with `navigation-failure`, discards the reservation if present, reports BiDi failure
for nonnull params, records population/referrer state, and completes without activating
the entry. Stored origin and history policy remain untouched for error and non-fetch
Documents. BiDi's status ID now permits null, matching its own definition; protocol
sessions and event delivery remain unfinished.

Two nullable inputs remain explicit in source:

- `SPEC_GAP(navigation-failure-null-environment)`: HTML unconditionally discards
  the reservation for failed normal params although synthetic params can have
  none. Browlet discards an existing reservation and does not invent one.
- `SPEC_GAP(navigation-history-null-request)`: HTML asserts a request exists when
  resolving a client history referrer, but synthetic params may lack one. A known
  stored referrer is preserved; an unresolved referrer with a null request throws.
  Choosing that missing value remains an audit dependency before enabling the loaders.

Twelve additional population cases cover policy order and short-circuiting,
report-only continuation, XFO precedence, reservation gating, null Fetch results,
failure cleanup, retained origin/policy/referrer state, nullable BiDi IDs, and the
unresolved synthetic referrer. Tests retain the real inline-owner failure and
substitute only that owner for cleanup tests; they do not claim actual error-page
creation is implemented. The following slice connects downloads and 204/205;
normal Document loading still stops at its named boundary.

Validation: all 274 tests in seven affected population, policy, reporting, and
navigation suites pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, each stock
and with the addon. No expected failures or skips occur in this selection.
Typechecking, touched-file lint, import hierarchy, and whitespace checks pass.
Existing addon builds were used without changes.

### Downloads and responses without a Document

Population now classifies Content-Disposition after the response policies. It
uses Fetch's header-list extraction, which delegates single-value parsing to HTTP,
then checks the captured source download permission and the params' final sandbox
flags, then asks `UserAgent.isNavigationDownloadAllowed()`. A denial completes
without creating a Document. An allowed response goes to
`UserAgent.handleAsDownload(response, navigable, navigationId)`; once that owner
returns, population completes. An ordinary 204/205 also completes without changing
the entry's Document, origin, policy, referrer, or population state. No branch
activates the pending entry or discards a reservation on its own.

Both UserAgent owners are explicit throwing dependencies. Download admission
must connect Mixed Content and optional hostile-download policy. The shared
`FetchResponse.isMixedDownload()` predicate already exists, but
`SPEC_GAP(mixed-download-source-url)` records that
[Mixed Content §5.2](https://w3c.github.io/webappsec-mixed-content/#html) still reads
the old navigation source's active Document URL, absent from today's population
signature. The source snapshot's Fetch client alone does not settle which URL or
capture time to use. The next audit must decide that input, including browser-UI
and retained/inactive sources; this slice does not silently borrow the target URL.
The clean Mixed Content checkout was refreshed and remained `a4eacec`.

Handle-as-download belongs to [HTML §4.6.5](https://html.spec.whatwg.org/multipage/links.html#handle-as-a-download):
safe suggested filenames, BiDi's allow/folder decision, parallel saving through a
host port, cancellation/failure, and download-end notification all remain unfinished.
No response body is saved by this slice. Filename/extension-parameter parsing is
separate from the implemented disposition-type extraction.

The browser-only `node-compat/experimental/navigation-download-admission.mjs`
probe ran 18 cases on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
A follow-up used a retained global marker to confirm Document identity for all
204/205 cases. Eric approved these choices on 2026-11-03:

| Marker | Evidence and decision |
| --- | --- |
| `content-disposition-extension-type` | RFC 6266 §4.2 and Chromium/Firefox treat an unknown valid token as attachment. HTML's literal attachment branch and WebKit do not. Follow RFC/Chromium/Firefox. |
| `content-disposition-invalid-type` | Chromium/WebKit ignore quoted or space-containing disposition types; Firefox downloads them. Follow the HTTP token grammar and Chromium/WebKit. A valid type still works with malformed/repeated filename parameters, as all three browsers demonstrate; filename extraction remains separate. |
| `content-disposition-conflicting-fields` | All three accept identical repeated fields. Chromium/Firefox reject different values as network errors; WebKit uses the last. Identical values are collapsed for classification; conflicting values throw at the explicit Fetch rejection dependency. This does not yet implement a network-error response or validate ordinary Fetch traffic. |
| `navigation-empty-attachment` | HTML, Chromium, and WebKit process attachment before 204/205. Firefox skips the download. Follow HTML's ordering. All tested engines retain the existing Document. |

Source evidence: [RFC 6266](https://www.rfc-editor.org/rfc/rfc6266.html#section-4.2),
[Chromium's type parser](https://github.com/chromium/chromium/blob/main/net/http/http_content_disposition.cc),
[Gecko's type classification](https://github.com/mozilla-firefox/firefox/blob/main/netwerk/base/nsNetUtil.cpp),
and [WebKit's attachment check](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/ResourceResponseBase.cpp).
The repeat-field decision remains bounded until Fetch's rejection path is audited;
no browser-specific passing expectation substitutes for that missing behavior.

The response tests cover type recognition, quoted commas, repeated fields,
malformed inputs, and unchanged header storage. Population tests exercise real
target tasks, source/final-target sandbox gating, policy denial, admitted handoff,
nullable navigation IDs, attachment-first ordering, unchanged history state,
policy-check precedence, and every unfinished owner. They substitute admission
and handling only to test the surrounding orchestration.

Validation: 490 tests in the five affected population, parallel-navigation, COEP,
Fetch-header, and Fetch-response suites pass on Node 24.19.0, 26.8.1, and custom
27.0.0-pre, each stock and with the addon. No expected failures or skips occur in
this selection. Typecheck, touched-file lint, import hierarchy, and whitespace
checks pass. Existing addon builds were used unchanged.

The reviewed parser-ownership correction preserves behavior: 571 HTTP-header,
Fetch-header/response, and population tests pass on Node 26.8.1 with the addon;
typecheck, lint, import hierarchy, and whitespace checks also pass.

### Document-loading handoff and retained history state

The ordinary-response branch now calls
[`Navigable.loadDocument()`](https://html.spec.whatwg.org/multipage/browsing-the-web.html#loading-a-document)
with the selected params, source snapshot, retained initiator origin, and prepared
ResourceReader on the destination's navigation-and-traversal task. Its nullable result becomes the
pending entry's Document. Completion remains in the same task and does not
activate the entry or commit history.

For a returned Document, population sets `everPopulated`, copies the **Document's**
origin (not the params' provisional origin), and checks the **Document's URL** to
decide whether history needs the policy container. It retains the params'
container by identity, without cloning it or substituting the Document's
container. Nonlocal/Blob URLs leave any retained history policy untouched.
Non-fetch and error pages continue to preserve their old origin/history policy.
A null loader result leaves retained state alone and still completes; it does
not discard the reservation or report a navigation failure.

`loadDocument()` now implements MIME/handler dispatch as described in the
[final §7.4.5 slice](#document-mime-and-handler-dispatch). Its §7.5 HTML/XML/text/
multipart/media/inline owners still require their complete loading behavior.
HTML's provisional path needs parser-script setup, scripts-may-run and
null-reservation integration. Unsupported-content policy, host confirmation and
external delivery/downloads remain unfinished.

`SPEC_GAP(document-loading-null-initiator)` records a missing input rule:
[DocumentState's initiator origin](https://html.spec.whatwg.org/multipage/browsing-the-web.html#document-state-initiator-origin)
can be null, and population passes that field directly, but the load-a-document
signature accepts only an origin. The concrete specified case is an openerless
window's initial about:blank entry; reloading/repopulating retained history keeps
that initiator. Browlet's provisional `createHistoryEntry()` also writes null and
still needs the captured navigation metadata. Fresh `Navigable.navigate()` always
supplies an origin, including a new opaque origin for browser-UI navigation; it is
currently the only production population caller. The loader's `Origin | null`
contract was reviewed and accepted. It preserves absent attribution without
inventing an origin or rejecting ordinary loads.

Browser source inspection supports keeping missing attribution distinct from
an opaque origin. [Chromium's loading contract](https://github.com/chromium/chromium/blob/main/third_party/blink/public/web/web_navigation_params.h)
permits absent requester origins for browser-initiated/initial loads; its
[external-protocol owner](https://github.com/chromium/chromium/blob/main/chrome/browser/external_protocol/external_protocol_handler.cc)
uses absence to mean non-web initiation and cannot remember an origin-specific
permission. [Firefox's principal setup](https://github.com/mozilla-firefox/firefox/blob/main/docshell/base/nsDocShellLoadState.cpp)
resolves a missing triggering principal before its external-protocol owner
requires a non-null value. WebKit has an optional navigation requester and
[separate client/host policy](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/Cocoa/NavigationState.mm)
for external handling. These are source findings, not live external-app probes.

No null-initiator external handoff is enabled. That dependency must distinguish
missing retained attribution from verified browser-UI initiation, preserve the
sandbox/activation/confirmation checks, and avoid borrowing the departing
Document's origin or granting browser privileges merely because the value is null.

The existing `SPEC_GAP(navigation-history-null-request)` remains separate. A
concrete stored referrer survives synthetic loading; an unresolved client referrer
with no request still throws after the Document and other metadata are saved.

Tests substitute the unfinished loader to cover successful/local/Blob Documents,
nullable results, previously populated state, exact origin/policy identity,
retained referrers, null initiators/reservations, and completion on the real HTML
task. Existing coverage still exercises the real throwing loader, stale IDs,
policy rejection, downloads, and non-fetch/error metadata preservation.

Validation: all 159 tests in the population, parallel-navigation, and COEP suites
pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, each stock and with the addon.
No expected failures or skips occur in this selection. Typechecking, touched-file
lint, import hierarchy, and whitespace checks pass. Existing addon builds were
used unchanged.

### Fetch navigation request construction

`SessionHistoryEntry.createNavigationRequest()` extracts steps 2–10 of
[create navigation params by fetching](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching).
The entry owns the URL, POST resource, retained referrer, and reload/history flags.
The source snapshot supplies the client, captured policy container, and activation;
the destination supplies the replaced-client ID and top-level prompt target.
`NavigationParams.fromFetch()` passes the UserAgent's sandbox as the request's
execution owner, separately from its nullable source client, and supplies the
existing CSP form-submission and WebDriver navigation-ID fields. The extracted
request factory and its smaller callable/result shape have been reviewed and
accepted. Supplying the execution environment is the usual ownership dependency.

Requests use navigate mode, included credentials, URL credentials, and manual
redirects. A null client gets a fresh opaque request origin and no referrer;
the top-level navigation initiator still retains the entry's independent,
nullable origin. A real source leaves origin resolution to Fetch. Client,
no-referrer, and concrete URL referrers retain their distinct representations.
The request uses the captured source policy by identity, not the destination's
policy or a fresh copy of the source Document's current policy. The history
state's request referrer policy remains separate from that policy container.

POST resources retain their bytes without re-encoding or consuming them, including
an empty body, and set their saved Content-Type. Fetch will extract these internal
bytes into its body/stream representation when dispatch is implemented. Failed
POST recovery and srcdoc resources are rejected as invalid inputs to this factory;
population already routes them elsewhere. Reload takes precedence over history
navigation, and activation comes from the snapshot even after the source becomes
inactive. Child requests select iframe/frame/object/embed destination and only
mark Resource Timing's initiator type when the source is the container Document.

**Container origin:** `SPEC_CLASH(navigation-container-origin)` follows all three
browsers: omit HTML's container-origin override and let Fetch resolve the initiating
client's origin. The unused `Element.getBrowsingContextScopeOrigin()` stub is removed.
Container destination and initiator-type selection remain unchanged, as does the
fresh opaque origin for a null client. HTML labels its ancestor-origin definition broken.
[HTML issue #4703](https://github.com/whatwg/html/issues/4703) says the operation
appears to be a no-op, asks whether cross-origin ancestors should instead suppress
the Origin header, and calls for tests. The issue remained open when inspected on
2026-11-03; it does not establish a corrected rule. The investigation below supplies
the browser evidence for Eric's approved choice. Tests now use the actual request
factory and Fetch origin/header operations, without substituting a scope-origin owner.

`fromFetch()` now reserves an environment and checks request CSP. A blocked request
resolves to null; an allowed request now dispatches Fetch as described below.
Remaining work includes enforcing the parallel-entry assertion, Early Hints processing,
Service Worker association, and actual loader integration. Redirect reservation
replacement/discard, repeated CSP, manual redirects, POST-to-GET updates, response
policies/origins/COOP, timing handoff, and final assembly are connected below. Completion uses UserAgent-owned
promises and scheduling, not the departing Document's readiness. The older
provisional response-policy loader is not removed by constructing a request.

`navigation-request.test.ts` covers ownership, captured policy/activation,
nullable initiators/clients, retained referrers, POST replay, reload precedence,
all container destinations, initiator selection, and the real unfinished Fetch owner.

Initial request-slice validation: all 116 tests in request construction, history population, and parallel
navigation pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, each stock and with
the addon. This includes 25 new request cases; no expected failures or skips occur
in this selection. Typechecking, touched-file lint, import hierarchy, and whitespace
checks pass. Existing addon builds were used unchanged.

### Container scope-origin investigation

The 2026-11-03 investigation ran 25 HTTP form-navigation cases on Chromium
156.0.8078.4, Firefox 157.0, and Playwright WebKit 27.2. All three agreed on every
observed Origin header; the final probe verifies the actual receiving frame as
well as the server-side request. Findings and the reproducible browser-only probe
are retained in Experimental's `NAVIGATION-SCOPE-ORIGIN.md` and
`navigation-scope-origin.mjs`.

The browsers use the initiating Document's origin despite cross-origin ancestors.
In A -> B, a POST from B into its own frame sends B, whereas HTML's literal
container override selects A. A -> B -> A sends A; ancestry does not blank it.
An opaque sandboxed child sends `null`, not its parent's origin. The controls
separate Fetch's existing rules: ordinary GET omits Origin; `no-referrer` sends
`null`; a cross-origin 307 redirect taints the subsequent origin. These are HTTP
observations, not coverage of browser-UI replay or HTTPS downgrade behavior.

[HTML #4703](https://github.com/whatwg/html/issues/4703) remains an unresolved
hypothesis, with no adopted correction. The linked
[Fetch #908](https://github.com/whatwg/fetch/pull/908) adopted referrer-policy
filtering of the outgoing header, not ancestry suppression or a change to the
request's origin. Browser source owners also retain the initiating Window or
triggering principal rather than substituting the target container Document.

**Approved and implemented:** omit HTML's container-origin override, retain
source-client origin resolution in Fetch, and remove the throwing Element method.
`SPEC_CLASH(navigation-container-origin)` records the choice at the omitted override.
The container destination and initiator-type steps and null-client opaque origin
remain unchanged. Twelve new regressions cover alternating ancestry, sibling
targets, opaque and null clients, referrer-policy filtering without origin mutation,
GET header omission, and the contained request's handoff to the unfinished Fetch loop.
All twelve first failed at the scope-origin stub before its removal.

Validation of the adopted rule: all 308 tests in navigation request construction,
history population, parallel navigation, Fetch requests, Origin headers, and
referrer policy pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, each stock and
with the addon. The request suite now has 36 cases; the obsolete throwing-stub
assertion is replaced by the regressions above. No expected failures or skips
occur in this selection. Typechecking, touched-file lint, import hierarchy, and
whitespace checks pass. Existing addon builds were used unchanged.

### Initial reserved navigation environment

The next bounded slice implements step 21.2 of
[create navigation params by fetching](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching),
using the existing `BrowletEnvironmentBase`. Its extracted static factory is
`createForNavigation(navigable, currentURL) -> BrowletEnvironmentBase`; this
smaller callable shape and owner have been reviewed and accepted. `fromFetch()` invokes
it for the first iteration, when the new request has no reserved client.

The reservation has a fresh opaque ID, the request's current creation URL, and
the target's active browsing context. Its UserAgent comes from the target Document,
independently of the request's source client and execution environment. No Window,
realm, or execution-ready settings are created. For a top-level navigation,
top-level creation URL is the incoming URL and top-level origin stays null until
Document setup. Child reservations inherit both fields from their parent's settings,
including the top-level metadata retained through an intermediate child. Existing
network partitioning already handles the top-level null-origin case from its URL.

Security uses the existing approved `SPEC_CLASH(secure-context-top-level-url)`
origin-and-parent rule. The creation-time decision survives Window composition;
later changes to the parent's state do not rewrite it. Sandboxed destination
security still needs the real §7.5.1 loader audit, as recorded in the policy roadmap.

| Following requirement | Explicit dependency |
| --- | --- |
| Steps 11–20 working state | Response, Fetch controller, and early-hint callback live in the Fetch loop below. COOP captures the departing Document before Fetch; response policies, sandbox flags, origin, and Location are computed on each response. No per-navigation object is introduced to hold them. |
| Step 21.1 redirects | Implemented: compare the next URL's origin with the reservation's creation URL. Cross-origin redirects run `discard()` and clear `commitEarlyHints` before replacement; same-origin redirects retain both. |
| Service Worker association | `UserAgent.handleFetch()` still has no registrations or active-worker selection. It must associate the reserved client during Fetch; its current `activeServiceWorker` stays null. Service Worker environment-discarding cleanup remains with that lifecycle. |
| Request checks and Fetch | Navigation-request CSP, initial Fetch, manual redirect continuation, parallel response callbacks, cancellation wakeup/abort, repeated response policies/COOP/CORP, timing handoff, and final params are implemented below. Actual Early Hints processing and Document loading remain unfinished. |
| Settings transfer | Existing Window composition transfers the reserved ID and security state. Actual §7.5 Document creation, sandbox inputs, and abandoning an unconsumed reservation remain separate lifecycle work. The provisional local-response loader remains in place. |

`navigation-environment.test.ts` covers fresh identities, realm-free construction,
parent/top-level metadata, partition ownership, security ancestry, stable security
decisions, and transfer to real Window settings. Request tests now observe an actual
reservation through `fromFetch()` before its unfinished response-processing boundary.

Validation: 248 tests pass with one existing expected failure on Node 24.19.0,
26.8.1, and custom 27.0.0-pre, each stock and with the addon. The six suites cover
reservation, requests, population, parallel navigation, environments, and secure
contexts. All 13 new reservation tests pass; the unchanged expected failure is
loaded-srcdoc iframe referrer-source selection in `environment.test.ts`.
Typechecking, touched-file lint, import hierarchy, and whitespace checks pass.
No addon or engine rebuild was needed.

### Navigation-request CSP before Fetch

Step 21.3 now calls the existing [CSP navigation check](../policy/csp/list.ts)
with the request's captured source policy container and source client. An enforcing
failure selects the network-error branch, whose step 23 result is null. The result
uses `UserAgent.HostPromise`, so source Document activity and scripting permission
cannot prevent the browser-owned operation from completing. No Fetch is started.

The source Document receives queued violation events; neither the destination nor
its new reservation owns them. All rejecting policies report, including report-only
policies. Report-only failure, a matching form action, ordinary non-form navigation,
and an empty browser-UI policy all continue to Fetch, whose response processing remains unfinished.
GET forms are checked just like POST forms; default-src supplies no form-action fallback.
The refreshed HTML (`6d7788b`) and CSP (`251d288`) sources introduce no new behavior
choice here; this connects the existing policy algorithm.

`navigation-fetch.test.ts` exercises the real request/check/report path, including
snapshot retention after live policy changes, a distinct source and target Document,
both dispositions, null source clients, and completion with an inactive source.
Its population case confirms that null reaches the existing throwing inline
error-Document factory. This slice does not create an error page, finish a navigation,
or add reservation-discard lifecycle behavior; those dependencies remain with the
loader and environment lifecycle described above.

Validation: 146 tests pass on each of Node 24.19.0, 26.8.1, and custom 27.0.0-pre,
both stock and with the addon. The five suites cover navigation requests,
reservations, this CSP connection (11 new tests), population, and CSP directives.
There are no expected failures or skips in this selection. Typechecking,
touched-file lint, import hierarchy, and whitespace checks pass. Existing addon
builds were used unchanged.

### Initial Fetch, parallel response delivery, and cancellation

The next bounded slice connects steps 21.4–21.8: dispatch the initial request with
`useParallelQueue`, receive its response, and wait for that response or a change to
the ongoing navigation ID. The existing UserAgent sandbox owns Fetch execution;
`HostPromise` keeps completion independent of either Window's script readiness.
No separate per-navigation object is introduced.

Navigable's existing ID field now notifies registered waits. Both direct history
assignments and `setOngoingNavigation()` wake them, but only the latter invokes
Navigation API abortion. Same-ID assignments do nothing. A changed ID aborts the
Fetch controller, removes the listener, and returns undefined for HTML's bare return;
null still represents a network failure. Population preserves that distinction even
if the ID changes away and back to null before its task runs: canceled work invokes
completion without creating an error Document. Rejections remove listeners and
release the controller before surfacing the internal failure.

After a response, a null request body clears the retained resource. Network errors
return null. Successful responses run the policy checks and manual redirect loop
described below, then return complete params with the live controller/body.
Cancellation, failure, non-fetch handoff, and internal errors release the controller;
success removes the temporary navigation-change listener and transfers control to
the params consumer.

The first 103 response calls the reserved environment's
`processEarlyHintHeaders(response)`. That method explicitly throws until HTML
§4.2.4 Link-header/preload/preconnect processing and preload-map commitment exist.
Fetch's interim response must also retain its URL for Link base/origin selection.
Later hints are ignored once commit steps exist; redirect handling retains them
for same-origin redirects and discards them, together with the reservation, for
cross-origin redirects. Service Worker association and the remaining reserved-client
disposal consumers remain the previously recorded lifecycle dependencies.

Connecting real Fetch reproduced a generic CSP failure: `default-src 'none'`
blocked a top-level form after the separate navigation check allowed it. The approved
`SPEC_CLASH(csp-document-fetch-directive)` correction follows Fetch's destination
table and all three browsers, returning no fetch directive for `document` while
retaining form-action and embedded-destination checks. See the
[CSP evidence and prerender dependency](../policy/csp/ROADMAP.md#navigation-request-consumer).

The navigation tests exercise the actual Fetch controller and parallel callbacks
through a controlled HTTP transport: successful headers, network failure, source
inactivation, direct and algorithm-driven cancellation, null-ID reuse, first-only
103 delivery, and the explicit Early Hints dependency. Earlier throwing-Fetch tests
now reach the later response-policy boundary instead.

Validation: all 228 tests in seven navigation/CSP suites pass on Node 24.19.0,
26.8.1, and custom 27.0.0-pre, each stock and with the addon. There are no expected
failures or skips in this selection. Typechecking, touched-file lint, import
hierarchy, and whitespace checks pass. Existing addon builds were used unchanged.

### Initial response policies, origin, COOP, and child CORP

The next bounded slice connects steps 14 and 21.9–21.13 of
[creating navigation params by fetching](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching),
checked against refreshed HTML `6d7788b`. The existing policy owners retain their
previously reviewed browser/spec choices; this slice adds their Fetch consumer.

Before waiting for Fetch, capture the departing Document's URL, origin, opener
policy, and strict-origin comparison with the nullable initiator. On receipt,
create the response policy container using the reserved environment, union its
enforced CSP sandbox restrictions with the captured target flags, and determine
the response origin. This leaves the target snapshot unchanged and ignores
report-only sandbox directives. A redirect response uses its own URL, not its
Location target. Local about:blank origin selection retains the initiator input.

Top-level responses obtain COOP in the reserved environment and enforce it on the
active browsing context, passing the captured departing state and Fetch's computed
referrer. Nonempty sandbox flags combined with enforced non-unsafe-none COOP fail
with null; report-only policy does not cause that rejection. The enforcement result
accumulates across redirects and final parameter assembly retains it.
URL-scoped COOP reporting remains explicitly unfinished in its policy
owner: a configured endpoint can throw, and the Fetch controller is released.

HTTP(S) child responses run Fetch's existing navigation CORP check against the
container Document's origin, embedder policy, and environment. The initiator and
departing child do not supply those inputs. Both dispositions report through the
container Document; only enforced failure returns null. Non-HTTP responses skip
this check; population's separate COEP inheritance check remains required.

`navigation-response-policy.test.ts` adds 21 cases using actual Fetch and controlled
HTTP transport, including delayed headers, policy rejection, report ownership,
redirect response origins, and cleanup at the unfinished COOP-reporting boundary.

Validation: all 316 tests in eight navigation/policy suites pass on Node 24.19.0,
26.8.1, and custom 27.0.0-pre, each stock and with the addon. No cases are skipped
or classified as expected failures. Typechecking, touched-file lint, import
hierarchy, and whitespace checks pass. Existing addon builds were used unchanged.

### Manual redirects and history state

The next bounded slice completes the response loop through steps 21.14–24 of
[creating navigation params by fetching](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching),
including its earlier reservation and repeated-check branches. A local continuation
retains the existing request and Fetch controller; `processNextManualRedirect()`
leaves URL-list advancement, referrer policy, POST-to-GET rewriting, body replay,
and the redirect limit with Fetch. Each response uses the same browser-owned wait,
so cancellation works on later hops as well as on the first response.

| Requirement | Implementation and boundary |
| --- | --- |
| Location selection | Use Fetch's Location parsing and fragment inheritance. Invalid Location returns null without replacing history state. An absent Location selects final parameter assembly. |
| History state | Clear classic History state to serialized null. Replace only this entry's DocumentState, preserving the specified referrer, origin, resource, population, and target-name metadata and cloning its history policy container. Adjacent entries keep the old state; document, nested histories, reload-pending, and not-restored diagnostics start at their defaults. Navigation API state is unchanged. |
| HTTP(S) redirects | Update the entry URL, repeat request CSP, and resume the same Fetch controller. A request body cleared by Fetch also clears the retained resource. Fetch's existing 20-redirect limit remains authoritative. |
| Reservation and Early Hints | Same-origin hops retain the reserved environment and first commit callback. Cross-origin hops discard the old reservation, clear its callback, and reserve a new client with the new URL/security inputs before continuing Fetch. Actual Link/preload/preconnect processing still throws. |
| Repeated response checks | Rebuild each response's policy container, sandbox flags, and origin; accumulate top-level COOP results and rerun HTTP(S) child CORP. Configured URL-scoped COOP reports retain their explicit unfinished owner. |
| Non-HTTP redirects | Clear retained POST data. Non-HTTP Fetch schemes return null; non-fetch schemes return params with the last response's origin and the captured activation/sandbox inputs. External handler selection and launch remain explicit dependencies. |

`SPEC_CLASH(navigation-redirect-csp-url)` follows the approved Chromium/WebKit
behavior: check the pending redirect target before Fetch sends it. HTML's ordering
instead reads the previous request URL; Firefox's live form probes follow forbidden
redirects. `CSPList.isNavigationRequestBlocked()` receives an optional pending URL
and uses the upcoming redirect count without mutating Fetch's request. That extra
input is the reviewed implementation arrangement; violation reporting retains the original
request URL. The [CSP roadmap](../policy/csp/ROADMAP.md#navigation-request-consumer)
records the browser evidence and still-open CSP issue #8.

`navigation-redirects.test.ts` adds 26 actual-Fetch cases covering controller reuse,
history isolation, fragment inheritance, method/body changes, reservations, Early
Hints retention, repeated COOP, invalid/non-fetch Locations, redirect limits, late
response cancellation, and form-action enforcement/report-only behavior.

Validation: all 406 tests in eleven navigation/policy suites pass on Node 24.19.0,
26.8.1, and custom 27.0.0-pre, each stock and with the addon. No cases are skipped
or classified as expected failures. Typechecking, touched-file lint, import
hierarchy, and whitespace checks pass. Existing addon builds were used unchanged.

### Final Fetch parameters and timing handoff

Steps 25–27 now select history/initiator/response policy, clear the iframe's pending
resource-timing start when the response permits normal reporting, and return
NavigationParams. The result retains its request, response, live Fetch controller,
reserved environment, response origin/sandbox/COOP, accumulated enforcement result,
Early Hints callback, navigation ID/type/involvement, retained about base, and
captured iframe referrer policy. The receiving Navigable remains the destination
owner under the previously reviewed representation.

Successful assembly removes the temporary navigation-change listener without
aborting the controller or body. A regression sends body bytes only after the
params have returned and confirms they remain readable. Population receives the
params on the target's navigation-and-traversal task; its existing admission and
retained-state processing now reaches the explicit Document-loader boundary.

`SPEC_CLASH(navigation-fetch-full-timing)` records the approved Fetch correction:
retain full timing for every navigation destination, including iframe/frame/object/
embed, instead of only document. The focused regression first passed for document
and failed for all four child destinations with `Fetch full timing info is not set`.
The conflict is independently identified in [HTML PR #12890](https://github.com/whatwg/html/pull/12890),
which remains open. This retains the existing raw timing record for the destination;
it does not bypass Timing-Allow-Origin or add public timing entries. See the
[Fetch decision](../../../fetch/ROADMAP.md#completion-and-execution).

`HTMLIFrameElementImpl.pendingResourceTimingStartTime` starts null. Its §4.8.5
navigation producer and fallback load-event reporting remain explicit TODOs.
The provisional response-policy loader also remains: Browlet's local route still
needs late preparation; §7.5.1 now preserves intentionally null reservations in
completed params rather than sending them through that adapter.
Service Worker association, actual Early Hints processing (including interim URL
metadata), URL-scoped COOP reporting, local cookie-URL inheritance, synthetic
null-request referrer persistence, error pages, and actual Document loaders remain
at their recorded owner boundaries. No dependency is replaced with a default success.

The new parameter tests cover retained fields, body/controller lifetime, policy
precedence and cloning, both iframe timing-permission branches, and target-task
population. Earlier response/redirect tests now assert returned params; the two
population-boundary tests now reach the selected §7.5 loader's explicit dependency.

Validation: all 559 tests in eighteen navigation, policy, and Fetch suites pass on
Node 24.19.0, 26.8.1, and custom 27.0.0-pre, each stock and with the addon. No cases
are skipped or classified as expected failures. Typechecking, touched-file lint,
import hierarchy, and whitespace checks pass. Existing addon builds were used unchanged.

### Document MIME and handler dispatch

This closes the document-order audit of §7.4.5 with
[load a document](https://html.spec.whatwg.org/multipage/browsing-the-web.html#loading-a-document),
using HTML `6d7788b` and the live 3 November 2026 text. It does not complete the
referenced §7.5 loaders or the remaining dependencies recorded throughout this section.

| Requirement | Implementation and boundary |
| --- | --- |
| Computed type | After response admission, ResourceReader determines MIME using the existing bounded sniffing algorithm. Population resumes on the captured Window's navigation-and-traversal task and rechecks its navigation ID. Supersession cancels the reader and completes without a Document. A read failure returns to the same task as a failure, not a fabricated successful load. |
| Configured handling | UserAgent.documentTypeHandlers maps MIME essences to inline/external choices, initially empty. External configuration bypasses built-in dispatch. An entry also marks an XML/JSON type explicitly supported, exempting it from generic XML/text loading. No plugin or external application is implicitly registered. |
| HTML | Call the existing loadHTMLDocument with the prepared reader. Production parser-script setup still throws; the earlier supplied-script byte-loader tests continue to run. |
| XML | Non-special XML calls loadXMLDocument with the parsed MIME type and reader. XML parser/DOM integration, original-header encoding, Link processing, scripts-may-run, completion, and diagnostics belong to §7.5.3. |
| Text | JavaScript, non-special JSON, text/css, text/plain, and text/vtt call loadTextDocument. The §7.5.4 owner must create the no-quirks pre/PLAINTEXT presentation, decode, process Link headers, gate scripts, and finish on networking tasks. |
| Multipart | multipart/x-mixed-replace calls loadMultipartDocument with params, source snapshot, initiator, and reader. MIME-part parsing, first-part dispatch, later replacement navigations and per-part completion remain §7.5.5 work. |
| Media | Image/audio/video types require UserAgent.supportsMIMEType before loadMediaDocument. The existing predicate claims no media support until installed decoder capabilities are composed. Element/presentation creation, resource consumption, Link processing, and completion remain §7.5.6 work. |
| PDF | Both application/pdf and text/pdf require UserAgent.pdfViewerSupported. It is false because no viewer exists. When enabled, dispatch selects the inline-content owner with the prepared reader. Navigator's §8.10.1.6 compatibility exposure must share this decision. |
| Other inline content | A configured inline choice selects createDocumentForInlineContent. Otherwise shouldDisplayUnsupportedResourceInline is an explicit throwing UserAgent dependency for native/error presentation versus external delivery; no default download/error policy is invented. |
| External content | Use the existing sandbox gate with the response, destination, final flags, captured activation, initiator, and prepared reader; return null. The host must consume that reader rather than reopen its locked body. Confirmation/delivery/downloads still throw. A null initiator stops at the retained attribution gap rather than inventing authority. |

The callable-shape change is deliberate: `loadDocument()` remains synchronous and
receives the prepared ResourceReader last. The §7.5 loader and external-handoff
owners receive the same implementation input; non-resource inline pages and URL
handoffs omit it. XML/text/media retain the existing parsed MIMEType instead of
serializing it into HTML's string input and reparsing it. These callable arrangements
are reviewed and accepted. `SPEC_GAP(inline-document-response)`
still records HTML's absent resource/response input; the new optional reader makes
the response-backed dependency explicit without implementing the inline renderer.

Source inspection found the same separation between content choice and loader
construction in Blink's
[DocumentInit](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/dom/document_init.cc),
WebKit's [DOMImplementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DOMImplementation.cpp),
and Gecko's [nsURILoader](https://github.com/mozilla-firefox/firefox/blob/main/uriloader/base/nsURILoader.cpp).
Their SVG/media/PDF/plugin policies depend on installed facilities. This slice
uses HTML's dispatch order and explicit Browlet support inputs; it does not claim
a live browser comparison or import browser-specific plugin policies.

The new dispatch tests exercise the MIME families, explicit XML/JSON handling,
external overrides, unsupported media, both PDF aliases, inline/external fallback,
and nullable initiator behavior. Real stream tests verify prefix replay, continued
body reads, target-task completion, and supersession cancellation. The existing
report-only population test now counts CSPViolation.report, since the browser-owned
reporting scheduler can retry while the added destination task is runnable.

Validation: all 655 tests in the 22 focused navigation, policy, Fetch, and loader
suites passed on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with
the addon disabled and enabled. Typechecking, changed-file ESLint, import hierarchy
checks, and diff whitespace checks also passed. Existing matching addon artifacts
were reused; no engine or addon rebuild was needed.

Document teardown must still cancel a retained reader when discarding its queued
continuation. The existing HTML null-reservation, local policy preparation,
synthetic referrer/cookie-URL gaps, Early Hints, Service Workers, COOP reporting,
download admission/handling, and iframe timing producers remain explicit at their
existing owners. This slice adds no native or Node/V8 work.

**Consolidation boundary:** §7.4.5's algorithms are now audited through the final
dispatcher, with unfinished dependencies enumerated and represented in code.
Vin's integration was verified at `c822141b`; §7.4.6 work resumes below.

## HTML §7.4.6.1: history-step selection

Read the [applying-history overview and traversable update](https://html.spec.whatwg.org/multipage/browsing-the-web.html#updating-the-traversable)
against refreshed HTML `a7f6aed` on 4 November 2026. This first slice implements
the selection helpers used by the coordinator; it does not yet replace the
provisional push/replace activation path. Traversal/reload admission is connected
in the following slice.

| Selection | Behavior |
| --- | --- |
| `getUsedStep()` | Greatest retained joint-history step at or before the request, including gaps left by removed child histories. Invalid internal requests with no predecessor throw instead of inventing a step. |
| `getTargetHistoryEntry()` | Existing per-navigable greatest-step lookup is reused. Pending entries remain an internal error. |
| `getNavigablesThatWillChangeOrReload()` | Compares the target with the **current** entry and checks the target state's reload flag. Descends while the target Document remains active and is not reloading. |
| `getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate()` | Selects unchanged, non-reloading current entries and descends only through those branches, as written. |
| `getNavigablesThatMightCrossDocuments()` | Compares the target Document with the **active** Document, including null targets and reloads. Stops below each possible cross-document traversal; those descendants unload rather than traverse separately. |

The three lists are independent. After a non-displayable response, the current
entry can have a null Document while the previous entry remains active. Selection
must not collapse the current and active comparisons into a single classification.
The walks preserve the specification's breadth-first order and return fresh lists
without mutating history, clearing reload flags, or dispatching tasks.

Eric approved a parent-owned child collection. `parent` is now an accessor that
keeps its inverse collection paired; consumers receive a read-only Set view.
Children are visited in parent-association order, including shadow-tree children,
without sorting or depending on Document tree order. `destroyChild()` removes the
child after crossing the existing recursive-teardown boundary, leaving the old
parent reference intact. Automatic element startup/removal and recursive Document
destruction still require their existing owners; restoration must reconcile
retained child associations. A retained child is not silently discarded merely
because the parent's active Document changes through the provisional loader.

Ladybird's source independently expresses the same three selection predicates and
uses its canonical navigable children (`Libraries/LibWebView/SessionHistory.cpp`,
`874f491`). This is implementation-source corroboration, not a live-browser claim
about complete traversal. No browser disagreement was established by this slice.

The rest of the read algorithms remains explicit:

| Next dependency | Existing owner and boundary |
| --- | --- |
| Entry-point wrappers and cancellation | Implemented in the following admission slice; the current-entry slice also recomputes its work lists after callbacks. The push/replace path still only applies its supplied entry. |
| Current-entry writes and successful cross-document Navigation cleanup | Implemented by the current-entry slice below. Selection remains side-effect-free; the coordinator advances current entries, queues cleanup on each Window's loop, and marks traversal ownership. |
| Population continuations | `populateHistoryEntryDocument()` exists. The history coordinator must supply snapshots/reload inputs, dispatch child traverse events, wait for population, handle non-displayable results, compare origins, and reset classic state/target names where required. |
| Synchronous queue jumping | `runSynchronousNavigationSteps()` selects eligible pending work, suppresses recursive selection, and propagates selected completion. Coordinator wake-ups, maintenance of the waiting set, and continuation processing remain unfinished. |
| Deactivation and activation | `Navigable.activateHistoryEntry()` switches the active entry/Window and initializes visibility after saving persisted state. `Window.firePageSwapEvent()` supplies the outgoing event and filtered activation. `Document.unloadAndDescendants()` and `SessionHistoryEntry.savePersistedState()` still throw. Deactivation must coordinate CSS capture and event delivery before unloading, then the coordinator must activate the destination. |
| Document updates and final completion | `Document.updateForHistoryStepApplication()` handles existing/new Documents and retained-Document reactivation. Automatic scroll restoration still throws before new-Document script permission; manual and suppressed restoration can continue. Fragment-scroll attempts are scheduled without blocking scripts. Form reset and visibility transitions block full reactivation. The coordinator must run changing and nonchanging Document jobs on their own loops and wait for completion. The later §7.4.6 audits cover revealing and scroll-restoration policy; physical scrolling remains unfinished. |

Two details need close attention when connecting those continuations: HTML's
length/index-only selector stops even below a same-document parent entry change,
so test descendant history updates across that case; and its population continuation
marks a null target Document update-only but then dereferences that Document. Keep
these audit questions visible rather than copying the later coordination unchecked.

Tests cover step gaps/removal, shadow children, breadth-first ordering, reloads,
branch pruning, target-versus-current flags, synchronous active-entry advancement,
non-displayable current entries, and side-effect-free repeated selection. Parent
reassignment and child destruction retain separate relationship tests.

Validation: all 1,233 tests in the 64 navigation suites passed on Node 26.8.1 with
the addon; the 70 cases in the five focused suites also passed on stock Node.
Typechecking, changed-file ESLint, import hierarchy, and diff whitespace checks
passed. This slice changes selection and ownership bookkeeping, not scheduling
or native facilities, so it reuses the validated addon without a rebuild or a
six-runtime sweep. The next bounded slice is the common apply-history-step
admission/cancellation coordinator, before population and continuation handling.

## HTML §7.4.6.1: history-step admission and cancellation

Implemented [apply the history step](https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-history-step)
steps 1–5 against HTML `a7f6aed`. `Traversable.applyHistoryStep()` requires entry
from its own traversal queue, normalizes the requested step, checks the captured
sandbox permission for every changing/reloading navigable, and awaits unload and
navigate-event cancellation for the possible cross-document list.

Creation/destruction, reload, traversal, and intercepted-traversal resumption now
forward their specified inputs. Creation/destruction and resumption disable
cancellation; reload selects the then-current joint step; ordinary traversal
retains its source snapshot and initiator. Browser-UI traversal retains null
source/initiator. The provisional local-loader push/replace path is deliberately
unchanged until full application can replace its existing activation behavior.

The callable adaptation is an `InternalPromise<HistoryStepResult>` instead of the
specification's result returned after a parallel wait. This arrangement is reviewed
and accepted; its `SPEC_MISMATCH` is removed. The queue's retained UserAgent owns that completion, independently
of any Document's lifetime. Queued callers return it; Navigation API traversal
waits before dispatching its existing AbortError/SecurityError failure handling.
Canceled navigate events retain their own abortion/settlement handling. The queue
ignores the result value and resumes only when completion settles, including on
failure. Its entry check distinguishes executing an algorithm from merely waiting
for one; it is not an ambient Agent or realm lookup. Later selective queue jumping
must enter through this same queue ownership when it is implemented.

This admission slice stopped before current-entry writes and Navigation cleanup;
the following slice connects those steps. Requests still reject at an explicit
population/activation boundary and never report `applied` while those effects are
missing. Full application must coordinate population and synchronous queue jumping,
unload and activate Documents, run each Document's history update on its own event
loop, and wait before committing the final joint step. Existing throwing owners and the
selection slice's null-Document/descendant-update audit questions remain in place.
Prompt admission/UI, transient-activation production, and cancellation of waits
whose Document tasks are discarded also remain explicit dependencies.

Tests exercise sandbox rejection before dispatch, requested-step gaps, real bound
beforeunload dismissal and navigate cancellation, reload flags, disabled cancellation,
owner lifetime, failures, and queue release. A public `navigation.back()` test checks
both rejected promises after actual beforeunload dismissal. Other traversables can
run while one waits; unrelated calls cannot borrow its suspended queue ownership.
Earlier caller tests now observe returned completion rather than a synchronous stub.
No browser rule or expected-failure classification changes in this slice.

Validation: all 1,247 tests in 65 navigation suites pass on Node 26.8.1 with the
addon. The 214 focused cases in 12 suites pass on Node 24.19.0, 26.8.1, and custom
27, with the addon both disabled and enabled. Typechecking, changed-file ESLint,
import hierarchy, and whitespace checks pass. Existing synchronous-stub assertions
now wait for the explicit population boundary; no required behavior was weakened
or reclassified. Existing matching addon artifacts were reused without rebuilds.

## HTML §7.4.6.1: current entries and cross-document Navigation cleanup

Implemented [apply the history step](https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-history-step)
steps 6–8 against HTML `a7f6aed`. After cancellation callbacks, the coordinator
recomputes changing and length/index-only lists before writing any current entries.
Each admitted changing navigable receives its target current entry and `traversal`
ownership. The direct assignment wakes existing parallel navigation waits without
invoking the aborting setter. Active entries, displayed Documents, and the final
joint-history step do not change yet.

When the target Document differs from the active Document, cleanup is queued on
that active Window's navigation-and-traversal task source. The task selects the
then-active Window's Navigation and clears only its ongoing event and method
tracker. It neither aborts the event's signal nor rejects/resolves the tracker's
promises. Same-Document targets, including a pending reload whose replacement has
not been populated, do not take this cleanup branch. Later population must arrange
the replacement's lifecycle; this is not an alternate reload implementation.

### Creation/destruction must not take over navigation

`SPEC_CLASH(history-bookkeeping-navigation)` records
[HTML issue #12724](https://github.com/whatwg/html/issues/12724). Reload sets
`reloadPending` before appending its own queue work; creation/destruction already
in that queue can therefore select it as changing despite having no navigation
type. Literal application takes over its ownership and eventually reaches a
cross-document assertion requiring a non-null navigation type. Pending document
changes have the same broader ownership problem.

Eric approved leaving those changes to their navigation. For null navigation type,
the changing list excludes a navigable with a pending navigation ID, and excludes
cross-document/reload work unless that navigable is already marked `traversal`.
Same-Document bookkeeping without a competing navigation remains eligible. Ordinary
reload/traverse application retains its normal selection. This follows Ladybird's
[ApplyHistoryStep safeguard](https://github.com/LadybirdBrowser/ladybird/blob/master/Libraries/LibWebView/ApplyHistoryStep.cpp)
([repair #10900](https://github.com/LadybirdBrowser/ladybird/pull/10900)), rather than
moving the reload flag's existing specified write or adding another navigation owner.

On 4 November 2026, the retained Experimental `history-bookkeeping.mjs` probe passed
all nine cases on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2:

- Inserting or removing a sibling iframe immediately before another frame reloads
  produces exactly one reload, with no page error.
- Repeated frame insertion/removal while a different frame's response is held
  leaves its old Document displayed, then completes the requested navigation once
  when the response is released; there is no extra request.

These observations establish the desired isolation, not identical internal guard
code. The engines use different machinery: Chromium's
[FrameTree](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/frame_tree.cc)
updates/prunes frame history; WebKit's
[HistoryController](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/HistoryController.cpp)
separates provisional-item bookkeeping from recursive navigation; Gecko's
[nsSHistory](https://github.com/mozilla-firefox/firefox/blob/main/docshell/shistory/nsSHistory.cpp)
removes child history entries separately from reload handling. The issue records
the fuller source comparison. Our focused regression first observed the literal
sequence replacing pending ownership with `traversal` and advancing entries; the
approved guard makes those cases preserve the existing request and current entry.

### Remaining coordinator work

The next bounded slice starts at steps 9–12: retain per-navigable continuation
state and dispatch population preparation. The current boundary still throws; it
does not claim that an entry advanced here has been populated or applied. The
length/index-only list is captured before writes but awaits its later jobs.

Population snapshots, reload/POST inputs, child traverse-event cancellation,
origin changes, non-displayable results, and target-name/classic-state resets
remain coordinator work. In addition to the existing null-Document and descendant
selector questions, audit HTML's population steps that clear `reloadPending`
before using it for `allowPOST`. Do not silently copy that ordering.

Selective queue jumping and wake-ups, continuation processing, unloading,
activation, per-Document updates, and final joint-step completion remain explicit.
Document destruction must discard its queued cleanup/population tasks and release
coordinator waits; automatic teardown/restoration is still unfinished. The existing
provisional push/replace loader is unchanged by this slice.

Tests cover post-callback reselection, reload-induced child pruning, current versus
active entry identity, child-loop cleanup, pending signals/promises, traversal
ownership notifications, and the approved bookkeeping exclusions and exceptions.

Validation: all 1,259 tests in 65 navigation suites passed on Node 26.8.1 with the
addon. The 226 focused cases in 12 suites passed on Node 24.19.0, 26.8.1, and custom
27, with the addon disabled and enabled. Typechecking, changed-file ESLint, import
hierarchy, and whitespace checks passed. The nine browser-only probes passed
separately; they do not substitute for the production regressions. No failures were
reclassified, and the existing matching addon artifacts were reused without rebuilds.

## HTML §7.4.6.1: history population ownership prerequisite

Before connecting step 12's population jobs, fixed the cancellation contract
shared with [history-entry population](https://html.spec.whatwg.org/multipage/browsing-the-web.html#attempt-to-populate-the-history-entry's-document)
and [Fetch navigation parameters](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching).
HTML `a7f6aed` marks a history operation's ongoing navigation `traversal`, but its
population call omits the navigation ID, leaving it null. Both later algorithms
compare ongoing navigation against that null ID and incorrectly cancel the work.
The initial regressions observed undefined Fetch results for both reload and
back/forward, plus a supplied response completing without invoking its loader.

`SPEC_CLASH(history-population-navigation-id)` records Eric's approved correction:
each operation captures `traversal` as its expected cancellation owner when its
navigation ID is null and traversal owns the navigable at entry. Otherwise it
keeps the original ID comparison. The request, response parameters, and BiDi
metadata retain null; the sentinel is not a navigation ID. A change to null or
another request still cancels. Fetch's existing change observer latches that
cancellation even if ownership later returns to `traversal`. Response-delivery
and MIME continuations compare their captured owner before loading a Document.
This introduces no new persistent navigable state or navigation object.

The retained browser probe described above completes reloads normally on all
three engines; the null-ID contradiction is in HTML's internal algorithm, not an
observed browser failure. Tests separately cover the Fetch result, queued response
delivery, delayed MIME sniffing, cancellation, and actual Fetch-to-population
delivery through a controlled Document loader. Successful population still does
not activate the entry or advance the joint-history step.

The coordinator still throws before dispatching population. The next bounded
slice remains continuation preparation; its dependencies are now more precise:

- [HTML #12760](https://github.com/whatwg/html/issues/12760): clearing
  `reloadPending` before its two consumers disables POST replay and makes Fetch
  select the history flag instead of the reload flag. Preserve the intended
  reload inputs when connecting the caller; no correction is implemented here.
- Step 12 computes `navTimingType` but omits that required input from its
  population call. Forwarding it must be explicit in that caller.
- [HTML #12668](https://github.com/whatwg/html/issues/12668): reload population
  replaces the Document in a shared active/current DocumentState before the old
  Document is deactivated. Retain the displayed Document and its navigable for
  lifecycle work; do not rediscover ownership from the replaced state.
- Null-Document continuations, child traverse-event handling, origin and target
  name/classic-state changes still need their audit and implementation.
- Population failures and discarded Document tasks must release coordinator
  waits. Ready continuations and eligible synchronous queue jumps must be
  processed while other population jobs are still waiting; an all-jobs barrier
  would change the algorithm. Nested applications must preserve job ownership
  even though all traversals use the same sentinel.

Validation: all 1,273 tests in 65 navigation suites passed on Node 26.8.1 with
the addon. The 252 focused cases in seven suites passed on Node 24.19.0, 26.8.1,
and custom 27, with the addon disabled and enabled. Typechecking, changed-file
ESLint, import hierarchy, and whitespace checks passed. No failures were
reclassified; existing matching addon artifacts were reused without rebuilds.

## HTML §7.4.6.1: per-navigable history preparation

Implemented the changing-navigable task in [apply the history step](https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-history-step),
step 12, against HTML `a7f6aed`. `Navigable.prepareHistoryStep()` queues its work on
the active Window's navigation-and-traversal task source. It reads the live
displayed and current entries inside that task, retains the displayed Document,
and produces the specified four-field changing-navigable continuation state.
An already advanced entry needs only updates; otherwise the task checks the
navigation-type preconditions and fires the specified same-origin child traverse
event. The old origin is captured before author listeners run.

Retained Documents proceed directly to continuation preparation. Missing or
reloading Documents receive target/source snapshots and parallel population,
followed by a task on the then-active Window. A changed origin clears classic
History state, leaving Navigation state separate. It clears a top-level target
name unless that Document's context is auxiliary with a retained opener; child
names survive. The displayed Document remains in the continuation even if reload
population replaced it in the shared DocumentState (the ownership hazard in
[HTML #12668](https://github.com/whatwg/html/issues/12668)). Deactivation must use
that retained Document and navigable instead of rediscovering the former owner.

The extracted callable takes the traversable, source snapshot, user involvement,
navigation type, and completion steps that insert a ready continuation. Its
`SPEC_MISMATCH` marks this extraction from the larger algorithm for review. It
returns no application result and performs no unloading, activation, or final
joint-step update. Errors still use their existing task/parallel owner.

### Population inputs and non-displayable responses

- `SPEC_CLASH(history-reload-pending-inputs)` records Eric's approved correction
  for [HTML #12760](https://github.com/whatwg/html/issues/12760). Capture `allowPOST`
  before clearing `reloadPending`, then keep the flag until the synchronous start
  of population has constructed its Fetch request. Clear it in `finally`, without
  waiting for the response. This preserves both POST admission and the request's
  reload-navigation flag, without adding another parameter through the Fetch
  factories. The upstream issue identifies both consumers; browser implementations
  generally derive them from their separate load types. Ordinary reload requests
  now select `no-cache` as described below; optional repost UI remains missing.
- `SPEC_GAP(history-population-timing-input)` supplies the `navTimingType` computed
  by step 12 but omitted from its population call. A missing Document selects
  `back_forward`; an existing Document being reloaded selects `reload`.
- `SPEC_GAP(history-population-null-document)` records the approved null-result
  branch. HTML marks a non-displayable target update-only, then dereferences its
  null Document. Browlet delivers the update-only continuation without changing
  retained classic state or the target name. The later update job remains missing.

The 4 November 2026 HTTP probe, retained in Experimental as
`history-population-inputs.mjs`, found that Chromium 156.0.8078.4 and Firefox 157.0
resend the original POST body through `location.reload()`. WebKit 27.2 sends GET
instead. All three report reload timing and retain the displayed Document when
the next response is 204. Eric approved retaining the POST requirement and marking
only WebKit's browser assertion as an expected failure. The probe uses a real
loopback HTTP server; earlier Playwright-intercepted responses are not its oracle.

### Ordinary reload cache policy

`SessionHistoryEntry.createNavigationRequest()` now sets Fetch's `no-cache` mode
when `reloadPending` is true, alongside the independent reload-navigation flag.
Ordinary new/history navigation retains `default`. The existing Fetch cache
implementation handles conditional requests, 304 body reuse, replacement after a
changed response, and network errors. This selects policy in HTML without making
generic Fetch infer it from a navigation flag.

- `SPEC_GAP(reload-navigation-cache-mode)` records the missing HTML/Fetch mapping
  in [Fetch #1899](https://github.com/whatwg/fetch/issues/1899). The older
  [Fetch #524](https://github.com/whatwg/fetch/issues/524) discussion separated
  navigation identity from cache policy and closed after navigation flags were
  added; it did not define which cache mode ordinary reload must select.
- `SPEC_CLASH(reload-cache-revalidation)` records Eric's approved Chromium/Firefox
  policy: revalidate even a fresh cached Document, using available validators.
  WebKit refetches it without validators. Browlet follows Fetch's `no-cache`
  header generation (`Cache-Control: max-age=0`), matching Chromium. Firefox's
  tested build sent validators without that header. WebKit's long-standing
  [main-resource revalidation issue](https://bugs.webkit.org/show_bug.cgi?id=17998)
  and `FrameLoader::reload` FIXME explain the different implementation path.

The 4 November HTTP probe exercised 51 cases in Chromium 156.0.8078.4, Firefox
157.0, and WebKit 27.2. Fresh persistent profiles verified cache hits before each
reload; no response interception or cache disabling was used. Location and
Navigation reloads revalidated in Chromium/Firefox and refetched in WebKit.
Chromium/Firefox reused fresh subresources, consistent with
[Chromium's stated policy](https://blog.chromium.org/2017/01/reload-reloaded-faster-and-leaner-page_26.html).
WebKit's `history.go(0)` instead reused the fresh cached Document and retained old
content after a server change; Browlet retains its shared reload path, consistent
with `SPEC_CLASH(history-zero-delta-reload)` above. Browser-only probes and detailed
observations remain in Experimental's `RELOAD-CACHE-POLICY.md`.

Explicit forced reloads are unfinished host work. The tested forced paths used
unconditional document/subresource requests with `Cache-Control: no-cache` and
`Pragma: no-cache`; Fetch's `reload` mode supplies cache bypass while allowing the
replacement response to be stored. That is distinct from `no-store`. Browlet
still needs an explicit host input, subresource propagation, and service-worker
bypass before exposing that operation. HTML's `Location.reload()` has no force
argument, so this slice adds none. Normal reloads do not gain a global cache-mode
override for later resource fetches.

Production regressions exercise request construction through real Fetch/HTTP,
including ETag, Last-Modified, both validators, no validators, changed content,
and connection failure. Request-level coverage checks all navigation destinations
and keeps ordinary/history request modes unchanged. These test the implemented
request/Fetch boundary; complete reload lifecycle delivery still requires the
coordinator described below.

Validation: the six new HTTP regressions and expanded request assertions failed
before the correction. All 135 tests across the six focused navigation/Fetch
suites now pass on Node 24.19.0, 26.8.1, and custom 27, with and without the addon.
Typechecking, changed-file ESLint, import hierarchy, and whitespace checks pass.
No failures were reclassified and no native artifacts were rebuilt.

### Deliberate integration boundary

`Traversable.applyHistoryStep()` still throws before starting these jobs. Connecting
only their producer would strand error/discard waits or imply an incorrect barrier
waiting for all loads. The next coordinator slice must accept each ready
continuation while other jobs wait, process eligible synchronous queue jumps, and
retain the traversal queue until the entire application finishes. It must also
route population failures and discarded tasks into that completion with one
reporting owner, and protect nested job/reload ownership. No
successful public back/forward or reload completion is claimed by this producer.

Transient-activation capture, Document loader/parser work, optional repost UI,
deactivation/unloading, activation, per-Document updates, and task teardown remain
explicit dependencies at their existing owners. The provisional push/replace
loader is unchanged. Tests drive the new producer through real Window task loops,
real bound child events and Fetch; controlled population results isolate lifecycle
branches that the Document loaders do not yet implement.

Validation: all 1,295 tests in 66 navigation suites pass on Node 26.8.1 with the
addon. The 250 focused cases in seven suites pass on Node 24.19.0, 26.8.1, and
custom 27, with the addon disabled and enabled. Typechecking, changed-file ESLint,
import hierarchy, and whitespace checks pass. The HTTP browser probe retains
the approved WebKit POST expected failure; no production failures were
reclassified. Existing matching addon artifacts were reused without rebuilds.

## HTML §7.4.6.1: Synchronous navigation queue jumping

Audited the [queue-jumping loop](https://html.spec.whatwg.org/multipage/browsing-the-web.html#sync-navigations-jump-queue)
against HTML `a7f6aed` (2026-11-04). `Traversable.runSynchronousNavigationSteps()`
extracts step 14.1. It receives the coordinator's live set of navigables that
must wait and returns browser-owned completion. This reviewed extraction is
part of history application, not a separate specification algorithm.

The method repeatedly selects the first eligible tagged item, removes it before
invocation, and preserves ordinary and blocked work in the ordered set. Selection
starts from the beginning after each job, accounting for newly appended items and
changes to eligibility. A nested application does not itself select more work.
The nested flag remains set until a selected job's `InternalPromise` settles;
neither subsequent selected work nor the suspended outer operation continues
early. Fulfillment payloads do not affect selection, and rejection or a synchronous
throw clears the flag and propagates the original failure.

`SessionHistoryTraversalQueue.runSteps()` supplies the same execution admission
for ordinary and selected callbacks, restoring an enclosing invocation afterward.
It requires an occupied queue. Awaiting completion does not retain execution
admission, so an unrelated call to `applyHistoryStep()` still fails while a job
waits. The UserAgent's `HostPromise` observes completion even after the original
Document retires; another traversable remains free to progress.

This is a bounded extraction, not yet connected to the incomplete coordinator.
`applyHistoryStep()` continues to reject before starting population. Its next
integration must wake for tagged appends and prepared continuations, add each
dequeued continuation's navigable to the waiting set before dispatching its later
job, and propagate population failures/discarded tasks. Deactivation, activation,
per-Document updates, and the final joint-step barrier remain explicit dependencies.
The provisional push/replace operation must eventually return its completion to
the selected callback, as the already-connected traverse/reload wrappers do.
No successful public traversal or new browser-policy choice is claimed here.

Validation: 12 new queue-jumping tests cover selection order, live eligibility,
reentrant appends, nested suppression, execution admission after waiting, retired
Document completion, independent traversables, and failure cleanup. All 1,313
navigation cases in 68 suites pass on Node 26.8.1 with the addon. The 92 cases in
six focused history suites pass on Node 24.19.0, 26.8.1, and custom 27, each with
and without the addon. Typechecking, changed-file ESLint, import hierarchy, and
whitespace checks pass. No failure classifications changed or native builds ran.

## HTML §7.4.6.1: Preparation failure completion

The next coordinator dependency is an error result from the existing producer.
`prepareHistoryStep()` now accepts optional implementation-only `failureSteps`
after its continuation callback and forwards them through population. Supplying
these steps transfers asynchronous error reporting to the waiting operation;
callers without them retain the previous task/parallel exception. Initial
synchronous setup errors still throw to the direct caller. The failure callback
is an accepted implementation completion path, following the existing unload-check
arrangement; it adds no author-facing API or browser-policy choice.

Preparation-task validation and snapshot errors, parallel request construction,
Fetch rejection, response-task delivery, MIME/body-reading failure, Document-loader
and retained-state failures, and the post-population continuation now have a route
back to their waiting owner. The original exception is preserved. Completion is
not fabricated on those paths, and reload inputs still clear after request
construction even if it throws. Fetch response delivery after loss of the active
Window now reports through its captured UserAgent, rather than escaping an
unobserved Promise reaction.

Resource cancellation is a separate cleanup after superseded population reports
completion. Its late failure remains a task error; it cannot send a second,
contradictory job result to the waiting operation. Real stream regressions cover
both reading failure and rejecting cancellation.

The coordinator remains deliberately disconnected. It must supply the failure
callback, settle/clean up outstanding jobs, wake for prepared continuations and
tagged appends, and consume the ready queue. The following slice supplies queued-task
removal notification; the §7.5 teardown owner still needs cancellation while
population has no queued continuation. Deactivation, activation, Document updates, and the final joint-step
barrier are unchanged dependencies. This slice does not complete a public reload
or traversal.

Validation: five regression expectations first demonstrated missing failure
notification. Eight additional cases cover reporting ownership, parallel and
Fetch failures, loss of the active Window, post-population errors, queue release,
body-read failure, and late cancellation cleanup. All 1,321 navigation cases in
68 suites pass on Node 26.8.1 with the addon. The 179 focused cases in five suites
pass on Node 24.19.0, 26.8.1, and custom 27, with and without the addon.
Typechecking, changed-file ESLint, import hierarchy, and whitespace checks pass.
No failures were reclassified and no native artifacts were rebuilt.

## HTML §7.4.6.1: Completion when queued work is discarded

`TaskCreationOptions.discardSteps` is internal completion bookkeeping, not an
additional HTML task execution. `EventLoop.removeTask()` and
`removeTasksForDocument()` remove pending work before notifying its owner. The
Document-wide operation detaches the entire batch first, notifies every waiting
owner even if one callback throws, and then propagates the first notification
error. Repeated or reentrant removal cannot notify a removed task twice. Running
or completed tasks are not discarded, and retained inactive Documents continue
to wait for reactivation.

History preparation uses its accepted failure callback when removal discards the
initial or post-population task. Population does the same for response delivery
and queued MIME success/failure continuations. Removed unload-check tasks reject
their existing browser-owned completion. These paths use an internal error, without
inventing a successful history result or a beforeunload/navigate cancellation.
Late resource-cancellation cleanup remains separate after population completion;
discarding its error-reporting task cannot fail an already completed job.

This covers tasks already queued when removal happens. Teardown during in-flight
Fetch/body reading or the parallel interval before a task exists still needs an
operation-lifetime cancellation path and protection against late callbacks. The
retained reader also needs cancellation if teardown removes its continuation.
Both dependencies remain explicit beside population's queueing and resource
ownership. Full continuation coordination, deactivation/activation, Document
updates, and the final history barrier remain unfinished. No public traversal or
reload completion is claimed.

Two regressions first failed because real Document destruction never notified
the preparation waiter. Further coverage exercises response and MIME-task removal,
unload-check rejection, reactivation, traversal-queue release, late cleanup, and
single/batch removal with reentrant or throwing notifications.

Validation: all 240 focused cases in nine suites pass on Node 24.19.0, 26.8.1,
and custom 27, with and without the addon. The wider navigation/scripting run on
Node 26.8.1 with the addon has 2,050 passes, 83 existing expected failures, and
seven existing skipped/TODO cases. Typechecking, changed-file ESLint, import
hierarchy, and whitespace checks pass. No failure classifications changed or
native artifacts were rebuilt.

## HTML §7.4.6.1: Activate a history entry

`Navigable.activateHistoryEntry()` follows
[activate a history entry](https://html.spec.whatwg.org/multipage/browsing-the-web.html#activate-history-entry):
save the displayed entry's persisted state, require a populated non-initial
Document, switch the active entry, make its Document active, and initialize its
visibility from the containing traversable. Existing Document activation connects
the browsing context and WindowProxy and marks the environment execution-ready.
Initial visibility does not dispatch `visibilitychange`.

The operation leaves the current entry and joint history step alone. Classic
History state, Navigation notifications, and later Document updates belong to
the surrounding history application. `SessionHistoryEntry.savePersistedState()`
remains an explicit throwing §7.4.6.5 dependency, before any activation mutation.
VisibilityStateEntry reporting retains its existing Document-owned dependency.
The provisional loader is not routed through this operation while that capture
is missing. Full coordination must also retain the displayed Document through
reload population and deactivation, as already recorded for HTML issue #12668.

Tests substitute only the missing persisted-state capture and exercise real
Document/Window activation. They cover capture ordering, failed capture, invalid
targets, same-Document entries, parent visibility, and the state reserved for
later history application. No new browser-policy choice is introduced.

Validation: all 1,337 navigation tests in 69 suites pass on Node 26.8.1 with
the addon. The 101 focused cases in five suites pass on Node 24.19.0, 26.8.1,
and custom 27 with the addon; stock runs have 98 passes and the same three
existing native-global expected failures. The seven new activation cases pass
in all six configurations. Typechecking, type contracts, changed-file ESLint,
import hierarchy, and whitespace checks pass. No failure classifications changed
or native artifacts were rebuilt.

## HTML §7.4.6.1: Outgoing pageswap production

`Window.firePageSwapEvent()` implements
[fire the pageswap event](https://html.spec.whatwg.org/multipage/browsing-the-web.html#fire-the-pageswap-event).
The Window supplies its associated displayed Document and realm instead of
receiving that Document separately. The operation requires a task on that Document's Agent
loop and a populated target Document. It creates a separate NavigationActivation
without modifying `navigation.activation` or either Navigation entry list.
Reload reuses the outgoing current entry; traversal selects the existing entry
by session-history identity; push/replace create a new outgoing-realm view of
the actual destination entry. A missing initial about:blank predecessor is
allowed; a missing reload/traversal destination remains an internal error.

Only same-origin targets receive activation. A new Document reached through a
cross-origin redirect is filtered even when the final URL returns to the source
origin. A previously activated same-origin Document retains HTML's restoration
exception. The supplied ViewTransition reference is independent of that filtering.
The trusted event targets Window, with its ordinary false EventInit flags.

The browser-only `node-compat/experimental/pageswap-production.mjs` probe ran on
4 November with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved
following HTML for these continuing conflicts:

| Marker | Evidence and chosen behavior |
| --- | --- |
| `pageswap-trust-target` | Chromium follows HTML's trusted Window event. WebKit supplies an untrusted event targeting Document; its `dispatchPageswapEvent()` calls the ordinary constructor and explicitly supplies Document as target. Browlet follows HTML. |
| `pageswap-traversal-entry` | Chromium reuses the existing Navigation entry and its stored state. WebKit returns a detached substitute with index -1 and different key/ID; its source has a FIXME to reuse the existing entry. Browlet selects by session-history identity. |
| `pageswap-redirect-origin` | Chromium suppresses activation across the probe's different-port redirect and return. WebKit exposes activation, checking request same-site status rather than cross-origin redirect history. Browlet follows HTML/Chromium's stricter origin rule. |
| `pageswap-destination-entry` | Push/replace use temporary entries in Chromium/WebKit, with key/ID different from the eventual committed entry. Blink explicitly constructs its substitute without state; WebKit describes its detached history item as provisional. Browlet retains the actual destination record's key, ID, and state, as HTML specifies. |

Source evidence: [Blink PageSwapEvent](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/view_transition/page_swap_event.cc),
[WebKit Navigation](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Navigation.cpp),
[WebKit Document](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/dom/Document.cpp),
and [WebKit FrameLoader](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/FrameLoader.cpp).
Firefox exposes the interface with `dom.viewTransitions.cross-document.enabled`
but delivered no pageswap in these runs. The probe retains these browser
disagreements and missing delivery as ordinary failing expectations; it is not a
Browlet acceptance suite. The new production tests exercise actual bindings,
outgoing realms, Window dispatch, `onpageswap`, and the Agent task precondition.

The Document-deactivation operation below now supplies the producer's caller.
The ViewTransition identity exists; CSS eligibility, capture, transfer, promises,
and invocation of the continuation after capture do not. Recursive unloading,
coordinator completion, and later incoming Document updates remain their
explicit boundaries. The provisional loader is unchanged.

Validation: all 68 focused tests in five suites pass on Node 24.19.0, 26.8.1,
and custom 27, with and without the addon. This includes 15 new producer tests.
The broader navigation/event run on Node 26.8.1 with the addon passes all 1,388
tests in 73 suites. Typechecking, type contracts, changed-file ESLint, import
hierarchy, and whitespace checks pass. No failures were reclassified and no
native artifacts were rebuilt.

## HTML §7.4.6.1: Deactivate a Document for cross-document navigation

`Document.deactivateForCrossDocumentNavigation()` implements the
[deactivation handoff](https://html.spec.whatwg.org/multipage/browsing-the-web.html#deactivate-a-document-for-a-cross-document-navigation).
The displayed Document owns the operation and retains its outgoing Window and
the populated destination. User involvement becomes the browser-UI boolean for
CSS eligibility; navigation type remains a separate input.

When CSS declines a transition, deactivation releases ongoing traversal ownership
and passes the pageswap producer to recursive unloading. That owner must dispatch
pageswap on the outgoing Window's task before unloading the Document and invoking
the supplied completion. Deactivation does not itself report completion early.

When a transition is possible, setup and pageswap run in a navigation-and-traversal
task on the active Window. A null setup result immediately appends unloading to
the traversal queue. A transition retains that same continuation until CSS capture
completes or is skipped. Both paths then release ownership and unload without a
second pageswap. These ownership changes run in parallel: they do not borrow the
displayed Document's Agent as a caller, and Navigation abortion remains queued.

`SPEC_CLASH(cross-document-transition-setup-inputs)` records that HTML passes four
inputs to CSS setup, including navigation type, while
[CSS setup](https://drafts.csswg.org/css-view-transitions-2/#setup-outbound-transition)
takes only the two Documents and the continuation. Eric approved following CSS;
its preceding [eligibility check](https://drafts.csswg.org/css-view-transitions-2/#check-eligibility)
already receives navigation type. Both live specifications were checked on
4 November 2026; local references were HTML `a7f6aed` and CSSWG `909869d6b`.

Dependencies remain callable and explicit:

- `Document.canTriggerCrossDocumentViewTransition()` throws until CSS's UA opt-out,
  outbound opt-in, and navigation gates are audited. Opt-in depends on rule
  resolution and reveal/visibility updates; missing state is not treated as false.
- `Document.setupCrossDocumentViewTransition()` throws until CSS supplies the
  existing-transition cleanup, outgoing allocation/types, capture, transfer,
  rendering suppression, and post-capture continuation lifecycle.
- `Document.unloadAndDescendants()` still throws. Its descendant ordering,
  pageswap task, pagehide/unload/visibility events, timing, bfcache decisions, and
  completion remain §7.5.9 work.
- The full history coordinator still needs the deactivation caller and all its
  completion/failure/discard paths. Errors currently propagate from direct work,
  queued setup, or traversal steps; no waiting coordinator is connected yet.
  Destruction during capture and late capture callbacks need the CSS/unloading
  lifecycle contracts before they can release that future wait safely.

Tests control only the unfinished CSS and unloading owners, using actual Window
bindings, Agent tasks, and the traversal queue. They cover all four navigation
types, browser-UI input, release/event/unload order, delayed capture, declined
setup, queue ordering, outgoing-realm event identity, and explicit dependency
failures. These are orchestration tests, not an implementation of CSS capture or
recursive unloading. No provisional-loader path was redirected to this operation.

Validation: all 82 focused tests in five suites pass on Node 24.19.0, 26.8.1,
and custom 27 with and without the addon, including 15 new deactivation cases.
Typechecking, type contracts, changed-file ESLint, import hierarchy, and whitespace
checks pass. No failure classifications changed or native artifacts were rebuilt.

## HTML §7.4.6.2: Existing-Document history updates

Audited [updating the document](https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application)
against HTML `a7f6aed` and the live specification on 4 November 2026.
`Document.updateForHistoryStepApplication()` now implements the existing-Document
branch. It reconciles History length/index, maintains latestEntry, restores classic
state in the Document's realm, publishes the URL, notifies Navigation, dispatches
trusted popstate, and queues trusted hashchange when appropriate. It calls the
existing activation updater after persisted-state restoration. It does not advance
the Navigable's current entry or the traversable's joint history step.

Unchanged entries retain their cached History state and do not deserialize or
repeat events. With reactivation permitted, they instead reach the new explicit
`Document.reactivate()` boundary. This preserves the distinction between a
same-Document entry change and restoring a retained Document.

The browser-only `node-compat/experimental/document-history-update.mjs` probe ran
on 4 November with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It covers
same/different-path traversal and replaceState from currententrychange/popstate.
Eric approved these choices, also marked beside the implementation:

| Marker | Evidence and chosen behavior |
| --- | --- |
| `history-document-url` (`SPEC_GAP`) | HTML never assigns the selected entry's URL to the existing Document. All three browsers expose the restored URL before currententrychange/popstate. Browlet updates it through `setURL()`, including base-URL consumers. Ladybird independently documents the same missing assignment. |
| `history-hashchange-url` | HTML compares fragments alone. All three browsers suppress hashchange when the non-fragment URL also changes. Browlet requires equal URLs excluding fragments and unequal fragments. |
| `history-popstate-reentrant-state` | A currententrychange listener can replace the entry before popstate. Browlet follows HTML/Firefox by reading the current History state after that listener. Chromium/WebKit preserve the traversal's earlier state for the event. All retain the listener's later URL/state on History. |
| `history-hashchange-queue-order` | HTML queues hashchange after popstate. Blink/Gecko explicitly queue first; WebKit queues afterward but delivers it ahead of the probe's popstate-created timer. Browlet queues first, retaining asynchronous delivery and the original URLs across reentrant History changes. |

[HTML issue #12190](https://github.com/whatwg/html/issues/12190) records the event/timer
ordering disagreement, the earlier popstate timing change, and interaction with
scroll restoration. Early queueing does not establish a universal priority between
task sources; this slice does not change the event loop's scheduling policy.
Source evidence: [Blink DocumentLoader](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/loader/document_loader.cc),
[Gecko nsDocShell](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/docshell/base/nsDocShell.cpp),
[WebKit FrameLoader](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/FrameLoader.cpp),
and [Ladybird Document](https://github.com/LadybirdBrowser/ladybird/blob/874f491af9b0675281d3caddb93982523f374f3e/Libraries/LibWeb/DOM/Document.cpp).

Remaining owners and stopping points:

- `SessionHistoryEntry.restorePersistedState()` now applies §7.4.6.5's gates.
  Automatic restoration still throws at the layout boundary after popstate and
  after hashchange is queued. Manual/suppressed restoration can finish without
  scrolling; those events alone still do not imply completed navigation.
- The following new-Document slice installs latestEntry, restores classic state,
  initializes Navigation/activation, and orders the script permit after the
  remaining persistence, BiDi, and fragment-scroll owners. Initial about:blank
  fragment callers still have a separate missing initialization described in
  [HTML issue #13041](https://github.com/whatwg/html/issues/13041).
- `Document.reactivate()` is implemented in the retained-Document slice below,
  with autocomplete-off form reset and visibility transitions still throwing.
  The bfcache lifecycle must supply retained Documents and history inputs.
- Full traversal coordination and persisted/fragment scrolling remain unfinished.
  The provisional cross-document loader keeps its existing separate initialization
  route, now releasing the shared script gate. Browlet has no cached-rendering UI;
  the actual produced popstate therefore has hasUAVisualTransition false.

Validation: all 118 focused cases in six suites pass on Node 24.19.0, 26.8.1, and
custom 27 with and without the addon, including 21 new Document cases and one
Location.hash integration case. The integration substitutes only persisted-state
restoration, scrolling, and finalization, exercising real URL/binding/event delivery.
Typechecking, type contracts, changed-file ESLint, import hierarchy, and whitespace
checks pass. No failure classifications changed or native artifacts were rebuilt.

## HTML §7.4.6.2: New-Document history initialization

Audited the new-Document branch of
[updating the document](https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-document-for-history-step-application)
against HTML `a7f6aed` and the live specification on 4 November 2026.
`Document.updateForHistoryStepApplication()` now installs latestEntry, restores
classic History state in the Document's realm, calls persisted-state restoration,
initializes Navigation entries and activation, calls the BiDi committed hook,
requests fragment-scroll scheduling, and then permits parser scripts. Initial
Navigation setup emits no popstate, hashchange, or currententrychange. It does not
advance the traversable's joint step or complete the history coordinator.

The Document retains a one-way readiness flag and allocates a shared internal
promise only if parsing must wait. Its existing provisional local commit path
releases the same gate after Navigation initialization. This preserves that route
without claiming its synchronous commit implements the full history algorithm.
The streamed HTML consumer rechecks `parser.stopped` after the wait: the regression
first demonstrated that an aborted parser could otherwise run its saved script
callback when permission arrived later. General HTML script preparation remains
a §7.5/HTMLScriptElement dependency.

The source records these input corrections:

| Marker | Evidence and chosen behavior |
| --- | --- |
| `history-new-document-inputs` (`SPEC_GAP`) | HTML reads the old latest entry's URL even when that entry is null, and later uses an unbound `navigable`. The old URL is needed only in the existing-Document branch; the new Document supplies its node navigable for commit reporting. Missing Navigation entries or a missing node navigable remain internal precondition errors. |
| `history-population-navigation-id` | The history-population caller passes null while this branch asserts a non-null loading ID. Eric approved preserving that retained null through the provisional committed hook, extending the earlier population/Fetch ownership correction. No ID is invented and no automation protocol attribution is claimed. |

[WebDriver BiDi's committed hook](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigation-committed)
requires navigation information, committed waiters, and subscribed sessions.
Its navigation-status definition also omits HTML's `committed` status and describes
null IDs for early cancellation, not this history-population case. The new UserAgent
hook retains HTML's supplied inputs as a marked no-op until the BiDi audit resolves
that mapping. [Ladybird's Document implementation](https://github.com/LadybirdBrowser/ladybird/blob/874f491af9b0675281d3caddb93982523f374f3e/Libraries/LibWeb/DOM/Document.cpp)
likewise retains a Document-owned readiness flag/deferred parser start and leaves
the non-null ID assertion unresolved; it is secondary source evidence, not a new
browser policy decision.

Remaining owners and stopping points:

- `SessionHistoryEntry.restorePersistedState()` (§7.4.6.5) now applies restoration
  policy, but its automatic scroll operation still throws. It follows latestEntry/
  classic state installation and precedes Navigation initialization; the operation
  is not an atomic transaction that can be retried after that throw.
- `Document.tryToScrollToFragment()` now schedules its delayed navigation task
  and returns immediately, as detailed in the fragment-scroll scheduling slice
  below. Its user-interest, indicated-part, and actual scrolling dependencies
  execute later; they no longer prevent parser-script permission. Automatic scroll
  restoration still blocks the full new-Document branch before scheduling.
- Real BiDi delivery, full traversal coordination, bfcache restoration, and
  XML/script-preparation callers remain unfinished. The retained-Document slice
  below implements reactivation around explicit form and visibility dependencies.
  The existing
  [initial about:blank fragment issue #13041](https://github.com/whatwg/html/issues/13041)
  still needs its separate latest-entry initialization correction; this slice does
  not fabricate Navigation entries for that caller.

Validation: five focused suites contain 97 cases, including 12 new initialization
cases and two streamed-parser ordering/cancellation cases. All 97 pass with the
addon on Node 24.19.0, 26.8.1, and custom 27; each stock run has 94 passes and the
same three existing native-global expected failures. The broader loader/parser
check passes all 68 cases on Node 26.8.1 with the addon. Typechecking, type contracts,
changed-file ESLint, import hierarchy, and whitespace checks pass. No failure
classifications changed or native artifacts were rebuilt.

## HTML §7.4.6.2: Retained-Document reactivation

Audited [reactivating a Document](https://html.spec.whatwg.org/multipage/browsing-the-web.html#reactivate-a-document)
against HTML `a7f6aed` and the live specification on 4 November 2026.
`Document.reactivate()` now calls the selective form-reset owner, reconciles
Navigation entries and activation, and, for a complete Document not already
showing, sets `pageShowing`, clears `hasBeenRevealed`, requests visibility updating,
and fires trusted persisted `pageshow`. Navigation's existing queued disposal runs
after that event. Readiness/showing checks prevent duplicate delivery, including
reentrant calls. No `currententrychange` or `pagereveal` is synthesized here.

The existing `GlobalTimers` owner already pauses and resumes deadlines on full
activity changes, before reactivation runs. Its per-timer suspension timestamps
also cover timers started while inactive. This operation must not add the cached
duration again or create a second suspended-timer list on Document. The regression
checks both timers across an inactive interval and observes their remaining delays
and actual callback order. It does not implement bfcache admission or unloading.

### Entry/activation ordering correction

`SPEC_CLASH(history-reactivation-navigation-order)` records HTML's activation
update before the later reactivation entry-list refresh. The regression first
failed because the previous page, created while this Document was cached, was not
in its retained list: `activation.from` was null despite becoming a listed entry
immediately afterward. Eric approved refreshing entries, then activation, then
`pageshow`. The retained entry and activation objects keep their identities.

`Document.reactivate()` takes two extra trailing inputs, `navigationType` and
`previousEntryForActivation`, so the history-update caller can defer that existing
activation operation until the entries are ready. Eric reviewed and accepted
this signature extension; its `SPEC_MISMATCH` is removed. The behavioral conflict
marker remains.

The browser-only `node-compat/experimental/document-reactivation.mjs` probe ran on
4 November with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Chromium's
full browser verified actual bfcache restoration twice (`persisted === true` and
the original Document marker): the previous page was listed and `activation.from`
was current during `pageshow`; visibility was visible; removed forward entries
were disposed afterward. Firefox and WebKit reloaded in this setup, so their runs
provide no live retained-Document ordering evidence.

[Blink's `SetEntriesForRestore()`](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigation_api.cc)
refreshes the list before activation and queues disposal.
[WebKit's `CachedPage::restore()`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/history/CachedPage.cpp)
instead fires `pageshow` before `restoreNavigationAPIHistoryItems()`.
[Gecko's `Document::OnPageShow()`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/Document.cpp)
updates showing/visibility state before delivery and clears the reveal flag for
persisted restoration. Source evidence does not turn the cache misses into
successful browser probes.

### Remaining owners and stopping points

- `Document.resetAutocompleteOffControls()` throws before subsequent work. HTML
  requires each control's computed autofill field name, including inherited form
  defaults, input type/mantle rules, and invalid tokens, then its individual reset
  algorithm. The [form-control roadmap](../../dom/nodes/html/forms/ROADMAP.md)
  tracks those missing owners. A raw attribute query or whole-form reset would
  select the wrong controls; this slice does not substitute either.
- `Document.updateVisibilityState()` implements only the specified equal-state
  return. A changed state throws until §6.2 can update the state, queue a timed
  `VisibilityStateEntry`, run Screen Orientation, CSS View Transitions, Device
  Posture and Web NFC hooks, and fire bubbling `visibilitychange`. Initial-state
  assignment is not a replacement for those effects. Navigation and showing/
  reveal flags already change before this dependency is reached; a throw is not
  a completed restoration or an automatically retryable transaction.
- `pageShowing` and `hasBeenRevealed` now exist and are maintained here. Initial
  loading/unloading must also maintain showing state; §7.4.6.3's `Document.reveal()`
  sets the reveal flag before inbound-transition work and `pagereveal`.
- Full history coordination, retention/eviction policy, unloading and activation
  scheduling must supply the retained Document and correct history inputs. The
  provisional loader does not thereby gain end-to-end bfcache/back-forward support.
  Fragment-scroll scheduling is implemented in the following §7.4.6.2 slice.

The tests use real Window bindings and Agent tasks, retaining handlers installed
before navigation. They substitute only the explicit unfinished owners when
checking the subsequent ordering and also assert those owners' current throws.
Validation: all 92 cases in seven focused suites pass on Node 24.19.0, 26.8.1, and
custom 27, each with and without the addon, including 12 retained-Document cases.
Typechecking, type contracts, changed-file ESLint, import hierarchy, and whitespace
checks pass. No failure classifications changed or native artifacts were rebuilt.

## HTML §7.4.6.2: Fragment-scroll scheduling during loading

Audited [trying to scroll to the fragment](https://html.spec.whatwg.org/multipage/browsing-the-web.html#try-to-scroll-to-the-fragment)
against HTML `a7f6aed` and the live specification on 4 November 2026.
`Document.tryToScrollToFragment()` uses the existing UserAgent `TimerHost` for
the parallel wait, then the Document environment's navigation-and-traversal task
source. The task checks the current parser and user-interest policy, calls
`scrollToFragment()`, and schedules another delayed attempt only if the current
indicated part is still null. It reads that part after scrolling, preserving
changes caused by the operation. No new task queue, promise, or timer registry
is introduced, and the Document remains the algorithm's receiver.

HTML leaves the delay implementation-defined. Browlet waits 50 ms per attempt
so a missing target cannot busy-loop while parsing awaits input. This is a local
scheduling choice, not a measured browser constant or an implemented rendering
cadence. The normal HTML task queue holds work for inactive Documents; its existing
teardown discards queued work. A wake-up after the browsing context has been cleared
does not enqueue a new task. That wake-up itself is bounded by the delay rather
than retained as a second Document timer state.

New-Document history initialization now returns from scheduling and permits
parser scripts immediately afterward. The regression exercises the real scheduler
and script gate: scripts resume before the host wake-up and before the later
navigation task attempts scrolling. Persisted-state restoration remains an earlier
throwing dependency. This does not connect the provisional loader to full traversal.

The browser sources tie the broader behavior to unfinished rendering/input owners:
[Blink's element fragment anchor](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/page/scrolling/element_fragment_anchor.cc)
waits for rendering resources and stops competing with explicit scrolling;
[WebKit's FrameLoader](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/FrameLoader.cpp)
defers fragment scrolling for pending stylesheets;
[Gecko's PresShell](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/layout/base/PresShell.cpp)
checks whether the viewport has moved since its earlier anchor scroll.
These are source references, not live browser timing measurements. This slice
implements HTML's scheduling flow without choosing those rendering policies.

The remaining calls stay explicit:

- `UserAgent.isUserInterestedInFragmentScrolling(document)` throws until input
  and scrolling integration can supply that decision. It does not equate a
  synthetic `scroll` event with user intent or silently assume continued interest.
- `Document.indicatedPart` now implements HTML selection. `scrollToFragment()`
  updates retained target state, then still throws for actual viewport/element
  scrolling, ancestor revealing, and focus; non-HTML MIME fragment rules also throw.
  No selector shortcut or synthetic scroll/focus event substitutes for those owners.
- Rendering/layout readiness and producer-specific cancellation belong with that
  integration. Parser absence/completion/abortion already stops this operation;
  XML parsing still lacks its implementation behind the shared parser contract.

Tests control host wake-ups and unfinished owners, while using real HTML parsers,
Document activity, event-loop task sources, and script-permission promises. They
cover delayed execution/retry, live parser and interest checks, post-scroll target
selection, inactive-Document gating, discarded work, and explicit owner failures.

Validation: seven focused suites contain 123 cases, including 14 scheduling cases
and the updated script-permission integration. All 123 pass with the addon on
Node 24.19.0, 26.8.1, and custom 27. Each stock run has 120 passes and the same
three existing native-global expected failures. Typechecking, type contracts,
changed-file ESLint, import hierarchy, and whitespace checks pass. No failure
classifications changed or native artifacts were rebuilt. The next bounded work
in document order is the not-restored-reasons collection still in §7.4.6.2;
§7.4.6.3 revealing follows those builders.

## HTML §7.4.6.2: Collecting not-restored reasons

Audited the [Document-state collector](https://html.spec.whatwg.org/multipage/browsing-the-web.html#build-not-restored-reasons-for-document-state)
against HTML `a7f6aed` and the live specification on 4 November 2026.
`Document.buildNotRestoredReasonsForDocumentState()` keeps its void contract and
stores each newly collected record in the active session history entry's state.
It copies blocking-detail membership and retains each detail and URL record.
Following the masking audit below, it traverses shadow-including container order
so the collector and filter visit the same Documents. Window's light-tree lookup
is unchanged. A missing node navigable or active child Document is an internal
precondition failure, not an empty report.

The browser-only `node-compat/experimental/not-restored-reasons-collection.mjs`
probe uses WPT's RTC cache blocker and verifies a reload rather than bfcache
restoration. Chromium 156.0.8078.4 produced a nonempty nested tree, empty lists
for same-origin leaves, and null URL/reasons/children for a foreign child.
Firefox 157 and WebKit 27.2 did not expose the Navigation Timing attribute.
Unlike the older unload probe above, this establishes actual child-tree behavior.
Blink's [recursive timing builder](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/timing/performance_navigation_timing.cc)
also asserts that recursively created child records are non-null.

Approved choices:

- `SPEC_CLASH(not-restored-reasons-collection)`: initialize children as an empty
  list and append the child's collected history-state record. HTML instead
  appends to initially null children and reads a Document accessor specified
  to return null for children. The existing accessor remains top-level-only.
- `SPEC_CLASH(not-restored-reasons-container-metadata)`: follow HTML's resolved,
  encoding-aware iframe `src` and empty strings for absent src/id/name.
  Chromium returns the raw source attribute and null for absent attributes;
  its live results distinguish missing attributes from explicitly empty ones,
  matching the [WPT metadata expectations](https://github.com/web-platform-tests/wpt/blob/master/performance-timeline/not-restored-reasons/performance-navigation-timing-iframes-without-attributes.tentative.window.js).
  Parsing uses the container's node Document base and encoding. On failure the
  source text is retained subject to the struct's scalar-string constraint;
  ID/name preserve lone surrogates. Non-iframe containers retain null metadata.

Document collection remains internal and unfiltered. The next audit completes
`TopLevelTraversable.buildNotRestoredReasons()` and its `masked`-reason ordering
correction; no public timing accessor is introduced. Unloading and cache eviction
must call that complete builder before destruction. Those lifecycle hooks, Web
Locks/optional cache-policy producers, and the real Navigation Timing consumer
remain explicit dependencies; the existing `navigation-failure` producer is retained.

Validation: the diagnostic-interface and collection suites contain 36 cases,
including 19 new collection cases. All pass on Node 24.19.0, 26.8.1, and custom
27 with and without the addon. Typechecking, type contracts, changed-file ESLint,
import hierarchy, and whitespace checks pass. No failure classifications changed
or native artifacts were rebuilt.

## HTML §7.4.6.2: Masking not-restored reasons

Audited the [top-level builder](https://html.spec.whatwg.org/multipage/browsing-the-web.html#build-not-restored-reasons-for-a-top-level-traversable-and-its-descendants)
against HTML `a7f6aed` and the live specification on 4 November 2026.
`TopLevelTraversable.buildNotRestoredReasons()` forwards to its active Document's
`buildNotRestoredReasons()`, which owns collection and filtering. The separate
recursive collector leaves records unfiltered until the top-level pass. This
reviewed ownership arrangement keeps the traversable's void entry point and
requires an active top-level Document at the Document entry point. Strict origins
determine which records lose their URL, reasons, and children; container metadata remains.
URL origin alone and `document.domain` relaxation do not grant visibility.
The parent-first descendant walk tracks Documents behind foreign ancestors so
blockers in their hidden subtrees still produce the generic root indication.
It updates active history state, independently of a pending traversal entry.

The browser-only `node-compat/experimental/not-restored-reasons-masking.mjs`
probe checks real navigation/back sequences with WPT's RTC cache blocker, recording
reload identity and `pageshow.persisted` to distinguish restoration. Chromium
156.0.8078.4 retains visible same-origin child reasons; a blocker in a foreign
child, deeper foreign child, same-origin grandchild behind a foreign parent, or
foreign shadow-tree iframe instead produces root `masked` and null foreign
URL/reasons/children. Firefox 157 and WebKit 27.2 do not expose this API, so they
provide no diagnostic-tree oracle here.

Approved corrections, each marked in source:

- `SPEC_CLASH(not-restored-reasons-collection)`: refresh the root's copied list
  after `makeUnsalvageable('masked')`. HTML otherwise omits its newly added detail
  from the collected report. Existing root reasons remain and later additions
  do not mutate that snapshot.
- `SPEC_CLASH(not-restored-reasons-hidden-blocker)`: count blockers anywhere in
  a subtree hidden by a foreign ancestor, including a descendant that returns
  to the root origin. HTML's foreign-Document-only check misses the latter.
  Only foreign records themselves are nulled, following HTML; same-origin
  records behind them cannot be reached through the filtered tree.
- `SPEC_CLASH(not-restored-reasons-shadow-tree)`: collect shadow-tree containers
  as well as light-tree containers. HTML collection uses document-tree children
  while masking uses shadow-including descendants, otherwise reading a missing
  or stale record. This revises the prior collection slice as approved; the
  Window child-lookup algorithm remains unchanged.

Chromium's [cache-tree implementation](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/content/browser/back_forward_cache/back_forward_cache_impl.cc)
checks a foreign subtree through `FlattenTree().CanRestore()` and adds a root
`masked` detail. It also contains flag-gated randomized foreign-frame attribution;
that is not HTML's rule or the behavior observed in the tested default build,
and Browlet does not introduce it. The existing
[WPT foreign-frame case](https://github.com/web-platform-tests/wpt/blob/master/performance-timeline/not-restored-reasons/performance-navigation-timing-cross-origin-bfcache.tentative.window.js)
expects a generic root reason with the foreign tree hidden.

The remaining dependency is delivery: unloading/cache eviction must invoke the
complete builder before destroying the active tree. Their existing throwing
lifecycle boundaries remain; this slice does not supply bfcache eligibility,
retention/eviction policy, or additional optional reason producers. Navigation
Timing must create and retain a platform diagnostic from the filtered record,
including its unresolved null-input rule documented in the Performance roadmap.
No public accessor or provisional loader shortcut has been added.

The builders at the end of §7.4.6.2 are now implemented. Previously recorded
owner dependencies in that section remain open; the next document-order slice
is **§7.4.6.3, revealing the document**.

Validation: all 48 cases across the diagnostic-interface, collection, and masking
suites pass on Node 24.19.0, 26.8.1, and custom 27, with and without the addon.
The new shadow-collection regression failed before the correction. Typechecking,
type contracts, changed-file ESLint, import hierarchy, and whitespace checks pass.
No failure classifications changed or native artifacts were rebuilt.

The reviewed ownership move was rechecked with the same 48 cases, typechecking,
and changed-file lint. Collection and masking now live together on Document;
the forwarding entry point keeps the specification's top-level owner explicit.

## HTML §7.4.6.3: Revealing the document

Audited HTML's [reveal](https://html.spec.whatwg.org/multipage/browsing-the-web.html#reveal)
algorithm at `a7f6aed` and the live specification on 4 November 2026.
`Document.reveal()` keeps the specified void contract. It returns immediately
when already revealed, sets the guard before inbound resolution, fires
PageRevealEvent at its relevant Window, and activates the resolved transition
after dispatch.

For a non-null transition, activation runs inside the Document environment's
existing EventLoop prepare/cleanup-script boundary. Cleanup is guaranteed even
when the explicit unfinished CSS operation throws. No new scheduler, native
hook, or Promise adapter is introduced. The real rendering-producer regression
supplies only its host opportunity and missing CSS results: activation's
InternalPromise reactions complete before the animation-frame phase, and a
second rendering opportunity does not repeat the event. Reactivation's existing
flag reset permits the next activation's revelation. Shared Window/body handlers
use their existing binding and dispatch machinery.

`SPEC_CLASH(pagereveal-target-and-trust)` follows HTML/Chromium: a trusted event
whose target is Window, with bubbles/cancelable/composed false. The browser-only
`node-compat/experimental/document-reveal.mjs` probe checked real page entry and
same-origin CSS-opted-in navigation on Chromium 156.0.8078.4 and WebKit 27.2.
Each emits one event with the appropriate null/non-null transition; WebKit's
event is untrusted and targets Document. Both observed transition runs place
updateCallbackDone reactions and handler microtasks before ready reactions,
and ready before the following animation frame. Firefox 157's default build
does not expose the event. Its feature-gated implementation agrees with HTML's
target/trust and uses a microtask boundary around activation.

Source evidence: Blink's
[rendering sequence](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/page/page_animator.cc),
Gecko's [Document::Reveal](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/Document.cpp),
and WebKit's [Document::reveal](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/dom/Document.cpp).
WebKit also suppresses revelation while a replacement loader is provisional;
the future rendering caller must audit that additional selection policy. This
slice implements HTML's callable algorithm without adding a pending-load gate.

Explicit remaining dependencies:

- `Document.resolveInboundCrossDocumentViewTransition()` throws until CSS
  implements outbound opt-in updates, transferred parameters, active-transition
  checks, @view-transition rule/type resolution, and incoming transition/promise
  allocation. CSS updates opt-in even with no incoming parameters; returning
  null unconditionally would silently omit required work.
- `ViewTransitionImpl.activate()` throws until CSS supplies skipped/done state,
  rendering suppression, geometry/capture, pseudo-elements/styles, animation,
  and ready settlement. Event listeners may skip or modify the transition;
  that state belongs to the future CSS implementation, not to HTML's caller.
- WindowRenderingController already has the ordered `reveal` phase, but production
  composition must connect it after the CSS prerequisite. Real rendering
  opportunities, visibility/suppression filters, layout/display, and cached-frame
  presentation remain with rendering. The provisional loader does not fire this
  event as a substitute for that first rendering update.

The reveal flag changes before the explicit resolution failure, following the
written order; a throw is not successful revelation or a retry mechanism.
No callable-shape change needs review. Next is **§7.4.6.4, scrolling to a fragment**.

Validation: the reveal, PageRevealEvent, and retained-Document reactivation
suites pass all 30 cases on Node 24.19.0, 26.8.1, and custom 27, with and without
the addon. The existing rendering-producer suite passes its 12 cases on Node 24
with the addon. Typechecking, type contracts, changed-file ESLint, import
hierarchy, and whitespace checks pass. No failure classifications changed and
no native artifacts were rebuilt. Stale persisted-state references to §7.4.6.3
were corrected to §7.4.6.5; that work is still explicitly unfinished.

## HTML §7.4.6.4: fragment selection and target state

The [fragment algorithms](https://html.spec.whatwg.org/multipage/browsing-the-web.html#scrolling-to-a-fragment)
were audited against HTML `a7f6aed` on 4 November 2026. This bounded slice
implements the HTML selector and the target-state portion of scrolling:

- `Document.selectIndicatedPart(url)` first checks URL equality excluding the
  fragment. Empty fragments select the top sentinel; otherwise raw ID/name
  matching precedes percent-decoding and UTF-8 decoding without BOM removal.
  A decoded ASCII-case-insensitive `top` is special only after element lookup.
- The private potential-element lookup prefers the first ID in tree order,
  then the first HTML `a` with the matching unnamespaced `name`. Ordinary
  Document traversal excludes shadow trees and template contents. IDs on SVG
  elements in an HTML Document remain eligible; SVG anchor names do not.
- `Document.indicatedPart` uses that operation for HTML Documents. An absent
  fragment identifies no part; non-HTML fragment rules remain a throwing owner.
- `scrollToFragment()` clears the target for no match. For the top sentinel it
  clears the target before calling the existing viewport-scroll operation.
  For an element it retains the selected identity before the explicit remaining
  revealing/scroll/focus boundary. A throw is not successful scrolling.

`Document.targetElement` starts null and supplies Selectlet and Stylelet through the existing
DOM adapter's optional `targetElement` operation. The regression first failed
with **two matches instead of zero** for duplicate IDs before fragment processing
had selected a target. The old URL comparison also could not preserve selection
after History or ID changes, match a named anchor, or select just the first duplicate.
The new integration reads the retained identity in both matchers; providers without that operation
keep their existing URL approximation, explicitly documented as incomplete.
The follow-up Stylelet regression reproduced the same two incorrect matches
before selection. It reuses a compiled selector through selection, URL/ID changes,
and clearing, while checking the stylesheet specificity and DOM-query result.

### Browser evidence and choices

`node-compat/experimental/fragment-selection.mjs` runs real HTTP Document loads
on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on raw
matching before decoding, IDs before names, the first duplicate, decoded UTF-8
replacement characters and a preserved BOM, real `top` elements, and excluding
shadow/template contents. All retain `:target` after `history.replaceState()`
and after changing the target's ID. An absent fragment selects no CSS target.

`SPEC_CLASH(fragment-quirks-anchor-name)` follows Eric's approved HTML/Firefox
choice: legacy names remain case-sensitive in quirks mode. Chromium/WebKit
accept case-insensitive names there. Blink's source records legacy compatibility
and usage measurement in its comments; WebKit explicitly notes the absent spec
rule. Standards mode agrees in all three.

`SPEC_GAP(fragment-null-selection)` records HTML's missing null branch: its URL
fragment is nullable, but selection passes it to string-only lookup/decoding.
Returning null agrees with the preceding indicated-part definition and the
browser probe; null is not the empty fragment's top sentinel.

Sources: Blink's [TreeScope lookup](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/dom/tree_scope.cc)
and [fragment anchor](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/page/scrolling/element_fragment_anchor.cc),
Gecko's [target lookup](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/nsContentUtils.cpp)
and [PresShell](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/layout/base/PresShell.cpp),
and WebKit's [TreeScope](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/dom/TreeScope.cpp).

### Remaining owners

- HTML §6.9.2 ancestor revealing: closed details and hidden-until-found ancestors,
  `beforematch`, and reentrant mutation checks. The element branch stops before
  this work rather than pretending the DOM is already revealed.
- CSSOM View: scroll to the beginning, or scroll the target into view with
  `auto`, `start`, and `nearest`. Viewport/scroll-box geometry, ongoing smooth
  scrolling, and scroll events remain absent.
- HTML §6.6: focusing steps with the Document viewport fallback, then moving
  the sequential focus navigation starting point. No fragment-specific focus
  approximation is added. Gecko's source notes the unresolved ordering question
  in [HTML #7759](https://github.com/whatwg/html/issues/7759); revisit it when
  these shared owners exist.
- MIME-specific fragments, including RFC 7303 XML rules and SVG view syntax,
  remain separate from HTML selection. Text-fragment directives also require
  their navigation/MIME integration; this slice does not implement them.
- Rendering must invalidate styles/layout when target selection changes. Queries
  already observe the retained target. Loading retries retain the explicit
  `isUserInterestedInFragmentScrolling()` dependency.

No callable-shape change needs review. The next document-order subsection is
**§7.4.6.5, persisted history entry state**; fragment scrolling is not complete
until the cross-section owners above are supplied.

Validation: 105 cases across the fragment-target, loading-retry, fragment-navigation,
NavigateEvent interception, and finishing suites pass on Node 24.19.0, 26.8.1,
and custom 27, with and without the addon. The existing Selectlet host suite
passes 12 cases on Node 24 with the addon. Typechecking, type contracts,
changed-file ESLint, import hierarchy, and whitespace checks pass. No failure
classifications changed and no native artifacts were rebuilt.

Follow-up: the Stylelet consumer regression and existing stylesheet/DOM matcher
suites pass all 60 cases on Node 24 with the addon. The new case uses the
Document's actual Stylelet context; no extra target state or matching cache is introduced.

## HTML §7.4.6.5: persisted history entry state

Audited [persisted history entry state](https://html.spec.whatwg.org/multipage/browsing-the-web.html#persisted-user-state-restoration)
against HTML `a7f6aed` on 4 November 2026. This slice supplies restoration policy
without inventing scroll boxes or a saved-position format:

| Algorithm/state | Current implementation and boundary |
| --- | --- |
| Save persisted state | `SessionHistoryEntry.savePersistedState()` still throws before capture. Both auto and manual entries must save positions: the restoration mode does not waive capture. Viewport and other region identity/positions need layout; navigable containers are excluded because children have their own entries. |
| Restore persisted state | Check the entry's mode first. In auto mode, use the entry's current Document and that Document's relevant Window/Navigation. Restore only when normal restoration is not suppressed. Manual mode and suppressed restoration return without pretending to move anything. |
| Optional persisted user state | Remains null. Browlet does not currently select the optional form-value/directionality capture policy. Future restoration must avoid input/change events and honor form-associated custom elements' formStateRestoreCallback. Those form owners remain explicit source dependencies. |
| User scrolling | `Document.hasBeenScrolledByUser` starts false. The lower-level restoration operation returns when it is true, leaving the flag unchanged. Actual user input must produce it; synthetic scroll events and scripted scrolling do not establish that input. |
| Restore scroll position data | Require the entry's populated Document, check the user-scroll guard, then retain the throwing layout dependency. The null placeholder is not interpreted as an empty successfully restored snapshot. Optional retries and scroll anchoring remain with layout/input integration. |

The entry follows DocumentState replacement rather than retaining its construction
environment or another Window's Navigation. Missing Documents/Windows are internal
precondition errors when the auto path actually needs them. Manual mode does not
consult that unused state. No callable shape changed.

The focused tests first failed because the old blanket stub threw even for manual
or suppressed restoration. Real Document history-update tests now complete in
manual, suppressed, and user-scrolled cases, while the ordinary automatic case
still reaches the explicit missing scroll operation after its history events.
The existing NavigateEvent path continues to call the lower-level scroll operation
directly; it does not reapply the automatic-restoration gates.

### Browser evidence and approved choices

The HTTP probe `node-compat/experimental/history-scroll-restoration.mjs` saves
the first entry at y=250, pushes a second entry at y=650, then traverses back.
For interception it holds the handler pending with manual scroll/focus behavior,
reads the position after commit, and finally calls `NavigateEvent.scroll()`.

| Observation | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
| --- | --- | --- | --- |
| Ordinary auto traversal | 250 | 250 | 250 |
| Ordinary manual traversal | 650 | 650 | 650 |
| Intercepted auto entry, before explicit scroll | 650 | 250 | 650 |
| Intercepted manual entry, before explicit scroll | 650 | 650 | 650 |
| Explicit scroll, auto entry | 0 | 250 | 250 |
| Explicit scroll, manual entry | 0 | 0 | 650 |

`SPEC_CLASH(history-scroll-interception)` follows the approved HTML rule and
Chromium/WebKit's delayed restoration. Firefox restores its auto entry before
the held handler finishes. Gecko sets the suppression flag in
[Navigation.cpp](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/navigation/Navigation.cpp),
but the inspected same-document position-update path in
[nsDocShell.cpp](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/docshell/base/nsDocShell.cpp)
checks History's mode without that flag.

`SPEC_CLASH(history-explicit-scroll-manual)` preserves the approved HTML/Blink
separation: explicit NavigateEvent scrolling bypasses History's manual mode and
normal-restoration suppression, while still respecting user scrolling.
[Blink's explicit path](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/navigation_api/navigate_event.cc)
deliberately requests auto restoration. WebKit's
[NavigateEvent](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/NavigateEvent.cpp)
instead enters [HistoryController](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/HistoryController.cpp),
which still honors manual mode. The zero positions in Chromium and Firefox's
manual case are observed results, not adopted saved-position behavior; actual
position capture/restoration needs its own integration tests once layout exists.

### Remaining dependencies and stopping point

Scroll-position data remains the existing null-only placeholder. There is no
region identifier/coordinate format, viewport or element measurement, restore
attempt, retry scheduler, or scroll-anchoring integration. A fresh zero offset
or empty list would conceal those dependencies. Form persistence also remains
unimplemented, as the optional capture policy has not been selected.

The input/scroll producer must set the user-scroll flag only for actual user
scrolling. HTML §7.5.9 resets it during unloading, before unload cleanup; that
reset is now named in the unloading stub. Same-document lifetime still needs
the input/layout audit: Blink resets its initial-scroll marker on non-pushState/
replaceState same-document navigation, while HTML names its reset in unloading.
Do not connect a permanent input latch or clear the flag on every restoration
attempt. The guard is implemented, but its producer/reset lifecycle is not.

This reaches the document-order boundary before **§7.5, Document lifecycle**.
It does not complete physical scroll restoration or end-to-end history traversal.

Validation: the seven focused suites pass all 123 cases on Node 24.19.0,
26.8.1, and custom 27, each with and without the addon. TypeScript and generated
platform checks, declaration contracts, changed-file ESLint, import hierarchy,
and whitespace checks pass. No failure classifications changed and no native
artifacts were rebuilt.

## HTML §7.5.1: Window selection and environment inputs

The first Document-lifecycle slice audits shared creation steps 1–7 against
[HTML's creation algorithm](https://html.spec.whatwg.org/multipage/document-lifecycle.html#initialise-the-document-object),
source `a7f6aed` (4 November 2026). This algorithm creates incoming Documents;
initial about:blank creation remains the separate §7.3.2.1 operation.

`Navigable.createAndInitializeDocument()` retains its existing ownership and
signature. It obtains the response's browsing context, creates enforced and
report-only Permissions Policies, selects request-current-URL or response URL,
then reuses only the eligible initial Window or allocates a new Window/realm.
The existing group lookup accounts for Browlet registering top-level contexts
in the group while child contexts reach it through their containing traversable.

The regressions exposed two incorrect inputs to that existing machinery:

- A child or grandchild Window received its own creation URL/origin as its
  top-level metadata, overriding the correct inherited reservation fields.
  New Windows now take those fields from the container's relevant environment;
  top-level Windows still use the incoming creation URL and origin. The tests
  also check the resulting network-partition key.
- Late local-route preparation allocated a reserved environment even when
  final synthetic params deliberately supplied null. Completed params now
  bypass that adapter before allocation. Window setup handles null itself;
  there is no synthetic reservation or transfer of a fabricated client ID.

Existing reservations still transfer ID, service worker, target browsing context,
and security classification through Window setup. Initial Window reuse neither
creates a Window nor consumes a reservation. A later same-origin Document gets
a new Window while retaining the browsing context's WindowProxy handle. Creation
does not activate the new Document. Tests include the real srcdoc params producer.

Browser source corroborates the retained initial-Window rule:
[Blink's ShouldReuseDOMWindow](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/loader/document_loader.cc),
[Gecko's WouldReuseInnerWindow](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/nsGlobalWindowOuter.cpp),
and [WebKit's FrameLoader](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/FrameLoader.cpp)
limit ordinary reuse to the initial Document and an origin-access check.
Their extra isolation/credentialless conditions are not new choices in this slice;
COOP group changes keep their existing owner. This is source evidence, not a new
live-browser probe or a claim that their complete reuse rules coincide.

### OAC without a reservation

`SPEC_GAP(document-oac-null-reservation)`: step 7 reads the reserved environment's
security classification, but supplied-response navigation permits null. HTML's
security definition requires an environment and supplies no replacement input.
The approved correction uses `UserAgent.computeWindowSecureContext()` with the
incoming selected origin and optional embedding `WindowEnvironment`. That is the
environment of the Document containing the child navigable's container, such as
an iframe; a top-level Window has no embedding environment, even with an opener.
UserAgent owns the trust calculation; the environment base stores its fixed result.
Window initialization, Fetch reservations, and provisional local response
preparation now share that same calculation. An existing reservation's fixed
decision takes precedence, even if current origin or ancestry checks disagree.

The result gates the OAC request before the browsing context group's historical
origin-keying decision is consulted. It neither creates a Fetch reservation nor
inherits the departing Window's security flag. The chosen origin matters for
inherited about:blank; the parent's fixed classification carries the complete
ancestry check, including an insecure intermediate ancestor. The separate,
previously approved `secure-context-top-level-url` choice remains unchanged.

`SPEC_CLASH(document-oac-insecure-ancestor)`: retain HTML's secure-context gate.
Live probes on 4 November 2026 found Chromium 156.0.8078.4 and Firefox 157.0
honor `Origin-Agent-Cluster: ?1` for an HTTPS child beneath an insecure HTTP
parent, although both report `isSecureContext === false`. WebKit 27.2 rejects
the request, matching HTML. All three honor it on ordinary HTTPS pages and
reject it on non-loopback HTTP pages. WebKit's
[September 30 correction](https://github.com/WebKit/WebKit/commit/cd3abe0e663eff9880a5d076737d6ed797754488)
identifies origin-only gating as the bug; [WPT #63109](https://github.com/web-platform-tests/wpt/pull/63109)
adds insecure-parent coverage. Its
[October 6 follow-up](https://github.com/WebKit/WebKit/commit/d0aabe7a8b228b18ad5b8e2005e705e9db2302ca)
passes an explicit security decision into OAC/COEP/DIP parsing. That supports
sharing the calculation rather than having each header infer trust separately.

Normal srcdoc and javascript: synthetic responses carry no OAC header. Later
multipart parts are a specified supplied-response caller with null reservation;
the multipart loader itself remains unfinished. WebKit's streamed two-part probe
retains the outer response's cluster decision despite conflicting part headers.
Chromium/Firefox produced no part observations in this probe, so their multipart
behavior is inconclusive. Independent Browlet regressions retain the group's
existing decision when a later same-origin response requests the opposite value.

Before the correction, all 11 added cases failed at the explicit null-reservation
guard. They cover the actual supplied-response producer, secure/insecure/local
origins, parent and intermediate-ancestor security, inherited origins, configured
trust, departing-Window separation, and historical cluster choice. The existing
reservation cases now also make their captured decision disagree with a fresh
origin check in both directions.

### Remaining shared-creation work

| Steps/owner | State and next boundary |
| --- | --- |
| Local response preparation | `#prepareResponsePolicy()` still completes unfinished local-route params. Move that work into the local producer before removing the adapter; final Fetch/srcdoc/supplied-response params already bypass it. |
| 8–10: Document fields and Window association | Audited below: incoming state is fresh even when the initial Window is reused, and association precedes loader callbacks without activating the Document. Cookie-URL producer/history inputs and the public registry API remain separate dependencies. |
| 11–14: ancestry, CSP, referrer | Audited below: captured iframe policy and known container initialize ancestry before activation; CSP applies to the incoming Document; referrer consumes Fetch's resolved value. Existing masking/null-request choices remain. CSP's unspecified style-src initialization and Console output remain explicit dependencies. |
| 15–16: Navigation Timing | Controller-backed creation selects redirect counts using HTML's taint/client/referrer/TAO rule. All shared-factory Documents expose destination metadata and buffer the entry before callbacks, using zero unavailable fetch phases/transfer size without a controller. Target-history diagnostics arrive before activation; child entries retain null. Load completion notifies observers without reinsertion. Initial about:blank intentionally has no entry. Missing producer timing, unload/Critical-CH producers, and diagnostic lifecycle callers remain explicit. |
| 17–20: response headers | Step 17 performs Refresh decoding, shared parsing, admission, and HTTP load-relative scheduling. Ordinary dispatch retains navigation's transient-activation dependency; meta insertion timing remains unfinished. Invalid inputs do not block Document creation. Speculation-Rules throws when present. Early Hints producer processing throws; its retained commit callback is invoked. HTML pre-media Link processing remains a marked no-op, distinct from the implemented CSSOM stylesheet-Link consumer. Their remaining algorithms and ordering need separate slices. |
| 21: deferred Fetch quota | The existing `potentiallyFreeDeferredFetchQuota()` consumer is connected; full deferred-fetch request/lifetime integration retains its Fetch owner. |
| §§7.5.2–7.5.11 | HTML production parser/script setup, other Document loaders, finish/unload/destruction/abort coordination remain separate bounded slices. Window allocation does not complete those operations. |

Validation: eight creation, reservation, lifecycle, and policy suites contain
334 cases, including 22 focused Window-selection/OAC cases. All 334 pass with
the addon on Node 24.19.0, 26.8.1, and custom 27. Each stock run has 331 passes
and the same three existing native-global expected failures. TypeScript/generated
platform checks, declaration contracts, changed-file ESLint, import hierarchy,
and whitespace checks pass. No failure classification or native artifact changed.

## HTML §7.5.1: Document initialization and association

Creation steps 8–10 already initialize the incoming Document at the correct
owner, so this slice adds audit coverage without changing the algorithm.
The selected origin, policies, sandbox flags, request/response URL, redirect
taint, navigation ID, about-base URL, and timing inputs enter the new Document
before its Window association and the later header-processing callbacks.
The operation creates an unparsed, loading Document; history activation and
WindowProxy retargeting remain the later commit's responsibility.

Four added cases cover HTML/XML creation with both a reused initial Window and
a new Window. They check projected Document state from the Early Hints commit
callback, fresh timing and registry identities, type-dependent element naming,
and the unchanged state of a retained old Document. Existing creation/lifecycle
and policy tests cover the other navigation inputs. No new browser disagreement
or callable-shape change was introduced.

The remaining dependencies are explicit at their owners:

- `NavigationParams.startTime` retains the approved
  `SPEC_CLASH(html-navigation-response-timing)` correction: Fetch's controller
  owns full timing; supplied responses retain their supplied start time.
  Initializing the Document's load-timing record does not implement the public
  Navigation Timing entry or its filtering/buffering dependencies.
- `NavigationParams.cookieURL` selects the value copied into the Document.
  Blank/srcdoc producer inheritance and retained history inputs still need
  implementation; the existing javascript: producer captures its replacement
  source. This audit does not claim to complete [HTML issue #332](https://github.com/whatwg/html/issues/332).
- `CustomElementRegistryImpl` supplies a fresh identity and definition state.
  Public registry methods, Window exposure, upgrade and reaction processing
  remain in the [custom-elements roadmap](../../dom/nodes/html/custom-elements/ROADMAP.md).

Shared creation steps 11–14, ancestry lists, CSP initialization, and referrer
initialization, are audited in the following slice. Header processing,
Navigation Timing, and loading/activation consumers remain outside this slice.

Validation: the same eight creation, reservation, lifecycle, and policy suites
now contain 338 cases, including 26 focused creation cases. All 338 pass with
the addon on Node 24.19.0, 26.8.1, and custom 27; each stock run has 335 passes
and the same three existing native-global expected failures. TypeScript/generated
platform checks, declaration contracts, changed-file ESLint, import hierarchy,
and whitespace checks pass. No failure classification or native artifact changed.

## HTML §7.5.1: Document ancestry, CSP, and referrer initialization

Shared creation steps 11–14 already invoke the correct Document operations in
order. The audit uses HTML source `a7f6aed` and refreshed CSP source `251d288`
(4 November 2026); it adds integration coverage and dependency notes without
changing runtime behavior or introducing a new callable shape.

| Step | Verified contract |
| --- | --- |
| 11–12: ancestor lists | Use the destination container's node Document and the captured iframe referrer policy, even when the attribute later changes. Create fresh nearest-first lists before activation while retaining the old Document's snapshot. The reviewed `ancestor-origins-before-activation` and `ancestor-origin-policy-masking` choices remain. |
| 13: CSP | Window association already selects the incoming policy container. Insecure-request inheritance runs first; enforcing response directives add their targets without changing the context's inherited policy. Report-only/absent directives do not retain the departing Document's own upgrade policy when the initial Window is reused. An inherited CSP self origin survives a sandboxed srcdoc Document's opaque origin. |
| 14: referrer | Consume the request's already-resolved URL or no-referrer value, without applying the response's policy to it again. A null request leaves the fresh Document's default empty string. An unresolved client referrer remains an explicit input error, and later request mutations do not alter the retained string. |

Fifteen new creation cases reach these operations through the real navigation
parameter/Document owners. Early Hints commit callbacks verify the incoming
state before activation; no parser or network wait is simulated to establish
that ordering. Existing ancestor-origin, CSP initialization, upgrade inheritance,
target-snapshot, and Fetch referrer tests retain the detailed owner coverage.

Dependencies remain explicit:

- `SPEC_GAP(csp-style-src-initialization)` is now marked in `CSPList` and its
  [roadmap](../policy/csp/ROADMAP.md#current-implementation). CSP's style-src
  initialization has no executable CSSOM steps yet. Its separate prose gates
  CSSOM string parsing on `unsafe-eval`, unlike all three browsers in the live
  probe; `SPEC_CLASH(csp-style-src-cssom-eval)` records that distinction.
  Existing CSSOM writes stay available, while Fetch and inline-input checks
  remain. This audit does not install a restriction from the unfinished hook.
- CSP parser warnings reach `env.reportConsoleWarning()`, whose Console Printer
  and output sink are still provisional. Initialization does not fabricate
  author-console or Node-console output.
- Automatic iframe/frame/object/embed lifecycle callers remain unfinished.
  The existing container links and initialized ancestor lists do not complete
  their insertion/loading/removal algorithms. Stale HTML audit notes describing
  the container getter as a throwing stub have been corrected.
- Fetch owns incoming referrer selection; initial about:blank's creator referrer
  is a separate creation algorithm. The approved empty referrer for a synthetic
  javascript: replacement remains unchanged.

Next: steps 15–16, Navigation Timing input selection and the explicit entry
creation/filtering dependencies, before the remaining response-header steps.

Validation: seven focused creation/lifecycle, ancestry, CSP, upgrade, target
snapshot, and referrer suites contain 202 cases, including 41 creation cases.
All 202 pass with the addon on Node 24.19.0, 26.8.1, and custom 27; each stock
run has 199 passes and the same three existing native-global expected failures.
TypeScript/generated platform checks, declaration contracts, changed-file
ESLint, import hierarchy, and whitespace checks pass. No failure classification
or native artifact changed.

## HTML §7.5.1: Navigation Timing input selection

Steps 15–16 now select controller-backed inputs in
`Document.createNavigationTimingEntry()`. The operation captures HTML's permitted
redirect count, delegates the destination-origin TAO check to Fetch, and retains
response-selected service-worker timing and cache classification alongside the
existing live Fetch/body/Document records. It also retains the previous-Document
unload record, whose producer is still unfinished. A supplied controller requires
the request that produced it. No extra timing extraction or second entry is
created, and filtering the count does not mutate shared Fetch timestamps.

The approved `SPEC_CLASH(navigation-redirect-count)` follows HTML rather than
Firefox's blanket cross-origin suppression, WebKit's same-origin no-referrer
suppression, or Chromium's missing clientless exception. The
[Performance roadmap](../../performance/ROADMAP.md#html-751-timing-input-selection)
records live browser versions/results, source evidence, and the reproducible
probe. Tests independently cover those privacy branches and retain the selected
count before Early Hints callbacks, without allowing later request changes to
rewrite it. A real Fetch path through a controlled HTTP transport verifies an
out-and-back redirect chain with and without the second hop's authorization.

This is the bounded controller-input slice, not completion of Navigation Timing.
HTML source `a7f6aed` still duplicates the entry-creation call, uses removed
response timing and out-of-scope variables, and omits required consumer arguments.
`SPEC_CLASH(html-navigation-response-timing)` and open
[PR #12890](https://github.com/whatwg/html/pull/12890) record those corrections.
The Performance detour now supplies realm-owned navigation entry construction,
destination response exposure, cache-mode conversion, available diagnostic
allocation, buffering, and load-event observer delivery. History population now
forwards the final target state's masked diagnostics before Document activation;
the [handoff audit](../../performance/ROADMAP.md#restoration-diagnostics-handoff)
records the missing specification input and child/redirect boundaries. Critical-CH
restart measurement, previous-Document unload, and diagnostic lifecycle callers
remain explicit consumer dependencies. Synthetic and supplied-response
navigation now use the [approved fallback](../../performance/ROADMAP.md#navigation-timing-creation-without-a-fetch-controller):
Document URL, retained response data, and zero unavailable fetch phases/transfer
size. Initial about:blank intentionally has no entry, following HTML/WebKit and
Navigation Timing issue #155; the [initial-blank audit](../../performance/ROADMAP.md#initial-aboutblank-is-a-separate-creation-path)
records the approved browser disagreement and initial-Window reuse regressions.
Original fetch timing for supplied network responses and synthetic-loader
completion remain explicit dependencies.

Validation: 18 added cases cover count selection, retained inputs and callback
ordering, the required request, and the real Fetch redirect handoff. Four
focused Document-creation, navigation-params, loader, and Fetch-TAO suites contain
81 cases, all passing on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, with and
without the addon. TypeScript/generated declarations, declaration contracts,
changed-file ESLint, import hierarchy, and whitespace checks pass. No new
expected failures, skips, or native artifacts were introduced.

The current detour implements [Performance Timeline](../../performance/ROADMAP.md#performance-timeline-entries-buffers-and-synchronous-queries)
before continuing the timing consumers. Its base entry, per-global buffers, and
synchronous queries, observer registration/replay/delivery, resource production,
and shared-factory navigation creation/delivery now exist. See the
[delivery audit](../../performance/ROADMAP.md#navigation-timing-load-event-delivery)
for single insertion, buffered replay, and the still-provisional loader's missing
initial pageshow, BiDi load-complete notification, and parser task sequencing.
Navigation Timing §8.1's legacy `performance.timing` now reads the retained
measurements, with its additional `domLoading` observation during Document
initialization. §8.2's [legacy navigation view](../../performance/ROADMAP.md#navigation-timing-legacy-performancenavigation)
now exposes the Document's type and strict same-origin redirect count. Ordinary
fragment commits reset only the legacy type; retained-Document restoration,
History state updates, and intercepted commits preserve it. A newly created
Document receives its navigate/reload/back-forward classification during §7.5.1.
The bounded timing detour is ready to return to HTML; its unfinished producers
remain with their named lifecycle, loader, worker, and host owners.
The following slice resumes HTML at §7.5.1 step 17. Steps 18–20 retain their
remaining response-header and callback-ordering audit.

## HTML §7.5.1: Refresh input preparation

Step 17 now calls `Document.processRefreshHeaders()` instead of rejecting every
response containing Refresh. Fetch's byte-string representation already supplies
the isomorphic decoding. The Document-owned shared operation implements
[§4.2.5.3's input parsing and admission](https://html.spec.whatwg.org/multipage/semantics.html#shared-declarative-refresh-steps),
steps 1–12: integer delays, discarded fractions, separators, optional URL prefixes,
quoted/unclosed targets, encoding-relative URL parsing, javascript rejection, and
the `willDeclarativelyRefresh` flag. Delay values stay exact nonnegative bigints
for the later scheduling owner; no native timeout conversion occurs in the parser.

The focused regression first failed because a malformed Refresh field threw from
`createAndInitializeDocument()`. Malformed and javascript inputs now leave the
admission flag false and allow the remaining initialization callbacks to run.
Accepted input sets the flag before calling
`Document.scheduleDeclarativeRefresh(seconds, url, meta?)`. This is the extracted
step-13 continuation, not another standard algorithm; its HTTP scheduling is
implemented in the following slice. The optional meta source
is retained for its future timing/sandbox checks; processing does not reread its
node Document after admission.

The HTML checkout was refreshed to `5955a33` on 2026-11-06. The same-day HTTP/meta
probe used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved:

- `SPEC_GAP(refresh-repeated-fields)` / `SPEC_CLASH(refresh-repeated-fields)`:
  [HTML issue #2900](https://github.com/whatwg/html/issues/2900) still gives no
  resolution for repeated fields. Use Fetch's comma combination, like Chromium
  and Firefox for nonempty fields. WebKit takes the last field; Firefox also
  ignores an empty first field. Thus two valid URL directives can produce one
  target containing the second directive; do not silently select a field.
- `SPEC_CLASH(refresh-closing-quote)`: keep HTML/Firefox/WebKit's first matching
  closing quote. Chromium uses the last matching quote.
- `SPEC_CLASH(refresh-empty-url)`: distinguish absent targets from explicit empty
  targets. An absent target keeps the Document URL; an empty target resolves
  against its base, matching HTML/Firefox. Chromium/WebKit use the Document URL
  for empty targets too. The base difference is observable with meta inputs;
  response-header parsing precedes body-created base elements.
- `SPEC_CLASH(refresh-url-encoding)`: use the Document encoding at processing
  time. Headers are processed before body decoding while the Document starts as
  UTF-8; Firefox/WebKit produce that result, whereas Chromium uses the response's
  legacy charset. For meta refresh in an established Windows-1252 Document,
  Chromium/WebKit use that encoding and Firefox uses UTF-8. Keep HTML's existing
  `encodingParseURL()` operation at both call sites.
- `SPEC_CLASH(refresh-first-valid)`: follow HTML's first-valid admission flag.
  All three browsers permit a later zero-delay meta refresh to replace an earlier
  header or meta refresh in the probe. Full replacement/priority policies have
  additional scheduling rules; this slice does not adopt them.

Experimental's `document-refresh.mjs` and `DOCUMENT-REFRESH.md` preserve the probe.
The [Blink parser](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/network/http_parsers.cc),
[Gecko parser](https://github.com/mozilla/gecko-dev/blob/master/docshell/base/nsDocShell.cpp),
and [WebKit parser](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/parser/HTMLParserIdioms.cpp)
support the observed quote/encoding differences. The Extractlet capture of #2900
was complete and supplied no capture warnings.

The input-preparation slice stopped at scheduling. The following slices connect
HTTP Refresh and meta insertion, including its timing and sandbox check. Window
timeout waits count fully active time and are not substituted for this algorithm.
Speculation-Rules, Early Hints production, and HTML's pre-media Link phases remain
separate unfinished owners.

Validation: the new 37-case suite covers malformed-header recovery, ordinary and
fractional input, huge exact delays, incomplete prefixes, quoted and empty URLs,
base/encoding selection, admission, duplicate fields, and initialization ordering.
Nine affected Document-creation, navigation-params, loader, load-status, timing,
and base-URL suites contain 174 cases; all pass on Node 24.19.0, 26.8.1, and custom
27.0.0-pre, with and without the matching addon. TypeScript/generated declarations,
declaration contracts, changed-file ESLint, import hierarchy, and whitespace checks
pass. No new expected failures, skips, or native changes were introduced.

## HTTP Refresh scheduling

The Document retains the accepted target and exact delay. Complete loading starts
the wait; processing after loading uses the already recorded timestamp. The
existing UserAgent TimerHost supplies wake-ups, and every wake-up rechecks the
deadline. Node's host already bounds individual native timeouts. A due refresh
queues a navigation-and-traversal task associated explicitly with the captured
Document, even if its Window has since been reassociated. Zero-delay refreshes
also queue instead of navigating inside a load handler or initialization callback.

`cancelDeclarativeRefresh()` removes the pending timer or task without resetting
first-valid admission. Document abortion, destruction through abortion, and
unsalvageable unloading cleanup call it. Canceled wake-ups cannot revive work,
and event-loop task disposal releases the pending state. Existing Document task
runnability prevents delivery against a replacement Document; it permits a held
task when the same Document becomes active again. That verifies task ownership,
not a completed bfcache pause/restart policy.

The 2026-11-06 probe used Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2:

| Case | Chromium | Firefox | WebKit | Browlet choice approved by Eric |
| --- | --- | --- | --- | --- |
| Slow load, then one-second Refresh | About one second after load | Same | Same | Document load-relative deadline |
| Same current URL | Reload | Reload | Reload | Existing reload operation |
| Distinct target, zero/one seconds | Replace | Replace | Reports push | HTML replacement |
| Distinct target, two seconds | Push | Replace | Reports push | HTML replacement |
| Changed fragment | Push, same Document | Replace, same Document | Push, same Document | HTML replacement |
| stop() after load, before deadline | Cancels | Cancels | Still refreshes | Cancel on Document abortion |
| Loaded child with a still-loading parent | Refreshes before parent load | Same | Waits for parent | Child Document's deadline |
| Child removed before deadline | No navigation | No navigation | No navigation | Document teardown cancels |

These are Navigation API event observations; WebKit's event type does not prove
that its eventual back/forward-list behavior is also push. Its scheduler separately
locks that list for short delays. The probe cancels the navigation event so it can
inspect dispatch without entering a replacement Document.

- `SPEC_CLASH(refresh-same-url-reload)`: HTML's shared algorithm calls ordinary
  replacement navigation even for the current URL. Follow all browsers' reload
  classification through the existing reload owner, including cancellation.
- `SPEC_CLASH(refresh-history-replacement)`: retain HTML's replacement rule for
  every other target and delay. Blink switches after one second, Gecko's source
  uses a 15-second threshold, and WebKit has separate list-lock/event decisions.
- `SPEC_CLASH(refresh-abort)`: follow Chromium/Firefox on cancellation after stop.
  The public stop/recursive-abortion owner still throws; it must eventually reach
  the implemented Document abortion hook, not another independent Refresh flag.
- `SPEC_CLASH(refresh-ancestor-loading)`: follow HTML/Chromium/Firefox's local
  deadline. WebKit's `ScheduledRedirect::shouldStartTimer()` waits for ancestors.
- `SPEC_CLASH(refresh-large-delay)`: retain HTML's full integer delay. Blink and
  WebKit source reject delays above `INT_MAX / 1000` seconds; Gecko checks its
  unsigned millisecond conversion. Those long-delay limits are source evidence,
  not multi-day live measurements. Browlet keeps an exact deadline and passes a
  finite, bounded numeric request to the host, without rounding the accepted delay.
- `SPEC_GAP(refresh-task-source)`: HTML does not identify delayed dispatch's task
  source. Use the existing navigation-and-traversal source and its Document gate.
  Blink uses its internal-loading runner; Gecko and WebKit dispatch through their
  document-loader timer/navigation machinery.

Sources: [shared refresh steps](https://html.spec.whatwg.org/multipage/semantics.html#shared-declarative-refresh-steps),
[Blink scheduler](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/loader/http_refresh_scheduler.cc),
[Gecko DocShell](https://github.com/mozilla/gecko-dev/blob/master/docshell/base/nsDocShell.cpp),
[WebKit scheduler](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/NavigationScheduler.cpp).
Experimental's `refresh-scheduling.mjs` and `REFRESH-SCHEDULING.md` retain the probe.

The meta follow-up below supplies the captured insertion timestamp and
automatic-features check. **Explicit dependencies:** host preferences/manual
redirect UI, complete parser load-event accounting, recursive abortion/destruction,
and full bfcache Refresh policy retain their existing owners. Most importantly, ordinary navigation
still calls the throwing `Window.hasTransientActivation()` through
`SourceSnapshotParams`. The new strict delivery regression observed that failure;
Eric approved retaining it as an expected failure. Enabled tests supply that one
activation result to verify real cancelable replacement/fragment events. Same-URL
reload reaches its cancelable event without that fixture. Downstream history,
unloading, and loading TODOs remain in the existing navigation/reload operations.

Validation: all eleven affected creation, loading, destruction, abortion, reload,
fragment, reactivation, timer, and Refresh suites pass across Node 24.19.0, 26.8.1,
and custom 27.0.0-pre, each with and without the matching addon. The final focused
scheduling suite has 21 passing cases and the one approved activation expected
failure in every configuration. TypeScript/generated declarations, declaration
contracts, changed-file ESLint, import hierarchy, and whitespace checks pass.
No native code or artifacts changed in this slice.

## Meta Refresh insertion and scheduling

HTML §4.2.5.3's Refresh state now enters the shared Document algorithm from the
ordinary insertion hook. `HTMLMetaElement` exposes its four current reflected
attributes through the existing binding machinery. A case-insensitive `refresh`
keyword is recognized without trimming, and absent/empty content is ignored.
Parser insertion, script insertion, and insertion of populated subtrees or
fragments use the same node hook. Detached and shadow trees are excluded.

The element records its Document-tree insertion time; admission copies that
timestamp, the parsed URL, and the exact delay into the Document's existing
pending Refresh state. The deadline uses the later of insertion and complete
loading. Removing, editing, reinserting, or adopting the meta does not change an
already accepted refresh. The eventual task checks the original Document's
`sandboxed-automatic-features` flag only for meta-originated work; HTTP Refresh
does not acquire that restriction. No new timer or scheduling owner was added.

The 2026-11-06 browser-only probe used Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2:

| Case | Chromium | Firefox | WebKit | Browlet |
| --- | --- | --- | --- | --- |
| Valid inserted meta, including a fragment | Refreshes | Refreshes | Refreshes | Refreshes |
| Change content/http-equiv after insertion; repair invalid content | Refreshes | No refresh | Refreshes | Insertion only |
| Whitespace-padded keyword or shadow-tree meta | Ignored | Ignored | Ignored | Ignored |
| Remove or adopt accepted meta into an inert Document | Original refresh remains | Same | Same | Original Document retains it |
| One-second refresh inserted after load | About 1009 ms after insertion | About 1002 ms | About 1006 ms | Later-of-insertion/load deadline |
| Sandboxed child, meta Refresh | Blocked | Blocked | Blocked | Blocked |
| Same child, HTTP Refresh | Allowed | Allowed | Allowed | Allowed |

`SPEC_CLASH(meta-refresh-attribute-changes)`: Eric approved HTML/Firefox's
insertion-only rule. Blink and WebKit reprocess when content/http-equiv changes;
Gecko calls `ProcessMETATag()` from `BindToTree()` and not from those attribute
changes. Reinsertion processes the new attributes if no prior valid directive was
accepted. The previously approved first-valid, history handling, and cancellation
choices still apply.

Sources: [HTML pragma directives](https://html.spec.whatwg.org/multipage/semantics.html#pragma-directives),
[shared Refresh algorithm](https://html.spec.whatwg.org/multipage/semantics.html#shared-declarative-refresh-steps),
[Blink HTMLMetaElement](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_meta_element.cc),
[Gecko HTMLMetaElement](https://github.com/mozilla/gecko-dev/blob/master/dom/html/HTMLMetaElement.cpp),
[WebKit HTMLMetaElement](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLMetaElement.cpp).
Experimental retains `meta-refresh-insertion.mjs` and `META-REFRESH-INSERTION.md`.

**Stopping point:** Refresh insertion and scheduling are connected. Other pragma
states (including meta CSP, default-style, and legacy content-language), metadata
name processing, and parser encoding declarations remain separate §4.2.5/§13
work; the element's hook explicitly covers only Refresh. The existing activation
expected failure is retained, with controlled-activation tests for projected
Navigation events. Complete recursive abortion/destruction, bfcache timer policy,
load-event accounting, and optional host UI remain at the owners listed above.
For §7.5.1, Early Hints production, pre-media Link processing, and Speculation-Rules
remain the next explicit response-initialization dependencies.

Validation: 17 affected suites pass with 311 passing cases and the one previously
approved activation expected failure on Node 24.19.0, 26.8.1, and custom 27.0.0-pre,
each with and without the matching addon. The scheduling suite includes 24 new
meta cases, including real parser insertion, projected Navigation events, and
delivery through Browlet's ordinary loader/host scheduler. TypeScript/generated
declarations, declaration contracts, changed-file ESLint, import hierarchy, and
whitespace checks pass. The Browlet package rebuild and CJS/ESM/platform-type
artifact checks pass on Node 26.8.1 stock and compat. No native changes were needed.

## Removal condition

Burn this file once all supported navigation kinds share the specified
history-step machinery and the public History/Navigation APIs exist.
