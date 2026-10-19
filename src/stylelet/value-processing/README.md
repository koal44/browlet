# Value-processing contracts

This folder currently contains two shared definitions. It is not yet a pipeline that
assigns all properties to an element. The [roadmap](ROADMAP.md) separates that
missing orchestration from the working [value algorithms](../values/README.md).

## Current definitions

[ValueStage](stage.ts) names Declared, Cascaded, Specified, Computed, Used, and
Actual in lifecycle order. Resolvers compare those enum values to decide when
to simplify, convert, clamp, or retain a dependency. The enum does not track
which stages a value has passed through or whether all required facts exist.

[ValueDefinition](definition.ts) supplies a component consumer, a resolver
taking `(value, stage, context)`, and a serializer taking only the value. Its
optional `custom` flag selects registered-property handling in WholeValue.
It has no initial/inherited-property metadata or generic interpolation method.

## Where the stages are used

| Stage | Current connection and limit |
| --- | --- |
| Declared | Built-in declaration interpretation parses and resolves at this stage. Context-free normalization can happen here; no element state is available. |
| Cascaded | The engine chooses a declaration; the enum value alone does not represent cascade origin, layer, or rollback candidates. |
| Specified | Value helpers accept this stage, for example to capture a local URL's tree scope. There is no engine defaulting pass. |
| Computed | The engine invokes selected built-in resolvers here. Individual helpers also support typed registered values, math, units, and URLs when their context is supplied. |
| Used / Actual | Resolvers can receive these stages in direct calls. There is no connected layout/device processing path establishing these values for elements. |

These names follow [Cascade's value stages](https://drafts.csswg.org/css-cascade-5/#value-stages).
A computed value may intentionally retain a percentage or calculation; whether
it is resolved at this stage belongs to the property, not just the numeric type.
CSSOM's **resolved value** is a separate query contract, sometimes requiring
used-value facts. It is not another enum entry or a synonym for Computed.

## Ownership and serialization

The current call chain runs from [property interpretation](../css/property.ts)
through [WholeValue](../values/whole-value.ts) to a concrete ValueDefinition.
[computeStyle()](../engine/computed-style.ts) selects declarations and requests
Computed resolution. Syntax records, WholeValue, and numeric/color records are
internal representations, not CSSStyleValue Platform objects.

The consume/resolve/serialize split supports the project's lifecycle rule:
serialization describes an already-established value. Resolution owns unit or
color conversion, dependency evaluation, normalization, rounding, and clamping
at their proper stages. A serialization requirement that needs a new value is
a reason to review the resolver or representation first.

The [property](../props/ROADMAP.md) and [value](../values/ROADMAP.md) roadmaps
track contextual resolution and serializer audits. [Typed OM](../cssom/typed/ROADMAP.md)
owns reification and public views; [animation](../../animation/ROADMAP.md) owns
the effect lifecycle that will consume value combination.
