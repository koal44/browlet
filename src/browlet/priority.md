# Browlet implementation priority

This file orders the work described by Browlet's roadmaps. It is an execution
plan, not a compatibility promise and not a second copy of each specification
inventory. The narrower roadmaps remain authoritative for exact contracts,
tests, ownership, and removal conditions.

A broad roadmap can appear in several priorities. That is deliberate: for
example, the scripting roadmap contains the early task kernel, the later script
loader, and still-later workers and rendering opportunities. Finishing an
entire roadmap before touching its consumers would recreate the dependency
problem this file is intended to solve.

## How to use this order

- Use the priority numbers as the default focus order. The dependency table
  below names the deliberate overlap points; do not wait on an unrelated
  earlier priority when its prerequisite is already complete.
- End each priority with its observable exit proof. “The types exist” or “the
  algorithm has a helper” is not an exit proof.
- Implement only the portion of a roadmap named by the priority. Do not pull a
  later API forward merely because it shares a directory.
- Where standards form a cycle, implement one vertical slice through the cycle
  and test its public behavior. Do not invent a general manager to make the
  graph appear linear.
- Keep expected host limitations explicit. In particular, do not deform the
  WindowProxy, `[[IsHTMLDDA]]`, buffer-detachment, or realm contracts around a
  current Node/V8 limitation.

The top-level [Browlet roadmap](roadmap.md) and
[HTML ownership map](html/roadmap.md) route cross-cutting work to narrower
domains. They are completeness indexes, not independently finishable gates.

## Critical path

| Gate | Required foundation | First major consumer unlocked |
| --- | --- | --- |
| Stable host boundary | Stylelet-owned declarations and Browlet-owned binding adapters | Every future CSSOM contribution can serve Browlet and jsdom without duplication |
| Deterministic host | One clock, authoritative Document activity, cancellation, task records, and a test driver | Timers, callbacks, Fetch completion, loading, and navigation can share one lifecycle |
| Normative DOM | One mutation path with live Range and NodeIterator adjustment | Parsing, custom elements, observers, collections, selectors, and style see the same tree |
| Reaction checkpoint | MutationObserver, custom-element, and slot delivery on the owning agent's microtask checkpoint | Parser-created and script-created trees have the same observable reactions |
| Response-bearing execution | Fetch records/transport, loader, parser bytes, and classic scripts | A URL can produce an executable Document rather than a synchronous source-string fixture |
| Browsing topology | Child navigables, cross-origin Window/Location rules, messaging, and history | `iframe`, traversal, auxiliary contexts, workers, and automation have a real browser graph |
| Rendered document | UA style input, boxes, layout, rendering opportunities, and output | Browlet can advance from DOM host to deterministic headless browser |

The deterministic-host and normative-DOM gates are neighboring roots. Their
internal work can proceed independently, but they meet at the reaction
checkpoint and must not grow competing scheduling or mutation models.

## Dependency edges

| Priority | Actual prerequisite | Permitted overlap |
| --- | --- | --- |
| 0 | Current package boundary | Architectural closure, not a platform prerequisite |
| 1 | Existing realm, Window, URL, Web IDL, and EventTarget foundation | May run beside Priority 2 |
| 2 | Existing projected DOM | May run beside Priority 1 |
| 3 | Priorities 1 and 2 | None: this is where their scheduler and mutation models join |
| 4 | Priority 1 | May run beside Priorities 2 and 3; its placement expresses focus, not a DOM dependency |
| 5 | Priorities 1, 3, and 4 | Integrates their completed lifecycle paths |
| 6 | Priority 5 and the Priority 0 Stylelet boundary | May run beside Priority 7 |
| 7 | Priorities 4 and 5 | Does not require rendering; may run beside Priority 6 |
| 8 | Priorities 2 and 3, plus whichever of 5–7 makes a family observable | Implement family by family |
| 9 | Priorities 4 and 7 | Storage-only internals can precede public multi-global delivery |
| 10 | Priority 2; Priority 5 only for navigation integration | Character-input XML and XPath need not wait for rendering |
| 11 | The concrete consumer named by each item | No common completion gate |

## Priority 0 — close the current package boundary

Primary roadmap: [style integration](style/roadmap.md).

1. Move host-neutral CSSOM Web IDL declarations and mixin contributions into
   Stylelet.
2. Keep semantic Stylelet implementation state host-neutral. Browlet binds the
   declarations to Browlet-specific platform objects; jsdom can consume the
   same declaration contract through its own wrapper strategy.
3. Leave HTML `<style>`/`<link>` processing and stylesheet fetching with
   Browlet and its loader.

Exit proof: existing Browlet style behavior is unchanged, Browlet's style
integration is an adapter rather than the declaration owner, and the exported
Stylelet contribution does not import Browlet.

This closes the architectural work which prompted the Domlet/Browlet merge. It
should precede adding more CSSOM declarations, otherwise the migration surface
will immediately start growing again.

## Priority 1 — deterministic low-dependency foundations

Primary roadmaps: [performance](performance/roadmap.md),
[abort](dom/abort/roadmap.md), [browsing](browsing/roadmap.md),
[interaction](interaction/roadmap.md), [scripting](scripting/roadmap.md), and
[HTML microsyntaxes](html/microsyntaxes/roadmap.md).

1. Implement the shared monotonic clock, coarsening, time origins, and initial
   `Performance` surface (High Resolution Time §§2–8). Route Event timestamps,
   realm timing, and existing navigation timing fields through it.
2. Implement the synchronous `AbortController`/`AbortSignal` core and replace
   EventTarget's native-`AbortSignal` shortcut (DOM §3). Defer only
   `AbortSignal.timeout()` and generic `onabort` handler compilation.
3. Make active/current session-history entry relationships and the derived
   active/fully-active Document predicates authoritative (HTML §§7.3–7.5).
   Connect initial Document visibility without adding a second activity flag.
4. Replace the microtask-delegation skeleton with task records, task sources,
   Document activity gating, named global/element task destinations, and a
   deterministic test driver (HTML §8.1.7). Node supplies wake-ups, not HTML
   ordering.
5. Add the ordered timer map, nesting/clamping, active-time timeout steps, and
   timer-task source on that loop (HTML §8.7). Use it to complete
   `AbortSignal.timeout()` with relevant-global retention; do not delegate its
   lifecycle to a bare Node `setTimeout()`.
6. As an independent bounded lane, implement only the boolean, enumerated,
   numeric, and token microsyntaxes needed by the early Document shell and
   reflection work (HTML §2.3). Dates, legacy colors, and unused syntaxes wait
   for their first elements.

Exit proof: every existing timestamp uses one clock; abort removes a listener
with the specified ordering; a navigation-owned relationship gives the only
fully-active answer; and tests can deterministically enqueue, gate, run, and
checkpoint tasks and active-time timers without wall-clock races.

## Priority 2 — establish the normative DOM

Primary roadmaps: [DOM infrastructure](dom/infra/roadmap.md),
[nodes](dom/nodes/roadmap.md), [ranges](dom/ranges/roadmap.md), and
[traversal](dom/traversal/roadmap.md).

1. Rewrite behavior-first coverage around public Browlet objects. Remove tests
   which preserve invalid conveniences, such as a Text child directly under a
   Document, or which assert raw tree mechanics.
2. Add the DOM §4.2.3 mutation spine: pre-insert validity, adoption, insert,
   move, replace, replace-all, remove, cloning, node-document changes, and the
   specified insertion/removal/children-changed extension points.
3. Route attributes and CharacterData through their normative mutation paths.
   Script and parser callers may not mutate a second raw tree or attribute
   model.
4. Implement boundary points, `AbstractRange`/`StaticRange`, live Range
   registration, and every insert/remove/move/text adjustment required during
   mutation (DOM §5). Full Range convenience operations can follow after the
   shared clone and CharacterData algorithms are stable.
5. Reserve and exercise the NodeIterator pre-remove participant, then complete
   `NodeFilter`, `TreeWalker`, and `NodeIterator` (DOM §6). TreeWalker is the
   first public slice because Selectlet already has a TreeWalker-capable path.
6. Replace Array/snapshot collection mechanics with projected, identity-stable
   live/static `NodeList` and `HTMLCollection` objects (DOM §4.2.10).
7. Expose `querySelector()`, `querySelectorAll()`, `matches()`, `closest()`, and
   their mixin callers over one Selectlet scope-match adapter (DOM §§1.3 and
   4.2). Do not add another selector parser.

Exit proof: invalid mutations fail atomically; DocumentFragment insertion,
adoption, removal, text replacement, and parser-originated mutation share one
path; live ranges, iterators, and collections update correctly; and selectors
work through the public projected DOM.

## Priority 3 — join DOM mutation to HTML reactions and parsing

Primary roadmaps: [scripting](scripting/roadmap.md),
[nodes](dom/nodes/roadmap.md), [custom elements](html/custom-elements/roadmap.md),
[HTML parser](html/parser/roadmap.md), [reflection](html/reflection/roadmap.md),
[HTML elements](html/elements/roadmap.md), and the top-level
[DOM roadmap](dom/roadmap.md).

This is the platform's first intentional cycle and should be implemented as
one vertical slice.

1. Put pending mutation observers, slot signals, and the queued-microtask flag
   on `WindowAgent`; implement record creation, transient observers, and
   MutationObserver delivery (DOM §§4.2.2 and 4.3).
2. Implement custom-element reaction stacks/queues and Web IDL
   `[CEReactions]`, followed by names, definitions, upgrade, and construction
   sufficient to observe attribute/insertion/removal/adoption behavior (HTML
   §4.13). `ElementInternals` and form-associated breadth can wait.
3. Implement DOM slot assignment/signaling and the first `HTMLSlotElement`.
   Deliver `slotchange` through the same microtask checkpoint.
4. Close the parse5 adapter's foster-parented text, template contents,
   intended-parent/scoped-registry, scripting-mode, and foreign-content seams.
   Parser writes must enter the Priority 2 mutation spine (HTML §13).
5. Implement `DOMTokenList` after attribute mutation and `[CEReactions]`, then
   expose `classList` and the first supported-token HTML attributes (DOM §7).
6. Add the reflection forms required by the initial `html`, `head`, `title`,
   `base`, `meta`, `body`, `style`, `template`, and `slot` elements (HTML
   §§2.6, 3, and 4). Reuse Priority 1 microsyntaxes.
Exit proof: the same public mutation initiated by script and by parsing has
the same tree result and ordered Range, NodeIterator, MutationObserver,
custom-element, slot, and style consequences; one deterministic microtask
checkpoint delivers everything.

## Priority 4 — portable data and Fetch foundations

Primary roadmaps: [Fetch](../fetch/roadmap.md) and
[structured data](scripting/structured-data/roadmap.md).

These two projects are independent internally and can be developed in either
order. Their public completion must use the Priority 1 task and realm model.

1. Implement Fetch header, body, request, response, controller, and filtered
   response records plus author-facing `Headers`, `Request`, and `Response`
   without network I/O (Fetch §§2 and 5).
2. Implement structured serialization/deserialization, cycles, storage mode,
   platform-object registration, target-realm reconstruction, and
   `structuredClone()` (HTML §2.7). Retain explicit buffer-detachment
   limitations rather than pretending native cloning closes every contract.
3. Establish explicit Streams, Encoding, MIME, abort, and task-destination
   boundaries as their first algorithms require them; do not hide those
   dependencies in `fetch.ts`.
4. Add `data:` and basic HTTP(S) fetching through an injected transport with
   cancellation and streaming. Use an Undici dispatcher-level adapter only
   after proving the supported Node floor; Browlet's public objects and Fetch
   policy remain project-owned.

Exit proof: realm-correct Request/Response/Headers and structuredClone objects
work without transport; a basic transport fetch returns a Browlet response
through an explicit destination task and can be canceled without leaking an
Undici/Node public object.

## Priority 5 — load and execute one complete Document

Primary roadmaps: [loader](loader/roadmap.md),
[navigation](browsing/navigation/roadmap.md),
[browsing policy](browsing/policy/roadmap.md),
[scripting](scripting/roadmap.md), [HTML parser](html/parser/roadmap.md),
[HTML elements](html/elements/roadmap.md), [style](style/roadmap.md), and
[performance](performance/roadmap.md).

1. Replace the synchronous source-string route with response-bearing Document
   loading, replayable bytes, cancellation, and MIME/resource selection (HTML
   §§7.4–7.5).
2. Carry origin, policy-container, referrer, OAC, CSP, COOP, and COEP state
   through responses/navigation as each boundary is reached. Begin with the
   policies required by the claimed navigation and subresource behavior; do
   not create a parallel header policy inside Fetch.
3. Add HTML encoding sniffing/restart, decoded streaming input, readiness
   transitions, stop/abort parsing, `DOMContentLoaded`, and load-event delay
   (HTML §§13.2–13.2.3).
4. Implement script records, host hooks, callback preparation/cleanup, runtime
   errors, generic event-handler attributes, and inline classic script
   execution. Then add parser-blocking and external classic scripts through
   the shared loader; add modules/import maps only after the classic path is
   stable (HTML §§8.1.4–8.1.6, 8.1.8, and 13.2.2).
5. Finish the Document shell and prove inline `<style>`, external `<link>`,
   `<script>`, and `<img>` in that order. They exercise render blocking,
   Stylelet, script blocking, ordinary subresource loading, events, and load
   completion without requiring nested browsing or media playback.
6. Record navigation/resource timing from the same clock and loader records;
   do not derive it later from events.

Exit proof: navigating to a basic HTTP(S) or `data:` page creates the response,
realm, Window, Document, parsed tree, inline/external style, inline/external
classic script, image request, readiness events, load completion, and timing
records through one cancelable lifecycle.

## Priority 6 — render the first single-context page

Primary roadmaps: [style integration](style/roadmap.md),
[rendering](rendering/roadmap.md), [performance](performance/roadmap.md), and
[graphics](graphics/roadmap.md).

1. Add the versioned HTML UA stylesheet and presentational-hint source without
   hiding either in element implementations (HTML §15).
2. Define the first truthful box-tree and “being rendered” boundary over
   Stylelet computed values. Do not infer it from DOM presence or `display`
   alone.
3. Implement the minimum deterministic block/inline layout, viewport, text,
   and basic image/replaced-content path needed by the initial Document shell.
4. Add rendering opportunities and `requestAnimationFrame()` to the existing
   event loop rather than creating a frame scheduler in rendering.
5. Build Performance Timeline and the navigation/resource/paint producers from
   the records already emitted by lifecycle, Fetch, and rendering.
6. Expose a deterministic headless output/screenshot boundary suitable for
   eventual automation without putting WebDriver transport inside Browlet.

Exit proof: the Priority 5 page has UA/author style, stable computed values, a
box tree, deterministic geometry/output, and correctly ordered animation-frame
and initial timing observations.

## Priority 7 — add browsing topology and cross-context behavior

Primary roadmaps: [browsing](browsing/roadmap.md),
[Window](browsing/window/roadmap.md),
[navigation](browsing/navigation/roadmap.md),
[policy](browsing/policy/roadmap.md), [communication](communication/roadmap.md),
[structured data](scripting/structured-data/roadmap.md),
[interaction](interaction/roadmap.md), and [HTML elements](html/elements/roadmap.md).

1. Implement `iframe` as the first child navigable, including creation,
   removal, `contentWindow` identity, `contentDocument`, `src`/`srcdoc`, child
   load propagation, sandbox/referrer/permissions inputs, and destruction.
2. Complete same-/cross-origin WindowProxy, Window, and Location exotic
   behavior and security checks. Preserve the current Node global-proxy
   expected failure as an engine limitation.
3. Extend visibility, focus chains, and user activation across nested
   navigables; use the same state for popup/navigation gating and future
   automation input.
4. Complete transferable structured data, then implement `MessageEvent`,
   same-agent MessageChannel/MessagePort, port transfer, and Window
   `postMessage()` with navigation-between-send-and-delivery tests (HTML §9).
5. Centralize fragment navigation, session-history mutation, traversal,
   reload, and the `History` API. Add anchor activation over that path.
6. Add auxiliary top-level traversables/opener relationships and session
   storage-shed cloning only after child navigation and ordinary traversal are
   stable. The Navigation API follows the shared history machinery rather than
   becoming a second commit path.

Exit proof: a parent and iframe can load, navigate, enforce same-/cross-origin
access, focus, post messages and transferred ports, be removed cleanly, and
participate in back/forward traversal without losing stable WindowProxy or
history identity.

## Priority 8 — complete the high-value author-facing surface

Primary roadmaps: [DOM parsing](dom/parsing/roadmap.md),
[sanitization](html/sanitization/roadmap.md),
[HTML collections](html/collections/roadmap.md),
[reflection](html/reflection/roadmap.md), [elements](html/elements/roadmap.md),
[interaction](interaction/roadmap.md), [Navigator](navigator/roadmap.md), and
[graphics](graphics/roadmap.md).

Implement these bounded families in order of the first real consumer, not in
alphabetical interface order:

1. Complete remaining Node/Document/Element/Range convenience methods,
   `DOMImplementation`, CharacterData/Text, shadow-tree, and collection
   surfaces over the existing mutation core.
2. Add HTML fragment parsing/serialization, `DOMParser`'s HTML path,
   `XMLSerializer` where applicable, and `innerHTML`/`outerHTML`/
   `insertAdjacentHTML()`. Then add safe and unsafe setters through the
   distinct Sanitizer contracts.
3. Complete reflection and microsyntax forms as forms and element-specific
   attributes consume them; add `HTMLAllCollection`, form/options collections,
   and `DOMStringList` without hiding the `[[IsHTMLDDA]]` limitation.
4. Implement tables, ordinary forms/validation/submission, details/dialog, and
   the semantic/text element families before media, canvas, or legacy widgets.
5. Add inertness, activation, focus, commands/popovers, editing/selection, and
   drag-and-drop only as their element/layout prerequisites become true.
6. Add the stable Navigator facade and low-dependency ID/language/hardware
   answers. Online, cookies, protocol handlers, and plugin compatibility wait
   for their real host capabilities.
7. Add `ImageData` and the image-decoding/`ImageBitmap` capability before
   canvas and media reuse them.

Exit proof is family-specific public behavior. This priority is not complete
merely because the full HTML element-name catalog has dedicated classes.

## Priority 9 — multi-global execution, channels, and storage

Primary roadmaps: [workers](workers/roadmap.md),
[worklets](worklets/roadmap.md), [communication](communication/roadmap.md),
[storage](storage/roadmap.md), [Navigator](navigator/roadmap.md),
[loader](loader/roadmap.md), and [scripting](scripting/roadmap.md).

1. Add worker settings, true worker agents/event loops, Fetch-backed script
   loading, WorkerGlobalScope, WorkerLocation, WorkerNavigator, and the
   dedicated-worker path over the existing MessagePort channel (HTML §10).
2. Implement owner-derived worker lifetime, close, terminate, queued-task
   discard, and Document-destruction behavior before relying on host-thread or
   wrapper garbage collection.
3. Add storage-key derivation and partition inputs, then the serialized
   shared-worker manager and shared-worker connections.
4. Implement BroadcastChannel over storage keys and destination tasks; add
   public local/session Storage, per-Document wrappers, traversable sheds,
   policy/quota errors, and storage-event delivery only when its synchronous
   state model is ready.
5. Add EventSource after Fetch streaming/cancellation and scheduler retry
   timing are complete.
6. Implement generic Worklet infrastructure only with a selected concrete
   consumer—most plausibly a Stylelet-owned worklet specification—and test
   multiple replaceable scopes and module replay. Do not build an unused base
   worklet first.

Exit proof: a dedicated worker has a distinct realm/agent/event loop, exchanges
transferred values and ports, and terminates with its owner; shared discovery
and storage-scoped communication then work without process-global registries.

## Priority 10 — XML and foreign document families

Primary roadmaps: [DOM parsing](dom/parsing/roadmap.md),
[SVG](svg/roadmap.md), [MathML](mathml/roadmap.md),
[XPath](dom/xpath/roadmap.md), and [XSLT](dom/xslt/roadmap.md).

1. Add `CDATASection` and `ProcessingInstruction`, then qualify the strict
   evented XML 1.0 engine and implement character-input XML parsing, namespace
   errors, fragments, and serialization. XML navigation follows through the
   loader only after the character-input path is conformant.
2. Complete parser foreign-content adjustments and the SVG/MathML base
   profiles needed by selectors, style, and the first rendered foreign
   content. Expand animated values, geometry, and specialized elements only as
   rendering requires them.
3. Qualify an XPath 1.0 engine against XPath, DOM Level 3 XPath, HTML's default
   namespace rule, browser tests, result typing, and mutation invalidation;
   then project the DOM §8 APIs.
4. Treat XSLT as optional. Qualify a portable engine and controlled loader
   before exposing `XSLTProcessor`; HTML DOM output must pass through Browlet's
   construction/mutation and `[CEReactions]` contracts. XML-navigation XSLT is
   a separate, later lifecycle claim.

Exit proof: claimed HTML/XML/SVG/MathML syntax produces namespace-correct
Browlet trees through the same mutation layer. XPath and XSLT are complete only
to the explicitly tested profile; their short, under-specified IDL is not the
proof.

## Priority 11 — compatibility and consumer-driven tails

Primary roadmaps: [legacy HTML](html/legacy/roadmap.md),
[microdata](html/microdata/roadmap.md), [remaining elements](html/elements/roadmap.md),
[rendering](rendering/roadmap.md), [graphics](graphics/roadmap.md),
[interaction](interaction/roadmap.md), [Navigator](navigator/roadmap.md),
[storage](storage/roadmap.md), and the top-level [Browlet roadmap](roadmap.md).

These areas do not belong on the critical path. Pull one forward only when a
concrete compatibility test, embedder capability, or chosen product milestone
consumes it:

- Microdata extraction and vocabulary serialization;
- retained HTML §16 interfaces, `document.all`, obsolete presentation, and
  specialized legacy elements;
- media playback, canvas, WebGL/WebGPU, codecs, capture, and device-backed
  graphics;
- complete form widgets, editing UI, find-in-page, native dialogs/printing,
  and accessibility exposure;
- persistent storage, IndexedDB/service workers/offline APIs, network/crypto/
  identity APIs, and optional device APIs;
- advanced layout, widgets, pagination, paint/element/long-task timing, and
  full SVG/MathML rendering; and
- WebDriver/WebDriver BiDi in a separate automation package once Browlet's
  lifecycle, script, network, input, and rendering surfaces are stable enough
  to drive.

Parse5 must continue accepting obsolete markup throughout earlier priorities;
late public compatibility does not justify rejecting legacy syntax now.

## Roadmap placement index

| First priority | Roadmaps activated there |
| --- | --- |
| 0 | [style](style/roadmap.md) declaration ownership |
| 1 | [performance](performance/roadmap.md), [abort](dom/abort/roadmap.md), [browsing](browsing/roadmap.md), [interaction](interaction/roadmap.md), [scripting](scripting/roadmap.md), [microsyntaxes](html/microsyntaxes/roadmap.md) |
| 2 | [DOM infrastructure](dom/infra/roadmap.md), [nodes](dom/nodes/roadmap.md), [ranges](dom/ranges/roadmap.md), [traversal](dom/traversal/roadmap.md) |
| 3 | [custom elements](html/custom-elements/roadmap.md), [HTML parser](html/parser/roadmap.md), [reflection](html/reflection/roadmap.md), [DOM top level](dom/roadmap.md), [events closure](dom/events/roadmap.md) |
| 4 | [Fetch](../fetch/roadmap.md), [structured data](scripting/structured-data/roadmap.md) |
| 5 | [loader](loader/roadmap.md), [navigation](browsing/navigation/roadmap.md), [policy](browsing/policy/roadmap.md), early [elements](html/elements/roadmap.md) |
| 6 | [rendering](rendering/roadmap.md), [graphics](graphics/roadmap.md) |
| 7 | [Window](browsing/window/roadmap.md), [communication](communication/roadmap.md) |
| 8 | [DOM parsing](dom/parsing/roadmap.md), [sanitization](html/sanitization/roadmap.md), [HTML collections](html/collections/roadmap.md), [Navigator](navigator/roadmap.md) |
| 9 | [workers](workers/roadmap.md), [storage](storage/roadmap.md), [worklets](worklets/roadmap.md) |
| 10 | [SVG](svg/roadmap.md), [MathML](mathml/roadmap.md), [XPath](dom/xpath/roadmap.md), [XSLT](dom/xslt/roadmap.md) |
| 11 | [microdata](html/microdata/roadmap.md), [legacy HTML](html/legacy/roadmap.md), and the remaining consumer-driven portions of the broader roadmaps |

## Removal condition

Burn this file when the critical path through a loaded, scriptable, nested,
rendered Document is complete and the remaining work is independently ordered
by narrower subsystem plans or a concrete browser-profile milestone.
