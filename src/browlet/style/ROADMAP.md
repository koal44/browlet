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
- [ ] Connect shadow tree-scope selection and encapsulation precedence to matching.
  ShadowRoot's retained sheet collections and adopted-sheet binding now work;
  Window's current computed-style path still starts from the document scope.
- [ ] Complete HTML `<link>` and CSS import loading using the Fetch-backed
  [external stylesheet consumer](README.md#sheet-association-and-execution).
- [ ] Supply CSSOM add-a-sheet step 2 from HTML's resource lifecycle. Document's
  `addScriptBlockingStyleSheet()`/`removeScriptBlockingStyleSheet()` and parser
  wait exist. The producer still needs parser-created state, media applicability,
  and critical-resource completion. Current inline sheets finish synchronously;
  ordinary `@import` reaches an explicit unfinished grammar. The missing
  connection is recorded beside `LinkStyleMixin` association.

## Stylesheet collection disagreements

CSSOM [§6.2](https://drafts.csswg.org/cssom/#css-style-sheet-collections) and
DOM's [adoption steps](https://dom.spec.whatwg.org/#concept-node-adopt) were
compared with Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5 on 2026-10-20.

- `SPEC_GAP(shadow-adopted-sheets-adoption)`: neither algorithm clears a shadow
  root's adopted sheets when its host changes documents. All three browsers
  clear the backing list, preserve the array, and reject subsequent additions
  from the old document. Follow that behavior; additions from the new document
  succeed. Same-document adoption preserves the list. Chromium's source also
  exempts moves to/from a document's template-contents owner; revisit that case
  with HTMLTemplateElement's unfinished owner-document machinery.
- `SPEC_CLASH(default-style-response-fields)`: follow CSSOM's individual header
  fields in order, using each entire value as the set name. Chromium/WebKit
  ignore HTTP `Default-Style`. Firefox honors a single field but combines
  repeated `alpha` and `beta` fields into `alpha, beta`; CSSOM selects `beta`.
  A literal comma in one field remains part of the name.
- `SPEC_CLASH(stylesheet-set-disabled-flags)`: follow CSSOM/Firefox by changing
  each sheet's `disabled` flag during preferred-set selection. Chromium/WebKit
  keep those flags false and select set applicability separately. With untitled,
  `alpha`, and `beta` sheets, all choose the first non-alternate titled set by
  default, but the flags differ.

[Browlet regressions](../../../test/browlet/style/adopted-stylesheets.test.ts)
cover retained lists, conversion, current-document checks, and host adoption.
[Response tests](../../../test/browlet/style/default-style.test.ts) cover ordered
fields before association. The enabled
[browser comparisons](../../../test/stylelet/scenarios/stylesheet-sets.test.ts)
exercise Stylelet and retain CSSOM expectations with separate browser failures.

## External stylesheet loading

[CSSOM §6.3](https://drafts.csswg.org/cssom/#style-sheet-association), the
[2010 XML stylesheet Recommendation](https://www.w3.org/TR/2010/REC-xml-stylesheet-20101028/),
and [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288.html) supply the contracts.
PI and header loading are connected; HTML `<link>` remains HTML §4.2.4 work.
Ordinary `@import` reaches an explicit missing-grammar error; its future loader
must retain the actual decoded encoding and await child loads. Script/load/render
blocking remains a separate resource-lifecycle review. CSSOM creates header sheets
after fetching; Firefox registers pending loads before fetching. HTML's current
Document blocker set holds elements. Connect pending loads, media applicability,
and critical-resource completion there; a top-level fetch does not finish imports.
Document abortion also still reaches FetchGroup.cancel's provisional no-op.
`SPEC_GAP(http-link-quirks-mode)`: header MIME checks use the document mode at
response completion. CSSOM leaves early-header/undetermined-mode timing open;
revisit with HTML loading.
XML document parsing is unfinished; the DOM-created PI path works independently.
DTD-contained instructions may be ignored under the XML specification. Its XSLT
embedded-module reference is informative, not a prerequisite for CSS loading.

Installed Chromium, Firefox, and WebKit were compared on 2026-10-20:

- `SPEC_CLASH(xml-stylesheet-prolog)`: follow CSSOM/Firefox's prolog restriction;
  Chromium/WebKit also process instructions after the document element.
- `SPEC_CLASH(xml-stylesheet-fragment)`: fetch fragment URLs normally with CSS
  MIME checks; Chromium/WebKit skip fragment-only CSS references.
- `SPEC_CLASH(xml-stylesheet-rejected-association)`: keep CSSOM's null association
  after rejection; all three browsers retain empty PI sheets for HTTP/MIME errors.
- `SPEC_CLASH(stylesheet-http-status)`: reject non-success status codes like all
  three browsers; CSSOM checks network errors and MIME but omits HTTP status.
- `SPEC_CLASH(http-link-stylesheets)`: implement CSSOM's at-risk Link-header
  mechanism, as Firefox does; Chromium/WebKit ignore it.
- `SPEC_GAP(xml-stylesheet-events)`: CSSOM leaves PI load/error events unspecified.
  Follow Chromium/WebKit by dispatching neither; Firefox dispatches them.
- Advisory types use MIME essence comparison, accepting `TEXT/CSS; charset=utf-8`
  like Firefox. Chromium/WebKit reject it; CSSOM permits rejecting unsupported types.

[Network/lifecycle regressions](../../../test/browlet/style/stylesheet-loading.test.ts)
and [enabled browser comparisons](../../../test/stylelet/scenarios/stylesheet-loading.test.ts)
cover this boundary. Native expected failures cannot mask project assertions.

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
while auditing the now-bound CSSStyleProperties implementation.
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

The [CSSOM tests](../../stylelet/cssom/README.md#existing-evidence-and-its-limits)
separate observable behavior from storage-trial assertions; keep containers provisional.

Clone/import behavior needs its own audit: Blink and WebKit explicitly recognize
cloning and bypass the ordinary CSP gate. Do not infer clone behavior from a
constructor's incidental attribute read or silently adopt that bypass.

Carry forward after reviewing this lifecycle trial: revisit repeated CSP
source-token classification/hash decoding. Whole-token
lowercasing is invalid for nonce/hash payloads and URL paths. Parsed-source
caching would first need a deliberate policy for the currently mutable `tokens`
array. These are review concerns, not authorization for a broader CSP rewrite.

Review the current [declaration-state owners](../../stylelet/cssom/README.md#declaration-data-and-mutation)
alongside the bound CSSStyleDeclaration/CSSStyleProperties API; their split is provisional.

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
