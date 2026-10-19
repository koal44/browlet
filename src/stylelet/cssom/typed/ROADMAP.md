# CSS Typed OM roadmap

Planned implementations of Typed OM interfaces, alongside ordinary CSSOM.
Shared CSS representations and arithmetic remain in [values](../../values/ROADMAP.md).
StylePropertyMapImpl currently throws, as does CSSStyleRuleImpl.styleMap; there
are no typed value implementations or attributeStyleMap/computedStyleMap paths.

## Sources and interface families

Use [Typed OM 1](https://drafts.css-houdini.org/css-typed-om-1/) and the local
Houdini `css-typed-om/Overview.bs`. Interface, exposure, reification, and map
contracts were inspected; individual algorithms still need implementation
review. The inspected Level 1 draft includes color objects. Level 2 is largely
open issues and is not a reason to defer those Level 1 contracts.

| Family | Work and dependencies |
| --- | --- |
| CSSStyleValue.parse/parseAll | Supported property grammars, custom-property registration, typed reification, and specified unsupported/unparsed cases |
| Keyword, unparsed, and variable values | Retained components, variable references, mutation, and conversion without exposing arbitrary internal records |
| CSSNumericValue, CSSUnitValue, CSSMath subclasses | Units/types, arithmetic, conversion, errors, mutable API state, and identity; reuse value algorithms without requiring layout |
| CSSTransformValue and components | Component identity, numeric typing, and real DOMMatrix results from [geometry](../../../geometry/ROADMAP.md); never invent dimensions for relative values |
| Image and color values | Specified representations and explicit operations; image objects do not supply decoding, and serialization does not perform additional resolution |
| StylePropertyMap / StylePropertyMapReadOnly | Property-specific reification, list-valued entries, enumeration, and mutation; a list represents component values, not duplicate declarations |

Many values and read-only maps have worker/worklet exposure; parsing methods
and writable maps have narrower exposure. Use each interface/member's actual
IDL rather than installing the entire family wherever a helper is available.
The active host owns conversion, Platform objects, and realm-sensitive results.

## Declaration and computed views

- [ ] Put [declared maps](https://drafts.css-houdini.org/css-typed-om-1/#declared-stylepropertymap-objects)
  over the same declarations as ordinary CSSOM. CSSStyleRule.styleMap and
  ElementCSSInlineStyle.attributeStyleMap have SameObject identity. Edits through
  either API must reach the other and the engine; no parallel authoritative store.
- [ ] Implement [reification](https://drafts.css-houdini.org/css-typed-om-1/#reify-stylevalue)
  at the relevant stage, including registered custom properties and unparsed
  values. It cannot finish missing inheritance, substitution, or layout.
- [ ] Give Element.computedStyleMap a stable, live
  [computed map](https://drafts.css-houdini.org/css-typed-om-1/#computed-stylepropertymapreadonly-objects).
  It exposes computed values. Ordinary getComputedStyle creates a new live
  object with property-specific resolved values; neither API is a frozen copy.
- [ ] Connect retained computed-map reads to the engine's recomputation and
  invalidation contract. Map identity does not determine internal cache ownership.

## Delivery and checks

1. Settle [CSSStyleProperties and declaration ownership](../ROADMAP.md#projection-and-declaration-lifecycle)
   before adding the declared maps. Standalone numeric/value implementations
   can proceed independently; all of Typed OM is not an inline-style prerequisite.
2. Test typed construction, mutation, errors, exposure, and realm identity
   through bindings, alongside direct post-conversion arithmetic tests.
3. Prove declared-map edits through ordinary CSSOM and engine reads, including
   lists, custom properties, invalid values, and removal.
4. Prove retained computed maps after style/tree/registration changes once the
   [engine](../../engine/ROADMAP.md) can supply complete current computed values.
5. Add Geometry/resource/layout-dependent cases only with their real providers.

No extra declaration-storage class or generic typed-value adapter is prescribed.
The first implementation should establish concrete types and reusable operations.
