# File API roadmap

The [File API](https://w3c.github.io/FileAPI/) data model, Blob/File reads,
FileList, structured cloning, asynchronous FileReader, and Blob object URLs are
implemented for the current Window host. Memory-backed Blob/File messaging and
worker-created Blob URLs also cross isolates through the browser owner.
FileReaderSync reads memory-backed data in dedicated and shared workers. Fetch
consumes the same backing data and registered Blob URLs. Remaining work concerns
forced/native worker teardown, host-selected files, general worker Fetch,
MediaSource, and the final conformance audit.

## Current ownership

| Location | Responsibility |
| --- | --- |
| [blob-data.ts](blob-data.ts) | Immutable segments, snapshot state, reads, slicing, and source failures |
| [blob.ts](blob.ts) | Blob construction, metadata, stream/promise reads, serialization steps, and declaration |
| [file.ts](file.ts), [file-list.ts](file-list.ts) | File metadata/host-source factory, owner-mutable FileList, and serialization steps |
| [environment.ts](environment.ts) | Streams execution and native line endings required by Blob/File |
| [package-data.ts](package-data.ts) | FileReader text, Data URL, ArrayBuffer, and binary-string results |
| [file-reader-sync.ts](file-reader-sync.ts) | Synchronous Blob/File reads and dedicated/shared-worker declaration |
| [Browlet File integration](../browlet/integration/file/) | Concrete FileReader EventTarget and Blob URL store/URL methods |
| [Storage](../storage/ROADMAP.md) | Storage-key acquisition and equality |
| [Fetch](../fetch/README.md) | Blob scheme responses/ranges and multipart body consumption |

Portable File implementations receive the existing owner as `FileEnvironment`.
It combines Streams facilities with host-supplied `nativeLineEnding`;
backing `BlobData` retains no realm. Browser integration supplies events,
file-reading tasks, settings, and UserAgent lifetime. Web IDL performs author
conversion and projection. Import through [index.ts](index.ts).

### Immutable data and reading

`BlobData.fromBytes()` copies input into owned storage. `fromOwnedBytes()` retains
storage without copying; its caller must stop mutating or transferring it.
Concatenation and slices share immutable segments, not eagerly copied bytes or
recursive read chains. Stream reads produce independent chunks for delivery.

`BlobByteSource` captures exact size/snapshot state and reports File API failure
reasons. A future host-file source must validate its snapshot and preserve that
contract without exposing paths, descriptors, Node streams, or Node Blob objects.
`FileImpl.fromHost()` already accepts a source and sanitized metadata; it is not
an implementation of file selection or filesystem access.

Blob/File retain `env`; slices preserve it and deserialization uses the target
environment. Background reads deliver bytes/failure/completion through
`env.queueTask('file', { run: steps })`. Promise reads use the owner's internal
Promise facility; `textStream()` pipes through TextDecoderStream's associated TransformStream.
Blob text is UTF-8; FileReader text instead applies label/MIME/BOM rules.

Discarding queued Blob data, EOF, or failure tasks now stops that producer and
errors its unfinished stream with TypeError. A backing read that finishes after
cancellation is ignored. HTML admits late production only as discard cleanup on
the original loop; inactive Documents still retain their ordinary tasks for
reactivation. Fully produced streams and the immutable Blob data remain usable.
`SPEC_GAP(body-production-discard)` records File API's missing discard completion;
`SPEC_CLASH(body-production-destruction)` records the approved browser choice in
the [loader audit](../browlet/loader/ROADMAP.md#byte-and-cache-body-production).
Blob production now registers destruction cleanup with its existing execution
owner, so a pending backing read fails immediately even with no queued task.
Completion, failure, or cancellation removes the registration; EOF releases it
before the consumer drains retained bytes. Late backing results are ignored,
and a stream created after destruction never starts its source read. This extends
the approved body-production decision; see the
[owner-lifetime slice](../browlet/loader/ROADMAP.md#execution-owner-destruction-without-queued-work).
Interrupting the host read itself and connecting worker shutdown remain explicit.

Constructed File modification time is captured once. A host file with unknown
modification time uses the specified current-time fallback. FileList mutation
belongs to its owner, not authors. HTML serialization preserves snapshot, bytes,
MIME type, and metadata; FileList sub-serialization retains repeated File identity.
Storage serialization requires a storage-safe source rather than silently
retaining an unusable host handle.

Memory-backed byte sequences serialize as plain segment records containing typed
arrays. Native transport copies the bytes; deserialization rebuilds `BlobData`
in the recipient. Blob/File messages therefore retain their contents after the
sending worker exits, and FileList keeps its shared File identities. Local cloning
of host-backed sources still defers reads and preserves snapshot failures. Those
source records explicitly reject native cloning until portable host-file backing
descriptors exist; native cloning must not discard their private state silently.

FileReader uses Browlet's EventTarget and XHR's ProgressEvent. Its read operation
owns its removable tasks, reader, progress clock, and final result. Abort and
reentrant reads suppress stale tasks/events. Each active read now registers with
the existing global destruction hook; completion, failure, or abort unregisters
before author callbacks can start another read. Document destruction invokes
internal `stop()`, cancelling the active reader and queued notifications without
events. It sets DONE synchronously, leaves error null, and ignores late backing
results. This preserves Pip's worker stop behavior while sharing registration
with Fetch and Blob production instead of adding another FileReader registry.

`SPEC_GAP(file-reader-global-destruction)` records the missing File API lifecycle
connection. Eric approved three browser choices: synchronous stop with null error
(Chromium/WebKit), retaining completed results (Firefox), and immediate AbortError
when starting a read after Document destruction (Chromium). The corresponding
`SPEC_CLASH(file-reader-destruction-state)`,
`SPEC_CLASH(file-reader-completed-destruction)`, and
`SPEC_CLASH(file-reader-after-destruction)` markers retain these disagreements.
Destroying the Document inside a notification also suppresses later notifications,
including loadend after a completed load; all three engines do this. Evidence and
the worker consolidation boundary are in the
[FileReader teardown audit](../browlet/loader/ROADMAP.md#filereader-document-destruction).

### FileReader failure state

FileReader retains `DOMExceptionImpl | null`; its normal Web IDL attribute
projects that implementation without a custom getter. Backing sources classify
expected read failures as `BlobReadFailure`; Blob streaming maps those reasons
to concrete DOMException implementations. Streams continue to carry arbitrary
rejection reasons, but FileReader rethrows unexpected failures from its file
task instead of storing values that its DOMException attribute cannot expose.
Such failures preserve their original identity for implementation diagnostics;
they do not dispatch FileReader's normal `error`/`loadend` recovery sequence.

Only result packaging belongs inside the completion catch. Event construction
and dispatch failures escape the task separately, leaving any completed result
intact. Author listener exceptions retain their existing callback reporting.

`SPEC_CLASH(filereader-allocation-error)`: the File API
[read operation](https://w3c.github.io/FileAPI/#readOperation) stores packaging
and stream exceptions directly, while its [FileReader state and declaration](https://w3c.github.io/FileAPI/#dfn-filereader)
require a DOMException or null. The Blob get-stream algorithm can also forward
a JavaScript allocation exception. Browlet preserves the declared error type:
a RangeError from the owner's result-buffer copy becomes `NotReadableError`.
Other packaging exceptions propagate unchanged as unexpected failures.
This follows WebKit's explicit buffer-allocation failure mapping in
`Source/WebCore/fileapi/FileReaderLoader.cpp`. Gecko's
`dom/file/FileReader.cpp` also retains a DOMException,
but includes different handling for engine errors; this is a documented choice,
not a claim that the draft or engines specify one uniform allocation-error name.

## Blob URL integration

File API [§§8.2–8.4](https://w3c.github.io/FileAPI/#BlobURLStore) is implemented
for Blobs. Each UserAgent owns its store and UUID generation. Entries retain the
Blob and its actual creator environment for origin, partition authorization,
and cleanup; origin equality alone cannot identify a creator's registrations.

Generation returns a serialized key, using `blob:null/UUID` for opaque origins.
Lookup ignores fragments; exact removal does not. Author revocation parses and
checks access before removal. Storage's non-storage key preserves opaque-origin
identity and remains available when storage is disabled. Acquisition accepts
reserved environments; registration requires the creator's security origin.
Top-level navigation/self-fetch exemptions are selected explicitly by the caller.

`UserAgent.parseURL()` supplies the store to URL parsing. Request/redirect records
retain captured entries; subsequent revocation prevents new lookup without
invalidating an already-acquired entry. Public URL parsing uses the basic parser
as specified. Document unloading cleanup removes registrations by creator
identity. Fetch owns response construction, ranges, and the reviewed clientless
precondition; see its [remaining work and decisions](../fetch/ROADMAP.md).

`URL.createObjectURL()` is provisionally Blob-only. Both the entry union and
Web IDL declaration must gain the real MediaSource implementation together.
A fake MediaSource or generic `object` would hide the missing dependency.

## Remaining work

1. **Host I/O cancellation and forced worker teardown.** Document destruction and
   cooperative worker shutdown now use the shared global destruction hook to
   stop pending reads without author events. Inactive Documents retain reads
   for reactivation. Host backing reads still lack an interrupt operation; late
   results are ignored. Forced/native termination remains a separate boundary.

2. **Worker Fetch and host-file reads.** Blob/File/FileList are exposed in worker
   globals, and memory-backed Blob/File messaging is connected across isolates.
   Worker-created Blob URLs now use the original browser store and are cleaned up
   at native exit. Worker-side Fetch of those URLs still needs the general Fetch
   connection; host-file backing transport is separate. FileReaderSync now reads
   memory sources through `BlobByteSource.readSync()` and shares result packaging
   with FileReader. Host-selected files must implement that optional synchronous
   source operation; async-only sources fail explicitly without starting I/O.
   The [§6.5](https://w3c.github.io/FileAPI/#FileReaderSync) stream-and-wait steps
   read the same internal bytes directly, without a nested loop or Promise
   pumping. Author overrides of `Blob.prototype.stream` are never consulted.
   The interface is exposed only to dedicated/shared workers, not Window or
   service workers, and needs no asynchronous shutdown registry.

3. **Host-selected files.** HTML file inputs/drag-and-drop and the selecting host
   must supply safe names, type policy, permissions, and captured snapshots.
   Implement missing/changed/unsafe/locked/unreadable source failures at that
   boundary. Preserve the no-path author API and shared immutable backing.
   Cross-isolate cloning also needs a portable source descriptor and lifetime,
   rather than a live source object from the sending isolate.

4. **MediaSource URLs.** The [media roadmap](../browlet/media/ROADMAP.md) owns MSE
   and its HTML media dependencies. Extend registration/acquisition and the
   public URL signature when that implementation exists; Blob fetching does
   not depend on completing media playback.

5. **Inherited Blob base URLs.** The approved TODO in
   [object-url.test.ts](../../test/browlet/object-url.test.ts) waits for HTML's
   creator-context/Document inheritance helpers. Preserve the captured URL record
   after revocation rather than serializing and reparsing it. The
   [browsing roadmap](../browlet/browsing/ROADMAP.md#missing-structural-concepts)
   owns that gap.

6. **Final specification audit.** Revisit File API §§2–8 in document order,
   including lifetime, failures, serialization, and worker exposure. Keep
   browser disagreements and missing owner integrations explicit; implemented
   Window behavior is not a claim that every File API branch is complete.

## Validation

[Portable tests](../../test/file/) cover construction, copying/sharing, slices,
metadata, source failures, and packaging. Browser tests cover
[projected File APIs](../../test/browlet/file-api.test.ts),
[FileReader](../../test/browlet/file-reader.test.ts),
[FileReader destruction](../../test/browlet/file-reader-destruction.test.ts),
[the Blob URL store](../../test/browlet/blob-url.test.ts), and
[public object URLs](../../test/browlet/object-url.test.ts).
Structured-data tests check destination realms, storage cloning, and graph identity.
Native transport variants exercise Blob and FileList records independently of the
add-on. [Worker messaging tests](../../test/browlet/workers/thread.test.ts) cover
Blob/File round trips through both dedicated `postMessage()` and BroadcastChannel,
including recipient brands, slices, repeated identities, and reads after sender exit.
The synchronous reader adds encoding/BOM, empty/composed/sliced data, source
failure, unsupported synchronous I/O, and copy-isolation coverage. Worker realm
tests cover Web IDL conversion, receiver/result realms, and exposure; a real
isolate reads cloned Blob/File data without running queued author jobs.

Selected FileAPI WPT groups live in [file.json](../../wpt/suites/file.json).
The complete File-constructor Window case still requires HTMLBodyElement;
File-specific assertions have focused coverage. Extend worker, lifetime, and
host-file groups as their owners arrive. Keep failures attributable to the
missing subsystem rather than weakening the File contract.
