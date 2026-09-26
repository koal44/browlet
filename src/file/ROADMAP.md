# File API roadmap

The [File API](https://w3c.github.io/FileAPI/) data model, Blob/File reads,
FileList, structured cloning, asynchronous FileReader, and Blob object URLs are
implemented for the current Window host. Fetch consumes the same backing data
and registered Blob URLs. Remaining work concerns global teardown, host-selected
files, workers, MediaSource, and the final conformance audit.

## Current ownership

| Location | Responsibility |
| --- | --- |
| [blob-data.ts](blob-data.ts) | Immutable segments, snapshot state, reads, slicing, and source failures |
| [blob.ts](blob.ts) | Blob construction, metadata, stream/promise reads, and declaration |
| [file.ts](file.ts), [file-list.ts](file-list.ts) | File metadata/host-source factory and owner-mutable FileList |
| [package-data.ts](package-data.ts) | FileReader text, Data URL, ArrayBuffer, and binary-string results |
| [Browlet File integration](../browlet/integration/file/) | Concrete FileReader EventTarget, Blob URL store/URL methods, and HTML Serializable registration |
| [Storage](../storage/ROADMAP.md) | Storage-key acquisition and equality |
| [Fetch](../fetch/README.md) | Blob scheme responses/ranges and multipart body consumption |

Portable File implementations receive the existing `JSEnvironment`; backing
`BlobData` retains no realm. Browser integration supplies events, file-reading
tasks, settings, and UserAgent lifetime. Web IDL performs author conversion and
projection. Import the portable implementation through [index.ts](index.ts).

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
`env.exec.fileReading`. Promise reads use the owner's internal Promise facility;
`textStream()` pipes through TextDecoderStream's associated TransformStream.
Blob text is UTF-8; FileReader text instead applies label/MIME/BOM rules.

Constructed File modification time is captured once. A host file with unknown
modification time uses the specified current-time fallback. FileList mutation
belongs to its owner, not authors. HTML serialization preserves snapshot, bytes,
MIME type, and metadata; FileList sub-serialization retains repeated File identity.
Storage serialization requires a storage-safe source rather than silently
retaining an unusable host handle.

FileReader uses Browlet's EventTarget and XHR's ProgressEvent. Its read operation
owns its removable tasks, reader, progress clock, and final result. Abort and
reentrant reads suppress stale tasks/events; global teardown remains below.

## Blob URL integration

File API [§§8.2–8.4](https://w3c.github.io/FileAPI/#BlobURLStore) is implemented
for Blobs. Each UserAgent owns its store and UUID generation. Entries retain the
Blob and its actual creator environment for origin, partition authorization,
and cleanup; origin equality alone cannot identify a creator's registrations.

Generation returns a serialized key, using `blob:null/UUID` for opaque origins.
Lookup ignores fragments; exact removal does not. Author revocation parses and
checks access before removal. Storage's non-storage key preserves opaque-origin
identity and remains available when storage is disabled. Acquisition accepts
early environment records; registration requires the creator's security origin.
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

1. **Shared global teardown.** Connect outstanding FileReader operations to the
   Window/worker destruction lifecycle, cancelling the active reader and its
   queued work. Inactive-Document task gating already prevents delivery but
   does not release an outstanding read. Use the shared
   [browsing lifecycle](../browlet/browsing/ROADMAP.md) and
   [worker lifecycle](../browlet/workers/ROADMAP.md), not a second File registry.

2. **Worker exposure and FileReaderSync.** Install the declared interfaces and
   Blob URL cleanup with real worker globals. File API
   [§6.5](https://w3c.github.io/FileAPI/#FileReaderSync) needs an actual synchronous
   worker byte-source contract. Reuse result packaging; do not manufacture
   synchrony over Streams with a nested loop or Atomics.wait.

3. **Host-selected files.** HTML file inputs/drag-and-drop and the selecting host
   must supply safe names, type policy, permissions, and captured snapshots.
   Implement missing/changed/unsafe/locked/unreadable source failures at that
   boundary. Preserve the no-path author API and shared immutable backing.

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
[the Blob URL store](../../test/browlet/blob-url.test.ts), and
[public object URLs](../../test/browlet/object-url.test.ts).
Structured-data tests check destination realms, storage cloning, and graph identity.

Selected FileAPI WPT groups live in [selection.txt](../../wpt/selection.txt).
The complete File-constructor Window case still requires HTMLBodyElement;
File-specific assertions have focused coverage. Extend worker, lifetime, and
host-file groups as their owners arrive. Keep failures attributable to the
missing subsystem rather than weakening the File contract.
