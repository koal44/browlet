# CSSOM rules

## Parsing and ownership

[RuleListContext](context.ts) supplies the complete interpretation contract to
Syntax consumption by forwarding to a supplied `CSSRuleListImpl`. It imports only types.
The list coordinates concrete rule and property grammars without retaining a second
interpreted tree or whole sheet source string. Selector records and value instances remain internal;
custom-property source text is retained where its representation needs it.

CSSOM and loading callers create RuleListContext with their existing rule list, enclosing selectors,
the constructed-sheet flag, and the environment. The same class handles both sheet kinds:
ordinary imports retain their URL/media prelude but cannot attach without the loader; constructed-sheet
insertion rejects imports and replacement discards them. Parsing helpers receive
the context, extracting its environment when allocating retained CSSOM objects.
Selector/property grammars receive the same context object directly.
The class carries optional namespace prefixes and a default namespace. The plain
`SelectorNamespaces` type defines these shared fields; `SelectorContext` builds
on it, and each style rule retains only those bindings for descendant rebuilding.
Nested contexts use the supplied child list, share the prefix map, and retain the default namespace.
Sheet parsing supplies no outer numeric bindings; value grammars introduce
their own bindings, such as relative-color channels.
Each child context selects its enclosing selectors and retains the environment
and constructed-sheet flag. Namespace declarations populate the prefix/default
bindings while consuming the sheet; later misplaced declarations are discarded.
Declaration-only callers supply `PropertyContext`
directly, passing `{}` when no settings are needed. They do
not construct a rule context. Syntax reading does not replace the caller's
context with a private identity interpreter.

`CSSRuleListImpl` owns interpretation dispatch, forwarding the same context to
the grammar owners. `CSSStyleRuleImpl` parses selectors and
consumes its block under a child context; import and namespace rules interpret
their own preludes and placement. Each rule implementation and its Web IDL
declaration have their own module. Syntax retains its parsing entry points and
structural consumers. After accepting a style rule's selectors, the coordinating
list creates its child list and passes it to the rule interpreter. The rule uses
that supplied list in its nested context and retains it after block assembly.
Concrete grouping rules and their base import the list only as a type; the base
obtains nesting selectors through the rule's instance method without importing
a subclass. Fresh-process tests cover independent loading from each entry point.
Parsing leaves the live list untouched and uses Syntax's current-input siblings
for placement. Replacement starts with fresh namespace state; insertion explicitly
imports the existing sheet's bindings. Style-element creation allocates its sheet
and list before parsing, then associates the completed sheet with its tree scope.
The rule list applies existing namespace declarations to a mutation context.
`CSSStyleRuleImpl.fromContents()`
assembles the interpreted declarations and children without repeating grammar work. These
helpers implement CSS Syntax's [rule interpretation requirements](https://drafts.csswg.org/css-syntax-3/#css-stylesheets)
and CSS Nesting's declaration placement; they are not separate named spec algorithms.
Grouping rules select their own mutation context. Selector edits use that
context's selector parser, so the enclosing-rule walk happens only once.

| Construct | Current result / limit |
| --- | --- |
| Ordinary style rule | CSSStyleRuleImpl with parsed selectors and a declaration object |
| Nested style rule | Child CSSStyleRuleImpl with parent-bound selectors and specificity; engine matching of nested style rules remains unfinished |
| Declarations after a retained child rule | Separate CSSNestedDeclarationsImpl children, in order; the cascade reads them with the parent's matching result |
| Namespace/import statements | Namespaces are interpreted; plain import preludes are retained, with loading and modern import conditions explicit dependencies |
| Other at-rules | Unknown rules are discarded; recognized unfinished grammars stop with InternalError. Page parsing has its own named boundary; conditional, font, animation, and other grammars retain their owners |
| `@charset` in parsed text | Intentionally discarded; encoding detection uses its initial byte pattern, not a live rule |

Invalid selector lists discard the rule. Invalid/unsupported declarations do
not discard its valid siblings. Constructed sheets reject inserted imports;
ordinary imports retain their parsed prelude and stop at the explicit loading
boundary when attached to a sheet. Nested insertion/deletion preserve rule-list
identity and update parent links; insertion also accepts nested declaration runs.

The export-only [barrel](index.ts) exposes the rule implementations and context.
The higher-level [rule list](../rule-list.ts) remains outside this folder and
coordinates construction through that barrel. Rule modules use local imports;
the context imports only types. ESLint places declaration and media objects
below rules; the context has its own lower layer, and outer CSSOM coordinates them.

The [roadmap](ROADMAP.md) records unfinished grammars and consumers.
[Construction tests](../../../../test/stylelet/unit/cssom/rules/construction.test.ts)
cover declaration assembly and nesting;
[interpretation and editing tests](../../../../test/stylelet/unit/cssom/rules/interpretation.test.ts)
cover selector changes, namespaces, imports, and explicit unfinished dependencies.
[Module-loading tests](../../../../test/stylelet/unit/cssom/module-loading.test.ts)
load individual implementations and both barrels independently.
