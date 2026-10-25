# CSS values

This folder holds reusable value grammars, internal representations, resolution,
and serialization. The [roadmap](ROADMAP.md) records missing
behavior. Parser breadth is not installed-property support.

## Value classes

The numeric families, auto, identifiers, strings, An+B, general-enclosed, ratio,
opacity, position, URL/modifiers, media queries, color, and gradient, together
with `AnyValue`, `DeclarationValue`, and `OptionalDeclarationValue`, implement
[Value](value.ts). Instances own `resolve()` and
`serialize()`; classes own `parse()`, `consume()`, and configured consumer
factories where needed. A value's representation is stored in `repr`, while
`WholeValue.inner` holds the contained value. Numeric literals keep their scalar
magnitude in `value`: `whole.inner.repr` can be a literal whose `value` is a number.
Token fields, declaration fields, and records within a representation keep their
own names.
`WholeValue` combines with another `WholeValue`, delegates to the contained value's
existing operation, and retains the result with `withValue()`, just as resolution
does. It neither reparses nor resolves an animation result. Concrete operations
keep their own operand contracts. Properties own animation categories and discrete
fallback selection; missing operations and unmet computation prerequisites throw.
`AnglePercentage` privately names its representation. `MathExpression` owns the
retained calculation tree, its serialization, and promoted-variable spelling.
`MathValueType` names a numeric result category such as length or angle-percentage.

Classes with alternative or refinable payloads use a defaulted
`R` parameter for the representation. Construction retains the supplied representation,
so `NumberValue<NumberLiteral>` can express a known literal without intersecting
the class with another `repr` field. Ordinary callers omit the parameter.
Parsing returns the complete grammar's value type; resolution and combination
also return the broader type when they can change the representation. Operations
that return the same instance can preserve the refinement. MathValue keeps its
numeric-category parameter first, with the representation constrained by that
category. Single-shape values and flat literals keep their existing contracts.
These refinements do not add runtime state or change resolution behavior.

[Collections](collections/index.ts) support multiple value grammars without
being values themselves. `MixPercentages` owns percentage completion and
normalization for mix notations; it leaves the supplied weights unchanged.

A MathValue owns resolution and retains its numeric category after its expression
becomes a literal. It can be resolved again with later context and combined through
instance methods. Numeric classes delegate their math branch to that same class, retaining
their own grammar, literal limits, percentage basis, and combination operations.
DimensionValue is a union: its parser returns the recognized value directly, or
a DimensionLiteral for an unknown unit. It adds no container of its own.
AnyValue, DeclarationValue, and OptionalDeclarationValue retain component lists
without copying already parsed lists' arrays. DeclarationValue requires nonempty
input; OptionalDeclarationValue also accepts empty input. Each has its own parse
and consume methods, and all three preserve opaque syntax through resolution.
Their raw component types and recursive malformed-token checks belong to
[Syntax](../syntax/component-value.ts). Syntax's function consumers use those
checks without constructing value instances or depending on this folder.
No value stores its resolution context or performs resolution during serialization.

Numeric literals are flat class instances. Number, integer, percentage, and zero
own their numeric operations; angle, length, frequency, time, and resolution
extend DimensionLiteral. Their magnitude and unit stay on the instance, with
operations shared through the prototype. Mixed dimension-percentage grammars
return either concrete literal and remain unions, without another container.

Math's numeric calculation terminals remain flat records with dimensional hints.
Structural nodes and variable leaves own simplification and serialization;
replacement nodes preserve their methods and dimensional hints. Shared algebra
still examines node kinds when combining terms. MathValue applies lifecycle-stage
finalization to the result, rather than finalizing each intermediate operand.
MathValue accepts literal instances and returns them when a calculation resolves;
its parser creates calculation leaves directly. Numeric variables can introduce
names and supply literal values through MathContext. They do not register new
units: the math unit table still determines which dimensions are supported.

BooleanExprValue evaluates caller-defined tests through nodes that own their
three-valued evaluation. Nodes receive the current context on each call and
preserve unknown through grouping and operators; only the complete expression
applies the caller's unknown-to-false policy. Conjunction and disjunction stop
as soon as an operand decides the result.
The nodes share an evaluation contract without type tags. Parentheses produce
the inner tree directly. A local boolean leaf applies the caller's unknown-syntax
policy to GeneralEnclosedValue, which remains an opaque value without evaluation.
SupportsConditionValue supplies the declaration-test grammar and takes its support
query at evaluation time. These are condition evaluators, not value-stage
resolvers. MediaQuery's condition and feature nodes own resolution and
serialization, including parentheses and the and/or distinction. Unknown syntax
remains GeneralEnclosedValue; device matching remains separate.
PositionValue retains logical keywords until context supplies
their physical mapping, and its combination methods require resolved offsets.
BoxSides remains a provisional tuple; its possible Typed OM role needs review.

ColorValue owns color parsing, resolution, serialization, conversion, gamut
mapping, interpolation, and comparison. Its retained color syntax and absolute
coordinate records remain data; color profiles still exchange absolute
coordinates. Relative-color resolution preserves the original syntax so the
same value can be resolved again with different contextual colors.
GradientValue coordinates interpolation compatibility; its LinearGradient,
RadialGradient, and ConicGradient representations own their geometry,
resolution, serialization, and interpolation calculations. They replace the
geometry records without adding another container. GradientBase owns shared
stop resolution, fixup, serialization, and interpolation; fixup processes
neighboring stops and hints together. The explicit form narrows the
retained color, numeric, and position representations;
angle, angle-percentage, and length-percentage resolution drop a completed math
container once its literal can be retained directly. ImageValue is a union of
URL and gradient values, whose instance methods need no separate dispatch.

Recognized URL modifier classes serialize their request options and retain
themselves in the enclosing URL's matching field, rejecting duplicates there.
The URL stores those modifiers directly, without keeping their parsing containers.
Unknown identifiers and
functions remain opaque syntax and are discarded when assembling a URL;
`url()` and `src()` share one argument grammar without separate modifier-tracking context.

## Whole values and property grammars

[WholeValue](whole-value.ts) owns the lifecycle of a complete property value.
Its `inner` uses `WholeValueContents<O>` for the grammar-specific value together
with raw, substitution, CSS-wide, first-valid, and guaranteed-invalid forms. It
retains the ordinary parser needed for deferred reparsing, without retaining
context. `BuiltInProperty.parse()` supplies its retained grammar to `WholeValue.parse()`.
Standalone callers pass their ordinary parser directly to the same method;
each parsed instance shares that parser.
Custom declarations retain their original components in `RawWholeValue` inside
the same wrapper, so declared spelling survives until computation applies the
whole-value notation and ordinary grammar. The custom property owns source-preserving
serialization and selects registration behavior from the current context;
registered computation in the engine remains unfinished.
Whole values and property records receive `PropertyContext`, which includes
substitution lookup, without a separate context type parameter. Concrete value
parsers and operations retain their narrower context contracts. The shared `Value`
interface also defaults to `PropertyContext`; explicit contexts such as
`Value<MathContext>` remain available.
`O` names the ordinary value, with `Value` as its default. Callers inspect complete
values with `isGuaranteedInvalid()`, `cssWideKeyword()`, and `isPendingSubstitution()`;
the latter checks for the retained shorthand occurrence and narrows its longhand position.
Pending substitution is state on WholeValue, not a subtype or another contained value.
Computation returns a whole value without that state, leaving the declaration unchanged.

Short type parameter names retain their roles across values and properties:
`C` is context, `O` the ordinary value accepted by a parser, `I` inner contents,
`R` a representation, `P` a property, `N` a property name, and `W` a whole value.
Use `V` for a replacement or other value, rather than reusing `R` for a result.

Parsing returns a value ready to retain in a
declaration, or null for invalid ordinary property syntax. It reads generic
declaration syntax through `OptionalDeclarationValue.parse()`, then applies the
property's grammar. The grammar's consumer prepares its Declared representation;
callers do not need a second Declared-stage resolution to finish parsing.
Existing component lists enter the same path without being tokenized again.

Later callers use `value.resolve(stage, context)` and `value.serialize()`.
Deferred substitution requires the engine's guarded `context.getCustomProperty` lookup;
ordinary values do not need it.
Resolution returns a WholeValue containing the resulting representation,
including GuaranteedInvalidValue where appropriate; null belongs to initial
parse rejection. Property records retain their parser, inheritance flag, and
initial value. WholeValue's parser association does not supply defaulting rules.
The ordinary representation can be retained or replaced by its resolver's
return type; resolution does not promise to preserve the parser's exact type.
Animation methods instead retain the return type of the corresponding concrete
operation. A length-percentage can gain math contents while remaining a
length-percentage, and color interpolation retains its absolute-color result.
The wrapper keeps the original grammar alongside any new representation.

The main representations are:

| Representation | Current role |
| --- | --- |
| RawWholeValue | Retains custom-property components and source spelling until Computed applies whole-value notation and the ordinary grammar. |
| Concrete ordinary value | Owns its resolution and serialization; WholeValue delegates directly to it. |
| CssWideValue | Recognizes `initial`, `inherit`, `unset`, `revert`, and `revert-layer`; resolution currently returns the keyword unchanged. |
| SubstitutionValue | Retains arbitrary-substitution components; replaces `var()` with a guarded custom-property lookup while preserving token/source data. Other functions stop explicitly. |
| FirstValidValue | Retains alternatives before Computed; WholeValue selects the first argument accepted by its consuming grammar, then resolves it. Unused alternatives are not substituted; a computed-time failure does not select another argument. |
| GuaranteedInvalidValue | Represents invalidity distinctly from an ordinary value; serializes as an empty string. It does not perform registration or property fallback. |

Pending longhands share one `PendingShorthand` occurrence and retain their own index
on WholeValue. Their serialization is empty; a complete compatible set can serialize
the original shorthand. The engine caches expansion per occurrence and element within
a query. Direct WholeValue resolution expands without an engine cache.

Resolution receives the requested stage and current context on every call.
Parsing recognizes CSS-wide keywords, first-valid alternatives, and substitution
values while leaving their deferred dependencies intact. Later resolution
interprets deferred syntax when due; serialization never advances a value's stage.

[substitution-value.ts](substitution-value.ts) validates `var()` arguments and
implements dynamic names, early spread, lazy fallbacks, and bounded token expansion.
Computed function blocks retain replacement lists. TokenList owns their character
bounds, including boundary comments, and preserves them through fallback selection.
Source spelling is assembled and cached only when requested. The engine supplies
computed custom values and property-cycle guards.
`WholeValue` reparses substituted components with its retained grammar. The engine
defaults invalid winners and CSS-wide results, and caches pending shorthand
expansions only for the current element/query. No serialized text is needed by
ordinary computation. Recognition of `attr`, `env`, `if`, `inherit`, `ident`, `random-item`,
and dashed custom functions does not establish their validation/replacement.
[if()](substitution/if.ts) has argument grammar support, with media/style-query
conditions still TODO; its replacement tests are existing expected failures.

## Registered syntax

[SyntaxValue](syntax-value.ts) parses universal syntax, named types,
identifiers, alternatives, and `+`/`#` lists. Its `createParser()` compiles the
registered grammar. Parsed scalar values are concrete value classes, without a
second type dispatcher. SyntaxListValue retains its items and separator kind,
preserving its identity when resolution leaves every item unchanged. Universal
syntax directly uses OptionalDeclarationValue for its possibly empty component
list. Both own their resolution and serialization. Transform type names are accepted
in syntax definitions, but creating their value consumer explicitly throws as unfinished.

For a known registration, compile its ordinary parser once with `syntax.createParser()`
and call `WholeValue.parse(input, context, parseOrdinary, true)`.
It retains ordinary raw input without consulting that grammar's dependencies
before Computed, then checks registered syntax
and resolves supported values; syntax failure becomes GuaranteedInvalidValue.
This does not implement `CSS.registerProperty()`, inheritance, `var()`, or
computed-time fallback. The [engine inventory](../engine/README.md#registration-lookup)
explains the separate registration lookup and fixture-based tests.

Unregistered declarations instead retain generic components and, when available,
original text in [interpreted-declaration.ts](../cssom/declarations/interpreted-declaration.ts). They do not use a registered
type's resolver merely because their tokens resemble a number, URL, or color.

## Reusable resolution

| Mechanism | Existing behavior and boundary |
| --- | --- |
| [Numeric literals](numeric-literal/) | Typed numbers/dimensions and unit conversion. Length resolution accepts explicit font, viewport, container, and axis references; it can report that a reference is unavailable. |
| [Math values](math-value.ts) | Calculation trees, type checks, simplification, numeric operations, stage/range handling, and context-dependent resolution. Serialization walks the retained representation. |
| [Lengths](length.ts) and [length-percentages](length-percentage.ts) | Combine literals/math and resolve when stage/context permit. Missing references can leave a value unresolved; `BuiltInProperty.resolve()` supplies property-specific percentage timing. |
| [Opacity](opacity-value.ts) | Converts percentages to number values during resolution and clamps at Computed or later. This is one connected example from the installed registry. |
| [URLs](url.ts) | Retains notation/modifiers, captures local-fragment tree scope when supplied from Specified onward, and resolves other nonempty URLs from Computed onward using the URL subsystem and contextual base. It does not fetch resources. |
| Type-specific combination methods | `Value` exposes optional `interpolate()`, `add()`, and `accumulate()` methods with their natural arguments. Property records call these methods directly and own category dispatch and discrete fallback. Missing operations throw when requested. There is no connected animation engine. |

The broad [PropertyContext](../props/base-property.ts) combines value-helper inputs.
The current engine supplies only URL/base/tree information. Standalone tests
can supply font or percentage facts that an actual style query does not yet
provide. Neither those tests nor the Used/Actual enum entries imply a layout
pipeline.

These classes are internal values, not CSSStyleValue/CSSUnitValue Platform objects.
Typed OM reification and property maps remain separate CSSOM implementation
work. The [lifecycle contracts](../value-processing/README.md) explain the
resolution/serialization boundary.

## Property-family helpers

| Helper | Existing representation/operation | Current limit |
| --- | --- | --- |
| [Colors](color.ts) | Named/absolute/contextual colors, relative colors, color mixing and conversion/interpolation helpers; caller-supplied palettes, scheme and profiles | The engine delivers a host palette or fixed light defaults. Per-element scheme selection, profiles, and output integration remain unfinished; generic currentColor handling does not supply each property's own rule. |
| [Images](image.ts) | ImageValue is a URL or gradient, with resolution delegated to those helpers. | No image(), image-set(), cross-fade(), element() or paint() value implementation, fetching, decoding or natural-size delivery. |
| [Gradients](gradient.ts) | Linear/radial/conic and repeating forms, stops and interpolation; explicit used-value preparation accepts gradient-box geometry. | Explicit preparation can return null when stage/facts are insufficient. Interpolation still throws for cases including cross-fade fallback, repeating-stop alignment and missing required percentage bases. No rasterization. |
| [Positions](position.ts) | Position grammar and stage-aware resolution, including CSS writing-mode/direction inputs for logical positions | Does not choose a property's reference rectangle or image size. |
| [BoxSides](box-sides.ts) | A four-item physical-side tuple introduced for HTML lazy loading | A provisional type, not shorthand expansion or layout. |
| [Supports conditions](supports-condition.ts), [media queries](media-query.ts), and [boolean expressions](boolean-expr.ts) | Shared condition grammars and nodes with their own evaluation or resolution; if() reuses the supports parser | Query-value resolution is distinct from capability checks, device matching, and stylesheet participation; see the [condition roadmap](../conditional/ROADMAP.md). |

The [property registry inventory](../props/README.md) records the seven installed
built-ins and unregistered animation-name parser. Additional generic types do
not register background images, fonts, transforms, or layout properties.
The [value roadmap](ROADMAP.md#context-inputs-and-freshness) names the required
inputs and their owners without inventing a combined layout interface.

## Evidence

The [cascade and value baseline](../README.md#cascade-and-values) covers engine queries,
numeric/math values, syntax strings, registered-value helpers, first-valid,
if grammar, and the general value suite. Existing skips cover registration
defaulting/substitution, registered transforms, and unfinished animation-name
parsing. Seven expected failures cover unfinished if replacement.

The [property and condition baseline](../README.md#properties-and-conditions) adds color, gradient,
image, position, mix, media/boolean/supports and property suites: 958 passing
tests. These are direct mechanism tests, not resource, rendering, or complete
property-family conformance tests.
