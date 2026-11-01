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

Addon context handles cannot be passed directly to Node's own `vm.Script` or
`vm.Module` classes. The addon supplies matching `Script`, `SourceTextModule`,
and `SyntheticModule` classes for its contexts; JS Engine selects the backend.
This supported subset excludes async linking callbacks, timeouts, and cached data.
Script and context dynamic-import callbacks require Node's patched forwarding export;
official Node 24/26 addon contexts lack it. HTML dynamic imports work on custom/compat
and stock VM contexts; official compat bases retain the approved expected failures
in [dynamic-import tests](../test/browlet/scripting/dynamic-import.test.ts).
See the [VM API contract](../node-compat/README.md#contexts-globals-and-optional-facilities).

**`node-function-import-referrer`:** Identical `Function` bodies can reuse the
first creating script's import loader on Node 26 and custom Node, reproducing
through both the addon and Node's own VM API. The Node 24 control passes. Custom
passes with the compilation cache disabled, which Browlet does not do in
production. [Regression evidence](../node-compat/test/dynamic-import.test.cjs)
retains the required distinct-loader result as an approved expected failure.

**`dynamic-import-executing-realm`:** If a script in Window A borrows Window B's
`Function` constructor, the generated function executes in B while retaining A's
Script referrer. Node's import callback supplies the referrer, not a separate
executing realm. An unsupported import attribute currently rejects with A's
TypeError instead of B's. The [focused regression](../test/browlet/scripting/dynamic-import.test.ts)
retains B's prototype as an approved expected failure. Discuss the boundary before
extending the addon API. Future Worklet/ServiceWorker restrictions also need the
current settings before HTML selects the referring script's settings.

## Realm identity and global objects

**`SPEC_CLASH(detached-context-promise-assimilation)`:** Browlet follows Chromium
and Firefox: host `await`/`Promise.resolve()` can remain pending for a Promise
from a detached context, including one already fulfilled before navigation.
V8's `DetachGlobal()` clears the old context's microtask queue, dropping the
thenable job. Direct host callbacks and replacement-context work still run.
WebKit instead resolves the adopted Promises. The
[regression](../node-compat/test/capabilities.test.cjs) asserts the accepted
Chromium/Firefox behavior on Node 24, 26, and custom; it is no longer an expected
failure. See the [browser evidence](js-engine/ROADMAP.md#detached-context-promise-delivery).

- **`node-v8-object-realms`:** Native `getRealm` and `getFunctionRealm` use
  creation contexts and stamped realm references when available. Plain Node
  instead uses known associations plus prototype/evaluation evidence; changed
  function prototypes and callable Proxy traps can defeat exact constructor
  realm selection. Replace that fallback when exact lookup is available on all
  supported paths, preserving cross-realm construction and callback tests.
  Sources: [runtime](js-engine/runtime.ts), [constructor tests](../test/web-idl/binding/constructor-realm.test.ts),
  [callback tests](../test/web-idl/binding/realm/callback.test.ts).
- **`node-vm-global-proxy`:** Plain Node cannot reuse Browlet's modeled
  WindowProxy as the VM's actual top-level `this`. Global `var` declarations
  consequently live on a different object from Window's
  `globalThis`; both source and retained-script execution expose that mismatch.
  [Calling tests](../test/browlet/scripting/script-calling.test.ts) retain approved
  stock-only expected failures. The JavaScript proxy also relaxes forwarded
  nonconfigurable descriptors across retargeting. The native context/allocation
  path resolves these mismatches. Remove the
  modeled proxy/descriptor accommodations only when that path is required.
  Sources: [JSRealm](js-engine/realm.ts), [Window binding tests](../test/browlet/dom-binding.test.ts),
  [navigation tests](../test/browlet/browsing/navigation/document-lifecycle.test.ts).
  The modeled WindowProxy now rejects preventing extensions and remains extensible
  across navigation. Native globals also remain extensible; foreign mutations
  throw SecurityError under the chosen Chromium policy. See the
  [WindowProxy audit](browlet/browsing/window/ROADMAP.md#html-723-windowproxy-foundations-and-extensibility).
  Valid child-index reads, descriptors, and presence checks work on both backends
  in container insertion order. Own keys include the live child-index prefix;
  native foreign keys are now filtered through the caller's binding. Both backends
  reject same-origin indexed writes/definitions and protect present children from deletion.
  Native `Reflect.set(window, absentIndex, value, differentReceiver)` still writes
  to that receiver because V8 bypasses the setter (`window-indexed-set-receiver`).
  Stock Node also lacks missing-index security. Native global proxies
  use owner-supplied indexed callbacks alongside V8's ordinary global storage.
  Native ordinary accessor access now preserves explicit receivers and rejects
  invalid derived IDL receivers. A stable host view retains each original global's
  properties across reuse; registered IDL attributes retain original-Window bare
  lookup, as recorded by `SPEC_CLASH(retained-window-attributes)` in the
  [Window roadmap](browlet/browsing/window/ROADMAP.md#native-window-property-storage-and-receivers).
  Stock get/set forwarding preserves the receiver, with exact associated VM globals
  mapped to the public proxy so free global names still reach Window bindings.
  Retired VM globals remain weakly recognized across navigation. Other receivers,
  including objects inheriting from Window, are not mapped. Duplicate ordinary
  numeric keys from internal storage or direct stock-VM access remain suppressed in enumeration.
- **Native origin checks are connected; complete WindowProxy conformance remains open.**
  Window contexts keep distinct tokens, and native access checks select the
  executing caller before host dispatch. Foreign Document access is rejected,
  descriptors and keys use that caller's binding, and foreign prototypes are null.
  `SPEC_CLASH(window-foreign-receiver)` and `SPEC_CLASH(window-foreign-prototype)`
  follow Chromium for foreign ordinary receivers and mutation denials. Same-origin
  access stays in V8 and still bypasses COOP reporting. The indexed explicit-receiver
  gap and missing Window members remain open. Stock Node lacks this automatic caller
  selection and retains the approved expected failures. See the
  [Window roadmap](browlet/browsing/window/ROADMAP.md#native-window-access-guard).
  The failed-access callback is isolate-wide and must have one addon owner; it
  cannot independently coexist with another embedder replacing the same hook.
  Node 24/addon applies a temporary Promise-lookup optimization workaround on its
  first guarded global. It repairs Node-owned imports and rejection delivery while
  preserving access checks, but affects the entire isolate: a tight host
  `Promise.all` benchmark takes about 27% longer. Node 26/custom do not activate it.
  See the [native import boundary](../node-compat/README.md#native-global-access-checks).
  Native global detachment cancels queued V8 jobs; HTML must perform its required
  checkpoint before detaching, as the current top-level path does.

## Scheduling and callback context

- **Forcibly aborting running scripts is unsupported and deferred.** Browlet,
  page JavaScript, and the Node caller share a JavaScript execution thread. An
  infinite loop prevents same-thread callers, timers, and abort listeners from
  requesting a stop. `Agent.abortRunningScript()` explicitly throws an
  unfinished-operation error; no watchdog or independent stop channel is supplied.
  Changing `scriptingEnabled` blocks later HTML entries, and navigation's local
  evaluation cancellation rejects host commands and removes queued work. Neither
  interrupts executing JavaScript. We retain direct synchronous host access and
  defer native termination work; this does not imply that external interruption
  is impossible. See the [killing audit](browlet/scripting/ROADMAP.md#html-8145-killing-scripts).

- **HTML script calling has explicit runtime boundaries.** Classic/module run
  methods implement eligibility, error/rejection control flow, and preparation/
  cleanup. Retained classic code and supplied module graphs execute on both
  backends. Module-specific active-script attribution and restoration after await
  remain unfinished, as do production script-element callers.
  Termination is only a represented outcome; timing remains unfinished.
  Child full activity now follows the retained container Document recursively;
  unassociated children, detached Documents, and inactive history entries fail.
  Child creation/destruction and ancestor-activity notification propagation still
  need their lifecycle producers before nested-page task/timer/script activity is
  complete. See the [calling audit](browlet/scripting/ROADMAP.md#html-8144-calling-scripts).

- **Runtime error reporting has incomplete attribution and worker support.**
  Window reporting dispatches trusted cancelable ErrorEvents, prevents recursive
  dispatch, and applies classic-script muting. Filename, line, and column remain
  empty/zero until runtime diagnostics are available. The modeled running-script
  lookup cannot identify every uncontrolled JavaScript transition; classic run
  explicitly retains its script for reporting. Special five-argument `onerror`
  handlers and dedicated-worker propagation are not implemented. `reportError`
  follows HTML's muting algorithm despite its noted Firefox disagreement. See
  the [runtime-error audit](browlet/scripting/ROADMAP.md#html-8146-runtime-script-errors).

- **HTML promise-rejection reporting requires the addon.** All addon bases deliver
  native reject/handle notifications, non-observing slot reads, and HTML checkpoint
  notifications/events. Stock Node retains its process-level reporting and throws
  for unavailable slot queries; the integration suite keeps approved expected
  failures. Captured compilation identity fixes classic muting across ordinary
  calls between retained scripts, following Chromium/Firefox. Missing metadata
  uses the modeled running script; complete attribution across arbitrary async
  resumptions and security-token boundaries remains unfinished.
  Independently replacing V8's rejection callback through another addon is
  unsupported; the maintained bridge forwards to Node's default handler. See the
  [rejection audit](browlet/scripting/ROADMAP.md#html-8147-unhandled-promise-rejections).

- **Retained Window event targets follow Chromium.** Live event targets,
  path entries, and function-listener receivers expose WindowProxy on both
  backends. After replacement, converting the old Window returns null as in
  Chromium/WebKit; Firefox retains WindowProxy. Removal without replacement
  retains the proxy as in Chromium/Firefox; WebKit returns null. A proxy saved
  before navigation remains stable. See the
  [Window identity tests](../test/browlet/browsing/window-event-target.test.ts)
  and the `window-event-target-after-navigation` / `window-event-target-after-removal` clashes in the
  [Window roadmap](browlet/browsing/window/ROADMAP.md).

- **Import-map algorithms still need production callers.** Parsing, normalization,
  merging, module specifier resolution, parse-result creation, and Window
  registration work when explicitly invoked. `import.meta.resolve` now calls the
  resolver through the real engine initializer, and static module loading now
  resolves dependencies and their integrity through the module's environment.
  Dynamic imports use the same resolver and fetchers. Script-element preparation,
  including `<script type="importmap">`, remains an unfinished consumer.
  Internal console warning output also remains provisional. Approved merge
  choices follow Chromium/WebKit where HTML and Firefox disagree; see the
  [import-map audit](browlet/scripting/ROADMAP.md#html-815-module-specifier-resolution).

- **Script creation is separate from execution.** Classic creation now compiles
  without running; source-text and CSS/JSON/text creation now retain real engine
  modules. Binding projects CSS exports before author use. Stock Node requires
  `--experimental-vm-modules` and its synchronous module linking API; the addon
  needs neither that flag nor an engine patch for static modules. The addon now
  supplies Wasm ESM graphs, but HTML's WebAssembly parser and Long Animation Frames
  creation timing remain unfinished. Module
  graph orchestration covers document, worker, and worklet entry points, including
  shared worklet responses. Static JavaScript/CSS/JSON/text dependencies now fetch,
  link, and evaluate through the existing graph entry points. Source/deferred
  imports remain unfinished. Dynamic evaluation-phase imports load, link, and
  wait for evaluation through HTML, including top-level await. The addon accepts
  Node-shaped import and metadata callbacks with their respective forwarding
  exports in the combined Node patch; official addon bases retain expected
  failures for these facilities. HTML's `import.meta.url` and `resolve` work on
  custom/compat and stock VM modules; official compat bases still receive empty
  metadata. The [integration tests](../test/browlet/scripting/import-meta.test.ts)
  retain those expected failures. Worker `importScripts()` fetching
  requires an unavailable synchronous pause. Existing direct evaluation remains
  separate, and HTML script/worker startup does not call these fetchers yet. See the
  [script-creation audit](browlet/scripting/ROADMAP.md#html-8143-creating-scripts).

- **Native Wasm task ownership requires the addon.** All addon bases now deliver
  native compilation/instantiation Promise resolution through the owning HTML
  task, including module thenable assimilation. Stock Node makes automatic
  progress through its native queue but cannot install that task/lifecycle handoff.
  The addon assumes Node's default V8 Wasm resolver for unregistered contexts;
  chaining another embedder's replacement of the isolate-wide callback is unsupported.
  See the [completion contract](browlet/scripting/ROADMAP.md#native-webassembly-completion)
  and [regressions](../test/browlet/scripting/wasm-completion.test.ts).

- **Wasm ESM has three retained binding gaps.** The addon runs supplied mixed
  JavaScript/Wasm graphs, but mutable globals exported to JavaScript are snapshots,
  `v128` exports read as undefined instead of remaining uninitialized, and mutable
  globals re-exported through JavaScript cannot be imported as Wasm globals.
  Direct Wasm-to-Wasm imports retain their globals and memory. The
  [expected-failure tests](../node-compat/test/wasm-gaps.test.cjs) and independent
  [Node controls](../node-compat/test/wasm-node-gaps.test.cjs) retain all three
  requirements. See the [bridge contract](../node-compat/README.md#webassembly-modules).

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
  It cannot synchronously drain reactions from within an existing Node microtask.
  It can drain unrelated jobs, next-ticks, and rejection machinery, including
  premature unhandled-rejection reporting during nested checkpoints. The
  explicit backend gives each configured HTML loop its own queue. Retire the
  ambient queue/checkpoint substitute together when unsupported runtimes are
  dropped. [Event-loop notes](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-microtask-queue)
  retain the affected tests and exact replacement conditions.
- **`node-v8-execution-contexts`:** Custom job hooks capture controlled Promise
  callback/job boundaries; official engines lack those hooks. Neither exposes
  the entire execution stack or supplies HTML Script records. Browlet's explicit
  JavaScript context model tracks controlled entries and scoped native platform
  observations. Addon-backed `postMessage()` captures the author incumbent before
  Binding runs, including A-to-B-to-C calls and reentry. Stock Node lacks that
  native entry; the sender-attribution regressions remain expected failures there.
  Capture is selected from declared inputs, synchronous callback conversion, and
  forwarding dependencies; it does not reconstruct missing ScriptOrModule provenance.
  Constructors still lack native incumbent capture. When A calls B to construct
  C's MutationObserver, the converted callback incorrectly saves A instead of B.
  A callback-taking legacy factory fixture fails the same way; both are approved
  expected failures on all backends, with passing A-only controls. See the
  [constructor evidence](browlet/scripting/ROADMAP.md#constructor-callback-incumbent).
  Later Promise/async-sequence conversions depend on their own callback/job context.
  Job callbacks now recover the registering classic/source-text script from
  native compilation metadata, including registration after module await.
  Missing metadata still uses the modeled stack. Arbitrary author calls and
  module continuations outside that registration boundary still lack complete
  script attribution. A direct `reportError()` call from a function defined by
  script A while script B runs uses B's muted-errors flag; both opposite-flag
  comparisons are skipped by agreement, not classified as defects to fix. HTML leaves that
  script selection implementation-defined; Browlet retains explicit runner
  attribution and the modeled-script fallback without additional native capture.
  The A-to-B bound-listener
  investigation is skipped by agreement: its JavaScript observer's equivalence to
  the native API in HTML's examples is uncertain. Revisit with the actual example
  pages and platform APIs when supported. Manual stack selection/restoration tests
  do not establish automatic function-call tracking.
  The direct-host-entry fallback remains in place. See the
  [callback lifecycle record](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md#node-v8-execution-contexts)
  and [tests](../test/browlet/scripting/callback-lifecycle.test.ts).
- **Native cleanup reporting needs the addon.** With it, registry errors reach
  their Window's cancelable error event. Stock mode still reports through Node.
  Official Node 24/26 use private `_fatalException` interception; their explicit
  `--abort-on-uncaught-exception` flag can abort before that interception.
  Custom Node has a context reporter ahead of this policy, preserving Node's
  behavior for unregistered contexts. Both limits have expected-failure coverage.
  V8 still queues and runs cleanup; custom make/call hooks preserve callback
  state. On official addon bases, a guarded queue-completion notification now
  wakes the existing HTML checkpoint after native cleanup; custom Promise-job
  hooks already provide that wake-up. Whole-cleanup HTML task integration remains
  unaudited. The
  [audit](browlet/scripting/ROADMAP.md#81662-finalizationregistry-cleanup-scheduling)
  distinguishes that uncertainty from the repaired reporting and idle-progress defects.
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

Window's `HostGetCodeForEval` extracts retained TrustedScript data through Binding
and the native callback, preserving eval's scope and Node's checks. Stock mode
and official Node 24/26 addon builds cannot extract it: the latter lack the required
forwarding export. Custom/compat now enforces CSP's script-src/default-src
compilation restrictions and reports violations through the existing callback.
Stock and official addon modes cannot enforce these restrictions. The preceding
Trusted Types validation remains unconnected on every backend, including
`require-trusted-types-for` and default-policy checks on eval/Function. Thus
`trusted-types-eval` does not yet guarantee trusted input. Even custom Node's callback lacks compilation kind, original Function
parameter boundaries and argument identities, and reports `Function()`'s empty
body as CodeLike. The [four regressions](../node-compat/test/code-generation-gaps.test.cjs)
remain approved expected failures; full Trusted Types Function support is not
established. See the [native contract](../node-compat/README.md#string-compilation-and-source-extraction).

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

## Permissions

The general permission store, feature definitions/defaults, permissions task
source, and §§5.1–5.4 state lookup, requests, choices, and revocation are present. Only
`persistent-storage` is installed.
Reads apply secure-context and applicable Document policy checks, then use a
stored decision or constrained feature default. Storage shares that store.
New consent is supplied by `BrowletConfig.permissionPrompt` (default: deny),
then saved in a separate permissions task. Cross-origin storage requests cannot
ask for new consent, but existing decisions retain §5.2's short circuit. There
is no built-in prompt UI or cancellation of a still-open prompt on global
destruction. `BrowletConfig.permissionChooser` supplies single/multiple option
selection without changing permission state. It is called even when permission
is granted; no silent-choice cache is implemented. Device APIs supplying actual
options remain dependencies, as does cancellation of an outstanding chooser.
Revocation runs feature cleanup and removes the decision; Storage drops bucket
protection without deleting data. Pending host answers and queued decision writes
are not canceled by this operation; prompt-lifecycle coordination remains.
`navigator.permissions` now supplies a stable Permissions object, including in
insecure contexts. `query()` returns a fresh PermissionStatus with initial name
and state for installed features. Results refresh after store changes and on
Document reactivation, with trusted change events and listener-based retention.
Future Permissions Policy and feature-specific constraints must notify the
UserAgent when non-store inputs change. The WorkerNavigator partial awaits HTML
worker integration. Extra permission data and automatic expiry also remain
unimplemented. Future features must register their descriptor/result declarations
and supply any additional query behavior and state implications for ordered
descriptor aspects.
[Permissions Policy](browlet/browsing/policy/ROADMAP.md#permissions-policy) has feature
definitions, per-Document empty policy records, allowlist matching, and attribute
and response-header parsers. Iframe `allow`/`allowFullscreen` reflection and
declared-origin/container-policy processing exist. Fullscreen remains unregistered;
its legacy wildcard fallback is inactive. Document and iframe `permissionsPolicy`
objects retain stable identity and expose all four §7.2 inspection methods. The
queries check current observable policy without consulting a loaded iframe child.
Allowlist inspection follows the draft's default-origin gate and uses serialized
opaque origins; its browser differences and missing-declaration fallback are
documented in the policy roadmap.
Response Document creation combines container inheritance with the enforced and
report-only response headers, retaining their endpoint names separately. Feature-use
checks enforce policy and generate actual violations through shared Reporting,
including local observation without an endpoint. Potential iframe checks and
report producers exist but await the iframe load-event caller. Full child
navigation and script-location extraction remain unfinished. Request feature
checks use the initiating Window's policy and the populated request origin;
Client Hints and other request-feature consumers remain unimplemented. The helper
does not automatically restrict ordinary fetches, and it denies non-Window clients.
The permission store does not bypass that policy check.
Appendix B has an internal queued permission setter for caller-supplied settings,
keys, and one UserAgent. It does not provide WebDriver commands, session lookup,
protocol conversion, or automatic settings enumeration. Inactive target tasks
wait; a discarded task leaves completion pending until driver cancellation is
implemented. With no matching settings, decisions are stored for future
environments, following Chromium and Firefox rather than the appendix's task-only
application of state.
See the [Permissions roadmap](permissions/ROADMAP.md).

## Storage

Storage persistence decisions use the origin-wide permission store.
`navigator.storage.persisted()` reads bucket protection in secure Window globals;
`persist()` requests host consent and protects the default local bucket when granted.
`estimate()` reports local payload usage and the configured shelf quota. Populated
endpoints without accounting reject with TypeError; IndexedDB, Cache Storage, and
service-worker registration accounting still await those implementations.
HTML Web Storage enforces bottle and shelf quotas for growing writes.
WorkerNavigator integration, permission expiry, and outstanding-prompt
cancellation/concurrent-decision coordination remain unimplemented.
A granted decision permits explicit bucket protection; it does not provide disk
durability. The backend remains in memory.
See the [Storage roadmap](storage/ROADMAP.md#persistence-permission).

HTML's `Storage` interface supports reads and named-property lookup over acquired
maps. `StorageEvent` supports construction and legacy initialization. Window's
`localStorage`/`sessionStorage` getters acquire and cache per-Document holders,
rejecting opaque origins and denied acquisition with `SecurityError`.
Removal, named deletion, and clearing queue storage events for other matching
objects, with delivery gated by Document activity. `setItem()` and named writes
check bottle and shelf quotas before mutation and broadcast changed values.
Window's IDL `onstorage` receives these changes with its public WindowProxy receiver.
Body/frameset handler aliases,
inline handler compilation, and storage synchronization across separate
threads/processes remain pending.
Storage keys are origin-only; third-party partitioning/blocking, expiry,
per-site storage access policies, and coordinated cookie/storage clearing
remain unimplemented privacy-policy integrations.
See the [Web Storage roadmap](browlet/storage/ROADMAP.md).

## HTML integration gates

- **Temporal's HTML clock requires custom Node with the addon.** Windows in every
  isolation mode install their environment's live, precision-limited wall clock. Stock mode and
  official Node 24/26 retain the engine clock; Node 24 also disables Temporal by
  default. Concrete isolation uses live Document activity and Permissions Policy
  checks, including violation reports. The clock connection does not configure
  native AgentCluster isolation or complete child navigation.
  The callback accepts signed 64-bit bigint nanoseconds (roughly 1677–2262),
  narrower than Temporal's full Instant range. An out-of-range system clock or a
  throwing internal callback is a fatal contract violation, not an author-catchable
  exception. The HTML calculation retains its specified full-range clamp. See the
  [HTML audit](browlet/scripting/ROADMAP.md#8165-temporal-clock-calculation-and-installation-boundary) and
  [clock contract](../node-compat/README.md#temporal-clock).

- **Window messaging still depends on runtime and WindowProxy work.**
  `postMessage()` clones/transfers and queues trusted delivery with target-origin
  checks. Native entry now fixes the A-to-B-to-C sender fixture on addon backends;
  stock Node still reports A while expecting B and retains the expected failure.
  Binding has cross-origin invocation checks and
  caller-bound descriptor lookup and Get. Native WindowProxy access now selects
  that binding automatically; stock Node still lacks the caller boundary.
  WindowEventHandlers remain unimplemented. MessagePort transfer is implemented. See the
  [§9.3 dependencies](browlet/communication/ROADMAP.md#93-cross-document-messaging).

- **BroadcastChannel supports Window realms in one UserAgent.** Worker eligibility
  remains explicit unfinished work, with worker closing/suspension and cross-thread
  delivery still absent. Routing uses the existing origin-based StorageKey; it does
  not add browser-specific privacy partitioning. See the
  [§9.5 dependencies](browlet/communication/ROADMAP.md#95-broadcastchannel).

- **Channel messaging uses modeled agents in one isolate.** MessageChannel,
  MessagePort transfer, queued-message migration, and document cleanup work with
  existing Window realms. Worker/AudioWorklet globals, shutdown, and cross-thread
  transport remain separate integrations. Entangled ports and pending tasks are
  retained conservatively; see [§9.4](browlet/communication/ROADMAP.md#94-channel-messaging).

- **EventSource lifetime is conservative.** Active sources remain retained until
  `close()` or permanent Document cleanup; listener-sensitive collection is not
  implemented. Worker globals and navigation-driven destruction remain separate
  integration gates. See the [communication roadmap](browlet/communication/ROADMAP.md#92-eventsource).

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
and speculative loading remain no-ops. Speculation-rule parse-result creation
now calls an explicitly unfinished parser and retains author parse exceptions;
the parser's InternalError escapes. Window registration/removal/replacement
maintain the associated Document's rule-set list and report parse errors
synchronously or through DOM manipulation tasks. The rule-set record is
empty-only pending §7.6's full rule model. Tests supply parser results; no source
string can produce a usable rule set or speculative request through this path yet.
`HTMLScriptElement` has a dedicated implementation/platform identity and result
state, plus `crossOrigin` and `referrerPolicy` reflection, without its preparation
algorithm. Link and script reflection uses the shared HTML attribute definitions,
but element fetching and `[CEReactions]` delivery remain missing. The credentials
mapper and potential-CORS request factory do not by themselves implement resource
loading. Fetch applies populated referrer policies, and supplied-response navigation
now associates the header with its document. Meta referrer processing and hyperlink
`rel=noreferrer` still lack their HTML consumers; complete referrer-policy precedence
is not implemented. Iframe referrer reflection and selection exist, with child
request/navigation integration still unfinished.
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

Nested/auxiliary creation stops at explicit missing creator-state inheritance and
child lifecycle operations. Ancestor-origin calculation and referrer-policy masking accept
the known parent document before activation; they do not complete those
[child-navigation dependencies](browlet/html/ROADMAP.md#section-313-ancestor-origins).
`Window.open()` supports empty-URL calls to existing `_self`, `_parent`, and `_top`
targets. Named lookup, new-window creation, and nonempty-URL navigation still
throw at explicit unfinished operations. Feature processing and the new/existing
opening branches are connected, but CSSOM View geometry and URL/history effects
remain unfinished. `close()` and `stop()` also require their lifecycle operations;
see the [Window audit](browlet/browsing/window/ROADMAP.md#html-7221-opening-and-closing-windows).
`Window.length` now counts current document-tree child navigables, using retained
iframe/object/frame associations. Those associations still require internal
creation/destruction producers; appending a container alone creates no child.
Valid numeric `window[index]` lookup uses container insertion order on the stock
proxy, and enumeration includes the current index prefix. Caller-bound own-descriptor
lookup now implements missing-index security, declared cross-origin members, named
children, and fallback keys. Caller-bound property definition rejects same-origin
numeric indices and all foreign definitions. Caller-bound Get/Set run the COOP
access check before property access. Get preserves the receiver through same-origin
prototype lookup; Set rejects same-origin indices and requires a permitted setter
for foreign writes. Caller-bound Delete protects present child indices and rejects
all foreign deletions. Caller-bound key lists now select the ordinary or cross-origin
tail after the live index prefix; missing focus/blur declarations still leave the
foreign list incomplete. Location writes still reach unfinished navigation. Native
foreign access now selects these bindings automatically; stock traps still lack
caller selection. Same-origin V8 access bypasses the caller-bound algorithms.
Automatic same-origin indexed mutation is connected, with the native absent-index
explicit-receiver exception described above; see the
[WindowProxy audit](browlet/browsing/window/ROADMAP.md#html-723-indexed-child-reads).
`Window[name]` resolves eligible names/IDs, stable live collections, and retained
child navigables through Web IDL's named-properties prototype. Child creation and
template contents still need their producers. HTML's same-origin-only child-name
rule differs from Blink/Gecko's matching-container-name allowance; Browlet follows
HTML, as recorded in the [named-access audit](browlet/browsing/window/ROADMAP.md#html-7223-named-access).
Related-window getters, opener assignment, six historical bars, and status are
implemented. Container removal does not yet destroy its child browsing context.
Bar visibility follows HTML's true result after context detachment; a retained
context with no fully active top-level context stops at an explicit specification
gap. See the [related-window and bar audits](browlet/browsing/window/ROADMAP.md#html-7224-accessing-related-windows).
Window settings follow the current associated Document. Their cross-site-ancestor
query retains a conservative true result without a navigable, a case HTML leaves
unspecified. Concrete isolation denies capability without full Document activity,
then checks the Document's Permissions Policy and reports actual violations; see
the [settings audit](browlet/browsing/window/ROADMAP.md#html-7226-script-settings-for-window-objects).
Location now reads its browsing context's active Document and checks the entry
origin before exposing URL components or ancestor origins. `Document.location`
returns null for inactive Documents; retained Location reads and detachment follow
HTML's live-Document/about:blank rules despite browser disagreement. Ancestor lists
retain their creation realm even when first exposed through an older Location.
Location creation now installs the realm's captured intrinsic `valueOf` and an own
undefined `Symbol.toPrimitive`, protecting string conversion from inherited author
replacements. The accepted `SPEC_CLASH(location-default-properties)` follows browsers:
initial properties are nonconfigurable, unchanged definitions succeed, and replacement
or deletion fails. HTML's descriptor rewriting and `[[DefaultProperties]]` are
deliberately omitted. Location's physical prototype is now immutable and it stays
extensible: Reflect.preventExtensions returns false, while Object.preventExtensions,
seal, and freeze throw. Caller-bound prototype algorithms expose null to a foreign
caller and compare against that visible prototype. The addon now connects all
Location internal methods automatically: prototype reflection, descriptors,
definitions, Get/Set, deletion, keys, and ordinary HasProperty use the accessing
realm. Native handler lookup captures that realm before JavaScript trap entry,
including borrowed reflection methods. Stock Node cannot capture this input or
change frozen-property visibility; its 12 automatic-dispatch regressions retain
approved expected-failure status. Href, assign, and replace parse
against entry settings. Component setters parse copies of the current URL;
search uses UTF-8 regardless of Document encoding and hash suppresses unchanged
fragments. Navigation requests target the live relevant Document's node navigable
with the incumbent source Document, including through a retained
Location whose old Window is inactive. Disconnected Locations return without
navigation. The specification gap and browser disagreement are recorded with
Location. Actual navigation remains unfinished; writes before complete loading
also require Window transient activation. Reload now returns for a null relevant
Document, checks the entry origin, and calls the live Document's navigable.
Its coordinator still throws explicitly: Navigation API cancellation and queued
reload history processing remain unfinished. Stock Node still needs an explicit
modeled incumbent for calls through another realm's author function. The [navigation slice](browlet/browsing/window/ROADMAP.md#html-724-third-slice-href-assign-replace-and-navigation-handoff)
records these dependencies; the [component setter audit](browlet/browsing/window/ROADMAP.md#html-724-fourth-slice-url-component-setters)
records the accepted parsing/encoding clashes and browser evidence. The [decision review](browlet/browsing/window/ROADMAP.md#location-descriptor-decision-review)
records the evidence and rejected alternatives; the [native dispatch slice](browlet/browsing/window/ROADMAP.md#html-724-native-location-dispatch)
records the delivered engine connection and integration boundary.
Policy inheritance, child navigation, history disposal, and storage-shed
cloning remain with [browsing](browlet/browsing/ROADMAP.md) and
[navigation](browlet/browsing/navigation/ROADMAP.md). Custom-element registry
identity is present; reactions and upgrade behavior remain with
[custom elements](browlet/dom/nodes/html/custom-elements/ROADMAP.md). Fetch's remaining
work and provisional consumer hooks stay in its [single roadmap](fetch/ROADMAP.md).

`document.domain` now validates and records relaxation, and origin-keyed clusters
suppress valid assignments. This does not implement WindowProxy/Location's
cross-origin access enforcement. The OAC header and `originAgentCluster` expose
modeled cluster selection, without native execution isolation or WebAssembly.Module
cloning/delivery. `Origin.from()` supports strings, URL, Origin, and Window
objects, including WindowProxy and entry-origin access checks. Direct host calls
without an HTML entry use the operation environment. Worker globals remain
unfinished. Anchor and area have nullable URL slots and extraction, but their
href/base URL lifecycle is still a stub. MessageEvent has its public constructor,
initialization, origin state, and extraction. EventSource and Window messaging
deliver it with the remaining [communication dependencies](browlet/communication/ROADMAP.md).
These producers remain incomplete even though extraction can consume their
internally supplied records. The
[origin audit](browlet/browsing/ROADMAP.md#same-origin-relaxation-origin-and-origin-keyed-clusters)
records each missing owner and integration.

Supplied-response navigation applies COOP headers and required context/group
changes. Report-only policies can change the virtual group identifier without
moving the document. COOP plus COEP selects logical isolation: agent keying changes,
while `crossOriginIsolated` remains false. This supplies neither physical isolation
nor complete WindowProxy/Location access security or opener-reference severance.
Fetch redirect-loop integration, popup inheritance, and sandboxed COOP network
errors remain unfinished. COOP navigation reporting throws when a configured
endpoint needs a report in a group shared with another context; the required
URL-scoped queue and access reports are explicit dependencies in the
[policy audit](browlet/browsing/policy/ROADMAP.md#html-713-cross-origin-opener-policies).
The caller-bound access check now filters declared cross-origin names, checks live
origin ancestry and virtual groups, and classifies opener relationships. Caller-bound
WindowProxy Get/Set invoke it before property access, including permitted child reads
and rejected writes.
Native foreign Get/Set reaches these checks; ordinary same-origin V8 access and
stock-Node traps still need the integration. The dispatcher still throws
for eligible accesses; tests intercept it to inspect inputs and ordering, without
establishing report construction or delivery. Missing Window declarations,
including focus/blur, also leave the annotation-derived property list incomplete.

COEP navigation and dedicated-worker inheritance checks and observer reports are
implemented, but automatic child creation/destruction, navigation network-error handling,
and worker startup still prevent complete enforcement through those lifecycles.
The new abstract worker globals expose no author-facing Worker API. Inheritance
reports omit CORP's destination member and preserve local observation even with
an empty endpoint or outbound delivery disabled. Private Network Access and
Opaque Response Blocking remain absent; the
[COEP audit](browlet/browsing/policy/ROADMAP.md#html-714-cross-origin-embedder-policies)
records these dependencies without claiming physical isolation.

Sandbox parsing, iframe attribute state, and creation-flag propagation exist,
but complete sandbox enforcement does not. Navigation permission checks still
allow provisionally; popup/target selection, forms, pointer lock, automatic
features, dialogs, orientation, presentation, and downloads lack their consumers.
Policy-container response creation, inheritance selection, local history retention,
and worker initialization are implemented independently of the missing full
iframe/navigation/history/worker lifecycles. Unassociated containers still use
an absent CSP list until a self origin is available. The
[§§7.1.5–7.1.7 audit](browlet/browsing/policy/ROADMAP.md#html-715-sandboxing)
maps every flag and remaining owner; partial worker globals still expose no IDL.
