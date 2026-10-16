# HTML collections roadmap

HTML §2.6 defines collection interfaces beyond the DOM Standard's `NodeList`
and `HTMLCollection`. Reuse the DOM collection machinery. `HTMLAllCollection`
lives beside `DocumentImpl` and the live DOM collections in `dom/nodes`. Form and
options collections live beside their element owners in `dom/nodes/html/forms`,
avoiding reverse dependencies from those owners into higher HTML consumers.

| Planned source | Contract | Specification |
| --- | --- | --- |
| [`../../dom/nodes/html-all-collection.ts`](../../dom/nodes/html-all-collection.ts) (implemented) | `HTMLAllCollection`, indexed/named lookup, callable behavior, and `document.all` | HTML §2.6.4.1 |
| [`../../dom/nodes/html/forms/form-controls-collection.ts`](../../dom/nodes/html/forms/form-controls-collection.ts) | `HTMLFormControlsCollection` and `RadioNodeList`; form membership and radio grouping remain stubbed | HTML §2.6.4.2 |
| [`../../dom/nodes/html/forms/options-collection.ts`](../../dom/nodes/html/forms/options-collection.ts) | `HTMLOptionsCollection` mutations; automatic selection and selectedcontent remain stubbed on their owners | HTML §2.6.4.3 |
| `dom-string-list.ts` | Read-only indexed string-list surface over its owner's associated list | HTML §2.6.5 |
| Web IDL native property binding (implemented) | Reuse legacy indexed/named algorithms; the HTMLAllCollection declaration supplies its HTML-owned call steps | HTML §2.6 and Web IDL legacy platform objects |

Begin after DOM's projected, identity-stable live `NodeList` and
`HTMLCollection` machinery. `HTMLFormControlsCollection` and `RadioNodeList`
also depend on form controls, radio-button checkedness, and live filtering;
`HTMLOptionsCollection` depends on `select`/`option` state and the normative DOM
mutation spine. Add `DOMStringList` with its first real consumer rather than as
an otherwise unowned list.

Web IDL supplies the reusable legacy indexed and named property algorithms.
`HTMLAllCollection`'s additional `[[Call]]` behavior is an HTML-specific exotic
surface and must not broaden every legacy platform object into a callable one.

`HTMLAllCollection` requires JavaScript's engine-internal [[IsHTMLDDA]]
behavior (`typeof document.all`, falsiness, and loose equality). Userland
JavaScript cannot reproduce that contract. V8 supplies native allocation
primitives exposed by the compatibility addon and used by the binding. See the
remaining ordering clash below. Keep
required behavior as ordinary test expectations unless an expected failure is
explicitly approved.

## Section 2.6.4 dependency audit — 2026-10-14

The reflection slice is committed. All three collection subsections have been
read. Native allocation, HTMLAllCollection and its binding are implemented.
Form and options collection algorithms now have concrete element owners, with
the missing §4.10 algorithms recorded in the [forms roadmap](../../dom/nodes/html/forms/ROADMAP.md).
§2.6.5 `DOMStringList` is outside this slice.

| Section | Existing foundation | Missing work and dependencies |
| --- | --- | --- |
| §2.6.4.1 `HTMLAllCollection` | Implemented live all-element view, restricted name matching, name/index dispatch, cached `document.all`, and native callable, undetectable platform identity | The property-order clash below remains; without the addon the attribute is deliberately absent. |
| §2.6.4.2 `HTMLFormControlsCollection` | Owner-supplied live membership, supported names/indices, and live `RadioNodeList` for multiple matches; inherited HTMLCollection platform behavior | `form.elements` membership needs listed-element classification and form-owner association, including controls outside the form subtree. Its owner method explicitly throws pending that work. |
| §2.6.4.2 `RadioNodeList` | NodeList binding and live filtering; value uses concrete input type state and checkedness | Radio-group exclusion remains an explicit input-owned stub, with an approved expected-failure regression. |
| §2.6.4.3 `HTMLOptionsCollection` | Length changes, indexed assignment, add/remove, names/indices, selected-index delegation; select-owned option list and explicit selection changes; concrete option/optgroup construction | Automatic selectedness, option reset notifications, selectedcontent, and their mutation hooks remain explicit owner stubs. `[CEReactions]` remains an existing dependency. |

`HTMLFormElement` now replaces the old declaration-only FormData identity.
`form`, `input`, `select`, `option`, and `optgroup` construct their respective
implementations and expose their implemented IDL fragments. The form and
selection algorithms belong to [HTML §4.10](https://html.spec.whatwg.org/multipage/forms.html).
Three approved expected-failure tests retain the required membership, radio-group,
and automatic-selection behavior. An unexpected pass fails the test so its marker
can be removed. The collection algorithms are ready for this slice; full §2.6.4
behavior still depends on those owners, reaction delivery, and the native ordering
repair below. This is not completion of §4.10.

### Native allocation and binding

Ordinary legacy platforms use `LegacyPlatformObjectBinding.createObject()` and
a JavaScript Proxy. Supplying an undetectable backing object to that path
is insufficient: wrapping it loses the required falsiness, typeof and loose
equality behavior.

A focused probe on the configured custom Node 27 runtime used V8's testing
intrinsic `%GetUndetectable()` and an otherwise empty Proxy around its result:

| Value | Boolean | typeof | == null | Call result |
| --- | --- | --- | --- | --- |
| Native object | false | `undefined` | true | null |
| Proxy around it | true | `function` | false | null |

The intrinsic was used only to establish the engine boundary, not as a proposed
production API. Blink's [binding generator](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/bindings/scripts/bind_gen/interface.py)
configures `HTMLAllCollection` with V8's public `SetCallAsFunctionHandler()` and
`MarkAsUndetectable()`. The compatibility addon now uses those public APIs in
`createHTMLDDA(context, call)`, with native regressions for calls, special checks,
realm ownership, direct property handlers, and garbage collection. No additional
V8 patch is needed. The factory invokes supplied call steps without interpreting
their arguments; HTML owns the collection's dispatch and conversion rules.

Web IDL's `HTMLAllCollectionBinding` reuses its indexed/named algorithms through the addon's direct
`setPropertyHandlers()` entry point. The older object-to-object delegate adapter
can split assignment and deletion between the native receiver and the backing
object; it is not the HTMLDDA path. The native callbacks now report physical own
properties and let mutation handlers return undefined for ordinary V8 behavior.
Web IDL intercepts collection properties; ordinary accessors and data properties
remain on the actual platform object. This preserves alternate receivers even on
Node 26+, whose property callbacks expose only the holder. No Node-version branch
is needed in Web IDL. Native and binding regressions cover these receiver cases.
HTML lookup/call steps remain in HTML, allocation in addon/JS Engine, and reusable
indexed/named behavior in Web IDL.

The declaration's `createHTMLAllCollection` hook is specific to this interface.
Native allocation for other objects need not share its undetectable callable and
property-handler contract. JS Engine's shared `isObject`/`isCallable` operations
handle its misleading `typeof`. Web IDL conversion, callback boundaries and
coercion use these predicates without separate author-value variants.
Recognition relies on the native factory's guaranteed callability, without a
temporary Proxy. Regressions cover callback conversion/results, overload and
union selection, nested values, synchronous/asynchronous iterator methods,
coercion, explicit unwrapping, interface projection, and stable platform identity.

Eric approved omitting `Document.prototype.all` when the native capability is
unavailable. Do not install a getter returning undefined or a truthy JavaScript
collection substitute. This is an intentional backend limitation, not an optional
HTML requirement. Native availability gates the exposed API; Node
upstreaming is not a prerequisite for the addon-backed implementation.

### Property enumeration order

`SPEC_CLASH(htmlallcollection-property-order)`: Web IDL's
[legacy [[OwnPropertyKeys]]](https://webidl.spec.whatwg.org/#legacy-platform-object-ownpropertykeys)
orders indices, visible collection names, ordinary own string properties, and
symbols. A live probe with a named element `entry` followed by an author-created
`accessor` property produced these string-key suffixes:

| Engine | Non-index own keys |
| --- | --- |
| Chromium | `accessor`, `entry` |
| Firefox | `entry`, `accessor` |
| WebKit | `entry`, `accessor` |

Browlet currently follows V8/Chromium. Eric approved retaining this clash for the
current slice and discussing an engine-level repair afterward. Native V8 merges
ordinary string keys before intercepted names, regardless of the names returned
by our handler. Keeping ordinary properties physical is what preserves accessor
receivers; an outer Proxy would destroy [[IsHTMLDDA]]. Do not describe this order
as spec-conforming. The focused collection and native tests retain the observed
order; an engine repair must update them to the Web IDL order.

### Assignment and separate receivers

`SPEC_CLASH(htmlallcollection-assignment)`: Web IDL's
[[Set]](https://webidl.spec.whatwg.org/#legacy-platform-object-set) ignores named
properties when obtaining the descriptor for ordinary assignment, but retains
indexed descriptors. For a collection containing a named element `entry`, a live
probe gave the following `Reflect.set()` results:

| Operation | Web IDL / Browlet | Chromium | Firefox / WebKit |
| --- | --- | --- | --- |
| Set `entry` on the collection | false | true (no replacement) | false |
| Set `entry` with a separate ordinary receiver | true; receiver gets the value | false | true; receiver gets the value |
| Set supported index `0` with a separate receiver | false | true | false |

Browlet follows the written rule and Firefox/WebKit. V8's query flags are separate
from the public property descriptor: the native binding permits named assignment
to a separate receiver, while the public descriptor remains read-only and the
collection's define handler rejects replacement. Indexed properties retain their
read-only query flag. This works through the existing addon, without an engine patch.

## Removal condition

Burn this file after all four collection families have live-tree behavior and
public binding tests, with the [[IsHTMLDDA]] host limitation still explicit if
the engine cannot provide it.
