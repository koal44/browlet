# File API project roadmap

This directory will own Browlet's host-neutral implementation of the
[File API Editor's Draft](https://w3c.github.io/FileAPI/): immutable Blob data,
`Blob`, `File`, `FileList`, file-reading algorithms, and the blob-URL store.
Browlet will supply realms, events, task destinations, environment settings,
user-agent lifetime, storage partitions, and browser-selected file sources.
Fetch and XHR will consume the resulting semantic objects; neither should
redefine them or substitute Node's similarly named globals.

Slices 1 through 3 are implemented. Blob and File now share immutable segmented
backing, projected stream and promise reads, realm-correct result objects,
cancellation and failure routing, and HTML Serializable integration. FileList
preserves owner-controlled mutation, indexed access, and graph identity. Blob
URLs and FileReader remain below.

The roadmap deliberately puts the Fetch-enabling data model before
`FileReader`. This is the one departure from specification order. Blob, File,
and blob-URL resolution are direct Fetch prerequisites; FileList completes the
file-selection model consumed by HTML and FormData. FileReader is not a Fetch
prerequisite and also consumes `ProgressEvent`, which is defined by XHR §5 and
is therefore a small, genuine cross-specification prerequisite.

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
processes, and IPC. Browlet can implement the normative stream/read loop over
the byte-source and Streams boundaries, with Browlet supplying EventTarget,
task, clock, and global-lifecycle integration.

The blob URL store belongs to the User Agent, not to a module-global map, a
Realm, or an individual Window. Entries strongly retain their object and the
creating environment. URL parsing and Fetch receive narrow lookup operations;
they do not own the store.

## Planned ownership

Create modules only as their behavior arrives. The likely final division is:

| Planned area | Responsibility | File API sections |
| --- | --- | --- |
| `blob-data.ts` | Immutable segment graph, bounded asynchronous reads, slicing, snapshot state, and failure reasons | §§2–3 and 7 |
| `blob.ts` | Blob construction, part processing, type normalization, attributes, slicing, streams, promises, and declaration | §§2–3 |
| `file.ts` | File construction, name, modification time, file type, host-file source integration, and declaration | §4 |
| `file-list.ts` | Owner-mutable ordered File collection, indexed getter, serialization state, and declaration | §5 |
| `blob-url-store.ts` | User-agent store, entry generation/removal/resolution, partition checks, and environment cleanup | §§8.2–8.4 |
| `file-reader.ts` | Asynchronous reader state, methods, cancellation, stream consumption, and event sequencing | §§6.1–6.4 and 7 |
| `package-data.ts` | Data URL, text, ArrayBuffer, and binary-string materialization | §6.3 |
| `integration.ts` | Separate native-line-ending and wall-clock Host Ports plus the File-reading scheduler capability. Keep future UUID and host-I/O effects with their actual owner rather than rebuilding a service bag | Cross-cutting |
| `web-idl.ts` | Lossless File API definitions and cross-package contributions assembled by Browlet | §§3–6 and 8.4 |

The HTML structured-data implementation will own the registered Serializable
capabilities for Blob, File, and FileList because HTML defines the generic
serialization machinery. `src/file` will export narrow state accessors so that
the Browlet integration can implement the File API's normative serialization
and deserialization steps without duplicating semantic state.

## Dependency ledger

| Dependency | First required by | Present state | Delivery decision |
| --- | --- | --- | --- |
| Web IDL BufferSource, USVString, dictionaries, promises, indexed properties, and projection | §§3–6 | Implemented | Use declarative definitions and existing BufferSource copy/detachment machinery. Keep realm selection, conversion, and promise projection at the boundary |
| Infra byte sequences, lists, and Base64 | §§2–6 | Byte/list representations and forgiving Base64 encoding exist in `src/shared` | Reuse the Base64 encoder for Data URLs; do not route through `Buffer` or `btoa()` |
| Encoding labels, UTF-8 operations, and TextDecoderStream | §§3.1, 3.3.3, 3.3.6, and 6.3 | Implemented in `src/encoding`, including internal access to a `TextDecoderStream`'s associated actual `TransformStream` | Blob text APIs are always UTF-8; FileReader text decoding instead honors labels and MIME parameters |
| Streams byte streams and read-all-bytes operations | §§3 and 6 | Implemented, including the cross-specification byte-stream factory, enqueue/error/close operations, default-reader acquisition, read-all-bytes, and piping through an actual `TransformStream` | Reuse these exact boundaries. Do not widen the transform helper to an arbitrary readable/writable pair or call projected author methods from internal algorithms |
| HTML parallel work, global tasks, event loop, and time | §§3, 6.1–6.4 | Blob reads use a narrow File-reading capability for Browlet's shared `runInParallel()` policy and the file-reading task source; native line endings come from the Node platform and File's wall-clock default uses `Date.now()` | FileReader still needs an owner/cancellation identity for removing only its queued tasks and monotonic progress timing. Do not scan or mutate private queues from File code |
| DOM Event, EventTarget, event handlers, and DOMException | §§6–7 | Implemented in Browlet | Keep FileReader's semantic read state in `src/file`; Browlet supplies the EventTarget implementation, handler composition, realm-correct exceptions, and dispatch |
| XHR `ProgressEvent` and fire-a-progress-event | §6.4 | Roadmapped as XHR slice 1, not implemented | Implement that bounded XHR slice before exposing FileReader. File API must not create a private lookalike event |
| HTML structured data | Serializable declarations in §§3–5 | Blob, File, and FileList are registered and tested for ordinary, storage, and target-realm cloning through HTML §2.7 | Preserve sub-serialization for FileList so repeated File references retain graph identity |
| MIME parsing and file-type policy | §§3.2, 4, and 6.3 | MIME parsing/sniffing is implemented; host-selected file type discovery is not | Constructed type normalization is entirely File API-owned. A future file-selection host may provide a validated MIME type under the file-type guidelines; never sniff an encoding statistically |
| URL records, parsing, origins, and serialization | §8 | Implemented in `src/url`; blob-entry lookup is explicitly provisional and always null | Add an explicit resolver seam so a host parse can attach the User Agent's entry without making URL depend on File. Remove the provisional private entry shape rather than adding a second parser |
| Environment settings and origins | §§8.2–8.4 | Window settings and origins exist; worker settings are incomplete | Blob URL entries retain the creating settings object through a Browlet-owned store. URL generation uses its origin, including implementation-defined serialization for opaque origins |
| Storage keys for non-storage purposes | §8.3.2 | Roadmapped but not implemented | Deliver the bounded Storage Standard key/partition comparison before author-facing blob URL fetch or revocation. Same-origin is not an acceptable partition substitute |
| Fetch `blob:` scheme handling | §8.3 | Fetch is roadmapped but not implemented | File API owns store resolution and authorization; Fetch owns the response, range/header behavior, network errors, and body stream |
| Document and worker cleanup | §8.3.3 | Full unload/destroy cleanup and worker lifecycle are incomplete | Add one environment-destruction hook that removes matching store entries. Never rely on wrapper garbage collection to revoke URLs |
| MediaSource | §8 and the partial `URL` interface | Not implemented | Keep MediaSource-capable store typing extensible, but do not invent MediaSource or publish a knowingly false Blob-only signature for the normative union. Reassess declaration assembly when exposing `createObjectURL()` |
| Worker globals | §§3–6 and 8 | Worker execution/lifecycle is roadmapped but incomplete | Preserve exposure metadata. Blob/File core remains usable in Window; FileReaderSync and executable worker installation wait for real worker globals |
| Native file selection and filesystem access | §§4, 7, and 9 | Constructed Files and the opaque host-source factory exist; HTML selection, drag-and-drop, permission UI, and a host-file backend do not | The future selecting host supplies sanitized metadata and an existing byte source; never read arbitrary paths or expose a path-based constructor |
| Wall-clock time | §4.1 | Implemented as a narrow File clock capability over Browlet's wall clock | Capture a constructed File's default once; read again only for a host file whose modification time remains unknown |
| UUID generation | §8.2 | The runtime can generate UUIDs, but `src/file` has no narrow composition seam for it | Add the operation with the blob-URL store; do not import Node crypto into the project |

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
`TransformStream`. A narrow implementation-only friend operation now exposes
that association to cross-specification algorithms. `Blob.textStream()` passes
the actual transform to `pipeReadableStreamThrough()` rather than reconstructing
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
  File API factory accepts only the already-sanitized metadata and existing
  byte-source boundary.
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

**Scope:** File API §§8.2–8.4, after the bounded storage-key prerequisite.

- Add a Blob URL store owned by each Browlet User Agent, with strong entry
  retention and creating-environment identity.
- Implement generate, add, remove, resolve, obtain-object, and same-partition
  checks over URL records and storage keys.
- Add the host resolver used by URL parsing and origin calculation; remove the
  current always-null provisional behavior.
- Add the File-owned contribution for `URL.createObjectURL()` and
  `URL.revokeObjectURL()` only when the complete declared union can be
  assembled honestly.
- Add Document environment-destruction cleanup and reserve the equivalent
  worker hook.
- Expose store resolution to Fetch's `blob:` scheme implementation without
  giving Fetch mutation authority.
- Prove that revocation prevents later acquisition while reads/fetches that
  already retained the object can complete.

MediaSource remains a named declaration/exposure dependency. The Blob store
algorithms and Fetch-facing Blob branch can be complete before MediaSource,
but the author-facing partial URL interface must not lie about its union.

**Exit proof:** opaque/tuple-origin generation, lookup, fragments, revocation,
cross-global same-partition use, cross-partition denial, environment cleanup,
strong retention, and already-started reads pass deterministic multi-global
tests. Fetch can resolve a Blob entry without using Node object URLs.

### Slice 5 — Asynchronous FileReader

**Scope:** File API §§6.1–6.4 and 7, after XHR §5 `ProgressEvent` exists.

- Add the file-reading task source and a scheduler cancellation identity that
  can remove only one FileReader operation's queued tasks.
- Implement FileReader state, result, error, constants, methods, and ordinary
  event-handler contributions over a Browlet-owned EventTarget composition.
- Implement the parallel stream-read loop, roughly-50-ms progress throttle,
  result packaging, read failure, and success/error completion.
- Implement Data URL packaging with the shared Base64 encoder. Because the
  editor's draft still carries an underspecified Data URL issue, verify exact
  syntax against WPT and interoperable browser behavior and record the chosen
  interpretation near the algorithm.
- Implement text encoding-label precedence, MIME charset fallback, UTF-8
  fallback, ArrayBuffer packaging, and the legacy binary-string path.
- Implement abort by canceling the active stream reader and queued tasks, then
  firing `abort` and conditional `loadend` in the specified order.
- Exercise reentrant read chaining from load, error, and abort handlers; the
  old operation must not fire a stale loadend after a new read begins.
- Tie outstanding work to global destruction without treating garbage
  collection as lifecycle.

**Exit proof:** state guards, all result modes, progress timing boundaries,
event order, read errors, abort, stale-task cancellation, reentrant reads,
wrong-Realm objects, and global teardown pass focused tests and applicable
FileAPI WPT groups.

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
- Do not silently omit MediaSource from a public normative union.
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
