# CSS values

This folder holds reusable value grammars, internal representations, resolution,
and serialization. The [roadmap](ROADMAP.md) records missing
behavior. Parser breadth is not installed-property support.

## Whole values and definitions

[whole-value.ts](whole-value.ts) adapts a
[ValueDefinition](../value-processing/definition.ts) to a shared
WholeValueDefinition. The definition owns parsing, resolution,
and serialization; each WholeValue retains only data, without lifecycle
methods, a definition reference, or a context type parameter.

`definition.parse(input, context)` returns a value ready to retain in a
declaration, or null for invalid ordinary property syntax. It reads generic
declaration syntax through `parseOptionalDeclarationValue`, then applies the
property's grammar. The grammar's consumer prepares its Declared representation;
callers do not need a second Declared-stage resolution to finish parsing.
Existing component lists enter the same path without being tokenized again.

Later callers use `definition.resolve(value, stage, context)` and
`definition.serialize(value)`. Resolution returns a value, including explicit
GuaranteedInvalidValue where appropriate; null belongs to initial parse rejection.
Built-in declarations select the definition by
property name; registered custom properties retain it in their registration.
Keep that association when carrying values into later processing: an ordinary
value alone does not identify its property's grammar or defaulting rules.

The main representations are:

| Representation | Current role |
| --- | --- |
| RawWholeValue | Retains registered custom-property components without trying the registered grammar before Computed. |
| OrdinaryWholeValue | Holds a concrete parsed value; its shared definition delegates resolution/serialization to the underlying ValueDefinition. |
| CssWideValue | Recognizes `initial`, `inherit`, `unset`, `revert`, and `revert-layer`; resolution currently returns the keyword unchanged. |
| SubstitutionValue | Retains a value containing a recognized arbitrary-substitution function. Before Computed it remains unresolved; at Computed replacement throws as unimplemented. |
| FirstValidValue | Retains alternatives before Computed; the property definition then tries its parser/resolver for each until one succeeds. It is not independent of the substitution/defaulting gaps. |
| GuaranteedInvalidValue | Represents invalidity distinctly from an ordinary value; serializes as an empty string. It does not perform registration or property fallback. |

Resolution receives the requested stage and current context on every call.
Parsing recognizes CSS-wide keywords, first-valid alternatives, and substitution
values while leaving their deferred dependencies intact. Later resolution
interprets deferred syntax when due; serialization never advances a value's stage.

[substitution-value.ts](substitution-value.ts) recognizes `var`, `attr`, `env`,
`if`, `inherit`, `random-item`, and dashed custom-function names, including in
nested blocks. This is detection, not validation/replacement of those functions.
[if()](substitution/if.ts) has argument grammar support, with media/style-query
conditions still TODO; its replacement tests are existing expected failures.

## Registered syntax

[syntax-value.ts](syntax-value.ts) parses universal syntax, named types,
identifiers, alternatives, and `+`/`#` lists. Parsed typed values are resolved
and serialized through their individual definitions; lists retain their items
and separator kind. Transform type names are accepted in syntax definitions,
but creating their value consumer explicitly throws as unfinished.

`defineCustomWholeValue()` supplies a grammar wrapper for a known registration.
It retains ordinary raw input without consulting that grammar's dependencies
before Computed, then checks registered syntax
and resolves supported values; syntax failure becomes GuaranteedInvalidValue.
This does not implement `CSS.registerProperty()`, inheritance, `var()`, or
computed-time fallback. The [engine inventory](../engine/README.md#registration-lookup)
explains the separate registration lookup and fixture-based tests.

Unregistered declarations instead retain generic components and, when available,
original text in [property.ts](../css/property.ts). They do not use a registered
type's resolver merely because their tokens resemble a number, URL, or color.

## Reusable resolution

| Mechanism | Existing behavior and boundary |
| --- | --- |
| [Numeric literals](numeric-literal/) | Typed numbers/dimensions and unit conversion. Length resolution accepts explicit font, viewport, container, and axis references; it can report that a reference is unavailable. |
| [Math values](math-value.ts) | Calculation trees, type checks, simplification, numeric operations, stage/range handling, and context-dependent resolution. Serialization walks the retained representation. |
| [Lengths](length.ts) and [length-percentages](length-percentage.ts) | Combine literals/math and resolve when stage/context permit. Missing references can leave a value unresolved; the caller must supply property-specific percentage timing. |
| [Opacity](opacity-value.ts) | Converts percentages to number values during resolution and clamps at Computed or later. This is one connected example from the installed registry. |
| [URLs](url.ts) | Retains notation/modifiers, captures local-fragment tree scope when supplied from Specified onward, and resolves other nonempty URLs from Computed onward using the host URL constructor/base. It does not fetch resources. |
| Type-specific combination functions | Number, dimension, math, color, and other helpers offer operations such as interpolation. There is no generic ValueDefinition interpolation dispatcher or connected animation engine. |

The broad [PropertyContext](../css/property.ts) combines value-helper inputs.
The current engine supplies only URL/base/tree information. Standalone tests
can supply font or percentage facts that an actual style query does not yet
provide. Neither those tests nor the Used/Actual enum entries imply a layout
pipeline.

These records are internal values, not CSSStyleValue/CSSUnitValue objects.
Typed OM reification and property maps remain separate CSSOM implementation
work. The [lifecycle contracts](../value-processing/README.md) explain the
resolution/serialization boundary.

## Property-family helpers

| Helper | Existing representation/operation | Current limit |
| --- | --- | --- |
| [Colors](color.ts) | Named/absolute/contextual colors, relative colors, color mixing and conversion/interpolation helpers; caller-supplied palettes, scheme and profiles | Contextual colors can remain unresolved without inputs. Generic currentColor handling does not supply each property's own rule. No engine-delivered palette/profile or output pipeline is established. |
| [Images](image.ts) | ImageValue is a URL or gradient, with resolution delegated to those helpers. | No image(), image-set(), cross-fade(), element() or paint() value implementation, fetching, decoding or natural-size delivery. |
| [Gradients](gradient.ts) | Linear/radial/conic and repeating forms, stops and interpolation; explicit used-value preparation accepts gradient-box geometry. | Explicit preparation can return null when stage/facts are insufficient. Interpolation still throws for cases including cross-fade fallback, repeating-stop alignment and missing required percentage bases. No rasterization. |
| [Positions](position.ts) | Position grammar and stage-aware resolution, including CSS writing-mode/direction inputs for logical positions | Does not choose a property's reference rectangle or image size. |
| [BoxSides](box-sides.ts) | A four-item physical-side tuple introduced for HTML lazy loading | A provisional type, not shorthand expansion or layout. |
| [Supports conditions](supports-condition.ts), [media queries](media-query.ts), and [boolean expressions](boolean-expr.ts) | Shared condition grammars, records, and generic boolean evaluation; if() reuses the supports parser | Query-value resolution is distinct from capability checks, device matching, and stylesheet participation; see the [condition roadmap](../conditional/ROADMAP.md). |

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
