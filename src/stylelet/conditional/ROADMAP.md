# Conditional-rule roadmap

The [README](README.md) distinguishes existing parsing/value resolution from
missing matching. Keep CSS condition logic in Stylelet, with actual host and
layout facts supplied explicitly. This is dependency accounting, not a new
environment interface or a commitment to implement every query at once.

Shared condition grammars and records live in [values/](../values/README.md),
including [supports conditions](../values/supports-condition.ts). This folder
will supply condition evaluation and applicability using those representations.

## Feature support

Sources: [Conditional 3 supports](https://drafts.csswg.org/css-conditional-3/#at-supports)
and [Conditional 4 selector tests](https://drafts.csswg.org/css-conditional-4/#at-supports-ext).

- [ ] Connect declaration tests to implemented property/value support and
  selector tests to the supported matching surface. A generic parser accepting
  syntax does not establish that the UA supports the feature.
- [ ] Preserve each query language's truth rules: supports uses two-valued
  logic; media/container conditions can propagate unknown. Do not assume the
  generic BooleanExpr helper's final unknown-to-false conversion implements
  every leaf or negation rule.
- [ ] Connect @supports, CSS.supports, and if() to the same capability decisions while
  retaining their entry-point parsing contracts. Keep newer font/at-rule
  support tests in the broader Conditional 5 inventory until their consumers
  and support definitions are reviewed.

## Media matching

Sources: [Media Queries 4](https://drafts.csswg.org/mediaqueries-4/#mq-features)
and [Media Queries 5 preferences](https://drafts.csswg.org/mediaqueries-5/#prefers-color-scheme).

- [ ] Add supported feature definitions and evaluation: discrete/range behavior,
  comparison, unit rules, unknown features/general-enclosed, media types and
  list combination. Keep parsing failure distinct from a valid false result.
- [ ] Define the caller's output facts: viewport or page-box size in CSS pixels,
  resolution with the specified zoom treatment, device/input capabilities,
  color/dynamic range and user preferences. Supply only the features being
  implemented; no generic layout object is needed merely to match a query.
- [ ] Use UA initial values for [relative media-query units](https://drafts.csswg.org/mediaqueries-4/#units).
  They must not inherit the queried element's font size or other declarations.
- [ ] Connect matching to sheet/import/group participation and the concrete
  [Browlet consumer](../../browlet/style/ROADMAP.md#media-matching). Changes in
  output/device state must invalidate applicability. CSSOM View's MediaQueryList
  identity, live matches, and change delivery belong to that host consumer.

## Container conditions and relative units

Source: [Conditional 5](https://drafts.csswg.org/css-conditional-5/#container-rule).

- [ ] Preserve container names, eligibility and tree relationships. Conditions
  select eligible ancestors for their queried features; no eligible container
  is unknown, not a fabricated zero-sized box.
- [ ] Size queries need the selected principal box and supported containment
  axes; [style queries](https://drafts.csswg.org/css-conditional-5/#style-container)
  need computed property values/registration. Relative units in size conditions
  use the container's computed values, unlike media queries' initial values.
- [ ] Supply [container-relative units](https://drafts.csswg.org/css-conditional-5/#container-lengths)
  with effective sizes per axis, including the specified small-viewport fallback.
  Different axes can select different containers. Existing length-context
  fields accept these numbers but do not perform container selection.
- [ ] For scroll-state queries, use the specified
  [post-layout snapshot](https://drafts.csswg.org/css-conditional-5/#updating-scroll-state)
  and HTML scheduling boundary. Do not recursively measure live layout from a
  predicate or create a second rendering scheduler.

## Integration and evidence gates

Coordinate rule storage/mutation with the [rule roadmap](../cssom/rules/ROADMAP.md),
selection/defaulting with the [engine](../engine/ROADMAP.md), and box/scroll
freshness with [layout](../../layout/ROADMAP.md#update-and-query-boundaries). Container
state and device state must not become interchangeable just because both answer
boolean questions.

Add focused parser/evaluator tests, then a connected stylesheet or API consumer
that changes a relevant input. Existing value tests do not prove application or
invalidation. The [property and condition baseline](../README.md#properties-and-conditions) records
what ran. This pass read the clauses linked above; complete feature tables,
all newer query forms, and browser/WPT comparison remain future audit work.
