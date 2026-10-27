# Known limitations

Runtime and integration constraints, with regression tests and replacement
conditions. Results depend on the selected base and capabilities.
[PRIORITY.md](PRIORITY.md) and owner roadmaps track unimplemented APIs.

## Runtime selection

Plain Node has no compatibility addon. Official Node plus the addon supplies
explicit queues and native global/context allocation. A custom Node build with
the relevant V8 patches supplies additional operations, including job hooks
and native callback iterators. Test capabilities, not just the `custom` label.
[Node compatibility](../node-compat/README.md) owns builds and supported bases;
[JS Engine](js-engine/README.md) owns their common runtime contract.

## Realm identity and global objects

- **`node-v8-object-realms`:** Native `getRealm` and `getFunctionRealm` use
  creation contexts and stamped realm references when available. Plain Node
  instead uses known associations plus prototype/evaluation evidence; changed
  function prototypes and callable Proxy traps can defeat exact constructor
  realm selection. Replace that fallback when exact lookup is available on all
  supported paths, preserving cross-realm construction and callback tests.
  Sources: [runtime](js-engine/runtime.ts), [constructor tests](../test/web-idl/binding/constructor-realm.test.ts),
  [callback tests](../test/web-idl/binding/realm/callback.test.ts).
- **`node-vm-global-proxy`:** Plain Node cannot reuse Browlet's modeled
  WindowProxy as the VM's actual top-level `this`. Its JavaScript proxy must
  also relax forwarded nonconfigurable descriptors across retargeting. The
  native context/allocation path resolves these two mismatches. Remove the
  modeled proxy/descriptor accommodations only when that path is required.
  Sources: [JSRealm](js-engine/realm.ts), [Window binding tests](../test/browlet/dom-binding.test.ts),
  [navigation tests](../test/browlet/browsing/navigation/document-lifecycle.test.ts).
- **Browser origin security remains unfinished on every backend.** A native
  WindowProxy and Node's shared security token provide identity and embedder
  access, not same-/cross-origin policy. The Web IDL security hook is currently
  a no-op. Retained-realm access, nested contexts, Location checks, and complete
  named properties await the [Window roadmap](browlet/browsing/window/ROADMAP.md).
  Native global detachment cancels queued V8 jobs; HTML must perform its required
  checkpoint before detaching, as the current top-level path does.

## Scheduling and callback context

- **Script creation is separate from execution.** Classic creation now compiles
  without running; CSS/JSON/text creation retains synthetic default-export inputs.
  JavaScript-module parsing and WebAssembly ESM parsing still throw explicitly.
  Synthetic records are not engine modules, and CSS export projection remains
  unfinished. Classic compiled code still needs execution in the retained realm
  through the selected backend. Long Animation Frames creation timing is also missing. Module
  graph orchestration covers document, worker, and worklet entry points, including
  shared worklet responses, but the record operations that load dependencies and
  link remain unfinished. Worker `importScripts()` fetching
  requires an unavailable synchronous pause. Existing direct evaluation remains
  separate, and HTML script/worker startup does not call these fetchers yet. See the
  [script-creation audit](browlet/scripting/ROADMAP.md#html-8143-creating-scripts).
- **`node-v8-agent-policy`:** `Agent.canBlock` records HTML's policy without
  enforcing it in V8. Window author code can call Atomics.wait and receive
  `"timed-out"` instead of TypeError, even with a zero timeout. The public
  [agent regression](../test/browlet/scripting/agents.test.ts) records this as an
  expected failure on all backends. Agent signifiers and cluster membership are
  likewise Browlet state, not native execution identities or memory barriers.
  Worker/worklet allocation supplies records and separate loops only; globals,
  independent execution, and shutdown remain unfinished. See the
  [§8.1.2 audit](browlet/scripting/ROADMAP.md#html-811812-audit).
- **`node-v8-microtask-queue` / `node-v8-checkpoint`:** Without explicit queues,
  all event loops share Node's ambient queue and use private `_tickCallback()`.
  It can drain unrelated jobs, next-ticks, and rejection machinery, including
  premature unhandled-rejection reporting during nested checkpoints. The
  explicit backend gives each configured HTML loop its own queue. Retire the
  ambient queue/checkpoint substitute together when unsupported runtimes are
  dropped. [Event-loop notes](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-microtask-queue)
  retain the affected tests and exact replacement conditions.
- **`node-v8-execution-contexts`:** Custom job hooks capture controlled Promise
  callback/job boundaries; official engines lack those hooks. Neither exposes
  the entire execution stack or supplies HTML Script records. Browlet's explicit
  JavaScript context model tracks controlled entries only. The A-to-B bound-listener
  investigation is skipped by agreement: its JavaScript observer's equivalence to
  the native API in HTML's examples is uncertain. Revisit with the actual example
  pages and platform APIs when supported. Manual stack selection/restoration tests
  do not establish automatic function-call tracking.
  The direct-host-entry fallback remains in place. See the
  [callback lifecycle record](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts)
  and [tests](../test/browlet/scripting/callback-lifecycle.test.ts).
- **Custom generic/timeout hooks are isolate-wide.** They cannot decline an
  individual job. `Atomics.waitAsync` in an unrelated Node/VM realm while those
  Browlet hooks are installed is unsupported; HTML realms use their task and
  active-time timeout paths. Revisit with a host-hook routing/fallback contract.
- **Direct host calls are not HTML tasks.** Calling a projected API from Node
  does not itself establish a checkpoint boundary. Use the
  [automation entry](browlet/automation/README.md) for page commands; a broader
  embedder contract must define direct-call/Promise interoperability. Do not
  hide this by checkpointing after every Web IDL operation.
- **WebDriver command algorithms have unfinished dependencies.** BiDi evaluation
  has protocol-shaped inputs/results and explicit target, execution, Await,
  serialization, activation, and exception-detail boundaries. It cannot execute
  end to end yet. Browlet's existing `PageEvaluation` remains a separate local
  source-evaluation path until these are connected. Its copying, cancellation,
  and exposed Node callbacks are convenience behavior, not protocol conformance.
  See the [automation boundary](browlet/automation/README.md).
- **Internal sandboxes provide execution, with browser client settings stubbed.**
  Their binding uses the full BrowletEnvironment contract, but origin, base
  URL, creation URL, policy, module, ancestry, time-origin, and Window/Worker
  global-scope queries throw explicitly. They remain suitable for internal
  allocations and clientless work such as Reporting uploads. Public APIs that
  need those settings require a Window or another complete environment.
  Sources: [environments](browlet/environment.ts),
  [sandbox tests](../test/browlet/scripting/sandbox.test.ts).

## Promise observation

`node-v8-promise-reactions` covers the captured intrinsic `then` fallback, which
bypasses author replacement of `then` but still observes `constructor`/`@@species`.
Native observation on the supported Node 26/custom paths avoids those accesses;
the older Node 24 native implementation still consults `constructor`. The
backend-sensitive expectations are in [engine Promise tests](../test/js-engine/promises.test.ts)
and [Web IDL Promise tests](../test/web-idl/values/promise.test.ts).

Even the native API creates an unreachable derived Promise rather than exposing
the exact no-result-capability form of `PerformPromiseThen`. Browlet also marks a
Promise handled by attaching a reaction; the addon does not expose V8's existing
`MarkAsHandled` API. Replace these substitutes with exact engine operations;
preserve typed settlement, exception identity, handled state, and queue ownership.
Implementation: [runtime observation](js-engine/runtime.ts) and [Web IDL promises](web-idl/values/promise.ts).

## Buffers and engine internal slots

- **Shared view length mode:** Native length-tracking inspection distinguishes
  auto-length from fixed views. Without it, a reversible resize probe works for
  resizable ArrayBuffers, but a growable SharedArrayBuffer cannot shrink back.
  Ambiguous shared views are reconstructed as fixed. Retire the inference path
  when native inspection is universally available. See [buffers](js-engine/buffers.ts)
  and [structured-data tests](../test/browlet/scripting/structured-data/deserialize.test.ts).
- **`SPEC_CLASH(webidl-buffer-source-byte-length)`:** Buffer/view length helpers
  report current intrinsic lengths rather than the raw `[[ByteLength]]` slot.
  Detached/out-of-bounds typed arrays return zero; DataViews request TypeError.
  This follows the needs of current consumers while Web IDL's definition remains
  under discussion. The [engine contract](js-engine/ROADMAP.md#buffer-source-byte-length)
  records the specification and browser evidence; [buffer tests](../test/js-engine/buffers.test.ts)
  cover resizing and detachment. Recovering old fixed-view lengths is not a
  current requirement.
- **Transfer eligibility:** There is no non-destructive query for
  `[[ArrayBufferDetachKey]]`. V8's `IsDetachable()` is not equivalent; the actual
  transfer remains authoritative. Add the correct query before claiming the
  separate predicate. See [JSRealm](js-engine/realm.ts) and the
  [engine roadmap](js-engine/ROADMAP.md).
- **Error internals:** `node-v8-error-stack` reads the known own stack accessor
  or data property, not an exposed `[[Stack]]`. V8's own-property layout differs
  from the proposed inherited stack accessor, whose test runs only when the
  engine provides it. Error.isError availability also varies by runtime.
  Error and DOMException serialization preserve readable stack strings;
  replaced stack accessors are not invoked. Native formatting can still run
  author name/message getters or Error.prepareStackTrace. Failed formatting
  leaves the stack unavailable and serialization writes an empty string.
  Preserve [DOMException tests](../test/browlet/dom-exception.test.ts)
  and serialization behavior when adopting exact primitives.
- **Unrecognized exotics:** The patched backend exposes exact Array, String,
  and RegExp String iterator brands, including iterators with added properties.
  Without those predicates, the decorated-iterator regression in
  [serialization tests](../test/browlet/scripting/structured-data/serialize.test.ts)
  remains an expected failure. `node-v8-exotic-object-slots` probes other
  propertyless values through native cloning; decorated iterator helpers and
  other unrecognized exotics still cannot be inspected safely without author effects.

## Web IDL boundaries

- **`document.all`:** Available with the addon on each supported base, including
  callable lookup and native falsiness. Without it, `Document.prototype.all` is
  omitted. `SPEC_CLASH(htmlallcollection-property-order)`: native V8/Chromium
  enumeration puts ordinary own string properties before collection names;
  Web IDL, Firefox and WebKit put those names first. This ordering remains
  accepted pending an engine investigation. Ordinary accessors and alternate
  receivers are handled by V8 rather than forwarded to separate storage. See the
  [nodes roadmap](browlet/dom/nodes/ROADMAP.md#htmlallcollection) and
  [native regressions](../node-compat/test/html-dda.test.cjs).
- **Collection iterator branding:** With the patched engine's iterator factory,
  native Map/Set `next()` recognizes generated iterators. Otherwise proxy shells
  preserve ordinary iteration, prototypes, and live results but fail borrowed
  native `next()` brand checks. Retire the fallback when the native factory is
  required. See [JSRealm](js-engine/realm.ts) and
  [collection tests](../test/web-idl/binding/realm/collection.test.ts).
- **`SPEC_GAP(webidl-symbol-selection)`:** Web IDL's
  [distinguishability table](https://webidl.spec.whatwg.org/#dfn-distinguishable)
  admits Symbol/string overloads and unions, but both the
  [overload](https://webidl.spec.whatwg.org/#dfn-overload-resolution-algorithm)
  and [union](https://webidl.spec.whatwg.org/#es-union) selection algorithms omit
  a Symbol branch. Browlet selects a declared symbol branch for a primitive
  JavaScript Symbol before coercing fallbacks. Nullable and union branches use
  the same prepared candidates; boxed Symbols retain object/conversion rules.
  This completes the type distinction without claiming browser precedent:
  Chromium, Firefox, and WebKit's inspected IDL declarations had no consumers,
  and [Blink rejects the type during binding generation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/bindings/scripts/bind_gen/blink_v8_bridge.py).
  Revisit when the specification supplies selection rules. The
  [overload](../test/web-idl/binding/realm/overload.test.ts) and
  [union conversion](../test/web-idl/converters/union.test.ts) regressions cover this choice.
- **CSSOM projection:** Sheets, rules, declaration results, and MediaList use
  real bindings. DocumentOrShadowRoot's adopted sheets now use the real observable
  array binding, current-document checks, and realm exception realization.
  CSSStyleProperties exposes the small implemented longhand set and ordinary
  margin shorthand expansion/serialization, including CSS-wide keywords and
  pending `var()` values. `first-valid()` shorthand selection remains an explicit
  [unfinished boundary](stylelet/props/ROADMAP.md#shorthand-substitution-handoff).
  The [CSSOM roadmap](stylelet/cssom/ROADMAP.md#projection-and-declaration-lifecycle)
  owns the remaining property and declaration dependencies.
  [Style integration](browlet/style/ROADMAP.md#next-boundary-change)
  owns external sheet loading, script/render blocking, and shadow-tree matching.
- **Computed style:** `getComputedStyle()` currently creates a readonly snapshot
  of the installed properties. CSSOM requires a new live object, complete
  supported-property/defaulting behavior, and resolved values that can depend
  on layout. Pseudo-elements and full eligibility checks also remain unfinished.
  See [computed-result dependencies](stylelet/cssom/ROADMAP.md#computed-results-and-external-facts).
- **Value lifecycle:** unregistered custom properties now compute retained tokens,
  valid empty values, guaranteed-invalid initial values, and `initial`/`inherit`/
  `unset` in ordinary trees, together with `var()` replacement, dynamic names,
  early spread, lazy fallbacks, cycle detection, and bounded token/source composition.
  Installed built-ins now reparse substituted components, expand pending margins,
  and apply initial/inherited defaults without reviving earlier declarations.
  Host-supplied system palettes now resolve system colors, including initial
  CanvasText; omitted palettes use fixed light defaults. Per-element color-scheme
  selection, forced-color policy, property-specific currentColor resolution,
  font/viewport inputs, and layout-dependent resolved values remain
  unconnected; symbolic values can still escape the limited computed-style query.
  Other arbitrary substitution functions, registered custom computation, custom
  and built-in cascade rollback, and unavailable shadow scopes throw explicitly. Argument
  validation beyond `var()`, animation/attribute taint, and registration APIs remain
  unconnected. Approved draft/browser differences are recorded in the engine guide.
  The standard DOM adapter cannot see closed-root slot assignments; such hosts
  must supply their own DOM operations, as Browlet does.
  The [engine inventory](stylelet/engine/README.md) distinguishes these limits
  from passing direct resolver tests.
- **Property animation:** pure combination operations cover installed opacity,
  physical margin, absolute-color, and unregistered custom values. Repeatable lists,
  symbolic-color interpolation, and registered custom animation throw explicitly.
  Keyframe/effect sampling, taint propagation, composition, and animation-driven
  cascade updates remain unconnected; these operations alone do not animate a document.
- **Stylesheet rules:** namespace declarations, selector edits, style-rule text,
  and nested insertion/deletion are implemented. Unknown at-rules are discarded;
  recognized unfinished grammars, including conditional groups and page/margin
  descriptors, stop explicitly. Plain imports can be attached and explicitly loaded;
  automatic loading and imported-rule cascade traversal remain unconnected.
  Import layer/supports clauses still stop explicitly.
  Nested style rules are retained
  in projected CSSOM lists, but their cascade participation remains unfinished. Direct nested
  selector tests therefore do not establish nested stylesheet support. See the
  [rule inventory](stylelet/cssom/rules/README.md#parsing-and-ownership)
  and [remaining contracts](stylelet/cssom/rules/ROADMAP.md).
- **Hosted Stylelet:** The package targets Node and directly uses the URL,
  Encoding, and Fetch subsystems; it no longer provides a browser-global bundle.
  Every Stylelet instance requires a host-supplied environment extending Fetch's
  contract; there is no default runtime. Hosts supply DOM operations, request/security
  state, execution, transport, and their Blob URL store through the environment.
  Native Node Blob URL registrations are not recovered automatically.
- **Inline CSS values:** style attributes are parsed and checked against CSP on
  mutation, but URL-valued CSS properties are not registered yet. Capturing and
  retaining their parse-time base URLs, including through CSSOM edits and
  custom-property substitution, remains [style integration work](browlet/style/ROADMAP.md#style-attributes--html-3265).

One owning world per implementation and preservation of genuine `object`/`any`
values are intentional [binding contracts](web-idl/README.md), not missing APIs.

## Live DOM mutation

Form and options collections have minimal concrete form/input/select/option/
optgroup owners. Form membership currently throws because form-owner association
is missing; radio-group exclusion, automatic selection, and selectedcontent
updates remain no-op stubs. The [forms roadmap](browlet/dom/nodes/html/forms/ROADMAP.md)
records those boundaries and the three approved expected-failure regressions. Their
exposed interfaces are implemented fragments, not complete HTML form controls.

Public tree collections and selector APIs are available. Selectors requiring
unimplemented HTML state (focus/editing, form controls, media, or custom-element
state) still reach explicit missing host operations in the DOM adapter. These
are recorded in the [4F scope](browlet/dom/nodes/ROADMAP.md#collections-tree-mixins-and-selectors-4f).

Document and ShadowRoot expose `activeElement`, but reading it currently throws
at the explicit `Document.focusedArea` dependency. The getter's retargeting and
fallback steps are implemented; document focus state and its lifecycle are not.
The [interaction roadmap](browlet/interaction/ROADMAP.md#focused-area-dependency)
records the remaining work. Getter tests supply focus state explicitly and do
not establish end-to-end focus support.

Element attribute setters, Attr attachment, and attached `Attr.value`,
`nodeValue`, and `textContent` writes enforce Trusted Types. Their common change
path delivers mutation records through the same observer machinery as structural
and character-data changes. Shadow attachment, named/manual slot assignment, and
slot-change delivery are implemented. Custom-element reactions remain unfinished. The
[attribute slice](browlet/dom/nodes/ROADMAP.md#section-4-slices) records these
dependencies and the tests for the implemented storage and mutation behavior.

Shadow attachment retains focus and serialization flags without implementing
their later consumers; clonable shadow trees participate in clone/import.
Declarative parsing, shadow-tree cascade selection,
ElementInternals attachment, and custom-element definition checks remain absent. Browser/spec
differences in assignment updates and adopted-host root allocation are recorded
in the [4H scope](browlet/dom/nodes/ROADMAP.md#shadow-trees-4h).

The core DOM Range surface is implemented. HTML contextual fragment parsing and
CSSOM View geometry remain absent; the
[Range roadmap](browlet/dom/ranges/ROADMAP.md#processinginstruction-collapse)
records the WebKit ProcessingInstruction collapse discrepancy. DOM §6 traversal
is implemented; its compatibility choices are recorded in the
[traversal roadmap](browlet/dom/traversal/ROADMAP.md). DOMTokenList/classList are
implemented; HTML token attributes and custom-element reaction delivery remain
with their owners. The [token-list roadmap](browlet/dom/ROADMAP.md#empty-add-compatibility)
records the browser disagreement for an empty `add()` on an absent attribute;
Browlet follows DOM and WebKit. Generic
cloning does not yet copy HTML-specific template, script, or form-control state.
ProcessingInstruction validation, pseudo-attributes, and public construction are
implemented. Its attribute-map cloning gap and the Document/XMLDocument equality
choice are recorded in the
[4I compatibility notes](browlet/dom/nodes/ROADMAP.md#node-completion-compatibility).
MutationObserver's existing Web IDL contract gives callback arrays the callback's
realm and retains the observer's binding ownership for records; browser behavior
differs. This choice is recorded in the
[observer compatibility notes](browlet/dom/nodes/ROADMAP.md#mutation-observer-compatibility).
NodeIterator rejects recursive traversal before changing its cursor, matching
Firefox rather than the written algorithm's later filtering check. The
[compatibility choice](browlet/dom/traversal/ROADMAP.md#reentrant-filter-compatibility-choice)
also rejects recursive calls that would otherwise return null before filtering.

## Trusted Types

Window exposes trusted string values, policies, factory queries, and CSP
`trusted-types` policy-creation restrictions with violation reporting. Creating
a trusted value does not sanitize its contents; that is the policy callback's work.
Default policies and `require-trusted-types-for` apply to Element attribute setters,
Attr/NamedNodeMap attachment, and attached `Attr.value`, `nodeValue`, and
`textContent` writes, including report-only violations and reentrant callbacks.
Internal/parser attribute storage does not run author-setter checks.
CSP meta delivery remains an HTML integration gate;
the existing response-header path supplies enforced policies.

`TrustedHTMLParserOptions`, `createParserOptions`, and its callback are absent,
including from generated declarations, until the real Sanitizer dependencies
exist. Markup parsing, script compilation, string timers, navigation, and Worker
integrations retain the separate gates in the [Trusted Types roadmap](browlet/browsing/policy/trusted-types/ROADMAP.md).
That roadmap also records the approved CSP policy-creation difference and the
explicit standard content-handler list used for sink metadata.

## HTML integration gates

- **HTML element identities do not imply complete element APIs.** All specified
  HTML names now select their concrete or intentionally generic interface,
  including HTML-namespace elements in XML documents. Many interfaces expose
  only identity, the shared HTML constructor, and inherited members; their
  element-specific APIs and lifecycle hooks remain missing. Shared inert/autofocus/heading reflections
  do not implement interaction, focus, or accessibility processing. See the
  [§3.2.2 inventory](browlet/html/ROADMAP.md#section-322-elements-in-the-dom) and
  [element owners](browlet/dom/nodes/html/ROADMAP.md#section-322-interface-identities).

- **HTML constructors do not yet make custom elements publicly usable.**
  `[HTMLConstructor]` consumes definitions, selects the current/scoped registry,
  creates elements, and reuses upgrade-stack entries. Public `define()`, upgrade,
  and reaction delivery remain absent, so authors cannot populate those inputs
  yet. Direct `new HTMLElement()` and built-in construction correctly throw.
  `Image`, `Audio`, and `Option` legacy factories remain separate missing APIs.
  The [constructor slice](browlet/html/ROADMAP.md#section-323-html-element-constructors)
  records those dependencies and the approved non-extensible-upgrade clash.

- **Content-model queries cover only the recorded models.** Contextual transparency
  and paragraph discovery are implementation queries; unfinished model shapes,
  container definitions, and foreign contexts throw when needed. They do not
  validate DOM insertion or provide layout/editing behavior. See the
  [transparency/paragraph scope](browlet/html/ROADMAP.md#sections-3253-and-3254-transparency-and-paragraphs).

- **Language lookup has an unfinished pragma producer.** Node language and
  Browlet-backed `:lang()` use attributes, DOM/shadow-host ancestry, and retained
  HTTP `Content-Language`. The §4.2.5 meta lifecycle does not yet populate
  `Document.pragmaLanguage`; creating a content-language meta element
  therefore does not supply that default. Standalone selector hosts without a
  computed-language operation use attribute ancestry only. CSS language-range
  validation/canonicalization and Selectlet's comma-separated language-range lists
  remain separate selector work. See the
  [language slice](browlet/html/ROADMAP.md#section-3262-lang-and-xmllang).

- **Translation policy does not yet drive page localization.** Element translation
  modes, HTMLElement.translate, and HTML's translatable-attribute inventory are
  available. Metadata-name classification and ARIA translation rules explicitly
  throw when queried. No localization service applies translations to text or
  attributes, sets the target lang, or recursively processes srcdoc/CSS. See the
  [translation slice](browlet/html/ROADMAP.md#section-3263-translate).

- **Automatic direction on text controls requires their unfinished live values.**
  HTML directionality, shadow/slot traversal, `HTMLElement.dir`, `Document.dir`,
  and `:dir()` integration are available. Automatic direction on eligible inputs
  and textarea throws until their current-value lifecycle exists; default value
  attributes and textarea child text are not substituted. Metadata-name rules for
  directionality-capable content attributes also remain explicit errors. Unicode
  first-strong lookup does not implement bidi layout, per-paragraph rendering, or
  editing UI. See the [directionality slice](browlet/html/ROADMAP.md#section-3264-dir).

- **Document metadata depends on the loader's inputs.** Response-based document
  creation retains `Last-Modified`; the source-only route has no response date
  and local-file modification metadata is not connected. Unknown dates use the
  current local time. Document cookies share Fetch's store and use a captured
  cookie URL. Inherited about:blank/srcdoc access requires the missing iframe
  and navigation-initiator producers to supply that URL; history recreation
  must preserve it too. Sandboxed inherited srcdoc throws, following
  Chromium/Firefox rather than WebKit. See the
  [resource metadata audit](browlet/html/ROADMAP.md#section-314-resource-metadata).

- **Lazy loading is scaffolding, not operational resource loading.** Basic
  image/iframe/audio/video classes expose `loading` and retained continuations,
  and Document now uses an internal observer scaffold with real registrations
  and entry queues. Observer option parsing, complete entry geometry, author
  bindings, automatic notification, and actual element resource loading are
  absent. Tests supply explicit entries and trigger notification themselves.
  Scripting eligibility uses a provisional BiDi hook with the no-session result
  of true; scoped automation overrides are not implemented.
  See the [HTML audit](browlet/html/ROADMAP.md#section-257-lazy-loading).

The [§2.4.3 base-change response](browlet/html/ROADMAP.md#section-24-audit)
connects explicitly provisional consumers. Base/fallback selection and notification
sequencing are implemented, but browser UI updates, link-state invalidation,
Window speculation-rule registration, and speculative loading remain no-ops.
Parse-result creation only initializes an empty record; it does not parse or
report errors yet.
`HTMLScriptElement` has a dedicated implementation/platform identity and result
state, plus `crossOrigin` and `referrerPolicy` reflection, without its preparation
algorithm. Link and script reflection uses the shared HTML attribute definitions,
but element fetching and `[CEReactions]` delivery remain missing. The credentials
mapper and potential-CORS request factory do not by themselves implement resource
loading. Fetch applies populated referrer policies, but navigation response-header
association, meta referrer processing, and hyperlink `rel=noreferrer` still lack
their HTML consumers; complete referrer-policy precedence is not implemented.
Browlet's existing parser callback still evaluates data-block scripts such as `application/json` as
JavaScript; an approved expected-failure regression retains that limitation.

Document's [tree accessors](browlet/html/ROADMAP.md#section-317-dom-tree-accessors)
include title/body mutation, live collections, name lookup, and named properties.
`currentScript` has retained state and readonly projection, but the provisional
script handler does not set/restore it yet. Minimal object/embed implementations
supply exposure; object loading must select fallback state. Iframe retains a
content navigable only when supplied internally; automatic child navigation and
public contentWindow/contentDocument remain absent. Named-property regressions
use those explicit state inputs, not simulated successful resource loads.

Document's [render-blocking mechanism](browlet/html/ROADMAP.md#section-316-render-blocking)
now supplies eligibility, a configurable five-second cutoff, element lifecycle
cleanup, and rendering-opportunity filtering. The element loading/preparation
algorithms still need to register and release pending work and populate Fetch
request flags. Setting `blocking="render"` alone does not start resource loading;
production rendering opportunities, layout, and display remain unfinished.

Image/link/script `fetchPriority` reflects the shared attribute state. Element
loaders do not yet transfer these hints into requests, and UserAgent's Fetch
priority-selection hook still has no transport scheduler. Setting the attribute
therefore does not change network scheduling. The
[§2.5.9 audit](browlet/html/ROADMAP.md#section-259-fetch-priority-attributes)
records the implemented boundary and WebKit keyword-case disagreement.

The shared [reflection slice](browlet/html/reflection/ROADMAP.md) covers the
implemented Element paths and a minimal ElementInternals owner for internal
defaults, separate element associations, and eligible shadow-root access.
`HTMLElement.attachInternals()` still needs custom-element definitions and
construction checks. ARIAMixin, form-associated internals, and CustomStateSet
remain absent; internal construction tests do not establish those author APIs.
Custom-element reaction delivery remains missing at the binding boundary.
Browlet now supplies HTML reflection through a Web IDL extended-attribute
preparation hook; this does not yet supply `[CEReactions]` invocation wrapping.

The [loader](browlet/loader/ROADMAP.md) now consumes streamed Fetch responses,
including response CSP and basic decoding/abort. `ResourceReader` preserves
MIME-sniffed input for the selected consumer, but general document-handler
selection and a concrete browser MIME-support policy remain unfinished.
The meta charset extractor is present without the encoding prescan or meta
element processing. The synchronous source-text
route also remains. Neither establishes full HTML navigation, encoding restart,
script readiness, HTML preload processing, load-event ordering, or public timing
entries. Fragment and `javascript:` navigation still need their specified paths.

CSSOM stylesheet Link headers and DOM-created `xml-stylesheet` instructions now
use Fetch and CSS decoding. An explicit import-loading operation now supports nested
completion, failure, cancellation, and subsequent CSSOM edits through the same fetcher.
Browlet owns the document-dependent fetch and fetched-sheet creation steps,
reading `DocumentImpl` state directly. Stylelet owns recursive import coordination
and the CSS decoding algorithms. Its required host environment still extends
Fetch's contract for generic CSS resource fetching.
HTML `<link>` processing,
automatic import startup, media applicability, and script/load/render blocker ownership
remain unfinished. The [style roadmap](browlet/style/ROADMAP.md#external-stylesheet-loading)
records those boundaries and browser disagreements. This does not supply an XML parser.

Document readiness changes and `readystatechange` now run through the shared
§3.1.5 algorithm. Existing HTML routes deliver DOMContentLoaded and load with
their corresponding timestamps, but still combine phases that §13 queues
separately and do not wait for all load-delaying resources. XML parsing and
previous-document unload timing capture remain missing; see the
[loading-status audit](browlet/html/ROADMAP.md#section-315-document-loading-status).

Nested/auxiliary creation stops at explicit missing creator-state and container
associations. Ancestor-origin calculation and referrer-policy masking accept
the known parent document before activation; they do not complete those
[child-navigation dependencies](browlet/html/ROADMAP.md#section-313-ancestor-origins).
`Location.ancestorOrigins` remains absent until relevant-document selection and
its security check are implemented. Policy inheritance, child navigation, history disposal, and storage-shed
cloning remain with [browsing](browlet/browsing/ROADMAP.md) and
[navigation](browlet/browsing/navigation/ROADMAP.md). Custom-element registry
identity is present; reactions and upgrade behavior remain with
[custom elements](browlet/dom/nodes/html/custom-elements/ROADMAP.md). Fetch's remaining
work and provisional consumer hooks stay in its [single roadmap](fetch/ROADMAP.md).
