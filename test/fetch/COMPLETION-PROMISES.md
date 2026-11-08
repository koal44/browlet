# Fetch completion promise investigation

Investigated 2026-11-07 in Pip's worktree, against `4e034bcb` and the uncommitted
classic-script promise trial. The trial was subsequently rolled back at Eric's
request; its implementation is retained in the benchmark. Production keeps the
callback contract. This is not a new production Fetch API.

## Finding

A returned promise is feasible and gives the script loader a clearer result and
failure contract. Moving that promise down to Fetch does not eliminate its cost.
There is no existing completed-body promise to return: `FetchBody.readAll()` and
`ReadableStreamDefaultReaderImpl.readAllBytes()` deliver completion through
callbacks. The reader drains chunks without allocating a result promise for each
chunk. Earlier Fetch promises obtain a response; they do not mean its body has
finished, or that the selected destination's completion task has run.

The lower-body prototypes in [completion-benchmark.ts](completion-benchmark.ts)
use the real Fetch, body reader, and parser. They model where result promises
would be allocated if those layers returned promises, while leaving their
production contracts unchanged. Merely moving the prototype's resolver into
Fetch or the reader would relocate that allocation, not remove it.

The least expensive promise variant converts the body into a script before
settling one result promise. This is also the pattern already used by
`BodyMixin.#consume()` for public body methods. A generic conversion helper could
centralize the loader's resolver/error handling; it would still accept a
synchronous conversion function and would not reduce promise work.

## Measurements

All five variants produced parsed scripts on Node 24.19.0, Node 26.8.1, and custom
Node 27, both stock and with the add-on. Instrumented counts agreed on all six
configurations. These are differences per fetch relative to the callback loader;
the common harness and existing Fetch work are excluded by subtraction.

| Completion path | Extra native Promise creations | Extra Promise reaction executions |
| --- | ---: | ---: |
| Existing callback loader | 0 | 0 |
| Archived loader promise trial | 2 | 1 |
| Fetch body promise, then script conversion | 4 | 2 |
| Response promise, then body promise, then script conversion | 8 | 4 |
| Convert at body completion, then settle one result promise | 2 | 1 |

One result promise plus its observation accounts for the archived trial's two
native promises. `InternalPromise.try()` returns a result already owned by the
same promise class without creating another result promise. Ordinary `.then()`
conversion and promise adoption introduce additional work in the longer chain.

Timing runs use interleaved requests with rotating variant order and no
`async_hooks` instrumentation. The shared long-lived fixture slowed as the run
progressed; interleaving reduces that comparison bias but does not explain its
cause. The wall-clock results do not establish a reliable speedup or a useful
general slowdown percentage. Promise counts demonstrate added work, not a
measured end-user performance regression.

Run from the repository root, selecting each supported base and runtime:

```powershell
node scripts/with-node.mjs --base 26.8.1 --runtime compat node --experimental-vm-modules --require ./test/support/register-typescript.cjs test/fetch/completion-benchmark.ts 100 7
```

The fixture uses a small `data:` script to include actual fetching, byte reading,
decoding, and parsing without network latency. Allocation/reaction instrumentation
runs separately from timing. These successful-completion prototypes do not prove
cancellation, failure handling, worker shutdown, or scheduling equivalence for a
replacement Fetch API. The classic-loader trial passed separate behavioral tests
before rollback; those promise-specific production tests were rolled back with it.

## Scope decision

Do not migrate Fetch/Streams to a chain of result promises as an optimization.
Keeping one result promise at a consumer boundary is the lowest-cost promise
option measured, but still adds work relative to the callback contract. A strict
no-additional-work requirement favors retaining that contract.

Fetch also exposes an immediate cancellation controller and distinct header,
progress, consumed-body, and end-of-body notifications. They cannot all be
replaced by one promise. Any later migration must preserve task destinations,
the distinction between request client and execution owner, and module-cache
callbacks that currently complete synchronously. Synchronous `importScripts()`
still needs its independent transport wait; promises do not supply it.
