# Graphics integration roadmap

HTML §8.11's image objects are shared primitives for canvas, workers, and later
graphics APIs. Their state and operations belong to the shared
[graphics subsystem](../../graphics/ROADMAP.md). This folder retains the
Browlet-specific source, lifecycle, policy, and binding integration. ImageData
and ImageBitmap's object lifetime use the existing Web IDL definitions; source
adapters, async creation, decoding, and rendering remain unfinished.

| Integration | Contract | Specification |
| --- | --- | --- |
| HTML image sources | Extract supported image/canvas/video/bitmap sources with their current availability, dimensions, origin-clean state, and lifetime; pass explicit source data to shared algorithms | HTML §§8.11 and 4.8 |
| Resource loading | Connect actual element/CSS consumers to Fetch, request settings, policy, cancellation, decode completion, and invalidation | HTML image loading; CSS Images |
| Platform exposure | ImageData and ImageBitmap are bound in Windows and workers, including cloning and bitmap transfer; createImageBitmap's overloads, options, and promises remain pending | HTML §8.11; Web IDL; structured data |
| Output consumers | Supply image frames and metadata to layout/canvas/paint through the existing document update lifecycle | HTML rendering updates; consuming graphics specifications |

Decoding and pixel operations stay in shared graphics/backend facilities;
source extraction must not make those facilities depend on DOM nodes. Native
objects must not leak onto the author-facing surface. Keep document association
and request authorization explicit rather than adding another graphics environment.

ImageData needs only the existing owning environment's realm and serialization
contracts. Its [tests](../../../test/graphics/image-data.test.ts) exercise actual
Window/worker bindings, pixel-buffer ownership, and cloning. Workers' public
structuredClone forwarding remains the existing §10.3 owner dependency; internal
worker-realm cloning is covered without adding that API here.

ImageBitmap's [lifetime tests](../../../test/graphics/image-bitmap.test.ts) supply
prepared pixels to its implementation and then use real binding/serialization
paths. They establish close, clone, transfer, taint rejection, and destination
ownership, without claiming HTML resource selection or display.

## ImageBitmap creation dependencies

The lifetime slice deliberately leaves createImageBitmap unexposed. Its existing
declaration comment in [the global mixin](../environment/global-scope.ts) now
identifies these missing connections; no placeholder fabricates a bitmap.

| Dependency | Existing foundation and remaining work |
| --- | --- |
| ImageData/ImageBitmap | Retained pixels and lifetime exist; creation still needs usability/detachment checks and an independent formatted snapshot |
| HTML/SVG images | HTMLImageElement has identity/loading-policy pieces; decoded resources, dimensions, animation-frame selection, and origin-clean extraction need image loading; SVGImageElement integration is absent |
| Video/VideoFrame | HTMLVideoElement identity exists; readiness, current/visible frame extraction, aspect correction, and VideoFrame integration need media/WebCodecs |
| Canvas/OffscreenCanvas | HTMLCanvasElement is identity-only; bitmap/context state, origin-clean tracking, and OffscreenCanvas sources need canvas |
| Blob decoding | Blob reads and MIME image-context sniffing exist; codec selection, decoding failure, dimensions, orientation/color profiles, and default animation frames need a decoder |
| Formatting | Shared graphics must supply cropping, transparent padding, resize interpolation, vertical flip, and alpha conversion; image/Blob color-conversion policy remains open |
| Async API | WindowOrWorkerGlobalScope needs the full source union, overloads/options, validation, and Promise settlement on the bitmap task source; worker API forwarding remains §10.3 |

Next start with in-memory source preparation and formatting, without selecting a
decoder or rendering backend. Review missing source types and callable shape
before exposing the author API. Codec/rendering dependencies must become named
throwing boundaries when a callable path reaches them; an empty graphics
environment would not supply those operations.

## Removal condition

Remove this roadmap once source extraction, loading, and Platform integration
have implemented source or narrower owning roadmaps. Shared graphics work stays
with its subsystem.
