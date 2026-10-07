# HTTP roadmap

Shared syntax, authentication, validators, structured fields, cache rules, and
cookie storage are implemented. Fetch's complete-response cache, origin Basic
authentication, and HTTP/1.1/HTTP/2 integration are also implemented. This is
client-scoped work, not a claim of complete RFC conformance or server/proxy support.
See [README.md](README.md) for current contracts and module ownership.

## Remaining work

| Work | Owner and gate |
| --- | --- |
| Partial-response retention/combination and local evaluation of authored preconditions | [Fetch cache](../fetch/ROADMAP.md#http-cache). Range and authored-conditional requests currently use the network. Reuse the tested helpers marked UNUSED in headers.ts when this work begins. |
| Same-origin Location/Content-Location invalidation targets | Fetch currently invalidates the request URI and all variants. Extend URI selection under RFC 9111 §4.4. |
| Qualified no-cache and must-understand storage | Extend cache.ts only alongside matching Fetch storage support; conservative handling remains valid. |
| Document cookie access | HTML supplies non-HTTP access and live browser context to the existing store. |
| Session-only cookies, additional third-party restrictions, persistence, and CHIPS | Explicit browser policy/storage work. The reviewed layered draft does not define Partitioned processing. |
| Proxy authentication | Requires a configured proxy/tunnel transport, proxy identity, and proof credentials do not leak to the origin. The current direct transport declines proxy prompts. |
| Other authentication schemes, Retry-After scheduling, or trailer consumers | Add only with a concrete consumer and its scheme/retry/transport contract. Parsing a header does not enable the behavior. |

The remaining pure HTTP helpers have no missing HTML dependency. Add protocol
rules as those consumers arrive; do not create a parallel request or cache model.

## Cache

[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html) and
[RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html) govern the reusable rules.
The current private cache does not store malformed Cache-Control/Vary, wildcard
Vary, partial responses, or must-understand responses. A 304 updates an existing
entry rather than becoming a new entry. Qualified no-cache is treated as
unqualified. Shared-cache-only s-maxage and proxy-revalidate have no effect.

Future partial storage needs strong validators, encoded-byte range/length
checks, and actual relative-clock evidence before treating Last-Modified as
strong ([RFC 9110 §8.8.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2)).
A one-second Date/Last-Modified gap alone is insufficient. Multipart/byteranges
requires its own consumer; multipart/form-data is not that parser.

Stale-if-error is not an unconditional network-error fallback. Request gates,
revalidation, and error classification stay in Fetch. RFC 9111 obsoletes Warning;
the older RFC 5861 references do not require adding that field's processing.

## Authentication

The following choices and browser evidence were reviewed on 2026-09-24.
Windows Playwright WebKit is not a Safari policy oracle.

- **basic-challenge-validation:** require a realm and unique parameter names,
  as [RFC 7617 §2](https://www.rfc-editor.org/rfc/rfc7617.html#section-2) and
  [RFC 9110 §11.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.2) specify.
  Skip an invalid Basic challenge and continue to a later valid one. Unknown
  extensions/charset advice are ignored. Chromium accepts missing realms and
  chooses the last repeated realm; Gecko accepts missing realms and chooses the
  first. Evidence: [Chromium Basic handler](https://chromium.googlesource.com/chromium/src/+/main/net/http/http_auth_handler_basic.cc)
  and [Gecko authentication tests](https://searchfox.org/mozilla-central/source/netwerk/test/unit/test_authentication.js).
- **basic-credential-normalization:** preserve input and encode UTF-8, including
  when charset=UTF-8 is advertised. Chromium, Gecko, and WebKit's shared Basic
  serializer do this. [RFC 7617 §2.1](https://www.rfc-editor.org/rfc/rfc7617.html#section-2.1)
  describes NFC as the server's expectation; its charset advice is optional.
  Normalizing only at transmission can change an existing password.
  [Fielding](https://mailarchive.ietf.org/arch/msg/http-auth/jcxUEEUp3b2duKJIAFkgqija6R8/)
  and [Reschke](https://mailarchive.ietf.org/arch/msg/http-auth/6qmuXA6ETnh21wbWi-Pe_tvE53o/)
  discuss that compatibility cost. Support Unicode scalar values and reject
  unpaired surrogates/ASCII controls; do not introduce a full PRECIS validator
  or extra case/width/space mappings. Realm labels remain opaque.
- **basic-scope-selection:** prefer the longest matching authenticated directory,
  then the most recently authenticated entry. Preserve nested scopes; lookup
  does not refresh authentication order. [RFC 7617 §2.2](https://www.rfc-editor.org/rfc/rfc7617.html#section-2.2)
  leaves overlapping priority unspecified. [Chromium](https://github.com/chromium/chromium/blob/main/net/http/http_auth_cache.cc)
  prefers the longest path but the first tie; [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/network/CredentialStorage.cpp)
  prefers the closest directory and replaces its default realm, matching our
  tie rule. [Gecko](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttpAuthCache.cpp)
  selects the first matching entry, with newly added realms first.
- **basic-authored-authorization:** return a rejected authored Authorization
  response without prompting/retrying. Fetch preserves the authored field on
  retry, so a new prompt cannot replace it. Gecko's test_wrong_stored_passwd
  and [HttpChannel](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttpChannel.cpp)
  take this route. A Playwright 1.61.1 probe with valid automation credentials
  and a rejected explicit header saw one request in Firefox 151, two unchanged
  requests in Chromium 149.0.7827.55/WebKit 26.5, and 401 in all three.
  The caller can issue a new request with a changed or omitted header.
- **Prompted versus automatic retries:** a fresh prompt may deliberately return
  a previously rejected pair. Automatic cache reuse may not repeat it, including
  via a concurrent replacement. Rejection history is scoped to the HTTP realm
  within one transaction; a 421 does not count as a credential failure.
  [RFC 9110 §15.5.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2)
  recommends presenting repeated failures; Fetch supplies no prompt-attempt bound.
  [Chromium](https://github.com/chromium/chromium/blob/main/net/http/http_auth_controller.cc),
  [Gecko](https://searchfox.org/mozilla-central/source/netwerk/protocol/http/nsHttpChannelAuthProvider.cpp),
  and [WebKit Cocoa](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/NetworkProcess/cocoa/NetworkDataTaskCocoa.mm)
  distinguish invalidating stored credentials from accepting fresh prompt input.
  The host receives previousFailed and can decline; the 401 body remains readable.

The [credential store](../browlet/loader/authentication.ts) belongs to UserAgent,
keyed by scheme/host/port and exact HTTP realm. Failures remove entries by identity;
clearing advances a generation so in-flight answers cannot repopulate the store.
Cancellation settles Fetch and aborts the host prompt signal. Generated credentials
stay on the wire request; replay, credentials-mode, and origin gates stay in Fetch.
The host prompt declines by default and retains no page realm or Binding Context.

## Cookies

The [layered-cookies draft](https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html)
was reviewed through §§1–9 on 2026-09-20; the live §5.4 source was dated 2026-09-17.
Local revision 1057fe0f1570aa539eb90502411995e28ba304c7 predates live corrections to
default-path cloning and segment matching. Recheck the draft when extending it.
Use its lenient consumer algorithms, not the producer grammar, for incoming cookies.
Keep Set-Cookie fields separate; cookies alone do not prohibit response caching.

**cookie-samesite-context**, approved 2026-09-21: Fetch's draft shared retrieval
mode disagrees with browser navigation, subresource, and storage rules. Follow
Chromium's distinct sending and acceptance decisions in [Fetch policy](../fetch/policy.ts):

- Compare schemeful sites using the current target and actual client/ancestry.
  A clientless subresource is cross-site; a null top-level navigation initiator
  denotes browser initiation. Top-level responses can store Strict/Lax even
  when the request could not send them.
- Classify redirects by the current target. In a 2026-09-21 A-to-B-to-A probe,
  Chromium 149 sent Strict again on return to A; Firefox 151 withheld it.
  Chromium's full-chain CookieSameSiteConsidersRedirectChain option is disabled
  by default; Browlet does not enable the stricter variant implicitly.
- Apply Lax-by-default, with a two-minute creation-age exception for unset
  cookies on unsafe top-level navigations. Explicit Lax never gets the exception.
  Replacement preserves creation time. The cookie core's age parameter defaults
  to unrestricted; Fetch supplies the two-minute limit.

Source evidence: [Chromium request/response contexts](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/net/cookies/cookie_util.cc#L908),
[Gecko cookie decisions](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/netwerk/cookie/CookieService.cpp#L141),
and [WebKit SameSiteInfo](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/platform/network/SameSiteInfo.cpp#L34).
Gecko's reviewed lax-by-default configuration was off; its optional POST grace
uses update time. Windows WebKit's curl lookup ignores SameSiteInfo, while Cocoa
delegates to platform storage. Neither establishes a Safari grace-period rule.
Reproducible probes remain in node-compat/experimental/cookies: same-site-context.mjs
and redirect-context.mjs, with findings in that independent repository's README.

Reviewed draft corrections, approved 2026-09-20, remain beside the algorithms:
Max-Age precedence survives the attribute loop; Expires tests the parsed value
and clamps to now plus the lifetime; retrieval orders by serialized path length.
Chromium 149.0.7827.55, Firefox 151, and Windows WebKit 26.5 probes agreed on
precedence and ordering. Chromium/Firefox capped expiry at 400 days; WebKit kept
the later date. Browlet retains the draft's 400-day limit. Source comparisons:
[Chromium expiration](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/canonical_cookie.cc),
[ordering](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/cookie_monster.cc),
and Gecko CookieParser::GetExpiry/CookieCommons::MaybeCapExpiry.

UserAgent.cookiesEnabled suppresses sending and storage without deleting the jar.
Third-party access is permitted subject to SameSite; stronger restrictions and
session-only policy remain explicit future work. Cookie isSecure follows the
request's HTTPS scheme, independently of BrowletEnvironment.isSecureContext. Document
access, actual iframe/worker lifecycle, and CHIPS need their respective owners.

## Transport boundary and evidence

Browlet uses Undici's dispatcher, not its Fetch, cache interceptor, or retry
handler. The [vendor notes](../../vendor/README.md) and
[issue notes](../../scratch/SPEC-ISSUES.md) own the raw-header, unsolicited-100,
and bodyless-304 repairs. Retain those regressions when updating the dependency.

The HTTP/2 response-start fallback records decoded-header receipt when Undici
omits the interim notification. This approximates first-byte timing; moving the
same callback into Undici would not improve precision. A lower-level observation
is needed for that. The [transport](../browlet/integration/network/node-transport.ts) owns it.

Transport tests retain informational/final separation, HEAD/304 representation
lengths, framing failures, unknown status codes, and HTTP/2 refusal recovery.
Ordinary 408/413/503 responses are not automatically replayed, nor are consumed
upload iterators. Trailers stay separate and currently have no consumer.
Expect negotiation, arbitrary status retries, and a separate wire stack remain out of scope.

## Verification

Pure algorithms: test/http, including HTTPWG structured-field fixtures.
Consumer coverage: test/fetch, test/mime, test/browlet/http-authentication.test.ts,
Fetch network/cache and framing tests, loader transport tests, and Reporting.
Cookie policy tests cover sending/storage, disabling, redirects, and grace periods;
Window environment tests cover live ancestry. These are evidence for their tested
scope, not claims that unfinished Document/worker integration is complete.
