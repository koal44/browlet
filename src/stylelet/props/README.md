# CSS properties

This folder supplies shared property contracts and registries. The `built-in/`
folder supplies concrete property grammars, metadata, and property-specific value
processing. Interpreted occurrences belong to [CSSOM declarations](../cssom/declarations/README.md).
The [roadmap](ROADMAP.md) groups missing
families and their dependencies.

## Installed properties

The [longhand registry](registry.ts) installs seven built-in names:

| Module | Registered names | Current behavior |
| --- | --- | --- |
| [color.ts](built-in/color.ts) | `color`, `background-color` | Shared color parser. Color inherits and starts at symbolic CanvasText; background-color does not inherit and starts at transparent. Property-specific currentColor rules remain unfinished. |
| [margin.ts](built-in/margin.ts) | `margin-top`, `margin-right`, `margin-bottom`, `margin-left` | Each starts at zero, does not inherit, and accepts length-percentage or auto. Resolution preserves auto and delegates numeric values to the shared resolver. All belong to the physical margin group; logical longhands remain absent. |
| [opacity.ts](built-in/opacity.ts) | `opacity` | Starts at one and does not inherit. OpacityValue handles percentage conversion and computed-stage clamping. |

[animation-name.ts](built-in/animation-name.ts) separately parses and serializes lists
of none, custom identifiers, or strings. It is **not registered** and has no
connected animation effect. Its five existing parser cases remain skipped in
the general value suite.

## How a property participates

`WholeValue.createParser()` adapts an ordinary value parser to the whole-value forms
described in the [value inventory](../values/README.md). It does not install the
property or provide defaulting, inheritance, shorthand expansion, applicability,
or a layout effect.

Different property records can share one parser, such as `parseColorProperty`.
The parsed values own resolution and serialization; no definition dispatch is
needed to call either operation.

Each `PropertyRecord` pairs `parse` with `inherits` and a
typed `initialValue`; its registry key supplies the name. The family modules
create these records once. Initial values are shared Declared representations,
not CSS strings to parse or per-element computed values. Resolution leaves them
unchanged and receives the current context, including the system palette.
An optional `logicalGroup` records the family name and physical/logical mapping
used by CSSOM's declaration ordering rules.

[Shorthand records](shorthand.ts) separately identify canonical longhands and
family-owned expansion/serialization. Margin expands one through four values or
a CSS-wide keyword into top/right/bottom/left values. CSSOM creates declaration
occurrences with those names and the original importance; the property layer
does not construct declarations. Compatible longhands serialize to the shortest
one-to-four-value form without resolving them. Unitless margin zero becomes a
`0px` length during parsing. Deferred margin syntax, including arbitrary
substitution and `first-valid()`, still throws at an explicit unfinished boundary;
see the [substitution handoff](ROADMAP.md#shorthand-substitution-handoff).

Property interpretation looks up built-in names in the registry and rejects
unknown built-ins, then uses the record's parser. Later processing calls the
value's resolution and serialization methods. Custom properties use a separate token-preserving path.
The [computed-style routine](../engine/computed-style.ts) also iterates the
registry; adding a generic value parser alone does not extend this inventory.
Engine defaulting and inheritance do not yet consume the new metadata; see
the [remaining lifecycle work](../engine/ROADMAP.md#defaulting-and-per-element-values).

The engine currently supplies URL/base/tree context. It does not populate the
font, viewport, container, color, or geometry fields accepted by the shared
value helpers. Direct tests can supply those facts independently; see
[value inputs](../values/ROADMAP.md#context-inputs-and-freshness).

## Existing foundations outside this folder

Reusable color, image/gradient, position, math, and numeric-unit machinery lives
in [values/](../values/README.md#property-family-helpers). Declaration interpretation,
records, and shared declaration storage live in
[cssom/declarations/](../cssom/declarations/README.md); selection and computation
live in `engine/`. The provisional BoxSides tuple supplies physical-side typing, not a
shorthand parser or a box model.

## Evidence

The [property tests](../../../test/stylelet/unit/props/property.test.ts) cover all
seven initial/inheritance records, shared color grammar, contextual resolution
without changing the shared initial value, and registry/value typing. They do
not establish complete CSSOM, inheritance, or used-value behavior. The
[engine baseline](../README.md#cascade-and-values) covers the connected query path.
