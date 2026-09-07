# HTTP cache roadmap

This folder owns the private-browser HTTP cache rules consumed by Fetch.
It uses Fetch records; Browlet owns the configured cache instances and their
partitioned storage. This is distinct from the service-worker Cache API.

**Status:** age/freshness calculations and independent cache-policy rules are
implemented. The store, response selection, validation, and Fetch transactions
still require the actual header lists, request/response records, body model,
and transport pipeline.

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

1. **Age and freshness — implemented.** Parse the relevant fields and implement explicit
   and permitted heuristic freshness, current-age calculations, delta-seconds,
   and stale windows. These are the initial dependency of response helpers.
2. **Storage and selection — independent policy implemented; store deferred.**
   `policy.ts` implements storage eligibility, request restrictions on reuse,
   and the invalidation trigger; `fields.ts` parses Vary names. Complete keys,
   variant matching/selection, field retention, body storage, and invalidation
   over retained Fetch records belong after those records exist. Apply
   private-cache rules. Incomplete/partial responses must either follow the
   supported storage/combination rules or be left unstored as permitted.
3. **Validation.** Produce conditional requests and apply 304/HEAD freshening
   and replacement rules through the real Fetch pipeline. Keep stored fields,
   body retention, and response exposure consistent.
4. **Fetch integration.** Honor Fetch's cache modes, credentials and partition
   selection, cancellation, and background stale-while-revalidate behavior.
   RFC 5861's stale-if-error is a separate extension; do not enable it as an
   unconditional network-error fallback outside the applicable Fetch rules.

The independent calculations and policy consume field values and controlled
time; they do not need fake copies of future Request/Response classes. The
remaining slices retain the real Fetch records.
Disk persistence and eviction policy are host choices around the same cache
contract. An explicitly disabled cache is a configuration, not proof that its
algorithms have been implemented.

## Age and freshness contract

`calculateCacheFreshness(fields, status, timing)` in `freshness.ts` consumes
combined field values and caller-supplied request/response/current timestamps
in UTC epoch milliseconds. It returns age and freshness lifetime in seconds,
chronological freshness, a validation requirement, and the response's
stale-while-revalidate/stale-if-error windows. It does not read an ambient clock
or mutate the input. [HTTP-date parsing](../roadmap.md#initial-http-syntax) and
`fields.ts` supply the bounded field syntax.

Age includes upstream Age, response delay, and residence time, using the more
conservative of apparent age and corrected Age. Missing/invalid Date uses
receipt time; invalid Age is ignored, and a combined Age field uses its first
member. Delta-seconds and age arithmetic saturate at `Number.MAX_SAFE_INTEGER`.
For this private cache, max-age takes precedence over Expires; shared-only
s-maxage/proxy-revalidate have no effect.

Heuristic freshness uses 10% of the interval from Last-Modified to Date only
when explicit expiration is absent and the response status or a public/private
directive permits it. This is a policy permitted by RFC 9111, not its mandated
formula. Missing/invalid/future Last-Modified gives no positive estimate.

Malformed Cache-Control syntax and duplicate/invalid max-age or applicable
Expires information conservatively require validation. Unknown well-formed
directives and duplicates remain available in `parseCacheControl`'s result.
Qualified no-cache is treated as unqualified for now. A response can be young
enough to be fresh while no-cache still requires validation; freshness alone
does not permit storing a no-store response or bypassing other cache rules.

Stale windows start at expiration and exclude their end boundary. No-cache,
must-revalidate, and no-store prevent stale use; invalid/duplicate extension
values grant no window. The caller still owns request restrictions, actual
revalidation, and whether an applicable error permits stale-if-error. The
older RFC 5861 references to Warning do not require new Warning processing:
RFC 9111 §5.5 obsoletes that field.

## Independent storage and request policy

`canStoreResponse(method, status, fields, requestCacheControl)` checks permission
to retain a complete GET/HEAD response. It honors request and response no-store,
private-cache storage permission, and explicit or heuristic cacheability.
No-cache and invalid expiration do not themselves prohibit storage; validation
is a separate requirement. Authorization is not a blanket private-cache
prohibition. Malformed Cache-Control/Vary and wildcard Vary are left unstored.

The initial policy also leaves 206, 304, and must-understand responses unstored.
Range combination, 304 updates, and the status-specific storage required before
using must-understand's no-store override are deferred to actual store work.
Storage is optional under RFC 9111; these choices do not claim support for
those branches. The caller must establish response completeness before storing
any bytes.

`evaluateCacheRequest(freshness, cacheControl)` applies no-cache, max-age,
min-fresh, and max-stale to an already storable response whose URI, method, and
Vary fields match. It retains the only-if-cached directive for the transaction
to honor on a miss. Request no-store forbids new storage but does not prohibit
reuse of an existing response (RFC 9111 §5.2.1.5). Duplicate/invalid numeric
constraints conservatively deny reuse; quoted numeric values are accepted.
The age/staleness limits are inclusive. Response revalidation requirements
still take precedence.

This predicate does not authorize the separate stale-while-revalidate or
stale-if-error transactions. Fetch's cache modes, conditional requests,
Pragma compatibility, and actual network activity remain with its pipeline.
`shouldInvalidateCache(method, status)` only identifies the RFC 9111 §4.4
trigger: a 2xx/3xx response to an unsafe method or one whose safety is unknown.
Deleting all variants for the target URI, and any permitted same-origin
Location/Content-Location targets, requires the real store.

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
directory. No Undici runtime dependency has been added. Reconsider store reuse
with actual Fetch records: correct candidate selection, partition ownership,
header preservation, and body conversion must be possible without maintaining
a second parallel index merely to recover information hidden by the store.

## Exit proof

The age/freshness and independent policy slices have 242 focused tests in
`test/fetch/unit/`: `http-syntax.test.ts`, `cache-fields.test.ts`,
`cache-freshness.test.ts`, and `cache-policy.test.ts`.
They use independent field/timestamp fixtures, including the RFC's date
examples, expiration and stale-window boundaries, two-digit year rollover,
network delay, overflow, duplicate directives, private-cache permission,
request restrictions, Vary syntax, and unsafe-method invalidation triggers.
The full unit suite passed (7,601 passing, 18 existing expected failures, 15
existing skips), as did lint/typecheck. The two failing external Undici
comparison assertions are reported separately above.

Storage/validation slices still need stored-response tests for Vary variants,
no-store/no-cache, authenticated requests, invalidation, and validation updates.

Integration tests must observe outgoing conditional requests, returned headers
and bytes, partition isolation, cache-mode differences, cancellation, and
background revalidation. A successful lookup in an in-memory map is not that
proof. Remove this roadmap when both calculation and transaction gates pass.
