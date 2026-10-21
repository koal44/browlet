# CSS conditions

This folder records the planned condition evaluation and applicability work.
It has no implementation yet. Shared supports, media, and boolean-expression
grammars live in `values/`; the [roadmap](ROADMAP.md) owns missing evaluation
and consumer connections.

## Existing machinery in other owners

| Entry point | Current behavior | Limit |
| --- | --- | --- |
| [supports-condition.ts](../values/supports-condition.ts) | Parses declaration tests, grouping, not/and/or, and general-enclosed syntax into BooleanExprValue; reused by the if() grammar. | No supports evaluator connects these tests to the property/selector implementation. SupportsContext declares an optional declaration callback, not an installed capability checker. |
| [boolean-expr.ts](../values/boolean-expr.ts) | Parses generic tests and short-circuits boolean evaluation through caller-supplied test results. It propagates unknown internally and, unless requested otherwise, converts a final unknown result to false. | This helper does not choose the leaf semantics of supports, media, or container queries. Those contracts differ. |
| [media-query.ts](../values/media-query.ts) | Parses types, modifiers, boolean/range features, lists and conditions; serializes query records. Invalid list entries become not all. | Feature names are strings, not a complete inventory of supported device features. |
| `resolveMediaQuery()` | Resolves value components using ValueStage/MathContext and returns a MediaQuery. | Despite its name, it does not answer whether the query matches a device/document. |
| [MediaListImpl](../cssom/media/media-list.ts) | Retains parsed media queries and exposes list mutation/serialization. | Retaining a media list does not evaluate stylesheet applicability. |

There is no container-query implementation. The
[CSSOM rule list](../cssom/rule-list.ts) reaches explicit missing-grammar methods for
conditional at-rules, and
`CascadeEngine.getActiveStyleSheets()` filters the disabled flag without media
matching. CSSOM rule declarations/types therefore do not establish engine
participation.

`StyleletEnvironment` currently supplies execution, DOM operations, URL
construction and text decoding. It does not supply device preferences,
viewport measurements or container-layout facts. Those future inputs are
listed in the [condition roadmap](ROADMAP.md#media-matching).

## Evidence

The [property and condition baseline](../README.md#properties-and-conditions) includes 10 supports
parser tests, 52 media-query tests, and 39 generic boolean-expression tests.
They exercise grammar, representation/serialization, value resolution and
generic truth operations. They do not establish media matching, supports
capability decisions, container queries, or conditional stylesheet activation.
