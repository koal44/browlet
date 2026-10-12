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
| `Navigable.loadHTMLDocument()` in `browsing/navigation/` | Document creation and streamed HTML load coordination using this directory's ResourceReader; encoding-restart byte retention remains pending | HTML §§7.4–7.5 and 13.2.3 |
| Navigable document handlers | Select and populate HTML, XML, text, multipart, media, and content-handler Documents from response MIME/type state | HTML §§7.5.2–7.5.7 |
| `UserAgent.createPotentialCORSRequest()` | Implemented potential-CORS request construction using FetchRequest and its browser owner; element consumers remain pending | HTML §2.5.1 |
| `resource-loader.ts` | Fetch-backed subresource requests, credentials, referrer and policy inputs | Fetch plus each HTML element's fetch algorithm |
| `resource-reader.ts` | Retain response metadata, sniff a bounded prefix, and replay it before subsequent body bytes | HTML §2.5.2, MIME Sniffing, and Streams |
| `element-fetch-options.ts` | Apply shared attribute rules from `dom/nodes/html/attributes/` to element requests, together with integrity, nonce, lazy-loading, blocking, and fetch-priority inputs | HTML §§2.5.4–2.5.9; SRI §§3.4–3.5 |
| `linked-resource.ts` | `<link>` processing and external style sheets | HTML §4.2.4 and CSSOM |
| `script-loader.ts` | Shared classic/module graph fetching plus parser, worker, `importScripts()`, and worklet coordination | HTML §§4.12.1 and 8.1.5; HTML §§10.2.4, 10.3.1, and 11.3.2 |
| `preload.ts` | preload/modulepreload resource hints, parser-discovered preloads, and Link-header integrity metadata | HTML §4.2.4; Fetch; SRI §3.6 |
| `response-policy.ts` | Convert response headers into CSP, COOP, COEP, OAC, referrer, permissions, Integrity Policy, policy-container, and `X-Frame-Options` state | HTML §§7.1 and 7.7; Fetch; SRI §3.8.1 |
| `refresh.ts` | Parse `Refresh` response/`meta` input and schedule the corresponding navigation | HTML §7.8 and §4.2.5 |
| `speculation.ts` | Speculation rule sets, parsing/processing, navigational prefetch, and `Speculation-Rules`/`Sec-Speculation-Tags` headers | HTML §7.6 |

The shared [CORS attribute definition](../dom/nodes/html/attributes/cors.ts) and link/script
`crossOrigin` reflection are implemented. Element loaders must read the current
attribute state when their own algorithms select it; reflection alone does not
start or modify a fetch. Ordinary requests use `createPotentialCORSRequest()`;
module fetches use the separate always-CORS credentials translation, whose absent
attribute default differs. The missing link processing, script preparation, and
module graph owners remain the next integration boundary; no alternate Fetch
path or provisional successful load has been introduced.
The shared referrer-policy attribute and link/script `referrerPolicy` reflection
are also implemented. Loaders must transfer the selected state to the request;
Fetch already resolves an empty request policy from its policy container.

Link/style/script now expose `blocking` token lists and
`isPotentiallyRenderBlocking()`. Their loaders must still enter Document's
unimplemented [render-blocking mechanism](https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism),
propagate the actual blocked state to Fetch, and release blockers at the specified
completion/failure points. Disconnection and loss of blocking eligibility also
need that Document mechanism. The existing script-blocking stylesheet set is
separate. Script's implicit predicate reads prepared `scriptType`; preparation
must supply that state rather than using the raw `type` attribute as a shortcut.
See the [§2.5.8 audit](../html/ROADMAP.md#section-258-blocking-attributes).

Image/link/script `fetchPriority` reflection and the shared fetch-priority
attribute definition are implemented using Fetch's `RequestPriority` type.
Image requests, link processing options (including preload and HTTP Link), and
script preparation must capture that state at their specified steps. Script's
hint does not propagate to module imports. Fetch already passes a request's
priority to `UserAgent.determineFetchPriority()`, but that hook still has no
transport scheduler. Attribute mutation alone neither starts nor reprioritizes
a resource load. See the [§2.5.9 audit](../html/ROADMAP.md#section-259-fetch-priority-attributes).

**Provisional lazy-load resumption representation:** HTML's
[lazy-load resumption steps](https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps)
are currently nullable callbacks on image, iframe, and media implementations,
with a separate poster callback on video. This directly represents the specified
suspended remainder of each loading algorithm while those loaders are missing.
When implementing them, reconsider whether the owning loader should instead
retain pending request/navigation state and expose an ordinary resume method.
Neither representation is locked in. Make that decision once the concrete state
and lifecycle are known; preserve which inputs were captured versus read at
resumption, cancellation/replacement, clearing before invocation, and the
independent media and poster loads.

HTML §2.4.3's `Document.respondToBaseURLChanges()` has approved provisional
consumers: a basic HTML script result (§4.12.1), a parse-result record initialized
without parsing, and a no-op Window update (§8.1.4.9).
`Document.considerSpeculativeLoads()` (§7.6) is also a marked no-op. Completing it
requires rule matching, candidate selection, prefetch/prerender state, and
navigation lifecycles; it is a substantial subsystem, not a direct `fetch()` call.
The result type lives in `scripting/speculation-rules.ts`; expand its currently
null rule-set field when the concrete rule-set representation is implemented here.

UserAgent composes the [Node transport](../integration/network/node-transport.ts)
and [native decoders](../integration/network/node-decoder.ts) from `integration/network/`.
Fetch's internal network algorithm calls the transport. Loopback HTTP/HTTPS tests exercise headers,
upload/download flow, decoding, and cancellation through the actual HTML loop.
HTTP/2 uses the temporary [vendor patch](../../../vendor/README.md) to preserve
original response fields. Basic authentication is implemented; proxy authentication
remains provisional in the [Fetch roadmap](../../fetch/ROADMAP.md#remaining-fetch-work).
Public `fetch()` now uses this transport. The source-text navigation route
below is unchanged.

**Implemented bounded consumer:**
[`Navigable.loadHTMLDocument()`](../browsing/navigation/navigable.ts) creates the
Document synchronously, including `about:blank`, and coordinates streamed
parsing through ResourceReader and HTMLDocumentParser. Callers supply the reader
already used for MIME determination and handler selection; the HTML handler
does not construct a fresh reader. The about:blank path consumes no bytes.
`HTMLDocumentParser.parseBytes()` implements BOM/transport decoding with a UTF-8
fallback; `abort()` cancels input and pending continuations. Encoding sniffing,
byte retention for restart, and parser lifecycle remain in the
[parser integration](../html/parser/ROADMAP.md).

`Document.waitForScriptsMayRun()` provisionally resolves immediately because
present callers commit before parser tasks run. `processLinkHeaders()` is a
marked no-op in the pre-media and media phases; preload/link processing and
media selection remain here. Navigation timing retains live Fetch/body/Document
records, pending public Performance entries. The extra ScriptHandler parameter
is still a callable-shape review point until script preparation has an owner.

The real network regressions use Windows-1252 with a supplied type and UTF-8
with no supplied type. They determine the MIME type before passing the same
ResourceReader to the HTML handler, then check parsing, CSP, and live byte counts.
They supply navigation inputs, select Fetch's parallel callback queue and sandbox
body owner, and commit before parser input tasks run. They do not implement
HTML §7.4's state machine, general MIME handler selection, Refresh, or
Speculation-Rules processing. These remain HTML work.

The first element consumers should be `<link>`, `<script>`, `<img>`, and
`<iframe>`, in that order of increasing lifecycle reach. That sequence proves
render blocking, parser execution, an ordinary subresource, and a child
navigation without making media playback or the full element catalog loader
prerequisites. Inline `<style>` processing reaches Stylelet without a Fetch.

`browsing/navigation/` owns the navigation state machine and document-load
coordination; this directory supplies resource consumption and shared loading
facilities below navigation. `html/parser/` consumes loaded bytes and may
discover resources, but must not become the loader.

`NavigationParams` now retains the actual `FetchRequest`, `FetchResponse`, and
`FetchController`. Navigable selects response CSP and sandbox restrictions before
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
and complete resource lifecycles remain integration work between navigation and
the loading facilities. Policy-container selection must also
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
and response/body completion; Document owns its events and cleanup, while
`browsing/navigation/` owns destination selection and history state.

Blink's `core/loader`, `platform/loader`, and `DocumentLoader` provide useful
evidence for this split.

## Section 2.5.2 resource reading

The [ordered HTML audit](../html/ROADMAP.md#section-25-audit) now connects the
existing MIME algorithms to a response body through `ResourceReader`:

- The reader retains the underlying response and a concrete MIME type once
  determined. Overlapping determination calls throw; the operation's Promise
  stays local, and later calls return the completed type. It
  supplies metadata and no-sniff state to MIME's pure functions. HTTP metadata
  passes the last Content-Type field unchanged as a byte string; other schemes
  use their supplied parsed type without the HTTP workaround.
- Header collection stops at 1445 bytes, EOF, or a 500 ms monotonic deadline.
  MIME Sniffing explicitly leaves the reasonable time limit to the user agent;
  500 ms is Browlet's initial policy, not a specification constant.
  Supplied HTML/XML types return before reading, as the sniffing algorithm
  requires no body inspection for them.
- One Streams reader supplies the prefix and subsequent body input. Callers
  finish determination before reading the body, then drain the complete chunks,
  including bytes beyond that prefix. There is no stream tee or second source
  reader. The deadline ends inspection; the outstanding Fetch read remains
  available to the body consumer. EOF, errors, and cancellation release the lock.
- Stream operations enter the body's owning environment, which may be the
  browser sandbox. Parser input separately enters the destination Document's
  networking tasks. Neither sniffing nor host Promise completion changes that owner.

`determineMIMEType()` asks MIME's `preservedMIMEType()` whether supplied metadata
is sufficient. Otherwise, it collects at most 1445 bytes into a local prefix
buffer, then calls `sniffMIMEType()` once with that prefix and the UserAgent's
support predicate. MIME interprets the bytes; ResourceReader owns collection,
the deadline, and the resulting concrete type. Its body-consumption code does
no sniffing. Collection copies at most 1445 bytes, avoiding a second chunk list
and stateful sniffer; complete Fetch chunks remain available for body delivery.

The deadline uses the UserAgent's monotonic clock and timer host. Collection
checks the clock before admitting each chunk, excluding late bytes even when
the timer is delayed. Early wakeups wait out the remaining interval. There is
no polling loop or MIME completion callback, and supplied HTML/XML types require
neither a prefix buffer nor a timer.
`read()` is Browlet's pull interface and throws until a concrete MIME type is
available. It returns buffered chunks first, then chains the outstanding or
next Fetch read directly. There is no separate body resolver or dispatcher.
The source read retains its result until sniffing or the consumer takes it,
including when it completes between the sniffing deadline and consumer demand.
`FetchBody.readChunk()` owns one source read, byte validation, copying, and
task delivery. The resource owner acquires one Streams reader and requests
another chunk only when sniffing or the consumer needs it. Promises represent
ongoing work and the one unconsumed Fetch result; the completed MIME type and
inspected body chunks are retained directly.
Terminal EOF or failure remains available to later reads without
reacquiring the stream. The resource owner releases its
lock on EOF, failure, or cancellation, cancels the body in its stream's
environment, and discards deliveries queued before cancellation.
`FetchBody.incrementallyRead()` reuses the same primitive for its automatic loop.
`readAll()` waits for EOF, and `BodyMixin.textStream()` always decodes UTF-8,
so neither supplies this bounded byte-reading contract.
The shape follows the inspected browser pipelines: Chromium's
[URLLoader](https://chromium.googlesource.com/chromium/src/+/main/services/network/url_loader.cc)
sniffs its delivery buffer before exposing the response. Blink's
[MimeSniffingURLLoader](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/loader/mime_sniffing_url_loader.cc)
and Gecko's
[nsUnknownDecoder](https://searchfox.org/mozilla-central/source/netwerk/streamconv/converters/nsUnknownDecoder.cpp)
forward retained prefix bytes before subsequent input. This informs ownership,
not Browlet's chosen byte limit or deadline.

Two integration gates remain explicit. UserAgent's support predicate still
returns false provisionally; the concrete document/image/media support policy
must follow the handlers Browlet actually supplies. General handler selection
still precedes `Navigable.loadHTMLDocument()`: the tests explicitly select known/sniffed
HTML, while XML, text, media, and other handlers remain §7.5 work. Context-specific
sniffers remain in MIME for their eventual element consumers. Reading a header
does not implement HTML encoding restart or retain the entire response for replay.

The [MIME integration notes](../../mime/ROADMAP.md) remain until the support
policy and handler selection are settled. Fetch's MIME/nosniff blocking checks
continue to serve their separate requirements.

## Removal condition

Burn this file when navigation and subresource loading no longer depend on
the source-string route seam and all loading flows through `src/fetch`.
