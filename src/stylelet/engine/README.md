# Style engine

This folder connects stylesheet collections, declaration selection, and the
current computed-style query. The [roadmap](ROADMAP.md) records what is missing;
this is not a complete cascade or computed-style implementation.

## Entry points and retained state

| Entry or owner | Current behavior |
| --- | --- |
| [CascadeEngine](cascade-engine.ts) | Holds the StyleletContext, environment base URL, and registration map; creates sheets, selects declarations, and computes style queries. |
| [ComputedStyle](computed-style.ts) | Retains existing property definitions with computed whole values, ordered names, and lazy value serialization for a query result. |
| [TreeScope](tree-scope.ts) | Holds ordered header/tree sheets, adopted sheets, and stylesheet-set selection. `finalStyleSheets()` yields associated sheets followed by adopted sheets. This is not CSS `@scope`. |
| [createSystemColorPalette()](system-colors.ts) | Creates independent fixed defaults with host-selected overrides; the engine supplies these absolute colors to value resolution. |
| `getActiveStyleSheets()` | Filters those sheets by `disabled`; it does not evaluate media or grouping-rule conditions. |
| `getCascadedPropertyForElement()` | Matches selectors and selects a declaration for one property and element. |
| `getComputedStyle()` | Computes a snapshot using local declaration/value maps and lazy parent-value lookup. |
| `getCascadedProperty()` | The element-free helper uses zero specificity and does not match selectors. Registration/provenance tests use it; it is not the element style-query path. |
| `getPropertyContext()` | Supplies the host palette, URL construction, tree scope, and sheet base/location or environment base. It does not supply inheritance, custom-property values, or font/layout facts. |

There is no persistent computed-style tree or per-element cache here. Declaration,
built-in/custom-value and shorthand-expansion maps, plus the active property-dependency stack, are local to
`getComputedStyle()` and passed to the engine methods that need them. Ancestor
declarations are selected once per query; their custom values are computed only
when inherited or referenced. The returned CSSOM object retains a separate
ComputedStyle collection; the intermediate maps are discarded. This collection
has no DOM owner and creates neither property definitions nor interpreted declarations.
Reuse across queries needs invalidation for
DOM, stylesheet, registration, and host-input changes.
The selector caches belong to [StyleletContext](../context.ts); stylesheet
collections and registration lookup are different state with different owners.

TreeScope retains ordinary implementation lists, including adopted sheets.
Binding supplies the observable array for author access. Its declared mutation
step checks the sheet's constructor document against the root's current node
document; internal list changes remain visible without reprojecting the array.
Browlet supplies separate shadow-root scopes, but the computed-style caller
does not yet choose them or implement shadow encapsulation precedence. A query
that needs an unavailable shadow scope now throws explicitly. DOMOperations
supplies the flat-tree inheritance parent; the standard DOM adapter sees open
slot assignment, while closed roots require host-supplied operations.

## Declaration selection

The engine's declaration selection visits each sheet's authoritative rule list and reads
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

[`CascadeEngine.getComputedStyle()`](cascade-engine.ts) currently:

1. Reads accepted inline declarations through `DOMOperations.inlineStyleBlock`.
   An absent provider permits raw-attribute parsing; an authoritative empty
   result does not. This preserves Browlet's CSP decision.
2. Selects matching sheet declarations for all names in one traversal, including
   custom names absent from the built-in registry.
3. Selects between inline and matched-sheet declarations. At equal importance,
   inline wins; an important sheet declaration beats a normal inline one.
4. Computes every installed built-in, substituting `var()` and reparsing its
   consuming grammar. Missing or invalid winners use initial/inherited metadata;
   `initial`, `inherit`, and `unset` work before or after substitution. Pending
   margin longhands share one shorthand expansion per element and query, while
   overridden sides retain their own winners. Installed names remain color,
   background-color, opacity, and the four margin longhands.
5. Computes unregistered custom properties, using their guaranteed-invalid
   initial value, substituting `var()`, and applying `initial`, `inherit`, and
   `unset`, including keywords produced by substitution. Inheritance
   shares the parent's computed token value without serializing or reparsing it.
   A valid empty value remains distinct from guaranteed-invalid.
6. Collects existing property definitions and resulting whole values in ComputedStyle,
   then exposes that collection through a new readonly CSSStylePropertiesImpl.
   The results have no declaration importance; guaranteed-invalid custom values
   are excluded. Property records still own serialization, and shorthands read
   the retained longhand values.

Both built-in and custom `revert`/`revert-layer`, registered custom computation,
`first-valid()` margin expansion, and substitution functions other than `var()`
reach explicit throwing boundaries. WholeValue selects the first supported
`first-valid()` argument without substituting unused alternatives or retrying
after a selected argument fails computation.
Relative built-in values can remain unresolved when reference facts are missing.
The engine supplies host system colors to selected and initial values, including
`CanvasText`; absent host palettes use independent fixed light defaults.
Per-element color-scheme selection, currentColor's used-value inputs, and
font/viewport/layout inputs remain unfinished.
The `Computed` argument therefore does not establish a complete computed value.

The result is a snapshot. CSSOM's live resolved-value object and Typed OM's
computed-value map require additional contracts described in the
[CSSOM roadmap](../cssom/ROADMAP.md#computed-results-and-external-facts).
Inline style does not own computed state.

### Custom-property substitution

The engine calls the retained `CustomProperty` with a guarded lookup of
computed custom values. The record delegates component replacement to `SubstitutionValue`.
Guards pair the property name with the element, so inherited
names do not falsely form cycles. Re-entering a guard invalidates every participant;
fallbacks outside the cycle can still succeed. A failed substitution does not
revive an earlier declaration. Cycle invalidation precedes CSS-wide defaulting.

`SubstitutionValue` follows [Values 5 Appendix A](https://drafts.csswg.org/css-values-5/#arbitrary-substitution)
and [Variables 1](https://drafts.csswg.org/css-variables-1/#using-variables):
argument validation, early `...` expansion, dynamic names, and lazy fallbacks.
An argument whose structure depends on spread is checked after that expansion.
The engine owns property guards; WholeValue and CustomProperty receive their guarded lookup through
`context.getCustomProperty`. The substitution algorithm receives a lookup of computed
custom properties. Attribute/custom-function guards and animation/attribute taint
remain explicit dependencies of those unfinished functions and registration.

Composition retains component objects and their source spelling, rebuilding
only changed lists/blocks. Adjacent tokens get a comment separator when needed,
so substituting a number before an identifier does not turn them into a dimension.
Expanded sequences are limited to 65,536 underlying tokens, including block
delimiters, before allocating their combined arrays/text. Literal values are not
subject to that substitution limit.

## Registration lookup

`CascadeEngine.collectCustomPropertyRegistry()` collects the last CSSPropertyRuleImpl
for each name in active sheets, then overlays the explicit `registeredPropertySet`. Those
implementations can be constructed directly, but stylesheet parsing does not
create them. The engine map stands in for document registration state; there is no
connected `CSS.registerProperty()` API or registered-property computation.
Each style query assembles this registry once and supplies the map through
PropertyContext's RegistryContext. CustomProperty reads it during computation;
it does not capture a registration when the declaration is parsed.
Registered computation remains an explicit error until its lifecycle is implemented.
The current collection covers the supplied tree scope; gathering registrations
across all shadow scopes into the document-wide registry remains unfinished.

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
The [computation tests](../../../test/stylelet/unit/engine/computed-style.test.ts)
cover custom inheritance, defaulting, invalid versus empty values, substitution,
cycle ordering, bounded expansion, and mutation.
The [ordinary-property tests](../../../test/stylelet/unit/engine/ordinary-properties.test.ts)
cover reparsing, initial/inherited fallback, pending margin expansion, shared
declaration freshness, and computation without serialized-source requests. Failed
expansions are cached once per occurrence, and distinct occurrences stay separate.
[Ordinary-property browser cases](../../../test/stylelet/ordinary-properties.contracts.ts)
cover the connected bindings, including empty/invalid margin replacements,
inheritance of computed margins, and repeated edits through rule declarations.
The 2026-10-22 comparisons isolate Firefox's
[pending-occurrence difference](#pending-shorthand-occurrences) and the approved
[deferred source serialization differences](../cssom/declarations/ROADMAP.md#continuing-browser-differences).
[Shared browser cases](../../../test/stylelet/custom-properties.contracts.ts)
exercise Browlet's real bindings before each Chromium/Firefox/WebKit comparison.
They also cover copying computed values, preserving declared text while computing,
and refreshing inherited results after edits.

### Computed custom-value serialization

`SPEC_CLASH(custom-property-uuid-serialization)`: follow Variables 1's
[exact-source requirement and UUID example](https://drafts.csswg.org/css-variables-1/#serializing-custom-props).
In the 2026-10-22 substitution comparison, Browlet, Chromium, and Firefox retain
`12345678-12e3-8d9b-a456-426614174000`. WebKit inserts `/**/` before `-12e3` and
`-8d9b`, even though those tokens came from the same unchanged source sequence.
Eric approved preserving the UUID and isolating WebKit's native comparison.
The case covers inheritance, copying the computed result, and subsequent edits.

Copying an empty computed custom value also exercises the previously approved
[single-space serialization choice](../cssom/declarations/ROADMAP.md#continuing-browser-differences).
The three browsers return empty text, which removes the destination in
`setProperty()`. Browlet returns one space and keeps an empty custom value.

### Guaranteed-invalid enumeration

`SPEC_CLASH(guaranteed-invalid-enumeration)`: CSSOM's
[getComputedStyle algorithm](https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle)
excludes custom properties whose computed value is guaranteed-invalid. In the
2026-10-21 comparison, Chromium, Firefox, and WebKit still enumerate a property
explicitly reset to `initial`; their value reads correctly return empty text.
Eric approved following CSSOM. The three native enumeration cases are independent
expected failures, with Browlet asserted before the failure annotation; value
and defaulting comparisons remain ordinary passing expectations.

### Substitution draft differences

Eric approved the following choices after Chromium, Firefox, and WebKit probes
on 2026-10-22. Each native comparison is separate, and Browlet's assertion runs
before any expected-failure annotation. Rechecked with Playwright 1.64.1.

The current
[var replacement algorithm](https://drafts.csswg.org/css-variables-1/#using-variables)
substitutes a fallback only when needed. All three browsers now agree, including
`--b: var(--a, var(--b))` when `--a` has a valid value; the lazy-fallback clash
marker and expected failure have been removed.

- `SPEC_CLASH(var-argument-grammar)`: follow the current
  [argument grammar and spread rules](https://drafts.csswg.org/css-values-5/#early-resolution).
  Chromium/Firefox reject dynamic names (`var(var(--name))`) and a non-custom name
  before it can use its fallback; WebKit now agrees with the draft for these cases.
  All three browsers still reject early spread (`var(...var(--args))`).
  They also retain braces around a fallback where the draft strips one enclosing
  brace block. The draft behavior is tested separately for each feature/browser.
  The margin suite independently covers the same approved name-validation rule
  for a pending shorthand; Chromium/Firefox remain expected failures there.
- `SPEC_CLASH(custom-property-eof-serialization)`: follow Variables 1's
  [original-source requirement](https://drafts.csswg.org/css-variables-1/#serializing-custom-props),
  retaining missing EOF delimiters as Chromium does. Firefox completes blocks,
  strings, and URLs; WebKit completes strings/URLs but retains unclosed block
  spelling. The component structure is closed internally and substitution never
  reparses the resulting text. For example, `f(var(--n)` with `--n: red` retains
  `f(red`, even when that computed sequence is inserted before more tokens.

### Pending shorthand occurrences

`SPEC_CLASH(pending-shorthand-occurrence)`: follow
[Values 5's pending-longhand cascade](https://drafts.csswg.org/css-values-5/#substitution-in-shorthands)
and [CSSOM's removal algorithm](https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-removeproperty).
Expansions belong to their original shorthand occurrence. A single element can
have winning sides from different `margin` declarations after CSSOM removes
individual longhands.

The 2026-10-22 regression combines a stylesheet's `margin: var(--sheet)`
(`--sheet: 1px 2px`) with inline `margin: var(--inline)` (`--inline: 3px 4px`),
then removes the inline top and bottom declarations. All three browsers remove
those names from the inline block. Browlet, Chromium, and WebKit compute
`1px 4px`; Firefox computes `3px 4px`. Replacing the remaining inline pending
sides with ordinary values restores Firefox's stylesheet-derived top/bottom.

The inspected Gecko `servo/components/style/properties/mod.rs` defines
`ShorthandsWithPropertyReferencesCache` with `(ShorthandId, LonghandId)` keys,
which is consistent with the observed reuse across occurrences. Our query-local
cache keys the original `PendingShorthand` object. Eric approved preserving this
behavior and marking only Firefox's native comparison as an expected failure;
the Browlet assertion remains before that annotation.

The [cascade and value baseline](../README.md#cascade-and-values)
records the run and its skips/expected failures. It does not establish complete
conformance, browser agreement or performance.
