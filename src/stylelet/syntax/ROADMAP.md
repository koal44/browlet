# CSS syntax roadmap

The [README](README.md) records current entry points. The remaining work follows
[CSS Syntax 3](https://drafts.csswg.org/css-syntax-3/) input, parser-entry,
block-context, stylesheet-interpretation and serialization contracts through
their consumers. The Syntax sections through serialization and security/privacy
have been audited. Context dispatch is connected; the remaining work belongs to
rule-specific grammars, loading, and the consuming value/API specifications.

## Work at the syntax boundary

- [ ] Implement the rule list's throwing at-rule interpretation
  dependencies. Syntax reaches them through RuleListContext while consuming, with the enclosing context,
  prelude, and earlier siblings. Each block supplies its declaration/rule grammar
  and final validity check. Follow
  [block-content grammars](https://drafts.csswg.org/css-syntax-3/#block-contents):
  a style rule, `@font-face`, `@page`, and `@keyframes` accept different kinds
  of content despite sharing structural parsing. Coordinate with the
  [rule roadmap](../cssom/rules/ROADMAP.md), without inventing a second property registry.
- [ ] Preserve declaration-run boundaries when adding group/descriptor rules.
  The style-rule interpreter now waits for a surviving child before ending a
  run; retain that behavior when supporting additional rule grammars.
- [ ] Supply document encoding when HTML starts inline-sheet imports. Fetched sheets
  now retain `getStylesheetEncoding()`'s effective encoding, using Encoding's
  BOM detection and the existing decoder. [Browlet's DocumentImpl](../../browlet/dom/nodes/document.ts)
  also preserves the final response URL for child imports; automatic HTML startup remains separate.
- [ ] Validate `unicode-range` in its owning descriptor grammar. The Syntax
  [entry algorithm](https://drafts.csswg.org/css-syntax-3/#consume-unicode-range-value)
  already retokenizes retained source, including prebuilt component blocks
  and the complete segment before priority/whitespace removal. Token lists require
  source; do not substitute serialized tokens for the original spelling.
  Bounds, reversed ranges, and priority acceptance belong
  to the unfinished font descriptor consumer.
- [x] Audit custom-property serialization against CSS Variables together with
  Values 5 Appendix A; see the [accounting](../values/ROADMAP.md#variables-1-and-values-5-appendix-a-audit).
- [x] Retain declaration-value character boundaries through priority removal,
  including boundary and comment-only comments. TokenList owns the outer bounds;
  parsing supplies the initial cursor position, including for empty block contents.
- [x] Preserve those value boundaries through replacements and fallback selection,
  including spread arguments that select part of a computed replacement. Slicing
  retains comment-only values at EOF without exposing ranges to fallback consumers.
- [ ] Complete CSSOM's author-string conversion and CSS.escape binding review.
  The Syntax serializer now covers token-boundary/numeric round trips; revisit
  the identifier conflict below when defining the projected CSS.escape contract.
  Property value resolution belongs to the value lifecycle, not serialization.

## Parser disagreements

`SPEC_CLASH(css-style-rule-block-grammar)` retains mixed declaration/nested-rule
parsing. [§7.1](https://drafts.csswg.org/css-syntax-3/#block-contents) assigns
`<block-contents>` to style rules, but [§8.1](https://drafts.csswg.org/css-syntax-3/#style-rules)
still says `<declaration-list>`, immediately followed by instructions for nested
qualified rules. Follow §7.1 and [CSS Nesting](https://drafts.csswg.org/css-nesting-1/).
Existing CSSOM and browser nesting regressions preserve this choice.

`SPEC_CLASH(css-invalid-rule-declaration-runs)` follows the browsers: discarded
nested rules and at-rules do not split declaration runs. The literal
[block algorithm](https://drafts.csswg.org/css-syntax-3/#consume-block-contents)
splits on an invalid-rule error and before parsing an at-rule. Open
[CSSWG issue #11271](https://github.com/w3c/csswg-drafts/issues/11271) records both
cases. Chromium, Firefox and WebKit were checked with an invalid `& + {}` and
an unknown `@unknown;`, both before and after a valid nested rule. All merge
the surrounding declarations. CSSOM unit tests and an enabled browser regression
retain the chosen behavior. Blink's `CSSParserImpl::ConsumeBlockContents` and
Gecko's `StyleRuleParser` likewise flush declaration runs only for surviving
rules. This boundary was deliberately specified in
[April 2024](https://github.com/w3c/csswg-drafts/commit/e5547b96f5de6fb5a68d050f42d562c448b99d0b),
with the aim of stable grouping as new rule syntax gains support. Our choice is
browser compatibility, not a claim that the written rule is accidental or stale.
Revisit if the issue resolves differently.

`SPEC_CLASH(css-block-final-declarations)` retains the final declaration run
at EOF or a closing brace. The draft's return step currently omits that flush,
which would lose even a declaration-only block. The surrounding declaration
placement rules and all three browsers retain it. Syntax recovery and CSSOM
consumer tests cover both EOF and brace termination.

`SPEC_CLASH(css-custom-property-boundary-comments)` records the approved choice to follow
[CSS Variables serialization](https://drafts.csswg.org/css-variables-1/#serializing-custom-props)
by retaining comments outside the first/last token and values containing only
comments. Declared and computed values preserve these boundaries through priority
removal, copying, substitution, and fallback selection. Replacement lists own their
source bounds; spread selection also keeps a replacement's comment-only tail.

The 2026-10-22 browser probe found that, for `--x:/**/red/**/;`, Chromium 149.0.7827.55
and WebKit 26.5 return `red`, while Firefox 151.0 returns `red/**/`. All three return
an empty string for `--x:/*only*/;`. Declared values, computed values, and references
through `var()` show the same difference. The target results are `/**/red/**/` and
`/*only*/`; the browser comparisons have separately approved expected failures.

Substitution also retains comments exposed by empty replacements; see
`SPEC_CLASH(custom-property-substitution-comments)` in the
[Values roadmap](../values/ROADMAP.md).

## Identifier serialization disagreement

`SPEC_CLASH(css-non-ascii-ident-serialization)` follows Syntax's
[non-ASCII identifier ranges](https://drafts.csswg.org/css-syntax-3/#non-ascii-ident-code-point)
and [round-trip requirement](https://drafts.csswg.org/css-syntax-3/#serialization).
[CSSOM's identifier serializer](https://drafts.csswg.org/cssom/#serialize-an-identifier)
now uses those same ranges; the 2026-10-21 reference refresh removed the earlier
specification disagreement. For example, U+0080, U+00A0, U+00D7 and U+200E need
escapes under Syntax's grammar. Our tokenizer keeps that grammar;
identifier/name serialization escapes excluded characters using
the same range predicate. Strings are unaffected.

Chromium 149.0.7827.55, Firefox 151.0 and WebKit 26.5 were checked on 2026-10-19:
all accept these literal characters as identifiers, emit them literally from
CSS.escape, and remove the escapes from selectorText. Unit regressions exercise
identifier, at-keyword, hash, function-name and dimension-unit round trips.
The enabled [browser regression](../../../test/stylelet/scenarios/syntax.test.ts)
checks that Stylelet's escaped selectors still select the intended elements in
all three engines. The separate native-only spelling probes retain the Syntax
expectations as expected failures and return to their idle skipped state.

## Adjacent work

Selector grammar, namespace/nesting context, and parser-to-matcher coverage are
tracked in the [selector roadmap](../selector/ROADMAP.md). The supported-rule
inventory and contextual rule validation belong to [CSSOM rules](../cssom/rules/ROADMAP.md).
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
