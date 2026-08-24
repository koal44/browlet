# Fetch project roadmap

This directory reserves a host-neutral implementation boundary for the Fetch
Standard. It should own Fetch records, algorithms, and public API semantics;
Browlet should supply browser-host state and consume the resulting responses.
Raw HTTP connection management is a transport capability, not Fetch policy.

Fetch records, header/body algorithms, and transport can be implemented before
Browlet's full event loop. Browser-visible completion cannot. Fetch's task
destination must return realm-neutral results through the target environment's
responsible event loop before resolving public promises, dispatching events,
or mutating platform objects; Node's promise/job timing is not a substitute for
HTML task-source ordering.

Do not add a TypeScript project reference or public package entry until the
first implemented source makes this boundary executable.

## Specification map

| Planned area | Contract | Specification |
| --- | --- | --- |
| `controller.ts` | Fetch parameters, controller state, cancellation, timing, and response-body information | Fetch §2, “Infrastructure” |
| `headers.ts` | Header lists, parsing, normalization, extraction, guards, and forbidden/safelisted names | Fetch §2.2.2 and §5.1 |
| `body.ts` | Body records, stream extraction, cloning, consumption, and `BodyInit` conversion | Fetch §§2.2.4 and 5.2–5.3 |
| `request.ts` | Internal request records, cloning, policy inputs, destinations, and `Request` implementation | Fetch §§2.2.5 and 5.4 |
| `response.ts` | Internal and filtered responses, cloning, network errors, and `Response` implementation | Fetch §§2.2.6 and 5.5 |
| `http/` | HTTP methods/statuses, CORS, redirects, authentication, cache integration, response blocking, and header protocols | Fetch §§2.2, 3, and 4.3–4.8 |
| `schemes/` | `about:`, `blob:`, `data:`, `file:`, and HTTP(S) scheme fetch dispatch | Fetch §§4.2 and 6 |
| `fetch.ts` | Main fetch orchestration, response processing callbacks, task destinations, and ongoing-fetch control | Fetch §4 and “Using fetch in other standards” |
| `api.ts` | `fetch()`, `Headers`, `Request`, `Response`, Body mixin, and realm-correct promises | Fetch §5 |
| `web-idl.ts` | Lossless Fetch IDL contributions for assembly by the active browser host | Fetch §5 |
| `host.ts` | Narrow capabilities for settings objects, origins, explicit task destinations, structured serialization, cookies/cache/service workers, and policy checks | Fetch integration points in HTML and other standards |
| `transport.ts` | HTTP request/response bytes, streaming, cancellation, connection reuse, and TLS metadata without performing Fetch redirects or CORS policy | Fetch §4.7 network fetch |

## Dependencies

- Use `src/url` for URL records, origins, and host parsing. IDNA processing is
  already a URL-layer responsibility backed by `tr46`; Fetch must not create a
  second domain parser.
- Reuse Browlet's DOM abort algorithms through the host contract rather than
  substituting Node's `AbortSignal` objects on the public surface.
- HTML's structured-data implementation must provide serialization of abort
  reasons. Fetch must not depend directly on Browlet's scripting classes.
- Encoding, MIME Sniffing, Streams, cookies, Resource Timing, and Referrer
  Policy are genuine specification dependencies. Add or adopt each boundary
  when the first implemented Fetch slice reaches it; do not hide them in
  `fetch.ts`.

## Node and Undici

Undici is both a valuable implementation reference and the leading transport
candidate. Its high-level `fetch`, `Headers`, `Request`, and `Response` objects
must not become Browlet's public objects: they belong to Node's realm, hide the
internal records required by HTML callers, and intentionally omit or defer
browser-owned cache, cookie, service-worker, partitioning, and task behavior.

Prefer an adapter over Undici's public `Dispatcher`/`request` layer with
automatic redirects disabled, leaving redirect, CORS, filtering, credentials,
and policy decisions in this project. Confirm the supported Node floor and
WPT behavior before adding an Undici runtime dependency; the current reference
checkout's latest release requires Node 22.19 or newer.

## Delivery slices

1. Implement header/body/request/response records and author-facing object
   behavior without network I/O.
2. Add data URL and basic HTTP(S) fetching through an injected transport,
   including cancellation and streaming.
3. Add redirect, CORS, filtered-response, referrer, integrity, and response
   blocking behavior needed by Browlet loaders.
4. Add caches, cookies, authentication, network partitioning, service-worker
   interception, and deferred fetching only as consumers reach them.

## Removal condition

Burn this file once Fetch's records, API, algorithms, host contract, and
transport boundary are represented by implemented source or narrower surviving
roadmaps.
