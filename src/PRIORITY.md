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

The [WPT roadmap](../wpt/ROADMAP.md) accompanies these stages. Investigate the
selected suite's failures now; add reports and bounded CI with the project
presentation pass. Broaden test coverage as each owning subsystem becomes ready,
rather than postponing all conformance work until the browser is complete.

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
[performance](browlet/performance/ROADMAP.md),
[abort](browlet/dom/abort/ROADMAP.md), and
[browsing](browlet/browsing/ROADMAP.md) owners. Add element task destinations
and checkpoint consumers when needed. Worker suspension, timer strings, and
idle periods await their actual script/global/rendering consumers. Implement
only the [microsyntaxes](browlet/html/microsyntaxes/ROADMAP.md) needed by reflection.

**2: complete the normative DOM mutation spine.**
[Infrastructure](browlet/dom/infra/ROADMAP.md), [nodes](browlet/dom/nodes/ROADMAP.md),
[ranges](browlet/dom/ranges/ROADMAP.md), and [traversal](browlet/dom/traversal/ROADMAP.md)
must share validity checks, adoption, insert/move/replace/remove/clone, attributes,
and CharacterData. Include live Range adjustment and NodeIterator pre-removal.
TreeWalker has an existing Selectlet consumer. Replace snapshot/Array shortcuts
with proper live/static collections and expose selector APIs through one
Selectlet adapter. Tests must reject invalid mutations without partial changes.

**3: join mutation, reactions, and parsing in one vertical slice.**
The [DOM](browlet/dom/ROADMAP.md) and [custom-element](browlet/html/custom-elements/ROADMAP.md)
owners supply MutationObserver delivery, reaction stacks/`[CEReactions]`, and
slot assignment/signaling at the same checkpoint. The [parse5 adapter](browlet/html/parser/ROADMAP.md)
must use that mutation path, including foster-parented text, templates, intended
parents/scoped registries, scripting mode, and foreign content. Then add
DOMTokenList/classList and [reflection](browlet/html/reflection/ROADMAP.md) for the
initial html/head/title/base/meta/body/style/template/slot shell.

These passes also retire relevant boundary debt: `asDocument` and ambient
factory intersections, post-conversion values widened back to platform types,
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

**8: add coherent author API families.** Follow [elements](browlet/html/elements/ROADMAP.md),
[collections](browlet/html/collections/ROADMAP.md),
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
[SVG](browlet/svg/ROADMAP.md), and [MathML](browlet/mathml/ROADMAP.md) own syntax,
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
