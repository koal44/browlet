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
Sections 1–5 have been audited; the remaining algorithm review stays open. Related browser evidence lives in
the [Browlet style roadmap](../../browlet/style/ROADMAP.md) and
[CSP roadmap](../../browlet/browsing/policy/csp/ROADMAP.md#style-attribute-consumer).

## Specification accounting

“Partial” means an implementation entry point exists, not that all its steps
or Platform behavior have been verified.

| CSSOM area | Current coverage | Remaining contract / next owner |
| --- | --- | --- |
| Introduction and terminology | CSS is the supported styling language; the property registry identifies supported built-ins. Binding separates author overrides from internal calls, covered for MediaList. | Implicit `::before`/`::after` existence belongs to pseudo-element matching/computed-style work, independently of box generation. |
| [Common idioms and CSSOMString](https://drafts.csswg.org/cssom/#common-serializing-idioms) | Identifier/string escaping, function/LOCAL formatting, URL serialization, and list separators; real DOMString typedef with conversion distinct from CSS preprocessing. | Function arguments remain the owning value grammar's responsibility. LOCAL formatting is ready for the missing font-source descriptor consumer. Preserve the reviewed [identifier clash](../syntax/ROADMAP.md#identifier-serialization-disagreement). |
| [Media queries and MediaList](https://drafts.csswg.org/cssom/#media-queries) | List parsing/recovery, serialization/comparison, mutation, complete IDL, and real Binding regressions. Modern conditions/ranges use the Media Queries grammar. | Finish the sheet/rule bindings that return MediaList. Device matching and additional feature interpretation belong to [Conditional Rules](../conditional/ROADMAP.md); serialization alone does not establish support. See disagreements below. |
| [Selectors](https://drafts.csswg.org/cssom/#selectors) | Section 5 parsing and serialization use `selector/parser.ts`, with namespace, combinator, attribute, pseudo-element, functional pseudo-class, and An+B coverage. | Connect CSSStyleRule getters/setters with the correct namespace/nesting context and complete the [consumer review](../selector/ROADMAP.md#parser-to-consumer-coverage). |
| [Style sheets](https://drafts.csswg.org/cssom/#css-style-sheets) | Metadata, construction, origin-clean/modification guards, replacement, simple insertion/deletion, and legacy aliases. | Complete typed interfaces/dictionaries, method-realm errors/promises, import handling, rule hierarchy, and actual response-derived origin/base state. |
| [Sheet collections](https://drafts.csswg.org/cssom/#css-style-sheet-collections) | Ordered document sheets, adopted-sheet checks, preferred/selected sets, and retained lists. | Complete ShadowRoot scopes, binding-owned `ObservableArray<CSSStyleSheet>`, Default-Style/Link response processing, script blocking, and resource completion. |
| [Association and fetching](https://drafts.csswg.org/cssom/#style-sheet-association) | HTML/SVG inline style elements associate sheets through Browlet's LinkStyle mixin. | `<link>`, `xml-stylesheet`, HTTP Link, imports, cancellation, MIME/CORS/encoding, policy, and load events belong at their host/loader boundary. Collection helpers alone do not satisfy these algorithms. |
| [CSS rules](https://drafts.csswg.org/cssom/#css-rules) | A single implementation tree, parent links, live lists, and separate style/nested declarations. | Selector mutation, rule serialization, nested insertion/deletion, hierarchy checks, and supported at-rule grammars. See rule work below. |
| [Declarations and declaration blocks](https://drafts.csswg.org/cssom/#css-declaration-blocks) | Retained declarations, importance/order handling, queries/edits, attribute write-back, and readonly checks. | CSSStyleProperties, generated property accessors, shorthand/longhand and logical-group rules, URL provenance, descriptors, and the final mutation owner. |
| [CSS values](https://drafts.csswg.org/cssom/#css-values) | Registry-driven value parsing/serialization and broader reusable value machinery. | Complete property grammar coverage, shorthand serialization, custom-property processing, and stage-correct representations through the value-lifecycle owner. |
| [ElementCSSInlineStyle](https://drafts.csswg.org/cssom/#the-elementcssinlinestyle-mixin) | Permanent HTML/SVG/MathML mixins, explicit attribute input, stable lazy `.style`, and CSP gating in Browlet. | Return a projected CSSStyleProperties; remove manual index synchronization from the mixin; audit clone/import and parse-time URL behavior. |
| [Window.getComputedStyle](https://drafts.csswg.org/cssom/#extensions-to-the-window-interface) | Provisional Element unwrapping and a readonly snapshot for selected installed properties. | Typed Window partial, target-document selection, pseudo-elements, eligibility, complete enumeration, live results, and resolved-value dependencies. |
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

### Rule and interface coverage

`CSSStyleRuleImpl` derives from `CSSGroupingRuleImpl` and retains nested style
and declaration-rule children. `selectorText` is currently an ordinary empty
field; both style-rule `cssText` accessors and nested mutation throw. The
specification's `CSSRule.cssText` setter is a no-op, not a replacement operation.
These are unfinished contracts to cover with regressions during implementation.

Missing implementations include `CSSImportRule`,
`CSSPageRule`, `CSSPageDescriptors`, `CSSMarginRule`, its descriptor interface,
and `CSSNamespaceRule`. CSSMediaRule is defined by Conditional Rules; font,
animation, supports, layer, nesting, and other rule interfaces have contributing
specifications. The [rule roadmap](../css/ROADMAP.md) now records those
contributions. CSSNestedDeclarationsImpl already retains later declaration runs;
its CSSStyleProperties result and Binding remain unfinished. CSSPropertyRuleImpl
currently supports direct registration fixtures, not parsed `@property` input.
CSSOM's legacy numeric
constants are not a complete list of rule types.

At present, unknown at-rules are discarded. Recognized unfinished at-rules stop
at StylesheetContext's explicit statement/block dependencies rather than being
silently discarded. Those methods receive preludes and preceding siblings;
block preparation must supply the child grammar and final validity/construction
step. Replacement discards imports as required by CSSOM. `insertRule()` rejects
all imports, including on non-constructed sheets, and cannot enforce a complete
mixed-rule hierarchy. Parsing support, CSSOM identity, engine participation,
and fetching must be accounted for separately as each rule is added.

## Projection and declaration lifecycle

- [ ] Implement `CSSStyleDeclaration` and `CSSStyleProperties` as distinct
  declared interfaces, with implementation members and complete adjacent IDL.
  Keep shared declaration operations separate from property-specific accessors
  and descriptor interfaces. Reuse existing behavior only after reviewing it.
  Remove `cssPropertyToIDLAttribute`, `installPropertyAccessor`, and manual
  index synchronization as their real Binding replacements land; these are
  legacy Platform emulation, not another required implementation layer.
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
