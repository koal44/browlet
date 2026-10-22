# CSS value roadmap

The [README](README.md) records the inspected shared machinery. This roadmap
covers lifecycle dependencies and unfinished property-family helpers.
The [property roadmap](../props/ROADMAP.md) owns the wider family inventory.
The class migration below replaced the function/definition arrangement.

## Value classes

- [x] Introduce the shared instance contract with precise context types and
  separate, static grammar entry points. Migrate MathValue, AnglePercentageValue,
  and AnyValue, retaining existing syntax lists without copying arrays.
- [x] Migrate the straightforward families: angle, dimension, frequency, time,
  length, resolution, number, integer, percentage, and the remaining mixed
  percentage grammars; auto, ident, custom-ident, dashed-ident, string, An+B,
  and general-enclosed. Retain their existing behavior and numeric-literal helpers.
- [x] Migrate the numeric literals to flat classes with static grammars and
  instance operations. Share DimensionLiteral as the base of recognized
  dimensions and retain it for unknown units. Remove the extra DimensionValue
  container; keep mixed literal grammars as unions. Preserve numeric-variable
  inputs and math's internal calculation records with dimensional hints.
- [x] Migrate ordinary composites and conditions: ratio, opacity, position,
  URL/modifiers, boolean expressions, supports, and media queries. Keep condition
  evaluation separate from value-stage resolution. Update Browlet's
  document/user-agent literal factories and IntersectionObserver margin copies
  and fixtures to retain literal classes. BoxSides remains provisional and
  unchanged pending clarification of its possible Typed OM role.
- [x] Migrate color and gradient, retaining color-profile coordinate contracts,
  relative-color context, gradient geometry, and stop fixup. Move image grammar
  consumers to the URL/gradient union without another container or lifecycle
  dispatcher. Keep unsupported gradient combinations explicit.
- [x] Final slice: contextual and deferred assembly. Migrate registered syntax,
  WholeValue, CSS-wide forms, invalidity, substitution, first-valid, and if;
  finish property and selector integration. Preserve the consuming grammar for deferred reparsing,
  lazy branch selection, and property-owned initial/inherited metadata. Remove
  obsolete definition dispatch as its consumers migrate.

The migrated consumers use one class API. Contextual behavior and missing
dependencies remain explicit; a class migration alone does not implement them.

Focused literal, numeric, elementary, composite, color, gradient, image,
condition, opaque-sequence, and lifecycle tests exercise the new classes.
URL tree-scope, MediaList, CSSOM, selector, engine, and Browlet integration suites
also use the migrated property/registered-syntax graph. Existing expected
failures and skips remain visible; migration failures are not reclassified.

## Substitution and custom values

Primary contracts: [Variables 1](https://drafts.csswg.org/css-variables-1/#using-variables),
[Values 5 substitution](https://drafts.csswg.org/css-values-5/#arbitrary-substitution),
and [environment variables](https://drafts.csswg.org/css-env-1/#environment).
The local Variables text now delegates shared substitution mechanics to Values 5;
audit those sources together rather than implementing two replacement engines.

- [ ] Replace the explicit arbitrary-substitution stub with the relevant
  function algorithms. Preserve component values and function-specific argument
  evaluation; fallbacks and unselected if branches are not eagerly evaluated.
- [ ] Supply per-element custom-property computed values, missing/invalid
  distinctions, empty fallbacks, cycle detection, and bounded expansion.
  Registered font-relative dependencies can form cycles with ordinary properties.
  Handle animation and attribute taint where their defining algorithms require it.
- [ ] Reparse substituted results against the consuming grammar and implement
  invalid-at-computed-value-time fallback. A failed winning value does not
  revive an earlier declaration; coordinate with [engine defaulting](../engine/ROADMAP.md).
- [ ] Preserve shorthand pending-substitution values and their original source
  relationship until longhands can be assigned. CSSOM serialization must retain
  the distinction between an unexpanded shorthand and independent longhands.
- [ ] Give `env()` a named/indexed variable lookup and fallback behavior supplied
  by the relevant UA/viewport owner. Do not confuse this with the JS owning
  environment or turn missing facts into zero. The draft's unresolved
  author-defined environment-variable API is not a design to invent here.
- [ ] Account separately for `attr()` typed conversion/security, `inherit()`,
  conditional selection, randomness, and custom functions as they acquire real
  consumers. Recognition by the current detector does not establish support.

## Registered values and provenance

Read the Properties and Values API's
[computed-value rules](https://drafts.css-houdini.org/css-properties-values-api-1/#calculation-of-computed-values),
[substitution](https://drafts.css-houdini.org/css-properties-values-api-1/#substitution),
and [relative-unit cycles](https://drafts.css-houdini.org/css-properties-values-api-1/#dependency-cycles).
Document registration and `@property` integration belong to the engine/rule
roadmaps; these tasks concern the resulting values.

- [ ] Finish transform value parsing/resolution and registration syntax tests.
  A syntax string being accepted does not mean its value consumer is available.
- [ ] Apply registration-specific computation, including canonical units,
  retained percentages, list items, first matching syntax alternative, and
  equivalent tokens for substitution. Generic helpers must not accidentally
  resolve registered percentages against an unrelated property's reference.
- [ ] Preserve URL timing: typed registered URLs resolve at their declaration's
  source before substitution; unregistered URL tokens resolve when consumed by
  a typed property. Include differing sheet bases and local-fragment tree scope.
- [ ] Preserve custom-property source spelling through substitution. Audit
  valid empty values versus guaranteed-invalid serialization against
  [Variables' serialization rules](https://drafts.csswg.org/css-variables-1/#serializing-custom-props);
  the current original-text field alone does not prove that whole lifecycle.

## Resolution, combination, and API boundaries

- [ ] Audit math/value resolver pairs against [Values 4](https://drafts.csswg.org/css-values-4/#calc-computed-value)
  and relevant Values 5 additions. Keep percentage timing, range clamping,
  integer rounding, non-finite values, and incomplete context explicit.
  Follow the [lifecycle roadmap](../value-processing/ROADMAP.md) for stage ownership;
  serialization must not supply missing calculation or conversion.
- [ ] Connect first-valid and if behavior to real substitution and property
  validity. Preserve the existing seven expected-failure cases as visible debt;
  recheck current draft algorithms before implementing them.
- [ ] Provide typed registered-property interpolation when an actual consumer
  needs it: computed-value dispatch, equal-length lists, and transform-specific
  behavior. Extend value operations when a consumer needs them, using the
  existing type-specific combination methods without restoring definition dispatch.
  [Registration interpolation](https://drafts.css-houdini.org/css-properties-values-api-1/#animation-behavior-of-custom-properties)
  does not require this folder to own timelines or animation scheduling.
- [ ] Implement [Typed OM reification](https://drafts.css-houdini.org/css-typed-om-1/#reify-stylevalue)
  through CSSOM implementations, including unparsed variable-containing values
  and property-associated fallback objects. Internal value classes remain
  distinct. [Typed OM](../cssom/typed/ROADMAP.md)
  owns public values/maps and their mutation, identity and freshness tests.

## Color, image, position and relative-value consumers

- [ ] Audit generic color computation against each consuming property. Connect
  currentColor, effective system palettes, chosen color scheme and profiles at
  their required stages; keep forced-color policy and output conversion distinct
  from arithmetic. Sources: [Color 4 resolution](https://drafts.csswg.org/css-color-4/#resolving-color-values)
  and [Color Adjust 1](https://drafts.csswg.org/css-color-adjust-1/#color-scheme-resolution).
- [ ] Extend [image values](https://drafts.csswg.org/css-images-4/#image-values)
  deliberately beyond URLs/gradients. Image-set candidate type/resolution
  selection needs supported formats and output/resource policy; cross-fade,
  element references and painting worklets have different consumers. A computed
  URL/image is not evidence of a loaded, decoded resource.
- [ ] Connect [natural/concrete image sizing](https://drafts.csswg.org/css-images-3/#sizing-terms)
  to gradient preparation and position resolution. Preserve percentages until
  their property's basis is available; background placement, for example,
  requires the positioning area minus the image size.
- [ ] Finish gradient combination's explicit unsupported cases when an actual
  consumer needs them. Keep direct stop/interpolation tests separate from a
  claim of rendered image equivalence or animation support.
- [ ] Supply effective font, viewport and per-axis container references from
  the owning style/resource/layout operation. Implement specified fallback
  rules there; missing context is not zero. See
  [context inputs](#context-inputs-and-freshness) and
  [query-specific reference rules](../conditional/ROADMAP.md).

## Context inputs and freshness

The engine currently supplies URL/base/tree facts. Direct resolvers accept the
additional fields below, but providers are not connected. Missing facts can
leave a relative value unresolved or make a helper return null; neither outcome
proves a complete observable computed value. Preserve intentionally unresolved
values when the property's stage requires them.

| Existing consumer/input | Required fact and owner | Changes that can invalidate the result |
| --- | --- | --- |
| [LengthResolutionContext](numeric-literal/length.ts): em/rem, ex/rex, cap/rcap, ch/rch, ic/ric, lh/rlh | Effective CSS pixels per unit from parent/root/element style and [font](../../fonts/ROADMAP.md) metrics/fallback; not every unit is a raw glyph measurement | Relevant style, selected face/fallback, loading, and line-height rules |
| LengthResolutionContext: small/large/dynamic viewport dimensions and viewportInlineAxis | Host viewport variants in CSS pixels and the appropriate CSS logical axis; not interchangeable with window.innerWidth/Height | Resize, viewport UI state, and relevant writing-mode changes |
| LengthResolutionContext: container physical/logical dimensions | [Condition selection](../conditional/ROADMAP.md#container-conditions-and-relative-units) plus layout size per axis, including small-viewport fallback | Ancestry, containment/eligibility, style, box size, and fallback viewport |
| [MathContext](math-value.ts): percentageReferenceValue, percentHint, range, devicePixelRatio | Property-specific reference, timing, and range; layout/image/output owners supply the actual facts | Reference box/image size, consuming property, or output density |
| [ColorContext](color.ts): currentColor, systemColors, colorScheme, colorProfiles | Style supplies computed color/scheme; UA policy and output/resource consumers supply effective palettes/profiles | Inheritance, scheme preferences, forced-color palette, and profile availability |
| [PositionContext](position.ts): writingMode, direction | Computed CSS axes; HTML directionality from DOMOperations is a different question | Relevant computed style |
| [GradientContext](gradient.ts): gradientBoxSize | Concrete gradient image size chosen by the consuming image/layout operation | Image placement/sizing and reference geometry |
| [UrlContext](url.ts): URL constructor, baseUrl, treeScope | Declaration/sheet provenance and scoped local references; resolution does not fetch, decode, or locate a resource | Preserve parse-time base and the required scope across later edits/adoption |

Sources include [system colors](https://drafts.csswg.org/css-color-4/#css-system-colors),
[scheme selection](https://drafts.csswg.org/css-color-adjust-1/#color-scheme-resolution),
[forced colors](https://drafts.csswg.org/css-color-adjust-1/#forced-colors-properties),
and [natural/concrete image sizes](https://drafts.csswg.org/css-images-3/#sizing-terms).
[Media](https://drafts.csswg.org/mediaqueries-4/#units) and
[container](https://drafts.csswg.org/css-conditional-5/#size-container) queries use
different reference styles; scroll-state queries require an ordered snapshot.
Connect only the facts a consumer needs through existing owners. No new context
bag or cache ownership follows merely from the existence of these fields.

## Scope and future evidence

Variables 2 and Conditional Values 1 were checked for scope/status: they remain
exploratory local drafts. The work above follows the concrete Variables 1 /
Values 5 contracts; newer proposals need their own review before adoption.

Use direct representation tests and connected stylesheet/inline/CSSOM tests
together. Existing helper tests do not prove registration, variable inheritance,
or computed-style integration. The [baseline](../README.md#cascade-and-values)
records exactly what ran. The [property and condition baseline](../README.md#properties-and-conditions)
adds existing family-helper and condition tests. Browser/WPT comparison and
complete property/feature audits remain future work.
