# CSS syntax roadmap

The [README](README.md) records current entry points. The remaining work follows
[CSS Syntax 3](https://drafts.csswg.org/css-syntax-3/) input, parser-entry,
block-context, stylesheet-interpretation and serialization contracts through
their consumers. Individual tokenization/recovery steps still need review.

## Work at the syntax boundary

- [ ] Audit each public parser against its precise entry algorithm: complete
  consumption, empty input, malformed recovery, nested delimiters, and string
  versus existing-token input. Preserve separate whole-sheet, single-rule,
  mixed-block, and declaration-only contracts.
- [ ] Complete the parser's existing grammar/context validation TODO. Follow
  [block-content grammars](https://drafts.csswg.org/css-syntax-3/#block-contents):
  a style rule, `@font-face`, `@page`, and `@keyframes` accept different kinds
  of content despite sharing structural parsing. Coordinate with the
  [rule roadmap](../css/ROADMAP.md), without inventing a second property registry.
- [ ] Preserve declaration-run boundaries and source order through nesting.
  Review the existing trailing-declaration flush note against the selected
  draft and retain its recovery tests; do not lose the final run at EOF/`}`.
- [ ] Finish the byte-input consumer when the loader is implemented: response
  encoding, BOM handling, imported-sheet environment encoding, and final URL
  provenance. Keep the independently tested decoder reusable; string parser
  success is not evidence that fetching is connected.
- [ ] Review retained source/range behavior for comments, escapes, replacement
  characters, custom properties, and token-array input. State which paths retain
  spelling and which serialize tokens; no source-editor contract is implied.
- [ ] Check token-boundary round trips and CSSOM identifier/string requirements
  using [Syntax serialization](https://drafts.csswg.org/css-syntax-3/#serialization)
  and [CSSOM idioms](https://drafts.csswg.org/cssom/#common-serializing-idioms).
  Property value resolution belongs to the value lifecycle, not this serializer.

## Adjacent work

Selector grammar, namespace/nesting context, and parser-to-matcher coverage are
tracked in the [selector roadmap](../selector/ROADMAP.md). The supported-rule
inventory and contextual rule validation belong to [css/](../css/ROADMAP.md).
The [value](../values/ROADMAP.md) and [lifecycle](../value-processing/ROADMAP.md)
owners handle property grammars and declared/computed values.

Keep `SPEC_CLASH(css-style-attribute-parsing)` and its existing browser evidence
with the [style-attribute consumer](../../browlet/style/ROADMAP.md). The mixed
block parser is not a drop-in replacement for the reviewed attribute path.

## Verification when implementation resumes

Use the owning syntax test for a parser change, plus the actual consumer:
stylesheet interpretation, CSSOM insertion, declaration input, or selector
matching. Add a failing regression before fixing a suspected discrepancy.
The [syntax and selector baseline](../README.md#syntax-rules-and-selectors) records current evidence;
it does not establish coverage of every Syntax algorithm.
