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
`CSPList.isStyleAttributeBlocked(element, source)` specializes
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
  response/local-URL/history inheritance and policy-container selection.
- **Elements:** inline script and style-block checks, script preparation, and
  element/preload integration. Style-attribute checks are implemented above;
  parsing the remaining directives is not enforcement.
- **Navigation:** form-action, navigation and frame-ancestor checks with real
  nested contexts, navigation state, and response policies.
- **Globals:** worker/worklet initialization and violation construction;
  global event-handler attributes. Window addEventListener already works.
- **Console:** `env.reportConsoleWarning()` is provisional. Supply a real
  Console Printer/output sink while retaining attribution; do not call the
  author's overridable console or substitute Node console output.
- **Compilation:** classic/module scripts and string-compilation host hooks,
  Trusted Types script-sink checks, Wasm compilation, and WebRTC integrations.
  Their owning specifications provide these dependencies.

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
