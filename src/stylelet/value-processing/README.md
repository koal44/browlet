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
optional `custom` flag selects registered-property handling in WholeValueDefinition.
It has no initial/inherited-property metadata or generic interpolation method.
When used as a property grammar, its consumer prepares the Declared
representation, including normalization appropriate at that stage. The
whole-value parser does not call its resolver again to finish ordinary parsing.

## Where the stages are used

| Stage | Current connection and limit |
| --- | --- |
| Declared | Property parsing validates ordinary values and prepares their Declared representation through the grammar's consumer. Deferred values retain their later dependencies; no element state is available. |
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
through [WholeValueDefinition](../values/whole-value.ts) to a concrete ValueDefinition.
[computeStyle()](../engine/computed-style.ts) selects declarations and requests
Computed resolution. Syntax records, WholeValue, and numeric/color records are
internal representations, not CSSStyleValue Platform objects.

WholeValue is retained data. Its property definition supplies the operations,
while each call supplies the stage and context. Raw components, deferred
alternatives, CSS-wide keywords, and guaranteed-invalid values remain distinct.
Raw whole values now mean registered syntax awaiting Computed-time validation,
not ordinary built-in values whose initial interpretation is unfinished.
Removing per-value methods does not implement the missing defaulting,
substitution, dependency tracking, or Used/Actual orchestration.

The consume/resolve/serialize split supports the project's lifecycle rule:
serialization describes an already-established value. Parsing owns initial
grammar interpretation and Declared preparation; later resolution owns unit or
color conversion, dependency evaluation, normalization, rounding, and clamping
at their proper stages. A serialization requirement that needs a new value is
a reason to review the resolver or representation first.

The [property](../props/ROADMAP.md) and [value](../values/ROADMAP.md) roadmaps
track contextual resolution and serializer audits. [Typed OM](../cssom/typed/ROADMAP.md)
owns reification and public views; [animation](../../animation/ROADMAP.md) owns
the effect lifecycle that will consume value combination.
