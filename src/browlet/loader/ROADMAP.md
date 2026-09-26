# Loader roadmap

The current `BrowletRoute` returns source text synchronously. This directory
will replace that test-oriented seam with response-bearing loading while
leaving Fetch's protocol algorithms in the Fetch implementation.

The implemented sibling `src/fetch` project supplies request,
response, header, body, cancellation, and fetch-algorithm semantics. This
directory supplies HTML settings, policy, task, navigation, and element inputs;
it must not wrap Node's global `fetch()` as an independent second Fetch stack.

| Source / planned source | Contract | Specification |
| --- | --- | --- |
| `document-loader.ts` | Streamed navigation response consumption and Document load coordination; encoding-restart byte retention remains pending | HTML §§7.4–7.5 and 13.2.3 |
| `document-handlers.ts` | Select and populate HTML, XML, text, multipart, media, and content-handler Documents from response MIME/type state | HTML §§7.5.2–7.5.7 |
| `resource-loader.ts` | Fetch-backed subresource requests, credentials, referrer and policy inputs | Fetch plus each HTML element's fetch algorithm |
| `resource-type.ts` | Determine resource type from response metadata and sniffing inputs | HTML §2.5.2 and MIME Sniffing |
| `element-fetch-options.ts` | Normalize CORS settings, referrer policy, integrity metadata, nonce, lazy-loading, blocking, and fetch-priority attributes into Fetch inputs | HTML §§2.5.4–2.5.9; SRI §§3.4–3.5 |
| `linked-resource.ts` | `<link>` processing and external style sheets | HTML §4.2.4 and CSSOM |
| `script-loader.ts` | Shared classic/module graph fetching plus parser, worker, `importScripts()`, and worklet coordination | HTML §§4.12.1 and 8.1.5; HTML §§10.2.4, 10.3.1, and 11.3.2 |
| `preload.ts` | preload/modulepreload resource hints, parser-discovered preloads, and Link-header integrity metadata | HTML §4.2.4; Fetch; SRI §3.6 |
| `response-policy.ts` | Convert response headers into CSP, COOP, COEP, OAC, referrer, permissions, Integrity Policy, policy-container, and `X-Frame-Options` state | HTML §§7.1 and 7.7; Fetch; SRI §3.8.1 |
| `refresh.ts` | Parse `Refresh` response/`meta` input and schedule the corresponding navigation | HTML §7.8 and §4.2.5 |
| `speculation.ts` | Speculation rule sets, parsing/processing, navigational prefetch, and `Speculation-Rules`/`Sec-Speculation-Tags` headers | HTML §7.6 |
| `node-transport.ts` | UserAgent-owned Undici HTTP/1.1 and HTTP/2 adapter, TLS verification, partitioned connections/timing, multiplexing, demand-driven uploads, pause/resume, abort, and shutdown | Fetch network fetch |
| `node-decoder.ts` | Per-response streaming gzip/deflate/Brotli codecs and bounded native transform queues | Fetch content codings |

Fetch's internal network algorithm calls the transport. Loopback HTTP/HTTPS tests exercise headers,
upload/download flow, decoding, and cancellation through the actual HTML loop.
HTTP/2 uses the temporary [vendor patch](../../../vendor/README.md) to preserve
original response fields. Basic authentication is implemented; proxy authentication
remains provisional in the [Fetch roadmap](../../fetch/ROADMAP.md#remaining-fetch-work).
Public `fetch()` now uses this transport. The source-text navigation route
below is unchanged.

**Implemented bounded consumer:** `document-loader.ts` creates the Document
synchronously, including `about:blank`, and consumes a streamed Fetch body.
`BrowletParser.parseBytes()` implements BOM/transport decoding with a UTF-8
fallback; `abort()` cancels input and pending continuations. Complete sniffing,
byte retention for restart, and parser lifecycle remain in the
[parser integration](../html/parser/ROADMAP.md).

`Document.waitForScriptsMayRun()` provisionally resolves immediately because
present callers commit before parser tasks run. `processLinkHeaders()` is a
marked no-op in the pre-media and media phases; preload/link processing and
media selection remain here. Navigation timing retains live Fetch/body/Document
records, pending public Performance entries. The extra ScriptHandler parameter
is still a callable-shape review point until script preparation has an owner.

The real network regression uses Windows-1252 bytes and response CSP, then
checks parsing and live timing/byte counts. It supplies navigation inputs,
selects Fetch's parallel callback queue and sandbox body owner, and commits
before parsing. It does not implement HTML §7.4's state machine, MIME handler
selection, Refresh, or Speculation-Rules processing. These remain HTML work.

The first element consumers should be `<link>`, `<script>`, `<img>`, and
`<iframe>`, in that order of increasing lifecycle reach. That sequence proves
render blocking, parser execution, an ordinary subresource, and a child
navigation without making media playback or the full element catalog loader
prerequisites. Inline `<style>` processing reaches Stylelet without a Fetch.

`browsing/navigation/` owns the navigation state machine; this directory owns
request/response and resource-load lifecycles. `html/parser/` consumes loaded
bytes and may discover resources, but must not become the loader.

`NavigationParams` now retains the actual `FetchRequest`, `FetchResponse`, and
`FetchController`. Response CSP and sandbox restrictions are selected before
origin/Window creation; the created Document receives the protected response
status, redirect taint, resolved referrer, and Reporting endpoints. The CSP
initialization and document-lifecycle tests cover these inputs.
`SPEC_CLASH(html-navigation-response-timing)` records HTML's stale reference to
response timing: Fetch owns full timing on the controller, so navigation reads
its start time there. Creating PerformanceNavigationTiming remains gated by the
[performance roadmap](../performance/ROADMAP.md#fetch-and-navigation-integration).

The synchronous source route creates only Fetch response metadata. Its text
still goes directly to the parser and explicitly into the history source slot;
a streamed network response body must not be stored in that slot. Full navigation
and complete resource lifecycles remain loader work. Policy-container selection must also
preserve history/local-URL inheritance and deliver the other response policies.

Encoding restart still needs loader-owned replayable bytes and response metadata
so the parser can restart without repeating the network request. The current
decoder streams character chunks without retaining the whole body or assembling
a second source string. Future XML Documents use XML's encoding rules instead
of HTML's sniffer, sharing the response/body and completion ownership.

Transport and Fetch callbacks may produce realm-neutral bytes and records off
the event loop. Loader completion, parser resumption, resource events, and
Document state changes must be queued for the destination environment on the
specified networking, DOM-manipulation, or navigation task source; a Node
promise continuation must not become a hidden second lifecycle scheduler.

Worker and worklet processing create their own realms, settings objects, and
lifetime state under `workers/` and `worklets/`. The loader supplies Fetch-backed
classic scripts and module graphs to those callers; it does not own their
globals, ports, exposure, or termination.

Unloading, destroying, and aborting Documents are browsing-lifecycle
algorithms even when they cancel loader work. The loader exposes cancellation
and response/body completion; `browsing/document-lifecycle.ts` orders events,
realm cleanup, navigable detachment, and history state.

Blink's `core/loader`, `platform/loader`, and `DocumentLoader` provide useful
evidence for this split.

## Removal condition

Burn this file when navigation and subresource loading no longer depend on
the source-string route seam and all loading flows through `src/fetch`.
