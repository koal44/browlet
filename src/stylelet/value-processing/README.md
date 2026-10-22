# Value processing

This folder currently defines lifecycle stages. It is not yet a pipeline that
assigns all properties to an element. The [roadmap](ROADMAP.md) separates that
missing orchestration from the working [value algorithms](../values/README.md).

## Current contracts

[Value](../values/value.ts), owned by the values folder, is the instance contract:
`resolve(stage, context)` returns a value and `serialize()` describes its current
representation. Each class keeps its own context type; contexts are supplied per
invocation, not stored in the value. Parsing and consuming are static factories.
Configured grammars can additionally provide `createConsumer(options)`.
Static signatures differ where a grammar needs configuration, such as MathValue's
expected numeric type; they are not forced into the instance interface.

Numeric literals, ordinary values, WholeValue, and the opaque component-list values
implement this contract. Their public `value` field holds the magnitude or
representation. Dimension literals also retain their unit directly. Resolution
can replace a representation or return a different value type; the contract does
not require the parser's exact result type to survive every stage. Opaque values
and identifiers retain their identity when there is no contextual work to perform.
The [value roadmap](../values/ROADMAP.md#value-classes) records the migration scope.

[ValueStage](stage.ts) names Declared, Cascaded, Specified, Computed, Used, and
Actual in lifecycle order. Resolvers compare those enum values to decide when
to simplify, convert, clamp, or retain a dependency. The enum does not track
which stages a value has passed through or whether all required facts exist.

Property grammars prepare the Declared representation, including normalization
appropriate at that stage. The whole-value parser does not call a resolver again
to finish ordinary parsing. There is no separate definition object dispatching
resolution or serialization. Initial values and inheritance remain property metadata.

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

The current call chain runs from [property interpretation](../props/property.ts)
through [WholeValue](../values/whole-value.ts) to a concrete value class.
[computeStyle()](../engine/computed-style.ts) selects declarations and requests
Computed resolution. Syntax records, WholeValue, and numeric/color values are
internal representations, not CSSStyleValue Platform objects.

WholeValue retains its consuming parser for deferred reparsing,
while each resolution call supplies the stage and context. Raw components, deferred
alternatives, CSS-wide keywords, and guaranteed-invalid values remain distinct.
Raw whole values now mean registered syntax awaiting Computed-time validation,
not ordinary built-in values whose initial interpretation is unfinished.
Migrating ownership of these methods does not implement the missing defaulting,
substitution, dependency tracking, or Used/Actual orchestration.

RawWholeValue, FirstValidValue, and SubstitutionValue are notation payloads whose
property-dependent resolution belongs to WholeValue. IfValue and IfArguments
describe conditional grammars; they do not pretend to implement substitution.
These grammar objects are distinct from independently resolvable values.

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
