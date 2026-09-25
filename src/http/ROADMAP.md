# HTTP roadmap

This project groups reusable HTTP syntax, authentication algorithms, validators,
structured fields, cache rules, and cookies. Its modules do not depend on Fetch
request/response records or on Browlet. Fetch, MIME, and browser consumers use the public exports in
`index.ts`; store instances and browser policy remain with their owning host.

This file owns that boundary and the shared syntax work. The linked submodule
notes describe their contracts, tests, and any remaining work.

## Ownership

| Component | Responsibility |
| --- | --- |
| `syntax.ts`, `date.ts` | HTTP tokens, whitespace, quoted strings, and HTTP-date parsing |
| Authentication and validators (planned below) | Challenge/credential syntax, Basic encoding, validator comparison, and conditional/range field rules |
| [Structured fields](struct-fields/README.md) | RFC 9651 values, parsing, and serialization |
| [Cache rules](cache/ROADMAP.md) | RFC 9111/5861 field parsing, freshness, storage eligibility, and request policy |
| [Cookies](cookies/ROADMAP.md) | Cookie records, parsing, storage, retrieval, serialization, store limits, and eviction |

[Fetch HTTP](../fetch/http/ROADMAP.md) retains CORS and forbidden-method rules,
Fetch status/range classifications, header protocols, and transactions. Its
[cache integration](../fetch/http/cache/ROADMAP.md) owns storage and selection
over Fetch records, validation, and network processing. MIME retains MIME type
parsing/sniffing; XHR retains its API and Fetch-consuming state machine.

`http/tsconfig.json` builds the whole HTTP subsystem. The subfolders organize
related algorithms within that project; `index.ts` defines its public API.
Internal imports and focused tests can refer directly to individual modules.

## Sources

- [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html):
  HTTP meaning shared across protocol versions: fields, methods, authentication,
  validators, ranges, and status codes. The client work below follows its
  user-agent and private-cache requirements; wire framing stays with transport.
- [RFC 7617, Basic authentication](https://www.rfc-editor.org/rfc/rfc7617.html):
  the named authentication scheme, its encoding and credential-reuse rules.
  Its RFC 7235 authentication-framework reference is now covered by RFC 9110.
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

## RFC 9110 and 7617 client completion

**Status (2026-09-24):** section-by-section scope scan complete; this is an
implementation plan, not a conformance claim. Fetch 9B reaches authentication
and supplies a provisional UserAgent implementation that returns no credentials,
declines prompts, and stores nothing. The detour below replaces it and supplies
the missing foundations for 9C cache transactions. It does not implement an
origin server, forwarding proxy, or an alternative HTTP wire stack.

### RFC 9110 coverage and ownership

| Sections | Browlet responsibility and remaining work |
| --- | --- |
| 1–3: introduction, conformance, concepts | Apply the requirements for a user agent and its private cache. Server and intermediary algorithms are not automatically client requirements. Existing Fetch and transport boundaries fit these roles. |
| 4: identification and origins | URL owns parsing, normalization, origins, and HTTP/HTTPS distinctions; Fetch selects target URLs. Node/Undici supplies TLS and certificate verification. Proxy selection and tunnel configuration require an explicit browser transport owner. |
| 5: fields | Tokens, whitespace, dates, and quoted strings exist. Authentication needs the list/parameter grammar in §5.6, including quoted commas, empty list elements, and field-specific duplicate rules. Fetch retains its own Headers conversion and acceptance rules. Preserve ordered duplicate response fields; HTTP/2 raw-header access remains a separate 9B gate. |
| 6: messages | Undici/Node handles wire framing and incomplete messages; Fetch handles response/body delivery. For §6.6.1, a cache recipient with a clock must record receipt time and append a missing Date when storing the response. Keep trailers separate from headers; the adapter currently discards trailers, and any later trailer consumer needs an explicit transport extension. |
| 7: routing | Host/authority and connection details belong to transport. Fetch already handles its 421 retry. Configured proxies/CONNECT are not implemented by merely declaring a proxy-authentication method. Via and forwarding transformations belong to an intermediary, not this browser. |
| 8: representation metadata | MIME, Encoding, Content-Length, and streamed content decoding have owners. Add §8.8 entity-tag parsing, strong/weak comparison, and Last-Modified validator strength. Check content-coding aliases at the decoder boundary; Content-Location participates in later cache invalidation. |
| 9: methods | Fetch owns permitted/forbidden methods, GET/HEAD restrictions, redirects, and replay eligibility. Cache invalidation follows unsafe methods. The adapter disables Undici's automatic idempotent replay; any additional retry must preserve Fetch's body and cancellation rules. Do not implement server-side method execution. |
| 10: context fields | User-Agent, Referer, and Location have browser/Fetch owners. Add reusable Retry-After parsing (§10.2.3); automatic delay/retry policy is a separate consumer decision. Expect/100-continue requires a deliberate transport feature if enabled, not another public Fetch header. |
| 11: authentication | Implement challenge/credential grammar, scheme selection, protection spaces, 401/407 processing, and successful credential reuse. Reusable parsing/encoding belongs here; the UserAgent owns credentials and prompting; Fetch owns retries and credentials-mode gates. |
| 12: content negotiation | Fetch supplies browser preferences and supported encodings; the existing cache rules parse Vary. Selecting server representations is not a browser task. Add preference/qvalue helpers only for an actual configurable client field. Accept-Charset is deprecated. |
| 13: conditional requests | Supply validator and conditional-field helpers. Fetch 9C constructs validation requests and applies responses with RFC 9111. Server-side evaluation of PUT or other preconditions is outside browser scope. |
| 14: ranges | Fetch has single-byte-range parsing and Blob range responses. Add received Content-Range parsing/validation and If-Range rules for cache/download consumers. Partial storage/combination belongs to 9C. Multipart/byteranges interpretation is a separate streaming MIME consumer, not the existing multipart/form-data parser. |
| 15: status codes | Fetch already supplies status classification, redirects, null-body handling, and 421 retry. Authentication supplies 401/407 behavior; cache work supplies 304/HEAD/206 handling. Preserve unknown status numbers and apply their class rules. Optional recovery for 408/413/503 is not a mandate to retry every response. |
| 16: extensibility | Retain unknown fields and status codes as their recipients require. Unknown authentication schemes must not hide supported challenges. A generic extension registry is not needed merely because the RFC defines IANA registries. |
| 17: security | Apply origin/proxy credential separation, replay limits, TLS validation, field/number bounds, and non-disclosure in the owning algorithms. Credential clearing (§17.16) needs browser control; privacy-state clearing should also clear identifying cached validators (§17.14). |
| 18–19; Appendices A–B | Registration information, references, collected ABNF, and changes. Use as supporting evidence; no independent browser subsystem to implement. |

### Implementation order

**A — Authentication syntax and Basic encoding.** Implement the shared RFC 9110
§§5.6/11 grammar and RFC 7617's complete scheme-specific client rules. Parse
multiple challenges across repeated fields, token68 versus auth parameters,
quoted strings/commas, mandatory Basic realm, optional charset, and unknown
extensions. Select supported schemes without interpreting unrelated schemes as
Basic. Encode user-id/password octets with Base64; validate the scheme's colon
and control-character restrictions. Keep origin and proxy field names at their
consumers rather than duplicating the grammar.

RFC 7617 leaves the default non-ASCII encoding unspecified while its UTF-8
challenge describes NFC plus UTF-8. Review Blink, Gecko, and WebKit before
choosing that compatibility behavior. Read the referenced RFC 7613 character
profiles and its successor [RFC 8265](https://www.rfc-editor.org/info/rfc8265)
before claiming complete internationalization coverage; distinguish required
character support from extra credential validation. Existing HTTP syntax, Encoding,
Infra Base64, and Unicode normalization supply the immediate primitives.
Exit proof: RFC examples, repeated/mixed schemes, quoted commas, malformed
parameters, unknown extensions, non-ASCII credentials, and UTF-8 challenges in
`test/http/`, without needing a running browser.

**B — Credential lifetime and Fetch integration.** Replace the provisional
`HTTPAuthentication` operations with a UserAgent-owned cache and an explicit
prompt hook that may decline. Retain the selected challenge across the retry:
a successful response need not repeat WWW-Authenticate. Implement protection
spaces, RFC 7617 §2.2 path reuse, failed-credential replacement/clearing, URL
credentials, and Fetch's existing credentials, prompt-target, cancellation, and
body-replay rules. Review browser behavior for overlapping scopes because
RFC 7617 leaves that priority unspecified. Keep scheme parsing in HTTP and
request/response orchestration in Fetch; refine the provisional interface to
carry the actual exchange information it needs.

Proxy authentication uses the configured proxy's identity, not the destination
origin. Our current direct transport has no proxy-selection/tunnel contract;
inspect that dependency before implementing its cache keys or sending proxy
credentials. A visible login dialog is not required for the headless prompt
hook. Exit proof: loopback challenges and retries, successful reuse, changed
realm/path/origin/port, rejected credentials, cancellation, user-controlled
clearing, and unchanged replayed upload bytes. Proxy acceptance additionally
requires an actual configured proxy and proves credentials never leak to the
origin. Keep that gate explicit if transport work remains deferred.

**C — Validators, conditional fields, and partial responses.** Implement the
reusable parts of RFC 9110 §§8.8, 13, and 14 needed by cache validation and future
downloads: entity-tag parsing and comparison, validator lists, Last-Modified
strength, If-Range selection, and Content-Range parsing/validation. Entity tags
are opaque: they are not ordinary quoted strings to unescape. Reject invalid
range bounds and preserve large decimal values without rounding. Cover weak
versus strong validators, wildcard/list forms, unknown totals/units, and 416
unsatisfied ranges. Actual 304 merging, partial-body retention/combination,
and request generation remain in Fetch 9C with RFC 9111; do not create another
cache or request model in HTTP.

**D — Remaining client fields and transport audit.** Add Retry-After parsing
and any missing Date serialization required by cache receipt handling. Audit
the current Node adapter and Fetch consumers against the remaining matrix:
1xx/final responses, bodyless statuses, truncation/errors, content-coding aliases
(including the RFC's x-gzip compatibility advice), field preservation, and
transport retry behavior. Keep metadata versus body-byte counts distinct.
Forwarding headers, server negotiation/precondition engines, and optional
protocol upgrades do not justify speculative implementations. Record each
still-needed consumer at its actual owner rather than adding unused parsers.
Exit proof combines small field tests with focused local-server regressions for
any uncovered adapter/Fetch behavior; the HTTP/2 gate stays independently
visible until raw fields and multiplexed stream behavior are verified.

### Boundaries and later dependencies

Undici's dispatcher carries HTTP messages and Node supplies sockets/TLS. Browlet
does not use Undici's public fetch, cache interceptor, or retry handler, so those
modules do not fulfill Browlet's authentication, cache, or retry obligations.
Undici's ProxyAgent can encode configured proxy credentials, but does not supply
a browser's protection-space cache, challenge selection, or prompt lifecycle.
Our response decompression is explicitly composed around Node codecs.

The immediate pure algorithms have no missing DOM or HTML dependency. Browser
integration needs retained challenge state, a prompt/credential-clear owner,
and the proxy boundary described above. Cache storage/freshening remains Fetch
9C; multipart byte-range assembly needs its own RFC 2046/9110 consumer if adopted.
Digest (RFC 7616), connection-bound schemes, and other optional schemes need
their own reviewed specifications and transport contracts; implementing Basic
does not claim those schemes. RFC 9110 already defines Authentication-Info
syntax, but consuming its scheme-specific data, including in trailers, belongs
with a scheme that uses it.

## Exit proof

`npm run test:unit -- test/http` covers the HTTP modules. `test/http/`
contains syntax/date tests, with cache tests under `test/http/cache/` and
Structured Fields tests under `test/http/struct-fields/`. The submodule roadmaps
own their acceptance criteria. Fetch and MIME tests prove the shared syntax
through their respective consumers.
