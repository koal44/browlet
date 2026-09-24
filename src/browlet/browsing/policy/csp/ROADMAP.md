# Content Security Policy roadmap

This folder will own Browlet's
[Content Security Policy Level 3](https://w3c.github.io/webappsec-csp/)
implementation. The [parent policy roadmap](../ROADMAP.md) owns policy-container
association and the neighboring policies; CSP owns its language, directive
behavior, violations, and integration algorithms.

**Status:** The bounded Fetch-preflight slices A, B, and C are implemented.
C supplies Window violations,
DOM events, Reporting bodies, sandbox parsing, base-uri enforcement, and document
initialization directives. Navigation consumes concrete Fetch records, and developer
warnings reach an approved provisional environment method. Hash reporting reads a
separate body branch and sanitizes report URLs. CSP is the last stage of the
[Fetch preflight order](../../../../fetch/PREFLIGHT.md#rejoin-fetch-then-finish-browser-policy).
Main Fetch and automatic network response policy delivery remain unwired.

## Sources and first scope

Local source: `w3c-csp/index.bs` under the
[reference root](../../../../fetch/PREFLIGHT.md#local-reference-inventory).
Read the framework, delivery, integrations, reporting, directive definitions,
and algorithms. The first supported consumer is Fetch; use its real
request/response records rather than a CSP-specific substitute.

## A — Policy model, parsing, and copying

Implemented in [`policy.ts`](policy.ts) and [`list.ts`](list.ts):

- One policy retains its source, disposition, original text, and ordered
  directive map. Names are ASCII lowercase; values retain their spelling.
  The first duplicate wins, with a retained developer warning. Unknown names
  remain data and acquire no enforcement behavior without a directive algorithm.
- String/byte parsing, repeated and comma-separated response headers, separate
  enforcing/report-only policies, and omission of empty policies follow §2.2.
  Source expressions remain tokens; their recognition and matching belong to B.
- `SPEC_CLASH(csp-directive-recovery)`: Eric approved recovery at directive
  boundaries: malformed names/values are discarded without losing valid
  siblings. This follows browser recovery
  rather than rejecting the entire field against its declared ABNF. See
  [the review notes](../../../../../scratch/SPEC-ISSUES.md#csp-policy-parsing-and-self-origin).
- `CSPList` retains its `selfOrigin` from the final response URL. Container
  cloning copies policy/directive data and preserves that origin, including
  opaque identity. Tests also exercise this through Fetch client population.

**Reviewed representation:** `PolicyContainer.cspList` is undefined until its
resource origin is known. Every constructed `CSPList` requires its `selfOrigin`.
Response parsing constructs a list even without policy headers. Document
initialization likewise creates an empty list if none was inherited; it leaves
an existing list and its origin intact. Cloning preserves either absence or an
independent list. Matching never substitutes the current environment's origin.

Parsing warnings are retained for delivery to the owner's developer console in
C. No console effect or enforcement is implied by successful parsing.

## B — Fetch checks and source matching

Implemented in `source-list.ts`, `directives.ts`, `policy.ts`, and `list.ts`
(§§4.1, 6.1, 6.2.2, 6.7, and 6.8):

- Scheme/host/port/path matching, retained `'self'`, redirect path handling,
  exact nonces, and all supported integrity digests rather than just the
  strongest digest. Script checks include parser metadata and strict-dynamic;
  connect-src includes the WebTransport certificate-hash opt-in.
- Destination selection and fallback, including the distinction between a
  worker's explicit worker-src and a selected script-src fallback. Empty
  directives stop fallback. Inline-only and unknown directives stay inert for
  these Fetch checks.
- Real FetchRequest/FetchResponse checks through the optional `FetchCSPList`
  contract on `FetchPolicyContainer`. Main Fetch must invoke
  `request.reportCSPViolations()` before URL upgrades, then
  `request.isBlockedByCSP()` after upgrades. Once the internal response URL
  list is populated, call `response.isBlockedByCSP(request)`.

`ContentSecurityPolicy.createViolationForRequest()` now captures the request's
browser client and original URL, then reports through its DOM/Reporting lifecycle.
The request/response violation expectations pass. The post-response check also
starts hash reporting when requested, without consuming the page's body or
changing the synchronous allow/block result.

### Recorded specification clashes

`SPEC_CLASH` records conflicting rules independently of which one Browlet
follows. The parser's recovery choice is recorded in A above. Eric approved
the first four matching choices below on 2026-09-23; the final three record
existing draft-following behavior. Source inspection is evidence; these were
not new browser execution experiments.

- `csp-resource-hint-matching`: recognize a successful URL match and include
  default-src's own source list when checking prefetch. The draft compares
  `Matches` against `Allowed` and omits that list. Chromium's fallback includes
  default-src. This changes only URL matching, not nonce/strict-dynamic handling
  for resource hints.
- `csp-decoded-integrity`: compare digest bytes, as Chromium and WebKit do;
  Gecko compares encoded strings. Base64url and omitted padding are equivalent,
  while nonces remain exact strings. This aligns with our SRI verification.
- `csp-ipv4-sources`: accept IPv4 hosts, including explicit loopback sources,
  as browser implementations do. The draft's current domain-only host step
  rejects them. IPv6 source-expression grammar remains outside this change.
- `csp-secure-default-port`: permit an explicit HTTP/WS port 80 to match a
  secure upgrade's default port 443. The current port algorithm omits this;
  Chromium, Gecko, and WebKit retain upgrade handling. Other port restrictions
  and the written scheme/path rules remain in effect.
- `csp-websocket-schemes`: keep the draft's ws-to-http/https and wss-to-https
  matches, also present in WebKit. Chromium's `MatchScheme` restricts its
  WebSocket upgrade to ws-to-wss.
- `csp-nondefault-port-upgrades`: keep the draft's equal-port comparison across
  a permitted scheme upgrade, also present in WebKit. For example, an HTTP
  source with port 8080 matches HTTPS on port 8080. Chromium couples scheme
  upgrades to its port-upgrade classification and rejects that case.
- `csp-path-segments`: keep the draft's split-before-decode comparison, also
  present in WebKit. Chromium decodes whole paths before matching, so `%2F`
  can match a literal slash. Browlet keeps those segment boundaries distinct.

Each choice has focused cases in the matching tests. Revisit its marked branch
when the specification or browser behavior changes; retire the marker when the
conflict is resolved and update the rule/evidence together. Broader browser
quirks are not implied.
Details and source locations are in
[SPEC-ISSUES](../../../../../scratch/SPEC-ISSUES.md#csp-fetch-source-matching).

## C — Delivery, initialization, and violations

Implemented independent behavior:

- `CSPViolation` captures the protected Document URL/status/referrer and original
  blocked resource. A queued task dispatches a trusted, bubbling, composed
  `SecurityPolicyViolationEvent`, checking element attachment at delivery time.
  Source locations remain absent when the engine cannot supply author provenance;
  a Node stack is not a substitute.
- `report-to` submits a typed `CSPViolationReportBodyImpl` through existing
  [Reporting](../../../reporting/ROADMAP.md) queues and observers. Deprecated
  `report-uri` prepares actual Fetch requests. The outbound opt-out preserves
  local events and observers. Delivery copies contain only JSON data, with no
  observer body or generating environment.
- Enforced `upgrade-insecure-requests` enables the existing environment policy;
  report-only delivery does not. `base-uri` uses the retained self origin and
  is connected to HTMLBaseElement's frozen-URL algorithm.
- HTML sandbox-token parsing supplies response restrictions before origin and
  Window selection. Multiple enforced header policies combine their restrictions.
- Script hash reports select the strongest requested SHA algorithm, encode the
  digest as SRI-style Base64, and submit through Reporting to each report-to
  endpoint. They are not visible to live or buffered ReportingObservers.

### Visible dependencies and review points

1. **HTML loader:** `NavigationParams` now retains the actual `FetchRequest`,
   `FetchResponse`, and `FetchController`. It parses response CSP and determines
   sandbox restrictions before origin selection. Document creation assigns the
   protected response status and initializes Reporting endpoints; its regression
   passes. Full body consumption and policy-container selection remain loader
   work, including history/local-URL inheritance and the other response policies.
   Local route text stays separate from Fetch's body and goes directly to the
   parser and history source slot. Navigation reads full timing from the Fetch
   controller; creating a PerformanceNavigationTiming entry remains a separate
   [performance gate](../../../performance/ROADMAP.md#fetch-and-navigation-integration).
2. **Developer console:** Eric authorized a provisional no-op for
   `env.reportConsoleWarning()`. The environment identifies the document or worker;
   Console's future internal Printer may share a UserAgent-owned output sink.
   The regression checks attribution and uninterrupted initialization, not visible
   console output. Do not use Node's console or the author's overridable API.
3. **Hash reporting:** Eric approved the body-reading and URL choices on
   2026-09-23. The implementation clones the body, waits for complete bytes, skips
   failed reads, and queues completion on the client's HTML loop. A null body
   hashes the empty byte sequence. Attribution captures sanitized document and
   original resource URLs before reading. Only CORS-same-origin responses expose
   a digest; request response-tainting also guards the internal-response call site.
   Opaque responses report an empty hash without reading their body. The outbound
   opt-out suppresses hash work, and csp-hash remains invisible to observers.
   Later loader/SRI integration should reuse completed bytes or digests instead
   of reading them twice. SRI already specifies Base64; encoding is not a clash.

Network delivery remains gated on Fetch orchestration/transport. Worker violation
construction and global event-handler attributes belong to their HTML consumers;
Window events currently use the existing `addEventListener` path.

### Initialization and reporting clashes

- `csp-sandbox-combination`: Eric approved unioning restrictions, as Blink,
  Gecko, and WebKit do. HTML's written loop instead retains only the last
  enforced sandbox directive; a later policy must not relax an earlier one.
- `csp-report-body-interface`: the draft declares a dictionary inheriting the
  ReportBody interface. Reuse the reviewed Reporting interface model and default
  Web IDL `toJSON`, preserving the concrete body through a base-typed attribute.
- `report-url-stripping`: reuse Reporting's approved copy-and-strip behavior.
  Both drafts mutate the supplied URL and assign an empty fragment, leaving a
  trailing `#`. Browlet preserves the source and removes the fragment entirely.
- `csp-violation-task-source`: the draft leaves the task source unnamed. Browlet
  uses DOM manipulation as WebKit does; Blink uses networking.
- `csp-hash-body-reading`: the draft supplies a Fetch body to SRI's byte
  algorithm without defining its read. Use a separate branch and report only
  completed bytes, following browsers' use of loaded resource data.
- `csp-hash-resource-url`: sanitize the original resource URL as Blink and
  WebKit do, instead of serializing credentials and fragments unchanged.
- `csp-hash-response-tainting`: Fetch passes the internal response to CSP,
  so its type alone does not expose opaque filtering. Also check the request's
  response tainting to prevent disclosure of a cross-origin resource digest.
- `html-navigation-response-timing`: HTML still reads response timing while
  current Fetch owns full timing on its controller. Read the existing controller.
  HTML's published redirect-taint reference is already corrected; the older local
  `hasCrossOriginRedirects` reference therefore does not merit a clash marker.

Browser evidence and the reviewed hash-report choices are recorded in
[SPEC-ISSUES](../../../../../scratch/SPEC-ISSUES.md#csp-initialization-and-violation-reporting).

## Dependency review and later consumers

- **A:** header lists, URL/origin records, ASCII operations, and isomorphic
  decoding already exist. No missing external implementation blocks A.
- **B:** request destination/current URL/redirect count, nonce/parser metadata,
  SRI parsing, and response URL records exist. Source-expression parsing,
  fallback selection, and matching are CSP's own work, not new prerequisites.
- **C:** independent hash reporting is implemented; console output is explicitly provisional.
  DOM event dispatch, scheduling, Reporting queues/bodies, URL sanitization,
  and hashing already exist. Document creation now consumes the real Fetch
  records, including protected response status and Reporting endpoints.
- **Later HTML consumers:** meta delivery and its directive restrictions,
  inline script/style/nonces, navigation/form/ancestor checks, workers/worklets,
  global event-handler attributes, and code compilation need their owning HTML
  lifecycles. Do not represent raw parsing of their directives as implemented enforcement.
- **Other specifications:** string compilation reaches Trusted Types and its
  compliant-string algorithms; Wasm compilation and WebRTC have separate host
  hooks. Audit these at their consumer boundaries instead of extending this
  Fetch preflight into full implementations of those subsystems.

Upgrade Insecure Requests and Mixed Content have their own algorithms under
the parent policy owner. CSP supplies the relevant policy/directive inputs;
it must not acquire another request-upgrade implementation.

## Exit proof and limits

Focused tests cover parsing, source matching, directive fallback, multiple
policies, redirect behavior, and enforce/report-only differences. Integration
tests demonstrate that real Fetch requests/responses are blocked or allowed,
and that violations reach the shared reporting/event lifecycle.

Hash-report tests cover full and failed reads, all three algorithms and strongest
selection, null bodies, opaque disclosure, multiple policies, URL capture,
outbound opt-out, observer exclusion, and preservation of the consumer's bytes.
The hash suite uses running Browlet loops and completion signals, including a
projected Response.text() read, without manually draining queues. All 28 cases
pass on stock Node 26.8.1 and custom Node 27 + compat. The broader custom/compat
Fetch, URL, Reporting, browser policy/lifecycle, DOM event, base-element, and
Browlet run passes 2,140 tests, with one existing skip and the approved
Node.textContent DOM TODO regression.

Later loader/compiler tests must exercise inline code, nonces/hashes, meta
delivery, and code-generation behavior when supported. Do not expose those
branches as working merely because their policy text parses. Broad CSP
conformance remains incomplete until those consumer-specific gates close.

Keep this roadmap through review and the return to Fetch. README consolidation
is a separate documentation pass with Eric.
