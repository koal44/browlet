# Graphics roadmap

Planned shared image data, decoding results, and graphics operations used by
CSS images, HTML elements, canvas, and later output. No implementation or backend
is selected yet. [Browlet's graphics integration](../browlet/graphics/ROADMAP.md)
owns HTML source extraction and lifecycle; [layout](../layout/ROADMAP.md) owns
placement and sizing, while Stylelet owns CSS image/gradient representations.

## Images and resources

- [ ] Define decoded image data, optional natural width/height/aspect ratio,
  frame access, failure/availability, and resource lifetime for the first
  consumer. Keep URL/candidate selection and request state distinct from pixels.
- [ ] Reuse Fetch and the existing loader for resource requests with their
  specific policy, CORS, referrer, and destination settings. Shared decoding
  consumes bytes or supported source data; it must not rediscover a document's
  loading policy. Font, image, and profile requests are not interchangeable.
- [ ] Preserve [natural and concrete image sizes](https://drafts.csswg.org/css-images-3/#sizing-terms).
  The consuming image/layout algorithm derives the concrete object size;
  missing dimensions are not fabricated zeroes. A gradient obtains its image
  box from the consumer rather than owning a layout box itself.
- [ ] Account for source changes, decoded dimensions, image frames, and failure
  notifications when invalidating style/layout/paint. Animated image frame
  delivery must use the host's update lifecycle, not a second frame scheduler.

## Shared objects and output

HTML §8.11 defines [ImageData and ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html).
Plan their implementation state and neutral declarations here, with host
bindings and HTML source adapters supplied by Browlet. Audit individual
algorithms before implementation; the existing roadmap established scope only.

| Work | Contract to establish |
| --- | --- |
| ImageData | Pixel storage, dimensions, formats, color space, constructor validation, and buffer ownership |
| ImageBitmap | Supported sources, crop/resize/orientation, conversion, origin-clean state, close, transfer, and correctly owned async results |
| Geometry | Reuse [geometry](../geometry/ROADMAP.md) for coordinate/matrix operations; no independent DOMMatrix family |
| Color/output | Keep CSS value computation in Stylelet; image/output color conversion, supported profiles, and rasterization need explicit consumers/backend capabilities |
| Painting/compositing | Define drawing inputs and retained output only when a concrete renderer/canvas consumer exists; this folder does not establish a complete paint pipeline |

Pixel buffers and decoder/native handles must not escape as Platform objects.
Use direct algorithms for shared math and narrow Host Ports for actual backend
effects. Do not add a generic graphics environment solely to collect services.

[CSS Painting](https://drafts.css-houdini.org/css-paint-api-1/) is a later consumer:
selected computed properties, arguments, image size, and a drawing context feed
author code. [Browlet worklets](../browlet/worklets/ROADMAP.md#css-worklet-consumers)
own module/global lifetime; a registration API alone cannot supply painting.

## First implementation and checks

Choose one real image consumer and supported format/backend. Test decoding
failure, dimensions, lifetime/close, and shared use by element and CSS callers.
Add Platform tests for the corresponding public objects and policy/taint tests
at the host source boundary. Output snapshots require a real drawing consumer;
value parsing alone cannot prove image rendering.
