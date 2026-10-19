# Style integration roadmap

## Present

- `integration.ts` connects Browlet Documents/elements/tree scopes to Stylelet
  state and implements the current `DocumentOrShadowRoot`,
  `ElementCSSInlineStyle`, and `LinkStyle` host behavior.
- Stylelet exports those mixins' neutral declarations through
  `styleletIDLDefinitions`; Browlet contributes only their host behavior and
  assembles the declarations into its Web IDL bindings.
- Documents and CSSOM implementations retain their existing environment through
  `StyleletEnvironment`. UserAgent supplies `dom` and the `URLImpl` constructor
  through `URL`; `env.exec` supplies the shared
  Promise and background scheduling plus `queueTask('dom-manipulation', steps)`
  for stylesheet delivery.
  There is no separate document execution adapter. Standalone Stylelet uses
  native scheduling without loading Browlet's engine runtime.
- Stylelet's host-neutral URL contract exposes `href`. Standalone hosts use
  their native URL constructor or supply one explicitly. Stylesheet creation
  and computed resource values use the same provider; CSSOM exposes URL strings.
- CSSOM exception allocation remains provisional: Browlet's direct CSSOM
  APIs receive platform exceptions from the owning environment, while
  standalone hosts supply their own constructor through `exec.DOMException`.
  Core's `WebIDLExecution` owns that contract. This prevents implementation
  objects from escaping through APIs that do not yet have member bindings.
  Full CSSOM bindings must project new failures in the invoking method's realm.
- Stylelet and Selectlet share Infra's `DOMOperations` through the `dom` option.
  Browlet supplies [implementation operations](../integration/dom.ts), including
  fast HTML class checks and access to existing inline-style state. Engines never
  read host node fields directly. Tests cover Browlet, jsdom, and opaque nodes
  that reject property access while preserving node identity.

## Next boundary change

- [ ] Replace the provisional no-op `Document.updateLinkStates()` from HTML
  §2.4.3, including visited-link history and style invalidation after a base URL
  changes. Selectlet's script-visible `:visited` result is not that history or
  a renderer invalidation mechanism. Keep browser history in Browlet and expose
  only the resulting host state/invalidation through Stylelet's existing boundary.
- [x] Share DOM operations with Selectlet, retaining original node identities
  without requiring host nodes to implement either engine's structural types.
- [ ] Connect focus, editing, custom-element upgrade state, and form/media state
  as Browlet implements those HTML features. Its operations currently report
  the missing feature when requested. Do not synthesize
  checkedness, validity, or focus from attributes to satisfy Stylelet.
- [x] Move host-neutral Web IDL declaration contributions for Stylelet-owned
  CSSOM objects and mixins into the Stylelet package.
- [x] Let Browlet bind those declarations to Browlet-specific implementation
  adapters; let jsdom generate or bind its own wrappers from the same semantic
  contribution.
- [x] Keep style-sheet fetching and HTML `<link>` processing in `loader/` and
  HTML; keep semantic sheet/declaration mutation in Stylelet.
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
  with Stylelet's CSSOM Window partial and projected style results. Its current
  adapter only unwraps the Element; it does not complete Web IDL conversion.
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

## Style attributes — HTML §3.2.6.5

HTML, SVG, and MathML elements own their inline-style mixins from construction.
Null-namespace `style` additions and changes check CSP immediately and, when
accepted, create/update a retained `CSSDeclarationBlock`, including parser-created
attributes and changes before the first `.style` read. The block owns property
data without a DOM owner, environment, or CSSOM object. First and later inputs
both call the mixin's `attributeChanged()`. Reading `.style` lazily creates a
`CSSStyleDeclarationImpl` around that same block without reading the attribute
or checking policy. CSSOM writes update the block and use the CSSOM object's
updating flag to avoid recursive parsing and CSP checks. Removing
the attribute clears declarations without a CSP check, allocating nothing if
there is no block yet. `getInlineStyleBlock()` returns declaration data without
allocating, or null when no block exists. Browlet's DOM provider uses that
query directly, including for elements outside the three CSSOM includers.
Stylelet treats a provider's null as authoritative empty state; only an absent
provider enables raw-attribute parsing. Computed-style reads therefore neither
create inline CSSOM nor revive a CSP-blocked raw attribute. Computed results
have separate blocks; the inline-style mixin never retains them.

Browlet's mixin checks the current node document's global CSP list, including
after adoption, before delivering accepted input to `CSSDeclarationBlock`.
The former `allowsAttribute` callback is removed. Stylelet exposes its existing
updating flag through a getter; the mixin checks it before policy evaluation.
Only Stylelet changes the flag, and its `finally` clears it even if the host's
attribute write throws. Standalone hosts can apply their own input policy
without importing Browlet or giving Stylelet a policy callback.
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

The 2026-10-18 review selected explicit attribute input and separate declaration
storage. `CSSStyleDeclarationImpl` construction exposes a supplied block, empty
by default, without reading its owner. The permanent mixin owned by each
HTML/SVG/MathML element retains the block and lazily creates its CSSOM object. Each includer
forwards null-namespace style notifications to its own mixin; generic `Element`
no longer owns or discovers the mixin. First and later assignments use the same
`attributeChanged()` path, with CSP checking entirely in Browlet.

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

The current trial follows the engines' separation of property data from CSSOM.
Blink's `MatchStyleAttribute()` and WebKit's `ElementRuleCollector` read retained
property data directly; Gecko's `GetInlineStyleDeclaration()` retrieves its
parsed attribute block independently of `Style()`. Their `getComputedStyle()`
implementations create separate computed-style CSSOM objects. Browlet's cascade
likewise reads the block through `DOMOperations.inlineStyleBlock`, without
requesting the inline CSSOM implementation. The previous combined representation
created CSSOM on accepted attribute input as well as author access.

Attribute input uses one path before and after CSSOM creation. After updating
the block, it calls `synchronizeIndices()` only if CSSOM already exists. This is
an explicit temporary dependency on the current numeric-property implementation;
full CSSOM Binding should own indexed property exposure and remove this step.
The block needs no observer, CSSOM reference, or host callback. CSSOM retains its
existing host write-back and rule-change notification responsibilities.

Regressions cover explicit external-host initialization, stable `.style`
identity, immediate parsing and one CSP check per attribute input, accepted state
after blocked replacements, removal without CSP, CSSOM write-back without
reporting across all three includers, and current document policy after adoption.
Host write failures reset the updating flag; unrelated namespaced style attributes
are preserved during CSSOM writes and null-namespace removal. Removing a blocking policy
before the first CSSOM read cannot revive a rejected attribute. Parser insertion
uses the same input path. The new external-host regression first failed because
construction had already consumed the attribute instead of creating empty state.
Cascade regressions first reproduced allocation on a read and raw-attribute
parsing despite an explicit empty provider result. They now cover non-allocating
reads across all three includers, CSP-blocked input before and after policy
removal, and the retained fallback for hosts without a provider.
The storage-split regression first observed CSSOM creation during accepted
attribute input in all three element families. It now verifies parsing and
cascade reads before the first CSSOM access, shared block identity, importance
handling, live numeric indices, removal, and subsequent CSSOM write-back.
Clone/import behavior needs its own audit: Blink and WebKit explicitly recognize
cloning and bypass the ordinary CSP gate. Do not infer clone behavior from a
constructor's incidental attribute read or silently adopt that bypass.

Carry forward after reviewing this lifecycle trial: revisit repeated CSP
source-token classification/hash decoding. Whole-token
lowercasing is invalid for nonce/hash payloads and URL paths. Parsed-source
caching would first need a deliberate policy for the currently mutable `tokens`
array. These are review concerns, not authorization for a broader CSP rewrite.

The planned CSSOM review should also examine the provisional direct exposure of
declaration implementations and their inline string conversions. Completing the
CSSStyleDeclaration/CSSStyleProperties binding boundary will establish which
conversions belong to the author API and which behavior internal callers need.
The declaration object still owns the retained property data. Non-allocating
cascade reads do not require the separate storage proposed in alternative 3.

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

Stylelet decides cascade, inheritance, and computed values. The future
`rendering/` domain consumes those values to create boxes, replaced content,
widgets, and print output. Predicates such as “being rendered” cannot be
answered from `display` alone because SVG boxes, `display: contents`, native
widgets, and suppressed replaced content participate in the result.

## Removal condition

Burn this file after Stylelet owns its neutral declarations and Browlet's
integration is only the host adapter, HTML rendering inputs, and loader
connection.
