# Fetch roadmap

The planned Fetch delivery slices (1-9, including 9A-9E) and independent
preflight work are complete. This is a delivery milestone, not a claim of full
Fetch or HTML conformance. [README.md](README.md) describes the current contracts;
[PRIORITY.md](../PRIORITY.md) controls the order of subsequent work.

## Conformance audit

Completed 2026-09-26 through Fetch §6, against local `whatwg-fetch/fetch.bs`
at `586cd2a`, with focused implementation, binding, transport, and WPT coverage.
The remaining implementation work is deferred below. Reviewed specification
and upstream-test disagreements remain documented under retained decisions.

## Early Hints response URL handoff

The next HTML §7.5.1 dependency audit reproduced missing provenance on 103 responses:
HTTP/1.1 and HTTP/2 callbacks received `url === null`, and hints delivered around
manual redirects had empty URL lists. Fetch now snapshots the producing request's
URL list, including the URL records, when creating each informational response.
Queued delivery and later redirects cannot advance an earlier hint's base URL.
The HTTP transport contract and final-response processing are unchanged.

`SPEC_GAP(early-hints-response-url)`: Fetch's HTTP network algorithm queues the 103
callback before HTTP-network-or-cache fetch assigns the final response URL list.
HTML nevertheless requires the hint response's URL to create its early policy
container and to choose Link's base URL and origin. Retain the producing request
history here, without substituting the departing Document or a later final URL.
The standards' acknowledged HTTP/Fetch layering gap leaves that interim assignment
implicit. This supplies existing inputs; it does not create a new policy decision.

Sources: [HTTP network fetch](https://fetch.spec.whatwg.org/#http-network-fetch),
[HTTP-network-or-cache fetch](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch),
[HTML early hint processing](https://html.spec.whatwg.org/multipage/semantics.html#process-early-hint-headers).
Both local specification checkouts were refreshed from upstream on 2026-11-06.
Browser source corroborates keeping navigation provenance available: Chromium's
[Early Hints manager](https://github.com/chromium/chromium/blob/main/content/browser/loader/navigation_early_hints_manager.cc)
receives the navigation request and retained origin, while Gecko's
[EarlyHintsService](https://github.com/mozilla/gecko-dev/blob/master/netwerk/protocol/http/EarlyHintsService.cpp)
receives the response's base URI and channel. These are source observations,
not a live browser comparison or a claim that their complete hint policies agree.
Extractlet's complete Chromium capture supplied no capture warnings.

Regressions retain real HTTP/1.1 and HTTP/2 coverage plus same/cross-origin manual
redirects. Navigation's first-hint test runs real policy-container construction
with the incoming reserved environment, checks the destination CSP self origin,
and keeps early policies separate from the final response's policies. HTML now
performs real Link option preparation through `FetchHeaders.extractLinks()`, which
filters anchors and expands relations over `extractRawLinks()`'s parsed fields.
CSSOM uses the raw view to retain complete relation lists; both leave target URL
resolution to their consumers. Tests control only unfinished resource operations.
Preload/preconnect/modulepreload and actual
preload/module-map commitment remain explicit throwing dependencies.

## Remaining Fetch work

Background cache revalidation retains the execution environment passed to the
original fetch and uses a parallel response queue. It still belongs to the
initiating client's FetchGroup for policy and termination. The regression in
`test/browlet/fetch-http-cache.test.ts` verifies refresh and body completion while
the client Document is inactive; previously even HTTP dispatch stalled. This
follows Fetch §4.6's parallel revalidation step. Separating the client type from
the complete execution-environment contract remains an architecture follow-up.

- **Early Hints consumption:** The response URL handoff above is implemented.
  HTML's reserved-environment callback prepares headers and retains its Document
  callback, but resource operations and actual preload/module-map commitment
  still throw. See the [Link boundary](../browlet/loader/ROADMAP.md#link-header-preparation).
- **Content-Disposition rejection:** Navigation now uses Fetch's header-list
  extraction and RFC 6266 attachment classification; HTTP owns single-value parsing.
  Identical repeated values are accepted; conflicting values explicitly throw during classification. Producing
  the network error seen in Chromium/Firefox still needs an HTTP response-processing
  audit; ordinary Fetch traffic is not yet rejected by this consumer-side boundary.
  WebKit selects the last value instead. The approved browser choices, malformed
  type recovery, and missing download owners are in the
  [navigation audit](../browlet/browsing/navigation/ROADMAP.md#downloads-and-responses-without-a-document).
- **Policy-controlled request features:** `FetchRequest.isAllowedToUseFeature()`
  implements Permissions Policy §9.15 through the initiating client's Document.
  Client Hints and other request-feature owners still need their definitions and
  callers; this is not a general network-request blocking check. See the
  [policy roadmap](../browlet/browsing/policy/permissions-policy/ROADMAP.md#915-request-feature-checks).
- **Group cancellation:** `FetchGroup.cancel()` is a provisional no-op. Complete
  HTML's task/data disposal and keepalive/deferred rules; controller cancellation
  and non-keepalive group termination already work.
  The real Speculation-Rules body test reproduces missing failure delivery after
  `Document.abort()`; Eric approved its expected-failure classification on 2026-11-06.
  See the [header loader audit](../browlet/loader/ROADMAP.md#speculation-rules-header-loading).
- **Speculation-rules destination:** HTML's header loader now uses the internal
  `speculationrules` destination and subresource classification. Fetch still lacks
  that destination (`SPEC_GAP(speculation-fetch-destination)`,
  [PR #1952](https://github.com/whatwg/fetch/pull/1952)); its proposed public enum
  and new CSP directive await the owning Fetch/CSP audit. It is not script-like:
  header rule sets require JSON, not JavaScript MIME, including with nosniff.
- **Deferred fetching:** [§4.12](https://fetch.spec.whatwg.org/#deferred-fetch)
  now has quota reservation/accounting and request-length calculation, connected
  to HTML navigation and Document creation. `fetchLater()`, FetchLaterResult,
  body validation/buffering, activation, and pending record processing remain
  unfinished. Coordinate HTML lifecycle, Permissions Policy, and the
  deferred-fetch task source's priority over script-running tasks. Pending
  records currently fail explicitly; do not mark them sent without execution.
  See [the quota audit](../browlet/browsing/navigation/ROADMAP.md#deferred-fetch-quota-at-navigation)
  for the approved Chromium disagreements and missing specification inputs.
- **Transport:** HTTPS DNS resource-record upgrades must not retry as HTTP.
  External DNS/connection establishment currently belongs to the Node adapter;
  any DNS caching must respect network partitions. Commented `ConnectionPool.obtain()`
  is reference material, not a second connection path.
- **Additional scope:** proxy authentication needs a configured proxy identity
  and transport route; other authentication schemes need their RFCs. `file:`
  needs an embedder policy. HTTP/3, WebSockets, and WebTransport remain separate
  protocol work. [Vendor fixes](../../vendor/README.md) have their own removal gate.

### HTTP cache

The store and transactions are implemented; these extensions remain open:

- Invalidate permitted same-origin Location/Content-Location targets after
  successful unsafe requests ([RFC 9111 §4.4](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.4)).
  Current invalidation covers the request URI and its variants.
- Range/partial storage and local evaluation of authored preconditions remain
  unsupported; preserve their current network fallback. Future combination needs
  strong validators, actual clock evidence for Last-Modified strength, applicable
  Content-Range checks, and encoded-length validation. Multipart/form-data is not
  a multipart/byteranges parser. Keep trailers separate from response headers.
- Do not turn stale-if-error into an unconditional network-error fallback.
  Reusable field/freshness rules remain with the [HTTP cache owner](../http/ROADMAP.md#cache).

Undici's cache stores hide candidate selection and cannot simply replace ours:
[the comparison probe](../../test/fetch/probes/undici-cache-selection.mjs) found
older-Date selection for overlapping variants in both backends at 8.10.0.
It remains an ordinary failing external probe, outside the unit suite. Revisit
reuse only with correct selection, partitioning, and header/body preservation.

## Owner integration gates

| Owner | Remaining work / present boundary |
| --- | --- |
| [HTML loader](../browlet/loader/ROADMAP.md) and [parser](../browlet/html/parser/ROADMAP.md) | The byte-loader proof has BOM/transport decoding and UTF-8 fallback, plus abort. Complete sniffing/restart, script readiness, Link/preload processing, MIME handlers, and navigation. The source-text route remains separate. |
| [Browsing](../browlet/browsing/ROADMAP.md) and [browser policy](../browlet/browsing/policy/ROADMAP.md) | Complete nested/srcdoc ancestry, policy inheritance, lifecycle/history destruction, navigation/download consumers, and actual automation sessions. Request's provisional prompt-target copy uses source-origin equality; the draft still describes the older settings-object target. |
| [Performance](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration) | Completed HTTP fetches produce Resource Timing entries and filtered Server Timing metrics. Navigation retains live Fetch/controller timing; its public entry/lifecycle integration remains pending. Server-Timing trailers need transport delivery before resource entry publication. |
| [Workers](../browlet/workers/ROADMAP.md) | Actual Service Worker selection, dispatch, response validation, timing, and body disposal. The no-worker hook returns null without preparing a clone. |
| [File](../file/ROADMAP.md), [media](../browlet/media/ROADMAP.md), and [XHR](../xhr/ROADMAP.md) | Worker Blob URL cleanup, MediaSource object URLs, HTML-backed FormData construction, and XHR's Fetch consumer. Blob-only object URLs already work. |

Preload lookup currently misses, priority scheduling and BiDi hooks use their
provisional/default paths, and document MIME support is limited. Replace these
at their owners. Consumer integration should use Fetch's existing entry and
records, without recreating HTTP/cache/CORS or inventing replacement environments.

The independent [HTTP/HSTS](../http/ROADMAP.md), [Storage](../storage/ROADMAP.md),
[Reporting](../browlet/reporting/ROADMAP.md), [Mixed Content/UIR](../browlet/browsing/policy/ROADMAP.md),
and [CSP](../browlet/browsing/policy/csp/ROADMAP.md) work is implemented within its
recorded scope. Their remaining features stay with those owners; preflight is
not a second backlog. HTML's element/preload algorithms still supply SRI inputs;
browser policy owns Integrity-Policy parsing and reports.

## HTML credentialless follow-up

Added during the HTML §7.1.4 audit on 27 October 2026; this was not an omission
recorded by the earlier WHATWG Fetch audit. [HTML's COEP preamble](https://html.spec.whatwg.org/multipage/browsers.html#coep)
strongly encourages Private Network Access and Opaque Response Blocking before
credentialless support. These are separate proposals, not steps in either the
audited Fetch snapshot or the [published Fetch snapshot checked on that date](https://fetch.spec.whatwg.org/commit-snapshots/59afe349913d56898c947576216f1c2579308be7/).

- [PNA §3.4](https://wicg.github.io/private-network-access/) proposes Fetch
  changes for IP-address-space classification and private-network authorization.
  It is a separate WICG draft; selecting its integration requires an independent audit.
- ORB's [original proposal](https://github.com/annevk/orb) points to
  [Fetch PR #1442](https://github.com/whatwg/fetch/pull/1442). The
  [updated PR #1755](https://github.com/whatwg/fetch/pull/1755) is also unmerged
  as of this check. Its response classification/blocking and HTML metadata
  dependencies need their own audit.

Neither pipeline is implemented. Existing COEP credential suppression and CORP
checks implement their Fetch algorithms but do not supply these additional
protections. Browlet currently grants only logical isolation, with
`crossOriginIsolated` false. Keep this HTML follow-up separate from the known
unfinished Fetch algorithms above.

## Retained specification decisions

Identifiers match source markers. Browser observations were collected in
September 2026; WebKit results refer to Playwright's build. Tests live in
`test/fetch`, `test/browlet/fetch-*.test.ts`, and the linked subsystems.
Revisit these decisions when the specification or implementation evidence changes.

### Completion and execution

- **`navigation-fetch-completion` (gap):** Fetch finale assigns end time only
  within optional Resource Timing reporting, leaving controller-backed
  navigation timing at zero when no resource report is requested. Record
  completion at body end for navigation requests, using the fetch's existing
  coarsening precision. The regression failed with zero instead of `100.5`;
  all three browsers update their navigation entry without an extra resource
  report. Ordinary resource reporting retains its report-time precision and
  later entry-realm conversion. See the [creation audit](../browlet/performance/ROADMAP.md#navigation-timing-automatic-creation).
- **`navigation-fetch-full-timing`:** [Fetch finale](https://fetch.spec.whatwg.org/#fetch-finale)
  retains controller timing only for destination document, but HTML's child
  navigation requests use iframe/frame/object/embed and need that timing when
  creating their Document. Eric approved retaining the existing timing record for
  all navigation destinations through `request.isNavigation`. The regression first
  passed for document and failed for all four child destinations at
  `extractFullTimingInfo()`. [HTML issue #12887](https://github.com/whatwg/html/issues/12887)
  records the removed response timing field; the open [replacement PR #12890](https://github.com/whatwg/html/pull/12890)
  also contains discussion of this child-destination conflict. The change supplies
  the destination's timing handoff without changing TAO, parent resource timing,
  or public entry delivery. `test/fetch/timing.test.ts` and the navigation parameter
  tests cover it. Synthetic-response timing remains HTML's separate lifecycle work.
- **`fetch-finale-byte-stream` / `fetch-body-completion`:** [Fetch finale](https://fetch.spec.whatwg.org/#fetch-finale)
  prescribes a generic transform, losing BYOB and observing only normal flush.
  Keep the original stream and finish bookkeeping on close, error, or cancel;
  consumer errors remain errors. Synchronous internal `onCompletion()` steps
  preserve completion-before-consumption ordering without pulling or adding a
  promise reaction. [Undici uses a passive completion observer](https://github.com/nodejs/undici/pull/3093#issuecomment-2050198541).
  Blink BodyStreamBuffer, Gecko FetchBody, and WebKit FetchBodySource retain byte
  streams; live network/clone BYOB and abort/cancel probes passed in all three.
- **`service-worker-unused-body` (gap):** [handle fetch](https://w3c.github.io/ServiceWorker/#on-fetch-request-algorithm)
  does not settle ownership of the eager clone on a no-worker return. Select
  interception before `prepareRequest()`; call it once before body consumption.
  [Blink's interception loader](https://github.com/chromium/chromium/blob/main/content/renderer/service_worker/service_worker_network_provider_for_frame.cc), Gecko's controller/handler checks,
  and WebKit's registration/active-worker checks support this ordering. A dispatched worker
  may retain its branch; a null response alone does not justify canceling it.
- **`fetch-borrowed-realm`:** successful promise/Response use the receiving
  Window, like [Blink](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/fetch/global_fetch.cc)
  and Gecko; WebKit uses the method's realm. Conversion failures use the method's
  realm. Covered through related Windows and actual bindings.
- **`fetch-tls-start`:** [clamp/coarsen](https://fetch.spec.whatwg.org/#clamp-and-coarsen-connection-timing-info)
  names connection end for TLS start. Retain actual TLS start, as all three
  engines' source does; this evidence is not a live timing measurement.
- **`resource-timing-end-clock`:** Fetch's completion callback makes end time
  relative, while [Resource Timing's conversion](https://w3c.github.io/resource-timing/#dfn-convert-fetch-timestamp)
  subtracts the entry owner's origin again. Retain a coarsened shared-clock end
  time, converting once in the entry. The regression first observed `20.543...`
  instead of `100.5` for a shared reading of `100.543` and origin `80`.
  This also corrected `FetchTimingInfo.createOpaque()` to retain end time and
  render-blocking, as Fetch already specifies. Its former regression incorrectly
  required both to be cleared; the corrected expectations failed before the fix.
  Automatic delivery now reaches Resource Timing entry construction, observer
  queueing, and resource-specific buffering. See the
  [Fetch timing integration](../browlet/performance/ROADMAP.md#fetch-produced-resource-timing)
  for approved CORS body-size exposure, local-cache phase/protocol normalization,
  plain-HTTP TLS-zero preservation, and failed-response opacity. The final
  environment argument carries combined TAO/CORS transfer-size permission;
  timing phases and filtered body/status records retain their separate rules.
  MIME support classification, service-worker observations, and worker-producer
  acceptance remain explicit owner dependencies.

### HTTP, Blob, and CORS

- **`referrer-empty-policy`:** HTML §7.1.7 response association exposed the
  missing empty-policy fallback on 27 October 2026. Referrer Policy §3.9 requires
  strict-origin-when-cross-origin; §8.3 instead says Fetch never supplies empty
  and omits its switch case. Follow §3.9 during calculation without rewriting
  the retained policy. The [policy audit](../browlet/browsing/policy/ROADMAP.md#referrer-policy)
  records the source conflict and failing-then-passing calculation/Blob/data tests.
- **`cookie-samesite-context`:** sending and storage use distinct browser
  decisions rather than Fetch's shared SameSite mode. The approved navigation,
  client, and redirect choices and evidence stay in the
  [HTTP roadmap](../http/ROADMAP.md#cookies).
- **`corp-clientless-policy`:** [CORP](https://fetch.spec.whatwg.org/#cross-origin-resource-policy-check)
  assumes settings, but clientless requests retain origin and embedder policy.
  Enforce those fields without a reporting recipient. Blink/Gecko/WebKit retain
  the equivalent initiator/principal and policy independently of a live Window.
- **`blob-clientless-access-context`:** [Blob scheme fetch](https://fetch.spec.whatwg.org/#scheme-fetch)
  can derive a null client; File API still needs storage authorization. Require a
  client/reserved environment or the explicit top-level-navigation exemption;
  otherwise throw InternalError. Browsers retain a token/principal/access context.
- **`blob-suffix-range-bounds`:** the same algorithm can produce negative or
  inverted bounds. Clamp oversized suffixes like Blink/WebKit (Gecko rejects);
  reject zero suffixes and empty ranges.
- **`multipart-redirect-replay`:** [redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch)
  re-extracts a body, which would regenerate a boundary under retained headers.
  Replay captured encoded data, as browsers retain serialized upload content.
- **`keepalive-current-request-accounting`:** [HTTP-network-or-cache fetch](https://fetch.spec.whatwg.org/#http-network-or-cache-fetch)
  counts the registered request twice. Count it once against 64 KiB, consistent
  with Blink and WebKit. **`basic-authored-authorization`:** prompting cannot
  replace an author header; return the 401 rather than retry unchanged, as Gecko
  tests. Scope selection/retry policy belongs to [HTTP authentication](../http/ROADMAP.md).
- **`keepalive-null-client`:** the same algorithm assumes a client fetch group.
  Pre-global CSP reports have none. Keep the 64 KiB per-request bound with zero
  additional group bytes, without borrowing the execution owner's group. Eric
  approved this gap resolution on 2026-11-03; aggregate clientless quotas remain
  unspecified, rather than inferred from browser report uploads.
- **`csp-report-no-cors-redirect`:** [CSP #320](https://github.com/w3c/webappsec-csp/issues/320)
  records that CSP's no-cors/error report requests conflict with main fetch's
  unconditional rejection. Admit that combination for the internal report
  destination only; HTTP fetch still rejects redirects and sends no CORS
  preflight. Chromium, Firefox, and WebKit sent one POST and rejected 302/307
  collector redirects in the navigation-CSP probe. Ordinary no-cors requests and
  report requests with manual redirects remain rejected. The focused regression
  first observed zero dispatches, then passed after this approved correction.
- **`cors-cache-credentialed-wildcard` / `cors-cache-permission-refresh`:**
  [§4.9 lookup](https://fetch.spec.whatwg.org/#cors-preflight-cache) expands `*`
  beyond §3.3's credential restriction; §4.8's broad refresh can renew older,
  broader grants. Require explicit credentialed permissions and refresh only
  the exact permission and credentials flag. Preserve broader grants' expiry.
  [Blink](https://github.com/chromium/chromium/blob/main/services/network/cors/preflight_result.cc)
  and WebKit retain credential restrictions; Gecko caches explicit tokens under
  credential-specific keys. Browsers do not promote the new narrow grant this way.
- **`cors-authorization-wildcard` / `cors-preflight-invalid-max-age`:** require
  explicit Authorization as Fetch says ([browser exception](https://github.com/whatwg/fetch/issues/1919));
  malformed/repeated/negative max-age uses Fetch's five-second fallback. Gecko
  skips invalid caching; Blink/WebKit accept negative values as expired.
- **Credentialless redirect taint, resolved:** Browlet already uses same-origin
  redirect taint for credentials. The audited snapshot's inverse was reported in
  [Fetch #1958](https://github.com/whatwg/fetch/issues/1958) with
  [fix #1959](https://github.com/whatwg/fetch/pull/1959). The
  [published algorithm](https://fetch.spec.whatwg.org/commit-snapshots/59afe349913d56898c947576216f1c2579308be7/#cross-origin-embedder-policy-allows-credentials)
  now agrees; retired `SPEC_CLASH(coep-redirect-taint)` on 27 October 2026 without
  changing behavior. The local audited source at `586cd2a` still has the old text.
- **`metadata-user-boolean`:** [Sec-Fetch-User](https://w3c.github.io/webappsec-fetch-metadata/#sec-fetch-user-header)
  is a boolean in its definition/ABNF but a token in its setter. Serialize `?1`,
  matching the definition, examples, and Blink/Gecko source.

### SRI and multipart

- **`sri-metadata-parsing` / `sri-digest-comparison`:** follow the declared SRI
  expression grammar, ASCII whitespace, canonical lowercase algorithm names,
  and decoded digest bytes. The prose parser/comparator disagrees. Keep valid
  but undecodable strongest hashes as failures. All three engines accept
  Base64url/unpadded digests and whitespace; only WebKit enforces uppercase
  names. See [SRI #84](https://github.com/w3c/webappsec-subresource-integrity/issues/84),
  [#172](https://github.com/w3c/webappsec-subresource-integrity/issues/172), and
  [historical syntax recovery](https://github.com/w3c/webappsec/issues/317#issuecomment-120958432).
- **`multipart-empty-body` / `multipart-part-recovery`:** accept a closing-only
  empty FormData body as [browsers serialize it](https://github.com/chromium/chromium/blob/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/core/html/forms/form_data.cc#L347), despite RFC 2046's first-part
  grammar. Reject malformed parts and duplicate disposition/type fields instead
  of WebKit's partial recovery. Fetch delegates parsing to RFC 7578; strict
  whole-body rejection follows Blink's FetchDataLoaderAsFormData and Gecko's FormDataParser. Coverage
  remains in [multipart.test.ts](../../test/fetch/multipart.test.ts).
  The pinned [WPT empty-body test](https://github.com/web-platform-tests/wpt/blob/54f8f933629e7c010ae98a246729af01f8abcda5/fetch/api/response/response-consume-empty.any.js)
  instead expects `new Response(new FormData()).text()` to yield zero bytes.
  On 2026-09-26, Chromium 149, Firefox 151, and Playwright WebKit 26.5 all emitted
  the closing boundary, like Browlet. Retain that encoding; the selected WPT
  preserves the upstream assertion and therefore still fails.
