# Graphics roadmap

Shared image data, with planned decoding results and graphics operations used by
CSS images, HTML elements, canvas, and later output. ImageData, ImageBitmap's
object lifetime, and in-memory cropping, alpha conversion, and resizing are implemented; no decoding or
rendering backend is selected. [Browlet's graphics integration](../browlet/graphics/ROADMAP.md)
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
supplies dimensions, close, cloning, and transfer. In-memory source preparation
is internal; its author-facing factory remains separate work.

| Work | Contract to establish |
| --- | --- |
| ImageData | Implemented pixel storage, dimensions, formats, color-space labels, constructor validation, and cloning; canvas consumers remain separate |
| ImageBitmap | Implemented lifetime and in-memory cropping/flip; resizing, alpha conversion, other source owners, and async creation remain pending |
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

Eric approved a prepared `BitmapData` class: tightly packed RGBA bytes,
positive dimensions, pixel format, color space, alpha-premultiplication state,
and origin-clean status. `ImageBitmapImpl.create(bitmapData, env)` is an internal
ownership handoff, not HTML's author-facing createImageBitmap algorithm. Its
producer supplies the complete valid representation and relinquishes mutable
aliases. BitmapData contains no environment, callback, or decoder handle.
Serialization and transfer carry its plain `BitmapDataRecord`; receiving steps
reconstruct the class, preserving its methods after transport. Cloning copies
component bits and metadata without conversion; transfer hands off the existing
pixel storage without preserving the internal source class instance.

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

## ImageBitmap in-memory preparation

[BitmapData.create](bitmap-data.ts) extracts the ImageData and
ImageBitmap branches of [createImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap)
and its [crop/format algorithm](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#cropped-to-the-source-rectangle-with-formatting).
Eric approved the internal `BitmapData.create(source, options, crop, env)` contract:
the optional crop record contains `sx`, `sy`, `sw`, and `sh`; inputs are already
converted, and the result owns independent pixels. Both ImageDataImpl and
ImageBitmapImpl implement `BitmapDataSource.prepareBitmapData()`, keeping source
validation and borrowed-pixel access with each owner. BitmapData supplies the
shared crop, flip, resize, and alpha operations without a source-class switch.
The complete source union,
author-facing Promise, and bitmap-task settlement are not exposed by this helper.
ImageBitmapOptions and its four enumerations live beside ImageBitmapImpl and
retain the complete HTML vocabulary, including EnforceRange resize dimensions,
for that later binding.

The factory checks zero crop dimensions before zero resize dimensions and source
usability. Detached ImageData buffers and closed/transferred ImageBitmaps reject
with InvalidStateError. Negative crop dimensions extend the rectangle left/up;
only `flipY` reverses rows. Cropping copies exact unorm8 or float16 component bits
through intrinsic-backed byte views, respects ImageData subarray offsets, fills
exterior pixels with transparent black, and retains color and origin-clean labels.
Creating from a tainted ImageBitmap preserves taint; the separate cloning/transfer
guards still reject it. No source pixels or lifetime state are changed.

`SPEC_CLASH(imagebitmap-crop-padding)` follows HTML/Chromium/Firefox's requested
dimensions and transparent padding. WebKit clips the rectangle to the source,
returning a 1x1 transparent bitmap when disjoint. Eric approved HTML's behavior.
The [browser-only probe](../../node-compat/experimental/browser-probes/html/image-bitmap-preparation.mjs)
and [results](../../node-compat/experimental/browser-probes/html/IMAGE-BITMAP-PREPARATION-RESULTS.json)
record Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three agree on
negative crop direction, immediate snapshots, inferred resize dimensions, and
the tested zero-size/detached-source errors.

`SPEC_CLASH(imagebitmap-default-alpha)` records the approved policy: `default`
preserves the source's alpha representation. HTML explicitly permits an
implementation-specific choice. Gecko's ImageData path uses NonPremult unless
`premultiply` is requested (`dom/canvas/ImageBitmap.cpp`, CreateInternal);
Blink treats `default` as premultiply (`core/imagebitmap/image_bitmap.cc`,
ParseOptions). This is source-inspected evidence, not an inference from canvas
readback, which can itself convert the representation. HTML applies its
colorSpaceConversion step only to image elements and Blobs; these two in-memory
sources keep their existing color space for either option value.

`BitmapData.convertAlpha()` now applies HTML's
[component multiplication/division](https://html.spec.whatwg.org/multipage/canvas.html#premultiplied-alpha-and-the-2d-rendering-context)
to independently owned pixels in place. The factory converts its copied crop,
leaving the source unchanged. Alpha bits, dimensions, format, color space, and
origin-clean state are preserved. Matching modes leave every byte unchanged;
opaque pixels also retain their exact RGB bits. Byte views with unaligned
half-float storage use an aligned temporary view and copy back into the original
storage. No graphics environment or backend is required.

`SPEC_CLASH(imagebitmap-alpha-rounding)` records the approved byte policy:
multiply RGB by alpha/255 or divide by it, then use Uint8ClampedArray's
nearest-even rounding and saturation. Chromium agrees in the
[alpha probe](../../node-compat/experimental/browser-probes/html/image-bitmap-alpha.mjs)
and [results](../../node-compat/experimental/browser-probes/html/IMAGE-BITMAP-ALPHA-RESULTS.json);
Firefox/WebKit differ on some components. For example, restoring red=1 at
alpha=6 gives 42, while restoring green=3 gives 128 in Chromium/Browlet; WebKit
gives 127 for green. The probe uploads ImageBitmaps to WebGL2 for raw RGBA
readback, avoiding 2D canvas's additional alpha conversion. It records Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2, with successful upload/readback.

`SPEC_GAP(imagebitmap-alpha-conversion)` records HTML's missing zero-alpha and
half-float normalization rules. Eric approved zero RGB at either signed zero
alpha. Other float16 components use their stored values, including negative/HDR
values and alpha outside 0–1, then round through Float16Array. No extra clamp is
applied; non-finite arithmetic follows JavaScript/IEEE behavior. Alpha is never
rewritten, preserving signed zero and NaN payload bits. The browser probe covers
byte pixels only; the half-float policy is an explicit choice tested locally.

The former alpha expected failures are now ordinary regressions. The focused
tests retain arithmetic/rounding, source ownership, exact half-float bits,
padding/flip, validation, detachment, metadata, intrinsic reads, and
destination-realm allocation coverage.

## ImageBitmap resizing

`BitmapData.resize(width, height, quality, env)` now implements HTML's
[pixelated rule](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-resizequality-pixelated)
and bilinear interpolation for `low`. Dimensions are already validated positive
integers. Changed dimensions produce independent storage in the supplied realm;
unchanged dimensions return the same bitmap for any quality. Format, color
space, alpha representation, and origin-clean state are retained. The factory
keeps HTML's crop, resize, flip, and requested alpha-conversion order.

`SPEC_CLASH(imagebitmap-pixelated-resize)` follows the written two-stage rule:
choose each axis's closest positive integer multiple, enlarge with nearest
neighbor, then use bilinear interpolation for the remaining size difference.
The implementation samples that conceptual enlarged grid directly, avoiding an
intermediate image allocation. Chromium, Firefox, and WebKit instead use direct
nearest-neighbor scaling for `pixelated`. With source red values `[0, 100, 250]`
resized from three to five pixels, Browlet produces `[0, 30, 100, 205, 250]`;
all three browsers produce `[0, 0, 100, 250, 250]`.

`SPEC_GAP(imagebitmap-resize-sampling)` records the approved details absent from
HTML's description: choose the larger integer multiple on a tie, sample pixel
centers, and clamp at the cropped image's edges. `low` uses bilinear directly.
Interpolation operates on stored RGBA components in the existing color space
and alpha representation, with double-precision intermediates and rounding only
when storing into Uint8ClampedArray or Float16Array. It does not introduce color
conversion or clamp half-floats to 0–1. Zero-weight neighbors do not participate
in non-finite arithmetic. An exact source-pixel sample copies its component bits,
including NaN payloads and signed zeros.

`SPEC_CLASH(imagebitmap-resize-components)` records two approved differences.
Interpolating transparent red with opaque blue gives `[128, 0, 128, 128]` at the
midpoint, matching Chromium/Firefox; WebKit gives `[255, 0, 255, 128]`. Byte
rounding retains the existing nearest-even policy: a red midpoint of 62.5 becomes
62, whereas the three tested browsers produce 63. The
[resize probe](../../node-compat/experimental/browser-probes/html/image-bitmap-resize.mjs)
and [results](../../node-compat/experimental/browser-probes/html/IMAGE-BITMAP-RESIZE-RESULTS.json)
record eight small byte-image cases on Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2, using WebGL2 readback with successful uploads/reads. Browser sources
also map pixelated to no/point interpolation in Blink's `image_bitmap.cc`,
Gecko's `ImageBitmap.cpp`, and WebKit's `ImageBitmap.cpp`. Half-float exceptional
values are covered locally, not claimed as browser-tested behavior.

`SPEC_GAP(imagebitmap-quality-filters)` records the approved remaining quality
choices: `medium` uses a triangle filter and `high` uses Catmull–Rom cubic
convolution (B = 0, C = 1/2). Each axis uses normalized weights and widens its
filter by the reduction ratio when shrinking. Pixel centers and clamped edge
samples retain the earlier sampling policy. Weights are precomputed per axis;
their products sample the source directly, without an intermediate pixel image.
Clamped contributions to the same edge pixel are combined, and zero-weight
edges are removed so exact samples retain their raw bits. The
[WebKit Skia backend](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/skia/GraphicsContextSkia.cpp)
also selects Catmull–Rom for high quality. HTML permits these filter choices but
does not require browsers to use the same kernels, footprints, or precision.

`SPEC_CLASH(imagebitmap-quality-resize)` records the approved reduction policy
and observed differences. For eight opaque red values
`[0, 0, 255, 0, 0, 0, 0, 0]` reduced to two pixels, the probe and local regressions
give:

| Implementation | Medium red values | High red values |
| --- | --- | --- |
| Browlet | `[56, 8]` | `[61, 6]` |
| Chromium | `[64, 0]` | `[143, 0]` |
| Firefox | `[65, 8]` | `[65, 8]` |
| WebKit | `[128, 0]` | `[143, 0]` |

The probe also retains a checkerboard reduction. These observations establish
implementation differences, not a requirement to reproduce one backend's pixels.

`SPEC_GAP(imagebitmap-cubic-range)` records the approved handling of signed
filter weights. Filtering retains stored RGBA, color space, and alpha
representation, with double-precision accumulation and rounding only at the
destination. Uint8ClampedArray clamps and rounds overshoot; Float16Array retains
negative/HDR output, including alpha outside 0–1. No additional alpha clamp or
color conversion is inserted. Zero-weight samples are omitted; other non-finite
arithmetic follows the existing JavaScript/IEEE policy. Exact single-pixel
contributions copy their component bits without arithmetic.

All four resize qualities are implemented. The former resize and alpha expected
failures are now ordinary passing regressions. [The focused suite](../../test/graphics/bitmap-data.test.ts)
passes 73 cases on Node 26.8.1/compat, with no expected failures. Coverage includes
independent axes, widened reductions, normalized constant images, rounding,
cubic overshoot, non-finite components, unaligned views, exact half-float copies,
source preservation, and resize-before-alpha integration.

## Next implementation and checks

The next work is the author-facing creation flow: review the complete source
union, then connect conversion, source usability/extraction, and bitmap-task
settlement to their actual owners. ImageData/ImageBitmap pixel preparation is
available; element, canvas, video, and Blob decoding dependencies remain below.
Do not expose a reduced ImageBitmapSource union as though it were the complete IDL.

The [Browlet dependency map](../browlet/graphics/ROADMAP.md#imagebitmap-creation-dependencies)
records the remaining source and decoding owners. Select a real consumer and
supported format/backend before decoding implementation. Output snapshots need
a drawing consumer; owned pixels alone cannot establish rendering.
