# Browsing policy roadmap

This folder owns browser policy values, response association, inheritance, and
the checks consumed by Fetch and HTML. Fetch's independent policy preflight is
complete; full navigation, nested contexts, elements, and workers still need
their owning integrations. [CSP](csp/ROADMAP.md) owns its language and violations;
[Reporting](../../reporting/ROADMAP.md) owns shared delivery.

## Remaining ownership

| Owner | Missing contract |
| --- | --- |
| Agent selection / loader | Native isolation and WebAssembly.Module cloning/delivery consequences; OAC header processing and historical keys exist (HTML §7.1.2) |
| `coop.ts` / navigation / Reporting | Redirect-loop integration, URL-scoped reports, and cross-window access reports; supplied-response enforcement and group switching exist (HTML §7.1.3) |
| COEP / navigation / workers / Fetch | Child-container lifecycle, blocked-response network errors, worker startup, and PNA/ORB; inheritance checks and reports exist (HTML §7.1.4) |
| Sandbox / iframe / navigation | Child/popup lifecycle and flag consumers; attribute state, creation-flag union, and response preparation exist (HTML §7.1.5) |
| Document ancestry / iframe | Child-container lifecycle; iframe referrer-policy selection, reflection, and ancestry inputs exist (HTML §7.1.6) |
| `permissions.ts` | Declared, inherited, and container policies plus feature definitions/default allowlists (Permissions Policy; HTML §2.2). `Document.isAllowedToUse()` implements HTML's browsing-context/full-activity gates; feature evaluation for fully active Documents explicitly throws. |
| Policy containers / navigation / workers | Navigation source/target snapshots, history reconstruction, worker startup, and origin-independent empty CSP state; selection and initialization algorithms exist (HTML §7.1.7) |

## HTML 7.1.3 cross-origin opener policies

Audited the complete [COOP section](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies),
including its reporting algorithms, against HTML revision
[`9396777`](https://github.com/whatwg/html/tree/939677714df7379fee3667040113b41c91c851e7)
(26 October 2026). The COEP compatibility predicate and §7.1.4.1 header parser
were included as direct dependencies; the full §7.1.4 audit is recorded below.

| Requirement | Owner and result |
| --- | --- |
| Policy values and matching | `OpenerPolicy` retains both values and nullable endpoints. Matching uses strict origin equality, including opaque identity, and ignores domain relaxation. Two unsafe-none values match across origins. |
| Header processing | `OpenerPolicy.obtain()` uses Fetch's structured-item parser and the reserved environment's security decision. It accepts only tokens, applies string report-to parameters, rejects lists/quoted strings, and preserves the specified difference between enforced and report-only noopener-allow-popups. |
| COEP dependency | `EmbedderPolicy.obtain()` parses both dispositions. Enforced COOP promotion uses enforced COEP; report-only promotion accepts either COEP disposition. The internal same-origin-plus-COEP value is not accepted as a header token. |
| Popup and ordinary navigation comparisons | Static policy operations implement each branch, including the unsafe-none popup allowances and matching report-only suppression. Actual popup creation still needs creator/opener inheritance. |
| Response enforcement | `BrowsingContext.enforceResponseOpenerPolicy()` carries both accumulated switch flags, URL, origin, policy, and navigation-source state through repeated response checks. It retains the first initial URL and requests navigation reports only when another context shares the group. |
| Navigation integration | The supplied-response path reserves the destination environment, parses its policies, and computes enforcement before creating the document. Existing prepared results are retained. The Fetch navigation loop must call enforcement at every redirect and supply its actual source state. |
| Group selection | Required switches create a new top-level context/group; report-only switches change only the virtual group identifier. Final sandbox flags are cloned. Old contexts remain available to history. Optional cross-site/browser-UI/singleton swaps are not taken. Nested destinations retain their context. |
| Isolation capability | same-origin-plus-COEP selects logical isolation. Agent clusters become origin-keyed, but the host does not provide physical isolation. The WindowOrWorkerGlobalScope crossOriginIsolated member now forwards the existing environment capability; logical isolation reports false. |
| Report URL sanitization | `sanitizeURLForReport()` copies the URL, removes credentials, and excludes the fragment without applying Fetch's different non-HTTP stripping rule. |
| Navigation reports | `queueNavigationToReport()` and `queueNavigationFromReport()` are explicit unfinished operations. They return for an absent disposition endpoint and otherwise throw for the missing URL-scoped Reporting queue. Body construction, disclosure rules, and delivery remain unfinished. |
| Access reports | `BrowsingContext.checkAccessShouldBeReported()` is an explicit unfinished operation. WindowProxy/Location security hooks must invoke it with the accessing environment. All six body producers and their dispatcher remain required, as detailed below. |

Reporting dependencies are deliberately not routed through an arbitrary active
global. A response report can belong to an earlier redirect, a future document,
or a document that no longer owns a live global. Reporting must retain the URL's
endpoint configuration and lifetime, and accept that URL without rediscovering
an environment. COOP reports are not exposed to ReportingObserver.

Navigation-to bodies still need disposition, effectivePolicy, previousResponseURL,
referrer, and type. The previous URL is disclosed only for same-origin responses.
Navigation-from bodies need nextResponseURL, disclosed only for same-origin
responses or when the COOP response initiated the navigation. Referrer uses its
specified serialization; it is not replaced by a sanitized unrelated URL.

Access reporting must filter cross-origin-accessible property names, require
fully active documents, reject cross-origin ancestor chains, compare top-level
virtual group identities, and classify accessor-is-opener, accessor-is-openee,
or neither. The dispatcher must produce both directions for opener, openee,
and unrelated-window accesses, with the specified report-only same-origin gate.
Body disclosure depends on current/initial URLs, opener origins at creation,
referrers, and exact same-origin checks. The accessing environment must supply
source URL, line, and column. Ancestor navigation, creator/opener state,
WindowProxy/Location access interception, source-location capture, and URL-scoped
Reporting are still missing consumers/producers; none is treated as complete by
the policy comparison tests.

The sandbox/COOP network-error path remains a throwing dependency in navigation.
Failed preparation must eventually discard its reservation through the full
navigation lifecycle. COOP group changes do not establish WindowProxy cross-origin
security, opener severance across author-held references, or history disposal.

### Specification conflicts

- `SPEC_CLASH(coop-report-endpoint)`: the reporting algorithms always name the
  enforced endpoint, including for the reporting disposition, despite defining
  a separate report-only endpoint. Eric approved selecting the endpoint for each
  disposition. This agrees with WebKit's
  [`reportingEndpointForDisposition()`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/loader/CrossOriginOpenerPolicy.h)
  and its navigation-report callers. This is local source evidence, not a live
  browser delivery test.
- `SPEC_CLASH(coop-noopener-navigation)`: the noopener-allow-popups description
  says to force a new group regardless of the predecessor policy. The explicit
  ordinary-navigation algorithm instead allows matching same-origin values.
  Browlet follows that algorithm; initial-about:blank popup processing always
  switches for a noopener-allow-popups response.
- `SPEC_CLASH(coop-access-report-type)`: all six access-report body tables use
  access-to-opener, including operations headed access from an opener, access
  to/from an openee, and access to/from another window. The body type choice is
  pending review with access reporting; no fabricated type is emitted.

[COOP tests](../../../../test/browlet/browsing/policy/coop.test.ts) cover headers,
origin/policy comparisons, accumulated enforcement, navigation and virtual group
changes, logical isolation, endpoint selection, and URL sanitization. Reporting
calls in the enforcement test are intercepted to inspect their conditions; they
are not evidence of report-body generation or delivery.

## HTML 7.1.4 cross-origin embedder policies

Audited the complete [COEP section](https://html.spec.whatwg.org/multipage/browsers.html#coep),
including its preamble, headers, inheritance checks, and reports, against HTML
revision `9396777` above. The next Section 7 audit is §7.1.5, sandboxing.

| Requirement | Owner and result |
| --- | --- |
| Values and policy records | `EmbedderPolicy` has the three values and four defaulted fields. Its compatibility predicate accepts require-corp and credentialless. Policy-container cloning preserves both dispositions independently. |
| Fetch behavior | Fetch owns credentialless credential suppression and CORP enforcement/reporting, including the navigation flag. These remain distinct from HTML's inheritance check. The published Fetch algorithm now agrees with Browlet's same-origin redirect-taint check; the earlier clash is resolved. |
| Headers | `EmbedderPolicy.obtain()` gates on the supplied environment's secure-context status, parses each disposition as a structured item, and accepts report-to only as a string parameter of a compatible token. Unknown, unsafe-none, quoted, malformed, and list values do not retain endpoints. |
| Navigation inheritance | `Navigable.checkResponseEmbedderPolicy()` exempts top-level navigations and checks the container document's policies against the response's enforced value. Either compatible response value satisfies either compatible parent value; the response's report-only value does not. Supplied-response document creation calls the check before changing contexts or creating a document. |
| Worker inheritance | `WorkerGlobalScopeImpl` owns the embedder policy and common scripting state. Its check exempts non-dedicated workers; `DedicatedWorkerGlobalScopeImpl` checks the owner's two dispositions against its own enforced policy. Service-worker listener rules now inherit the common state. |
| Inheritance reporting | `queueCOEPInheritanceViolation()` uses Fetch's sanitized original response URL and the selected owner environment. Report-only precedes enforce, each with its own endpoint. Empty endpoints still reach local observers. |
| Observer bodies | Inheritance reports contain type, blockedURL, and disposition. A separate hidden `COEPInheritanceViolationReportBody` projects those fields without CORP's destination; existing CORP bodies retain it. This follows the reviewed Reporting interface model and WebKit's separate inheritance body. |

The checks are implemented; their remaining lifecycle consumers are explicit:

- **Navigation:** iframe/object/frame content-navigable setters now retain the
  reverse container association; child creation/destruction must populate it. Use that element's
  current node document, including after adoption, rather than the parent's active
  document or the element's creation environment. The Fetch-backed navigation loop
  must perform its CORP/inheritance checks and turn rejection into a network error.
  The supplied-response path currently throws at that unfinished error-document
  boundary. Child permissions policy and local/history policy selection remain
  separate navigation dependencies.
- **Workers:** the abstract globals have no startup, settings construction, or
  platform projection. Startup must obtain the response's embedder policy, assign
  it to the global, and call the dedicated-worker check with the outside settings
  before executing script. A false result requires network-error and worker-discard
  processing; adding the policy method does not implement that processing.
- **HTML's credentialless recommendation:** the preamble strongly encourages
  Private Network Access and Opaque Response Blocking. These separate proposals
  are not integrated into the published Fetch Standard, and Browlet implements
  neither pipeline. Their independent audits are recorded as an
  [HTML follow-up](../../../fetch/ROADMAP.md#html-credentialless-follow-up),
  separate from the earlier Fetch audit's known unfinished algorithms.
  Browlet's logical isolation continues to grant no cross-origin-isolated capability.

[COEP tests](../../../../test/browlet/browsing/policy/coep.test.ts) cover the header
matrix, both inheritance operations, disposition ordering/endpoints, current
container-document ownership, the blocked-document boundary, original-URL
sanitization, and local reporting with outbound delivery disabled. Worker tests
use concrete test subclasses of the partial globals; navigation tests connect real
container associations without automatic child creation. These are not worker-startup or iframe
conformance tests. [Observer tests](../../../../test/browlet/reporting/observers.test.ts)
exercise real projection and retain the regression for the unwanted destination
member; Fetch's [embedder tests](../../../../test/fetch/policy/embedder.test.ts)
cover credential suppression and CORP.

## HTML 7.1.5 sandboxing

Audited the complete [sandboxing section](https://html.spec.whatwg.org/multipage/browsers.html#sandboxing),
including every flag description, token exception, and state owner, against HTML
[`9396777`](https://github.com/whatwg/html/tree/939677714df7379fee3667040113b41c91c851e7)
(26 October 2026). Parsing all sixteen flags does not implement all their consumers.

| Requirement | Owner and result |
| --- | --- |
| Directive parsing | `SandboxingFlagSet.parse()` already covers all sixteen flags, ASCII whitespace/case, unknown tokens, activation distinctions, and the three custom-protocol exceptions. It returns a fresh set rather than taking an output set, as previously reviewed. |
| Iframe flag set | `HTMLIFrameElementImpl.sandboxingFlagSet` follows null-namespace sandbox attribute creation, mutation, and removal. Absence means no restrictions; an empty attribute means all restrictions. The projected `sandbox` DOMTokenList remains §4.8.5 work. |
| Popup and active-document sets | Contexts start with an empty popup set; Documents retain independent active-flag snapshots. Later iframe attribute changes do not alter an existing document's flags. Actual popup propagation remains with auxiliary-context creation. |
| Permitted navigator | `BrowsingContext.onePermittedSandboxedNavigator` starts null. Target selection must populate it and navigation permission checks must consume it; neither lifecycle exists yet. |
| CSP-derived restrictions | Existing `CSPList.getSandboxingFlags()` unions enforced header policies and ignores reporting/meta policies. Keep the reviewed `SPEC_CLASH(csp-sandbox-combination)`: HTML currently retains only the last directive, whereas Browlet and all three reference engines combine restrictions. Evidence remains in the [CSP audit](csp/ROADMAP.md#retained-specification-decisions). |
| Creation flags | `BrowsingContext.determineCreationSandboxingFlags()` copies popup flags without an embedder; with an iframe, it unions the iframe's flags and its current node Document's active flags. Child creation does not inherit the context's popup set separately. Object/frame response preparation throws pending a sandbox inheritance audit: HTML's element case asks for an iframe flag set not defined on those elements. |
| Supplied-response navigation | `createNavigationParams()` combines creation flags and response CSP before selecting an opaque origin, then document creation copies the final set. Full navigation still needs source/target snapshots and the inline-srcdoc path's inherited-CSP ordering. |

Every flag's remaining enforcement owner is explicit:

| Flags | Existing behavior or remaining consumer |
| --- | --- |
| navigation; auxiliary navigation; top-level navigation with/without activation; custom-protocol navigation | Navigation target selection, user-activation checks, popup creation, close, and external-protocol handling remain unfinished. `isNavigationOrHistoryUpdateBlocked()` is still a provisional false result, not enforcement. |
| origin | Context/response preparation can select an opaque origin. Origin-sensitive DOM/storage/cookie checks exist, but creator/iframe/srcdoc origin and cookie-URL inheritance still require their lifecycles. |
| forms; pointer lock | Form submission and pointer-lock entry points must apply their flags. |
| scripts; automatic features | The environment's scripting predicate reads the scripts flag. Parser/script preparation, automatic media playback, and autofocus still need their owning consumers; parsing the automatic-features flag does not enforce them. |
| document.domain | The Document setter rejects the flag before domain relaxation. |
| propagation to auxiliary contexts | Auxiliary browsing-context creation must copy restrictions unless the source permits escape. |
| modals; orientation lock; presentation; downloads | Dialogs/beforeunload, orientation, Presentation API, and both navigation/hyperlink downloads need their checks. |

[Sandbox tests](../../../../test/browlet/browsing/policy/sandbox.test.ts) cover
tokens, attribute mutation/cloning, independent snapshots, adopted iframe
ownership, and response preparation. The last test supplies only the unfinished
container association; it does not claim working child navigation.

## HTML 7.1.6 iframe element referrer policy

Audited [the complete algorithm](https://html.spec.whatwg.org/multipage/browsers.html#the-iframe-element-referrer-policy)
at the same HTML revision. `HTMLIFrameElementImpl.determineReferrerPolicy()`
returns the canonical referrerpolicy attribute state for an iframe and the empty
string for a non-iframe or null. The real `referrerPolicy` IDL member uses the
existing shared enumerated-attribute binding, including empty/invalid defaults.
Browsing-context initialization and response preparation now supply this value
to Document ancestry initialization. It is distinct from the destination's
response Referrer-Policy header.

The actual child/container association, iframe request construction, and srcdoc
load lifecycle remain unfinished. [Reflection tests](../../../../test/browlet/dom/nodes/html/referrer-policy.test.ts)
exercise the projected member; sandbox/navigation tests check capture before
later attribute mutations. Existing ancestry tests retain their separate
loaded-srcdoc expected failure.

## HTML 7.1.7 policy containers

Audited [all container fields and algorithms](https://html.spec.whatwg.org/multipage/browsers.html#policy-containers)
at the same HTML revision.

| Requirement | Owner and result |
| --- | --- |
| Defaults and cloning | Containers retain CSP, COEP, referrer, enforced integrity, and report-only integrity state. Cloning preserves CSP self origin and copies policies independently. A not-yet-associated container still represents the empty CSP list as `undefined`: `CSPList` currently requires a self origin. An origin-independent empty-list representation remains CSP owner work; do not invent an opaque origin as a default. |
| Response creation | `UserAgent.createPolicyContainerFromResponse()` composes CSP, COEP, referrer, and both integrity parsers. This factory lives beside the existing browser policy allocator because it also consumes browser-owned Blob entries and permits a null environment. |
| Blob responses | Clone the retained Blob entry creator environment's current policy container. Do not re-resolve the store after revocation or overwrite inherited policies with response headers. `BlobURLEnvironment` now explicitly requires its existing creator's policy container. |
| History predicate | `PolicyContainer.requiresStorageInHistory()` accepts local non-Blob URLs. Supplied-response history entries retain the live container; reconstruction selects a clone so subsequent document mutations are retained without sharing the reconstructed copy. |
| Navigation selection | `PolicyContainer.determineForNavigation()` implements history, srcdoc parent, local initiator, response, and fresh-default precedence. History and inherited state are cloned; a response container retains identity. Assertions reject invalid history URLs or missing srcdoc parents. |
| Response association | Supplied-response navigation now installs Referrer-Policy and both integrity headers along with existing CSP/COEP. COEP completion waits for the reserved environment's security decision and preserves Blob creator policy. Regressions exposed both the lost no-referrer header and Fetch's missing default for an empty container policy; both are fixed. |
| Worker initialization | `WorkerGlobalScopeImpl.initializePolicyContainer()` clones the sole owner for local non-Blob URLs and uses response creation otherwise. URL, owner set, and policy container are explicit on the partial global. Worker owners contribute their own policies, including for nested workers. §10 startup must populate the URL/owners and call this operation; IDL and startup remain deferred. |

Two continuing specification conflicts are recorded in code:

- `SPEC_CLASH(policy-container-null-environment)`: HTML assigns the string
  unsafe-none to a field defined to contain an embedder-policy record. Browlet
  retains the fresh default record, including report-only state and endpoints.
- `SPEC_CLASH(policy-container-report-only-integrity)`: HTML defines report-only
  integrity state but omits it from cloning. Preserve Browlet's existing copy of
  both dispositions. Gecko's `PolicyContainer::InitFromOther()` delegates to
  [`IntegrityPolicy::InitFromOther()`](https://searchfox.org/firefox-main/source/dom/security/IntegrityPolicy.cpp),
  which copies enforced and report-only entries; this is source evidence, not a
  newly run browser probe.

The supplied-response path represents browser-UI navigation, with no initiator or
history restoration. Full §7.4 navigation must capture source/target policies,
feed retained history state into selection, and implement inline srcdoc ordering.
Initial blank creator inheritance, history reconstruction, worker startup, and
worklet policy association remain lifecycle work. Do not infer those integrations
from the standalone selection tests. [Container tests](../../../../test/browlet/browsing/policy/container.test.ts)
cover precedence, copy/identity rules, all response fields, Blob revocation, and
history retention; [worker tests](../../../../test/browlet/workers/policy-container.test.ts)
cover document/nested-worker ownership and the Blob exception without worker startup.

This pass stops before §7.2.

## Policy state and composition

Policy values travel through environments, Documents, responses, navigation, and
history. Preserve each specification's clone/identity rule rather than copying
ad hoc subsets. PolicyContainer.clone copies populated CSP directives and their
self origin, COEP/referrer state, and both Integrity Policy dispositions.
A container without a known resource origin has no CSP list yet.

The bounded response-bearing Document creation path initializes CSP, sandbox,
COOP, COEP, referrer and integrity policies, upgrade policy, and Reporting endpoints. It is not the complete
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

BrowletEnvironmentBase owns the fixed decision before realm creation; BrowletRealm reads
it for exposure and full settings retain it. Window initialization uses an
existing reserved decision or derives one from the selected origin and parent
Window, including insecure intermediate ancestors. New Window creation computes
a new decision. Full iframe/popup, sandbox, worker, and worklet inheritance remain
with those lifecycles.

`SPEC_CLASH(secure-context-top-level-url)` was reviewed at HTML §8.1.3.5.
Its written fallback tests only `topLevelCreationURL` using URL trustworthiness.
That treats creatorless about:blank and top-level data URLs as secure, and does
not account for an insecure intermediate ancestor beneath a secure top-level URL.
Browlet instead preserves its selected-origin and parent-security checks by
agreement. This also preserves classification before binding exposure and the
reserved environment's decision when full settings are created.

Evidence: HTML `webappapis.html#secure-context`; Secure Contexts'
[ancestral-risk discussion](https://w3c.github.io/webappsec-secure-contexts/#ancestors);
and Blink's
[SecurityContext::SetSecurityOrigin](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/execution_context/security_context.cc),
which checks origin trustworthiness and insecure ancestors. Existing
[secure-context tests](../../../../test/browlet/browsing/policy/secure-contexts.test.ts)
cover creatorless/inherited about:blank, data URLs, insecure intermediate
ancestors, configured trust, reserved settings, and Web IDL exposure.
This does not complete sandboxed or worker/worklet setup; their security inputs
must be reviewed with those lifecycles.

### Referrer Policy

[Referrer Policy](https://w3c.github.io/webappsec-referrer-policy/) parsing,
stripping, request calculation, and redirect updates live in
[Fetch](../../../fetch/referrer-policy.ts) and are called directly there.
Window settings use the Document's URL/srcdoc state, not its base URL;
other settings use their creation URL. Stripping returns independent copies.
The same Fetch module owns the shared enum values, TypeScript type, and Web IDL
declaration. Browser-owned source selection and
trust decisions remain environment/UserAgent queries.

Header parsing follows the grammar: ASCII-insensitive tokens, unknown
letter/hyphen extensions, and whole-value rejection for malformed tokens.
Chromium follows that rejection rule; Gecko/WebKit skip malformed tokens.
Absent/rejected headers preserve the request's policy.

`SPEC_CLASH(referrer-empty-policy)`: Referrer Policy
[§3.9](https://w3c.github.io/webappsec-referrer-policy/#referrer-policy-empty-string)
says an empty document policy falls back to strict-origin-when-cross-origin when
determining the request's referrer. Its
[§8.3](https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer)
instead says Fetch never passes an empty policy and omits that switch case.
Fetch's main algorithm copies the container value, which HTML response creation
sets to empty when no header is supplied. Browlet follows §3.9 in the calculation,
without rewriting the request or container policy. The same-origin/cross-origin/
downgrade regression first reproduced the thrown unresolved-policy error; existing
Blob/data Fetch tests also exposed it when response policy association was connected.

HTML §2.5.5 now defines referrer-policy attributes over the shared values, and
link/script/iframe expose `referrerPolicy`. An empty or invalid attribute defers to
Fetch's existing policy-container fallback; it does not mean `no-referrer`.
Complete element/stylesheet delivery and inherited state with their loaders.
Supplied-response navigation associates Referrer-Policy with the new Document's
policy container. Meta referrer processing and hyperlink
`rel=noreferrer` are also missing; the complete precedence described by HTML
§2.5.5 requires those consumers, not another shared attribute parser.
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
retain the reviewed parser/model differences. Supplied-response navigation now
delivers both headers. Element/preload inputs and full policy lifecycle remain owner work.

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

Local source checkouts include
`w3c-secure-contexts/index.bs`, `w3c-referrer-policy/index.src.html`,
`w3c-subresource-integrity/index.bs`, `w3c-mixed-content/index.bs`, and
`w3c-upgrade-insecure-requests/index.bs`. Retained browser comparisons are
September 2026 evidence, not newly rerun observations.
