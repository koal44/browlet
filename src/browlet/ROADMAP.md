# Browlet roadmap

This is the browser-host ownership map. Rows can describe implemented or planned
domains; narrower roadmaps carry their actual status and remaining contracts.
[Project priority](../PRIORITY.md) owns execution order, and
[architecture](../ARCHITECTURE.md) owns composition and environment conventions.

## Source map

| Domain | Specification ownership | Browlet directory |
| --- | --- | --- |
| DOM infrastructure and objects | DOM §§1–9 | `dom/` |
| HTML common infrastructure, document, elements, and microdata | HTML §§2–5 | Distributed across `html/`, `browsing/policy/`, `loader/`, and `scripting/structured-data/` as mapped by `html/ROADMAP.md` |
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

## Current boundary

Fetch's planned delivery slices and independent preflight are complete within
their recorded scope. Reuse the implemented HTTP transport/cache/authentication,
CORS, policy checks, Reporting delivery, Storage keys, and Blob URLs. Their
remaining audits and owner gates are in the [Fetch roadmap](../fetch/ROADMAP.md).
They no longer need to be scheduled as missing foundations for HTML.

Full browser navigation, script loading/execution, nested contexts, element-driven
loading, and much of the public DOM remain unfinished. Follow the
[DOM](dom/ROADMAP.md), [browsing](browsing/ROADMAP.md),
[loader](loader/ROADMAP.md), and [scripting](scripting/ROADMAP.md) plans rather
than interpreting implemented Fetch as complete HTML loading.

## Later external consumers

HTML's dependency inventory is not a prerequisite list. Introduce an external
standard with its first real consumer and retain its own ownership:

- XML parsing/serialization, XPath, and XSLT need qualified engines and DOM
  integration; an HTML parser is not an XML parser.
- Performance Timeline/Navigation/Resource Timing build on existing clocks and
  Fetch records. Paint/long-frame APIs also need rendering/scheduler consumers.
- Permissions Policy, Trusted Types, and remaining CSP enforcement enter with
  the relevant navigation, element, worker, and compilation lifecycles.
- IndexedDB, Web Locks, manifest, background APIs, and public Web Storage remain
  future application work. XHR can now use Fetch; SharedWorker/BroadcastChannel
  can use existing storage keys. URL Pattern and No-Vary-Search need their actual
  navigation/cache consumers.
- WebSockets, WebTransport, Web Crypto, credentials, WebAuthn, and payments have
  separate protocol/security/host dependencies.
- [Media](media/ROADMAP.md), graphics, layout, accessibility, and interaction
  retain their own prerequisites. MSE is unnecessary for existing Blob URLs.
- Device APIs need both an explicit use case and a host capability.
  Core WebAssembly execution remains engine-owned; HTML module/clone integration
  enters with its consumers.

## Deferred top-level domains

Add accessibility and other new domains when their first behavior arrives,
not as empty source placeholders. Existing narrow roadmaps reserve ownership
for communication, workers/worklets, storage, navigation, and rendering.

A future WebDriver/BiDi protocol package can drive the browser's normal algorithms.
The core retains scoped instrumentation hooks and the existing evaluation bridge;
it should not acquire a second navigation lifecycle or the driver transport.
