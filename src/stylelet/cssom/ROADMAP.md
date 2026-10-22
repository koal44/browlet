# CSSOM roadmap

The [README](README.md) records present implementations and the focused baseline.
This file accounts for CSSOM's contracts and their dependencies; it does not
mark the specification implemented or prescribe the final declaration storage.

## Sources and related ownership

Primary reading used the local CSSWG `cssom-1/Overview.bs`,
`css-style-attr-1/Overview.src.html`, and WHATWG HTML's `source` section on the
style attribute. The reference roots are listed in the
[Stylelet roadmap](../ROADMAP.md#sources-and-reading-depth).

The [selector](../selector/ROADMAP.md), [rule](rules/ROADMAP.md),
[value-lifecycle](../value-processing/ROADMAP.md), [property](../props/ROADMAP.md)
and [Typed OM](typed/ROADMAP.md) guides own the related contracts.
Sections 1–5 and §6.1–6.6 have been reviewed, including explicit rule-family
and declaration dependencies below. Related browser evidence lives in
the [Browlet style roadmap](../../browlet/style/ROADMAP.md) and
[CSP roadmap](../../browlet/browsing/policy/csp/ROADMAP.md#style-attribute-consumer).

## Declaration boundary

[css-stylesheet.ts](css-stylesheet.ts) and [style-properties.ts](declarations/style-properties.ts)
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
| [Selectors](https://drafts.csswg.org/cssom/#selectors) | Section 5 parsing/serialization and CSSStyleRule mutation use namespace/nesting context; edits refresh descendant selectors and specificity. | Complete the [matcher/consumer review](../selector/ROADMAP.md#parser-to-consumer-coverage), including future group-rule traversal. |
| [Style sheets](https://drafts.csswg.org/cssom/#css-style-sheets) | Metadata, one-pass initialization, typed construction/dictionary, access guards, replacement promises, insertion/deletion and namespace/import ordering, legacy aliases, identity/realm coverage, and response-derived origin/base state. | Import loading, modern import clauses, and hierarchy exceptions for unfinished rule families such as layer statements. |
| [Sheet collections](https://drafts.csswg.org/cssom/#css-style-sheet-collections) | Ordered document/shadow sheets, real observable-array binding and adoption checks, retained identities, preferred/selected sets, and ordered Default-Style response processing. Header order survives reversed fetch completion. | Script blocking and resource completion; shadow-tree cascade selection is separate from collection ownership. See the [collection disagreements](../../browlet/style/ROADMAP.md#stylesheet-collection-disagreements). |
| [Association and fetching](https://drafts.csswg.org/cssom/#style-sheet-association) | LinkStyle bindings for HTML/SVG inline style owners and ProcessingInstruction; Fetch-backed PI/header loading, cancellation on PI mutation/removal/adoption, policy, MIME/status/CORS, encoding, and URL metadata. | HTML `<link>`, imports, script/load/render blocking, and XML document parsing retain explicit owners. See [resource boundaries and browser choices](../../browlet/style/ROADMAP.md#external-stylesheet-loading). |
| [CSS rules](https://drafts.csswg.org/cssom/#css-rules) | One implementation tree, parent links/live lists, selector edits, style/nested-declaration serialization, nested mutation, namespace grammar, and required CSSOM-owned interfaces. | Conditional/font/animation rule grammars and consumers; page/margin descriptors and import lifecycle. See the [rule interface accounting](rules/ROADMAP.md#rule-and-interface-coverage). |
| [Declarations and declaration blocks](https://drafts.csswg.org/cssom/#css-declaration-blocks) | §6.5–6.6 longhand/custom mutation, independent name/value parsing, indices/property bindings, shared collection ownership, and shorthand/logical metadata paths. | Margin expansion and value serialization explicitly throw; pending substitution, logical property families, URL provenance, and descriptors remain unfinished. |
| [CSS values](https://drafts.csswg.org/cssom/#css-values) | Registry-driven value parsing/serialization and broader reusable value machinery. | Complete property grammar coverage, shorthand serialization, custom-property processing, and stage-correct representations through the value-lifecycle owner. |
| [ElementCSSInlineStyle](https://drafts.csswg.org/cssom/#the-elementcssinlinestyle-mixin) | Permanent HTML/SVG/MathML mixins, explicit attribute input, stable lazy projected CSSStyleProperties, and CSP gating in Browlet. | Audit clone/import and parse-time URL behavior, alongside declaration ownership. |
| [Window.getComputedStyle](https://drafts.csswg.org/cssom/#extensions-to-the-window-interface) | Typed Window partial and projected readonly snapshot for selected installed properties. | Target-document selection, pseudo-elements, eligibility, complete enumeration, live results, and resolved-value dependencies. |
| [CSS.escape](https://drafts.csswg.org/cssom/#the-css.escape()-method) | `serializeCssIdentifier()` supplies the underlying primitive, with the [non-ASCII browser disagreement](../syntax/ROADMAP.md#identifier-serialization-disagreement) recorded. | Add the CSS namespace declaration/binding and author conversion tests; review that conflict for the projected API. Other specs' CSS namespace members retain their own owners. |
| [Resolved values](https://drafts.csswg.org/cssom/#resolved-values) | Current engine requests `ValueStage.Computed`. | Apply each property's resolved-value rule; some require used values and layout facts. Keep Typed OM computed values distinct. |
| IANA, change history, security/privacy notes | Reviewed for additional obligations. | Default-Style handling is already accounted for under sheet collections; registry metadata and editorial history need no separate runtime module. Origin-clean/privacy constraints remain part of observable API review. |

### Media-query disagreements

The [media roadmap](media/ROADMAP.md#media-query-disagreements) records the
approved parsing, serialization, and list-mutation differences, with browser evidence.

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

The [rules roadmap](rules/ROADMAP.md) owns §6.4 interface accounting, unfinished
grammars, and the rule-specific disagreements and gaps.

## Projection and declaration lifecycle

The [declarations roadmap](declarations/ROADMAP.md#declaration-state-and-lifecycle)
owns shorthand expansion/serialization, future logical families, and declaration
URL provenance. The collection owns ordered data; CSSOM owns flags and associations.
Preserve explicit initialization, CSP input, and CSSOM write-back bypass.

Rule-family mutation work is tracked in the [rules roadmap](rules/ROADMAP.md#rule-mutation-ownership).

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

1. Implement the explicit [shorthand dependencies](../props/ROADMAP.md#shorthand-and-logical-property-dependencies),
   starting with margin, then continue §6.7 value serialization.
2. Review `ElementCSSInlineStyle`, then Window's computed-style partial.
   Separate what can work now from cascade, pseudo-element, and layout
   dependencies; record each unfinished branch at its owner.
3. Revisit rule-family/resource dependencies with their owners; their explicit
   entry points and the [rule coverage table](rules/ROADMAP.md#rule-and-interface-coverage) remain unfinished work.

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
