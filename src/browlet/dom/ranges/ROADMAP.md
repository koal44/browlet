# DOM ranges roadmap

## Why this is an early dependency

The public Range API can be delivered incrementally, but live Range adjustment
cannot be postponed until after DOM mutation is finished. DOM §§4–5 make every
insert, remove, move, character-data replacement, and text split update
affected boundary points as part of that mutation. The mutation spine must
therefore reserve and exercise the Range participant from its first complete
implementation.

DOM 4C implements `AbstractRange`, `StaticRange`, and the live Range selection
surface: construction, boundary setters, collapse, node/content selection,
common ancestor, and compatibility `detach()`. `Document.createRange()` uses its
receiver's document; `new Range()` uses the constructor realm's document.
Insertion, removal, replacement, and movement adjust real live ranges. DOM 4E
adds CharacterData replacement, text splitting, and normalization adjustment.
The DOM §5 pass completes comparison and point queries, content operations,
cloning, insertion, surrounding, and stringification. StaticRange has an
implementation validity check; construction still permits invalid snapshots.

Ranges sit below nodes in the import hierarchy and retain node types without
loading their implementation classes; use the supplied nodes and document
factories. Review runtime dependencies for parsing and geometry when those
extensions are implemented.

| Source | Contract | Specification |
| --- | --- | --- |
| `abstract-range.ts` comparator and `range.ts` validation helper | Boundary-point ordering and validation, using node/offset arguments without temporary point objects | DOM §5.2, `#boundary-points` |
| `abstract-range.ts` | `AbstractRange` | DOM §5.3, `#interface-abstractrange` |
| `static-range.ts` | `StaticRange` | DOM §5.4, `#interface-staticrange` |
| `range.ts` | Live `Range`, mutation adjustment, comparison, queries, content operations, and stringification | DOM §5.5, `#interface-range` |

## Dependency and ownership rules

- Boundary points and `StaticRange` need node topology and Web IDL projection,
  but no live-registration machinery.
- A live `Range` initially belongs to the current global's associated Document;
  realm/Document lookup must therefore be available to its constructor.
- Live ranges register in a weak set indexed by ordinary root. Selection changes
  and insertion of a detached root relocate that registration. Shadow-root ranges
  remain separate when the host is removed or adopted. Neither root keys nor range
  entries keep otherwise unreachable objects alive.
- `Range` extraction, cloning, deletion, insertion, and surrounding depend on
  complete node cloning, CharacterData replacement, and the normative mutation
  spine in `../nodes/ROADMAP.md`.
- HTML's future `createContextualFragment()` integration consumes
  `../../html/parser/fragment.ts`; Range must not grow a second HTML fragment parser.
- CSSOM View later contributes range geometry. `getClientRects()` and
  `getBoundingClientRect()` are not prerequisites for DOM §5 behavior.

Blink centralizes structural mutation before notifying its live ranges. Gecko
registers live ranges as internal mutation observers and moves that
registration with their root. Both are evidence for an explicit mutation
participant rather than reconstructing boundary changes after raw tree writes;
Browlet need not copy either engine's native class structure.

## Remaining work

1. Connect HTML contextual fragment parsing when the shared parser is available.
2. Add CSSOM View geometry only when layout supplies it.

The DOM §5 surface is complete without these extensions. Range content operations
use the existing node factories and mutation methods; custom-element reactions
and HTML-specific cloning steps retain their node-owner gates.

## Behavioral coverage

`test/browlet/dom/ranges/` covers comparisons and error ordering, live versus static
boundaries, partial-ancestor copying, whole-node identity, mutation records,
insertion/surrounding failures, shadow isolation, UTF-16 stringification, and
cross-realm allocation. The 2026-10-10 browser probe compared 2,109 nested XML
content-operation cases per engine: Chromium 149.0.7827.55 and Firefox 151.0 matched;
WebKit 26.5 differed only in the two cases below. The reproducible probe remains
in `scratch/dom-5-probe.mjs`.

Coverage should exercise boundary points through public Range objects, then
mutate their tree through public node and CharacterData operations. Tests which
call a private range-adjustment helper directly do not establish the contract.

## ProcessingInstruction collapse

`SPEC_CLASH(range-processing-instruction-collapse)` follows DOM, Chromium, and
Firefox. Given a ProcessingInstruction with data `ij` and a range from offset 1
to 2, `deleteContents()` and `extractContents()` leave data `i` and collapse to
offset 1. WebKit instead collapses to offset 0. The chosen behavior was reviewed
and approved; `contents.test.ts` retains both regressions.

DOM's [deletion](https://dom.spec.whatwg.org/#dom-range-deletecontents) and
[extraction](https://dom.spec.whatwg.org/#concept-range-extract) steps replace only
the selected CharacterData. WebKit's `Range.cpp`, in
`processContentsBetweenOffsets()`, uses whole-data replacement for
ProcessingInstruction instead of the targeted deletion used for Text and Comment.
That resets the live offsets; Browlet uses targeted replacement for all
CharacterData node kinds.

## Removal condition

Burn this file after all three public interfaces and live mutation
adjustment are covered, contextual fragment parsing is connected, and any
remaining geometry work is owned by the rendering roadmap. Resolve or rehome the
continuing compatibility note before removing this file.
