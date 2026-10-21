# CSSOM roadmap

The [README](README.md) records present implementations and the focused baseline.
This file accounts for CSSOM's contracts and their dependencies; it does not
mark the specification implemented or prescribe the final declaration storage.

## Sources and related ownership

Primary reading used the local CSSWG `cssom-1/Overview.bs`,
`css-style-attr-1/Overview.src.html`, and WHATWG HTML's `source` section on the
style attribute. The reference roots are listed in the
[Stylelet roadmap](../ROADMAP.md#sources-and-reading-depth).

The [selector](../selector/ROADMAP.md), [rule](../css/ROADMAP.md),
[value-lifecycle](../value-processing/ROADMAP.md), [property](../props/ROADMAP.md)
and [Typed OM](typed/ROADMAP.md) guides own the related contracts.
Sections 1–5 and the §6 preface/§6.1–6.2 sheet and collection contracts have been audited.
Required rule/declaration bindings are present; their behavioral audit remains open. Related browser evidence lives in
the [Browlet style roadmap](../../browlet/style/ROADMAP.md) and
[CSP roadmap](../../browlet/browsing/policy/csp/ROADMAP.md#style-attribute-consumer).

## Declaration boundary

[css-stylesheet.ts](css-stylesheet.ts) and [style-properties.ts](style-properties.ts)
declare their constructor and property accessors through Web IDL Core. Sheet
construction receives `StyleletEnvironment` directly; property accessors forward
to implementation operations. Binding owns conversion, realm selection, and
projection. The [Web IDL contract](../../web-idl/README.md#entry-points-and-layout)
applies equally to standalone Stylelet and Browlet integration.

## Specification accounting

“Partial” means an implementation entry point exists, not that all its steps
or Platform behavior have been verified.

| CSSOM area | Current coverage | Remaining contract / next owner |
| --- | --- | --- |
| Introduction and terminology | CSS is the supported styling language; the property registry identifies supported built-ins. Binding separates author overrides from internal calls, covered for MediaList. | Implicit `::before`/`::after` existence belongs to pseudo-element matching/computed-style work, independently of box generation. |
| [Common idioms and CSSOMString](https://drafts.csswg.org/cssom/#common-serializing-idioms) | Identifier/string escaping, function/LOCAL formatting, URL serialization, and list separators; real DOMString typedef with conversion distinct from CSS preprocessing. | Function arguments remain the owning value grammar's responsibility. LOCAL formatting is ready for the missing font-source descriptor consumer. Preserve the reviewed [identifier clash](../syntax/ROADMAP.md#identifier-serialization-disagreement). |
| [Media queries and MediaList](https://drafts.csswg.org/cssom/#media-queries) | List parsing/recovery, serialization/comparison, mutation, complete IDL, and real Binding regressions, including sheet media. Modern conditions/ranges use the Media Queries grammar. | Device matching and additional feature interpretation belong to [Conditional Rules](../conditional/ROADMAP.md); serialization alone does not establish support. See disagreements below. |
| [Selectors](https://drafts.csswg.org/cssom/#selectors) | Section 5 parsing and serialization use `selector/parser.ts`, with namespace, combinator, attribute, pseudo-element, functional pseudo-class, and An+B coverage. | Connect CSSStyleRule getters/setters with the correct namespace/nesting context and complete the [consumer review](../selector/ROADMAP.md#parser-to-consumer-coverage). |
| [Style sheets](https://drafts.csswg.org/cssom/#css-style-sheets) | Metadata, one-pass initialization, typed construction/dictionary, access guards, replacement promises, simple insertion/deletion, legacy aliases, and projected identity/realm coverage. | Ordinary import/namespace grammars and mixed-rule hierarchy; actual response-derived origin/base state. Recognized missing grammars stop explicitly. |
| [Sheet collections](https://drafts.csswg.org/cssom/#css-style-sheet-collections) | Ordered document/shadow sheets, real observable-array binding and adoption checks, retained identities, preferred/selected sets, and ordered Default-Style response processing. | HTTP Link/external sheet producers, script blocking, and resource completion; shadow-tree cascade selection is separate from collection ownership. See the [collection disagreements](../../browlet/style/ROADMAP.md#stylesheet-collection-disagreements). |
| [Association and fetching](https://drafts.csswg.org/cssom/#style-sheet-association) | HTML/SVG inline style elements associate sheets through Browlet's LinkStyle mixin. | `<link>`, `xml-stylesheet`, HTTP Link, imports, cancellation, MIME/CORS/encoding, policy, and load events belong at their host/loader boundary. Collection helpers alone do not satisfy these algorithms. |
| [CSS rules](https://drafts.csswg.org/cssom/#css-rules) | A single projected implementation tree, parent links, live lists, separate style/nested declarations, and the no-op cssText setter. | Selector mutation, rule serialization, nested insertion/deletion, hierarchy checks, and supported at-rule grammars. See rule work below. |
| [Declarations and declaration blocks](https://drafts.csswg.org/cssom/#css-declaration-blocks) | Retained declarations, queries/edits, attribute write-back, readonly checks, and CSSStyleDeclaration/CSSStyleProperties bindings with supported indices/property attributes. | Full declaration algorithm audit, shorthand/longhand and logical-group rules, URL provenance, descriptors, and the final mutation owner. |
| [CSS values](https://drafts.csswg.org/cssom/#css-values) | Registry-driven value parsing/serialization and broader reusable value machinery. | Complete property grammar coverage, shorthand serialization, custom-property processing, and stage-correct representations through the value-lifecycle owner. |
| [ElementCSSInlineStyle](https://drafts.csswg.org/cssom/#the-elementcssinlinestyle-mixin) | Permanent HTML/SVG/MathML mixins, explicit attribute input, stable lazy projected CSSStyleProperties, and CSP gating in Browlet. | Audit clone/import and parse-time URL behavior, alongside declaration ownership. |
| [Window.getComputedStyle](https://drafts.csswg.org/cssom/#extensions-to-the-window-interface) | Typed Window partial and projected readonly snapshot for selected installed properties. | Target-document selection, pseudo-elements, eligibility, complete enumeration, live results, and resolved-value dependencies. |
| [CSS.escape](https://drafts.csswg.org/cssom/#the-css.escape()-method) | `serializeCssIdentifier()` supplies the underlying primitive, with the [Syntax/CSSOM non-ASCII conflict](../syntax/ROADMAP.md#identifier-serialization-disagreement) recorded. | Add the CSS namespace declaration/binding and author conversion tests; review that conflict for the projected API. Other specs' CSS namespace members retain their own owners. |
| [Resolved values](https://drafts.csswg.org/cssom/#resolved-values) | Current engine requests `ValueStage.Computed`. | Apply each property's resolved-value rule; some require used values and layout facts. Keep Typed OM computed values distinct. |
| IANA, change history, security/privacy notes | Reviewed for additional obligations. | Default-Style handling is already accounted for under sheet collections; registry metadata and editorial history need no separate runtime module. Origin-clean/privacy constraints remain part of observable API review. |

### Media-query disagreements

Three-engine probes and the retained media-list browser regressions establish
the following choices. Revisit the markers when the specifications or engines converge.

- `SPEC_CLASH(media-query-only-serialization)`: CSSOM's
  [serializer](https://drafts.csswg.org/cssom/#serialize-a-media-query) only emits
  `not`. Preserve `only`, following Chromium, Firefox, and WebKit; for example,
  `ONLY Screen AND (color)` becomes `only screen and (color)`.
- `SPEC_CLASH(media-query-trailing-comma)`: Media Queries delegates list splitting
  to Syntax's [comma-list algorithm](https://drafts.csswg.org/css-syntax-3/#parse-comma-separated-list-of-component-values),
  which drops the final empty arm. Preserve it specifically for media queries,
  as all three engines do: `screen,` becomes `screen, not all`. The general
  Syntax entry point is unchanged. A comma inside a folded block is not a separator.
- `SPEC_GAP(media-general-enclosed-serialization)`: Media Queries defines
  [`<general-enclosed>`](https://drafts.csswg.org/mediaqueries-4/#typedef-general-enclosed),
  but CSSOM's older serializer does not cover it. Retain token-based serialization,
  as WebKit does: `future(a,` becomes `future(a,)`, and repeated whitespace
  collapses. Chromium and Firefox preserve source text, including missing
  closers and comments. Unknown grammar remains opaque; its function names
  are not treated as interpreted CSS function keywords.
- `SPEC_CLASH(media-list-mutation-comparison)`: Keep CSSOM's
  [append](https://drafts.csswg.org/cssom/#dom-medialist-appendmedium) and
  [delete](https://drafts.csswg.org/cssom/#dom-medialist-deletemedium) behavior,
  matching Chromium: an equivalent append leaves order unchanged; deletion
  removes all matching entries. Firefox moves an existing query to the end on
  append; WebKit appends a duplicate and deletes only one match.
- `SPEC_CLASH(media-list-mutation-input)`: Keep CSSOM's
  [single-query parsing](https://drafts.csswg.org/cssom/#parse-a-media-query)
  and Chromium's mutations: empty or multiple-query inputs are no-ops; invalid
  single queries recover as `not all`. The table below records the other engines.
  Each browser/input pair has a separate expected failure so convergence surfaces.

Starting from `screen`, append and then delete the same input:

| Input | Firefox | WebKit |
| --- | --- | --- |
| Empty string | Both operations throw NotFoundError; unchanged. | Append does nothing; delete throws NotFoundError. |
| `,` | Append does nothing; delete throws NotFoundError. | Appends two `not all` entries; delete throws NotFoundError, retaining them. |
| `screen, print` | Append does nothing; delete removes `screen`. | Appends both entries, including duplicate `screen`; delete throws NotFoundError. |
| `&` | Append does nothing; delete throws NotFoundError. | Appends `not all`; delete throws NotFoundError, retaining it. |

### Constructed-sheet disagreements

Three-engine checks on 2026-10-20 and the retained
[stylesheet scenarios](../../../test/stylelet/scenarios/stylesheets.test.ts)
support the following approved choices:

- `SPEC_CLASH(constructed-sheet-location)`: the
  [constructor algorithm](https://drafts.csswg.org/cssom/#create-a-constructed-cssstylesheet)
  assigns the Document base URL to location. Chromium, Firefox, and WebKit expose
  null `href`. Follow the browsers, retaining the construction-time base URL
  internally for relative resolution.
- `SPEC_CLASH(sheet-insert-error-order)`: [insertRule](https://drafts.csswg.org/cssom/#dom-cssstylesheet-insertrule)
  parses before calling the insertion helper, but the
  [helper](https://drafts.csswg.org/cssom/#insert-a-css-rule) checks the index
  before parsing. All three browsers return IndexSizeError for invalid rule
  text with an out-of-range index. Preserve this index-first behavior.
- `SPEC_GAP(constructed-sheet-invalid-base-url)`: the constructor algorithm does
  not specify URL validation or its failure. Use NotAllowedError for invalid
  input, following Firefox and WebKit. Chromium currently ignores the option;
  its feature-gated `CSSStyleSheet::Create()` also throws NotAllowedError
  (`third_party/blink/renderer/core/css/css_style_sheet.cc`).
  WebKit's corresponding validation is in `Source/WebCore/css/CSSStyleSheet.cpp`.
  Valid relative input resolves against the construction-time Document base.
  The [binding regression](../../../test/browlet/style/cssom.test.ts) verifies
  the chosen exception's projected identity and name.

### Rule and interface coverage

`CSSStyleRuleImpl` derives from `CSSGroupingRuleImpl` and retains nested style
and declaration-rule children. `selectorText`, style-rule `cssText` reads, and
nested mutation are explicit throwing dependencies. `CSSRule.cssText` assignment
has no effect, as specified. The interfaces are bound without claiming those
remaining algorithms are implemented.

Missing implementations include `CSSImportRule`,
`CSSPageRule`, `CSSPageDescriptors`, `CSSMarginRule`, its descriptor interface,
and `CSSNamespaceRule`. CSSMediaRule is defined by Conditional Rules; font,
animation, supports, layer, nesting, and other rule interfaces have contributing
specifications. The [rule roadmap](../css/ROADMAP.md) now records those
contributions. CSSNestedDeclarationsImpl retains later declaration runs and
projects its CSSStyleProperties result. CSSPropertyRuleImpl
currently supports direct registration fixtures, not parsed `@property` input.
CSSOM's legacy numeric
constants are not a complete list of rule types.

At present, unknown at-rules are discarded. Recognized unfinished at-rules stop
at StylesheetContext's explicit statement/block dependencies rather than being
silently discarded. Those methods receive preludes and preceding siblings;
block preparation must supply the child grammar and final validity/construction
step. Replacement discards imports as required by CSSOM. Constructed insertion
rejects imports; ordinary insertion reaches the missing grammar. Complete
mixed-rule hierarchy checks depend on these rule types. Parsing support, CSSOM identity, engine participation,
and fetching must be accounted for separately as each rule is added.

## Projection and declaration lifecycle

- [ ] Before closing the CSSOM audit, replace the provisional
  `css/CSSDeclarationBlock` class with plain declaration state or ownership by
  the appropriate implementation, unless review establishes a concrete need
  for the separate class. Audit inline style, style rules, descriptor rules,
  and computed results together. CSSOM defines an ordered collection and its
  associated state; that does not require this extra class. Element `.style`
  exposes `CSSStylePropertiesImpl`. Preserve observable identity and lifecycle
  behavior; current private-storage tests and `instanceof` consumers do not
  settle the representation.
- [ ] Make attribute input, author mutation, and engine reads explicit paths.
  Preserve one authorization/parsing path for first and later attribute inputs,
  CSSOM write-back bypass, and accepted state after a blocked replacement.
  Binding already replaces manual numeric properties and the mixin's
  `synchronizeIndices()` dependency; no observer layer was required.
- [ ] Audit supported-property lookup, custom-name case, empty/invalid values,
  priority, null conversion, order, shorthand expansion/removal/serialization,
  logical groups, and readonly/computed behavior. The current small registry
  cannot exercise every one of these rules.
- [ ] Preserve URL base/provenance per parsed declaration when enabling
  URL-valued properties. A block can contain declarations from different edits
  and bases; a later document base cannot replace that history.

CSSOM's abstract declaration-block creation steps initialize from an existing
owner attribute. They do not require our TypeScript constructor or the first
Platform access to perform that read. Browlet already delivers attributes
after element construction. An external host attaching to an existing node
must supply the initial input explicitly. Preserve this reviewed lifecycle
requirement while reconsidering the objects that carry it.

### Rule mutation ownership

- [ ] Extend parent-association coverage to nested insertion/deletion and
  supported group rules. Existing parsing and top-level mutation propagate
  sheet attachment/removal through the retained child tree.
- [ ] Complete selector and rule serialization behavior using the underlying
  algorithms, then nested mutation and rule-type hierarchy constraints.

Declaration edits already update the state the engine reads. Regressions cover
nested-rule survival, separate later declaration runs, and parent-sheet links
after removal/replacement. There is no declaration copy-back callback or
independent interpreted tree to keep synchronized.

Discarded nested rules do not split declaration runs, following the reviewed
browser behavior. The continuing Syntax disagreement and issue link are recorded
in the [syntax roadmap](../syntax/ROADMAP.md#parser-disagreements).

## Computed results and external facts

CSSOM requires a **new, live** CSSStyleProperties object from each
`getComputedStyle()` call. New identity does not mean a snapshot. The current
engine creates independent declaration data once; the live query/invalidation
contract remains missing. Inline style does not own computed state.

The [engine inventory](../engine/README.md#current-computed-style-path) traces
that sparse query; the [lifecycle roadmap](../value-processing/ROADMAP.md)
separates its missing defaulting/substitution from the reusable value resolvers.

- [ ] Use the element's node document when selecting style rules. The current
  Window implementation selects its own associated document. Cover calls with
  an element from another document through the eventual binding.
- [ ] Account for pseudo-element parsing and identity, connectedness, flat-tree
  membership, browsing-context/container rendering, and the empty result cases.
  Current pseudo-element arguments are rejected rather than implemented.
- [ ] Enumerate supported longhands in the required order and include eligible
  custom properties. Finish defaulting, inheritance, and substitution before
  equating a sparse declaration selection with a computed-style object.
- [ ] Establish live reads and mutation invalidation before choosing a cache
  location. Cover retained query objects after attribute, rule, sheet, tree,
  and relevant host-state changes.
- [ ] Follow the resolved-value rule for each property. Layout-dependent size,
  line-height, position, and rendering facts remain external dependencies;
  request concrete facts with known freshness rather than inventing a universal
  layout bag. Serialization must not supply missing resolution.

## Typed OM integration gates

The [Typed OM roadmap](typed/ROADMAP.md) owns value interfaces, reification,
declared maps, and live computed maps. Settle ordinary CSSOM declaration state
first so both APIs can share it; complete computed values and invalidation
before connecting computed maps. Standalone typed numeric operations can proceed
independently. Geometry and layout are dependencies of particular consumers,
not prerequisites for every CSSOM interface.

## Next review order

1. Continue from §6.1 into collections/adoption and association. Keep missing
   external-resource producers explicit rather than expanding their stubs silently.
2. Audit CSS rule behavior, including selectors, nested mutation, serialization,
   and hierarchy. The existing bindings supply observable test boundaries.
3. Audit `CSSStyleDeclaration`/`CSSStyleProperties` and `ElementCSSInlineStyle`.
   Settle declaration ownership while preserving the input/CSP/CSSOM behavior.
4. Return to Window's computed-style partial with the completed interface.
   Separate what can work now from cascade, pseudo-element, and layout
   dependencies; record each unfinished branch at its owner.

This is a bounded CSSOM review route, not a replacement for project priority.
Small independent interfaces such as MediaList can be completed alongside the
binding work. Broader property/rule families retain their own roadmaps.

## Verification

The [README's test inventory](README.md#existing-evidence-and-its-limits)
distinguishes direct implementation, host integration, and Platform coverage.
The dated [baseline](README.md#validation-baseline) records what ran.
Before fixing newly identified behavior, add and run
the focused regression first. Add author-conversion, identity, and borrowed-call
tests through Platform bindings as those contracts become available; direct
implementation tests must not impersonate author inputs after that migration.
