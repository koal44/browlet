# Browsing policy roadmap

This folder owns browser policy values, response association, inheritance, and
the checks consumed by Fetch and HTML. Fetch's independent policy preflight is
complete; full navigation, nested contexts, elements, and workers still need
their owning integrations. [CSP](csp/ROADMAP.md) owns its language and violations;
[Reporting](../../reporting/ROADMAP.md) owns shared delivery.

## Remaining ownership

| Owner | Missing contract |
| --- | --- |
| Agent selection / loader | Origin-Agent-Cluster header processing, historical keys, and cluster consequences (HTML §7.1.2) |
| `coop.ts` | Response enforcement, group switching, and reporting (HTML §7.1.3) |
| `coep.ts` | Complete response processing/inheritance and navigation enforcement; Fetch already applies credentials/CORP checks (HTML §7.1.4) |
| Sandbox / iframe / navigation | Container-flag propagation and navigation checks; token parsing and combined CSP restrictions exist (HTML §7.1.5) |
| Document ancestry / iframe | Referrer inheritance, ancestor-origin lists, and real srcdoc container association (HTML §7.1.6) |
| `permissions.ts` | Declared, inherited, and container policies plus feature definitions/default allowlists (Permissions Policy; HTML §2.2) |
| `container.ts` / navigation | Complete policy-container selection, response association, and history/local-URL inheritance (HTML §7.1.7) |

## Policy state and composition

Policy values travel through environments, Documents, responses, navigation, and
history. Preserve each specification's clone/identity rule rather than copying
ad hoc subsets. PolicyContainer.clone copies populated CSP directives and their
self origin, COEP/referrer state, and both Integrity Policy dispositions.
A container without a known resource origin has no CSP list yet.

The bounded response-bearing Document creation path initializes CSP, sandbox,
upgrade policy, and Reporting endpoints. It is not the complete
navigation state machine. Worker top-level responses and worklet creation must
supply their specified inheritance rather than copying whichever fields are
convenient at realm setup.

Loader response adaptation stays with the loader. Fetch invokes policy through
its narrow contracts; policy languages and browser state remain here.
Blink's policy_container and policy_container_utils illustrate this division
without prescribing Browlet's file structure.

## Fetch-facing policy work

### Trustworthiness

[Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) origin/URL
trustworthiness is implemented on UserAgent, including secure schemes,
localhost/loopback, opaque/file/Blob origins, and configured trust exceptions.
A potentially trustworthy origin is not by itself a secure environment.

EnvironmentRecord owns the fixed decision before realm creation; the Realm reads
it for exposure and full settings retain it. Window initialization uses an
existing reserved decision or derives one from the selected origin and parent
Window, including insecure intermediate ancestors. New Window creation computes
a new decision. Full iframe/popup, sandbox, worker, and worklet inheritance remain
with those lifecycles.

### Referrer Policy

[Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/) parsing,
stripping, request calculation, and redirect updates are implemented and called
by Fetch. Window settings use the Document's URL/srcdoc state, not its base URL;
other settings use their creation URL. Stripping returns independent copies.

Header parsing follows the grammar: ASCII-insensitive tokens, unknown
letter/hyphen extensions, and whole-value rejection for malformed tokens.
Chromium follows that rejection rule; Gecko/WebKit skip malformed tokens.
Absent/rejected headers preserve the request's policy.

Complete element/stylesheet delivery and inherited state with their loaders.
Navigable.container is still provisional, so loaded srcdoc remains an approved
expected failure. Use the actual container element's node Document, including
inactive predecessors, rather than the current parent navigable's active Document.

### Integrity Policy

[Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/)
policy parsing, independent enforce/report-only association, cloning, blocking,
and violation bodies are implemented. Fetch invokes them and Reporting uploads
their reports. Byte/hash verification remains in [Fetch](../../../fetch/integrity.ts).

Validate the entire Structured Fields dictionary before applying defaults.
Every member must be an inner list of tokens, including unknown keys. Invalid
present fields replace only their policy with an empty policy; absent fields
preserve it. Missing sources defaults to inline, while an explicit empty or
unsupported-token list stays empty.

Retain both dispositions when cloning despite HTML omitting report-only state.
Malformed-field handling is a draft gap: Browlet rejects the whole header;
browser recovery differs. Report once per endpoint as the draft/Gecko/WebKit do;
an enforced policy still blocks with no endpoints. Preserve boolean reportOnly
and the concrete observer body. [Issue notes](../../../../scratch/SPEC-ISSUES.md#integrity-policy-malformed-structured-fields-and-stale-parser-call)
retain the reviewed parser/model differences. Automatic response-header delivery,
element/preload inputs, and full policy lifecycle remain owner work.

### HSTS

[RFC 6797](https://www.rfc-editor.org/rfc/rfc6797.html) was audited in full on
2026-09-22, including appendices, errata, and §12's non-normative advice.
The implemented browser algorithms are principally §§6.1 and 8; server emission
and Effective Request URI reconstruction are server responsibilities.

`UserAgent.hstsStore` owns remembered hosts across Documents. `HSTSPolicy.parse()`
expects an unfolded field value. Processing uses the first STS field only,
requires authenticated HTTPS without certificate errors, excludes IP addresses,
and supports refresh, exact-host removal, and expiry. Bigint lifetime arithmetic
avoids overflow. Missing headers preserve state; repeated identical max-age
values refresh expiry from receipt time, not the server's Date.

`requiresHTTPS()` checks exact hosts and DNS-label ancestors with
includeSubDomains. A child's removal or expiry cannot override a live parent.
Fetch's `upgradeForHSTS()` upgrades the current URL on main-fetch entry and
redirect re-entry, preserves non-default ports, and applies Fetch's
localhost/public-suffix exception. Network response processing learns policy
from actual TLS evidence before redirects, including non-2xx responses.

Accepted choices and evidence:

- Follow §6.1 by rejecting every duplicate directive, including unknown names.
  Gecko's `ParseSSSHeaders` and Chromium's
  [`ParseHSTSHeader`](https://github.com/chromium/chromium/blob/main/net/http/http_security_headers.cc)
  reject only repeated known directives. WebKit's libsoup ports use the
  [strict parameter parser](https://github.com/GNOME/libsoup/blob/master/libsoup/soup-headers.c),
  rejecting all duplicate names. Well-formed unknown directives are ignored;
  malformed ones invalidate the policy. Quoted values are unescaped first.
- Remove expired entries along the queried host path, as
  [Chromium](https://chromium.googlesource.com/chromium/src/+/main/net/http/transport_security_state.cc)
  and [Gecko](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/security/manager/ssl/nsSiteSecurityService.cpp#L904)
  do. Accepting a valid authenticated policy also sweeps unrelated expired
  entries at most once per minute. Ineligible responses do not trigger a sweep;
  lookups always ignore expired policy. No background timer or expiry heap.
  Gecko separately caps storage; [libsoup](https://github.com/GNOME/libsoup/blob/master/libsoup/hsts/soup-hsts-enforcer.c)
  sweeps on policy replacement/removal. Safari's CFNetwork eviction is not
  exposed by public WebKit source; libsoup evidence is not Safari evidence.
- Reuse URL's canonical host, omitting the DNS root dot for storage. URL's
  non-strict IDNA behavior can preserve ASCII labels rejected by strict IDNA
  (the URL test includes `xn--8i7caa`); do not introduce a conflicting HSTS-only
  host normalizer. RFC §13 permits UTS #46. Rejected errata
  [5372](https://www.rfc-editor.org/errata/eid5372) and
  [8153](https://www.rfc-editor.org/errata/eid8153) do not change refresh or create
  an RFC localhost exception; that exception comes from Fetch.

Remaining integration and host choices:

- HTML meta processing must ignore `Strict-Transport-Security` for both learning
  and removal (§8.5); retain a negative regression with the future consumer.
- HTTPS DNS-record upgrades are separate unfinished Fetch/transport work.
- Keep ordered, separate STS fields through transport and TLS verification
  distinct from bypassing certificate errors. HSTS requires termination on every
  TLS error or warning, without HTTP fallback or user bypass, including direct
  HTTPS loads (§8.4). Existing Fetch/transport tests
  cover field preservation, policy learning, verified TLS, and untrusted-certificate
  rejection; remaining Fetch transport work stays in its roadmap.
- Preloads, configured hosts, lifetime/capacity limits, disk persistence, and
  deliberate per-host deletion are optional host features. Profile/private-mode
  and browsing-data clearing work must address HSTS retention: state can encode
  browsing history (§14.9).

HTTP Public Key Pinning (RFC 7469) is not a prerequisite or planned feature.
Its mention in SRI's introduction is informative: dynamic HPKP was
[removed in Chrome 72](https://developer.chrome.com/blog/chrome-72-deps-rems#remove-http-based-public-key-pinning)
and [disabled in Firefox 72](https://bugzilla.mozilla.org/show_bug.cgi?id=1412438#c23).
Application-configured certificate pins would be a separate transport feature.

### Mixed Content and Upgrade Insecure Requests

[Mixed Content](https://w3c.github.io/webappsec-mixed-content/) and
[Upgrade Insecure Requests](https://w3c.github.io/webappsec-upgrade-insecure-requests/)
were audited in full. Independent algorithms and Fetch ordering are implemented:
monitored CSP reporting, UIR upgrade, eligible mixed-content upgrade, then
enforced request blocking; response checks follow URL-list population.
Failed HTTPS upgrades cannot fall back to plaintext. HSTS has its own stage.

The environment's mixed-security classification checks its origin and Window
ancestors separately from secure-context exposure. Mixed-download checks examine
all response URL hops against the initiating Document; a secure final hop cannot
erase an insecure redirect.

Approved choices use the current request URL, include eligible CORS images in
automatic mixed-content upgrading, compare navigation targets by host and port,
and exempt trustworthy HTTP UIR targets such as localhost. A single preference
header is set on every navigation. [Decision evidence](../../../../scratch/SPEC-ISSUES.md#mixed-content--upgrade-insecure-requests-reviewed-interpretations)
retains the specification/browser differences.

InsecureRequestsPolicy belongs to environments and browsing contexts.
Nested-context inheritance uses the embedding element's current node Document,
not its creation realm after adoption. Document initialization copies context
policy before CSP; Window reuse clears the former Document's directive state.
Focused tests cover inheritance independently of unfinished full DOM adoption
and nested-context construction.

Remaining consumers:

- Navigation/forms must supply form-submission state for GET as well as POST,
  and distinguish top-level document requests from nested destinations.
- Navigation and hyperlink downloads must call the mixed-download check before
  acceptance. Those HTML consumers remain unfinished.
- Worker creation must inherit upgrade state/targets and retain the initiating
  worker as the report recipient. Inherited policy must never route violations
  or SecurityPolicyViolationEvent to the ancestor that enabled it.
- Optional insecure-form warnings must cover redirects and permit cancellation;
  any optional override controls must also be accessible (Mixed Content §7).
  Browlet currently exposes no bypass. The obsolete block-all-mixed-content
  directive needs no second flag.

## Validation and sources

Tests cover parsing, independent policy copies, URL/origin decisions, real Fetch
checks/ordering, shared reports, active Document initialization, and composed
inheritance. Full iframe/navigation/worker behavior must be tested when its
owners exist; policy-unit coverage does not establish it.

Local sources under the [reference root](../../../fetch/README.md#sources) are
`w3c-secure-contexts/index.bs`, `w3c-referrer-policy/index.src.html`,
`w3c-subresource-integrity/index.bs`, `w3c-mixed-content/index.bs`, and
`w3c-upgrade-insecure-requests/index.bs`. Retained browser comparisons are
September 2026 evidence, not newly rerun observations.
