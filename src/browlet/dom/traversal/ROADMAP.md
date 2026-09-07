# DOM traversal roadmap

## Audit outcome

Traversal is self-contained once node topology, callback invocation, and
realm-correct `DOMException` creation exist. It does not require an event loop.
Only `NodeIterator`'s pre-remove adjustment is an early dependency of the DOM
§4 mutation spine; the public traversal interfaces can otherwise follow that
spine as a bounded feature.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `node-filter.ts` | `NodeFilter`, all current and legacy constants, `whatToShow`, callback invocation, and reentrancy protection | DOM §6.4, `#interface-nodefilter` |
| `node-iterator.ts` | `NodeIterator`, iterator collection, reference/candidate pointers, forward/backward traversal, no-op `detach()`, and pre-removing steps | DOM §6.2, `#interface-nodeiterator` |
| `tree-walker.ts` | `TreeWalker`, mutable current node, and parent/child/sibling/tree-order traversal with accept/skip/reject semantics | DOM §6.3, `#interface-treewalker` |
| existing `../nodes/document.ts` | Project and implement `createNodeIterator()` and `createTreeWalker()` | DOM §4.5 and §6 |

`Document.createNodeIterator()` and `createTreeWalker()` are already declared;
they should remain visibly incomplete until these objects exist. Blink's
`core/dom/node_iterator.*`, `node_iterator_base.*`, and `tree_walker.*` show
that iterator mutation adjustment belongs beside traversal, not in Document.

The DOM §4 mutation spine must nevertheless expose exactly one pre-remove
participant point before it is considered complete. `NodeIterator` will own
the registered iterator state and its pre-removing steps here; the mutation
core must not grow traversal-specific state or let raw removals bypass the
participant.

## Behavioral details worth preserving

- Filtering must set and clear the traverser's active flag around the Web IDL
  callback, including when the callback throws. Recursive filtering throws a
  realm-correct `InvalidStateError`.
- `whatToShow` is applied before invoking the filter. For `TreeWalker`,
  `FILTER_REJECT` prunes descendants while `FILTER_SKIP` can still traverse
  them; `NodeIterator` does not use rejection to prune a subtree.
- A `NodeIterator` candidate pointer is observable indirectly when a filter
  mutates the tree. Pre-removing steps must adjust both the committed reference
  and any in-flight candidate.
- `TreeWalker.currentNode` follows the standard's unrestricted setter; do not
  add a defensive root-membership check which DOM does not require.
- `NodeIterator.detach()` is deliberately a no-op compatibility method.
  Likewise, `SHOW_ENTITY_REFERENCE`, `SHOW_ENTITY`, and `SHOW_NOTATION` remain
  exposed legacy constants even though DOM §11 removed those node interfaces.

Tests should construct traversers through the public `Document` methods, use
JavaScript function and object filters, distinguish skip from reject, cover
callback exceptions/reentrancy, and mutate/remove nodes during filtering. A
test of a private pointer-adjustment helper alone would preserve mechanics
rather than the traversal contract.

## Delivery order

1. Define the callback interface/constants and shared filter algorithm.
2. Implement `TreeWalker`; it has no mutation registry and gives Selectlet's
   existing TreeWalker-capable path a real Browlet consumer.
3. Implement `NodeIterator` together with the mutation spine's pre-remove
   registration and in-flight-candidate behavior.
4. Project both factories and interfaces through Web IDL, then remove the
   corresponding type-only stubs.

## Removal condition

Burn this file after the three interfaces work through the public Browlet
surface against live, mutating trees.
