# Property declarations and storage

This folder recognizes property declarations, holds the installed property
registry, and provides the current declaration storage. Stylesheet and rule
state belongs to the [CSSOM implementations](../cssom/README.md); there is no
separate interpreted stylesheet tree.

## Current representations

| Representation | Responsibility |
| --- | --- |
| `PropertyDeclaration` | Name, importance, and parsed value; built-in names preserve their registry/value type relationship |
| `CustomPropertyRegistration` | Syntax, inheritance, definition, and initial value used by registration lookup; author registration and `@property` parsing remain unfinished |
| [CSSDeclarationBlock](declaration-block.ts) | Declaration order, lookup, text parsing/serialization, and mutation; shared by the inline owner and its current CSSOM object |

[interpretPropertyDeclarations()](property.ts) interprets syntax declarations
in source order through `interpretPropertyDeclaration()`, which recognizes
installed built-ins and custom properties. The declaration-block and CSSOM
parsers share this step; see the [parsing pipeline](../README.md#parsing-and-object-construction).
Unknown properties and invalid values are discarded without invalidating their
containing rule. Built-in names are ASCII-lowercased;
custom names retain case and their component values remain available for later
substitution. Custom values can retain original text.

The installed built-ins are color/background-color, opacity, and four margin
longhands. Broader value parsers do not register additional properties.

## Consumers and boundaries

[CSSOM's parser](../cssom/parser.ts) converts generic syntax records directly
into rule implementations, using this folder for property interpretation.
Nested style rules and later declaration runs retain their own implementations;
the engine reads their current declaration data without copying it back to a
second tree. See the [CSSOM inventory](../cssom/README.md#rule-parsing).

The separate declaration block is still under review alongside
`CSSStyleDeclaration` and the missing `CSSStyleProperties` implementation.
It currently stores one declaration list, not a synchronized duplicate.
Its shared inline ownership and the mixin's manual index synchronization are
the next ownership questions; see the [CSSOM roadmap](../cssom/ROADMAP.md).

The [rule roadmap](ROADMAP.md) maps unfinished grammars and their consumers.
[Rule construction tests](../../../test/stylelet/unit/cssom/parser.test.ts)
cover invalid/unknown input, declaration ordering, retained custom values,
and recursive nested-selector binding. End-to-end nesting, all rule grammars,
and complete CSSOM conformance remain unfinished.
