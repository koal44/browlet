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
adds CharacterData replacement, text splitting, and normalization adjustment;
the former `.data` expected failure now passes. StaticRange remains unchanged.

Ranges sit below nodes in the import hierarchy and retain node types without
loading their implementation classes; use the supplied nodes and document
factories. Review runtime dependencies for parsing and geometry when those
extensions are implemented.

| Source | Contract | Specification |
| --- | --- | --- |
| `range.ts` private static helpers | Boundary-point ordering and validation algorithms, using node/offset arguments without temporary point objects | DOM §5.2, `#boundary-points` |
| `abstract-range.ts` | `AbstractRange` | DOM §5.3, `#interface-abstractrange` |
| `static-range.ts` | `StaticRange` | DOM §5.4, `#interface-staticrange` |
| existing `range.ts` | Live `Range`, mutation adjustment, extraction, cloning, insertion, stringification, and HTML `createContextualFragment()` integration | DOM §5.5, `#interface-range`; HTML §8.5.7 |

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
- `createContextualFragment()` consumes `../../html/parser/fragment.ts`; Range
  must not grow a second HTML fragment parser.
- CSSOM View later contributes range geometry. `getClientRects()` and
  `getBoundingClientRect()` are not prerequisites for DOM §5 behavior.

Blink centralizes structural mutation before notifying its live ranges. Gecko
registers live ranges as internal mutation observers and moves that
registration with their root. Both are evidence for an explicit mutation
participant rather than reconstructing boundary changes after raw tree writes;
Browlet need not copy either engine's native class structure.

## Remaining work

1. Complete Range comparison/query methods, cloning, content extraction/deletion,
   insertion, surrounding, and stringification using the shared mutation spine.
   The current projected Range interface deliberately contains only the selection
   surface needed by 4C; its complete Web IDL surface remains unfinished.
2. Connect contextual fragment parsing, then add CSSOM View geometry only when
   layout supplies it.

Coverage should exercise boundary points through public Range objects, then
mutate their tree through public node and CharacterData operations. Tests which
call a private range-adjustment helper directly do not establish the contract.

## Removal condition

Burn this file after all three public interfaces and live mutation
adjustment are covered, contextual fragment parsing is connected, and any
remaining geometry work is owned by the rendering roadmap.
