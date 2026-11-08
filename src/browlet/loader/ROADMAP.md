# Loader roadmap

The current `BrowletRoute` returns source text synchronously. This directory
will replace that test-oriented seam with response-bearing loading while
leaving Fetch's protocol algorithms in the Fetch implementation.

The implemented sibling `src/fetch` project supplies request,
response, header, body, cancellation, and fetch-algorithm semantics. This
directory supplies HTML settings, policy, task, navigation, and element inputs;
it must not wrap Node's global `fetch()` as an independent second Fetch stack.

Loading separates discovery, request execution, resource readiness, and owner
completion. URL parsing alone starts no request. Navigation/iframe loads, script
graphs, image candidate selection, media tracks, workers/worklets, and link hints
have different response processing and cancellation lifetimes. Preloading a
stylesheet does not apply it; speculative or lazy discovery does not establish
successful use. Keep each completion contract with its consuming owner.

`HTMLIFrameElementImpl.runLoadEventSteps()` is called by initial-insertion
javascript: completion and queued Document completion. It checks potential
Permissions Policy violations after the element's `load` handlers return,
using current raw `allow` and `src`, before clearing the child's load-in-progress
flag. Child Window `load` is a separate event. Pending fallback resource timing,
automatic attribute processing, and `document.open()`'s mute producer remain
explicit dependencies.
See the [integration review](../browsing/policy/permissions-policy/ROADMAP.md#101-html-integration).

The javascript: string-result path now calls `Navigable.loadHTMLDocument(params)`
with a synthetic UTF-8 response, inherited policy, null request/controller/reserved
environment, and the original target snapshot's iframe policy. The loader now
creates its reader when no prepared reader was supplied; script-free replacements
load and activate through the existing history machinery. Script encounters still
throw at the explicit §4.12.1 preparation dependency after scripts-may-run permission.
The existing supplied callback remains available for controlled integration.
Document creation preserves final
synthetic params' null reservation and inherited policy; an Origin-Agent-Cluster
request with no reservation uses the shared incoming-Window security calculation.
The [OAC audit](../browsing/navigation/ROADMAP.md#oac-without-a-reservation) records
the specification gap and retained HTML secure-context gate. Full multipart
loading, including its later supplied-response parts, remains unfinished.
The provisional local route still needs late response preparation. Do not replace
inherited synthetic params with ordinary response-derived policy.

Navigation Fetch receives 103 responses through
`BrowletEnvironmentBase.processEarlyHintHeaders(response)`. The environment forwards
to `links/early-hints.ts`, which creates the early policy container, extracts Link
relations, prepares options using the reserved environment, dispatches each relation,
and returns the specified Document callback.
Fetch snapshots the producing request's URL history for the correct base and origin.
Only the first response is processed, including an empty/irrelevant response;
same-origin redirects retain its callback and cross-origin redirects discard it.
Actual preload, preconnect, and modulepreload header operations still throw at
their named owners in `links/`. See [Link preparation](#link-header-preparation).

History population now calls `Navigable.loadDocument(params, sourceSnapshotParams,
initiatorOrigin, resource)` for an admitted ordinary response and saves its nullable
result, origin, and history-required policy. MIME/handler dispatch reuses
ResourceReader's computed type and retained bytes, selects the §7.5 loader or
external handler, and preserves synthetic reservations/policy. HTML is connected;
the other loaders and external handoff retain their explicit dependencies.
Null initiators from openerless initial
about:blank history or the provisional local loader, and synthetic
history-referrer persistence remain separate specification gaps; see the
[population handoff audit](../browsing/navigation/ROADMAP.md#document-loading-handoff-and-retained-history-state).

`SPEC_CLASH(javascript-about-blank-body)` is resolved in favor of browsers:
HTML's blanket about:blank loader branch skips response parsing, while all three
browsers parse a javascript: replacement body at that URL. A null request with
a supplied body takes the parser path, including an empty string result. The
[navigation audit](../browsing/navigation/ROADMAP.md#string-result-response-and-replacement-history)
records the probe, approved UTF-8/referrer choices, and remaining history finalization.

For stylesheet integration, follow the
[style-loading reading order](../style/ROADMAP.md#loading-algorithm-reading-order)
and the [CSS resource consumers](../../stylelet/ROADMAP.md#resource-consumers).
Fetch owns redirects, caching, CORS, body delivery, controllers, and fetch groups;
the owner supplies live URL, encoding, MIME, CSP, referrer-policy, and integrity
inputs at the steps that require them. Delivery returns through the specified
networking/element/document task rather than an arbitrary Promise continuation.

Document creation retains a valid response `Last-Modified` date for
`document.lastModified`. The source-only route supplies no such metadata, so
the getter uses the current time. A future local-file loader must populate
`Document.lastModificationTime` from filesystem metadata; this getter does not
read files itself. See the [resource metadata slice](../html/ROADMAP.md#section-314-resource-metadata).

Response integration retains the first nonempty `Content-Language` list member
for node language fallback, whether supplied in one field or separate fields;
no supplied language means unknown. This follows Chromium/WebKit rather than
HTML's unknown result for multiple languages or Firefox's multiple matches, as
recorded by SPEC_CLASH(language-protocol-fallback). The source-only route has
no protocol language. A later successful meta pragma will override that default
through `Document.pragmaLanguage`; its producer remains §4.2.5 work.
See the [language slice](../html/ROADMAP.md#section-3262-lang-and-xmllang).

Document retains the §3.1.7 `currentScript` state and projects either script
interface. The §4.12 execution algorithms must set it for classic scripts in a
document tree, clear it for modules/shadow-tree execution, and restore the old
value after execution, including exceptions/nesting. The provisional parser
script callback does not maintain this state yet.

| Source / planned source | Contract | Specification |
| --- | --- | --- |
| `Navigable.loadHTMLDocument()` in `browsing/navigation/` | Document creation and streamed HTML load coordination using this directory's ResourceReader; encoding-restart byte retention remains pending | HTML §§7.4–7.5 and 13.2.3 |
| Navigable document handlers | Select and populate HTML, XML, text, multipart, media, and content-handler Documents from response MIME/type state | HTML §§7.5.2–7.5.7 |
| `UserAgent.createPotentialCORSRequest()` | Implemented potential-CORS request construction using FetchRequest and its browser owner; element consumers remain pending | HTML §2.5.1 |
| `resource-loader.ts` | Fetch-backed subresource requests, credentials, referrer and policy inputs | Fetch plus each HTML element's fetch algorithm |
| `resource-reader.ts` | Retain response metadata, sniff a bounded prefix, and replay it before subsequent body bytes | HTML §2.5.2, MIME Sniffing, and Streams |
| `element-fetch-options.ts` | Apply shared attribute rules from `dom/nodes/html/attributes/` to element requests, together with integrity, nonce, lazy-loading, blocking, and fetch-priority inputs | HTML §§2.5.4–2.5.9; SRI §§3.4–3.5 |
| `linked-resource.ts` | `<link>` processing and external style sheets | HTML §§4.2.4 and 4.6.8.23; CSSOM |
| [`../scripting/script-fetching.ts`](../scripting/script-fetching.ts), `BrowletEnvironment` forwarders | Classic/worker/single-module fetching and document/worker/worklet graph orchestration reach explicit creation and module-record dependencies; worklet responses are shared across target globals. Worker-imported fetching needs synchronous pause, and owner callers remain pending | HTML §8.1.4.2; HTML §§4.12.1, 10.2.4, 10.3.1, and 11.3.2 |
| `preload.ts` | preload/modulepreload resource hints, parser-discovered preloads, and Link-header integrity metadata | HTML §4.2.4; Fetch; SRI §3.6 |
| `response-policy.ts` | Convert response headers into CSP, COOP, COEP, OAC, referrer, permissions, Integrity Policy, policy-container, and `X-Frame-Options` state | HTML §§7.1 and 7.7; Fetch; SRI §3.8.1 |
| `refresh.ts` | Parse `Refresh` response/`meta` input and schedule the corresponding navigation | HTML §7.8 and §4.2.5 |
| [`speculation.ts`](speculation.ts), [`../scripting/speculation-rules.ts`](../scripting/speculation-rules.ts) | Header-selected rule-set fetching, validation, and registration are implemented; rule-set parsing, candidate selection, navigational prefetch, and `Sec-Speculation-Tags` remain explicit dependencies | HTML §7.6 |

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
implemented [render-blocking mechanism](../html/ROADMAP.md#section-316-render-blocking),
propagate the actual blocked state to Fetch, and release blockers at the specified
completion/failure points. Disconnection and loss of blocking eligibility now
release blockers through the shared Element paths. The script-blocking stylesheet set is
separate. Script's implicit predicate reads prepared `scriptType`; preparation
must supply that state rather than using the raw `type` attribute as a shortcut.
See the [§2.5.8 audit](../html/ROADMAP.md#section-258-blocking-attributes).

Keep three completion gates distinct when connecting stylesheet owners:

- [Script-blocking stylesheets](https://html.spec.whatwg.org/multipage/semantics.html#interactions-of-styling-and-scripting)
  constrain script execution, including parser progress.
- [Render blocking](https://html.spec.whatwg.org/multipage/dom.html#render-blocking-mechanism)
  constrains rendering and supplies the request's render-blocking state.
- [Style-owner completion](https://html.spec.whatwg.org/multipage/semantics.html#update-a-style-block)
  includes critical subresources and delays the document load event. Releasing
  that delay does not itself dispatch the document's `load` event: follow
  [the parser's end steps](https://html.spec.whatwg.org/multipage/parsing.html#the-end)
  and the remaining [parser lifecycle work](../html/parser/ROADMAP.md).

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

HTML §2.4.3's `Document.respondToBaseURLChanges()` reparses prepared speculation
results against the current document base and replaces registration through the
script's relevant Window. §8.1.4.9 now supplies parse-result creation/error capture,
Window registration/removal/replacement, and queued errors on replacement.
Document owns the registered rule-set list. The result and empty-only rule-set
record live in `scripting/speculation-rules.ts`, with an explicitly throwing
static parser. Expand that record/parser for §7.6; Loader can consume it without
making the lower Scripting component depend on Loader.

`Document.considerSpeculativeLoads()` (§7.6) remains a marked no-op. Completing it
requires coalesced microtasks, rule matching, candidate selection, prefetch/prerender
state, and navigation lifecycles; it is a substantial subsystem, not a direct
`fetch()` call. §4.12.1 script preparation, execution, and removal also need to
call the parse-result lifecycle algorithms. The bounded
[§8.1.4.9 tests](../../../test/browlet/scripting/speculation-rules-parse-results.test.ts)
supply parser results and establish no actual speculative loading.

UserAgent composes the [Node transport](../integration/host/network/node-transport.ts)
and [native decoders](../integration/host/network/node-decoder.ts) from `integration/host/network/`.
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
parsing through ResourceReader and HTMLDocumentParser. Ordinary navigation supplies
the reader already used for MIME determination and handler selection; direct
supplied-response loading creates one. The parser reuses an existing MIME result
and retained prefix. Only the ordinary empty about:blank path consumes no bytes.
`HTMLDocumentParser.parseBytes()` implements BOM/transport decoding with a UTF-8
fallback; `abort()` cancels input and pending continuations. Encoding sniffing,
byte retention for restart, and parser lifecycle remain in the
[parser integration](../html/parser/ROADMAP.md).

`Document.waitForScriptsMayRun()` now waits for Document history initialization
to permit scripts. The provisional local loader releases the same gate at its
existing synchronous commit point. The streamed parser checks that it has not
stopped when the wait resolves, so a late permit cannot run an aborted script.
Full history application still reaches persisted-state restoration before granting
permission. Fragment-scroll scheduling now returns without waiting; its later
navigation task reaches explicit user-interest, target-selection, and scrolling
dependencies. See the
[new-Document audit](../browsing/navigation/ROADMAP.md#html-7462-new-document-history-initialization).
`processLinkHeaders()` forwards both loading phases to the Link processor, which
selects the phase and prepares Document-owned options. Nonempty media matching,
responsive-image source sets, and resource effects remain explicit dependencies.
CSSOM stylesheet Link relations have a separate
[Document method](../dom/nodes/document.ts), `processStyleSheetLinkHeaders()`: they fetch once, retain
header order, and feed the parsed document's cascade. Script/load blockers remain
with the [resource-lifecycle review](../style/ROADMAP.md#external-stylesheet-loading),
including FetchGroup.cancel's unfinished document-abort behavior. Navigation timing retains live Fetch/body/Document
records and publishes public Performance entries. The reviewed optional
ScriptHandler remains provisional until script preparation has an owner.

The real network regressions use Windows-1252 with a supplied type and UTF-8
with no supplied type. They determine the MIME type before passing the same
ResourceReader to the HTML handler, then check parsing, CSP, and live byte counts.
Both decoding cases also cover comma-separated and repeated Content-Language
fields: parsed elements inherit the first language, and an explicit lang attribute
overrides it. Stylesheet cases cover repeated and combined Link fields through
Fetch, document creation, sheet association, and computed style on parsed elements.
They supply navigation inputs, select Fetch's parallel callback queue and sandbox
body owner, and commit before parser input tasks run. They do not implement
HTML §7.4's whole state machine or Speculation-Rules processing. Refresh has since
been connected through the shared Document scheduler and meta insertion hooks.
General MIME dispatch is now connected separately by navigation's §7.4.5 coordinator.

The first element consumers should be `<link>`, `<script>`, `<img>`, and
`<iframe>`, in that order of increasing lifecycle reach. That sequence proves
render blocking, parser execution, an ordinary subresource, and a child
navigation without making media playback or the full element catalog loader
prerequisites. Inline `<style>` supplies its root text without a Fetch, but its
imports still require fetching and [owner integration](../style/ROADMAP.md#external-stylesheet-loading).

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
lifetime state under `workers/` and `worklets/`. Shared script fetching lives in
`scripting/`; creation compiles classic scripts, but retained execution and
engine module loading/linking remain explicit dependencies.
Those algorithms supply scripts to the eventual callers; they do not own their
globals, ports, exposure, or termination. See the
[fetch algorithm audit](../scripting/ROADMAP.md#html-8142-fetching-scripts).

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

UserAgent's support predicate still returns false provisionally; installed
decoder/viewer capabilities must determine the support Browlet claims. History
population now determines MIME after response admission, then queues
`Navigable.loadDocument()` dispatch with the same ResourceReader. Its `mimeType`
getter requires completed determination. Loader and external-handoff inputs retain
that reader, including the sniffed prefix and any pending read. HTML's production
script setup and the XML/inline handlers remain unfinished. The HTML, text,
multipart, and media orchestration passes are recorded below, including their
parser, lifecycle, and element-loading dependencies.
Configured type choices and unsupported-resource host policy belong to UserAgent.
Context-specific sniffers remain in MIME for their eventual element consumers. Reading a header
does not implement HTML encoding restart or retain the entire response for replay.

The [MIME integration notes](../../mime/ROADMAP.md) remain until the support
policy and handler selection are settled. Fetch's MIME/nosniff blocking checks
continue to serve their separate requirements.

## Link header preparation

HTML §§4.2.4.4–4.2.4.5 now use `FetchHeaders.extractLinks()` and `LinkProcessingOptions`.
This is a dependency slice for §7.5.1 steps 18–19, not a general Section 4
implementation pass. Resource loading and image selection retain their named
unfinished owners.

`FetchHeaders.extractRawLinks()` collects complete Link fields through HTTP's
parser. It returns the existing unresolved `HTTPLink` values without interpreting
relations or anchors. The CSSOM stylesheet-header path uses this view to retain
the relationship between `alternate` and `stylesheet`. `FetchHeaders.extractLinks()`
uses that raw view, filters anchors, and expands relations for HTML preparation
without resolving a target against the wrong Document. These distinct methods
keep their result types explicit without a mode flag or another loader helper.
Options retain the response base/origin, reserved environment, early policy container,
destination, CORS, integrity,
nonce, type, referrer policy, priority, and Document-completion callback.
`links/early-hints.ts` owns the loop and returns the specified commit steps;
`BrowletEnvironmentBase.processEarlyHintHeaders()` only forwards with its owner.
Empty, irrelevant, and invalid-only hints still occupy the first-response slot.
The callback either sets the receiving Document or
invokes the resource's then-current `onDocumentReady` operation.

The layer sits below nodes/environments because both are consumers of Link
preparation; their references in options and the Early Hints function are type-only.
Syntax remains in HTTP, both extraction views belong to FetchHeaders, and attribute
keyword interpretation reuses `dom/nodes/html/attributes/`. CSSOM's stylesheet
interpretation remains with its existing consumer.

The representation review is accepted: extracted HTML links retain unresolved
`{ href, rel, attributes }` fields until the consuming loader has the correct base.
Options retain the specified `sourceSet` slot with its null default. Its type is
currently null-only, with an explicit TODO for the future image-source owner;
source-set construction and selection remain unfinished. Early Hints does not
populate that slot. The standalone Early Hints function preserves the spec's
response/environment inputs and returned callback. No Binding or Platform object
is involved, and neither representation retains a pending `SPEC_MISMATCH` flag.

Sources: [HTML Link processing](https://html.spec.whatwg.org/multipage/semantics.html#processing-link-headers),
[Early Hints](https://html.spec.whatwg.org/multipage/semantics.html#early-hints),
[RFC 8288 parsing](https://www.rfc-editor.org/rfc/rfc8288.html#appendix-B).
The current HTML source was checked on 2026-11-06. The browser-only
`node-compat/experimental/link-header-processing.mjs` uses local HTTPS/HTTP2 and
records actual resource requests. Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2 were tested. WebKit emitted no Early Hints requests in this fixture;
its final-response results are not evidence of Early Hints behavior.

| Retained decision | Evidence and chosen behavior |
| --- | --- |
| `SPEC_CLASH(link-header-comma-splitting)` | HTML uses Fetch's generic comma splitter, which breaks `<a,b.js>`. All three browsers preserve the target. Use the existing RFC-aware parser on complete fields. |
| `SPEC_CLASH(link-header-relations)` | RFC parsing and all three final-response paths expand space-separated relations. Chromium/Firefox Early Hints ignore a multi-relation value. Expand it consistently. |
| `SPEC_CLASH(link-header-duplicate-parameters)` | Retain the existing parser's first parameter value, as Chromium/Firefox do for duplicate `as`; WebKit uses the last. RFC permits application rules for extension parameters; this is not a claim that it mandates first-wins for every extension. |
| `SPEC_CLASH(link-header-as-case)` | HTML's string translation rejects mixed-case destinations; all three final-response paths and Chromium/Firefox Early Hints accept them. Fold ASCII case before translation, without trimming. |
| `SPEC_CLASH(link-header-crossorigin)` | HTML's header algorithm recognizes only explicit keywords. All three final-response paths and Firefox Early Hints use anonymous for empty/unknown values. Chromium accepts empty but rejects unknown Early Hints values. Reuse the shared attribute defaults. |
| `SPEC_CLASH(link-header-invalid-preload)` | HTML exits the whole loop and can omit its callback; browsers skip an invalid preload and process the later valid link. Continue, preserving all retained commit work. |
| `SPEC_CLASH(link-header-modulepreload)` | HTML says no effect; all three browsers fetch modules from final headers and Chromium/Firefox do so from Early Hints. Recognize it and retain an explicit throwing integration boundary. |

All choices above were approved. Anchored links are ignored under RFC 8288's
permitted policy. Prefetch requests appeared in Chromium/Firefox final headers,
but not Early Hints; final-response behavior remains part of its separate phase
audit. Firefox's stylesheet requests agree with the existing CSSOM decision.

Remaining owners are explicit:

- `LinkProcessingOptions.preload()` must perform MIME admission, Link request
  construction, Fetch/SRI, and preload-map insertion/consumption. Construction
  must resolve HTML's reserved environment versus Fetch's full-settings client
  contract; borrowing the departing Document or sandbox as the client is not a
  completed implementation. The existing `UserAgent.supportsMIMEType()` support
  policy remains unfinished.
- `preconnect()` must select a URL, partition and credentials, then ask the
  transport connection owner for a reusable idle connection.
- `modulepreload()` must connect the existing module-graph fetch algorithm to
  the incoming settings/module map, including early results and cancellation.
- `Document.processLinkHeaders()` now forwards both final-response phases to
  `links/response.ts`. Nonempty media matching and image source-set creation
  throw at the point where their inputs are needed. Element Link lifecycle
  processing remains separate; the options class does not replace the stylesheet owner.
- Preload/connection/module methods throw today. Callback bookkeeping can be
  exercised with controlled resource operations, but it does not populate a
  real preload or module map. Speculation-Rules now has its separate header loader
  below; Service Worker integration remains its existing explicit dependency.

Initial validation on 2026-11-06: the four Early Hints preparation regressions first
failed at the old blanket throwing hook. The preparation slice passed 168 tests
in eight suites on Node 24.19.0, Node 26.8.1, and custom Node 27.0.0-pre, each
with stock and matching-addon runtimes. The suites cover Link parsing/options,
Early Hints callbacks, navigation Fetch/redirect ownership, Document creation,
network/cache delivery, and HTTP/2. Typecheck, declaration contracts,
changed-file ESLint, and the import-hierarchy checks also pass. Resource effects
remain controlled only where their named implementations are unfinished.

After the ownership cleanup, nine focused suites pass in all six configurations:
431 passes with the addon, and 428 passes plus three existing expected failures
without it. Those failures cover native Window global identity/prototype behavior
in `document-lifecycle.test.ts`, not Link processing. The expanded selection adds
Fetch header contracts, CSSOM stylesheet loading, and Document loader/lifecycle
integration. Typecheck, changed-file ESLint, import boundaries, and diff whitespace
checks pass. The two new extraction cases verify that Fetch preserves anchors,
unexpanded relations, raw targets, and later fields after a malformed suffix.

Consolidating both extraction views into FetchHeaders preserves those results on
Node 26.8.1 stock and matching-addon runtimes: 428 passes plus the same three expected
failures on stock, and 431 passes with the addon. The expanded extraction tests now
live beside the raw tests in `test/fetch/headers.test.ts`. Typecheck, changed-file
ESLint, import boundaries, and diff whitespace checks pass again.

## Final-response Link phases

HTML §7.5.1 step 19 now reaches the shared §4.2.4.4 processor. The Document method
forwards its receiver, response, and phase; loader owns the loop. Attribute
presence selects the phase: `media`, `srcset`, or `imagesrcset`, including empty
values, require the media phase. `imagesizes` alone does not. Options use the
receiving Document's current base URL, origin, policy container, and environment,
with its Document already attached. Invalid preloads continue to later links
under the previously approved `link-header-invalid-preload` decision.

HTML's empty/ASCII-whitespace media rule is implemented without device inputs.
Other media strings reach an explicit throwing dependency: Stylelet still needs
active matching and the Document's actual device/viewport facts. A matching link
with both `imagesrcset` and `imagesizes` reaches a separate source-set construction
dependency after option validation. Neither dependency supplies a fabricated
match, source set, or successful load.

The existing §7.5.2 byte-loader callback now performs actual preparation after its
first input has been parsed. A regression confirms that this phase sees the
`base` element from that input, while the earlier pre-media phase uses the
Document's original base. No parser or scheduler ordering changed. Another
integration regression now controls only the unfinished preload operation and
confirms Early Hints commitment precedes final-header preparation on the new
Document. CSSOM stylesheet Link loading remains its separate once-only consumer.

This slice leaves preload, preconnect, modulepreload, responsive images, and
element Link lifecycle at their recorded Section 4 owners. Final-response
prefetch's browser-behavior audit remains deferred as described above; the
existing HTML relation dispatch is unchanged. §7.5.1 step 20's Speculation-Rules
header is covered by the subsequent complete header-processing slice below.

Sources: [processing Link headers](https://html.spec.whatwg.org/multipage/semantics.html#process-link-headers),
[HTML media matching](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#mq),
[HTML document loading](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html).
The clean local HTML reference was refreshed on 2026-11-06 at `5955a33`.
This adds no new browser-policy choice; the earlier Link decisions still apply.

Validation: all 13 new preparation cases first failed at the old no-op hook and
now pass. A new byte-loader regression covers the parsed base URL; the existing
Early Hints ordering regression now runs real final-header preparation. Nine
focused suites pass across Node 24.19.0, 26.8.1, and custom 27.0.0-pre, each with
stock and matching-addon runtimes: 445 passes with the addon, 442 passes plus
the same three existing Window identity/prototype expected failures without it.
Typecheck/generated declarations, declaration contracts, changed-file ESLint,
import boundaries, and diff whitespace checks pass. No native code changed.

## Speculation-Rules header loading

HTML §7.5.1 now calls the complete §7.6.3 header-processing algorithm for top-level
Documents. `speculation.ts` selects strings from the structured list, resolves
URLs before parallel work, queues each request on the speculation-rules task
source, and uses real Fetch with the incoming Document as client. It ignores
failed/null bodies, non-ok status, and incorrect MIME essence. Successful bodies
are decoded as UTF-8, handed to the existing parser with the final response URL,
and appended to the Document's list before reconsidering speculative loads.
Author parse exceptions are ignored; an InternalError from an unfinished owner
escapes instead of masquerading as invalid author input.

Approved decisions (2026-11-06):

- `SPEC_GAP(speculation-header-client)`: HTML omits Fetch's client assignment.
  Use the incoming Document's environment for its origin, referrer, fetch group,
  policy container, and networking tasks. Both implementing browser sources use
  the Document's loader/context; live requests carry that Document's Origin.
- `SPEC_GAP(speculation-fetch-destination)`: HTML references `speculationrules`
  although Fetch has not defined it. Add the internal destination as a subresource,
  without making it script-like (which would reject its JSON MIME under nosniff).
  [Fetch PR #1952](https://github.com/whatwg/fetch/pull/1952) remains open. Its
  public enum and proposed CSP directive are not adopted wholesale here.
- `SPEC_CLASH(speculation-header-csp)`: follow HTML's explicit header exemption
  and Chromium. WebKit blocks under script CSP, while CSP's current destination
  fallback would select connect-src. [The original discussion](https://github.com/WICG/nav-speculation/issues/327)
  and [Chromium's correction](https://issues.chromium.org/issues/371595744)
  distinguish trusted response headers from injected script elements.
  [CSP PR #808](https://github.com/w3c/webappsec-csp/pull/808) proposes a new
  speculation-rules-src directive; revisit this rule if that integration lands.
- `SPEC_CLASH(speculation-header-credentials)`: follow HTML/Chromium's same-origin
  credentials. WebKit's live foreign request sends the foreign site's cookie.
  CORS still governs whether any foreign response can supply rules.
- `SPEC_CLASH(speculation-header-empty-url)`: follow HTML's normal URL parsing,
  including resolving an empty string against the Document base. Chromium/WebKit
  skip empty strings. Non-string items and inner lists are ignored in all three
  implementations that supply an algorithm (HTML, Blink, and WebKit).
- `SPEC_CLASH(speculation-header-redirect-base)`: follow HTML and Blink's final
  response URL for rule parsing. WebKit's source retains the requested URL;
  this distinction is source evidence, not a live rule-target observation.

Browser-only probe: `node-compat/experimental/speculation-rules-header.mjs`,
Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2. Firefox made no rule requests,
including the positive control, so it supplies no behavior oracle here. Blink
sources: `core/speculation_rules/speculation_rules_header.cc`,
`core/loader/speculation_rule_loader.cc`, and
`core/frame/csp/content_security_policy.cc`; WebKit sources:
`dom/Document.cpp` and `dom/LoadableSpeculationRules.cpp`.
Specification: [header algorithm](https://html.spec.whatwg.org/multipage/speculative-loading.html#process-the-speculation-rules-header)
and [security considerations](https://html.spec.whatwg.org/multipage/speculative-loading.html#speculative-loading-injected-content).

The rule parser still throws at `SpeculationRuleSet.parse()`. The data model,
candidate matching, coalesced reconsideration, and actual prefetch/prerender
lifecycles remain §7.6 work; `considerSpeculativeLoads()` is still a marked no-op.
This slice fetches rule-set resources, not their proposed navigation targets.
Shared cancellation also remains explicit: `Document.abort()` reaches the
no-op `FetchGroup.cancel()`. The new real-Fetch regression failed waiting for
body-failure delivery, and Eric approved retaining that strict assertion as an
expected failure until §7.5.11/Fetch cancellation is implemented. Destruction
already removes queued rule-request tasks; inactive Documents' tasks wait for
activation through the existing event loop.

The §7.5.1 pass is now through its return: step 21 already invokes the deferred
Fetch quota owner, and its existing dedicated tests remain part of validation.
This completes the algorithm audit, not all of its referenced subsystems.
The following §7.5.2 audit covers the connected loader/parser handoffs.

Validation: 23 header-loader cases cover selection, URL snapshots, MIME/status,
body failure, UTF-8, redirects, parse errors, real CORS/cookies/CSP, incoming
Document activation, child exclusion, and teardown. The cancellation case is the
one approved expected failure. Seven focused suites (including request
classification, CSP, inline-rule lifecycle, Document loading/creation, and quota)
pass on Node 24.19.0, 26.8.1, and custom 27.0.0-pre with stock/matching addons:
212 passes plus one expected failure with addons; 209 passes plus that failure
and the same three existing Window identity/prototype expected failures on stock.
Typecheck/generated declarations, declaration contracts, changed-file ESLint,
import boundaries, and diff whitespace checks pass. No native code changed.

## HTML document loading

The §7.5.2 flow now handles ordinary and directly supplied responses without a
mandatory script callback. It creates the Document synchronously, reuses the
MIME dispatch reader or creates one for a supplied response, and associates an
HTML parser. Input, first-input media Link processing, EOF, and completion retain
their Document-owned networking tasks. Encoding still uses the real Content-Type
metadata plus BOM, never the sniffed MIME type's charset. The existing
`allowDeclarativeShadowRoots` flag is retained, but templates/shadow attachment
still reach the parser adapter's explicit missing implementation.

The parser selects `noscript` handling from the Document's scripting policy and
does not invoke script handlers when that policy disables scripting. Enabled
scripts wait for the existing history-initialization gate. Without a supplied
handler, their §4.12.1/§13.2 preparation boundary throws; it does not silently use
the source-route evaluator. Internal implementation failures are rethrown on the
Document's task after abortion; ordinary body failures abort without a load event.

Empty ordinary about:blank Documents get html/head/body synchronously and queue
the existing completion handoff after activation. There is no parser EOF on that
branch. This uses the provisional `Document.finishLoading()` lifecycle and does
not complete §13.2's stop-parsing/deferred-script/load-delay work.

Browser probe `node-compat/experimental/html-document-loading.mjs` verifies
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. Eric approved both choices:

- `SPEC_CLASH(javascript-about-blank-body)`: parse supplied HTML at about:blank,
  matching all three engines rather than HTML's unconditional empty branch.
  Existing null-request provenance distinguishes supplied bodies from ordinary
  Fetch (whose about:blank response also has a body). An empty supplied string
  still takes the parser path; a nonempty standards-mode result keeps its doctype.
- `SPEC_CLASH(loaded-about-blank-quirks)`: all three engines put an ordinary
  non-initial empty about:blank in quirks mode; HTML's population branch omits
  that assignment. Browlet now sets it, as its initial Document already does.

Sources: [HTML loading](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html),
[Blink DocumentLoader](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/loader/document_loader.cc)
(`loading_url_as_empty_document_` excludes static data), and
[WebKit DocumentWriter](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/DocumentWriter.cpp)
(`replaceDocumentWithResultOfExecutingJavascriptURL` feeds the supplied source).

Remaining dependencies: §4.12.1 script preparation/type/fetch/execution; §13.2
encoding prescan, confidence and restart; template/foster-parenting tree adapter
hooks and declarative shadow-root attachment; full stop-parsing and abort
coordination; iframe completion; and Document-wide FetchGroup cancellation.
These owners remain explicit. The subsequent XML and text boundaries are recorded below.

Validation: seven focused suites pass on Node 24.19.0, 26.8.1, and custom
27.0.0-pre with stock and matching addons. Each addon run has 153 passing cases
and the existing script data-block expected failure; stock has 150 passing cases
and that failure plus the same three Window expected failures. New coverage
observed the blanket-loader and disabled-noscript failures before the fix.
Typecheck/generated declarations, declaration contracts, changed-file ESLint,
import boundaries, and diff whitespace checks pass. No native code changed.

## XML loading: deferred parser dependency

HTML §7.5.3 remains an explicit throwing `Navigable.loadXMLDocument()` boundary.
Eric deferred XML parsing until the planned XML/Namespaces specification work;
this pass adds neither saxes nor another XML parser dependency. The future loader
must create the XML Document, apply RFC 7303 encoding, build namespace-aware DOM,
process media Link headers after first input, respect the scripts-may-run gate,
clear the during-loading navigation ID at EOF, and connect completion, abortion,
and XML error reporting. These are required integration work, not a claim that
creating an empty XML Document implements the loader.

## Text document loading

The HTML §7.5.4 orchestration now creates an HTML Document with the computed MIME
essence and a locked no-quirks mode. The existing HTML parser receives synthetic
pre/newline tokens before switching to PLAINTEXT. Synthetic tokens preserve
response source locations; the consumed newline preserves any real leading LF.
Markup, doctypes, character references, and script-looking text stay literal.
HTML input preprocessing still normalizes CR/CRLF and replaces null characters.

The same prepared ResourceReader retains sniffed bytes. Decoding, media Link
processing after first input, EOF, and the existing `Document.finishLoading()`
handoff use the incoming Document's networking tasks. Abortion cancels this reader
and suppresses completion; body failures also abort. This loader supplies no
optional user-agent head content or scripts, so no script can arise from its
plaintext input. RFC 3676 Format=Flowed styling is optional and is not implemented.

The first streaming regressions found that parse5 batches the final character
run across writes, leaving partial text invisible until another token or EOF.
`TextDocumentTokenizer` overrides its protected hibernation hook solely to flush
that run before waiting for input. It retains parse5's tokenizer/preprocessor and
does not supply a replacement parser. Recheck that hook when upgrading parse5.
The delay also reproduces in unmodified ParserStream without Browlet. Upstream
[issue #130](https://github.com/inikulin/parse5/issues/130) discusses flushing at
hibernation and the performance tradeoff; its closing change reclaimed consumed
input rather than promising a DOM flush after every write. The SAX EOF fix in
[issue #271](https://github.com/inikulin/parse5/issues/271) is separate. This adapter
addresses live text-document visibility; broader HTML streaming behavior remains
part of the parser audit, and the flush overhead has not been benchmarked.
The strict tests now cover input split at every byte, BOM/transport selection,
newline/null handling, source positions, partial visibility, cancellation, load
events, and a real Fetch response with Navigation Timing completion.

`SPEC_CLASH(empty-text-document-pre)`: HTML and Firefox create an empty pre even
for an empty response. Chromium/WebKit defer creation until data arrives and
omit it when the response stays empty. Eric approved HTML/Firefox's immediate
structure. The browser-only probe `node-compat/experimental/text-document-loading.mjs`
checked Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. All agree on literal
text, leading LF, null replacement, transport charset, BOM precedence, and text
visibility before EOF. No optional browser viewer styling is copied.

Sources: [HTML text loading](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-text),
[Blink TextDocumentParser](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/html/parser/text_document_parser.cc),
and [WebKit TextDocumentParser](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/parser/TextDocumentParser.cpp).
Both browser parsers synthesize tokens and disable the pre newline skip; their
lazy creation accounts for the empty-input difference.

Remaining dependencies: full byte-encoding selection is still provisional
(BOM, transport label, otherwise UTF-8), as in the HTML adapter. The probe's
unlabeled empty text response reports windows-1252 in all three browsers; this
slice does not establish that as a universal fallback. §7.5.4's final paragraph
also delegates decoding/presentation to each computed MIME type's specification:
text/plain defaults, CSS encoding rules, JavaScript source decoding, JSON's UTF-8
requirements, and WebVTT decoding still need their explicit policy integration.
The loader TODO retains that dependency rather than treating generic HTML
fallback as the finished answer. Full stop-parsing/load-delay/deferred-script
coordination, iframe completion, and Document-wide FetchGroup cancellation also
remain with their existing owners. XML parsing stays deferred as above.
The next document-order section is §7.5.5, multipart/x-mixed-replace.

Validation: eight focused loader/parser/navigation suites pass across Node
24.19.0, 26.8.1, and custom 27.0.0-pre with stock and matching addons. Each addon
run has 178 passing cases; stock has 175 passing cases and the same three existing
Window expected failures. The new text suite has 19 passing cases. Typecheck and
generated declarations, declaration contracts, changed-file ESLint, import
boundaries, and diff whitespace checks pass. No native code or dependencies changed.

## Multipart loading: framing foundation

HTML §7.5.5 now has its realm-neutral RFC 2046 framing prerequisite in
[`MultipartParser`](../../mime/multipart.ts). It accepts incremental bytes,
emits headers and available body data without waiting for a whole part, and
reports part EOF at the following boundary while the outer response can remain
open. This is MIME framing, separate from the deferred HTML/XML parser work.
The existing complete-body FormData parser is not a suitable streaming loader
and retains its own compatibility choices.

The framer now accepts `appendData()` through Infra's byte cursor, preserving
bulk scanning and original-buffer body views. Cursor storage can retain unread
chunks, but the framer still drains synchronously: the Document consumer below
supplies asynchronous part admission and body-demand backpressure without adding
a second framing state machine.

The first EOF regression observed `complete === false` after the following
boundary had arrived. It now observes completion before delimiter suffixes,
the next part's headers, or transport EOF. Other tests cover every two-chunk
split, one-byte chunks, folded/duplicate fields, binary bodies, exact delimiter
CRLF ownership, zero-copy body runs, invalid/incomplete framing, and cancellation
from each callback. The parser reports malformed framing without choosing how
a browser presents partially received Documents.

The framing checkpoint did not yet have a production consumer. That handoff is
now implemented as described below; the parser/cursor redesign remains a
separate review after the Document lifecycle work, and no HTML/XML string-cursor
design has been adopted.

Sources: [HTML §7.5.5](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-multipart-x-mixed-replace)
and [RFC 2046 §5.1.1](https://www.rfc-editor.org/rfc/rfc2046.html#section-5.1.1).

Validation: six MIME/FormData suites pass on Node 26.8.1 with the matching addon
(299 cases, including 33 new framing cases). Typecheck/generated declarations,
declaration contracts, changed-file ESLint, import boundaries, and diff whitespace
checks pass. This slice changes no realm, scheduling, native, or fallback behavior.

## Multipart loading: Document consumer

HTML §7.5.5 now connects `ResourceReader` → `MultipartParser` → individual
Fetch response bodies → the existing Document loaders. `MultipartResourceReader`
lives here because it owns the Fetch/Streams handoff; RFC 2046 byte framing
remains in MIME. The first part is admitted when its headers and computed type
are available. Each boundary closes that part's stream while the outer transport
can remain open. Body demand drives further transport reads; one already-read
transport chunk can contain several queued parts. Body runs remain views of
that chunk rather than copies or whole-part accumulation.

`loadDocument()` and `loadMultipartDocument()` now return internal promises
of Document-or-null. Eric accepted this shape on 2026-11-06. The UserAgent's
HostPromise is an InternalPromise whose completion outlives individual Documents;
the HTML/text constructors remain synchronous. Population resumes on the target
loop, retains the still-active task Document across initial Window reuse, and
rechecks navigation ownership before saving the result. The first Document's
history-initialization gate precedes later-part navigation. Later parts use
`navigate(..., { response: part, historyHandling: 'replace' }, sourceEnv)`.

Eric approved these corrections on 2026-11-06:

- `SPEC_CLASH(multipart-replacement-inputs)`: HTML's additional-part loop
  passes the outer response and first Document again. Use the current part and
  active Document, preserving replacement routing instead of recursively
  loading the outer multipart entity.
- `SPEC_GAP(multipart-null-request)`: supplied-response parameters can have
  no request. Use their final response URL in that case.
- `SPEC_CLASH(multipart-default-content-type)`: retain RFC 2046's text/plain
  default. WebKit sniffed the probe's untyped HTML-shaped part as HTML.

The browser-only probe is
[`multipart-document-loading.mjs`](../../../node-compat/experimental/multipart-document-loading.mjs).
Chromium 156.0.8078.4 and Firefox 157.0 produced no rendered-part observations;
that probe does not establish their replacement behavior. WebKit 27.2 replaced
first with second, used each part's Content-Type, and enforced both outer and
part CSP in the separate policy cases. Source checks agree that WebKit's
DocumentLoader receives new response metadata on each replacement, while
Gecko's nsMultiMixedConv constructs part channels and combines CSP. See
[WebKit DocumentLoader](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/DocumentLoader.cpp)
and [Gecko nsMultiMixedConv](https://searchfox.org/mozilla-central/source/netwerk/streamconv/converters/nsMultiMixedConv.cpp).

This is a real first-part loader and later-navigation handoff, not completed
multipart lifecycle support. Explicit dependencies remain:

- Ordinary navigation's recursive abortion/unloading are still required for fully
  automatic later replacements. Window transient-activation queries now work;
  input/automation notification remains with HTML §6.4.2.
- Window.stop()/Document-wide abortion and destruction must cancel the outer
  reader even after the current part has closed. Active-body cancellation and
  navigation supersession are connected now.
- Local-URL part CSP composition, non-identity Content-Transfer-Encoding, and
  nested multipart coordination throw explicitly. HTTP multipart CSP admission
  is covered by the following slice; inherited local policies are not overwritten.
- MIME/header recovery and malformed/truncated-response presentation remain
  unaudited; malformed framing is surfaced, not silently accepted.
- Full per-part timing/transport attribution, XML/media/inline content handlers,
  parser scripts, and the broader load/unload lifecycle retain their owners.

Regression coverage includes real HTTP/Fetch/history admission, streaming HTML
and literal default text, load at a boundary before outer EOF, replacement
arguments, multiple parts in one chunk, body-demand backpressure, failure,
supersession, cancellation, and copied navigation inputs. The boundary test
first failed because pending header discovery did not resume after body EOF;
the consumer now wakes that read. A transport-failure regression also caught
duplicate host-error reporting during cancellation cleanup.
The replacement ownership regression initially kept the stream open when an
author navigation superseded the next part during `navigate()`. The consumer
now adopts only the first replacement ID, then treats further changes as
supersession.

The active-body cancellation regression initially failed on addon runtimes: the
source canceled, but the completion promise stalled until an explicit checkpoint.
The same failure reproduced with two linked `ResourceReader`s and no multipart
parser. Native settlement notification followed the Promise's creation context,
which need not own its observer's queue. Eric initially deferred the runtime fix,
preserving the strict production expectation and the standalone
[`multipart-cancel-promise.mts`](../../../node-compat/experimental/multipart-cancel-promise.mts)
probe. The approved addon follow-up now registers weak observer destinations,
notifies them on settlement, and requests a checkpoint after observing an
already-settled source. It preserves coalescing, detachment, and environment
cleanup; the loader needs no manual checkpoint or cancellation workaround.
The custom-hook path additionally needed to admit known `SandboxAgent` Promise
jobs even though the sandbox's environment is not attached to its realm. Its existing event loop owns their
delivery, with no script preparation. That fix belongs to the
[Promise-job hook](../scripting/ROADMAP.md#81664-promise-jobs).

Initial validation (2026-11-06): nine affected loader/navigation/framing/cursor suites,
237 tests, across Node 24.19.0, 26.8.1, and custom 27.0.0-pre. Each stock run
passed all 237. Each matching-addon run passed 236 and failed only the strict
active-body cancellation completion regression above. Typecheck/generated
declarations, declaration contracts, changed-file ESLint, import boundaries,
and diff whitespace checks passed. The runtime failure was not an expected failure
or a skip; the initial loader checkpoint was intentionally not a green addon run.

Runtime follow-up validation (2026-11-06): the strict cancellation regression
now passes in all six Node 24.19.0/26.8.1/custom stock/compat configurations.
The 102-file Promise/realm/scripting/Streams/loader sweep passes with the existing
expected failures and skips; custom/compat finishes with 1229 passes, two expected
failures, and three skips. The final 43-case cancellation/job/checkpoint/handoff
sweep also passes across all six configurations. An earlier parallel run timed
out in an Atomics subprocess; the unchanged case passes with both the old and new
addons in isolation and in the one-worker matrix. All three rebuilt addons pass
their native suites and the 14 focused observation regressions, including Vin's
two coalesced-source cases. The standalone linked-reader probe completes before
its diagnostic checkpoint on every addon base. Type/declaration checks, focused
ESLint, import boundaries, and diff checks pass. No unexpected failures remain
in these runs.

## Multipart loading: CSP admission

The follow-up applies HTTP multipart policies before Document admission. The
reader retains outer-response and earlier-part CSP header fields independently,
including report-only fields. Each part receives a snapshot, so parsing several
parts in one transport chunk cannot add future restrictions to an earlier part.
Empty fields cannot clear earlier restrictions. The first part receives a cloned
policy container with the cumulative CSP list, combined sandbox flags, and an
opaque origin when required, before Window creation. Non-CSP container state is
preserved. A part that adds sandboxing cannot bypass an already prepared COOP
decision; the existing network-error presentation dependency remains explicit.
Later supplied-response navigations now obtain their response policy container,
so the normal population checks see each part's cumulative restrictions.

Eric approved these choices on 2026-11-06:

- `SPEC_CLASH(multipart-csp-lifetime)`: retain cumulative independent policies,
  following WebKit. Gecko's `nsMultiMixedConv` instead combines only the outer
  policy and current part, joining their directive text with a semicolon. That
  differs from independent CSP policies, which must all permit an action.
- `SPEC_CLASH(multipart-part-policy-admission)`: HTML's shallow first-part copy
  retains the original policy container and origin, and its supplied-response
  branch provides no response container. Apply the part's CSP and sandbox first,
  and run frame-ancestors before admission, matching WebKit's live behavior.
  Report-only violations report without blocking. Forbidden embedding reaches
  the existing inline error-page dependency instead of creating the part's Window.

The browser-only probe is
[`multipart-csp.mjs`](../../../node-compat/experimental/multipart-csp.mjs).
WebKit 27.2 retained an earlier part's connect-src restriction and report-only
script policy on the next part, preserved outer sandboxing through an empty
part policy, applied part sandboxing to both Documents' origins, and blocked a
part with frame-ancestors 'none'. Chromium 156.0.8078.4 and Firefox 157.0 produced
no baseline part observations, so this probe does not establish their policy
behavior. Source evidence: WebKit's
[2024 CSP bypass fix](https://github.com/WebKit/WebKit/commit/93603245b1ebc4cd2c451af93d98c86533c0d6fe)
explicitly retains restrictions across replacements; Gecko's
[part-channel processing](https://searchfox.org/mozilla-central/source/netwerk/streamconv/converters/nsMultiMixedConv.cpp)
uses the outer/current combination. Compare
[HTML §7.5.5](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-multipart-x-mixed-replace)
and [CSP's multiple-policy rule](https://w3c.github.io/webappsec-csp/#multiple-policies).

Local-URL responses retain their existing inherited container. Added part CSP
remains a throwing dependency there: composition must preserve inherited self
origins and policy provenance without duplicating earlier restrictions and
reports. This slice does not complete local-URL policy composition, error-page
creation, activation notification, recursive abortion/unloading, or parser redesign.
The subsequent addon follow-up resolves the separately retained cancellation
wake-up failure described above.

The first regression failed at the old part-CSP throwing boundary. A further
regression demonstrated that prepared COOP parameters could admit a newly
sandboxed part; it now reaches the existing network-error dependency. Tests
cover independent restriction intersection, cumulative enforce/report-only
policies, snapshot isolation, sandbox union, origin ownership, both dispositions
of frame-ancestors, and the local-URL boundary.

Validation (2026-11-06): the five affected loader, Document creation, population,
and CSP suites contain 207 tests. Node 24.19.0, 26.8.1, and custom 27.0.0-pre each
pass 207/207 in stock mode. Each matching-addon run passes 206 and fails only the
previously retained active-body cancellation completion test. Typecheck and
generated declarations, declaration contracts, changed-file ESLint, import
boundaries, and diff whitespace checks pass. No addon or engine code changed.

## HTML §7.5.6: media Document construction

`Navigable.loadMediaDocument()` now creates and initializes the HTML Document,
sets no-quirks mode, populates html/head/body, and appends the specified img,
audio, or video element with its Document URL in src. It adds no optional
user-agent script, style, title, or autoplay policy. The existing callable shape
continues to take the parsed MIME type and prepared ResourceReader; sniffed bytes
are handed to the element rather than lost or fetched again.

`HTMLImageElementImpl.loadDocumentResource()` and
`HTMLMediaElementImpl.loadDocumentResource()` are explicit throwing dependencies.
Their eventual implementations must adopt that response, establish load-event
delays, and connect decoding, element state/events, output, and cancellation.
HTML §§4.8.4 and 4.8.11 own that work. The generic application/ogg type does not
identify the appropriate element; it stops before Document construction until
track inspection exists. `UserAgent.supportsMIMEType()` still returns false;
this slice does not claim image or audio/video support.

After the element accepts the response, the loader processes media Link headers
and waits for `scripts may run` before queueing provisional `finishLoading()` on
the Document's networking task source. This prevents completion callbacks before
history activation and lets destruction discard the queued task. The full
stop-parsing algorithm remains unfinished: readiness milestones, deferred scripts,
media load-event delays, separate DOM tasks, and initial pageshow/BiDi delivery
must replace that provisional finish path. Decoder completion is not represented
by the resource-adoption method returning.

Eric approved `SPEC_CLASH(media-document-host-element)`: retain HTML's element
table and direct src attribute. Chromium, Firefox, and WebKit use video even for
audio Documents. Chromium places the URL on a source child; Firefox hands the
retained channel to video without a src attribute; WebKit sets video.src.
The local HTTP probe used redirected PNG, WAV, and Ogg resources. All three
engines produced no-quirks image Documents with the final URL in img.src.
Chromium rendered both audio resources, Firefox rendered Ogg and downloaded WAV,
and WebKit rendered WAV and downloaded Ogg. WebKit omitted head for its WAV
Document; Browlet retains the head required by HTML's population step.

Evidence: [`media-document.mjs`](../../../node-compat/experimental/media-document.mjs)
and [`MEDIA-DOCUMENT.md`](../../../node-compat/experimental/MEDIA-DOCUMENT.md),
Chromium 156.0.8078.4, Firefox 157.0, WebKit 27.2 (2026-11-06).
Source references: [HTML §7.5.6](https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-media),
[Blink MediaDocument](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/html/media/media_document.cc),
[Gecko VideoDocument](https://searchfox.org/mozilla-central/source/dom/html/VideoDocument.cpp),
[WebKit MediaDocument](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/MediaDocument.cpp).

The focused tests use real Document/element construction, bindings, sniffing,
reader state, history activation, and task delivery. They control only the
unfinished element resource-adoption operation and the support predicate; the
uncontrolled paths assert the named dependency. Coverage includes all three host
types, final URLs, reader identity and retained bytes, Link phase ordering,
activation gating, and destruction before completion. The manual-loop tests
advance their own microtask queues; a separate automatic-loop regression requires
completion without an explicit checkpoint on every runtime.

Validation (2026-11-06): all 236 tests in the seven affected media/text/HTML/
multipart, dispatch, creation, and history-population suites pass on Node
24.19.0, 26.8.1, and custom 27.0.0-pre, in stock and matching-addon modes.
There are no expected failures or skips in that sweep. Typecheck/generated
declarations, declaration contracts, changed-file ESLint, import boundaries,
and diff whitespace checks pass. This slice changes no addon or engine code.

## HTML §7.5.7: inline user-agent Document construction

`Navigable.createDocumentForInlineContent()` now constructs the isolated HTML
Document for browser pages and PDF viewers. It supplies a fresh opaque origin,
opener policy and enforcement result, empty policy container/sandbox flags, and
a new synthetic response. Request, Fetch controller, early hints, and reserved
environment remain null. The shared initialization selects its browsing context
and Window; construction does not activate the Document or commit history.

`SPEC_GAP(inline-document-response)`: the
[HTML algorithm](https://html.spec.whatwg.org/multipage/document-lifecycle.html#navigate-ua-inline)
reads an undefined response's URL, then creates a response with no URL. The
approved correction passes the caller's target URL after the specified inputs
and copies it onto that new response. Failed admission supplies the response's
final URL, or the history entry's URL when no response exists. Non-fetch pages
supply their URL; resource viewers supply the final resource URL. The already
accepted optional ResourceReader remains last, separate from the synthetic
response. Its headers, policies and body never become the UI Document's response.
Nullable navigation IDs retain the previously accepted caller contract.

A regression exposed the provisional loader repeating COEP admission even for
this unreserved synthetic response. Document creation now uses the same
reserved-environment gate as history population. The blocked response stays
blocked; its fresh error Document can still be constructed under an isolated
parent. Ordinary supplied-response preparation continues to create a reservation
and enforce COEP.

`UserAgent.renderInlineDocument()` is the explicit throwing presentation owner.
It still needs browser error/handler UI, failure diagnostics, PDF decoding,
resource consumption/cancellation, and exclusion of content scripts from the
viewer DOM. No renderer is fabricated and PDF support remains false. Registered
web handlers navigate their handler URL instead of using this operation.
Ordinary HTML loading already runs headlessly without this hook. Browser-owned
content can also have a nonvisual representation; the unfinished presentation
owner does not imply a display or rasterizer requirement.

If that owner supplies a presentation, completion waits for history activation's
scripts-may-run gate, then uses the existing networking task and provisional
`finishLoading()`. Container notification is connected in the following §7.5.8
slice. Full stop-parsing behavior, iframe fallback timing (including policy and
network failures), readiness and load-delay coordination remain explicit
lifecycle dependencies. Tests control only the unfinished renderer;
uncontrolled calls assert its named failure.

Coverage includes fresh origin/policy identity, URL copying and metadata, null
IDs, the untouched original reader, network-error and rejected-response
population, an opaque child under COEP, activation-gated and automatic completion,
and destruction before delivery.

Validation (2026-11-06): all 338 checks in the nine affected inline/media/multipart,
dispatch, population, Fetch navigation, non-fetch, creation, and COEP suites pass
on Node 24.19.0, 26.8.1, and custom 27.0.0-pre, in stock and matching-addon modes.
There are no expected failures or skips in this sweep. Typecheck/generated
declarations, declaration contracts, changed-file ESLint, import boundaries,
and diff whitespace checks pass. No addon or engine code changed.

## HTML §7.5.8: finishing the loading process

`DocumentImpl.completelyFinishLoading()` asserts the browsing context, records
completion, and queues the container's notification on its node Document's DOM
manipulation task source. Iframes run their specialized load steps; frame,
object, and embed containers receive a trusted, non-bubbling, non-cancelable
load event. This notification is separate from the child Window's load event
and uses the parent's event loop even when the child belongs to another Agent.
Destroying the owning Document discards its queued task through existing teardown.

Initial `about:blank` creation has no node navigable/container association yet,
so it records completion without queueing a notification. The separate
synchronous initial iframe notification still belongs to §4.8.5 attribute
processing. The [HTML completion algorithm](https://html.spec.whatwg.org/multipage/document-lifecycle.html#completely-finish-loading)
explicitly distinguishes these two paths.

`HTMLIFrameElementImpl.runLoadEventSteps()` now honors the child's mute flag,
sets its load-in-progress flag, fires load, and checks potential Permissions
Policy violations before clearing the flag. The checker reads current raw
attributes and the element's current node Document after author handlers.
The progress flag is also cleared if the reporting owner throws.

The existing iframe operation was a throwing dependency reached by the new
container task, including the enabled child-refresh regression. Its ordinary
event path is now implemented. Pending fallback resource timing still throws
explicitly: iframe navigation must retain its URL and start together and supply
the timing subsystem's shared-clock inputs before reporting can clear them.
The `document.open()` mute-flag producer, automatic container insertion/loading,
and the full stop-parsing/deferred-script/load-delay lifecycle remain unfinished.
This slice does not claim those Section 4, Section 8, or parser algorithms.

Browser evidence (2026-11-06): Chromium 156.0.8078.4, Firefox 157.0, and WebKit
27.2 agree on synchronous initial empty-iframe load, normal child Window load
before the iframe event, a microtask checkpoint between those events, and the
iframe event's trusted/non-bubbling/non-cancelable flags. The reproducible probe
and results are in Experimental's `document-load-completion.mjs` and
`DOCUMENT-LOAD-COMPLETION.md`. Blink's `HTMLFrameOwnerElement::DispatchLoad()`
also places fallback timing before dispatch and the potential policy check after it.

The [completion tests](../../../test/browlet/browsing/navigation/document-load-completion.test.ts)
cover timestamp/precondition handling, initial construction, all four container
types, parent-loop ownership, mute/progress flags, post-handler policy inputs,
pending timing, teardown, and automatic event-loop delivery without a renderer.
The caller audit also replaces obsolete JavaScript-URL and population tests
that expected the former HTML/iframe loader stubs to throw. They now verify
replacement loading and initial iframe notification. Supplied-response policy
expectations now retain the selected response header (or its empty policy),
consistent with the previously implemented response-policy factory.

Validation (2026-11-06): fourteen completion, refresh, policy, lifecycle, timing,
loader, browsing-context, Browlet, and navigation suites pass on Node 24.19.0,
26.8.1, and custom 27.0.0-pre in stock and matching-addon modes. Across those
suites each addon configuration passes 305 tests; each stock configuration passes
302 with the three existing Window identity/global prototype expected failures.
The existing external stylesheet test stays skipped.
All 14 new completion checks pass in every configuration. Typecheck/generated
declarations, declaration contracts, changed-file ESLint, import boundaries,
and whitespace checks pass. No addon or engine code changed.

The next document-order section is §7.5.9, unloading documents.

## Removal condition

Burn this file when navigation and subresource loading no longer depend on
the source-string route seam and all loading flows through `src/fetch`.
