# Fetch project roadmap

This directory owns Browlet's host-neutral implementation of the
[Fetch Standard](https://fetch.spec.whatwg.org/). It owns Fetch records,
algorithms, and public API semantics. Browlet supplies browser-host state and
consumes the resulting responses. Raw HTTP connection management is a
transport capability, not Fetch policy.

Fetch must preserve the standard's record model even when a later consumer
only needs a small public surface. Undici can supply transport bytes, but its
`fetch`, `Headers`, `Request`, `Response`, streams, abort objects, and promises
must not cross Browlet's implementation or Web IDL boundaries.

Do not add a TypeScript project reference or public package entry until the
first implemented source makes this boundary executable.

## Implementation order

Implement algorithms in specification order within each slice. Preserve their
normative names and step order unless a representation-level optimization is
proved equivalent and documented.

There is one deliberate departure from top-to-bottom document order. After
completing Fetch §2's semantic records, implement the network-independent API
objects in Fetch §§5.1–5.5 before entering Fetch §§3–4. `Headers`, `Request`,
and `Response` directly project the §2 records and can be tested without I/O.
Requiring cookies, caches, policy checks, and transport merely to exercise
those objects would enlarge the dependency front without improving the model.

After §§5.1–5.5, return to Fetch §3 and proceed in document order through
Fetch §4. Fetch §6 is allowed to close the `data:` branch left by Fetch §4.3.
The public `fetch()` operation in Fetch §5.6 becomes executable only after the
required Fetch §4 orchestration exists.

When an algorithm reaches a missing external dependency:

- keep the dependency visible under its specification name;
- add the narrow record, capability, or integration seam needed by the caller;
- do not substitute a Node public object or unrelated host behavior;
- do not expose an interface whose referenced interface family is incomplete;
- leave the unsupported branch and its completion condition explicit here or
  in a narrower surviving roadmap; and
- continue with later independent algorithms when doing so does not falsify
  an invariant used by them.

## Ownership map

| Planned area | Contract | Fetch sections |
| --- | --- | --- |
| `host.ts` | Origins, settings/client state, task destinations, clocks, abort reasons, policy decisions, storage services, and transport entry points supplied without a Browlet dependency | §§2.1–2.2, 4, and “Using fetch in other standards” |
| `controller.ts` | Fetch parameters, controller state, cancellation, timing, and response-body information | §2, “Infrastructure” |
| `headers.ts` | Header lists, parsing, normalization, extraction, guards, and forbidden/safelisted names | §§2.2.2, 3.3–3.8, and 5.1 |
| `body.ts` | Body records, stream extraction, cloning, consumption, and `BodyInit` conversion | §§2.2.4 and 5.2–5.3 |
| `request.ts` | Request records, cloning, policy inputs, destinations, and the `Request` implementation | §§2.2.5 and 5.4 |
| `response.ts` | Response records, filtered responses, cloning, network errors, and the `Response` implementation | §§2.2.6 and 5.5 |
| `http/` | HTTP extensions, redirects, CORS, authentication, cache integration, response blocking, and header protocols | §§2.3–2.10, 3, and 4.4–4.11 |
| `schemes/` | `about:`, `blob:`, `data:`, `file:`, and HTTP(S) scheme dispatch | §§4.3 and 6 |
| `fetch.ts` | Main Fetch orchestration, response-processing callbacks, task destinations, and ongoing-fetch control | §§4.1–4.2 and “Using fetch in other standards” |
| `transport.ts` | HTTP request/response bytes, streaming, cancellation, connection reuse, and TLS metadata without Fetch redirects or CORS policy | §§2.5–2.6 and 4.6–4.7 |
| `api.ts` | Realm-correct `Headers`, `Request`, `Response`, Body mixin, `fetch()`, and related promises | §5 |
| `web-idl.ts` | Lossless Fetch IDL contributions assembled by the active browser host | §5 |

## Dependency ledger

| Dependency | First required by | Present state | Delivery decision |
| --- | --- | --- | --- |
| URL records, parsing, hosts, and origins | Fetch §§2.1 and 2.2.5 | Implemented in `src/url`, including the host-neutral origin and site operations | Consume the existing records and algorithms directly; do not create a second parser or IDNA path |
| DOM abort algorithms | Fetch §§2.2 and 5.4–5.6 | Implemented through DOM §3 | Consume through a narrow Fetch host capability; never expose Node's `AbortSignal` |
| HTML structured data | Fetch §2 controller abort steps | Implemented through HTML §2.7 | Serialize abort reasons through the existing capability boundary |
| Streams | Fetch §2.2.4 | Ordinary Readable, Writable, and Transform Streams are implemented; Fetch's cross-specification tee clone is connected to HTML structured cloning | Transferable Streams and MessagePort are not Fetch prerequisites |
| Parallel queues and task destinations | Fetch §§2.2 and 2.2.4 | HTML §2.1.1 parallel queues are implemented in `src/shared`; global task destinations and the networking task source also exist | Fetch retains its own task-destination union and queue-fetch-task algorithm |
| Encoding | Fetch §§2.2.4 and 5.2–5.3 | `@exodus/bytes` supplies useful encoding algorithms, but Browlet has no Encoding-owned projection | Establish UTF-8 encode/decode hooks for body work; add a Browlet `TextDecoderStream` before exposing `Body.textStream()` |
| MIME types | Fetch §§2.2.2, 2.10, 3.5–3.6, 5.3, and 6 | MIME Sniffing §§1–8 are implemented in `src/mime` | Consume the host-neutral MIME records and algorithms directly; consumer-specific missing-type policy remains with its loader |
| Forgiving Base64 | Fetch §7 | Infra §7 encode and forgiving decode are implemented in `src/shared/base64.ts` | Consume the host-neutral algorithms directly from the `data:` URL processor |
| Blob and File | Fetch §§2.2.4, 4.3, and 5.2–5.3 | Not implemented | Add the File API objects, stream access, slicing, type/size state, and HTML structured-data capabilities before exposing the complete Body family or `blob:` fetching |
| FormData and multipart data | Fetch §§2.2.4 and 5.2–5.3 | Not implemented | Add XHR's FormData entry-list model and multipart encoding/parsing as a bounded prerequisite to the complete Body family |
| High Resolution Time | Fetch §2 timing records and §4 timing steps | Environment timing and a shared monotonic clock exist | Keep Fetch timing records host-neutral; Browlet supplies the clock and later Resource Timing reporting |
| Referrer Policy | Fetch §§2.2.5, 3.2, and 4.1–4.5 | Policy-container storage exists; the normative policy algorithms do not | Preserve request fields immediately and add policy hooks when the first algorithm needs to calculate or redirect a referrer |
| Cookies, cache, authentication, and network partitioning | Fetch §§2.3, 2.7–2.8, 3.1, and 4.4–4.9 | Not implemented | Define records and explicit host services in document order; defer storage behavior until the HTTP transport slice or a Browlet consumer requires it |
| CSP, Mixed Content, SRI, CORP/COEP, Reporting, and Service Workers | Fetch §§3.7 and 4.1–4.7 | Partial policy records exist, but the owning subsystems do not | Keep named policy/interception hooks and test the no-policy path; do not report unsupported branches as implemented |
| Resource Timing and Navigation Timing reporting | Fetch §§2.2.6 and 4.1 | High-resolution timestamps exist; reporting does not | Store all required timing information now and add reporting at the existing loader/performance integration phase |
| HTTP transport | Fetch §§2.5–2.6 and 4.6–4.7 | No Fetch transport adapter or direct Undici dependency | Prove behavior with an injected fake transport, then add an Undici dispatcher-level adapter with redirects disabled |

## Slice 1 — foundational infrastructure

**Specification:** Fetch §§2.1–2.2.3.

Implement in document order:

1. URL- and origin-facing Fetch concepts from §2.1 without duplicating URL
   parsing or IDNA processing.
2. Fetch parameters, controller state, timing information, task destinations,
   fetch-controller abort/terminate behavior, and queue-a-fetch-task from the
   opening portion of §2.
3. HTTP whitespace, tokens, quoted strings, methods, header names and values,
   header lists, header-list combination/sorting, forbidden and safelisted
   header algorithms, and status classifications from §§2.2.1–2.2.3.
4. The host contract required by these records, including an explicit global
   or parallel task destination and realm-neutral error/timing values.
5. Fetch's queue-a-fetch-task routing over the HTML §2.1.1 parallel queue
   completed during preflight and Browlet's existing global task destination.

Do not add transport or public `Headers` behavior merely to test the records.
Test the internal algorithms directly, including duplicate headers,
`Set-Cookie`, normalization, invalid bytes, guards' prerequisite predicates,
abort serialization, and destination ordering.

**Exit proof:** Fetch's controller, timing, method, status, header-list, and
task-destination algorithms execute without importing Browlet, Undici, or a
Node platform object.

## Slice 2 — bodies, requests, and responses

**Specification:** Fetch §2.2.4–§2.10.

Implement in document order:

1. Body records, cloning, incremental reading, fully reading, and byte-stream
   setup from §2.2.4 using the Streams implementation.
2. Body extraction initially for byte sequences, `BufferSource`, scalar-value
   strings, `URLSearchParams`, and `ReadableStream`.
3. MIME, Blob/File, FormData/multipart, and Encoding prerequisites when their
   branches are reached; do not narrow the declared `BodyInit` union to avoid
   implementing them.
4. Request records, destinations, modes, credentials, referrer and policy
   inputs, cloning, and origin/client relationships from §2.2.5.
5. Response, filtered-response, network-error, cloning, location URL, and MIME
   extraction records from §2.2.6.
6. The remaining §2 infrastructure in order: miscellaneous HTTP concepts,
   authentication entries, fetch groups, domain resolution, connections,
   partition keys, cache partitions, port blocking, and MIME-type blocking.
   Implement pure algorithms and records; leave network/storage actions behind
   named host capabilities.

Content-coding decompression belongs to the transport boundary but its Fetch
decision and failure semantics remain in this project.

**Exit proof:** request and response records can carry, clone, consume, and
cancel streamed byte bodies with deterministic task delivery; every deferred
§2 network or storage action is represented by a named capability rather than
an implicit no-op.

## Slice 3 — network-independent platform APIs

**Specification:** Fetch §§5.1–5.5. This is the deliberate document-order
departure described above.

Implement:

1. `Headers` and its iterator from §5.1 over the existing header-list and guard
   algorithms.
2. The complete `XMLHttpRequestBodyInit` and `BodyInit` unions from §5.2.
3. The Body mixin from §5.3, including realm-correct promises, ArrayBuffers,
   `Uint8Array`, Blob/File, FormData, JSON parsing, UTF-8 text decoding, and
   `textStream()` through a Browlet `TextDecoderStream`.
4. `Request`, `RequestInit`, and signal following from §5.4.
5. `Response`, `ResponseInit`, filtered responses, cloning, and static
   constructors from §5.5.

Partials and mixins follow the project-wide Web IDL policy: declarations are
co-located with their semantic owners, meaningful Body state/behavior is
composed into Request and Response, and bindings only project the completed
object graph.

Do not expose `fetch()` from §5.6 in this slice. A stub that returns a rejected
promise would make an unavailable Fetch pipeline appear implemented.

**Exit proof:** realm-correct `Headers`, `Request`, and `Response` objects pass
their constructor, conversion, mutation, clone, body-consumption, abort, and
exception tests with no network transport installed and no Node public object
escaping.

## Slice 4 — HTTP extensions

**Specification:** Fetch §§3.1–3.8.

Return to document order and implement:

1. Cookie header integration seams from §3.1, while keeping cookie parsing,
   storage, retrieval, and policy with the cookie subsystem.
2. Origin-header serialization and referrer-policy integration from §3.2.
3. CORS protocol definitions, safelists, credentials behavior, new-header
   syntax, and checks from §3.3.
4. `Content-Length`, MIME extraction for `Content-Type`, `nosniff`, CORP, and
   `Sec-Purpose` behavior from §§3.4–3.8.

Use pure deterministic tests for header and CORS algorithms. Policy-owned
questions must call named host capabilities so the default no-policy test host
is explicit and replaceable.

**Exit proof:** every Fetch §3 header protocol and check is either executable
or stops at a named external-policy/storage capability with its inputs fully
formed.

## Slice 5 — Fetch orchestration and local schemes

**Specification:** Fetch §4–§4.5 and §6.

Implement in order:

1. The Fetch entry algorithm and main-fetch response processing from the
   opening of §4 and §4.1, preserving CSP, Mixed Content, upgrade, Service
   Worker, response-blocking, and timing calls as explicit host decisions.
2. Override fetch from §4.2 as an embedder/test seam, not a global mutable
   shortcut.
3. Scheme fetch from §4.3 for the branches whose dependencies exist.
4. HTTP fetch and HTTP-redirect fetch from §§4.4–4.5, with transport and cache
   work still delegated by contract.
5. The `data:` URL processor from §6, then close the `data:` branch left in
   scheme fetch. Use the MIME parser and project-owned byte/base64 operations.

`about:`, `blob:`, and `file:` branches remain explicit until their owning URL
store, File API, and host filesystem decisions exist. `file:` behavior is an
embedder policy, not permission to expose arbitrary Node filesystem access.

**Exit proof:** an injected test host can perform a `data:` fetch and exercise
redirect/main-fetch control flow with deterministic response callbacks and no
real network.

## Slice 6 — HTTP transport, CORS, and public fetch

**Specification:** Fetch §§4.6–4.11, §§5.6–5.7, and “Using fetch in other
standards”.

Implement:

1. HTTP-network-or-cache fetch and HTTP-network fetch from §§4.6–4.7 over an
   injected streaming transport. First use a deterministic fake; then add the
   Undici dispatcher adapter with redirects and public Fetch objects disabled.
2. CORS-preflight fetch, its cache records, CORS check, and TAO check from
   §§4.8–4.11.
3. Function-based cancellation and streamed backpressure between the
   transport, Fetch controller, and Browlet Streams.
4. The public `fetch()` operation from §5.6, including local-abort timing,
   response filtering, realm-correct promises, and delivery on the target
   environment's responsible event loop.
5. The §5.7 garbage-collection requirements that are observably testable on
   Node, with nondeterministic collection limitations documented rather than
   hidden in timing-sensitive tests.
6. Request setup, invocation, response callbacks, and ongoing-fetch control
   from “Using fetch in other standards” for Browlet's loader.

Add a direct Undici runtime dependency only with this slice. Browlet's
supported Node floor is already 22.19 or newer, but the adapter still requires
version-specific conformance and cancellation/backpressure tests.

**Exit proof:** a basic HTTP(S) request through an injected transport produces
a Browlet `Response`, streams bytes with backpressure, resolves through an
explicit Fetch task destination, and aborts without leaking an Undici/Node
public object.

## Explicitly deferred work

These algorithms remain part of the audit and must not disappear, but they do
not gate the initial transport proof:

- Fetch §4.12 deferred fetching, its quota model, `fetchLater()`, and
  `FetchLaterResult` wait for their document-lifecycle and persistence owner.
- Full cookies, HTTP cache semantics, authentication UI, connection pooling,
  HSTS, network partitioning, and proxy/TLS policy wait for their owning host
  services.
- Service Worker interception waits for worker agents, events, and lifecycle.
- Complete Referrer Policy, CSP, Mixed Content, SRI, Reporting, CORP/COEP, and
  Resource Timing integration waits for those subsystems, while their Fetch
  call sites remain named and testable through host capabilities.
- `blob:` URL fetching waits for Blob/File and the object-URL store; `file:`
  fetching waits for an explicit embedder policy.
- WebSockets and WebTransport use Fetch infrastructure but are not part of the
  Fetch API delivery sequence.

## Verification policy

Each slice requires:

- internal tests for records and normative algorithms before projection;
- projected tests for Web IDL conversion, receiver checks, realm identity,
  exceptions, promises, and iterators when an interface is exposed;
- deterministic fake-host tests for task ordering, cancellation, policy, and
  transport behavior before using Node or Undici;
- focused WPT adoption once the corresponding complete interface family is
  exposed; and
- browser implementation comparisons as architectural evidence, with the
  Fetch Standard remaining authoritative unless an identified specification
  issue requires an explicit Browlet decision.

## Preflight plan

Complete these bounded prerequisites before beginning Fetch Slice 1. Keep each
step independently reviewable and committable; do not fold unrelated platform
work into a generic Fetch-foundations commit.

### Preflight 1 — MIME sniffing

**Status:** Complete in `src/mime`.

**Specification:** MIME Sniffing §§1–8.
**First Fetch consumers:** Fetch §§2.2.2, 2.10, 3.5–3.6, 5.3, and 6.

Implement:

1. The MIME type record: type, subtype, ordered parameters, and essence.
2. HTTP token and quoted-string collection required by MIME parsing.
3. MIME type parsing and serialization.
4. Parameter mutation and serialization behavior, including duplicate names,
   escaping, and invalid input.
5. The MIME group predicates required by Fetch.

Use the MIME Sniffing Standard as the owner. Fetch consumes the resulting
records and algorithms; it must not grow a private MIME parser.

**Required exit proof:** parser/serializer round trips, invalid input,
parameters, essence, and required group predicates agree with focused WPTs and
browser oracles.

The implementation continued through resource metadata, bounded resource
headers, byte-pattern matching, computed types, and context-specific sniffing.
Fetch should consume only the algorithms reached by its normative branches;
the completed surface does not make every loader policy a Fetch concern.

### Preflight 2 — parallel queue

**Status:** Complete in `src/shared/parallel-queue.ts`.

**Specification:** HTML §2.1.1, “Parallelism”.
**First Fetch consumers:** Fetch's opening §2 task-destination and
queue-a-fetch-task algorithms, followed by Fetch §2.2.4 body reading.

Implement:

1. A parallel queue with a FIFO queue of algorithm steps.
2. Enqueueing that schedules one serial drain without turning the specification
   model into a continuously running JavaScript loop.
3. An explicit host scheduling boundary; the parallel queue does not become an
   HTML event loop or use Node promise timing as HTML ordering.
4. Nonthrowing-step enforcement and deterministic handling of work enqueued
   during a drain.

Test FIFO ordering, a single active drain, reentrancy, newly enqueued work,
exceptions, and independence from Browlet's ordinary task queues.

**Exit proof:** Fetch can use one task-destination union for globals and
parallel queues, and queue-a-fetch-task preserves each destination's required
ordering.

### Preflight 3 — host-neutral origin operations

**Status:** Complete in `src/url/origin.ts` and `src/url/origin-api.ts`.

**Specification:** Fetch §§2.1 and 2.2.5, consuming URL and HTML origin
concepts.

Complete. Origin records, site types, comparisons, effective-domain handling,
and serialization live in `src/url/origin.ts`. The standalone `Origin`
implementation and declaration live beside them in `src/url/origin-api.ts`;
Browlet remains responsible only for selecting and exposing that declaration in
its assembled Web IDL environment. Browsing-context policy remains in Browlet.

**Exit proof:** `src/fetch` can compare and serialize origin records without
importing from `src/browlet`, and existing Browlet origin behavior continues to
use the same single implementation.

### Preflight completion audit

**Status:** Passed.

The audit verified:

- the MIME type core is executable from a host-neutral module;
- HTML parallel queues have a deterministic test host and no hidden Node
  scheduling dependency;
- Fetch can import all required URL/origin primitives without importing
  Browlet;
- Streams teeing and HTML structured cloning remain connected;
- DOM abort, High Resolution Time, global task destinations, and the networking
  task source remain available through explicit integration seams; and
- Infra forgiving Base64 is available from a host-neutral shared module.

Encoding, Blob/File, FormData, CSP, cookies, caches, Resource Timing, Referrer
Policy, and Service Workers remain assigned to their later first consumers
rather than being pulled into preflight.

The preflight is complete when these three changes are landed and the audit
passes. At that point begin Fetch Slice 1 even if the optional full MIME
Sniffing continuation has not been implemented.

## Removal condition

Burn this file once Fetch's records, APIs, algorithms, host contract, and
transport boundary are represented by implemented source or by narrower
roadmaps attached to the remaining external subsystems.
