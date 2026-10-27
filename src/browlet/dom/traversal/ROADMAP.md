# DOM traversal roadmap

## DOM §6 audit

Traversal is self-contained once node topology, callback invocation, and
realm-correct `DOMException` creation exist. It does not require an event loop.
Only `NodeIterator`'s pre-remove adjustment is an early dependency of the DOM
§4 mutation spine; the public traversal interfaces can otherwise follow that
spine as a bounded feature.

DOM 4C implemented NodeFilter and NodeIterator through
`Document.createNodeIterator()`, including filter identity, callback invocation,
forward/backward traversal, and pre-removal adjustment. Iterators register weakly
by their fixed traversal root; removal visits registrations on ancestors of the
removed node. An iterator rooted within a detached/adopted subtree retains its
cursor and registration. Traversal sits below nodes in the import hierarchy,
retaining concrete node types without loading their implementation classes.

The §6 pass completes TreeWalker and `Document.createTreeWalker()`.
`NodeTraverser` shares the mask, converted callback, and active-flag algorithm;
NodeIterator retains its early guard and mutation registry. TreeWalker has no
registry: removal leaves its current node in place, and its unrestricted setter
can select a node outside the root or in another document. Successful traversal
updates that position using live links, including changes made by the filter.

| Source | Contract | Specification |
| --- | --- | --- |
| `node-filter.ts` | `NodeFilter`, all current and legacy constants, callback adaptation, and original filter identity | DOM §6.3, `#interface-nodefilter` |
| `node-traverser.ts` | Shared `whatToShow`, callback invocation, active flag, and exception cleanup | DOM §6, `#concept-node-filter` |
| `node-iterator.ts` | `NodeIterator`, iterator collection, reference/candidate pointers, forward/backward traversal, no-op `detach()`, and pre-removing steps | DOM §6.1, `#interface-nodeiterator` |
| `tree-walker.ts` | `TreeWalker`, mutable current node, and parent/child/sibling/tree-order traversal with accept/skip/reject semantics | DOM §6.2, `#interface-treewalker` |
| `../nodes/document.ts` | Project and implement `createNodeIterator()` and `createTreeWalker()` | DOM §4.5 and §6 |

The public factories use the receiver Document's realm, including borrowed
methods and roots from another realm. Their filters retain original author
identity while callbacks receive projected nodes through Web IDL.

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

Tests construct traversers through the public `Document` methods and cover
all seven TreeWalker directions, filtered hierarchy, root boundaries, outside
current nodes, shadow isolation, function/object filters, integer conversion,
callback exceptions/reentrancy, and mutation during filtering. Shared-filter
tests cover all supported node kinds, invalid author inputs, and factory realms.
NodeIterator regressions also cover multiple cursors sharing a root and removal
which finds the next node through an ancestor's sibling.

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
[`node-compat/experimental/browser-probes/dom/ITERATOR-REENTRANCY.md`](../../../../node-compat/experimental/browser-probes/dom/ITERATOR-REENTRANCY.md).

The [NodeIterator regressions](../../../../test/browlet/dom/traversal/node-iterator.test.ts)
cover both recursive directions, caught and uncaught errors, cursor preservation,
and removal during a filter after it catches the error.

## Unrecognized filter results

Web IDL converts `acceptNode()` results to unsigned short without restricting
them to the three named constants. The DOM
[`nextNode()` algorithm](https://dom.spec.whatwg.org/#dom-treewalker-nextnode)
descends whenever the result is not `FILTER_REJECT`. Firefox agrees. When a node
is reached through a sibling, Chromium and WebKit instead descend only for
`FILTER_SKIP`; a result such as 0 or 4 prunes that node's children. Their
first-child descent does follow DOM's non-reject rule.

Browlet follows DOM and Firefox.
`SPEC_CLASH(treewalker-unrecognized-filter-result)` records the continuing
browser disagreement. The
[2026-10-10 probe](../../../../node-compat/experimental/browser-probes/dom/tree-walker.mjs) compared 168 combinations
of operation, filter result, and callback mutation. Firefox 151 matched all 168;
Chromium 149.0.7827.55 and WebKit 26.5 differed only in these eight sibling-entry
cases. The ordinary accept/reject/skip cases agreed across all three browsers.

The [TreeWalker tests](../../../../test/browlet/dom/traversal/tree-walker.test.ts)
retain the 0/4 cases: a skipped preceding sibling, a branch returning that
number, and an accepted child. `nextNode()` should return the child. The same
tests preserve each other operation's distinct handling of those values.

Blink `core/dom/tree_walker.cc` and WebKit `dom/TreeWalker.cpp` have separate
child/sibling paths; Gecko `dom/base/TreeWalker.cpp` retains a single result
variable through both paths. These sources corroborate the browser probe.

## Completion boundary

The three traversal interfaces now work through the public Browlet surface.
No missing runtime dependencies were found in this pass. Keep this file for
the continuing compatibility choices; Selectlet's existing pointer traversal
does not need to change to complete DOM §6.
