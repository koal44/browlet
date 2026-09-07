# HTTP roadmap

This project groups reusable HTTP syntax, structured fields, cache rules, and
cookies. Its modules do not depend on Fetch request/response records or on
Browlet. Fetch, MIME, and browser consumers import the particular module they
need; store instances and browser policy remain with their owning host.

This file owns that boundary and the shared syntax work. The linked submodule
roadmaps own their detailed contracts, tests, and remaining work.

## Ownership

| Component | Responsibility |
| --- | --- |
| `syntax.ts`, `date.ts` | HTTP tokens, whitespace, quoted strings, and HTTP-date parsing |
| [Structured fields](struct-fields/ROADMAP.md) | RFC 9651 values, parsing, and serialization |
| [Cache rules](cache/ROADMAP.md) | RFC 9111/5861 field parsing, freshness, storage eligibility, and request policy |
| [Cookies](cookies/ROADMAP.md) | Planned cookie records, store, parsing, retrieval, and serialization |

[Fetch HTTP](../fetch/http/ROADMAP.md) retains CORS and forbidden-method rules,
Fetch status/range classifications, header protocols, and transactions. Its
[cache integration](../fetch/http/cache/ROADMAP.md) owns storage and selection
over Fetch records, validation, and network processing. MIME retains MIME type
parsing/sniffing; XHR retains its API and Fetch-consuming state machine.

`http/tsconfig.json` builds syntax, dates, and independent cache rules.
Structured Fields keeps its own nested TypeScript project and UTF-8 dependency;
MIME's dependency on HTTP syntax does not pull in that project. Cookies has
only a roadmap until its implementation requires a build boundary.

## Sources

- [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html):
  referenced token, date, field, and validator rules. This is bounded reuse,
  not a plan to implement all HTTP wire protocols here.
- [Fetch §2.2](https://fetch.spec.whatwg.org/#http): its shared HTTP whitespace
  and quoted-string algorithms, also consumed by MIME.

Published RFCs and editable specifications are catalogued in the
[reference inventory](../fetch/PREFLIGHT.md#local-reference-inventory).
Each submodule names its additional governing sources.

## Syntax and dates

**Implemented:** `syntax.ts` supplies the HTTP token/whitespace predicates and
`collectHTTPQuotedString`. The collector retains Fetch's two specified modes:
the consumed source text, or the extracted value with quoting/escapes handled.

`parseHTTPDate(value, now)` in `date.ts` accepts the three RFC 9110 §5.6.7
date formats and returns UTC epoch milliseconds or null. Cache-recipient
case-insensitivity follows RFC 9111 §4.2. Calendar/weekday validity, GMT,
and the two-digit-year 50-year rule are checked; only surrounding SP/HTAB is
trimmed. The caller supplies `now` so year interpretation is deterministic.
Leap seconds round down to the preceding representable second, keeping cache
expiration conservative. Cookie dates have separate rules in their own module.

Add further reusable field grammar or validators when a concrete consumer
requires them. Keep Fetch-specific acceptance and processing in that consumer.

## Exit proof

`npm run test:unit -- test/http` covers the HTTP modules. `test/http/`
contains syntax/date tests, with cache tests under `test/http/cache/` and
Structured Fields tests under `test/http/struct-fields/`. The submodule roadmaps
own their acceptance criteria. Fetch and MIME tests prove the shared syntax
through their respective consumers.
