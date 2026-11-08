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
scripts and real source-text/CSS/JSON/text engine modules. Supplied graphs link
and evaluate, with CSS exports projected through Binding. §8.1.6.7.3 now connects
static and dynamic graph loading to the resolver and fetchers. Wasm ESM parsing
and source-phase URL imports now use the addon's retained records. Deferred loading,
object-valued source imports, module-specific context restoration, and creation timing
retain explicit unfinished boundaries. Worker-imported scripts
still need a synchronous Fetch host wait; the event loop's pause guard alone
cannot supply it. §8.1.3.4 now has settings/object scripting predicates;
§8.1.4.4 has classic/module runners and the running-script lookup. Child Document
activity follows retained container ancestry, and ancestor changes notify child
Documents and wake their queued tasks. Automatic child lifecycle remains unfinished.
Retained classic and linked module evaluation are connected; termination, timing, and production
script callers remain explicit dependencies. §8.1.4.5 now records the Agent's
unfinished abort operation, live-disable integration, and optional resource/UI
policies. Forced interruption is explicitly deferred for the shared Node thread;
do not pursue addon termination work or a worker migration for this audit.
§8.1.4.6 now supplies ErrorEvent, reportError, cancellation, recursion handling,
and classic-script muting. Source diagnostics, complete script attribution,
dedicated-worker propagation, and special onerror handlers remain explicit
dependencies. §8.1.4.7 now supplies PromiseRejectionEvent and the HTML rejection
tracker/notification algorithms, with native reject/handle notifications,
non-observing slot queries, and checkpoint delivery connected on all addon bases.
Stock Node retains explicit expected failures for that engine boundary. §8.1.4.8 now
supplies import-map parse results and Window registration. §8.1.4.9 now supplies
speculation-rule parse-result creation, Document registration state, and Window
registration/removal/replacement with synchronous or queued parse-error reporting.
The §7.6 rule model/parser and speculative-load processing remain unfinished,
as do script-element callers. [§8.1.5](browlet/scripting/ROADMAP.md#html-815-module-specifier-resolution)
now supplies module specifier resolution and import-map parsing, normalization,
and merging. The approved merge conflicts follow Chromium/WebKit, with Firefox's
differences recorded. Script-element callers and console warning output remain
explicit dependencies. The §8.1.6 host-hook audit has connected static and dynamic
evaluation-phase `HostLoadImportedModule`. The available §8.1.7 scheduling
operations are implemented; its [remaining dependencies](browlet/scripting/ROADMAP.md#outstanding-event-loop-work)
retain their owner and engine boundaries. §8.1.8.1's existing IDL event handlers
check target automation policy and callback Document activity. Window's
`onerror` supplies its five arguments and return-true cancellation; beforeunload
now converts nullable strings and preserves an existing returnValue. Navigation
produces beforeunload events and coordinates unload cancellation; native prompt UI
and the remaining document-unloading steps retain explicit dependencies. The
§8.1.8.2 declarations and Window/body/frameset targeting are connected through
the shared [event-handler machinery](browlet/scripting/ROADMAP.md#html-8181-event-handler-idl-invocation).
Window and HTML element content attributes now use CSP checks, raw storage, and
lazy realm-owned FunctionBody compilation with projected Document/form/element
scopes. Form-owner discovery (§4.10.18.3) and precise source-location reporting
remain explicit dependencies. The [UI Events foundation](browlet/interaction/events/ROADMAP.md)
now exposes UIEvent, FocusEvent, the base InputEvent, KeyboardEvent, CompositionEvent,
and legacy TextEvent, including initialization, related-target dispatch, input
payload conversion, and modifier snapshots. The event-type audits
retain their HTML producer dependencies and the separate Input Events extension.
UI Events §4's keyboard mapping/cancellation audit retains explicit producer dependencies.
Section 5 supplies internal movement initialization and Window-owned mousemove deltas;
native input and Pointer Lock APIs remain unfinished. The main
UI Events audit now covers §§1–12, with producer dependencies and ordering
conflicts retained. Pointer Events §§1–2 are reviewed, and §3's MouseEvent
prerequisite now exposes construction, modifiers, related targets, movement,
and legacy initialization/factory names. Layer coordinates remain explicit
CSS layout/painting dependencies. PointerEvent construction now supplies pointer
data, orientation conversion, and copied coalesced/predicted lists. §§3.1.1–3.1.2
now provide UserAgent-owned active sources, button transitions, and primary-pointer
selection. §3.1.3.1's internal attribute initialization now supplies the event table's
flags, detail, and related-target rules. §3.1.3.2 now supplies pending capture
transitions and copied notifications as an internal per-stream primitive.
§3.1.3 target preparation now connects that processing to capture-or-hit-test
selection, active-document tracking, and implicit direct-manipulation capture
through `PointerEventStream`. Capture requests require the Pointer Lock owner's
query and validate connectivity, buttons, and active Document. Its dispatch step
now orders boundary notifications, delivers the prepared event, and repairs the
previous target using DOM's actual dispatch path. §3.1.3.3 suppression now copies
the retained input into cancellation, releases capture, and exits. §8.5 releases
capture after up, then uses the producer's explicit hover-target query to restore
boundaries. §3.1.4 now has an explicit stationary-pointer layout refresh, retaining
capture and removal rules without generating a move. §3.1.5's orientation
conversion is already implemented. §§3.2.1–3.2.2 now initialize/create pointer events
from a required normalized input snapshot through the target's event allocation.
§3.2.3 now creates pointer events from targeted mouse events with explicit flags,
fresh realm allocation, and independent pointer/dispatch state. §§3.3.1–3.3.3's
entry/down triggers, propagation, and cancellation are audited against the
existing source/dispatch machinery. §§3.3.4–3.3.11 now include raw-update security
gating and zero pressure on native up events; raw/move scheduling and §9 sample
production remain explicit input-owner dependencies. §3.3.12 now supplies
click/auxclick/contextmenu creation, pointer defaults, and live/captured target
selection from private down/up snapshots. Gesture recognition, click counting,
and non-pointer input remain producer responsibilities. §4's Element capture
methods now resolve context-local IDs through the top-level traversable's stream
map and expose pending capture through ordinary Binding. §5's GlobalEventHandlers
contribution now connects all eleven pointer handlers, including secure-context
raw-update property exposure and ordinary content-attribute handling. §§6–10 now
provide Navigator capacity selection, touch-action parsing and manipulation
permissions, removal-aware capture release, trusted sample preparation, and
compatibility mouse delivery, within their recorded input/layout dependencies.
§11.1 through §11.4 now include normalized creation and a UserAgent-owned
mouse-button processor. It queues user-interaction tasks, registers mouse ID 1,
and drives pointer/capture/compatibility delivery plus adapter-qualified click/auxclick
and primary double-clicks in the release task. Chorded clicks retain each button's
press/release pair. Movement supplies secure raw/pointer/mouse delivery with shared
receipt-time input; context menus honor adapter timing and cancellation. The order
and event-type audit also prevents activation on a disconnected release target.
Layout, locked input delivery, HTML activation/focus, and native menu UI remain
explicit callable dependencies. §12 now supplies WheelEvent construction and Document-owned
wheel transactions, queued delivery, and listener-based cancelability. Hit testing
and scrolling/zooming remain explicit callable dependencies; native
normalization, gesture timing, and cross-Document routing remain adapter work.
The closing examples/security/glossary/legacy audit is complete. DOM removal now
connects previous-pointer-target repair through the existing capture-cleanup scan.
Individual Document.destroy() now clears its retained pointer state while
preserving surviving Documents and physical device state. This closes the
identified local pointer/wheel plumbing. Recursive/inactive destruction remains
HTML §7.5.10 work; other-device ID assignment/retirement and input/default-action
producers retain their explicit dependencies.
The adjacent [Pointer Lock pass](browlet/interaction/pointer-lock/ROADMAP.md) supplies
§§2–5's state/API and mouse/wheel lock queries. Native effects and HTML focus/
activation remain explicit throwing dependencies. §§6–7 connect locked relative
input and fixed mouse/wheel coordinates. §8 now handles disconnection, queued-request
validity, and adoption-safe notifications; native unlock/focus-loss signals and
HTML teardown remain explicit dependencies. The closing §§9–12 audit adds no
further runtime algorithms; the native feature remains incomplete. The adjacent
[Selection API slice](browlet/interaction/selection/ROADMAP.md) implements shared
Document/Window state, live Range attachment, composed snapshots, collapse methods,
and Document selectionchange tasks. §3 now adds extend and composed endpoint state
for cross-root setBaseAndExtent, including live mutation, move ordering, and explicit
replacement/detachment. The former cross-root expected failure now passes normally.
selectAllChildren, deleteFromDocument, and DOM-based containsNode are implemented.
modify exposes validation and empty-selection handling; stringification exposes
empty/caret results. Their called editing/layout and rendered-text dependencies
remain unfinished, with four approved expected failures. §4.3 now supplies
onselectstart/onselectionchange through the existing handler maps. §§6–6.1 now
provide selectFromUser with fresh Range ownership, selectstart cancellation, and
post-listener lifetime checks. §§6.2.1–6.2.2 now share per-target scheduling and
firing across Document, input, and textarea. The local specification pass is
complete; native endpoint selection, control state, and HTML document reset remain
explicit owners. The [keyboard coordinator](browlet/interaction/keyboard/ROADMAP.md#queued-keyboard-delivery-2026-11-05)
now supplies key selection/NFC, key/code vocabularies, modifier snapshots, and
queued trusted keydown/keyup. Native layout/classification, HTML focus/activation,
editing/default actions, and IME effects remain explicit dependencies.
The [Clipboard opening review](browlet/interaction/clipboard/ROADMAP.md) covers
§§1–4. The approved HTML §§6.11.2–6.11.3 [DataTransfer data slice](browlet/interaction/drag-drop/ROADMAP.md)
now supplies string/File operations, bindings, and lifetime checks. Drag-image
rendering remains an explicit throwing dependency; native dragging is separate.
Clipboard §5.1 now exposes ClipboardEvent and reuses existing handlers and DOM
dispatch. §5.2.1 now supplies ClipboardChangeEvent data, queued notifications,
focus replay and storage-key change IDs. Native clipboard state, persistent read
consent and HTML system focus remain explicit throwing dependencies.
§§5.2.2–5.2.4 now have trusted event delivery and temporary DataTransfer lifetime;
rendered/editable target selection and native paste preparation still throw.
§5.3, §§6.1–6.3 and §§8.1–8.3 now have action admission and cancellation/default
flow, write/clear decisions and queued change notifications. Native writing,
rendered selection, editing and script-paste permission remain explicit throwing
dependencies; keyboard/menu/execCommand callers still need their owners. §§6.4–6.5
format requirements are recorded at those effects; §6.6 informs later async read
options. §7.2 now supplies author-created ClipboardItem data, promised Blob access,
MIME validation and format recognition. Appendix A.3/A.4 standard MIME/OS
translation and A.7/A.8 custom-format names are implemented as pure helpers.
A.5 map decoding and A.6 validated JSON/payload preparation are implemented.
A.2 writeItems consumes those helpers, preserving each item’s standard/custom
data and style before one writeFormats call. Platform selection and additional
standard-format mapping remain explicit host dependencies.
Metadata mapping retains the selected OS format for each MIME key; OS enumeration,
registration, byte access and collective writing remain explicit dependencies.
Items read from the system clipboard now retain metadata,
generation and original-Document state, sharing cached getType reads and delivering
item-realm results. OS format discovery, byte access and rich read
preparation remain separate throwing SystemClipboard dependencies. §§7.1/7.3.1–7.3.2 now expose the
Navigator-owned Clipboard and asynchronous read/readText admission and task flow,
with §9.1's strict Paste-interaction permission rule. readText selects the first
standard plain-text format through the shared snapshot/byte ports, skips custom
map access, and reuses Blob UTF-8 decoding. Generation and original-Document
checks continue through its final task, including absent text. Focus, activation,
native provenance, OS format/byte access and generation queries remain explicit
dependencies. §§7.3.3/9.2 now
provide asynchronous write admission through Permissions, promised representation
joining, format validation and collective commit flow. Native Cut/Copy provenance,
item-model support, rich-format preparation and OS item writing remain explicit
throwing dependencies. §7.3.4 writeText now shares write admission and native
commit, with UTF-8 text and Windows newline preparation. The §§10–11/Appendix A
audit maps each algorithm to local behavior or a named throwing dependency,
including paste-origin restrictions, image preservation and native size/count
limits. Local lazy reads and Appendix A format processing are complete within
these boundaries; actual Clipboard support still requires its adapter, rich-format
processing and the HTML owners above.
Next native integration must choose its concrete OS clipboard/format contract
before replacing those throwing dependencies.
CSSOM View remains deferred.
HTML §8.1.8.3's synthetic pointer/click firing is connected on Element, using
UserAgent keyboard modifiers and DOM dispatch. HTMLElement.click() and keyboard
activation still need HTML §6.5's caller policies; input producers retain their
HTML, editing, and layout owners. Input Events Level 2 and trusted composition
preparation are complete within their recorded scope; editing and IME sessions
remain explicit dependencies. Vin's audit has returned to HTML §§8.2–8.3 with the
[global origin getter](browlet/scripting/ROADMAP.md#html-82-global-settings-origin)
and [Base64 utility methods](browlet/scripting/ROADMAP.md#html-83-base64-utility-methods).
Eric deferred §§8.4–8.6 (dynamic markup insertion, DOM parsing/serialization,
and the timer audit) to Ged. §8.7's
[microtask-queuing audit](browlet/scripting/ROADMAP.md#html-87-microtask-queuing)
uses the existing callback/checkpoint machinery and preserves the Window Document
on queued microtasks. It needs no unfinished work from those deferred sections.
The [user-prompts slice](browlet/scripting/ROADMAP.md#html-user-prompts-simple-dialogs)
(§8.8 at that checkpoint, now §8.9) supplies alert(), confirm(), and prompt(),
including conversion, dialog admission, text preparation, automation routing,
and the existing host-pause boundary. Actual display and response UI remain
explicit throwing dependencies. [Printing](browlet/scripting/ROADMAP.md#html-user-prompts-printing)
now supplies Window.print(), deferred Document tasks, and synchronous frame-tree
notifications. Print-state capture, print media/layout, preview/PDF, and printer UI
remain explicit dependencies; the full parser task ordering stays with Ged.
The [Navigator audit](browlet/navigator/ROADMAP.md#closing-custom-handler-audit)
has reached §8.10.1.4: shared Window/worker identification, language preferences,
online state, and the local custom-handler algorithms are implemented. Handler
consent/UI, durable storage, selection/navigation, and WebDriver sessions/transport
remain explicit dependencies; worker service transport remains with its owner.
§8.10.1.5's [NavigatorCookies.cookieEnabled](browlet/navigator/ROADMAP.md#cookies)
now reads the existing shared cookie policy. §8.10.1.6's
[PDF compatibility objects](browlet/navigator/ROADMAP.md#pdf-compatibility) now
reuse navigation's support flag, defaulting to no viewer. Actual PDF rendering,
external handoff, live viewer-preference updates, and the deferred CSSOM View work
remain separate. §8.11.1's [ImageData](graphics/ROADMAP.md#imagedata) now supplies
both pixel formats, all current color-space labels, constructor validation, and
cloning with preserved buffer aliases. Window and worker exposure use existing
bindings. §8.11.2's [ImageBitmap lifetime](graphics/ROADMAP.md#imagebitmap-lifetime)
now supplies owned pixels, dimensions, close, origin-clean checks, cloning, and
transfer. Next is in-memory source preparation/formatting for createImageBitmap;
the author factory, decoding, color conversion, and canvas consumers remain
explicit dependencies.
Source/deferred imports and the HTML Wasm parser remain explicit boundaries.
Later host-hook algorithms must be connected before judging
the complete model; the uncertain cross-realm observer test is skipped.
The [environment audit](browlet/scripting/ROADMAP.md#html-81318132-audit) maps
every covered item to code or an explicit implementation dependency. Preserve
specified state and explicit unfinished dependencies, with approved expected
failures for observable gaps.
Vin's HTML audit keeps runtime dependencies explicit. Pip is investigating
Node/addon/V8 facilities separately; production adoption remains a coordinated
step, distinct from the older `research/html-agent-execution` work.

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
visible. Geometry, fonts, animation, and layout have roadmap-only
homes. Graphics now supplies ImageData; its decoding/rendering backend remains
open. Stylelet stays host-neutral,
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
[timing](timing/README.md), [performance](browlet/performance/ROADMAP.md),
[abort](browlet/dom/abort/ROADMAP.md), and
[browsing](browlet/browsing/ROADMAP.md) owners. Element task destinations retain
their creation global; add checkpoint consumers at their owning algorithms.
Worker suspension and timer strings retain their script/global dependencies.
HTML's idle-period steps supply Request Idle Callback delivery, cancellation,
deadlines, and timeouts. Rendering predictions remain an explicit owner dependency.
Follow the bounded
[microsyntax slices](browlet/html/microsyntaxes/ROADMAP.md); reflection
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
