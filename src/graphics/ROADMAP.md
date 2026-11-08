# Graphics roadmap

Shared image data, with planned decoding results and graphics operations used by
CSS images, HTML elements, canvas, and later output. ImageData and ImageBitmap's
object lifetime are implemented;
no decoding or rendering backend is selected. [Browlet's graphics integration](../browlet/graphics/ROADMAP.md)
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
Their implementation state and neutral declarations belong here, with host
bindings and HTML source adapters supplied by Browlet. ImageData's constructor,
initialization, and serialization algorithms are implemented below. ImageBitmap
supplies dimensions, close, cloning, and transfer; its factory and source
processing remain separate work.

| Work | Contract to establish |
| --- | --- |
| ImageData | Implemented pixel storage, dimensions, formats, color-space labels, constructor validation, and cloning; canvas consumers remain separate |
| ImageBitmap | Implemented owned pixels, origin-clean state, dimensions, close, clone, and transfer; sources, formatting, and async creation remain pending |
| Geometry | Reuse [geometry](../geometry/ROADMAP.md) for coordinate/matrix operations; no independent DOMMatrix family |
| Color/output | Keep CSS value computation in Stylelet; image/output color conversion, supported profiles, and rasterization need explicit consumers/backend capabilities |
| Painting/compositing | Define drawing inputs and retained output only when a concrete renderer/canvas consumer exists; this folder does not establish a complete paint pipeline |

ImageData exposes its specified typed array; internal decoder handles must not
escape onto the author-facing surface.
Use direct algorithms for shared math and narrow Host Ports for actual backend
effects. Do not add a generic graphics environment solely to collect services.

[CSS Painting](https://drafts.css-houdini.org/css-paint-api-1/) is a later consumer:
selected computed properties, arguments, image size, and a drawing context feed
author code. [Browlet worklets](../browlet/worklets/ROADMAP.md#css-worklet-consumers)
own module/global lifetime; a registration API alone cannot supply painting.

## ImageData

[HTML §8.11.1](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#the-imagedata-interface)
is implemented against revision `5fcc2318395821db61e353705e6368ad9a000af5`, verified
against official upstream on 7 November 2026. [ImageDataImpl](image-data.ts) owns
the typed array, dimensions, pixel format, and color-space label. It uses the
existing `JSEnvironment` for realm-owned allocation, with no new graphics
environment or browser dependency. Its two constructor factories implement the
two HTML overloads; `initialize()` is the shared initialization algorithm.

Web IDL supplies overload selection, unsigned-long and dictionary conversion,
buffer restrictions, readonly getters, receiver checks, and Platform identity.
Fresh arrays and their buffers belong to the constructor's realm. Supplied arrays
retain their own identity and realm. Serializable steps use HTML's existing
sub-serialization memory, preserving view offsets and graph aliases. ImageData
itself is not transferable; its ArrayBuffer can be transferred separately.

Eric approved these continuing differences:

- `SPEC_CLASH(imagedata-formats)` and `SPEC_CLASH(imagedata-color-spaces)`:
  implement both `rgba-unorm8` and `rgba-float16`, and all four current HTML
  color-space labels (`srgb`, `srgb-linear`, `display-p3`, `display-p3-linear`).
  Chromium supports both formats but rejects the linear labels. The tested
  Firefox/WebKit builds lack parts of the settings and attribute surface.
  Labeling a buffer does not perform color conversion.
- `SPEC_CLASH(imagedata-validation-order)`: check empty/incomplete pixel data
  first, raising InvalidStateError as HTML/Firefox/WebKit require. Chromium
  instead raises IndexSizeError first when the width is also zero.
- `SPEC_CLASH(imagedata-inferred-height)`: initialize with the computed height
  when the argument is omitted, matching all three browsers. HTML computes that
  height but mistakenly passes the optional argument to initialization.
- `SPEC_CLASH(imagedata-array-identity)`: retain the exact supplied array,
  following HTML/Chromium/Firefox. WebKit returns another view.
- `SPEC_CLASH(imagedata-clone-aliases)`: preserve shared serialization memory,
  following HTML/Firefox. Chromium/WebKit separately copy ImageData pixels,
  losing the original view offset and aliases to other serialized references.

The [browser-only probe](../../node-compat/experimental/browser-probes/html/image-data.mjs)
and [results](../../node-compat/experimental/browser-probes/html/IMAGE-DATA-RESULTS.json)
record Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. The data-URL probe
does not establish SharedArrayBuffer behavior: that constructor was unavailable
there. The Browlet regression exercises the actual shared-buffer rejection.

[Focused tests](../../test/graphics/image-data.test.ts) cover both formats,
metadata, zero initialization, supplied views, dimension/format validation order,
intrinsic metadata despite author shadow properties, detached/resizable/shared
buffers, readonly/receiver rules, subclassing, cross-realm identity, cloned
aliases, separate buffer transfer, and dedicated/shared worker realms.
All 21 ImageData cases and 13 existing structured-clone/transfer cases pass on
Node 24.19.0, 26.8.1, and custom 27, each in stock and compat mode. Typecheck,
Web IDL type contracts, focused lint, and import-boundary checks also pass.

Remaining dependencies are explicit:

- Half-float allocation requires the realm's Float16Array intrinsic and throws
  InternalError if the engine cannot supply it. Allocation limits/errors belong
  to the engine; no additional arbitrary size cap or substitute format is used.
- Worker globals expose ImageData, but their public `structuredClone()`
  forwarding remains the existing [HTML §10.3 dependency](../browlet/workers/ROADMAP.md).
  Worker tests exercise the existing environment cloning machinery directly.
- Canvas allocation/readback, decoding, ImageBitmap creation, color conversion,
  rendering, and resource lifecycle are separate owners. No ImageData algorithm
  requires pretending these operations exist.

## ImageBitmap lifetime

[HTML §8.11.2](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#the-imagebitmap-interface)
uses the same verified HTML revision as ImageData. [ImageBitmapImpl](image-bitmap.ts)
now exposes the nonconstructible Window/worker interface, readonly dimensions,
and idempotent close. Serialization copies the bitmap data; transfer moves it.
Closed or non-origin-clean objects fail with DataCloneError. Failed origin-clean
checks preserve the original bitmap; close and successful transfer release its
reference and make both dimensions zero.

Eric approved a prepared `BitmapData` record: tightly packed RGBA bytes,
positive dimensions, pixel format, color space, alpha-premultiplication state,
and origin-clean status. `ImageBitmapImpl.create(bitmapData, env)` is an internal
ownership handoff, not HTML's author-facing createImageBitmap algorithm. Its
producer supplies the complete valid representation and relinquishes mutable
aliases. The record contains no environment, callback, or decoder handle, so it
can survive transport of serialization records. Cloning preserves component
bits and metadata without running a conversion algorithm.

The absent bitmap represents the object's local detached state. HTML's existing
generic transfer machinery also stamps successfully transferred implementations.
The ImageBitmap steps explicitly reject absent data, handling close without
importing Browlet's transfer marker into this shared subsystem. No new graphics
environment or registry is needed.

`SPEC_CLASH(imagebitmap-clone-identity)` follows HTML/Chromium/Firefox's repeated
reference identity during cloning; WebKit duplicates repeated bitmap references.
`SPEC_CLASH(imagebitmap-closed-clone)` follows HTML/Chromium/Firefox's DataCloneError
for a closed bitmap; WebKit cloning throws TypeError, although its transfer path
throws DataCloneError. Eric approved both choices. All three engines agree on
zero dimensions after close/transfer, idempotent close, origin-clean rejection,
and preservation of the source on an origin-clean failure.

The [browser-only probe](../../node-compat/experimental/browser-probes/html/image-bitmap-lifetime.mjs)
and [results](../../node-compat/experimental/browser-probes/html/IMAGE-BITMAP-LIFETIME-RESULTS.json)
record Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Locally intercepted
URLs supply a foreign-origin image and tainted canvas without external fetching.

[23 focused cases](../../test/graphics/image-bitmap.test.ts) supply prepared data
at the missing producer boundary and exercise real bindings. They cover the
surface, close, aliases, exact pixel/metadata copying, moved ownership, duplicate
transfer rejection, taint, portable records, borrowed methods, error realms,
and worker destinations. The combined 57 graphics/structured-clone/transfer cases
pass on Node 24.19.0, 26.8.1, and custom 27 in stock and compat modes. These tests
do not claim source extraction, pixel formatting, or rendering.

## Next implementation and checks

The next bounded work can start with in-memory ImageData/ImageBitmap source
preparation and formatting. Creation needs specified options/conversions,
invalid-state checks, independent snapshots, and bitmap-task settlement. Cropping,
transparent padding, resize, orientation, alpha conversion/default policy, and
result lifetime must be implemented or explicitly deferred at their call sites.
Do not expose a reduced ImageBitmapSource union as though it were the complete IDL.

The [Browlet dependency map](../browlet/graphics/ROADMAP.md#imagebitmap-creation-dependencies)
records the remaining source and decoding owners. Select a real consumer and
supported format/backend before decoding implementation. Output snapshots need
a drawing consumer; owned pixels alone cannot establish rendering.
