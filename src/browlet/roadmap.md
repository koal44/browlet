# Browlet roadmap

This file records unimplemented browser-host domains whose eventual ownership
is already clear. It is not a compatibility promise. Burn each entry when
its domain has real source and its narrower roadmap has been removed.

Cross-domain implementation order and the observable exit proof for each wave
are maintained in [priority.md](priority.md).

## Source map

| Domain | Specification ownership | Browlet directory |
| --- | --- | --- |
| DOM infrastructure and objects | DOM §§1–9 | `dom/` |
| HTML common infrastructure, document, elements, and microdata | HTML §§2–5 | Distributed across `html/`, `browsing/policy/`, `loader/`, and `scripting/structured-data/` as mapped by `html/roadmap.md` |
| HTML parsing | HTML §13 | `html/parser/` |
| XML parsing and serialization | HTML §14; XML and Namespaces in XML; DOM Parsing and Serialization | `dom/parsing/`, using a dedicated XML syntax engine rather than the HTML parser |
| HTML suggested rendering and legacy compatibility | HTML §§15–16 plus CSS layout specifications | `rendering/` for boxes/output, `style/` for UA rules and presentational hints, and `html/legacy/` for retained APIs |
| Origins, policies, windows, and navigation | HTML §7 | `browsing/` |
| Agents, realms, scripts, scheduling, global utilities, timers, and frames | HTML §§8.1–8.3, 8.7–8.8, and 8.12 | `scripting/` |
| Dynamic markup, DOM parsing/serialization, and sanitization | HTML §§8.4–8.6 | `html/parser/`, `dom/parsing/`, and `html/sanitization/` |
| Window prompts, printing, and system capabilities | HTML §§8.9–8.10 | `browsing/window/` plus an embedder capability, and `navigator/` |
| Image and drawing primitives | HTML §§4.12 and 8.11 | `graphics/` |
| Cross-context, channel, server-event, and broadcast messaging | HTML §9 | `communication/` |
| User interaction, focus, editing, drag-and-drop, and popovers | HTML §6; UI, Pointer, Touch, Clipboard, Selection, and Fullscreen specifications | `interaction/` |
| Clocks and performance entries | High Resolution Time and Performance Timeline family | `performance/` |
| Accessibility tree and host exposure | HTML §3.2.9 and ARIA | Future `accessibility/` |
| Fetch records, algorithms, and API | Fetch | Sibling `src/fetch`; Browlet supplies host capabilities |
| Fetch-backed document and subresource loading | HTML §§2.5 and 7.4–7.5 | `loader/` over `src/fetch` |
| Workers | HTML §10 plus Storage-backed shared-worker identity | `workers/` |
| Worklet infrastructure | HTML §11; concrete worklet specifications | `worklets/`, with concrete types in their owning subsystem |
| Web Storage facade and events | HTML §12 over the Storage Standard | `storage/` |
| SVG and MathML host elements | HTML foreign-content integration plus SVG 2 and MathML Core | `svg/` and `mathml/` |
| CSSOM/HTML host integration | CSSOM, CSSOM View, and HTML link/style processing | `style/` |

Blink uses the same broad boundaries—`core/dom`, `core/html`,
`core/html/parser`, `core/frame`, `core/loader`, `core/execution_context`,
`core/workers`, `core/svg`, and `core/mathml`—but Browlet should not reproduce
Blink's native-code file granularity.

## External specification sequence

HTML §2.1.9 is a cross-reference inventory for the entire standard, not a
prerequisite list. Adopt an external standard when Browlet reaches its first
observable consumer; do not implement every specification merely because HTML
imports one of its terms.

| Wave | Specifications | Browlet decision or first consumer |
| --- | --- | --- |
| Delegated substrate | Infra; JavaScript, Intl, and core WebAssembly; Unicode and Encoding | Translate Infra notation directly into TypeScript; use the host JavaScript engine; retain `@exodus/bytes` for Encoding algorithms and APIs instead of creating parallel implementations |
| Implemented foundations | DOM, Web IDL, URL | Continue document-order audits as consumers reveal gaps; these are foundational because nearly every public object and algorithm crosses them |
| Additional document syntax | XML and its namespace/style-sheet-processing specifications; later XPath and XSLT | Keep the DOM namespace-aware; qualify a strict evented XML 1.0 engine against W3C conformance, §14 fragments, and bounded entity processing before character-input DOMParser work, then add byte-oriented XML navigation through the loader. Qualify XPath/XSLT engines separately; Browlet owns their DOM/Web IDL adapters, result objects, mutation integration, and HTML-specific behavior rather than another parser/evaluator by default |
| Execution and loading kernel | High Resolution Time; Fetch; HTTP; MIME Sniffing; Streams and the Blob subset of File API; cookies | Implement timing first, then Fetch records/APIs and an Undici-backed transport; connect loader/parser/document lifecycle without absorbing browser policy into the transport |
| Secure external content | Referrer Policy, CSP, Subresource Integrity, Mixed Content, Secure Contexts, Permissions Policy, Trusted Types, Reporting | Add with external scripts, styles, frames, and navigation; these are required for faithful loading but need not block the first response-bearing Fetch slice |
| Performance observability | Performance Timeline, Navigation Timing, Resource Timing, Paint Timing; later Long Tasks and Long Animation Frames | Build on the shared clock and Fetch/loader timestamps; paint and long-frame entries wait for rendering and scheduler machinery |
| Interaction and DOM extensions | UI Events, Pointer Events, Touch Events, Clipboard, DOM Parsing and Serialization, Selection, Fullscreen, `execCommand`, Console, and cooperative scheduling | Add from concrete focus/input/editing/parser consumers; selection and fullscreen require layout/lifecycle, while idle callbacks require a real event loop and scheduler |
| Styling, layout, and accessibility | CSS modules, Media Queries, Geometry, SVG, MathML, ARIA; later Intersection Observer, Resize Observer, Filter Effects, and Compositing | Stylelet owns CSS semantics; Browlet supplies DOM, environment, layout, rendering, and accessibility integration. Observers wait for geometry/layout |
| Application and offline platform | Full File API, Storage, IndexedDB, Service Workers, Web Locks, Web App Manifest, Background Sync/Fetch, XMLHttpRequest, URL Pattern, No-Vary-Search | Add storage-key derivation when SharedWorker or BroadcastChannel first consumes it; the public Web Storage facade can wait. Add Fetch before XHR/service workers, Navigation API before URL Pattern, and HTTP caching before No-Vary-Search |
| Network, crypto, and identity APIs | WebSockets, WebTransport, Web Crypto, Credential Management, WebAuthn, Payment Request | Add after streams, event-loop, origin, permissions, and secure-context foundations; none is needed to create and run an ordinary Document |
| Media and graphics | HTML media, WebVTT, Media Source Extensions, WebCodecs, Media Capture, WebRTC, Picture-in-Picture, canvas, WebGL, WebGPU | Treat as later subsystem projects with host decoders/devices. Media Source Extensions are media-buffer plumbing and are unrelated to CSS media queries |
| Automation | WebDriver and WebDriver BiDi | Preserve narrow lifecycle/navigation instrumentation points, but implement the protocols in a separate automation package after browsing, script, input, and network behavior are stable enough to drive |
| Optional device APIs | Battery, Screen Orientation, Idle Detection, Web Speech/OTP/Share, Smart Card, Keyboard Lock, MIDI, Sensors, HID, and WebXR | Defer until the corresponding host capability and an explicit product use case exist |

Core WebAssembly execution remains the JavaScript engine's responsibility.
Browlet only needs the HTML module-loader and structured-clone integration
when WebAssembly module scripts or cross-realm module transfer become a target.

## Deferred top-level domains

- [ ] Add `accessibility/` when its first observable behavior is implemented
  rather than reserving empty TypeScript modules. `interaction/` already has a
  specification roadmap but should gain TypeScript only with real behavior.
- [ ] Add other application APIs only when a consumer reaches them. The
  `communication/`, `navigator/`, `graphics/`, `workers/`, `worklets/`, and
  `storage/` roadmaps reserve Section 8–12 ownership without adding empty
  runtime modules.
- [ ] Add an automation/driver package outside `src/browlet` if Browlet grows
  into a Playwright-compatible headless engine. The browser core must not own
  the transport protocol.

## Removal condition

Burn this file once every row is represented by implemented source or a
more specific surviving roadmap, and the automation north star has a project
of its own.
