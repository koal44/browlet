# Stylesheet rule roadmap

The [README](README.md) describes the existing interpreter. This roadmap connects
Syntax, Namespaces, Nesting and Cascade/Conditional requirements to interpretation,
CSSOM state and engine reads. Property-family descriptors and complete cascade
evaluation retain their own owners.

## Missing rule contracts

All at-rules below are currently discarded by the interpreter. A future rule
needs its permitted syntax/context, retained representation, CSSOM behavior,
and actual consumer accounted for together; not every rule contributes element
declarations to the cascade.

| Rule / specification | Required owner or dependency |
| --- | --- |
| [`@namespace`](https://drafts.csswg.org/css-namespaces-3/#declaration) | Sheet-local prefix/default-namespace context for selector parsing, placement validation, and CSSNamespaceRule. Prefixes are independent of markup prefixes and do not propagate across imports. |
| [`@import`](https://drafts.csswg.org/css-cascade-5/#at-import) | Rule ordering, supports/media/layer qualifiers, imported sheet identity and origin, and CSSImportRule. Fetch/MIME/encoding/policy/completion belong at the host loader; a false supports condition must prevent fetching. |
| [`@media`, `@supports`](https://drafts.csswg.org/css-conditional-3/#processing) | Retained group children, CSSGroupingRule/CSSConditionRule derivatives, and condition evaluation. False conditions keep CSSOM children but exclude their declarations; changes require fresh applicability. |
| [`selector()` support queries](https://drafts.csswg.org/css-conditional-4/#at-supports-ext) | Selector support, including recursively unsupported forgiving arms and namespace context. The current declaration-only supports grammar is insufficient. |
| [`@layer`](https://drafts.csswg.org/css-cascade-5/#at-layer) | Statement/block forms, layer identity/order, import integration, CSSOM interfaces, and cascade precedence. Account for the statement form's exceptions to initial rule ordering. |
| [`@scope`](https://drafts.csswg.org/css-cascade-6/#scoped-styles) | Roots/limits, matching context, nesting interactions, proximity in cascade selection, and CSSScopeRule. This is not the existing document/shadow `TreeScope`. |
| [`@container`](https://drafts.csswg.org/css-conditional-5/#container-rule) | Per-element container selection, condition representation, CSSContainerRule, and query evaluation. Computed-style facts belong to style processing; size/scroll facts and their freshness require explicit external owners. |
| [Conditional 5 extensions](https://drafts.csswg.org/css-conditional-5/#at-supports-ext) | Additional support-query forms, `@when`/`@else` chains, and named `@supports-condition` queries. Review the draft's open issues and select the supported forms before designing their implementation. |
| `@property` | Registration interpretation/CSSPropertyRule in the Properties and Values API; existing record/registry types do not connect stylesheet input. See the [registration roadmap](../engine/ROADMAP.md#custom-property-registration). |
| Font, keyframe, page/margin, counter-style, and other family rules | Descriptor/property distinctions, family-specific grammars, CSSOM interfaces, and consumers belong to their contributing modules. Follow the [property families](../props/ROADMAP.md), [fonts](../../fonts/ROADMAP.md), and [animation](../../animation/ROADMAP.md) owners; do not route every declaration through the element-property registry. |

## Nesting and shared rule state

[Nesting 1](https://drafts.csswg.org/css-nesting-1/) supplies concrete requirements
beyond selector expansion:

- [ ] Preserve the first declaration run separately from later runs represented
  by [nested declarations rules](https://drafts.csswg.org/css-nesting-1/#nested-declarations).
  They retain parent matching/specificity, including pseudo-elements; an invented
  `& { ... }` rule is not equivalent. Add `CSSNestedDeclarations` and its
  CSSStyleProperties result at the CSSOM boundary.
- [ ] Interpret nested group rules with the nearest enclosing style rule's
  nesting context. Direct declarations in those groups need the same run
  representation; unknown children must not discard a valid group.
- [ ] Connect retained nested rules to engine participation in correct order.
  Current direct matcher tests do not exercise this missing traversal.
- [ ] Connect CSSOM child lists, parent associations, insertion/deletion, and
  declaration mutation to the same retained rule state. Before changing the
  current copy-back callback, reproduce its nested-content loss with a focused
  regression. The [CSSOM roadmap](../cssom/ROADMAP.md#rule-mutation-ownership)
  owns that implementation review.
- [ ] Reparse `selectorText` with sheet namespace and parent nesting context;
  preserve rule identity and update dependent child selectors/matcher caches.
  Audit serialization against [Nesting's CSSOM additions](https://drafts.csswg.org/css-nesting-1/#cssom).

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

## Related ownership

The [engine](../engine/ROADMAP.md), [lifecycle](../value-processing/ROADMAP.md),
and [value](../values/ROADMAP.md) roadmaps own cascade ordering, registration,
substitution, defaulting, and value stages. [Value inputs](../values/ROADMAP.md#context-inputs-and-freshness)
and [Typed OM](../cssom/typed/ROADMAP.md) retain their consumer contracts. Reuse
these owners rather than introducing a general rule registry or parser context
merely to distribute the work.
