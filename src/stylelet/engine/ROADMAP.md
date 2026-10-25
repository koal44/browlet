# Style engine roadmap

The [README](README.md) describes the connected path. This roadmap records
missing behavior and acceptance criteria;
[project priority](../../PRIORITY.md#stylelet-delivery-order) orders delivery.

## Cascade participation and ordering

Read [Cascade 5 filtering](https://drafts.csswg.org/css-cascade-5/#filtering),
[sorting](https://drafts.csswg.org/css-cascade-5/#cascade-sort), and
[Cascade 6 proximity](https://drafts.csswg.org/css-cascade-6/#cascade-proximity)
together. Level 6 supplements the earlier level.

- [ ] Connect nested/imported rules, conditional applicability, and final sheet
  order through the [rule pipeline](../cssom/rules/ROADMAP.md). A retained CSSOM child
  can exist while its condition excludes its declarations.
- [ ] Carry origin, importance, encapsulation context, element attachment,
  layer, specificity, scope proximity, and appearance order as applicable.
  Include presentational hints and animation/transition contributions when
  their owners exist; do not manufacture those sources in the selector matcher.
- [ ] Preserve enough candidate provenance for `revert`, `revert-layer`, and
  the local draft's `revert-rule`. A single winner without origin/layer/rule
  identity cannot answer the rollback question. Recheck draft status at audit.
- [ ] Account for shorthand expansion, aliases, logical groups, and `all`
  before treating the current longhand registry as a general cascade model.

## Defaulting and per-element values

[Cascade's value stages](https://drafts.csswg.org/css-cascade-5/#value-stages)
and [defaulting](https://drafts.csswg.org/css-cascade-5/#defaulting) require more
than calling a selected value's resolver.

Unregistered custom properties compute in ordinary trees: retained tokens, valid
empty values, guaranteed-invalid initial values, `initial`/`inherit`/`unset`, and
Values 5 Appendix A's `var()` replacement. Each query owns its declaration/value
maps and property guards; there is no persistent value cache. Ordinary properties
now reparse substituted components with their consuming grammar and default
invalid winners without reviving earlier declarations. Pending margin longhands
share one expansion per element and query.

- [ ] Follow this bounded Variables/substitution work with a full CSS Cascade
  review. The small defaulting implementation is not a completed Cascade audit;
  review filtering, origin/layer ordering, all CSS-wide keywords, inheritance,
  property metadata, and computed-time failure together.

- [x] Consume initial values and inherited flags from the installed property
  records. Missing declarations and `initial`/`inherit`/`unset` now default,
  including CSS-wide keywords produced by substitution. Property-specific
  computed/used-value inputs remain unfinished; the
  [lifecycle roadmap](../value-processing/ROADMAP.md) records remaining metadata
  and stage contracts.
- [ ] Complete inheritance across scopes and for pseudo-elements. Ordinary-tree
  inheritance is connected for built-ins and unregistered custom properties. DOMOperations
  now supplies `flatTreeParent`; Browlet forwards to NodeImpl's existing method.
  Connect shadow-root scope selection and cross-scope inheritance, then
  pseudo-element-specific inheritance. Queries that need an unavailable shadow
  scope currently throw explicitly. The standard DOM adapter can see open slot
  assignment; closed roots require host-supplied operations.
- [x] Connect custom-property computation and substitution before resolving
  consuming built-ins. Preserve the distinction between parse-time rejection,
  computed-time invalidity, and cascade rollback.
  Unregistered custom `var()` substitution is connected, including lazy fallbacks,
  dynamic names, early spread, cycles, and bounded token/source composition.
  `revert`/`revert-layer` and registered custom computation still stop explicitly.
  The local draft's `revert-rule` is not yet a
  recognized keyword. Generalize guards to attribute/custom-function dependencies
  when those owners are connected; do not silently treat their missing inputs as
  absent custom properties.
- [ ] Supply only the facts a resolver needs: parent/root style, percentages,
  font metrics, viewport/container references, color inputs, and URL provenance.
  The [value-input contracts](../values/ROADMAP.md#context-inputs-and-freshness) distinguish existing
  fields from absent providers. Do not silently report a value as fully
  computed when a required fact is unavailable.
  Host palettes are now supplied through `userAgent.systemColors`, with fixed
  light defaults when omitted; initial `CanvasText` becomes an absolute color.
  Per-element color-scheme selection, forced-color policy, currentColor's used-value
  dependency, and CSSOM's remaining resolved-color rules are still unfinished.

## Custom-property registration

The [Properties and Values API](https://drafts.css-houdini.org/css-properties-values-api-1/#determining-registration)
defines document registration state and precedence over stylesheet registration.

- [ ] Connect the document-owned set, `CSS.registerProperty()`, interpreted
  `@property`, and CSSPropertyRule. Validate names, duplicates, syntax, inherit
  flags, and initial values, including computational independence and the
  optional initial value for universal syntax. The current record always
  requires `initialValue`; review its representation with those algorithms.
- [ ] Keep declaration parsing permissive regardless of registration. Apply
  registered syntax at computation, with proper initial/inherited fallback;
  setting up a registration must not discard earlier declaration text.
- [ ] Determine active stylesheet registrations using conditions and layer
  rules required by the contributing specifications. Include all shadow scopes
  in one document-wide registry rather than restricting collection to the query's
  scope ([Shadow DOM](https://drafts.css-houdini.org/css-properties-values-api-1/#shadow-dom)), then invalidate affected
  values on registration or stylesheet changes. Registration lookup is not
  per-element variable lookup.
- [ ] Preserve typed registered values when substituting their equivalent token
  sequence. Unregistered token values have different URL timing and source-text
  requirements; see the [value roadmap](../values/ROADMAP.md).

## Queries, mutation, and tests

- [x] Audit Variables 1's API serialization and Values 5's pending shorthand
  queries. Cover declared/computed spelling, copying computed custom values,
  and repeated rule edits through CSSOM. Fresh queries reflect each edit;
  this does not implement live updates to an already returned computed object.
- [ ] Establish freshness for tree/attribute changes, CSSOM mutation, sheet
  replacement/adoption, registrations, and external facts before choosing a
  cache. Keep live CSSOM/Typed OM views distinct from cached internal values.
- [ ] Preserve parse-time URL bases across inline/CSSOM edits and shared sheets;
  keep the authoritative-empty inline provider contract through this work.
- [x] Cover absent declarations, explicit inheritance, invalid substituted
  winners, unregistered variables, and pending margin expansion through connected
  queries. Failed expansions are shared within one query; distinct shorthand
  occurrences and separate elements/queries retain independent results.
- [ ] Add connected tests for cross-scope flat-tree inheritance, rollback,
  registered variables, and retained live query objects. Registration tests
  must use real input/API paths as well as direct value fixtures.

The custom-property slices have connected tests for acceptance, case-sensitive
names, source preservation, importance/specificity/order, root defaulting,
inheritance, empty versus invalid values, substitution, cycle/defaulting order,
bounded expansion, and fresh queries after CSSOM edits. The
[approved draft differences](README.md#substitution-draft-differences) cover
argument grammar/spread and EOF source spelling. Lazy fallback behavior now agrees
across all three browsers.
The inline raw-text fallback regression also covers duplicate declarations and
importance; an authoritative empty inline provider remains authoritative.

The [existing baseline](../README.md#cascade-and-values) is scoped evidence.
It does not close these tasks. Layout, painting, timelines, and platform-object
projection remain with their owners; the engine consumes their defined inputs.
