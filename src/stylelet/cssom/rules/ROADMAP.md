# CSSOM rules roadmap

The [README](README.md) describes current ownership. These are the remaining
rule-family contracts and preserved browser/specification decisions.

## Rule and interface coverage

| §6.4 contract | Implemented / explicit stopping point |
| --- | --- |
| Common parse/insert/remove, CSSRuleList, CSSRule | Shared validation, nested declaration fallback, index/hierarchy/namespace errors, live lists, parent cleanup, constants and no-op cssText setters. Owners attach a validated rule before inserting it. Syntax passes null preceding siblings for standalone parsing; whole-list parsing supplies actual siblings. |
| CSSStyleRule | Canonical text, invalid-selector no-op, namespace/nesting-aware edits, descendant specificity refresh, stable style/list identity. Winning declarations retain their specified position; shorthand expansion remains declaration/property work. |
| CSSImportRule | Complete IDL, URL/media grammar, retained `UrlValue` with request modifiers, literal href and canonical text. Attachment is structural; `CSSStyleSheetImpl.loadImports()` explicitly supplies recursive loading, completion/cancellation, and shared media/ownerRule association. Automatic startup and supports matching remain unconnected; layer/supports interpretation throws. Constructed sheets still reject/discard imports. |
| CSSGroupingRule | Nested insertion/deletion and association propagation. Concrete conditional/page groups must supply their own block grammar and permitted children; generic operations alone do not implement those families. |
| CSSMediaRule | Defined by Conditional Rules, still an explicit `@media` grammar/construction dependency in `../rule-list.ts`. Its CSSOM serializer, CSSConditionRule base and condition evaluation belong to that integration. |
| CSSPageRule / CSSPageDescriptors | Complete declarations and deliberately unavailable implementations. `CSSPageRuleImpl.interpret()` requires page selectors, descriptor grammar/storage and margin rules. Inherited element-property parsing must not substitute for descriptors. |
| CSSMarginRule / CSSMarginDescriptors | Rule declaration and provisional descriptor subtype; creation stops until the page grammar supplies real descriptor state. No invented descriptor attributes. |
| CSSNamespaceRule | String/url grammar, literal namespace names, last-prefix/default binding, placement, serialization, read-only projection and mutation restrictions. Namespace scopes do not propagate into imports. |
| CSSPropertyRule | Direct registration fixtures exist; parse and validate descriptors and finish syntax/initialValue/serialization members. See [registration](../../engine/ROADMAP.md#custom-property-registration). |
| Other serializers referenced by §6.4 | Font-face and keyframe/animation representations remain dependencies of their contributing specifications. Recognized grammars stop explicitly; CSSPropertyRule still only serves direct registration fixtures. Legacy numeric constants are not a complete rule inventory. |

Import loading must skip false supports conditions and preserve host Fetch,
MIME, encoding, and policy checks; see [Cascade's import rule](https://drafts.csswg.org/css-cascade-5/#at-import).
Unknown rules are discarded; recognized unfinished grammars throw. Parsing,
projection, engine participation, and resource completion remain separate
obligations; the table below identifies additional rule owners.

## Other rule families and consumers

A future rule needs its permitted syntax/context, retained representation, CSSOM behavior,
and actual consumer accounted for together; not every rule contributes element
declarations to the cascade.

| Rule / specification | Required owner or dependency |
| --- | --- |
| [`@media`, `@supports`](https://drafts.csswg.org/css-conditional-3/#processing) | Retained group children, CSSGroupingRule/CSSConditionRule derivatives, and condition evaluation. False conditions keep CSSOM children but exclude their declarations; changes require fresh applicability. |
| [`selector()` support queries](https://drafts.csswg.org/css-conditional-4/#at-supports-ext) | Selector support, including recursively unsupported forgiving arms and namespace context. The current declaration-only supports grammar is insufficient. |
| [`@layer`](https://drafts.csswg.org/css-cascade-5/#at-layer) | Statement/block forms, layer identity/order, import integration, CSSOM interfaces, and cascade precedence. Account for the statement form's exceptions to initial rule ordering. |
| [`@scope`](https://drafts.csswg.org/css-cascade-6/#scoped-styles) | Roots/limits, matching context, nesting interactions, proximity in cascade selection, and CSSScopeRule. This is not the existing document/shadow `TreeScope`. |
| [`@container`](https://drafts.csswg.org/css-conditional-5/#container-rule) | Per-element container selection, condition representation, CSSContainerRule, and query evaluation. Computed-style facts belong to style processing; size/scroll facts and their freshness require explicit external owners. |
| [Conditional 5 extensions](https://drafts.csswg.org/css-conditional-5/#at-supports-ext) | Additional support-query forms, `@when`/`@else` chains, and named `@supports-condition` queries. Review the draft's open issues and select the supported forms before designing their implementation. |
| Font, keyframe, page/margin, counter-style, and other family rules | Descriptor/property distinctions, family-specific grammars, CSSOM interfaces, and consumers belong to their contributing modules. Follow the [property families](../../props/ROADMAP.md), [fonts](../../../fonts/ROADMAP.md), and [animation](../../../animation/ROADMAP.md) owners; do not route every declaration through the element-property registry. |

## Rule disagreements and gaps

The enabled [rule scenarios](../../../../test/stylelet/scenarios/rules.test.ts)
check Browlet before marking a separate native-browser expectation as failing.

- `SPEC_CLASH(detached-group-rule-insertion)`: follow [CSSOM](https://drafts.csswg.org/cssom/#dom-cssgroupingrule-insertrule)
  and Chromium/WebKit: a detached style rule remains editable. Firefox throws
  `NS_ERROR_FAILURE`. Parent/list identity and subtree cleanup are tested separately.
- `SPEC_CLASH(namespace-insertion-error-order)`: follow [CSSOM](https://drafts.csswg.org/cssom/#insert-a-css-rule)
  and Firefox: a namespace inserted after a style rule throws HierarchyRequestError
  before the namespace-edit restriction. Chromium/WebKit throw InvalidStateError.
- `SPEC_CLASH(important-declaration-order)`: follow [CSSOM's specified order](https://drafts.csswg.org/cssom/#concept-declarations-specified-order)
  and Firefox: `color: red !important; opacity: .5; color: blue` retains color first.
  Chromium/WebKit retain the important value but move it after opacity. Ordinary
  repeated declarations use the last winning position in all three browsers.
- `SPEC_GAP(margin-descriptors-interface)`: [CSSOM](https://drafts.csswg.org/cssom/#the-cssmarginrule-interface)
  references CSSMarginDescriptors but defines no interface; no other local CSSWG
  draft supplies it. The approved provisional subtype extends CSSStyleDeclaration
  without attributes. Chromium exposes CSSStyleDeclaration for margin styles;
  Firefox/WebKit do not expose this descriptor interface. Revisit before page support.
- `SPEC_GAP(page-selector-algorithms)` and `SPEC_GAP(page-rule-serialization)`:
  CSSOM leaves the named page-selector algorithms and page-rule serializer as
  editorial issues. Their implementation remains explicitly unfinished, alongside
  [Paged Media's grammar](https://drafts.csswg.org/css-page-3/#syntax-page-selector).

## Rule mutation ownership

- [ ] Connect retained nested rules to cascade participation in source order.
  Direct selector matching does not establish that missing traversal.
- [ ] Preserve the enclosing style rule's matching and pseudo-elements for
  nested declaration runs inside groups; an invented `& { ... }` rule is not equivalent.
- [ ] Extend the tested style/nested-declaration mutation path to conditional
  and page groups, including family-specific child restrictions and serialization.
- [ ] Traverse future group-rule descendants when refreshing nested selectors;
  direct nested style-rule edits already refresh bindings and specificity.

Declaration edits already update the state the engine reads. Regressions cover
nested-rule survival, separate later declaration runs, and parent-sheet links
after removal/replacement. There is no declaration copy-back callback or
independent interpreted tree to keep synchronized.

Discarded nested rules do not split declaration runs, following the reviewed
browser behavior. The continuing Syntax disagreement and issue link are recorded
in the [syntax roadmap](../../syntax/ROADMAP.md#parser-disagreements).

## Checks that must accompany implementation

Use complete sheet input through CSSOM and the engine as well as narrow parser
tests. Cover a declaration before and after a nested rule, nested groups, a
nonmatching condition whose children remain observable, namespace context after
insertion/replacement, and retained rule references after removal. These are
acceptance cases for future changes, not tests claimed to pass today.

Keep invalid/unknown-rule recovery distinct from deliberately unsupported
standard rules. Preserve source order, origin/base URL, and tree context rather
than reconstructing them later. Imported resources and container geometry are
stopping points until their owning contracts are available.
