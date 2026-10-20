# CSSOM implementation

This folder implements parts of the CSS Object Model over Stylelet's parsed
values and stylesheet state. Missing interfaces and algorithms belong in the
[roadmap](ROADMAP.md). The current representation remains under review;
observable behavior, rather than private storage choices, constrains its replacement.

## Objects and their current state

| Implementation | Current responsibility and limit |
| --- | --- |
| [StyleSheetImpl](stylesheet.ts) | Common metadata, owner/parent references, retained `MediaList`, disabled state; abstract base |
| [CSSStyleSheetImpl](css-stylesheet.ts) | Owns the rule tree, location/base URL, metadata, and construction/access flags; retains list identity through insert/delete/replace operations |
| [CSSRuleImpl](rule.ts), [CSSGroupingRuleImpl](rules.ts) | Rule identity/constants, parent associations, and retained child lists; nested insertion/deletion remain throwing stubs |
| [CSSStyleRuleImpl](rules.ts), [CSSNestedDeclarationsImpl](rules.ts) | Parsed selectors, leading declarations, and separate later declaration runs; style-rule selector text and serialization remain unfinished |
| [CSSPropertyRuleImpl](rules.ts) | Registration data used by existing fixtures; `@property` parsing and syntax/initialValue/serialization members remain unfinished |
| [CSSStyleDeclarationImpl](declaration.ts) | Declaration queries, mutation, CSS text, owner write-back, and readonly/computed flags. It currently also installs the property accessors expected from the missing `CSSStyleProperties` interface. |
| [MediaListImpl](media-list.ts) | Query-list parsing/serialization, comparison, and collection mutation; does not evaluate media against a device |
| [CSSRuleListImpl](rule-list.ts), [StyleSheetListImpl](stylesheet-list.ts) | Retained ordered collections with manually synchronized numeric properties |
| [StylePropertyMapImpl](style-property-map.ts) | Explicit throwing placeholder for Typed OM; no working typed map API |

[web-idl.ts](../web-idl.ts) currently contributes `ElementCSSInlineStyle`,
`LinkStyle`, and the stylesheet members of `DocumentOrShadowRoot`. Their return
types are still `object`/`any`. It does not yet declare the primary CSSOM
interfaces in the table. An IDL comment or TypeScript `implements` clause does
not create a realm-owned Platform interface.

## Declaration data and mutation

[CSSDeclarationBlock](../css/declaration-block.ts) stores interpreted
`PropertyDeclaration` values and their importance/order. It can parse text,
set/remove declarations, and serialize the retained data. It has no DOM owner,
environment, or CSSOM identity. Supported built-ins come from the small
[property registry](../css/property.ts); custom-property token values are stored
separately from built-in value representations.

`CSSStyleDeclarationImpl` holds a block and supplies CSSOM-shaped operations.
It currently performs some author conversion itself and installs numeric and
property-name accessors directly on implementation objects/prototypes. Those
parts predate complete Binding integration.

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

The CSSOM object updates its indices on its own mutations. Browlet also calls
`synchronizeIndices()` when attribute input changes an existing object's block.
This coupling is an acknowledged consequence of manual indexed exposure;
Binding's supported-index machinery is the intended review point. The block
does not currently maintain an observer list.

## Sheets, collections, and execution

`CSSStyleSheetImpl.ruleList` is the authoritative rule collection. Internal
engine reads use it directly, including for non-origin-clean sheets;
the author-facing `cssRules` getter retains its security check.
`replaceSync()` replaces contents while keeping the list object;
`replace()` uses the owning environment's background execution, task delivery,
and `InternalPromise`. Modification locking spans the asynchronous replacement.
Parent-sheet associations propagate through children on attachment/removal.
Location and parse-time base URL belong to the sheet, independently of its rules.

### Rule parsing

[parseCSSRules()](parser.ts) parses generic syntax and constructs unattached
implementations directly. It does not retain a second interpreted tree or whole
sheet source string. Selector/value records remain internal parsed data;
custom-property source text is retained where its representation needs it.

`interpretCSSRule()` dispatches generic rules; `interpretStyleRule()` applies
selector/property grammars and constructs style-rule implementations. These
helpers implement CSS Syntax's [rule interpretation requirements](https://drafts.csswg.org/css-syntax-3/#css-stylesheets)
and CSS Nesting's declaration placement; they are not separate named spec algorithms.

| Construct | Current result / limit |
| --- | --- |
| Ordinary style rule | CSSStyleRuleImpl with parsed selectors and a declaration object |
| Nested style rule | Child CSSStyleRuleImpl with parent-bound selectors and specificity; engine matching of nested style rules remains unfinished |
| Declarations after a retained child rule | Separate CSSNestedDeclarationsImpl children, in order; the cascade reads them with the parent's matching result |
| At-rules | Discarded; recognized rule grammars, namespace context, grouping applicability, and imports are unfinished |
| `@charset` in parsed text | Intentionally discarded; encoding detection uses its initial byte pattern, not a live rule |

Invalid selector lists discard the rule. Invalid/unsupported declarations do
not discard its valid siblings. Top-level import insertion is still rejected
for every sheet; nested insertion/deletion remain explicit stubs.

[TreeScope](../engine/tree-scope.ts) orders header sheets before tree-associated
sheets, then adds adopted sheets for cascade order. It tracks preferred/selected
stylesheet sets. Its adopted collection currently uses Infra's observable-array
proxy and direct implementation checks. Actual sheet loading and header
integration are separate host work; having collection operations does not mean
those resources are fetched.

All CSSOM objects that need execution retain the supplied
[StyleletEnvironment](../environment.ts). Standalone defaults and Browlet's
environment both work through this boundary. Current direct exposure allocates
exceptions through `env.exec`; proper method-realm projection remains pending.

## Existing evidence and its limits

| Tests | What they exercise |
| --- | --- |
| [CSSOM unit suites](../../../test/stylelet/unit/cssom/) | Direct implementation construction, sheet/list identity, declaration edits, media lists, and asynchronous replacement |
| [Tree-scope tests](../../../test/stylelet/unit/engine/tree-scope.test.ts) | Ordering and stylesheet-set selection using explicit sheet inputs |
| [Host tests](../../../test/stylelet/unit/host.test.ts), [environment tests](../../../test/stylelet/unit/environment.test.ts) | Host-neutral DOM access, explicit initialization, empty-provider semantics, URL/decoding/execution facilities, and interim exceptions |
| [Browlet style tests](../../../test/browlet/style/) | Inline/stylesheet association, mutation, cascade reads, adopted sheets, and selected calls through `Browlet.evaluate()` |
| [CSP style tests](../../../test/browlet/browsing/policy/csp/style-attribute.test.ts) | Raw-source authorization, reporting, accepted state, parser input, and adoption |
| [Style-attribute browser scenarios](../../../test/stylelet/scenarios/style-attribute.test.ts) | Stylelet's declaration parsing compared with native behavior; not included in the baseline below |
| [IDL contribution test](../../../test/stylelet/unit/web-idl.test.ts) | Serialization of the current provisional declarations, not CSSOM Platform conformance |

Several tests intentionally pin current representation details: block identity,
no `.style` getter call during cascade reads, numeric own properties, direct
implementation coercion, and the provisional IDL strings. Review those tests
when changing ownership or introducing Binding. Preserve their observable
contracts, but do not require a new implementation to keep the same private
storage or to accept author inputs that Binding should already have converted.

## Validation baseline

On 2026-10-19, the rule-ownership cleanup passed **138 tests across 14 files**
on the custom Node 27 compatibility runtime. Seven pre-existing custom-property
defaulting/substitution cases remained skipped. These two focused commands cover
rule construction, mutation, engine reads, host integration, CSP, and the current
IDL contribution:

```text
node scripts/with-node.mjs vitest run --project=unit test/stylelet/unit/cssom test/stylelet/unit/engine test/stylelet/unit/environment.test.ts test/stylelet/unit/host.test.ts test/browlet/style
node scripts/with-node.mjs vitest run --project=unit test/browlet/browsing/policy/csp/style-attribute.test.ts test/stylelet/unit/web-idl.test.ts
```

The Stylelet package build and global-artifact smoke test also passed.
This baseline does not establish CSSOM interface exposure, cross-realm borrowing,
live computed values, complete parsing/serialization, or layout-dependent results.
