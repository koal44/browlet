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
| Code points and tokens | `filterCodePoints()`, `tokenize()` | CSS newline/replacement preprocessing and tokens, with the preprocessed text and parallel source ranges. |
| Components | [parser.ts](parser.ts), [component-value.ts](component-value.ts) | Preserved tokens, nested blocks, and functions. These are syntax, not resolved CSS values. |
| Stylesheet contents | `parseStylesheetContents()` | Rules interpreted by the required caller-supplied grammar context. |
| Block syntax | `parseBlockContents()` | Interpreted declaration runs interleaved with rules, preserving the distinction needed by nesting. |
| CSS rule construction | [CSSOM parser](../cssom/parser.ts) | Recognizes selectors/properties and constructs rule implementations directly; see the [rule inventory](../cssom/README.md#rule-parsing). |

`ParserInput` accepts a string, `TokenList` record, or existing `TokenCursor`.
Every parser entry point requires a context, including component and value
parsers. Existing cursors retain their source ranges; parsing consumes from
their current position using the explicitly selected context and restores the
caller's context afterward. String inputs take the preprocessing path. Byte
decoding exists independently of the unfinished external-sheet loader and must
precede these entry points. Grammar context is caller-supplied parsing data,
not an owning environment or a guarantee of rule validity.

`DecodeStylesheetOptions.transportEncoding` is an unprocessed charset label;
`environmentEncoding` is an already determined Encoding value from the referring
document or importing sheet. This CSS term is separate from `StyleletEnvironment`:
the latter supplies `userAgent.decodeText`. Browlet uses Encoding's decoder;
standalone hosts default to native decoding. Both paths honor leading BOMs.
The initial `@charset` bytes select an encoding; they are not a live CSS rule.

Token lists omit EOF; `TokenCursor` supplies it at exhaustion. Source ranges
are half-open UTF-16 offsets into the **preprocessed** string, not byte offsets
or offsets into the original input. Comments produce no tokens, but they
separate whitespace runs. Numeric conversion consumes the complete CSS spelling
before converting to a JavaScript number, avoiding intermediate overflow and
underflow. `consumeUnicodeRangeDescriptorValue()` opts into unicode-range
tokens when a declaration is named `unicode-range`.
It retokenizes the complete value segment; descriptor validation remains missing.

`Declaration` and `StatementAtRule` hold syntax passed to interpretation.
Rule consumers return `CSSRuleImpl` objects; `BlockContents` interleaves those
rules with `PropertyDeclaration` runs. There is no parallel raw rule tree.

There is no separate syntax stylesheet container. The specification's
[parse a stylesheet](https://drafts.csswg.org/css-syntax-3/#parse-stylesheet)
operation spans contents parsing here and sheet creation in CSSOM. Callers supply
StylesheetContext to `parseStylesheetContents()` and use `CSSStyleSheetImpl` to
own the resulting rules and location.

## Choosing an entry point

- `parseRule()` expects one complete rule; CSSOM `insertRule()` supplies a
  StylesheetContext carrying the sheet's constructed flag. Whole-sheet parsing
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

`parseStylesheetContents()`, `parseRule()`, and `parseBlockContents()` require
CSSOM's `StylesheetContext`, as do their internal rule consumers.
Syntax imports the class's instance type without a runtime dependency on CSSOM
or a separate interpretation interface. Declaration-only APIs preserve the caller's
context without requiring interpretation methods. Property interpretation accepts
`PropertyContext`; selectors accept `SelectorContext`. Neither requires a
partial rule contract or an allocation environment. There is no runtime
completeness check.
The methods interpret declarations, statements, and whole block rules.
Block methods receive the prelude, preceding siblings where relevant,
and a cursor at the block; they must consume or discard it, even when returning
null. They select a child grammar with `withContext(child, consumeBlock)` and can
reject the completed block. Descriptor and keyframe result types remain part of
their unfinished at-rule implementations.

`TokenCursor<Value, Context>` has one constructor: `(list, context, options?)`.
Fresh cursors receive their parsing context at construction. Parser entry points
use `withContext()` only for an existing caller-owned cursor. The explicit
argument selects the context even when the input cursor carries another one.
`withContext()` restores the parent/caller context on return or failure while
retaining the same token position and source spans. Context methods live on their
class prototypes; each rule-list instance retains only its parse state.
Consumers read the context from their cursor and forward it when opening a
nested block or invoking another parser; they do not also take a context argument.
Root callers with no grammar settings pass `{}` without creating a CSSOM owner.
Nested consumers forward their existing context. No parser silently supplies
an empty context.
Property parsing and initial declared-value interpretation share their caller's
context. Later resolution and substitution reparsing use the context selected
for that value-processing stage.

`TryConsumer<Value, Context>` declares the context a grammar reads. Parser
factories, adapters, multipliers, and `ValueDefinition` retain that type.
Combinators require the context needed by every participating production and
their projector. A `contextAfter` update preserves the other fields supplied by
the caller. Functional-notation grammars can explicitly select a different
argument context while their projector still receives the outer context.
Token-only consumers accept `unknown` because they do not inspect context.

CSSOM's `StylesheetContext` validates supported selectors/properties once and
returns their parsed results. It passes itself to those grammar owners directly.
Each nested rule block gets its own context with the enclosing selectors,
constructed-sheet flag, and environment. Declaration rejection happens before
the parser retries that input as a qualified rule. At-rule and descriptor grammars remain
explicit throwing dependencies in that context. Syntax tests use the concrete
context and capture interpretation inputs where they need to inspect unfinished
grammar boundaries. Declaration entry points also require the caller to
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
`serializeCssString()` provide syntax-level serialization. The component serializer
preserves token kinds, explicit numeric signs, and integer/number flags, including
large integers and overflowed numeric tokens. Boundary comments prevent tokens
from joining, including the three-token `<!--` hazard. Identifier escaping uses
the tokenizer's character ranges; the resulting CSSOM/browser disagreement is
recorded in the [roadmap](ROADMAP.md#identifier-serialization-disagreement).
Custom-property declarations can retain original value text rather than reconstructing it from
tokens. These facilities do not promise a lossless source editor, CSSRule
serialization, or value resolution during serialization.

[An+B](../values/an-plus-b.ts) is a component grammar used by the selector parser.
It interprets the token productions into an integer step and offset and serializes
that record with integer spelling. Coefficients use JavaScript's finite number
range; overflow is limited during interpretation, not serialization. This is a
context-specific range choice permitted by CSS Values, not a general numeric
range policy for all properties. Selector matching owns positive-index and
nonnegative-iteration behavior.

`TokenList` extends `TokenSource` as an explicit record: `tokens`, `text`, and
`ranges`. Source is required. `tokenize()` produces this record; folding tokens
into components creates matching ranges while sharing the full preprocessed
text. Block/function children, comma-list arms, and collected grammar values
retain that same text with ranges for their own sequences.

`TokenCursor` caches the tokens array for token reads and uses the record for
source queries. Parser consumers build output lists; the cursor does not own
output construction. Reopening a block or entering a component grammar therefore
preserves custom-property spelling and unicode-range reparsing. Slicing a list
requires slicing its ranges alongside its tokens. A bare array is not parser
input; serialization can still read a component array without source information.

Use `component` for one component value and `components` for an array of them;
use `token` for a lexical or unspecialized token. Name the complete `TokenList`
record `list`, `input`, or a specific role such as `prelude`. The `tokens` member
can contain lexical tokens or folded components, as its type argument specifies.
Retain `value` for payload fields and interpreted values.

## Evidence

CSS Syntax 3 §§1–11 have been reviewed against the local draft: §§1–2 and the
railroad diagrams are informative; input decoding/preprocessing, token records,
character classes, and all fifteen tokenizer algorithms are implemented. Parser
entry points and consumers cover structural recovery, including existing streams,
mixed token/component inputs, nested delimiters and unicode-range retokenization.
The unfinished rule and descriptor grammars prevent claiming full §5
conformance. Stylesheet creation remains in CSSOM.

| Remaining section | Implementation / boundary |
| --- | --- |
| §6 An+B | Token grammar and coefficient interpretation in `values/an-plus-b.ts`; selector tests cover accepted/rejected forms and `of` clauses. |
| §7 Rule and arbitrary-value grammars | `StylesheetContext` selects valid construct kinds while consuming and constructs CSSOM rules. Descriptor grammars remain unfinished. `any-value.ts` and `declaration-value.ts` enforce recursive malformed-token restrictions and the latter's additional top-level restrictions. |
| §8 Stylesheets, style rules, at-rules, @charset | CSSOM interprets selectors/properties and retains nested rules. Invalid selectors discard the rule; invalid declarations do not. Recognized unfinished at-rules reach explicit throwing dependencies; unknown at-rules and @charset are discarded. |
| §9 Serialization | Component/token round trips and canonical An+B serialization; CSSOM and individual value specifications still own their further serialization requirements. |
| §§10–11 Privacy/security | No additional runtime algorithm or API; consistent error recovery is supplied by the parser. |

Recovery follows the user-agent algorithms without exposing a conformance-checker
diagnostic API. The entry points accept complete input rather than incremental
chunks. CSS Syntax contains no Web IDL declarations.

The [syntax tests](../../../test/stylelet/unit/syntax/) cover tokenization and
decoding, parser recovery, component grammars, and component serialization.
[Tokenizer tests](../../../test/stylelet/unit/syntax/tokens.test.ts) exercise
both decoder hosts, strict `@charset` spelling and the 1024-byte boundary, BOM
precedence, preprocessing, astral characters, numeric extremes, recovery, and
token source ranges. [Source tests](../../../test/stylelet/unit/syntax/source.test.ts)
cover folding, nested blocks, component grammars, comma-list arms, and reparsing
collected `first-valid()` arguments. CSSOM parser regressions also check exact custom-property
text through prebuilt nested rules. Numeric-value regressions cover consumers
of the corrected whitespace and number tokens.
[An+B tests](../../../test/stylelet/unit/values/an-plus-b.test.ts) cover coefficient
round trips, overflow, grammar failure restoration, and the selector-clause boundary.
[Selector tests](../../../test/stylelet/unit/selector/) cover selector grammar,
context, specificity, serialization, and matching.

The 2026-10-19 final Syntax audit ran all 39 Stylelet unit files:
2,915 passed, 7 existing expected failures, and 14 existing skips. The new browser
regression exercised Stylelet's identifier/selector serialization in Chromium,
Firefox and WebKit; all passed. The three native-only spelling probes confirmed
the documented disagreement before returning to idle. Loader behavior, every
property grammar, and full browser/WPT conformance were not established by these runs.
