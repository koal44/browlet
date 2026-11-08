# Window roadmap

## Present

- `window.ts`: Window implementation and its current Web IDL contributions.
- `opening.ts`: window-open coordination and private feature/noopener helpers,
  reached through `BrowletEnvironment.openWindow()`. Existing special targets work;
  new-target creation and navigation/history effects remain explicit dependencies.
- `window-proxy.ts`: internal handle retaining the stable platform identity and
  paired Window association across navigation.
- `location.ts`: Location identity, URL accessors, and navigation preparation.
- [`../../integration/web-idl/bindings/cross-origin.ts`](../../integration/web-idl/bindings/cross-origin.ts):
  HTML's shared cross-origin algorithms and the Web IDL security check.
- [`../../integration/web-idl/bindings/window-proxy.ts`](../../integration/web-idl/bindings/window-proxy.ts):
  native Window caller selection and foreign property dispatch.

## HTML §7.2.1: cross-origin objects

Audited against HTML `939677714df7379fee3667040113b41c91c851e7` (26 October 2026),
[§7.2.1](https://html.spec.whatwg.org/multipage/nav-history-apis.html#cross-origin-objects).
The preamble introduces platform-object access rules. The algorithms manipulate
descriptors, realm-owned functions, and Web IDL invocation, so they live at the
HTML/Binding boundary. `CrossOriginObjectBinding` supplies the descriptor
algorithms in its bound context; the prepared security policy receives the
invoked function's context.
Window and Location implementations do not retain Binding Context.

### Annotation proof of concept

`check-in C` (`b1dc7a35`) preserves the complete explicit permission tables.
The current experiment derives permissions from existing declarations:
`[CrossOriginObject]` opts an interface into HTML's security rules;
`[CrossOrigin]` permits an operation call or an attribute getter;
`[CrossOrigin=Setter]` and `[CrossOrigin=(Getter,Setter)]` specify accessor permissions.
Unannotated members on a protected interface still require same-origin-domain.
These are project annotations prepared through `htmlExtendedAttributeHooks` when
the binding world is assembled. Web IDL selects the actual receiver's prepared
security policy and invokes it with the called function's binding context.

Preparation caches the assembled interface's annotated members, including partials
and mixins, and merges overloads into one property. The shared descriptor and
invocation algorithms remain in use. Window-name lookup is a method on the same
binding and reads its assembled Window through that preparation, so permissions
and accessible names include the same partial and mixin contributions.

Annotations now cover Window's `window`, `self`, `location`, `close`, `closed`,
and `frames`, and Location's `href` setter and `replace` method. Declaration
coverage does not imply completed behavior: `close` and Location navigation
still reach explicit unfinished dependencies. The complete permission and
complete key-list tests remain expected failures while other Window declarations
are absent. The non-callable `close` descriptor test is now an ordinary passing
test, alongside the accessor, Location, and fallback coverage.
[`cross-origin-annotations.test.ts`](../../../../test/browlet/browsing/window/cross-origin-annotations.test.ts)
checks the pattern separately, including inherited members, registration without
an environment-initializer hook, real bindings, and unsupported annotations.

| Passage | Implementation and remaining dependency |
| --- | --- |
| §7.2.1.1, security check | Prepared from interface/member annotations during binding-world assembly. Window/Location receivers are checked by operation kind against the allowlist, otherwise requiring same-origin-domain. Other platform objects are unaffected. Borrowed functions use the invoked function's realm and the receiver's relevant environment. |
| §7.2.1.2, descriptor map | Lazy empty maps retain descriptors per object, caller environment, and property. The object's binding record fixes its relevant environment. Weak keys permit collection without dropping observable function identity; there is no optional eviction on `document.domain` changes. |
| §7.2.1.3.1, properties | The annotation proof derives records from declared members: Window coverage is partial; Location has both permitted members. The Window property-name predicate also includes Web IDL array indices. Numeric lookup and cross-origin proxy access remain §7.2.3 work; §7.2.2.3 supplies ordinary named child lookup. |
| §7.2.1.3.2, fallback | Only `then` and the three specified well-known symbols produce the undefined-valued descriptor. Other keys throw a current-realm SecurityError. |
| §7.2.1.3.3, same origin | Compares current and relevant origins using same-origin-domain, preserving opaque identity and two-sided domain relaxation. |
| §7.2.1.3.4, descriptors | Configurable, non-enumerable descriptors with read-only method values. Required functions are freshly created from declared IDL steps in the current realm, then cached. Author replacements cannot replace those steps; non-callable original method values follow the written algorithm. |
| §7.2.1.3.5–6, get/set | Dispatch through the object's own-property internal method, preserving the supplied receiver, return values, and abrupt completions. An absent getter/setter throws SecurityError. |
| §7.2.1.3.7, keys | Allowed property names followed by `then`, `Symbol.toStringTag`, `Symbol.hasInstance`, and `Symbol.isConcatSpreadable`, in that order. |

`RealmBinding.createMemberFunction()` supplies fresh getters, setters, and
operations without reading author-modified prototype properties. The IDL member's
conversion, overload, receiver, result-projection, and exception behavior is reused.
Name and length match the IDL member, as required by the corresponding upstream
`html/browsers/origin/cross-origin-objects/cross-origin-objects-function-{name,length}.html`
WPT tests. Local coverage is in
[`security.test.ts`](../../../../test/browlet/browsing/window/security.test.ts) and
[`member-function.test.ts`](../../../../test/web-idl/binding/member-function.test.ts).
The borrowed `document` getter regression failed before the security hook was wired.

WindowProxy and Location now select the current binding through native context
capture before entering their shared algorithms. Location also supplies ordinary
descriptor access without recursively entering its exotic method. Stock Node
retains the [execution-context limitation](../../../LIMITATIONS.md#scheduling-and-callback-context);
the invoked member's realm is only sufficient inside Web IDL invocation.
Window's undeclared `focus` and `blur` remain explicit dependencies. They do
not contribute permissions or descriptors in the annotation proof of concept.
Location's URL setters, `assign()`, and `replace()` prepare navigation inputs
before reaching the navigation dependency; reload remains unfinished.

## HTML §7.2.2: Window preamble and foundations

Audited the [preamble](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-window-object)
against the same HTML revision above. This pass stops before §7.2.2.1,
opening and closing windows. The full IDL block introduces APIs whose algorithms
belong to later sections; the inventory below records those dependencies without
claiming their algorithms have been audited.

| Requirement | Owner and result |
| --- | --- |
| Global Window inheriting EventTarget | `windowIDL` uses the existing global binding and EventTarget implementation. Its named getter feeds Web IDL's NamedPropertiesObject on the prototype chain; supported names and results are covered below in §7.2.2.3. Indexed access belongs to WindowProxy, not an indexed Window getter. |
| Associated Document and initial-about:blank reuse | `WindowImpl` retains its Document. Browsing-context creation attaches the first Document; `Navigable.createAndInitializeDocument()` reuses that Window only for a same-origin-domain navigation from the initial about:blank Document. Ordinary navigation creates another Window and realm while retaining the proxy. |
| Window browsing context and navigable | Derived getters read the associated Document. An inactive Window can retain its browsing context while its navigable is null. No duplicate mutable association is introduced. |
| `window`, `self`, and `frames` | All return the relevant realm's retained WindowProxy handle, including after the Document loses its browsing context. `frames` now has its own Replaceable IDL accessor and cross-origin getter permission. Obsolete proxy fallbacks no longer resurrect deleted `self` or `frames` properties. |
| `document` and `Document.defaultView` | The former returns the associated Document; the latter returns its browsing context's proxy or null. Existing implementations satisfy these steps, including the distinct detached-Document result. |
| `HTMLDocument` | `Document`'s existing LegacyWindowAlias machinery exposes the same realm's Document interface object with writable/configurable/non-enumerable flags. The annotation belongs to the primary declaration because Web IDL does not permit it on partial interfaces; HTML's actual partial members remain separate. |

[`window.test.ts`](../../../../test/browlet/browsing/window/window.test.ts)
covers the aliases, replacement/deletion, borrowed cross-origin `frames`
accessors, and detached browsing-context behavior. The descriptor, detached
getter, constructor-alias, and deletion expectations failed before their fixes.
[`document-lifecycle.test.ts`](../../../../test/browlet/browsing/navigation/document-lifecycle.test.ts)
covers initial-about:blank reuse, ordinary Window replacement, the changing
navigable association, and stable proxy/defaultView identity.

### Remaining IDL dependencies

| Members or declaration | Owner and remaining work |
| --- | --- |
| `name`, `open`, `close`, `closed`, `stop` | Declared in the §7.2.2.1 pass below. Name/closed behavior is implemented; opening, closing, and stopping retain explicit lifecycle dependencies. |
| `length` | Declared and implemented in §7.2.2.2 below; numeric access still needs §7.2.3's proxy algorithms. |
| Named getter | §7.2.2.3 now supplies child WindowProxy results, eligible name-bearing elements, IDs, live HTMLCollection results, and supported-name ordering; see the audit below. |
| `top`, `opener`, `parent`, `frameElement` | Declared and implemented in §7.2.2.4 below; automatic child/opener lifecycle producers remain unfinished. |
| Six BarProp attributes and `status` | Declared and implemented in §7.2.2.5 below, with one inactive-context specification gap. |
| `location`, `history`, `navigation` | Respectively §§7.2.4, 7.2.5, and 7.2.6. Location, History attributes/methods, and the replaceable Window-owned Navigation API are exposed. [Synchronous URL/history updates](../navigation/ROADMAP.md#html-744-non-fragment-synchronous-navigations) now commit through real Navigation events; queued history application, automatic focus/scroll, and lifecycle integration remain unfinished. |
| `customElements` | [Custom elements](../../dom/nodes/html/custom-elements/ROADMAP.md) owns the registry implementation and state; Window's getter/exposure is still missing. |
| `focus`, `blur` | [Interaction](../../interaction/ROADMAP.md) owns focusing and user-activation dependencies; Window declarations are absent. |
| `navigator`, `clientInformation` | [Navigator](../../navigator/ROADMAP.md), HTML §8.10; per-Window identity, the Replaceable alias, and NavigatorID are implemented. Other Navigator families retain their own dependencies. |
| `originAgentCluster` | Implemented and exposed in the [§7.1.2 audit](../ROADMAP.md#same-origin-relaxation-origin-and-origin-keyed-clusters). |
| `alert` overloads, `confirm`, `prompt`, `print` | Window bindings and local algorithms are connected in [user prompts](../../scripting/ROADMAP.md#html-user-prompts-simple-dialogs) and [printing](../../scripting/ROADMAP.md#html-user-prompts-printing). Dialog UI, physical-form rendering/output, and BiDi sessions remain explicit dependencies. |
| `postMessage` overloads and `WindowPostMessageOptions` | [Communication](../../communication/ROADMAP.md), HTML §9.3; integrated declarations, target-origin handling, and delivery use the shared structured-data algorithms. Caller attribution and WindowProxy descriptor dispatch remain dependencies. |
| GlobalEventHandlers and WindowEventHandlers includes | HTML's general and Window handlers use the shared map, with body/frameset forwarding and lazy content attributes. Beforeunload's special callback conversion and return-value processing are connected in [scripting](../../scripting/ROADMAP.md); navigation's dispatch, counters, and prompt admission/UI remain unfinished. |
| Obsolete Window partial | [Legacy HTML](../../html/legacy/ROADMAP.md); the IDL's reference does not bring those algorithms into this pass. |

Window script settings are audited in §7.2.2.6 below. Complete proxy behavior
(§7.2.3) and Location exotic behavior (§7.2.4) remain separate audits, building on
the environment/realm composition and §7.2.1 checks.

## HTML §7.2.2.1: opening and closing windows

Audited [§7.2.2.1](https://html.spec.whatwg.org/multipage/nav-history-apis.html#apis-for-creating-and-navigating-browsing-contexts-by-name)
against the same HTML revision. The implementation covers Window state, feature
algorithms, and the opening flow. Empty-URL calls to existing `_self`, `_parent`,
and `_top` targets work. **New-window creation, navigation, closing, and stopping
are not yet functional end to end.** The remaining §7.2.2 audits follow below.

The Window binding calls `BrowletEnvironment.openWindow()` on the entry
environment. `opening.ts` is transitional: it exports only that algorithm body;
tokenization, normalization, boolean parsing, and popup/noopener helpers remain
private. Rehouse the algorithms as the navigation owners are completed.

| Passage | Implementation and remaining dependency |
| --- | --- |
| Introductory API descriptions and feature example | All five APIs have their specified IDL declarations. `name` and `closed` are functional; the three operations have explicit missing-work boundaries below. |
| Get noopener for window open | `getNoopenerForWindowOpen()` compares a resolved Blob registration's creator origin with the source environment's top-level origin using schemeful same-site. A cross-site Blob forces true even for `noopener=0`. Otherwise the parsed feature decides. Opaque identity is preserved. |
| Window-open entry and URL handling | Binding supplies the modeled entry environment, using the operation environment for direct host calls, as Origin.from does. `openWindow()` returns null when termination nesting is nonzero and uses the entry Document's encoding/base for URL parsing; invalid URLs throw a realm-owned SyntaxError DOMException. The new EventLoop counter starts at zero; unloading must maintain it. |
| Feature processing and target selection | Empty targets normalize to `_blank`; features are tokenized, `noreferrer` and noopener are parsed and removed, and noreferrer forces noopener and `no-referrer`. `Navigable.chooseNavigable()` supplies the target/window-type pair through existing lookup or [new-target selection](../navigation/ROADMAP.md#html-7317-new-target-selection). Policy, consumption, COOP/noopener, sandbox bookkeeping, auxiliary context creation, and familiarity are implemented; activation lookup and sandbox permission remain dependencies. A null result returns immediately without target effects. |
| New/existing target branches | New targets receive popup classification, CSSOM View feature setup, default about:blank, and URL/history update versus navigation. Existing targets navigate for a nonempty URL and update their current browsing context's opener when permitted. Both branches supply exception/referrer inputs and apply the final window-type/noopener/special-target return rules. `BrowsingContext.setUpFeatures()` still throws; `DocumentImpl.updateURLAndHistory()` now commits synchronously before queued history application. `Navigable.navigate()` retains explicit population/abortion dependencies. Creator inheritance and opener session-storage cloning are connected through the context/top-level factories. |
| Feature tokenizer and separators | `tokenizeWindowFeatures()` consumes ASCII whitespace, equals signs, and commas with the specified boundaries. It ASCII-lowercases names/values and normalizes aliases before updating an insertion-ordered Map; duplicate values replace without reordering. Non-ASCII whitespace is retained. |
| Boolean features and popup classification | Empty/yes/true are true; all other values use HTML's exact integer-prefix parser, with errors/zero false. Missing features take the caller's default. Popup classification honors explicit `popup`, then location/toolbar, menubar, resizable, scrollbars, and status in specification order. Opening removes noopener/noreferrer before classification and feature setup. |
| Legacy feature names | screenx/screeny/innerwidth/innerheight normalize to left/top/width/height. Other names survive, including unknown features that can affect popup classification. |
| Name accessors and reset note | `Navigable.targetName` reads its active history entry. Window's setter updates that entry; an inactive Window reads empty and ignores writes. Existing navigation carries names across same-origin navigation and resets them for the supported cross-origin case; tests cover both. |
| Close and script-closability | `close()` returns for a non-top-level, inactive, or already-closing Window. `Navigable.isScriptClosable` implements top-level plus web-created-or-one-entry. Actual closing stops explicitly before source snapshotting: transient activation, incumbent familiarity, and sandbox navigation permission are required before setting isClosing and queueing `TopLevelTraversable.definitelyClose()` on the DOM manipulation task source. That coordinator retains the context through unloading for final cleanup, but unloading/cancellation, recursive destruction, and traversal execution remain explicit dependencies. |
| Closed getter | True for a null navigable or a navigable already closing; false otherwise. Uses the receiver's current associated Document, including a retained inactive Window. Cross-origin reads are permitted. |
| Stop | Returns for a null navigable, otherwise calls `Navigable.stopLoading()`. That dependency explicitly throws until unload-counter handling, ongoing-navigation cancellation without canceling traversal, and document/descendant abortion exist. Calling Document.abort() alone would omit required work. |

The declaration-level `[CrossOrigin]` annotations permit `close()` and `closed`
reads; `name`, `open()`, and `stop()` retain the ordinary same-origin-domain check.
Full proxy security remains §7.2.3 work. No permission, activation, popup-blocking,
or unloading decision is replaced with a permissive default.

`Navigable.navigate()` accepts the URL, source Document, and a reviewed options
record containing every remaining specified input. Defaults are documented beside
`NavigateOptions` until navigation is implemented. The Navigation
API tracker is an explicit opaque dependency; its record/lifecycle and navigation
effects remain [navigation work](../navigation/ROADMAP.md#missing).

[`opening.test.ts`](../../../../test/browlet/browsing/window/opening.test.ts)
exercises projected accessors, inactive Windows, history-name behavior, early
close/stop returns, script-closability, and Window-open conversion/entry/URL
checks, including distinct parent/top destinations in a constructed navigable
tree. Stop delegation is tested with its unfinished navigable operation
controlled; it is not an end-to-end cancellation test.
[`window-features.test.ts`](../../../../test/browlet/browsing/window/window-features.test.ts)
covers tokenizer boundaries/order, boolean/popup branches, actual Blob
registrations under same-site/cross-site/opaque top-level origins, and opening's
new/existing target effects and return rules. All feature tests call the projected
`Window.open()` API and observe its inputs to the unfinished owners; they do not
export helpers for tests or claim end-to-end target creation/navigation coverage.
The name/closed and existing special-target expectations failed before their
implementation. No new expected failures or skips were added.

## HTML §7.2.2.2: indexed access

Audited [§7.2.2.2](https://html.spec.whatwg.org/multipage/nav-history-apis.html#accessing-other-browsing-contexts)
and its document-tree child-navigables dependency against the same HTML revision.

| Passage | Implementation and remaining dependency |
| --- | --- |
| `length` API description and getter | `WindowImpl.length` counts its associated Document's current document-tree child navigables. Its unsigned-long IDL attribute is Replaceable and permits cross-origin getters; replacement retains the ordinary security check. |
| Document-tree child navigables | `DocumentImpl.getDocumentTreeChildNavigables()` returns an empty list without a node navigable, otherwise collects non-null iframe/object/embed/frame content navigables in descendant tree order. Shadow trees and nested Documents are excluded. It recomputes the list so insertion, removal, reordering, and association changes are visible immediately. |
| `window[index]` API description and proxy reference | The section delegates indexed lookup to WindowProxy's §7.2.3 `[[GetOwnProperty]]`. The passes below supply values/descriptors in container insertion order and the live child-index key prefix on stock Node. Foreign key filtering, write/delete rules, and cross-origin out-of-range handling remain explicit proxy work. No indexed getter is added to Window's IDL. |

Object and legacy frame implementations now retain the same initially-null
`contentNavigable` state as iframe. The §7.2.2.4 pass below connects their reverse
container associations. Connected insertion now records container order, including
before child creation. Loading/creation/destruction producers remain unfinished.
Tests supply real child navigables at these associations;
creating or appending a container alone does not create a child browsing context.

[`indexed-access.test.ts`](../../../../test/browlet/browsing/window/indexed-access.test.ts)
covers empty/live counts, all three container kinds, tree ordering, association
changes, shadow and nested-Document exclusion, detached/inactive Documents,
Replaceable behavior, and borrowed cross-origin getter/setter checks. The initial
zero-length expectation failed with `undefined` before implementation. The additional
numeric WindowProxy tests are described below; full child creation remains unfinished.

## HTML §7.2.2.3: named access

Audited [§7.2.2.3](https://html.spec.whatwg.org/multipage/nav-history-apis.html#named-access-on-the-window-object)
against the same HTML revision. Lookup stays on `WindowImpl`; the existing
Web IDL NamedPropertiesObject supplies the prototype-chain behavior.

| Passage | Implementation and remaining dependency |
| --- | --- |
| API introduction | Names resolve dynamically. The spec's warning about fragile name collisions is author guidance; real global and prototype members continue to shadow named elements. |
| Child target-name property set and duplicate-name example | The first nonempty target name wins in document tree order, then same-origin filtering applies. A cross-origin first child therefore hides a later same-origin child with the same name. The comparison uses origin, not relaxed origin-domain, and observes name/origin changes without a DOM mutation. |
| Supported property names | Collect eligible child target names, nonempty `name` attributes of HTML embed/form/img/object, and IDs of all elements in contributing-element tree order, ignoring later duplicates. Attributes are unnamespaced and values are case-sensitive. Shadow trees, separate DocumentFragments, child Documents, and detached elements do not contribute. |
| Named objects and value selection | Child navigables matching the target name take priority over elements; select the first container in document tree order and return its active WindowProxy. Otherwise return the sole matching element or a stable live HTMLCollection. One element matching both name and ID appears once. Unlike Document named access, object/embed exposure does not restrict Window matches. |
| Origin filtering versus value selection | The origin filter only governs the child-name contribution to supported names. If an eligible element independently supplies the name, the named-objects algorithm can still select a cross-origin child. Tests retain that distinction. |
| Collection and binding behavior | Collections stay rooted in their original Document and update with tree/attribute mutations. Reusing an initial Window clears its lookup cache for the replacement Document. The IDL still serializes as `getter object`; its typed result union supplies projection of Element, HTMLCollection, or WindowProxy. Named descriptors remain inherited, nonenumerable, writable, and configurable; the NamedPropertiesObject retains ordinary own-key enumeration. |

`SPEC_CLASH(window-named-child-origin)`: Browlet follows HTML's same-origin-only
child-name contribution, as reviewed with Eric. Blink's
[`WindowProperties::AnonymousNamedGetter`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/window_properties.cc)
and Gecko's
[`ShouldExposeChildWindow`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/WindowNamedPropertiesHandler.cpp)
also expose a cross-origin child when its target name matches the container's
`name` attribute. This evidence comes from the local browser sources, not a live
browser probe. The regression expects HTML's result even for a matching container
name; no browser-compatibility exception is added.

Child creation, destruction, navigation, and container-name propagation still
need their [navigation owners](../navigation/ROADMAP.md#missing). Tests connect
real child implementations at the retained iframe/object/frame associations;
appending a container alone does not create a child. Full WindowProxy security,
caller-realm selection, and COOP access reporting remain §7.2.3 dependencies.
Template contents are separate trees in HTML, but the
[template implementation](../../dom/nodes/html/ROADMAP.md) lacks its contents
fragment and the [parser hooks](../../html/parser/ROADMAP.md) explicitly throw.
Fragment-root exclusion is covered; template integration needs those producers.

[`named-access.test.ts`](../../../../test/browlet/browsing/window/named-access.test.ts)
covers eligibility, namespaces, duplicates, tree ordering, collection identity
and mutation, all three child containers, child-origin/name changes, origin-domain
distinctions, shadow/inactive-document handling, property visibility, author
evaluation, and initial-Window reuse. The form-name and duplicate-ID collection
expectations failed before implementation. No expected failures or skips were added.

## HTML §7.2.2.4: accessing related windows

Audited [§7.2.2.4](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigating-nested-browsing-contexts-in-the-dom)
against the same HTML revision.

| Passage | Implementation and remaining dependency |
| --- | --- |
| `top` and `parent` | Return the active proxy of the outermost or immediate-parent navigable, respectively; a top-level parent is itself. Both return null without a Window navigable, including inactive/detached Windows. Top is LegacyUnforgeable; parent is Replaceable. Their real declarations replace the last proxy self fallbacks. |
| `opener` | Reads the browsing context's retained opener, which can survive while the Window's navigable is null. A null assignment disowns it. Any non-null assignment defines an ordinary writable/enumerable/configurable property at the IDL boundary without changing the relationship. Failed replacement requests a TypeError in the setter realm. |
| `frameElement` | Reads the actual navigable container and returns it only when its node Document is same origin-domain with the getter's current environment. No container/navigable returns null. Web IDL supplies the invoked getter environment separately from the receiver environment, including borrowed getters. Ordinary Window security still applies before these steps. |
| Removal example and container dependency | Iframe/object/frame content-navigable setters retain the reverse container link, including clearing, replacement, and reassociation. Document full activity now follows the actual container Document recursively. Automatic child creation/destruction, removal-triggered context clearing, and ancestor-activity notification propagation remain navigation work. The example's null results are covered after explicit context clearing, not by claiming removal already destroys a child. |
| Cross-origin access | Top/opener/parent getters carry the permitted CrossOrigin annotations; opener/parent setters and frameElement remain protected. Full proxy dispatch and caller attribution remain §7.2.3 work. |

[`related-windows.test.ts`](../../../../test/browlet/browsing/window/related-windows.test.ts)
covers nested destinations, descriptors, replacement/deletion, opener disowning,
borrowed getters/setters, detached/inactive Windows, all three container kinds,
domain relaxation, association changes, and a container left in an inactive parent
Document. The child-parent and ancestor-activity regressions failed before the fix.
The getter environment contract also has direct Web IDL and ReflectSetter adapter
regressions; the latter exposed and fixed a Binding Context being passed to a
declaration getter expecting an environment.

## HTML §7.2.2.5: historical browser interface element APIs

Audited [§7.2.2.5](https://html.spec.whatwg.org/multipage/nav-history-apis.html#browser-interface-elements)
against the same HTML revision. Each Window owns six distinct, stable BarProp
implementations. Their Replaceable attributes use ordinary IDL projection;
replacement does not replace the retained implementation. BarProp is exposed
without a public constructor. All six visible getters read the top-level browsing
context's current popup flag. Status stores only its converted string, initially
empty; it has no browser-interface effect. Initial-Window reuse preserves these
objects and status.

`SPEC_CLASH(detached-barprop-visible)`: follow HTML and Gecko's true result when
the relevant Window has no browsing context, as reviewed with Eric. Local
[`BarProps.cpp`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/BarProps.cpp)
returns true for a missing/discarded context; Blink's
[`bar_prop.cc`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/bar_prop.cc)
and WebKit's
[`BarProp.cpp`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/BarProp.cpp)
return false without a live frame.
This is source evidence, not a live browser probe.

`SPEC_GAP(barprop-inactive-context)`: the visible getter only handles a null
Window browsing context, then dereferences its top-level context. However,
[`top-level browsing context`](https://html.spec.whatwg.org/multipage/document-sequences.html#bc-tlbc)
returns null when the context's active Document is not fully active. HTML supplies
no boolean for that case. Gecko's implementation instead walks to its top context;
Blink/WebKit consult their live frame/page. Browlet leaves this case explicitly
unfinished with an InternalError pending a specification/browser decision.
Child destruction will eliminate some such states, but is not yet implemented.

[`bars.test.ts`](../../../../test/browlet/browsing/window/bars.test.ts) covers
object identity, exposure, replacement, popup changes through a child Window,
detachment, borrowed visible getters, status conversion, Window security, and
initial-Window reuse. No new expected failures or skips were added.

The wider scripting/binding validation found three existing borrowed-call failures
in `global-scope.test.ts`, `runtime-errors.test.ts`, and `structured-clone.test.ts`.
Their different-origin Window fixtures encounter the existing SecurityError check
before the intended receiver-ownership assertions. All three reproduce against
the starting commit's source; they remain ordinary failures, outside this slice.

## HTML §7.2.2.6: script settings for Window objects

Audited [§7.2.2.6](https://html.spec.whatwg.org/multipage/nav-history-apis.html#script-settings-for-window-objects)
against the same HTML revision. The existing Window environment composition
supplies most of this algorithm; the fix adds the missing inactive-Document
checks before Permissions Policy evaluation.

| Passage | Implementation and remaining dependency |
| --- | --- |
| Realm, global, and realm execution context | `createWindowEnvironment()` composes the realm, Window, and settings. `realmExecutionContext` returns that realm's retained context; creation leaves the agent's execution-context stack restored. No additional execution record is allocated for settings. |
| Document-dependent algorithms | Module map, API base URL, origin, and policy container query the Window's current associated Document. They follow initial-about:blank Document replacement without replacing the Window's settings. Time origin reads the current Document's navigation start through the existing HRT `Moment` representation. |
| Has cross-site ancestor | `Document.hasCrossSiteAncestor` walks the live parent chain. Comparing each ancestor with the current origin is equivalent to HTML's recursive parent comparisons because same-site is transitive, including opaque-origin identity. It ignores document.domain relaxation. The null-navigable case is recorded below. |
| Cross-origin isolated capability | None/logical isolation returns false. Concrete isolation calls `Document.isAllowedToUse('cross-origin-isolated')`, which returns false without a browsing context or full activity, then checks the Document's inherited/declared/default policy and reports actual violations. |
| Reserved environment | Copies ID, target browsing context, and active service worker into the new settings, then clears the reserved ID. Service Worker lookup/control and failed-navigation discarding remain their owners' lifecycle work. |
| No reservation | Creates a fresh opaque ID with null target browsing context and active service worker. Execution readiness remains false until the separate document-initialization step. |
| Creation inputs and HostDefined | Retains the supplied creation URL, top-level creation URL, and top-level origin. `realm.env` is the modeled HostDefined link to these settings. These identities survive initial-Window reuse. |

The reviewed factory accepts a `WindowEnvironmentInit` record and combines
realm/global creation with settings setup. It selects the retained context from
the realm it creates instead of accepting a separate execution-context argument.

`SPEC_GAP(window-settings-inactive-ancestry)`: HTML dereferences the Window's
navigable without specifying a result when that navigable is null. Browlet keeps
its existing conservative true result, so a detached/inactive Document does not
establish a same-site cookie context. Blink's
[`Document::SiteForCookies`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/dom/document.cc)
similarly returns an empty cookie site without a frame. That is source evidence
for missing-frame behavior, not a live probe of every inactive-Window state.

[`settings.test.ts`](../../../../test/browlet/browsing/window/settings.test.ts)
covers live settings after initial-Window reuse, retained creation/context
identity, and isolation mode/activity boundaries. The three inactive concrete
isolation cases failed before the fix. Existing
[`document-lifecycle.test.ts`](../../../../test/browlet/browsing/navigation/document-lifecycle.test.ts)
covers reserved-state transfer and now checks fresh identities, the retained
context, and HostDefined association.
[`environment.test.ts`](../../../../test/browlet/environment.test.ts) covers
live schemeful ancestor checks and their Fetch-cookie consumer. No new expected
failures or skips were added. Full Permissions Policy, child lifecycle, and
Service Worker integration are not established by these settings tests.

## HTML §7.2.3: WindowProxy foundations and extensibility

Audited the [preamble and §§7.2.3.1–4](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-windowproxy-exotic-object)
against the same HTML revision. Native Window access checks now supply the executing
caller to the HTML binding. The [production guard](#native-window-access-guard)
connects foreign property access and records the accepted Chromium differences;
stock caller selection and same-origin COOP reporting remain unfinished.

| Passage | Implementation and remaining dependency |
| --- | --- |
| Stable identity and [[Window]] | `WindowProxyHandle.platform` stays fixed while `associatedWindow` changes on navigation. Binding unwraps receivers through the current association. No WindowProxy interface object is exposed. Existing navigation tests and the new rejection/navigation case cover this lifecycle. |
| Ordinary target note | The specification permits dispatch through the Window's methods while it behaves as an ordinary object. Stock Node uses Reflect forwarding and Web IDL's global prototype behavior; its nonconfigurable-descriptor accommodation remains necessary for JavaScript Proxy invariants. |
| §7.2.3.1, [[GetPrototypeOf]] | Native same-origin access returns Window.prototype; foreign access returns null. Stock traps still lack automatic caller selection. |
| §7.2.3.2, [[SetPrototypeOf]] | Same-origin access rejects changing the immutable prototype. Foreign native mutations throw SecurityError, following Chromium rather than HTML's comparison against the visible null prototype: `SPEC_CLASH(window-foreign-prototype)`. Explicit caller-bound helpers retain the HTML algorithm. |
| §7.2.3.3, [[IsExtensible]] | Both backends return true. |
| §7.2.3.4, [[PreventExtensions]] | Same-origin Reflect returns false; Object.preventExtensions/seal/freeze throw TypeError. Foreign native mutations throw the accessing realm's SecurityError under the same Chromium choice. Neither path makes the Window non-extensible. |

**Caller boundary:** V8 captures the accessing context before entering the Node
host callback. JS Engine resolves its existing realm reference; HTML's
[`getWindowProxyAccess()`](../../integration/web-idl/bindings/window-proxy.ts) selects the caller's
registered binding and invokes `CrossOriginObjectBinding`. A B-authored function
or borrowed B Reflect operation therefore selects B, including when entered from
A. Native checks exempt only the exact Node composition context; an unregistered
author context is not treated as privileged. Context extras retain the selector
through garbage-collected edges, without a separate Window registry.

Stock traps still cannot infer every author/built-in realm transition from the
modeled execution stack. The earlier probe at `5a165edd` observed A instead of B
for B-authored and borrowed-built-in calls, while controlled nested evaluation
selected B correctly. The execution-context experiment `956bde8f` remains parked
on `research/ged-modeled-execution-context`. It is not needed by the native guard;
the stock dependency and same-origin native reporting remain explicit follow-up.

**Native boundary:** the actual global proxy bypasses JavaScript Proxy traps.
Access checks connect its foreign property handlers to HTML, while V8 supplies
the foreign null prototype and mutation denial. The isolate-wide failed-access
callback asks the selected HTML binding to create SecurityError. This uses public
addon APIs on all supported bases; it requires no new Node/V8 patch.

[`window-proxy.test.ts`](../../../../test/browlet/browsing/window/window-proxy.test.ts)
checks exposure, own-Window prototype immutability, Reflect/Object extensibility
operations, caller-realm TypeErrors, foreign proxies, and navigation after a
rejected change. Five regression cases failed before the original fix: stock Node allowed
Reflect.preventExtensions, and Object.seal/freeze left the hidden target
non-extensible even when they threw. The foreign-mutation case now tests the
accepted native Chromium choice and is an approved stock-only expected failure.

## HTML §7.2.3: indexed child reads

Read the remaining [§§7.2.3.5–10](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-getownproperty)
against HTML revision `939677714df7379fee3667040113b41c91c851e7` (26 October 2026).
This slice implements valid-index lookup on the stock-Node WindowProxy. That
branch returns the same child identity for same-origin and cross-origin callers,
so it does not need a provisional caller-realm guess.

`DocumentImpl` retains connected insertion ordinals for iframe, object, and frame
containers. Their DOM insertion steps record the ordinal even before a child
navigable exists. Disconnected subtree assembly does not set an ordinal; insertion
of the subtree records its containers in traversal order. Reinsertion refreshes
the ordinal, while a state-preserving move retains it. The weak keys do not keep
removed containers alive. Child lookup still collects the live document-tree list,
so shadow trees, disconnected containers, and null child associations are excluded.

`getIndexedChildNavigable(index)` extracts the child-selection portion of
`WindowProxy.[[GetOwnProperty]](P)` onto the Document, returning a Navigable rather
than a property descriptor. Its `SPEC_MISMATCH` marks that extraction for review.
WindowProxy owns projection to the active proxy and the descriptor flags. The
existing tree-order collection stays unchanged for named access and other consumers.

| Passage | Implementation and remaining dependency |
| --- | --- |
| §7.2.3.5, valid array index | Select the current associated Document's child in container insertion order and return its active WindowProxy. Descriptor is non-writable, enumerable, configurable. Noncanonical numeric strings and symbols retain the ordinary path. |
| §7.2.3.5, missing index and non-index properties | Native foreign access invokes the caller-bound descriptor algorithm, including missing-index SecurityError, declared descriptors, child target names, and fallback checks. Stock forwarding still lacks caller selection. |
| §7.2.3.6, [[DefineOwnProperty]] | Both automatic paths reject same-origin indexed definition. Native foreign definition throws the caller's SecurityError; stock foreign dispatch still needs caller selection. Stock nonconfigurable properties retain the Proxy invariant limitation. |
| §7.2.3.7, [[Get]], and ordinary [[HasProperty]] | Native foreign Get runs the caller-bound COOP check and CrossOriginGet; presence checks use the descriptor algorithm. Same-origin COOP reporting and stock caller selection remain unfinished. |
| §7.2.3.8, [[Set]] | Native foreign Set runs the caller-bound COOP check and requires the foreign descriptor's setter, using the target receiver under the Chromium choice. Both automatic paths reject ordinary same-origin indexed writes; the native absent-index explicit-receiver gap is recorded below. Same-origin reporting, stock caller selection, and Location navigation remain unfinished. |
| §7.2.3.9, [[Delete]] | Both automatic same-origin paths return false for present children and true for absent indices without deleting underlying stored numeric properties. Native foreign deletion throws the caller's SecurityError; stock foreign deletion lacks caller selection. |
| §7.2.3.10, [[OwnPropertyKeys]] | Both backends prefix live child indices. Native foreign enumeration adds declared cross-origin keys and fallback symbols; stock enumeration lacks caller filtering. Missing focus/blur declarations remain covered by the completeness expected failure. |

Native global proxies bypass these JavaScript traps. Both backends use Window's
child lookup and length, with WindowProxy supplying indexed descriptors. Window
composition supplies callbacks retaining the original Window; ordinary globals
use V8's per-context store and preserve their receivers as described below.
Stock caller-realm integration and origin-sensitive filtering remain separate
work. Indexed mutations are connected below. The indexed-access suite covers both backends.
Automatic child creation/destruction remains with the element/navigation owners;
tests connect real children at the existing content-navigable association.
The generated `WindowProxy` type now adds a readonly numeric index to the declared
Window surface, as described below, without inventing an indexed Window IDL getter.

The indexed-access tests cover all three containers, descriptors, presence, foreign
callers, insertion versus tree order, subtree insertion, moves and reinsertion,
late/replaced child associations, filtering, and parent navigation. Ten new
regressions failed before implementation; all eighteen tests in that file pass
on stock Node 24. No new expected failures or skips were introduced.

### Automatic indexed mutations

HTML §§7.2.3.6, 7.2.3.8, and 7.2.3.9 now reach the automatic paths for
same-origin numeric properties. Stock traps reject assignment and definition
before touching a supplied receiver. Deletion checks the current child list:
present indices return false, absent indices return true, and neither case
changes ordinary numeric properties in the original Window store.

The native global adapter now forwards all indexed mutations to
`GlobalIndexedProperties.set`, `defineProperty`, and `deleteProperty`, including
indices without a synthetic descriptor. HTML supplies the same rejection and
child-presence rules when composing Window. The existing native interceptors
already return false and honor strict-mode throwing; this slice changes their
JavaScript adapter, with no C++ or Node/V8 patch and no binary rebuild.
Native foreign access remains subject to the existing guard before these callbacks.

`SPEC_CLASH(window-indexed-reflect-result)` follows HTML/Firefox/WebKit:
`Reflect.set(window, index, value)` and indexed `Reflect.defineProperty` return
false. Chromium returns true without changing the child or creating the indexed
property; strict assignment still throws. Returning false already works on the
existing native bridge, so this difference does not need an engine workaround.

`SPEC_CLASH(window-indexed-set-receiver)` records the native boundary for a
different explicit receiver. HTML/Firefox/WebKit reject every indexed write
before inspecting that receiver. V8's `Object::SetPropertyInternal` instead
queries interceptor attributes when the holder differs from the receiver, then
uses `SetSuperProperty`; it does not call the setter. Our read-only child
descriptor rejects present indices, but an absent index writes to the supplied
receiver. Chromium permits this receiver write for both present and absent
indices. Returning a fabricated descriptor for every absent index would change
presence and descriptor lookup, so that is not used as a workaround.

Browser-only probe `node-compat/experimental/window-indexed-mutations.mjs`
reproduces these differences in Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2 (2026-10-31). The approved boundary keeps the small integration and
records the native receiver gap without a V8 patch. Its two regression cases keep
HTML's required result as expected failures only with the addon; stock Node runs
and satisfies those same assertions normally.

The indexed-access regressions cover present/absent/boundary indices, alternate
receiver side effects, strict-mode errors, ordinary non-index controls, original
property-store preservation, same-origin callers, and navigation. Before the
repair, ten cases failed on stock Node 24 and seven with the addon; the native
adapter's focused owner-callback regression failed as well. Automatic COOP
reporting, stock caller selection, and child creation/destruction remain separate.

## HTML §7.2.3: enumeration and receivers

Rechecked [§§7.2.3.6–10](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-defineownproperty)
against published HTML (26 October 2026) on 28 October. DefineOwnProperty, numeric
Set, and Delete require the caller-origin decision before selecting false/true
versus SecurityError. Those dependencies remain at their traps and in the table;
existing forwarding remains provisional until that decision is available.

The origin-independent part of OwnPropertyKeys now enumerates the current child
indices as strings before the existing ordinary keys. It counts the associated
Document's actual child navigables rather than reading the replaceable `length`
attribute or sorting children just to count them. Removal, child-association changes,
and navigation update the prefix on each call. The ordinary tail preserves string
and symbol order; automatic selection of the foreign tail remains unfinished.
The caller-bound operation below now selects both tails. At the stock trap a Set suppresses
overlapping ordinary numeric keys, which the unfinished define/set paths and direct
stock-VM access can still create; duplicate keys would violate JavaScript Proxy
invariants. This is part of `ACCOMMODATION(node-vm-global-proxy)`.

Get and Set now retain the supplied Receiver through ordinary forwarding.
Author accessors receive the public proxy by default, or the explicitly supplied
receiver. Data writes update that receiver and respect its extensibility and type.
The stock VM's actual global inherits from the modeled proxy, so free global names
arrive with a separate VM global as receiver. On Window association the handle
weakly records that exact global identity and maps it to its public proxy, including
after navigation. Other objects are unchanged; merely inheriting from Window does
not make an object a valid IDL receiver. This accommodation does not select a caller
realm or restore the parked execution-context machinery. Stock automatic Get still
needs caller selection; both backends still need automatic same-origin COOP reporting.

Five enumeration regressions initially missed the child-key prefix. Two receiver
regressions initially observed the underlying Window as `this` and mutations of
Window even when the supplied receiver was frozen. Tests now cover these behaviors,
live key order, navigation, overlapping numeric keys, exact VM-global aliases, and
rejection of derived objects as IDL receivers. Native proxies bypass these traps;
the native repair below covers their ordinary receivers separately.

## Native Window property storage and receivers

31 October 2026. The maintained native path now stores ordinary properties on
V8's actual per-context global. Binding installs into a stable host view of that
same store; global declarations, descriptors, definitions, deletion, and keys no
longer pass through a separate Window target. Ordinary author accessors execute
with V8's actual receiver, including an explicit `Reflect.get`/`Reflect.set`
receiver. The existing WindowProxy regressions first reproduced two native
failures: accessor `this` was replaced with the internal target, and a derived
receiver incorrectly passed the `document` getter's brand check.

The view retains its original global across public-proxy reuse. Binding registers
the original global IDL getter functions through the allocation contract. Only
retired-context attribute access uses this registration: bare names select the
old Window, while `window.document` and borrowed getter calls with the reused
proxy select the replacement. Author-created getters keep their ordinary receiver.
No getter-result cache, Document association notification, or WindowImpl hook is
needed. The native capture mechanism and its lifetime constraints are documented
in [Node compatibility](../../../../node-compat/README.md#native-global-property-storage).

`SPEC_CLASH(retained-window-attributes)`: preserve original-Window ownership,
as Eric selected. ECMAScript's [Object Environment Record GetBindingValue](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html#sec-object-environment-records-getbindingvalue-n-s)
reads its binding object; SetMutableBinding writes that same object. Combined
with HTML's per-Window [status](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-status)
and [navigator](https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator)
attributes and Web IDL's [receiver-based attribute getter](https://webidl.spec.whatwg.org/#dfn-attribute-getter),
Browlet interprets retained bare lookup as access to the original Window. This
does not change the receiver of explicit access through a retained public proxy.

An iframe replacement-document probe on 31 October produced:

| Browser | Retained bare `status` | Retained bare `navigator` | Retained bare status write |
| --- | --- | --- | --- |
| Chromium 156 | Replacement value | Replacement object | Updates replacement Window |
| Firefox 157 | Throws `NS_ERROR_XPC_SECURITY_MANAGER_VETO` | Neither saved object | Throws the same veto |
| WebKit 27.2 | Original value | Original object | Updates original Window |

All three retained the original bare `document`. The browser-only probe is
`node-compat/experimental/window-property-store/retained-attributes.mjs`; the
maintained regression is `test/browlet/browsing/native-global.test.ts`. The native
fixture independently exercises ordinary storage, exact receivers, retained
Document access paths, live old-owner state, capture-name collisions and TDZ, and
collection of retired/replacement contexts and views.

This property-store slice preceded the native access guard below, which now
rejects foreign Document access and controls foreign prototype reflection.
Automatic same-origin indexed mutations are connected above, with the explicit
receiver limitation recorded there. COOP access reports and stock caller selection
remain open. The property-store repair required addon rebuilds, not a Node/V8 patch.

Validation on Windows used all six runtime configurations, with four Vitest
workers. All **579 unit files** passed in each configuration:

| Runtime | Passing assertions | Existing expected failures |
| --- | --- | --- |
| Node 24.19.0, compat | 17,091 | 81 |
| Node 26.8.1, compat | 17,095 | 77 |
| Custom Node 27.0.0-pre, compat | 17,151 | 21 |
| Each of the three bases, stock | 17,003 | 169 |

Each run also retained 16 existing skips and one TODO. The full native addon
suite passed on all three bases: 277 cases on each official runtime, and 276
plus one existing skip on custom, including existing expected-failure controls.
Typecheck, type contracts, scoped ESLint, and whitespace checks passed. Initial
single-worker full-suite attempts exhausted the worker's 4 GiB heap; the completed
matrix distributed the same tests across four workers. No assertions were removed
or newly classified as expected failures.

### Native Window access guard

The 31 October guard refresh in `node-compat/experimental/window-guard/` now uses
this maintained store directly. It blocks the actual foreign-Document regression
on all three native bases, including warmed lookup. It also exposed a Node 24
own-property query that followed the reused public proxy instead of the original
global. The maintained native regression reproduces that wrong query without the
guard; `property-delegate.cc` now selects the original holder consistently.
The guard now lives in maintained `node-compat/addon/global-access.cc`, with the
HTML adapter in `integration/web-idl/bindings/window-proxy.ts`. Guarded allocation is opt-in;
ordinary addon contexts keep their existing behavior. Only the exact composing
Node context bypasses policy. The addon owns the isolate-wide failed-access
callback, reference-counted across repeated loads and removed at final environment
cleanup. V8 exposes no previous-callback getter, so competing addons replacing
that callback remain unsupported. The context retains its selector; discarded
selectors, globals, and contexts collect. See the
[native contract](../../../../node-compat/README.md#native-global-access-checks).

Window composition supplies the requested prototype layout and an accessing-realm
policy. JS Engine selects the backend, detaches and reuses native globals, and
installs the policy; HTML does not inspect addon exports. The HTML adapter is
`getWindowProxyAccess()`. Its own-key list includes index strings; JS Engine
separates those for V8's named/indexed interceptors. Stock Node returns no global
allocation and retains the explicitly limited modeled-proxy path.

The accepted choices are marked beside the production dispatch:

- `SPEC_CLASH(window-foreign-receiver)`: Chromium uses the target for ordinary
  foreign Get/Set even when Reflect supplies another receiver. HTML, Firefox,
  and WebKit preserve that receiver. Browlet follows Chromium at this native
  boundary; same-origin access and explicitly called reflected accessors retain
  the receiver. No JavaScript proxy is added around the native global.
- `SPEC_CLASH(window-foreign-prototype)`: Chromium throws SecurityError for
  foreign setPrototypeOf/preventExtensions/seal/freeze. HTML and Firefox/WebKit
  instead permit the unchanged visible null prototype and reject preventing
  extensions with boolean results (or TypeError in Object helpers). Browlet
  follows Chromium, including caller-owned errors. Foreign definition/deletion
  also use the native denial callback; they do not reach property interceptors.

Browser evidence was collected on 31 October 2026 with Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. The reproducible browser probe is retained in
experimental `window-guard/foreign-receivers.mjs`. All three also throw a caller
TypeError for Symbol assignment to foreign Window.location, both through ordinary
assignment and its reflected setter. Web IDL's [PutForwards setter](https://webidl.spec.whatwg.org/#dfn-attribute-setter)
performs Get and Set in the setter's realm; it must not silently switch to the
target's realm for the nested Location.href conversion.

Three production prerequisites accompany the guard: Promise observation attaches
in the backing Promise's context while reactions keep the observer's queue and
enter their callback's context; trusted Binding code compiles in the Node host;
PutForwards uses the setter realm's captured Reflect operations. The full-suite
cross-owner pipe regression exposed the callback-context requirement. Its small
native reproduction failed before the explicit context entry was added. Same-origin
sibling test documents now share their requested origin, allowing existing borrowed
Streams methods to test their intended realm behavior.

Maintained coverage in `global-access.test.ts` tests cold and warmed Document
denial, caller/borrowed-realm selection, navigation, retained bindings, receiver
and conversion rules, descriptors, keys, and prototype mutations. The corresponding
native suite covers registration, unconnected checks, unknown callers, queue
ownership, proxy reuse, collection, repeated addon loads, and worker teardown.
Confirmed addon-dependent assertions remain strict expected failures only with
the addon disabled, as approved. Same-origin COOP reporting, the indexed
explicit-receiver gap, missing Window declarations, and navigation remain separate work.

Node 24's native Promise-resolution fast path selects the importing context's
`.then` for a host Promise. This caused Node-owned imports to reject with
`TypeError: no access` and leak rejected loader results. The first guarded global
now initializes a temporary workaround entirely inside `node-compat`: invalidate
the shared Promise lookup optimization in a disposable realm. Access checks and
host/Window intrinsics remain unchanged. The import assertions run normally and
the leaked rejections are repaired. Node 26/custom do not activate the workaround.
The [addon notes](../../../../node-compat/README.md#native-global-access-checks)
record the isolate-wide performance cost, exact upstream backport target, and
the distinct module-evaluation repair already present in Node 24.19.0. The
official-base HTML import-forwarding dependency remains separate.

Production guard validation on 31 October 2026:

| Full unit configuration | Passing assertions | Expected failures | Run result |
| --- | --- | --- | --- |
| Node 24.19.0, compat | 17,123 | 81 | Pass; no unhandled import rejections |
| Node 26.8.1, compat | 17,127 | 77 | Pass |
| Custom Node 27.0.0-pre, compat | 17,183 | 21 | Pass |
| Each of the three bases, stock | 17,008 | 196 | Pass |

Each run also retains 16 skips and one TODO. The full native suites complete with
305 cases on each official base, and 304 plus one existing skip on custom; their
counts include approved expected-failure controls. All 26 guard cases execute on
each native base. Import success and rejection now pass normally.

The subsequent addon reload repair reuses the Node environment's import router
and registers cleanup only once. Each weak loader record retains its original
module-result converter. The regression first reproduced the duplicate-cleanup
abort, then passed after clearing every JavaScript addon adapter from the require
cache: old, pending, and new script/module/context imports still use their own
loaders and module identities. Ordinary context creation across entry-point reload
now passes on every native base; the custom expected-failure classification is
removed. Official bases still lack the separate import-forwarding export.
The reload repair also passes the 14 affected unit files (224 cases) in all six
runtime configurations, retaining their existing capability-dependent expected
failures. Type contracts, changed-file ESLint, and whitespace checks pass.

The rebuilt Browlet package and all ten artifact checks pass on each of the six
configurations. Typecheck, type contracts, changed-file ESLint, and whitespace
checks pass. One Node 26/stock Headers test hit its five-second timeout during
concurrent matrix runs; its isolated suite and the complete serial rerun passed
without changing assertions or timeouts. The Node 24 workaround clears the 22
previously unhandled import rejections; the separate expected failures above
remain explicit dependencies.

## HTML §7.2.3: indexed platform types

The generated platform declaration now permits `window[index]`, `window.frames[index]`,
and nested child access, returning `WindowProxy | undefined`. The readonly index
reflects [§7.2.3.5](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-getownproperty)'s
non-writable child descriptor. TypeScript cannot express the distinction between
canonical array indices and other numeric property names, or the cross-origin
SecurityError for missing indices. Runtime write rejection and caller-dependent
dispatch remain unfinished as recorded above.

The existing generation-time `proxyInterfaces` option accepts a forwarded interface
and an optional indexed result type. Runtime declarations and conversion are
unchanged; this adds no Window IDL getter, iterator, constructor, or arbitrary named
properties. Independent no-DOM type contracts initially rejected all three indexed
forms; they now also enforce readonly indices and absence checks. Existing runtime
tests use direct typed indexing for child identity, nesting, order, and navigation.
Older test views of the full ambient global were narrowed to WindowProxy and the
particular JavaScript intrinsics they use.

## HTML §7.2.3.5: caller-bound own-property descriptors

Rechecked [§7.2.3.5](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-getownproperty)
against the local source and published HTML (26 October 2026) on 28 October.
`CrossOriginObjectBinding.getWindowProxyOwnProperty(property, proxy)` implements the
descriptor algorithm for an explicitly selected caller binding. Its `SPEC_MISMATCH`
records moving the proxy receiver to a final handle argument; the binding supplies
the caller realm. No new environment callback, registry, or execution-context
tracking is introduced. Automatic WindowProxy traps do not yet call this method.

Valid indices retain the existing insertion-order lookup. Missing indices ignore
ordinary Window properties: same-origin-domain callers receive undefined and foreign
callers get a caller-realm SecurityError. Non-index same-origin descriptors preserve
their original flags, including nonconfigurability. The stock JavaScript Proxy's
configurable-descriptor accommodation remains at its existing trap boundary.

Foreign lookup prioritizes the assembled cross-origin declarations, then eligible
child target names, then the four fallback keys. `WindowImpl`'s existing child-name
operation is shared with ordinary named access; it deduplicates before exact-origin
filtering and does not admit element IDs or names. Child descriptors are non-enumerable
and non-writable. Declared functions retain the shared caller/Window cache, while
child names, origins, and proxy retargeting are read live. Missing `focus`/`blur`
declarations remain the existing annotation-completeness dependency.

[Descriptor tests](../../../../test/browlet/browsing/window/window-proxy-descriptors.test.ts)
use real Window bindings and constructed child navigables. Against the old forwarding
path, 25 of 28 cases failed: foreign descriptors were unrestricted, child names were
not own properties, fallback values leaked author replacements, and ordinary descriptor
flags were altered. Tests supply the caller binding explicitly; they do not establish
automatic cross-origin enforcement or native proxy dispatch. Automatic Get/Set still
need COOP reporting and descriptor-based dispatch; explicit Get/Set are implemented below.
The execution experiment remains parked.

## HTML §7.2.3.6: caller-bound property definition

Audited [§7.2.3.6](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-defineownproperty)
against the same HTML revision. `defineWindowProxyOwnProperty(property, descriptor, proxy)`
uses the caller binding and the handle's current Window. Its `SPEC_MISMATCH` records
the explicit receiver argument, as with descriptor lookup. Inputs are already a
property key and an internal descriptor record; author key/descriptor conversion
belongs before this internal method.

The origin-domain check runs before numeric-index rejection. Every foreign definition
throws a caller-realm SecurityError, including permitted cross-origin reads, setters,
methods, fallback keys, and child names. Same-origin canonical indices return false,
whether or not a child or an ordinary numeric property exists. Other names and symbols
use ordinary definition, preserving descriptor defaults, partial updates, and false
results for incompatible nonconfigurable properties. Each call resolves the current
Window and its live origin, so a retained handle cannot keep old mutation authority
after navigation.

The [descriptor suite](../../../../test/browlet/browsing/window/window-proxy-descriptors.test.ts)
adds 23 definition cases; 16 failed against the existing forwarding path. Tests use
real caller/target bindings and descriptor records, including two-sided domain
relaxation and navigation. They call the algorithm explicitly, not the automatic
proxy trap. The stock trap still needs caller selection and must account for
nonconfigurable Proxy invariants. Native foreign definition now uses the guard's
denial callback; both automatic paths now reject same-origin indexed definition.

## HTML §7.2.3.7: caller-bound property reads

Audited [§7.2.3.7](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-get)
against the same HTML revision and ECMAScript's
[OrdinaryGet](https://tc39.es/ecma262/#sec-ordinaryget).
`getWindowProxy(property, receiver, proxy)` retains the specification's property and
receiver order, with the explicit proxy handle last; `SPEC_MISMATCH` records that
shape. The caller binding supplies the accessing Window's browsing context; the
handle's current Window supplies the accessed context. Receiver does not select
the caller. These operations retain HTML's Window/context preconditions.

The actual COOP eligibility check runs before descriptor lookup or author getters,
including reads of permitted child indices. Same-origin reads evaluate the proxy's
own descriptor, then follow the Window prototype when it is absent. Thus an absent
child index ignores an ordinary numeric expando, but can reach an inherited getter.
Foreign reads use declared cross-origin descriptors, eligible child names, or the
specified fallback; they cannot reach arbitrary author properties or prototypes.
Both branches preserve Receiver and abrupt completions. CrossOriginGet's public
signature is unchanged; a private descriptor-evaluation helper shares its remaining
steps with Get and retains a `SPEC_MISMATCH` marker for that extraction.

The [Get suite](../../../../test/browlet/browsing/window/window-proxy-get.test.ts)
has 28 cases; 21 failed against ordinary forwarding. It covers data/accessor and
prototype reads, primitive receivers, named/indexed children, caller-realm failures
and declared functions, navigation, and COOP ordering. Reportable cases intercept
the unfinished dispatcher; they establish its inputs and ordering, not report
construction or delivery. Native foreign forwarding is now connected; stock caller
selection, same-origin reporting, missing focus/blur declarations, and report
production remain explicit dependencies. The parked execution experiment is unchanged.

## HTML §7.2.3.8: caller-bound property writes

Audited [§7.2.3.8](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-set)
against the same HTML revision and ECMAScript's
[OrdinarySet](https://tc39.es/ecma262/#sec-ordinaryset).
`setWindowProxy(property, value, receiver, proxy)` follows Get's explicit caller
and proxy-handle arrangement, with a `SPEC_MISMATCH` for the handle argument.
COOP eligibility runs before either rejection or mutation. Same-origin array indices
return false regardless of child presence or ordinary numeric properties. Other
same-origin writes delegate to the underlying Window, as the specification requires,
preserving receiver operations, setter calls, false results, and abrupt completions.

Foreign writes resolve the caller's proxy descriptor and require its setter; readable
children, methods, getter-only attributes, and fallback keys all reject assignment
with a caller-realm SecurityError. CrossOriginSet's public signature is unchanged;
a private helper evaluates the selected descriptor and retains a `SPEC_MISMATCH`
for that extraction. Existing IDL machinery supplies the permitted `location` setter,
receiver checks, PutForwards, and href conversion. Actual Location navigation remains
unfinished in §7.2.4.

The [Set suite](../../../../test/browlet/browsing/window/window-proxy-set.test.ts)
has 32 cases; 24 failed against ordinary forwarding. Tests cover ordinary writes,
index boundaries, foreign denials, receiver/error identity, navigation, and reporting
before setters, conversion, or rejection. Location tests intercept its unfinished
implementation setter while retaining real IDL conversion and receiver selection;
COOP tests intercept report dispatch. Neither establishes navigation or report delivery.
Automatic indexed rejection is connected above; complete stock caller dispatch
and same-origin COOP reporting remain unfinished. OrdinarySet and
PutForwards can also invoke an independently supplied WindowProxy receiver's internal
methods; those nested accesses still need automatic caller selection. No ambient
caller fallback or replacement execution tracking is introduced.

## HTML §7.2.3.9: caller-bound property deletion

Audited [§7.2.3.9](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-delete)
against local HTML and the published 26 October revision on 29 October, alongside
ECMAScript's [OrdinaryDelete](https://tc39.es/ecma262/#sec-ordinarydelete).
`deleteWindowProxyProperty(property, proxy)` follows the existing caller-bound
operations; its `SPEC_MISMATCH` records the explicit handle argument.
The current Window's origin-domain check precedes descriptor lookup or mutation.
Foreign callers always receive a caller-realm SecurityError, including absent keys,
readable children/members, and fallback keys. Delete has no COOP reporting step.

Same-origin indices use the proxy descriptor: present children return false even
though their descriptors are configurable; absent indices return true. Ordinary
numeric properties left by unfinished paths are untouched in either case. Other
properties use ordinary Window deletion, preserving nonconfigurable properties
and inherited named properties without invoking getters or setters.

The [Delete suite](../../../../test/browlet/browsing/window/window-proxy-delete.test.ts)
has 25 cases; 21 failed against ordinary forwarding. Coverage includes numeric
boundaries, live child association/removal, domain relaxation, caller-realm errors,
and current-Window selection after navigation. Child associations and caller bindings
are supplied explicitly. Native foreign deletion is now secured by the guard's
denial callback. Automatic same-origin indexed deletion is connected above;
stock caller selection and child lifecycle production remain unfinished.

## HTML §7.2.3.10: caller-bound own-property keys

Audited [§7.2.3.10](https://html.spec.whatwg.org/multipage/nav-history-apis.html#windowproxy-ownpropertykeys)
against the same HTML revision and ECMAScript's
[OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys).
`getWindowProxyOwnPropertyKeys(proxy)` retains an explicit handle argument, marked
with `SPEC_MISMATCH`. It counts the current Document's actual child navigables and
materializes their index keys as decimal strings. Same-origin-domain callers get
the underlying Window's ordinary keys after that prefix; foreign callers get the
ordered cross-origin declarations and fallback symbols. Named children are not
added, even when their names have accessible own descriptors. No getters, value
conversions, or COOP reporting run. Each call returns a fresh list.

The algorithm preserves list concatenation, including overlapping numeric properties
left on Window by unfinished paths. Deduplication remains solely at the stock
JavaScript Proxy trap to preserve its invariants. The shared cross-origin key-list
result and fallback input now use string/symbol types, matching ECMAScript property
keys without adding coercion or runtime guards.

The [key-list suite](../../../../test/browlet/browsing/window/window-proxy-keys.test.ts)
has 15 cases; seven failed against ordinary forwarding. It covers key ordering,
private-key filtering, child changes, replaced length, numeric overlap, deleted
declared members, independent snapshots, domain relaxation, navigation, and absence
of COOP reporting. Its foreign-list checks disregard only the approved focus/blur
gap without requiring those names to remain absent. The independent complete-list
expected failure in `security.test.ts` remains unchanged; no new expected failures
or skips were added. Full declaration coverage, automatic caller selection,
prototype/HasProperty behavior, and native interception remain unfinished. The
parked execution experiment is unchanged.

## HTML §7.2.4: whole-section review before implementation

Reviewed on 29 October 2026, through §7.2.4.10. The local HTML source is at
`24c5e48bf66ea61bc199ec6338c81258275ba9c6`; the relevant definitions and exotic
algorithms were also checked against the published
[Location section](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-location-interface),
last updated 26 October 2026. The inventory below records the initial design audit;
the [first slice](#html-724-first-slice-document-association-and-reads) records subsequent implementation.

### Passage inventory

| Passage | Required behavior and Browlet's position |
| --- | --- |
| Window association and creation | One Location per Window, including a new identity when navigation replaces Window. Window already retains `LocationImpl`, and Binding retains its projected identity. The own intrinsic `valueOf`, own undefined `Symbol.toPrimitive`, and `[[DefaultProperties]]` creation steps are absent. Capture the realm intrinsic before author replacement; eager projection is one possible arrangement, not itself an observable requirement. |
| `Document.location` / `Window.location` | Document returns its relevant global's Location only while fully active, otherwise null. The Document declaration and getter are absent. Window's retained Location and PutForwards binding already exist. Preserve unforgeability and the nullable Document result. |
| Relevant Document and URL | Resolve through the owning Window's browsing context to its active Document; null context means null Document and `about:blank`. This is distinct from the Window's own associated Document. The current Node `URL` snapshot has neither relationship. Reuse Browlet's URL records rather than reparsing or retaining another mutable URL. Lifecycle disagreements below must be resolved explicitly. |
| Location-object navigate | Select the owning Window's navigable, the incumbent global's associated Document as source, and `auto` history handling by default. Use `replace` when the relevant Document is not completely loaded and the incumbent lacks transient activation. Call navigate with exceptions enabled. Window activation state and cancelable document-initiated navigation are connected; subsequent loading/unloading retains its dependencies. |
| All URL component getters | Check the relevant Document against the **entry** environment's origin-domain before serialization; a null relevant Document uses `about:blank`. Existing IDL invocation checks use the invoked function and receiver realms, which does not replace this additional check against the current relevant Document. URL origin is obtained from the URL, not the Document's possibly inherited or sandboxed origin. |
| `href` setter / `assign` / `replace` | Return for a null relevant Document; encoding-parse against the entry environment; parse failure throws SyntaxError. Only assign adds the entry-origin check; href and replace deliberately allow foreign use. Replace requests replacement history. Current implementations all throw the generic unfinished-navigation error before these steps. |
| `protocol` setter | Null-Document return, entry-origin check, copy URL, scheme-start parsing with an appended colon, SyntaxError on parse failure, and stop unless the resulting scheme is HTTP(S), then navigate. This is not a direct assignment to the Document URL. |
| `host` / `hostname` setters | Null-Document return and entry-origin check; copy URL; return for opaque paths; parse using the distinct host/hostname overrides; navigate the copy. Do not turn parser failures into new exceptions where HTML does not do so. |
| `port` setter | The same initial checks; return for URLs that cannot have credentials/port; empty input removes the port, otherwise use the port override; navigate the copy. |
| `pathname` setter | The same initial checks; return for an opaque path; clear the path list and parse with path-start override; navigate the copy. |
| `search` setter | The same initial checks; empty input removes the query. Otherwise strip one leading `?`, initialize an empty query, and use UTF-8 with query override. This follows the merged HTML change and WPT despite the current passage's Document encoding argument; see the component clash follow-up below. Navigate the copy. |
| `hash` setter | The same initial checks; strip one leading `#`, initialize an empty fragment, and parse with fragment override. Compare the parsed fragment with the old fragment (null treated as empty); equal means no navigation. Empty input is deliberately unlike the hyperlink setter. Href/assign must not inherit this bailout. |
| `reload` | Return for null relevant Document, perform the entry-origin check, then reload that Document's node navigable. Reload/traversal is an explicit navigation dependency, not the host-facing `Browlet.navigate()` operation. |
| `ancestorOrigins` | Retain one empty DOMStringList for the null-Document case. Otherwise perform the entry-origin check, require the Document's initialized ancestor list, and return that exact list. DOMStringList and Document initialization already exist; Location's member, empty-list state, and checks do not. Do not substitute an empty list for missing initialization. |
| §7.2.4.1–2, prototype | GetPrototypeOf returns the ordinary prototype for same-origin callers and null otherwise. SetImmutablePrototype compares against that caller-visible result: setting null for a foreign caller can succeed without changing the underlying prototype. Location currently has an ordinary mutable prototype. |
| §7.2.4.3–4, extensibility | IsExtensible always returns true; PreventExtensions returns false. Ordinary projection currently permits preventing extensions. Browser disagreement is recorded below. |
| §7.2.4.5, descriptors | Same-origin lookup uses the ordinary descriptor, then reports initial properties configurable. Foreign lookup uses the shared helper and fallback. Binding must retain ordinary backing descriptors separately so the helper does not re-enter the exotic lookup. `[[DefaultProperties]]` and the browser disagreement are central, not incidental creation details. |
| §7.2.4.6, definition | Same-origin definitions of every initial key return false, even no-op redefinitions; other keys use OrdinaryDefineOwnProperty. Every foreign definition throws SecurityError. Browsers disagree about no-op definitions. |
| §7.2.4.7–8, get/set | Dispatch to OrdinaryGet/OrdinarySet for same-origin callers and CrossOriginGet/CrossOriginSet otherwise. Preserve supplied Receiver, exceptions, conversion, and cached caller-owned functions. The existing shared helpers and annotations provide pieces, not automatic Location interception. Location does not inherit WindowProxy's COOP reporting step. |
| §7.2.4.9, deletion | Same-origin uses OrdinaryDelete; foreign callers throw SecurityError. OrdinaryDelete consults the object's own-property internal method, so its interaction with §7.2.4.5's configurable-descriptor rewriting must be addressed with the descriptor decision. Delegating to a separate backing object's Reflect.deleteProperty is not automatically equivalent. |
| §7.2.4.10, keys / remaining internal methods | Same-origin ordinary own keys; foreign href, replace, then and the three fallback symbols. All otherwise-unspecified methods remain ordinary, including HasProperty, whose descriptor/prototype dependencies must still use the exotic object's operations. |

### Browser evidence and unresolved choices

The manually invoked [browser probe](../../../../test/browlet/probes/location.mjs)
fulfills every request locally. On 29 October it ran Chromium **156.0.8078.4**,
Firefox **157.0**, and WebKit **27.2**. It is browser-only evidence, not a Browlet
pass or a full Location conformance run. Its normal test-runner state is idle;
there is no automatic runner registration.

```powershell
node scripts/with-node.mjs --base 24.19.0 --runtime stock node test/browlet/probes/location.mjs
```

Source comparisons use older local revisions and are distinguished from those
live results:

- Blink `1136757f47c7e2b6cc593f871a5d79fc0e9834b4` (3 July):
  [Location state and navigation](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/location.cc),
  [IDL annotations](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/frame/location.idl),
  and [generated binding machinery](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/bindings/scripts/bind_gen/interface.py)
  install intrinsic conversion properties, immutable prototypes, and native access-check handlers.
- Gecko `d92a7ec0e622782fe62529bb3a4809780da01d6c` (2 July):
  [Location](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/Location.cpp),
  [LocationBase navigation](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/LocationBase.cpp),
  [shared cross-origin object](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/MaybeCrossOriginObject.cpp),
  and [binding generator](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/bindings/Codegen.py)
  separate member checks against the browsing context's current principal from platform-object checks.
- WebKit `713192fabebfdd2955aa596c262c33bfbf3d50be` (26 August):
  [Location](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Location.cpp),
  [IDL](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Location.idl),
  [JSLocation custom methods](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/bindings/js/JSLocationCustom.cpp),
  and [creation generator](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/bindings/scripts/CodeGeneratorJS.pm)
  keep Window-owned state and engine property hooks separate. The IDL explicitly records an incumbent-versus-active-window FIXME.

SPEC_CLASH(location-default-properties): Browlet follows browsers: initial properties stay nonconfigurable, unchanged definitions succeed, and replacement/deletion fail. HTML instead rewrites initial descriptors to configurable and rejects every redefinition, with an inconsistent deletion path.

All three return false when deleting the probed initial properties. The existing
WPT `location-valueof.html`, `location-symbol-toprimitive.html`, and
`location-stringifier.html` also expect nonconfigurability. Gecko's generator
deliberately avoids HTML's descriptor rewriting and links
[whatwg/html#4157](https://github.com/whatwg/html/issues/4157), still open when
read through Extractlet on 29 October with no capture warnings. A September 2026
comment identifies the same WPT/spec disagreement. Initial creation descriptors
and later observable descriptors must not be conflated in our tests.
Literal HTML plus ECMAScript's [OrdinaryDelete](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinarydelete)
would consult the rewritten configurable descriptor; this consequence also conflicts
with the unforgeability motivation. The accepted browser rules address this group
together; Browlet does not combine browser deletion with HTML's descriptor rewriting.
The [focused decision review](#location-descriptor-decision-review) below adds fresh
deletion, prototype-poisoning, and document.domain transition evidence.

SPEC_CLASH(location-retained-url): Browlet follows HTML's owning-Window browsing-context active Document and about:blank null-context fallback; tested browsers disagree about retained and detached Location reads.

After a same-origin iframe navigation, every engine produces a new Location, but
the retained old Location reads the new URL in Firefox and the old Document URL in
Chromium/WebKit. After a subsequent foreign navigation Firefox throws SecurityError
from that retained Location; Chromium/WebKit still expose its old URL. After iframe
removal Firefox returns empty href/origin/pathname, while Chromium/WebKit retain
the old URL; none produces HTML's about:blank fallback in this probe. All three
return a stable empty ancestor list and make assign return without navigation.
Document destruction and retained history are distinct: HTML destruction clears
the browsing-context link; a retained inactive Document can still have one. Do not
infer either state solely from `isFullyActive()`. In the latter state, also settle
how Location-object navigate's owning Window navigable (which can be null) relates
to the non-null relevant Document before forwarding a navigation request.

SPEC_CLASH(location-document-access): Browlet follows HTML/Chromium/Firefox and returns null from Document.location for an inactive Document; tested WebKit retains a Location after iframe navigation/removal.

SPEC_CLASH(location-extensibility): HTML keeps Location extensible and rejects preventing extensions; tested Chromium allows it for same-origin Location and throws SecurityError cross-origin, while Firefox/WebKit follow HTML in both cases. Browlet's choice is pending review.

SPEC_CLASH(location-foreign-set-prototype): HTML's immutable-prototype comparison permits setting null when the foreign-visible prototype is null; tested Chromium throws SecurityError while Firefox/WebKit return true. Browlet's choice is pending review.

All three agree on the tested foreign own-key list, setter-only href descriptor,
read-only replace method descriptor, stable repeated replace identity, null visible
prototype, and SecurityError for forbidden reads/definitions/deletions. Same-origin
key order differs across engines, so do not use an engine's whole key list as a
substitute for the assembled IDL and specified creation order. The July/August
sources additionally expose differences around URL credential stripping, protocol
mutation, ancestor-list initialization, and incumbent selection; these are leads
for focused member tests, not conclusions from the reflection/lifecycle probe.

### Proposed ownership and implementation sequence

Location's state and URL/navigation algorithms belong on `LocationImpl`, with its
owning `WindowEnvironment`. Its relevant Document is a live query, not a copied URL
or a permanently captured Document. The empty ancestor list is implementation state.
Use `env.encodingParseURL()`, URL records/parsing/serialization, Document's existing
ancestry, and Navigable's navigation contract. The caller's entry/incumbent environments
are invocation inputs selected at the binding boundary; they are not inferred from
the receiver's environment or replaced by one generic caller parameter.

HTML's Binding integration should own the Location platform allocation, ordinary
property storage, caller-selected exotic algorithms, and cross-origin descriptor
cache. The accepted browser rules omit `[[DefaultProperties]]`. Keep the existing
interface/member annotations for permissions; do not move Binding Context into
LocationImpl. Full automatic
dispatch still needs the real current caller before invoking an IDL function, just
as WindowProxy does. After rebasing onto main `c3c34a0a`, native incumbent capture
and scoped `JSExecutionContext.incumbentEnv` observations are available for opted-in
operations. Location navigation can use that existing mechanism; setter entry
capture still needs an extension, and stock Node retains the documented incumbent
limitation. Entry selection remains
separate from incumbent observations. The parked execution experiment stays parked.

A plain Proxy directly wrapping today's projected Location cannot implement this
contract. Its nonconfigurable target properties cannot disappear from foreign keys,
be reported with configurable foreign descriptors, or yield a different frozen
method value. An empty shadow target can support configurable views, but cannot
honestly report browser-style nonconfigurability without acquiring the same invariant
constraints. Nonconfigurable author expandos and origin-domain changes need coverage
too. These are [ECMAScript Proxy restrictions](https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-getownproperty-p),
not something an IDL permission annotation fixes. Browser-compatible automatic
reflection requires an engine-supported design or an explicitly limited stock mode;
the existing native Window global-proxy support does not establish ordinary Location support.
Do not eagerly lock down the final platform allocation before deciding this boundary.

Bounded implementation sequence:

1. Implement ownership, Document.location, relevant-Document/URL reads, entry-origin
   checks, and ancestor-list state. This slice follows HTML's lifecycle rules.
2. Implement creation safeguards and the accepted browser rules for initial
   properties. Keep the separate exotic allocation/engine boundary explicit;
   `[[DefaultProperties]]` is intentionally omitted under the recorded clash.
3. Implement URL mutation preparation and the Location navigation coordinator,
   explicitly selecting entry settings and incumbent source/activation inputs,
   keeping `Navigable.navigate()`, reload, and user activation visibly unfinished.
4. Implement caller-bound exotic methods against deliberate ordinary storage, then
   connect automatic/native dispatch only when caller selection and the engine
   property contract are available. Test reflection and mutation together, not just
   direct helper results.

The [initial creation regressions](../../../../test/browlet/browsing/window/location-creation.test.ts)
reported **4 ordinary failures and 1 pass** on stock Node 24.19.0: missing
own conversion properties allow replacement and inherited primitive conversion to
forge the URL string. The existing IDL stringifier case passes. These tests do not
choose configurability or require eager allocation; the disputed cases remain in
the audit above. No expected failures or skips were added. These creation failures
remained open after the first slice and are fixed by the second slice below.

## HTML §7.2.4 first slice: Document association and reads

`LocationImpl` now retains its `WindowEnvironment` and queries that Window's
browsing context for the active Document. There is no independent Node URL snapshot.
The URL getters serialize the existing URL record; origin uses URL's origin
algorithm, including inherited-origin about:blank and blob URL distinctions.
Disconnected Windows expose about:blank components. Initial-about:blank Window
reuse retains its Location, while replacement Windows get distinct objects.

The getter bindings select the modeled entry environment before calling the
implementation's shared entry-origin check. Direct host calls use the getter's
environment, matching Window.open and Origin.from. This check covers the current
relevant Document independently of the existing invocation check against the
Location's owning realm. Current-caller selection for exotic property inspection
is still separate; these tests do not establish automatic cross-origin dispatch.

Document now declares the nullable, unforgeable, href-forwarding location attribute.
It returns its relevant Window's Location only while fully active. Assignment
uses the existing Web IDL forwarding path, including TypeError before conversion
when an inactive Document returns null. The declaration generator now follows
the inner interface of a nullable PutForwards target when deriving the setter's
input type; a focused generation regression failed before that repair.

`env.createDOMStringList()` associates a new list with its owner before projection.
Document ancestry initialization and Location's separate empty list use it, so
a retained Location cannot claim a newer Document's list for its older realm.
Missing Document ancestry initialization throws instead of manufacturing an empty
list. The list implementation itself remains independent of browser environments.

The [Document/Location tests](../../../../test/browlet/browsing/window/location-document.test.ts)
cover live URL changes, Window reuse/replacement, retained-object access after
same-origin and foreign navigation, domain relaxation, entry settings, disconnection,
nullable forwarding, URL serialization, and ancestor-list identity/realm ownership.
The lifecycle and entry-origin assertions were observed failing before the repair.
Navigation setters/operations, creation conversion safeguards, and exotic reflection
remain later slices. No new expected failures or skips were added.

Validation on stock Node 24.19.0: all 15 Document/Location cases pass. The selected
Window, document-lifecycle, DOMStringList, declaration-generation, and messaging
suites report 442 passes, 8 existing expected failures, and the 4 ordinary creation
failures above. Typecheck and touched-file lint pass. No native binaries were built.

## HTML §7.2.4 second slice: creation conversion safeguards

Location now receives an own, nonwritable, nonenumerable intrinsic `valueOf` and
an own undefined `Symbol.toPrimitive`. JSRealm captures the original method before
author code can replace it. Lazy projection therefore preserves the original
identity even when Object.prototype and Location.prototype were modified before
the first Location access. The IDL stringifier remains the existing own member.

Web IDL's additional platform-creation hook runs after inherited unforgeable members
are installed and before the final object is stamped. HTML owns the Location steps
in `integration/web-idl/bindings/location.ts`. This splits the specification's creation
algorithm: the hook receives an already allocated object, with Web IDL's creation
step complete. The callable arrangement has a pending `SPEC_MISMATCH` review marker.
The hook may return a different exotic object later, without stamping its backing
allocation or changing implementation ownership. Tests exercise lazy projection,
public/internal construction, cross-realm ownership, and retry after failed creation.

This bounded slice initially stopped before the descriptor choice. The subsequent
[decision review](#location-descriptor-decision-review) adopts the browser rules
already supplied by ordinary projection and deliberately omits `[[DefaultProperties]]`.
Creation and property tests now assert the accepted behavior. Automatic caller
selection and the recorded Proxy-invariant constraints remain separate dependencies.

The four committed creation failures were reproduced before the change; all five
creation tests and all 15 Document/Location tests now pass on stock Node 24.19.0.
The full unit suite exposed one stale DOM expectation from the first slice:
Document now has the specified enumerable own `location` attribute. That test now
checks its placement and unforgeable descriptor. The final full unit run passes
all 525 files: 16,407 passes, 143 existing expected failures, 16 existing skips,
and one existing TODO. Typecheck, touched-file lint, and `git diff --check` pass.
No expected failures or skips were added, and no native binaries were built.

## Location descriptor decision review

After checkpoint `d701b0d9`, this bounded pass investigated
`SPEC_CLASH(location-default-properties)`. Eric accepted the browser rules on
29 October 2026; the evidence and implementation consequences are recorded here.
The [focused manual probe](../../../../test/browlet/probes/location-properties.mjs)
ran on 29 October 2026 against Chromium **156.0.8078.4**, Firefox **157.0**, and
WebKit **27.2**. All requests are fulfilled locally. This is browser-only evidence,
not a Browlet regression or a conformance pass.

```powershell
node scripts/with-node.mjs --base 24.19.0 --runtime stock node test/browlet/probes/location-properties.mjs
```

The three engines agree on each tested built-in: `href`, `assign`, `replace`,
`toString`, `valueOf`, and `Symbol.toPrimitive`.

| Same-origin operation on an initial property | Written HTML algorithms | All three browsers |
| --- | --- | --- |
| Report `configurable` | true | false |
| Define an empty descriptor or the unchanged descriptor | false | true |
| Replace the function/accessor or make it configurable | false | false |
| Delete the property | true, as derived below | false |

Deletion is an inconsistency in the written algorithms, not merely a browser
preference. [HTML's Delete](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-delete)
calls OrdinaryDelete, which calls the object's overridden GetOwnProperty. That
reports the default property configurable, so OrdinaryDelete removes it. A later
[GetOwnProperty](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-getownproperty)
still finds the key in `[[DefaultProperties]]`, but its ordinary descriptor is now
undefined; the algorithm nevertheless tries to set that descriptor's Configurable
field. The deletion result and this invalid subsequent step are deductions from the
published algorithms, not observed browser behavior. Do not claim a particular
post-deletion string result for the literal specification without resolving that step.

The probe separately installs forged conversion functions on Location.prototype,
then attempts to delete the corresponding own safeguard. Each browser rejects
deletion and retains `about:blank` for String conversion, concatenation, and computed
property keys. This agrees with HTML's stated unforgeability motivation. No browser
in this probe allows the inherited forgery to take over.

There is also a concrete reason behind HTML's configurable view. With
`Origin-Agent-Cluster: ?0` on both documents, changing only a child's document.domain
makes its retained Location foreign to the parent without replacing the object.
All three engines then hide `valueOf`, expose a different `replace` function, and
report that function configurable. Relaxing the parent to the same domain restores
the original function and nonconfigurable descriptor. A normal JavaScript Proxy
over ordinary storage cannot promise a frozen function and later expose a different
one. Full browser reflection therefore remains an engine integration dependency;
member annotations and incumbent capture do not remove that restriction.

[whatwg/html#4157](https://github.com/whatwg/html/issues/4157) remains open, re-read
through Extractlet at 10:49 UTC with no capture warnings. Its discussion distinguishes
ECMAScript invariant preservation from compatibility concerns about newly failing
no-op definitions. Gecko's local generator explicitly cites that issue and retains
ordinary descriptor behavior; Blink marks these built-ins DontDelete. The checked-in
WPT conversion-property tests also expect nonconfigurability.

Accepted choice: follow the browsers for this property group and retain the
`SPEC_CLASH` marker until the specifications and implementations converge. Initial
own members remain nonconfigurable; empty, identical, and matching partial
definitions succeed; incompatible definitions and deletion fail. Accessor setters
retain their declared URL-writing behavior: protecting the property descriptor does
not make `location.href` a read-only attribute. Author-added string/symbol properties
keep ordinary descriptor rules, including explicitly nonconfigurable expandos.

This preserves the stated unforgeability goal and interoperable no-op behavior.
It does not select browser behavior for the separate extensibility, prototype, or
retained-Document clashes. Full cross-origin enforcement stays explicitly unfinished
until its caller and engine boundaries exist.

The rejected alternative was HTML's configurable view with an explicit deletion
guard for initial properties. The probe includes a small ECMAScript control showing
that a Proxy may report configurable while refusing both definition and deletion. That
would be a deliberate local repair to HTML, not literal HTML or current browser
behavior, and it does not solve nonconfigurable author expandos or caller selection.
The literal-HTML option also leaves the invalid post-deletion descriptor step
unresolved. Neither alternative is silently implemented alongside the chosen rules.

The existing Web IDL `[LegacyUnforgeable]` descriptors plus HTML's own conversion
properties already implement the accepted same-origin behavior. The creation hook
now marks the choice beside that allocation. No additional Proxy or property-name
registry is needed for this part. HTML's `[[DefaultProperties]]` slot is deliberately
absent: its only consumers are the configurable-descriptor rewrite and blanket
redefinition rejection that this choice replaces. This is a documented consequence
of the clash, not an unfinished producer hidden behind a TODO.

The [property regressions](../../../../test/browlet/browsing/window/location-properties.test.ts)
use an independent inventory of all initial IDL members and conversion safeguards.
They cover descriptor flags, unchanged definitions, replacement/deletion, frozen
method assignment with a different receiver, author-realm TypeError, inherited
conversion forgeries, and ordinary author expandos. These exercise projected
Browlet objects; they do not claim cross-origin reflection is connected.

Validation after accepting the choice: all 31 focused Location tests pass on stock
Node 24.19.0, including nine new property cases. Typecheck, touched-file lint, and
`git diff --check` pass. The chosen ordinary behavior already existed; no additional
runtime dispatch was added, no failures were reclassified, and no binaries were built.

## HTML §7.2.4 third slice: href, assign, replace, and navigation handoff

`LocationImpl.setHref()`, `assign()`, and `replace()` now implement their
[URL-writing steps](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-href).
They return when the relevant Document is null, encoding-parse relative to the
entry environment, and throw SyntaxError on failure. Assign additionally checks
the entry origin against the relevant Document before parsing; href and replace
deliberately omit that check. Web IDL still performs receiver/security checks and
USVString conversion first. The implementation receives the converted string and
explicit entry/incumbent environments, with no retained Binding Context.

The shared [Location-object navigate](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-object-navigate)
method selects the live relevant Document's node navigable, the incumbent Window's
associated Document as source, and `auto` or explicit `replace` history handling.
It switches to replacement when the relevant Document has not completely loaded
and the incumbent Window lacks transient activation. It passes `exceptionsEnabled: true`
to `Navigable.navigate()` without directly changing the Document URL or history.
`Window.hasTransientActivation()` is an explicit §6.4 dependency that throws until
expiration and notification are implemented. Timestamps and consumption now exist. Loaded
Documents do not consult it. Actual document-initiated navigation still throws at
`Navigable.navigate()`; this slice does not make Location load pages.

Binding derives incumbent observation from Location's callback parameters.
Href and component setter bindings receive the incumbent as their fourth parameter;
assign and replace receive it through their argument resolvers. Window.location and
Document.location forwarding setters inherit the requirement from Location.href,
without additional capture flags. Entry
selection continues to use the retained HTML entry; incumbent selection uses the
observed platform call or callback backup. Direct host calls without either use
the member's environment, matching the existing host-entry accommodation. Stock
Node still cannot infer an arbitrary B-authored function called from entry A;
modeled-input tests do not establish automatic native capture or exotic dispatch.

SPEC_GAP(location-inactive-window-navigation): a retained Location can have a non-null relevant Document but its owning Window's navigable is null; HTML supplies no rule for that target. Browlet navigates the live relevant Document's node navigable.

This follows from the different [relevant-Document](https://html.spec.whatwg.org/multipage/nav-history-apis.html#relevant-document)
and [Window navigable](https://html.spec.whatwg.org/multipage/nav-history-apis.html#window-navigable)
definitions after Window replacement. The navigation algorithm passes that null
target to an operation requiring a navigable. The accepted choice uses the relevant
Document's node navigable, which is the same target while the owning Window is
active and remains available after replacement. A null relevant Document still
returns before parsing or navigation. This fills HTML's missing case; it does not
change Window.navigable or relax assign's entry-origin check.

Local browser-source evidence uses the revisions listed in the whole-section
review above. Blink's `Location::SetLocation` returns when its owning DOMWindow
has no Frame (`IsAttached`); WebKit's `Location::setHref` also checks its owning
Window's Frame. Gecko's `LocationBase::Navigate` instead obtains the browsing
context retained by Location and returns only for a missing/discarded context.
The [browser probe below](#retained-location-navigation-browser-evidence) now
confirms the write behavior and distinguishes the engines' Document lifetime
observations. The existing retained-read clash alone does not settle navigation.

The focused [navigation tests](../../../../test/browlet/browsing/window/location-navigation.test.ts)
exercise projected APIs and intercept only the unfinished navigation/activation
effects. Coverage includes independent entry/incumbent/method/receiver environments,
legacy query encoding, base changes during conversion, null-Document returns,
assign's security ordering and domain relaxation, history choices, callback
backups, forwarding, and exception realms. The Web IDL registration tests cover
borrowed-setter environments and accessor capture selection. Before the retained
target decision below, the focused run passed 90 tests on stock Node 24.19.0.
The full unit run passed 527 files:
16,448 passed, 143 existing expected failures, 16 skipped, and 1 todo. Typecheck,
touched-file ESLint, and `git diff --check` pass; no failures were reclassified.
The component setters are covered by the next slice below; reload and the
remaining exotic methods are still separate slices. No binaries were built.

### Retained Location navigation browser evidence

On 29 October 2026, the manually invoked
[retained navigation probe](../../../../test/browlet/probes/location-retained-navigation.mjs)
ran 26 cases each in Chromium **156.0.8078.4**, Firefox **157.0**, and WebKit
**27.2**. Each case creates a fresh iframe at `/old`, retains its Location,
Document, href setter, assign, and replace, then loads a distinct Document at
`/new`. Every case verifies that the new Location has a different identity.
Same-origin and cross-origin replacements and subsequent iframe removal are
separate cases. All documents are fulfilled locally. The probe observes both
navigation requests and frame commits for 750 ms after each call; all 15 direct
current-Location controls navigate successfully.

| Observation after same-origin Window replacement | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Retained Location href | Old URL | Current URL | Old URL |
| Old Document.defaultView | null | Current WindowProxy | null |
| Old Document.location | null | null | Non-null |
| Retained href / assign / replace with a valid URL | Return; no request or commit | Navigate current frame | Return; no request or commit |
| Same writes with invalid `http://[` | Return; no request or commit | SyntaxError | Return; no request or commit |
| New function invoked with retained Location receiver | No navigation | Navigate current frame | No navigation |
| Retained function invoked with current Location receiver | Navigate current frame | Navigate current frame | SecurityError |

Conversion runs exactly once in all of those cases. After cross-origin
replacement, Firefox permits retained href/replace writes to navigate the current
frame, but assign throws SecurityError; saved pre-navigation functions give the
same result. Chromium/WebKit return without navigation for all three writes.
After iframe removal, all three engines return without navigation. Firefox's
retained href then becomes empty; Chromium/WebKit keep the old URL.

SPEC_CLASH(location-retained-navigation): Browlet follows Firefox's navigation through a retained Location with a live relevant Document; Chromium/WebKit ignore writes after replacement, with different observed Document lifetime state.

The lifetime distinction prevents treating the table as a vote on the exact
`SPEC_GAP(location-inactive-window-navigation)` state. HTML's
[defaultView algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-document-defaultview)
returns null for a null browsing context, while
[Document destruction](https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document)
clears that context. Chromium/WebKit's null defaultView and owning-Frame checks
are evidence of disconnection in this probe. Firefox retains the current
WindowProxy, reads the active Document's URL, and routes navigation through the
retained browsing context. Firefox is therefore the closer precedent for Browlet's
existing live relevant-Document model. This is an interpretation of observable
and source evidence, not access to browser internal slots or a test of BFCache
preservation. Returning early for an actually disconnected Location remains a
separate, already implemented path.

Accepted on 29 October 2026: when the relevant Document remains live, navigate
its node navigable even if the old owning Window has none. This extends the
accepted live-Document reading rule consistently to writes and follows Firefox's
observed behavior. It deliberately fills HTML's missing case rather than literally
implementing its current target-selection step. The earlier explicit InternalError
has been removed. Both the specification-gap and browser-clash markers remain.

The navigation regression covers retained href/assign/replace after replacement,
the current Document's loading state, foreign href/replace writes, assign's foreign
entry rejection before parsing, and disconnection of the old owning Window while
the replacement remains active. Seven expectations failed at the old InternalError
before target selection changed. Tests observe the navigation request; actual
document-initiated loading remains the separate `Navigable.navigate()` dependency.
After the change, all 100 focused Location/Window forwarding and Web IDL tests
pass on stock Node 24.19.0, including 40 navigation-preparation cases. Typecheck,
touched-file ESLint, and `git diff --check` pass. The earlier full-suite result
predates this target-selection change; no binaries were built.

SPEC_CLASH(location-inactive-method-realm): WebKit throws SecurityError when an old Location function is applied to the new same-origin Location; Chromium and Firefox navigate. The reason for WebKit's additional rejection is not established.

The probe retains the successful-navigation expectations for these borrowed
function controls and completes every case before asserting. Its completed run
exits **1** for WebKit's three failures (href, assign, replace); these were not
reclassified as expected failures. Direct current-object controls all pass, so
the retained-receiver no-ops are not explained by a generally broken navigation
harness. This is a browser-only manual probe, idle outside this investigation,
and does not run in Browlet's regression suite. The browser investigation made no
production changes; the accepted target-selection change is recorded above.

```powershell
node scripts/with-node.mjs --base 24.19.0 --runtime stock node test/browlet/probes/location-retained-navigation.mjs
```

## HTML §7.2.4 fourth slice: URL component setters

`LocationImpl` now implements the protocol, host, hostname, port, pathname,
search, and hash setter algorithms. Binding performs USVString conversion and
selects the entry and incumbent environments using the same accessor capture
as href. Each implementation returns for a null relevant Document, checks the
entry origin, and copies the live Document URL before parsing. None directly
mutates the Document URL. The existing navigation coordinator owns history
selection, incumbent source/activation, and retained-Location target selection.

The implementation follows the [HTML component setters](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-protocol)
and URL's [basic parser](https://url.spec.whatwg.org/#concept-basic-url-parser),
with the accepted encoding choice documented below:

- Protocol appends a colon, throws SyntaxError on parse failure, and navigates
  only when the resulting scheme is HTTP(S). A rejected scheme transition can
  leave the original HTTP(S) URL and still reach navigation.
- Host and hostname return for opaque paths. Port returns for a URL that cannot
  have credentials/port and clears the port on empty input. These setters ignore
  parser failure and navigate the resulting copy, including a partial host change
  before port parsing fails. URL owns the shared opaque-path and port predicates;
  its public URL implementation uses the same definitions.
- Pathname returns for an opaque path; otherwise it clears the copied path list
  and invokes the parser's path-start override.
- Search distinguishes null from empty query and removes only one leading `?`.
  Its query parser uses UTF-8 independently of the relevant Document, entry,
  incumbent, and setter realms, following the merged HTML change and WPT.
- Hash removes only one leading `#`, parses an initially empty fragment, and
  returns if the resulting fragment equals the previous one, treating a null old
  fragment as empty. Empty input preserves an empty fragment when navigation is
  needed. This bailout does not apply to href or assign.

The new [component regressions](../../../../test/browlet/browsing/window/location-components.test.ts)
exercise projected setters, unchanged Document records, parser failures and partial
mutations, opaque paths, unsupported ports, null/empty query and fragment handling,
conversion ordering, independent execution environments, history selection, and
retained Location writes after Document replacement. Stock Node tests explicitly
supply modeled platform-call observations where separate incumbents are needed.

This exposed a missing prerequisite in URL §4.4: the basic parser did not
[obtain an output encoding](https://url.spec.whatwg.org/#concept-basic-url-parser).
UTF-16LE, UTF-16BE, and replacement encodings consequently threw RangeError while
encoding a query. The initial regressions reproduced the failure through both
URL parsing and Location.search before the repair. `parseBasicURL()` now calls Encoding's
existing `getOutputEncoding()` operation, mapping those inputs to UTF-8 before
query parsing. The fix belongs to URL and also covers encoding-parsed href URLs.
Direct URL regressions retain that coverage after search became independent of
Document encoding.

### Component setter browser differences

On 29 October 2026, the manual [component oracle](../../../../test/browlet/probes/location-components.mjs)
ran 14 cases in each of Chromium **156.0.8078.4**, Firefox **157.0**, and WebKit
**27.2**. Each case uses a fresh same-origin iframe, an initial HTTPS URL on port
8443, and a Windows-1252 Document. Documents are fulfilled locally. Requests and
frame commits are observed for 500 ms; ordinary pathname navigation succeeds in
every engine. These are parsing/navigation observations, not transport conformance.

SPEC_CLASH(location-search-encoding): Browlet follows the merged HTML UTF-8 rule, WPT, and browsers; the current HTML passage still passes the relevant Document's encoding.

For `search = '?q=é'`, Browlet and all three engines produce `?q=%C3%A9`, even
for a Windows-1252 Document. Eric accepted UTF-8 on 29 October 2026 after the
source-history review below, replacing the earlier choice of the passage's `%E9`.

SPEC_CLASH(location-component-parse-failure): Browlet follows HTML/URL's parser results, including ignored failures and partial mutation; browsers disagree on errors, malformed hosts, and port preservation.

| Input | HTML/URL and Browlet | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- |
| `host = 'bad host'` | Navigate unchanged URL | Navigates to `bad%20host` | `NS_ERROR_MALFORMED_URI` | SyntaxError |
| `host = 'other.test:99999'` | Change host, preserve 8443 | Same | Same | Change host, clear port |
| `hostname = 'other.test:1234'` | Navigate unchanged URL | SyntaxError | `NS_ERROR_MALFORMED_URI` | Same as spec |
| `port = '1234abc'` | Navigate with port 1234 | Same | Same | Clear port |
| `port = ':1234'` | Navigate unchanged URL | Same | Use port 1234 | Clear port |
| `port = '99999'` | Navigate unchanged URL | Same | `NS_ERROR_MALFORMED_URI` | Clear port |

The earlier exploratory probe used port 123, which also triggered Firefox's
restricted-port policy. The retained oracle uses 1234 to isolate parsing. Eric
accepted HTML/URL's results, including the malformed-input cases, on 29 October 2026.

SPEC_CLASH(location-protocol-navigation): Browlet follows HTML's resulting HTTP(S) scheme check; Chromium attempts FTP navigation and Firefox omits navigation for a rejected HTTPS-to-mailto transition.

For `protocol = 'ftp'`, HTML, Browlet, Firefox, and WebKit return without navigation;
Chromium emits an FTP request but does not commit it. For `protocol = 'mailto'`,
URL's special/non-special restriction leaves the HTTPS URL unchanged, after which
HTML requires navigation. Chromium/WebKit emit a same-document commit; Firefox
returns without a request or commit. All three agree on SyntaxError for an empty
protocol, repeated-colon parsing, and the tested unchanged/empty hash cases.

The oracle uses the accepted HTML/URL rules, including the merged UTF-8 search
change, and exits **1** for 13 browser disagreements (3 Chromium, 5 Firefox,
5 WebKit). These remain ordinary failing expectations. Search now agrees in all
three engines; the host, port, and protocol expectations remain unchanged. The
probe runs only when invoked manually and stays outside the Browlet regression suite.

```powershell
node scripts/with-node.mjs --base 24.19.0 --runtime stock node test/browlet/probes/location-components.mjs
```

Reload and Location's remaining exotic internal methods are the next slices.
Actual navigation, activation notification, and automatic caller/engine observation
remain the explicit dependencies recorded above. No binaries were built.

Validation on stock Node 24.19.0 passes 48 Window/Location, URL, and Encoding test
files: **1,330 passed** and **3 existing expected failures**. The UTF-8 expectations
first reproduced five failures under the old Document-encoding behavior, including
retained Locations and independently selected execution environments. Direct URL
tests also retain the output-encoding regression coverage. Typecheck, touched-file ESLint,
and `git diff --check` pass. The separate browser oracle's exit status remains 1
for the 13 documented browser disagreements; no failures were reclassified.

### Component clash follow-up (29 October 2026)

Eric accepted these recommendations on 29 October 2026. The implementation and
test expectations now use UTF-8 for `Location.search`; host, hostname, port, and
protocol retain the HTML/URL rules. Source comments record the competing rules
beside each affected setter.

**Search has an explicit standards decision.** In
[HTML issue 8308](https://github.com/whatwg/html/issues/8308), editors proposed
aligning with Chrome and Safari's UTF-8 behavior because it was simpler and
required fewer engines to change; Gecko's participant agreed. The merged
[HTML change 8309](https://github.com/whatwg/html/pull/8309/changes), dated
22 September 2022, removes the Document encoding argument. The accompanying
[WPT change 36019](https://github.com/web-platform-tests/wpt/pull/36019/changes)
explicitly expects UTF-8. That test remains in the local Firefox WPT checkout at
`html/infrastructure/urls/resolving-urls/query-encoding/location.sub.html`.
[URL issue 783](https://github.com/whatwg/url/issues/783) subsequently cites the
same HTML change as removing this use of the encoding argument.

There is still a source inconsistency: the clean local HTML source, the published
Location.search passage, and a fresh read of `whatwg/html/main/source` on this
date all contain the Document encoding argument. This investigation did not
establish why that text conflicts with the merged decision and WPT.
`SPEC_CLASH(location-search-encoding)` preserves both sources and the UTF-8 choice.
Href, assign, and replace still use encoding-parsing; their WPT expectations
continue to use the entry Document's encoding. The output-encoding repair in
URL remains necessary independently of the search change.

**Malformed components expose several older mutation paths.** The inspected
source revisions are the pinned browser revisions listed in the whole-section
audit above, older than the installed browsers used for the probes:

- Blink's [KURL::SetHostAndPort](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/platform/weborigin/kurl.cc#L597)
  explicitly describes its parsing as sloppy for backwards compatibility. It
  deliberately replaces host and port separately to preserve the old port when
  the new port is invalid. This is evidence of compatibility constraints, not
  evidence that each observed malformed-host result is an intentional contract.
- Gecko's [Location::SetPort](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/Location.cpp#L418)
  strips an optional leading colon, converts with `atol`, and propagates the URI
  mutator's errors. Host/hostname setters also propagate mutator errors. Those
  paths explain the colon acceptance and exposed `NS_ERROR_MALFORMED_URI`.
- WebKit's [Location::setPort](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/page/Location.cpp#L199)
  passes `parseInteger<uint16_t>` directly into
  [URL::setPort](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WTF/wtf/URL.cpp#L526).
  An absent parsed integer clears the port. Its host-and-port mutator likewise
  empties an out-of-range port before reparsing. These explain the observed
  clearing; no deliberate web-compatibility rationale for that clearing was found.

Additional observation-only controls created fresh `URL` and anchor objects at
`https://example.test:8443/path?old#same` in the same installed browser versions.
The Location column repeats the earlier navigation probe; URL and anchor columns
are the new controls. "Unchanged" means retaining the original component.

| Browser and assignment | Location | URL | Anchor |
| --- | --- | --- | --- |
| Chromium `host = 'bad host'` | `bad%20host` | `bad%20host` | `bad%20host` |
| Firefox `host = 'bad host'` | Throws | Unchanged | Unchanged |
| Firefox `port = '1234abc'` | 1234 | Unchanged | Unchanged |
| Firefox `port = ':1234'` | 1234 | Unchanged | 1234 |
| WebKit `port = '1234abc'` | Cleared | 1234 | 1234 |
| WebKit `port = '99999'` | Cleared | Unchanged | Unchanged |

These are not one interoperable alternative to HTML/URL. Keep Browlet's shared
parser rules and `SPEC_CLASH(location-component-parse-failure)`; the investigation
found no concrete compatibility requirement that outweighs those rules.

**Keep the protocol behavior.** Gecko reparses the changed scheme before its
HTTP(S) gate, explaining why `mailto` returns immediately there. Blink lacks the
Location-specific gate in the inspected source, whereas WebKit and Gecko have
it. The existing WPT `location-protocol-setter-non-broken.html` checks the final
URL after four seconds; it does not check attempted requests or unchanged-URL
navigation. Thus Chromium's FTP request without a commit can satisfy that test.
Retain HTML's HTTP(S) gate and navigation after a rejected transition leaves an
HTTP(S) URL. Keep `SPEC_CLASH(location-protocol-navigation)` for the observable
differences; no additional exception or protocol-specific bailout is justified
by this evidence.

## HTML §7.2.4 fifth slice: reload preparation

`LocationImpl.reload(entryEnv)` now implements the
[Location method's four steps](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-location-reload)
through the navigation handoff: select the live relevant Document, return when
it is null, compare its origin with the entry environment using same origin-domain,
and call that Document's node navigable. The Web IDL declaration supplies the
entry environment through `invokeWith` after receiver validation. Borrowed
methods preserve the receiver's Document and the method realm's exception
allocation. Reload needs neither an incumbent observation nor URL parsing or
transient-activation selection. A non-null relevant Document without a node
navigable throws an explicit lifecycle error.

`Navigable.reload(options)` exposes all three optional inputs of
[reloading a navigable](https://html.spec.whatwg.org/multipage/browsing-the-web.html#reload)
in `ReloadOptions`, defined beside Navigable. The options-record translation is
reviewed and accepted. The §7.4.3 coordinator now selects Navigation
state, dispatches the cancelable event, and sets `reloadPending` only if it may
continue. It queues `Traversable.applyReloadHistoryStep()` and waits for its unload-cancellation result;
actual Fetch/revalidation, unloading, replacement, and Navigation entry/activation
updates remain later work. See the
[reload coordination audit](../navigation/ROADMAP.md#html-743-reload-coordination).

### Browser disagreements

The 30 October audit ran Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2.
The reproducible browser-only probe and individual observations remain in the
independent experimental repository's `location-remaining/` folder on main.
The selected behavior follows HTML and the already accepted live-Document
direction for retained Location navigation; source-side markers retain both
disagreements:

| Case | HTML / Browlet | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- |
| Retained Location after same-origin replacement | Reload the live Document | No-op | Reload | No-op |
| Retained Location after foreign replacement, old entry origin | SecurityError | No-op | SecurityError | No-op |
| Location from a removed iframe | Return undefined | As specified | `NS_ERROR_FAILURE` | As specified |
| Old method with the new same-origin receiver | Reload the new Document | As specified | As specified | As specified |

`SPEC_CLASH(location-retained-reload)`: Blink's `Location::reload()` returns when
`IsAttached()` is false; WebKit returns when the old Location has no local frame.
Gecko obtains the browsing context's current docshell and checks its subject
principal. These mechanisms explain the observations but do not establish a
compatibility requirement to ignore retained receivers. Unlike the earlier
Location-object navigate ambiguity, reload expressly names the relevant
Document's node navigable, so no new specification gap is needed.

`SPEC_CLASH(location-disconnected-reload)`: Gecko's missing-docshell error occurs
before its discarded-context return. Its nearby `CallerSubsumes` comment calls
discarded-context operations no-ops. Guard ordering is a plausible explanation
for the difference; Browlet follows HTML's null-Document return.

Inspected source checkpoints: Blink `1136757f47c7e2b6cc593f871a5d79fc0e9834b4`,
`third_party/blink/renderer/core/frame/location.cc:262`; Gecko
`d92a7ec0e622782fe62529bb3a4809780da01d6c`, `dom/base/Location.cpp:577` and `:636`;
WebKit `713192fabebfdd2955aa596c262c33bfbf3d50be`,
`Source/WebCore/page/Location.cpp:280`. Sources live under the configured local
browser roots; these checkouts were inspected rather than built.

### Validation and integration

The nine focused reload regressions first produced one pass (derived receiver
rejection) and eight ordinary failures against the old navigation stub. All
nine pass after the change. They exercise real Binding invocation, null-Document
ordering with a foreign entry, realm-owned denial, domain relaxation, borrowed
methods, retained receivers, and the live navigable handoff. Only the unfinished
`Navigable.reload()` effect is replaced by an observer. The entry-origin controls
supply modeled script entry explicitly; they do not claim arbitrary native caller
discovery. The handoff test verifies that Location does not mutate the URL,
history entry, or `reloadPending`, or consult activation and URL parsing.

Validation on stock Node 24.19.0 across all Location suites and document lifecycle
passes **187 tests with 3 existing expected failures** (8 files, exit 0).
Typecheck and touched-file ESLint pass. No addon or engine binaries were built.

This slice stays in the Ged worktree while main's Window repairs proceed. Main's
observed head was `d6112a5a`; its uncommitted binding-input changes preserve
`entryEnvironment(methodEnv)` and `invokeWith(atArg(...))`, which this slice uses.
The reload method body and one IDL operation are the only Location integration
points; no incumbent helper, getter, or setter was rewritten here. Adopt these
changes onto Vin's final binding shape, preserving her removal of the generic
navigation-error helper. Location's caller-dependent exotic operations and native
allocation remain the next work; the Window owner-view experiment does not
complete them.

## HTML §§7.2.4.1–7.2.4.4: Location prototype and extensibility

The Location creation hook now returns a Proxy around its ordinary IDL target.
The Proxy prevents physical prototype replacement, reports extensible, and
returns false from `[[PreventExtensions]]`. As a result, same-origin
`Reflect.setPrototypeOf(location, itsPrototype)` succeeds while a different
proposal fails; `Object.setPrototypeOf` and the inherited `__proto__` setter
throw a caller-realm TypeError for replacement. `Object.preventExtensions`,
`seal`, and `freeze` throw before changing descriptors. The prototype object
itself remains mutable. Ordinary expandos, unforgeable members, receivers, and
string conversion retain their existing behavior.

Binding stamps only the final Proxy. Projecting its implementation returns that
same object; the private target does not acquire another public platform identity.
This applies to both new and retained Locations and does not retarget their
implementation or realm when navigation replaces the Window.

The caller's `CrossOriginObjectBinding.getLocationPrototypeOf()` implements
[GetPrototypeOf](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-getprototypeof):
return the supplied ordinary prototype for same origin-domain, otherwise null.
`setLocationPrototypeOf()` implements
[SetPrototypeOf](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-setprototypeof)
by comparing the proposal with that caller-visible result. In particular, a
foreign proposal of null returns true without changing ordinary storage.
The origin comparison uses the Location's relevant environment, not the live
Document used by its URL methods. Tests preserve that distinction across
navigation and recheck both sides of domain relaxation without replacing the
object or caching the origin decision.

These methods take the platform Location explicitly, as the existing caller-bound
WindowProxy algorithms do. The additional ordinary-prototype input is an explicit
engine dependency and is marked `SPEC_MISMATCH` for callable-shape review.
It must be read from ordinary storage without invoking the same exotic operation.

### Engine connection identified by this slice

This initial slice left automatic prototype reflection on the physical prototype
and required a current-realm observation at reflection entry. Neither the
Location's owner nor inferred incumbent/entry settings substitute for that realm
through arbitrary cross-realm author functions. The subsequent native dispatch
slice below supplies the observation; stock Node retains the gap.

Prototype/extensibility rules fit a Proxy while its target stays extensible.
Descriptor/key rules additionally require native support: an ordinary target
cannot hide nonconfigurable keys or substitute their frozen values as origins
change. The delivered allocation preserves the final Binding identity, one
ordinary property store, and exact receivers. It does not reuse Window's native
global owner or retarget Location during navigation.

### Browser disagreements and accepted choice

Eric selected HTML with `SPEC_CLASH` records on 30 October 2026. The earlier
three-browser audit is retained in main's independent experimental repository,
`location-remaining/browser-oracle.mjs` and `BROWSER-RESULTS.json`.

| Operation | HTML / Browlet rule | Chromium 156 | Firefox 157 / WebKit 27.2 |
| --- | --- | --- | --- |
| Same-origin prototype replacement | Reject | Reject | Reject |
| Foreign get-prototype | null | null | null |
| Foreign set-prototype to null | true, no storage change | SecurityError | As specified |
| Foreign set-prototype to a non-null object | false | SecurityError | As specified |
| Same-origin prevent-extensions | false; remain extensible | true; becomes non-extensible | As specified |
| Foreign prevent-extensions | false; remain extensible | SecurityError | As specified |

`SPEC_CLASH(location-extensibility)` records the written
[IsExtensible](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-isextensible)
and [PreventExtensions](https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-preventextensions)
rules in the installed traps. `SPEC_CLASH(location-foreign-prototype)` records
the foreign proposal rule beside the caller-bound algorithm. This choice is
independent of the accepted browser behavior for initial Location descriptors.
Gecko compares the caller-visible prototype before entering the target realm;
Blink's generated Location support uses native immutable prototypes and access
checks. The inspected sources explain these observations but do not establish
a compatibility requirement to copy Chromium's differences.

Source checkpoints from that audit: Gecko `d92a7ec0e622782fe62529bb3a4809780da01d6c`,
`dom/base/MaybeCrossOriginObject.cpp:380` and `:425`; Blink
`1136757f47c7e2b6cc593f871a5d79fc0e9834b4`,
`third_party/blink/renderer/bindings/scripts/bind_gen/interface.py:5486`;
WebKit `713192fabebfdd2955aa596c262c33bfbf3d50be`,
`Source/WebCore/bindings/js/JSLocationCustom.cpp:187` and `:197`.

### Validation scope

The baseline reproduced nine failures in eleven actual-platform checks: prototype
replacement and prevention/sealing/freezing were allowed. The four additional
caller-bound checks initially failed because their methods were absent. Those
15 checks and an added default/explicit accessor-receiver control now pass.
They use real platform objects and bindings;
the caller-bound group supplies the caller and ordinary prototype explicitly and
does not claim automatic foreign prototype dispatch. The actual foreign
extensibility check needs no caller selection and runs through normal author
reflection. No expectations were weakened or reclassified.

The surrounding Location, cross-origin Binding, and document-lifecycle checks
pass on stock Node 24.19.0: **217 passed, 3 existing expected failures** across
12 files (exit 0). Typecheck, touched-file ESLint, and `git diff --check` pass.
Native addon and engine builds were not run for that initial slice. The following
Location-owned work supplies the native connection; coordination with Vin concerns
shared engine files and integration, rather than transferring Location ownership.

## HTML §7.2.4: Native Location dispatch

All ten Location internal methods and ordinary HasProperty now connect through
automatic platform operations on addon backends. The existing URL attributes,
ancestorOrigins, assign/replace, and reload preparation remain the implementation
layer. Actual navigation/reload effects and activation notification remain explicit
dependencies with their navigation and Window owners.

`prepareLocationObject()` retains its ordinary IDL allocation as the only property
store. Only the final exotic object receives a Binding record. Each accessing
realm selects its existing world binding; caller handlers are weakly cached, but
every operation rechecks the live origin-domain relationship. Cross-origin
functions retain the established caller/target cache and are allocated in the
accessing realm. Public Location identity and ordinary storage are separate inputs
to the caller-bound methods, marked with their original `SPEC_MISMATCH` signatures.
The ordinary store prevents recursion in CrossOriginGetOwnPropertyHelper.

The native allocation has two private adapters: a handler object whose property
interceptor captures V8's current realm during Proxy trap lookup, and a target
whose descriptor/key interceptors expose the same selected view for invariant
checking. Neither adapter stores author properties or acquires another Binding
identity. This captures the realm before entering the JavaScript trap function,
including when A calls B's author function or borrows B's Reflect methods. The
incumbent and outermost entry are deliberately not substituted. Native fields
trace the selector and its ordinary store; no persistent native roots are added.
The initial probe passes on official Node 24/26 using public V8 APIs. No new
Node/V8 patch or engine rebuild is needed.

Allocation uses the owner's captured intrinsic prototype as a stable realm
anchor. An integration regression initially failed when an old Window first
projected its Location after detachment: the context-handle factory rejected that
allocation. Anchoring to the original realm fixes this without changing Window
detachment or native global storage. Captured caller-realm Reflect.get/set/has
also preserve the caller through inherited lookup and receiver definition;
ordinary host Reflect calls would lose that input on nested exotic access.
The shared CrossOriginGet/Set helpers likewise use captured caller-realm
descriptor lookup. An explicit-helper regression first returned the owner's
replace function instead of the already cached caller function; both entry
paths now select the same descriptor and identity.

The accepted `SPEC_CLASH(location-default-properties)` still preserves frozen
initial descriptors, compatible no-op definitions, and deletion protection.
Foreign descriptors remain configurable and can expose caller-owned functions;
foreign keys hide the owner's defaults and nonconfigurable expandos. Prototype
and extensibility choices continue following HTML/Gecko/WebKit under their
existing clash identifiers. Source-side markers remain beside the algorithms.

The five initial automatic regressions reproduced incorrect prototypes, keys,
descriptor/function identity, foreign mutations, and frozen-expando visibility.
The expanded twelve cases also cover domain relaxation, retained/replacement
Locations, nested receiver/prototype access, and foreign href/replace navigation
handoffs. Eric approved expected failures for these twelve cases only on stock
Node; native cases remain ordinary tests. Six native tests independently cover
realm capture, numeric/symbol descriptors, exact receivers, reentrancy,
exceptions, garbage collection, and allocation after global reuse.

Validation covers 59 affected Location, security, lifecycle, JS Engine, and Web
IDL Binding files (799 tests). Every command exits zero; expected failures are
counted separately, including the twelve newly approved stock-only cases:

| Base | Runtime | Passing | Expected failures |
| --- | --- | ---: | ---: |
| Node 24.19.0 | stock | 735 | 64 |
| Node 24.19.0 | compat | 792 | 7 |
| Node 26.8.1 | stock | 735 | 64 |
| Node 26.8.1 | compat | 794 | 5 |
| Custom Node 27.0.0-pre | stock | 735 | 64 |
| Custom Node 27.0.0-pre | compat | 797 | 2 |

The complete native addon suite passes 261 tests on each official base, and 260
on custom with its existing official-installer-only test skipped. The twelve new
Location integration cases and six native allocation cases pass on all addon
bases. Typecheck, touched-file ESLint, and diff checks pass. All addon binaries
were built in this worktree; custom uses the existing regular Node checkout and
engine binary. No Node engine or browser binaries were built.

Integration remains confined to this worktree. Main's observed `4490d7a5` keeps
the same native realm references and context API, while its incumbent binding
input refactor and Window property-store work remain separate. Adopt the Location
creation hook, cross-origin methods, generic engine facility, and tests together;
do not replace main's Window or incumbent-input changes with this checkout's older
versions. The shared native facility may help Window caller selection later, but
this slice does not change Window's automatic dispatch.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `opening.ts`, `window.ts`, and navigation owners | Complete `open()`, auxiliary/top-level traversable creation, target selection, opener relationships, session-storage shed cloning, closing, and stopping | HTML §7.2.2.1; HTML §7.3; Storage |
| existing `window.ts` | Remaining Window members and event-handler mixins; automatic child/opener lifecycle integration | HTML §7.2.2 and owning chapters |
| existing `window-proxy.ts` and `integration/web-idl/bindings/window-proxy.ts` | Resolve the native indexed explicit-receiver gap; finish same-origin COOP reporting; supply stock caller selection; complete missing Window declarations | HTML §7.2.3 |
| existing `location.ts` and navigation owners | Reload coordination and activation/navigation effects; automatic Location exotic dispatch requires the addon | HTML §§7.2.4, 7.4 |

Automatic WindowProxy Get/Set must call the caller binding's
`CrossOriginObjectBinding.checkAccessShouldBeReported()` with the accessor,
accessed context, and property before property dispatch. The explicit Get/Set operations
above and native foreign dispatch do so; automatic same-origin access still needs
this connection, and stock traps need caller selection. That check handles
declared-name filtering, fully active ancestry, exact-origin comparisons,
top-level virtual groups, and opener relationship classification. It passes the
complete selected state and caller environment to the unfinished
`OpenerPolicy.queueAccessReports()` dispatcher. The remaining automatic integration,
missing focus/blur annotations, source-location capture, report bodies,
and URL-scoped delivery remain explicit [policy dependencies](../policy/ROADMAP.md#html-713-cross-origin-opener-policies).
Group switching alone does not implement these traps or author-reference severance.

HTML §2.6.5's `DOMStringList` is available, and `Location.ancestorOrigins` returns
the relevant Document's initialized list after its entry-origin check, or its
retained empty list for a null Document. Document implements the parent-origin
chain and referrer-policy masking in [§3.1.3](../../html/ROADMAP.md#section-313-ancestor-origins).
Child creation must populate its retained container association before it can initialize
those lists in production; ancestry initialization itself accepts the parent
document before activation.
Missing ancestry initialization still throws rather than substituting an empty list.

Native context/global-proxy allocation and reuse are implemented through the
compatibility addon. Stock Node retains a modeled fallback with documented
[limitations](../../../LIMITATIONS.md); cross-origin security remains HTML work
on either backend. Blink owns Window/Location in `core/frame` and the
actual V8 WindowProxy in `bindings/core/v8/window_proxy.*`, reinforcing that
the proxy is binding/engine machinery attached to—but not identical with—the
Window implementation.

The generated `WindowProxy` type extends the declared Window platform surface with
readonly child indices; `WindowProxyHandle` retains the internal proxy state. Undeclared compatibility
properties and the missing Window members above are not promised by the types.

Window values returned through EventTarget conversion expose the public
WindowProxy for `target`, `currentTarget`, `srcElement`, `composedPath()`, and
function-listener/`onstorage` receivers. Chromium 156, Firefox 157, and WebKit 27.2
agree for live Windows (2026-10-31), including Document bubbling and listeners
from another realm. Object listeners retain their own receiver; ordinary
EventTargets and post-dispatch cleanup keep their normal behavior.

Binding's `PlatformRecord.project()` supplies the shared author conversion for
interface and union results and callback receivers. HTML's WindowProxy integration
registers the Window rule through `prepareProjectionOverride`; each realm's
Window `ImplementationBinding` retains it. The record captures those steps once,
including for EventTarget results and explicit context/world projection.
Its `platformObject` retains
the original property store for installation, reflection, and receiver ownership.
Event dispatch and Storage retain implementation targets. No native code or
engine capability is involved in this conversion.

`SPEC_CLASH(window-event-target-after-navigation)` follows Chromium/WebKit:
converting a Window after replacement returns null. Firefox returns the stable
WindowProxy after navigation. Web IDL's
[interface conversion](https://webidl.spec.whatwg.org/#interface-to-js) preserves
the referenced object; [DOM's target getter](https://dom.spec.whatwg.org/#dom-event-target)
does not clear the stored Window on navigation. Browlet follows Chromium/WebKit
at the author conversion boundary without changing that stored target. A proxy
saved before navigation remains stable in all three browsers. Both eager and
previously unread event targets show the disagreement. Blink's `DOMWindow::Wrap()`
returns null without a Frame and otherwise returns WindowProxy; WebKit's
`toJS(DOMWindow&)` makes the same frame check in `JSDOMWindowBase.cpp`.
The manual probe remains in `node-compat/experimental/window-event-identity.mjs`.
This approved choice is an HTML projection/lifecycle rule, not a V8 limitation.

`SPEC_CLASH(window-event-target-after-removal)` follows Chromium/Firefox:
removing an iframe without replacing its Window retains the public WindowProxy;
WebKit returns null. The conversion therefore checks the handle's current Window,
not whether the old Document still has a browsing context. This separately
approved distinction also avoids making ordinary object conversion depend on
Document activity or scheduling.

The [Window regression suite](../../../../test/browlet/browsing/window-event-target.test.ts)
covers live identities, same-agent cross-realm listeners, retained/lazy targets,
detachment, and the original property store after navigation. The original
expected failure is now an ordinary test, and Storage's two identity regressions
pass through the same conversion.

`Window.postMessage()` forwards both overloads to the
[communication implementation](../../communication/window-messaging.ts), using
the shared structured-data algorithms and target agent's event loop. Its
`CrossOrigin` metadata participates in Binding's invocation checks. Full
WindowProxy property access must select the caller-bound descriptor helpers for
cross-origin calls; the permissive proxy currently returns the target's method instead.
WindowEventHandlers now supplies `onmessage`/`onmessageerror` along with the other
ordinary Window handlers. Beforeunload's special callback conversion and
return-value processing are connected; navigation still needs dispatch,
counters, and prompt admission/UI.
See the [§9.3 dependencies](../../communication/ROADMAP.md#93-cross-document-messaging).
Window now owns activation timestamps, the history-action predicate, and
both history-action and transient consumption across the top-level traversable.
Sticky/transient predicates and the Window-owned `UserActivation` view are now
implemented. Input/automation notification, close watchers, and focus remain
[interaction work](../../interaction/ROADMAP.md#html-641-and-644-activation-state-and-its-public-view).

## Removal condition

Burn this file after the Window, WindowProxy, and Location observable
contracts are complete for Browlet's supported realm/navigation model.
