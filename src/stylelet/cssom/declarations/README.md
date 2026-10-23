# CSSOM declarations

This folder owns interpreted declarations, their collection, CSSStyleDeclaration
and CSSStyleProperties, and their Web IDL declarations. Rules, sheets, and inline
styles consume this lower-level object family.

## Current state and mutation

[CSSDeclarationBlock](declaration-block.ts) stores interpreted
`InterpretedDeclaration` values and their importance/order. It can parse text,
set/remove declarations, and serialize the retained data. It has no DOM owner,
environment, or CSSOM identity. Supported built-ins come from the small
[property registry](../../props/registry.ts); custom-property token values are stored
separately from built-in value representations.

The collection remains a class because it owns ordered replacement, mutation,
and serialization shared by inline and CSSOM consumers. It is not another
Platform implementation or a second declaration tree. Keeping this collection
separate lets accepted inline data exist before `.style` is requested.

[CSSStyleDeclarationImpl](style-declaration.ts) exposes either an authored block
or the engine's [ComputedStyle](../../engine/computed-style.ts) collection.
Computed data contains existing property definitions and whole values, without
creating interpreted declarations. Authored-only `declarations` and
`getDeclaration()` expose no occurrences for computed results; `computedStyle`
provides internal access to their retained values.
`CSSStylePropertiesImpl` adds the projected subtype identity; supported property
attributes declared beside the implementation forward to
`getPropertyValue()`/`setProperty()` through Binding.
Neither implementation installs numeric or property-name accessors.

[InterpretedDeclaration](interpreted-declaration.ts) implements §6.5's record as a class:
a retained named property record, an interpreted value, and importance. Its `name`
and `custom` accessors forward to that record without storing duplicate state.
Property records own value resolution and serialization; the declaration retains
its lazy serialization cache and adds the name and priority to complete declaration text.
Built-in value instances retain their grammar/lifecycle representation rather
than turning back into a generic component list.

`InterpretedDeclaration.interpret()` applies the registered property grammar to one Syntax
`SyntaxDeclaration`. It returns one custom/built-in declaration or multiple longhands
for a shorthand, and returns null for an unsupported name or invalid value.
`InterpretedDeclaration.parseBlock()` collects these results in source order. Rule-list
interpretation calls the same operation while Syntax consumes a rule block.
`PropertyContext` carries value inputs without rule-interpretation hooks.
Built-in names are ASCII-lowercased; custom names retain case, exclude the
reserved `--`, and retain components and original text for later substitution.
Custom spelling comes from the value's retained token-list source spans. The
interpreted declaration reads and caches that spelling only on a serialization request.
An empty custom value serializes as one space in a property query, while a
missing property returns the empty string. The complete empty declaration still
serializes as `--name: ;`.
The declaration is an internal instance, not a Platform implementation; descriptor
interpretation remains unfinished with its owning rule families.

Each occurrence owns `serializeValue()`, `serialize()`, and `hasDifferentMapping()`.
Value resolution belongs to property records and whole values, leaving the source
occurrence unchanged. Retained values and nested payloads must not be mutated:
CSSOM replaces declaration occurrences instead.
Serialization only describes the current representation; `serializeValue()` lazily
caches its result for subsequent equality checks and property queries.
`serializeValue()` supplies CSSOM property queries; `serialize()` produces the
complete declaration, including its name, priority, and semicolon. Shorthand
output uses the same static `serializeText()` formatter without creating a
temporary declaration or serialized record. Custom-property records substitute
opaque components using the supplied context. Registered computation remains unfinished.

The class stores its property record, value, and importance directly. Its exported instance
union preserves narrowing by custom status and by each registered property name.

`setProperty()` parses its value independently of the decoded property name.
Custom names may contain characters that require escaping when placed in CSS
text; their lookup and `item()` spelling remains unchanged. The reserved `--`
name is rejected. Empty values remove declarations before priority validation.

There are three current uses of declaration state:

| Use | Data and change path |
| --- | --- |
| Inline style | Browlet's permanent element mixin retains a block and lazily creates the declaration object around it. Attribute input changes the block; CSSOM writes serialize back to the owner with an updating flag. |
| Style-rule declarations | Each style or nested-declarations rule owns its declaration object. The engine reads that object's parsed declarations directly; edits do not replace child rules or synchronize a second tree. |
| Computed result | The engine fills a ComputedStyle collection and exposes it through a readonly CSSOM object. The collection is a snapshot with no element attachment or update mechanism. |

Construction itself does not read an owner's attribute. A standalone host
attaching to an existing element explicitly delivers its attribute through
`attributeChanged()`. Browlet delivers additions/changes through its mixin and
checks CSP there. Its `.style` getter does not reread raw input. This preserves
accepted declarations after a blocked replacement and avoids a second parsing
path on first access.

Binding reads supported indices from the current authored or computed collection. Attribute input
therefore needs no `synchronizeIndices()` call or block observer to update the
already-retained Platform object.

## Shorthand boundary

[Property metadata](../../props/shorthand.ts) supplies canonical longhands and
their expansion/serialization operations. The block handles preferred shorthand
selection, complete/equal-priority checks, and logical-group ordering. Properties
identify their logical group and physical/logical mapping in their own records;
only physical margins are currently registered.

The block's shorthand method follows the current CSSOM
[shorthand-form algorithm](https://drafts.csswg.org/cssom/#serialize-into-a-shorthand-form).
The local CSSWG and Houdini references were refreshed on 2026-10-21 to
`3110cd02e` and `954df53`, respectively. The updated declaration-list parsing
entry point and non-ASCII identifier serialization rule already matched our
implementation; the shorthand loop now follows the extracted algorithm.

Ordinary margin assignment expands one through four values or a CSS-wide keyword.
The property record returns values in canonical longhand order; interpreted
declarations supply their names and importance. Complete compatible sets shorten
to one through four components. Incomplete, mixed-priority, mixed CSS-wide, or
independently deferred longhands return an empty shorthand query and remain
separate in block text. Pending margin longhands retain their original shorthand
occurrence; a complete compatible set serializes that original value, while each
pending longhand serializes empty text. Replacing a pending occurrence always
updates its sides rather than comparing those empty serializations. The
[shorthand account](../../props/ROADMAP.md#shorthand-substitution-handoff)
records computation and remaining dependencies. The [roadmap](ROADMAP.md) accounts for §6.7's other
value-family dependencies and browser choices.

Declared substitutions use their retained source spelling, including number
spelling and interior whitespace, in both longhand and shorthand queries.
Computing a value does not rewrite its declaration. Replacing a declaration with
different spelling also replaces its lazy serialization cache, even when the
tokens represent the same numbers. A complete pending longhand set reconstructs
its original shorthand; a partially overwritten set cannot reconstruct that
shorthand and exposes the required empty pending longhands instead. Source
preservation also retains missing EOF delimiters, so it does not promise that
appending further declarations to the serialized text will preserve their parsing.

The export-only [barrel](index.ts) is the entry point for declaration consumers.
Shared property contracts, concrete grammars, and registries live in
[props/](../../props/README.md). Parent-rule references here are type-only;
declarations do not construct rules or sheets.

[Projected regressions](../../../../test/browlet/style/declarations.test.ts) cover
name/value separation, escaping, priority, readonly behavior, and Binding.
[Collection tests](../../../../test/stylelet/unit/cssom/declarations/style-declaration.test.ts)
cover shared state, ordinary/pending margins, and the unfinished first-valid boundary.
[Margin contracts](../../../../test/stylelet/margin.contracts.ts) cover inline
styles, rules, mutation, and shortening through projected CSSOM. The matching browser
scenarios assert Browlet before applying any native expected-failure annotation.
