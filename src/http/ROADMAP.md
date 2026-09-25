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
| `syntax.ts`, `date.ts`, `retry-after.ts` | HTTP tokens, whitespace, quoted strings, HTTP-date parsing/serialization, and Retry-After parsing |
| `authentication.ts`, `basic-authentication.ts` | Shared challenge syntax, Basic challenge selection, and credential encoding |
| `validators.ts`, `content-range.ts` | Entity tags, conditional lists, Last-Modified strength, If-Range, and byte Content-Range parsing |
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

`serializeHTTPDate(value)` emits IMF-fixdate in UTC at whole-second precision.
Invalid times or years outside 0000–9999 return null. Fetch 9C uses this when
storing a response received without Date; it must retain receipt time separately.

`parseRetryAfter(value, now)` preserves either `date` (UTC epoch milliseconds)
or `delaySeconds` (an exact bigint), with the unused member omitted. Malformed
or combined values return null. A past date remains a past date, and long delays
are not truncated to a timer's range. The eventual retry owner decides whether
to wait, starting a relative delay at response receipt, and how to schedule it.

Add further reusable field grammar or validators when a concrete consumer
requires them. Keep Fetch-specific acceptance and processing in that consumer.

## RFC 9110 and 7617 client completion

**Status (2026-09-24):** A's challenge parser and Basic encoder, B's origin
credential cache and Fetch integration, and C's validator/range helpers are
implemented. D's fields and transport checks are complete, including the approved
vendor repair for unsolicited HTTP/1.1 `100 Continue` responses.
Proxy authentication still requires a configured proxy transport; cache
transactions remain Fetch 9C.
This is client-scoped work, not a claim of complete RFC conformance or an
implementation of an origin server, forwarding proxy, or alternative wire stack.

### RFC 9110 coverage and ownership

| Sections | Browlet responsibility and remaining work |
| --- | --- |
| 1–3: introduction, conformance, concepts | Apply the requirements for a user agent and its private cache. Server and intermediary algorithms are not automatically client requirements. Existing Fetch and transport boundaries fit these roles. |
| 4: identification and origins | URL owns parsing, normalization, origins, and HTTP/HTTPS distinctions; Fetch selects target URLs. Node/Undici supplies TLS and certificate verification. Proxy selection and tunnel configuration require an explicit browser transport owner. |
| 5: fields | Tokens, whitespace, dates, and quoted strings exist. Slice A supplies authentication's list/parameter grammar in §5.6, including quoted commas, empty list elements, and parameter occurrences for scheme validation. Fetch retains its own Headers conversion and acceptance rules. The patched HTTP/2 adapter preserves ordered duplicate response fields; retain that coverage when replacing the vendor patch. |
| 6: messages | Undici/Node handles wire framing and incomplete messages; Fetch handles response/body delivery. For §6.6.1, a cache recipient with a clock must record receipt time and append a missing Date when storing the response. Keep trailers separate from headers; the adapter currently discards trailers, and any later trailer consumer needs an explicit transport extension. |
| 7: routing | Host/authority and connection details belong to transport. Fetch already handles its 421 retry. Configured proxies/CONNECT are not implemented by merely declaring a proxy-authentication method. Via and forwarding transformations belong to an intermediary, not this browser. |
| 8: representation metadata | MIME, Encoding, Content-Length, and streamed content decoding have owners. C supplies §8.8 entity-tag parsing, strong/weak comparison, and Last-Modified validator strength. D accepts x-gzip as gzip without changing received fields or advertised coding preferences; Content-Location participates in later cache invalidation. |
| 9: methods | Fetch owns permitted/forbidden methods, GET/HEAD restrictions, redirects, and replay eligibility. Cache invalidation follows unsafe methods. The adapter disables HTTP/1 pipelined replay; Undici can still retry replayable HTTP/2 requests explicitly refused before processing. Status responses and consumed upload iterators are not automatically replayed. Do not implement server-side method execution. |
| 10: context fields | User-Agent, Referer, and Location have browser/Fetch owners. Retry-After parsing (§10.2.3) is available; automatic delay/retry policy is a separate consumer decision. Sending Expect/100-continue requires a deliberate transport feature if enabled. Receiving unsolicited 100 is independently required; the approved Undici vendor repair enables this on HTTP/1.1, alongside the existing HTTP/2 behavior. |
| 11: authentication | A implements challenge grammar, Basic selection, and encoding. B connects origin protection spaces, prompts, credential clearing, and retries with approved overlap/retry policies; proxy support remains open below. Reusable parsing/encoding belongs here; the UserAgent owns credentials and prompting; Fetch owns retries and credentials-mode gates. |
| 12: content negotiation | Fetch supplies browser preferences and supported encodings; the existing cache rules parse Vary. Selecting server representations is not a browser task. Add preference/qvalue helpers only for an actual configurable client field. Accept-Charset is deprecated. |
| 13: conditional requests | C supplies validator lists and If-Range helpers; HTTP-date parsing supplies date conditionals. Fetch 9C constructs validation requests and applies responses and conditional precedence with RFC 9111. Server-side evaluation of PUT or other preconditions is outside browser scope. |
| 14: ranges | Fetch has single-byte-range parsing and Blob range responses. C supplies received Content-Range parsing/validation and If-Range rules for cache/download consumers. Partial storage/combination belongs to 9C. Multipart/byteranges interpretation is a separate streaming MIME consumer, not the existing multipart/form-data parser. |
| 15: status codes | Fetch already supplies status classification, redirects, null-body handling, and 421 retry. Authentication supplies 401/407 behavior; cache work supplies 304/HEAD/206 handling. Preserve unknown status numbers and apply their class rules. Optional recovery for 408/413/503 is not a mandate to retry every response. |
| 16: extensibility | Retain unknown fields and status codes as their recipients require. Unknown authentication schemes must not hide supported challenges. A generic extension registry is not needed merely because the RFC defines IANA registries. |
| 17: security | Apply origin/proxy credential separation, replay limits, TLS validation, field/number bounds, and non-disclosure in the owning algorithms. Credential clearing (§17.16) needs browser control; privacy-state clearing should also clear identifying cached validators (§17.14). |
| 18–19; Appendices A–B | Registration information, references, collected ABNF, and changes. Use as supporting evidence; no independent browser subsystem to implement. |

### Implementation order

**A — Authentication syntax and Basic encoding. Implemented.**
[`authentication.ts`](authentication.ts) parses repeated challenge fields using
RFC 9110 §§5.6/11: token68, parameter lists, quoted strings/commas, and empty
list members. It lowercases scheme/parameter names and retains ordered parameter
occurrences; malformed syntax rejects the combined list. Scheme validation can
therefore reject duplicates without guessing which value wins.
[`basic-authentication.ts`](basic-authentication.ts) selects the first valid Basic
challenge and encodes credentials, including the required realm, charset advice,
unknown extensions, colon restrictions, and prohibited ASCII controls. Origin
and proxy field names stay with their consumers. Credential reuse is B.

Existing HTTP syntax, Encoding, and Infra Base64 supplied
the dependencies. The referenced RFC 7613 and its successor
[RFC 8265](https://www.rfc-editor.org/rfc/rfc8265.html) were reviewed: Basic requires
support for their character repertoires, not wholesale enforcement of those
profiles. The encoder supports their Unicode scalar values, rejects unpaired
surrogates, and does not introduce extra case/width/space mapping or a PRECIS
validator. This does not claim implementation of the complete profiles.

Exit proof: `test/http/authentication.test.ts` and
`test/http/basic-authentication.test.ts` cover RFC examples, repeated/mixed
schemes, quoted commas, malformed syntax and parameters, unknown extensions,
non-ASCII credentials, and UTF-8 challenges without a running browser.

**Slice A compatibility choices.**

Eric approved these choices on 2026-09-24:

- `SPEC_CLASH(basic-challenge-validation)`: RFC 7617 §2 requires a realm, and
  RFC 9110 §11.2 requires parameter names to occur once per challenge. Reject
  Basic challenges that violate either rule, continuing to a later valid challenge.
  [Chromium's Basic handler](https://chromium.googlesource.com/chromium/src/+/main/net/http/http_auth_handler_basic.cc)
  accepts a missing realm and uses the last repeated realm; Gecko's
  `netwerk/test/unit/test_authentication.js` explicitly tests accepting a missing
  realm and retaining the first repeated realm. Unknown extensions and unknown
  charset advice are ignored as RFC 7617 specifies; duplicates still invalidate
  that challenge. No equivalent WebKit-wide recovery rule was established.
- `SPEC_CLASH(basic-credential-normalization)`: preserve input and encode UTF-8,
  including when a challenge advertises `charset=UTF-8`. RFC 7617 §2.1 describes
  NFC as the server's expectation, but changing composition can change an existing
  password. Chromium's
  `HttpAuthHandlerBasic::GenerateAuthTokenImpl`, Gecko's
  `nsHttpBasicAuth::GenerateCredentials`, and WebKit's shared
  `CredentialBase::serializationForBasicAuthorizationHeader` convert the supplied
  credentials directly to UTF-8 without NFC. RFC 7617 leaves the default encoding
  unspecified, and Appendix B.1 describes UTF-8 defaults as already satisfying
  the charset advice; §2.1 describes NFC as the server's expectation. The advice
  is explicitly optional, so this is not simply a universally mandatory client
  step that every browser violates.
  Realm labels remain opaque and are unaffected by the credential charset.

The HTTPAUTH working group debated normalization in November 2014:
[Roy Fielding opposed retrofitting normalization](https://mailarchive.ietf.org/arch/msg/http-auth/jcxUEEUp3b2duKJIAFkgqija6R8/)
because existing accounts rely on users supplying the same character composition
as at creation. [Julian Reschke, the RFC's author](https://mailarchive.ietf.org/arch/msg/http-auth/6qmuXA6ETnh21wbWi-Pe_tvE53o/),
also doubted adoption because of the compatibility cost.
[Nico Williams](https://mailarchive.ietf.org/arch/msg/http-auth/PIz0fhEf6csIIshNt9dKTfq4VlE/)
agreed that changing existing clients is risky, while allowing a new expectation
to be signaled and favoring normalization-insensitive server comparisons.

NFC can make equivalent input methods work when account creation and verification
use the same normalization. Applying it only in the HTTP encoder can instead
change an existing password's bytes. Conditioning NFC on `charset=UTF-8` limits
that change, but a browser-compatible server might advertise UTF-8 while comparing
unnormalized credentials. That failure scenario is an implementation inference,
not a measured prevalence claim or a documented decision by all three engines.
The approved choice replaces our initial conditional NFC behavior. The WebKit evidence above
covers its shared serializer, not every Safari system-networking path.

**B — Credential lifetime and Fetch integration. Implemented.**
[`HTTPAuthenticationStore`](../browlet/loader/authentication.ts) belongs to UserAgent.
It keys Basic credentials by target scheme/host/port and exact HTTP realm, with
RFC 7617 §2.2 directory scopes for preemptive reuse. Explicit realm lookup after
a challenge can discover a new directory in the same protection space. Failed
credentials are removed by identity so an older failure cannot remove a newer
replacement. Clearing advances a generation, preventing in-flight exchanges
from repopulating the cleared cache.

[`transaction.ts`](../fetch/http/transaction.ts) retains the selected entry across
authentication and 421 retries; successful responses need not repeat the challenge.
It applies credentials-mode, COEP, prompt-target, CORS-taint, URL-credential, and
body-replay gates. URL credentials are percent-decoded before UTF-8 Basic encoding.
Generated Authorization fields stay on the wire copy. Existing authored fields
remain unchanged. Parsing/encoding stays in HTTP; request/response decisions stay
in Fetch.

The Node-facing `BrowletConfig.authentication` hook may return credentials, null,
or a Promise. It receives a sanitized URL, realm, prompt target, previous username,
`previousFailed` indicator for that realm, and cancellation signal. It declines by
default. A host may deliberately resubmit credentials or decline with null after
a failure; Fetch does not impose a prompt-attempt limit. `Browlet.clearHTTPCredentials()`
clears session credentials. Fetch cancellation settles immediately and aborts the
host signal; late answers cannot retry or store credentials. No page realm or
Binding Context is retained by the credential cache.

**Approved decisions (2026-09-24):**

- `SPEC_CLASH(basic-scope-selection)`: prefer the closest authenticated directory,
  breaking ties by the most recently authenticated entry. Lookups do not change
  that order. Keep nested scopes even when an ancestor is also known, since their
  depth can distinguish them from another realm's scope.
  [RFC 7617 §2.2](https://www.rfc-editor.org/rfc/rfc7617.html#section-2.2)
  expressly leaves priority unspecified. Chromium's
  [HttpAuthCache::LookupByPath](https://github.com/chromium/chromium/blob/main/net/http/http_auth_cache.cc)
  chooses the longest matching directory, retaining the first match on ties. WebKit's
  [CredentialStorage::findDefaultProtectionSpaceForURL](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/CredentialStorage.cpp)
  searches the closest directory first; storing a mapping replaces the default
  realm for that exact directory. Gecko's
  [nsHttpAuthNode::LookupEntryByPath](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttpAuthCache.cpp)
  returns the first matching cached entry, with newly added realms inserted first.
  The approved tie rule follows WebKit's replacement behavior rather than
  Chromium's first match.
- `SPEC_CLASH(basic-authored-authorization)`: return a rejected authored
  Authorization response without prompting or retrying. Fetch preserves an
  authored Authorization field even during retry;
  Gecko's [test_wrong_stored_passwd](https://searchfox.org/mozilla-central/source/netwerk/test/unit/test_authentication.js)
  expects a single request and a 401 for rejected custom credentials.
  [nsHttpChannel::ProcessResponse](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttpChannel.cpp)
  explicitly bypasses both cached credentials and prompting in this case.
  A local Playwright 1.61.1 probe on 2026-09-24 supplied a rejected explicit Basic
  header and valid automation credentials: Firefox 151.0 sent one request;
  Chromium 149.0.7827.55 and WebKit 26.5 sent two requests with the unchanged bad
  header. All returned 401. The unauthenticated control succeeded in all three.
  Reproduction: `node Scratch/basic-auth-browser-probe.mjs`. This substitutes
  automation for the prompt; Windows Playwright WebKit is not Safari's Cocoa port.
  The caller can start a new request with a changed or omitted Authorization field.
- Allow a fresh prompt to supply credentials already rejected by the same Basic
  challenge. Rejected cached credentials cannot retry automatically, including
  a concurrent cache replacement carrying the same pair. Rejection history is
  scoped to the HTTP realm within this transaction, so a different realm can use
  the same pair. A 421 does not mark credentials as rejected.
  [RFC 9110 §15.5.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2)
  permits a new/replaced Authorization field and recommends presenting the response
  after a repeated challenge following an authentication attempt. Fetch specifies
  recursive prompting without an attempt bound or a same-credentials rule.
  Chromium's [HttpAuthController](https://github.com/chromium/chromium/blob/main/net/http/http_auth_controller.cc)
  and Gecko's [nsHttpChannelAuthProvider](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttpChannelAuthProvider.cpp)
  invalidate rejected cache entries but accept newly supplied prompt credentials.
  WebKit's [NetworkDataTaskCocoa::tryPasswordBasedAuthentication](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/NetworkProcess/cocoa/NetworkDataTaskCocoa.mm)
  uses the previous-failure count to stop automatic stored-credential reuse, then
  leaves the challenge to its client. These paths do not establish a shared browser
  rule banning every pair previously tried during an exchange. The host receives
  `previousFailed` when the preceding credentials were rejected for the requested
  realm. It controls whether to answer again; declining returns the readable 401.

Proxy authentication uses the configured proxy's identity, not the destination
origin. Our current direct transport has no proxy-selection/tunnel contract;
`applyProxyAuthentication()` remains a no-op and `promptProxy()` declines.
Do not populate proxy cache entries or send proxy credentials until that owner
exists. A visible login dialog is not required for the headless prompt hook.
Exit proof in `test/browlet/http-authentication.test.ts`: loopback HTTP/1.1 and
HTTP/2 challenges/retries, successful reuse, changed
realm/path/origin/port, overlapping scopes and ties, automatic versus prompted
retries, rejected authored fields, cancellation, user-controlled clearing, and
unchanged replayed upload bytes. Proxy acceptance additionally
requires an actual configured proxy and proves credentials never leak to the
origin. That gate remains open until a proxy transport is implemented.

**C — Validators, conditional fields, and partial responses. Implemented.**
[`validators.ts`](validators.ts) supplies RFC 9110 §§8.8 and 13's reusable
validator rules. `EntityTag` parses a complete field, compares with explicit
strong/weak rules, and serializes without escaping or changing its opaque
value. Its `W/` marker is case-sensitive. `parseEntityTagList()` handles combined
If-Match/If-None-Match values, preserves order and duplicates, and distinguishes
a lone wildcard from an empty list. Commas and backslashes inside tags stay
literal. Malformed members invalidate the list; empty members are ignored
under §5.6.1. `serializeEntityTagList()` provides the corresponding field text.

`isStrongLastModified()` consumes parsed epoch-millisecond dates and explicit
clock evidence. RFC 9110 §8.8.2.2 requires Date to be at least one second later
than Last-Modified **and** a reason to trust the relative clocks. The caller's
`clocksReliable` argument states that they share a clock or the separation is
large enough to discount skew; this helper does not invent a default skew
allowance or use receipt time as evidence. Cache integration must establish
that evidence before treating a date as strong.

`selectIfRangeValidator()` prefers a strong entity tag, refuses a date fallback
when a weak tag exists, and otherwise requires a strong Last-Modified date.
`parseIfRange()` accepts the entity-tag or HTTP-date grammar;
`matchesIfRange()` requires strong tag equality or exact strong-date equality.
The caller owns the Range-presence and method gates. Date conditionals use the
existing `parseHTTPDate()`; wire date serialization is part of D.

[`content-range.ts`](content-range.ts) parses byte Content-Range fields with
inclusive `bigint` offsets and complete lengths, preserving values beyond
JavaScript's safe-integer and native 64-bit limits. `ContentRange` is one record
with optional `first`, `last`, and `completeLength` fields. The parser omits an
unknown complete length; unsatisfied ranges carry only the known length,
including zero. Reversed bounds and totals that do not exceed the final offset are invalid.
Malformed/repeated fields and unsupported range units return null, so a byte
cache cannot accidentally combine an unknown unit. No partial body is allocated.

Dependencies were already present: HTTP syntax/date parsing and Infra's cursor
and whitespace pattern. Exit proof: `test/http/validators.test.ts` and
`test/http/content-range.test.ts` cover RFC examples, opaque bytes, strong/weak
comparisons, wildcard/list forms, clock evidence, If-Range selection/equality,
large numbers, invalid bounds, unknown totals/units, and 416 unsatisfied ranges.

Actual request generation, conditional precedence, 304 merging, status/body
checks on 206/416 responses, and partial-body retention/combination remain
Fetch 9C with RFC 9111. A partial response's Content-Length counts the transferred
content, not the complete representation; ranges describe encoded bytes.
Multipart/byteranges needs its own consumer before generating multi-range
requests (RFC 9110 §15.3.7.2). No parallel cache or request model was introduced.

**D — Remaining client fields and transport audit: complete.**
Retry-After parsing and HTTP-date serialization have no new subsystem dependency.
The x-gzip regression initially exposed compressed bytes to the page; Fetch now
selects gzip decoding for that alias, including mixed case and stacked codings.
The received field and registered coding name remain intact. The supported
Accept-Encoding preferences remain gzip, deflate, and br. Neither compress nor
x-compress is supported by the current native decoder.

The HTTP/2 Early Hints regression initially recorded a zero start time because
Undici omitted its response-start callback. The adapter now supplies a start
notification at header receipt if Undici did not provide an earlier one.
This is an approximation: Node's HTTP/2 events expose decoded headers, while
Fetch asks for the first response byte. Undici's final HTTP/2 start callback
already uses that same event boundary. Moving the omitted interim callback
into Undici would restore its callback contract but would not improve timing
precision; that requires a lower-level per-response observation. The missing
callback came with [Undici #5712](https://github.com/nodejs/undici/pull/5712).

The transport audit verifies:

- Separate 102/103 and final responses, unknown final status retention, original
  field boundaries, and no merging of trailers into final headers. Both HTTP/1.1
  and HTTP/2 accept an unsolicited 100 before the final response.
- HEAD/304 representation Content-Length without transferred content at the Fetch
  consumer and transport; 204/205 null-body delivery; coding headers retained
  without decoding absent bytes. The approved Undici HTTP/1.1 vendor repair
  preserves a 304's Content-Length and completes it without closing the connection.
- Short Content-Length responses reject the consuming page's body read with
  its TypeError on both protocols. Existing tests cover coding errors,
  cancellation, bounded buffering, TLS failure, and connection reuse.
- Ordinary 408/413/503 responses retain Retry-After without automatic replay;
  a failed HTTP/1 socket is not replayed. Unsolicited protocol upgrades fail.
- Undici's HTTP/2 REFUSED_STREAM recovery replays a buffered request once and
  stops on a second refusal. Fetch upload iterators are not replayed beneath
  Fetch. RFC 9113 §8.7 permits recovery of requests the peer did not process;
  Undici also has bounded GOAWAY refusal recovery. This is narrower than retrying
  arbitrary failed requests, and corrects the old "one exchange" comment.

**Unsolicited 100 repair:** `test/browlet/loader/node-transport.test.ts` initially
failed because Undici 8.11.2 closed the HTTP/1 connection for status 100. The
approved vendor patch removes that rejection and uses the existing informational
response path, as permitted by RFC 9110 §§15.2–15.2.1. Undici commit `41496d5d`
keeps the repair separate from the other vendor changes, with regressions for
repeated 100 responses through Fetch and pipelined response ordering. Evidence
is in [issue notes](../../scratch/SPEC-ISSUES.md#undici-http11-rejects-unsolicited-100-continue).
The follow-up browser probe passed GET and POST with zero, one, and two
unsolicited 100 responses in Chromium, Firefox, and Windows WebKit. Undici's
[original discussion](https://github.com/nodejs/undici/issues/197#issuecomment-667529094)
favored ignoring 100; its August 2020 coverage commit instead added rejection.
The narrower repair does not require implementing Expect upload negotiation.

Exit evidence is in `test/http/date.test.ts`, `test/http/retry-after.test.ts`,
the loader's `node-transport.test.ts` and `node-http2.test.ts`, and Browlet's
`fetch-content-decoding.test.ts`, `fetch-http2.test.ts`, and
`fetch-response-framing.test.ts`. The last exercises real transport and page
body delivery; it stubs the separate TAO policy still owned by Fetch 9D.
Validation passed: 5,357 HTTP/Fetch/transport tests, TypeScript, and 31 focused
Undici informational-response, pipelining, and raw-header tests.

Forwarding headers, server negotiation/preconditions, and optional protocol
upgrades remain outside this client detour. Fetch 9C connects Date receipt/storage;
no new automatic Retry-After policy or trailer consumer was introduced.

### Boundaries and later dependencies

Undici's dispatcher carries HTTP messages and Node supplies sockets/TLS. Browlet
does not use Undici's public fetch, cache interceptor, or retry handler, so those
modules do not fulfill Browlet's authentication, cache, or retry obligations.
Undici's ProxyAgent can encode configured proxy credentials, but does not supply
a browser's protection-space cache, challenge selection, or prompt lifecycle.
Our response decompression is explicitly composed around Node codecs.

The immediate pure algorithms have no missing DOM or HTML dependency. Browser
integration now supplies retained challenge state and a prompt/credential-clear
owner with the approved selection and retry rules. The proxy boundary above
remains open. Fetch 9C implements complete-response storage/freshening;
multipart byte-range assembly needs its own RFC 2046/9110 consumer if adopted.
Digest (RFC 7616), connection-bound schemes, and other optional schemes need
their own reviewed specifications and transport contracts; implementing Basic
does not claim those schemes. RFC 9110 already defines Authentication-Info
syntax, but consuming its scheme-specific data, including in trailers, belongs
with a scheme that uses it.

## Exit proof

`npm run test:unit -- test/http` covers the HTTP modules. `test/http/`
contains syntax/date/authentication/validator/range tests, with cache tests under `test/http/cache/` and
Structured Fields tests under `test/http/struct-fields/`. The submodule roadmaps
own their acceptance criteria. Fetch and MIME tests prove the shared syntax
through their respective consumers.
