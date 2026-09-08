# Fetch dependency preflight

Reviewed 2026-09-07. This file owns the dependency work order, suggested folder
layout, and local reference inventory. The [Fetch roadmap](ROADMAP.md) owns
Fetch's implementation slices; the linked subsystem roadmaps own detailed
scope, implementation status, tests, and stopping points.

**Signature audit:** [Slices 1–10](#signature-audit) and all five
[deeper Streams families](#deeper-streams-reviews) are marked. The planned
signature audit is complete; investigation and fixes remain separate.

This is the agreed detour from [Browlet's priority order](../browlet/PRIORITY.md).
Read each named specification, then implement the portion assigned by its
owner. Where a dependency consumes Fetch itself, finish its independent work
first and integrate it with real Fetch records/lifecycle later. CSP stays last.

## Suggested folder structure

This is a **suggested implementation layout**, with the adopted HTTP grouping
defined by the [HTTP roadmap](../http/ROADMAP.md). Planned source filenames can
change as implementation becomes concrete. Add a TypeScript project/build
reference when its first source is implemented, not merely because its roadmap
exists. No new Git repositories or published packages are implied.

```text
src/
├── http/
│   ├── ROADMAP.md
│   ├── syntax.ts
│   ├── date.ts
│   ├── struct-fields/
│   │   └── ROADMAP.md
│   ├── cache/
│   │   └── ROADMAP.md
│   └── cookies/
│       └── ROADMAP.md
├── storage/
│   └── ROADMAP.md
├── fetch/
│   ├── ROADMAP.md
│   ├── PREFLIGHT.md
│   ├── integrity.ts
│   ├── multipart/
│   │   └── ROADMAP.md
│   └── http/
│       ├── ROADMAP.md
│       ├── metadata.ts
│       └── cache/
│           └── ROADMAP.md
├── file/
│   ├── ROADMAP.md
│   └── blob-url-store.ts
├── xhr/
│   ├── ROADMAP.md
│   └── form-data.ts
└── browlet/
    ├── browsing/
    │   └── policy/
    │       ├── ROADMAP.md
    │       ├── container.ts
    │       ├── secure-contexts.ts
    │       ├── referrer-policy.ts
    │       ├── integrity-policy.ts
    │       ├── hsts.ts
    │       ├── mixed-content.ts
    │       ├── upgrade-insecure-requests.ts
    │       └── csp/
    │           └── ROADMAP.md
    ├── storage/
    │   └── ROADMAP.md
    ├── reporting/
    │   └── ROADMAP.md
    └── performance/
        └── ROADMAP.md
```

The HTTP roadmap owns the boundary between reusable protocol work and Fetch's
processing. Multipart and cache transactions remain within Fetch. Storage has
its own substrate; browser policy, report delivery, and timing remain in
Browlet. Store instances still belong to the appropriate browser lifetime;
a shared source project does not imply shared process-global state.

## Work order

Follow this order for the independently implementable portions. Status and
acceptance criteria live in the linked owner, not in a second checklist here.

| Order | Work / authoritative plan | First integration point |
| --- | --- | --- |
| 1 | [Structured fields](../http/struct-fields/ROADMAP.md), RFC 9651 | Fetch header operations |
| 2 | [Multipart bytes](multipart/ROADMAP.md), RFC 7578 + HTML/Fetch | Body extraction/consumption |
| 3 | [HTTP foundation](../http/ROADMAP.md) and [cache rules](../http/cache/ROADMAP.md), RFCs 9110/9111/5861 | Response freshness, then [Fetch cache transactions](http/cache/ROADMAP.md) |
| 4 | [Trustworthiness](../browlet/browsing/policy/ROADMAP.md#trustworthiness), Secure Contexts | Browser policy and Metadata inputs |
| 5 | [Cookies](../http/cookies/ROADMAP.md), the current HTTPWG draft + HTML/Fetch | HTTP cookie processing, then HTML consumers |
| 6 | [Referrer Policy](../browlet/browsing/policy/ROADMAP.md#referrer-policy) | Request/redirect handling and policy delivery |
| 7 | [Fetch Metadata](http/ROADMAP.md#fetch-metadata) | Outgoing HTTP request headers |
| 8 | [SRI verification](ROADMAP.md#subresource-integrity) and [Integrity Policy](../browlet/browsing/policy/ROADMAP.md#integrity-policy) | Response bytes and request policy |
| 9 | [HSTS](../browlet/browsing/policy/ROADMAP.md#hsts), RFC 6797 | Scheme upgrading and secure transport |
| 10 | [Storage keys](../storage/ROADMAP.md#first-slice--storage-keys), then [File's Blob URL slice](../file/ROADMAP.md#slice-4--blob-url-store-and-urlfetch-integration-deferred) | URL resolution, Fetch, and environment teardown |

Existing foundations are indexed in Fetch's
[dependency ledger](ROADMAP.md#dependency-ledger). In particular, the
[FormData entry list](../xhr/ROADMAP.md) and Blob/File bytes already exist;
their remaining multipart and Blob URL work has the owners linked above.

## Signature audit

**Status:** Slices 1–10 and the deeper Streams pass below are marked as of
2026-09-07. The planned signature audit is complete. Investigation and fixes
come later.
Review the callable shapes of existing
implementations, including unmarked differences; searching `SPEC_MISMATCH`
alone cannot establish coverage. JS Engine is outside this audit. The completed
Fetch body-scheduling and multipart reviews are starting evidence, not proof
that the rest of Fetch has been checked.

Compare each implemented specification operation with its source: argument
count/order, optional arguments/defaults, callback signatures, input/result
representations, and synchronous versus promise/completion results. Account
for an implicit receiver or surrounding algorithm state before calling an
argument extra. Include private helpers that implement named spec algorithms;
exclude data-only records and explicitly unimplemented operations.

This is a signature review, not a line-by-line algorithm or conformance audit.
Mark observable shape differences without investigating their justification.
Browser comparisons, caller tracing, and design discussions are a later pass;
a browser's different internal signature is not itself a specification failure.
RFC prose predicates and ordinary implementation helpers do not acquire an
invented normative signature merely to fit this exercise.

Use the existing single-line `SPEC_MISMATCH: <original signature>` convention.
Do not reorder arguments, remove dependencies, or change implementation during
this pass, even where a difference looks easy to fix. Follow specification
order within a slice and label differences for later review instead of stopping
to resolve each one. Record the covered scope so the remainder is clear.

Each slice should cover one related family, usually about 15–25 specification
operations. Split a larger family at a named algorithm boundary rather than
expanding into its behavior. Report covered operations and marker locations.
This section owns audit progress;
keep detailed decisions beside the code or in an existing owner note and link
them here instead of copying them across roadmaps. A marked slice means its
signature differences were inventoried, not resolved.

### Review slices

**Slice 1 coverage:** controller operations, task delivery, offline/integer
helpers, FetchParams predicates/callback signatures, timing creation, URL
predicates, implemented Body operations, multipart, and HTML parallel-queue
construction. Nine new markers; the two multipart markers remain. Data-only
records and unimplemented Body methods were excluded. The Body record's added
scheduling dependency is marked by its original record shape.

**Slice 2 coverage:** header-list operations and predicates, structured-field
adapters, method/status helpers, ranges, and implemented Request/Response
creation and getters, including their API declarations. Five new markers:
header extraction's extra arguments, User-Agent environment input, range
parsing's failure result, and the two creation signatures. Data-only records
and unimplemented API methods were excluded.

**Slice 3 coverage:** Blob/File construction, Blob-part processing and native
line endings, slicing, Blob stream/promise reads, File metadata getters, and
FileList's item/length/index signatures, including their API declarations.
Eleven new markers in `src/file/blob.ts` and `file.ts`: construction
inputs/defaults, the BlobData result, nullable slice inputs, and explicit
Binding Context arguments on reads. FileList needed no markers; owner-only
mutation and host-storage helpers have no corresponding named spec signatures.
Serialization is covered by Slice 4; the Streams adapters remain in Slice 10.

**Slice 4 coverage:** FileReader's API, private read operation, data packaging,
and Blob/File/FileList serialization callbacks and record fields. Twelve new
markers: six Binding Context inputs on reading/packaging, four serialization
context inputs, and the Blob/File records' BlobData backing and added MIME
type field. Callback signatures use HTML's contract, which already supplies
`forStorage` and `targetRealm`. FileReaderSync remains unimplemented; general
Streams adapters and event machinery were not audited here.

**Slice 5 coverage:** HTTP token/whitespace predicates, quoted strings, dates,
Cache-Control/delta-seconds/Vary parsing, freshness/stale windows, storage
eligibility, request restrictions, and invalidation triggers. Fifteen functions
reviewed; one new marker in `src/http/syntax.ts` for combining input and position
in a cursor. The RFC-based helpers implement grammars, rules, and formulas
without prescribed callable signatures; their local interfaces needed no markers.

**Slice 6 coverage:** all 32 RFC 9651 §4 serialization/parsing operations,
including inlined operations and §3 value representations, across 22 functions.
Fourteen new markers: two in `serialize.ts` for its string result versus §4.1's
final ASCII-byte result and bundled Item/Inner List arguments; twelve in
`parse.ts` for cursor inputs and tagged results versus RFC strings, arrays,
maps, tuples, and bare values. `null` represents unspecified failure signaling;
`undefined` asks the caller to omit an empty field. Character predicates and
data-only type declarations needed no separate markers.

**Slice 7 coverage:** MIME parsing/serialization, classification, resource
metadata/header reading, pattern matching, WebM/MP3 helpers, and all sniffing
contexts across the five MIME source files. Twenty-five new markers: three in
`mime-type.ts`, two in `resource.ts`, eight in `signatures.ts`, and twelve in
`sniffing.ts`. They cover explicit host inputs, failure/result representations,
resource updates exposed as returned values, and media-helper shapes. `void`
denotes steps that update resource metadata or surrounding state without a
returned value; MP3's shared locals are carried in a frame record. Byte-pattern
tables and existing notes about unfinished sniffing/MP3 behavior were not
re-audited; ordinary helpers and data-only records needed no separate markers.

**Slice 8 coverage:** all seven implemented Encoding hooks, TextEncoder/
TextDecoder API declarations and operations, shared decoder state, and stream construction,
chunk/flush callbacks, and getters. Twelve new markers: seven for encoding
names/failure values and complete byte-array/string results instead of I/O
queues with optional output queues; four for constructor-supplied Binding
Contexts; one for the encoder chunk helper's converted string and explicit
enqueue callback. Exodus's public adapter declarations were checked; its
codecs were not audited. Web IDL supplies API defaults and buffer types;
`encodeInto`'s map result matches the specified IDL dictionary value. Ordinary
codec/realm adapters have no separate normative signatures. The general
Streams boundary remains in Slice 10.

**Slice 9 coverage:** FormData's constructor, both append/set overloads,
delete/get/getAll/has, entry-list iteration/access, and HTML's create-an-entry
capability and implementation. One new marker on the constructor for the
supplied capability; its form/submitter branch remains explicitly deferred.
HTML's string/Blob inputs and name/value tuple match the implementation-layer
representations, so create-an-entry needed no marker. The unresolved HTML
forms branch and unimplemented XMLHttpRequest were excluded.

**Slice 10 coverage:** all 40 entry points exposed by the three Streams
cross-specification modules: 27 local definitions and 13 re-exports, including
byte-stream creation. Also checked the nested read-loop, callback contracts,
GenericTransformStream getters, and immediate Fetch/File/Encoding callers.
Fourteen new markers: six in `readable-stream-cross-spec.ts`, two each in
`readable-byte-stream-operations.ts`, `writable-stream-cross-spec.ts`, and
`transform-stream-cross-spec.ts`, and two at Blob's call sites. They cover
allocation combined with setup and explicit Binding Contexts, byte offsets
instead of consumed-prefix removal, captured read-loop arguments, bundled
piping options, and write/cancel callback signatures. File API's byte-read and
text-stream call sites still describe different shapes from current Streams;
the Blob adapter supplies the callbacks/promise and associated TransformStream.
Internal promise and stream implementations, the DOM-backed abort signal,
read-request callbacks, and implicit stream receivers needed no separate
markers. General stream state machines and the deeper reviews below remain
outside slice 10.

Existing stubs and planned features remain with their implementation roadmaps.

| Slice | Bounded source scope | Specification comparison |
| --- | --- | --- |
| 1 — Fetch control and bodies — marked | `controller.ts`, `tasks.ts`, `infrastructure.ts`, `params.ts`, `timing.ts`, `url.ts`, `body.ts`, `multipart/`, and `src/infra/parallel-queue.ts`; include constructor-supplied scheduling and the remaining extracted-helper signatures | Fetch §2 preamble, §2.1, §2.2.4, and implemented §5.2–§5.3 paths; HTML parallel queues and multipart encoding |
| 2 — Fetch HTTP adapters — marked | `headers.ts`, `http/methods.ts`, `http/ranges.ts`, `http/statuses.ts`, and implemented operations in `request.ts`/`response.ts` | Fetch §§2.2.1–2.2.3 and implemented §§2.2.5–2.2.7; compare present API declarations with §5 without treating stubs as implemented |
| 3 — Blob, File, and FileList — marked | `src/file/blob.ts`, `file.ts`, `file-list.ts`; inspect `blob-data.ts`/`integration.ts` only where they explain a signature | File API §§2–5 and referenced stream/byte operations; distinguish internal construction from author-facing Web IDL |
| 4 — File reading and serialization — marked | `src/file/package-data.ts` and `src/browlet/integration/file/`, including FileReader and registered serialization steps | File API §§6–7 and Blob/File/FileList serialization; follow immediate HTML/Streams dependencies without auditing those whole subsystems |
| 5 — HTTP syntax, dates, and cache policy — marked | `src/http/syntax.ts`, `date.ts`, and `cache/` | Fetch's quoted-string algorithm and the implemented RFC 9110/9111/5861 rules; distinguish local policy predicates from named algorithms |
| 6 — Structured fields — marked | `src/http/struct-fields/parse.ts`, `serialize.ts`, and value representations | RFC 9651 §4 parsing/serialization; include cursor mutation, parse failure, and serialized-result shapes |
| 7 — MIME — marked | `mime-type.ts`, `resource.ts`, `sniffing.ts`, `signatures.ts`, and `pattern.ts` | MIME Sniffing's parsing, serialization, classification, and sniffing signatures; skip byte-pattern tables and algorithm internals |
| 8 — Encoding — marked | `src/encoding/hooks.ts`, `utf-8.ts`, and TextEncoder/TextDecoder stream and non-stream adapters | Encoding's named operations and API declarations; check the adapter contract against Exodus without auditing or replacing its codecs |
| 9 — XHR/FormData — marked | `src/xhr/form-data.ts` and `src/browlet/html/forms/entry-list.ts` | XHR §4 and HTML's create-an-entry operation, including the supplied capability and Blob/File representations; unimplemented XMLHttpRequest remains out of scope |
| 10 — Streams used by other specs — marked | `readable-stream-cross-spec.ts`, `writable-stream-cross-spec.ts`, `transform-stream-cross-spec.ts`, and their re-exported entry points | Streams' operations for use by other specifications; inspect the immediate creation/read/pipe callers in Fetch, File, and Encoding |

Sources are the [local inventory](#local-reference-inventory), plus
`whatwg-encoding/encoding.bs`, `whatwg-mimesniff/mimesniff.bs`, and
`whatwg-streams/index.bs` under the same specification root.

### Deeper Streams reviews

The completed slice 10 covers the entry points used by other specifications.
These five completed families extend the same marker-only review through the
internals, including Binding Context parameters and retained contexts.
Context use alone is not a signature mismatch. These reviews do not verify
the stream state machines or add implementation prerequisites to Fetch.

**Readable defaults coverage (2026-09-07):** checked the ReadableStream,
generic/default reader, and default controller APIs, plus 30 functions in
`readable-stream-operations.ts`, including asynchronous iteration and private
named algorithms. Eleven new markers: two in `readable-stream.ts`, one in
`readable-stream-default-reader.ts`, and eight in
`readable-stream-operations.ts`. Five identify explicit Binding Context
parameters on constructors and creation methods/algorithms. The others cover
initialization returning a state record, unpacked iterator arguments, a
separate reader mixin, and strategy extraction folded into controller setup.

Streams, generic-reader mixins, and default controllers retain a Binding
Context for construction, promises, exceptions, and underlying-source
conversion. Operations obtaining that context from an existing receiver keep
their specified arguments. The mixin and nonconstructible controller have no
separate specification constructor signature to label. Converted callbacks,
read requests, promise results, and explicit equivalents of implicit receivers
needed no additional markers. Pipe/tee, byte operations, shared helpers, and
unimplemented transfers remain outside this slice.

**Byte streams / BYOB coverage (2026-09-07):** checked the byte controller,
BYOB reader/request APIs and internal methods, pull-into records, and named
algorithms in `readable-byte-stream-operations.ts`, excluding tee. Seven new
markers: one on the BYOB reader constructor and six in the operations module.
They cover context-supplied construction/cloning, the added controller used
when converting a pull-into descriptor, controller state passed directly,
ArrayBuffers in place of data blocks, and byte-only narrowing of the general
read-request chunk. Buffer clone/copy signatures come from ECMAScript's
`CloneArrayBuffer` and `CopyDataBlockBytes` operations.

The byte controller and BYOB request retain a Binding Context without having
author constructors to label. View-construction helpers use that context and
a view-type name in place of the descriptor's specified view constructor;
the descriptor itself is a data record. These uses remain visible for the
later context review without inventing signatures for allocation helpers.

**Pipe and tee coverage (2026-09-07):** checked PipeTo, default/byte tee,
public pipe/tee methods, and their read, cancellation, abort, and clone
callbacks. Four new markers: PipeTo's three shutdown/finalize helpers add
booleans to preserve whether an error was supplied; `structured-data.ts`
adds a Binding Context to Streams' `StructuredClone`. Outer pipe/tee
signatures match. The DOM abort handle and HTML clone capability remain
integration contracts, not additional named Streams algorithms.

**Writable coverage (2026-09-07):** checked stream/writer/controller APIs,
underlying-sink callbacks, creation/setup, queue progression, erroring,
closing, and promise-result signatures, including private named algorithms.
Six new markers across `writable-stream.ts`, the writer, and operations:
constructor/creation context, creation defaults, initialization returning a
state record, the supplied controller in sink setup, and state passed instead
of a stream to the in-flight predicate. Streams and writers retain context;
controllers obtain it through their stream. `createStreamAbortController`
passes context through the existing DOM capability and has no independent
Streams algorithm signature to label.

**Transform and shared coverage (2026-09-07):** checked transform/controller
APIs, source/sink/backpressure algorithms, the generic-transform mixin, both
queuing strategies, queue-with-sizes, and promise/miscellaneous helpers.
Eight new markers: the transform and two strategy constructors, the supplied
controller in transformer setup, two explicit RangeError constructors,
`CloneAsUint8Array`'s context, and `TransferArrayBuffer`'s realm argument.
The last marker lives at the shared definition in `src/web-idl/buffer-source.ts`;
it covers the Streams boundary without extending this into a Web IDL audit.

Transform operations otherwise recover context from their stream. Strategy
size functions are cached by Binding Context; their allocation/cache helper
signatures are local, and the generated size functions keep their specified
arguments. `runPromiseAlgorithm` is a local promise adapter, not another
named spec operation. MessagePort-backed transfers remain deferred in
[Streams' owner notes](../streams/PORTING-NOTES.md). `CanTransferArrayBuffer`
has no implementation; its missing detach-key check is recorded beside
[the shared transfer helper](../web-idl/buffer-source.ts). No state-machine
behavior or context ownership was changed by this pass.

| Follow-up | Scope |
| --- | --- |
| Readable defaults — marked | ReadableStream, generic/default readers, default controller, and their abstract operations; exclude pipe/tee and byte-stream operations |
| Byte streams / BYOB — marked | Byte controller, BYOB reader/request, pull-into records, and `readable-byte-stream-operations.ts`; exclude tee |
| Pipe and tee — marked | Default/byte tee and piping signatures, including abort and clone callbacks; inspect the HTML cloning capability only at that boundary |
| Writable streams — marked | WritableStream, writer/controller operations, underlying-sink callback shapes, and promise results |
| Transform and shared operations — marked | TransformStream, its controller and generic-transform mixin, queuing strategies, queue-with-sizes, and shared promise/miscellaneous helpers where they map to spec operations |

## Rejoin Fetch, then finish browser policy

After structured fields, multipart bytes, and independent HTTP cache policy,
resume the [Fetch slices](ROADMAP.md#slice-1--control-and-task-delivery).
The remaining work-order entries above are gates for their named consumers,
not prerequisites for starting §2. Cache storage/selection likewise resumes
when Fetch supplies its request, response, header-list, and body records.
Follow their order for records, APIs, and request processing. Complete the
consumer integration gates in each owning roadmap with real Fetch inputs;
do not construct parallel Request/Response models to avoid those dependencies.

Finish the policy stage in this order:

1. [Mixed Content and Upgrade Insecure Requests](../browlet/browsing/policy/ROADMAP.md#mixed-content-and-upgrade-insecure-requests).
2. [Reporting](../browlet/reporting/ROADMAP.md), including its Fetch delivery.
3. [CSP](../browlet/browsing/policy/csp/ROADMAP.md), last, including delivery of
   its inputs to the preceding policy algorithms.

Configured policy enforcement must have real behavior tests; explicitly
empty policies exercise only the unconfigured path.

Timing integration is owned by the [performance roadmap](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration).
HTML Web Storage remains in its [browser roadmap](../browlet/storage/ROADMAP.md).
Their complete API families are not prerequisites for Fetch's initial records.

## Deferred consumers

[Fetch's deferred-work section](ROADMAP.md#explicitly-deferred-work) owns the
later Service Worker, fetchLater/Permissions Policy, automation, authentication,
and transport gates. The [File roadmap](../file/ROADMAP.md) owns Blob URL
lifetime/MediaSource exposure, and [XHR](../xhr/ROADMAP.md) retains form-backed
FormData construction. This index does not repeat those implementation plans.

## Local reference inventory

Root: `C:/Users/rando/source/repos/_web-platform/specs/`.
The paths below are relative to that root. Existing checkouts were reused;
the missing repositories were shallow-cloned and the published RFC texts
downloaded on 2026-09-06. These are reference sources, not installed runtime
dependencies. Prefer the listed editable source over generated snapshots.

| Specification / evidence | Local source | Acquisition |
| --- | --- | --- |
| Fetch | `whatwg-fetch/fetch.bs` | Existing |
| HTML | `whatwg-html/source` | Existing |
| XHR / FormData | `whatwg-xhr/xhr.bs` | Existing |
| File API | `w3c-file-api/index.bs` | Existing |
| RFC 9651 | `rfcs/rfc9651.txt` | Published RFC |
| RFC 7578; supporting MIME rules | `rfcs/rfc7578.txt`, `rfcs/rfc2046.txt`, `rfcs/rfc2183.txt` | Published RFCs |
| HTTP semantics/cache/stale extensions | `rfcs/rfc9110.txt`, `rfcs/rfc9111.txt`, `rfcs/rfc5861.txt` | Published RFCs |
| HSTS | `rfcs/rfc6797.txt` | Published RFC |
| HTTP/1.1 and extensible priorities | `rfcs/rfc9112.txt`, `rfcs/rfc9218.txt` | Published RFCs; supporting transport references |
| [Structured-field test vectors](https://github.com/httpwg/structured-field-tests) | `httpwg-structured-field-tests/README.md` and JSON fixtures | New; `1e280c3` |
| [Cookies / HTTPWG drafts](https://github.com/httpwg/http-extensions) | `httpwg-http-extensions/draft-ietf-httpbis-layered-cookies.md` | New; `1057fe0` |
| [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) | `w3c-secure-contexts/index.bs` | New; `68191bb` |
| [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/) | `w3c-referrer-policy/index.src.html` | New; `cc435b0` |
| [Fetch Metadata](https://w3c.github.io/webappsec-fetch-metadata/) | `w3c-fetch-metadata/index.bs` | New; `6d0c5bf` |
| [SRI / Integrity Policy](https://w3c.github.io/webappsec-subresource-integrity/) | `w3c-subresource-integrity/index.bs` | New; `632bf53` |
| [Storage](https://storage.spec.whatwg.org/) | `whatwg-storage/storage.bs` | New; `1933f42` |
| [Mixed Content](https://w3c.github.io/webappsec-mixed-content/) | `w3c-mixed-content/index.bs` | New; `a4eacec` |
| [Upgrade Insecure Requests](https://w3c.github.io/webappsec-upgrade-insecure-requests/) | `w3c-upgrade-insecure-requests/index.bs` | New; `87d0b9d` |
| [CSP Level 3](https://w3c.github.io/webappsec-csp/) | `w3c-csp/index.bs` | New; `e81d712` |
| [Reporting](https://w3c.github.io/reporting/) | `w3c-reporting/index.bs` | New; `57e73b5` |
| [Resource Timing](https://w3c.github.io/resource-timing/) | `w3c-resource-timing/index.bs` | New; `1f9ef25` |
| [Performance Timeline](https://w3c.github.io/performance-timeline/) | `w3c-performance-timeline/index.bs` | New; `8aa7b1d` |
| [Navigation Timing](https://w3c.github.io/navigation-timing/) | `w3c-navigation-timing/index.bs` | New; `245fee2` |
| [Server Timing](https://w3c.github.io/server-timing/) | `w3c-server-timing/index.bs` | New; `573ee35` |
| [Permissions Policy](https://w3c.github.io/webappsec-permissions-policy/) | `w3c-permissions-policy/index.bs` | New; `c10c76d` |
| [Service Workers](https://w3c.github.io/ServiceWorker/) | `w3c-service-workers/index.bs` | New; `92aba3b` |
| [WebDriver BiDi](https://w3c.github.io/webdriver-bidi/) | `w3c-webdriver-bidi/index.bs` | New; `242588e` |

The existing Infra, URL, Encoding, MIME Sniffing, Streams, Web IDL, and High
Resolution Time checkouts remain the reference sources for completed
foundations. Undici and browser source checkouts are implementation evidence;
their behavior does not override a normative requirement.

## Maintaining these plans

Record implemented scope, spec revision, observable tests, and remaining gaps
in the owning roadmap. Parent plans retain ordering and links. Move detail
when ownership changes rather than copying the same checklist into each
ancestor. Reference paths/revisions are catalogued above; downloaded sources
are not implemented dependencies.

The dependency review covers Fetch's direct surface and the additional
multipart/trust/storage prerequisites found so far. It does not claim a full
transitive audit of CSP, workers, or every transport protocol. Record a newly
required specification at its actual consumer before expanding the plan.
Keep new failures ordinary failures until Eric agrees to another status.
