# Content Security Policy roadmap

The [CSP Level 3](https://w3c.github.io/webappsec-csp/) Fetch-preflight work is
implemented: policy parsing/copying, source matching, Fetch checks, Window
violations, reporting, sandbox restrictions, base-uri checks, and document
initialization. Full CSP conformance still needs the HTML and engine consumers
listed below. The [parent roadmap](../ROADMAP.md) owns neighboring policies and
policy-container association.

## Current implementation

| Module | Responsibility |
| --- | --- |
| [policy.ts](policy.ts), [list.ts](list.ts) | Policies/directives, retained self origin, response parsing/copying, checks, and initialization |
| [directives.ts](directives.ts) | Directive values, source matching, request directives, and fallback |
| Violation/event/body implementations in this folder | Captured violation data, trusted events, Reporting bodies, and hash reports |

A policy retains its disposition, source, original text, and ordered directives.
Names use ASCII lowercase; values preserve spelling. The first duplicate wins.
Unknown names remain data, without enforcement merely because they parse.

`PolicyContainer.cspList` is absent until its resource origin is known.
Every `CSPList` requires `selfOrigin`; response parsing creates one even without
headers. Document initialization preserves an inherited list and origin, or
creates an empty list. Cloning copies policies/directives independently while
preserving origin identity. Matching never substitutes the current environment's origin.

Fetch checks use concrete request/response records. They cover scheme, host,
port, path, retained self origin, redirect paths, nonces, integrity digests,
parser metadata, strict-dynamic, and directive fallback. Empty directives stop
fallback; an explicit worker-src differs from a script-src fallback.
Main Fetch reports monitored violations before upgrades, applies enforced
request checks afterward, and checks responses after populating their URL list.

Document initialization consumes real Fetch navigation records, response status,
sandbox restrictions, and Reporting endpoints. The bounded HTML loader consumes
body bytes; complete navigation/policy inheritance remains with the loader.
`base-uri` is connected to HTMLBaseElement. Only enforced
`upgrade-insecure-requests` enables the existing upgrade policy.

## Violations and hash reporting

`CSPViolation` captures the protected Document URL/status/referrer and original
blocked resource. A queued task dispatches a trusted, bubbling, composed
SecurityPolicyViolationEvent, checking element attachment at delivery time.
Unavailable author source locations stay absent; Node stacks are not a substitute.

`report-to` uses typed bodies and the shared [Reporting](../../../reporting/ROADMAP.md)
queues/observers. Deprecated `report-uri` uses Fetch requests. Outbound opt-out
preserves local events and observers. Delivery copies retain JSON data without
the observer body or generating environment.

Hash reporting uses a separate body branch, waits for completed bytes, and skips
failed reads. It selects the strongest requested SHA algorithm and emits an
SRI-style Base64 digest. A null body hashes the empty sequence. Document and
original resource URLs are sanitized and captured before reading.

Only CORS-same-origin responses disclose a digest. The request's response tainting
also guards internal responses; opaque responses report an empty hash without
reading their body. Opt-out suppresses this work. Hash reports are never exposed
to ReportingObservers. Future loader/SRI consumers should reuse completed bytes
or digests when available instead of reading twice.

## Style-attribute consumer

HTML §3.2.6.5 now calls the inline CSP check for `style` attribute input through
the [style integration](../../../style/ROADMAP.md#style-attributes--html-3265).
`CSPList.isInlineAttributeBlocked(element, 'style-attr', source)` specializes
[should-block-inline](https://w3c.github.io/webappsec-csp/#should-block-inline)
to `style attribute`, returning a boolean. It selects `style-src-attr`, then
`style-src`, then `default-src`; an empty present directive stops fallback.
Every rejected policy reports, including report-only policies, but only enforcing
policies block. Reports retain effective directive `style-src-attr` even when a
fallback supplied the source list, and use the existing element-targeted task.
CSSOM writes and attribute removal bypass the attribute-input check.

Matching supports `unsafe-inline` and exact UTF-8 SHA-256/384/512 hashes with
`unsafe-hashes`. A valid nonce/hash source suppresses `unsafe-inline`; nonces
cannot authorize style attributes. `strict-dynamic` has no effect for styles.
The report sample is the first 40 characters only when the selected source list
contains `report-sample`. Source locations remain unavailable as documented above.

Browser checks on 2026-10-18 used Chromium 149.0.7827.55, Firefox 151.0, and
WebKit 26.5. Eric approved these choices:

- **SPEC_CLASH(csp-blocked-style-attribute):** preserve the raw DOM attribute and
  last accepted declaration, as Chromium/WebKit do. Firefox clears both after
  rejection. CSSOM's attribute-change steps contain no CSP gate; HTML explicitly
  forbids applying rejected rules, leaving the retained-state interaction unclear.
- **SPEC_CLASH(csp-style-attribute-sample):** include requested samples following
  CSP/Chromium/Firefox. WebKit reports an empty sample for these violations.
- **SPEC_CLASH(csp-style-attribute-nonce):** follow CSP/Chromium/Firefox by
  excluding nonce authorization. WebKit accepts a style attribute with a matching
  nonce, both with and without `unsafe-inline`; an unmatched nonce still blocks.
- **SPEC_CLASH(csp-decoded-integrity):** extend the existing decoded-digest choice
  to inline hashes. Chromium/WebKit accept omitted padding; Firefox/the draft's
  encoded comparison reject it. All three accept padded Base64url spelling.

The native probes are in `node-compat/experimental/browser-probes/css/style-attributes.mjs`; persistent Browlet
regressions cover pre-CSSOM checks, parser input, both dispositions and multiple
policies, report targets/samples, adoption, namespaces, and CSSOM bypass. Source
list regressions cover all three hashes, UTF-8 input, equivalent hash encodings,
fallback inputs, and keywords. No new expected failures or skips are needed.

## Script-attribute policy prerequisite

The same `CSPList.isInlineAttributeBlocked(element, type, source)` operation now
accepts `script-attr` (CSP's `script attribute`). It retains the existing boolean
result (`true` means
an enforcing policy blocks) and violation delivery. Source selection is
`script-src-attr`, then `script-src`, then `default-src`; an empty present
directive stops fallback. Rejected policies report effective directive
`script-src-attr`, including when a fallback supplied the source list. Report-only
policies report without blocking; only the selected list supplies `report-sample`.

The shared attribute matcher permits exact UTF-8 hashes only with `unsafe-hashes`.
Nonces never authorize attributes. For script attributes, `strict-dynamic` also
suppresses `unsafe-inline`; it does not grant trust to handler source. The existing
decoded-digest choice above is retained. Style matching is unchanged.

HTML §8.1.8.1 now calls this check before storing raw body/frameset Window handler
source; blocked writes retain the prior handler while updating the DOM attribute.
Report-only policies permit compilation. General element handlers still need
their declarations and scope integration in the
[remaining steps](../../../scripting/ROADMAP.md#html-8181-event-handler-idl-invocation).
Script/style element bodies need separate checks outside this attribute API.

The 29 script-attribute tests cover fallback, keywords, exact hashes, multiple
policies, report-only behavior, samples, and adopted/removed elements. Policy
inputs use implementations; violation delivery exercises real Window bindings.
These tests do not claim that assigning an HTML handler attribute executes code.

Validation: 156 script/style attribute and source-list tests pass on all six
Node 24/26/custom stock/addon configurations. All 351 CSP tests pass on the custom
addon build. Typechecking, Web IDL declaration contracts, and touched-file ESLint
pass. No new expected failures or skips were introduced.

## String-compilation consumer

Window's native eval/Function hook now calls `CSPList.isStringCompilationBlocked()`
for ordinary strings and extracted TrustedScript source. This implements the
source-list portion of
[EnsureCSPDoesNotBlockStringCompilation](https://w3c.github.io/webappsec-csp/#can-compile-strings):
`script-src` takes precedence over `default-src`, including empty directives;
`script-src-elem` and `script-src-attr` do not govern compilation. `unsafe-eval`
permits compilation. `trusted-types-eval` permits the source-list step only when
the CSP list has an enforced `require-trusted-types-for 'script'` requirement.
These keywords match ASCII case-insensitively.

Every violated policy reports effective directive `script-src` and blocked
resource `eval`. `report-sample` retains the first 40 source code units. Report-only
policies report without blocking. The boolean result lets the existing engine
callback produce EvalError in the compilation realm, rather than throwing a
Node-owned error. Policy is read at each compilation, including cached source;
already compiled functions remain callable. Borrowed eval and Function use their
own realm's policy. Native eval scope and Node's existing checks remain intact.

This is not the complete Trusted Types algorithm. Its preceding validation,
default-policy invocation, and unchanged-source check remain unconnected because
the engine callback lacks compilation kind and original Function arguments.
In particular, `require-trusted-types-for` does not yet reject untrusted compilation,
even with `trusted-types-eval`. Do not infer those inputs from source text or claim
that the source-list allowance establishes trust. The four existing
[engine-input regressions](../../../../../node-compat/test/code-generation-gaps.test.cjs)
remain expected failures. Stock mode and official Node addon builds lack the
forwarding export, so their native compilation remains unenforced; integration
assertions retain the previously approved `codeGeneration` expected-failure gate.
The policy algorithm itself is exercised on every backend.

## Wasm-compilation consumer (§4.5.1)

[`CSPList.isWasmCompilationBlocked()`](list.ts) implements
[EnsureCSPDoesNotBlockWasmByteCompilation](https://w3c.github.io/webappsec-csp/#can-compile-wasm-bytes).
`script-src` takes precedence over `default-src`, including an empty directive.
ASCII-insensitive `wasm-unsafe-eval` or `unsafe-eval` permits compilation. Other
script allowances, including `trusted-types-eval`, do not. Every violated policy
reports `script-src` / `wasm-eval` with no sample; report-only policies never block.

Realm composition registers the live policy decision with JS Engine. All three
addon bases intercept V8's native byte compilation, preserving Node's original
handler and its disabled-Wasm contexts. No Node/V8 patch is needed. V8 creates
CompileError in the compilation realm. The check covers Module construction,
compile/instantiate bytes, response compilation, and HTML's Wasm module parser;
it is separate from URL/Fetch policy. Borrowed operations use their own realm.
Validation, retained-module instantiation, internal callback conversion bridges,
and Module cloning remain available after compilation has been forbidden.

Stock Node checks the same decision at Browlet's constructor and compilation
entry points. It cannot intercept captured native functions used directly by the
host. Stock Wasm ESM parsing remains an unsupported engine dependency. Worker
startup must supply its policy container and global violation reporting before
this Window integration can be reused there.

The [policy tests](../../../../../test/browlet/browsing/policy/csp/wasm-compilation.test.ts)
and [browser tests](../../../../../test/browlet/webassembly/csp.test.ts) cover
fallback lists, report-only/multiple policies, realm ownership, live policy
changes, and continued use of compiled modules. The
[native tests](../../../../../node-compat/test/wasm-code-generation.test.cjs)
also cover Node preservation, global reuse, collection, and worker teardown.

Validation: the 55-file Wasm/CSP integration selection passes in all six runtime
configurations, retaining existing expected failures only. All 25 new policy/API
tests pass everywhere; the HTML module-parser case passes on all addon bases.
Rebuilt addons pass their full native suites (393/393 on Node 24 and 26; 392 plus
the existing installer skip on custom). Typechecking, focused lint, and import
boundary checks pass. No failure classifications changed.

## Navigation-request consumer

HTML §7.4.2.3.2 now calls
[`isNavigationRequestBlocked`](list.ts) with the captured source policies and
source client. The target Window owns the queued task and request allocation;
it does not supply the source factory or receive the source's violation events.
`NavigationRequest`, beside Navigable's other input types, preserves those concrete
HTML types without changing Fetch's portable policy contract. Browser-UI navigation
has a null source client and an
empty source policy container. A nonempty list requires its source environment.

The [CSP §4.2.4 check](https://w3c.github.io/webappsec-csp/#should-block-navigation-request)
first applies `form-action` and Trusted Types pre-navigation checks. All rejected
policies report; only enforcing policies block. A blocked pre-navigation phase
skips inline checks but does not suppress the remaining pre-navigation checks.
`form-action` applies only to form submissions, matches the current request URL
with its redirect count and retained self origin, and reports the original URL.
It has no default-src fallback.

Trusted Types may rewrite the first request URL. Its factory's
`processValueWithDefaultPolicy()` reuses the existing converted callback, keeping
the temporary trusted value's string without allocating an immediately discarded
object. Missing callbacks, null results, exceptions, and URL parse failure are
failed pre-navigation checks. Empty strings are successful conversions.
`getCompliantString()` still propagates author exceptions for ordinary DOM sinks;
navigation catches them at its own specified boundary.

If pre-navigation allows a javascript: URL, inline matching uses `script-src-elem`,
then `script-src`, then `default-src`, retaining `script-src-elem` as the effective
report directive. Nonces cannot authorize navigation; hashes require unsafe-hashes.
The shared attribute/navigation matcher preserves unsafe-inline suppression by
nonces, hashes, and script strict-dynamic. Script/style element-body matching is
still a separate missing consumer.

`CSPInlineSourceType` names the supported matching inputs: `script-attr`,
`style-attr`, and `navigation`. Attribute-only checks retain `CSPInlineAttributeType`,
so they cannot accidentally receive a navigation request. The hyphenated attribute
values correspond to CSP's `script attribute` and `style attribute` names.

### Reviewed browser differences

Live HTTP/header probes on 2026-11-02 used Chromium 156.0.8078.4, Firefox 157.0,
and WebKit 27.2. The reproducible probe is
`node-compat/experimental/javascript-navigation-policy.mjs` in Experimental;
an optional name filter selects one case. Each case starts with a fresh document.
CSP `251d288` and Trusted Types `3cd79cb` were refreshed fast-forward-only and
already matched upstream. HTML was read at `404b3eb14a7a936dddefb2d78e224dbeb01d2358`.

| Source marker | Browlet's approved choice and observed alternatives |
| --- | --- |
| `javascript-csp-encoding` | Hash the full serialized URL without percent-decoding, as the written algorithm, Firefox, and WebKit do. Chromium decodes first. All tested engines include `javascript:`; hashing only the script does not authorize it. |
| `javascript-trusted-types-encoding` | Pass the encoded script, without the scheme, to the default policy, as Trusted Types and Firefox do. Chromium/WebKit decode first. All receive `TrustedScript` and `Location href` as additional arguments. |
| `javascript-trusted-types-order` | Rewrite before inline checks, as CSP/Firefox do. Chromium/WebKit can block the original inline source without invoking the default callback. A hash authorizing only the rewritten URL passes Firefox and Browlet. |
| `trusted-types-navigation-exception` | Report a throwing callback and let disposition decide blocking, as the algorithms, Firefox, and WebKit do. Chromium stops even a report-only request and emits no violation for the throw. |
| `trusted-types-navigation-policies` | Invoke the default callback once across policies, and require a valid `'script'` token, matching all three engines. The written per-directive loop would repeat conversion and does not inspect the token. Still report each failing applicable policy. |
| `trusted-types-navigation-report` | Report `trusted-types-sink` and `Location href\|` plus the first 40 source code units, matching browser report structure. CSP's generic pre-navigation report instead uses the request URL and supplies no sample. Encoding follows the separate approved input choice. |
| `javascript-csp-sample` | Honor report-sample on the selected inline directive, using the first 40 encoded URL code units as WebKit does. The navigation algorithm omits this step; Chromium decodes first, and Firefox appends an ellipsis. |

[Trusted Types #584](https://github.com/w3c/trusted-types/issues/584) explicitly
identifies the reporting disconnect and Chromium's missing exception report;
it also supplies the invalid `javascript://test:test/` reparse case. Browser
structure explains the differing order: Blink's
`LocalDOMWindow::CheckAndGetJavascriptUrl` decodes and checks inline CSP before
Trusted Types. Gecko's `GetConvertedScriptSourceForPreNavigationCheck` retains
encoded input, and `nsJSProtocolHandler.cpp` passes the full URL to inline CSP.
WebKit's `requireTrustedTypesForPreNavigationCheckPasses` decodes the input and
uses its shared sink reporting; earlier loading checks can reject inline CSP.
These traces explain the results without making browser behavior the default rule.
[CSP #553](https://github.com/w3c/webappsec-csp/issues/553) discusses hashing the
scheme-inclusive URL; its historical Firefox observation no longer matches the
tested build.

This completes the navigation-request policy algorithm. The subsequent navigation
slice connects ClassicScript execution; string-result document replacement remains
unfinished. Network-navigation callers, response-policy/reporting integration,
and complete script-element checks remain below. Policy failures return
without reaching the loader; admitted javascript: requests execute in Navigable.

Validation: the 61 focused policy/queued-navigation tests pass on Node 24.19.0,
26.8.1, and the existing custom Node 27.0.0-pre, each with and without the addon.
The broader CSP, Trusted Types, beginning-navigation, and abortion selection
passes 603 tests on Node 26/addon. Typechecking, touched-file lint, import hierarchy,
and whitespace checks pass; there are no new expected failures or native changes.

## Navigation-response foundation

HTML §7.4.5 needs [CSP §4.2.5](https://w3c.github.io/webappsec-csp/#should-block-navigation-response)
before admitting an incoming response. `ContentSecurityPolicy.getViolatedNavigationResponseDirective()`
now implements the [frame-ancestors response check](https://w3c.github.io/webappsec-csp/#frame-ancestors-navigation-response).
This is the only nontrivial navigation-response directive check in this CSP draft;
other directives default to Allowed. `form-action` remains a request check, not
an additional ancestor or response-URL check.

The method exempts Fetch local URLs (about/blob/data), ignores source-side
frame-ancestors, and checks every live container Document origin. It uses the
list's retained self origin and redirect count zero, independently of the incoming
Document's sandboxed origin and the departing child's state. Report-only and
enforced policies produce the same violation identity; the list-level algorithm
reports both and blocks only enforced policies.

Reviewed callable arrangement: the method omits the request and navigation type, which CSP
explicitly declares unused, and returns the violated directive or undefined,
matching our existing Fetch checks. `CSPList.isNavigationResponseBlocked()` has
the full request/response/type/target inputs with the response list as `this`,
plus the UserAgent needed before a destination realm exists. It accepts null
requests because HTML supplies them for synthetic responses. Both callable
arrangements are accepted; their `SPEC_MISMATCH` markers are removed.

Eric approved these matching choices on 2026-11-03:

- `SPEC_CLASH(csp-frame-ancestors-origin)`: compare serialized ancestor origins,
  as CSP, Chromium, and WebKit do. Firefox matches its full principal URI, so a
  `/parent` source can match a parent with that path; Browlet rejects it.
- `SPEC_GAP(csp-frame-ancestors-opaque-origin)`: CSP passes the opaque origin's
  serialization, `null`, through the URL parser without handling failure.
  Reject that ancestor. `SPEC_CLASH` with the same identifier records that
  Chromium/WebKit reject it even for `*`, while Firefox admits `*`.

`CSPList.isNavigationResponseBlocked()` now aggregates response policies through
the null-global reporting path below. Every violating policy queues a report,
including report-only policies and policies after an enforcing violation. Matching
policies do not report. The method consumes the selected list and its retained
self origin; it does not reparse the response or substitute an existing Window's policies.

The source-policy loop has been audited and is a no-op in the current draft:
`frame-ancestors` explicitly returns Allowed for `source`, and every other
directive's navigation-response check defaults to Allowed. In particular,
`form-action` belongs to the pre-navigation check, while `frame-src` belongs to
Fetch; neither becomes a second response restriction here. The original request
and navigation-type parameters remain in the callable contract. A future
source-side response directive must add its check and request-client reporting
here when that directive is implemented.

`SPEC_GAP(csp-navigation-response-null-request)` records that CSP dereferences a
request which HTML leaves null for synthetic responses. With no source request,
there is no source-policy loop; do not borrow the departing or embedding Window.
This leaves all currently defined response checks intact, including local-URL
exemptions for inherited frame-ancestors policies. Population now calls these
checks before COEP and X-Frame-Options; error-page and ordinary Document creation
remain explicit boundaries.

### Navigation-response reporting

`SPEC_GAP(csp-navigation-violation-global)` records that CSP creates response
violations with a null global, then derives their URL/status and delivery context
from that global. `CSPViolation.fromNavigationResponse()` now captures the incoming
response and its Reporting-Endpoints with a UserAgent owner. `fromGlobal()` retains
the existing Document event/observer behavior. The navigation factory's response
input supplies information missing from the null-global construction algorithm;
its `SPEC_MISMATCH` remains for callable-shape review.

No existing Window substitutes for the absent global. There is no DOM event target
or ReportingObserver, and no parent/departing report buffer or endpoint lookup.
The UserAgent schedules delivery; its sandbox owns Fetch execution without
becoming the request's client. Modern `report-to` uses the existing Reporting
contract, retaining the response URL's origin separately from its sanitized URL.
Legacy `report-uri` uses the separately approved opaque-origin contract below.
Report-to presence still suppresses report-uri even without a configured endpoint.

The browser-only `node-compat/experimental/navigation-csp-response.mjs` probe ran
nine matching/metadata cases plus three cookie and two collector-redirect cases
in Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All three
admitted report-only failures and sandboxed destinations with an allowed response
self origin. No securitypolicyviolation event was observed on the parent or
destination for these frame-ancestor reports. Eric approved the reporting choices
below on 2026-11-03:

| HTTP 201 response rejected by frame-ancestors | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Protected document URI | Response origin only | Full sanitized response URL | Full sanitized response URL |
| Blocked URI | Response origin only | Same-origin ancestor URL, otherwise empty | Full sanitized response URL |
| Status | 200 | 0 | 201 |
| Referrer in the direct iframe cases | Empty | Navigation request referrer | Navigation request referrer |
| Report POST Origin header | null | Response origin | null |
| Legacy cookies, including same-origin collector | Omitted | Omitted | Sent, including foreign collector |

- `SPEC_CLASH(csp-navigation-report-resource)`: use the sanitized final response
  URL for both protected and blocked resources and the actual response status,
  matching WebKit in the HTTP probe. Do not copy an ancestor's URL or assume 200.
- `SPEC_CLASH(csp-navigation-report-referrer)`: leave null-global referrer empty,
  following CSP and Chromium's direct-frame reports.
- `SPEC_GAP(csp-navigation-report-client)` and
  `SPEC_CLASH(csp-navigation-report-credentials)`: use a clientless legacy request
  with an opaque origin, matching Chromium. CSP's same-origin credentials mode
  then omits credentials. Firefox likewise omits cookies; WebKit sends them even
  to a foreign collector. Existing global reports retain their actual client.
- `SPEC_CLASH(csp-report-no-cors-redirect)`: CSP prescribes no-cors with
  redirect:error, while Fetch rejects this combination before sending a foreign
  request. [CSP #320](https://github.com/w3c/webappsec-csp/issues/320) records the
  conflict and the historical requirements: send without preflight and refuse
  collector redirects. Fetch now admits this combination only for the internal
  report destination. HTTP redirect handling still rejects 302/307; all three
  browsers sent one POST and stopped in those probes. Ordinary author requests
  and manual redirects keep Fetch's restriction.
- `SPEC_GAP(keepalive-null-client)`: Fetch's keepalive accounting dereferences
  the absent client group. Retain the 64 KiB per-request limit with zero additional
  group bytes. Do not charge the parent or execution sandbox, invent a global,
  or silently disable keepalive. This is an explicit implementation choice;
  aggregate clientless quotas were not established by the browser probes.

All three leave the direct no-referrer case empty. Chromium's nested opaque-ancestor
case exposed older surrounding-frame metadata; it must not be treated as a reliable
request-referrer source. Firefox's source location contained Playwright/privileged
script details, which are probe artifacts and not a proposed author source location.
Report-to transport was not tested in browsers by this legacy report-uri probe;
production tests exercise it through the already implemented Reporting machinery.

[CSP issue #460](https://github.com/w3c/webappsec-csp/issues/460) documents the
referrer disagreement: the written null-global path leaves it empty; if populated,
the request's referrer is the relevant candidate, not an arbitrary ancestor URL.
[Gecko's Framing/CSP code](https://github.com/mozilla-firefox/firefox/blob/main/dom/security/nsCSPContext.cpp)
collects principal URIs and suppresses frame-ancestor DOM events;
[WebKit's directive checks](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/csp/ContentSecurityPolicyDirectiveList.cpp)
convert ancestor origins to URLs and reject invalid URLs. The probe and local
source inspection support the matching decisions above.
[Blink's PingLoader](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/loader/ping_loader.cc)
explicitly selects an opaque requestor origin for frame-ancestor violations and
redirect:error for legacy reports. Gecko marks report channels anonymous and
installs a redirect-rejecting sink.

The real-upload regression first timed out because Fetch rejected the no-cors/error
combination; a focused test observed zero transport calls. Once admitted, the
clientless keepalive request exposed the missing-group assertion. Both cases are
retained as passing regressions alongside ordinary-request rejection, redirect
rejection, quota boundaries, and both report formats' HTTP/body-disposal tests.
Window violation events and observers retain their existing tests.

The factory is now connected to list-level aggregation, including null synthetic
requests, and HTML's population task calls the aggregate checker. Remaining:
HTML's error-page creation, downloads, empty responses, and Document loader. Worker
global violation construction remains explicitly unfinished; this slice does not
substitute the sandbox for a Worker either.

Aggregation-slice validation: 12 new cases cover both dispositions, all reports
after a blocking policy, selected self origin, source-policy exclusion, synthetic
null requests, local URLs, and top-level targets. The 52 matcher/aggregation cases
plus 12 violation/delivery cases pass on all six Node 24.19.0, Node 26.8.1, and
custom Node 27.0.0-pre stock/compat configurations. Typecheck, touched-file lint,
import hierarchy, and diff checks pass. No new expected failures or native changes.

Reporting-slice validation: 677 tests in 30 CSP, Reporting, and Fetch suites pass
on each of Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, with the addon
both disabled and enabled. This includes real uploads for both report formats,
existing Window events/observers, no-cors and redirect restrictions, and client
versus clientless keepalive quotas. Typecheck, touched-file lint, import hierarchy,
and diff checks pass. No new expected failures or native changes were introduced.

Matcher-slice validation: 41 new focused cases plus the adjacent CSP parsing/source matching,
navigation-request, XFO, and population suites pass: 268 tests on Node 26.8.1
stock and compat. Typecheck, touched-file lint, import hierarchy, and diff checks
pass. No runtime scheduling or native integration changed in this slice.

## Retained specification decisions

The following source markers retain approved choices. September 2026 browser
evidence and source locations are recorded in the linked issue notes; this
documentation cleanup does not refresh those observations.

[Parsing](../../../../../scratch/SPEC-ISSUES.md#csp-policy-parsing-and-self-origin):

- `csp-directive-recovery`: discard malformed directives while retaining valid
  siblings, as browsers do, instead of rejecting the whole field against its ABNF.

[Source matching](../../../../../scratch/SPEC-ISSUES.md#csp-fetch-source-matching):

- `csp-resource-hint-matching`: recognize Matches and include default-src's own
  list for prefetch, correcting the draft's result-name/fallback inconsistencies.
- `csp-decoded-integrity`: compare decoded digests, like Blink/WebKit; Gecko
  compares encoded strings. Nonces remain exact strings.
- `csp-ipv4-sources`: accept explicit IPv4 sources like browsers despite the
  draft's domain-only matching step. This does not add IPv6 source grammar.
- `csp-secure-default-port`: accept HTTP/WS :80 to HTTPS/WSS default-port
  upgrades, like browsers; other port restrictions remain.
- `csp-websocket-schemes`: retain the written ws-to-http/https and wss-to-https
  matches, also in WebKit; Blink restricts its WebSocket upgrade to ws-to-wss.
- `csp-nondefault-port-upgrades`: retain equal nondefault ports across an allowed
  scheme upgrade, like the draft/WebKit; Blink's port-upgrade classification differs.
- `csp-path-segments`: split before decoding, like the draft/WebKit. Blink's
  whole-path decoding can treat an encoded slash as a segment boundary.

[Initialization and reporting](../../../../../scratch/SPEC-ISSUES.md#csp-initialization-and-violation-reporting):

- `csp-sandbox-combination`: union enforced restrictions like all three engines;
  HTML's loop currently retains only the last sandbox directive.
- `csp-report-body-interface`: use Reporting's interface model and default
  toJSON instead of the draft's dictionary inheriting an interface.
- `report-url-stripping`: copy and remove the fragment entirely, preserving
  the source instead of mutating it and leaving a trailing delimiter.
- `csp-violation-task-source`: the draft leaves this unspecified; use DOM
  manipulation like WebKit, while Blink uses networking.
- `csp-hash-body-reading`: supply completed bytes from a separate branch where
  the draft passes an unread Fetch body into a byte algorithm.
- `csp-hash-resource-url`: sanitize the original resource URL like Blink/WebKit.
- `csp-hash-response-tainting`: retain the request's filtering information when
  Fetch supplies an internal response, preventing opaque digest disclosure.
- `html-navigation-response-timing`: use full timing from Fetch's controller;
  HTML still reads it from the response.

## Dependency review and later consumers

- **Trusted Types:** [TT-A/TT-B](../trusted-types/ROADMAP.md#next-slices)
  implement policy-name restrictions, attribute default-policy/enforcement checks,
  and both dispositions through existing Window policy state and violation
  delivery. `require-trusted-types-for` reports each unsatisfied policy independently.
  Parser options, sanitization, script compilation, and workers remain separate
  consumer gates in that roadmap.
- **HTML delivery:** meta policies and their directive restrictions; full
  navigation source/target capture and local-URL/history reconstruction. §7.1.7
  now implements response policy creation and container-selection precedence.
  `PolicyContainer` still represents an unassociated empty CSP list as absent
  because `CSPList` requires its self origin; separate initially empty state from
  later origin association without fabricating an opaque origin.
- **Elements:** inline script and style-block checks, script preparation, and
  element/preload integration. Style-attribute checks are connected; the
  script-attribute check now gates lazy body/frameset Window handlers. General
  element handlers still await their declarations and scope integration. Parsing the
  remaining directives is not enforcement.
- **Navigation:** network request/response and frame-ancestor integration with
  real nested contexts, navigation state, and response policies. The queued
  [javascript: admission path](../../navigation/ROADMAP.md#html-74232-queued-javascript-navigation-admission)
  now uses form-action, pre-navigation Trusted Types rewriting, and inline checks.
  Admitted requests now execute through ClassicScript, while string-result
  document replacement remains an explicit dependency. The ordinary
  network-navigation consumer must use this navigation algorithm too; Fetch's
  existing request check cannot substitute for it.
  The frame-ancestor matcher, response-policy aggregation, and null-global
  violation/reporting paths are implemented, including synthetic null requests.
  HTML population now performs admission; its error-page and Document loaders remain unfinished.
- **Globals:** worker/worklet initialization and violation construction;
  global event-handler attributes. Window addEventListener already works.
- **Console:** `env.reportConsoleWarning()` is provisional. Supply a real
  Console Printer/output sink while retaining attribution; do not call the
  author's overridable console or substitute Node console output.
- **Compilation:** classic/module script consumers, the preceding Trusted Types
  validation in the string-compilation hook and string timers,
  and WebRTC integrations. Their owning specifications provide these dependencies.

Mixed Content and Upgrade Insecure Requests remain parent-policy algorithms;
CSP contributes directives rather than another upgrade implementation.
Navigation Timing remains [performance work](../../../performance/ROADMAP.md#fetch-and-navigation-integration).

## Validation and sources

Tests cover parsing, matching/fallback, multiple policies, redirects,
enforce/report-only behavior, actual Fetch checks, events, and shared reporting.
Hash cases cover complete/failed reads, all three algorithms, strongest selection,
null/opaque responses, URL capture, opt-out, observer exclusion, and preservation
of the page's body through projected Response.text().

Extend coverage through each real consumer above, especially inline/meta and
code-generation behavior. Independent policy tests do not prove those lifecycles.
Local source: `w3c-csp/index.bs`.
