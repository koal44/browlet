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

`BuiltInProperty.parse()` applies the record's ordinary grammar through
`WholeValue.parse()`, including the whole-value forms described in the
[value inventory](../values/README.md). Parsing does not install the property or
provide defaulting, inheritance, shorthand expansion, applicability, or a layout effect.

Different property records can share one ordinary grammar, such as `ColorValue.parse`.
`BuiltInProperty.resolve(value, stage, context)` supplies the property's percentage
reference before delegating to the value's resolver. Values own their calculations
and serialization; the record does not perform layout or mutate the context.

[BuiltInProperty](builtin-property.ts) and [CustomProperty](custom-property.ts)
extend [BaseProperty](base-property.ts), which owns their shared metadata and
operation contracts, percentage-context selection, and animation-category guard.
Each subclass implements interpolation, addition, and accumulation directly.
Interpreted declarations retain their property through resolution and
delegate value serialization to it. Both kinds retain `WholeValue` instances.
Custom records retain their declaration components as `RawWholeValue` until
computation, then use WholeValue's substitution and whole-value notation handling.
Their serializer preserves source spelling. Their
default inheritance, initial value, and animation category come from Variables 1.
`PropertyContext` includes `RegistryContext`, whose `customPropertyRegistry` holds
the effective registrations for computation. Records never capture a document's
registration during declaration parsing.
Registered computation still throws explicitly until that lifecycle is implemented.

The [registry module](registry.ts) owns both registry types and custom registrations.
The built-in object retains the exact type for each supported property name; the
custom `Map` holds document-specific registrations that can change. A custom
property exists without a registration. `CustomPropertyRegistration` overrides
the Variables 1 defaults; it is not a second built-in definition table.

Each `BuiltInProperty` takes one `BuiltInPropertyDefinition` object containing its `name` and ordinary
parser, `inherits`, typed `initialValue`, `appliesTo`, `animationType`, `percentages`, and `resolvedValueStage`.
These fields are required; the registry retains the named record. The family
modules create these records once, supplying an ordinary initial value. The record
retains that value in a `WholeValue` with its grammar, as it does for already-parsed
shorthand components. It also constructs pending shorthand longhands.
Initial values are shared Declared representations,
not CSS strings to parse or per-element computed values. Resolution leaves them
unchanged and receives the current context, including the system palette.
An optional `logicalGroup` records the family name and physical/logical mapping
used by CSSOM's declaration ordering rules.

## Property definition tables

Read the defining table together with its normative prose. These entries do not
all describe work performed by the same subsystem:

| Table entry | Current representation and remaining work |
| --- | --- |
| Value | The ordinary `parse` function supplies the grammar; `WholeValue` adds CSS-wide and deferred notation. |
| Initial | Required ordinary `initialValue`, retained with the property's parser. Engine defaulting consumes it. |
| Applies to | Required `appliesTo(context): boolean`. Colors and opacity have all-element rules; custom properties also apply to every pseudo-element. Margin throws until box classification is available. |
| Inherited | Required `inherits`; the full Cascade review still owns the remaining inheritance/defaulting rules. |
| Percentages | Required `percentages`: `not-applicable` for N/A, `number` (100% maps to 1 in the value grammar), or a contextual reference callback with its earliest resolution stage. |
| Computed value | Value instances own `resolve()`. Property-specific rules and complete computation still need review; supplying a generic value resolver does not establish conformance. |
| Canonical order | Grammar and serializers own value ordering; shorthand longhands have explicit canonical order. No additional metadata field yet. |
| Animation type | Required `animationType`: not animatable, discrete, by computed value, repeatable list, or typed property-specific interpolation/addition/accumulation methods. Property operations dispatch these rules; repeatable lists and effect sampling/composition remain unfinished. |

`appliesTo` records the [property-definition applicability rule](https://drafts.csswg.org/css-cascade-5/#applies-to).
A false result does not prevent parsing, cascading, or computing a value; that value
can still be inherited. Missing target facts must throw rather than imply false.
The context does not yet supply box classification or pseudo-element identity, and
the engine does not consume this rule. Built-in all-element rules do not establish
pseudo-element support: the pseudo's permitted-property rules still need integration.
Custom properties explicitly apply even to pseudos with restricted property lists.

`resolvedValueStage` separately records [CSSOM's resolved-value rule](https://drafts.csswg.org/cssom/#resolved-values)
for `getComputedStyle()`. It is Computed or Used, or a selector receiving the computed
whole value and property context. Color properties select Used; opacity and custom
properties select Computed. Margin selects Used only when it applies and resolved
`display` is neither `none` nor `contents`, otherwise Computed. Its selector currently
throws explicitly because applicability and display inputs are not available.
The engine does not consume this metadata yet. Its computed-value cache and inheritance
must remain at Computed; CSSOM's later query pass will select the exposed stage.
The metadata does not certify a representation or supply missing resolution inputs.

The animation categories come from [Web Animations](https://drafts.csswg.org/web-animations-1/#animating-properties).
All currently installed built-ins combine by computed value.
[CustomProperty](custom-property.ts) supplies the [Variables 1](https://drafts.csswg.org/css-variables-1/#defining-variables)
defaults, including discrete animation, while registered syntax can change that behavior.
Unregistered custom values combine discretely; registered animation still throws
until registered computation and syntax-specific combination are implemented.

`BaseProperty.interpolate(from, to, progress, context)`, `.add(underlying, effect, context)`,
and `.accumulate(underlying, effect, context)` accept and return `WholeValue` instances.
Custom properties select one complete operand for their discrete behavior.
`null` means a not-animatable property contributes nothing. These operations
do not parse, resolve, clamp, or mutate their operands. Resolve the final result
after the complete composition sequence to apply property limits; an opacity
above one can still be brought back into range by a later contribution.

For by-computed-value animation, the property calls `WholeValue.interpolate()`,
`add()`, or `accumulate()`. WholeValue delegates to its contained value and retains
the result through `withValue()`, preserving the grammar and registration state.
Concrete values retain their existing operand contracts; the property does not
compare constructors. A `null` result requests the property's discrete fallback.
The installed opacity and margin numeric branches are connected. Margin's own
animation rules select discrete fallback whenever either operand is `auto` and
otherwise call the length-percentage operations. Colors interpolate resolved
absolute coordinates and are not additive, so addition
and accumulation retain the second operand. Symbolic `currentColor` interpolation
needs further representation/property work and throws explicitly. Margins retain
percentages through combination until Used-stage resolution supplies their basis.
An unconnected value type throws rather than silently behaving discretely.

`PropertyAnimation<W>` supplies three typed methods: `interpolate(from, to, progress, context)`,
`add(underlying, effect, context)`, and `accumulate(underlying, effect, context)`.
Only interpolation receives progress. Each property method calls the matching
property-specific or whole-value operation. Callbacks receive complete `W` operands
and return a `W` result or `null` for an incompatible pair. BuiltInProperty passes
these values through without unwrapping or rewrapping them. Margin's callbacks
inspect the inner values for `auto`, combine compatible numeric values, and retain
the result with `WholeValue.withValue()`. The property applies discrete interpolation
or selects the second operand for addition/accumulation when a callback returns
`null`. Unfinished implementations must throw instead.
Timing and effect composition remain outside these methods. Property-specific
specification links stay in code comments alongside the implementation.

Type parameter `O` names the ordinary value accepted by the property's grammar.
`BuiltInPropertyValue<O>` includes parsed and resolved representations,
without claiming that a particular lifecycle stage has already been reached.
Built-in animation results follow the corresponding `WholeValue` operation's return
type, independently of resolution. `BaseProperty` uses `W` for the whole-value
family accepted and returned by resolution. Its animation results can contain
any `Value`; concrete property classes retain the more specific result types.
BaseProperty and BuiltInProperty put the value parameter before the property name.
`N` names a property name and `P` a property record; each module explains its
short parameter names near the imports. Bare `WholeValue` means `WholeValue<Value>`;
specific value families remain typed as `WholeValue<O>`.
Properties and whole values receive `PropertyContext` directly; concrete values
can keep their narrower context contracts.

`BuiltInProperty.resolve()` supplies the existing `MathContext.percentageReferenceValue`
input at the property's required stage. For the four physical margins, the callback
reads `containingBlockInlineSize` from [LayoutContext](../value-processing/layout-context.ts),
the containing block's logical width in CSS px, only at Used or later. For example, `calc(10% + 2px)` remains
unresolved at Computed and becomes `22px` with a 200px reference at Used.
An unavailable size preserves the percentage rather than inventing zero.
The record clears unrelated percentage references locally and leaves the caller's
context unchanged. It does not perform layout or compute the containing block.

Cascade computation uses the record's resolving method.
Layout does not yet supply containing-block sizes or drive a Used-stage pass;
direct tests supply those facts. More complex percentage rules, such as different
references for components of a position, must retain their value-specific contexts
rather than use one scalar for everything.
Opacity's percentage conversion already belongs to its value grammar and needs
no contextual reference. `color` and `background-color` have N/A in their tables;
that does not prevent percentages inside a color function such as `rgb()`.

## Shorthands and consumers

[Shorthand](shorthand.ts) owns declaration validation, CSS-wide expansion,
pending substitution, and shared serialization checks. Families supply ordinary
parsing and shortening, plus named longhand records in canonical order.
[MarginShorthand](built-in/margin.ts) expands one through four values into
top/right/bottom/left values and shortens compatible sides.
The separate [registry](shorthand-registry.ts) derives the reverse longhand
lookup once, in CSSOM's preferred shorthand order. The property and shorthand
classes sit below the built-in families; `Shorthand` imports the supplied record's
type, and neither class loads the registry. Families never load their collector.
CSSOM creates declaration
occurrences retaining those records and the original importance; the property layer
does not construct declarations. Compatible longhands serialize to the shortest
one-to-four-value form without resolving them. Unitless margin zero becomes a
`0px` length during parsing. Variable-containing margins retain a shared shorthand
occurrence until computed-time substitution and expansion; overwritten sides
participate independently in the cascade. `first-valid()` shorthand selection
remains unfinished; see the [shorthand account](ROADMAP.md#shorthand-substitution-handoff).

Property interpretation looks up built-in names in the registry and rejects
unknown built-ins, then uses the record's parser. Later processing calls the
value's resolution and serialization methods. Custom properties keep opaque
components inside the same whole-value lifecycle. The engine unwraps computed
custom values only when supplying the component lookup used by substitution;
the lookup still distinguishes valid empty components from guaranteed-invalid values.
The [computed-style query](../engine/cascade-engine.ts) also iterates the
registry; adding a generic value parser alone does not extend this inventory.
Engine defaulting and inheritance consume this metadata for the installed names; see
the [remaining lifecycle work](../engine/ROADMAP.md#defaulting-and-per-element-values).

The engine currently supplies URL/base/tree context and the host system-color palette.
It does not populate the font, viewport, container, currentColor, or geometry fields accepted by the shared
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
seven initial/inheritance records, shared color grammar, stage-aware margin
percentage references (including unavailable and zero sizes), contextual resolution
without changing the shared initial value, and registry/value typing. They do
not establish complete CSSOM, inheritance, or used-value behavior. The
[animation-operation tests](../../../test/stylelet/unit/props/animation.test.ts)
cover pure combinations, discrete fallback, source retention, unclamped intermediate
opacity, and explicit missing dependencies. They do not establish an animation engine. The
[engine baseline](../README.md#cascade-and-values) covers the connected query path.
