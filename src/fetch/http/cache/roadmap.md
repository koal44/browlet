# HTTP cache roadmap

This folder owns the private-browser HTTP cache rules consumed by Fetch.
It uses Fetch records; Browlet owns the configured cache instances and their
partitioned storage. This is distinct from the service-worker Cache API.

**Status:** planned. Pure calculations can precede Fetch records; complete
cache transactions require the actual request/response and transport pipeline.

## Sources

- [RFC 9111, HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html):
  §3 storage, §4 selecting/freshening/invalidating responses, and §5 fields.
- [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html): stale extensions.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): dates, validators,
  conditional requests, and other referenced HTTP semantics, shared through
  the [HTTP folder](../roadmap.md).
- [Fetch](https://fetch.spec.whatwg.org/): §2.2.6 freshness predicates,
  §2.8 partitions, and §4.6 cache modes and HTTP-network-or-cache processing.

Local sources are `rfcs/rfc9111.txt`, `rfcs/rfc5861.txt`, `rfcs/rfc9110.txt`,
and `whatwg-fetch/fetch.bs` under the
[reference root](../../preflight.md#local-reference-inventory).

## Implementation order

1. **Age and freshness.** Parse the relevant fields and implement explicit
   and permitted heuristic freshness, current-age calculations, delta-seconds,
   and stale windows. These are the initial dependency of response helpers.
2. **Storage and selection.** Implement cacheability, request/response
   directives, Vary keys, matching, and invalidation over retained Fetch
   records/body data. Apply private-cache rules rather than treating this as
   a shared proxy cache. Incomplete/partial responses must either follow the
   supported storage/combination rules or be left unstored as permitted.
3. **Validation.** Produce conditional requests and apply 304/HEAD freshening
   and replacement rules through the real Fetch pipeline. Keep stored fields,
   body retention, and response exposure consistent.
4. **Fetch integration.** Honor Fetch's cache modes, credentials and partition
   selection, cancellation, and background stale-while-revalidate behavior.
   RFC 5861's stale-if-error is a separate extension; do not enable it as an
   unconditional network-error fallback outside the applicable Fetch rules.

The first slice uses values and controlled time; it does not need fake copies
of future Request/Response classes. Later slices retain the real Fetch records.
Disk persistence and eviction policy are host choices around the same cache
contract. An explicitly disabled cache is a configuration, not proof that its
algorithms have been implemented.

## Exit proof

Controlled-clock fixtures cover freshness boundaries, age/delay arithmetic,
invalid or conflicting directives, and stale windows. Stored-response tests
cover Vary variants, no-store/no-cache, authenticated requests, invalidation,
and validation updates.

Integration tests must observe outgoing conditional requests, returned headers
and bytes, partition isolation, cache-mode differences, cancellation, and
background revalidation. A successful lookup in an in-memory map is not that
proof. Remove this roadmap when both calculation and transaction gates pass.
