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
- `Navigable.findNavigableByTargetName()` searches the source subtree, its
  traversable, and then familiar contexts in the same group. `chooseNavigable()`
  uses it for existing named targets and coordinates new-target policy, activation
  consumption, COOP/noopener, creation, and sandbox bookkeeping. Activation lookup
  and sandbox permission remain explicit dependencies. Context familiarity checks
  active origins, live ancestry, and auxiliary openers. Named lookup limits that
  walk to the immediate opener; the
  [related-context audit](#html-7322-related-browsing-contexts) records its boundaries.
- `Navigable` prepares response policy inputs, selects the browsing context and
  Window/realm, and creates the destination document and history entry.
  `loadHTMLDocument()` starts HTML parsing with a supplied reader/script callback
  and coordinates completion or abortion; production setup remains explicit.
  Its bounded cross-document commit activates the entry; `Traversable` applies
  the history step and clears forward entries.
- `state/session-history.ts` models entries and nested histories for the active
  top-level traversable; `state/document-state.ts` retains their document/reload state.
- `not-restored-reasons.ts` owns the §7.2.8 diagnostic implementations and their
  backing records. Document and TopLevelTraversable have explicit throwing
  collection/filtering entry points; cache decisions and Navigation Timing
  exposure remain separate.
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
  parser scripts. Full history/reload/reactivation and pageswap producers remain
  unfinished; its [audit](./api/ROADMAP.md) records the remaining dependencies.
- `Traversable` owns its session-storage shed across Document replacements.
  Top-level creation clones the opener's top-level shed through the
  [Storage substrate](../../../storage/ROADMAP.md#storage-sheds), including
  the real auxiliary-context creation path.
  Final `UserAgent.removeTopLevelTraversable()` clears that traversable's session
  data after document teardown. Definite closing must reach this step only after
  unload cancellation and history/descendant destruction; those callers remain
  unfinished. Do not clear the session at close entry or Document destruction.
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
| Shared push/replace steps | Preparation, the public methods, and navigate-event firing are implemented below. `DocumentImpl.updateURLAndHistory()` remains an explicit dependency. |
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

This slice stops at those navigation owners. Reload retains the explicit
unfinished boundary described below. Delta traversal also throws before changing
history: source snapshotting, initiator capture, the traversal queue, and applying
the traverse history step are missing. Supplying a source denotes script
involvement (`none`); omitting it denotes `browser UI`. Target selection and the
out-of-range no-op must happen inside the queue, against then-current distinct
history steps. The History entry point therefore does not prefilter deltas using
its stored length or replace traversal with ordinary URL navigation. Applying
the step must supply sandbox permission, cancellation/unloading, document and
state restoration, history events, and scrolling.

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

This does **not** implement a successful state change yet. This slice introduced
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
effects remain explicit dependencies. Accepted History
changes still reach the explicit URL/history boundary.
`DocumentImpl.updateURLAndHistory()` independently remains unfinished: it must
update History and Navigation state and queue the same-document history steps.
Preparation tests observe unfinished owner operations; event-firing tests now
also cancel real projected History calls without substituting event dispatch.

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
Named lookup still needs source activation and sandbox permission.
New-target selection now supplies popup policy, activation consumption,
COOP/noopener, and sandbox propagation. Both auxiliary and null-opener creation
now use their context factories; feature setup and navigation remain unfinished.
The empty-name branch applies to direct algorithm
callers; `Window.open()` normalizes its empty target to `_blank` first.

The opening flow calls explicit unfinished operations on their owners:
`BrowsingContext.setUpFeatures()` for CSSOM View positioning/sizing,
`DocumentImpl.updateURLAndHistory()` for the new target's about:blank URL/history
update, and `Navigable.navigate()` for document-initiated navigation. That last
method now accepts the URL, source Document, and all remaining specification
inputs through `NavigateOptions`, defined beside Navigable. Its documented defaults
will be applied as navigation is implemented; the current stub does not consume
the options. The options arrangement is reviewed; its former `SPEC_MISMATCH` is removed. POST resources,
responses, serialized state, form entries, and source elements retain their
existing concrete types. `NavigationHistoryBehavior` includes `auto`, while
resolved commit/history-update inputs use `HistoryHandlingBehavior` (`push` or
`replace`). All three operations still throw until their effects are implemented.

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
the §7.4.6 reactivation caller must still supply inputs before `pageshow`.
`Navigation.navigate()`/`reload()` now prepare requests with serialized state and
real trackers. Its traversal methods also select/deduplicate destinations and
prepare queued history work and failure delivery. §7.2.6 supplies same-document
entry commits, event-driven acceptance/settlement, and finishing policy;
automatic focus/scroll effects remain unfinished. The full `navigate()` input
contract and tracker lifecycle do not make document-initiated navigation functional.

`SourceSnapshotParams`, in the shared `navigation/state/source-snapshot.ts` foundation,
captures all five source fields, including policy cloning and the null browser-UI
case. The non-null source still requires Window's unfinished transient activation.
Navigation API traversal uses it; navigation, closing, and delta traversal have
not yet been connected. `Traversable.appendSessionHistoryTraversalSteps()` now
executes through the §7.4.1.3 queue. `applyTraverseHistoryStep()` exposes the §7.4.6
application contract, including all four history-step outcomes, but still throws
when that queued work runs. The Navigation API roadmap records
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
translation has a pending `SPEC_MISMATCH`; the current stub does not consume them.

Reload coordination remains explicitly unfinished. HTML first selects the active
Window's Navigation object and history-entry Navigation API state, then fires a
cancelable reload navigate event (except for browser-UI involvement). Only after
that event permits continuation may it set `reloadPending` and append traversal
steps that apply the reload history step. Navigation event/state behavior,
reload history application and method-tracker integration are
missing. `SessionHistoryTraversalQueue` now executes appended work, but reload
still needs to produce its queued algorithm.
`SessionHistoryEntry` now retains Navigation API state, but reload must select,
carry, and restore it through those unfinished algorithms. The coordinator
therefore throws `Navigable reload coordination is not implemented` without
setting `reloadPending`. It does not substitute ordinary URL navigation for a
reload. Fetch/revalidation, unloading, document replacement, and restoration stay
with the later history and navigation algorithms.

HTML §7.2.6.8's Navigable notification operations are now implemented: callers
supply their executing event loop, or null for parallel work; abortion runs on
the active Window's loop or queues a global navigation-and-traversal task there.
It repeatedly cancels reentrant NavigateEvents. Child-destruction notification
also rejects a snapshot of pending traversal trackers. These helpers do not
implement `stopLoading()`, ongoing-navigation ID/traversal state, or child teardown.
Their exact caller obligations and pending signature review are in the
[Navigation API audit](./api/ROADMAP.md#seventh-slice-navigable-abortion-and-child-destruction-notifications).
Revisit the provisional caller-loop parameter when wiring production callers;
the [deferred decision](./api/ROADMAP.md#deferred-decision-caller-loop-parameter)
requires comparing a parameter-free handoff through their existing Documents/environments.

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `../history/history.ts` and navigation owners | state restoration and URL/history, traversal, and reload effects; attributes and all method preparation are implemented above | HTML §7.2.5 and §2.7 |
| existing `api/navigation.ts` | Navigation state, results/options, entries, ongoing navigation, activation, and focus/scroll policy are implemented; history effects, rendering, and lifecycle callers remain | HTML §7.2.6 |
| existing `api/navigation-transition.ts` and `api/navigation-destination.ts` | Transition/destination state, interfaces, and commit/completion promise settlement are implemented; owner effects remain explicit | HTML §§7.2.6.8 and 7.2.6.10.3 |
| existing `api/navigation-history-entry.ts` | Read interface, state, reactivation and same-document disposal implemented; full reload/session restoration remains | HTML §7.2.6 |
| existing `events/navigation-current-entry-change-event.ts` | Implemented for state and same-document entry updates; full history-application caller remains | HTML §7.2.7.1 |
| existing `api/navigate-event.ts` | Event dispatch, interception, precommit/commit/postcommit execution, success/error, and finish policy are implemented; URL/history, focus/scroll effects, and lifecycle producers remain | HTML §7.2.6 |
| `events/` | Interfaces through BeforeUnloadEvent, the legacy factory entries, and Window's page-transition firing method are implemented. Lifecycle callers and handler processing remain separate. | HTML §7.2.7 |
| existing `not-restored-reasons.ts` | Diagnostic interfaces, recursive creation, and the Document/history-record accessor are implemented; collection, masking, and Navigation Timing remain | HTML §7.2.8 |
| `traversal.ts` | Traversal queue, apply history step, back/forward/reload | HTML §§7.4.1, 7.4.3, and 7.4.6 |
| `state/` | Complete document/session-history state and persisted user state | HTML §§7.4.1–7.4.2 |

Existing modules still need fragment navigation, `javascript:` URLs,
download/POST handling, nested navigables, reload, traversal, unloading,
ongoing-navigation cancellation, and full history-step application (HTML
§7.4).

Failed/aborted navigation and cross-origin redirect replacement must run
`reservedEnv.discard()` before releasing the reserved environment. The operation
now implements the Service Workers client discarded flag; the incomplete
navigation and redirect algorithms still need to call it.

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
still needs source/target/activation inputs and sandbox enforcement. Target
selection must also populate and consult the context's
`onePermittedSandboxedNavigator`. Popup restrictions, external protocols, dialogs,
and download consumers remain explicit in the sandbox audit.

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
keeps HTML's declarations; the backing contract already requires a scalar source
string and a URL record. Producer conversion of invalid raw iframe source text
must be checked when collection is implemented, not invented at this read boundary.

### Remaining producers and consumers

| Dependency | Current boundary and later work |
| --- | --- |
| Document blocking details | `makeUnsalvageable()` already records individual details and clears salvageability. Existing abort/destroy paths supply `fetch`, `parser-aborted`, and `websocket`; this slice does not change their triggers. |
| Mandatory reason producers | `navigation-failure` needs the failed-navigation path; `lock` needs Web Locks lifecycle integration; `masked` needs privacy filtering and cache-policy producers. Having a string field does not implement those features. |
| Tree collection | `Document.buildNotRestoredReasonsForDocumentState()` is an explicit throwing stub for HTML's [document-state builder](https://html.spec.whatwg.org/multipage/document-lifecycle.html#build-not-restored-reasons-for-document-state). It must capture the URL, iframe source/ID/name (including absent attributes and URL-parse failure), clone blocking details, recurse through child navigables, and assign each active history state. |
| Cross-origin filtering | `TopLevelTraversable.buildNotRestoredReasons()` calls Document collection, then throws at the unfinished masking step. This [top-level builder](https://html.spec.whatwg.org/multipage/document-lifecycle.html#build-not-restored-reasons-for-a-top-level-traversable-and-its-descendants) must compare descendant origins, hide foreign URL/reasons/children, and report a masked blockage before platform creation. |
| Cache lifecycle | Admission, eviction, unloading, restoration, and failed-history navigation must retain or replace diagnostic records at their specified steps. Interface creation does not provide a back/forward cache. |
| Navigation Timing | `PerformanceNavigationTiming` and its PerformanceEntry/ResourceTiming foundation are absent. The existing provisional `Document.createNavigationTimingEntry()` and `NavigationTimingRecord` mark the exact missing step: create and retain the diagnostic object when constructing the real entry, then return it from the getter. The [Performance roadmap](../../performance/ROADMAP.md#restoration-diagnostics-dependency) records the consumer contract and null/realm gap. This slice exposes no public diagnostic-producing accessor. |

`SPEC_CLASH(not-restored-reasons-collection)` records three unresolved producer
problems in the later HTML algorithms: the document-state builder appends to
`children` without replacing its initial null with a list; it appends a child
Document's accessor even though §7.2.8 defines that accessor as null outside a
top-level traversable; and the top-level builder records `masked` only after
cloning the root's blocking-detail list. Resolve these against browser behavior
with Eric when implementing collection. The current interfaces consume supplied
records and do not choose a workaround for those later algorithms.

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
PerformanceEntry, Timeline buffering, and observer delivery do not exist yet.
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
- The new `updateForNavigableCreationOrDestruction()` is a throwing §7.4.6.1
  dependency. It must apply the current joint-history step without cancellation,
  with null source/initiator/navigation type and user involvement `none`;
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
| Session-history traversal | The queue now executes appended work; `updateForNavigableCreationOrDestruction()` still throws. It must reapply the current joint history step without cancellation checks. |
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
| `Navigable.checkIfUnloadingIsCanceled()` | Explicit §7.4.2.5 dependency with the full list/optional traversable/target step/user-involvement inputs and all three result values. Beforeunload prompting, optional top-level navigate-event cancellation, per-Window tasks, shared prompt state, and completion waits remain unfinished. |
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

Recursive teardown, unload/cancellation, history application, and UI/BiDi
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
- `Navigable.isAllowedBySandboxingToNavigate(target, sourceSnapshotParams)` is
  now the explicit throwing owner for HTML §7.4.2.5. Its later audit must cover
  self/ancestor relationships, activation-dependent top navigation, sandbox flags,
  and the target's one permitted sandboxed navigator. The snapshot is passed
  intact instead of consulting potentially changed source state per candidate.
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
  URL/history updates remain their existing explicit dependencies.

Production named opening is therefore still incomplete. Tests supply only
activation and sandbox permission, with explicit child/group associations.
Familiarity now runs through its implementation; tests of candidate ordering
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
| Retain sandbox and lifecycle state | With an opener and `sandboxed-navigation`, set the new context's one permitted sandboxed navigator to the opener. If propagation is requested, copy all source flags into the popup sandboxing set without sharing it. Mark the traversable created by web content, then return it and its window type. |

Consumption is a bounded dependency from HTML §6.4, using existing state and
collections. Input/automation notification, transient duration and expiry,
sticky activation, and UserActivation exposure remain unfinished in the
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
creator/opener/group inheritance for a non-null opener. Named lookup still
needs sandbox permission. The one-permitted-navigator field is
now populated, but §7.4.2.5 must consume it.

`Window.open()` still needs CSSOM View feature setup and about:blank URL/history
application or document-initiated navigation. Immediate navigation of a new
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
activation predicate and local sandbox permission when named lookup needs it.
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
  subsequent navigation must consume that context state. The one-permitted
  navigator still needs the navigation-permission consumer.
- New Window creation does not complete `Window.open()`: activation lookup,
  named-target sandbox checks, CSSOM View features, URL/history
  effects, and navigation retain their explicit boundaries. BiDi delivery and
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

Named lookup still reaches `Window.hasTransientActivation()` and
`Navigable.isAllowedBySandboxingToNavigate()`'s explicit unfinished boundaries.
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
| Back/forward can refetch or reactivate an entry | Entry URLs and nullable Document state retain the distinction. `traverseHistoryByDelta()` and `applyTraverseHistoryStep()` still need Document population/reactivation, state restoration, and event delivery. |
| Linearize child histories into one traversable history | Nested histories and distinct-step counting exist. The traversal queue, creation/destruction history update, and full history application remain explicit dependencies. |
| Synchronize multiple navigables, event loops, and clusters | The serial queue can wait for an algorithm's completion; the intercepted-traversal resume boundary still throws. Document-population waits, synchronization, and queue jumping remain §7.4.6 work. |
| 204/205 and attachment responses preserve the active Document | Navigation response selection must handle these outcomes before creating or committing a Document. The `navigate()` stub now names them explicitly. Download navigate-event dispatch alone does not implement download response handling. |
| Location/Refresh/X-Frame-Options/CSP/COOP headers | Fetch redirect processing and policy components are available, but HTML navigation must coordinate redirects, snapshots, response selection, and X-Frame-Options enforcement. Document creation already applies CSP/COOP and context-group changes; Refresh processing has its own explicit throwing boundary. |
| Synchronous fragment and single-page navigation | `Document.updateURLAndHistory()` is the shared throwing dependency for History/interception. Fragment navigation and synchronization with other navigables still need their later algorithms. |
| javascript: URLs, srcdoc, and beforeunload | URL/origin and inherited-state foundations exist, but special navigation paths remain unfinished. `checkIfUnloadingIsCanceled()` explicitly stops before the beforeunload/navigate checks and coordinated results. |

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
| Classic History API state | New `classicHistoryAPIState`, initialized with `env.serializeForStorage(null)`. The URL/history update and traversal stubs explicitly retain the missing storage/restore consumers. |
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

`entry.savePersistedState()` and `entry.restorePersistedState()` are explicit
throwing §7.4.6.3 dependencies alongside `entry.restoreScrollPositionData()`.
They are not yet called by the provisional commit path. Capture needs restorable
region identity and position measurements; restoration needs auto/manual and
Navigation suppression checks, user-scroll state, optional retries as content
loads, and scroll anchoring. Child navigable containers are excluded because
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
| Not restored reasons | Initially null. Existing diagnostic types and platform projection are available; `Document.buildNotRestoredReasonsForDocumentState()` still throws pending lifecycle reason collection and tree masking. |

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
and same-document fixtures now preserve that identity. The real History/fragment
producer still reaches `Document.updateURLAndHistory()`; its TODO explicitly
requires state sharing and latest-entry maintenance.

`Document.latestEntry` now starts null. The existing provisional local commit
path sets it to the committed entry, and an inactive Document retains its own
pointer after replacement. Creating an entry alone does not change the pointer.
Full same-document history updates and §7.4.6.2 history-step application still
need to maintain it; the active entry of a Navigable is not a substitute for
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
| Run one algorithm before the next | Synchronous steps run directly. A step can return `InternalPromise<void>` to retain queue ownership while waiting; the UserAgent's `HostPromise` observes completion and schedules resumption. This adaptation and the browser-owned queue were reviewed and accepted. History application and its queued callers must propagate that completion when their waits are implemented. |
| Queue jumping | The target tag and mutable pending set are present. §7.4.6.2 must provide the navigables-that-must-wait set, population/continuation coordination, eligible-step selection, and the `runningNestedApplyHistoryStep` guard. Tagged appends and population continuations must also wake the suspended history operation; its completion promise alone does not provide that notification. These remain explicit at the history-application boundary. |

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
Those operations still throw, now when their queued steps run. With the activation
dependency supplied, a Navigation request can therefore be accepted before its
unfinished history owner fails; the queue does not supply the missing tracker
commit/finish settlement. Tests retain each actual boundary and also exercise
real parallel delivery of an existing cancellation outcome to the Navigation
owner. Automatic element loading/removal and beforeunload remain unfinished.

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
| request, response, fetch controller, commit early hints | Existing fields retain request/response/controller identity and the Document callback. Local routes supply a response with a URL and null request/controller. Fetch navigation and srcdoc producers remain §7.4.5 dependencies; network failures need its separate error-Document path. Early-hints invocation and controller-owned timing are already exercised by document-lifecycle tests. |
| COOP enforcement result, reserved environment, opener policy | The supplied-response preparation fills these before creating the Document. The result is temporarily nullable during that local assembly. The full Fetch/redirect producer must supply finalized inputs; this slice preserves the existing COOP implementation and its reporting limitations. |
| origin, policy container, final sandboxing flags, iframe referrer policy | Response policies and captured sandbox/referrer inputs are connected. about:blank/srcdoc origin, source/history-policy selection, and inherited base/cookie inputs retain their existing explicit dependencies. |
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
parallel cancellation/history preparation below. Unload cancellation and history
population remain throwing owner dependencies; this does not enter the provisional
supplied-response loader or complete end-to-end navigation.

| Steps | Implementation and boundary |
| --- | --- |
| 1–6: source preparation and admission | Capture CSP form-submission classification, source policy/activation, initiator origin/base, and enforce the source/user-involvement assertions. Null source uses browser UI defaults; its javascript: case captures the destination origin. Sandbox rejection returns or throws SecurityError according to exceptionsEnabled. Transient activation and sandbox permission still stop at their existing owner stubs. An inactive source without a node navigable is an internal invariant failure; this slice does not invent a permission rule for it. |
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
tests supply `traversal` explicitly. Fragment processing and stop-loading still
need their setter calls; further navigation/history work
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
interception stops ordinary loading. Immediate intercepted commit still reaches
Document.updateURLAndHistory's explicit §7.4.4 dependency. Accepted non-intercepted
events reach quota reservation and the parallel unload-cancellation dependency. No Fetch,
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
| [CSP navigation request check](https://w3c.github.io/webappsec-csp/#should-block-navigation-request) | Implemented and connected through the captured policy container and source client. Pre-navigation directives run before inline checks, both dispositions report, and the default Trusted Types policy may rewrite the request URL. Fetch request checks remain a different algorithm. The next ordinary-network navigation slice still needs to connect its caller. |
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
`Navigable.checkIfUnloadingIsCanceled()`. Cancellation or a changed navigation ID
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

- **§7.4.2.4 unload cancellation:** the existing owner still throws. Its eventual
  implementation must snapshot Documents, dispatch beforeunload/navigate checks
  on their owning loops, coordinate prompt state, and resume these parallel steps
  after all results. Its current synchronous result signature is provisional;
  adding a real wait must update both this caller and top-level closing. No
  blocking wait, unconditional approval, or substitute beforeunload dispatch was added.
- **§7.5.11 recursive abortion:** Document.abortAndDescendants explicitly throws.
  The existing single-Document abort operation is insufficient: descendants need
  their own Window tasks and unsalvageability propagation. HTML leaves their
  ordering open; resolve that during the lifecycle audit.
- **§7.4.5 population:** Navigable.populateHistoryEntryDocument has the complete
  inputs, with optional arguments grouped into PopulateHistoryEntryOptions
  (pending callable-shape review). It still throws. Its owner must handle srcdoc,
  Fetch/external protocols/error Documents, replayable POST bytes, ID rechecks,
  response/frame restrictions, and downloads/204/205 without replacing the old
  Document. The completion callback appends finalization only after that owner
  finishes, rather than finalizing an unpopulated entry immediately.
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
it now would remove work those paths still require.

Its replacement boundary is explicit:

- [§7.4.5 population](https://html.spec.whatwg.org/multipage/browsing-the-web.html#populating-a-session-history-entry)
  must select the appropriate params producer. In particular,
  [create navigation params by fetching](https://html.spec.whatwg.org/multipage/browsing-the-web.html#create-navigation-params-by-fetching)
  owns the request/reserved client and policy/COOP decisions across redirects.
  The local source route must likewise supply completed inputs before Document
  creation, rather than depend on a late generic preparation call.
- [§7.5.1 Document creation](https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object)
  must consume the selected inputs and handle the intentional null reserved
  environments in javascript: and HTML supplied-response params. It currently
  depends on this fallback and non-null environment reads; that consumer audit
  is still required before enabling those paths end to end.
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
| Apply Document history state | New `Document.updateForHistoryStepApplication()` has the complete §7.4.6.2 inputs and throws explicitly. Latest-entry maintenance, classic-state restoration, Navigation notifications, popstate/hashchange, persisted state, reactivation, and initial-load/BiDi behavior belong there. |
| Scroll | Call `scrollToFragment()` on the live active Document after history callbacks. Its existing §7.4.6.4 dependency still throws; target selection, ancestor revealing, viewport geometry, focus, and retrying a not-yet-parsed fragment remain unfinished. |
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

The adjacent finalization algorithm is covered below. §7.4.4 URL/history updates
and §7.4.6 Document updates and scrolling remain separate audits.

## HTML §7.4.2.3.3: Same-document finalization

Audited [finalize a same-document navigation](https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-same-document-navigation)
against WHATWG HTML `6d7788b` (2026-11-03). `Traversable` owns the operation;
its inputs retain the specification's order, with the traversable as `this`.

| Requirement | Implementation and boundary |
| --- | --- |
| Traversal queue | Fragment navigation already appends tagged steps. The finalizer runs on that queue; its ownership assertion remains a TODO alongside the other low-level history operations. §7.4.4 must connect the URL/history-update caller. |
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
§7.4.6.2 update, fragment scrolling, automatic history events, and §7.4.4's
URL/history-update coordinator remain separate throwing boundaries.

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
| Direct and redirected producers | §7.4.5 population must assemble these inputs and call the new operation on the target's navigation-and-traversal task, after its stale-ID check. A redirect must retain the last fetch-scheme response's origin, not the final opaque/custom-scheme URL's origin or the destination Document's origin. The population TODO names these dependencies; no producer is claimed complete here. |
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

## Removal condition

Burn this file once all supported navigation kinds share the specified
history-step machinery and the public History/Navigation APIs exist.
