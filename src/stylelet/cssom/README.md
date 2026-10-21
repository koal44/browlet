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
| [CSSStyleDeclarationImpl](declaration.ts), [CSSStylePropertiesImpl](style-properties.ts) | Shared declaration operations and the property-facing subtype; Binding supplies numeric and supported-property attributes |
| [MediaListImpl](media-list.ts) | Query-list parsing/serialization, comparison, and collection mutation, with a real MediaList declaration; does not evaluate media against a device |
| [CSSRuleListImpl](rule-list.ts), [StyleSheetListImpl](stylesheet-list.ts) | Retained ordered collections; Binding supplies live supported indices and projects entries |
| [StylePropertyMapImpl](style-property-map.ts) | Explicit throwing placeholder for Typed OM; no working typed map API |

[web-idl.ts](../web-idl.ts) exports the CSSOM string typedef, common sheet,
rule, list, and declaration interfaces, and the host mixin/partial contributions.
`CSSStyleSheet` and `CSSStyleProperties` are declared beside their implementations.
`CSSRule` keeps the Animations, Counter Styles, Conditional Rules, and Fonts
constants as separate partial declarations beside its primary declaration until
their feature modules own them. Assembly combines their members into `CSSRule`.
`CSSStyleSheetInit` describes the converted constructor dictionary; standalone
`createStyleSheet()` accepts `Partial<CSSStyleSheetInit>` and supplies its defaults.
The constructor obtains its Document through `env.getAssociatedDocument()`;
property attributes call the declaration's `getPropertyValue()`/`setProperty()`.
Both declarations use Web IDL Core; Binding supplies conversion, invocation,
and projection without a declaration factory in Browlet.

Bindings own conversion, receiver checks, indexed properties, and exception
realization. Implementations accept converted values and throw realm-neutral
DOMExceptionImpl failures. Sheet, rule, and declaration results project through
their declared references; DocumentOrShadowRoot's adopted-sheet collection
uses `ObservableArray<CSSStyleSheet>` with declared indexed mutation steps.

Common identifier, string, function, and LOCAL formatting lives in
`syntax/component-value.ts`. Function formatting receives a name and contents
already serialized by the value's grammar; it performs no value resolution.
`values/url.ts` supplies URL notation and modifiers. Generic component-value
serialization remains distinct: without a grammar it preserves function names.
List owners use `join(', ')` or `join(' ')` for CSSOM's separators.

## Declaration data and mutation

[CSSDeclarationBlock](../css/declaration-block.ts) stores interpreted
`PropertyDeclaration` values and their importance/order. It can parse text,
set/remove declarations, and serialize the retained data. It has no DOM owner,
environment, or CSSOM identity. Supported built-ins come from the small
[property registry](../css/property.ts); custom-property token values are stored
separately from built-in value representations.

This separate class is provisional, including its role as the inline mixin's
retained state. The [declaration audit](ROADMAP.md#projection-and-declaration-lifecycle)
must resolve its representation and ownership before CSSOM review closes.

`CSSStyleDeclarationImpl` holds a block and supplies CSSOM operations.
`CSSStylePropertiesImpl` adds the projected subtype identity; supported property
attributes declared beside the implementation forward to
`getPropertyValue()`/`setProperty()` through Binding.
Neither implementation installs numeric or property-name accessors.

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

Binding reads supported indices from the current declarations. Attribute input
therefore needs no `synchronizeIndices()` call or block observer to update the
already-retained Platform object.

## Sheets, collections, and execution

`CSSStyleSheetImpl.ruleList` is the authoritative rule collection. Internal
engine reads use it directly, including for non-origin-clean sheets;
the author-facing `cssRules` getter retains its security check.
`replaceSync()` replaces contents while keeping the list object;
`replace()` uses the owning environment's background execution, task delivery,
and a `Promise<CSSStyleSheet>`-typed InternalPromise. Modification locking spans the asynchronous replacement.
Parent-sheet associations propagate through children on attachment/removal.
Location and parse-time base URL belong to the sheet, independently of its rules.
Constructed sheets expose null `href`, retain their Document and resolved base
internally, and clone MediaList constructor input. Ordinary sheets initialize
their own metadata directly rather than first constructing an author sheet.

### Rule parsing

[StylesheetContext](parser.ts) supplies the complete interpretation contract to
Syntax consumption and constructs unattached implementations directly. It does not retain a second
interpreted tree or whole sheet source string. Selector/value records remain internal parsed data;
custom-property source text is retained where its representation needs it.

CSSOM and loading callers create StylesheetContext with the enclosing selectors,
constructed-sheet flag, and environment. The same class handles both sheet kinds:
ordinary imports reach the explicit unfinished grammar; constructed-sheet
insertion rejects imports and replacement discards them. Parsing helpers receive
the context, extracting its environment when allocating retained CSSOM objects.
Selector/property grammars receive the same context object directly.
The class carries optional namespace prefixes and a default namespace.
Nested contexts share the prefix map and retain the default namespace.
Sheet parsing supplies no outer numeric bindings; value grammars introduce
their own bindings, such as relative-color channels.
Each child context selects its enclosing selectors and retains the environment
and constructed-sheet flag. Populating namespace state from stylesheet text
remains part of the unfinished `@namespace` integration, covered by an expected-failure
test with actual stylesheet input. Declaration-only callers supply `PropertyContext`
directly, passing `{}` when no settings are needed. They do
not construct a rule context. Syntax reading does not replace the caller's
context with a private identity interpreter.

`StylesheetContext` methods apply selector/property grammars, consume each block
under its child context, and return the completed rule. `createStyleRule()` assembles
the interpreted declarations and children without repeating grammar work. These
helpers implement CSS Syntax's [rule interpretation requirements](https://drafts.csswg.org/css-syntax-3/#css-stylesheets)
and CSS Nesting's declaration placement; they are not separate named spec algorithms.

| Construct | Current result / limit |
| --- | --- |
| Ordinary style rule | CSSStyleRuleImpl with parsed selectors and a declaration object |
| Nested style rule | Child CSSStyleRuleImpl with parent-bound selectors and specificity; engine matching of nested style rules remains unfinished |
| Declarations after a retained child rule | Separate CSSNestedDeclarationsImpl children, in order; the cascade reads them with the parent's matching result |
| At-rules | Unknown rules are discarded; named unfinished grammars stop with InternalError at their context method. Namespace, grouping, descriptors, and import consumers remain unfinished |
| `@charset` in parsed text | Intentionally discarded; encoding detection uses its initial byte pattern, not a live rule |

Invalid selector lists discard the rule. Invalid/unsupported declarations do
not discard its valid siblings. Constructed sheets reject inserted imports;
ordinary imports reach the explicit unfinished grammar. Nested
insertion/deletion remain explicit stubs.

[TreeScope](../engine/tree-scope.ts) orders header sheets before tree-associated
sheets, then adds adopted sheets for cascade order. It tracks preferred/selected
stylesheet sets. The adopted collection is a retained implementation list;
Binding owns its observable array and runs `checkAdoptedStyleSheet()` after
conversion. Browlet supplies separate document/shadow scopes and ordered
`Default-Style` response processing. Actual external-sheet loading remains
separate host work; collection operations do not fetch those resources.

All CSSOM objects that need execution retain the supplied
[StyleletEnvironment](../environment.ts). Standalone defaults and Browlet's
environment both work through this boundary. Sheet/declaration bindings realize
synchronous failures at the method boundary; replacement promises retain their
owning environment and typed result projection. Adoption failures use the same
neutral exception path; Stylelet no longer requires a host DOMException constructor.

## Existing evidence and its limits

| Tests | What they exercise |
| --- | --- |
| [CSSOM unit suites](../../../test/stylelet/unit/cssom/) | Direct implementation construction, sheet/list identity, declaration edits, media lists, and asynchronous replacement |
| [Tree-scope tests](../../../test/stylelet/unit/engine/tree-scope.test.ts) | Ordering and stylesheet-set selection using explicit sheet inputs |
| [Host tests](../../../test/stylelet/unit/host.test.ts), [environment tests](../../../test/stylelet/unit/environment.test.ts) | Host-neutral DOM access, explicit initialization, empty-provider semantics, URL/decoding/execution facilities, and neutral exceptions |
| [Browlet style tests](../../../test/browlet/style/) | Inline/stylesheet association, cascade reads, and real CSSOM conversion, identity, supported indices, borrowed calls, and promises |
| [CSP style tests](../../../test/browlet/browsing/policy/csp/style-attribute.test.ts) | Raw-source authorization, reporting, accepted state, parser input, and adoption |
| [Style-attribute browser scenarios](../../../test/stylelet/scenarios/style-attribute.test.ts) | Stylelet's declaration parsing compared with native behavior; not included in the baseline below |
| [MediaList binding tests](../../../test/browlet/style/media-list.test.ts) | Real interface exposure, identity, conversions, live indices/iteration, author overrides, and borrowed-method exception realms |
| [Media-list browser scenarios](../../../test/stylelet/scenarios/media-list.test.ts) | Stylelet parsing/mutation against Chromium, Firefox, and WebKit, with documented disagreements |
| [IDL contribution test](../../../test/stylelet/unit/web-idl.test.ts) | Serialization of the typedef, MediaList, and mixin contributions |

Several tests pin representation details such as block identity and avoiding
`.style` access during cascade reads. Review those assertions when changing
ownership. Preserve observable contracts without requiring replacement code to
keep the same private storage. Implementation tests receive converted values;
author conversion and projection belong in Binding tests.

## Validation baseline

The 2026-10-19 sections 1–5 audit passed **3,001 tests across 45 files** on
the custom Node 27 compatibility runtime, with 7 pre-existing expected failures
and 14 pre-existing skips. This covers Stylelet units, Browlet style integration,
CSP, and MediaList's real Binding boundary:

```text
node scripts/with-node.mjs vitest run --project=unit test/stylelet/unit test/browlet/style test/browlet/browsing/policy/csp/style-attribute.test.ts
```

Full lint/typecheck, the Stylelet package build, and global-artifact smoke test
also passed. The MediaList browser run completed all 19 scenarios: 7 passed
normally and 12 matched the approved expected failures for documented browser
differences.

The 2026-10-20 §6.1 audit passed **168 tests across 16 focused files**, with one
existing expected failure and seven existing skips. The final binding/IDL
recheck passed all 11 tests. Full lint/typecheck and the Stylelet build passed.
All 16 CSSOM, style-attribute, and constructed-sheet scenarios passed in
Chromium, Firefox, and WebKit.
Later rule/declaration algorithms, live computed values, complete
property grammars, and layout-dependent results remain unfinished.

The §6.2 collection audit passed **3,543 tests across 90 files**, with 8 existing
expected failures and 14 existing skips, including Stylelet units, Browlet style/CSP,
and Web IDL Binding/Core/assembly. The 12 stylesheet-set browser comparisons had
3 ordinary passes and 9 approved expected failures; Stylelet passed in all three
engines. These comparisons remain enabled. The
[collection disagreements](../../browlet/style/ROADMAP.md#stylesheet-collection-disagreements)
record the precise browser results and remaining resource-lifecycle dependencies.
