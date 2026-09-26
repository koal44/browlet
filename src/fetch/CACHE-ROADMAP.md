# Fetch HTTP cache integration roadmap

This plan covers storage, selection, validation, and cache transactions over
Fetch request/response records. Browlet owns the configured store and its
partitions. This is distinct from the service-worker Cache API.

**Status (9C):** storage, Vary selection, validation, and transport transactions
are implemented. 9D's TAO check closes background Fetch completion; the existing
regression now passes without unhandled errors. The approved vendor repair
resolves Undici's HTTP/1.1 304 length check. Two callable shapes remain for review.

[`cache-http.ts`](cache-http.ts) contains `HTTPCacheStore`, `HTTPCachePartition`,
and `HTTPCacheEntry`: a shared body budget and LRU eviction over actual Fetch
response records, plus immutable `BlobData` for completed content. Entries retain
no execution environment. `httpNetworkOrCacheFetch()` in [`fetch.ts`](fetch.ts)
connects cache modes, validators, invalidation, and background revalidation to
the wire path.

## Sources

- [Fetch](https://fetch.spec.whatwg.org/): §2.2.6 freshness predicates,
  §2.8 partitions, and §4.6 cache modes and HTTP-network-or-cache processing.
- [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html): storing, selecting,
  freshening, and invalidating responses (§§3–4).
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): validators and
  conditional requests, shared with [Fetch HTTP](HTTP-ROADMAP.md).
- [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html): stale extensions.

Local sources and revisions are in the
[reference inventory](PREFLIGHT.md#local-reference-inventory).
The HTTP cache module owns field parsing and standalone policy contracts.
The [RFC 9110/7617 detour](../http/ROADMAP.md#rfc-9110-and-7617-client-completion)
now supplies validator lists, strong/weak tag comparison, Last-Modified strength,
If-Range, and byte Content-Range parsing. These helpers do not depend on Fetch
cache records; D supplies HTTP-date serialization for recording a missing Date.

## Implementation boundaries

The complete-response portions below are connected. Range/partial storage and
local evaluation of authored preconditions are optional and remain unsupported;
those requests go to the network with their original conditions intact.

1. **Storage and selection.** Retain actual Fetch records and bodies. Implement
   partitioned URI/method keys, Vary matching, newest suitable response selection,
   field retention, and invalidation of all applicable variants. Apply the
   existing private-cache policy. Record receipt time and append a missing Date
   when caching, as RFC 9110 §6.6.1 requires. Incomplete/partial responses must
   follow the
   supported storage/combination rules or remain unstored as permitted.
2. **Validation.** Produce conditional requests and apply 304/HEAD freshening
   and replacement rules through the real Fetch pipeline. Keep stored fields,
   body retention, and response exposure consistent. Revisit the HTTP module's
   deferred status-specific storage branches as their support becomes available.
   Use HTTP's strong/weak validator comparisons and Content-Range validation;
   partial-response combination must additionally satisfy RFC 9111 §3.4's
   strong-validator requirements. Establish the clock evidence required by
   `isStrongLastModified()`; receipt time or a locally synthesized Date does not
   alone establish that the origin's clocks agree. If-Range must not fall back
   to a date when a weak entity tag exists. Interpret Content-Range only for
   applicable 206/416 responses, check the transferred encoded length, and keep
   unknown units unstored. Apply conditional precedence, including If-None-Match
   over If-Modified-Since. Do not treat the multipart/form-data parser as a
   multipart/byteranges implementation or generate multi-range requests without
   a multipart consumer. Keep trailers separate from headers.
3. **Fetch transactions.** Honor cache modes, credentials and partition selection,
   cancellation, and background stale-while-revalidate behavior. RFC 5861's
   stale-if-error is a separate extension; do not enable it as an unconditional
   network-error fallback outside the applicable Fetch rules.

Do not invent parallel Request/Response models for the store. Persistence and
eviction policy are host choices around its contract. An explicitly disabled
cache is a configuration, not proof that its algorithms have been implemented.
Browser privacy-state clearing must include identifying cached validators
(RFC 9110 §17.14), not only cookies or the independent authentication cache.

## Storage and transaction choices

- Capture copies decoded chunks only as the existing transport delivers them.
  There is no extra stream reader or tee and no change to backpressure. A write
  becomes selectable only after framing and decoding finish successfully.
  Failed, canceled, or oversized writes are discarded. `BlobData.fromBytes()`
  now copies Node Buffers correctly instead of retaining Buffer.slice views;
  a focused File regression covers that dependency repair.
- Defaults are 32 MiB of retained/in-progress body bytes, 8 MiB per entry, and
  256 entries across partitions. LRU eviction bounds storage; persistence is
  not implemented. `Browlet.clearHTTPCache()` removes identifying validators
  and prevents pending writes from restoring cleared data.
- Each reader receives a new stream in its own environment. The cache retains
  neither the original stream nor its request/client. Body timing metadata is
  copied when decoding finishes. Set-Cookie is processed only on network
  receipt, not replayed on cache hits.
- Unknown end-to-end fields and duplicates survive storage; hop/proxy fields
  do not. Vary compares combined field values conservatively, distinguishing
  absence from an empty value. Overlapping matches use the newest Date,
  preferring valid explicit Vary rules to responses without Vary.
- Validation sends both ETag and Last-Modified when available; the origin
  applies If-None-Match precedence. Strong validators update all matching
  candidates; weak validators update the newest. Dates remain weak without
  origin-clock evidence. HEAD freshens matching GET metadata and evicts a
  contradicted representation. A 304 merges metadata while retaining body
  interpretation and Content-Length (RFC 9111 §3.2).
- All six Fetch cache modes are connected. HTTP's only-if-cached directive
  yields 504 on a miss, while Fetch's cache mode yields a network error.
  Unsafe successful responses invalidate all target variants. Stale-if-error
  is not enabled as an unconditional error fallback.
- Background revalidation enters main Fetch directly, without repeating
  preload consumption or copying already-generated wire fields. It drains
  incrementally and belongs to the original client's Fetch group. Its lifetime
  ends with the client; it is not a keepalive operation.

## Remaining acceptance gates and review

TODO: extend invalidation to same-origin `Location`/`Content-Location` targets
after 2xx/3xx responses to unsafe requests (optional under
[RFC 9111 §4.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.4)).
Currently only the request URI is invalidated.

`FetchResponse.copy(body)` copies metadata with an explicit replacement body,
including null; `clone()` tees the existing body. The approved HTTP-network fetch
signature accepts the caller-selected cache partition to establish capture before
the first body chunk. Neither introduces a parallel response model.

The background-completion gate is closed: `test/browlet/fetch-http-cache.test.ts`
observes the revalidation request reach `done` through the real TAO check,
beyond the earlier successful cache-byte update.

The approved Undici vendor repair exempts 304 from transferred-length checks.
The transport regression now completes `304 + Content-Length: 123` with no body;
the upstream-style regression also verifies connection reuse. HTTP/2 validation
continues to pass. See
[the issue evidence](../../scratch/SPEC-ISSUES.md#undici-http11-checks-304-representation-length-as-body-length).

## Undici reuse assessment

Reviewed the clean Undici 8.10.0 checkout at `181c293`. Its public
`cacheStores.MemoryCacheStore` and `cacheStores.SqliteCacheStore` can be used
independently of `interceptors.cache()`. They offer buffered body writes,
bounded storage/eviction, and optional SQLite persistence. The interceptor
itself also owns freshness, conditional requests, and background revalidation;
it would therefore be a larger policy delegation than borrowing storage.

The stores select one matching entry internally, apply Vary matching and an
expiry cutoff, and expose no enumeration of candidate responses. Our
[standalone comparison](../../test/fetch/probes/undici-cache-selection.mjs)
stores two variants that both match a later request. Both backends return the
older Date; RFC 9111 §4 requires the newest suitable response. This is an
ordinary failing assertion against each backend, not a passing test of the
limitation. Run it against an installed package or checkout:

```text
node scripts/with-node.mjs node test/fetch/probes/undici-cache-selection.mjs <undici-directory>
```

Both assertions currently fail (exit 1). This external-package comparison is
separate from Browlet's unit suite and needs the explicitly supplied Undici
directory. Slice 9A's Undici transport dependency does not adopt these cache
stores or the cache interceptor. Reconsider store reuse
with actual Fetch records: correct candidate selection, partition ownership,
header preservation, and body conversion must be possible without maintaining
a second parallel index merely to recover information hidden by the store.

## Exit proof

`test/fetch/cache-http.test.ts` covers storage, selection, validators,
HEAD, invalidation, and eviction. `test/browlet/fetch-http-cache.test.ts` exercises
real HTTP transactions and lifecycle, and `test/browlet/fetch-http2.test.ts`
covers actual HTTP/2 validation and subsequent local reuse.

Stored-response tests must cover overlapping Vary variants, no-store/no-cache,
authenticated requests, invalidation, and validation updates. Integration tests
must observe outgoing conditional requests, returned headers and bytes,
partition isolation, cache-mode differences, cancellation, and background
revalidation. A successful lookup in an in-memory map is not that proof.

Standalone calculation/policy tests remain with the
[HTTP cache module](../http/cache/ROADMAP.md#exit-proof). The external
Undici comparison above remains an ordinary failing probe, separate from the
unit suite. Remove this roadmap when the storage and transaction gates pass.
