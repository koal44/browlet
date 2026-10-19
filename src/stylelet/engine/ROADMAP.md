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
  order through the [rule pipeline](../css/ROADMAP.md). A retained CSSOM child
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

- [ ] Obtain initial values, inherited flags, and computed-value rules from
  property definitions. Defaults and explicit CSS-wide keywords must work even
  when no declaration won. The [lifecycle roadmap](../value-processing/ROADMAP.md)
  records the missing metadata and stage contracts.
- [ ] Resolve inherited computed values using the flat-tree parent, with root
  defaults and pseudo-element-specific inheritance. Identify the existing DOM
  owner supplying that relation; layout boxes are not the inheritance tree.
- [ ] Connect custom-property computation and substitution before resolving
  consuming built-ins. Preserve the distinction between parse-time rejection,
  computed-time invalidity, and cascade rollback.
- [ ] Supply only the facts a resolver needs: parent/root style, percentages,
  font metrics, viewport/container references, color inputs, and URL provenance.
  The [value-input contracts](../values/ROADMAP.md#context-inputs-and-freshness) distinguish existing
  fields from absent providers. Do not silently report a value as fully
  computed when a required fact is unavailable.

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
  rules required by the contributing specifications, then invalidate affected
  values on registration or stylesheet changes. Registration lookup is not
  per-element variable lookup.
- [ ] Preserve typed registered values when substituting their equivalent token
  sequence. Unregistered token values have different URL timing and source-text
  requirements; see the [value roadmap](../values/ROADMAP.md).

## Queries, mutation, and tests

- [ ] Establish freshness for tree/attribute changes, CSSOM mutation, sheet
  replacement/adoption, registrations, and external facts before choosing a
  cache. Keep live CSSOM/Typed OM views distinct from cached internal values.
- [ ] Preserve parse-time URL bases across inline/CSSOM edits and shared sheets;
  keep the authoritative-empty inline provider contract through this work.
- [ ] Add connected tests for an absent declaration, explicit inheritance,
  flat-tree inheritance, rollback, invalid substituted winners, registered and
  unregistered variables, and retained live query objects. Registration tests
  must use real input/API paths as well as direct value fixtures.

The [existing baseline](../README.md#cascade-and-values) is scoped evidence.
It does not close these tasks. Layout, painting, timelines, and platform-object
projection remain with their owners; the engine consumes their defined inputs.
