# Streams reference-implementation port

Source: WHATWG Streams reference implementation at commit
`b9ba9f49d95b4280be0dc2372377a006c3a91c18` (2026-08-18).

This is a temporary working journal. Burn this file after every retained
deviation and host requirement has a permanent test, limitation, or code
comment.

## Contract decisions

- `src/streams/index.ts` is the private project entry. It exports one
  `streamsIDLDefinitions` declaration contribution and does not install
  globals. Semantic implementation modules remain package-private.
- Web IDL declarations remain beside their implementation modules. The entry
  aggregates them for Browlet's binding domain.
- Reference-implementation calls to generated `.new(globalThis)` wrappers
  must become explicit platform-object creation through the active binding
  context. The semantic implementation must never import Browlet's Window.
- Grow `StreamEnvironment` from observed requirements. Do not expose an
  entire Realm, platform-object adapter, or callback subsystem when one
  semantic operation is sufficient.
- Stream implementations receive `StreamEnvironment` directly and remain
  independently unit-testable. In production, its Abort capability asks the
  assembled Web IDL binding domain to internally create `AbortController`;
  Streams never imports Browlet's DOM implementation or reaches for an
  ambient global.
- Writable-stream internal slots live in a module-private `WeakMap` family.
  Cross-module algorithms use that slot boundary directly rather than copying
  symbol-keyed friend methods onto every projected implementation object.
  This costs more per access and entry than direct private fields, but preserves
  true author-invisible state without restoring the implementation/operations
  import cycle; symbol-keyed data properties would be reflectable. Cache a slot
  record within hot algorithms, and benchmark sustained writable and byte-stream
  workloads before considering a different representation.
- Ambient `Promise`, `queueMicrotask`, errors, buffer constructors, and
  `AbortController` must be replaced by relevant-realm or injected host
  capabilities as their algorithms are ported.
- Transferable-stream steps are deliberately deferred. They belong to the
  HTML structured-data and MessagePort integration, not the Streams core.
- Keep incomplete implementation families private. `streamsIDLDefinitions`
  must not expose `ReadableStream` until every interface referenced by its
  public operations exists in the assembled definition graph.

## Port progress

- [x] Project boundary, license, and declaration aggregation
- [x] Queue-with-sizes and queuing-strategy extraction algorithms
- [x] `ByteLengthQueuingStrategy` and `CountQueuingStrategy`
- [x] Narrow callback, conversion, platform-object, and promise capabilities
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
- A writable stream default controller obtains its `AbortController` through
  `StreamEnvironment`. Browlet's production environment resolves the standard
  interface through the assembled Web IDL domain, while implementation tests
  inject a structural controller directly. The host-neutral Streams project
  must not import Browlet, use an ambient Node signal, or create a Streams-local
  lookalike.
- Transferable streams remain blocked on HTML structured serialization and
  `MessagePort`. Ordinary readable, writable, transform, byte, BYOB, tee, and
  piping behavior does not wait for that integration.
- Browlet's WPT runner synthesizes the Window document that wptserve normally
  generates for selected `.any.js` files. Worker variants remain deferred
  until Browlet has the corresponding worker globals.
