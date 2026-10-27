# Encoding

Browlet implements the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/):
label lookup, legacy mapping tables, codecs, encoding/decoding operations,
TextEncoder, TextDecoder, and their stream interfaces. TextEncoder always emits
UTF-8; legacy output encodings are available through the internal operations.

## Organization

| Location | Responsibility |
| --- | --- |
| `index.ts` | Entry point for other subsystems. |
| `web-idl.ts` | Collects interface, dictionary, and mixin declarations for the host binding. |
| `labels.ts`, `decoding.ts` | Canonical encoding names, label lookup, and shared BOM detection. |
| `encodings.ts` | Codec factories and complete-input/queue operations. |
| `codecs/` | Encoder and decoder algorithms, including complete-input UTF-8 helpers and state retained across input chunks. |
| `io-queue.ts` | Typed byte/scalar queues, output collection, and suspension through the owning environment. |
| `indexes.ts`, `gen/` | Lazy lookup tables and checked-in packed mapping data. |
| `text-*.ts` | Interface implementation, stream composition, and Web IDL declarations. |
| `scripts/` | Mapping-data generator and its source license. |

## Operations and ownership

`getEncoding` accepts labels, trims ASCII whitespace, and folds ASCII case.
It returns a canonical `Encoding` or null. `getOutputEncoding` maps replacement
and UTF-16 names to UTF-8 where the caller's specification requires it;
replacement and UTF-16 deliberately have no encoders.

Encoding sits above JS Engine in the dependency hierarchy. Label lookup uses
Infra's ASCII helpers; complete-input UTF-8 conversion uses the existing Node
backend and has no environment or realm dependency.

Stylelet imports label lookup and `decode` from the full subsystem. CSS selects
the fallback encoding; Encoding applies BOM override and replacement decoding.
Complete-input UTF-8 helpers live in `codecs/utf-8.ts` and are exported by Encoding.
`utf8Encode` returns internal bytes without an environment. TextEncoder and
TextEncoderStream allocate their own final buffers through `env.realm`
and use the UTF-8 writer to fill them, so author-visible
results need no intermediate allocation or copy. Streaming codecs retain their
Node fast paths and queue state.

Infra's JSON-byte algorithms live on [BrowletEnvironment](../browlet/environment.ts).
They combine these UTF-8 helpers with the realm-owned JSON string operations.
Fetch obtains the two operations it uses through its environment contract.
Neither Infra nor JS Engine depends on Encoding.

`decode` and `encode` accept complete inputs and return complete results.
Their `*Queue` counterparts retain supplied output and return `InternalPromise`
completion through the trailing JSEnvironment and its `InternalPromise` constructor. `encodeOrFailSync` provides the
immediate operation used by URL processing; it requires complete input and
retains the supplied encoder's state across failures.

TextEncoderStream and TextDecoderStream accept `StreamsEnvironment` because they
construct streams; the codec and queue operations need only `JSEnvironment`.

Codecs themselves run synchronously. Their instance methods combine queue
processing with the per-item handlers and append to a supplied output queue:

| Result | Meaning |
| --- | --- |
| `waiting` | Input is empty but open; resume the same codec when more input or EOF arrives. |
| `finished` | Processing completed and the output end marker was appended. |
| `{ error }` | Fatal processing stopped; partial output and unread input remain available. |

`processQueue` subscribes to input readiness
through the runtime when processing returns `waiting`; byte/scalar loops do not
schedule promises. Fatal codec processing leaves output open. The `encodeOrFail`
operations additionally append its end marker, including on error, as required
by Encoding §6.1. Reuse a stateful encoder when resuming an operation; separate
completed encodings are not interchangeable with one streaming encoding.

`IOQueue<Uint8Array>` stores bytes; `IOQueue<string>` stores well-formed scalar
strings. Queues retain chunks, so their bytes must not be mutated while queued.
An empty open queue differs from the persistent `endOfQueue` token. `restore`
prepends unread input in order. Collection reads currently available output;
`takeBytes(env)` allocates and fills the final result in that environment's realm.
`bomSniff` peeks without consuming and needs three bytes or EOF: streaming callers
wait for that lookahead rather than repeatedly retrying a shorter prefix.

Web IDL owns author conversion and result projection. TextEncoder writes directly
into its result buffer through its construction runtime; return conversion preserves
that typed array. Runtime facilities also allocate retained buffers and
callback-visible stream chunks in their owning realm. Raw
codecs preserve BOMs; the higher-level decoding operations and TextDecoder apply
their respective BOM policies.

## Native paths and interoperability

UTF-8 conversion and byte writing use the existing native backend; UTF-16 string
materialization uses JS Engine's byte/string operations. Large single-byte
replacement chunks use a lazily retained Node TextDecoder; small chunks and fatal
decoding use our mapping tables. Keep
partial-character and fatal-recovery behavior when changing these fast paths.
The `utf8EncodeInto` accommodation completes a native underfilled prefix on
affected Node versions without discarding the native bulk conversion. Remove the
repair when all supported engines supply the correct fitting behavior.

Fatal streaming TextDecoder recovery has a known browser difference. Browlet
follows the written §7.2 queue steps and retains unread input after a fatal
streaming error. Chromium 149.0.7827.55, Firefox 151.0, and Playwright Windows
WebKit 26.5 discarded that input in the cases checked on September 11, 2026.
The regressions in `test/browlet/encoding.test.ts` retain the specification result,
including restored ASCII and independence from later input-buffer mutation.

## Mapping data and tests

From the repository root:

```sh
node --import tsx src/encoding/scripts/generate-tables.mjs
node --import tsx src/encoding/scripts/generate-tables.mjs --check
npm run test:unit -- test/encoding test/browlet/encoding.test.ts
```

The generator downloads the published `index-<name>.txt` files, validates their
entries, and checks packing through the runtime loader. It writes `gen/indexes.ts`
and independent mapping digests under `test/encoding/gen/`. Both generator modes
require network access; builds and runtime use checked-in data. Canonical names
and labels are maintained in [labels.ts](labels.ts).

Indexes expand on first use; reverse lookups are also lazy. Packed source strings
are present at module load. Source URLs, published identifiers, and WHATWG data
attribution remain in the generated files; retain `scripts/WHATWG-LICENSE.txt`.

Tests cover mapping digests, Unicode scalars, malformed input, chunk boundaries,
BOM handling, resumable errors, supplied output, and realm ownership through the
projected APIs.
