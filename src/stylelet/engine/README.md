# Style engine

This folder connects stylesheet collections, declaration selection, and the
current computed-style query. The [roadmap](ROADMAP.md) records what is missing;
this is not a complete cascade or computed-style implementation.

## Entry points and retained state

| Entry or owner | Current behavior |
| --- | --- |
| [CascadeEngine](cascade-engine.ts) | Holds the StyleletContext, environment base URL, and registration map; creates sheets and delegates style queries. |
| [TreeScope](tree-scope.ts) | Holds ordered header/tree sheets, adopted sheets, and stylesheet-set selection. `finalStyleSheets()` yields associated sheets followed by adopted sheets. This is not CSS `@scope`. |
| `getActiveStyleSheets()` | Filters those sheets by `disabled`; it does not evaluate media or grouping-rule conditions. |
| `getCascadedPropertyForElement()` | Matches selectors and selects a declaration for one property and element. |
| `getCascadedProperty()` | The element-free helper uses zero specificity and does not match selectors. Registration/provenance tests use it; it is not the element style-query path. |
| `getPropertyContext()` | Supplies URL construction, tree scope, and sheet base/location or environment base. It does not supply inheritance, custom-property values, or font/layout facts. |

There is no engine-owned computed-style tree or per-element value cache here.
The selector caches belong to [StyleletContext](../context.ts); stylesheet
collections and registration lookup are different state with different owners.

TreeScope retains ordinary implementation lists, including adopted sheets.
Binding supplies the observable array for author access. Its declared mutation
step checks the sheet's constructor document against the root's current node
document; internal list changes remain visible without reprojecting the array.
Browlet supplies separate shadow-root scopes, but the computed-style caller
does not yet choose them or implement shadow encapsulation precedence.

## Declaration selection

[cascade.ts](cascade.ts) visits each sheet's authoritative rule list and reads
declarations from CSSStyleRuleImpl and its later CSSNestedDeclarationsImpl
children. CSSOM edits change the same data without a copy-back callback.
With an element, selector matching supplies the
matching specificity. Importance wins first, then specificity; later equal
candidates replace earlier ones. The result retains the declaration, sheet,
and TreeScope so a later value operation can recover its provenance.

This handles author normal/important declarations. Nested style rules are
retained but not matched here; at-rules are dropped earlier. Origins,
encapsulation precedence, layers, scope proximity, animation, and transition
contributions are not represented by this selection algorithm. See the
[rule inventory](../cssom/rules/README.md#parsing-and-ownership) for the earlier boundary.

## Current computed-style path

[computeStyle()](computed-style.ts) currently:

1. Reads accepted inline declarations through `DOMOperations.inlineStyleBlock`.
   An absent provider permits raw-attribute parsing; an authoritative empty
   result does not. This preserves Browlet's CSP decision.
2. Visits the seven installed property names: color, background-color, opacity,
   and the four margin longhands.
3. Selects between inline and matched-sheet declarations. At equal importance,
   inline wins; an important sheet declaration beats a normal inline one.
4. Resolves each selected built-in directly at `ValueStage.Computed`, using the
   available property context.
5. Returns a new readonly CSSStyleDeclarationImpl and declaration block.

An undeclared property is omitted. There is no defaulting or inheritance pass,
and custom properties are not included. CSS-wide keyword values currently
resolve to themselves; arbitrary substitution reaches an explicit throwing
stub. Relative values can remain unresolved when reference facts are missing.
The `Computed` argument therefore does not establish a complete computed value.

The result is a snapshot. CSSOM's live resolved-value object and Typed OM's
computed-value map require additional contracts described in the
[CSSOM roadmap](../cssom/ROADMAP.md#computed-results-and-external-facts).
Inline style does not own computed state.

## Registration lookup

[custom-property.ts](custom-property.ts) first checks the engine registration
map, then takes the last matching CSSPropertyRuleImpl in active sheets. Those
implementations can be constructed directly, but stylesheet parsing does not
create them. The engine map stands in for document registration state; there is no
connected `CSS.registerProperty()` API or per-element custom-property pipeline.

The [registration tests](../../../test/stylelet/unit/engine/custom-property.test.ts)
construct registrations and rules directly. Their URL tests manually invoke
registered-value parsing/resolution, including sheet base and local-fragment
tree scope. They do not establish author-facing registration or substitution.

## Evidence

The [cascade tests](../../../test/stylelet/unit/engine/cascade-engine.test.ts)
exercise matching, importance/specificity/order, provenance, and sheet mutation.
[TreeScope tests](../../../test/stylelet/unit/engine/tree-scope.test.ts) cover sheet
collections. [Host tests](../../../test/stylelet/unit/host.test.ts) exercise inline
selection and selected-value queries across DOM providers.
The [cascade and value baseline](../README.md#cascade-and-values)
records the run and its skips/expected failures. It does not establish complete
conformance, browser agreement or performance.
