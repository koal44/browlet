# XMLHttpRequest roadmap

[XHR](https://xhr.spec.whatwg.org/) contributes FormData, ProgressEvent, and the
XMLHttpRequest state machine. The no-form FormData API and ProgressEvent are
implemented. XMLHttpRequest/Upload themselves are not yet implemented or exposed.
Fetch now supplies their protocol dependency; it is no longer a missing foundation.

## Current ownership

| Owner | Responsibility |
| --- | --- |
| [form-data.ts](form-data.ts) | Ordered entry list, Blob/File normalization, mutation, lookup, iteration, and declaration |
| [Browlet ProgressEvent](../browlet/dom/events/progress-event.ts) | XHR §5 event implementation, declaration, and trusted firing |
| [Fetch](../fetch/README.md) | Requests, responses, headers, bodies, controllers, policy, transport, and multipart processing |
| [File](../file/ROADMAP.md) | Shared Blob/File data and realm-owned reads |
| HTML/browser integration | Forms, concrete event targets, settings, Documents, tasks, timers, and lifecycle |

FormData's no-argument constructor and methods are complete. New Files use its
`env`; an unchanged File keeps its existing identity and owner. Fetch consumes
the internal entry list and preserves encoded multipart data for replay.
HTML owns constructing an entry list from a form. The declaration retains
`HTMLFormElement`/submitter types; missing interface conversion and an internal
guard keep that branch visibly unavailable until forms are implemented.

XHR owns ready states, response interpretation, progress throttling, and event
order. It must consume Fetch rather than call Undici, Node fetch, or sockets.
Portable code must not import Browlet or reconstruct its event infrastructure.
Place concrete browser integration with its actual owner, following the existing
FileReader boundary; decide module splits when implementation establishes them.

## Dependencies for the next work

| Dependency | Present boundary |
| --- | --- |
| Fetch | Internal `fetch(request, options, env)` returns a controller and supplies upload/response/body/completion callbacks, filtered records, CORS, and cancellation |
| Web IDL and DOM events | Conversion, projection, event handlers, EventTarget, and ProgressEvent exist; upload-listener observation and active-object retention still need their actual XHR consumer |
| Environment and scheduling | Window settings, fully-active checks, event loops, timers, and monotonic time exist; use the relevant owner's tasks for delivery and progress/timeout work |
| URL, MIME, Encoding, File, Streams | Implemented foundations for request inputs and text/JSON/byte/Blob responses; do not replace them with Node's platform objects |
| HTML forms | Form ownership, successful controls, submitter validation, entry-list construction, and the formdata event remain missing |
| Document serialization | The Document request-body branch needs normative DOM serialization |
| Document parsing | HTML has provisional streamed BOM/transport decoding; XHR still needs final-encoding selection and a scripting-disabled Document path. A conforming XML parser is absent |
| HTML pause and workers | Synchronous XHR and executable worker exposure remain deferred |

The [Fetch roadmap](../fetch/ROADMAP.md) records provisional hooks and remaining
protocol work. XHR should expose missing consumer contracts for review rather
than create a second policy/transport stack. HTML parsing dependencies belong
to the [parser](../browlet/html/parser/ROADMAP.md) and
[loader](../browlet/loader/ROADMAP.md); forms, serialization, and worker work
follow [project priority](../PRIORITY.md).

## Remaining implementation slices

The original slices 1–2 delivered ProgressEvent and FormData. Continue with
slices 3–5 below; this roadmap does not restart their completed foundation work.

### Slice 3 — Local state and asynchronous surface

XHR [§§3.1–3.5.5](https://xhr.spec.whatwg.org/#interface-xmlhttprequest) and
network-independent response access:

- Add XMLHttpRequestEventTarget, XMLHttpRequestUpload, and XMLHttpRequest
  state/declarations: ready states, send/upload flags, timeout, request and
  response records, received bytes, and the response-object cache.
- Establish constructor ownership, stable upload identity, and event handlers
  through existing binding/event machinery.
- Implement `open()` using URL/method/settings checks, fully-active state, and
  controller termination when replacing an earlier request.
- Implement `setRequestHeader()` with Fetch's normalization, forbidden names,
  and combination rules.
- Add timeout, credentials, responseType, response URL/status, header access,
  MIME override, and their state/exception guards.

Prove these with synthetic records and projected APIs: conversion, realms,
state transitions, guards, header behavior, and replacement of old requests.
Do not install an apparently usable public XHR backed by a no-op send, or
allow synchronous execution without HTML's pause contract.

### Slice 4 — Send, progress, timeout, and termination

XHR [send](https://xhr.spec.whatwg.org/#the-send()-method),
[abort](https://xhr.spec.whatwg.org/#the-abort()-method), and request error/end steps:

- Extract supported bodies through Fetch. Set the specified mode, credentials,
  initiator, service-worker, referrer, and response-tainting inputs.
- Capture upload-listener state before fetching and let Fetch apply preflight
  and cross-origin policy before revealing progress information.
- Connect upload progress/end, response headers, response-body chunks/end, and
  errors to the ready-state and event algorithms.
- Throttle progress on the shared monotonic clock at the specified roughly
  50-ms boundary; use the owner's task/timer delivery instead of Node timers.
- Terminate through the Fetch controller for abort and timeout. Preserve exact
  readystatechange/progress/load/error/timeout/abort/loadend ordering, including
  reentrant listeners and suppression of stale work.

Use deterministic callback delivery for state/event tests and real Fetch with
loopback transport for integration. Cover upload/download, partial responses,
network failure, cancellation, timeout, reentrancy, and owner retention.
Document request bodies and synchronous send remain gated below.

### Slice 5 — Responses and lifecycle

XHR [§3.6](https://xhr.spec.whatwg.org/#xmlhttprequest-response) and §3.2:

- Implement final MIME/encoding selection and text, JSON, ArrayBuffer, and Blob
  materialization, including null, failure, partial, and wrong-state behavior.
- Cache response objects as specified and allocate results in the owning realm.
- Add HTML Document responses only with the required encoding and disabled
  scripting; XML responses require the XML parser. Do not substitute a text-only
  Document or claim complete responseXML with a missing parsing branch.
- Model active-object reachability and controller termination through browser
  lifecycle ownership. Keep nondeterministic GC checks separate.

Every implemented response type needs success, failure, state, realm, and
identity/caching coverage. Additional lifecycle branches enter with their owners.

## Deferred owner integrations

- **Forms:** connect `FormData(form, submitter)` when HTML can construct the
  entry list and fire formdata with the required validation/reentrancy.
- **Document bodies:** use the normative serializer; Fetch BodyInit alone does
  not implement XHR's Document extraction rules.
- **HTML/XML responses:** complete the parser contracts above and verify MIME,
  charset, scripting-disabled state, and parse failures.
- **Synchronous XHR:** requires HTML pause and the appropriate restrictions.
  Do not emulate it with Atomics.wait, a nested Node loop, or a Promise bridge.
- **Workers:** preserve exposure metadata, then install APIs with actual worker
  globals, settings, termination, and synchronous behavior where permitted.

## Validation and completion

Existing [FormData](../../test/browlet/form-data.test.ts) and
[ProgressEvent](../../test/browlet/progress-event.test.ts) tests cover those
completed APIs. They do not establish XMLHttpRequest behavior.

Audit XHR §§3–5 in document order after implementation. Add WPT groups by
behavior so state/events, network/CORS, forms, parsers, workers, synchronous
execution, and GC retain separate failure owners. Use browser comparisons for
disputed behavior and retain the chosen rule/evidence. The completion boundary
must name every deferred owner instead of silently degrading its API.
