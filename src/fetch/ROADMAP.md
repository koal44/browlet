# Fetch project roadmap

- **Complete:** [Slice 1 — control and task delivery](#slice-1--control-and-task-delivery).
- **Complete:** [Slice 2 — HTTP methods, headers, and statuses](#slice-2--http-methods-headers-and-statuses).
- **Complete:** [Slice 3 — bodies and stream processing](#slice-3--bodies-and-stream-processing).
- **Complete:** [Slice 4 — requests and responses](#slice-4--requests-and-responses), Fetch §§2.2.5–2.2.7.
- **Infrastructure implemented, effects deferred:** [Slice 5 — fetch groups and network infrastructure](#slice-5--fetch-groups-and-network-infrastructure); transport, response storage, and deferred-fetch processing remain open.
- **Complete:** [Slice 6 — network-independent platform APIs](#slice-6--network-independent-platform-apis), including Request/Response construction and HTML's document-base-URL dependency.
- **Complete, HTML integrations provisional:** [Slice 7 — HTTP extensions](#slice-7--http-extensions); srcdoc ancestry and report generation retain their explicitly deferred integration hooks.
- **In progress:** [Slice 8 — Fetch orchestration and local schemes](#slice-8--fetch-orchestration-and-local-schemes); 8A client population is connected for the implemented HTML policy state.

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
The network-independent API objects are complete; the public `fetch()` operation
remains in Slice 9. The
[dependency preflight](PREFLIGHT.md) retains the remaining external work order.

`index.ts` exports the contracts consumed by production outside Fetch, including
task delivery, client settings, fetch groups, and browser-owned pools/partitions. Add exports with their real
consumers; focused tests may import internal algorithms without widening this
surface.

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
| `controller.ts`, `timing.ts`, `tasks.ts`, `infrastructure.ts`, `url.ts` | Controller state, abort reasons, timing/body information, task delivery, offline-state inputs, integer serialization, and URL classifications | Opening §2 and §2.1 |
| `params.ts` | Fetch bookkeeping over the real request/response records and the controller | §2, “Infrastructure” |
| `headers.ts` | Header lists, parsing, normalization, extraction, guards, and forbidden/safelisted names | §§2.2.2, 3.3–3.8, and 5.1 |
| `body.ts` | Body records, stream extraction, cloning, consumption, and `BodyInit` conversion | §§2.2.4 and 5.2–5.3 |
| `request.ts` | Request records, cloning, policy inputs, destinations, and the `Request` implementation | §§2.2.5 and 5.4 |
| `response.ts` | Response records, filtered responses, cloning, network errors, and the `Response` implementation | §§2.2.6 and 5.5 |
| [`http/`](http/ROADMAP.md) | Fetch-specific HTTP rules and transactions; its [cache plan](http/cache/ROADMAP.md) owns storage/validation over Fetch records | §§2.2–2.10, 3, and 4.4–4.11 |
| [`multipart/`](multipart/ROADMAP.md) | FormData byte encoding/parsing used by Body | §§5.2–5.3 |
| `integrity.ts` | SRI metadata and byte verification; see [the scoped plan below](#subresource-integrity) | §4.1 and SRI |
| `schemes/` | `about:`, `blob:`, `data:`, `file:`, and HTTP(S) scheme dispatch | §§4.3 and 6 |
| `fetch.ts` | Main Fetch orchestration, response-processing callbacks, task destinations, and ongoing-fetch control | §§4.1–4.2 and “Using fetch in other standards” |
| `transport.ts` | HTTP request/response bytes, streaming, cancellation, connection reuse, and TLS metadata without Fetch redirects or CORS policy | §§2.5–2.6 and 4.6–4.7 |
| Co-located API implementations and IDL in `headers.ts`, `body.ts`, `request.ts`, `response.ts` | Record ownership, Body composition, declaration signatures, and staged Browlet installation during Slice 6 | §§5.1–5.5 |
| Public `fetch()` binding (planned) | Realm-correct orchestration and abort handling | §5.6 |

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
| §2 is offline and serialize an integer | `infrastructure.ts`: `FetchEnvironment` supplies its owning `FetchUserAgent`, which provides the scoped BiDi query; decimal serialization precedes §2.1 |
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
the composed runtime. Transport, response storage, and pending deferred-fetch
processing remain explicit completion gates, not passing network/cache claims.

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

**8A started, not complete:** `FetchRequest.populateFromClient()` preserves
supplied fields and resolves deferred fields once. HTML settings select the real
traversable; HTML's policy container owns cloning, and the UserAgent supplies
default containers for clientless requests. Integration tests cover these paths
with real settings and traversables, including a cross-origin child Window.
The Fetch entry algorithm and main-fetch processing have not been implemented;
client population is their first completed dependency, not the whole of 8A.
`fetch.ts` exposes an approved provisional entry for Reporting's delivery caller.
It returns void and does nothing: no dispatch, processing callbacks, or controller.
Replace it with the real entry algorithm here; a pending Reporting delivery
Promise is not evidence that any network request has been sent.

The accepted provisional Request-constructor rule preserves a selected target
only when the source request's resolved origin matches the new environment.
An unresolved or cross-origin source defers selection. A traversable has no origin;
its current Document's origin is not used for this check. The specification's
old environment-object wording remains an upstream issue to resolve.

Policy cloning covers implemented COEP/referrer state, both Integrity Policies,
and independent default containers. Populated CSP lists explicitly reject
cloning until the CSP owner supplies copying.
That model must include CSP's list-level `self-origin`, not just replace
`object[]` with typed policy entries; see the [CSP roadmap](../browlet/browsing/policy/csp/ROADMAP.md).
Both Integrity Policies now copy independently, following Gecko despite HTML's
report-only omission. Remaining policy models and delivery belong to their
policy owners, rather than requiring new Fetch wiring.

After client population, 8A reaches HTML preload consumption, shared-clock
access, language/priority selection, and BiDi hooks. Main fetch then reaches
CSP, Mixed Content, HSTS/HTTPS DNS upgrading, SRI byte verification, CORS
preflight-cache invalidation, and Resource Timing. Preserve the planned owner
boundaries and pause at unresolved dependencies; a test host's policy decisions
do not constitute Browlet policy enforcement.

Mixed Content's independent request/response blocking checks are available on
`FetchRequest` and `FetchResponse`, using the client's browser-owned ancestor
classification. Call `request.upgradeInsecureRequest()` followed by
`request.upgradeMixedContent()` after monitored CSP reporting and before
request blocking. Both rewrite the current URL; the former also sets the
navigation preference header. The [policy roadmap](../browlet/browsing/policy/ROADMAP.md#mixed-content-and-upgrade-insecure-requests)
records the reviewed browser/spec choices and consumer inputs. Fill
the internal response URL list before its mixed-content check. Preserve this
ordering on redirect re-entry. A failed HTTPS upgrade never retries HTTP.

HSTS's independent algorithms are implemented. Main fetch must call
`request.upgradeForHSTS()` after referrer selection and before dispatch, including
on redirect re-entry. It uses the request's UserAgent store and exempts localhost
and its subdomains as required by Fetch. Do not move this step into Request
construction. The sibling DNS HTTPS-record upgrade condition still depends on
DNS/transport support; the HSTS method does not stand in for that condition.

The Blob URL preflight now supplies URL parsing, captured entry retention,
and `FetchUserAgent.obtainBlobObject()` for authorized acquisition. In 8C,
consume `request.currentURL.blobURLEntry` instead of resolving the URL again;
revocation must not invalidate an entry already captured by Request parsing.
Select the reserved/client environment or the specified top-level exemption
at scheme fetch, then construct the response, headers, and range body.

`about:` and `file:` branches remain explicit until their dependencies exist. `file:` behavior is an
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
  Revisit the pending-record processor when Slice 8 supplies the internal Fetch
  entry algorithm. It also needs the client's global task destination and the
  deferred-fetch task source's priority over script-running tasks. Slice 9 supplies
  runnable HTTP transport; full `fetchLater()` activation, quotas, and lifecycle
  integration remain a separate deferred feature, without a numbered delivery slice.
- Service Worker interception waits for worker agents, events, and lifecycle.
  Ordinary requests with no applicable worker can use the no-worker path.
- WebDriver BiDi offline/emulation/interception hooks use their specified
  no-session paths until real automation exists. Sources for this and the
  preceding specs are in the [reference inventory](PREFLIGHT.md#local-reference-inventory).
- HTTP authentication UI and additional challenge schemes wait for credential
  services and review of the supported schemes' RFCs. Connection pooling,
  proxy/TLS policy, and protocol support need verified host controls.
- Store, policy, and timing integrations close under their linked owners in
  the dependency ledger. Fetch-owned CORP remains in the HTTP slice; Metadata
  and trustworthiness are required for the corresponding outgoing headers.
- `blob:` URL fetching waits for the [File-owned store and lifetime integration](../file/ROADMAP.md#slice-4--blob-url-store-and-urlfetch-integration);
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
parallel queues in `src/infra/parallel-queue.ts`, and host-neutral
origin/site operations in `src/url`. Their implementation contracts remain
with those owners. The [current dependency preflight](PREFLIGHT.md) supersedes
the earlier three-item preflight; completing those foundations does not close
the remaining external dependencies.

## Removal condition

Burn this file once Fetch's records, APIs, algorithms, host contract, and
transport boundary are represented by implemented source or by narrower
roadmaps attached to the remaining external subsystems.
