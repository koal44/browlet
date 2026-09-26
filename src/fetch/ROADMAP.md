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

## Remaining Fetch work

- **Group cancellation:** `FetchGroup.cancel()` is a provisional no-op. Complete
  HTML's task/data disposal and keepalive/deferred rules; controller cancellation
  and non-keepalive group termination already work.
- **Deferred fetching:** [§4.12](https://fetch.spec.whatwg.org/#deferred-fetch)
  still needs `fetchLater()`, FetchLaterResult, quotas, activation, and pending
  record processing. Coordinate HTML lifecycle, Permissions Policy, and the
  deferred-fetch task source's priority over script-running tasks. Pending
  records currently fail explicitly; do not mark them sent without execution.
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
  Reusable field/freshness rules remain with the [HTTP cache owner](../http/cache/ROADMAP.md).

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
| [Performance](../browlet/performance/ROADMAP.md#fetch-and-navigation-integration) | Timing/body records exist; public Resource/Navigation Timing entries remain pending. Navigation retains live Fetch/controller timing. |
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

## Retained specification decisions

These are approved choices, not new review requests. Identifiers match source
markers. Revisit them when the specification or implementation evidence changes.
Browser observations below were collected in September 2026, not rechecked by
this documentation consolidation; Playwright WebKit observations are not Safari
claims. Tests live in `test/fetch`, `test/browlet/fetch-*.test.ts`, and the linked
owners. Callable-shape choices already accepted are documented in code, not
kept as pending mismatch flags.

### Completion and execution

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

### HTTP, Blob, and CORS

- **`cookie-samesite-context`:** sending and storage use distinct browser
  decisions rather than Fetch's shared SameSite mode. The approved navigation,
  client, and redirect choices and evidence stay in the
  [cookie roadmap](../http/cookies/ROADMAP.md#implementation-order).
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
- **`coep-redirect-taint`:** use same-origin redirect taint for credentialless
  credentials. The draft's inverse was reported in [Fetch #1958](https://github.com/whatwg/fetch/issues/1958)
  with [fix #1959](https://github.com/whatwg/fetch/pull/1959). Confirm publication
  before retiring the marker; the last recorded check found the PR still open.
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
