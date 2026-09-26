# Media and Media Source Extensions roadmap

**Status:** planned; ownership and dependency review complete. Media
implementations are deferred to the later media work in Browlet's priority
roadmap. File API's completed Blob URL path uses `BlobImpl` entries and a
provisional Blob-only `URL.createObjectURL()` declaration. Media Source
Extensions (MSE) is not a Fetch preflight prerequisite.

## Sources and scope

Reviewed the [MSE editor's draft](https://w3c.github.io/media-source/), dated
7 August 2026, on 23 September 2026. This review covers its normative sections
and implementation dependencies; it is not a conformance audit of implemented
media behavior. The draft is maintained as ReSpec HTML, rather than Bikeshed.

- [HTML media elements](https://html.spec.whatwg.org/multipage/media.html#media-elements)
  supply the element lifecycle and shared media types. In the local HTML source,
  search for `HTMLMediaElement`, `TimeRanges`, and `MediaProvider`.
- The [byte stream format registry](https://www.w3.org/TR/mse-byte-stream-format-registry/)
  links separate specifications for WebM, ISO BMFF, MPEG-2 TS, and MPEG audio.
  Choose supported formats explicitly before implementing a segment parser.
- [File API §8](https://w3c.github.io/FileAPI/#url) owns object URL registration;
  its [roadmap](../../file/ROADMAP.md#blob-url-integration)
  remains authoritative for URL parsing, revocation, and Fetch integration.

This folder owns shared media state and MSE implementations. HTML audio/video
element implementations remain under `html/elements/embedded/`, consuming this
folder's support types. Suitable later residents include `TimeRanges`,
`MediaError`, tracks and track lists, timed-text support, and playback/backend
integration. Create those modules when their behavior arrives.

Web Audio, WebCodecs, capture/MediaStream, WebRTC, encrypted media, and
picture-in-picture are separate projects, not implicit additions to MSE.
MSE needs a media backend, but does not require exposing the public
WebCodecs API. HTML's full `MediaProvider` union also names `MediaStream`, defined
by [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/#mediastream);
account for that declaration before claiming a complete `srcObject` surface.

## Ownership

- `MediaSourceImpl`, its buffer/list implementations, and their IDL belong
  together here. Reuse Browlet's existing EventTarget and event-handler machinery.
- `integration/file/blob-url.ts` owns `BlobURLStore` and `BlobURLEntry` beside
  FileReader. Each UserAgent retains its store. This permits the eventual
  concrete `BlobImpl | MediaSourceImpl` union without an upward import from File.
- Portable Blob/File implementations remain in `src/file`. URL and Fetch must
  receive explicit lookup/acquisition contracts, not import Browlet's store or
  MediaSource. There is one store and one retained implementation identity.
- Range arithmetic and buffering state belong to media implementations. A
  genuine decoder/output backend gets a narrow Host Port at composition time;
  do not make a second environment or move Binding Context into media objects.

## Dependency gates

| Dependency | Defining specification | Current Browlet state | First consumer / action |
| --- | --- | --- | --- |
| EventTarget, Event, event handlers, Web IDL projection, buffers, and task queues | [DOM events](https://dom.spec.whatwg.org/#events), [Web IDL](https://webidl.spec.whatwg.org/), and [HTML event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops) | Implemented | Reuse for A; select the owning global and proper task source when delivery is added |
| `TimeRanges` and range operations | [HTML §4.8.11.14, Time ranges](https://html.spec.whatwg.org/multipage/media.html#time-ranges) | Missing; shared media type owned here | A: first concrete missing dependency, reached by MediaSource's initial live range; implement the shared type rather than a private MSE substitute |
| `SourceBufferList`, `SourceBuffer`, and `MediaSourceHandle` declarations | MSE itself: [§6 SourceBufferList](https://w3c.github.io/media-source/#sourcebufferlist), [§5 SourceBuffer](https://w3c.github.io/media-source/#sourcebuffer), and [§4 MediaSourceHandle](https://w3c.github.io/media-source/#mediasourcehandle) | Missing; owned by this roadmap, not separate prerequisite projects | A must account for the whole declaration graph without substituting `object` for interface types |
| HTMLMediaElement loading, playback state, and seeking | [HTML §4.8.11, Media elements](https://html.spec.whatwg.org/multipage/media.html#media-elements), especially §§4.8.11.5–4.8.11.9 | Roadmapped in [HTML elements](../html/elements/ROADMAP.md); no implementations | B: supply actual element state and lifecycle before implementing attachment and playback-facing algorithms |
| `MediaError` | [HTML §4.8.11.1, Error codes](https://html.spec.whatwg.org/multipage/media.html#error-codes) | Missing; shared media type owned here | B: element errors used by MSE append and end-of-stream algorithms |
| Audio/video tracks and lists; text tracks and lists | [HTML §4.8.11.10.1](https://html.spec.whatwg.org/multipage/media.html#audiotracklist-and-videotracklist-objects) and [§4.8.11.11, Timed text tracks](https://html.spec.whatwg.org/multipage/media.html#timed-text-tracks); MSE §§11–13 extend those types | Missing; shared media types owned here | B/C: actual track identities and lists for initialization segments and active-buffer selection |
| Format parsing and codec support | [MSE §14, Byte Stream Formats](https://w3c.github.io/media-source/#byte-stream-formats), plus the separate format specifications listed below | No media implementation or selected formats | B/C: agree on supported formats; MIME parsing alone cannot establish codec support |
| Decoder/output backend | HTML's [playback requirements (§4.8.11.8)](https://html.spec.whatwg.org/multipage/media.html#playing-the-media-resource) and the selected codec specifications constrain behavior; no particular backend API or library is prescribed | No backend selected | B/C: choose an implementation and its Host Port; exposing WebCodecs is not a prerequisite |
| Dedicated-worker execution and lifetime | [HTML §10.2.1.2, DedicatedWorkerGlobalScope](https://html.spec.whatwg.org/multipage/workers.html#dedicated-workers-and-the-dedicatedworkerglobalscope-interface), plus §§10.2.2–10.2.4 for event loops, lifetime, and processing | [Worker roadmap](../workers/ROADMAP.md) only | D: real worker globals, agents, task delivery, closing, and termination |
| MessageChannel/MessagePort and transfer | [HTML §9.4.2, Message channels](https://html.spec.whatwg.org/multipage/web-messaging.html#message-channels), [§9.4.4, Message ports](https://html.spec.whatwg.org/multipage/web-messaging.html#message-ports), and [§2.7, structured data](https://html.spec.whatwg.org/multipage/structured-data.html#safe-passing-of-structured-data) | [Communication roadmap](../communication/ROADMAP.md) only; structured-data transfer hooks already exist | D: cross-context communication and port transfer; MSE §4 supplies the MediaSourceHandle-specific transfer rules |
| Buffer budget and playback/efficiency policy | MSE §5.5.10, Coded Frame Eviction, and [§7.3, ManagedMediaSource algorithms](https://w3c.github.io/media-source/#managedmediasource), with §9.3.2, ManagedSourceBuffer memory cleanup | No media owner yet; concrete limits and efficiency decisions are implementation policy | C/E: explicit policy and deterministic test controls; no invented hardware or network signals |

The separate byte-stream specifications are [WebM](https://www.w3.org/TR/mse-byte-stream-format-webm/),
[ISO BMFF/MP4](https://www.w3.org/TR/mse-byte-stream-format-isobmff/),
[MPEG-2 TS](https://www.w3.org/TR/mse-byte-stream-format-mp2t/), and
[MPEG audio](https://www.w3.org/TR/mse-byte-stream-format-mpeg-audio/). They define
the accepted segment structures and reference the underlying formats. Review
the specifications for the formats we choose to support; MSE does not require
implementing every registered format.

Full MSE is therefore gated on B/C and D, not merely on a missing TypeScript
name. A headless backend need not display a GUI, but passing tests with invented
decoded frames is not evidence of format parsing or playback support.

## Implementation order

### A — Shared ranges and unattached MediaSource foundation

Add `TimeRangesImpl`, the real MediaSource/list identities and declarations,
initial state, event-handler storage, and the independent validation paths.
Keep related SourceBuffer/handle declarations explicit; show missing operations
at their consumers rather than inserting empty stand-ins to satisfy a union.

Then extend the existing Blob URL store and `URL.createObjectURL()` declaration
with the real MediaSource implementation. Existing Blob support is independent
of this media work. An unattached object and an object URL do not establish
playback support. Do not report worker or codec support that Browlet cannot provide.

**Proof:** projection/brand checks, initial state, range boundaries, rejected
calls, identity-preserving URL registration, revocation, and environment cleanup.

### B — Window media attachment and HTML prerequisites

Implement the media-element/track state needed by attachment, detachment,
duration, errors, and local media loading, coordinating with the HTML element
owner. Settle the backend and supported-format contract here. The resource
loader must recognize the retained MediaSource; treating its URL as Blob bytes
does not perform attachment.

**Gate:** actual HTML media consumers and backend decisions. Write calls to the
needed element/backend operations first and review absent dependencies before
expanding the HTML or host surface.

### C — SourceBuffer and the media pipeline

Implement the SourceBuffer state machine, parser/track-buffer algorithms, range
updates, event sequencing, and backend integration. Follow MSE §5 in order;
split the parser, coded-frame, and splice work further if needed when executing
this slice. Use real byte-stream fixtures as well as focused algorithm tests.

**Gate:** B and a selected format implementation. Parser bookkeeping, decoded
output, and host resource limits need distinct tests; an all-false capability
probe or a buffer that discards appended bytes does not complete this slice.

### D — Dedicated workers and MediaSourceHandle

Connect the existing transferable machinery to real worker execution and media
attachment. Test same-cluster transfer, sender detachment, failed reuse,
destination exposure, communication, and worker shutdown with actual workers.

**Gate:** Workers and Communication. Preserve their ownership of agents and
channels; no MSE-private worker scheduler or substitute MessagePort.

### E — Managed media, completion, and conformance

Add the managed interfaces and BufferedChangeEvent on the completed pipeline.
Make memory and streaming decisions testable. Finish the coverage ledger below,
then run applicable WPT and browser comparisons for disputed behavior.

**Gate:** C, D, and reviewed resource policy. Review §7.3.1's relationship between
the assigned `streaming` boolean and the `startstreaming`/`endstreaming` names
against browser implementations before choosing an interpretation.

## Coverage ledger

| Draft sections | Planned slice / disposition |
| --- | --- |
| §1 introduction; §2 definitions | Shared model for A–E; retain configuration requirements when selecting backend support |
| §3.1–§3.13 MediaSource surface | A foundations; B/C live behavior; D worker handle |
| §3.14 cross-context model; §3.15.8 mirroring | D |
| §3.15.1–§3.15.7 attachment and playback integration | B/C, then D worker path |
| §4 MediaSourceHandle | D |
| §5.1–§5.4 SourceBuffer surface and track state | A declarations, C implementation |
| §5.5.1–§5.5.7 parsing, append, removal, and initialization | C |
| §5.5.8–§5.5.13 coded frames, eviction, and splicing | C; decoder/output dependency remains explicit |
| §6 SourceBufferList | A, with mutations/events completed by B/C |
| §§7–9 managed interfaces and range-change events | E |
| §10 HTMLMediaElement extensions | B/C, then D worker path |
| §§11–13 track extensions | B/C, then D cross-context behavior |
| §14 byte stream formats | B/C; separate format specifications must be reviewed for every advertised format |
| §15 conformance | Final verification across A–E |
| §§16–17 examples/acknowledgments; appendices | Examples are integration candidates; Appendix A points playback-quality metrics to their separate specification |

Keep this roadmap until the implementation and dependency decisions have been
reviewed. Replace it with maintained documentation only with Eric's agreement.
