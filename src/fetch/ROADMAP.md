# Fetch project roadmap

- **Complete:** [Slice 1 — control and task delivery](#slice-1--control-and-task-delivery).
- **Complete:** [Slice 2 — HTTP methods, headers, and statuses](#slice-2--http-methods-headers-and-statuses).
- **Complete:** [Slice 3 — bodies and stream processing](#slice-3--bodies-and-stream-processing).
- **Complete:** [Slice 4 — requests and responses](#slice-4--requests-and-responses), Fetch §§2.2.5–2.2.7.
- **Infrastructure implemented:** [Slice 5 — fetch groups and network infrastructure](#slice-5--fetch-groups-and-network-infrastructure); transport and response storage are connected in Slice 9. Deferred-fetch processing remains open.
- **Complete:** [Slice 6 — network-independent platform APIs](#slice-6--network-independent-platform-apis), including Request/Response construction and HTML's document-base-URL dependency.
- **Complete, HTML integrations provisional:** [Slice 7 — HTTP extensions](#slice-7--http-extensions); srcdoc ancestry and report generation retain their explicitly deferred integration hooks.
- **Complete, later dependencies provisional:** [Slice 8 — Fetch orchestration and local schemes](#slice-8--fetch-orchestration-and-local-schemes), including 8E data URL processing.
- **9A–9E implemented; HTML integrations provisional, audit pending:** [Slice 9 — HTTP transport, CORS, and public fetch](#slice-9--http-transport-cors-and-public-fetch). Public Fetch, Reporting, and the bounded HTML byte-loader path are tested. [9E](#9e--public-fetch-and-consumers) closes the upload-cancellation regression through lazy worker request preparation. Remaining Fetch algorithms, host dependencies, and callable-shape reviews are inventoried below.

This directory owns Browlet's host-neutral implementation of the
[Fetch Standard](https://fetch.spec.whatwg.org/). It owns Fetch records,
algorithms, and public API semantics. Browlet supplies browser-host state and
consumes the resulting responses. Raw HTTP connection management is a
transport capability, not Fetch policy.

Fetch must preserve the standard's record model even when a later consumer
only needs a small public surface. Undici can supply transport bytes, but its
`fetch`, `Headers`, `Request`, `Response`, streams, abort objects, and promises
must not cross Browlet's implementation or Web IDL boundaries.

This project contains multipart algorithms; reusable HTTP foundations and cache
rules live in the [HTTP project](../http/ROADMAP.md).
The network-independent API objects and public `fetch()` operation are implemented. The
[dependency preflight](PREFLIGHT.md) retains the remaining external work order.

`index.ts` exports the contracts consumed by production outside Fetch, including
task delivery, client settings, fetch groups, and browser-owned pools/partitions. Add exports with their real
consumers; focused tests may import internal algorithms without widening this
surface.

## Completion boundary and follow-up audit

The completion target is a reusable Fetch implementation for HTML and other
specification consumers, alongside the author-facing `fetch()`, Request,
Response, and Headers APIs. The internal entry is
`fetch(request, options, env) -> FetchController`. Consumers supply request
metadata and response-processing steps; Fetch supplies response headers,
streaming body bytes, progress/completion delivery, cancellation, redirect
continuation, and timing/body information. Content codings are decoded by
Fetch; choosing an HTML character encoding and constructing a Document belong
to HTML. Consumers must not recreate Fetch's HTTP, cache, CORS, or policy work.

**9E bounded closure (2026-09-25):** the no-worker path no longer splits an
upload, and its early-response cancellation regression passes. The HTML loader
also consumes a real Fetch response through provisional byte parsing and abort,
script-readiness, Link-header, and navigation-timing contracts. These have
limited behavior, marked in code and described under their HTML owners below;
they do not establish full HTML conformance. The synchronous source route is
still separate from network navigation.

**Remaining within Fetch:**

- Complete `FetchGroup.cancel()`: it is still a provisional no-op, unlike
  controller cancellation and the implemented non-keepalive `terminate()` path.
  HTML's cancellation rules require task/data disposal and keepalive handling.
- Implement §4.12 deferred fetching, its quotas/API, and pending group records
  when the HTML lifecycle and Permissions Policy dependencies are ready.
- Close transport-dependent branches: HTTPS DNS resource-record upgrades,
  proxy authentication, and additional protocols/schemes when their owners
  exist. Node currently supplies DNS/connection establishment; the older
  `resolveOrigin()`/`ConnectionPool.obtain()` helpers still throw for those
  effects and need reconciliation with the real transport during the audit.
- Review retained callable-shape markers in response cloning, preloaded
  responses, preflight/cache records, network fetch, and HTTP cache integration.
  The old complete-buffer content-coding helper also needs review against the
  streaming decoder now used by network fetch.

Service Worker dispatch, preloads, priority scheduling, BiDi sessions, supported
document MIME handlers, and public Performance entries remain owner integrations,
with explicit current behavior in the dependency ledger. They are not additional
implementations of Fetch's completed HTTP/cache/CORS algorithms.

TODO: After the bounded 9E review, audit Fetch in specification order across
separate turns: §2 records and infrastructure; §3 HTTP extensions; §4 fetching
and transport; then §§5-6 public APIs and data URLs. Check each algorithm's
actual consumers, observable behavior, tests, and retained markers. Record
coverage and stop for discussion at genuine gaps. Include an explicit inventory
of §4.12 and the other [deferred work](#explicitly-deferred-work), so closing
the current delivery sequence is not mistaken for implementing every feature
in the standard. Reconcile stale roadmap status with the implementation during
that audit rather than relying on completion labels alone.

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
| Cross-specification capabilities at their consumers | HTML serialization/task delivery, client state, clocks, policy, and storage supplied explicitly without a Browlet dependency; no combined host service bag | §2, 4, and “Using fetch in other standards” |
| `controller.ts`, `timing.ts`, `tasks.ts`, `environment.ts`, `url.ts` | Controller state, abort reasons, timing/body information, task delivery, offline-state inputs, integer serialization, and URL classifications | Opening §2 and §2.1 |
| `params.ts` | Fetch bookkeeping over the real request/response records and the controller | §2, “Infrastructure” |
| `headers.ts` | Header lists, parsing, normalization, extraction, guards, and forbidden/safelisted names | §§2.2.2, 3.3–3.8, and 5.1 |
| `body.ts` | Body records, stream extraction, cloning, consumption, and `BodyInit` conversion | §§2.2.4 and 5.2–5.3 |
| `request.ts` | Request records, cloning, policy inputs, destinations, and the `Request` implementation | §§2.2.5 and 5.4 |
| `response.ts` | Response records, filtered responses, cloning, network errors, and the `Response` implementation | §§2.2.6 and 5.5 |
| `policy/` | Cookie rules, Origin-header disclosure, COEP/CORP, Integrity Policy checks, mixed content, and request upgrades; Request/Response methods delegate here | §§3.1, 3.7, 4.1, and contributing policy specifications |
| [`http/`](http/ROADMAP.md) | Fetch-specific HTTP rules and transactions; its [cache plan](http/cache/ROADMAP.md) owns storage/validation over Fetch records | §§2.2–2.10, 3, and 4.4–4.11 |
| [`multipart/`](multipart/ROADMAP.md) | FormData byte encoding/parsing used by Body | §§5.2–5.3 |
| `integrity.ts` | SRI metadata and byte verification; see [the scoped plan below](#subresource-integrity) | §4.1 and SRI |
| `schemes/` | `about:`, `blob:`, `data:`, `file:`, and HTTP(S) scheme dispatch | §§4.3 and 6 |
| `fetch.ts` | Main Fetch orchestration, response-processing callbacks, task destinations, and ongoing-fetch control | §§4.1–4.2 and “Using fetch in other standards” |
| `transport.ts` | HTTP request/response bytes, streaming, cancellation, connection reuse, and TLS metadata without Fetch redirects or CORS policy | §§2.5–2.6 and 4.6–4.7 |
| Co-located API implementations and IDL in `headers.ts`, `body.ts`, `request.ts`, `response.ts` | Record ownership, Body composition, declaration signatures, and staged Browlet installation during Slice 6 | §§5.1–5.5 |
| `global.ts` | Public `fetch()` orchestration and abort handling, contributed to HTML's global-scope mixin | §5.6 |

Policy modules operate on the existing Fetch records and browser contracts.
They retain no separate request/response state. CSP's language, matching, and
list behavior stay with [Browlet's CSP implementation](../browlet/browsing/policy/csp/ROADMAP.md)
behind `FetchCSPList`; SRI metadata and byte verification remain in `integrity.ts`.

## Dependency ledger

This is a first-consumer index. Detailed status, algorithms, tests, and
deferrals live with the linked owner. The [preflight](PREFLIGHT.md) orders
the external dependency work and catalogs its specification sources.

| Dependency | First Fetch consumer | Owner / integration |
| --- | --- | --- |
| URL/origins/sites and Infra bytes/collections/Base64 | §§2.1–2.2 and 6 | Existing `src/url` and `src/infra` algorithms; reuse their IDNA/public-suffix delegation |
| DOM abort and HTML structured data | §2 controller state and §5 | Browlet's existing abort/serialization capabilities |
| Parallel queues and global task destinations | §2 task delivery | Existing `src/infra/parallel-queue.ts` and HTML task lifecycle |
| Streams, Encoding, and MIME | §§2.2.2–2.2.4 and 5 | Existing subsystem implementations; body processing and header-list integration remain Fetch-owned |
| Structured fields | §2.2.2 | [Structured fields](../http/struct-fields/README.md) |
| HTTP syntax / Metadata headers | §2.2 / §4.6 | [HTTP syntax](../http/ROADMAP.md); [Fetch Metadata](http/ROADMAP.md#fetch-metadata) |
| Blob/File bytes and Blob URLs | §§2.2.4, 5 / §4.3 | [File](../file/ROADMAP.md); shared keys come from [Storage](../storage/ROADMAP.md) |
| FormData / multipart | §§2.2.4 and 5.2–5.3 | Existing [XHR entry list](../xhr/ROADMAP.md); [multipart](multipart/ROADMAP.md) owns byte processing |
| UUIDs and cryptographic hashes | §2.2.5 / integrity checks | Narrow host primitives; a complete public Web Crypto API is not a prerequisite |
| HTTP cache | §2.2.6, §2.8, and §4.6 | [RFC cache rules](../http/cache/ROADMAP.md); [Fetch cache integration](http/cache/ROADMAP.md) |
| Cookies | §3.1 | [Cookies](../http/cookies/ROADMAP.md); Fetch owns its request/response inputs |
| Trustworthiness, referrer, HSTS, and integrity policy | Request construction and §4 | [Browser policy](../browlet/browsing/policy/ROADMAP.md); SRI byte verification is scoped below |
| CSP / Mixed Content / Upgrade Insecure Requests | §4 | [Browser policy](../browlet/browsing/policy/ROADMAP.md) and its [CSP plan](../browlet/browsing/policy/csp/ROADMAP.md) |
| CORP / COEP | §§2.2.5 and 3.7 | CORP is Fetch-owned HTTP work; HTML supplies embedder-policy state and processing |
| Reporting | §3.7 and other policy checks | [Reporting](../browlet/reporting/ROADMAP.md) |
| Clocks / Resource and Navigation Timing | §2 records / §4 delivery | [Performance](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration) |
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

**Specification:** the opening of Fetch §2, “Infrastructure,” followed by
§2.1, “URL.” Stop before §2.2, “HTTP.”

| Source portion | Implementation / boundary |
| --- | --- |
| §2 terminology, ABNF, credentials | Definitions for subsequent consumers, not separate runtime services |
| §2 fetch params | `params.ts`: request/response record references, typed callbacks, defaults, and aborted/canceled predicates |
| §2 fetch controller and its operations | `controller.ts`: state, reporting/redirect steps, abort/terminate, and serialized abort-reason restoration |
| §2 fetch timing info, response body info, opaque timing | `timing.ts`: defaults and opaque filtering; §2.6's connection timing **record only** is brought forward as a field dependency |
| §2 queue a fetch task | `tasks.ts`: existing `ParallelQueue` or the global networking-task capability |
| §2 is offline and serialize an integer | `environment.ts`: `FetchEnvironment` supplies its owning `FetchUserAgent`, which provides the scoped BiDi query; decimal serialization precedes §2.1 |
| §2.1 URL | `url.ts`: local, HTTP(S), and fetch scheme predicates over existing URL records |

**Status:** complete. The independent controller, timing, task, and URL work is implemented.
The source/target RealmExecution objects supply HTML structured serialization and
deserialization. Fetch retains serialization records opaquely;
`browlet/integration/execution.ts` realizes exception requests at serialization,
and `browlet/integration/fetch.ts` realizes fallback errors in the destination
realm and supplies global networking tasks. The controller takes no Binding Context.
The adapters are ready for Fetch orchestration; no public Fetch APIs are installed.

Timing records store DOMHighResTimeStamp values. Reading/coarsening clocks and
delivering performance entries remain at the later timing producers, using the
existing [Performance owner](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration).
Service Worker timing defaults to null; its shared data type records the six
fields supplied by Service Workers, whose execution remains deferred.
`isOffline(env)` reads the owning UserAgent's live offline assumption
before asking the same UserAgent for environment-scoped BiDi state. Browlet's base `Environment`
retains the UserAgent supplied during construction; Window setup receives the
target browsing-context group's owner, including across navigation.
Provisional integration: `UserAgent.assumeNoInternetConnectivity` defaults to
false; host connectivity detection is not wired yet. The UserAgent's
BiDi query receives the environment and follows the no-session path. Replace it with
navigable/user-context/session lookup
when automation owns network emulation. Worker settings and reserved navigation
environments must receive their owner's UserAgent when those paths are implemented.

**Exit proof:** abort serialization/fallback, controller transitions, timing,
and deterministic task routing execute without transport or public Fetch APIs.
Covered by `test/fetch/control.test.ts`,
`test/browlet/fetch-control.test.ts`, and the record tests below.

### Record and API spine

The records' fields, defaults, and shared references are established ahead of
their later algorithms. Classes supply defaults; unfinished operations throw
explicit errors. This is structural groundwork, not completed §§2.2 or 5 APIs.

| Construct | Representation and ownership |
| --- | --- |
| Header entry / header list (§2.2.2) | `Header` pair and `FetchHeaders`, owning an ordered array and unguarded list operations |
| Body (§2.2.4) | `FetchBody` with stream, source, and length; use existing Streams/File representations |
| Request / response (§§2.2.5–2.2.6) | `FetchRequest` / `FetchResponse` classes with actual fields and defaults; required inputs stay required |
| Fetch params (§2) | Record over those types, `FetchController`, timing info, task destination, and typed processing steps |
| Headers (§5.1) | `HeadersImpl` retains shared `FetchHeaders` and applies its own mutation guard |
| Body mixin (§5.3) | `BodyMixin` supplies shared body behavior over the includer's body; it must not create another body value |
| Request / Response (§§5.4–5.5) | `RequestImpl` / `ResponseImpl` retain their internal `FetchRequest` / `FetchResponse` and construct their Headers and Body mixin; Binding projects Headers in the receiver's realm; Request retains a supplied DOM signal reference |
| Unions, enums, dictionaries, callback signatures | Type aliases/record types; Web IDL owns author conversion and defaults |

Header lists retain their identity: mutate their entries rather than replacing
the list after an API object refers to it. Body reads through the includer's
record, so body replacement does not strand the mixin. Request URL/current URL
and response URL are derived from their URL lists. A request copies its initial
URL components while retaining any Blob URL entry reference.

**Remaining boundaries:**

- `client` retains the actual HTML settings object through
  `FetchEnvironment`; `reservedClient` uses `FetchEnvironmentRecord`.
  Traversable-for-prompts retains an opaque reference to the actual HTML
  traversable; policy containers use their owner's cloning operation.
  Further client-derived values and policy operations need narrow
  HTML capabilities in §4.1; these objects are not new Fetch-owned environments
  or policy containers. Clientless requests retain their owning UserAgent
  explicitly; do not synthesize an environment or assume online.
- Request retains a DOM signal through `AbortSignalCapability`.
  `RealmExecution.createDependentAbortSignal()` delegates to DOM's existing
  dependency graph, preserving abort-reason identity and event ordering.
  Fetch's constructor chooses the Headers guard (`request` or `request-no-cors`);
  cloning preserves it. These are not client-policy fields. Browlet supplies
  Referrer Policy's enum declaration; policy calculation/delivery remains later work.
- BodyInit extraction and Body consumption are implemented in Slice 6b. Author
  Request/Response construction and cloning are implemented in 6c, with its base-URL gate still open. Internal record cloning
  is implemented in Slice 4. Byte-sequence request bodies must be extracted before
  a Body API can expose their stream.
- `FilteredFetchResponse` provides a live restricted view of its internal
  record. Its specified overrides include a separate filtered header list;
  other fields, including body replacement and timing updates, remain shared.
- API IDL is co-located with the implementations and installed in Browlet.
  The public `fetch()` operation and transport remain uninstalled.

**Exit proof:** `test/fetch/state.test.ts` covers defaults, independent
mutable state, live URL/body references, shared Headers, allocation realm, and
FetchParams cancellation. Tests allocate implementations through the shared
Binding Context and check Headers identity and realm through borrowed getters.
Full API construction/conversion coverage belongs to Slice 6. Repeated setup
lives in `test/fetch/fetch-fixture.ts`.

## Slice 2 — HTTP methods, headers, and statuses

**Specification:** Fetch §2.2 through §2.2.3.

Implement HTTP syntax, methods, header lists,
normalization/combination/extraction, forbidden and safelisted header
algorithms, range handling, and status classifications in document order.
The [structured-field algorithms](../http/struct-fields/README.md) must be
supplied before completing their header-list integration.

**Status:** complete. Methods, header-list operations, quoted-string splitting,
validation/normalization, CORS and forbidden-header classifications, range
parsing, and statuses are implemented. Structured-field get/set operations use
the existing RFC 9651 parser and serializer; the interface methods and guards
remain in Slice 6.

`Set-Cookie` coverage here preserves separate lines in sort-and-combine and
classifies forbidden names. It does not parse cookies, maintain a cookie jar,
or claim browser response filtering; those belong to their later consumers.

Header-list extraction takes the field's parser and its single/multiple-line
rule explicitly. It implements absence, duplicate rejection, ordering, and
whole-field failure, returning undefined for absence and null for failure;
concrete field grammars join it at their consumers.
The default User-Agent selector takes the actual settings object, asks its
UserAgent for the environment-scoped BiDi override, and otherwise reads that owner's
configured default. Header values remain isomorphic strings, including an
explicit empty override. Browlet supplies the default; BiDi session lookup is
still provisional.
Range endpoints use BigInts to preserve decimal ordering above JavaScript's
safe-integer range, without inventing a smaller limit than the specification.

The HTTP quoted-string collector is shared with MIME, and HTTP token checks
are shared with MIME and cache parsing. Fetch's raw quoted-string return
wording says "inclusive", but its examples stop at the consumed closing quote;
the collector follows those examples and leaves the next delimiter unread.

**Structured-field setter edge cases:** Fetch does not spell out how to handle
the RFC serializer's omission/failure outcomes. Following RFC 9651 §4.1, setting
an empty List/Dictionary removes that named field. Serialization failure throws
before any list mutation; `TypeError` is our internal API's failure mapping.
The RFC's lower-level List serialization algorithm itself returns an empty
string for an empty list; omission belongs to the enclosing §4.1 operation.

- Chromium's [QUICHE serializer](https://github.com/google/quiche/blob/main/quiche/common/structured_headers.cc)
  returns an empty string for empty containers and nullopt on failure. Blink's
  [client-hint serializers](https://github.com/chromium/chromium/blob/main/third_party/blink/common/user_agent/user_agent_metadata.cc)
  can also turn failure into an empty string; this is field-specific behavior.
- Gecko's [SFV library](https://searchfox.org/firefox-main/source/third_party/rust/sfv/src/ref_serializer.rs)
  returns None for empty containers, explicitly citing RFC omission. Its
  [XPCOM adapter](https://searchfox.org/firefox-main/source/netwerk/base/http-sfv/src/lib.rs)
  surfaces that result as NS_ERROR_FAILURE.
- WebKit's [RFC8941 module](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/RFC8941.h)
  exposes parsing and string escaping, not a general List/Dictionary serializer
  or setter from which to infer this behavior.

These source observations from 2026-09-07 show different internal contracts,
not demonstrated differences in browser-visible setter behavior. No browser
runtime comparison was performed.

**Exit proof:** focused tests cover invalid bytes, duplicate headers,
`Set-Cookie`, range/safelist rules, structured fields, and extraction failures;
`test/fetch/headers.test.ts` and `test/fetch/http/concepts.test.ts` exercise these
operations, including header mutation over the real request record. Public
`Headers` projection remains in the API slice.

## Slice 3 — bodies and stream processing

**Specification:** Fetch §2.2.4.

**Status:** complete. `FetchBody` clones through Streams' tee operation and
supports incremental and full reads. Incremental reading copies each chunk
before queueing its Fetch task and begins the next read only after that task
processes the bytes. Full reads reuse Streams' read-all-bytes operation and
queue either the complete result or the failure, including reader acquisition
failure.

`FetchBody.fromBytes` brings forward only §5.2's internal byte-sequence path. It retains
the source/length and creates a byte-stream implementation, filled through supplied
parallel scheduling. `FetchBody` retains its `JSEnvironment` from construction
and forwards it when cloning. Its networking facilities supply HTML global
tasks and parallel execution; the read signatures keep the specified
callbacks and optional destination. An omitted destination starts a new parallel queue.

`handleContentCodings` accepts host decoders keyed by lowercase coding names.
It checks support for the entire list before decoding in reverse application
order, leaves unsupported lists unchanged, and maps decoding errors to failure.
Tests supply actual Node gzip, deflate, and Brotli codecs. The transport adapter
will choose its codec set and retain decoder state across network chunks in
§4.7; this slice proves decoding complete byte sequences.

The full `BodyInit` union and public Body mixin operations are implemented in Slice 6b.

**Exit proof:** `test/fetch/body.test.ts` covers tee identity, branch isolation
and cancellation, byte/BYOB extraction, global and parallel delivery, byte copies,
cross-realm chunks, read failures, and content codings. `test/browlet/fetch-body.test.ts`
proves delivery to the destination Window's networking task source and Document,
full-read completion through its microtask checkpoint, and HTML parallel scheduling.

## Slice 4 — requests and responses

**Specification:** Fetch §§2.2.5–2.2.7.

Implement request/response records, cloning, request-client/origin/policy
inputs, response filtering, network errors, location URLs, freshness
predicates, and the miscellaneous HTTP concepts. Reuse URL/site operations;
consume the [HTTP cache freshness helpers](../http/cache/ROADMAP.md).
Storing a policy field does not implement the later policy check.

**Status: complete (2026-09-19).** Request/destination classifications,
redirect-taint, origin serialization, request cloning, and Range-header addition
use the existing URL, header, and body algorithms. Cloning copies owned values
and lists, retains client/policy owner references, and generates a fresh WebDriver
ID. Raw byte bodies are copied before extraction; extracted bodies tee their streams.

Response algorithms cover reporting URLs, network errors, the four filtered
views, cloning, cache freshness, and Location parsing. An internal Proxy forwards
unmasked fields to the original response; basic/CORS headers are independently
filtered lists, matching Blink, Gecko, and WebKit. Opaque views retain the hidden
body for internal cloning without exposing it. Potential destinations and their
translation complete §2.2.7.

Freshness uses the existing HTTP cache calculations with explicit `CacheTiming`
from the future cache transaction. It does not introduce an ambient clock or
implement cache storage/revalidation. Location parsing follows the reviewed
header-extraction convention: undefined for absence, null for failure. That
return-type translation has been reviewed and accepted.

**COEP credentials check (2026-09-19):** implemented on `FetchRequest`, reading
the actual client's policy container through `FetchEnvironment`.
HTML's [`EmbedderPolicy`](../browlet/browsing/policy/coep.ts) now holds its four
specified fields and defaults. Tests cover policy/mode selection, same-origin credentials,
redirect suppression, and the live Document policy-container relationship.

[Fetch's current step 5](https://fetch.spec.whatwg.org/#cross-origin-embedder-policy-allows-credentials)
says redirect-taint is *not* `same-origin`; our implementation deliberately uses
*is* `same-origin`. The literal wording denies a same-origin request without
redirects and allows a return home after a foreign redirect. The original
untainted-origin check, WPT, and Chromium/Firefox probes support the correction.
Reported in [Fetch #1958](https://github.com/whatwg/fetch/issues/1958).
The retained experimental `fetch-credentials` probe and Scratch review preserve
the evidence, including WebKit's failing credential-omission control. HTML's
response-header processing, inheritance, and reporting remain unfinished, as
does invoking this predicate from network orchestration. A true result here
does not override the request's credentials mode.

**Exit proof:** `test/fetch/request.test.ts`, `response.test.ts`, and `state.test.ts`
cover record defaults, owner identity, independent clone data and streamed bytes,
filtered visibility and live field forwarding, reporting/Location URLs, freshness
boundaries, and destination translation without a network connection. The byte
copy regression includes Node buffers, whose `.slice()` would share storage.
Public API constructors and dependent AbortSignals remain in Slice 6.

## Slice 5 — fetch groups and network infrastructure

**Specification:** Fetch §§2.3–2.10.

Implement authentication-entry records, fetch groups, domain/connection
contracts, partition keys, cache partitions, port blocking, and MIME blocking
in order. Bring forward §3.5 MIME extraction where §2.10 calls it. Preserve
fetch-group termination's call to §4.12 process deferred fetches, whose full
feature remains deferred. Network/storage effects require explicit host
contracts and deterministic fakes.

**Status: infrastructure implemented (2026-09-19), with the effects below deferred.**
`http/authentication.ts` defines the shared username/password/realm
entry shape from §2.3. Credential storage, request associations, and clearing
remain with the later HTTP authentication integration. `group.ts` contains the
§2.4 records and ordinary termination. Each HTML environment settings object
owns its group directly, exposed through `FetchEnvironment`.
`FetchGroup` privately processes deferred fetches during termination. It skips
sent/aborted records and throws at pending processing, which still needs the Fetch entry algorithm and client-task
integration. It does not mark an unsent request sent or invoke its notification.
Automatic request registration and lifecycle termination calls remain with
their Fetch/HTML consumers. No deferred-fetch API is exposed.

`http/connections.ts` implements §2.5's direct IP and localhost resolution.
External origin resolution explicitly throws until the transport supplies that
effect. Resolution accepts a tuple origin (the origin kind with a host) and
represents returned addresses as an array, with null reserved for resolution
failure. That signature translation retains its pending-review marker.

Each UserAgent owns a `ConnectionPool`. §2.6 reuse compares partition keys,
origins, credentials, and the unreliable-transport requirement, while forced-new
settings bypass reuse. A cache miss or forced-new request explicitly throws:
proxy selection, DNS, connection establishment, certificate policy, ALPN, and
timing observations join through the Slice 9 transport. No socket is opened here.

`ConnectionTimingInfo.clampAndCoarsen()` hides reused-connection details and
directly imports Infra's `coarsenTime()` for new-connection timestamps.
Browlet supplies its existing High Resolution Time calculation; JS Engine
only declares the supplied facility. The accepted behavior preserves TLS start,
matching Blink, Gecko, and WebKit source. The specification currently uses
connection end there; the end-of-slice issue candidate remains in Scratch.

§2.7 derives keys from the actual HTML environment's top-level origin or
creation URL, preferring a request's reserved client over its client. The
implementation-defined second key is null. Equal sites share a key; opaque
origins retain their distinct identities. `reservedClient` now has the concrete
`FetchEnvironmentRecord` contract rather than `object`.

§2.8 selects browser-owned `HTTPCachePartition` identities using those keys.
A clientless request returns null. These objects do not yet store responses;
the signature's pending-review marker makes that partial representation explicit.
Storage, selection, validation, and transactions remain in the
[HTTP cache slice](http/cache/ROADMAP.md#implementation-order).

§§2.9–2.10 implement the complete bad-port table and script-like MIME blocking.
§3.5 MIME extraction is brought forward for that check, retaining its last-valid
Content-Type and same-essence charset rules. Main Fetch will invoke the blockers;
the separate nosniff check remains in Slice 7.

**Exit proof:** `test/fetch/group.test.ts` covers termination; the HTTP tests
cover resolution, connection reuse, partition identity, and blocking. Header
tests cover MIME extraction. `test/browlet/fetch-control.test.ts` proves actual
settings/UserAgent ownership, and `test/browlet/fetch-timing.test.ts` exercises
the composed runtime. Slice 9 connects transport and response storage, with
the cache acceptance dependencies recorded there. Pending deferred-fetch
processing remains an explicit completion gate.

## Slice 6 — network-independent platform APIs

**Specification:** Fetch §§5.1–5.5. This is the deliberate document-order
departure described above.

Work in three reviewable parts: **6a Headers**, **6b Body extraction and
consumption**, then **6c Request and Response**. These are subdivisions of
Slice 6, not new prerequisites for its first part.

**6a complete (2026-09-20):** Headers construction, mutation guards, reads,
Set-Cookie lists, and live sorted iteration are implemented and installed in
Browlet. Borrowed operations retain receiver-realm return allocation, matching
Chromium and Windows WebKit for `getSetCookie()`; Firefox uses the method realm.
The projection regression records our receiver-realm choice while Web IDL issues
[#135](https://github.com/whatwg/webidl/issues/135) and
[#371](https://github.com/whatwg/webidl/issues/371) remain unresolved.
Headers returns its string list through ordinary Web IDL conversion.
Allocation cleanup and the `allocateIn('receiver' | 'method')` declaration review
are complete.

**6b complete (2026-09-20):** `FetchBody.extract()` handles converted BodyInit
values; `fromBytes()` remains the internal byte-sequence path. Multipart extraction
captures the boundary, exact length, text, and File data without reading Files
synchronously. File and multipart streams share the existing bounded Blob-data reader.
`BodyMixin` implements all seven consumption methods, including incremental
`TextDecoderStream` decoding. Its owner supplies one JSEnvironment, whose exec includes
the relevant global; FormData owns entry creation. JSON uses a captured parse
intrinsic from that runtime's realm. Body completion targets the receiver's HTML
networking tasks even when the stream belongs to another realm.

The new multipart integration tests exposed two corrected gaps: parsing errors
needed realm-neutral exception requests, and borrowed iterators needed the
collection's binding owner when first projecting File values. Iterator result
allocation retains its existing method-realm behavior. Chromium 149, Firefox 151,
and Windows WebKit 26.5 confirmed File ownership for borrowed FormData iteration.

Coverage is in `test/fetch/body-init.test.ts`, `body-consumption.test.ts`,
`test/browlet/fetch-body.test.ts`, and `test/web-idl/iterable.test.ts`.
All six unit configurations pass: Node 24.19.0, 26.8.1, and the custom build,
each with stock and compatibility runtimes. The 9,708 cases include 81 new
passing cases; existing expected failures/skips are unchanged. Typecheck and lint pass.
**6c complete:** Request/Response author constructors,
static factories, cloning, dependent AbortSignals, and the ReferrerPolicy enum
are installed in Browlet. Binding supplies the constructor's actual HTML settings
object; Request retains that client. Response.redirect receives its API base URL.
The constructor's explicit settings dependency has been reviewed; the redirect
factory's base-URL argument retains its callable-shape marker. Internal priority
updates use a narrow `update(priority)` contract; network scheduling will supply
its implementation.

`new Request(existing)` proxies the input body and disturbs/locks its stream;
`clone()` tees it. Copied bodies/signals use the new constructor's runtime;
borrowed clones retain the receiver's runtime. JSON serialization uses the
factory realm's captured intrinsic. Byte-backed bodies now deliver through an
owning-global networking task, as Blob data already does through file-reading
tasks. Direct delivery from parallel Node work left tee/proxy reactions queued
without an HTML checkpoint; the new constructor tests reproduced those timeouts.

Coverage is in `test/browlet/fetch-request.test.ts`, `fetch-response.test.ts`,
and the existing body tests. Chromium 149, Firefox 151, and Windows WebKit 26.5
agree on input consumption, cloned body contents, dependent-signal ordering,
and clone/factory realms. Firefox's tested build does not expose Request.body;
stream identity/locking was checked in Chromium and Windows WebKit.

The HTML base-URL gate is complete
([element roadmap](../browlet/html/elements/ROADMAP.md)). Settings read the
document's base URL record directly, and the original Request failure now passes.
Coverage includes base mutations and borrowed Response.redirect factories;
Fetch contains no duplicate base-element selection rules. CSP `base-uri`
enforcement remains pending with CSP. Resume with Slice 7's HTTP extensions.

Validation: all 9,798 unit cases ran on Node 24.19.0, 26.8.1, and the custom
build, each with stock and compatibility runtimes, with no ordinary failures.
Existing expected failures/skips are unchanged. Typecheck and changed-file lint pass.

Implement:

1. `Headers` and its iterator from §5.1 over the existing header-list and guard
   algorithms.
2. The complete `XMLHttpRequestBodyInit` and `BodyInit` unions from §5.2,
   consuming the [multipart implementation](multipart/ROADMAP.md).
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

- [x] **Multipart File realm ownership:** exercise `Request.formData()` and
  `Response.formData()` with multipart bodies. The parser receives the consuming
  runtime and constructs `FileImpl` values with it; integration must give the
  FormData and its Files the producing Request/Response's realm. Verify first File exposure through
  `get()`, `getAll()`, and iteration, including methods borrowed from another
  realm, and stable File identity across repeated access. This replaces the
  parser's early-origin test; byte-parser tests do not prove this integration.

## Slice 7 — HTTP extensions

**Specification:** Fetch §§3.1–3.8.

Return to document order and implement:

1. Cookie header integration from §3.1, using the cookie subsystem's parsing,
   storage, and retrieval, with browser policy supplied by Browlet.
2. Origin-header serialization and referrer-policy integration from §3.2.
3. CORS protocol definitions and new-header syntax from §3.3, using §2's
   safelists. The actual CORS/preflight checks are in §§4.8–4.10, implemented
   with their network callers in Slice 9.
4. `Content-Length`, MIME extraction for `Content-Type`, `nosniff`, CORP, and
   `Sec-Purpose` behavior from §§3.4–3.8.

Work in three parts: **7a cookie headers (§3.1)**, **7b Origin and Referrer
Policy (§3.2)**, then **7c CORS and remaining header protocols (§§3.3–3.8)**.

**7a complete:** `FetchRequest.appendCookieHeader()` and
`FetchResponse.parseAndStoreCookies(request)` consume the real UserAgent-owned
store and its `cookiesEnabled` setting. Each request receives its owning user
agent at construction, including clientless requests; cloning preserves that
owner. Response cookie processing uses the request's owner. HTML Window settings
now supply a live cross-site-ancestor answer from the navigable chain. A
Document without a current navigable cannot establish a same-site cookie
context. The tests compose real Window settings and navigables; iframe loading
and Worker lifecycle are still separate HTML work.

The reviewed browser model replaces §3.1's contradictory SameSite branches:
same-site requests permit Strict; cross-site top-level safe-method navigations
permit Lax; other cross-site requests permit only None. An unset SameSite acts
as Lax, with Chromium's two-minute creation-age exception for unsafe top-level
navigations. The store applies this age limit before updating access times;
replacing a cookie does not restart the window. Top-level navigation responses
may store Strict/Lax cookies independently of what their requests could send.
Clientless subresources remain cross-site; a null navigation initiator means
browser initiation. Follow Chromium's default redirect policy: compare the
current target, without retaining cross-site taint from earlier hops. A fresh
A-to-B-to-A navigation/fetch probe confirmed that Chromium sends Strict again
on return to A; Firefox keeps it restricted. Chromium's full-chain check is
behind the disabled-by-default `CookieSameSiteConsidersRedirectChain` feature.
See the [cookie policy and source comparison](../http/cookies/ROADMAP.md#implementation-order).

The default policy permits third-party cookies only as allowed by SameSite;
blanket third-party blocking, tracking exceptions, session-only controls, and
partitioned cookies are not added here. Disabling cookies suppresses both
header algorithms while preserving existing stored cookies.

The serialized-cookie-default-path algorithm reuses HTTP's default-path rule
and URL path serialization without mutating the input. Focused coverage is in
`test/fetch/http/cookies.test.ts` and `test/browlet/scripting/environment.test.ts`.
Slice 9 must invoke these algorithms at the HTTP network boundary after its
credentials decision; completing 7a does not imply network requests or
`document.cookie` are implemented.

Validation: all 9,839 unit cases pass with the existing expected failures/skips
on Node 24.19.0, 26.8.1, and the custom build, each in stock and compatibility
mode. Typecheck and changed-file lint pass. Concurrent full-suite runs exceeded
the declaration-contract test's five-second limit; run the variant matrix
sequentially rather than increasing that timeout.

Use pure deterministic tests for header and CORS algorithms. Policy-owned
questions must call named host capabilities so the default no-policy test host
is explicit and replaceable.

**7b complete, iframe integration provisional:** `FetchRequest.appendOriginHeader()` implements §3.2 using
the existing origin serialization and redirect taint. CORS-tainted responses,
WebSocket, and WebTransport requests disclose the serialized origin; other
non-GET/HEAD requests apply the specified referrer-policy restrictions.
Origin's downgrade check is explicitly HTTPS-to-non-HTTPS, including HTTP
loopback targets; it is not Referrer Policy's potentially-trustworthy-URL check.

The browser policy owner implements Referrer Policy §§8.1–8.4: parse response
headers, update a request's policy on redirect, select the referrer, and strip
URLs for disclosure. Parsing accepts the last
recognized token, ignores well-formed extension tokens, and rejects the entire
header list value on malformed syntax. This follows the grammar and Chromium;
Gecko/WebKit instead retain recognized policies alongside malformed tokens.
Absent, unrecognized, or malformed headers leave the existing redirect policy
unchanged. Coverage is in `test/fetch/http/origin.test.ts` and
`test/browlet/browsing/policy/referrer-policy.test.ts`.

Window settings expose `getReferrerSource()`: the live Document URL for ordinary
Windows, no referrer for an opaque-origin Document, and the container Document
chain for srcdoc. Other settings use their creation URL. Selection applies all
eight policies, the 4096-character limit, and the request owner's trustworthiness
rules, including loopback and configured trusted origins. URL stripping copies
the source so full and origin-only results cannot mutate each other or the Document.

Per Eric's decision, the missing iframe relationship is provisional rather than
a gate on the remaining policy code. `Navigable.container` currently returns
null; child-navigable creation/destruction must supply the real element. The
srcdoc branch throws if that required relationship is absent, and the expected
failure in `test/browlet/scripting/environment.test.ts` requests the embedding
Document's referrer through a loaded iframe. It currently fails because the
iframe has no content Document. When HTML implements that lifecycle, remove
the provisional accessor and expected-failure designation, then cover nested
srcdoc and containers retained in an inactive predecessor Document. Do not
substitute the API base URL or `parent.activeDocument`.

Main-fetch and HTTP-redirect callers remain in Slices 8–9, including resolving
an empty request policy before referrer calculation. Element/response policy
delivery remains with HTML's loaders.

Validation: the full unit suite passes on all six Node configurations, with
the authorized srcdoc expected failure and existing expected failures/skips.
Typecheck and lint pass.

**7c complete, outbound Reporting delivery still pending:**

- §3.3's CORS response token-list grammar supplies header-list extraction for
  Allow-Methods, Allow-Headers, and Expose-Headers. It preserves case and `*`
  for the later consumer, ignores empty list members, and rejects the whole
  extraction on malformed syntax. Max-Age uses HTTP's existing delta-seconds
  parser. Credentials and wildcard interpretation, Allow-Origin comparison,
  and preflight/cache integration remain at their §4 algorithms in Slice 9.
- §3.4 Content-Length extraction distinguishes unavailable/unusable values
  (`undefined`) from conflicting field values (`null`), and returns `bigint`
  without rounding. Repeated values must match as strings before numeric
  interpretation. The return mapping has been reviewed and accepted.
- §3.5 MIME extraction already existed. Legacy encoding extraction now uses
  the selected charset with Encoding's label lookup and the caller's fallback.
- §3.6 determines nosniff from the first field value and enforces JavaScript
  and CSS MIME types for script-like and style destinations respectively.
- §3.7's CORP internal check handles exact field values, duplicate/invalid
  fields, same-origin and schemeless same-site comparisons, the HTTPS rule,
  credentialless, and nested navigation. Policy comparison uses the final URL.
  Per Eric's reviewed choice, it reuses HTML's site algorithm in URL, including
  same-IP/different-port cases. A real-navigation probe confirms that Firefox
  151 and Playwright Windows WebKit 26.5 allow this case; Chromium 149 blocks it.
- §3.8's `Sec-Purpose: prefetch` uses the existing structured-field token
  serializer/parser. Setting it belongs to the later HTML prefetch caller.

The outer check and report-producing method live in `response.ts`.
`isBlockedByCORP()` and `isBlockedByCORPInternal()` return true for blocking;
`queueCORPViolationReport()` submits the selected endpoint and report body
through `settings.queueReport()`. Fetch's contract exposes HTML's existing
enforcing and report-only policy fields. The settings method now reaches actual
Window report generation, queues, and observers. The
[Reporting roadmap](../browlet/reporting/ROADMAP.md) retains destruction integration
and outbound delivery; `test/browlet/reporting/observers.test.ts` exercises the
real COEP and Integrity Policy submission paths.

Focused coverage is in `test/fetch/headers.test.ts`,
`test/fetch/http/blocking.test.ts`, and `test/fetch/http/corp.test.ts`.
The focused tests supply the Reporting capability to verify Fetch's decision,
report-only/enforcing behavior, endpoint selection, ordering, and URL stripping.
The six Node variants, typecheck, and repository-wide lint cover the completed
contracts; passing them does not establish outbound Reporting delivery.

**Exit proof:** every Fetch §3 header protocol and check is either executable
or stops at a named external-policy/storage capability with its inputs fully
formed.

## Slice 8 — Fetch orchestration and local schemes

**Specification:** Fetch §4–§4.5 and §6.

Client population connects the prompt target to its actual HTML traversable.
The field uses `FetchPromptTarget | null | undefined`: undefined defers selection,
null suppresses prompts, and a value retains the traversable by identity. A
type-only brand excludes ordinary navigables without adding runtime state. Fetch
defines a traversable navigable but its Request constructor still tests for an
environment settings object; the accepted provisional copy rule is described below.
Chromium retains an opaque window identifier and documents a partial constructor
implementation, so copying its code alone does not settle the mismatch. See
`scratch/SPEC-ISSUES.md` for the source comparison.
Keep the initiating origin distinct from the target's active document origin:
a cross-origin iframe's requests can use its top-level traversable for prompts.

Keep five subdivisions; 8A already includes substantial setup, policy ordering,
response filtering, body completion, and task delivery. The later subdivisions
have separate callers and dependency fronts.

Implement in order:

- **8A — Entry and main-fetch processing.** The Fetch entry algorithm and
  main-fetch response processing from the opening of §4 and §4.1, preserving
  CSP, Mixed Content, upgrade, Service Worker, response-blocking, and timing
  calls as explicit dependencies of their owning subsystems.
- **8B — Override fetch.** §4.2's embedder/test seam, without a global mutable
  shortcut.
- **8C — Scheme fetch.** §4.3's branches whose dependencies exist.
- **8D — HTTP fetch and redirects.** §§4.4–4.5, with transport and cache work
  still delegated by contract.
- **8E — Data URLs.** §6's processor, then close the `data:` branch left in
  scheme fetch. Use the MIME parser and project-owned byte/base64 operations.

**8A complete, with the recorded later-subsystem hooks provisional:** `FetchRequest.populateFromClient()` preserves
supplied fields and resolves deferred fields once. HTML settings select the real
traversable; HTML's policy container owns cloning, and the UserAgent supplies
default containers for clientless requests. Integration tests cover these paths
with real settings and traversables, including a cross-origin child Window.
`fetch.ts` now contains the entry algorithm and returns its controller.
`FetchParams.mainFetch()` supplies policy ordering, response selection/filtering,
SRI verification, and handover, including body-end and consumption callbacks.
It replaces the entry no-op; policy-blocked, preload, and overridden-response
paths can complete. 8C supplies local-scheme dispatch, 8D HTTP/redirect
orchestration, and 8E data URL processing.
Tests control the provisional owner operations and later HTTP stages,
while using real Window environments, policies, streams, bindings, and running
HTML event loops. They do not demonstrate actual network delivery.

The accepted provisional Request-constructor rule preserves a selected target
only when the source request's resolved origin matches the new environment.
An unresolved or cross-origin source defers selection. A traversable has no origin;
its current Document's origin is not used for this check. The specification's
old environment-object wording remains an upstream issue to resolve.

Policy cloning covers implemented COEP/referrer state, both Integrity Policies,
populated CSP lists, and independent default containers. CSP copying preserves
the list-level `self-origin` while independently copying directive data; tests
exercise that behavior through client population. A default container can have
no CSP list; every constructed list requires its origin. CSP parsing, source
matching, Window violations, and hash reporting are implemented through
[CSP slice C](../browlet/browsing/policy/csp/ROADMAP.md). The independent preflight
detour and entry/main-fetch integration are complete.
Both Integrity Policies now copy independently, following Gecko despite HTML's
report-only omission. Remaining policy models and delivery belong to their
policy owners, rather than requiring new Fetch wiring.

### 8A dependency review

The shared clock, time-origin conversion, Referrer Policy, and preflight policy
algorithms are connected. Background continuations use the UserAgent's existing
`hostPromises` and background scheduler. Before touching realm-owned Streams,
main fetch queues a networking task to the supplied execution owner. Processing
callbacks still select their prescribed global or parallel queue. Compatibility
addon tests exercise this without test-side microtask checkpoints.

The following owner operations are provisional. Each stub identifies its
missing subsystem:

| Consumer | Intended owner operation | Work still required |
| --- | --- | --- |
| [Fetch entry](fetch.ts) | `client.consumePreloadedResource(...)` | Returns a miss until HTML has a Document preload map, request-key matching, integrity checks, and deferred response notification. |
| [Fetch entry](fetch.ts) | UserAgent's BiDi body/language hooks, `defaultAcceptLanguage`, `determineFetchPriority(request)` | BiDi hooks are inert without sessions. Configured language is used, with no header when null. Priority returns an inert update handle until Slice 9 has a transport scheduler; no numeric priority or locale is invented. |
| [Main fetch](params.ts) | `userAgent.corsPreflightCache.clearEntries(request)` | 9D supplies lookup, storage, expiration, credentials matching, and invalidation after a failed preflighted fetch. Wildcard expansion is restricted to noncredentialed requests. |
| [Response handover](params.ts) | UserAgent's BiDi fetch-error/response-completed hooks | No-ops until network instrumentation has sessions to notify. |
| [Timing handover](params.ts) | `userAgent.supportsMIMEType(type)`, `env.markResourceTiming(...)` | Support defaults false outside MIME Sniffing's independently minimized types. Recording is a no-op pending the [Performance Timeline/Resource Timing foundation](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration). |

`FetchParams` retains the explicit `JSEnvironment` used for body allocation;
this is separate from the nullable initiating client and callback destination.
Clientless Reporting uploads use `UserAgent.sandbox`, a lazily created execution
environment with its own Realm and running Agent. It needs neither a Window nor
an HTML settings object. Requests retain their original origin and null client.

The [Reporting execution-owner review](../browlet/reporting/ROADMAP.md#c-delivery-serialization-and-retirement)
compares Gecko's sandbox with Chromium/WebKit's native upload paths. Browlet's
sandbox reuses existing Streams and the main binding world. Integration tests
destroy the generating Document before dispatch and while waiting for a response,
then complete delivery through the real Fetch entry and handover without manual
checkpoints. Only the later network-dispatch stage is controlled.

Validation: focused Fetch/Reporting/CSP/scripting coverage passes 1,326 tests on
custom Node with the compatibility addon, plus two existing expected failures.
The 64 sandbox, Reporting delivery, and Fetch orchestration tests also pass on
stock Node 26.8.1.

A pending preload is an internal Promise rather than a string requiring polling;
that representation remains marked for review. The accepted `reportTiming()`
shape takes the selected global's environment for its time origin and timing
owner. Main-fetch's Promise represents internal waiting, not the public Fetch API.

HTTPS DNS-record upgrades remain at connection establishment in Slice 9, as
Fetch expressly permits. Transport must also disregard later body enqueues after
main fetch removes a HEAD/CONNECT/null-status body. HSTS and request policies are
already invoked at their prescribed main-fetch stages.

Mixed Content's independent request/response blocking checks are available on
`FetchRequest` and `FetchResponse`, using the client's browser-owned ancestor
classification. Call `request.upgradeInsecureRequest()` followed by
`request.upgradeMixedContent()` after monitored CSP reporting and before
request blocking. Both rewrite the current URL; the former also sets the
navigation preference header. The [policy roadmap](../browlet/browsing/policy/ROADMAP.md#mixed-content-and-upgrade-insecure-requests)
records the reviewed browser/spec choices and consumer inputs. Fill
the internal response URL list before its mixed-content check. Preserve this
ordering on redirect re-entry. A failed HTTPS upgrade never retries HTTP.

CSP provides `request.reportCSPViolations()` for the pre-upgrade monitored pass,
`request.isBlockedByCSP()` for post-upgrade enforcement, and
`response.isBlockedByCSP(request)` for the received internal response. The last
pass checks both dispositions and the response's URL. Run it after filling the
response URL list. These use the request's cloned policy container and its
retained self origin, without importing the browser's CSP implementation.
CSP's Window event and report-generation dependencies are implemented; actual
network report delivery will use the Fetch entry and transport algorithms.

HSTS's independent algorithms are implemented. Main fetch calls
`request.upgradeForHSTS()` after referrer selection and before dispatch, including
on recursive redirect re-entry when 8D supplies that caller. It uses the request's UserAgent store and exempts localhost
and its subdomains as required by Fetch. Do not move this step into Request
construction. The sibling DNS HTTPS-record upgrade condition still depends on
DNS/transport support; the HSTS method does not stand in for that condition.

The Blob URL preflight now supplies URL parsing, captured entry retention,
and `FetchUserAgent.obtainBlobObject()` for authorized acquisition. 8C now
consumes `request.currentURL.blobURLEntry` instead of resolving the URL again;
revocation must not invalidate an entry already captured by Request parsing.
Scheme fetch selects the reserved/client environment or the specified top-level
exemption, then constructs the response, headers, and range body. The reviewed
clientless-access precondition is recorded below.

Scheme fetch implements `about:blank` and uses Fetch's permitted network-error
result for `file:`. File-scheme support remains an embedder policy.

### 8B — Override fetch

**Complete:** `FetchParams.overrideFetch(type, makeCORSPreflight)` consults the
request's own `UserAgent.potentiallyOverrideResponse(request, env)` before
dispatch. The UserAgent implements Fetch's specified default, returning null.
An implementation can supply a concrete response, including a network error;
otherwise the same FetchParams continues into `schemeFetch()` or
`httpFetch(makeCORSPreflight)`. The environment supplies body execution for an
override without inventing a client for browser-owned requests. There is no
process-wide override callback, and this hook does not replace Service Worker
or WebDriver BiDi interception at their own prescribed stages.

The result uses `InternalPromise<FetchResponse>` to carry downstream completion.
Its continuations use UserAgent's host Promise destination; main fetch still
enters the body owner's networking task before processing the result. The
Promise return shape is accepted, including recursive main fetch and downstream
scheme/HTTP fetch. Internal dispatch labels use `scheme-fetch` and `http-fetch`;
their spelling has no protocol or author-visible effect.

Coverage in `test/browlet/fetch-override.test.ts` checks default fallthrough,
scheme/HTTP selection, preflight forwarding, supplied responses/network errors,
UserAgent isolation, failure propagation, and main-fetch filtering, blocking,
and body consumption. Existing orchestration and Reporting handoff tests now
exercise real override fetch while controlling only the later scheme/HTTP work.

### 8C — Scheme fetch

**Complete:** `FetchParams.schemeFetch()`
checks cancellation, dispatches the current URL, constructs `about:blank`'s
empty HTML body, delegates Blob handling to `schemes/blob.ts`, and dispatches
HTTP(S) directly to HTTP fetch. Other about URLs, file URLs, and unsupported
schemes return network errors. 8D supplies the HTTP-fetch consumer algorithm;
8E supplies `schemes/data.ts`'s processor and completes the data branch's
MIME/header/body integration.

Blob handling enforces GET, uses the captured registration without another
lookup, selects the reserved environment before the client, and honors the
top-level navigation and exact-creation-URL self-fetch exemptions. HTML supplies
`env.isTopLevelWindow` from the Window's actual navigable. A missing navigable
or a nested navigable does not qualify. Full responses and single ranges retain
Blob data; decimal range calculations stay in BigInt until bounded slicing.

Reviewed access contract and range choice:

- **`SPEC_CLASH(blob-clientless-access-context)`:** determining the environment
  can return null, but File API requires an environment or explicit exemption.
  Eric approved an `InternalError` for ordinary Blob access without either.
  The nullable Fetch type remains correct; a future browser-owned Blob consumer
  must supply authorization explicitly. Chromium binds storage keys to its
  Blob service, Gecko retains security principals independently of a client,
  and WebKit distinguishes DOM loads from embedding API loads. Do not substitute
  the creator's environment or the execution sandbox. Clientless top-level
  navigation retains its exemption, and reserved environments remain usable.
  Unlike CORP's retained policy, the request has no retained storage-partition
  context. Its origin alone is not an authorization input to File API's check.
  The regression first failed with a null dereference; all 50 scheme tests pass.
- **`SPEC_CLASH(blob-suffix-range-bounds)`:** the draft subtracts an oversized
  suffix from the full length, producing a negative range start; zero suffixes
  and empty resources can also produce inverted bounds. Chromium/WebKit clamp
  oversized suffixes to the whole resource; Gecko's checked range rejects them.
  The accepted behavior clamps oversized suffixes to the whole Blob and rejects
  zero-length suffixes and ranges on empty Blobs. Source evidence is in
  `scratch/SPEC-ISSUES.md`.

The focused BodyInit regression first demonstrated that Blob extraction created
its stream on the Blob creator's environment. Extraction now streams the same
retained data on the supplied Fetch environment. An integration regression
destroys the creator Document on its HTML task, confirms registration cleanup,
then reads an already-captured entry through the browser sandbox. Ordinary
Window Fetch also filters and consumes Blob ranges through its automatic loop.

Coverage in `test/browlet/fetch-schemes.test.ts` includes local scheme responses,
cancellation, current-URL dispatch, HTTP delegation, revocation, partitions,
reserved clients, top-level exemptions, range syntax/bytes/headers, and lifetime.

### 8D — HTTP fetch and redirects

**Consumer algorithms complete; dependencies provisional.**
`FetchParams.httpFetch()` offers a cloned request to Service Workers,
validates intercepted responses, selects preflight from cached permissions,
delegates network/cache work, applies CORS/TAO/CORP checks, and handles redirect
modes. `httpRedirectFetch()` resolves Location, checks scheme/credentials/count,
rewrites methods and body headers, removes cross-origin Authorization, replays
retained bodies, updates timing and Referrer Policy, and re-enters main fetch.
Manual navigations install the controller continuation and restart nonrecursive
main fetch; other manual requests receive an opaque-redirect response.

The future-owner calls now have explicit provisional implementations:

| Call | Owner and remaining work |
| --- | --- |
| `userAgent.handleFetch(request, controller, isolated, prepareRequest)` | Returns a host-owned Promise of null without preparing a copy: no registrations or active workers exist. Service Workers later supplies selection, lazy preparation, timing, and response delivery through this entry. |
| `userAgent.webDriverBiDiResponseStarted(request, response)` | No-op until BiDi sessions exist, alongside the other UserAgent hooks. |
| `corsPreflightCache.matchesMethod()` / `matchesHeaderName()` | 9D supplies §4.9 permissions, including partition, origin, credentials, expiry, and the approved wildcard restriction. |
| `params.corsPreflightFetch()` / `httpNetworkOrCacheFetch()` | 9D connects preflight transactions and cached permissions. 9B supplies HTTP transactions and Basic authentication; 9C supplies cache transactions, including background completion through 9D's TAO check. |
| `response.isBlockedByCORS(request)` / `isTimingAllowed(request)` | 9D supplies §§4.10–4.11 in Fetch's policy modules, including navigation timing permission. |

**`SPEC_CLASH(corp-clientless-policy)`:** [Fetch's guidance for background consumers](https://fetch.spec.whatwg.org/#fetch-elsewhere-request)
explicitly permits a null client with retained origin and policy-container state,
but HTTP fetch passes that nullable client to a CORP algorithm requiring settings.
The reviewed implementation supplies the embedder policy separately from the
nullable reporting environment. HTTP fetch selects the client's live policy when
present, otherwise the request's already-populated policy container. Explicit
CORP restrictions and enforced COEP remain effective without a client; violations
are reported only when a reporting environment exists. No reporting recipient or
partition authority is inferred from the execution sandbox.

Browser evidence separates enforcement inputs from live reporting machinery:
[Chromium's CORP checker](https://chromium.googlesource.com/chromium/src/+/main/services/network/public/cpp/cross_origin_resource_policy.cc)
takes an initiator, embedder policy, and optional reporter; Gecko's
`dom/fetch/FetchDriver.cpp` creates a channel without a Document or client info
while retaining its principal and copying `InternalRequest`'s embedder policy;
[WebKit's network checker](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/NetworkProcess/NetworkLoadChecker.cpp)
also enforces policy independently of its optional reporting loader. Chromium's
missing-initiator and Gecko's system-principal exemptions are separate privileged
cases, not equivalents of a null Fetch client.

Four main-fetch regressions first reproduced the null dereference. They now
cover unrestricted and CORP-restricted responses, plus enforced and report-only
COEP without a client. Separate cases preserve live-client policy selection and
verify that reports use the endpoints from the supplied policy.

URL Location parsing now accepts the actual UserAgent as well as settings,
because clientless redirects still have a URL-parsing owner. The existing
browser Referrer Policy algorithm is connected through that owner. Body teeing,
transforms, cancellation, and replay run on the supplied environment's networking
task, with completion observed by host Promises. These tasks supply the automatic
microtask checkpoint under the compatibility addon.

`test/browlet/fetch-http.test.ts` controls the named later algorithms and worker
boundary while testing the actual 8D flow. It covers network and worker response
selection, preflight selection, policy ordering, redirects and limits, replay,
manual continuation, and complete main-fetch body delivery through a running
Window. These are orchestration tests, not evidence that transport or CORS/TAO
checks exist.

**`SPEC_CLASH(multipart-redirect-replay)`:** the draft retains live FormData and
re-extracts it on redirect without replacing Content-Type. It does not specify
how to preserve the original boundary and captured entries. Following the
reviewed Blink, Gecko, and WebKit behavior, extraction now retains the already
encoded `BlobData` as the replay source. `FetchBody.fromSource()` creates a fresh
stream over that source, preserving the boundary, length, fields, and file data
without re-encoding or flattening the shared file segments. Author BodyInit
conversion remains separate from this internal replay path. Regressions cover
307 and 308 boundaries, post-extraction FormData mutations, and repeated replay
after consumption, including lazy binary file reads.

Validation: all 1,317 tests in the 33 Fetch and browser-Fetch suites pass on
custom Node with the compatibility addon. TypeScript and modified-file lint pass.

### 8E — Data URLs

**Complete:** `processDataURL()` implements [Fetch §6](https://fetch.spec.whatwg.org/#data-urls),
which supplies the normative processing rules in place of RFC 2397. It serializes
the URL without its fragment, splits at the first comma, percent-decodes the
payload once, recognizes a trailing case-insensitive `;base64` marker, and uses
Infra's forgiving Base64 decoder. The existing MIME parser handles parameters,
the omitted-type shorthand, and the `text/plain;charset=US-ASCII` fallback.
Queries remain part of the payload; charset metadata does not transcode bytes.

The dependency scan found all required URL, MIME, byte, and Base64 algorithms
already implemented. The existing scheme-fetch branch now returns a readable
200 response or a network error through the normal body/task machinery, with
no new environment contracts or transport dependency.

`test/fetch/schemes/data.test.ts` has 69 cases, including representative WPT
`fetch/data-urls/resources/data-urls.json` cases. Browser integration adds 14
cases for response construction, malformed input, basic filtering in all three
ordinary request modes, HEAD body removal, clientless navigation, SRI, and
completion through the automatic Window event loop. TypeScript and changed-file
lint pass; all 1,400 tests in the 34 Fetch and browser-Fetch suites pass on custom
Node with the compatibility addon.

**Slice 8 exit proof:** data URLs complete through Fetch entry, scheme dispatch,
main-response processing, and callbacks without a network. The HTTP/redirect
tests exercise deterministic injected responses through those same consumers.
Actual network/cache transactions, CORS/TAO enforcement, and the public `fetch()`
binding remain in Slice 9; the later-owner hooks listed above remain provisional.

## Slice 9 — HTTP transport, CORS, and public fetch

**Specification:** Fetch §§4.6–4.11, §§5.6–5.7, and “Using fetch in other
standards”.

Keep five subdivisions, with the first bounded to proving the transport:

| Slice | Scope | Status |
| --- | --- | --- |
| **9A — Transport and download flow** | Narrow HTTP host contract, Undici dispatcher adapter, available-byte uploads, bounded streamed downloads, cancellation, and network failures | Implemented |
| **9B — HTTP transactions** | Connect §§4.6–4.7, consume request bodies and send progress callbacks, stream uploads with demand, decode responses with one decoder per exchange, process headers/cookies/authentication/HSTS, and populate connection/body timing | Implemented with HTTP/2 and Basic credentials; HTTP detour complete; proxy authentication remains provisional |
| **9C — HTTP cache transactions** | Storage, selection, validation, and response merging from §4.6 and the [cache roadmap](http/cache/ROADMAP.md) | Implemented; background completion passes with 9D's TAO check; two callable shapes remain for review |
| **9D — CORS and timing permission** | Preflight fetch, its permission cache, CORS check, and TAO check from §§4.8–4.11 | Implemented with approved cache permission rules; two callable shapes remain for review |
| **9E — Public fetch and consumers** | §5.6 binding, local abort, realm-owned promises, filtering, and loader/Reporting integration; observable §5.7 lifetime requirements and browser-owned transport shutdown | Implemented with provisional HTML contracts; upload cancellation passes; full Fetch audit remains |

**9A implementation:** [`http/transport.ts`](http/transport.ts) defines the
UserAgent-owned host contract. [`node-transport.ts`](../browlet/loader/node-transport.ts)
uses Undici's dispatcher, preserving ordered duplicate response fields,
strict certificate/hostname verification, and actual TLS verification evidence.
Undici is a direct Browlet runtime dependency and a matching workspace development
dependency. Its Node floor matches Browlet's 22.19-or-newer requirement. The
temporary [vendor pin and patch](../../vendor/README.md) preserve HTTP/2 fields.

[`http/network.ts`](http/network.ts) implements the wire exchange behind
`FetchParams.httpNetworkFetch()`. A deterministic transport tests byte delivery,
BYOB reads, errors, and cancellation; local HTTP/HTTPS servers exercise the
adapter and real response consumption through `browlet.evaluate()`. Page tests
use the ordinary running HTML event loop, without manual checkpoints.

The network buffer pauses at 64 KiB and resumes below 32 KiB; one received chunk
can overshoot the upper bound. It retains chunks/offsets and queues at most one
delivery task, allocating page-visible bytes through the response's execution
owner. Native callbacks do not mutate page Streams. Controller cancellation stops
active and queued requests, including before Undici assigns a socket, and releases
their listeners. Adapter shutdown aborts outstanding exchanges and closes clients.

**9B implementation:** [`http/transaction.ts`](http/transaction.ts) prepares a
separate wire request, applies credentials/COEP, cookies, Origin, Fetch Metadata,
User-Agent, Referer, cache-control, content-length, and content-coding fields,
checks the keepalive budget, and handles authentication/retry control flow.
9C connects cache selection/storage; 9D connects CORS/TAO.

**9C implementation:** [`http/cache/store.ts`](http/cache/store.ts) retains
complete decoded bodies and actual Fetch metadata, selected by network partition,
URL, method, and Vary. [`http/cache/transaction.ts`](http/cache/transaction.ts)
applies cache modes, validation, 304/HEAD merging, invalidation, and background
revalidation. Capture follows existing backpressure without an additional reader
or tee. The UserAgent owns bounded LRU storage; `Browlet.clearHTTPCache()` clears
identifying validators and pending writes. No retired environment is retained.
The cache roadmap records its optional partial/range-storage boundary and two
callable shapes awaiting review. 9D closes the TAO background-completion gate.

Each attempt consumes one upload stream on its HTML owner. Retained sources
(including Blob and encoded multipart data) are recreated only for a retry,
avoiding an unread tee branch and preserving the original stream's used state.
`FetchRequest.clone(body)` is an accepted internal arrangement: its extra body
argument lets the transaction select that single stream; ordinary cloning still
tees. A separate wire header list is used even for redirect-error requests,
because a 421 can still require one fresh-connection retry. Discarding an unused
response releases its exchange without aborting the entire redirect controller.

**Cloning review (2026-09-24):** Fetch's ordinary request-clone algorithm clones
the body by teeing its stream. The §4.6 note explicitly encourages avoiding that
tee for a source-less body, because no replay can succeed. For replayable bodies,
our transaction instead keeps the replay source and reconstructs a stream when
needed; the unread spare tee branch would otherwise retain uploaded chunks.
This is an internal strategy for preserving retry behavior, not a change to
author-visible `Request.clone()`.

Browser source supports that separation: Blink's
`FetchRequestData::CloneExceptBody()` and `Clone()` distinguish metadata copying
from public cloning, while FetchManager drains encoded FormData or an upload
pipe; Gecko's FetchDriver passes the upload stream to the channel, whose redirect
setup rewinds seekable uploads; WebKit's `FetchRequest::resourceRequest()` copies
wire metadata and supplies encoded FormData separately from `cloneBody()`.
The source files are `core/fetch/fetch_request_data.cc` and `fetch_manager.cc`
under Blink; `dom/fetch/FetchDriver.cpp` and
`netwerk/protocol/http/HttpBaseChannel.cpp` under Gecko; and
`Modules/fetch/FetchRequest.cpp` under WebKit. The extra `clone(body)` argument
was accepted on 2026-09-24 and its pending-review marker removed. This comparison
does not establish an observable browser/spec conflict requiring `SPEC_CLASH`.

The Node adapter permits up to six concurrent HTTP/1.1 connections per partition,
origin, and credentials mode. Established HTTP/2 sessions multiplex requests,
with Undici enforcing the peer's concurrent-stream limit. It records live
connections and DNS/TCP/TLS/ALPN observations in the UserAgent's ConnectionPool.
Upload reads follow native write
demand; progress and Early Hints return through the Fetch task destination.
Source-less author streams are rejected before transmission over HTTP/1.x, as
§4.7 requires, and succeed over negotiated HTTP/2. The adapter passes its async
upload iterator directly to Undici, avoiding an extra Node Readable and the
HTTP/2 Node-stream path's incorrect upload-progress listener.

The UserAgent supplies `HTTPContentDecoder` instances backed by bounded Node
zlib transforms, one chain per response. Supported codings are gzip (including x-gzip), zlib-wrapped
deflate, and Brotli, applied in reverse header order. Unsupported lists remain
untouched, malformed compressed data errors the page body, and zero-byte bodies
do not invoke decoding. Backpressure pauses both decoded output and wire input;
encoded and decoded byte counts remain distinct. The older complete-buffer
`handleContentCodings()` helper is not used on network chunks.

**Integration decisions and remaining dependencies (2026-09-24):**

- `userAgent.httpAuthentication` now reaches a UserAgent-owned Basic credential
  cache and cancelable host prompt through [`http/authentication.ts`](http/authentication.ts).
  The
  [HTTP completion plan](../http/ROADMAP.md#rfc-9110-and-7617-client-completion)
  owns four slices for RFC 9110/7617 and additional cache/client foundations.
  Detour A supplies challenge parsing and Basic encoding; B connects credential
  reuse, clearing, and retry retention, verified over local HTTP/1.1 and HTTP/2.
  B's approved rules prefer the closest credential scope and the newest accepted
  entry on ties, return rejected authored Authorization responses without retrying,
  and allow fresh prompt answers after a failure. Rejected credentials do not
  retry automatically for the same realm; the host receives `previousFailed`.
  Proxy operations remain provisional until transport owns a configured proxy.
- Detour C supplies entity-tag parsing/comparison, conditional lists,
  Last-Modified strength with explicit clock evidence, If-Range selection, and
  exact byte Content-Range parsing. Fetch 9C will consume these helpers for
  validation and partial responses. D now supplies Retry-After parsing and
  HTTP-date serialization, accepts x-gzip, and fixes HTTP/2 interim timing.
  Its transport audit verifies bodyless metadata, truncation, and bounded
  refusal recovery. The approved vendor repair also accepts unsolicited
  HTTP/1.1 100 Continue responses; the previously failing regression passes.
- HTTP/2 is enabled with Eric's approved temporary vendor arrangement. Undici
  8.11.2 at `328ab8435079ca6edc1236a29e45a46915456502` is prepared with the tracked
  [patch](../../vendor/_patches/undici.patch), then packed as the ordinary runtime
  dependency. No install hook modifies `node_modules`. The patch preserves
  original final/interim/trailer/CONNECT fields and corrects the declaration
  of the already-supported iterable upload body. A separate repair removes
  HTTP/1.1's unsolicited-100 rejection. Parsed-header consumers keep their
  existing representation. [Undici #5898](https://github.com/nodejs/undici/issues/5898)
  records the raw-header issue; [vendor instructions](../../vendor/README.md)
  describe preparation and eventual removal.
  [Transport tests](../../test/browlet/loader/node-http2.test.ts) cover negotiation,
  repeated fields, Early Hints, concurrent streams, pause/resume, stream resets,
  queued cancellation, peer limits, and connection isolation.
  [Fetch tests](../../test/browlet/fetch-http2.test.ts) cover decoding repeated
  Content-Encoding, MIME recovery, first-field HSTS, duplicate Location rejection,
  and source-less page uploads with progress. Eight dependency regressions cover
  raw and parsed APIs. Historical probes and browser/spec evidence remain in
  [`scratch/SPEC-ISSUES.md`](../../scratch/SPEC-ISSUES.md#undici-http2-raw-headers-lose-duplicate-field-boundaries).
- `SPEC_CLASH(keepalive-current-request-accounting)` records the approved rule
  that the current registered request counts once, not twice, against 64 KiB.
  Details and browser source pointers are in `scratch/SPEC-ISSUES.md`.

`fetch-transactions.test.ts`, `fetch-network.test.ts`, and
`fetch-content-decoding.test.ts` exercise actual HTTP/HTTPS servers and page
consumption, including fast-response upload completion, 421 replay, cookies,
HSTS, Early Hints, decoded expansion, cancellation, and realm-owned errors.
The transport tests also occupy all six connections before canceling a queued
seventh request. Public Fetch and loader/Reporting integration remain 9E.

`FetchRequest.appendUserAgentHeader()` already implements the User-Agent
insertion step, preserving an existing header and using the owning UserAgent's
default for clientless requests. Call it at the prescribed HTTP-network-or-cache
stage; public Request construction must not insert it early.

HSTS response processing must reach the browser-owned
`userAgent.hstsStore.processResponse(response, hasValidTLS)` with the unfiltered
network response and authenticated connection evidence. Extend Fetch's narrow
store contract when adding this consumer; HTTPS URL syntax alone is insufficient.
Preserve separate STS fields in arrival order rather than combining their
values. Process verified redirect responses before following Location, and
include non-2xx responses. Test a same-host HTTPS-to-HTTP redirect that learns
HSTS on the first response and therefore upgrades the next request.
For a matching HSTS host, every TLS error or warning must fail the connection,
including direct HTTPS requests; never offer a bypass or retry over HTTP.
See the [HSTS owner roadmap](../browlet/browsing/policy/ROADMAP.md#hsts) for the
implemented parser, expiry, host matching, and port rules.

**Exit proof:** a basic HTTP(S) request through an injected transport produces
a Browlet `Response`, streams bytes with backpressure, resolves through an
explicit Fetch task destination, and aborts without leaking an Undici/Node
public object.

### 9D — CORS and timing permission

[`http/cors-preflight.ts`](http/cors-preflight.ts) constructs the OPTIONS request,
validates its status and CORS permissions against the original request, and
stores allowed methods/headers. It uses the existing HTTP transaction, without
Service Worker interception or sending origin credentials. The original client,
reserved environment, and policy references preserve network partitioning and
browser configuration; no replacement environment is constructed. Cancellation
and task delivery follow the parent execution, while timing and callbacks stay
separate. Unused preflight bodies are discarded before the actual request.

[`http/cors-preflight-cache.ts`](http/cors-preflight-cache.ts) retains partition,
serialized origin/URL, credentials, and individual method/header permissions.
The UserAgent owns a bounded list of 1024 entries, with a two-hour maximum age;
Fetch permits early eviction and a UA-chosen cap. Expired entries cannot match
and are pruned on insertion. Entries retain neither environments nor response
bodies. Clientless requests without a partition can preflight but cannot cache.

[`policy/cors.ts`](policy/cors.ts) validates exact origins and credential
permission. [`policy/timing.ts`](policy/timing.ts) supplies TAO and navigation
TAO, including sticky redirect failures, serialized opaque origins, basic
responses, and explicit cross-origin navigation permission. Request/Response
remain the small forwarding surface. The existing cache-background completion
regression now passes without a TAO stub or an unhandled rejection.

**Specification choices and remaining review:**

- `cors-cache-credentialed-wildcard`: §4.9 cache matching accepts `*` broadly,
  conflicting with §3.3's credential restriction. Approved 2026-09-25: expand
  wildcards only when the current request's credentials mode is not `include`.
  Credentialed requests require explicit method/header matches; a literal `*`
  still matches itself.
  [Blink's result checks](https://github.com/chromium/chromium/blob/main/services/network/cors/preflight_result.cc)
  and WebKit's `CrossOriginPreflightResultCacheItem::allowsRequest()` retain a
  credential restriction. Gecko caches explicit tokens under credential-specific keys.
- `cors-cache-permission-refresh`: §4.8 uses the broad lookup match, so an anonymous response
  can refresh an older credentialed grant and a named method can refresh an
  older wildcard. Approved 2026-09-25: refresh only the exact method/header
  permission and credentials flag within the same partition, origin, and URL.
  Header names compare case-insensitively. Narrower grants have separate entries,
  leaving broader grants at their original expiry. Blink and WebKit
  replace the response's stored grants; Gecko refreshes explicit tokens in its
  credential-specific entry. See
  [Blink's cache insertion](https://github.com/chromium/chromium/blob/main/services/network/cors/preflight_cache.cc).
- `cors-authorization-wildcard`: follow Fetch's requirement to name Authorization
  explicitly, both on the wire and in the cache. Browsers' remaining wire-path
  compatibility exception is tracked in [Fetch #1919](https://github.com/whatwg/fetch/issues/1919)
  and [#1278](https://github.com/whatwg/fetch/issues/1278).
- `cors-preflight-invalid-max-age`: follow Fetch's delta-seconds grammar and
  five-second fallback for malformed or repeated fields, including negative
  values. Gecko skips caching malformed values; Blink/WebKit accept negative
  numbers as expired. The two-hour cap follows Blink's permitted UA limit;
  WebKit uses ten minutes and Gecko one day.
- Callable shapes: preflight takes `FetchParams` rather than only `request` to
  share cancellation/task ownership. Cache entries store string values and an
  absolute monotonic deadline instead of byte-array origins, mutable URL
  records, and a max-age field. Both carry `SPEC_MISMATCH` review markers.

**Coverage:** focused CORS/TAO/cache tests plus real loopback transactions cover
OPTIONS ordering, sorted unsafe names, credentials, failure before the actual
request, wildcard/Authorization rules, independent grant expiry, age fallback,
cache invalidation, parent abort, body disposal, filtered delivery, redirect
origin taint, and navigation timing. Public `fetch()` installation and its
consumers are covered in 9E below.

### 9E — Public fetch and consumers

[`global.ts`](global.ts) implements `fetch()` over converted Request inputs,
using the receiver's environment, internal promises, and immutable Responses.
Fetch contributes a partial `WindowOrWorkerGlobalScope` declaration; HTML's
existing mixin owns the operation and Window forwards it. No second global
implementation or Node Fetch object is introduced. A future Service Worker
environment identifies itself through `isServiceWorker`, disabling interception
of its own fetches; current Window environments return false.

Local abort preserves the original reason, including values that cannot be
cloned, and cancels request streams/errors response streams. Remote controller
aborts deserialize through the relevant environment. Request construction and
Web IDL conversion failures become rejected promises rather than synchronous
exceptions. The binding now allocates promises for failed operation invocations
in the method's realm, independently of successful result allocation.

`SPEC_CLASH(fetch-borrowed-realm)` records the approved receiver-realm choice
for a borrowed method's successful promise and Response. A same-origin iframe
probe on 2026-09-25 found that Chromium 149.0.7827.55 and Firefox 151.0 use the
receiver for both; Playwright WebKit 26.5 uses the method realm for both. All
three resolve relative URLs against the receiver and reject Request-construction
failures with a method-realm promise and TypeError. This is Playwright WebKit
evidence, not a Safari claim. Compare
[Blink's GlobalFetch](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/fetch/global_fetch.cc)
and [WebKit's global Fetch implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/fetch/WindowOrWorkerGlobalScopeFetch.cpp).
Borrowed-method regressions use related Windows on the same agent.

Reporting now has real loopback delivery coverage through preflight and HTTP
POST, including success, 410 endpoint removal, retryable failure, and completion
after the generating Document is destroyed. Its existing UserAgent sandbox owns
continuation. Reporting discards the unused response body after inspecting status;
the regression with an open collector body first failed and now closes correctly.

Public API tests cover streaming response delivery at headers, HTTP/2 streaming
uploads, filtering, redirects, HTTP versus network errors, local and controller
abort, reader-only observability, response cancellation, and transport shutdown.
These exercise §5.7's observable requirements without imposing a GC strategy or
adding a partial browser-close API.

**Provisional HTML consumers:**

- [`loadHTMLDocument()`](../browlet/loader/document-loader.ts) creates the
  Document synchronously and handles `about:blank`. `BrowletParser.parseBytes()`
  decodes incrementally using a BOM, transport charset, or UTF-8 fallback;
  `abort()` cancels its reader and suppresses parser continuations. Meta/prescan
  encoding selection, restart, and the full parser lifecycle remain open.
  Stream work enters the body's execution owner, while input/EOF and DOM work
  enter the new Document's networking tasks. The real navigation regression
  uses a parallel Fetch queue and sandbox-owned body, then commits the new
  Document before parser tasks run. It verifies Windows-1252 text, response CSP,
  and live timing/body information without manual checkpoints. These belong to
  the [HTML loader](../browlet/loader/ROADMAP.md),
  [parser](../browlet/html/parser/ROADMAP.md), and
  [performance](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration)
  owners. `waitForScriptsMayRun()` currently resolves immediately;
  `processLinkHeaders()` is inert in both phases. Navigation timing retains
  live records without exposing a PerformanceNavigationTiming object.
  Full navigation, MIME handler selection, and these HTML features remain open.
  The extra `ScriptHandler` argument is marked `SPEC_MISMATCH` for review;
  it supplies the existing parser integration while HTML script preparation
  remains unfinished.

**Approved upload-cancellation handling (2026-09-25):** `handleFetch()` receives
the original request for routing and a `prepareRequest()` callback. The owner
calls it once, only if interception needs a copy, before consuming or modifying
the request. Preparation clones and validates the body on its existing execution
owner. The provisional no-worker hook returns null without calling it; no
unused tee branch can prevent cancellation of the original upload. Tests retain
the original stream identity on the no-worker path and verify that prepared
copies remain independent. The formerly failing HTTP/2 early-response test now
observes the source's cancellation callback.

[Fetch's HTTP algorithm](https://fetch.spec.whatwg.org/#concept-http-fetch)
clones first, while [Handle Fetch](https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm)
can return null before dispatch, including when no active worker exists.
`SPEC_GAP(service-worker-unused-body)` records the missing disposal rule for
that unused clone. Service Workers does specify cleanup after event dispatch
when a body has no replay source: an unusable body fails, otherwise it is
canceled. The early no-worker returns never reach those steps. A null result
alone does not distinguish the no-dispatch case from network fallback after
an actual event; cleanup after dispatch belongs to those body-state rules.
The lazy preparation callback closes the no-dispatch case. Actual dispatch
still needs the specified worker body-state and lifetime rules when Service
Workers are implemented; a null result must not unconditionally cancel a
Request retained by a worker.

Browser source precedent is selection before worker-specific dispatch:
[Chromium's loader selection](https://github.com/chromium/chromium/blob/main/content/renderer/service_worker/service_worker_network_provider_for_frame.cc)
uses its configured interception factory;
[Gecko's ShouldPrepareForIntercept](https://github.com/mozilla-firefox/firefox/blob/main/dom/serviceworkers/ServiceWorkerInterceptController.cpp)
checks for a controlling worker and fetch handler;
[WebKit's createFetchTask](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/NetworkProcess/ServiceWorker/WebSWServerConnection.cpp)
returns before creating a fetch task when no matching active worker exists.
These support avoiding unused worker work; they are not identical callback APIs
or a claim that the exact regression was run in all three browsers.

Validation on custom Node 27 with the compatibility addon: 2,092 tests pass
across 94 Fetch, browser Fetch/loader/Reporting, parser, lifecycle, sandbox, and
Web IDL test files, with one existing expected failure. Both former 9E regressions
now pass. TypeScript and changed-file lint pass. The final 40-test parser,
loader, and document-lifecycle run also covers abort before the first parser
task. Parser tests cover split BOM/UTF-8 input, parsing before EOF, and abort
while waiting for bytes or a script.

## Subresource integrity

`integrity.ts` owns metadata parsing, strongest-supported-hash selection,
and byte verification from [Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/).
Read the framework/response-verification algorithms in local
`w3c-subresource-integrity/index.bs`; its path is relative to the
[reference root](PREFLIGHT.md#local-reference-inventory).

Use three slices across SRI and
[the browser policy owner](../browlet/browsing/policy/ROADMAP.md#integrity-policy):

1. **Metadata and verification (SRI §§2-3.3).** Parse supported expressions,
   select every strongest-algorithm candidate, and verify byte sequences using
   SHA-256, SHA-384, or SHA-512. Keep the host hash primitive independent of
   Web Crypto's public API and realm-owned promises.
2. **Integrity Policy state (SRI §3.8 through §3.8.1).** Replace HTML's empty
   policy placeholders, parse both structured-field headers, associate them
   with policy containers, and implement independent copying. Both policies
   copy independently; HTML's report-only omission was reviewed and rejected.
3. **Policy checks and reports (SRI §§3.8.2-3.8.3).** Implement request
   blocking and report-only decisions, source/destination exemptions, URL
   stripping, and violation bodies. Use the existing settings-owned Reporting
   seam with typed boolean fields and the report-body dictionary declaration.
   Observer/endpoint delivery stays with the planned Reporting implementation.

**Slice 1 complete:** `integrity.ts` parses and verifies metadata using JS
Engine's `computeHash(algorithm, bytes)`, backed by Node's native hashing.
The byte/hash fixtures cover all three algorithms, exact byte views, and the
parser and matching choices below. The complete unit suite passes on Node
24.19.0, 26.8.1, and custom 27.0.0-pre, each with stock and compat runtimes.
Blink's `ComputeDigest`, Gecko's `nsICryptoHash`, and WebKit's `CryptoDigest`
likewise serve SRI directly without requiring its public Web Crypto API.

**Slice 2 complete:** the browser's `IntegrityPolicy` owns typed source,
destination, and endpoint lists and parses both headers through HTTP Structured
Fields. `PolicyContainer` associates each present header independently and
copies both policies. Strict validation rejects an entire header when a
dictionary member is not an inner list of tokens. Unknown well-formed
keys/tokens are ignored; defaults apply only after validation. Tests cover
parsing, association, and independent copying through actual Window settings
and Fetch client population. The existing HTML loader/navigation consumer
still needs to deliver response headers automatically.

**Slice 3 complete:** `FetchRequest.isBlockedByIntegrityPolicy()`
checks enforced and report-only requirements and submits violation bodies to
the request client's `queueReport()`. Fetch's narrow container contract exposes
the attached integrity policy fields. Window settings supply their live Document URL separately from
base/referrer URLs; future Worker settings must supply their own URL. Metadata
with CORS/same-origin mode, local URLs, and unlisted sources/destinations are
exempt. Clientless requests and globals outside Window/Worker have no applicable
policy owner. Tests cover those decisions, policy snapshots, per-endpoint
reporting, and real Window client population.

Report bodies preserve `reportOnly` as a boolean. Fetch submits plain data;
Browlet's observer-facing body inherits the `ReportBody` interface, following
the approved browser model rather than the draft's dictionaries. URL's Reporting helper strips
credentials/fragments without mutating the original URL, as approved; non-HTTP(S)
URLs disclose only their scheme. The draft's per-endpoint reporting loop is
retained, as in Gecko/WebKit; Chromium instead queues one observer report with
an endpoint list. No endpoints means blocking can still occur, but this algorithm
submits no report. Reporting B connects actual Window queues and observers;
outbound delivery remains Reporting C's Fetch consumer.

Eric approved these parsing choices on 2026-09-21: split on Infra's ASCII
whitespace, ignore expressions outside the attribute grammar, retain digests
whose syntax is valid even if they cannot decode, and compare decoded bytes
so Base64url and omitted padding work. Normalize only algorithm names, using
the spec's case-insensitive definition; digest text remains case-sensitive.
The computed digest is shared by all strongest candidates rather than hashing
the body again for each candidate.

The draft instead strictly splits on spaces and every hyphen, omits expression
validation, and compares Base64 strings literally. Its algorithm-name
validation ignores case but its later ordered-set lookup omits normalization.
These issues are centralized in `scratch/SPEC-ISSUES.md`. The implementation
uses typed expression objects in ordered arrays, an accepted representation
for the fixed fields and sequential scans. Repeated expressions do not change
the verification result. Returning raw digest bytes rather than encoded digest
strings is also accepted; verification compares decoded bytes directly.

A real-navigation Fetch probe in Chromium 149, Firefox 151, and Playwright
Windows WebKit 26.5 confirms whitespace-separated hashes, Base64url, and
omitted padding. WebKit enforces uppercase algorithm names, while Chromium
and Firefox ignore them. Malformed-expression details also differ: Chromium
retains `sha512-====`, while Firefox/WebKit discard it. We follow the declared
Base64 grammar, which requires data characters before any padding.

**Consumer gates:** main Fetch must invoke `request.isBlockedByIntegrityPolicy()`
after client population. Fetch 8A must check response eligibility, fully read the
actual body, and deliver an integrity failure as a network error before
handover. SRI §§3.4-3.7's script/link attributes, Link processing options,
and element error events belong to their HTML/loader consumers. Neither a
digest helper nor a parsed policy completes those lifecycles.

**Exit proof:** known byte/hash fixtures cover supported/unsupported and
malformed metadata, strongest-algorithm selection, matches, and mismatches.
Fetch integration tests must exercise response eligibility, actual consumed
bytes, and integrity failure delivery. Parsing a policy or hashing arbitrary
test bytes alone does not prove the response path.

### SRI audit coverage

Reviewed the complete SRI draft (`w3c-subresource-integrity` at `632bf53`) against
the implementation and focused tests on 2026-09-21. No additional gap was found
in the completed algorithm slices beyond the approved departures above. This
does not close the consumer integrations:

| SRI sections | Coverage and remaining owner |
| --- | --- |
| §§1-3.3: metadata, hash support, selection, verification | Implemented and tested, including unsupported algorithms, unknown options, exact byte views, and strongest-digest selection. |
| §§3.4-3.6: HTML attributes and Link processing | [HTML loading](../browlet/loader/ROADMAP.md) must carry script/link and Link-header integrity metadata into Fetch. The shared metadata parser already ignores unknown options as required. |
| §3.7: failed integrity checks | Fetch 8A must reject ineligible responses and hash the consumed body before handover, returning a network error on failure. HTML loaders must deliver element error events and prevent execution/application. |
| §§3.8-3.8.3: policies, blocking, reports | Algorithms and report bodies are implemented, including Window report queues and observers. HTML must deliver response policies; main Fetch must invoke blocking; [Reporting](../browlet/reporting/ROADMAP.md) retains outbound delivery and destruction integration. Worker URL/lifetime integration waits for workers. |
| §4: transforming proxies | Requirements apply to content-transforming intermediaries and serving origins, not an additional Browlet SRI algorithm. Do not synthesize a response's `Cache-Control: no-transform` header. |
| §5: security/privacy | Explicitly non-normative. Its cross-origin leakage concern reinforces the Fetch response-eligibility gate; the helper alone must not be used to validate an opaque response. |

The optional verification overrides and console warning mentioned after §3.3.4
do not introduce mandatory SRI APIs. Reporting's separate §9.4 does require a
user opt-out; that requirement and its enforcement-preservation tests are now
explicit in the Reporting roadmap. Re-audit the live Fetch/HTML paths when those
consumers land, rather than treating standalone tests as end-to-end coverage.

## Explicitly deferred work

These are later consumers and integration gates. They do not prevent an
initial transport proof over an explicitly configured subset, but that proof
does not complete every Fetch branch.

- Fetch §4.12 deferred fetching, quotas, `fetchLater()`, and FetchLaterResult
  wait for the HTML lifecycle and Permissions Policy checks. §2.4 termination
  must retain its forward dependency; do not accept deferred records before
  their processing works.
  The internal Fetch entry and client task destinations now exist. The processor
  still needs the deferred-fetch task source's priority over script-running tasks. Slice 9 supplies
  runnable HTTP transport; full `fetchLater()` activation, quotas, and lifecycle
  integration remain a separate deferred feature, without a numbered delivery slice.
- Service Worker interception waits for worker agents, events, and lifecycle.
  Ordinary requests with no applicable worker can use the no-worker path.
- WebDriver BiDi offline/emulation/interception hooks use their specified
  no-session paths until real automation exists. Sources for this and the
  preceding specs are in the [reference inventory](PREFLIGHT.md#local-reference-inventory).
- Basic authentication, its cache, and a prompt hook are implemented; the
  default prompt declines. Additional challenge schemes need their RFCs, and
  proxy authentication needs a configured proxy identity and transport route.
- Store, policy, and timing integrations close under their linked owners in
  the dependency ledger. CORP, Metadata, trustworthiness, Blob URLs, and SRI
  already run in the current Fetch path. Public timing entries remain pending.
- `file:` fetching needs an explicit embedder policy.
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
parallel queues in `src/infra/parallel-queue.ts`, and host-neutral
origin/site operations in `src/url`. Their implementation contracts remain
with those owners. The [current dependency preflight](PREFLIGHT.md) supersedes
the earlier three-item preflight; completing those foundations does not close
the remaining external dependencies.

## Removal condition

Burn this file once Fetch's records, APIs, algorithms, host contract, and
transport boundary are represented by implemented source or by narrower
roadmaps attached to the remaining external subsystems.
