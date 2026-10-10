# DOM traversal roadmap

## Audit outcome

Traversal is self-contained once node topology, callback invocation, and
realm-correct `DOMException` creation exist. It does not require an event loop.
Only `NodeIterator`'s pre-remove adjustment is an early dependency of the DOM
§4 mutation spine; the public traversal interfaces can otherwise follow that
spine as a bounded feature.

DOM 4C implements NodeFilter and NodeIterator through
`Document.createNodeIterator()`, including filter identity, callback invocation,
forward/backward traversal, and pre-removal adjustment. Iterators register weakly
by their fixed traversal root; removal visits registrations on ancestors of the
removed node. An iterator rooted within a detached/adopted subtree retains its
cursor and registration. Traversal sits below nodes in the import hierarchy,
retaining concrete node types without loading their implementation classes.

| Source | Contract | Specification |
| --- | --- | --- |
| `node-filter.ts` | `NodeFilter`, all current and legacy constants, `whatToShow`, callback invocation, and reentrancy protection | DOM §6.3, `#interface-nodefilter` |
| existing `node-iterator.ts` | `NodeIterator`, iterator collection, reference/candidate pointers, forward/backward traversal, no-op `detach()`, and pre-removing steps | DOM §6.1, `#interface-nodeiterator` |
| `tree-walker.ts` | `TreeWalker`, mutable current node, and parent/child/sibling/tree-order traversal with accept/skip/reject semantics | DOM §6.2, `#interface-treewalker` |
| existing `../nodes/document.ts` | Project and implement `createNodeIterator()` and `createTreeWalker()` | DOM §4.5 and §6 |

`Document.createTreeWalker()` and TreeWalker remain unimplemented. Blink's
`core/dom/node_iterator.*`, `node_iterator_base.*`, and `tree_walker.*` show
that iterator mutation adjustment belongs beside traversal, not in Document.

The DOM §4 mutation spine calls the pre-remove participant before unlinking a
node. NodeIterator owns its state and adjustment here; the mutation core must
not grow traversal-specific state or let raw removals bypass the participant.

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

## Reentrant-filter compatibility choice

`SPEC_CLASH(nodeiterator-reentrant-filter)` records Browlet's approved choice to
follow Firefox: recursive `nextNode()` and `previousNode()` calls throw
`InvalidStateError` before changing the active traversal's candidate pointer,
including when no node remains in that direction. An uncaught error aborts the
outer traversal; if the filter catches it, the outer traversal continues with
its candidate intact and still participates in removal adjustment.

DOM's [traversal algorithm](https://dom.spec.whatwg.org/#concept-nodeiterator-traverse)
changes the candidate before the
[filtering algorithm](https://dom.spec.whatwg.org/#concept-node-filter) checks
the active flag. An inner call can clear the outer candidate before returning
to the filter, or return null without reaching the check. Keep the clash marker
until the specification and browser behavior converge.

The 2026-10-09 probe found Firefox 151 preserved the outer cursor and rejected
both recursive directions. WebKit 26.5 lost the outer reference; recursive
`previousNode()` returned null instead of throwing. Chromium did not complete;
Playwright reported `Target crashed` after the probe's timeout, so the exact
failure mechanism remains unconfirmed. Source/probe details are in
[`scratch/DOM-4C-ITERATOR-REENTRANCY.md`](../../../../scratch/DOM-4C-ITERATOR-REENTRANCY.md).

The [NodeIterator regressions](../../../../test/browlet/dom/traversal/node-iterator.test.ts)
cover both recursive directions, caught and uncaught errors, cursor preservation,
and removal during a filter after it catches the error.

## Remaining work

1. Implement `TreeWalker`; it has no mutation registry and gives Selectlet's
   existing TreeWalker-capable path a real Browlet consumer.
2. Project TreeWalker and its factory, reusing the NodeFilter declaration and
   preserving its distinct skip/reject semantics.

## Removal condition

Burn this file after the three interfaces work through the public Browlet
surface against live, mutating trees.
