# Selector and scope roadmap

The [README](README.md) describes the current matcher and Selectlet boundary.
The work below follows Selectors 4 parsing/matching/forgiving-list contracts,
Selectors 5 additions, Namespaces/Nesting context and relevant Shadow 1
contracts. Individual selector algorithms still need implementation review.

## Sources and ownership

| Source | Contract to carry through |
| --- | --- |
| [Selectors 4](https://drafts.csswg.org/selectors-4/#api-hooks) | Parsing failure, matching against elements/pseudo-elements/trees, optional scoping roots, specificity, and forgiving-list behavior |
| [Selectors 5](https://drafts.csswg.org/selectors-5/) | Additions to level 4: location, interest, blank input, timeline, custom-state, heading, grid-structural, and reference selectors; many need host-language facts |
| [Namespaces 3](https://drafts.csswg.org/css-namespaces-3/#scope) and [Nesting 1](https://drafts.csswg.org/css-nesting-1/) | Per-sheet namespace resolution and parent-rule selector context; carried through interpretation, editing, matching, and serialization |
| [Shadow 1](https://drafts.csswg.org/css-shadow-1/#selectors) | Shadow matching context, featureless hosts, slot/part selection, flat-tree distinctions, and tree-scoped names |
| [Cascade 6 `@scope`](https://drafts.csswg.org/css-cascade-6/#scoped-styles) | Scoping roots/limits and proximity; rule parsing and cascade participation are tracked in the [rule roadmap](../cssom/rules/ROADMAP.md) |

In the inspected local checkout, `css-scoping-1/Overview.html` and
`css-shadow-parts-1/Overview.html` redirect to CSS Shadow 1, whose local source
is `css-shadow-1/Overview.bs`. Keep old references recognizable, but use the combined
module when continuing this work. Its experimental default-element-styles
proposal needs its own status and consumer review before implementation.

## Parser-to-consumer coverage

- [ ] Account for accepted selector forms against actual matcher branches.
  Start with `:nth-child(... of ...)`, column relationships, `:has-slotted`,
  and the parsed Selectors 5 forms currently falling through to no match.
  Distinguish missing behavior from selectors that legitimately match nothing
  in a particular host; do not use grammar acceptance as a support query.
- [ ] Extend the implemented CSSStyleRule getter/setter and child rebinding to
  future conditional groups. Invalid edits, namespace bindings and changed
  descendant specificity are covered; broaden forgiving-arm, pseudo-element
  and matcher-freshness coverage with the corresponding engine consumers.
- [ ] Supply real host facts for dynamic selectors. Focus indication, form
  state, media/timeline state, interest, heading levels, and grid relationships
  have different owners; a present attribute or guessed layout result is not
  a substitute. Some DOMOperations hooks already exist and should be reused.
- [ ] Keep script-visible visited-link privacy separate from any future
  history-sensitive styling and CSSOM disclosure restrictions.

## Shadow and pseudo-element work

- [ ] Carry the stylesheet's tree context into matching, including featureless
  host handling. Do not replace ordinary selector traversal with flat-tree
  traversal: [Shadow 1](https://drafts.csswg.org/css-shadow-1/#flattening)
  explicitly distinguishes them.
- [ ] Connect slot/part targets and part forwarding to their DOM owners, then
  support actual pseudo-element subjects and applicable pseudo-class tails.
  A parsed pseudo-element or query-engine no-match rule does not satisfy the
  stylesheet algorithm.
- [ ] Preserve tree-scoped names/references with values when font, animation,
  and other named resources cross shadow boundaries. The
  [value owner](../values/ROADMAP.md) preserves provenance; family-specific
  work supplies the resource definitions.
- [ ] Invalidate affected matching/participation when trees, slots, parts,
  attributes, dynamic host state, or rule context change. Review existing
  tree-version caches before selecting an additional cache or owner.

## Sharing with Selectlet

Review one duplicated predicate at a time through the existing DOMOperations
contract. Keep grammar/source records distinct from query seed/planner data
unless a concrete consumer demonstrates that a shared representation is simpler.
Any broader unification must preserve stylesheet specificity, namespace and
nesting context, query scope/order, pseudo-element rules, and host cache lifetime.
Use both consumers' regressions; benchmark only if an implementation change
needs that evidence.

The [syntax and selector baseline](../README.md#syntax-rules-and-selectors) passed existing focused
tests. Missing paths above need observable regressions when implemented;
no browser-only probe or full WPT run was performed for this inventory.
