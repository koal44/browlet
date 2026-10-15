# HTML reflection roadmap

## Implemented slice: HTML §§2.6.1–2.6.3

[Reflection](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes)
connects content attributes to typed author-facing IDL attributes. Declarations
carry annotations; Browlet supplies `htmlExtendedAttributeHooks` to `BindingWorld`
from `integration/web-idl/`. The HTML handler selects rules once after Web IDL
resolves member types, including typedefs and interface implementations. Generic
Web IDL owns the extension point, conversion, receiver checks, realm selection,
and platform projection; the hook supplies HTML's behavior.
Declaration tests validate every declaring or including interface's implementation,
including shared mixins, and reject static reflection or token-list reflection on
internals. Production preparation trusts those contracts and selects typed Element
or ElementInternals attribute operations for each owner. Getters and setters need
no target-kind discriminator; shared mixins retain one projected-array cache across
their includers and realm registrations.

Reflection helpers produce records with `kind: 'reflection'`; the HTML hook
selects that record directly rather than searching a list of reflection names.
Numeric defaults and ranges belong to the selected reflection annotation.
Core's `reflect({ default: 1, range: [1, 1000] })` carries both in one record;
the HTML hook reads them directly. The helpers share one options type and return
one reflection record with optional metadata. The declaration audit checks
whether each option applies: only plain reflection supports a range, the other
numeric behaviors support a default, and URL, setter-only, enumerated, and
token-list reflection support neither numeric modifier. Serialization emits the specification's separate
`[ReflectDefault]` and `[ReflectRange]` annotations without changing the declaration.
The declaration audit rejects standalone modifiers; it also checks the reflected
member's numeric type and integer/decimal literal requirements.

`[ReflectEnumerated]` is Browlet's shorthand for HTML's prose-defined reflection
limited to known values. Web IDL Core's `reflectEnumerated(definition)` records
that annotation and an opaque `unknown` definition; the declaration tests check it.
The helper does not build accessors. This is project
notation, not a specification gap or a behavioral disagreement. Core's
`reflectTokens(attribute)` records `[ReflectTokens]` for all DOMTokenList reflection.
The opaque payload is a DOM `TokenListAttribute` record containing the attribute name
and supported tokens, shared by bindings and internal callers. Null supported tokens
make `supports()` throw; an empty set makes it return false. Both still permit
arbitrary tokens in the attribute. These annotation metadata payloads are omitted
from IDL serialization. The source IDL comments retain the specification's notation.

| Source | Contract |
| --- | --- |
| `rules.ts` | Strings, nullable strings, scalar strings, boolean presence, canonical enumerated keywords, signed/unsigned limits, getter-only ranges, defaults, and finite-double reflection over the existing microsyntax parsers |
| `element-associations.ts` | Explicit weak associations, live tree-scope and ID lookup, and interface filtering; no platform objects |
| `../../../web-idl/core/types.ts` and `helpers.ts` | Annotation records and data-only builders carrying opaque enumerated or token-list definitions |
| `../../integration/web-idl/reflection.ts` | `[Reflect]` variants, `[ReflectEnumerated]`, and `[ReflectTokens]`; prepared accessors, resolved interface filtering, and cached projected arrays |
| `../../integration/web-idl/reflection-target.ts` | Binding adapters for ordinary DOM attributes or ElementInternals' separate internal content-attribute map |

`ElementImpl` owns lazily created token lists and explicit-reference state.
`ElementInternalsImpl` owns independent reference state and content-attribute
read/write/delete operations over its target element's internal map. Both owners expose `getAssociatedElements(name,
targetConstructor, isArray)` and `setAssociatedElements(name, value)` to implementation
callers. `ElementAssociations.get()` handles the single-element/list choice; its
owner argument supplies the tree scope, while the constructor filters target types.
Assignment maps are allocated only by setters; reads recompute live scope and ID
matches, computing the owner's initial root once per list read. The setter accepts
either shape or null to clear it. Ordinary DOM writes cannot clear the
internals' associations.
Ordinary null-namespace attribute changes update token views and clear explicit
associations, including equal-value and attached `Attr` writes. Specialized
classes no longer duplicate blocking-list fields and forwarding. The projected
array cache stays in the integration, shared across the world's realms;
`BindingContext.createFrozenArray()` accepts the already-resolved type and delegates
to Web IDL's converter for receiver-realm allocation and element projection.

Existing crossOrigin, referrerPolicy, fetchPriority, loading, blocking, slot name,
and base target declarations use the supplied hooks. Base href retains its fallback-base
getter and uses `[ReflectSetter]` for writes. Nonce retains its separate internal
state and hiding behavior. DOM id/className/classList/slot remain existing DOM primitives.

Under [§2.6.3](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#using-reflect-in-specifications),
loading algorithms read content attributes or their interpreted state directly.
Associated-element methods are the exception: internal callers use them without
invoking projected getters or accessing the binding cache.

## Remaining dependencies and review

- **ElementInternals (§4.13.7):** the concrete owner now supplies internal
  attribute access, associated-element operations, and shadow-root access.
  `HTMLElement.attachInternals()` still depends on custom-element definitions
  and construction checks. ARIAMixin, form-associated APIs, and CustomStateSet
  remain unfinished; the test-only reflected members do not expose those APIs.
- **Custom-element reactions (§4.13.6):** declarations retain `[CEReactions]`, but
  entry/exit and delivery remain missing. Binding must wrap the complete operation;
  primitive reflection helpers must not open another reaction boundary. The
  extension facility currently prepares attribute accessors only; operation,
  setter, and deleter wrapping belongs to the custom-element reaction slice.
- **Reviewed callable shape:** associated-element helpers receive the owner,
  attribute name/value, and the target implementation constructor for Web IDL interface `T`.
  The HTML binding integration supplies the constructor selected by assembly; ID lookup
  uses `instanceof` without creating a separate predicate. This preserves
  first-match filtering without importing node classes into this lower-level module.
- **ID indexing:** lookup currently walks the ordinary root's tree. A future
  tree-scope index must preserve duplicate-ID/interface filtering, root inclusion,
  case sensitivity, and the absence of empty IDs.
- **Attribute storage and token caches:** preserve order, namespace lookup,
  identity, and live updates when revisiting performance; see the
  [DOM follow-up](../../dom/nodes/ROADMAP.md#attribute-lookup-and-token-list-performance-follow-up).
- HTML §§2.6.4–2.6.5 collections remain the next slice.

## Browser disagreements and specification gap

The 2026-10-12 Playwright probe used Chromium 149, Firefox 151, and WebKit 26.5.
It exercised native `ariaControlsElements`; the checked-in binding fixture covers
the underlying algorithms without adding unfinished ARIA APIs.

**SPEC_CLASH(reflected-elements-initial-empty).** On a first read with
`aria-controls=""`, Chromium/WebKit return a frozen empty array; Firefox returns
null. The [literal initial cache](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-elements)
also permits null because its list starts empty while its object starts null.
Browlet follows the approved Chromium/WebKit behavior: a present empty result
produces `[]`, independent of getter history, and equal contents reuse that array.
An absent attribute still produces null.

**SPEC_CLASH(reflected-element-detached-scope).** For explicit references in a
detached parent/child tree, Chromium/Firefox retain both parent-to-child and
child-to-parent references. WebKit retains only the latter. HTML's strict
descendant-of-a-shadow-including-ancestor wording excludes detached roots on
either side. Browlet follows the approved Chromium/Firefox inclusive tree scopes:
the owner's ordinary tree, followed by each enclosing shadow host's ordinary
tree. This does not expose candidates inside unrelated shadow trees.

**SPEC_GAP(reflect-positive-fallback-double).**
[§2.6.2](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#xattr-reflectpositivewithfallback)
permits `[ReflectPositiveWithFallback]` on double, but §2.6.1 defines fallback
only for unsigned long. HTML's current uses are textarea cols/rows, both unsigned
long; there is no native double consumer to probe. The declaration audit rejects
this unused combination until its behavior is defined. Production preparation
trusts that audit; a future consumer must resolve this gap before adding the annotation.

## Validation and stopping point

`test/browlet/html/reflection/` uses real Browlet realms, DOM implementations,
and a separate binding world for test-only members. It covers numeric limits and
conversion, URL/custom getters, live token lists, duplicate IDs and subtypes,
shadow scope, attribute synchronization, frozen-array caching, and cross-realm
adoption/borrowed accessors. `internals.test.ts` verifies the separate defaults
and association state through real bindings, plus eligible closed-shadow access.
Existing HTML attribute, lazy-loading, nonce,
base-URL, and slot tests cover the migrated production declarations.

The concrete ElementInternals dependency is present. Its focused tests do not
establish custom-element attachment, forms, ARIA, or reaction support. Remove this
roadmap only after those dependencies are resolved.
