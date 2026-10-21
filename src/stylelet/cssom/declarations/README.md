# CSSOM declarations

This folder owns CSSStyleDeclaration and CSSStyleProperties, their Web IDL
declarations, and the provisional declaration-block storage they share with
inline styles. Rules and sheets consume this lower-level object family.

## Current state and mutation

[CSSDeclarationBlock](declaration-block.ts) stores interpreted
`PropertyDeclaration` values and their importance/order. It can parse text,
set/remove declarations, and serialize the retained data. It has no DOM owner,
environment, or CSSOM identity. Supported built-ins come from the small
[property registry](../../props/property.ts); custom-property token values are stored
separately from built-in value representations.

This separate class is provisional, including its role as the inline mixin's
retained state. The [declaration audit](ROADMAP.md#declaration-state-and-lifecycle)
must resolve its representation and ownership before CSSOM review closes.

`CSSStyleDeclarationImpl` holds a block and supplies CSSOM operations.
`CSSStylePropertiesImpl` adds the projected subtype identity; supported property
attributes declared beside the implementation forward to
`getPropertyValue()`/`setProperty()` through Binding.
Neither implementation installs numeric or property-name accessors.

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

The export-only [barrel](index.ts) is the entry point for declaration consumers.
Property records, the registry, and declaration interpretation live in
[props/](../../props/README.md). Parent-rule references here are type-only;
declarations do not construct rules or sheets. The [roadmap](ROADMAP.md) keeps
the storage and mutation review explicit.
