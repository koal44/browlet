# Browsing policy roadmap

The current files hold policy slots and defaults needed by Document and
navigation. UserAgent owns origin/URL trustworthiness. The remaining policy
languages and enforcement algorithms are tracked below.

| File | Missing contract | Specification |
| --- | --- | --- |
| `scripting/agents.ts` plus loader response processing | `Origin-Agent-Cluster` parsing, historical key selection, and agent-cluster-key consequences | HTML §7.1.2 |
| `coop.ts` | Response parsing, enforcement result, browsing-context group switching, reporting | HTML §7.1.3 |
| `coep.ts` | Response processing, inheritance, enforcement, reporting | HTML §7.1.4 |
| `sandbox.ts` | Parsing sandbox tokens, determining flags, propagation and navigation checks | HTML §7.1.5 |
| iframe element plus Document ancestry | iframe referrer-policy inheritance and ancestor-origin list construction | HTML §7.1.6 |
| `permissions.ts` | HTML's policy-controlled feature definitions/default allowlists plus declared, inherited, and container policy checks | HTML §2.2; Permissions Policy; HTML Document, browsing-context, and lifecycle integration |
| `container.ts` | Complete CSP copying and determine policy container; response policy association | HTML §7.1.7 |

Policy data travels with environments, Documents, history entries, responses,
and navigations. Keep one typed value model here and apply each specification's
explicit clone or identity rule; do not duplicate policy state in each
subsystem.

`PolicyContainer` now owns `clone()`. Fetch's client population calls it through
the same HTML object; clientless requests obtain a fresh default container from
their UserAgent. COEP fields and referrer policy copy independently, and each
new container has independent default policy storage. Populated CSP lists
explicitly reject cloning until CSP supplies its concrete records and copying.
Integrity Policy has typed source, destination, and endpoint lists. Both
enforced and report-only policies copy independently, following Gecko's
behavior; HTML's clone algorithm omits its report-only member.

COEP's value and reporting fields now have their specified defaults. Fetch's
request credentials predicate reads the actual client's embedder-policy value;
response-header delivery and the remaining policy lifecycle are still pending.

Worker globals receive policy-container and embedder-policy state while their
top-level script response is processed; worklet settings clone the creator's
policy container. Worker/worklet modules should retain those specified
identity rules instead of copying an ad hoc policy subset during realm setup
(HTML §§10.2.1, 10.2.4, and 11.3.1.3).

Response-bearing navigation installs response policies; Fetch applies their
request/response checks for its clients. Nested
browsing adds sandbox flags, referrer and container policy, COEP, and
Window/Location access checks; top-level cross-origin navigation separately
adds COOP browsing-context-group switching. The loader passes response headers
to the owning policy parser; policy meaning and inherited state remain here.

Blink's `core/frame/policy_container.*` and
`platform/loader/fetch/policy_container_utils.*` demonstrate the useful split
between the container's state and response/fetch conversion. Browser-side
loader adaptation remains in `loader/`; the independent Fetch implementation
lives in `src/fetch`.

## Fetch-facing policy work

This section owns the policies implemented directly in this folder. The
[CSP roadmap](csp/ROADMAP.md) owns CSP details, and
[Reporting](../../reporting/ROADMAP.md) owns shared report delivery. Fetch owns
request/response processing and invokes these browser policies through
explicit integration. Implementation order is in the
[Fetch preflight](../../../fetch/PREFLIGHT.md#work-order).

Source paths below are relative to that preflight's local reference root.
Except for trustworthiness, these algorithms are planned; existing slots are
not working enforcement.

### Trustworthiness

[Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/), local
`w3c-secure-contexts/index.bs`, defines the trustworthiness methods on
[`UserAgent`](../../user-agent.ts). Origin/URL trustworthiness is
implemented and tested for secure schemes, loopback/localhost, opaque origins,
files, special URLs, blob creator origins, and configured trust exceptions.
The UserAgent owns authenticated schemes and exact trusted-origin overrides.
File origins retain distinct opaque identities with a potentially-trustworthy
flag; the flag does not itself classify an environment as secure.

`createWindowEnvironment()` shares Window initialization between initial
browsing-context creation and navigation. `Environment` owns the fixed security
decision before realm creation; the Realm reads it for Web IDL exposure, and
settings inherit it for `WindowOrWorkerGlobalScope.isSecureContext`. A reserved
environment supplies its existing decision. Otherwise the helper classifies
the selected origin and parent Window. The parent's decision includes its
ancestors, so an insecure intermediate frame prevents a secure descendant.
Navigation creates a new decision when it creates a new Window.

Tests cover the supported top-level lifecycle, inherited origins and composed
parent/child Windows, and `[SecureContext]` interface/member exposure. Full
iframe/popup creation, sandbox origin derivation and trust inheritance, and
worker/worklet inheritance remain with those unfinished lifecycles. Referrer
Policy and Fetch Metadata will consume the same trustworthiness algorithms.

### Referrer Policy

Read [Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/), local
`w3c-referrer-policy/index.src.html`, including all policy values and §8.
Implement header parsing, referrer calculation/stripping, and redirect updates.
HTML supplies delivery/inheritance and Fetch supplies request/client records.
Reuse trustworthiness for downgrade decisions.

`referrer-policy.ts` supplies the enum declaration used by Request/RequestInit,
header parsing (§8.1), redirect policy updates (§8.2), referrer calculation (§8.3),
and URL stripping (§8.4). Header parsing uses
the declared grammar: ASCII case-insensitive policy tokens, unknown letter/hyphen
extensions, and whole-value rejection for malformed tokens. Chromium follows
that rejection rule; Gecko and WebKit ignore individual malformed tokens.
Absent or rejected headers do not replace a request's existing policy.

Referrer calculation consumes the client's `getReferrerSource()` and the owning
UserAgent's URL trustworthiness algorithm. Window settings read the Document's
existing URL and srcdoc flag; other settings use their creation URL. Stripping
produces independent copies. Tests cover all eight policies, the length limit,
same-/cross-origin requests, loopback and configured trust, credentials/fragments,
and redirects.

The srcdoc container relationship is provisional: `Navigable.container` returns
null until HTML supplies the container's content navigable. The source-selection
algorithm follows the intended relationship and throws when a srcdoc Document
lacks it. The loaded-iframe referrer test in `test/browlet/scripting/environment.test.ts`
is an authorized expected failure, currently at the missing content Document.
Complete that lifecycle under the browsing roadmap, then cover nested srcdoc and
containers in inactive predecessor Documents. Do not substitute the base URL
or current parent navigable's active Document.
Policy delivery/inheritance through responses, elements, and stylesheets is
still pending with the corresponding loader/HTML/CSS consumers.

Next test actual loader/element delivery; the stored default policy is only
the starting value. Main Fetch and HTTP redirects will call the policy algorithms
in Fetch Slices 8–9.

### Integrity Policy

Read the Integrity-Policy section of
[Subresource Integrity](https://w3c.github.io/webappsec-subresource-integrity/),
local `w3c-subresource-integrity/index.bs`. Implement structured-field policy
parsing, container association, and request enforce/report-only decisions.
It depends on [structured fields](../../../http/struct-fields/README.md),
Fetch records, and Reporting. Byte/hash verification is owned by
[Fetch's integrity work](../../../fetch/ROADMAP.md#subresource-integrity).

That plan divides the combined work into three slices. Slice 1 supplies SRI
metadata and digest verification and is complete. Slice 2 here supplies the
policy model, both header parsers, container association and independent copying,
and is complete. Slice 3's blocking/report-only checks and violation bodies
are also complete through the actual settings object's Reporting seam.
Reporting B connects report generation, Window queues, and local observers;
outbound delivery and destruction integration remain with Reporting and HTML.

`IntegrityPolicy.parse(headers, headerName)` consumes the existing HTTP
Structured Fields parser. `PolicyContainer.parseIntegrityPolicyHeaders(response)`
associates enforcement and report-only headers independently. An absent
header preserves the existing policy; an invalid present header replaces
only its policy with an empty one. The entire dictionary is validated before
defaults are applied: every member must be an inner list of tokens, including
unrecognized keys. Valid unknown keys/tokens are ignored, and valid Structured
Fields parameters do not alter policy interpretation.

The reviewed choices are:

- HTML's container clone omits report-only integrity state. Gecko's
  `IntegrityPolicy::InitFromOther` copies both policies, and Chromium's
  policy-container conversions carry both. Copying both independently is
  accepted and covered by populated-policy regression tests.
- The draft requires inner lists of tokens but leaves malformed-field
  handling unspecified. Chromium and WebKit skip non-token items; Gecko
  rejects the affected policy. A present, non-list `sources` field also
  differs: Chromium leaves sources empty, while Gecko/WebKit default to
  `inline`. Browlet consistently rejects the whole header for malformed
  structure, as requested by Eric. A missing `sources` key defaults to
  `inline`; an explicit empty or unsupported-token list stays empty.
  Examples and source pointers are in `scratch/SPEC-ISSUES.md`.

Tests cover both destinations, sources, endpoint names, repeated headers,
malformed syntax and types, independent header association, and cloning both
policies through an actual Window's Fetch client population. Automatic
response delivery still belongs to the unfinished HTML loader/navigation
consumer. `FetchRequest.isBlockedByIntegrityPolicy()` returns
a boolean and submits violations of either policy using the request client's
live reporting URL. Its observer-facing `IntegrityViolationReportBodyImpl` inherits
Reporting's `ReportBodyImpl`, following the approved browser interface model;
`reportOnly` stays a boolean. Fetch still submits plain producer data.
Main Fetch must invoke
this operation after populating the request's policy container. Workers must supply
their own reporting URL when their settings implementation is introduced.

The report loops follow the draft and Gecko/WebKit, one submission per endpoint;
an enforced policy still blocks when its endpoint list is empty. Reporting URL
stripping preserves the source and removes the fragment delimiter entirely,
matching Gecko/Blink rather than the draft's mutation and empty-fragment wording.
The approved departure and observer-count difference are recorded in
`scratch/SPEC-ISSUES.md`.

### HSTS

Read [RFC 6797](https://www.rfc-editor.org/rfc/rfc6797.html) §§6.1 and 8,
local `rfcs/rfc6797.txt`. Implement header processing, host storage, expiry,
`max-age=0` removal, includeSubDomains matching, and URI/port upgrade rules.
The User Agent owns this host state; it is not a per-Document policy-container
slot. Fetch consumes host matching and upgrades; transport supplies verified
secure-connection results and enforces the required failure behavior.

Keep this detour in two slices:

- **A — Header processing and remembered hosts:** `hsts.ts` now supplies
  `HSTSPolicy.parse()` and `HSTSStore`, owned by `UserAgent.hstsStore`.
  Processing uses the first STS field only, requires verified TLS without
  errors or warnings, excludes IP addresses, and supports refresh, exact-host
  removal, and expiry. URL supplies IDNA/case normalization; the DNS root dot
  is omitted from the storage key. Lifetimes and absolute expiry use bigint
  so valid delta-seconds cannot overflow. Parsing expects an already unfolded
  HTTP field value. These independent operations have focused tests; the
  network response caller remains with Fetch's HTTP-network fetch work.
- **B — Matching, upgrading, and consumer contracts:** `HSTSStore.requiresHTTPS()`
  checks the exact host and successive DNS-label ancestors, requiring
  includeSubDomains for inherited protection. Expired entries are ignored and
  removed along that path; a closer entry, removal, or expiry cannot suppress a
  covering ancestor. `FetchRequest.upgradeForHSTS()` uses the owning UserAgent's
  store through Fetch's narrow contract, including for clientless requests.
  It upgrades the current HTTP URL, preserves non-default ports and other URL
  components, and applies Fetch's localhost/public-suffix exception. Parsed port
  80 is already null; explicit 443 is normalized to HTTPS's null default port.
  Both slices' independent algorithms and their store-to-request integration
  are implemented and tested. The dispatch and transport calls below remain.

Expired entries are removed along the lookup path, as in Chromium and Gecko.
Accepting a valid policy also sweeps unrelated expired entries at most once
per minute; missing, invalid, or unauthenticated policies do not trigger a
sweep. This uses one timestamp, without a background timer. Focused tests
cover the maintenance interval, eligibility, explicit sweeping, and immediate
rejection of expired policies during lookup. The full RFC audit and browser
source comparison are recorded in `scratch/HSTS-AUDIT.md`.

Accepted parser choice: follow §6.1's rule that every directive may appear only
once, rejecting the whole header even for repeated unknown extensions. Gecko's
`nsSiteSecurityService::ParseSSSHeaders` and Chromium's
[`ParseHSTSHeader`](https://github.com/chromium/chromium/blob/main/net/http/http_security_headers.cc)
reject repetitions only of recognized directives. WebKit's libsoup-based ports
use [`soup_header_parse_semi_param_list_strict`](https://github.com/GNOME/libsoup/blob/master/libsoup/soup-headers.c),
which rejects all duplicate names, case-insensitively. This does not establish
Safari's behavior: its HSTS implementation belongs to Apple's networking stack.
These are source comparisons, not fresh browser probes. Well-formed unknown
directives are ignored; malformed directives invalidate the complete policy.
The RFC also specifies quoted-string unescaping before checking max-age.
Browser lifetime caps are implementation choices; no preload list, disk
persistence, or arbitrary age cap is introduced here.

Consumer gates:

- **Fetch 8A:** call `request.upgradeForHSTS()` in main fetch after referrer
  selection, including on redirect re-entry, before dispatch. Construction must
  not perform this step early. The same Fetch step's DNS HTTPS-record condition
  still needs the DNS/transport owner; this method implements only its HSTS branch.
- **Fetch 9:** on an unfiltered network response, reach
  `userAgent.hstsStore.processResponse(response, hasValidTLS)` with actual
  authenticated connection evidence. Extend Fetch's store contract at that
  consumer. A response URL alone, cached response, or synthetic Response cannot
  supply the TLS proof. `requiresHTTPS(host)` also supplies the connection's HSTS
  requirement for RFC §8.4: every TLS error or warning must terminate the
  connection, without an HTTP fallback or user bypass. This applies to direct
  HTTPS loads too, not only requests that were upgraded.
- **Transport regression details:** preserve separate STS fields and their
  arrival order, process each verified redirect response before following its
  Location, and include non-2xx responses. Test a configured trusted CA
  separately from bypassed certificate errors; the latter must not qualify as
  verified transport or bypass an existing HSTS requirement.
- **HTML meta:** when adding `http-equiv` processing, prove that
  `Strict-Transport-Security` is ignored for both learning and removal (§8.5).

Focused tests cover learning over secure versus insecure transport, duplicate
rejection, expiry, inherited matching, port mapping, redirects, and UserAgent
isolation with controlled clocks. The real transport must add proof of TLS
failure behavior; it cannot be demonstrated by these synchronous policy tests.
Preload distribution and disk persistence remain explicit host choices.
Section 12's configured policies and deliberate per-host deletion are optional
host features, not new preflight prerequisites. If persistent/private profiles
or browsing-data clearing are added, explicitly address HSTS retention and
deletion because the store can encode browsing history (§14.9).

HTTP Public Key Pinning (RFC 7469) is not a prerequisite or planned feature.
Its mention in SRI's introduction is an informative reference: dynamic HPKP was
[removed in Chrome 72](https://developer.chrome.com/blog/chrome-72-deps-rems#remove-http-based-public-key-pinning)
and [disabled in Firefox 72](https://bugzilla.mozilla.org/show_bug.cgi?id=1412438#c23).
Application-configured certificate pins would be a separate transport feature,
not part of HSTS or SRI.

### Mixed Content and Upgrade Insecure Requests

Read [Mixed Content](https://w3c.github.io/webappsec-mixed-content/) and
[Upgrade Insecure Requests](https://w3c.github.io/webappsec-upgrade-insecure-requests/),
local `w3c-mixed-content/index.bs` and `w3c-upgrade-insecure-requests/index.bs`.
Both complete sources have been reviewed. Keep this as one algorithm slice;
CSP's own review remains a separate preflight task.

**Independent algorithms implemented:** `Environment.prohibitsMixedSecurityContexts()` checks the
origin and Window ancestors, independently of secure-context classification.
`FetchRequest.upgradeInsecureRequest()` applies the enforced policy and sets
the navigation preference header; `upgradeMixedContent()` upgrades eligible
images, audio, and video before blocking.
`FetchRequest.isBlockedByMixedContent()` and
`FetchResponse.isBlockedByMixedContent(request)` supply the blocking checks.
`FetchResponse.isMixedDownload(sourceURL, env)` checks every response URL hop
against the initiating Document URL. There is no mixed-content override setting;
the optional user bypass and additional form-warning UI are not implemented.

`InsecureRequestsPolicy` groups the upgrade flag and navigation targets on the
Environment and BrowsingContext. Nested-context creation copies the embedding
environment's enabled policy; Document initialization copies context policy
before CSP initialization. Window reuse clears the previous Document's own
directive state. Full iframe creation still reaches the existing unfinished
HTML creator/embedding helpers; the tests compose real navigables and separately
exercise policy inheritance during the implemented Document creation path.

**Reviewed choices:** both upgrades rewrite the current URL, preserving earlier
redirect hops. Mixed Content follows the algorithm's CORS-image eligibility;
ordinary CORS checks still apply. Navigation targets match host and port by
value. UIR exempts trustworthy HTTP targets such as localhost, following
Chromium and Gecko. See [the source comparison notes](../../../../scratch/SPEC-ISSUES.md#mixed-content--upgrade-insecure-requests-reviewed-interpretations).
The preference header is set on every navigation, as permitted by UIR, and
redirect re-entry does not duplicate it. Tests cover both upgrades, their
ordering with blocking, form submissions, ports, IP hosts, and redirects.

Consumer gates:

- **CSP:** an enforced `upgrade-insecure-requests` directive calls
  `env.insecureRequestsPolicy.enableFor(protectedResourceURL)`; report-only
  delivery must not enable it. No CSP parser or directive dispatch is added here.
- **Fetch 8A:** report monitored-policy violations before either upgrade;
  apply UIR, mixed-content upgrading, and then request blocking. Apply enforced
  CSP after rewriting. Fill the internal response URL list before response
  blocking. Failed HTTPS upgrades must not retry plaintext. HSTS keeps its own
  later stage and transport verification remains mandatory.
- **HTML navigation/forms:** supply `FetchRequest.isFormSubmission` for GET
  as well as POST forms, and distinguish top-level `document` from nested
  destinations. The method alone cannot identify a form submission.
- **HTML downloads:** call `response.isMixedDownload(sourceDocument.url, env)`
  before accepting either navigation or hyperlink downloads. A secure final URL
  does not erase an insecure redirect hop.
- **Workers:** inherit both upgrade state and targets at creation, once the
  worker lifecycle exists. Reports belong to the initiating worker/document,
  not to the ancestor from which an upgrade policy was inherited.
- **CSP violation destinations:** UIR [§5.2](https://w3c.github.io/webappsec-upgrade-insecure-requests/#violation-report-target)
  also forbids sending `SecurityPolicyViolationEvent` to another Document.
  Inherited upgrade state must not redirect either reports or events to the
  ancestor that originally enabled it.

The obsolete `block-all-mixed-content` directive does not need a second policy
flag. These policies do not replace HSTS or TLS verification.

#### Mixed Content audit

The complete Mixed Content source was audited against the implementation and
its consumer gates. The reviewed choices above are intentional departures;
no additional mandatory algorithm step was found missing from the independent
methods.

| Sections | Coverage |
| --- | --- |
| 1–3: introduction, definitions, content categories | Trustworthiness uses the existing UserAgent algorithms; destinations and `imageset` distinguish automatic-upgrade eligibility. |
| 4.1–4.2: upgrading and removal of the old category split | Current-URL upgrading checks trustworthiness, IP hosts, client restrictions, destination, and initiator before rewriting HTTP. |
| 4.3: environment classification | The environment's origin and every Window ancestor are checked independently of secure-context classification. Workers use the origin check when their environments exist. |
| 4.4–4.5: request and response blocking | The current request URL and final internal response URL are checked separately; top-level navigation is exempt. Optional user overrides are not exposed. |
| 5: Fetch and HTML integration | Upgrade-before-blocking and both download handoffs are recorded above. Main Fetch must populate the internal response URL list, including for responses supplied by Service Workers. |
| 6: obsolete strict checking | No `block-all-mixed-content` flag is needed. |
| 7: security considerations, forms, user controls | The upgrade categories are covered. Optional UI has the conditional requirements below. |
| 8 and generated index/references | No additional implementation algorithm. |

If optional UI is introduced later, retain these conditions:

- [§7.1](https://w3c.github.io/webappsec-mixed-content/#requirements-forms):
  insecure-form submission warnings should also cover redirects to insecure
  URLs and let the user abort.
- [§7.2](https://w3c.github.io/webappsec-mixed-content/#requirements-user-controls):
  any controls overriding blocking or automatic upgrading must also be exposed
  through accessibility APIs. Offering either override remains optional.

#### Upgrade Insecure Requests audit

The complete UIR source was audited in document order, retaining the reviewed
choices above. The independent request-upgrade algorithm covers the reached
requirements. The nested-context policy-owner issue found during the audit
has been corrected and covered by focused regression tests.

| Sections | Coverage |
| --- | --- |
| 1: introduction, goals, examples, recommendations | Upgrades preserve the resource target and restrict ordinary top-level links. Failed HTTPS requests must not fall back to HTTP; Fetch already records that gate. Server redirects and deployment advice are server responsibilities. |
| 2: concepts and terminology | Upgrade and host/port concepts have representations. Always sending the navigation preference header avoids needing preload-specific suppression or refresh scheduling. |
| 3.1: directive delivery and Mixed Content ordering | Enforced delivery has `enableFor()`; CSP parsing/dispatch remains planned. Report-only delivery must leave upgrade state unchanged. Upgrading precedes Mixed Content and enforced CSP checks. |
| 3.2: capability advertisement | Navigation requests set one `Upgrade-Insecure-Requests: 1` field, including HTTPS requests and redirect re-entry. Sending it on every navigation is permitted. |
| 3.3: inheritance | Policy state and target sets are copied independently from the embedding element's current Document; adoption, Document initialization, and Window reuse are covered. Worker creation remains a recorded consumer gate. |
| 3.4: monitored-policy reporting | The Fetch gate explicitly puts report-only checks before rewriting and enforced checks afterward. |
| 4.1–4.2: processing algorithms | The client policy, navigation/form distinction, host/port targets, current URL, and reviewed trustworthy-target exception are covered. |
| 5: security considerations | HSTS remains independent. Violation reports and events must stay with the initiating Document/Worker, as recorded above. |
| 6–9 and generated index/references | Optional header optimizations, authoring advice, registration details, acknowledgements, and references add no missing mandatory runtime algorithm. |

[`BrowsingContext.inheritInsecureRequestsPolicy()`](../browsing-context.ts)
uses the embedding element's current node document, as required by UIR
[§3.3](https://w3c.github.io/webappsec-upgrade-insecure-requests/#nesting).
The element retains its creation realm after adoption; that realm must not
choose the inherited flag or navigation targets. Focused regressions exercise
enabled-to-disabled, disabled-to-enabled, and differently targeted enabled
policies through real bindings. They supply adoption's node-document change
directly and call the same inheritance method used by context creation.

Full DOM adoption and nested-context construction remain unfinished HTML
lifecycle work. These tests cover the policy-inheritance step independently
of the existing creator/sandboxing gaps.

## Removal condition

Burn this file after all listed value models and their navigation/loader
integrations have behavior tests.
