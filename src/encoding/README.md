# Encoding

Browlet implements the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/):
label lookup, legacy mapping tables, codecs, encoding/decoding operations,
TextEncoder, TextDecoder, and their stream interfaces. TextEncoder always emits
UTF-8; legacy output encodings are available through the internal operations.

## Organization

| Location | Responsibility |
| --- | --- |
| `index.ts` | Entry point for other subsystems. |
| `encodings.ts` | Canonical encoding type, label lookup, codec factories, and complete-input/queue operations. |
| `codecs/` | Encoder and decoder algorithms, including state retained across input chunks. |
| `io-queue.ts` | Typed byte/scalar queues, output collection, and suspension through RuntimeContext. |
| `indexes.ts`, `gen/` | Lazy lookup tables and checked-in packed mapping data. |
| `text-*.ts` | Interface implementation, stream composition, and Web IDL declarations. |
| `scripts/` | Mapping-data generator and its source license. |

## Operations and ownership

`getEncoding` accepts labels, trims ASCII whitespace, and folds ASCII case.
It returns a canonical `Encoding` or null. `getOutputEncoding` maps replacement
and UTF-16 names to UTF-8 where the caller's specification requires it;
replacement and UTF-16 deliberately have no encoders.

`decode` and `encode` accept complete inputs and return complete results.
Their `*Queue` counterparts retain supplied output and return `PromiseValue`
completion through the trailing RuntimeContext. `encodeOrFailSync` provides the
immediate operation used by URL processing; it requires complete input and
retains the supplied encoder's state across failures.

Codecs themselves run synchronously. Their instance methods combine queue
processing with the per-item handlers and append to a supplied output queue:

| Result | Meaning |
| --- | --- |
| `waiting` | Input is empty but open; resume the same codec when more input or EOF arrives. |
| `finished` | Processing completed and the output end marker was appended. |
| `{ error }` | Fatal processing stopped; partial output and unread input remain available. |

These results are ordinary values. `processQueue` subscribes to input readiness
through the runtime when processing returns `waiting`; byte/scalar loops do not
schedule promises. Fatal codec processing leaves output open. The `encodeOrFail`
operations additionally append its end marker, including on error, as required
by Encoding §6.1. Reuse a stateful encoder when resuming an operation; separate
completed encodings are not interchangeable with one streaming encoding.

`IOQueue<Uint8Array>` stores bytes; `IOQueue<string>` stores well-formed scalar
strings. Queues retain chunks, so their bytes must not be mutated while queued.
An empty open queue differs from the persistent `endOfQueue` token. `restore`
prepends unread input in order. Collection reads currently available output;
`takeBytes(runtime)` allocates and fills the final result in that runtime.
`bomSniff` peeks without consuming and needs three bytes or EOF: streaming callers
wait for that lookahead rather than repeatedly retrying a shorter prefix.

Web IDL owns author conversion and result projection. Runtime facilities allocate
retained buffers and callback-visible stream chunks in their owning realm. Raw
codecs preserve BOMs; the higher-level decoding operations and TextDecoder apply
their respective BOM policies.

## Native paths and interoperability

Bulk UTF-8 conversion and UTF-16 string materialization use JS Engine's native
byte/string operations. Large single-byte replacement chunks use a lazily retained
Node TextDecoder; small chunks and fatal decoding use our mapping tables. Keep
partial-character and fatal-recovery behavior when changing these fast paths.
The JS Engine `writeUTF8Into` accommodation completes a native underfilled prefix
on affected Node versions without discarding the native bulk conversion.

Fatal streaming TextDecoder recovery has a known browser difference. Browlet
follows the written §7.2 queue steps and retains unread input after a fatal
streaming error. Chromium 149.0.7827.55, Firefox 151.0, and Playwright Windows
WebKit 26.5 discarded that input in the cases checked on September 11, 2026.
The regressions in `test/browlet/encoding.test.ts` retain the specification result,
including restored ASCII and independence from later input-buffer mutation.

## Mapping data and tests

From the repository root:

```powershell
node --import tsx src/encoding/scripts/generate-tables.mjs
node --import tsx src/encoding/scripts/generate-tables.mjs --check
npm.cmd run test:unit -- test/encoding test/browlet/encoding.test.ts
```

The generator downloads the published `index-<name>.txt` files, validates their
entries, and checks packing through the runtime loader. It writes `gen/indexes.ts`
and independent mapping digests under `test/encoding/gen/`. Both generator modes
require network access; builds and runtime use checked-in data. Canonical names
and labels are maintained directly in `encodings.ts`.

Indexes expand on first use; reverse lookups are also lazy. Packed source strings
are present at module load. Source URLs, published identifiers, and WHATWG data
attribution remain in the generated files; retain `scripts/WHATWG-LICENSE.txt`.

Tests cover mapping digests, Unicode scalars, malformed input, chunk boundaries,
BOM handling, resumable errors, supplied output, and realm ownership through the
projected APIs. Performance investigations are separate from these regressions.
