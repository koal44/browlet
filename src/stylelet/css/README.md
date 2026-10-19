# Interpreted CSS and declaration data

This folder recognizes CSS rules and property declarations after structural
parsing. It holds the installed property registry and the current declaration
storage. These records are distinct from CSSOM implementations and their
eventual Platform objects. The [roadmap](ROADMAP.md) records missing rule
contracts and state-ownership questions.

## Current path

1. [parseStylesheet()](stylesheet.ts) calls the
   [syntax parser](../syntax/parser.ts), then interprets its records.
2. A valid top-level qualified rule becomes a `StyleRule` with parsed selectors
   and a `StyleBlock`. Invalid selector lists discard the rule.
3. [interpretPropertyDeclaration()](property.ts) recognizes installed built-in
   properties and custom properties. Unknown properties and invalid values are
   discarded without invalidating their containing rule.
4. [CSSStyleSheetImpl](../cssom/css-stylesheet.ts) retains the interpreted sheet
   and builds CSSOM rule implementations. The
   [cascade](../engine/cascade.ts) reads interpreted rules directly.

| Representation | Current contents |
| --- | --- |
| `InterpretedStyleSheet` | Ordered rules, optional location/base URL, and retained source text |
| `StyleRule` | A parsed selector list and mixed block of property declarations/nested style rules |
| `PropertyDeclaration` | Name, importance, and parsed value; built-in names preserve their registry/value type relationship |
| `PropertyRule` | A custom-property registration record type; no stylesheet parser or CSSOM rule construction currently produces it |
| [CSSDeclarationBlock](declaration-block.ts) | Current declaration data, order, serialization, and mutation container; ownership remains under CSSOM review |

Built-in names are ASCII-lowercased during interpretation and values enter the
declared stage. Custom-property names retain case and their component values
remain available for later substitution; original value text can be retained.
The installed built-ins are color/background-color, opacity, and four margin
longhands. Broader value parsers do not register additional properties.

## Rule support stops at different layers

| Construct | Interpreter | CSSOM / engine consequence |
| --- | --- | --- |
| Ordinary style rule | Retained | Declaration edits and top-level matching exist; selector/rule serialization and mutation are incomplete. |
| Nested style rule | Retained recursively; implicit `&` and parent-dependent specificity are represented | Selector tests can match it directly, but CSSOM child lists are not populated and the cascade does not visit nested rules. |
| Declarations after a nested rule | Kept in mixed source order, but syntax declaration runs are flattened into individual entries | No `CSSNestedDeclarations` representation; CSSOM currently collects all direct declarations into the parent's `.style`. |
| Statement/block at-rules | Discarded at both top level and nested level | No `@namespace`, import, conditional, layer, scope, or descriptor-rule participation follows from structural parsing. |
| `@charset` in parsed CSS | Discarded | Intentional: encoding detection recognizes its initial byte pattern; it is not a CSS rule needing an implementation. |

Namespace support currently requires explicitly supplied selector-parser
context. Stylesheet interpretation neither processes `@namespace` nor supplies
that context. Likewise, the declaration-based condition grammar in
[conditional/supports.ts](../conditional/supports.ts) is not an implemented
`@supports` rule or projected `CSS.supports()` API.

## Mutation and participation

`CSSStyleRuleImpl` copies direct declarations into its current declaration
block. Its change callback replaces the interpreted block with declarations.
That arrangement needs review together with nested-rule preservation and the
future `CSSStyleProperties` owner; passing simple-rule tests does not settle it.
See the [CSSOM mutation work](../cssom/ROADMAP.md#rule-mutation-ownership).

The cascade currently filters disabled sheets and matches top-level style
rules. It compares importance, matching specificity, and appearance order for
supported declarations. It does not traverse nested rules or evaluate group
conditions, layers, or `@scope`. The [engine roadmap](../engine/ROADMAP.md)
owns full cascade participation and evaluation.

## Evidence and next work

The [stylesheet tests](../../../test/stylelet/unit/css/stylesheet.test.ts) cover
interpretation, invalid/unknown input, declaration ordering, retained custom
values, and recursive nested-selector binding. The
[matcher tests](../../../test/stylelet/unit/selector/match.test.ts) exercise
nested selectors independently of engine traversal. Both passed in the
[syntax and selector baseline](../README.md#syntax-rules-and-selectors).

The [roadmap](ROADMAP.md) maps missing rules to their specifications and owners.
End-to-end nesting and complete rule conformance remain unverified.
