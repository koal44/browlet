# CSS property definitions

This folder supplies property-specific grammars and value processing.
The [roadmap](ROADMAP.md) groups missing
families and their dependencies.

## Installed definitions

The [registry](../css/property.ts) installs exactly seven built-in names:

| Definition | Registered names | Current behavior |
| --- | --- | --- |
| [color.ts](color.ts) | `color`, `background-color` | Both use the shared color grammar/resolver through `defineProperty()`. They do not yet carry separate initial/inheritance metadata or property-specific currentColor rules. |
| [margin.ts](margin.ts) | `margin-top`, `margin-right`, `margin-bottom`, `margin-left` | Each accepts length-percentage or auto. Resolution preserves auto and delegates numeric values to the shared resolver. No margin shorthand or logical longhands are registered. |
| [opacity.ts](opacity.ts) | `opacity` | Uses the opacity value definition, including percentage conversion and computed-stage clamping. |

[animation-name.ts](animation-name.ts) separately parses and serializes lists
of none, custom identifiers, or strings. It is **not registered** and has no
connected animation effect. Its five existing parser cases remain skipped in
the general value suite.

## How a definition participates

`defineProperty()` adapts a reusable ValueDefinition to the whole-value forms
described in the [value inventory](../values/README.md). It does not install the
property or provide defaulting, inheritance, shorthand expansion, applicability,
or a layout effect.

Property interpretation looks up built-in names in the registry and rejects
unknown built-ins. Custom properties use a separate token-preserving path.
The [computed-style routine](../engine/computed-style.ts) also iterates the
registry; adding a generic value parser alone does not extend this inventory.

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

The [property and condition baseline](../README.md#properties-and-conditions) includes the 15 existing
property tests and the relevant value/condition suites. The property tests
exercise whole-value definitions and registry typing, not all seven properties'
complete CSSOM, inheritance, or used-value behavior. The earlier
[engine baseline](../README.md#cascade-and-values) covers the connected query path.
