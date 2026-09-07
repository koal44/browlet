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
first implemented source makes this boundary executable. The current
[dependency preflight](preflight.md) owns the detour's work order and suggested
layout; this roadmap resumes at Slice 1 after its independent prerequisites.

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
| [`http/`](http/roadmap.md) | HTTP syntax, extensions, and transactions; its [cache plan](http/cache/roadmap.md) owns caching detail | §§2.2–2.10, 3, and 4.4–4.11 |
| [`multipart/`](multipart/roadmap.md) | FormData byte encoding/parsing used by Body | §§5.2–5.3 |
| `integrity.ts` | SRI metadata and byte verification; see [the scoped plan below](#subresource-integrity) | §4.1 and SRI |
| `schemes/` | `about:`, `blob:`, `data:`, `file:`, and HTTP(S) scheme dispatch | §§4.3 and 6 |
| `fetch.ts` | Main Fetch orchestration, response-processing callbacks, task destinations, and ongoing-fetch control | §§4.1–4.2 and “Using fetch in other standards” |
| `transport.ts` | HTTP request/response bytes, streaming, cancellation, connection reuse, and TLS metadata without Fetch redirects or CORS policy | §§2.5–2.6 and 4.6–4.7 |
| `api.ts` | Realm-correct `Headers`, `Request`, `Response`, Body mixin, `fetch()`, and related promises | §5 |
| `web-idl.ts` | Lossless Fetch IDL contributions assembled by the active browser host | §5 |

## Dependency ledger

This is a first-consumer index. Detailed status, algorithms, tests, and
deferrals live with the linked owner. The [preflight](preflight.md) orders
the external dependency work and catalogs its specification sources.

| Dependency | First Fetch consumer | Owner / integration |
| --- | --- | --- |
| URL/origins/sites and Infra bytes/collections/Base64 | §§2.1–2.2 and 6 | Existing `src/url` and `src/infra` algorithms; reuse their IDNA/public-suffix delegation |
| DOM abort and HTML structured data | §2 controller state and §5 | Browlet's existing abort/serialization capabilities |
| Parallel queues and global task destinations | §2 task delivery | Existing `src/shared/parallel-queue.ts` and HTML task lifecycle |
| Streams, Encoding, and MIME | §§2.2.2–2.2.4 and 5 | Existing subsystem implementations; body processing and header-list integration remain Fetch-owned |
| Structured fields | §2.2.2 | [Structured fields](../struct-fields/roadmap.md) |
| HTTP syntax / Metadata headers | §2.2 / §4.6 | [HTTP](http/roadmap.md) |
| Blob/File bytes and Blob URLs | §§2.2.4, 5 / §4.3 | [File](../file/roadmap.md); shared keys come from [Storage](../storage/roadmap.md) |
| FormData / multipart | §§2.2.4 and 5.2–5.3 | Existing [XHR entry list](../xhr/roadmap.md); [multipart](multipart/roadmap.md) owns byte processing |
| UUIDs and cryptographic hashes | §2.2.5 / integrity checks | Narrow host primitives; a complete public Web Crypto API is not a prerequisite |
| HTTP cache | §2.2.6, §2.8, and §4.6 | [Cache](http/cache/roadmap.md) |
| Cookies | §3.1 | [Cookies](../cookies/roadmap.md); Fetch owns its request/response inputs |
| Trustworthiness, referrer, HSTS, and integrity policy | Request construction and §4 | [Browser policy](../browlet/browsing/policy/roadmap.md); SRI byte verification is scoped below |
| CSP / Mixed Content / Upgrade Insecure Requests | §4 | [Browser policy](../browlet/browsing/policy/roadmap.md) and its [CSP plan](../browlet/browsing/policy/csp/roadmap.md) |
| CORP / COEP | §§2.2.5 and 3.7 | CORP is Fetch-owned HTTP work; HTML supplies embedder-policy state and processing |
| Reporting | §3.7 and other policy checks | [Reporting](../browlet/reporting/roadmap.md) |
| Clocks / Resource and Navigation Timing | §2 records / §4 delivery | [Performance](../browlet/performance/roadmap.md#fetch-and-navigation-integration) |
| Service Workers, deferred fetch, Permissions Policy, BiDi | Their named call sites | See [deferred work](#explicitly-deferred-work) |
| HTTP transport and credentials | §§2.5–2.6 and 4.6–4.7 | Host services and [Slice 9](#slice-9--http-transport-cors-and-public-fetch) |

### Transport and reference boundaries

Undici is the planned dispatcher-level transport. Node/Undici supply sockets,
DNS, TCP/TLS, HTTP wire handling, connection primitives, and cancellation;
host codecs supply decompression. Fetch owns redirects, CORS, credentials,
partition selection, coding decisions, and encoded/decoded byte accounting.

Verify the selected adapter's protocol, TLS/client-certificate, timing, and
pool-isolation controls. For example, Fetch §4.7 rejects a source-less
streaming request body on HTTP/1.x even if a client can transmit it. A working
HTTP client alone does not prove Fetch transport conformance.

Supporting HTTP/TLS/ALPN/DNS/SVCB and RFC 9218 priority requirements belong at
their transport call sites. ABNF/RFC 7405 provide grammar notation, not a
requirement for a generic grammar-parser subsystem. Fetch §6 itself defines
`data:` processing; RFC 2397 is informative there. Historical references and
consumer specs such as WebSockets, WebTransport, XHR, and Beacon do not make
those entire protocols prerequisites for ordinary Fetch.

Two internal forward dependencies also need explicit ordering: §2.2.4's
bytes-as-body operation calls §5.2 safely extract, and §2.10 MIME blocking calls
§3.5 extract a MIME type. Implement those narrow dependencies with their first
consumers. The existing MIME parser does not perform Fetch's header-list
extraction algorithm. Multipart parsing also needs focused browser/WPT evidence:
Fetch §5.3 explicitly describes its RFC 7578 integration as incomplete.

## Slice 1 — control and task delivery

**Specification:** opening Fetch §2 through §2.1.

Implement parameters/controller state, timing and body-information records,
abort/termination and abort-reason serialization, and queue-a-fetch-task over
global and parallel-queue destinations. Then implement the URL scheme
predicates and offline-state contract from §2.1. Reuse HTML structured data,
High Resolution Time, URL records, and existing task primitives.

**Exit proof:** abort serialization/fallback, controller transitions, timing,
and deterministic task routing execute without transport or public Fetch APIs.

## Slice 2 — HTTP methods, headers, and statuses

**Specification:** Fetch §2.2 through §2.2.3.

Implement HTTP syntax, content-coding dispatch, methods, header lists,
normalization/combination/extraction, forbidden and safelisted header
algorithms, range handling, and status classifications in document order.
The [structured-field algorithms](../struct-fields/roadmap.md) must be
supplied before completing their header-list integration. Host codecs implement decompression; Fetch owns
the coding selection and failure behavior.

**Exit proof:** focused tests cover invalid bytes, duplicate headers,
`Set-Cookie`, range/safelist rules, structured fields, and coding failures;
public `Headers` projection remains in the API slice.

## Slice 3 — bodies and stream processing

**Specification:** Fetch §2.2.4.

Implement body records, clone/tee, incremental reading, and fully reading over
Browlet Streams and Fetch task delivery. Bring forward only the byte-sequence
path of §5.2 safely extract for the bytes-as-body algorithm; complete the
author-facing `BodyInit` union in the API slice.

**Exit proof:** body bytes, failures, and completion arrive in order at global
and parallel destinations, with correct tee and cancellation behavior.

## Slice 4 — requests and responses

**Specification:** Fetch §§2.2.5–2.2.7.

Implement request/response records, cloning, request-client/origin/policy
inputs, response filtering, network errors, location URLs, freshness
predicates, and the miscellaneous HTTP concepts. Reuse URL/site operations;
consume the [cache owner's freshness helpers](http/cache/roadmap.md).
Storing a policy field does not implement the later policy check.

**Exit proof:** record defaults, clone identity, filtered visibility, location
parsing, and freshness decisions pass without a network connection.

## Slice 5 — fetch groups and network infrastructure

**Specification:** Fetch §§2.3–2.10.

Implement authentication-entry records, fetch groups, domain/connection
contracts, partition keys, cache partitions, port blocking, and MIME blocking
in order. Bring forward §3.5 MIME extraction where §2.10 calls it. Preserve
fetch-group termination's call to §4.12 process deferred fetches, whose full
feature remains deferred. Network/storage effects require explicit host
contracts and deterministic fakes.

**Exit proof:** pure blocking/partition algorithms and fetch-group cancellation
work; each remaining network, storage, or deferred-fetch effect has an explicit
owner and completion gate.

## Slice 6 — network-independent platform APIs

**Specification:** Fetch §§5.1–5.5. This is the deliberate document-order
departure described above.

Implement:

1. `Headers` and its iterator from §5.1 over the existing header-list and guard
   algorithms.
2. The complete `XMLHttpRequestBodyInit` and `BodyInit` unions from §5.2,
   consuming the [multipart implementation](multipart/roadmap.md).
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

## Slice 7 — HTTP extensions

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

## Slice 8 — Fetch orchestration and local schemes

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

## Slice 9 — HTTP transport, CORS, and public fetch

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

## Subresource integrity

`integrity.ts` owns metadata parsing, strongest-supported-hash selection,
and byte verification from [Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/).
Read the framework/response-verification algorithms in local
`w3c-subresource-integrity/index.bs`; its path is relative to the
[reference root](preflight.md#local-reference-inventory).

**Status:** planned. Implement the independently testable metadata/digest
operations first, then connect response eligibility and actual body bytes
during main-fetch processing. Hashing uses a host cryptographic primitive.
The [browser policy owner](../browlet/browsing/policy/roadmap.md#integrity-policy)
separately owns Integrity-Policy parsing, container association, request
blocking, and reporting.

**Exit proof:** known byte/hash fixtures cover supported/unsupported and
malformed metadata, strongest-algorithm selection, matches, and mismatches.
Fetch integration tests must exercise response eligibility, actual consumed
bytes, and integrity failure delivery. Parsing a policy or hashing arbitrary
test bytes alone does not prove the response path.

## Explicitly deferred work

These are later consumers and integration gates. They do not prevent an
initial transport proof over an explicitly configured subset, but that proof
does not complete every Fetch branch.

- Fetch §4.12 deferred fetching, quotas, `fetchLater()`, and FetchLaterResult
  wait for the HTML lifecycle and Permissions Policy checks. §2.4 termination
  must retain its forward dependency; do not accept deferred records before
  their processing works.
- Service Worker interception waits for worker agents, events, and lifecycle.
  Ordinary requests with no applicable worker can use the no-worker path.
- WebDriver BiDi offline/emulation/interception hooks use their specified
  no-session paths until real automation exists. Sources for this and the
  preceding specs are in the [reference inventory](preflight.md#local-reference-inventory).
- HTTP authentication UI and additional challenge schemes wait for credential
  services and review of the supported schemes' RFCs. Connection pooling,
  proxy/TLS policy, and protocol support need verified host controls.
- Store, policy, and timing integrations close under their linked owners in
  the dependency ledger. Fetch-owned CORP remains in the HTTP slice; Metadata
  and trustworthiness are required for the corresponding outgoing headers.
- `blob:` URL fetching waits for the [File-owned store and lifetime integration](../file/roadmap.md#slice-4--blob-url-store-and-urlfetch-integration-deferred);
  existing Blob/File bytes are already available. `file:` fetching needs an
  explicit embedder policy.
- WebSockets, WebTransport, and unsupported transport protocols such as HTTP/3
  remain outside the initial Fetch API delivery sequence.

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

## Initial foundations

The original prerequisite work supplied MIME operations in `src/mime`,
parallel queues in `src/shared/parallel-queue.ts`, and host-neutral
origin/site operations in `src/url`. Their implementation contracts remain
with those owners. The [current dependency preflight](preflight.md) supersedes
the earlier three-item preflight; completing those foundations does not close
the remaining external dependencies.

## Removal condition

Burn this file once Fetch's records, APIs, algorithms, host contract, and
transport boundary are represented by implemented source or by narrower
roadmaps attached to the remaining external subsystems.
