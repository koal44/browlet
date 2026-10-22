# CSSOM declarations

This folder owns CSSStyleDeclaration and CSSStyleProperties, their Web IDL
declarations, and the declaration collection they share with
inline styles. Rules and sheets consume this lower-level object family.

## Current state and mutation

[CSSDeclarationBlock](declaration-block.ts) stores interpreted
`PropertyDeclaration` values and their importance/order. It can parse text,
set/remove declarations, and serialize the retained data. It has no DOM owner,
environment, or CSSOM identity. Supported built-ins come from the small
[property registry](../../props/property.ts); custom-property token values are stored
separately from built-in value representations.

The collection remains a class because it owns ordered replacement, mutation,
and serialization shared by inline and CSSOM consumers. It is not another
Platform implementation or a second declaration tree. Keeping this collection
separate lets accepted inline data exist before `.style` is requested.

`CSSStyleDeclarationImpl` holds a block and supplies CSSOM operations.
`CSSStylePropertiesImpl` adds the projected subtype identity; supported property
attributes declared beside the implementation forward to
`getPropertyValue()`/`setProperty()` through Binding.
Neither implementation installs numeric or property-name accessors.

`PropertyDeclaration` implements §6.5's record: normalized built-in names or
case-sensitive custom names, an interpreted value, and importance. Its `custom`
discriminant supplies the case distinction; it needs no second case flag.
Built-in value instances retain their grammar/lifecycle representation rather
than turning back into a generic component list.

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

Margin's mapping is present, but its expansion, pending-substitution representation,
and value serialization explicitly throw as unfinished. Thus incomplete or
mixed-priority margin longhands can be queried/removed together, but assigning
`margin`, querying its complete value, or serializing a compatible complete set
of margin longhands stops at that dependency. This is not working shorthand
support. The [roadmap](ROADMAP.md) records the next property work and browser choices.

The export-only [barrel](index.ts) is the entry point for declaration consumers.
Property records, the registry, and declaration interpretation live in
[props/](../../props/README.md). Parent-rule references here are type-only;
declarations do not construct rules or sheets.

[Projected regressions](../../../../test/browlet/style/declarations.test.ts) cover
name/value separation, escaping, priority, readonly behavior, and Binding.
[Collection tests](../../../../test/stylelet/unit/cssom/declarations/declaration.test.ts)
cover shared state and the explicit shorthand boundary. The matching browser
scenarios assert Browlet before applying any native expected-failure annotation.
