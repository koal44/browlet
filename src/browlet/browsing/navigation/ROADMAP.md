# Navigation roadmap

This component owns browsing contexts, navigables, document creation, and
session history. It shares the `browsing/` family with `window/` and `policy/`;
outside consumers use its index, while its modules import each other directly.

## Present

- `browsing-context.ts` retains context/group relationships and creates the
  initial Window and about:blank document through the UserAgent's factory.
- `TopLevelTraversable.create()` registers the initialized entry and calls the
  UserAgent's provisional BiDi creation hook. `UserAgent.createFreshTopLevelTraversable()`
  adds the initial navigation request; that request still reaches `navigate()`'s
  explicit unfinished boundary.
- `UserAgent.createChildNavigable()` forwards to `Navigable.createChild()`,
  which prepares iframe child state and nested-history work;
  context inheritance, traversal-queue execution, and the final history update
  remain explicit dependencies. Iframe/object/frame `contentDocument` and
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
  unloading/destruction, and traversal execution remain throwing dependencies.
  UI removal and BiDi delivery retain explicit provisional UserAgent hooks.
- Document owns the ancestor, inclusive-ancestor, descendant, inclusive-descendant,
  and document-tree child collections. History-action activation consumption and
  COOP access-reporting ancestry use these shared algorithms.
- `Navigable.findNavigableByTargetName()` searches the source subtree, its
  traversable, and then familiar contexts in the same group. `chooseNavigable()`
  uses it for existing named targets and coordinates new-target policy, activation
  consumption, COOP/noopener, creation, and sandbox bookkeeping. Activation lookup,
  sandbox permission, familiarity, and auxiliary creation remain explicit dependencies.
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
`_parent`, and `_top` names and calls the existing-target lookup coordinator.
Named lookup still needs source activation, sandbox permission, and familiarity.
New-target selection now supplies popup policy, activation consumption,
COOP/noopener, and sandbox propagation. Auxiliary creator inheritance remains
unfinished; null-opener creation already uses the existing top-level factory.
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
`applyTraverseHistoryStep()` expose the §7.4.1.3 queue and §7.4.6 application contracts,
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
| Mutation ownership | Current-entry changes belong to the traversable's history traversal queue; active-entry changes belong to the active Document's event loop. Existing provisional synchronous commits do not establish that queue/dispatch machinery. The field comments and existing throwing queue operation keep this requirement explicit. |
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

The field's required initialization is the result of **starting** a queue,
not merely allocating its state. That execution part remains unfinished:

- [§7.4.1.3](https://html.spec.whatwg.org/multipage/browsing-the-web.html#starting-a-new-session-history-traversal-parallel-queue)
  must supply serial in-parallel draining and both ordinary and tagged
  synchronous-navigation append operations. `appendSessionHistoryTraversalSteps()`
  deliberately retains its existing explicit failure until work can be executed.
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
reaches the explicit auxiliary-context dependency. It captures the resulting
Document, initiator origin, origin, target name, and about base URL in document
state; initializes the navigable; assigns step 0; and appends the initial entry.
The existing provisional History length/index initialization remains in place.
Queue startup and initial visibility's performance entry retain the preceding
audits' explicit dependencies.

For an opener, session storage is cloned from its **top-level** traversable,
including when the opener is a child. The existing Storage implementation and
focused clone test cover separate destination maps. Auxiliary context creation
still throws: creator origin/base URL, policy/referrer inheritance, opener/group
relationships, and the new Window environment need the §7.3.2.1 audit. The test
supplies only that unfinished context factory; it does not establish working
`window.open()` or auxiliary browsing contexts.

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
notification. Only unfinished factories, queue draining, and final history
application are substituted by the creation tests.

The complete path is **not executable yet**:

- `BrowsingContext.create()` throws for creator inheritance; §7.3.2.1 must supply
  creator/group state, inherited origin/base/cookie/referrer/policy state,
  embedder environment ancestry, sandbox/Permissions Policy, and Window setup.
  Its current embedder type is iframe-only. `createChild()` explicitly rejects
  object, embed, and legacy frame until their context/policy inputs are supported.
- `appendSessionHistoryTraversalSteps()` still throws at §7.4.1.3's missing queue
  drain. Accepting work without running it would leave child entries pending.
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
| Session-history traversal | `appendSessionHistoryTraversalSteps()` and `updateForNavigableCreationOrDestruction()` still throw at their §7.4 queue/application boundaries. The latter must reapply the current joint history step without cancellation checks. |
| [BiDi destruction](https://w3c.github.io/webdriver-bidi/#webdriver-bidi-navigable-destroyed) | New `UserAgent.webDriverBiDiNavigableDestroyed()` is an explicit provisional hook. Live sessions, navigable-info serialization, parent-related event subscriptions, event delivery, and subscription pruning remain unfinished. |
| Element lifecycle | Iframe/legacy-frame removal, object fallback/resource changes, and embed removal/display-no-plugin must call their node Document's UserAgent. Source TODOs name the route and the missing startup/teardown/queue work. DOM removal does not automatically invoke this unfinished coordinator. |

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
before its source snapshot, script-closability, familiarity, sandbox permission,
and DOM-manipulation-task handoff; its source now names `definitelyClose()` as
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
The unfinished recursive teardown, cancellation, traversal queue, and unloading
are supplied only at those boundaries; their unmocked failures stay explicit.
Together with creation, storage lifetime, and Document destruction, all 28 tests
pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each with and without
the addon. Typechecking, touched-file ESLint, import
checks, and whitespace checks pass. No new expected failures or runtime rebuilds.

Recursive teardown, unload/cancellation, traversal execution, and UI/BiDi
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
- `BrowsingContext.isFamiliarWith(other)` is the explicit throwing owner for
  HTML §7.3.2.2: active origins, the source's top-level context, the target's
  auxiliary opener chain, and its ancestor contexts. Other-group contexts are
  not searched, even if this future predicate would consider them familiar.
- The [new-target follow-up](#html-7317-new-target-selection) now supplies the
  choosing branch, its UserAgent settings, and activation consumption. Its
  missing creation/navigation dependencies remain separate from named lookup.
- `TopLevelTraversable.create()` already supplies null-opener creation,
  registration, and opener session-storage cloning. Non-null openers still reach
  `BrowsingContext.createAuxiliary()` and creator-state inheritance. Immediate
  replacement navigation, CSSOM View feature effects, and `Window.open()`'s
  URL/history updates remain their existing explicit dependencies.

Production named opening is therefore still incomplete. Tests supply only
activation, sandbox permission, familiarity, and pre-existing child/group
associations; they do not claim these owners are implemented. The new lookup
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

Selection still reaches `Window.hasTransientActivation()` when popup blocking
is enabled and `BrowsingContext.createAuxiliary()` for a non-null opener. The
latter needs creator/opener/group inheritance in §7.3.2.1. Named lookup still
needs sandbox permission and familiarity. The one-permitted-navigator field is
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
activation predicate, local sandbox permission when named lookup needs it, and
auxiliary creation only where that branch is being exercised. The top-level
factory and consumption algorithm run normally. Separate cases retain the real
auxiliary error and exercise sandbox rejection through projected `Window.open()`.

Together with target lookup, top-level creation, existing activation, and opening
suites, all 129 tests pass on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre,
each with and without the addon. Typechecking, touched-file ESLint, import
hierarchy, and whitespace checks pass. No new expected failures or runtime rebuilds.

## Removal condition

Burn this file once all supported navigation kinds share the specified
history-step machinery and the public History/Navigation APIs exist.
