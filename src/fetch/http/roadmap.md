# Fetch HTTP roadmap

This folder owns Fetch's HTTP-specific syntax, header protocols, partitioning,
and request processing. It remains part of the Fetch project and uses its
request/response records. The [parent roadmap](../roadmap.md) owns orchestration,
the public API, and transport; [caching](cache/roadmap.md) owns its detailed
storage and validation work.

**Status:** planned; no HTTP implementation or transport adapter exists here.

## Sources

Read [Fetch](https://fetch.spec.whatwg.org/) §§2.2–2.10, §3, and §§4.4–4.11,
with [HTTP Semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
for the referenced field, date, validator, method, status, and range rules.
Fetch's explicit overrides remain authoritative for Fetch behavior.

[Fetch Metadata Request Headers](https://w3c.github.io/webappsec-fetch-metadata/)
defines the separate `Sec-Fetch-*` append algorithms used by §4.6.

Local sources under the [reference root](../preflight.md#local-reference-inventory):
`whatwg-fetch/fetch.bs`, `rfcs/rfc9110.txt`, and
`w3c-fetch-metadata/index.bs`. `rfcs/rfc9112.txt` and `rfcs/rfc9218.txt`
supply supporting HTTP/1.1 and transport-priority rules. Wire framing itself
belongs to the transport, not another parser in this folder.

## Delivery and ownership

| Work | Delivery point | Boundary |
| --- | --- | --- |
| Reusable HTTP syntax (`syntax.ts`) | Parent Slice 2 | Implement the referenced grammar/date/validator primitives; reuse existing Infra/MIME operations where their contracts match. Header-list state and public Headers stay with the parent |
| Authentication entries and partitions | Parent Slice 5 | Fetch owns keys/records; Browlet supplies client/top-level state and actual credential/store/pool instances |
| §3 header protocols | Parent Slice 7 | Origin, CORS, Content-Length, MIME extraction, nosniff, CORP, and Sec-Purpose remain Fetch algorithms |
| Cookies | §3.1 and request/response processing | Use the [cookie subsystem](../../cookies/roadmap.md); Fetch computes its browser inputs and credentials decisions |
| Browser policy | Main Fetch and redirects | Call the [policy owner](../../browlet/browsing/policy/roadmap.md); do not reimplement its language or infer an HTML environment from Node globals |
| Cache transactions | §4.6 | Follow the [cache roadmap](cache/roadmap.md) |
| HTTP-network processing | Parent Slice 9 | Integrate redirects, authentication, cache, CORS preflight/cache, filtering, cancellation, and transport without a second request pipeline |

## Fetch Metadata

Implement `metadata.ts` over the actual Fetch request record when available.
It appends `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, and
`Sec-Fetch-User`. Reuse [structured fields](../../structured-fields/roadmap.md),
URL origin/site operations, and the policy owner's trustworthiness operation.
Client, URL-list/redirect, destination, and activation state must retain their
provenance from request construction; an ordinary header-setting API does not
provide those facts.

**Exit proof:** cover same-origin/same-site/cross-site requests, redirect
history, empty destinations, navigation activation, and omission for
untrustworthy targets. Verify the actual outgoing header list in Fetch tests.

## Other acceptance gates

Pure tests cover invalid HTTP bytes, syntax, method/status classifications,
range and safelist rules, and §3 header protocols. Transaction tests use an
explicit fake transport to prove ordering and credentials across redirects,
authentication, cache hits/revalidation, CORS preflights, and cancellation.

HTTP authentication scheme support must name and review the applicable scheme
RFCs when implemented. Undici cannot supply browser credential policy merely
by carrying an Authorization header. Broader protocol and automation scope
stays in the parent's deferred-work section.

Remove this roadmap when reached HTTP algorithms and transactions are tested,
and any remaining branches have an explicit owner.
