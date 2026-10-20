# CSS properties

This folder supplies shared property records, their metadata, and value processing.
The [roadmap](ROADMAP.md) groups missing
families and their dependencies.

## Installed properties

The [registry](../css/property.ts) installs exactly seven built-in names:

| Module | Registered names | Current behavior |
| --- | --- | --- |
| [color.ts](color.ts) | `color`, `background-color` | Shared color value definition. Color inherits and starts at symbolic CanvasText; background-color does not inherit and starts at transparent. Property-specific currentColor rules remain unfinished. |
| [margin.ts](margin.ts) | `margin-top`, `margin-right`, `margin-bottom`, `margin-left` | Each starts at zero, does not inherit, and accepts length-percentage or auto. Resolution preserves auto and delegates numeric values to the shared resolver. No shorthand or logical longhands are registered. |
| [opacity.ts](opacity.ts) | `opacity` | Starts at one and does not inherit. Its value definition handles percentage conversion and computed-stage clamping. |

[animation-name.ts](animation-name.ts) separately parses and serializes lists
of none, custom identifiers, or strings. It is **not registered** and has no
connected animation effect. Its five existing parser cases remain skipped in
the general value suite.

## How a property participates

`defineWholeValue()` adapts a reusable ValueDefinition to the whole-value forms
described in the [value inventory](../values/README.md). It does not install the
property or provide defaulting, inheritance, shorthand expansion, applicability,
or a layout effect.

The resulting constants use `WholeValueDef` names, such as `colorWholeValueDef`,
because they describe reusable value behavior. Different property records can
share one of these definitions.

Each `PropertyRecord` pairs `definition` with `inherits` and a
typed `initialValue`; its registry key supplies the name. The family modules
create these records once. Initial values are shared Declared representations,
not CSS strings to parse or per-element computed values. Resolution leaves them
unchanged and receives the current context, including the system palette.

Property interpretation looks up built-in names in the registry and rejects
unknown built-ins, then uses the record's `definition` for parsing,
resolution, and serialization. Custom properties use a separate token-preserving path.
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
in [values/](../values/README.md#property-family-helpers). Property interpretation
and declaration storage live in `css/`; selection and computation live in
`engine/`. The provisional BoxSides tuple supplies physical-side typing, not a
shorthand parser or a box model.

## Evidence

The [property tests](../../../test/stylelet/unit/property.test.ts) cover all
seven initial/inheritance records, shared color grammar, contextual resolution
without changing the shared initial value, and registry/value typing. They do
not establish complete CSSOM, inheritance, or used-value behavior. The
[engine baseline](../README.md#cascade-and-values) covers the connected query path.
