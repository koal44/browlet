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

### Variables 1 and Values 5 Appendix A audit

Reviewed both local `Overview.bs` sources and the published editor's drafts on
2026-10-22. The connected profile is unregistered custom properties, `var()`,
the installed ordinary properties, and margin. The following accounts for each
normative section; a working substitution path does not complete its dependencies.

| Section | Implemented and tested | Remaining work or recorded choice |
| --- | --- | --- |
| Variables 1 §2: names, cascade, inheritance | Decoded names retain exact case/code points; `--` is reserved. Inline and matched rules use importance/specificity/order; children inherit computed values. | Full [Cascade](../engine/ROADMAP.md), conditions, pseudo-elements and cross-scope inheritance. The future `all` shorthand must exclude custom properties. |
| Variables 1 §2: animation | CustomProperty combines unregistered values discretely, retaining their source. No connected animation producer. | Keyframe taint, transitive taint, and rejection of tainted substitutions in non-animatable properties belong with [animation](../../animation/ROADMAP.md). |
| Variables 1 §2.1: value syntax | Opaque declaration validation, empty values, priority removal, retained casing, and `var()` argument validation. | Unregistered URL tokens stay unresolved; URL-valued consumers must supply the consuming declaration's base. Other substitution functions still need argument validation. |
| Variables 1 §2.2: guaranteed-invalid | Distinct from a valid empty value; initial/missing values, cycles, and failed substitution use the sentinel. | Registered universal-syntax values need the same invalid-result rule when registration is connected. |
| Variables 1 §3: `var()` | Dynamic name substitution, exact-name lookup, empty/comma/brace fallbacks, and lazy fallback selection. | Animation taint and registered computed values. The approved draft/browser argument and fallback differences remain recorded in the [engine account](../engine/README.md#substitution-draft-differences). |
| Variables 1 §4–4.1: APIs and serialization | CSSOM name/value access, retained declared/computed spelling, boundary and comment-only values through substitution and fallback/spread selection, empty-value serialization, and fresh reads after edits. | Live computed-style objects remain unfinished. Browser comment differences are recorded in [Syntax](../syntax/ROADMAP.md#parser-disagreements). The [declaration roadmap](../cssom/declarations/ROADMAP.md#continuing-browser-differences) and engine account retain the other approved differences. |
| Appendix A.1: traversal and guards | Outermost arbitrary functions control their arguments; ordinary blocks recurse. Property guards mark all cycle participants, including references visited after an earlier failure. | The engine's guards cover custom properties on an element. Attribute, custom-function, and registered/ordinary value dependencies need their own identities and producers. |
| Appendix A.2: argument grammars and spread | Early `...` expansion precedes argument parsing; spacing rules and lazy non-spread arguments are covered. | Apply the shared traversal to each remaining function's own grammar and replacement algorithm. |
| Appendix A.3–A.4: property replacement and invalidity | Defer the consuming grammar, substitute tokens, reparse, then apply CSS-wide/defaulting rules. Invalid winners do not revive earlier declarations. | Cascade rollback, registration, and missing property inputs. Keep substitution confined to property values unless another specification explicitly enables a context; descriptors, media queries, selectors, and property names do not inherit this permission. Declaration-support queries still need the [conditional owner](../conditional/ROADMAP.md#feature-support). |
| Appendix A.5: shorthands | Pending margin occurrences cascade independently, expand once per element/query, and serialize according to pending-longhand rules. | Additional shorthand families, including reset-only/logical relationships, remain property work. `first-valid()` shorthand selection is a separate whole-value dependency. |
| Appendix A.6 / Variables security | A 65,536-token expansion limit, counting nested delimiters and each occurrence of shared replacements, prevents exponential token materialization. | This is the chosen UA limit, not a specification-mandated number or a general resource-budget policy. |

The traversal, property guard, and retained-source model need no new abstraction
for this profile. In particular, continuing after a failed replacement is needed
to discover later cycle edges; token counting and lazy source assembly serve
different consumers and must not be replaced by a text round trip.

### Implementation checklist

- [x] Connect `var()` for unregistered custom properties: recursive token
  replacement, early `...` expansion, dynamic names, and lazy fallback evaluation.
  The engine supplies guarded per-element lookup and marks all cycle participants.
  Missing/invalid values remain distinct from valid empty values. Expanded
  sequences are bounded to 65,536 underlying tokens before composition.
- [x] Validate `var()` argument grammar in custom and ordinary declaration
  acceptance. Lists whose structure depends on early spread are validated after
  expansion; the final custom-property name is checked at computation. Preserve
  the [approved draft/browser differences](../engine/README.md#substitution-draft-differences).
- [ ] Extend validation and replacement to the other arbitrary substitution
  functions. Their evaluation currently throws explicitly; their argument
  validation is still a TODO. Preserve function-specific evaluation rather than
  eagerly substituting every fallback or unselected conditional branch.
- [ ] Generalize dependency guards to registered font-relative values, ordinary
  properties, attributes, and custom functions when those owners are connected.
  Carry animation and attribute taint where their defining algorithms require it.
  Animation taint originates in keyframes, propagates through custom-property
  references, and makes `var()` use its fallback in a non-animatable property.
  The current lookup returns a value without this metadata.
- [x] Reparse substituted results against the consuming grammar and implement
  invalid-at-computed-value-time fallback. A failed winning value does not
  revive an earlier declaration; coordinate with [engine defaulting](../engine/ROADMAP.md).
- [x] Preserve shorthand pending-substitution values and their original source
  relationship until longhands can be assigned. CSSOM serialization must retain
  the distinction between an unexpanded shorthand and independent longhands.
  Margin is connected; the [shorthand account](../props/ROADMAP.md#shorthand-substitution-handoff)
  records shared grammar, overwrite/equality, and computed-failure handling.
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
- [x] Preserve unregistered custom-property source spelling through substitution,
  including comments, escapes, empty replacements, and implicit EOF delimiters.
  Compose token/source lists directly and separate adjacent tokens when needed;
  do not serialize and retokenize substituted values. Keep empty values distinct
  from guaranteed-invalid under
  [Variables' serialization rules](https://drafts.csswg.org/css-variables-1/#serializing-custom-props).
  Registered equivalent-token serialization remains part of the computation task above.

  `SPEC_CLASH(custom-property-substitution-comments)` follows Variables' source
  preservation rule for retained comments. The 2026-10-22 native probe used
  Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5, with `--empty: ;`:

  | Computed input | Browlet | Chromium | Firefox | WebKit |
  | --- | --- | --- | --- | --- |
  | `one/**/var(--empty)var(--empty)/**/two` | `one/**//**/two` | `one/**//**/two` | `one/**//**/two` | `one/**/two` |
  | `var(--empty)var(--empty)/**/one` | `/**/one` | `/**/one` | `/**/one` | `one` |
  | `one/**/var(--empty)var(--empty)` | `one/**/` | `one` | `one/**/` | `one` |
  | `fn(var(--empty)var(--empty)/**/)` | `fn(/**/)` | `fn(/**/)` | `fn(/**/)` | `fn()` |

  TokenList retains boundary comments alongside its token spans. Replacement
  references retain these lists, and slicing preserves the selected source,
  including comment-only tails of spread arguments. Computed text is assembled
  lazily and cached, so shared empty replacements do not require repeated
  traversal during serialization.

### Fallback source spelling

`SPEC_GAP(fallback-comment-whitespace)`: fallback whitespace trimming and exact
comment preservation do not yet form a complete source-serialization rule;
[CSSWG issue 6871](https://github.com/w3c/csswg-drafts/issues/6871) discusses
trimming fallback whitespace. Replacement text retains the selected token
spellings and intervening comments, but does not restore whitespace tokens
discarded by grammar selection. Whitespace inside comments is preserved.
Declared source remains unchanged. Rendering and caching happen only when text
is requested; substitution and argument parsing still work directly with tokens.

For example, `calc(1px/**/var(--missing, /*before*/ + 2px))` emits
`calc(1px/**//*before*/+ 2px)`. Both the retained tokens and reparsed text fail
the length grammar because the fallback's leading whitespace was discarded.
A local browser probe on 2026-10-22 confirmed that Chromium, Firefox, and WebKit
also reject this calculation, although their emitted comments differ.
Computed `--absent, /*only*/ var(--empty)` supplies `/*only*/` when selected
as a spread fallback. The [substitution regressions](../../../test/stylelet/unit/values/substitution.test.ts)
cover literal, braced, and spread fallbacks, declared custom replacements, and
whitespace that must remain meaningful in the surrounding calculation.

## Resolution, combination, and API boundaries

- [ ] Audit math/value resolver pairs against [Values 4](https://drafts.csswg.org/css-values-4/#calc-computed-value)
  and relevant Values 5 additions. Keep percentage timing, range clamping,
  integer rounding, non-finite values, and incomplete context explicit.
  Follow the [lifecycle roadmap](../value-processing/ROADMAP.md) for stage ownership;
  serialization must not supply missing calculation or conversion.
- [ ] Extend whole-value selection to shorthands and implement if replacement.
  Ordinary WholeValue selects a supported first-valid argument and only then
  computes it, including substitution. Margin first-valid remains an explicit
  unfinished boundary. Preserve the existing seven expected-failure cases as visible debt;
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

The engine currently supplies URL/base/tree facts, guarded custom-property lookup,
and host system colors (with fixed light defaults). Direct resolvers accept the
other fields below, but their providers are not connected. Missing facts can
leave a relative value unresolved or make a helper return null; neither outcome
proves a complete observable computed value. Preserve intentionally unresolved
values when the property's stage requires them.

Animation callers currently retain the value family without having to prove its
resolved representation. `ColorValue.interpolate()` checks for absolute colors
at runtime and throws when resolution is unfinished. Revisit guarantees tying
stage and supplied context to result representations once connected stylesheet
and animation consumers establish their requirements; do not make all context
fields mandatory merely to promise complete resolution.

| Existing consumer/input | Required fact and owner | Changes that can invalidate the result |
| --- | --- | --- |
| [LengthResolutionContext](numeric-literal/length.ts): em/rem, ex/rex, cap/rcap, ch/rch, ic/ric, lh/rlh | Effective CSS pixels per unit from parent/root/element style and [font](../../fonts/ROADMAP.md) metrics/fallback; not every unit is a raw glyph measurement | Relevant style, selected face/fallback, loading, and line-height rules |
| LengthResolutionContext: small/large/dynamic viewport dimensions and viewportInlineAxis | Host viewport variants in CSS pixels and the appropriate CSS logical axis; not interchangeable with window.innerWidth/Height | Resize, viewport UI state, and relevant writing-mode changes |
| LengthResolutionContext: container physical/logical dimensions | [Condition selection](../conditional/ROADMAP.md#container-conditions-and-relative-units) plus layout size per axis, including small-viewport fallback | Ancestry, containment/eligibility, style, box size, and fallback viewport |
| [MathContext](math-value.ts): percentageReferenceValue, percentHint, range, devicePixelRatio | Property-specific reference, timing, and range; layout/image/output owners supply the actual facts | Reference box/image size, consuming property, or output density |
| [ColorContext](color.ts): currentColor, systemColors, colorScheme, colorProfiles | Style supplies computed color/scheme; UA policy and output/resource consumers supply effective palettes/profiles | Inheritance, scheme preferences, forced-color palette, and profile availability |
| [PositionContext](position.ts): writingMode, direction | Computed CSS axes; HTML directionality from DOMOperations is a different question | Relevant computed style |
| [GradientContext](gradient.ts): gradientBoxSize | Concrete gradient image size chosen by the consuming image/layout operation | Image placement/sizing and reference geometry |
| [UrlContext](url.ts): env, baseUrl, treeScope | Declaration/sheet provenance and scoped local references; resolution does not fetch, decode, or locate a resource | Preserve parse-time base and the required scope across later edits/adoption |

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
together. [Custom-property contracts](../../../test/stylelet/custom-properties.contracts.ts)
and [ordinary-property contracts](../../../test/stylelet/ordinary-properties.contracts.ts)
now exercise the unregistered path through Browlet and native browsers; helper
tests alone still do not prove registration or the other integrations above.
The [baselines](../README.md#test-baselines) record earlier runs. Full WPT coverage,
remaining function grammars, and complete property/feature audits remain future work.
