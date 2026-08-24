# DOM ranges roadmap

## Why this is an early dependency

The public Range API can be delivered incrementally, but live Range adjustment
cannot be postponed until after DOM mutation is finished. DOM §§4–5 make every
insert, remove, move, character-data replacement, and text split update
affected boundary points as part of that mutation. The mutation spine must
therefore reserve and exercise the Range participant from its first complete
implementation.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `boundary-point.ts` | Boundary-point ordering and validation algorithms | DOM §5.2, `#boundary-points` |
| `abstract-range.ts` | `AbstractRange` | DOM §5.3, `#interface-abstractrange` |
| `static-range.ts` | `StaticRange` | DOM §5.4, `#interface-staticrange` |
| `range.ts` | Live `Range`, mutation adjustment, extraction, cloning, insertion, stringification, and HTML `createContextualFragment()` integration | DOM §5.5, `#interface-range`; HTML §8.5.7 |

## Dependency and ownership rules

- Boundary points and `StaticRange` need node topology and Web IDL projection,
  but no live-registration machinery.
- A live `Range` initially belongs to the current global's associated Document;
  realm/Document lookup must therefore be available to its constructor.
- Live ranges must register with the document/root that can notify them of
  mutations and move that registration when their root changes. Do not use a
  process-wide strong collection which keeps otherwise dead ranges alive.
- `Range` extraction, cloning, deletion, insertion, and surrounding depend on
  complete node cloning, CharacterData replacement, and the normative mutation
  spine in `../nodes/roadmap.md`.
- `createContextualFragment()` consumes `../../html/parser/fragment.ts`; Range
  must not grow a second HTML fragment parser.
- CSSOM View later contributes range geometry. `getClientRects()` and
  `getBoundingClientRect()` are not prerequisites for DOM §5 behavior.

Blink centralizes structural mutation before notifying its live ranges. Gecko
registers live ranges as internal mutation observers and moves that
registration with their root. Both are evidence for an explicit mutation
participant rather than reconstructing boundary changes after raw tree writes;
Browlet need not copy either engine's native class structure.

## Delivery order

1. Implement boundary-point validation/comparison, `AbstractRange`, and
   `StaticRange` with public behavioral tests.
2. Add live-range registration and every mutation-adjustment algorithm while
   completing the DOM §4 mutation spine.
3. Project the complete `Range` surface and implement its node/CharacterData
   mutation methods once those shared operations are normative.
4. Connect contextual fragment parsing, then add CSSOM View geometry only when
   layout supplies it.

Coverage should exercise boundary points through public Range objects, then
mutate their tree through public node and CharacterData operations. Tests which
call a private range-adjustment helper directly do not establish the contract.

## Removal condition

Burn this file after all three public interfaces and live mutation
adjustment are covered, contextual fragment parsing is connected, and any
remaining geometry work is owned by the rendering roadmap.
