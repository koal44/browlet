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
| [CSSRuleImpl](rules/rule.ts), [CSSGroupingRuleImpl](rules/grouping.ts) | Rule identity/constants, parent associations, live child lists, and nested insertion/deletion with declaration fallback |
| [CSSStyleRuleImpl](rules/style.ts), [CSSNestedDeclarationsImpl](rules/nested-declarations.ts) | Parsed selectors, selector mutation and child rebinding, leading/later declaration runs, and rule serialization |
| [CSSNamespaceRuleImpl](rules/namespace.ts) | Namespace grammar, literal URI/prefix, serialization, sheet scope, and mutation constraints |
| [CSSImportRuleImpl](rules/import.ts) | URL/media prelude, serialization, and bindings; attachment explicitly requires the unfinished import loader; layer/supports clauses stop at their missing grammar |
| [CSSPageRuleImpl](rules/page.ts), [CSSMarginRuleImpl](rules/margin.ts) | Bound rule and descriptor interfaces; construction/parsing stop explicitly until page-specific grammars exist; margin-descriptor subtype is provisional |
| [CSSPropertyRuleImpl](rules/property.ts) | Registration data used by existing fixtures; `@property` parsing and syntax/initialValue/serialization members remain unfinished |
| [CSSStyleDeclarationImpl](declarations/declaration.ts), [CSSStylePropertiesImpl](declarations/style-properties.ts) | Shared declaration operations and the property-facing subtype; Binding supplies numeric and supported-property attributes |
| [MediaListImpl](media/media-list.ts) | Query-list parsing/serialization, comparison, and collection mutation, with a real MediaList declaration; does not evaluate media against a device |
| [CSSRuleListImpl](rule-list.ts), [StyleSheetListImpl](stylesheet-list.ts) | Retained ordered collections; Binding supplies live supported indices and projects entries |
| [StylePropertyMapImpl](typed/style-property-map.ts) | Explicit throwing placeholder for Typed OM; no working typed map API |

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

[declarations/](declarations/README.md) owns the declaration implementations,
their bindings, and provisional block storage. Its [roadmap](declarations/ROADMAP.md)
tracks the ownership review and the input/CSP/CSSOM lifecycle to preserve.
[media/](media/README.md) owns MediaList mutation and serialization. Both
object families sit below rules and sheets and have export-only barrels.

## Sheets, collections, and execution

`CSSStyleSheetImpl.ruleList` is the authoritative rule collection. Internal
engine reads use it directly, including for non-origin-clean sheets;
the author-facing `cssRules` getter retains its security check.
`replaceSync()` replaces contents while keeping the list object;
`replace()` uses the owning environment's background execution, task delivery,
and a `Promise<CSSStyleSheet>`-typed InternalPromise. Modification locking spans the asynchronous replacement.
Parent-sheet associations propagate through children on attachment/removal.
`CSSRuleListImpl` checks insertion bounds before parsing, tries declarations when
nested rule parsing fails, and validates placement. It also owns removal and
parent cleanup. Parsing uses a supplied `RuleListContext`; the sheet or grouping
rule attaches the validated result before inserting it into the list.
This ordering keeps a failed resource attachment from partially changing the list.
Location and parse-time base URL belong to the sheet, independently of its rules.
Constructed sheets expose null `href`, retain their Document and resolved base
internally, and clone MediaList constructor input. Ordinary sheets initialize
their own metadata directly rather than first constructing an author sheet.

Rule implementations and the type-only context live in [rules/](rules/README.md).
The coordinating [rule list](rule-list.ts) stays here, above those implementations.
See [rule parsing](rules/README.md#parsing-and-ownership) for the ownership contract.

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
| [Rule browser scenarios](../../../test/stylelet/scenarios/rules.test.ts) | Browlet rule serialization, mutation, namespace scope, declaration order, and the isolated native-browser disagreements |
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

The §6.4 rule audit passed **3,101 tests across 54 files**, with 7 existing
expected failures and 14 existing skips, using the broad command above. All 21
rule browser comparisons completed: 16 ordinary passes and 5 approved native
expected failures; Browlet assertions pass before those annotations apply.
Full lint/typecheck, the Stylelet build, and global-artifact smoke test passed. Rollup reports the
parser/rule module cycle. The subsequent ownership cleanup has failing fresh-process
rule-module regressions; the passing audit baseline above predates that work.
Import loading, modern import clauses, and page/margin grammars
remain explicit unfinished boundaries, not passing conformance claims.
