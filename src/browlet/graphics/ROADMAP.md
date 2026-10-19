# Graphics integration roadmap

HTML §8.11's image objects are shared primitives for canvas, workers, and later
graphics APIs. Their state and operations belong to the planned
[graphics subsystem](../../graphics/ROADMAP.md). This folder retains the
Browlet-specific source, lifecycle, policy, and binding integration; neither
folder contains a graphics implementation yet.

| Integration | Contract | Specification |
| --- | --- | --- |
| HTML image sources | Extract supported image/canvas/video/bitmap sources with their current availability, dimensions, origin-clean state, and lifetime; pass explicit source data to shared algorithms | HTML §§8.11 and 4.8 |
| Resource loading | Connect actual element/CSS consumers to Fetch, request settings, policy, cancellation, decode completion, and invalidation | HTML image loading; CSS Images |
| Platform exposure | Bind shared ImageData/ImageBitmap implementations, complete dictionaries/conversion, exceptions, promises, and transfer using the owning environment | HTML §8.11; Web IDL; structured data |
| Output consumers | Supply image frames and metadata to layout/canvas/paint through the existing document update lifecycle | HTML rendering updates; consuming graphics specifications |

Decoding and pixel operations stay in shared graphics/backend facilities;
source extraction must not make those facilities depend on DOM nodes. Native
objects must not leak onto the author-facing surface. Keep document association
and request authorization explicit rather than adding another graphics environment.

Start with one real image consumer and test accepted/invalid sources, policy and
taint propagation, source changes, close/transfer, and realm-sensitive results.
Shared pixel tests do not establish HTML resource selection or display behavior.

## Removal condition

Remove this roadmap once source extraction, loading, and Platform integration
have implemented source or narrower owning roadmaps. Shared graphics work stays
with its subsystem.
