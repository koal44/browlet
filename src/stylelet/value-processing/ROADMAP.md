# Value-processing roadmap

The [README](README.md) describes the two existing shared contracts. This
roadmap accounts for lifecycle requirements without prescribing a new value
class hierarchy, context bag, or cache.

## Contracts to connect

| Requirement | Owner and missing connection |
| --- | --- |
| Declared values | Syntax/property interpretation preserves validity, importance, source order, text where required, and base/tree provenance. Shorthand and logical-property relationships need explicit accounting. |
| Cascaded value | The [engine](../engine/ROADMAP.md) selects among applicable declarations with complete precedence and rollback context. |
| Specified value | Engine defaulting uses property initial/inherited metadata and the inherited computed value; CSS-wide keywords are operations here, not final values. |
| Computed value | Engine supplies dependency facts and substitution; property/value resolvers apply the property's computed-value rule. Percentages and unresolved calculations survive when the property requires it. |
| Used / Actual values | Style algorithms consume explicit font, geometry, rendering, and device facts from their owners. Layout and painting remain external; not every property applies to every target. |
| Observable queries | CSSOM chooses resolved values; Typed OM reifies computed or declaration values into its own implementations. Binding creates Platform objects. Neither serialization nor projection performs missing style computation. |

Sources: [Cascade stages/defaulting](https://drafts.csswg.org/css-cascade-5/#value-stages),
[Values 4 calculation stages](https://drafts.csswg.org/css-values-4/#calc-computed-value),
[range checking](https://drafts.csswg.org/css-values-4/#calc-range), and
[Values 5 property substitution](https://drafts.csswg.org/css-values-5/#resolve-property).
Individual algorithms in these sections still need implementation review.

## Property definitions and failure states

- [ ] Add the property information needed by actual consumers: initial value,
  inherited flag, computed-value rule, applicability, percentage behavior,
  shorthand relationships, and logical groups. Do not turn ValueDefinition's
  shared grammar operations into a duplicate table of every property fact.
  Decide the concrete shape while connecting the first defaulting cases.
- [ ] Preserve different outcomes: invalid syntax is discarded before cascade;
  an invalid substituted winner follows computed-time fallback, not an earlier
  declaration; a rollback keyword deliberately revisits cascade candidates.
  Missing implementation/input is neither valid CSS invalidity nor a default.
- [ ] Keep guaranteed-invalid custom values distinct from valid empty token
  values. Registered syntax failure needs the registration's defaulting rules,
  not just a serialized empty string.
- [ ] Define how a stage caller knows required facts were supplied. The current
  resolvers may retain a relative value when facts are absent; that is useful
  internally but insufficient evidence that an observable Computed result is
  complete. Preserve intentional unresolved percentages/calculations.

## Dependencies and serialization

- [ ] Trace parent/root values, font-relative references, percentages, color
  dependencies, viewport/container facts, and registration changes through
  computation and invalidation. Reuse existing owners and identify the exact
  fact/lifetime before introducing an abstraction.
- [ ] Treat value dependencies and substitution cycles together, including
  registered relative lengths that depend on font-size/line-height. The
  [value roadmap](../values/ROADMAP.md#substitution-and-custom-values) owns the
  replacement algorithms; the engine owns per-element values and their lifetime.
- [ ] Audit resolver/serializer pairs with stage-specific expectations. For
  example, retain unresolved percentages, resolve relative URLs at the required
  stage, and clamp computed math results before serializing. The specification
  sometimes describes these outcomes in its serialization section; this does
  not move resolution responsibility into our serializers.
- [ ] Preserve original custom-property token spelling where required and use
  equivalent tokens for computed registered values. Do not round-trip every
  internal value through text merely to cross an ownership boundary.

Use small resolver tests for representation/stage behavior and connected engine
tests for inherited/defaulted values and dependency updates. Existing direct
resolver coverage is recorded in the [cascade and value baseline](../README.md#cascade-and-values).
The [family roadmap](../props/ROADMAP.md) and
[value inputs](../values/ROADMAP.md#context-inputs-and-freshness) record required
facts and their freshness. [Animation](../../animation/ROADMAP.md) and
[Typed OM](../cssom/typed/ROADMAP.md) own effect and public-view consumers;
[project priority](../../PRIORITY.md#stylelet-delivery-order)
orders delivery from the CSSOM declaration boundary.
