# CSS syntax

This folder turns CSS input into tokens, component values, and syntax records.
Selector parsing, property recognition, deciding which rules apply, and exposing
CSSOM objects belong to later layers.

The [roadmap](ROADMAP.md) records missing consumer connections and remaining
algorithm checks. Existing parser coverage does not establish complete Syntax
conformance.

## Input and representations

| Stage | Existing implementation | Result / boundary |
| --- | --- | --- |
| Bytes | [tokens.ts](tokens.ts), `decodeStylesheetBytes()` | Chooses a fallback from transport metadata, the initial `@charset` byte sequence, environment encoding, then UTF-8; the supplied decoder handles decoding, including BOM precedence. Callers decode before using the string parser. |
| Code points and tokens | `filterCodePoints()`, `tokenize()`, `tokenizeWithSource()` | CSS newline/replacement preprocessing and tokens; the source-aware path also supplies ranges for retained text. |
| Components | [parser.ts](parser.ts), [component-value.ts](component-value.ts) | Preserved tokens, nested blocks, and functions. These are syntax, not resolved CSS values. |
| Stylesheet contents | `parseStylesheetContents()` | `Rule[]` containing qualified/at-rule records. An at-rule record does not establish support for that rule. |
| Block syntax | `parseBlockContents()` | Declaration runs interleaved with rules. This preserves the structural distinction needed by nesting. |
| CSS rule construction | [CSSOM parser](../cssom/parser.ts) | Recognizes selectors/properties and constructs rule implementations directly; see the [rule inventory](../cssom/README.md#rule-parsing). |

`ParserInput` is currently a string or token array, not a byte stream. Token
inputs can reuse earlier tokenization; string inputs take the preprocessing
path. Decoding exists independently of the unfinished external-sheet loader.

Records use the specification's plain names: `Rule`, `QualifiedRule`, `AtRule`,
and `Declaration`. The syntax folder identifies their stage; `CSSRuleImpl` and
`PropertyDeclaration` identify the later interpreted results.

There is no separate syntax stylesheet container. The specification's
[parse a stylesheet](https://drafts.csswg.org/css-syntax-3/#parse-stylesheet)
operation spans contents parsing here and sheet creation in CSSOM. Callers use
`parseCSSRules()` to interpret the contents and `CSSStyleSheetImpl` to own the
resulting rules and location.

## Choosing an entry point

- `parseRule()` expects one complete rule; CSSOM `insertRule()` uses it before
  interpreting that rule. Whole-sheet parsing has different recovery behavior.
- `parseDeclarationList()` is the declaration-only path used for style
  attributes and CSSOM declaration text. It consumes and discards at-rules.
  It is deliberately distinct from mixed block contents; the existing
  `SPEC_CLASH(css-style-attribute-parsing)` remains documented in
  [Browlet's style roadmap](../../browlet/style/ROADMAP.md).
- `parseDeclaration()`, component-value/list parsers, and the comma-separated
  component parser serve narrower grammars. `parseAsComponentGrammar()` and
  `parseListAsComponentGrammar()` require their selected grammar to consume the
  input apart from permitted trivia.
- [component-grammar.ts](component-grammar.ts),
  [component-consumers.ts](component-consumers.ts), and
  [token-cursor.ts](token-cursor.ts) provide the common grammar machinery.
  [any-value.ts](any-value.ts) and [declaration-value.ts](declaration-value.ts)
  enforce their respective component restrictions.

The parser has an explicit TODO for grammar/context validation in rule and
declaration consumption. Its current structural recovery must not be mistaken
for validation of every rule's permitted contents or placement.

## Selectors and serialization

[selector/parser.ts](../selector/parser.ts) builds typed selector records, resolves supplied
namespace prefixes, calculates specificity, binds nested selectors to their
parent selector lists, and serializes them. Invalid forgiving-list arms can
retain syntax without becoming matching selectors. The
[matcher inventory](../selector/README.md) explains what consumes these records
and how this differs from Selectlet's query parser. Selector grammar consumes
this folder's generic syntax machinery and the reusable value grammars.

`serializeComponentValues()`, `serializeCssIdentifier()`, and
`serializeCssString()` provide syntax-level serialization. Custom-property
declarations can retain original value text rather than reconstructing it from
tokens. These facilities do not promise a lossless source editor, CSSRule
serialization, or value resolution during serialization.

## Evidence

The [syntax tests](../../../test/stylelet/unit/syntax/) cover tokenization and
decoding, parser recovery, component grammars, and component serialization.
[Selector tests](../../../test/stylelet/unit/selector/) cover selector grammar,
context, specificity, serialization, and matching. Both were included in the passing
[syntax and selector baseline](../README.md#syntax-rules-and-selectors). Loader behavior, all
property grammars, and full browser/WPT conformance were not tested by that run.
