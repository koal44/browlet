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
  and critical-resource completion. Current inline sheets are associated synchronously;
  explicit import loading still needs its HTML caller. The missing
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
PI and header loading are connected; HTML `<link>` needs both
[§4.2.4's resource acquisition](https://html.spec.whatwg.org/multipage/semantics.html#obtaining-a-resource-from-a-link-element)
and [§4.6.8.23's stylesheet processing](https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet).
`CSSStyleSheetImpl.loadImports()` connects an import tree and starts its first attempt.
`DocumentImpl.loadStyleSheetImports()` connects it to `fetchCSSStyleSheet()` and accepts
per-request settings from its caller. Actual decoded encodings survive BOM override;
child URLs use the final response base. The callback reports aggregate success only
after all nested attempts finish. Cancelling suppresses old callbacks and associations.
HTTP failures associate empty imported sheets while still reporting failure; rejected
response CSS is discarded. Other rejection paths retain their existing null association.
The Fetch helper reports `success`, `http-error`, or `failure`; the import adapter
uses that outcome without repeating the HTTP-status check.

CSS Values §4.5.4 is owned by Stylelet's
[resource fetcher](../../stylelet/resource.ts), which calls Fetch with the existing
owning environment. Import parsing retains `UrlValue`, whose
`applyRequestModifiers()` method supplies the recognized request modifiers.
The generic fetch algorithm remains separate from the CSSOM import adapter: it
starts with a client referrer for no-CORS requests, while the existing adapter uses
the parent stylesheet's referrer and response policy. Reconcile those contracts
before replacing the existing fetch path; preserve its outcome and cancellation behavior.

`SPEC_GAP(css-style-resource-sheet)`: [fetch a style resource](https://drafts.csswg.org/css-values-4/#fetch-a-style-resource)
uses `sheet` without defining it, then tests its origin-clean flag without a null
case. The translation derives the containing stylesheet exactly as the
base-URL algorithm does. With no sheet, it leaves the initiator type unset. This is
an explicit reading of the incomplete algorithm, not a browser-compatibility choice.
The declaration-block input is `CSSStyleDeclarationImpl`, which carries the parent
rule; the underlying `CSSDeclarationBlock` collection does not retain that ownership.

CSSOM mutations use the retained connection; automatic startup from HTML/PI/header
owners and imported-rule cascade traversal remain unconnected. The bounded owner
integration work is:

- [ ] Follow HTML's [update a style block](https://html.spec.whatwg.org/multipage/semantics.html#update-a-style-block)
  from an inline sheet through unconditional imports; connect the existing PI and
  header owners too. External `<link>` has the separate algorithms linked above.
- [ ] Supply the inline sheet's encoding from its owner before starting imports,
  so imported bytes receive the correct fallback encoding.
- [ ] Connect attempt completion and cancellation to owner events and the
  [three distinct blocking gates](../loader/ROADMAP.md). Cover replacement,
  removal, and adoption; a top-level fetch does not finish its import tree.
- [ ] Make loaded imports participate at their source-order position in the
  [cascade](../../stylelet/engine/ROADMAP.md). Conditional applicability and
  layers remain further work, separate from retaining an imported sheet.

CSSOM creates header sheets after fetching; Firefox registers pending loads
before fetching. HTML's current Document blocker set holds elements; header loads
need their own reviewed connection rather than an invented element owner.
Document abortion still reaches FetchGroup.cancel's provisional no-op, and
Document.finishLoading's provisional timing does not establish correct load-event ordering.

`SPEC_GAP(stylesheet-import-parse-url)`: Cascade's
[fetch an import](https://drafts.csswg.org/css-cascade-4/#fetch-an-import) passes
`parsedUrl` to stylesheet parsing without defining it. Reconcile that input with
CSSOM's fetch/create path before unifying the algorithms; preserve the existing
final-response base URL behavior while the specification input remains unresolved.

`SPEC_CLASH(stylesheet-import-content-type)`: the same import algorithm rejects
a non-`text/css` MIME type after its quirks exception, but the following
[content-type prose](https://drafts.csswg.org/css-cascade-4/#content-type) also
treats a missing type as `text/css`. Resolve that discrepancy against CSSOM and
browser evidence before changing acceptance behavior. No new choice was made
in this reading pass.

`SPEC_GAP(stylesheet-import-loading)`: HTML's
[style completion steps](https://html.spec.whatwg.org/multipage/semantics.html#update-a-style-block)
leave critical-subresource fetching undefined. [Issue 968](https://github.com/whatwg/html/issues/968)
remains open; its discussion favors shared HTML request setup. Our explicit operation
keeps CSS dependency tracking in Stylelet and document-specific request setup in Browlet. HTML
retains task delivery, events, blockers, and superseded-load cancellation. This is
implementation coordination, not a newly specified algorithm. The current
[critical-subresource definition](https://html.spec.whatwg.org/multipage/infrastructure.html#critical-subresources)
includes recursive imports; the broader image/font question remains
[issue 1088](https://github.com/w3c/csswg-drafts/issues/1088).

Keep coordination centralized in `StyleSheetLoad`. Each sheet is fully parsed before
its imports start; supplied fetch callbacks may nevertheless complete immediately.
The `#visiting` guard prevents that completion from overtaking unvisited siblings.
Encoding remains a direct dependency for label/BOM algorithms and byte decoding.

`SPEC_CLASH(stylesheet-referrer-policy)`: retain each external sheet's response
policy, including the empty unspecified policy. Import request construction uses
`strict-origin-when-cross-origin` when that policy is empty.
Eric selected that fallback on 2026-10-24. The
[Referrer Policy CSS integration](https://w3c.github.io/webappsec-referrer-policy/#integration-with-css)
distinguishes external-sheet policy from the inline owner's live document policy,
but leaves stylesheet header processing as a specification issue. In the local
probe, Chromium 149.0.7827.55 and Firefox 151.0 honored explicit stylesheet headers;
WebKit 26.5 used the document policy and URL instead. Without a header, Firefox used
the default, while Chromium/WebKit used the document policy. Follow Firefox here.
Blink's `StyleRuleImport::RequestStyleSheet` and Gecko's `Loader::LoadChildSheet`
consume retained response-derived referrer information; WebKit's
`CachedResourceLoader` supplies the document policy. Read headers from the internal
response even when Fetch filters author-visible headers. Inline imports use the
document URL, independently of their CSS base URL. The request-settings callback
can explicitly override the default request policy; it does not replace the
document's CSP policy container.

CSSOM's [insert](https://drafts.csswg.org/cssom/#insert-a-css-rule) and
[remove](https://drafts.csswg.org/cssom/#remove-a-css-rule) algorithms specify rule
mutation and parent associations, but no import-loading notification. This belongs
to `SPEC_GAP(stylesheet-import-loading)`. Blink/WebKit start imports from their
stylesheet-contents insertion paths; WebKit explicitly calls `cancelLoad()` on
removal. Our hooks run after successful insertion/removal and internal rule replacement.
Removal withdraws pending requests throughout the removed import branch, cancels them,
and ignores late responses. Replacement withdraws old branches and adds new ones
before checking completion. Existing associated sheets are retained.

The loading root retains its last `StyleSheetLoad` and that attempt's callbacks.
Insertions join a running attempt; after completion they create a new finite attempt
for the added imports, without refetching existing siblings. Descendant mutations
find the connection through attached import rules. Each attempt is published before
its optional `started(load)` notification, which runs before fetching. Completion is
once per attempt; cancelled attempts suppress completion. Normal completion retains
the connection; cancellation disconnects it if the attempt is still current, even
when already finished. Sheet removal cancels its connection before clearing owner
associations. Cancelling an old handle cannot disconnect a newer attempt. Automatic
HTML startup, blocker/event handling, and inline-sheet encodings remain separate. The synchronous-callback guard
also covers mutations during a fetch and prevents starting further requests in a
branch removed during traversal.

`SPEC_CLASH(stylesheet-import-descendant-failure)`: preserve aggregate failure at
any import depth, matching Gecko's `Loader::MarkLoadTreeFailed`. In the 2026-10-24
probe, Chromium 149, Firefox 151, and WebKit 26.5 all waited for a delayed sibling.
Firefox reported a failed grandchild to the root; Chromium/WebKit reported success.
All three associated empty sheets with failed HTTP imports. Their differing root
results do not change our aggregate-failure contract.

`SPEC_GAP(stylesheet-import-cycles)`: Cascade §2 does not specify cycle handling.
Follow Blink's `StyleRuleImport::RequestStyleSheet`, WebKit's
`StyleRuleImport::requestStyleSheet`, and Gecko's `Loader::LoadChildSheet`: skip
imports of ancestor resources without treating them as request failures. Like
Blink/WebKit, compare original and final URLs without fragments. Repeated sibling
imports remain separate occurrences; this is not a global resource deduplication set.

Import association combines the parent's origin-clean flag with the child's
response-derived flag before loading descendants, as required by
[Cascade's import processing](https://drafts.csswg.org/css-cascade-4/#fetch-an-import).
An unclean child does not clear its parent's flag or make the load fail.

The request-settings callback must eventually supply current owner state; it does
not manufacture HTML policy or infer blockers. URL request modifiers still need
review; referrer policy alone does not finish
response-policy propagation. Imported
conditions/layers and automatic stylesheet loading remain prerequisites for full
browser import behavior. Focused tests cover explicit completion and cancellation
in Stylelet, including Fetch/decoding without Browlet, plus Browlet's document integration.
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
  mechanism, as Firefox does; Chromium/WebKit ignore it. HTML's
  [stylesheet link type](https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet)
  instead makes its Link-header processing steps a no-op. Preserve the existing
  CSSOM choice when connecting the generic HTML header path.
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

The [declaration-state owners](../../stylelet/cssom/README.md#declaration-data-and-mutation)
retain one collection; CSSOM owns flags, associations, and write-back.
Preserve that lifecycle when adding shorthand, descriptor, or URL-bearing properties.

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
