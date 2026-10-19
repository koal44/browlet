# Geometry roadmap

Planned shared geometric objects and arithmetic for CSS, SVG, graphics, and
layout. This folder has no implementation yet. Geometry owns coordinates and
operations on them; [layout](../layout/ROADMAP.md) produces measured boxes and
fragments, and Browlet exposes measurements through its DOM APIs.

## Sources and scope

Read [Geometry Interfaces 1](https://drafts.csswg.org/geometry-1/) from the local
CSSWG `geometry-1/Overview.bs`. Interface contracts and consumers were inspected;
individual operations still need implementation review.

| Work | Contract and dependencies |
| --- | --- |
| DOMPoint / DOMPointReadOnly | Coordinate state, dictionaries, mutation, and matrix transformation |
| DOMRect / DOMRectReadOnly / DOMRectList | Rectangle state, derived edges, and the collection required by measurement APIs; no inference from DOM or CSS width |
| DOMMatrix / DOMMatrixReadOnly | Matrix state, aliases, multiplication, inversion, point transformation, and typed-array conversion |
| DOMQuad | Retained points and bounds; distinguish these API objects from layout's internal fragment records |
| Binding and structured data | Complete adjacent IDL, exposure, identity, dictionaries, exception policy, and each interface's specified serialization steps |

## Dependency boundaries

- Keep numeric operations directly callable without a document, layout pass,
  or generic environment. Reuse Infra and Web IDL's existing facilities where
  required; host bindings own Platform identity and allocation.
- DOMMatrix's [CSS-string input](https://drafts.csswg.org/geometry-1/#parse-a-string-into-an-abstract-matrix)
  requires CSS transform parsing and rejects relative lengths. Compose that
  specific Stylelet dependency without making the arithmetic core load the
  style engine or creating a Geometry/Typed OM import cycle. The callable seam
  remains to be chosen with the implementation.
- [Typed OM transforms](../stylelet/cssom/typed/ROADMAP.md) need real DOMMatrix
  results. Reuse the same geometric implementation instead of a second matrix
  API inside CSSOM.
- CSSOM View and range geometry consume these objects after layout supplies
  measurements. Returning a rectangle does not prove that a layout query ran.
- Graphics and layout may share coordinate arithmetic without projecting
  Platform objects or forcing every internal rectangle into a DOMRectImpl.

## Delivery and evidence

1. Implement numeric point/rectangle/matrix behavior with independent tests.
2. Add interfaces and test conversion, mutation, identity, and cross-realm
   results through the active host binding.
3. Connect CSS-string parsing and Typed OM transform consumers, preserving
   their different input and failure rules.
4. Connect measured APIs only after the layout owner establishes freshness,
   coordinate spaces, and the required snapshot or live-result contract.

No geometry engine, native backend, or new hosting API is selected by this
roadmap. The first consumer should settle implementation names and module splits.
