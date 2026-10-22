# CSSOM declarations roadmap

The [README](README.md) records the §6.5–6.6 implementation and ownership.
The APIs and Web IDL are present; incomplete property families still limit them.

## Declaration typing

- [ ] Revisit the name/value coupling in [InterpretedDeclaration](interpreted-declaration.ts).
  It rejects mismatched construction and preserves per-property narrowing, but
  current production callers mainly need the built-in/custom distinction and
  common value operations. Reassess whether those benefits justify the class
  expression, mapped instance union, and correlation assertions as consumers
  develop. As the property registry grows, measure TypeScript checking and
  editor responsiveness before extending this machinery. The typing adds no
  runtime work; no compiler or editor slowdown has been established.

## Declaration state and lifecycle

- [ ] Finish shorthand expansion and serialization in the property layer,
  starting with [margin](../../props/built-in/margin.ts). The mapping, CSSOM query/removal,
  block selection, and expanded-declaration return contract exist. The family
  operations throw explicitly; do not count those stubs as supported CSS.
- [ ] Retain pending substitution across a shorthand's longhands. A `var()`
  shorthand cannot be split into independently parsed longhands before
  substitution; partial overwrites must remain distinguishable. See
  [Variables](https://drafts.csswg.org/css-variables-1/#variables-in-shorthands)
  and the [property roadmap](../../props/ROADMAP.md#shorthand-and-logical-property-dependencies).
- [ ] Complete §6.7 value serialization, including CSS-wide shorthand values,
  reset-only longhands, incompatible combinations, and canonical shortening.
  Serialization must not resolve values to manufacture a shorthand.
- [ ] Add actual logical-property families. Physical margin metadata and
  CSSOM's ordering/serialization constraints are present, but no registered
  logical longhands exercise the opposite-mapping branches yet. Cover both
  `setProperty()` movement and interleaved shorthand serialization when adding them.
- [ ] Preserve URL base/provenance per parsed declaration when enabling
  URL-valued properties. A block can contain declarations from different edits
  and bases; a later document base cannot replace that history.

The collection class owns ordered declaration data; the CSSOM implementation
owns flags, rule/node associations, and attribute write-back. This keeps one
accepted inline collection before and after lazy `.style` access.
Construction reads no attribute. Hosts explicitly deliver initial input;
Browlet gates it through CSP. Keep the existing regression coverage for blocked
replacements, CSSOM bypass, shared identity, and live indexed properties.

Descriptor grammars remain with their [rule families](../rules/ROADMAP.md).
The [computed-result contract](../ROADMAP.md#computed-results-and-external-facts)
needs invalidation and external facts; [Typed OM](../typed/ROADMAP.md) must
eventually use the same declaration mutations.

## Continuing browser differences

Observed with installed Chromium, Firefox, and WebKit on 2026-10-21; approved
choices are covered by separate native-browser expected failures. Browlet
assertions run before those annotations.

- `SPEC_CLASH(custom-property-name-serialization)`: CSSOM's
  [literal declaration serializer](https://drafts.csswg.org/cssom/#serialize-a-css-declaration)
  appends the decoded property name without escaping; WebKit does likewise.
  Follow Chromium/Firefox by escaping names such as `--x:other` and `--x y`,
  preserving their identity across a cssText round trip. Ordinary property
  lookup and `item()` still return the decoded name.
- `SPEC_CLASH(custom-property-value-escapes)`: Follow
  [CSS Variables serialization](https://drafts.csswg.org/css-variables-1/#serializing-custom-props)
  and Chromium/Firefox by preserving custom-value source spelling. WebKit
  decodes escapes such as `foo\62 ar` to `foobar` in both property queries and
  `cssText`. The isolated escape round-trip case asserts Browlet first and marks
  only WebKit's native comparison as an expected failure.
- `SPEC_CLASH(empty-custom-property-serialization)`: Follow
  [CSS Variables' empty-value exception](https://drafts.csswg.org/css-variables-1/#serializing-custom-props)
  by returning one space for an empty custom value. Chromium, Firefox, and
  WebKit return the empty string instead. One space keeps copying the result
  through `setProperty()` from removing the destination property. Full declaration
  text remains `--name: ;`. Each browser has its own expected-failure case;
  Browlet's property query and copy round trip must pass before the annotation.
- `SPEC_CLASH(empty-value-priority-order)`: Follow
  [CSSOM setProperty](https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-setproperty)
  and Firefox: an empty value removes the property even with an invalid priority.
  Chromium/WebKit validate priority first and leave it in place. Null-to-empty
  conversion follows the same path.
- `SPEC_CLASH(css-declaration-indexed-write)`: Follow
  [Web IDL legacy indexed objects](https://webidl.spec.whatwg.org/#legacy-platform-object-set)
  and Firefox/WebKit: an indexed write fails without an indexed setter.
  Chromium reports success while leaving the declaration unchanged.
- `SPEC_CLASH(css-property-attribute-placement)`: Follow
  [Web IDL regular attributes](https://webidl.spec.whatwg.org/#es-attributes)
  and Firefox/WebKit by putting generated property attributes on the prototype.
  Chromium exposes enumerable own attributes instead. Binding owns this behavior.

The earlier important-declaration source-order choice remains documented in the
[rule roadmap](../rules/ROADMAP.md); custom-value boundary comments retain the
[Syntax choice](../../syntax/ROADMAP.md).
