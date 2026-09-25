# Fetch HTTP cache integration roadmap

This folder will own storage, selection, validation, and cache transactions over
Fetch request/response records. Browlet owns configured cache instances and their
partitioned storage. This is distinct from the service-worker Cache API.

**Status:** the reusable [HTTP cache rules](../../../http/cache/ROADMAP.md) and
Fetch request/response cloning exist. `partitions.ts` selects browser-owned
partition identities from the actual client environment, including opaque-site
separation. A partition currently holds only its key; response storage,
selection, validation, and transport transactions remain unimplemented.

## Sources

- [Fetch](https://fetch.spec.whatwg.org/): §2.2.6 freshness predicates,
  §2.8 partitions, and §4.6 cache modes and HTTP-network-or-cache processing.
- [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html): storing, selecting,
  freshening, and invalidating responses (§§3–4).
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): validators and
  conditional requests, shared with [Fetch HTTP](../ROADMAP.md).
- [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html): stale extensions.

Local sources and revisions are in the
[reference inventory](../../PREFLIGHT.md#local-reference-inventory).
The HTTP cache module owns field parsing and standalone policy contracts.
The [RFC 9110/7617 detour](../../../http/ROADMAP.md#rfc-9110-and-7617-client-completion)
supplies the remaining validator/conditional/range helpers before these
transactions; its algorithms must not depend on Fetch cache records.

## Implementation order

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
   strong-validator requirements. Do not treat the multipart/form-data parser
   as a multipart/byteranges implementation. Keep trailers separate from headers.
3. **Fetch transactions.** Honor cache modes, credentials and partition selection,
   cancellation, and background stale-while-revalidate behavior. RFC 5861's
   stale-if-error is a separate extension; do not enable it as an unconditional
   network-error fallback outside the applicable Fetch rules.

Do not invent parallel Request/Response models for the store. Persistence and
eviction policy are host choices around its contract. An explicitly disabled
cache is a configuration, not proof that its algorithms have been implemented.
Browser privacy-state clearing must include identifying cached validators
(RFC 9110 §17.14), not only cookies or the independent authentication cache.

## Undici reuse assessment

Reviewed the clean Undici 8.10.0 checkout at `181c293`. Its public
`cacheStores.MemoryCacheStore` and `cacheStores.SqliteCacheStore` can be used
independently of `interceptors.cache()`. They offer buffered body writes,
bounded storage/eviction, and optional SQLite persistence. The interceptor
itself also owns freshness, conditional requests, and background revalidation;
it would therefore be a larger policy delegation than borrowing storage.

The stores select one matching entry internally, apply Vary matching and an
expiry cutoff, and expose no enumeration of candidate responses. Our
[standalone comparison](../../../../test/fetch/probes/undici-cache-selection.mjs)
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

Stored-response tests must cover overlapping Vary variants, no-store/no-cache,
authenticated requests, invalidation, and validation updates. Integration tests
must observe outgoing conditional requests, returned headers and bytes,
partition isolation, cache-mode differences, cancellation, and background
revalidation. A successful lookup in an in-memory map is not that proof.

Standalone calculation/policy tests remain with the
[HTTP cache module](../../../http/cache/ROADMAP.md#exit-proof). The external
Undici comparison above remains an ordinary failing probe, separate from the
unit suite. Remove this roadmap when the storage and transaction gates pass.
