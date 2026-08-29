# Streams reference-implementation port

Source: WHATWG Streams reference implementation at commit
`b9ba9f49d95b4280be0dc2372377a006c3a91c18` (2026-08-18).

This is a temporary working journal. Burn this file after every retained
deviation and host requirement has a permanent test, limitation, or code
comment.

Follow the project-wide order in
[priority.md](../browlet/priority.md), the composition rules in
[subsystem-architecture.md](../subsystem-architecture.md), and the object
boundary rules in
[platform-object-architecture.md](../platform-object-architecture.md).

## Contract decisions

- `src/streams/index.ts` is the private project entry. It exports the
  `streamsIDLDefinitions` declaration contribution plus intentional
  cross-specification operations and types, and it does not install globals.
  Semantic implementation modules remain package-private.
- Web IDL declarations remain beside their implementation modules. The entry
  aggregates them for Browlet's bindings.
- Reference-implementation calls to generated `.new(globalThis)` wrappers
  must become direct implementation construction using the shared per-realm
  context. Binding projects the result only when it crosses an author-visible
  boundary, while retaining the construction realm across borrowed methods.
  The implementation must never import Browlet's Window.
- The former `StreamEnvironment` façade has been removed. Realm-sensitive
  runtime services use the shared Realm Context, realm-neutral algorithms are
  direct imports, and the two genuine cross-specification dependencies--HTML
  structured cloning and DOM `AbortController` creation--are narrow,
  independently registered capabilities. Do not recreate a Streams-specific
  service bag.
- Stream implementations remain independently testable with the shared Realm
  Context and narrow fakes for genuine external dependencies. Streams never
  imports Browlet's DOM implementation or reaches for an ambient global. A
  converted signal already is the implementation, so piping reads its state
  and registers its internal abort algorithm directly through a host-neutral
  structural contract. It does not reverse through Web IDL or call the
  projected `AbortSignal` event-listener API.
- The focused implementation tests use Browlet's real Realm Context, Web IDL
  promise records, conversions, and projections. They fake only structured
  cloning and AbortController creation, the two external capabilities under
  test; do not restore a miniature Streams runtime.
- Cross-specification cloning is an explicit HTML-owned capability. Browlet
  registers HTML's semantic structured-data operation for each supported
  global interface; Streams never calls the projected author-facing
  `structuredClone()` method. Exceptions from that semantic boundary are
  realized by Web IDL in the stream realm before they reject stream promises.
- Writable-stream internal slots live in a module-private `WeakMap` family.
  Cross-module algorithms use that slot boundary directly rather than copying
  symbol-keyed friend methods onto every projected implementation object.
  This costs more per access and entry than direct private fields, but preserves
  true author-invisible state without restoring the implementation/operations
  import cycle; symbol-keyed data properties would be reflectable. Cache a slot
  record within hot algorithms, and benchmark sustained writable and byte-stream
  workloads before considering a different representation.
- The Readable/BYOB and Transform module cycles are inherited from the WHATWG
  reference implementation's class/algorithm split, not introduced by Browlet.
  Imported class bindings are dereferenced only after module evaluation, when a
  stream operation runs; there is no top-level cross-cycle execution.
  Participating modules acknowledge their cycle group on their first line. The
  build accepts a cycle only when every module names the same group.
- Ambient `Promise`, `queueMicrotask`, errors, and buffer constructors must use
  the shared Realm Context where the specification requires the relevant
  realm. `AbortController` construction remains a narrow cross-specification
  capability. Do not group these unrelated dependencies into a host façade.
- Transferable-stream steps are deliberately deferred. They belong to the
  HTML structured-data and MessagePort integration, not the Streams core.
- Keep incomplete implementation families private. `streamsIDLDefinitions`
  must not expose `ReadableStream` until every interface referenced by its
  public operations exists in the assembled definition graph.

## Port progress

- [ ] Audit the current implementation in document order against the WHATWG
  Streams Living Standard. Treat the reference implementation as secondary
  evidence, not as the architectural source of truth. Account for every
  interface and normative algorithm, then expand focused WPT coverage for the
  retained surface.
- [ ] Reassess the acknowledged Readable/BYOB and Transform import cycles
  during that audit. Remove cycles produced only by the reference
  implementation's file layout; retain a cycle only when the resulting module
  ownership is clearer than an acyclic alternative, and keep its no-top-level
  execution invariant tested.
- [x] Project boundary, license, and declaration aggregation
- [x] Queue-with-sizes and queuing-strategy extraction algorithms
- [x] `ByteLengthQueuingStrategy` and `CountQueuingStrategy`
- [x] Replace `StreamEnvironment` with the shared Realm Context, direct shared
  algorithms, and narrow cross-specification capabilities
- [x] Ordinary stream state, default controller, and default reader
- [x] Byte readable streams and BYOB readers
- [x] Piping and ordinary/byte teeing
- [x] `ReadableStream.from()` and asynchronous iteration
- [x] Writable streams
- [x] Transform streams
- [x] Window `.any.js` WPT harness support
- [ ] Broader focused Streams WPT coverage

## Known upstream limitations to preserve explicitly

- The reference runner skips owning-type `MessagePort` and `VideoFrame`
  cases, non-transferable `WebAssembly.Memory` buffers, and one transferable
  transform-stream case.
- Generic default-stream tee cloning requires HTML's serializable-object
  framework. Public `tee()` does not request that clone; byte-stream teeing
  clones bytes without the structured-data framework.
- Transferable streams remain blocked on HTML structured serialization and
  `MessagePort`. Ordinary readable, writable, transform, byte, BYOB, tee, and
  piping behavior does not wait for that integration.
- Browlet's WPT runner synthesizes the Window document that wptserve normally
  generates for selected `.any.js` files. Worker variants remain deferred
  until Browlet has the corresponding worker globals.
