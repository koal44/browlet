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

[CSSStyleDeclarationImpl](style-declaration.ts) holds a block and supplies CSSOM operations.
`CSSStylePropertiesImpl` adds the projected subtype identity; supported property
attributes declared beside the implementation forward to
`getPropertyValue()`/`setProperty()` through Binding.
Neither implementation installs numeric or property-name accessors.

[InterpretedDeclaration](interpreted-declaration.ts) implements §6.5's record as a class: normalized built-in names or
case-sensitive custom names, an interpreted value, and importance. Its `custom`
discriminant supplies the case distinction; it needs no second case flag.
Built-in value instances retain their grammar/lifecycle representation rather
than turning back into a generic component list.

`InterpretedDeclaration.interpret()` applies the registered property grammar to one Syntax
`Declaration`. It returns one custom/built-in declaration or multiple longhands
for a shorthand, and returns null for an unsupported name or invalid value.
`InterpretedDeclaration.parseBlock()` collects these results in source order. Rule-list
interpretation calls the same operation while Syntax consumes a rule block.
`PropertyContext` carries value inputs without rule-interpretation hooks.
Built-in names are ASCII-lowercased; custom names retain case, exclude the
reserved `--`, and retain components and original text for later substitution.
Custom spelling comes from the value's retained token-list source spans; the
interpreted declaration does not store a separate copy of that text.
An empty custom value serializes as one space in a property query, while a
missing property returns the empty string. The complete empty declaration still
serializes as `--name: ;`.
The declaration is an internal instance, not a Platform implementation; descriptor
interpretation remains unfinished with its owning rule families.

Each occurrence owns `resolve()`, `serializeValue()`, `serialize()`, and
`hasDifferentMapping()`. Resolution creates a separate occurrence with the
resolved value; serialization only describes the current representation.
`serializeValue()` supplies CSSOM property queries; `serialize()` produces the
complete declaration, including its name, priority, and semicolon. Shorthand
output uses the same static `serializeText()` formatter without creating a
temporary declaration or serialized record. Custom values remain opaque;
calling their resolver does not implement variable substitution or registration.

The class stores its name, value, and importance directly. Its exported instance
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
| Computed result | The engine creates a separate block and readonly/computed declaration object for each query. The object contains a snapshot and has no owner node or update mechanism. |

Construction itself does not read an owner's attribute. A standalone host
attaching to an existing element explicitly delivers its attribute through
`attributeChanged()`. Browlet delivers additions/changes through its mixin and
checks CSP there. Its `.style` getter does not reread raw input. This preserves
accepted declarations after a blocked replacement and avoids a second parsing
path on first access.

Binding reads supported indices from the current declarations. Attribute input
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

Margin's mapping is present, but its expansion, pending-substitution representation,
and value serialization explicitly throw as unfinished. Thus incomplete or
mixed-priority margin longhands can be queried/removed together, but assigning
`margin`, querying its complete value, or serializing a compatible complete set
of margin longhands stops at that dependency. This is not working shorthand
support. The [roadmap](ROADMAP.md) records the next property work and browser choices.

The export-only [barrel](index.ts) is the entry point for declaration consumers.
Shared property contracts, concrete grammars, and registries live in
[props/](../../props/README.md). Parent-rule references here are type-only;
declarations do not construct rules or sheets.

[Projected regressions](../../../../test/browlet/style/declarations.test.ts) cover
name/value separation, escaping, priority, readonly behavior, and Binding.
[Collection tests](../../../../test/stylelet/unit/cssom/declarations/style-declaration.test.ts)
cover shared state and the explicit shorthand boundary. The matching browser
scenarios assert Browlet before applying any native expected-failure annotation.
