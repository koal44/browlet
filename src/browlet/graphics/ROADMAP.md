# Graphics primitives roadmap

HTML §8.11's image objects are shared primitives for canvas, workers, and later
graphics APIs. They are not part of the initial rendering engine merely
because animation frames appear in the same HTML chapter.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `image-data.ts` | `ImageData`, pixel formats, storage, color space, dimensions, and constructor validation | HTML §8.11.1 |
| `image-bitmap.ts` | `ImageBitmap`, source decoding/cropping, orientation, resize, color conversion, close, and realm-correct promises | HTML §8.11.2 |
| `image-source.ts` | Shared image-source extraction/decoding capability consumed by canvas and element loading | HTML §8.11; HTML §4.8 |
| `web-idl.ts` | ImageData/ImageBitmap interfaces, dictionaries, enums, and exposure | HTML §8.11 |

Decoders and pixel buffers are injected host capabilities. Public objects and
their Web IDL conversions remain Browlet-owned; Node-native image objects must
not leak onto the author-facing surface.

## Removal condition

Burn this file once image data and bitmap creation have implemented source or
a narrower canvas/decoder roadmap.
