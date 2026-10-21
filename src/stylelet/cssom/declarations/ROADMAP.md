# CSSOM declarations roadmap

The [README](README.md) describes the current objects. Continue the CSSOM
declaration audit here before treating their retained representation as settled.

## Declaration state and lifecycle

- [ ] Before closing the CSSOM audit, replace the provisional
  `CSSDeclarationBlock` class with plain declaration state or ownership by
  the appropriate implementation, unless review establishes a concrete need
  for the separate class. Audit inline style, style rules, descriptor rules,
  and computed results together. CSSOM defines an ordered collection and its
  associated state; that does not require this extra class. Element `.style`
  exposes `CSSStylePropertiesImpl`. Preserve observable identity and lifecycle
  behavior; current private-storage tests and `instanceof` consumers do not
  settle the representation.
- [ ] Make attribute input, author mutation, and engine reads explicit paths.
  Preserve one authorization/parsing path for first and later attribute inputs,
  CSSOM write-back bypass, and accepted state after a blocked replacement.
  Binding already replaces manual numeric properties and the mixin's
  `synchronizeIndices()` dependency; no observer layer was required.
- [ ] Audit supported-property lookup, custom-name case, empty/invalid values,
  priority, null conversion, order, shorthand expansion/removal/serialization,
  logical groups, and readonly/computed behavior. The current small registry
  cannot exercise every one of these rules.
- [ ] Preserve URL base/provenance per parsed declaration when enabling
  URL-valued properties. A block can contain declarations from different edits
  and bases; a later document base cannot replace that history.

CSSOM's abstract declaration-block creation steps initialize from an existing
owner attribute. They do not require our TypeScript constructor or the first
Platform access to perform that read. Browlet already delivers attributes
after element construction. An external host attaching to an existing node
must supply the initial input explicitly. Preserve this reviewed lifecycle
requirement while reconsidering the objects that carry it.

Descriptor grammars remain with their [rule families](../rules/ROADMAP.md).
The [computed-result contract](../ROADMAP.md#computed-results-and-external-facts)
requires engine invalidation and external facts; [Typed OM](../typed/ROADMAP.md)
must eventually share the chosen declaration state.
