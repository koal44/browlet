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
Detailed algorithm review remains open. Existing browser evidence stays in
the [Browlet style roadmap](../../browlet/style/ROADMAP.md) and
[CSP roadmap](../../browlet/browsing/policy/csp/ROADMAP.md#style-attribute-consumer).

## Specification accounting

“Partial” means an implementation entry point exists, not that all its steps
or Platform behavior have been verified.

| CSSOM area | Current coverage | Remaining contract / next owner |
| --- | --- | --- |
| [Common idioms and CSSOMString](https://drafts.csswg.org/cssom/#common-serializing-idioms) | Identifier/string/component serialization exists in `syntax/component-value.ts`; `cssom/string.ts` chooses DOMString's UTF-16 behavior. | Audit conversion separately from CSS input preprocessing; finish serialization coverage against value stages. |
| [Media queries and MediaList](https://drafts.csswg.org/cssom/#media-queries) | Partial parsing, serialization, comparison, and collection behavior; focused tests pass. | Project `MediaList`, move index/coercion exposure to Binding, and audit modern Media Queries additions. Device matching is a separate dependency. |
| [Selectors](https://drafts.csswg.org/cssom/#selectors) | Parser and serializer exist in `selector/parser.ts`. | Connect CSSStyleRule getters/setters with the correct namespace/nesting context and complete the [consumer review](../selector/ROADMAP.md#parser-to-consumer-coverage). |
| [Style sheets](https://drafts.csswg.org/cssom/#css-style-sheets) | Metadata, construction, origin-clean/modification guards, replacement, simple insertion/deletion, and legacy aliases. | Complete typed interfaces/dictionaries, method-realm errors/promises, import handling, rule hierarchy, and actual response-derived origin/base state. |
| [Sheet collections](https://drafts.csswg.org/cssom/#css-style-sheet-collections) | Ordered document sheets, adopted-sheet checks, preferred/selected sets, and retained lists. | Complete ShadowRoot scopes, binding-owned `ObservableArray<CSSStyleSheet>`, Default-Style/Link response processing, script blocking, and resource completion. |
| [Association and fetching](https://drafts.csswg.org/cssom/#style-sheet-association) | HTML/SVG inline style elements associate sheets through Browlet's LinkStyle mixin. | `<link>`, `xml-stylesheet`, HTTP Link, imports, cancellation, MIME/CORS/encoding, policy, and load events belong at their host/loader boundary. Collection helpers alone do not satisfy these algorithms. |
| [CSS rules](https://drafts.csswg.org/cssom/#css-rules) | CSSRule base, live rule list, and partial CSSStyleRule declarations. | Parent links, selector mutation, rule serialization, grouping and nested declarations, hierarchy checks, and supported at-rule representations. See rule work below. |
| [Declarations and declaration blocks](https://drafts.csswg.org/cssom/#css-declaration-blocks) | Retained declarations, importance/order handling, queries/edits, attribute write-back, and readonly checks. | CSSStyleProperties, generated property accessors, shorthand/longhand and logical-group rules, URL provenance, descriptors, and the final mutation owner. |
| [CSS values](https://drafts.csswg.org/cssom/#css-values) | Registry-driven value parsing/serialization and broader reusable value machinery. | Complete property grammar coverage, shorthand serialization, custom-property processing, and stage-correct representations through the value-lifecycle owner. |
| [ElementCSSInlineStyle](https://drafts.csswg.org/cssom/#the-elementcssinlinestyle-mixin) | Permanent HTML/SVG/MathML mixins, explicit attribute input, stable lazy `.style`, and CSP gating in Browlet. | Return a projected CSSStyleProperties; remove manual index synchronization from the mixin; audit clone/import and parse-time URL behavior. |
| [Window.getComputedStyle](https://drafts.csswg.org/cssom/#extensions-to-the-window-interface) | Provisional Element unwrapping and a readonly snapshot for selected installed properties. | Typed Window partial, target-document selection, pseudo-elements, eligibility, complete enumeration, live results, and resolved-value dependencies. |
| [CSS.escape](https://drafts.csswg.org/cssom/#the-css.escape()-method) | `serializeCssIdentifier()` supplies the underlying primitive. | Add the CSS namespace declaration/binding and author conversion tests. Other specs' CSS namespace members retain their own owners. |
| [Resolved values](https://drafts.csswg.org/cssom/#resolved-values) | Current engine requests `ValueStage.Computed`. | Apply each property's resolved-value rule; some require used values and layout facts. Keep Typed OM computed values distinct. |
| IANA, change history, security/privacy notes | Reviewed for additional obligations. | Default-Style handling is already accounted for under sheet collections; registry metadata and editorial history need no separate runtime module. Origin-clean/privacy constraints remain part of observable API review. |

### Rule and interface coverage

The local CSSOM source defines `CSSStyleRule` as a `CSSGroupingRule`, while the
current implementation derives directly from `CSSRuleImpl`. Its child list is
not populated from interpreted nested rules. `selectorText` is currently an
ordinary empty field; both `cssText` accessors and nested mutation throw. The
specification's `CSSRule.cssText` setter is a no-op, not a replacement operation.
These are unfinished contracts to cover with regressions during implementation.

Missing implementations include `CSSGroupingRule`, `CSSImportRule`,
`CSSPageRule`, `CSSPageDescriptors`, `CSSMarginRule`, its descriptor interface,
and `CSSNamespaceRule`. CSSMediaRule is defined by Conditional Rules; font,
animation, supports, layer, nesting, and other rule interfaces have contributing
specifications. The [rule roadmap](../css/ROADMAP.md) now records those
contributions, including CSSNestedDeclarations. CSSOM's legacy numeric
constants are not a complete list of rule types.

At present, stylesheet interpretation drops at-rules. `insertRule()` rejects
all imports, including on non-constructed sheets, and cannot enforce a complete
mixed-rule hierarchy. Parsing support, CSSOM identity, engine participation,
and fetching must be accounted for separately as each rule is added.

## Projection and declaration lifecycle

- [ ] Implement `CSSStyleDeclaration` and `CSSStyleProperties` as distinct
  declared interfaces, with implementation members and complete adjacent IDL.
  Keep shared declaration operations separate from property-specific accessors
  and descriptor interfaces. Reuse existing behavior only after reviewing it.
- [ ] Replace provisional `object` results with concrete references and test
  Platform prototypes, receiver checks, SameObject/PutForwards, conversions,
  reactions, supported indices, and exception realms through real bindings.
  The host owns Platform objects; internal algorithms retain concrete
  implementations and post-conversion values.
- [ ] Review who owns declaration state across inline style, style rules,
  descriptor rules, and computed results. Compare direct ownership by the
  appropriate implementation with the current separate block. Neither a
  missing interface nor a passing private-storage test settles this choice.
- [ ] Make attribute input, author mutation, and engine reads explicit paths.
  Preserve one authorization/parsing path for first and later attribute inputs,
  CSSOM write-back bypass, and accepted state after a blocked replacement.
  Removing manual numeric properties should remove the mixin's
  `synchronizeIndices()` dependency without adding a speculative observer layer.
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

- [ ] Trace a CSSOM declaration edit through the interpreted rule into the
  cascade. Review the current copy-in/copy-back callback rather than promoting
  it to an invariant.
- [ ] Add a focused regression before changing the mixed declaration/nested-rule
  path: current copy-back assigns a declaration-only array to `rule.block`.
  The existing simple-rule tests do not establish that nested contents survive edits.
- [ ] Maintain parent rule/sheet associations across insertion, deletion, and
  replacement, including references retained by author code after removal.
- [ ] Complete selector and rule serialization behavior using the underlying
  algorithms, then nested mutation and rule-type hierarchy constraints.

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

1. Start at `CSSStyleDeclaration`/`CSSStyleProperties` and
   `ElementCSSInlineStyle`. Establish the actual interface and declaration owner
   together, preserving the input/CSP/CSSOM behavior above.
2. Follow the same declarations into `CSSStyleRule`. Settle mutation ownership,
   parent associations, selectors, and nested contents with observable tests.
3. Finish the surrounding sheet/list bindings, adoption, and replacement
   contracts. Keep missing external-resource producers explicit.
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
