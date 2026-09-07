# DOM infrastructure roadmap

## Present

- `tree.ts`: the parent/child/sibling topology and tree-order queries needed
  to represent DOM §1.1 (`#trees`). Its insertion methods are storage
  primitives, not substitutes for the full DOM §4 mutation algorithms.
- `ordered-set.ts`: ordered-set parsing and serialization (DOM §1.2,
  `#ordered-sets`).
- `name-validation.ts`: namespace/name validation (DOM §1.4,
  `#namespaces`).

The remaining tree vocabulary in §1.1 is mostly terminology over these
relationships. Add a named helper only when a normative consumer makes it
useful; do not mirror every defined term with an otherwise unused function.

## Selector integration

DOM §1.3 (`#selectors`) supplies one integration algorithm: parse a selectors
string, throw a realm-correct `SyntaxError` `DOMException` on failure, and
match against the node's tree root using the node as the scoping root.

Selectlet already parses and matches against Browlet nodes, but the current
test calls Selectlet directly. Browlet does not yet expose `querySelector()`,
`querySelectorAll()`, `closest()`, `matches()`, or
`webkitMatchesSelector()`. Add one narrow scope-match adapter rather than a
second selector implementation. The DOM §4 callers then own first-result,
static-`NodeList`, and inclusive-ancestor behavior.

Behavioral coverage must include the scoping root, matching from the tree
root, a detached subtree, selector-list ordering where observable, and the
realm of the `SyntaxError`. Do not assert Selectlet parser internals.

## Dependencies

- Infra collection and string concepts are represented with ordinary
  TypeScript values; they do not require a parallel runtime abstraction.
- Selector parsing and matching belong to Selectlet.
- Encoding, XML, XML Namespaces, and stylesheet-association requirements are
  consumed by the later parsing and node APIs that cite them.
- Trusted Types applies at the later DOM APIs accepting trusted strings; it is
  not a prerequisite for the §1 tree and name primitives.

Revisit `tree.ts` only as DOM §4.2.3 mutation algorithms add MutationObserver,
range, slotting, custom-element reaction, and HTML
insertion/post-connection/removing/moving hooks (HTML §2.1.4).

Blink also shares tree primitives across `core/dom`; its selector machinery is
separate. That dependency direction is the useful precedent here.

## Removal condition

Burn this file once scope matching is exposed through the DOM APIs and DOM
mutation hooks are represented by explicit consumers rather than TODOs in the
tree primitives.
