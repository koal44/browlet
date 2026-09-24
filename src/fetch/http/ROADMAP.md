# Fetch HTTP roadmap

This folder owns Fetch's HTTP-specific classifications, header protocols,
partitioning, and request processing over its request/response records. The
[parent roadmap](../ROADMAP.md) owns orchestration, the public API, and transport;
[cache integration](cache/ROADMAP.md) owns storage, selection, and validation.
Reusable syntax, dates, and RFC algorithms belong to [HTTP](../../http/ROADMAP.md).

**Status:** methods, ranges, and status classifications support parent Slice 2.
Slice 5 adds authentication records, IP/localhost resolution, connection reuse,
network partition derivation, cache partition identities, and port/MIME blocking.
Header lists and MIME extraction live in `../headers.ts`. New connections, cache
response storage, HTTP transactions, and the transport adapter remain planned.
Slice 7 adds cookie/Origin integration, CORS token-list syntax, Content-Length,
legacy encoding extraction, and nosniff blocking. FetchResponse's CORP methods
delegate checks and violation submission to
[`policy/embedder-policy.ts`](../policy/embedder-policy.ts); report generation
uses the settings object's Reporting hook. Cookie and Origin-header methods
likewise delegate to Fetch's `policy/` modules.
Slice 8A declares a UserAgent-owned `CORSPreflightCache` with provisional
`clearEntries()` for the main-fetch failure path. It cannot store entries yet;
lookup, insertion, expiration, credential matching, and removal belong together
in Slice 9's CORS preflight work.
Slice 8D now calls those lookups, preflight/network fetch, and CORS/TAO checks
from its HTTP response-selection algorithm. Lookup provisionally returns a miss
while the cache has no entries. Preflight/network fetch reject with an explicit
unimplemented InternalError, and CORS/TAO policy stubs throw likewise. Slice 9
replaces those stubs; the parent roadmap lists their owners and remaining work.

## Sources

Read [Fetch](https://fetch.spec.whatwg.org/) §§2.2–2.10, §3, and §§4.4–4.11,
with [HTTP Semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
for the referenced field, date, validator, method, status, and range rules.
Fetch's explicit overrides remain authoritative for Fetch behavior.

[Fetch Metadata Request Headers](https://w3c.github.io/webappsec-fetch-metadata/)
defines the separate `Sec-Fetch-*` append algorithms used by §4.6.

Local sources under the [reference root](../PREFLIGHT.md#local-reference-inventory):
`whatwg-fetch/fetch.bs`, `rfcs/rfc9110.txt`, and
`w3c-fetch-metadata/index.bs`. `rfcs/rfc9112.txt` and `rfcs/rfc9218.txt`
supply supporting HTTP/1.1 and transport-priority rules. Wire framing itself
belongs to the transport, not another parser in this folder.

## Delivery and ownership

| Work | Delivery point | Boundary |
| --- | --- | --- |
| Fetch classifications (`methods.ts`, `ranges.ts`, `statuses.ts`) | Parent Slice 2, then the consuming transactions | CORS/forbidden methods, method normalization, single-range parsing, and Fetch status classifications. Reuse HTTP's syntax; header-list state and public Headers stay with the parent |
| Authentication entries and partitions | Parent Slice 5 | Fetch owns keys/records; Browlet supplies client/top-level state and actual credential/store/pool instances |
| §3 header protocols | Parent Slice 7; algorithms implemented | CORP uses a provisional Reporting hook; §4 CORS/preflight checks belong to Slice 9 |
| Cookies | §3.1 and request/response processing | Use the [cookie subsystem](../../http/cookies/ROADMAP.md); Fetch computes its browser inputs and credentials decisions |
| Browser policy | Main Fetch and redirects | Call the [policy owner](../../browlet/browsing/policy/ROADMAP.md); do not reimplement its language or infer an HTML environment from Node globals |
| Cache transactions | §4.6 | Follow the [cache roadmap](cache/ROADMAP.md) |
| HTTP-network processing | Parent Slice 9 | Integrate redirects, authentication, cache, CORS preflight/cache, filtering, cancellation, and transport without a second request pipeline |

## Fetch Metadata

**Slice 1 — Header algorithms:** implemented as `FetchRequest` methods in
[`request.ts`](../request.ts), grouped under the Fetch Metadata banner.
The single algorithm slice covers all four headers and the append operation
from Fetch Metadata §§2-3. It reuses structured-field serialization, URL
origin/site operations, and the request owner's URL trustworthiness policy.
No additional runtime facility, policy capability, or request state was needed.

The published draft was checked on 2026-09-21: its current-URL wording supersedes
the local snapshot's older request-URL wording. The current URL controls
trustworthiness. Site classification compares every URL in the redirect history
with the resolved request origin; it is distinct
from Fetch's redirect-taint and cookie classifications. HTML's navigation-fetch
algorithm supplies a null client only for browser-UI initiation, so a navigation
with a null client receives `none`. A page link retains its client even with
activation or no referrer. Activation separately controls the boolean `?1`.
The draft's token/boolean typo is recorded in `scratch/SPEC-ISSUES.md`.

`test/fetch/http/metadata.test.ts` covers header values, replacement, origin/site
relationships, redirect history, navigation/activation, and trust gating.
`test/browlet/fetch-metadata.test.ts` exercises real Request bindings and the
UserAgent's loopback/configured-origin trust policy. These tests inspect actual
Fetch header lists; they do not claim that Browlet sends network requests yet.
All six Node variants pass the unit suite with the existing expected failures
and skips; the 46 new cases pass. Typechecking and focused lint also pass.

**Consumer integration — parent Slice 9:** call `request.appendFetchMetadataHeaders()`
on the outgoing HTTP request from §4.6, after origin population and URL upgrades,
and recompute it at each redirect. Keep generated headers on that outgoing
request, separate from author-visible Request headers. The caller must not carry
old generated metadata into an untrustworthy redirect: the append algorithm's
untrustworthy-URL branch returns without editing headers. HTML navigation
construction must supply the real source client and snapshotted activation.
These are later HTTP/navigation acceptance gates, not a second parser slice.

**Exit proof:** cover same-origin/same-site/cross-site requests, redirect
history, empty destinations, navigation activation, and omission for
untrustworthy targets. Verify the actual outgoing header list in Fetch tests.

## Other acceptance gates

Fetch tests cover method/status classifications, range and safelist rules,
and §3 header protocols; HTTP owns the shared syntax/date tests. Transaction tests use an
explicit fake transport to prove ordering and credentials across redirects,
authentication, cache hits/revalidation, CORS preflights, and cancellation.

HTTP authentication scheme support must name and review the applicable scheme
RFCs when implemented. Undici cannot supply browser credential policy merely
by carrying an Authorization header. Broader protocol and automation scope
stays in the parent's deferred-work section.

Remove this roadmap when reached HTTP algorithms and transactions are tested,
and any remaining branches have an explicit owner.
