# Streams

Browlet's implementation of the [Streams Standard](https://streams.spec.whatwg.org/):
readable streams (ordinary and byte/BYOB), writable streams, transforms, piping,
teeing, asynchronous iteration, and queuing strategies.

Derived from the [WHATWG reference implementation](https://github.com/whatwg/streams/tree/b9ba9f49d95b4280be0dc2372377a006c3a91c18/reference-implementation),
with attribution in [LICENSE.WHATWG.md](./LICENSE.WHATWG.md).

## Layout

| Module | Contents |
| --- | --- |
| [index.ts](./index.ts) | Entry point for other subsystems; implementation exports and IDL definitions |
| [readable-stream.ts](./readable-stream.ts) | Stream, iterator, default/byte controllers, readers, BYOB request, pipe/tee algorithms |
| [writable-stream.ts](./writable-stream.ts) | Stream, writer, controller, write/close/abort algorithms |
| [transform-stream.ts](./transform-stream.ts) | Stream, controller, backpressure, generic-transform mixin, readable proxy |
| [queuing-strategy.ts](./queuing-strategy.ts) | Strategy records, extraction algorithms, Count and ByteLength interfaces |
| [queue-with-sizes.ts](./queue-with-sizes.ts) | Queue entries and total-size bookkeeping |

Each interface's implementation and Web IDL declaration live together. Algorithm
comments identify the relevant specification section; methods use the owning
implementation as their receiver.

## Runtime and bindings

A stream retains one trailing `JSEnvironment` and passes it to derived streams.
Its `env.exec` supplies execution, allocation, and task delivery.
Its `InternalPromise` chains retain their execution destination. Streams use that
facility for asynchronous work; native `async`/`await` and global microtask
scheduling are excluded by ESLint. Native backend I/O enters through explicit
tasks or Promise imports.

Buffer allocation, views, transfer, and copying use `exec.buffers`. Ordinary
tee with cloning uses `exec.clone`; public `tee()` shares ordinary chunks,
while byte tee copies bytes. Writable controllers obtain their AbortController
from the runtime.

Implementations receive converted records and callable steps. Web IDL's
`cbDict()` preserves member-access order and the original source,
sink, or transformer as the callback receiver. Binding also projects controllers,
adapts Promise results, and realizes exceptions. Strategy `size` functions use
`attrFn()` and Binding's existing per-realm identity cache.

Borrowed reads receive the method's environment for immediate validation failures.
Enqueue, write, byte-controller close, reader/writer release, termination, and
piping pass the invoking environment to errors shared across stream state,
callbacks, and Promise rejections. Retained read/write, `ready`, and `closed`
Promises keep their creation owner; error allocation does not move them.

`ReadableStreamIterator` owns its reader and `preventCancel` state. Its Web IDL
declaration names `createAsyncIterator` as the factory and exposes `return()`.
Binding handles the author iterator's identity, overlapping calls, completion,
and realm-owned results.

Internal factories combine allocation and setup. A null source, sink, or
transformer requests allocation for later setup; an empty record runs normal
constructor initialization. Internal callers use these implementation entry
points directly.

`ReadableStreamImpl.onCompletion(closed, errored)` registers internal steps at
the terminal state transition, before read completion, or runs them immediately
for an already completed stream. It neither acquires a reader nor pulls bytes.
Steps must not throw or invoke author code. Fetch uses this to retain byte-stream
support while queuing its own completion tasks; it is not a Web IDL operation.

The wider ownership rules live in [ARCHITECTURE.md](../ARCHITECTURE.md);
[Web IDL](../web-idl/README.md) describes the platform-object boundary.

## Specification correspondence

Internal organization can use methods, combined factories, and closed-over state
while preserving observable behavior. Callback order, Promise settlement order,
error propagation, identity, and buffer ownership still matter. A hidden Promise
object does not by itself make the timing of its reactions unobservable.

`pullFromBytes` advances an offset instead of removing a byte-sequence prefix.
The local `copyDataBlockBytes` copies between ArrayBuffer backing stores, which
represent the specification's Data Blocks. Pipe shutdown retains an explicit
error-presence flag because rejection with `undefined` is still a failure.

Two borrowed-operation choices retain browser-disagreement markers:

- `SPEC_CLASH(stream-reader-release-errors)`: Browlet follows Web IDL's
  [current-realm exception creation](https://webidl.spec.whatwg.org/#js-creating-throwing-exceptions)
  for [reader release](https://streams.spec.whatwg.org/#readable-stream-reader-generic-release).
  Chromium agrees; Gecko uses the receiver realm; WebKit varies by reader/state
  and gives separate errors to pending BYOB reads.
- `SPEC_CLASH(stream-pipe-through-error-realm)`: for
  [a closed pipe destination](https://streams.spec.whatwg.org/#readable-stream-pipe-to),
  Browlet retains the invoking environment and passes a method-realm error to
  source cancellation, matching Chromium/WebKit. Gecko uses the receiver realm;
  the algorithm also acknowledges ambiguity around its "in parallel" steps.

The [browser probe](../../node-compat/experimental/promise-constructors/release-realms.mjs)
records Chromium 149, Firefox 151, and Playwright WebKit 26.5. All three agree
on method-realm errors for writer release and transform termination. Replacement
and failed-write Promise realms differ, so these error fixes retain the existing
Promise allocation rules.

## Tests

From the repository root:

```powershell
npm.cmd run test:unit -- test/browlet/streams
npm.cmd run test:browlet:wpt
```

The [unit tests](../../test/browlet/streams) cover implementation records and
projected APIs, including callback receivers, borrowed getters, independent
queues, error identity, and BYOB ownership. The WPT command runs the repository's
[selected tests](../../wpt/suites/streams.json), including Window `.any.js` cases;
it does not run the entire upstream Streams suite. Queue-sensitive coverage
depends on the [selected Node runtime](../../node-compat/README.md).

## Remaining work

- MessagePort-backed stream transfer and transfer-receiving steps remain
  deferred. The interfaces already carry their `Transferable` declarations.
- The complete ordinary `streams/readable-streams/tee.any.js` WPT file remains
  outside the selection and needs a fresh run; focused ordinary-tee tests and
  the byte-tee WPT are present.
- Worker variants, the IDL harness, and per-global iframe strategy tests await
  their broader host/harness support. Unit tests cover strategy identity across
  two Browlet globals.

The reference runner also excludes some MessagePort, VideoFrame, WebAssembly
buffer, and transform-transfer cases. Those exclusions are not evidence of
Browlet conformance. Engine detach-key inspection and HTML rejection-event
delivery remain tracked by the [JS Engine roadmap](../js-engine/ROADMAP.md).
