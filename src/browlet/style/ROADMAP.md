# Style integration roadmap

The [README](README.md) describes current owners, lifecycle, and host behavior.
This roadmap retains unfinished integration work and browser-conflict evidence.
The [Stylelet roadmap](../../stylelet/ROADMAP.md) covers CSS feature dependencies;
the [CSSOM roadmap](../../stylelet/cssom/ROADMAP.md) owns the interface and
declaration-state review.

## Next boundary change

- [ ] Replace the provisional no-op `Document.updateLinkStates()` from HTML
  §2.4.3, including visited-link history and style invalidation after a base URL
  changes. Selectlet's script-visible `:visited` result is not that history or
  a renderer invalidation mechanism. Keep browser history in Browlet and expose
  only the resulting host state/invalidation through Stylelet's existing boundary.
- [ ] Connect focus, editing, custom-element upgrade state, and form/media state
  as Browlet implements those HTML features. Its operations currently report
  the missing feature when requested. Do not synthesize
  checkedness, validity, or focus from attributes to satisfy Stylelet.
- [ ] Connect HTML style/link processing and critical-resource completion to
  `Element.blockRendering()`/`unblockRendering()`. Document's
  [§3.1.6 mechanism](../html/ROADMAP.md#section-316-render-blocking) and shared
  disconnection/attribute cleanup are implemented; the current inline sheet
  association does not supply the complete resource-loading lifecycle.
- [ ] Finish projecting `CSSStyleSheet` and the CSSOM objects it exposes through
  the active host's Web IDL binding. Stylelet retains their implementation
  state and mutation behavior. Verify the declared API surface as well as
  behavior: ambient `implements` clauses do not check the implementation's
  converted values, and declarations alone do not establish conformance.
- [ ] Replace the provisional `projectWindow()` installation of `getComputedStyle`
  with Stylelet's CSSOM Window partial and projected CSSStyleProperties results.
  Its current adapter only unwraps the Element; it does not complete Web IDL
  conversion.
- [ ] Restore `ObservableArray<CSSStyleSheet>` for `adoptedStyleSheets` once
  those platform objects exist. Web IDL already supports observable arrays;
  `TreeScope` should retain only the backing collection and CSSOM mutation
  steps, with conversion and proxy ownership in the binding. Move the proxy
  factory into Web IDL and remove `src/infra/observable-array.ts`.
- [ ] Exercise CSSOM exception and promise boundaries through the projected
  APIs, including borrowed cross-realm calls. Replace the interim owner-realm
  exception construction with projection of DOMException implementations in the
  operation's realm, preserving author-thrown exceptions. Complete CSSOM
  projection is still required to exercise this boundary.
- [ ] Supply ShadowRoot's missing style scope and connect tree-scope selection
  to matching. Shared DocumentOrShadowRoot declarations do not establish a
  working shadow stylesheet implementation.
- [ ] Connect external sheets through their actual producers: HTML `<link>`,
  XML `xml-stylesheet` processing instructions, HTTP Link/Default-Style headers,
  and CSS imports. Account for cancellation, response policy, MIME/encoding,
  origin-clean/base state, load completion, and script/render blocking with the
  loader and node owners; do not make Stylelet fetch by itself.

The contracts come from CSSOM, CSSOM View, CSS Style Attributes, and HTML's
style/link processing rather than one WHATWG HTML section. This file records
the host boundary, not the CSS feature backlog.

## Media matching

Defer [HTML §2.3.10](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#mq)
integration until a concrete caller needs matching. Current
sheet associations retain their media lists, but Stylelet's
[`getActiveStyleSheets()`](../../stylelet/engine/cascade-engine.ts) checks only
the disabled flag. Stylesheet applicability is a natural first integration;
HTML's [`<source media>` selection](https://html.spec.whatwg.org/multipage/embedded-content.html#attr-source-media)
and CSSOM View's [`Window.matchMedia()`](https://drafts.csswg.org/cssom-view/#dom-window-matchmedia) are
other consumers. The latter creates a `MediaQueryList` associated with the
Window's Document and matches that Document's state.

Review the existing Document-owned style engine when implementing a consumer.
Keep CSS parsing/evaluation in Stylelet and apply HTML's empty/whitespace-list
rule where required. Determine the needed host inputs from that caller; no
Environment or Agent matching operation is prescribed by this roadmap.
The [Stylelet condition roadmap](../../stylelet/conditional/ROADMAP.md) owns CSS
evaluation and the required device/reference facts; [layout](../../layout/ROADMAP.md)
owns box/scroll results. Neither establishes a host measurement API yet.

Implement MediaQueryList separately from CSSOM's MediaList: it retains its
Document association, live matches, and event behavior. Deliver changed matches
in creation order at HTML's existing media-query phase. Device/preferences and
viewport changes invalidate matching; full layout is not required for every
feature. Test retained lists and notifications through the real host boundary.

## Style attributes — HTML §3.2.6.5

The [current lifecycle](README.md#inline-style-lifecycle) separates raw attribute
input, accepted declaration data, CSSOM access, and cascade reads. Its objects
remain under review; preserve the observable input/policy/write-back boundaries
while completing CSSStyleProperties and its Binding.
The [CSP roadmap](../browsing/policy/csp/ROADMAP.md#style-attribute-consumer)
records enforcement, reporting, hashes, and the approved browser differences.

**SPEC_CLASH(css-style-attribute-parsing):** follow
[CSS Style Attributes' declaration-only grammar](https://drafts.csswg.org/css-style-attr/#syntax)
and Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5 (2026-10-18).
An unmatched `}` is an invalid declaration token; it must not end the whole
attribute. Nested rule syntax is part of declaration-error recovery rather than
a rule whose following declarations become valid. CSSOM's current reference to
CSS Syntax's newer block-contents parser instead stops at `}` and recognizes
nested rules. `parseDeclarationList()` uses the existing declaration/component
consumers for attribute and CSSOM declaration text; stylesheet block parsing
keeps its own closing-brace/nesting behavior. At-rules are ignored. Regressions
first reproduced both failures and now exercise Stylelet in all three browsers.

Dependencies still open:

- **URL-valued properties and declaration provenance:** CSS Style Attributes
  requires relative URLs to retain the base URL at attribute-parse time. The
  standalone URL value resolver exists, but no registered CSS property currently
  uses it. When connecting one, retain the base with each declaration and pass it
  into value resolution; do not use a later document or engine base. CSSOM edits
  can mix declarations parsed under different bases, so one mutable base on the
  whole declaration block is insufficient. Custom-property URL substitution and
  adoption need the same review. All three browsers retained the original URL
  after a base change, including before the first `.style` read and after an
  equal-value attribute write. Eager parsing here does not claim that missing
  URL pipeline is complete.
- **CSSOM platform projection:** the existing SameObject/PutForwards `.style`
  binding still returns the provisional declaration implementation. Complete
  CSSStyleProperties interfaces, named property access, and method-realm exception
  behavior remain in the boundary work above.
- **Rendering:** author-origin inline precedence is already in Stylelet's
  cascade, but layout/painting and author usability without styles are not DOM
  mutation checks. The latter is an author-conformance requirement.

Tests: `test/browlet/style/inline-style.test.ts`, CSP's `style-attribute.test.ts`
and `source-list.test.ts`, and the enabled Stylelet `style-attribute` browser
scenarios. The manual `scratch/STYLE-ATTRIBUTE-PROBE.mjs` records the browser-only
CSP and base-URL comparisons; it is not part of the automatic regression suite.

### Lifecycle — explicit attribute input

The 2026-10-18 review selected explicit attribute input and tried separate
declaration storage. The current CSSOM review reopens that storage arrangement;
the engine evidence below informs it without requiring the same class split.

[CSSOM's declaration-block creation steps](https://drafts.csswg.org/cssom/#css-declaration-blocks)
do describe initialization from an existing attribute. HTML requires parsing at
attribute addition/change, independently of whether author code reads `.style`.
These requirements do not dictate our constructor placement or require a second
attribute-input path. A host attaching a declaration to an existing element
explicitly reads and delivers the current attribute through `attributeChanged()`.
Browlet's own elements receive their attributes after creation through ordinary
DOM notifications, so no separate initial read is needed.

Local implementation sources inspected on 2026-10-18:

- **Blink:** `Element::StyleAttributeChanged()` checks CSP and updates retained
  property data. `Element::style()` lazily creates an `InlineCSSStyleDeclaration`
  accessing that data; its constructor does not read the attribute. CSSOM edits
  invalidate the serialized attribute, with separate synchronization machinery.
  See `core/dom/element.cc` and `core/css/inline_css_style_declaration.{h,cc}`.
- **WebKit:** `StyledElement::styleAttributeChanged()` checks CSP before parsing
  element-owned `StyleProperties`. `cssomStyle()` obtains the retained CSSOM
  object from those properties. Attribute synchronization is separate from
  attribute input. See `dom/StyledElement.cpp` and
  `css/MutableStyleProperties.cpp`.
- **Gecko:** `nsStyledElement::ParseStyleAttribute()` checks CSP and ordinarily
  stores parsed declarations in the attribute value. `Style()` lazily creates
  the CSSOM object. A separate `ReparseStyleAttribute()` path handles attributes
  retained as text, including documents loaded as data; this is not evidence
  that every first CSSOM access is free of parsing. CSSOM mutation supplies a
  declaration directly. See `dom/base/nsStyledElement.cpp` and
  `layout/style/nsDOMCSSAttrDeclaration.cpp`.
- **jsdom:** `_initElementCSSInlineStyle()` eagerly creates an empty declaration
  during element construction. Attribute notifications subsequently supply
  text; the declaration constructor does not pull it from the element.
  `_settingCssText` suppresses write-back recursion. See
  `living/css/ElementCSSInlineStyle-impl.js`, `CSSStyleDeclaration-impl.js`, and
  `living/nodes/HTMLElement-impl.js` in its `lib/jsdom/` tree.

The storage trial followed the engines' separation of property data from CSSOM.
Blink's `MatchStyleAttribute()` and WebKit's `ElementRuleCollector` read retained
property data directly; Gecko's `GetInlineStyleDeclaration()` retrieves its
parsed attribute block independently of `Style()`. Their `getComputedStyle()`
implementations create separate computed-style CSSOM objects. Browlet's cascade
likewise reads the block through `DOMOperations.inlineStyleBlock`, without
requesting the inline CSSOM implementation. The previous combined representation
created CSSOM on accepted attribute input as well as author access.

The [CSSOM test inventory](../../stylelet/cssom/README.md#existing-evidence-and-its-limits)
separates observable regressions from storage-trial assertions. Existing coverage
includes explicit host initialization, first/later attribute input, one policy
check, accepted state after rejection, CSSOM write-back, namespace handling,
adoption, updating-flag cleanup on host failure, and authoritative empty provider
results. Do not let identity/allocation tests accidentally require the trial's
container arrangement when the interface implementation changes.

Clone/import behavior needs its own audit: Blink and WebKit explicitly recognize
cloning and bypass the ordinary CSP gate. Do not infer clone behavior from a
constructor's incidental attribute read or silently adopt that bypass.

Carry forward after reviewing this lifecycle trial: revisit repeated CSP
source-token classification/hash decoding. Whole-token
lowercasing is invalid for nonce/hash payloads and URL paths. Parsed-source
caching would first need a deliberate policy for the currently mutable `tokens`
array. These are review concerns, not authorization for a broader CSP rewrite.

Completing the CSSStyleDeclaration/CSSStyleProperties binding boundary must
establish which conversions belong to the author API and which behavior internal
callers need. Review the current [declaration-state owners](../../stylelet/cssom/README.md#declaration-data-and-mutation)
alongside that boundary rather than preserving their split by default.

## Unchanged style type

**SPEC_CLASH(style-type-same-value): stylesheet replacement after an equal-value write.**
The 2026-10-10 HTML §2.1 audit found that assigning `text/css` again to an existing
`style type="text/css"` replaced its sheet in Chromium 149.0.7827.55 and WebKit
26.5, discarding a rule added through `insertRule`. Firefox 151.0 retained the
sheet and the inserted rule. Browlet currently replaces it through `LinkStyleMixin`.

[HTML §2.1.4](https://html.spec.whatwg.org/multipage/infrastructure.html#dom-trees)
distinguishes equal-value assignments from changes, but the
[style-block update triggers](https://html.spec.whatwg.org/multipage/semantics.html#the-style-element)
do not explicitly include changes to this obsolete attribute at all. Review
both changed and unchanged type assignments with HTML §4.2.6/CSSOM before
changing this behavior. Do not infer a global attribute-notification shortcut
from either this split or the separate frozen-base-URL clash.

## Pseudo-elements and highlights

[CSSPseudoElement](https://drafts.csswg.org/css-pseudo-4/#CSSPseudoElement-interface)
associates a pseudo subject with its originating element and retains observable
identity independently of box existence. The inspected draft marks the API as
under design; ordinary CSSOM pseudo-style queries do not require adopting it.

[Custom highlights](https://drafts.csswg.org/css-highlight-api-1/#registration)
associate names with sets of AbstractRanges through the document's CSS.highlights
registry. Keep live Range adjustment and StaticRange validity with the
[range owner](../dom/ranges/ROADMAP.md). Registry/range/priority changes must
invalidate relevant styles and presentation; they do not synchronously paint.
Stylelet owns highlight style processing; layout supplies text fragments and
rendering supplies output/hit testing. Public interfaces, detailed styling, and
delivery remain unimplemented and require a focused review.

## HTML rendering inputs

HTML §15 contributes two kinds of style input that Browlet must not bury in
element implementations:

- a versioned HTML user-agent style sheet at the UA cascade origin; and
- presentational hints derived from content attributes at the author origin
  with zero specificity.

`ua-sheet.ts` should own the former and `presentational-hints.ts` the latter.
Hint extraction consumes HTML microsyntax parsers and produces ordinary
Stylelet declarations; it must not mutate inline style or special-case the
computed-style resolver. This includes both current and obsolete attributes.

Stylelet decides cascade, inheritance, and computed values. The planned
[layout engine](../../layout/ROADMAP.md) consumes internal style and content to
create boxes/fragments; [rendering integration](../rendering/ROADMAP.md)
coordinates HTML state, widgets, and print/output. Predicates such as “being rendered” cannot be
answered from `display` alone because SVG boxes, `display: contents`, native
widgets, and suppressed replaced content participate in the result.

Keep host-specific work and conflict evidence here as Stylelet's CSSOM contracts
become complete. Current integration behavior belongs in the README; general
CSS feature work belongs in Stylelet's roadmaps.
