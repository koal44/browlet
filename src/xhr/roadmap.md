# XMLHttpRequest project roadmap

This directory will own Browlet's host-neutral implementation of the
[XMLHttpRequest Standard](https://xhr.spec.whatwg.org/): the `FormData`
entry-list model, XMLHttpRequest state and algorithms, and the specification's
Web IDL contributions. Browlet will supply realms, event targets, environment
settings, documents, tasks, and other browser-host state. Fetch will supply
request and response records, bodies, CORS, filtering, controllers, and network
transport.

This roadmap is intentionally being written before the File API roadmap even
though implementation should proceed in the opposite order. File API is a
direct prerequisite of both `FormData` and XMLHttpRequest responses, so its
analysis should be freshest when implementation begins.

Do not add a TypeScript project reference or package entry until the first
implemented slice makes this boundary executable. Do not expose
`XMLHttpRequest` merely because its declaration can be assembled: its useful
behavior begins at the Fetch integration boundary.

## Controlling architecture

The standard describes XMLHttpRequest in terms of Fetch. Preserve that
relationship. XMLHttpRequest owns its state machine, author-facing response
interpretation, progress throttling, and event order; it must not call Undici,
Node streams, Node timers, or Node's `fetch()` directly. A transport used by
Fetch must remain invisible here.

`src/xhr` must also remain independent of `src/browlet`. It can export records,
algorithms, declarations, and narrow host contracts. Browlet assembles those
contributions with its DOM and HTML implementations. This avoids making a
lower-level Fetch consumer depend back on the browser host that consumes it.

The three major responsibilities have different owners:

- The XHR Standard owns `FormData`'s public entry list and methods. HTML owns
  constructing an entry list from a form. Fetch owns multipart encoding and
  parsing.
- The XHR Standard defines `ProgressEvent` and the progress-event firing
  algorithm. Browlet's DOM event subsystem owns the projected `Event` state,
  dispatch machinery, and inheritance integration.
- The XHR Standard owns the XMLHttpRequest state machine. Fetch owns all
  network policy and I/O below the callbacks supplied by `send()`.

WebKit, Blink, and Gecko colocate XMLHttpRequest with browser loader and event
infrastructure, and all retain explicit progress-throttling machinery. Their
implementations are useful evidence for lifecycle and event ordering, but not
an ownership template: Browlet already has a separate Fetch boundary and
should not reconstruct a second loader inside XMLHttpRequest.

## Planned ownership

The final module division should follow behavior rather than mirror the
specification's physical file layout. The likely boundary is:

| Planned area | Responsibility | XHR sections |
| --- | --- | --- |
| `host.ts` | Relevant global and settings access, fully-active checks, event creation and dispatch, listener observation, task and timer scheduling, clocks, document parsing, and Fetch entry points | §§3.1–3.7 and 5.1 |
| `form-data.ts` | Entry-list state, construction helpers, mutation and lookup operations, iteration, and Blob/File normalization | §4 |
| `progress-event.ts` | `ProgressEventInit`, progress data, the IDL contribution, and the fire-a-progress-event algorithm | §§5.1–5.2 |
| `xml-http-request.ts` | XMLHttpRequest and upload state, ready states, author-facing properties, and the implementation objects | §§3.1–3.4 |
| `request.ts` | `open()`, request headers, `send()`, `abort()`, Fetch callbacks, timeout handling, and request-error/end algorithms | §§3.5 and 3.7 |
| `response.ts` | Response metadata, headers, MIME/encoding selection, bytes, and response materialization | §3.6 |
| `web-idl.ts` | Lossless XHR declarations and cross-package contributions assembled by Browlet | §§3–5 |

This is guidance, not a requirement to create empty modules. Split a module
only when the implementation establishes the responsibility.

## Dependency ledger

| Dependency | First required by | Present state | Delivery decision |
| --- | --- | --- | --- |
| File API `Blob` and `File` | §§3.5.6, 3.6, and 4 | Not implemented | Implement File API first. Do not substitute Node's `Blob` or `File`; XHR and Fetch must share the projected File API objects and implementations |
| Fetch records and algorithms | §§3.5–3.7 | Fetch has a detailed roadmap but no implementation | Keep local state independently testable, then stop before `send()` until Fetch supplies headers, bodies, requests, responses, controllers, filtered responses, and callback-driven fetching |
| DOM `Event` and `EventTarget` | §§3.2–3.3, 3.5–3.7, and 5 | Implemented in Browlet | Export declaration and integration contributions rather than importing Browlet. Add a narrow internal listener-observation seam because upload-listener presence affects CORS preflighting and garbage-collection reachability |
| HTML event handlers | §3.3 | Ordinary handler machinery exists | Contribute the named `on*` attributes through the established event-handler integration path; do not create duplicate listener storage |
| HTML environment settings and relevant globals | §§3.1 and 3.5.1 | Window realms and settings exist; workers are incomplete | Implement and test Window ownership first through a host contract. Defer worker exposure without changing the core records |
| Fully-active documents | §§3.5.1 and 3.5.6 | Implemented for the current browsing lifecycle | Ask the host for the relevant Document; do not move navigable or Document state into XHR |
| URL and origins | §§3.5.1 and 3.6.1 | Implemented host-neutrally in `src/url` | Reuse URL records, parsing, credentials, fragments, and serialization directly |
| MIME parsing and sniffing | §§3.6.6–3.6.9 | Implemented in `src/mime` | Reuse MIME records and supplied-type algorithms; response-type policy remains with XHR |
| Encoding labels and decoders | §§3.6.6–3.6.9 | Implemented in `src/encoding` | Reuse label lookup and decoder operations; never delegate author-facing response decoding to Node defaults |
| Streams | §3.5.6 and Fetch body processing | Ordinary stream core is implemented | Consume streams only through Fetch body records and File API Blob streams; XHR itself still accumulates received bytes as the standard requires |
| HTML timers, tasks, parallel queues, and monotonic time | §§3.5.3, 3.5.6, 3.7, and 5.1 | Event-loop scheduling, timers, parallel queues, and a shared monotonic clock exist | Use the owning global's scheduling boundary and clock for timeout and roughly-50-ms progress throttling. Do not introduce direct Node timers |
| HTML `pause` | Synchronous branch of §3.5.6 | Explicitly deferred | Defer synchronous XMLHttpRequest. Do not emulate it with `Atomics.wait()`, nested Node loops, or a promise bridge |
| DOM Parsing and Serialization | Document body branch of §3.5.6 | Fragment serialization is not complete | Defer sending a `Document` body until the normative serializer exists |
| HTML and XML parsers | §§3.6.9–3.6.12 | The HTML parser exists, but not the required known-encoding byte entry point; an XML parser is absent | Defer `responseType = "document"` and `responseXML`. Do not return a text-only surrogate Document |
| HTML forms and entry-list construction | `FormData(form, submitter)` in §4 | Form controls, form ownership, and construct-an-entry-list are absent | Complete the no-argument constructor and entry-list API first. Add the form constructor through an HTML-owned integration contribution when forms exist |
| Web IDL | §§3–5 | Projection, overloads, iterables, callbacks, partials, and cross-package capabilities exist | Keep realm selection, conversion, exceptions, and promise/event boundary work declarative where possible; semantic state belongs on implementations |
| Workers | §3 exposure sets and synchronous-XHR restrictions | Worker globals and lifecycle are incomplete | Preserve exposure metadata but defer executable worker installation and worker-specific synchronous behavior |
| Garbage collection | §3.2 | JavaScript reachability exists, but deterministic host-GC observation does not | Model strong reachability and controller termination in lifecycle ownership. Keep GC-sensitive WPTs separate from deterministic unit tests |

## Implementation slices

Implement algorithms in specification order within each slice. Keep normative
algorithm names and step order where practical. Each slice must be reviewable
and testable without pretending that a later dependency exists.

### Slice 1 — ProgressEvent foundation

**Scope:** XHR §§5.1–5.2, plus the declarations in §§3.2–3.3 needed to prove
the event inheritance boundary.

- Add `ProgressEventInit` and the `ProgressEvent` declaration contribution.
- Add semantic storage for `lengthComputable`, `loaded`, and `total` without
  duplicating base `Event` state.
- Implement fire a progress event using the target realm's constructor and
  Browlet's existing dispatch machinery.
- Establish the internal listener-observation capability needed later by the
  upload-listener and garbage-collection rules.
- Preserve the standard's loaded/total rules; do not infer a total when no
  length is available.

**Exit proof:** projected construction, inheritance, initialization defaults,
realm identity, dispatch, and progress values pass focused tests. No
XMLHttpRequest interface is exposed yet.

### Slice 2 — FormData entry-list core

**Scope:** XHR §4, after the File API implementation exists.

- Implement entry records and the ordered entry list.
- Implement the no-argument constructor, `append`, `delete`, `get`, `getAll`,
  `has`, `set`, and iterable behavior in specification order.
- Apply the HTML create-an-entry algorithm for strings and Blob/File values,
  including default filename and supplied filename behavior, through a narrow
  declared capability rather than copied HTML logic.
- Project the overloads and iterable declaratively through Web IDL.
- Export the semantic entry-list access that Fetch needs for Body extraction;
  do not expose mutable storage as public API.
- Leave `FormData(form, submitter)` visibly unavailable until HTML forms can
  construct an entry list and validate the submitter.

Multipart encoding and parsing do not belong in this slice. They are Fetch
algorithms consuming this entry-list model.

**Exit proof:** order, duplicates, replacement position, Blob/File naming,
conversion, iteration, and realm-correct projection pass focused tests. Fetch
can consume the entry list without calling author-facing methods.

### Slice 3 — XMLHttpRequest local state and synchronous-free surface

**Scope:** XHR §§3.1–3.5.5 and the network-independent portions of §3.6.

- Implement `XMLHttpRequestEventTarget`, `XMLHttpRequestUpload`, and
  XMLHttpRequest semantic objects and declarations.
- Add the complete internal state record, ready-state constants, send flag,
  upload flags, timeout state, request metadata, response metadata, received
  bytes, and response-object cache.
- Implement construction, event-handler contributions, and upload identity.
- Implement `open()` through URL, method, settings, fully-active, and Fetch
  controller contracts. Terminating an old controller remains observable even
  before real transport exists.
- Implement `setRequestHeader()` once Fetch header primitives exist, including
  normalization, forbidden names, and combination.
- Implement timeout, credentials, response-type guards, response URL/status,
  response header access, MIME override, and other properties whose answers
  depend only on injected records and state.
- Test the state machine with synthetic Fetch records rather than a network.

Do not add a partial `send()` whose behavior bypasses Fetch. Do not enable the
synchronous flag in an environment where HTML `pause` is absent.

**Exit proof:** construction, relevant-global ownership, state transitions,
guards, exceptions, header behavior, and response metadata pass deterministic
tests against synthetic records.

### Slice 4 — Asynchronous send, progress, timeout, and termination

**Scope:** XHR §§3.5.6–3.5.7 and 3.7, after Fetch's request, body, response,
controller, filtering, and callback orchestration exist.

- Extract supported request bodies through Fetch's BodyInit machinery.
- Construct the Fetch Request record with the exact XHR mode, credentials,
  initiator, service-worker, referrer, and response-tainting inputs.
- Determine the upload-listener flag before fetching and let Fetch derive the
  resulting CORS-preflight behavior.
- Connect request-body progress, request-body end, response, response-body
  chunk, and response-body end callbacks to the XHR state machine.
- Implement the roughly-50-ms progress throttle using the shared monotonic
  clock and owning event loop.
- Implement timeout through the Fetch controller and global task destination.
- Implement request error, request end-of-body, handle errors, and abort with
  the precise readystatechange/progress/load/error/timeout/abort/loadend order.
- Ensure callbacks and queued work retain the correct XHR object and realm.
- Use a deterministic fake Fetch host for algorithm tests before adding a real
  transport oracle.

The Document request-body branch remains deferred until DOM serialization is
available. The synchronous branch remains deferred until HTML `pause` exists.

**Exit proof:** a fake Fetch implementation can drive success, upload,
incremental download, cancellation, timeout, network error, and reentrant
listener scenarios with exact state and event ordering.

### Slice 5 — Response materialization and lifecycle tails

**Scope:** XHR §§3.2 and 3.6, followed by the remaining exposure work.

- Implement response MIME and final-encoding selection.
- Implement text, JSON, ArrayBuffer, and Blob response materialization with
  per-response caching and realm-correct objects.
- Complete response byte/text behavior for null, failure, and partial states.
- Add HTML Document response parsing only when the parser accepts the required
  byte stream and known encoding with scripting disabled.
- Add XML Document response parsing only with a conforming XML parser.
- Add `responseXML` only when both response-Document branches are honest.
- Complete active-object reachability and Fetch controller termination on
  collection to the degree supported by the host, with GC-sensitive tests
  isolated from deterministic behavior tests.
- Install worker exposure only with real worker globals and lifecycle.
- Implement synchronous XMLHttpRequest only after HTML `pause` supplies the
  required nested processing contract.

**Exit proof:** every implemented response type has success, failure,
wrong-state, wrong-realm, and caching coverage. Every remaining tail names its
missing owner and completion condition rather than silently degrading.

## Explicit non-goals and stop conditions

- Do not begin XHR transport integration before Fetch exposes its record and
  callback model.
- Do not treat Undici's classes or Node's global `fetch()` as Fetch records.
- Do not implement multipart encoding in `FormData`; Fetch owns it.
- Do not define form-control success rules in XHR; HTML owns them.
- Do not fake Document responses, XML parsing, worker globals, or synchronous
  event-loop pausing.
- Do not invent a second event-listener registry merely to answer whether an
  upload listener exists.
- Do not make the progress throttle a direct wall-clock `setTimeout()` loop.
- Do not interpret browser loader architecture as permission to merge XHR and
  Fetch ownership in Browlet.

## Final completion audit

Before declaring the project complete:

1. Audit XHR §§3–5 in document order against the current Living Standard.
2. Run focused Web IDL, realm, state-machine, event-order, FormData, and
   response-materialization tests.
3. Import the applicable XHR WPTs in behavior groups rather than as one opaque
   suite; keep network, worker, synchronous, parser, and GC requirements
   separately attributable.
4. Compare disputed behavior with WebKit, Blink, and Gecko while keeping the
   standard authoritative unless a deliberate interoperable deviation is
   documented.
5. Verify that Fetch remains the sole owner of transport, CORS, response
   filtering, and multipart processing.
6. Remove this roadmap only when every explicit deferral has either been
   implemented or moved to the surviving roadmap of its actual owner.
