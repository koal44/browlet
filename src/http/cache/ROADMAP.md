# HTTP cache rules roadmap

This module owns reusable private-cache calculations and policy. Its inputs
are field values, methods/statuses, and caller-supplied timestamps; it imports
neither Fetch nor Browlet. The [Fetch cache plan](../../fetch/http/cache/ROADMAP.md)
owns storage, response selection, validation, and transactions over Fetch records.

**Status:** age/freshness, bounded field parsing, storage eligibility, request
restrictions, and invalidation triggers are implemented. Partial-response and
status-specific policy extensions wait for the corresponding storage support.

## Sources

- [RFC 9111, HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html):
  cache rules and fields, particularly §§3–5.
- [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html): stale extensions.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): referenced dates,
  validators, conditional requests, and other HTTP rules.

Local sources are `rfcs/rfc9111.txt`, `rfcs/rfc5861.txt`, and
`rfcs/rfc9110.txt` under the [reference root](../../fetch/PREFLIGHT.md#local-reference-inventory).
The [HTTP roadmap](../ROADMAP.md) owns shared syntax and date parsing.

## Age and freshness contract

`calculateCacheFreshness(fields, status, timing)` in `freshness.ts` consumes
combined field values and caller-supplied request/response/current timestamps
in UTC epoch milliseconds. It returns age and freshness lifetime in seconds,
chronological freshness, a validation requirement, and the response's
stale-while-revalidate/stale-if-error windows. It does not read an ambient clock
or mutate the input. [HTTP-date parsing](../ROADMAP.md#syntax-and-dates) and
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

## Exit proof

The focused tests in `test/http/cache/` cover cache fields, freshness, and policy;
`test/http/date.test.ts` covers the shared HTTP-date dependency. Fixtures exercise the RFC's
date examples, expiration/stale-window boundaries, year rollover, network delay,
overflow, duplicate directives, private-cache permission, request restrictions,
Vary syntax, and unsafe-method invalidation triggers.

These calculations do not prove storage or transaction behavior. The
[Fetch cache plan](../../fetch/http/cache/ROADMAP.md) owns those acceptance gates
and the external Undici store comparison. Extend these rules alongside those
consumers, with a focused test for each newly supported branch.
