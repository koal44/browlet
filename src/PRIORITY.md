# Project implementation priority

This is the execution order for the whole repository: Browlet's browser model,
Stylelet, Selectlet, and the shared specification subsystems. Narrow roadmaps
own exact contracts, tests, and stopping points. [ARCHITECTURE.md](ARCHITECTURE.md)
owns composition; [LIMITATIONS.md](LIMITATIONS.md) owns observable constraints.

Independent Stylelet and Selectlet work can proceed without waiting for HTML
while preserving their host-neutral contracts. The gates below order their
integration with the shared foundations and browser consumers.

## Current position

- The Stylelet declaration boundary is established: Stylelet exports neutral
  CSSOM contributions and Browlet supplies its host binding. Complete CSSOM
  platform projection remains [style integration](browlet/style/ROADMAP.md) work.
- The clock, abort core, active-Document relationships, task kernel, Window
  function timers, and supported explicit microtask backend are present.
  Script records, reaction delivery, and broader global lifecycles remain open.
- Streams, Encoding, File/Blob, FormData's no-form core, structured data, and
  Fetch's delivery slices supply the portable data foundation. Fetch's HTTP,
  HSTS, Storage/Blob URL, Reporting, Mixed Content/UIR, and CSP dependency work
  is complete within each owner's recorded scope.
- Fetch now provides internal/public fetching, local schemes, streaming
  HTTP/1.1 and HTTP/2, authentication, caches, CORS, cancellation, and retained
  Reporting delivery. Its [conformance audit](fetch/ROADMAP.md#conformance-audit)
  is complete within the recorded scope. The HTML byte-loader proof has
  provisional lifecycle hooks; it does not complete navigation, parsing, or
  script execution.

Resume the unfinished DOM and HTML foundations below. Fetch's remaining features
and owner integrations are deferred in its roadmap. Do not reopen completed
preflight as a second backlog, or infer DOM readiness from the Fetch milestone.
File/XHR consumers can use the completed Fetch contract when their own
prerequisites are ready.

DOM 4A-4I now provide structural/text mutation, live Range/NodeIterator participation,
the shared attribute path, live/static collections, convenience mutations, and
Selectlet-backed selector APIs, with MutationObserver records and Agent-backed
notification. Trusted Types TT-A/TT-B supply Window factories,
trusted values and policies, default-policy processing, attribute enforcement,
and CSP checks/reporting through the existing mutation path.
[DOM 4I](browlet/dom/nodes/ROADMAP.md#node-and-document-completion-4i) adds clone/import,
equality and namespace queries, document factories, XML leaf interfaces, and
ProcessingInstruction pseudo-attributes. Shadow attachment and slot assignment
share the mutation path and observer checkpoint. [DOM §5](browlet/dom/ranges/ROADMAP.md)
completes the core Range surface; contextual fragments and geometry keep their
parser/layout gates. DOM §6 traversal now supplies NodeFilter, NodeIterator, and
TreeWalker through the Document factories. DOM §7 adds DOMTokenList and
Element.classList through the shared attribute path. The bounded HTML §§2–3
pass has recorded the [§§2.1–2.2 audit](browlet/html/ROADMAP.md#sections-21-and-22-audit).
The [§2.3 microsyntax slices](browlet/html/microsyntaxes/ROADMAP.md#five-implementation-slices)
now supply 2.3A's boolean/enumerated attribute values and canonical keywords,
2.3B's exact integers, floating-point values, dimensions, and numeric lists,
2.3C's dates, times, offsets, weeks, and durations, 2.3D's legacy colors and
token syntax, and 2.3E's hash-name references. The media and identity review
retains the deferred matching and serialization gates. The
[§2.4 URL audit](browlet/html/ROADMAP.md#section-24-audit) led to §2.4.2's parsing
methods on Document and the browser environment. The §2.4.3 base-change response
now has a basic HTML script implementation and approved provisional consumers for
hyperlink state, speculation-rule parsing/registration, and speculative loads.
Those effects and the proposed nested-document slices remain explicit follow-ups.
The [§2.5 audit](browlet/html/ROADMAP.md#section-25-audit) now includes §2.5.1's
potential-CORS request construction, §2.5.2's response reader and sniffed-prefix
replay, §2.5.3's meta charset extractor, §2.5.4's CORS attribute states and
credentials mapping, and §2.5.5's referrer-policy attribute interpretation.
Link/script expose `crossOrigin` and `referrerPolicy` reflection. Actual content
support and general document-handler selection remain explicit loader gates.
Element fetch consumers, complete document policy delivery, and custom-element
reactions remain explicit dependencies. The bounded §2.5.7 lazy-loading slice is
accepted complete; its element state and HTML observer consumer use a provisional
Intersection Observer for registrations and entry queues. Complete observer
initialization, geometry, bindings, automatic delivery, and actual element loaders
remain in the HTML/observer roadmaps. The BiDi scripting hook has an approved
provisional no-session result; scoped automation overrides remain unfinished.
§2.5.6 adds nonce state, IDL, attribute synchronization, connection-time hiding,
and cloning across HTML, SVG, and MathML. Policy delivery and script/style loading
remain separate consumers. §2.5.8 adds link/style/script `blocking` token lists
and potential-render-blocking predicates, including parser-origin state.
Script preparation and resource-loading integration remain explicit dependencies.
§2.5.9 adds shared fetch-priority states and image/link/script
reflection; element loaders and actual network prioritization remain pending.
The [§§2.6.1–2.6.3 reflection slice](browlet/html/reflection/ROADMAP.md) now
consolidates the implemented attributes and supplies numeric, URL, token, and
element-reference rules. Minimal ElementInternals state and shadow-root access
are present; attachment, ARIA, forms, and reaction delivery remain pending.
§2.6.4.1 HTMLAllCollection and native `document.all` are implemented, with the
[enumeration-order clash](browlet/dom/nodes/ROADMAP.md#property-enumeration-order)
retained for engine follow-up. §§2.6.4.2–2.6.4.3 form/options collections now have
minimal concrete [form-control owners](browlet/dom/nodes/html/forms/ROADMAP.md).
Form membership, radio grouping, automatic selection, and selectedcontent remain
explicit stubs; three approved expected-failure tests expose the first three gaps.
§2.6.5 supplies DOMStringList, now retained by Document ancestry initialization;
child navigation and Location's relevant-document/security integration remain pending.
The [§3.1.1 slice](browlet/html/ROADMAP.md#section-311-document-state-and-declarations)
supplies Document's required initial state, inherited-base cloning hook, and
declared types, with minimal dialog/SVG-script identities and readonly
referrer/readiness projection. Its complete member inventory keeps later
algorithms explicit. The [§3.1.2 contribution](browlet/html/ROADMAP.md#section-312-documentorshadowroot-contribution)
adds the active-element declaration and getter while leaving Document's focused
area as an explicit throwing dependency on §6.6. The
[§3.1.3 slice](browlet/html/ROADMAP.md#section-313-ancestor-origins) supplies
ancestor-origin lists and policy masking, with explicit parent input before
activation and child-navigation dependencies recorded. The
[§3.1.4 slice](browlet/html/ROADMAP.md#section-314-resource-metadata) adds Document cookie
access and response modification dates; local-file metadata remains a loader dependency,
and inherited cookie URLs still need iframe/initiator and history-restoration producers.
The [§3.1.5 slice](browlet/html/ROADMAP.md#section-315-document-loading-status)
adds readiness transitions/events, parser lifecycle state, and load/unload
timing records. XML parsing, unload capture, and complete parser/load scheduling
remain explicit dependencies. The [§3.1.6 mechanism](browlet/html/ROADMAP.md#section-316-render-blocking)
adds Document's blocking set, eligibility and timeout checks, element cleanup,
and rendering-opportunity filtering. Resource loaders and production rendering
remain separate dependencies. The [§3.1.7 accessors](browlet/html/ROADMAP.md#section-317-dom-tree-accessors)
add HTML/SVG title, body replacement, live collections/name lookup, currentScript
state, and Document named properties. Object fallback selection, iframe child
navigation, and script-execution producers remain explicit dependencies.
The [§3.2.1 audit](browlet/html/ROADMAP.md#section-321-semantics-audit-2026-10-16)
accounts for authoring requirements and the unfinished dynamic-presentation
dependency. The [§3.2.2 slice](browlet/html/ROADMAP.md#section-322-elements-in-the-dom)
completes HTML element identities and the shared-member dependency inventory,
including ordinary reflections available now. The [§3.2.3 constructor slice](browlet/html/ROADMAP.md#section-323-html-element-constructors)
implements HTML constructor overrides and their consumed definition/stack state.
The [§3.2.4 review](browlet/html/ROADMAP.md#section-324-element-definitions-audit)
accounts for the definition headings and verifies unrestricted DOM attribute
strings. Every registered HTML tag now has a distinct internal implementation
while retaining its specified public interface. Resume §3.2.4 to attach the
category, content-model, and sanitization information to these owners before
continuing with §3.2.5. Consumer algorithms retain their subsystem owners.
Keep missing
dependencies with their owners; this is not a requirement to finish every referenced subsystem. HTML
§3.2.3 leads into §4.13
for public definition registration, upgrade producers, and reaction delivery.
HTML cloning hooks retain their separate gates.
Selectlet continues to use its existing pointer traversal.
Trusted parser options, sanitization, markup
APIs, script compilation, and workers keep their later consumer gates.

The [WPT roadmap](../wpt/ROADMAP.md) accompanies these stages. The selected suite's
unexpected failures are resolved, and CI runs the selection and publishes its
results and progress graphic. WPT-compatible report interchange and server
integration remain open. Broaden test coverage as each owning subsystem becomes
ready, rather than postponing all conformance work until the browser is complete.

## Dependency order

Numbers express default focus, not a requirement to finish unrelated work first.
Each stage ends with observable behavior through the actual public/integration
path. Implement the named portion of a roadmap, not every future feature in it.

| Stage | Prerequisites | Scope and completion proof |
| --- | --- | --- |
| 0. Package boundary | Existing packages | Host-neutral Stylelet declarations with Browlet adapters; established, with CSSOM projection still separate |
| 1. Deterministic foundations | Realm, Window, URL, Web IDL, events | One clock and activity model; deterministic task, microtask, timer, and cancellation delivery; may proceed beside 2 |
| 2. Normative DOM | Existing projected DOM | One mutation path updates ranges, iterators, collections, selectors, and style atomically |
| 3. Reactions and parsing | 1 + 2 | Script and parser mutations have identical ordered observer, custom-element, slot, and style consequences |
| 4. Portable data and Fetch | 1 | Realm-correct values and cancelable transport through explicit destinations; may proceed beside 2/3 |
| 5. Complete Document loading | 1 + 3 + 4 | URL-to-Document lifecycle with parsing, classic scripts, style, images, events, and timing |
| 6. First rendered page | 5 + Stylelet boundary | UA/author style, boxes, deterministic geometry/output, animation frames, and timing observations |
| 7. Browsing topology | 4 + 5 | Parent/iframe navigation, access control, messaging, teardown, and traversal preserve identity; may proceed beside 6 |
| 8. Author API families | 2 + 3 and relevant parts of 5-7 | Each family proves behavior against its real element/layout/loader consumers |
| 9. Multiple globals and storage | 4 + 7 | Worker agents, lifetime, transferred messages, and partitioned shared state; storage internals can precede public delivery |
| 10. XML and foreign content | 2; also 5 for navigation | Namespace-correct trees, claimed XPath/XSLT profiles, and shared mutation behavior; no rendering prerequisite for parsing |
| 11. Consumer-driven tails | The specific consumer | Compatibility or product evidence justifies each additional feature |

## Next foundation gates

**1: retain one deterministic host.** Extend the existing
[scripting/event loop](browlet/scripting/ROADMAP.md),
[timing](browlet/timing/README.md), [performance](browlet/performance/ROADMAP.md),
[abort](browlet/dom/abort/ROADMAP.md), and
[browsing](browlet/browsing/ROADMAP.md) owners. Add element task destinations
and checkpoint consumers when needed. Worker suspension, timer strings, and
idle periods await their actual script/global/rendering consumers. Follow the
bounded [microsyntax slices](browlet/html/microsyntaxes/ROADMAP.md); reflection
consumes their value algorithms, while media matching retains its style/host
dependency gate.

**2: complete the normative DOM mutation spine.**
[Infrastructure](browlet/dom/infra/ROADMAP.md), [nodes](browlet/dom/nodes/ROADMAP.md),
[ranges](browlet/dom/ranges/ROADMAP.md), and [traversal](browlet/dom/traversal/ROADMAP.md)
must share validity checks, adoption, insert/move/replace/remove/clone, attributes,
and CharacterData. Include live Range adjustment and NodeIterator pre-removal.
Live/static collections and selector APIs use the existing Selectlet adapter.
TreeWalker can later supply its optional traversal hook. Tests must reject
invalid mutations without partial changes.

The completed [Trusted Types TT-A/TT-B pass](browlet/browsing/policy/trusted-types/ROADMAP.md)
closes 4D's string-only dependency through existing Web IDL and CSP owners.
4E extends the checked attribute path to inherited Attr setters. Later Trusted
Types consumers retain their own gates without requiring parser or sanitizer work now.

**3: join mutation, reactions, and parsing in one vertical slice.**
The [DOM](browlet/dom/ROADMAP.md) and [custom-element](browlet/dom/nodes/html/custom-elements/ROADMAP.md)
owners supply MutationObserver delivery, reaction stacks/`[CEReactions]`, and
slot assignment/signaling at the same checkpoint. The [parse5 adapter](browlet/html/parser/ROADMAP.md)
must use that mutation path, including foster-parented text, templates, intended
parents/scoped registries, scripting mode, and foreign content. Build
[reflection](browlet/html/reflection/ROADMAP.md) on the completed attribute and
DOMTokenList/classList contracts for the
initial html/head/title/base/meta/body/style/template/slot shell.

These passes also retire relevant boundary debt: incomplete DOM host contracts,
post-conversion values widened back to platform types,
Array-backed legacy collection shortcuts, and known interface returns declared
as `object`/`any`. Prefer ordinary instance operations over obsolete static
friends. Apply the [shared vocabulary](ARCHITECTURE.md#source-boundaries-and-vocabulary)
as those code paths are reviewed, without a separate speculative rewrite.

**4: consume the established Fetch contract.**
The [Fetch roadmap](fetch/ROADMAP.md) retains deferred group cancellation,
deferred-fetch, cache, and transport work. Owner integration gates
remain explicit. [File](file/ROADMAP.md), [XHR](xhr/ROADMAP.md),
[HTTP](http/ROADMAP.md), [Storage](storage/ROADMAP.md), and
[structured data](browlet/scripting/structured-data/ROADMAP.md) retain their own
tails: worker cleanup, forms, public XHR, proxy routes, and new transfer types.
Do not recreate protocol or policy logic in downstream loaders.

## Document and browser milestones

**5: load and execute one Document.** [Loader](browlet/loader/ROADMAP.md),
[navigation](browlet/browsing/navigation/ROADMAP.md),
[policy](browlet/browsing/policy/ROADMAP.md), and
[parser](browlet/html/parser/ROADMAP.md) complete response selection, cancelable
bytes, encoding sniffing/restart, origin/policy inheritance, readiness,
DOMContentLoaded, and load delays. [Scripting](browlet/scripting/ROADMAP.md)
adds Script records, callback/error handling, inline classic scripts, then
parser-blocking/external classics; modules/import maps follow the classic path.
Prove inline style, external link, script, and image loading in that order.
Retain navigation/resource timing from the same records. Exercise timer, Fetch,
parser, and load ordering on the supported runtime backends; plain Node's
limitations do not redefine HTML behavior.

Use the first Fetch-backed Document/external-script slice to integrate
[WPT's servers](../wpt/ROADMAP.md#c-use-wpts-servers-with-document-loading).
Dynamic-markup, child-context, and worker tests follow their own prerequisites.

**6: render that Document.** [Style](browlet/style/ROADMAP.md) supplies versioned
UA rules and presentational hints; [rendering](browlet/rendering/ROADMAP.md)
consumes Stylelet values for boxes, viewport, block/inline layout, text, and
replaced content. Rendering opportunities and animation frames join the existing
event loop. [Performance](browlet/performance/ROADMAP.md) and
[graphics](browlet/graphics/ROADMAP.md) add the required entries and deterministic
output. DOM presence or `display` alone is not proof that an element is rendered.

**7: extend the browsing graph.** [Browsing](browlet/browsing/ROADMAP.md) and
[Window](browlet/browsing/window/ROADMAP.md) add child navigables, iframe/srcdoc,
same-/cross-origin Window/Location behavior, child loads, and destruction.
Native WindowProxy reuse already supplies identity, not origin policy. Extend
[interaction](browlet/interaction/ROADMAP.md), fragment/history traversal,
reload, and [communication](browlet/communication/ROADMAP.md) with transferred
ports and navigation-between-send-and-delivery tests. Auxiliary contexts and
session-storage cloning follow children/traversal. Retained-history ownership
and inactive Document disposal are an HTML lifecycle task, not a Reporting fix.

## Later consumer gates

**8: add coherent author API families.** Follow [elements](browlet/dom/nodes/html/ROADMAP.md),
[collections](browlet/html/ROADMAP.md#collections-and-domstringlist),
[DOM parsing](browlet/dom/parsing/ROADMAP.md), [sanitization](browlet/html/sanitization/ROADMAP.md),
[interaction](browlet/interaction/ROADMAP.md), and [Navigator](browlet/navigator/ROADMAP.md).
Build convenience APIs on completed mutation; fragment setters on real parsing;
forms, tables, dialogs, and ordinary elements before specialized widgets/media.
ImageData/image decoding precede canvas/media reuse. Interface names alone are
not a completion proof.

**9: add globals with real lifetimes.** [Workers](browlet/workers/ROADMAP.md)
need distinct agents/loops, Fetch-backed scripts, MessagePorts, and owner-driven
termination. Existing [Storage keys](storage/ROADMAP.md) support shared-worker
discovery and BroadcastChannel; [Web Storage](browlet/storage/ROADMAP.md) adds
sheds, quotas, wrappers, and events. EventSource consumes streaming Fetch and
retry scheduling. [Worklets](browlet/worklets/ROADMAP.md) need a selected concrete
consumer before a generic base. Service Worker integration has its own worker,
navigation, and offline-storage prerequisites.

**10: qualify XML and foreign engines.** [DOM parsing](browlet/dom/parsing/ROADMAP.md),
[SVG](browlet/dom/nodes/svg/ROADMAP.md), and [MathML](browlet/dom/nodes/mathml/ROADMAP.md) own syntax,
namespaces, and initial profiles. [XPath](browlet/dom/xpath/ROADMAP.md) needs
result typing and mutation invalidation; [XSLT](browlet/dom/xslt/ROADMAP.md) is
optional and requires a qualified engine and controlled loader. XML navigation
and advanced rendering follow those separate foundations.

**11: pull breadth forward only for a consumer.**
[Legacy HTML](browlet/html/legacy/ROADMAP.md), [microdata](browlet/html/microdata/ROADMAP.md),
[media](browlet/media/ROADMAP.md), advanced graphics/layout, persistent/offline
storage, device APIs, editing/accessibility UI, and external WebDriver automation
are not prerequisites for the earlier browser milestones. Continue accepting
legacy markup while its public compatibility surface remains deferred.

The [Browlet domain map](browlet/ROADMAP.md) indexes the detailed browser owners.
Keep this guide short: update state and dependency gates here, put new algorithm
inventories in the owner roadmap, and remove completed journals rather than
copying them into the next stage.
