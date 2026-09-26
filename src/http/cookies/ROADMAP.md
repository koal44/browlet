# Cookies roadmap

This submodule owns cookie records, the cookie store, and the parsing, storage,
retrieval, and serialization algorithms. Fetch and HTML consume the same
implementation. Browlet owns store instances and supplies browser policy;
this project must not discover a process-global cookie jar or import Browlet.

**Status:** §§5.1–5.4 implemented: cookie records and predicates, store limits,
eviction, subcomponent parsing/matching, and the main parse/store/retrieve/serialize
algorithms. Each Browlet UserAgent owns a store. Fetch 7a now supplies cookie
header algorithms, SameSite decisions, and Window ancestry inputs; network
invocation and credentials checks remain in Fetch Slice 9. Document cookie
access remains a later HTML consumer.

## Sources

Use [Cookies: HTTP State Management Mechanism](https://httpwg.org/http-extensions/draft-ietf-httpbis-layered-cookies.html),
the layered-cookies draft currently referenced by Fetch. Record its revision
when implementing; it is a draft, not a published replacement RFC yet.

First slice implemented against the live draft and local checkout
`1057fe0f1570aa539eb90502411995e28ba304c7`, rechecked 2026-09-20.
The §5.3 slice follows the live draft retrieved 2026-09-20, which has since
corrected default-path cloning and changed path matching to compare segments.
Those corrections are not yet in that local revision.
The §5.4 slice follows the live draft dated 2026-09-17, retrieved 2026-09-20,
with the reviewed corrections below.

Local sources under the [reference root](../../fetch/PREFLIGHT.md#local-reference-inventory):

- `httpwg-http-extensions/draft-ietf-httpbis-layered-cookies.md`: §5
  user-agent records, eviction, subcomponent/main algorithms, and browser
  requirements; consult server syntax to interpret the wire format.
- `whatwg-fetch/fetch.bs`, §3.1: HTTP cookie integration and browser inputs.
- `whatwg-html/source`: cookie access through Document, same-site context,
  and other browser-owned decisions. The draft's non-browser user-agent
  defaults must not replace these rules.

## Requirements outside §5

Reviewed §§1–4 and §§6–9 on 2026-09-20:

- **§§1–4:** §3 directs browsers to the lenient consumer algorithms. Do not
  turn §4's producer grammar into an incoming-cookie validator or a second
  record model. Keep `Set-Cookie` fields separate; cookies alone do not make
  responses uncacheable (§4.1).
- **§6:** structured API guidance fits the planned records; no additional
  browser algorithm.
- **§7:** Browlet owns cookie management and disabling controls (SHOULD).
  Disabling MUST suppress outbound `Cookie` and inbound `Set-Cookie`
  processing. An optional session-only mode MUST treat received cookies as
  having null expiry. Decide third-party policy before browser integration;
  §7.1 recommends restrictions but prescribes no particular mechanism.
- **§8:** security guidance adds no browser algorithm. Keep cross-port sharing
  and arbitrary cookie paths in tests; paths are not security boundaries.
- **§9:** header registration only; no runtime work.

## Implementation order

1. **Complete: records, limits, and eviction (§§5.1–5.2).** `HTTPCookie`
   retains byte strings, URL paths, and Unix millisecond timestamps.
   `CookieStore` defaults to 50 cookies per host, 3000 total, and a 400-day age
   limit; applying the age limit belongs to parsing in §5.4. Eviction returns
   the original records in removal order and preserves survivor order.
2. **Complete: subcomponent algorithms (§5.3).** Cookie dates use the specified
   byte-token grammar, fixed two-digit-year rules, and strict calendar checks.
   Domain matching uses parsed hosts. Default paths copy the input; path
   matching compares URL segments without allocating a serialized path or clone.
3. **Complete: parse/store/retrieve/serialize (§5.4).** Includes Secure,
   HttpOnly, SameSite, all four name prefixes, overwrite protection,
   replacement, ordering, deletion, and eviction. A `Set-Cookie` value is processed
   separately; it must not be treated as a comma-combinable field.
4. **Fetch header integration complete; network and Document consumers deferred.**
   [Fetch Slice 7a](../../fetch/ROADMAP.md#slice-7--http-extensions) supplies §3.1's
   cookie header algorithms; Slice 9 connects them to network request/response
   processing and credentials decisions through its
   [HTTP integration](../../fetch/HTTP-ROADMAP.md).
   Browlet's Document implementation supplies non-HTTP access and the
   required browser context. The core does not infer those contexts from
   whichever realm happens to be executing.
   Preflight on 2026-09-20 reached a SameSite policy review: Fetch's current
   algorithm excludes Strict cookies on same-site navigations, excludes Lax on
   cross-site navigations, and omits the client/target-site check for ordinary
   subresources. Its GET/POST assertion and reuse of retrieval mode for storage
   also disagree with browser behavior. Reviewed with Eric on 2026-09-21:
   follow Chromium's distinct sending/acceptance rules, schemeful site
   comparisons, current-target redirect classification, and Lax-by-default with
   a two-minute creation-age exception for unsafe top-level navigations.
   A clientless subresource is cross-site; a null top-level navigation
   initiator denotes browser initiation. Top-level responses can store
   Strict/Lax cookies even when the request could not send them.
   The reproducible browser probe and findings are in the independent experimental
   repository's `cookies/same-site-context.mjs` and `cookies/README.md`.

   Browser source review on 2026-09-21 confirms the separate decisions:
   [Chromium](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/net/cookies/cookie_util.cc#L908)
   computes request and response contexts separately; ordinary top-level
   navigation responses can set Strict/Lax cookies even when the request
   could not send Strict cookies. Gecko likewise separates
   [`ProcessSameSiteCookieForForeignRequest`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/netwerk/cookie/CookieService.cpp#L141)
   from `CookieValidation::ValidateInContextInternal`. Its configurable
   `network.cookie.sameSite.laxByDefault` is off in this checkout, consistent
   with the probe's unset-cookie result. [WebKit](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/platform/network/SameSiteInfo.cpp#L34)
   passes same-site, top-level-navigation, and safe-method
   facts to its platform cookie backend; the Windows curl lookup ignores
   `SameSiteInfo`, so its divergent result is not a Safari policy oracle.

   A fresh 2026-09-21 A-to-B-to-A navigation/fetch probe confirmed Chromium
   149 sends Strict again when returning to A; Firefox 151 withholds it.
   Follow Chromium's default here, which leaves
   `CookieSameSiteConsidersRedirectChain` disabled. The stricter full-chain
   variant is not enabled implicitly in Browlet. The reproducible observation
   is `experimental/cookies/redirect-context.mjs` under `node-compat/`.

   Chromium's age exception preserves legacy sign-in flows which return
   through a cross-site top-level POST; explicit Lax cookies never receive it.
   Gecko also has a 120-second `laxPlusPOST.timeout` preference, but checks
   update time and gates it behind its lax-by-default configuration. WebKit's
   Cocoa code delegates cookie selection to the platform storage backend;
   that source does not establish a Safari grace-period rule. Our policy is
   Chromium's creation-time rule: replacement preserves the original time.
   `retrieveCookies` takes an optional maximum unset-cookie age, applied only
   in unset-or-less mode before access times change. The core's default
   remains unrestricted; Fetch supplies the two-minute limit.

   `UserAgent.cookiesEnabled` controls both sending and storage without
   deleting cookies. The default permits third-party access subject to SameSite.
   Blanket third-party blocking, tracking exceptions, session-only controls,
   and persistence remain explicit later browser policy, not hidden defaults.

## Representation choices

- Names and values use byte strings, as Fetch headers do: each U+0000–U+00FF
  code unit represents one byte. Convert bytes isomorphically, not through
  UTF-8 decoding. Preserve their case; only the reserved-prefix checks are
  case-insensitive. Construction and expiration read `Date.now()` directly.
- An absent host is `undefined`; a failed host parse is `null`. These must stay
  distinct for §5.4: a later Domain attribute can override a failed one; storage
  rejects a final failed host. `StoredHTTPCookie` narrows the same cookie's host
  to a domain or IP address; it does not allocate a second record.
- The store uses an insertion-ordered `Set` for direct removal by identity.
  Host eviction, global eviction, and sending order differ, and retrieval changes
  access times. Sort temporary lists when needed and preserve survivor order.
  Storage establishes uniqueness by name, host, host-only, and path. Even an indistinguishable
  replacement installs the new record, preserves creation time, and refreshes
  access time; its null result means no observable change, not necessarily rejection.
- `parseCookieDate` accepts the same byte-string representation and returns a
  Unix millisecond timestamp or `null` for failure. It cannot use `parseHTTPDate`:
  cookies ignore weekday/timezone labels, recognize more token forms, use a
  fixed year cutoff, and reject leap seconds. Sharing only their small calendar
  check would not simplify either parser.
- Cookie hosts retain URL's parsed domain/IP values. Matching, public-suffix
  decisions, and IP-specific host-only rules use that classification and
  canonical value, rather than depending on a serialized spelling. Reviewed
  §5.3.2's string parameter against §5.4's parsed-host callers; retain the
  parsed representation.
- `HTTPCookie.matchesDomain(host)` and `matchesPath(requestPath)` test the
  supplied host/path against the cookie's own scope. Host-only and public-suffix
  restrictions remain storage/retrieval decisions. `HTTPCookie.getDefaultPath`
  is static because parsing needs it before constructing a cookie; its input
  is a non-empty URL path list. Matching does not serialize, decode, or normalize
  paths. An unassigned/failed cookie host or an opaque cookie path cannot match.
- `HTTPCookie.parse(input, path, cookieAgeLimit)` constructs a cookie without
  depending on a store. Its trailing age limit is supplied in days; the draft's
  unused `isSecure` and `host` arguments are omitted. `CookieStore.parseAndStoreCookie`
  supplies its current limit, then applies storage policy. It returns null on
  parse failure, consistently with its storage result and the draft's caller.
  These signature adaptations have been reviewed and accepted.
- Parsing takes a non-empty URL path list. Retrieval accepts `URLPath` and
  returns no cookies for an opaque path, without updating access times. Storage
  also rejects an opaque cookie path because no request can match it.
- `HTTPCookie.serialize(cookies)` formats the supplied list as a byte string.
  Retrieval selects and orders cookies; serialization neither selects nor normalizes them.
- Gecko's `CookieStorage` is the closest ownership comparison. Its eviction
  code also prioritizes insecure cookies, but groups by base domain and adds
  quota/tie-break policy. Chromium has further priority and batch-purge rules;
  WebKit storage depends on its backend. Follow the draft's exact host equality
  and stable last-access ordering here, without importing those extensions.

## Draft corrections and browser comparison

Reviewed with Eric on 2026-09-20; these are deliberate departures from the
2026-09-17 draft, not literal implementations of its mistakes:

- **§5.4.2, Max-Age:** keep `maxAgeSeen` outside the attribute loop so a valid
  Max-Age overrides Expires regardless of their order. Invalid later attributes
  do not erase a previously valid value.
- **§5.4.2, Expires:** check the parsed `expiryTime` for failure, not the original
  attribute string. Clamp to `now + cookieAgeLimit`, not the duration alone.
- **§5.4.5, ordering:** compare serialized path lengths, including slashes,
  rather than URL path segment counts. Break ties by creation time.

Fresh Playwright probes confirmed Max-Age precedence and serialized-path ordering
in Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5. Chromium and Firefox
capped the far-future Expires value at 400 days; this WebKit build retained it.
We retain the draft's 400-day limit. The reproducible probe and observations are
in the independent experimental repository under `cookies/`.

Source comparisons: Gecko's `CookieParser::GetExpiry` gives Max-Age precedence,
and `CookieCommons::MaybeCapExpiry` adds the duration to the current time.
[Chromium's expiration parser](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/canonical_cookie.cc)
also prioritizes Max-Age, while its
[cookie sorter](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/cookies/cookie_monster.cc)
compares serialized path lengths.

Retrieval also excludes expired cookies between garbage-collection passes.
The draft lists eviction separately and Fetch does not clean the store before
retrieval. Filtering prevents stale cookies from being exposed without consuming
the removal report: garbage collection still returns those original records.

## Dependencies and stopping points

- URL supplies parsed hosts, host equality, public-suffix lookup, URL paths,
  and site comparisons. The completed cookie core uses these directly.
- Keep cookie `isSecure` separate from `Environment.isSecureContext`. The
  current Fetch §3.1 callers derive it from the request URL's HTTPS scheme.
- Window settings now expose HTML's live cross-site-ancestor answer, and Fetch
  consumes it in cookie classification. An inactive/detached Document does not
  establish a same-site context. Iframe loading and worker lifecycle are not
  claimed by the tests that compose Window settings and navigables directly.
- Fetch Slice 9 must call the header algorithms at the HTTP network boundary
  under its credentials decision. Document cookie access is still unfinished.
- The reviewed layered draft does not define a partition-key field or the
  `Partitioned` attribute algorithms; its source contains only a commented-out
  partition field. Review CHIPS and browser storage-partition policy separately
  before adding partition state or treating that coverage as complete.

## Exit proof and later scope

`test/http/cookies/` covers record defaults, prefix predicates, the strict
expiration boundary, eviction priority/order, limits, and domain/IP host
equality. It also covers date-token ordering, every delimiter byte, year/calendar
limits, domain suffix boundaries, default-path ownership, and literal path
segment matching. Parsing/storage/retrieval tests cover byte and attribute limits,
precedence, public suffixes, IP hosts, all prefixes, secure and HTTP-only overwrite
protection, unchanged replacements, deletion, SameSite modes, expiry, and path
ordering. Serialization preserves the supplied ordering and byte values.
`test/browlet/fetch-request.test.ts` checks shared ownership across
Window settings and separation between UserAgents.

`test/fetch/policy/cookies.test.ts` covers header processing, SameSite sending
versus acceptance, redirects, disabling, and the grace-period boundary.
`test/browlet/scripting/environment.test.ts` covers the real Window ancestry
query and a shared UserAgent store. Credentials omission and actual network
invocation remain Slice 9 acceptance tests; Document access remains HTML work.

Network cookie handling does not require implementing the separate Cookie
Store API or persistent storage. The core uses an in-memory store;
browser integration must address the §7 controls and policy above,
including tests for disabled cookies. Track any deferred controls explicitly.

Remove this roadmap when the core and reached browser consumers are covered,
with any remaining public API or persistence work assigned to its owner.
