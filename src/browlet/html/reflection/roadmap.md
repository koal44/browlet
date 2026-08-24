# HTML reflection roadmap

HTML §2.6, “Common DOM interfaces”, defines the reusable algorithms by which
IDL attributes reflect content attributes. This directory should own those
algorithms; individual element classes should only select a reflection form.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `content-attribute.ts` | Basic DOMString and nullable reflection | HTML §2.6.1 |
| `boolean.ts` | Content-attribute presence reflection over the shared boolean microsyntax | HTML §§2.3.2 and 2.6.1 |
| `enumerated.ts` | Reflection adapter over shared enumerated state and canonical-keyword algorithms | HTML §§2.3.3 and 2.6.1 |
| `numbers.ts` | Signed, unsigned, limited, ranged, defaulted, and floating-point reflection over shared numeric parsing | HTML §§2.3.4 and 2.6.1 |
| `url.ts` | URL-valued reflection against the element's node document | HTML §2.6 and URL parsing hooks |
| `element-reference.ts` | Element and element-array reflection | HTML §2.6 |
| `extended-attributes.ts` | Bind `[Reflect]`, `[ReflectSetter]`, `[ReflectURL]`, numeric reflection attributes, `[ReflectRange]`, and `[ReflectDefault]` to the correct reflection form | HTML §2.6.2 |

Some reflected members require `[CEReactions]`; the reflection helper must
enter the custom-element reaction machinery rather than invoking it ad hoc in
each setter.

The reusable boolean, enumerated, and numeric value algorithms live in
`html/microsyntaxes/`. This directory owns only their connection to element
content attributes and Web IDL members.

Blink distributes reflection helpers between generated bindings and
`core/html` element utilities. Browlet's declarative Web IDL can keep the
selection metadata near declarations while these semantic algorithms remain
HTML-owned.

## Removal condition

Burn this file when all reflection forms used by implemented elements share
these algorithms and have observable tests.
