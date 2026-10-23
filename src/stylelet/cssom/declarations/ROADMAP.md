# CSSOM declarations roadmap

The [README](README.md) records the §6.5–6.7 implementation and ownership.
The APIs and Web IDL are present; incomplete property families still limit them.

## Declaration typing

- [ ] Revisit the name/value coupling in [InterpretedDeclaration](interpreted-declaration.ts).
  It rejects mismatched construction and preserves per-property narrowing, but
  current production callers mainly need the built-in/custom distinction and
  common value operations. Reassess whether those benefits justify the
  constructor alias, mapped instance union, and correlation assertions as consumers
  develop. As the property registry grows, measure TypeScript checking and
  editor responsiveness before extending this machinery. The typing adds no
  runtime work; no compiler or editor slowdown has been established.

## Declaration state and lifecycle

- [x] Implement ordinary shorthand expansion and serialization in the property
  layer, starting with [margin](../../props/built-in/margin.ts). The property record
  returns ordered values; CSSOM retains their named property records and importance.
  One-to-four sides, CSS-wide values, incompatible combinations, and canonical
  shortening now work through inline-style and rule bindings.
- [x] Retain pending substitution across a shorthand's longhands. A `var()`
  shorthand cannot be split into independently parsed longhands before
  substitution; partial overwrites must remain distinguishable. See
  [Values 5](https://drafts.csswg.org/css-values-5/#substitution-in-shorthands)
  and the [shorthand account](../../props/ROADMAP.md#shorthand-substitution-handoff).
  Margin now retains the shared occurrence, and assignment does not mistake
  two pending values' empty serializations for equality.
- [ ] Add reset-only longhands with the first property family that has them.
  Margin has none; its passing tests do not establish reset-only support.
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

## Section 6.7 value accounting

Reviewed the current CSSOM parsing and serialization rules on 2026-10-21,
including their references to CSS Values, Box, Cascade, and Color. The live
[§6.7](https://drafts.csswg.org/cssom/#css-values) agrees with the local source
used here. Its examples explicitly warn that some are outdated; the normative
rules and each value family's current specification take precedence.

| Requirement | Current owner and remaining boundary |
| --- | --- |
| Parse a CSS value against its property's grammar; reject embedded `!important` | `InterpretedDeclaration.parse()` tokenizes only the value and applies the registered grammar. It retains interpreted values instead of returning the specification's component list, as already reviewed. Invalid input leaves existing declarations unchanged. Unsupported property names still have no grammar. |
| Exact shorthand representation, canonical order, shortest equivalent spelling | Ordinary margin expands and shortens in top/right/bottom/left order. Equal importance and completeness belong to the block; the family rejects incompatible values. There are no reset-only or logical margin records yet. |
| Keywords, identifiers, strings, separators | Value-owned serializers use Syntax's identifier/string escaping and function/list formatting. Opaque custom-property source preservation follows Variables rather than stripping all whitespace. There is no property-independent whitespace rewrite over parsed values. |
| Integer, number, percentage | Numeric literals use shortest base-ten text, no exponent notation, at most six fractional digits, and normalized negative zero; numeric literal tests exercise rounding and large integers. |
| Angle, frequency, length, time, resolution | Literal serialization formats the retained unit. Resolvers prepare canonical computed units; margin additionally prepares unitless declared zero as `0px`. Time/resolution-valued properties are not registered: their future property consumers must prepare any required declared seconds/dppx representation before serialization. Generic value parsers and media-query components are not proof of those property contracts. |
| Color and alpha | `ColorValue` prepares declared representations and serializes the retained stage; existing color tests cover the family's formats and alpha rules. Contextual colors still need the palette/current-color/profile facts listed in the value roadmap. No color-record reorganization is needed for this section. |
| Ratio | `RatioValue` serializes the retained numerator and denominator with ` / `; existing tests cover this primitive. No ratio-valued property is registered. |
| URL | `UrlValue` quotes and escapes the retained URL. Resolution owns absolutization; future URL properties must retain each declaration's parse-time base. CSSOM itself flags the declared/computed distinction as unresolved. |
| Counter, legacy `rect()` shape, font-family name | Concrete value/property grammars and their consumers are absent. Implement the counter/counters argument and default-decimal rules, rect components, and font-family quoting with those families; generic strings/functions alone do not establish support. These remain on the property-family roadmap. |

Serialization must not resolve units, supply contextual defaults, or run
substitution to manufacture the required representation. See the
[value lifecycle](../../value-processing/ROADMAP.md) and
[property-family owners](../../props/ROADMAP.md#family-homes-and-stopping-points).
This audit accounts for the section; it does not claim all property families,
computed/resolved values, or deferred shorthand syntax are implemented.

## Continuing browser differences

Observed with installed Chromium, Firefox, and WebKit on 2026-10-21–22; approved
choices are covered by separate native-browser expected failures. Browlet
assertions run before those annotations.

- `SPEC_CLASH(deferred-value-source-serialization)`: Preserve a declared
  substitution's original spelling in ordinary and shorthand queries, following
  [Values 5's pending shorthand rule](https://drafts.csswg.org/css-values-5/#substitution-in-shorthands)
  and Chromium/Firefox. WebKit decodes an escaped function name (`v\61 r`) and
  drops interior comments. The 2026-10-22 cases cover margin, margin-left, and
  opacity; only WebKit's escape/comment comparison is an expected failure.
  All three engines preserve the numeric spelling and whitespace in
  `var( --gap ,  01.00px )`.
- `SPEC_CLASH(deferred-value-eof-serialization)`: Extend the approved
  [custom-value source choice](../../engine/README.md#substitution-draft-differences)
  to deferred ordinary and shorthand values. Browlet and Chromium retain
  missing closing delimiters. Firefox adds missing function, string, and URL
  closers; WebKit adds string/URL closers but leaves the outer function unclosed.
  Each delimiter case has its own native comparison. Computation uses the
  already-closed component structure and does not change the declared spelling.
- `SPEC_CLASH(shorthand-removal-return)`: Follow
  [CSSOM removeProperty](https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-removeproperty)
  and Firefox by returning the previous serialized shorthand value. Chromium
  and WebKit remove the longhands but return empty text even for a complete
  representable margin. Separate native-browser cases isolate the return value;
  mutation, rule text, and Browlet behavior remain ordinary passing assertions.
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

Unchanged shorthand assignment is a permitted implementation choice rather than
a specification clash. CSSOM's
[set-a-declaration constraints](https://drafts.csswg.org/cssom/#set-a-css-declaration)
allow a true result even when serialization did not change. Browlet, Chromium,
and Firefox avoid rewriting `style="margin: 1px 1px; color: red"` after assigning
`margin = '1px'`; WebKit rewrites canonical text. The native comparison accepts
either permitted spelling, while Browlet's test requires its unchanged attribute.

The earlier important-declaration source-order choice remains documented in the
[rule roadmap](../rules/ROADMAP.md); custom-value boundary comments retain the
[Syntax choice](../../syntax/ROADMAP.md).
