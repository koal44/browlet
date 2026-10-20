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
| Stylesheet contents | `parseStylesheetContents()` | Rules interpreted by the required caller-supplied grammar context. |
| Block syntax | `parseBlockContents()` | Interpreted declaration runs interleaved with rules, preserving the distinction needed by nesting. |
| CSS rule construction | [CSSOM parser](../cssom/parser.ts) | Recognizes selectors/properties and constructs rule implementations directly; see the [rule inventory](../cssom/README.md#rule-parsing). |

`ParserInput` accepts a string, token/component array, or existing `TokenCursor`.
Existing cursors retain their position, context and source ranges; parsing
consumes from that position. String inputs take the preprocessing path. Byte
decoding exists independently of the unfinished external-sheet loader and must
precede these entry points. Grammar context is caller-supplied parsing data,
not an owning environment or a guarantee of rule validity.

`DecodeStylesheetOptions.transportEncoding` is an unprocessed charset label;
`environmentEncoding` is an already determined Encoding value from the referring
document or importing sheet. This CSS term is separate from `StyleletEnvironment`:
the latter supplies `userAgent.decodeText`. Browlet uses Encoding's decoder;
standalone hosts default to native decoding. Both paths honor leading BOMs.
The initial `@charset` bytes select an encoding; they are not a live CSS rule.

Token arrays omit EOF; `TokenCursor` supplies it at exhaustion. Source ranges
are half-open UTF-16 offsets into the **preprocessed** string, not byte offsets
or offsets into the original input. Comments produce no tokens, but they
separate whitespace runs. Numeric conversion consumes the complete CSS spelling
before converting to a JavaScript number, avoiding intermediate overflow and
underflow. `consumeUnicodeRangeDescriptorValue()` opts into unicode-range
tokens when a declaration named `unicode-range` has retained source text.
It retokenizes the complete value segment; descriptor validation remains missing.

Records use the specification's plain names: `Rule`, `QualifiedRule`, `AtRule`,
and `Declaration`. The syntax folder identifies their stage; `CSSRuleImpl` and
`PropertyDeclaration` identify the later interpreted results.

There is no separate syntax stylesheet container. The specification's
[parse a stylesheet](https://drafts.csswg.org/css-syntax-3/#parse-stylesheet)
operation spans contents parsing here and sheet creation in CSSOM. Callers supply
CSSParsingContext to `parseStylesheetContents()` and use `CSSStyleSheetImpl` to
own the resulting rules and location.

## Choosing an entry point

- `parseRule()` expects one complete rule; CSSOM `insertRule()` supplies a
  CSSParsingContext carrying the sheet's constructed flag. Whole-sheet parsing
  has different recovery.
- `parseDeclarationList()` is the declaration-only path used for style
  attributes and CSSOM declaration text. It consumes and discards at-rules.
  It is deliberately distinct from mixed block contents; the existing
  `SPEC_CLASH(css-style-attribute-parsing)` remains documented in
  [Browlet's style roadmap](../../browlet/style/ROADMAP.md).
- `parseDeclaration()` consumes one declaration, leaving its terminating
  semicolon unread; it does not require complete input. Component-value/list
  parsers and the comma-separated component parser serve narrower grammars.
  `parseAsComponentGrammar()` and
  `parseListAsComponentGrammar()` require their selected grammar to consume the
  input apart from permitted trivia.
- [component-grammar.ts](component-grammar.ts),
  [component-consumers.ts](component-consumers.ts), and
  [token-cursor.ts](token-cursor.ts) provide the common grammar machinery.
  [any-value.ts](any-value.ts) and [declaration-value.ts](declaration-value.ts)
  enforce their respective component restrictions.

`ParsingContext` is the complete interpretation contract. `parseStylesheetContents()`,
`parseRule()`, and `parseBlockContents()` require it in their signatures, as do
their internal rule consumers. Declaration-block APIs accept `Partial<ParsingContext>`
because their syntax readers do not invoke rule interpretation. The types describe
the same caller-supplied object; there is no runtime completeness check.
The methods interpret declarations, statements, and whole block rules.
Block methods receive the prelude, preceding siblings where relevant,
and a cursor at the block; they must consume or discard it, even when returning
null. They select a child grammar with `withContext(child, consumeBlock)` and can
reject the completed block. The child grammar can use a different declaration type.

`TokenCursor<Value, Context>` has one constructor: `(input, context, options?)`.
Fresh cursors receive their parsing context at construction. Grammar entry points
use `withContext()` only for an existing caller-owned cursor; component-only
entry points preserve an existing cursor without changing its context.
`withContext()` restores the parent/caller context on return or failure while
retaining the same token position and source spans. Context methods live on their
class prototypes; each rule-list instance retains only its parse state.
Stateless component grammars share `emptyParsingContext` without a CSSOM owner.

CSSOM's `CSSParsingContext` validates supported selectors/properties once and
returns their parsed results. Declaration rejection happens before the parser
retries that input as a qualified rule. At-rule and descriptor grammars remain
explicit throwing dependencies in that context. Only Syntax tests supply a
structural rule grammar. Declaration entry points also require the caller to
supply its context, but read syntax without invoking interpretation methods.
They preserve that context, including opaque component-grammar context supplied
by `@supports`, rather than substituting a declaration-specific object. An
unsupported property is valid support-condition syntax whose result is false.
Block parsing interprets each declaration before deciding whether to retry it
as a rule. Declaration-only parsing discards whole at-rules without interpreting
them. Neither declaration entry point produces rule records.
Discarded rules do not split CSSOM declaration runs, following the browsers'
behavior documented in the [roadmap](ROADMAP.md#parser-disagreements).

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

Source retention currently covers string input and source-bearing cursors.
Bare token arrays and prebuilt blocks lack that provenance. They cannot supply
exact custom-property spelling or retokenize a unicode-range descriptor reliably;
the missing connections are marked in `consumeDeclaration()` and `consumeBlock()`.

## Evidence

CSS Syntax 3 §§1–5 have been reviewed against the local draft: §§1–2 and the
railroad diagrams are informative; input decoding/preprocessing, token records,
character classes, and all fifteen tokenizer algorithms are implemented. Parser
entry points and consumers cover structural recovery, including existing streams,
mixed token/component inputs, nested delimiters and unicode-range retokenization.
The unfinished rule grammars and source provenance prevent claiming full §5
conformance. Stylesheet creation remains in CSSOM.
Recovery follows the user-agent algorithms without exposing a conformance-checker
diagnostic API. The entry points accept complete input rather than incremental
chunks. These sections contain no Web IDL declarations.

The [syntax tests](../../../test/stylelet/unit/syntax/) cover tokenization and
decoding, parser recovery, component grammars, and component serialization.
[Tokenizer tests](../../../test/stylelet/unit/syntax/tokens.test.ts) exercise
both decoder hosts, strict `@charset` spelling and the 1024-byte boundary, BOM
precedence, preprocessing, astral characters, numeric extremes, recovery, and
token source ranges. CSSOM parser and numeric-value regressions cover consumers
of the corrected whitespace and number tokens.
[Selector tests](../../../test/stylelet/unit/selector/) cover selector grammar,
context, specificity, serialization, and matching. Both were included in the passing
[syntax and selector baseline](../README.md#syntax-rules-and-selectors). Loader behavior, all
property grammars, and full browser/WPT conformance were not tested by that run.
