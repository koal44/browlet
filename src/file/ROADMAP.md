# File API project roadmap

This directory will own Browlet's host-neutral implementation of the
[File API Editor's Draft](https://w3c.github.io/FileAPI/): immutable Blob data,
`Blob`, `File`, `FileList`, and file-reading algorithms. The browser-owned
blob-URL store and URL declaration contribution live in Browlet's File integration.
Browlet will supply realms, events, task destinations, environment settings,
user-agent lifetime, storage partitions, and browser-selected file sources.
Fetch and XHR will consume the resulting semantic objects; neither should
redefine them or substitute Node's similarly named globals.

Slices 1–3 and 5–6 are implemented; Slice 7 is implemented except for shared
global teardown. Blob and File share immutable segmented
backing, projected stream and promise reads, realm-correct result objects,
cancellation and failure routing, and HTML Serializable integration. FileList
preserves owner-controlled mutation, indexed access, and graph identity.
FileReader is implemented through §6.4 except for shared global teardown.
Slice 4, the Blob URL work in §§8.2–8.4, is implemented for Blobs through the
A–C preflight plan below: storage keys, the browser-owned store, URL parsing,
Document cleanup, and the public URL methods. Actual Fetch dispatch remains
in Fetch 8C; MediaSource and worker lifecycle remain deferred. §6.5
`FileReaderSync` waits for real workers.

Blob's `text()`, `bytes()`, and `arrayBuffer()` share a runtime-owned Promise
read-result path, with focused coverage for HTML delivery and binding projection.
Blob and File retain their construction runtime, including native line endings;
slices keep it and deserialization supplies the destination runtime. Backing
`BlobData` remains runtime-neutral. Blob streams deliver buffers through the
Blob's runtime; FileReader retains its final result buffer without a projection
copy or separate cache. These paths follow
the [Streams runtime and binding contracts](../streams/README.md#runtime-and-bindings).
FileReader's event-driven reads and result bindings have focused passing coverage.

The roadmap deliberately put the Fetch-enabling data model before
`FileReader`. This is the one departure from specification order. Blob and File
are direct Fetch prerequisites; FileList completes the file-selection model
consumed by HTML and FormData. FileReader is not a Fetch prerequisite and also
consumes `ProgressEvent`, which is defined by XHR §5 and was therefore a small,
genuine cross-specification prerequisite. Blob URL resolution is later
File/URL/Fetch integration and does not block Fetch's foundational records and
network-independent APIs.

## Controlling architecture

The public object and its backing bytes are different responsibilities. A
`Blob` is an immutable view over a byte sequence and metadata. Its backing data
can be composed from copied BufferSource bytes, encoded strings, existing
Blobs, slices, or a future host-selected file. Constructing a Blob from another
Blob or slicing one must not eagerly copy all of its bytes.

Use a host-neutral immutable byte-source boundary with these properties:

- it reports an exact byte length and snapshot state;
- it can produce bounded chunks asynchronously and report File API failure
  reasons;
- in-memory sources own copied bytes, while Blob parts and slices can share
  immutable backing segments;
- a host-file source can later validate its captured snapshot before reading;
  and
- no source exposes a filesystem path, Node stream, file descriptor, or Node
  `Blob` to author-facing or cross-project code.

WebKit, Blink, and Gecko all make this same essential separation. WebKit uses
internal Blob URLs and a threadable registry, Blink uses Blob data handles and
a browser-side blob service, and Gecko uses a family of `BlobImpl` backends.
Those process and IPC architectures are not Browlet requirements. The useful
lesson is the shared immutable backing-data boundary, not any engine's
registry topology.

For §§4–5, use WebKit as the primary structural comparison. Its constructed
`File` delegates Blob-part processing to `Blob`, adds only name and captured
last-modified state, and its `FileList` keeps mutation private to owners such
as file inputs and `DataTransfer`. Blink is useful secondary evidence for
constructor conversion, wall-clock defaults, and current `textStream()`
integration. Gecko is most useful when designing a future host-file backend
and read-failure boundary. Its polymorphic file backends, and both engines'
path, IPC, and registry state, are browser infrastructure rather than a model
to reproduce in Browlet.

Two engine details are evidence, not precedent. WebKit's host-file
`lastModified` getter still performs synchronous filesystem I/O and says that
the result should instead be cached and monitored. Blink's serializer admits
that a File repeated inside and outside a FileList is not deduplicated. Follow
the File snapshot model and HTML sub-serialization memory instead of copying
either divergence.

FileReader similarly does not need a private network loader. Browser engines
reuse loader-style infrastructure because their Blob backends span files,
processes, and IPC. Browlet implements the normative stream/read loop over the
host-neutral byte-source and Streams boundaries in
`src/browlet/integration/file/file-reader.ts`, where the concrete object can
use Browlet's EventTarget, task, clock, and global-lifecycle facilities without
making `src/file` depend on Browlet.

The blob URL store belongs to the User Agent, not to a module-global map, a
Realm, or an individual Window. Entries strongly retain their object and the
creating environment. URL parsing and Fetch receive narrow lookup operations;
they do not own the store.

The concrete store and entries live in `src/browlet/integration/file/blob-url.ts`,
alongside FileReader. This placement allows the real browser-owned MediaSource
to join the retained object union without making portable File import Browlet.
The [media roadmap](../browlet/media/ROADMAP.md) owns that implementation and its
dependency gates. Store tests live in `test/browlet/blob-url.test.ts`.

`BlobURLStore` owns generation, registration, exact removal, and fragment-free
lookup, plus creating-environment cleanup. `BlobURLEntry` owns partition checks
and object acquisition; its retained object is private so consumers go through
that check. Both environments supply
Storage-owned non-storage keys, including opaque-origin identity. Each UserAgent
constructs its store with itself, satisfying `StorageUserAgent` and supplying
`generateUUID()`. `add()` returns the serialized key; `remove()` accepts that
string directly or an existing URL record. Author revocation must still parse
its input and authorize access before removing an entry.

The creating environment must provide its actual origin. Acquisition and
partition checks accept the broader `StorageEnvironment`, including an earlier
record whose origin comes from its creation URL. Fetch and HTML select the
explicit top-level exemptions before calling object acquisition.

## Planned ownership

Create modules only as their behavior arrives. The likely final division is:

| Planned area | Responsibility | File API sections |
| --- | --- | --- |
| `blob-data.ts` | Immutable segment graph, bounded asynchronous reads, slicing, snapshot state, and failure reasons | §§2–3 and 7 |
| `blob.ts` | Blob construction, part processing, type normalization, attributes, slicing, streams, promises, and declaration | §§2–3 |
| `file.ts` | File construction, name, modification time, file type, host-file source integration, and declaration | §4 |
| `file-list.ts` | Owner-mutable ordered File collection, indexed getter, serialization state, and declaration | §5 |
| `browlet/integration/file/blob-url.ts` | User-agent store, entry generation/removal/resolution, partition checks, and environment cleanup | §§8.2–8.4 |
| `browlet/integration/file/file-reader.ts` | Browlet's concrete asynchronous reader state, methods, cancellation, stream consumption, declaration, and event sequencing | §§6.1–6.4 and 7 |
| `package-data.ts` | Data URL, text, ArrayBuffer, and binary-string materialization | §6.3 |
| `integration.ts` | Native-line-ending policy plus the File-reading scheduler capability. Keep future UUID and host-I/O effects with their actual owner rather than rebuilding a service bag | Cross-cutting |
| `web-idl.ts` | Lossless File API definitions and cross-package contributions assembled by Browlet | §§3–6 and 8.4 |

The HTML structured-data implementation will own the registered Serializable
capabilities for Blob, File, and FileList because HTML defines the generic
serialization machinery. `src/file` will export narrow state accessors so that
the Browlet integration can implement the File API's normative serialization
and deserialization steps without duplicating Blob state.

## Dependency ledger

| Dependency | First required by | Present state | Delivery decision |
| --- | --- | --- | --- |
| Web IDL BufferSource, USVString, dictionaries, promises, indexed properties, and projection | §§3–6 | Implemented | Use declarative definitions and existing BufferSource copy/detachment machinery. Keep realm selection, conversion, and promise projection at the boundary |
| Infra byte sequences, lists, and Base64 | §§2–6 | Byte/list representations and forgiving Base64 encoding exist in `src/infra` | Reuse the Base64 encoder for Data URLs; do not route through `Buffer` or `btoa()` |
| Encoding labels, UTF-8 operations, and TextDecoderStream | §§3.1, 3.3.3, 3.3.6, and 6.3 | Implemented in `src/encoding`, including internal access to a `TextDecoderStream`'s associated actual `TransformStream` | Blob text APIs are always UTF-8; FileReader text decoding instead honors labels and MIME parameters |
| Streams byte streams and read-all-bytes operations | §§3 and 6 | Implemented, including the cross-specification byte-stream factory, enqueue/error/close operations, default-reader acquisition, read-all-bytes, and piping through an actual `TransformStream` | Reuse these exact boundaries. Do not widen the transform helper to an arbitrary readable/writable pair or call projected author methods from internal algorithms |
| HTML parallel work, global tasks, event loop, and time | §§3, 6.1–6.4 | Blob and FileReader reads use `runtime.runInParallel()` for background execution and `runtime.fileReading.queueTask()` for delivery; FileReader retains removable handles only for its active operation; native line endings come from the Node platform and File's wall-clock default uses `Date.now()` | Cancellation removes only the active reader's tasks and cancels its Streams reader. Do not scan or mutate private queues from File code |
| HTML script/callback cleanup and global lifecycle | §§6.2–6.4 | HTML §§8.1.3.3 and 8.1.4.4 callback/script preparation, cleanup, and the checkpoint boundary are implemented for Browlet-controlled entries; Window/worker destruction remains incomplete | Keep FileReader's specified synchronous event order. The promise-based event-sequencing WPTs run through the shared lifecycle; later cancel outstanding reads from the shared global-destruction hook |
| DOM Event, EventTarget, event handlers, and DOMException | §§6–7 | Implemented in Browlet | Keep FileReader as one concrete EventTarget implementation in `src/browlet/integration/file`; do not split its state into a File facade plus a Browlet event object merely to reproduce the specification boundary |
| XHR `ProgressEvent` and fire-a-progress-event | §6.4 | Implemented in `src/browlet/dom/events/progress-event.ts`, with XHR contributing its declaration | Reuse that event and helper when implementing FileReader; File API must not create a private lookalike event |
| HTML structured data | Serializable declarations in §§3–5 | Blob, File, and FileList are registered and tested for ordinary, storage, and target-realm cloning through HTML §2.7 | Preserve sub-serialization for FileList so repeated File references retain graph identity |
| MIME parsing and file-type policy | §§3.2, 4, and 6.3 | MIME parsing/sniffing is implemented; host-selected file type discovery is not | Constructed type normalization is entirely File API-owned. A future file-selection host may provide a validated MIME type under the file-type guidelines; never sniff an encoding statistically |
| URL records, parsing, origins, and serialization | §8 | Implemented in `src/url`; B supplies store resolution, but parsing still leaves the entry null | In C, add an explicit resolver seam so a host parse can attach the User Agent's entry without making URL depend on File. Remove the provisional private entry shape rather than adding a second parser |
| Environment settings and origins | §§8.2–8.4 | Window settings and origins exist; worker settings are incomplete | Blob URL entries retain the creating settings object through a Browlet-owned store. URL generation uses its origin, including implementation-defined serialization for opaque origins |
| Storage keys for non-storage purposes | §8.3.2 | Slice A implements acquisition and comparison in `src/storage` | Consume Storage-owned keys, preserving opaque-origin identity and the distinction from storage-disabled policy. Do not substitute a local origin check |
| Fetch `blob:` scheme handling | §8.3 | Request/Response/body primitives exist; scheme dispatch remains in Fetch 8C | File API owns store resolution and authorization; Fetch owns the response, range/header behavior, network errors, and body stream |
| Document and worker cleanup | §8.3.3 | Document unloading cleanup calls the real `UserAgent.blobURLStore.removeForEnvironment()`, with destruction coverage; worker lifecycle is incomplete | Remove registrations by creating-environment identity. Never rely on platform-object garbage collection to revoke URLs; connect worker cleanup when its lifecycle exists |
| MediaSource | §8 and the partial `URL` interface | Deferred to the [media roadmap](../browlet/media/ROADMAP.md); not a Blob URL prerequisite | Entries remain typed as `BlobImpl`; C exposes a provisional Blob-only `createObjectURL()` declaration. Extend both with the real MediaSource implementation when available |
| Worker globals | §§3–6 and 8 | Worker execution/lifecycle is roadmapped but incomplete | Preserve exposure metadata. Blob/File core remains usable in Window; FileReaderSync and executable worker installation wait for real worker globals |
| Native file selection and filesystem access | §§4, 7, and 9 | Constructed Files and the opaque host-source factory exist; HTML selection, drag-and-drop, permission UI, and a host-file backend do not | The future selecting host supplies sanitized metadata and an existing byte source; never read arbitrary paths or expose a path-based constructor |
| Wall-clock time | §4.1 | Uses the directly available ECMAScript `Date.now()` operation | Capture a constructed File's default once; read again only for a host file whose modification time remains unknown |
| UUID generation | §8.2 | The store retains its `StorageUserAgent`; Browlet supplies `generateUUID()` and tests use deterministic UUIDs | Each UserAgent owns its store; File calls the supplied owner without importing Node crypto |

## Delivery order

Implement algorithms in specification order within each slice. Preserve their
normative names and step ordering unless an optimization is behaviorally
equivalent and documented.

### Slice 1 — Immutable data substrate and Blob core (implemented)

**Scope:** File API §2, §3 through §3.3.1, and the Blob-related failure model
in §7.

- Define the immutable byte-source and segment representations, including an
  in-memory source and bounded slice views.
- Copy BufferSource bytes at construction time, UTF-8 encode USVStrings, share
  existing immutable Blob data, and flatten segment references enough to avoid
  recursive read chains.
- Implement native line-ending conversion from an explicitly supplied
  platform convention, with deterministic tests for LF and CRLF.
- Implement Blob type normalization, size, construction, processing blob
  parts, slice blob, and `slice()`.
- Preserve metadata independently from backing data so slices can share bytes
  while receiving their own normalized type.
- Define snapshot-state and read-failure contracts without claiming native-file
  support yet.
- Keep internal byte arrays inaccessible and immutable by construction.

**Exit proof:** constructor, BufferSource-copy, surrogate replacement,
line-ending, nested-Blob, type, size, positive/negative/out-of-range slice,
empty slice, and no-eager-copy tests pass against applicable WPT cases.

### Slice 2 — Blob streams, promise reads, and serialization (implemented)

**Scope:** the Blob get-stream and Serializable algorithms in §3, followed by
§§3.3.2–3.3.6.

- Establish the cross-project Streams operations needed to create a byte
  stream in the Blob's relevant Realm and enqueue asynchronously read chunks
  through the file-reading task source.
- Implement stream failure and cancellation without exposing the backing
  source or a Node stream.
- Implement `stream()`, `text()`, `arrayBuffer()`, `bytes()`, and
  `textStream()` with target-realm Streams, promises, ArrayBuffers, typed
  arrays, and TextDecoderStream.
- Register Blob serialization/deserialization through Browlet's HTML
  Serializable capability. Non-storage serialization may share immutable
  backing only when equivalent; storage serialization must retain a
  storage-safe byte sequence and snapshot state.
- Test chunk boundaries independently of the observable concatenated result;
  the draft deliberately leaves chunk size implementation-defined.

**Exit proof:** every read surface returns objects from the correct Realm,
produces identical bytes across chunking strategies, remains independent of
source BufferSource mutation, propagates read failures, and survives
structured cloning with distinct wrappers and equivalent immutable data.

#### Generic-transform piping seam (complete)

**Scope:** File API §3.3.6, Streams §9.3's `GenericTransformStream` wrapping
model and §9.5 piping operation, and Encoding §7.5 `TextDecoderStream`.

File API creates a `TextDecoderStream`, while Streams defines every object
including `GenericTransformStream` as owning an associated actual
`TransformStream`. An internal instance method exposes
that association to cross-specification algorithms. `Blob.textStream()` passes
the actual transform to `stream.pipeThroughTransform()` rather than reconstructing
its readable/writable pair or calling the projected author API. The binding
continues to expose only the public `readable` and `writable` attributes.

Blink independently creates the UTF-8 transform and passes its readable and
writable sides to `pipeThrough()`, confirming the wrapper/underlying-transform
distinction. WebKit and Gecko do not yet contain `Blob.textStream()` in the
reviewed checkouts, so they provide no stronger evidence for this new method.

### Slice 3 — File and FileList (implemented)

**Scope:** File API §§4–5.

- Implement `FileImpl` as a real `BlobImpl` subtype. Reuse Blob-part
  processing, immutable backing state, snapshot state, and type normalization
  rather than copying the Blob model into File.
- Let Web IDL convert the `USVString` name and inherited `FilePropertyBag`
  members. For a constructed File, capture the default host wall-clock value
  once during construction; its `lastModified` is stored state, not a live
  clock getter.
- Add an internal factory for host-selected files that accepts an opaque byte
  source, safe name, validated type, a known or unknown modification time, and
  captured snapshot. Only the unknown host-file case reads the wall clock from
  the getter, as §4 requires.
- Keep filesystem paths and type discovery in the future selecting host. The
  `FileImpl.fromHost()` factory accepts the already-sanitized metadata, existing
  byte source, and owning runtime. The host binding projects the resulting File.
- Implement FileList as an ordered owner-mutable list with `length`, `item()`,
  a declarative `indexedGetter()`, exact File identity, and no author
  constructor. Its "at risk" status does not authorize substituting an Array.
- Give HTML file inputs and future DataTransfer code explicit owner operations;
  do not make author-facing FileList mutation possible.
- Register File and FileList Serializable capabilities. File serialization
  composes the existing Blob state, including its observable MIME type, with
  name and the current value of `lastModified`. FileList uses HTML
  sub-serialization rather than copying entries so structured-data graph
  identity remains intact.
- Map missing, changed, unsafe, locked, or unreadable host sources to the §7
  failure reasons and DOMException names at the Browlet boundary.

**Exit proof:** the endings WPT and all File-specific constructor assertions
pass, including required arguments, sequence conversion, inherited dictionary
members, exception propagation, USVString names, type normalization, and
explicit/default modification times. The constructor WPT remains unselected
only because its Window variant also asserts the separately roadmapped
`HTMLBodyElement` identity. Focused tests cover File inheritance, FileList
indices/null/identity/order and owner mutation, snapshot failure, target-Realm
cloning, and repeated File identity through FileList sub-serialization. At this
checkpoint XHR FormData and Fetch Body can consume Blob and File without
FileReader.

### Slice 4 — Blob URL store and URL/Fetch integration

**Scope:** File API §§8.2–8.4, after the
[bounded storage-key prerequisite](../storage/ROADMAP.md#first-slice--storage-keys).

The Fetch preflight detour uses three subdivisions:

- **A — Storage keys (implemented).** Storage §4.2 acquisition and equality,
  environment/settings origin selection, opaque identities, and the
  user-agent storage preference. Owned by the linked Storage roadmap.
- **B — Blob URL store (Blob branch implemented).** File API §§8.2–8.3.2 generation, strong retention,
  entry lookup/removal, object acquisition, and storage-key authorization.
  The UserAgent owns the store and supplies UUID generation; §8.3.3 Document
  cleanup is also connected through the existing unloading hook.
  Focused tests cover fragments, opaque origins, cross-environment access,
  denied access, removal, the explicit top-level acquisition exemptions, and
  reads retaining an already-acquired Blob. Generation uses `blob:null/UUID`
  for opaque origins. Lookup excludes fragments; exact removal includes them.
- **C — Browser and consumer integration (Blob branch implemented).**
  `UserAgent.parseURL()` supplies URL's resolver with the browser-owned store.
  Request and redirect parsing retain entries and their origins; author-facing
  URL construction, parsing, and href assignment use the basic parser, as URL
  specifies. File's partial URL declaration supplies `createObjectURL()` and
  partition-checked `revokeObjectURL()` using the static method's environment.
  Fetch's UserAgent contract supplies authorized acquisition from the captured
  entry, without resolving again after revocation. Its actual `blob:` response,
  range handling, and dispatch remain in Fetch 8C.

A–C's Blob branch, UserAgent composition, and Document cleanup are implemented.
Worker lifecycle remains deferred to Workers. Document cleanup uses the existing
unloading hook, without a second resource-lifetime registry.

`test/browlet/object-url.test.ts` covers projected argument conversion, static
method ownership, cross-global authorization, opaque origins, disabled-storage
policy, redirect parsing, Request cloning across revocation, and destruction.
A frozen base URL also retains its captured entry after revocation. The test
for inheriting that base into a new browsing context is an approved TODO:
HTML's creator-context and Document-state inheritance helpers still throw.
The [browsing roadmap](../browlet/browsing/ROADMAP.md#missing-structural-concepts)
owns that dependency; the existing URL record is preserved at the inheritance
step instead of being serialized and reparsed.

MediaSource support is explicitly deferred. Entries, registration, and
acquisition retain their concrete `BlobImpl` typing. The author-facing
`createObjectURL()` declaration accepts Blob provisionally, with the full
specification IDL and the missing MediaSource branch recorded nearby. Extend
the entry and declaration together when the [media roadmap](../browlet/media/ROADMAP.md)
provides the real implementation. No media work is required to finish C.

**Exit proof:** opaque/tuple-origin generation, lookup, fragments, revocation,
cross-global same-partition use, cross-partition denial, environment cleanup,
strong retention, and already-started reads pass deterministic multi-global
tests. Fetch can acquire a captured Blob entry without using Node object URLs.

### Slice 5 — FileReader foundation (FileReader slice 1; implemented)

**Scope:** File API §6.1; the declaration, state, constructor, and getters in
§6.2; and §§6.2.1–6.2.2. The §6.2 read-operation algorithm remains in the next
slice.

- Add the concrete `FileReader` EventTarget implementation, its three states,
  result and error storage, constants, getters, and six event-handler
  attributes.
- Give queued file-reading tasks removable identities so one read operation
  can later cancel only its own pending work.
- Fix the later roughly-50-ms progress boundary on Browlet's existing shared
  monotonic clock; do not add a File-specific clock façade.
- Preserve the complete declaration without installing a partially functional
  author API before the remaining asynchronous algorithms exist.

**Exit proof:** implementation-level tests prove initial state, constant and
getter values, independent event-handler slots, EventTarget behavior, and
selective removal of queued file-reading tasks.

### Slice 6 — Asynchronous reads and result packaging (FileReader slice 2; implemented)

**Scope:** the read-operation algorithm in File API §6.2;
§§6.2.3–6.2.3.4; §6.3; and §§6.4–6.4.1.

- Implement the parallel stream-reader loop and the `readAsDataURL()`,
  `readAsText()`, `readAsArrayBuffer()`, and `readAsBinaryString()` entry
  points.
- Implement Data URL packaging with the shared Base64 encoder. Because the
  editor's draft still carries an underspecified Data URL issue, verify exact
  syntax against WPT and interoperable browser behavior and record the chosen
  interpretation near the algorithm.
- Implement text encoding-label precedence, MIME charset fallback, UTF-8
  fallback, realm-correct ArrayBuffer packaging, and the legacy binary-string
  path.
- Fire `loadstart`, throttled `progress`, `load`, `error`, and ordinary
  `loadend` events through XHR §5 `ProgressEvent`.

**Exit proof:** every result mode, read failure, first/final chunk, progress
timing boundary, event payload, and target-Realm result passes focused tests.

### Slice 7 — Abort, reentrancy, and public exposure (FileReader slice 3; implemented except global teardown)

**Scope:** File API §6.2.3.5, §6.4.2, and the asynchronous failure mappings in
§7.

- Implement abort by canceling the active stream reader and only that
  operation's queued tasks, then firing `abort` and conditional `loadend` in
  the specified order.
- Exercise reentrant read chaining from load, error, and abort handlers; an old
  operation must not fire stale progress or `loadend` events after a new read
  begins.
- Verify all five §7 failure reasons and their realm-correct DOMException
  mappings.
- Install the complete `FileReader` declaration in Browlet. Tie outstanding
  work to global destruction once HTML supplies the shared Window/worker
  destruction hook; inactive-document task gating prevents event delivery in
  the meantime, but garbage collection is not lifecycle.

**Exit proof:** state guards, abort, stale-task cancellation, reentrant reads,
wrong-Realm objects, and the independently runnable FileAPI WPT groups pass.
The WPT sequences which await between `load`, `error`, or `progress` and
`loadend` are enabled through HTML §8.1.4.4's cleanup checkpoint. Global
teardown remains the shared-lifecycle tail and does not belong in
FileReader-specific machinery.

## Deferred worker tail

File API §§6.5–6.5.1.5 define `FileReaderSync` only for DedicatedWorker and
SharedWorker. Waiting synchronously for a stream promise is not meaningful on
the current single-threaded Window host and must not be approximated with
`Atomics.wait()`, Node internals, or a nested event loop.

Implement `FileReaderSync` when Browlet has real worker agents and a host byte
source that supports a synchronous worker read contract. Its packaging logic
should reuse §6.3, but the read operation must not manufacture synchrony over
the asynchronous Streams API.

## Explicit non-goals and stop conditions

- Do not use Node's `Blob`, `File`, object URLs, filesystem paths, streams, or
  `Buffer` as Browlet platform objects or semantic records.
- Do not eagerly concatenate existing Blob parts or copy slices merely because
  the first implementation uses in-memory data.
- Do not put the blob URL store in module scope, Realm state, or URL.
- Do not equate origin equality with storage-partition equality.
- Do not expose arbitrary filesystem access; file selection and permissions
  belong to their HTML/host consumers.
- Do not implement a FileReader-specific progress event; consume XHR §5.
- Do not expose `FileReaderSync` before workers can satisfy its execution
  model.
- Keep the provisional Blob-only `createObjectURL()` limitation explicit;
  do not substitute `object` or a fake MediaSource for the missing union member.
- Do not let serialization resolve, decode, normalize, or reread a File; it
  preserves the value's captured byte and snapshot state.

## Final completion audit

Before declaring the project complete:

1. Audit File API §§2–8 in document order against the current Editor's Draft.
2. Run constructor, slice, stream, structured-clone, FileList, FileReader,
   error, blob-URL, partition, and lifetime WPT groups separately so failures
   retain an architectural owner.
3. Compare disputed storage, progress, cancellation, and URL behavior with
   WebKit, Blink, and Gecko, treating implementations as evidence rather than
   automatic authority.
4. Verify that Fetch consumes Blob data and URL entries through File-owned
   contracts, XHR consumes the same Blob/File objects, and HTML remains the
   owner of file selection and structured-data machinery.
5. Verify that every host-selected File preserves snapshot and security
   boundaries without leaking its path or backend.
6. Remove this roadmap only when all deferrals have either been implemented or
   moved to the surviving roadmap of their actual owner.
