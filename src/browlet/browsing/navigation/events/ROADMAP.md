# Navigation event interfaces

Audited HTML [§§7.2.7.1–3](https://html.spec.whatwg.org/multipage/nav-history-apis.html#nav-traversal-event-interfaces)
against `404b3eb` (30 October 2026), on 1 November, then extended through
§7.2.7.7 BeforeUnloadEvent below. The preceding NavigateEvent work is recorded in the
[Navigation API roadmap](../api/ROADMAP.md).

## Present

- §7.2.7.1 NavigationCurrentEntryChangeEvent already has its complete constructor,
  nullable navigationType, required previous entry, EventInit handling, and
  receiver-realm projection. Its payload now lives here; the Navigation API
  retains only the producers. Its
  current-entry-change producers are implemented; full history coordination
  remains unfinished. Retained-Document reactivation refreshes entries without
  firing currententrychange.
- §7.2.7.2 PopStateEvent exposes `state` and `hasUAVisualTransition` with null/false
  defaults. Constructor state is an unchanged `any` value, not a structured clone;
  existing-Document history application now supplies the restored classic state
  for a trusted popstate. Full traversal and persisted-state restoration remain open.
- §7.2.7.3 HashChangeEvent exposes `oldURL` and `newURL` with empty-string defaults.
  Binding converts USVString inputs without parsing or resolving them as URLs.
- §7.2.7.4 PageSwapEvent exposes nullable NavigationActivation and ViewTransition
  references. Its constructor/getters preserve supplied identity, including
  objects from another realm; origin filtering belongs to the event producer.
- §7.2.7.5 PageRevealEvent exposes its nullable ViewTransition reference with the
  same identity and EventInit rules. The getter retains the initialized value;
  it does not query the Document's current transition or activation state.
- §7.2.7.6 PageTransitionEvent exposes the retained `persisted` boolean.
  `WindowImpl.firePageTransitionEvent()` implements trusted lifecycle dispatch
  with HTML's legacy flags and Document target. Its lifecycle callers remain open.
- §7.2.7.7 BeforeUnloadEvent exposes its independent string `returnValue` and
  legacy Document factory entry. Handler processing and unload prompts remain open.
- These interfaces are exposed only to Window, inherit Event, and use its
  ordinary construction, timestamp, dispatch, and trust machinery. Internal
  producers can allocate and initialize trusted events through the existing
  `fireEvent()` path; this does not implement those producers.
- DOM's ASCII-case-insensitive `Document.createEvent()` table now includes
  HashChangeEvent and BeforeUnloadEvent. They start uninitialized with empty payload fields and require
  `initEvent()` before dispatch. PopStateEvent is deliberately absent, matching
  the [DOM table](https://dom.spec.whatwg.org/#dom-document-createevent)
  (`3c53f93`, refreshed 1 November).

These payload implementations sit below DOM nodes in the import hierarchy, like
StorageEvent. Document's legacy factory can depend on them without loading the
navigation coordinator. Their declaration collection belongs to this folder;
Browlet's Web IDL composition assembles it.

## Integration after the §8.1.8 rebase

Vin's ongoing event-handler work changes callback-realm tracking and the order
of the DOM-event and scripting layers. Preserve the Navigation API's existing
EventHandlerMap consumers (`onnavigate`, `oncurrententrychange`, and entry
`ondispose`) when applying those changes to their new `navigation/api/` paths.
Merge the hierarchy/import ordering changes with the new `events/` layer, and
rerun handler, Navigation update/interception, and history-event tests together.
Review the WindowEventHandlers inventory below when the broader declarations
land, including `onpageswap`, `onpagereveal`, `onpageshow`, `onpagehide`, and
`onbeforeunload`; event payloads themselves do not implement those attributes.
BeforeUnloadEvent supplies `EventImpl.isBeforeUnloadEvent()` for interface
narrowing and its own string `returnValue`. Preserve Event's separate boolean
cancellation binding; the handler rules below must not conflate the two.

## Browser evidence

`node-compat/experimental/navigation-history-events.mjs` records the browser-only
probe. On 1 November, Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 agreed
on constructor defaults, state identity, PopStateEvent dictionary access order,
borrowed PopStateEvent getters, and the legacy event-factory distinction.

- `SPEC_CLASH(hashchange-url-scalar-strings)`: Eric chose HTML/WebKit's USVString
  conversion. Lone UTF-16 surrogates become U+FFFD; valid surrogate pairs remain
  unchanged. Chromium and Firefox preserve lone surrogates. Their IDL explains
  the difference: [Blink](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/events/hash_change_event.idl)
  and [Gecko](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/webidl/HashChangeEvent.webidl)
  use DOMString, while [WebKit](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/dom/HashChangeEvent.idl)
  uses USVString. This is string conversion, not URL normalization.
- `SPEC_CLASH(currententrychange-constructor-event-flags)`: retain Browlet's
  existing HTML/Chromium/Firefox behavior: author construction preserves the
  supplied EventInit flags and leaves isTrusted false. WebKit ignores true
  bubbles/cancelable/composed inputs and reports isTrusted true. Its
  [constructor](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/NavigationCurrentEntryChangeEvent.cpp)
  uses the internal Event constructor instead of passing the initialization
  dictionary. The existing navigation-updates regression already requires the
  correct flags and trust; this audit changes no behavior there.

## Remaining producers and dependencies

| Requirement | Owner and remaining work |
| --- | --- |
| Restore and expose History state | Existing-Document updates deserialize the entry's classic History state in the owning realm and retain it on History. Unchanged entries preserve the cached object's identity. New-Document initialization remains unfinished. |
| Popstate delivery | Existing-Document updates synchronously dispatch after Navigation notifications, using the current History state. Full traversal coordination and persisted-state restoration remain explicit dependencies. See the [Document-update audit](../ROADMAP.md#html-7462-existing-document-history-updates) for reentrancy and browser choices. |
| Native visual transitions | The user agent must report whether it already displayed a cached rendering. Browlet has no such UI; automatic production must keep hasUAVisualTransition false until a real presentation owner supplies it. Synthetic construction can explicitly set true. |
| Hashchange delivery | Existing-Document updates compare URLs, retain old/new serialized values, and queue a trusted DOM-manipulation event before popstate. The event remains asynchronous. Persisted-state restoration still throws after popstate with hashchange already queued; the full traversal/scrolling lifecycle remains unfinished. |
| Window handler attributes | §8.1.8 supplies onpopstate/onhashchange and body/frameset forwarding through the shared WindowEventHandlers machinery. The event producer does not need a separate handler path. |
| Remaining audit | The §7.2.7 event interfaces are implemented; lifecycle and handler dependencies remain listed here. The [§7.2.8 diagnostic-interface audit](../ROADMAP.md#html-728-notrestoredreasons) is also implemented; document-order work continues at §7.3. |

The §7.2.7 preamble points NavigateEvent to its dedicated §7.2.6.10 section,
already covered in the Navigation API roadmap. NavigationCurrentEntryChangeEvent's
null/reload previous-entry descriptions are covered by its existing producers.
The initial Document state gives popstate a null state, while restoration must
supply the saved value. PopStateEvent's visual-transition guidance describes
author handling, not an additional rendering effect performed by the constructor.

## PageSwapEvent (§7.2.7.4)

The complete event interface and initialization dictionary are implemented,
including readonly getters, null defaults, EventInit flags, and Window-only
exposure. DOM's legacy `createEvent()` table does not include this interface.
This slice does not add automatic pageswap dispatch to Browlet.navigate().

The ViewTransition reference has a narrow [rendering-owned identity foundation](../../../rendering/ROADMAP.md#viewtransition-dependency-identity).
It is nonconstructible and uses ordinary Binding identity/realm checks. Its
methods, promise lifecycle, rendering state, and creation APIs remain unfinished;
the event does not widen the field to an arbitrary object or silently discard
non-null supplied values. Tests supply an internal transition identity through
real bindings, without claiming that captures or a transition occurred.

The [§7.4.6.1 producer](https://html.spec.whatwg.org/multipage/browsing-the-web.html#fire-the-pageswap-event)
is now `Window.firePageSwapEvent()`. It requires a task on the displayed
Document's agent loop, checks target-document origin and cross-origin redirect
history, and constructs a **separate** activation in the outgoing realm. Reload
reuses the current entry; traversal finds the target by history-entry identity;
push/replace allocate an outgoing-realm view of the actual destination entry.
It does not overwrite `navigation.activation`. Cross-origin navigation and
cross-origin redirects to new Documents expose null activation; a previously
activated same-origin target retains the specified restoration exception.
An initial about:blank predecessor can be null for push/replace. Reload/traversal
require their existing destination entry. The producer does not fabricate one
when the caller violates that precondition.

The [producer audit](../ROADMAP.md#html-7461-outgoing-pageswap-production)
records the approved event trust/target, redirect filtering, and destination-entry
differences with Chromium/WebKit. Automatic deactivation, unloading, and CSS
capture remain unfinished, so this is not yet automatic pageswap delivery.

The producer also receives the CSS outbound transition, or null if none exists;
capture, old/new-document transfer, opt-in checks, and lifecycle timing remain
CSS View Transitions/history-application work. The constructor merely retains
its input, so even a same-document transition can be supplied synthetically.
The `onpageswap` handler and body/frameset forwarding are supplied by the shared
§8.1.8 handler machinery; production tests exercise the Window handler.

`node-compat/experimental/page-swap-event.mjs` was run on 1 November with Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2. Chromium/WebKit agree with HTML on
defaults, EventInit flags/trust, dictionary order, real interface checks, borrowed
getters, cross-realm payload identity, readonly properties, and absence from the
legacy factory. A retained event still references its transition after that
transition finishes. Firefox's default tested build does not expose PageSwapEvent;
its [IDL](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/webidl/PageSwapEvent.webidl)
agrees but gates exposure on `dom.viewTransitions.cross-document.enabled`.
No behavior disagreement requiring a new SPEC_CLASH was found in this slice.

## PageRevealEvent (§7.2.7.5)

The complete event interface and initialization dictionary are implemented:
Window exposure, ordinary Event construction, nullable ViewTransition conversion,
and the readonly getter. The retained reference survives replacement of its
Window. Synthetic construction accepts any real ViewTransition, including one
from another realm; the constructor does not resolve or activate a transition.
DOM's legacy `createEvent()` table does not include PageRevealEvent.

HTML's [reveal algorithm](https://html.spec.whatwg.org/multipage/browsing-the-web.html#reveal)
is now implemented as `Document.reveal()`. The remaining connections are:

- Document's `has been revealed` state is initially false and reset on history
  reactivation. `reveal()` sets it before inbound resolution or dispatch, so
  reentrant callbacks cannot reveal the Document again during that activation.
- The existing rendering pipeline's `reveal` phase must call that algorithm on
  the first update displaying the current page. It is currently an unconnected
  hook. A cached frame may be shown before this event; the event is not a generic
  load-completion notification or evidence that a frame was painted.
- CSS [inbound transition resolution](https://drafts.csswg.org/css-view-transitions-2/#resolve-inbound-cross-document-view-transition)
  must consume transferred parameters, respect an already-active transition,
  resolve opt-in/type rules, and allocate the incoming transition and its promises
  in the incoming Document's realm. `resolveInboundCrossDocumentViewTransition()`
  explicitly throws at this [rendering dependency](../../../rendering/ROADMAP.md#viewtransition-dependency-identity).
- Once resolution completes, `reveal()` fires the trusted event at the incoming
  Window, even for a null transition. It then calls a non-null transition's
  `activate()` inside the existing prepare/cleanup-script boundary, including
  cleanup on failure. CSS activation remains an explicit throwing operation.
- `onpagereveal` and body/frameset forwarding are supplied by §8.1.8's shared
  event-handler machinery; the producer uses the same event dispatch path.

`SPEC_CLASH(pagereveal-target-and-trust)` follows HTML/Chromium's trusted Window
target. The 4 November `document-reveal.mjs` production-event probe finds that
WebKit instead emits an untrusted Document-targeted event, for both null and
non-null transitions. Gecko's source sets trust and dispatches at Window, behind
its disabled feature flag. The [revelation audit](../ROADMAP.md#html-7463-revealing-the-document)
records this approved choice and the rendering/CSS stopping point.

`node-compat/experimental/page-reveal-event.mjs` was run on 1 November with
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Chromium/WebKit agree on
defaults, type/dictionary conversion order, brand rejection, flags/trust,
cross-realm identity, borrowed getters, readonly properties, getter exceptions,
and the missing legacy-factory entry. The reference remains after a real
transition finishes. Firefox's tested default build does not expose the interface;
its [IDL](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/webidl/PageRevealEvent.webidl)
matches HTML behind `dom.viewTransitions.cross-document.enabled`. No new
SPEC_CLASH is needed for the implemented constructor/getter behavior.

## PageTransitionEvent (§7.2.7.6)

The constructor, initialization dictionary, and readonly `persisted` getter are
implemented. The dictionary defaults to false and uses Web IDL boolean conversion;
an object is truthy without invoking `valueOf()` or `toString()`. Author-created
events retain ordinary EventInit defaults and are untrusted. DOM's legacy
`createEvent()` table does not include this interface.

HTML's [fire a page transition event](https://html.spec.whatwg.org/multipage/nav-history-apis.html#fire-a-page-transition-event)
is a Window instance method. It uses the existing trusted event allocation and
legacy-target-override dispatch: listeners run at Window, `target` is its
Document, `currentTarget` and the listener receiver are Window, and the composed
path contains Window alone. Document listeners do not run. `bubbles` and
`cancelable` are true for historical reasons; `composed` remains false.
Cancellation sets `defaultPrevented` but does not veto the lifecycle operation,
so this method deliberately discards dispatch's cancellation result. Synthetic
`dispatchEvent()` does not acquire these special flags or the target override.

`persisted` is the supplied snapshot, not a query of current salvageability:
`pageshow(false)` describes a newly loaded page, while `pageshow(true)` describes
reactivation. `pagehide(true)` means the Document might be retained, not that
restoration is guaranteed; later work can still make it unsalvageable.

The remaining callers and state are explicit dependencies:

- Initial loading: §13's full stop-parsing algorithm must set Document's
  `page showing` state and fire `pageshow(false)` after Window load. The existing
  provisional completion path does not yet implement those steps.
- History reactivation: §7.4.6.2 now refreshes Navigation entries and activation,
  tests readiness and `page showing`, updates that flag, clears `has been revealed`,
  requests visibility updating, and fires `pageshow(true)`. Both Document flags
  now exist. Form reset and changed visibility still throw; the bfcache/traversal
  coordinator remains absent. The [retained-Document audit](../ROADMAP.md#html-7462-retained-document-reactivation)
  records those owners, the approved entry/activation order, and actual event tests
  proving that disposal follows pageshow.
- Unloading: §7.5.9 must determine retention, update `page showing`, fire
  `pagehide(document.salvageable)`, then update visibility and continue cleanup.
  Existing salvageability, abortion, and WebSocket cleanup state do not complete
  cache-retention policy or propagation from unsalvageable child Documents.
- `onpageshow`/`onpagehide` and body/frameset forwarding remain §8.1.8 integration
  work. `addEventListener()` delivery is covered now.

`node-compat/experimental/page-transition-event.mjs` was run on 1 November with
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on constructor
defaults, boolean conversion, readonly/borrowed getters, invalid argument errors,
the missing legacy-factory entry, and real initial pageshow/pagehide dispatch.
Each exposed the Document target, Window-only path, historical flags, and
cancellation without preventing the next navigation. This probe does not prove
bfcache retention or restoration policy.

`SPEC_CLASH(pagetransition-init-frame-swap)`: Eric chose HTML/Chromium/WebKit's
dictionary. Firefox additionally reads `inFrameSwap` before `persisted`, which is
observable through a getter or Proxy. Its [IDL](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/webidl/PageTransitionEvent.webidl)
declares that nonstandard dictionary member while marking the corresponding
attribute ChromeOnly. Browlet does not add that extension or read its value.

## BeforeUnloadEvent (§7.2.7.7)

The Window-exposed interface is nonconstructible. DOM's case-insensitive
`Document.createEvent('BeforeUnloadEvent')` entry creates an uninitialized event
with an empty string. Existing internal allocation creates trusted events in
the producer's realm. `initEvent()` initializes ordinary Event state without
resetting the string. Binding performs DOMString conversion, including preserving
lone surrogates and rejecting Symbols; the implementation retains the last value.

The string and Event's boolean `returnValue` are independent. Assigning a nonempty
string does not set the canceled flag, and clearing it does not undo cancellation.
Event's boolean accessor is now a Binding adapter over `defaultPrevented` and
`preventDefault()`, so explicitly borrowing it still uses the base-interface
behavior on a BeforeUnloadEvent. Its former implementation-only tests now exercise
the projected property, retaining noncancelable coverage and adding passive listeners.

The generated TypeScript declaration uses the **approved `any` accommodation for
this one property**, matching TypeScript's `lib.dom.d.ts`. A precise string member
made `BeforeUnloadEvent` structurally incompatible with `Event`, rejecting normal
`dispatchEvent(event)` calls. The retained platform type-contract test reproduced
that failure and now verifies Event assignment, dispatch, and nonconstructibility.
Runtime IDL conversion and implementation storage remain DOMString/string; no
generator-wide widening or runtime `any` conversion was introduced.

Remaining owners and connections:

- §8.1.8 now declares `OnBeforeUnloadEventHandler`, converts its callback result to
  nullable DOMString, and combines `isBeforeUnloadEvent()` with
  `event.type === 'beforeunload'`. A non-null result requests cancellation and
  supplies the string only when the event's current string is empty. A false
  callback result becomes `"false"`, not the ordinary handler's boolean false.
  Window/body/frameset attributes and lazy content-handler compilation share
  these rules. See the [handler audit](../../../scripting/ROADMAP.md#html-8181-beforeunload-handler-processing).
- HTML's [steps to fire beforeunload](https://html.spec.whatwg.org/multipage/browsing-the-web.html#steps-to-fire-beforeunload)
  must bracket dispatch with the Document unload counter and event-loop termination
  nesting level. The trusted event is cancelable and targets **Window**, without
  PageTransitionEvent's legacy Document override. The producer must retain the
  event alongside the boolean dispatch result to inspect its string afterward.
- Prompt admission still requires the already-shown check, sandboxed-modals
  policy, sticky activation, cancellation or a nonempty string, and user-agent
  nuisance policy. BiDi prompt notifications, confirmation UI, pausing, and the
  caller's navigation decision remain unfinished. The string is a request, not
  customizable dialog text; a synthetic dispatch alone cannot show a prompt.

`node-compat/experimental/before-unload-event.mjs` was run on 1 November with
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on factory
defaults/case folding, nonconstructibility, DOMString conversion, independent
string/cancellation state, retention across `initEvent()`, borrowed accessors,
and explicit author dispatch. No new SPEC_CLASH was needed for this interface.

## Validation

`test/browlet/browsing/history-events.test.ts` covers projected construction,
conversion/order, unchanged state identity, borrowed getters, readonly attributes,
legacy initialization, and the trusted internal-event boundary. Existing
`navigation-updates.test.ts` covers NavigationCurrentEntryChangeEvent and its
connected producer. All 29 tests across those two suites pass on Node 24.19.0,
Node 26.8.1, and custom Node 27.0.0-pre, with and without the addon. The wider
Node 26/compat run also includes StorageEvent, DOM events, Web IDL registration,
and import-hierarchy checks: 175 tests pass across seven suites. Typechecking,
type-contract tests, touched-file lint, import checks, and whitespace checks
pass. No expected failures or skips were added; no addon or engine build was needed.

After grouping the API under `navigation/api/` and moving the current-entry-change
payload here, all 467 selected Navigation, history-event, handler, and hierarchy
tests pass on Node 26/compat. Typechecking, type contracts, lint, and import checks
also pass; the move changes ownership paths without changing event behavior.

The PageSwapEvent slice adds 11 focused cases. Its suite and the 13 history-event
cases pass in all six Node 24.19.0/26.8.1/custom stock/compat configurations.
The wider Node 26/compat check passes 159 tests including NavigationActivation
and the hierarchy. Typechecking, type contracts, touched-file lint, import checks,
and whitespace checks pass. No new expected failures or skips were introduced.

The PageRevealEvent slice adds nine cases for construction/conversion, retained
and cross-realm transition identity, borrowed getters, trusted internal delivery,
and the legacy-factory boundary. All 33 tests across the history-event,
PageSwapEvent, and PageRevealEvent suites pass in the same six runtime
configurations. Typechecking, type contracts, touched-file lint, import checks,
and whitespace checks pass. No expected failures or skips were added; no addon
or engine build was needed.

The PageTransitionEvent slice adds 12 tests and updates the eight-test Navigation
reactivation suite to use the real firing method. All 20 tests pass in the six
Node 24.19.0/26.8.1/custom stock/compat configurations. The combined history,
PageSwapEvent, PageRevealEvent, PageTransitionEvent, and reactivation check passes
53 tests on Node 26/compat. Typechecking, type contracts, touched-file lint,
import checks, and whitespace checks pass. No expected failures or skips were
added, and no addon or engine rebuild was needed.

The BeforeUnloadEvent slice adds 12 tests, including the ordinary Event legacy
cancellation assertions moved from implementation-only tests to the projected API.
All 34 tests across its suite and DOM Event/EventTarget pass in the same six runtime
configurations. The broader Node 26/compat run passes 98 tests across nine event,
handler, and reactivation suites. The generated-type contract verifies Event
assignability, dispatch, and the absence of an author constructor. Typechecking,
type contracts, touched-file lint, import checks, and whitespace checks pass.
No expected failures or skips were added, and no addon or engine build was needed.
