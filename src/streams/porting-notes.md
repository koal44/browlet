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
- Ambient `Promise`, `queueMicrotask`, errors, buffer constructors, and
  `AbortController` must be replaced by relevant-realm or injected host
  capabilities as their algorithms are ported.
- Transferable-stream steps are deliberately deferred. They belong to the
  HTML structured-data and MessagePort integration, not the Streams core.

## Port progress

- [x] Project boundary, license, and declaration aggregation
- [x] Queue-with-sizes and queuing-strategy extraction algorithms
- [x] `ByteLengthQueuingStrategy` and `CountQueuingStrategy`
- [x] Narrow callback, conversion, platform-object, and promise capabilities
- [x] Ordinary stream state, default controller, and default reader
- [ ] Byte readable streams and BYOB readers
- [ ] Remaining readable-stream public operations
- [ ] Writable streams (requires the DOM `AbortSignal` platform contract)
- [ ] Transform streams
- [ ] Focused WPT integration

## Known upstream limitations to preserve explicitly

- The reference runner skips owning-type `MessagePort` and `VideoFrame`
  cases, non-transferable `WebAssembly.Memory` buffers, and one transferable
  transform-stream case.
- Generic default-stream tee cloning requires HTML's serializable-object
  framework. Byte-stream teeing clones bytes without that framework.
- A writable stream default controller owns an `AbortController` and exposes
  its signal as a bound `AbortSignal` platform object. Browlet currently uses
  native signals internally but does not define those DOM interfaces. Do not
  replace this with an ambient Node signal or a Streams-local lookalike.
