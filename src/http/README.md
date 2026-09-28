# HTTP

Reusable HTTP syntax, header values, private-cache rules, authentication, and
cookies. Other subsystems import through [index.ts](index.ts). These modules
accept protocol values and caller-supplied policy; they do not import Fetch or
Browlet.

## Module guide

| Module | Responsibility |
| --- | --- |
| [syntax.ts](syntax.ts) | Tokens, whitespace, and Fetch's quoted-string collector |
| [headers.ts](headers.ts) | HTTP dates, entity tags, conditional fields, Content-Range, and Retry-After |
| [authentication.ts](authentication.ts) | Challenge lists, Basic selection, and credential encoding |
| [structured-fields.ts](structured-fields.ts) | RFC 9651 records, parsing, and serialization |
| [cache.ts](cache.ts) | Cache-Control, Vary, freshness, storage permission, request constraints, and invalidation triggers |
| [cookie.ts](cookie.ts) | Cookie records, parsing, matching, dates, and serialization |
| [cookie-store.ts](cookie-store.ts) | Retention, replacement, retrieval, limits, and eviction |

[Fetch](../fetch/README.md) owns its request/response records, header processing,
cache entries and transactions, CORS, retries, and content decoding. Browlet's
UserAgent owns cookie and credential stores. URL owns parsed hosts and paths;
MIME owns media-type parsing and sniffing. Node/Undici owns HTTP wire framing,
sockets, and TLS, with the maintained [vendor repairs](../../vendor/README.md).

## Cache values and rules

`CacheControl.parse(value)` returns a parsed object or null for malformed syntax.
Its `directives` preserve order, duplicates, unknown names, and the difference
between a bare directive and an explicitly empty argument. Names are lowercase;
values retain their original case. `has(name)` tests presence, and
`getDeltaSeconds(name, bareValue?)` returns undefined for absence, null for an
invalid or repeated constraint, or nonnegative seconds. Bare max-stale can use
Infinity; numeric overflow saturates at Number.MAX_SAFE_INTEGER.

`CacheHeaderValues` contains combined, unparsed header strings. It is temporary
input to the rules, not a cache entry. `calculateCacheFreshness()` takes explicit
request, response, and current timestamps in epoch milliseconds; its age and
lifetime results use seconds. It does not consult an ambient clock.

The private-cache heuristic is 10% of the Last-Modified-to-Date interval when
heuristics are permitted. Invalid freshness information requires validation.
Stale windows exclude their endpoint; request max-age/min-fresh/max-stale limits
are inclusive. No-cache, must-revalidate, and no-store constrain stale use.

Storage eligibility, freshness, and request permission are separate decisions.
No-cache permits storage; request no-store prohibits new storage but does not
forbid reuse of an existing entry. Fetch selects matching entries and applies
304/HEAD updates. `shouldInvalidateCache()` identifies the method/status trigger;
Fetch selects and removes the affected URIs.

## Header values

HTTP dates use epoch milliseconds and an explicit clock for obsolete two-digit
years. Cookie dates have a separate grammar and fixed year cutoff.
`EntityTag` retains the opaque value and weak flag; comparisons explicitly
select strong or weak matching. Date-validator strength requires caller evidence
about relative clocks, not merely two timestamps one second apart.

Content-Range offsets and lengths use bigint. Unknown lengths and unsatisfied
range offsets are omitted. Retry-After retains either an absolute date or exact
seconds; it does not schedule retries. `UNUSED` marks helpers retained for future
conditional-cache, partial-response, or retry consumers.

## Structured fields

`parseStructuredField(bytes, type)` parses the combined field value and rejects
the whole field on malformed syntax. Tagged records preserve distinctions such
as Integer versus Decimal and String versus Token; Maps retain dictionary and
parameter order. Consumers supply the field's declared type and interpretation.

`serializeStructuredField(field)` returns an ASCII string, undefined to omit an
empty List/Dictionary, or null on failure. Serialization does not mutate records.

## Authentication and cookies

Challenge parsing retains parameter occurrences so Basic selection can reject
ambiguous duplicates. Encoding preserves Unicode input and uses UTF-8. Credential
scope selection, prompts, clearing, and request replay belong to Browlet/Fetch;
reviewed browser differences are in the [roadmap](ROADMAP.md#authentication).

Cookies retain byte strings and parsed URL hosts/paths. An undefined host has not
been assigned; null records a failed Domain parse. `StoredHTTPCookie` narrows the
same object's host after storage. Parsing applies the store's lifetime limit;
retrieval selects and orders records; serialization emits the supplied order.

The store defaults to 50 cookies per host, 3000 total, and a 400-day age limit.
Replacement preserves creation time and refreshes access time. Its null return
can also mean an indistinguishable replacement; the new object is still stored.
Retrieval filters expired records even between garbage-collection passes.
Browser policy supplies SameSite and access decisions; see [cookies](ROADMAP.md#cookies).

## Tests and sources

Run `node scripts/with-node.mjs vitest run --project=unit test/http`.
Tests under `test/http/` follow the module layout, with basic cases before
specialized behavior. Separate HTTPWG tests use the [upstream fixtures](../../test/http/fixtures/httpwg/README.md)
for independent parsing/serialization expectations and provenance. Fetch, MIME,
authentication, and Reporting tests exercise the actual consumers.

Governing sources are RFC 9110/9111, RFC 5861, RFC 7617, RFC 9651, Fetch's shared
HTTP algorithms, and the layered-cookies draft. Algorithm comments link exact
sections. Local copies live under the [reference root](../fetch/README.md#sources).
Remaining work and retained browser evidence belong to [ROADMAP.md](ROADMAP.md).
