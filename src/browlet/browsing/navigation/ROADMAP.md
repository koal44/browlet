# Navigation roadmap

This component owns browsing contexts, navigables, document creation, and
session history. It shares the `browsing/` family with `window/` and `policy/`;
outside consumers use its index, while its modules import each other directly.

## Present

- `browsing-context.ts` retains context/group relationships and creates the
  initial Window and about:blank document through the UserAgent's factory.
- `Navigable` prepares response policy inputs, selects the browsing context and
  Window/realm, and creates the destination document and history entry.
  `loadHTMLDocument()` starts HTML parsing and coordinates completion or abortion.
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
  [Storage substrate](../../../storage/ROADMAP.md#storage-sheds); auxiliary
  browsing-context creation still blocks the full opener flow.
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
predicate, but source snapshots, familiarity, sandbox navigation permission,
and definite closing remain prerequisites for a successful `Window.close()`.
Opening now coordinates feature processing, target selection, new/existing
branches, and return rules. `Navigable.chooseNavigable()` handles empty, `_self`,
`_parent`, and `_top` names; named lookup and new targets still need familiarity,
popup/activation policy, sandbox restrictions, COOP/noopener, and creator inheritance.
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
not yet been connected. `Traversable.appendSessionHistoryTraversalSteps()` and
`applyTraverseHistoryStep()` expose the §7.3.2 queue and §7.4.6 application contracts,
including all four history-step outcomes. Both throw until implemented; no parallel
queue or provisional movement is substituted. The Navigation API roadmap records
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
traversal queue, reload history application, and method-tracker integration are
missing. `SessionHistoryTraversalQueue` is still an empty identity class.
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
its origin. Initial blank creator inheritance, history reconstruction, and popup
creator state remain unfinished.

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

Iframe, object, and legacy frame implementations retain an initially-null
`contentNavigable`. Document's `getDocumentTreeChildNavigables()` collects these
associations in tree order for Window's §7.2.2.2 length getter, excluding shadow
trees and returning an empty list when the Document has no node navigable.
The setters maintain the reverse `Navigable.container` link for all three types,
including clearing, replacement, and reassociation. Document full activity follows
the actual container Document recursively; a child without a container is not
fully active. Container reassociation and ancestor activity changes now notify
child Documents recursively, including shadow-tree containers, so timers and
queued tasks can resume. Child creation/destruction must still populate and clear
these associations. `Navigable.activeWindowProxy`
provides the active document's stable proxy once that relationship exists;
the field and accessor alone do not create nested browsing contexts.
Browsing-context creation still accepts an iframe embedder; object/frame creation
must extend those inputs when their lifecycles are introduced. Sandboxing and
iframe referrer-policy rules remain restricted to iframe containers. Response
preparation explicitly rejects object/frame containers pending their sandbox
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

The next area in document order is §7.3, beginning with navigables. Its audit
should compare the existing state/initialization with the complete written
algorithms before moving into larger lifecycle and history-application work.

## Removal condition

Burn this file once all supported navigation kinds share the specified
history-step machinery and the public History/Navigation APIs exist.
