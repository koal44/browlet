# Streams reference-implementation port

Source: WHATWG Streams reference implementation at commit
`b9ba9f49d95b4280be0dc2372377a006c3a91c18` (2026-08-18).

This is a temporary working journal. Burn this file after every retained
deviation and host requirement has a permanent test, limitation, or code
comment.

Follow the project-wide order in
[PRIORITY.md](../browlet/PRIORITY.md), the composition rules in
[SUBSYSTEM-ARCHITECTURE.md](../SUBSYSTEM-ARCHITECTURE.md), and the object
boundary rules in
[PLATFORM-OBJECT-ARCHITECTURE.md](../PLATFORM-OBJECT-ARCHITECTURE.md).

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
  runtime services use the shared Binding Context, realm-neutral algorithms are
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
- The focused implementation tests use Browlet's real Binding Context, Web IDL
  promise records, conversions, and projections. They fake only structured
  cloning and AbortController creation, the two external capabilities under
  test; do not restore a miniature Streams runtime.
- Cross-specification cloning is an explicit HTML-owned capability. Browlet
  registers HTML's semantic structured-data operation for each supported
  global interface; Streams never calls the projected author-facing
  `structuredClone()` method. Exceptions from that semantic boundary are
  realized by Web IDL in the stream realm before they reject stream promises.
- Writable-stream state and Binding Context live directly on the stream, writer,
  and controller implementations. Separate platform objects already keep that
  state author-invisible; a sidecar `WeakMap` would duplicate the Binding
  boundary. Operations import those implementation types only, so their direct
  field access does not restore a runtime module cycle.
- The Readable/BYOB and Transform module cycles are inherited from the WHATWG
  reference implementation's class/algorithm split. Their normative object
  graph, browser comparisons, Browlet-specific edges, and removal threshold are
  recorded in the [cycle analysis](CYCLE.md). Participating modules acknowledge
  their cycle group on their first line, and no cross-cycle binding may execute
  during module initialization.
- Ambient `Promise`, `queueMicrotask`, errors, and buffer constructors must use
  the shared Binding Context where the specification requires the relevant
  realm. `AbortController` construction remains a narrow cross-specification
  capability. Do not group these unrelated dependencies into a host façade.
- Transferable-stream steps are deliberately deferred. They belong to the
  HTML structured-data and MessagePort integration, not the Streams core.
- Keep incomplete implementation families private. `streamsIDLDefinitions`
  must not expose `ReadableStream` until every interface referenced by its
  public operations exists in the assembled definition graph.

## Living Standard audit

Audit the current implementation in document order against the WHATWG Streams
Living Standard. The standard is authoritative; the reference implementation
and browsers are secondary evidence when an algorithm or ownership boundary is
unclear. For each slice, account for its Web IDL, internal state, normative
algorithms, exception and realm behavior, retained deferrals, and focused WPT
coverage.

1. [x] **Sections 1–3 and 4.1–4.2 — model, conventions, and
   `ReadableStream`.** Verify the public class, underlying-source contract,
   asynchronous iteration, and transfer declaration. Follow referenced
   abstract operations far enough to verify each public boundary, leaving the
   full reader/controller machinery to the next slice.
2. [x] **Sections 4.3–4.9 — readers, controllers, BYOB, and readable-stream
   abstract operations.** Audit every reader and controller family, ordinary
   and byte teeing, piping, and the Readable/BYOB cycle group.
3. [x] **Section 5 — writable streams.** Audit the stream, writer, controller,
   abort-signal behavior, abstract operations, and writable state ownership.
4. [x] **Sections 6–8 — transform streams, queuing strategies, and supporting
   operations.** Audit transform backpressure and cancellation, both strategy
   classes, queue-with-sizes, transfer helpers, miscellaneous operations, and
   the Transform cycle group.
5. [x] **Sections 9–10 — other-specification operations and closure.** Audit
   the cross-specification construction, reading, writing, wrapping, pairing,
   and piping APIs; use the non-normative examples as integration checks; then
   reconcile the WPT inventory and the deferred MessagePort-backed transfer
   steps.

Reassess each acknowledged import cycle when its owning slice is audited.
Remove cycles inherited only from the reference implementation's file layout;
retain one only when its module ownership is clearer than an acyclic
alternative, and keep the no-top-level-execution invariant tested.

### Slice 1 result

- Sections 1–3 introduce the common model and conventions rather than another
  runtime owner. Their stream state, queue, locking, direct-algorithm, and
  promise rules map to the existing implementation boundaries.
- The section 4.1–4.2 Web IDL, `ReadableStream` state, underlying-source
  conversion, public methods, and asynchronous iterator agree with the
  standard. The locked WPT constructor-order, invalid source and strategy, and
  async-iterator suites are now selected and pass.
- The audit restored the explicit rejected-next-promise branch in
  `ReadableStreamFromIterable`: iterator failures now error the stream's
  controller directly, as specified, instead of incidentally propagating
  through the controller's generic pull-promise rejection path.
- `ReadableStream` remains declared transferable, while its MessagePort-backed
  transfer and transfer-receiving steps remain the explicit cross-specification
  deferral below.
- The initially stalled `streams/readable-streams/from.any.js` exposed a
  Streams boundary error rather than a host limitation: the internal algorithm
  was sending an already-converted underlying source back through the public
  constructor. The complete WPT is now selected and passes.

### Slice 2 result

- Sections 4.3–4.8's default and BYOB reader/controller interfaces, state, and
  operations agree with the Living Standard. The three byte-stream interfaces
  now carry the standard's current `Exposed=*` declaration.
- Internal `ReadableStreamFromIterable`, ordinary tee, and byte tee construction
  now uses the section 4.9 creation algorithms directly. Internal callback and
  promise records no longer cross the author-facing constructor conversion
  boundary a second time.
- The audit restored `ReadableStreamDefaultControllerHasBackpressure` and made
  TransformStream consume that predicate instead of approximating it from
  desired size. Piping also defers each write past `enqueue()` as required by
  `ReadableStreamPipeTo` and its focused WPT.
- BYOB transfer coverage exposed an HTML structured-data representation detail:
  an ArrayBufferView may refer to the transfer placeholder for its backing
  buffer until the transfer phase fills that record. That graph edge is now
  accepted and covered by a focused transfer test.
- The selected reader, controller, byte-stream, byte-tee, and piping WPT
  assertions pass under the explicit compatible-Node queue. A prior trial of
  `streams/readable-streams/tee.any.js` passed 25 of 26 subtests because stock
  Node's ambient nested-checkpoint bridge could not enforce source-rejection
  ordering. The compatible-mode unit reproduction now passes, but the complete
  ordinary-tee file is not in the current WPT selection and has not been rerun
  as part of that suite. Keep the fallback mismatch explicit rather than
  changing the Streams algorithms around it.
- The Readable/BYOB import cycle remains under the documented
  [cycle decision](CYCLE.md). The new internal creation functions remove a
  wrong Binding round trip, but do not themselves remove an import edge, so no
  cycle-only refactor belongs in this slice.

### Slice 3 result

- Section 5's `WritableStream`, default writer, default controller, abort
  integration, state transitions, and abstract operations agree with the
  Living Standard. The selected constructor, sink, start, write, close, abort,
  error, reentrancy, queue-size, and property WPTs pass all 186 subtests.
- `WritableStreamDefaultWriterWrite` now preserves the standard's observable
  rejection precedence: an errored stream rejects with its stored error, a
  closing or closed stream rejects with a `TypeError`, and only then does an
  erroring stream reject with its stored error.
- Resolving a Web IDL promise capability now adopts another internal promise
  capability just as it adopts a JavaScript promise. Readable, writable, and
  transform setup can therefore use the standard's direct `startAlgorithm`
  contract; the Streams-only `startPromise` bypass has been removed.
- Writable state now lives directly on its implementation objects, matching its
  specification ownership and the native-engine model. Since Binding projects
  separate platform objects, authors cannot observe those fields. Type-only
  reverse imports keep the TypeScript runtime graph acyclic without a sidecar
  slot protocol.
- Writable transfer and transfer-receiving steps remain deferred with the
  shared MessagePort dependency. Their `Transferable` declaration and HTML
  detached-state ownership remain intact.

### Slice 4 result

- TransformStream backpressure, cancellation, errors, flushing, termination,
  strategies, and reentrancy pass the 133 selected non-transfer WPT subtests.
  The interfaces now use the Living Standard's current `Exposed=*`; the
  reference implementation's checked-in IDL is older here.
- The author constructor now follows the standard's internal order: convert
  and validate the transformer, extract the readable strategy, then extract
  the writable strategy before initialization.
- Transform stream and controller state now lives directly on their
  implementations. Moving controller allocation to the implementation
  boundary made the reverse operation imports type-only and removed the
  acknowledged Transform import cycle. Blink and Gecko likewise keep this
  state on their interface classes; WebKit uses equivalent private slots.
- Section 8's queue-with-sizes arithmetic remains covered by the selected
  readable and writable floating-point WPTs. Byte-stream cloning now uses the
  single shared `CloneAsUint8Array` operation, and the copy path checks the
  shared `CanCopyDataBlockBytes` predicate rather than leaving both helpers
  disconnected.
- Buffer transfer remains Web IDL-owned, structured cloning remains an HTML
  capability, and MessagePort-backed transferable streams remain deferred.
  The per-global strategy WPT requires iframe lifecycle support; the unit suite
  covers the same realm-identity rule with two Browlet globals.

### Slice 5 result

- `src/streams/index.ts` is the stable §9 entry for other specifications.
  Readable, writable, and transform creation goes through the Binding Context's
  internal implementation-construction path, while operations that merely
  rename an existing abstract operation are direct aliases rather than wrapper
  functions. No subsystem-private environment or service registry was added.
- The transform setup boundary now accepts the standard's semantic transform,
  flush, and cancel algorithms. It no longer exposes a controller-shaped
  `TransformStreamImpl.fromAlgorithms()` escape hatch. Encoding consequently
  imports only the Streams entry point and uses §9 enqueueing, leaving
  controller ownership entirely inside Streams.
- Cross-specification callback results are normalized through the stream Realm
  Context, including native promises returned by a host algorithm. Focused
  tests verify that writable completion does not run ahead of such a promise.
- Readable byte enqueueing now implements the current-BYOB-view fast path: a
  chunk over the requested buffer responds to the pending pull-into instead of
  enqueueing and transferring the same buffer. `pull from bytes` represents
  Infra's prefix removal by returning an updated `Uint8Array` offset, matching
  WebKit's bounded buffer-plus-offset implementation without copying the
  remainder.
- Blink, Gecko, and WebKit all expose purposeful native/private entry points
  for other specifications rather than making consumers call the public Web
  IDL API. Gecko's readable public-operations surface is the closest direct
  analogue; Blink combines allocation and setup in static factories, and
  WebKit implements both the byte-pull offset and identity-transform proxy
  patterns used here.
- Section 9.4's duplex and endpoint pairs are specification guidance, not a new
  runtime abstraction. Existing `readable`/`writable` surfaces already follow
  its naming rule. Section 10 adds no normative algorithms; its push, pull,
  BYOB, writable-backpressure, shared-pair, and transform patterns are covered
  by the selected WPTs and focused implementation tests.
- Additional ordinary Streams WPT files add strategy-integration and
  patched-global coverage. Under the rebuilt compatible Node runtime, all
  1,193 selected assertions pass and the WPT command exits cleanly without the
  parser/Promise-job `boo!` rejection leak. Stock Node completes the same
  assertions but still reports that rejection as unhandled and exits nonzero.
  Transfer WPTs still wait for MessagePort, worker-only variants wait for
  worker globals, and the IDL harness waits for its general harness integration.

## Port progress
- [x] Project boundary, license, and declaration aggregation
- [x] Queue-with-sizes and queuing-strategy extraction algorithms
- [x] `ByteLengthQueuingStrategy` and `CountQueuingStrategy`
- [x] Replace `StreamEnvironment` with the shared Binding Context, direct shared
  algorithms, and narrow cross-specification capabilities
- [x] Ordinary stream state, default controller, and default reader
- [x] Byte readable streams and BYOB readers
- [x] Piping and ordinary/byte teeing
- [x] `ReadableStream.from()` and asynchronous iteration
- [x] Writable streams
- [x] Transform streams
- [x] Window `.any.js` WPT harness support
- [x] Broader focused Streams WPT coverage

## Known upstream limitations to preserve explicitly

- The reference runner skips owning-type `MessagePort` and `VideoFrame`
  cases, non-transferable `WebAssembly.Memory` buffers, and one transferable
  transform-stream case.
- Generic default-stream tee cloning requires HTML's serializable-object
  framework. Public `tee()` does not request that clone; byte-stream teeing
  clones bytes without the structured-data framework.
- Transferable streams remain blocked on `MessagePort`; HTML structured
  serialization is now present. Ordinary readable, writable, transform, byte,
  BYOB, tee, and piping behavior does not wait for that integration.
- Browlet's WPT runner synthesizes the Window document that wptserve normally
  generates for selected `.any.js` files. Worker variants remain deferred
  until Browlet has the corresponding worker globals.
