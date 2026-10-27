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
  Platform projection remains [style integration](browlet/style/ROADMAP.md) work.
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

The DOM mutation, range, traversal, collection, shadow/slot and Trusted Types
passes are recorded in their [owning roadmaps](browlet/dom/ROADMAP.md). The
[HTML audit](browlet/html/ROADMAP.md) has reached §3.2.6.5, the style attribute,
with referenced missing dependencies explicit. The next global attribute is
§3.2.6.6, data-*. Style/loading work is paused while the
[HTML §8 audit](browlet/scripting/ROADMAP.md#html-811812-audit) proceeds in order.
§§8.1.1–8.1.3.3 are reviewed. The
[§8.1.3.3 experiment](browlet/scripting/ROADMAP.md#html-8133-explicit-context-experiment)
now models execution contexts and global state in JavaScript. The next slice
audited §8.1.3.5 secure contexts and §8.1.4.1 script definitions, preserving the
agreed secure-context clash and adding modeled active-script lookup.
[§8.1.4.2's fetch algorithms](browlet/scripting/ROADMAP.md#html-8142-fetching-scripts)
now supplies fetch options, classic-script/classic-worker fetchers, and single-module
fetching with shared module-map callbacks, plus document/worker/worklet graph
orchestration and shared worklet responses. §8.1.4.3 now creates compiled classic
scripts and CSS/JSON/text synthetic export inputs. JavaScript/Wasm module parsing,
module-record loading/linking, CSS export projection, and creation timing retain
explicit unfinished boundaries. Worker-imported scripts
still need synchronous pause. §8.1.3.4 enabling/disabling scripting awaits its
own audit. Script calling and later host-hook algorithms must be connected
before judging the complete model; the uncertain cross-realm observer test is skipped.
The [environment audit](browlet/scripting/ROADMAP.md#html-81318132-audit) maps
every covered item to code or an explicit implementation dependency. Preserve
specified state and explicit unfinished dependencies, with approved expected
failures for observable gaps.
New addon/V8 work remains parked on `research/html-agent-execution` until real
consumers justify returning to it.

The [Stylelet roadmap](stylelet/ROADMAP.md) maps missing contracts and dependencies;
its [README](stylelet/README.md) records existing implementations. Keep detailed
algorithm inventories in those owners rather than expanding this guide.

Fetch's remaining features and owner integrations stay in its roadmap; do not
reopen completed protocol work as a prerequisite for consumers. The
[WPT roadmap](../wpt/ROADMAP.md) accompanies delivery: broaden public-path tests
as each owner becomes ready, with server integration tied to real loading.

## Stylelet delivery order

This is the default route within the broader browser milestones below.
Independent value/interface work can proceed beside it. Each step proves the
connected path for a bounded supported profile; it need not finish every
property or referenced specification first.

1. **Declaration ownership and Platform projection.** Start with
   [CSSStyleDeclaration/CSSStyleProperties and ElementCSSInlineStyle](stylelet/cssom/ROADMAP.md#next-review-order).
   Settle retained state, mutation and typed results together. Preserve raw
   attributes, accepted declarations, CSP rejection and the CSSOM-write bypass.
   Prove same-object style access and realm-correct binding behavior. Existing
   storage classes and tests of those internals are not architectural constraints.
2. **Rules, sheets and participation.** Follow declarations into CSSStyleRule,
   then sheet/list identity, adoption, replacement and mutation. Connect nested
   rules and selected group rules to interpretation and cascade; retain namespace,
   URL and tree-scope context. Follow the [rule](stylelet/cssom/rules/ROADMAP.md) and
   [selector](stylelet/selector/ROADMAP.md) gates. Add external sheet loading through
   the existing loader when that consumer is reached, not through another fetcher.
3. **Complete the value path for supported properties.** Finish cascade ordering,
   defaulting, inheritance, CSS-wide keywords and custom-property substitution.
   Connect @property/CSS.registerProperty to registration and invalidation.
   Follow [engine](stylelet/engine/ROADMAP.md), [lifecycle](stylelet/value-processing/ROADMAP.md),
   and [value](stylelet/values/ROADMAP.md) ownership. Serialization exposes the
   resulting stage; it does not repair missing computation.
   Follow the bounded Variables/substitution slices with the full
   [Cascade review](stylelet/engine/ROADMAP.md#defaulting-and-per-element-values).
4. **Live queries and typed views.** Complete getComputedStyle's identity,
   eligibility, enumeration, freshness and property-specific resolved values.
   Keep Typed OM computed values distinct. Declared typed maps can follow step 1;
   retained computed maps need step 3 and invalidation. Context-free typed values
   and [geometry](geometry/ROADMAP.md) can proceed separately. See
   [Typed OM](stylelet/cssom/typed/ROADMAP.md).
5. **Deliver facts for actual consumers.** Pull in property families, device/media
   matching, resource loading and fonts as the supported profile needs them.
   [Value inputs](stylelet/values/ROADMAP.md#context-inputs-and-freshness) identify
   each owner and freshness condition. matchMedia needs matching/device state; font readiness and box-based
   queries need their rendering contracts. Do not gate every CSSOM operation on
   complete layout, or return invented facts to hide an unfinished dependency.
6. **Effects and rendering-dependent APIs.** Add [animation](animation/ROADMAP.md)
   timing/composition and CSS animation/transition producers through the existing HTML update sequence.
   Scroll timelines, resize observations, pseudo/highlight output and view
   transitions require their particular box/scroll/capture consumers. Concrete
   worklets follow module/global lifetime support and an actual rendering consumer.
   Their names in the scheduler are integration points, not implementations.

When Stylelet work resumes, continue from step 1. The
[CSSOM review order](stylelet/cssom/ROADMAP.md#next-review-order) bounds this detour;
[subsystem roadmaps](stylelet/ROADMAP.md#source-organization) keep later dependencies
visible. Geometry, fonts, graphics, animation, and layout have roadmap-only
homes; concrete APIs and backend choices remain open. Stylelet stays host-neutral,
and Browlet composes document lifecycle, policy, scheduling, and Platform bindings.

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
UA rules and presentational hints; [layout](layout/ROADMAP.md) consumes internal
Stylelet values and content for boxes, formatting, and fragments, using
[fonts](fonts/ROADMAP.md) and [graphics](graphics/ROADMAP.md) for resource facts.
[Rendering integration](browlet/rendering/ROADMAP.md) joins document updates and
output to the existing event loop; [performance](browlet/performance/ROADMAP.md)
consumes actual milestones. DOM presence or `display` alone is not proof that
an element is rendered.

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
