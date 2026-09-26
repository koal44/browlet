# Fetch

This subsystem implements the [Fetch Standard](https://fetch.spec.whatwg.org/)
for Browlet and other specification consumers. It owns request/response records,
policy checks, HTTP transactions, body streams, and the author-facing Fetch APIs.
The planned delivery slices and independent dependency preflight are complete;
the [roadmap](ROADMAP.md) records the completed audit and remaining work.

## Entry points

`fetch(request, options, env) -> FetchController` starts an internal fetch.
The caller supplies a `FetchRequest`, response-processing steps, and the owning
execution environment. Options select header delivery, body consumption,
upload progress, Early Hints, completion, and parallel callback delivery.
The controller supports cancellation and exposes timing information.

Consumers receive Fetch records and streaming bytes. They should consume or
cancel an unused response body; inspecting its status alone does not release it.
Fetch owns HTTP content decoding. HTML owns character decoding, parsing,
Document construction, and the navigation lifecycle.

`fetchForGlobal()` adapts the internal entry to the Web IDL `fetch()` operation
on HTML's existing WindowOrWorkerGlobalScope mixin. Headers, Request, Response,
and Body declarations accompany their implementations. Binding machinery owns
author conversion, platform identity, realm selection, and promise projection.
Import across subsystem boundaries through [index.ts](index.ts).

## Module guide

| Module | Responsibility |
| --- | --- |
| [fetch.ts](fetch.ts) | Fetch entry, main/scheme/HTTP/redirect/preflight algorithms, cache transactions, response completion, and private network stream machinery |
| [fetch-global.ts](fetch-global.ts) | Author-facing fetch operation and abort handling |
| [request.ts](request.ts), [response.ts](response.ts), [headers.ts](headers.ts), [body.ts](body.ts) | Fetch records, public implementations, header algorithms, and body extraction/consumption |
| [params.ts](params.ts), [controller.ts](controller.ts), [group.ts](group.ts), [timing.ts](timing.ts) | Per-fetch state, cancellation, environment lifetime, and timing records |
| [environment.ts](environment.ts) | Contracts supplied by browser environments and UserAgent |
| [policy.ts](policy.ts) | Cookies, origins, CORS/CORP/COEP, timing disclosure, metadata, upgrades, integrity requirements, and blocking checks |
| [transport.ts](transport.ts) | HTTP I/O and decoder contracts, connection records, and network partition keys |
| [cache-http.ts](cache-http.ts), [cache-cors.ts](cache-cors.ts) | HTTP response storage and CORS preflight permissions |
| [multipart.ts](multipart.ts), [integrity.ts](integrity.ts), [data-url.ts](data-url.ts), [url.ts](url.ts) | Multipart bodies, SRI digest verification, and local URL algorithms |

Only the entry and its options are exported from `fetch.ts`. Tests of its
subordinate algorithms enter through that same entry with controlled owners.
Request/Response policy methods provide small forwarding calls to `policy.ts`;
CSP language and browser policy state remain with their browser owners.

## Execution and ownership

The execution owner (`env: JSEnvironment`), initiating client
(`request.client`), and callback destination are distinct. The client may be
null; it does not supply every execution facility. The supplied environment
provides `exec` for promises, Streams, allocation, and abort handling, and queues
networking tasks to a global or parallel queue. Pass the existing environment;
do not manufacture a substitute browser settings object.

UserAgent owns transport, connections, HTTP/CORS caches, authentication, cookies,
and HSTS. Its sandbox supplies execution for work that outlives a Window, such
as retired Reporting deliveries. Reserved HTML environment records supply early
origin/partition state without pretending to be complete settings objects.

The [Node adapter](../browlet/loader/node-transport.ts) uses Undici's dispatcher
for HTTP/1.1 and HTTP/2 wire I/O. Browlet owns Fetch policy and its own public
objects, streams, and promises. Native callbacks return work through the owner's
networking tasks. Upload pulls follow transport demand; response backpressure
pauses both decoding and wire input. A separate
[decoder](../browlet/loader/node-decoder.ts) chain handles each compressed response.
The temporary Undici patches and their removal criteria live in
[vendor/README.md](../../vendor/README.md).

## Bodies and caches

`FetchResponse.clone()` tees its existing body. `copy(body)` copies metadata
with an explicit replacement body, including null. Multipart replay retains
the encoded `BlobData`, preserving the boundary and captured fields without
reading every File into a second contiguous buffer.

HTTP cache entries retain metadata and immutable `BlobData`, without retaining
the original request, stream, or execution environment. Capture copies chunks
as they flow; it adds no reader or tee. Publication waits for successful framing
and decoding, and each hit creates a fresh stream in its consumer's environment.
The store bounds entries and in-progress body bytes; clearing it also invalidates
pending writes and stored validators. Set-Cookie runs on network receipt only.

CORS cache entries retain partition keys, serialized origins/URLs, permissions,
and monotonic expiry deadlines. They retain no client or body. Cache transactions
remain in `fetch.ts`; reusable RFC field and freshness rules belong to
[HTTP](../http/ROADMAP.md) and its [cache module](../http/cache/ROADMAP.md).

## Tests

From the repository root, run the implementation and browser Fetch suites:

```sh
node scripts/with-node.mjs vitest run --project=unit test/fetch test/browlet/fetch
```

Related suites under `test/browlet/loader`, `test/browlet/reporting`, and
`test/streams` cover transport, retained delivery, and stream completion.
Use real bindings for author conversion and realm behavior, controlled transport
for algorithm ordering, and loopback HTTP/HTTPS for actual wire behavior.
Browser comparisons are evidence for recorded decisions, not conformance proof.

## Sources

Fetch-specific companion standards are [SRI](https://w3c.github.io/webappsec-subresource-integrity/),
[Fetch Metadata](https://w3c.github.io/webappsec-fetch-metadata/), and HTML's
[multipart encoder](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm).
The roadmap links remaining dependencies and reviewed disagreements.

Local reference sources live under `C:/Users/rando/source/repos/_web-platform/specs/`:
Fetch uses `whatwg-fetch/fetch.bs`, HTML uses `whatwg-html/source`, W3C drafts
usually use `index.bs`, and published RFC text lives in `rfcs/`. Consult each
owner's roadmap for its specific source; runtime dependencies are separate.
