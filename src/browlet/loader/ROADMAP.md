# Loader roadmap

The current `BrowletRoute` returns source text synchronously. This directory
will replace that test-oriented seam with response-bearing loading while
leaving Fetch's protocol algorithms in the Fetch implementation.

The sibling `src/fetch` project is a prerequisite: it supplies request,
response, header, body, cancellation, and fetch-algorithm semantics. This
directory supplies HTML settings, policy, task, navigation, and element inputs;
it must not wrap Node's global `fetch()` as an independent second Fetch stack.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `document-loader.ts` | Navigation response consumption, replayable response bytes for parser encoding restart, and Document load coordination | HTML §§7.4–7.5 and 13.2.3 |
| `document-handlers.ts` | Select and populate HTML, XML, text, multipart, media, and content-handler Documents from response MIME/type state | HTML §§7.5.2–7.5.7 |
| `resource-loader.ts` | Fetch-backed subresource requests, credentials, referrer and policy inputs | Fetch plus each HTML element's fetch algorithm |
| `resource-type.ts` | Determine resource type from response metadata and sniffing inputs | HTML §2.5.2 and MIME Sniffing |
| `element-fetch-options.ts` | Normalize CORS settings, referrer policy, nonce, lazy-loading, blocking, and fetch-priority attributes into Fetch inputs | HTML §§2.5.4–2.5.9 |
| `linked-resource.ts` | `<link>` processing and external style sheets | HTML §4.2.4 and CSSOM |
| `script-loader.ts` | Shared classic/module graph fetching plus parser, worker, `importScripts()`, and worklet coordination | HTML §§4.12.1 and 8.1.5; HTML §§10.2.4, 10.3.1, and 11.3.2 |
| `preload.ts` | preload/modulepreload resource hints and parser-discovered preloads | HTML §4.2.4 and Fetch |
| `response-policy.ts` | Convert response headers into CSP, COOP, COEP, OAC, referrer, permissions, policy-container, and `X-Frame-Options` state | HTML §§7.1 and 7.7; Fetch |
| `refresh.ts` | Parse `Refresh` response/`meta` input and schedule the corresponding navigation | HTML §7.8 and §4.2.5 |
| `speculation.ts` | Speculation rule sets, parsing/processing, navigational prefetch, and `Speculation-Rules`/`Sec-Speculation-Tags` headers | HTML §7.6 |
| `node-transport.ts` | Adapt a supported Node HTTP/Undici dispatcher to Fetch's transport contract without delegating redirects or browser policy | Fetch network fetch |

The first element consumers should be `<link>`, `<script>`, `<img>`, and
`<iframe>`, in that order of increasing lifecycle reach. That sequence proves
render blocking, parser execution, an ordinary subresource, and a child
navigation without making media playback or the full element catalog loader
prerequisites. Inline `<style>` processing reaches Stylelet without a Fetch.

`browsing/navigation/` owns the navigation state machine; this directory owns
request/response and resource-load lifecycles. `html/parser/` consumes loaded
bytes and may discover resources, but must not become the loader.

For HTML, the loader retains response metadata and enough replayable bytes for
the parser's encoding component to sniff, decode, and request the specified
navigation restart without repeating the network request. It then feeds
decoded character chunks to the streaming parser rather than assembling a
second source string. XML Documents use XML's encoding rules instead of HTML's
sniffer, but share the same response/body and completion ownership.

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
