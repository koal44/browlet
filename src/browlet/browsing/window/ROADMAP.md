# Window roadmap

## Present

- `window.ts`: Window implementation and its current Web IDL contributions.
- `opening.ts`: window-open coordination and private feature/noopener helpers,
  reached through `BrowletEnvironment.openWindow()`. Existing special targets work;
  new-target creation and navigation/history effects remain explicit dependencies.
- `window-proxy.ts`: internal handle retaining the stable platform identity and
  paired Window association across navigation.
- `location.ts`: Location identity and currently supported URL accessors.
- [`../../integration/web-idl/cross-origin.ts`](../../integration/web-idl/cross-origin.ts):
  HTML's shared cross-origin algorithms and the Web IDL security check.

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

This is not full cross-origin enforcement. WindowProxy and Location's exotic
internal methods must select the current binding before entering an IDL function,
invoke these helpers, and implement their additional rules. Their caller lookup
must account for the [execution-context limitation](../../../LIMITATIONS.md#scheduling-and-callback-context);
the invoked member's realm is only sufficient inside Web IDL invocation.
Location's future binding must supply OrdinaryGetOwnProperty access to the descriptor
helper without recursively entering its exotic `[[GetOwnProperty]]`.
Window's undeclared `focus`, `blur`, and `postMessage` remain explicit dependencies. They do
not contribute permissions or descriptors in the annotation proof of concept.
Location's setters and `replace()` still stop at the navigation dependency.

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
| `location`, `history`, `navigation` | Respectively §§7.2.4, 7.2.5, and 7.2.6. Location's partial implementation is exposed; History and Navigation need their interfaces and the unfinished session-history lifecycle. |
| `customElements` | [Custom elements](../../dom/nodes/html/custom-elements/ROADMAP.md) owns the registry implementation and state; Window's getter/exposure is still missing. |
| `focus`, `blur` | [Interaction](../../interaction/ROADMAP.md) owns focusing and user-activation dependencies; Window declarations are absent. |
| `navigator`, `clientInformation` | [Navigator](../../navigator/ROADMAP.md), HTML §8.10; object creation, shared identity, and the Replaceable alias remain absent. |
| `originAgentCluster` | Implemented and exposed in the [§7.1.2 audit](../ROADMAP.md#same-origin-relaxation-origin-and-origin-keyed-clusters). |
| `alert` overloads, `confirm`, `prompt`, `print` | HTML's simple-dialog and printing algorithms; user-agent prompt/printing effects and Window bindings remain unfinished. |
| `postMessage` overloads and `WindowPostMessageOptions` | [Communication](../../communication/ROADMAP.md), HTML §9.3; declarations, target-origin handling, and delivery remain missing. Reuse the existing StructuredSerializeOptions and structured-data algorithms. |
| GlobalEventHandlers and WindowEventHandlers includes | [DOM events](../../dom/events/ROADMAP.md) and [scripting](../../scripting/ROADMAP.md) need the handler declarations and lifecycle; the existing EventTarget base does not supply these mixins. |
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
| Feature processing and target selection | Empty targets normalize to `_blank`; features are tokenized, `noreferrer` and noopener are parsed and removed, and noreferrer forces noopener and `no-referrer`. `Navigable.chooseNavigable()` supplies the target/window-type pair. Its special-target branches work; named lookup and new targets explicitly throw until familiarity, popup/activation policy, sandbox rules, and creation exist. A null result returns immediately without target effects. |
| New/existing target branches | New targets receive popup classification, CSSOM View feature setup, default about:blank, and URL/history update versus navigation. Existing targets navigate for a nonempty URL and update their current browsing context's opener when permitted. Both branches supply exception/referrer inputs and apply the final window-type/noopener/special-target return rules. The owner methods `BrowsingContext.setUpFeatures()`, `DocumentImpl.updateURLAndHistory()`, and `Navigable.navigate()` explicitly throw until their effects exist. Creator inheritance and session-storage cloning also remain blockers. |
| Feature tokenizer and separators | `tokenizeWindowFeatures()` consumes ASCII whitespace, equals signs, and commas with the specified boundaries. It ASCII-lowercases names/values and normalizes aliases before updating an insertion-ordered Map; duplicate values replace without reordering. Non-ASCII whitespace is retained. |
| Boolean features and popup classification | Empty/yes/true are true; all other values use HTML's exact integer-prefix parser, with errors/zero false. Missing features take the caller's default. Popup classification honors explicit `popup`, then location/toolbar, menubar, resizable, scrollbars, and status in specification order. Opening removes noopener/noreferrer before classification and feature setup. |
| Legacy feature names | screenx/screeny/innerwidth/innerheight normalize to left/top/width/height. Other names survive, including unknown features that can affect popup classification. |
| Name accessors and reset note | `Navigable.targetName` reads its active history entry. Window's setter updates that entry; an inactive Window reads empty and ignores writes. Existing navigation carries names across same-origin navigation and resets them for the supported cross-origin case; tests cover both. |
| Close and script-closability | `close()` returns for a non-top-level, inactive, or already-closing Window. `Navigable.isScriptClosable` implements top-level plus web-created-or-one-entry. Actual closing stops explicitly before source snapshotting: transient activation, incumbent familiarity, and sandbox navigation permission are required before setting isClosing and queueing definite closing on the DOM manipulation task source. Definite closing additionally requires unloading/cancellation, destruction, and user-agent removal. |
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
| Document-tree child navigables | `DocumentImpl.getDocumentTreeChildNavigables()` returns an empty list without a node navigable, otherwise collects non-null iframe/object/frame content navigables in descendant tree order. Shadow trees and nested Documents are excluded. It recomputes the list so insertion, removal, reordering, and association changes are visible immediately. |
| `window[index]` API description and proxy reference | The section explicitly delegates indexed lookup to WindowProxy's §7.2.3 `[[GetOwnProperty]]`. That operation sorts the list by container insertion order before selecting a child proxy. Numeric lookup, descriptors, own-key ordering, write/delete rules, and cross-origin out-of-range handling remain explicit proxy work. No indexed getter is added to Window's IDL. |

Object and legacy frame implementations now retain the same initially-null
`contentNavigable` state as iframe. The §7.2.2.4 pass below connects their reverse
container associations. Loading/creation/destruction producers and insertion-order
tracking remain unfinished. Tests supply real child navigables at these associations;
creating or appending a container alone does not create a child browsing context.

[`indexed-access.test.ts`](../../../../test/browlet/browsing/window/indexed-access.test.ts)
covers empty/live counts, all three container kinds, tree ordering, association
changes, shadow and nested-Document exclusion, detached/inactive Documents,
Replaceable behavior, and borrowed cross-origin getter/setter checks. The initial
zero-length expectation failed with `undefined` before implementation. These tests
do not claim numeric WindowProxy access or full child-creation support.

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
| Cross-origin isolated capability | None/logical isolation returns false. Concrete isolation calls `Document.isAllowedToUse('cross-origin-isolated')`, which returns false without a browsing context or full activity. Fully active Documents still throw at the explicit Permissions Policy dependency; policy evaluation, inherited rules, and feature defaults remain unfinished. |
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
against the same HTML revision. This first pass implements the unconditional
extensibility rules on the stock-Node forwarding proxy. Prototype security still
requires caller selection and native interception, described below. §§7.2.3.5–10
remain a separate implementation pass.

| Passage | Implementation and remaining dependency |
| --- | --- |
| Stable identity and [[Window]] | `WindowProxyHandle.platform` stays fixed while `associatedWindow` changes on navigation. Binding unwraps receivers through the current association. No WindowProxy interface object is exposed. Existing navigation tests and the new rejection/navigation case cover this lifecycle. |
| Ordinary target note | The specification permits dispatch through the Window's methods while it behaves as an ordinary object. Stock Node uses Reflect forwarding and Web IDL's global prototype behavior; its nonconfigurable-descriptor accommodation remains necessary for JavaScript Proxy invariants. |
| §7.2.3.1, [[GetPrototypeOf]] | The own-Window case returns Window.prototype. The required null result across origins remains missing: automatic traps need the current caller's binding before invoking `CrossOriginObjectBinding.isPlatformObjectSameOrigin()`. |
| §7.2.3.2, [[SetPrototypeOf]] | Existing forwarding rejects changing the associated Window's immutable prototype. Full SetImmutablePrototype must instead compare against the proxy's caller-visible [[GetPrototypeOf]] result: a cross-origin caller may set null successfully without changing anything. This depends on §7.2.3.1. |
| §7.2.3.3, [[IsExtensible]] | Stock-Node trap always returns true; its hidden target stays extensible. |
| §7.2.3.4, [[PreventExtensions]] | Stock-Node trap always returns false. Reflect reports false; Object.preventExtensions/seal/freeze throw in the calling realm without changing the proxy or its target. These rules need no origin check. |

**Caller dependency:** each HTML EventLoop knows its own modeled running context,
but the accessed Window can belong to another agent. Its loop cannot select the
caller. Object/function creation-realm lookup also does not identify the currently
executing caller, and the modeled stack does not intercept every cross-realm
function call. The execution/binding boundary must supply that current realm to
the exotic algorithms; direct Node-host access additionally needs an explicit
policy when no HTML context is running. Selecting the target realm by default
would silently permit cross-origin access. This pass adds no such fallback.

**Native dependency:** an addon global proxy bypasses `WindowProxyHandle`'s
JavaScript traps. Its property delegate exposes property operations, not
origin-sensitive prototype hooks. Native immutability alone cannot supply the
different same-origin and cross-origin prototype results. The native path still
needs a focused runtime design and validation; this pass changes no native code
and builds no binaries.

[`window-proxy.test.ts`](../../../../test/browlet/browsing/window/window-proxy.test.ts)
checks exposure, own-Window prototype immutability, Reflect/Object extensibility
operations, caller-realm TypeErrors, foreign proxies, and navigation after a
rejected change. Five regression cases failed before the fix: stock Node allowed
Reflect.preventExtensions, and Object.seal/freeze left the hidden target
non-extensible even when they threw. The tests remain ordinary enabled regressions;
stock Node 24 validation does not establish native-backend conformance.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| existing `opening.ts`, `window.ts`, and navigation owners | Complete `open()`, auxiliary/top-level traversable creation, target selection, opener relationships, session-storage shed cloning, closing, and stopping | HTML §7.2.2.1; HTML §7.3; Storage |
| existing `window.ts` | Remaining Window members and event-handler mixins; automatic child/opener lifecycle integration | HTML §7.2.2 and owning chapters |
| existing `window-proxy.ts` | Complete exotic internal methods and same-origin/cross-origin switching | HTML §7.2.3 |
| existing `location.ts` | Complete navigation setters/methods, ancestor origins, and exotic internal methods | HTML §7.2.4 |

Cross-origin access hooks must call
`BrowsingContext.checkAccessShouldBeReported()` with the accessor, accessed
context, property, and accessing environment. That operation currently throws:
ancestor-origin collection, opener relationship classification, source-location capture, and
COOP's URL-scoped reports remain explicit [policy dependencies](../policy/ROADMAP.md#html-713-cross-origin-opener-policies).
Group switching alone does not implement these traps or author-reference severance.

HTML §2.6.5's `DOMStringList` is available, and Document's initialized ancestor
origins retain that implementation. `Location.ancestorOrigins` is still absent:
Location needs relevant-Document selection, its retained empty DOMStringList for
a null Document, the entry settings object's origin-domain check, and the return
of the Document's initialized list. Document now implements the parent-origin
chain and referrer-policy masking in [§3.1.3](../../html/ROADMAP.md#section-313-ancestor-origins).
Child creation must populate its retained container association before it can initialize
those lists in production; ancestry initialization itself accepts the parent
document before activation.
Do not replace these missing paths with an empty list or omit the security check.

Native context/global-proxy allocation and reuse are implemented through the
compatibility addon. Stock Node retains a modeled fallback with documented
[limitations](../../../LIMITATIONS.md); cross-origin security remains HTML work
on either backend. Blink owns Window/Location in `core/frame` and the
actual V8 WindowProxy in `bindings/core/v8/window_proxy.*`, reinforcing that
the proxy is binding/engine machinery attached to—but not identical with—the
Window implementation.

The generated `WindowProxy` type aliases the declared Window platform surface;
`WindowProxyHandle` retains the internal proxy state. Undeclared compatibility
properties and the missing Window members above are not promised by the types.

Window values returned through EventTarget projection currently expose the target
object instead of the public WindowProxy: `event.target === window` is false on
both backends. Chromium returns true (2026-10-27). The focused
[regression](../../../../test/browlet/browsing/window-event-target.test.ts) is an
approved expected failure. Fix the Window/Binding identity conversion for all
such returns; rejection notification must not special-case its event target.

`Window.postMessage()` belongs on Window, with its future algorithms in
`communication/window-messaging.ts`; it must consume the single structured-data
implementation and the target agent's event loop. It must not add a
Window-local cloning format. User activation and focus likewise associate state
with Window while retaining their algorithms under `interaction/`.

## Removal condition

Burn this file after the Window, WindowProxy, and Location observable
contracts are complete for Browlet's supported realm/navigation model.
