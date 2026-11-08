# Graphics integration roadmap

HTML §8.11's image objects are shared primitives for canvas, workers, and later
graphics APIs. Their state and operations belong to the shared
[graphics subsystem](../../graphics/ROADMAP.md). This folder retains the
Browlet-specific source, lifecycle, policy, and binding integration. ImageData
and ImageBitmap's object lifetime use the existing Web IDL definitions. Internal
in-memory creation and Blob reading also use the global mixin and bitmap task
source; the full source union, author exposure, decoding, and rendering remain unfinished.

| Integration | Contract | Specification |
| --- | --- | --- |
| HTML image sources | Extract supported image/canvas/video/bitmap sources with their current availability, dimensions, origin-clean state, and lifetime; pass explicit source data to shared algorithms | HTML §§8.11 and 4.8 |
| Resource loading | Connect actual element/CSS consumers to Fetch, request settings, policy, cancellation, decode completion, and invalidation | HTML image loading; CSS Images |
| Platform exposure | ImageData and ImageBitmap are bound in Windows and workers, including cloning and bitmap transfer; internal creation supplies typed Promises, but createImageBitmap's full source union and author overloads remain pending | HTML §8.11; Web IDL; structured data |
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

createImageBitmap remains unexposed. Its declaration comment in
[the global mixin](../environment/global-scope.ts) identifies these missing
connections; no placeholder fabricates a bitmap.

| Dependency | Existing foundation and remaining work |
| --- | --- |
| ImageData/ImageBitmap | Each implements prepareBitmapData for source validation; shared BitmapData.create returns independent cropped/resized/flipped pixels with optional alpha conversion and all four resize qualities |
| HTML/SVG images | HTMLImageElement has identity/loading-policy pieces; decoded resources, dimensions, animation-frame selection, and origin-clean extraction need image loading; SVGImageElement integration is absent |
| Video/VideoFrame | HTMLVideoElement identity exists; readiness, current/visible frame extraction, aspect correction, and VideoFrame integration need media/WebCodecs |
| Canvas/OffscreenCanvas | HTMLCanvasElement is identity-only; bitmap/context state, origin-clean tracking, and OffscreenCanvas sources need canvas |
| Blob decoding | Internal creation now reads retained BlobData in parallel and applies MIME image-context sniffing; BitmapData.decode explicitly throws until codec selection, natural dimensions, default animation frames, orientation and color-profile processing exist |
| Formatting | BitmapData owns cropping, transparent padding, all four resize qualities, vertical flip, and unorm8/float16 alpha conversion; image/Blob color-conversion policy remains open |
| Async API | The global mixin accepts converted ImageData/ImageBitmap/Blob, options and an optional crop record; in-memory preparation is immediate, Blob reads run in parallel, and result delivery uses the receiving bitmap task source; full source-union conversion, public overloads and Window/worker forwarding remain unfinished |

The complete source-union review found three absent interfaces: SVGImageElement,
OffscreenCanvas and VideoFrame. HTML image/video/canvas element identities exist,
but they do not yet own usable decoded/frame/backing pixels. Next agree their
source adapters and interface dependencies before exposing the full author API.
Codec/rendering dependencies must become named throwing boundaries when a
callable path reaches them; an empty graphics environment would not supply
those operations.

## Internal in-memory creation

The approved `WindowOrWorkerGlobalScopeMixin.createImageBitmap(image, options,
crop?)` entry extracts the ImageData/ImageBitmap branches of
[HTML's factory](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap).
It takes concrete implementations and converted ImageBitmapOptions, with the
second overload's four coordinates collected in the already approved crop record.
This internal subset is not declared as the public ImageBitmapSource union.

BitmapData.create checks crop and resize dimensions, then the source lifetime,
and copies/formats the pixels synchronously. Changes to the source or input
records after the call cannot alter the result. Invalid inputs reject the
binding-owned Promise immediately without queuing a bitmap task; successful
results are projected in the receiving global through the existing typed Promise.
The ordinary global task retains its Window Document's activity gate, or uses
the worker's own event loop with no Document. No independent lifecycle registry
or new cancellation policy was added.

`SPEC_CLASH(imagebitmap-task-delivery)` records the approved HTML/Chromium/Firefox
task delivery, versus WebKit's immediate fulfillment for these source kinds.
The [delivery probe](../../../node-compat/experimental/browser-probes/html/image-bitmap-delivery.mjs)
and its adjacent JSON results record Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2: a microtask queued after the call precedes fulfillment in Chromium
and Firefox; WebKit reverses those observations. All three retain the original
pixels when ImageData is changed or the source ImageBitmap is closed immediately.
Source inspection agrees: Blink's ImageBitmapSource::FulfillImageBitmap posts a
task, Gecko calls AsyncFulfillImageBitmapPromise, and WebKit's in-memory
completion handler calls the Promise resolver directly.

The [focused tests](../../../test/browlet/graphics/image-bitmap-creation.test.ts)
pass 15 cases on Node 24.19.0, 26.8.1, and custom 27, each in stock and compat
modes. They cover snapshots, formatting, taint, independent calls, immediate
rejection, validation order, receiving realms, Document activity, and dedicated/
shared worker task ownership. There are no expected failures in this slice.

## Blob reading and decoder boundary

The internal factory now includes HTML's Blob branch. Shared dimension checks run
before reading or scheduling parallel work. The operation retains BlobData and
the supplied MIME type, and copies the converted options/crop record. It reads
complete bytes on the host continuation queue, independently of the Blob's source
global, then uses the existing image-context MIME sniffer. Sniffing selects a
type; it does not prove the bytes decode successfully.

The approved `BitmapData.decode(bytes, mimeType, options, crop, env)` dependency
must produce independently owned, origin-clean pixels with the specified
formatting. Its TODO names codec selection, natural dimensions, the default
animation image/first frame, orientation, and color conversion. Empty input
already produces InvalidStateError. Nonempty input currently exposes the named
InternalError; no real image codec is claimed. Ordinary unsupported/corrupt-image
failures from a future decoder must instead use InvalidStateError.

Read failures become InvalidStateError on the receiving bitmap task source;
decoder failures retain their identity and are delivered on that same source.
The owning environment supplies Promise/result realms and ordinary global-task
lifetime handling. Source-Document inactivity cannot stall byte reading, while
receiving-Document inactivity gates delivery. The existing byte-read contract
has no abort input; this slice adds no teardown cancellation of backing I/O.

[The Blob suite](../../../test/browlet/graphics/image-bitmap-blob.test.ts) adds
15 cases using real Blob storage, sniffing, bindings and scheduling, with a
controlled replacement only for the missing decoder. Both creation suites pass
30 cases on all six runtime configurations. The 73 pixel-preparation cases also
pass on Node 26.8.1/compat after sharing dimension validation. Public exposure
and successful real-image decoding remain separate work, not passing acceptance
claims from the decoder replacement.

## Removal condition

Remove this roadmap once source extraction, loading, and Platform integration
have implemented source or narrower owning roadmaps. Shared graphics work stays
with its subsystem.
