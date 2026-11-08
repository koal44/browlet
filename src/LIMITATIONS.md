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

**`node-function-source-name`:** Stock Node's `vm.compileFunction` exposes no
operation for setting V8's retained source name. Compiled inline handlers have
the correct `.name`, realm, scope, and behavior, but their intrinsic
`toString()` omits the name. All three addon bases supply the name using public
V8 `Function::SetName`, without an engine patch. The exact source-text assertion
is an approved stock-only expected failure in the
[function-compilation tests](../test/js-engine/function-compilation.test.ts).

**`proxy-function-source-name`:** V8's function compiler rejects JavaScript Proxy
scope objects, including Browlet's platform Document. JS Engine uses a validated
FunctionBody and a `with`-scope factory for these cases. Stock Node preserves
behavior, object identity, and `.name`, but intrinsic `Function.prototype.toString()`
shows an anonymous function. Its exact named-source assertions remain approved
stock-only expected failures. All three addon bases use a declaration factory
with a deletable name binding, preserving named source without changing live
lookup. This requires only the maintained addon, with no Node/V8 patch.

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
  Ordinary Wasm construction, compilation, cloning, and export projection establish
  platform ownership on every backend. Native Exceptions can originate directly
  in the engine, but their public-interface integration is currently unfinished
  on every backend; see the Web IDL boundary below. Raw engine Wasm objects are
  not accepted as platform arguments; host
  integration wraps them in their implementation and projects them explicitly. See the
  [Module tracking tests](../test/browlet/webassembly/module-tracking.test.ts).
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

- **`window-idle-rendering`:** `requestIdleCallback`, cancellation, deadlines,
  and timeout delivery are implemented for the headless Window runtime.
  AnimationFrameProvider supplies callback state, but a production rendering host
  must still connect pending-frame predictions and refresh rate through
  `EventLoopInit.idleRendering`.
  The implementation does not invent a display rate or simulate rendering. See the
  [idle-period dependencies](browlet/scripting/ROADMAP.md#html-8173-idle-period-processing).

- **`animation-frame-production`:** Window and dedicated-worker request/cancel
  APIs and per-target callback controllers are implemented. Window delivery is
  connected to the existing rendering phase, but its refresh/display host is not
  installed by the headless runtime. Dedicated-worker rendering-opportunity and
  delivery production remain unfinished. Registration alone therefore does not
  cause an automatic frame; tests explicitly supply opportunities or delivery.
  See the [§8.12 boundary](browlet/scripting/ROADMAP.md#html-812-animation-frames).

- **Forcibly aborting scripts on the shared Node thread remains deferred.** Browlet,
  page JavaScript, and the Node caller share a JavaScript execution thread. An
  infinite loop prevents same-thread callers, timers, and abort listeners from
  requesting a stop. `Agent.abortRunningScript()` explicitly throws an
  unfinished-operation error; no watchdog or independent stop channel is supplied.
  Changing `scriptingEnabled` blocks later HTML entries, and navigation's local
  evaluation cancellation rejects host commands and removes queued work. Neither
  interrupts executing JavaScript. We retain direct synchronous host access and
  defer native termination work; this does not imply that external interruption
  is impossible. Independent workers have a separate native stop path through
  `WorkerThread.terminate()`, including dedicated outside-port cleanup; that
  whole-isolate operation does not interrupt a Window while retaining its Node
  caller. See the [killing audit](browlet/scripting/ROADMAP.md#html-8145-killing-scripts).

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
  explicitly retains its script for reporting. Window's five-argument `onerror`
  handlers work; dedicated-worker propagation is not implemented. `reportError`
  follows HTML's muting algorithm despite its noted Firefox disagreement. See
  the [runtime-error audit](browlet/scripting/ROADMAP.md#html-8146-runtime-script-errors).

- **HTML event handlers are partially implemented.** Existing IDL handlers retain
  callback identity and listener order, check the target's BiDi scripting policy,
  and skip callbacks whose own Window Document is not fully active. Window's
  `onerror` uses five arguments and cancels only on boolean `true`. Current-event
  bookkeeping follows the callback's realm, including handler replacement;
  Chromium/WebKit agree, while Firefox uses the target's realm. Body/frameset
  Window handlers and the six Window-reflecting names forward to the current
  active Document's Window, including after adoption. HTML's GlobalEventHandlers,
  the ordinary WindowEventHandlers, and Document-only handlers are connected.
  `onbeforeunload` is exposed, including nullable DOMString callback conversion,
  cancellation, and preservation of an existing event return value. Document's
  beforeunload producer now dispatches the trusted event, maintains counters, and
  applies the sandbox/sticky-activation/request gates. User-agent anti-abuse policy
  and confirmation UI still throw at their explicit owners. Navigation's queued
  multi-Document coordinator is connected, including the optional traversal event
  pair. Removed check tasks reject their internal wait; full history application
  and cancellation of in-flight population still need their lifecycle integration.
  Internal handler/listener erasure works for existing targets; `document.open()`
  still needs its §8.4 selection and lifecycle hookup.
  BiDi has no session overrides yet. See the
  [event-handler audit](browlet/scripting/ROADMAP.md#html-8181-event-handler-idl-invocation).

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

- **`node-module-settlement-reporting`:** Official Node 26 can misreport a throwing
  Promise settlement hook's error as the module evaluation error. Bare Node
  reproduces it. The addon's guarded metadata query avoids exposing the engine
  defect through its own observer, but does not repair unrelated hooks. Custom
  Node retains the upstream module-evaluation fix. See the
  [queue observation contract](../node-compat/README.md#contexts-globals-and-optional-facilities).

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
  supplies Wasm ESM graphs, now connected through HTML's parser and ordinary graph
  loader with callback-aware instantiation. Stock mode lacks a public Wasm VM
  class; Long Animation Frames creation timing remains unfinished. Module
  graph orchestration covers document, worker, and worklet entry points, including
  shared worklet responses. Static JavaScript/CSS/JSON/text dependencies now fetch,
  link, and evaluate through the existing graph entry points. Static Wasm source
  imports work on all addon bases and return the public Module without loading
  its dependencies. Dynamic `import.source(url)` also works on custom/compat;
  official addon bases lack the existing dynamic-import forwarding export.
  Object-valued `import(moduleObject)` and deferred imports remain unfinished.
  Dynamic evaluation-phase imports load, link, and
  wait for evaluation through HTML, including top-level await. The addon accepts
  Node-shaped import and metadata callbacks with their respective forwarding
  exports in the combined Node patch; official addon bases retain expected
  failures for these facilities. HTML's `import.meta.url` and `resolve` work on
  custom/compat and stock VM modules; official compat bases still receive empty
  metadata. The [integration tests](../test/browlet/scripting/import-meta.test.ts)
  retain those expected failures. Isolated worker `importScripts()` now waits on
  its browser-side Fetch connection without running author jobs. Same-isolate
  callers still need a synchronous hook: pausing cannot make asynchronous I/O
  complete on the blocked thread itself. Ordinary HTML script-element loading
  remains separate from the connected worker loaders. See the
  [script-creation audit](browlet/scripting/ROADMAP.md#html-8143-creating-scripts).

- **Wasm namespace lookup currently covers the addon bridge.**
  `WebAssembly.namespaceInstance()` returns an existing bridge-owned Instance,
  including from another context, without instantiating it again. HTML's Wasm
  parser now produces these records with the addon. Stock Node/Node-loader Wasm
  namespaces have no public record association. Ordinary JS/synthetic namespaces,
  exports objects, and proxies are rejected. `SPEC_GAP(wasm-namespace-before-execution)`:
  the draft returns an empty internal slot before execution; Browlet provisionally
  throws ReferenceError without evaluating the module. See the
  [ESM opening review](browlet/webassembly/ROADMAP.md#esm-opening-review-sections-1-through-5).

- **Native Wasm CSP interception requires the addon.** CSP §4.5.1 now governs
  Browlet's byte/response compilation APIs on every backend, with realm-correct
  CompileError and violation reporting. All addon bases also enforce it at native
  compilation entry points and HTML's Wasm module parser, preserving Node's checks.
  Stock Node cannot intercept retained native constructors/functions used directly
  by the host; its Wasm ESM parser remains unsupported. Worker policy setup and
  global violation reporting remain dependencies. Fetch policy is separate. See
  [CSP integration](browlet/browsing/policy/csp/ROADMAP.md#wasm-compilation-consumer-451).

- **Native Wasm task ownership requires the addon.** All addon bases now deliver
  native compilation/instantiation Promise resolution through the owning HTML
  task, including module thenable assimilation; response compilation selects
  networking while ordinary compilation/instantiation use the engine source. Stock Node makes automatic
  progress through its native queue but cannot install that task/lifecycle handoff.
  The addon assumes Node's default V8 Wasm resolver for unregistered contexts;
  chaining another embedder's replacement of the isolate-wide callback is unsupported.
  See the [completion contract](browlet/scripting/ROADMAP.md#native-webassembly-completion)
  and [regressions](../test/browlet/scripting/wasm-completion.test.ts).

- **Wasm host-callback integration remains partial.** Constructor, Module, byte,
  and response instantiation adapt imported JavaScript functions using the existing
  realm callback hooks. Callback bodies run with script/callback preparation and
  cleanup, including nested calls and throws; native Wasm functions and other
  import values retain their identities. With the addon, a generated Wasm bridge
  finishes scalar coercion and multi-value iteration inside that scope, including
  throws. Stock mode still performs that conversion after cleanup; its four
  expected-failure regressions retain the gap. The addon's narrow metadata reader rejects
  unsupported experimental shared-everything/descriptor/continuation/string-view
  types, exact-function imports, and unknown binary encodings on first adapted
  invocation. Revisit this before enabling those proposals or upgrading to a
  runtime that enables them by default. Custom page-size limits are future
  compatibility work; the current V8 decoder does not accept them. Ordinary
  shared memories and memory64 are supported. The bridge adds a Wasm round trip
  and caches bridges by Module/signature.
  See the [addon contract](../node-compat/README.md#webassembly-imported-function-conversion).
  Native entry capture now saves B when A calls B to import a callback from C,
  while its later body runs in C's modeled realm. Constructor, Module, and byte
  instantiation all declare that requirement. Stock backends without the add-on
  still save A; the three ordinary regressions retain that limitation. This is Wasm
  import integration,
  not skipped Web IDL argument conversion: imports are intentionally an IDL
  `object`, not a callback dictionary. See the
  [§5.6 review](browlet/webassembly/ROADMAP.md#56-reviewed-exported-functions-and-the-host-callback-boundary).

- **`SPEC_CLASH(wasm-module-start-timing)`:** Native `WebAssembly.instantiate(module)`
  reads imports and runs the start function before returning. The draft requires
  synchronous import reads followed by instantiation in a later task. Chromium
  matches V8; Firefox and WebKit defer startup. Browlet accepts this existing V8
  limitation for now. The addon's completion hook runs after instantiation, so it
  does not repair this ordering. The
  [specification regression](../test/browlet/webassembly/instantiation.test.ts)
  and [audit](browlet/webassembly/ROADMAP.md#5-audit-imports-and-compiled-module-instantiation)
  retain the required ordering and the standards discussion; acceptance does not
  establish a specification exception or a documented V8 compatibility rationale.

- **`SPEC_CLASH(wasm-js-tag-realms)`:** V8 creates a separate JavaScript-exception
  tag per context; the draft requires one cached tag per Agent. A Wasm instance
  using another realm's `JSTag` cannot catch ordinary JavaScript throws, and V8
  allows `new Exception(foreign.JSTag, ...)` instead of rejecting it. Binding the
  namespace getter does not repair those engine comparisons. The three
  [cross-realm regressions](../test/browlet/webassembly/js-tag.test.ts) retain the
  draft assertions as approved expected failures. Browser comparisons and the
  engine boundary are recorded in the [JSTag audit](browlet/webassembly/ROADMAP.md#5-audit-javascript-exception-tag).

- **`SPEC_CLASH(wasm-nonfunction-builtin-import)`:** With `js-string` enabled,
  V8 treats a global named `wasm:js-string.test` as an ordinary import. The draft
  selects the builtin by name and rejects the non-function type; Firefox and
  WebKit agree with the draft. Browlet retains Chromium's behavior, covered by an
  ordinary [compatibility test](../test/browlet/webassembly/builtins.test.ts).
  The [builtin review](browlet/webassembly/ROADMAP.md#6-foundation-and-611613-reviewed-builtin-selection-cast-and-test)
  records the browser comparison and engine boundary.

- **`SPEC_CLASH(wasm-from-code-point-result)`:** The draft declares a nullable
  `externref` result for `wasm:js-string.fromCodePoint`. Browlet retains the
  non-nullable `(ref extern)` signature required by all three browsers and the
  original proposal. Both accepted and rejected signatures have ordinary
  [compatibility tests](../test/browlet/webassembly/strings.test.ts); the
  [string review](browlet/webassembly/ROADMAP.md#6166114-reviewed-remaining-string-operations)
  records browser evidence and WebKit's explicit signature correction.

- **`SPEC_CLASH(wasm-substring-unsigned-offsets)`:** Browlet retains Chromium's
  unsigned offsets for `wasm:js-string.substring`, matching Firefox and the
  original proposal. The draft's signed `ToJSValue` conversion changes results
  for large end offsets; WebKit has a third behavior. Ordinary
  [compatibility tests](../test/browlet/webassembly/strings.test.ts) preserve the
  chosen results, with the comparison recorded in the string review above.

- **Native Wasm resource limits remain engine-owned.** Fatal out-of-memory
  handling can terminate Browlet's shared Node process; successful recovery from
  ordinary traps or stack overflow does not promise recovery from heap exhaustion.
  The [error/limit review](browlet/webassembly/ROADMAP.md#78-reviewed-error-conditions-and-implementation-limits)
  distinguishes tested boundaries from source-only resource-limit review.

- **`SPEC_CLASH(wasm-module-memory-count)`:** Browlet retains Chromium's acceptance
  of more than 100 memories per module (V8 caps the count at 100,000). The draft,
  Firefox, and WebKit cap it at 100. The
  [compatibility test](../test/browlet/webassembly/limits.test.ts) uses empty
  memory declarations without instantiating them.

- **`SPEC_CLASH(wasm-memory64-declaration-limit)`:** V8 rejects memory64 maximum
  declarations above 262,144 pages (16 GiB), even with an initial size of zero.
  The draft, Firefox, and WebKit permit declarations up to 2^37 − 1 pages while
  separately limiting actual growth. Browlet retains Chromium's narrower range;
  the same limit suite preserves the accepted and rejected declarations.

- **Wasm ESM has two retained binding gaps and a guarded re-export hack.** The addon runs supplied mixed
  JavaScript/Wasm graphs, but mutable globals exported to JavaScript are snapshots,
  and `v128` exports read as undefined instead of remaining uninitialized. On
  reviewed Windows x64 V8 builds, private binding-identity reads recover native
  globals through JavaScript re-exports. Unknown builds retain the original
  re-export LinkError; same-version custom layout changes still require manual
  review. Direct Wasm-to-Wasm imports retain their globals and memory. The
  [expected-failure tests](../node-compat/test/wasm-gaps.test.cjs) and independent
  [Node controls](../node-compat/test/wasm-node-gaps.test.cjs) retain the requirements,
  with re-exports passing normally on the guarded addon builds. Node's own loader
  still has all three gaps. See the [bridge contract](../node-compat/README.md#webassembly-modules).

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
- **Direct host calls are not HTML tasks.** Calling a projected API from Node
  does not itself establish a checkpoint boundary. Use the
  [automation entry](browlet/automation/README.md) for page commands; a broader
  embedder contract must define direct-call/Promise interoperability. Do not
  hide this by checkpointing after every Web IDL operation. The official addon
  fallback now wakes a queue for its own Promise settlements, including Atomics
  and direct resolver calls. A raw Node-owned Promise given a Window reaction,
  or a host call attaching a reaction to an already-fulfilled Window Promise,
  can still enqueue into that Window without notifying it. The serialized
  `exposeFunction()` bridge supplies its own delivery boundary. The
  [raw-handoff regressions](../test/browlet/scripting/host-promise-handoff.test.ts)
  are TODOs on official addon bases pending that interoperability contract;
  passing stock/custom configurations remain active.
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
  Sources: [environments](browlet/environment/environment.ts),
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

Realm-owned internal Promise completion catches escaping observer exceptions and
reports them through Node's host failure path before the discarded result can
become an author-visible rejection. This fixes internal error ownership without
removing the extra native Promise or changing the raw observation primitive.
See the [internal observer regression](../test/browlet/scripting/promise-observers.test.ts).

## Buffers and engine internal slots

- **WebAssembly Memory buffer conversion on Node 24:** Its engine lacks
  `toFixedLengthBuffer()` and `toResizableBuffer()`, with or without the addon.
  Node 26 and the custom build provide both. The two approved Node-24-only
  expected failures retain the required behavior and detect an unexpected pass;
  copying buffers cannot preserve live Wasm storage. See the
  [Memory review](browlet/webassembly/ROADMAP.md#53-reviewed-memories).
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

- **`SPEC_CLASH(wasm-gc-reflection)`:** Native Wasm structs and arrays remain
  opaque engine objects. Browlet follows Chromium's TypeError from
  `Reflect.preventExtensions()` and `Reflect.defineProperty()` where the draft
  requires `false`; ordinary Object
  mutation operations throw either way. Ordinary compatibility tests assert this
  accepted behavior. Node 24's older V8 also throws for
  `Reflect.setPrototypeOf()`, which newer builds correctly reject with `false`.
  Only that older-engine difference retains expected failures.
  Native identities, typed references, same-Agent cross-realm round-trips and
  callback results are preserved. A Proxy
  cannot repair reflection without losing typed-reference recognition. See the
  [GC-object review](browlet/webassembly/ROADMAP.md#58-reviewed-garbage-collected-objects).
- **WebAssembly Tag bindings:** Ordinary construction converts the draft's iterable
  `ValueType` sequence and preserves derived prototypes. `WasmTagImpl` keeps V8's
  native signature and tag identity private. Engine-only reference kinds are
  rejected, as for Global construction. Engine exports and `JSTag` are projected
  into owned platform objects. The accepted cross-realm `JSTag` failures are unchanged. See the
  [Tag review and browser comparison](browlet/webassembly/ROADMAP.md#57-reviewed-tags).
- **WebAssembly Exception integration:** Exceptions use an ordinary implementation
  with a private native backing. Binding converts tags, iterable payloads, options,
  and indices and establishes construction ownership on every backend. The special
  native adoption bridge has been removed for redesign. Wasm-thrown Exceptions do
  not yet use our public prototype or accept public Tags through their native methods;
  public Exceptions thrown back into Wasm are not recognized by native tagged catches.
  Captured own stack data is also not projected. These desired behaviors remain
  ordinary failing regressions on all backends. `SPEC_CLASH(wasm-exception-stack)`
  still records the intended Chromium-compatible stack shape; fractional indices
  use ordinary Web IDL truncation. The separate cross-realm JSTag limits remain.
  See the [migration notes](browlet/webassembly/ROADMAP.md#implementationplatform-migration).


- **`SPEC_CLASH(wasm-cached-source-url)`:** Streaming compilation now supplies the
  fetched Response URL to Node/V8. V8 and Chromium retain the first diagnostic
  URL for identical bytes: an earlier byte compilation can leave a generated
  Wasm URL, or a later fetch can show the first fetched URL. Firefox preserves
  each streaming URL. Browlet keeps the approved Chromium cache behavior with
  ordinary compatibility tests. Native names, indices, and offsets are retained;
  the private Node Response adapter preserves completion and error ownership. See the
  [Web API closing review](browlet/webassembly/ROADMAP.md#4–7-and-closing-material-reviewed).
- **WebAssembly Global bindings:** A separate implementation holds V8's typed
  storage; ordinary Binding owns construction and value conversion. Native
  recognition uses the addon's private type helpers or the public import/re-export
  probe. Both avoid reading values; source comments document their tradeoffs.
  Native exports are wrapped and projected in their instance's known realm.
  See the [Global review](browlet/webassembly/ROADMAP.md#55-reviewed-globals).
- **WebAssembly Table bindings:** The constructor exposes the draft's externref
  and anyfunc kinds. Runtime overloads preserve omission versus explicit undefined
  for grow/set and the accepted browser error precedence. The generated TypeScript
  surface uses equivalent optional parameters. See the
  [Table audit](browlet/webassembly/ROADMAP.md#54-reviewed-tables).


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
not establish end-to-end focus support. UI Events' FocusEvent constructor,
relatedTarget conversion/retargeting, and legacy event creation are available;
they do not implement HTML §6.6's automatic focus transitions or event production.

InputEvent exposes UI Events' data/isComposing/inputType constructor data and
Input Events Level 2's dataTransfer and getTargetRanges/targetRanges partials.
Supplied transfers and StaticRanges retain their identities and realms; ranges
remain unchanged through DOM mutations and synthetic dispatch. The internal
trusted-event factory applies the host/inputType attribute tables to explicit
producer facts and packages supplied rich data in read-only transfers. It does
not dispatch or edit. HTML editing, affected-range calculation, rendered
HTML/plaintext extraction, and IME producers remain unfinished; EditContext
preparation explicitly throws. Existing keyboard/clipboard editing entries still
throw; synthetic beforeinput/input dispatch does not edit content. See the
[Input Events preparation slice](browlet/interaction/events/ROADMAP.md#input-events-level-2-sections-61262-trusted-preparation)
and [closing audit](browlet/interaction/events/ROADMAP.md#input-events-level-2-closing-audit-2026-11-06).
Automatic edit delivery, real composition sessions and paste-to-edit ordering are
explicitly deferred to those owners; the composition event-order conflict between
UI Events and Input Events is still unresolved.

KeyboardEvent construction, all specified modifier queries, legacy initialization,
and DOM's legacy factory are available. The companion key-selection algorithm
and key/code vocabularies are also implemented; constructor strings bypass their
producer rules. Native layout lookup, key-string classification, and glyph-only
text translation remain required adapter inputs. UserAgent.keyboardInput now retains
post-transition modifier snapshots and queues trusted keydown/keyup through HTML
user-interaction tasks. Each event selects current focus and its target's realm;
canceling a press gates ordinary effects without dropping its release. No native
keyboard listener or GUI adapter exists. Document focus and activation notification,
focus traversal, editing, Clipboard commands and IME effects remain named throwing
dependencies. Synthetic keyboard dispatch does not enter the producer.
See the [keyboard delivery boundary](browlet/interaction/keyboard/ROADMAP.md#queued-keyboard-delivery-2026-11-05).
The [keyboard slice](browlet/interaction/events/ROADMAP.md#section-35-event-objects-and-keyboard-ordering)
records those dependencies and the approved modifier/legacy browser differences.

CompositionEvent construction, legacy initialization, and DOM's legacy factory
are available. An internal trusted factory prepares §3.6.7's flags, view and data
from the producer's selected target and text. It does not dispatch, create an IME
session or edit text. Composition sequencing and isComposing state need the input
producer; UI Events and Input Events also disagree on compositionupdate/beforeinput
ordering and cancelability. Those boundaries remain explicit in the
[composition audit](browlet/interaction/events/ROADMAP.md#section-36-event-objects-and-composition-dependencies).

TextEvent's legacy factory and initializer are available; its interface has no
author constructor. Synthetic textInput dispatch delivers listeners/cancellation
without editing, following Chromium/Firefox rather than WebKit. Trusted textInput,
keypress, and legacy focus/activation production remain unfinished, with native
ordering conflicts documented in the [legacy audit](browlet/interaction/events/ROADMAP.md#sections-68-legacy-audit-and-textevent).

UI Events §5's internal mouse-movement initializer and Window-owned coordinate
deltas are implemented. MouseEvent now exposes construction, modifiers, related
targets, legacy initialization/factory names, and movement fields. Its layerX
and layerY getters throw explicitly because CSS layout/painting geometry is
missing; CSSOM View's page/offset coordinates and x/y aliases are not exposed.
The native adapter, input-gap notification, locked/raw deltas, and Pointer
Lock APIs remain unfinished. MouseEvent's internal creation now accepts normalized
input and explicit flags through the target's realm allocation. As with existing
PointerEvent creation, its producer must finalize event-specific fields and trust
before dispatch; the factory does not supply native device input. The
[MouseEvent prerequisite](browlet/interaction/events/ROADMAP.md#pointer-events-12-and-the-3-mouseevent-prerequisite)
records the approved coordinate/legacy choices without claiming device input.

PointerEvent now exposes constructor data, orientation conversion, and copied
coalesced/predicted lists. Its constructor does not register devices, manage active
pointers/capture, generate trusted samples, or perform hit testing. Native stream
delivery now prepares trusted sample lists from supplied input; the device adapter,
HTML's synthetic-pointer-event hookup, and inherited CSS geometry remain unfinished.
The aggregate mouse source keeps persistentDeviceId=0 because it identifies no
individual hardware device. Future identified-device producers must use page/session
identities, randomized for a new session, rather than expose hardware identifiers.
Optional prediction must not use additional sensitive history outside the current
gesture. These producer constraints are recorded in source; author-supplied IDs
and sample lists remain ordinary untrusted constructor data.
The [PointerEvent object slice](browlet/interaction/events/ROADMAP.md#pointer-events-31-pointerevent-objects-and-orientation)
records the approved rounding, orientation, and returned-array realm choices.
UserAgent now retains active input sources with per-type primary selection and
chorded button transitions. A UserAgent-owned mouse producer now accepts normalized
button actions, queues user-interaction tasks, and registers context-local mouse
streams before pointer/capture/mapped mouse delivery. Other devices, source
retirement, and native adapter/WebDriver Actions integration remain unfinished.
Author construction and dispatch do not mutate input state. DOM removal now
repairs each registered stream's previous boundary target before reinsertion, using
the same stream scan as capture cleanup. Per-Document stream retirement is still
unfinished; the existing top-level teardown alone does not supply that lifecycle.

Pointer Events §6 exposes `Navigator.maxTouchPoints` and selects BiDi emulation
before hardware capacity. The native digitizer query is an explicit throwing
dependency, so ordinary reads still fail until an input host supplies it. Active
BiDi sessions and scoped touch overrides are also unfinished; the selector returns
null in their absence. Tests supply these narrow queries through real bindings;
they do not establish hardware discovery. See the
[§6 audit](browlet/interaction/pointer/ROADMAP.md#pointer-events-6-navigator-touch-capacity).

Stylelet now parses and computes `touch-action`, including directional keywords
and `pinch-zoom`, through the normal cascade and CSSOM paths. `DirectManipulation`
now computes and freezes per-contact permissions with required layout inputs;
the pointer stream guards suppression before viewport takeover. There is still no
native gesture producer or scrolling/zooming implementation. Box applicability,
scroll-container classification, and local-coordinate direction mapping must be
supplied by layout; the property's own applicability query still throws. Shadow-tree
queries reach Stylelet's explicit unfinished scope-selection path, retained as one
approved expected failure. See the
[§7.2–§7.3 audit](browlet/interaction/pointer/ROADMAP.md#pointer-events-7273-direct-manipulation-decisions).

PointerEvent's internal attribute initializer applies the §3.1.3.1 table before
dispatch. `PointerCapture` now implements pending-target transitions and trusted
capture notifications with copied input data. `PointerEventStream.prepareTarget()`
now combines attribute/ID preparation, capture processing, target selection,
active-document tracking, and implicit capture for direct-manipulation down events.
Hit testing remains a required callable supplied by layout. The mouse producer's
Document lock query now reads UserAgent's PointerLock state. Device
capability is supplied explicitly rather than inferred from pointerType. Internal
capture requests validate connectivity, lock state, buttons, and active Document;
Element's public capture methods now resolve the active ID from the receiver's
top-level traversable and report unknown IDs with NotFoundError. They expose
pending capture immediately. Documents without an active browsing context ignore
set/release requests and report no capture, following the approved Chromium/WebKit
behavior; requests during pointerup use current zero buttons, following the draft.
The context's stream map is shared with child documents and cleared on top-level
teardown. No producer yet registers or retires IDs, so these APIs alone do not
make device pointers available. Author-created PointerEvents cannot register IDs.
DOM removal immediately releases disconnected pending capture through that map;
reinsertion does not restore it. Effective loss waits for capture processing and
targets the reconnected element or its Document if still detached. State-preserving
moves retain capture. Successful Pointer Lock application now invokes the existing
release operation; native lock acquisition remains an explicit host dependency.
Pointer Events §5's eleven handler attributes are connected on every
GlobalEventHandlers includer. The raw-update property is exposed only in secure
contexts; its content attribute can still handle author-dispatched events on an
insecure page, following the draft/Chromium/Firefox choice. WebKit's missing
raw-update handler is recorded in the event roadmap. This adds no native input
producer and does not change the trusted raw-delivery restriction.
`dispatchToTarget()` sends boundary notifications, dispatches a prepared input,
and retains its actual DOM path for previous-target repair. It releases capture
after up/cancel; after up, a required producer callback supplies the uncaptured
hover target or null. `suppress()` cancels from a private last-input snapshot and
exits the stream. `updateAfterLayout()` refreshes stationary-pointer boundaries
without a move event; actual layout invalidation, scheduling, and hit testing
remain unconnected owner dependencies. The input owner must supply the prepared
event in its target's realm. Mouse registration and queued delivery are connected;
other devices still need context-local IDs, registration/retirement and their
suppression triggers (device loss, modal UI, pan/zoom, HTML drag). Remaining mouse
default actions stay with their HTML owners. DOM removal repairs previous
boundary targets before reinsertion. Individual Document.destroy() silently
clears its retained pointer references, including capture and click history,
without retiring the physical source or clearing surviving Documents' state.
Recursive teardown also runs this cleanup for inactive Documents on their owning loops.
Author construction and dispatch keep their supplied attributes and do not change
capture state. Hardware acquisition and measured/predicted sample collection
remain producer dependencies.

Native raw dispatch rejects insecure target documents before boundary delivery
or input retention; author dispatch remains available. Native up preparation
zeros pressure before capture processing. Raw-before-move scheduling, detection
of non-position input changes, and collection/prediction of §9's input samples still
need their input owner. Trusted delivery now creates chronological coalesced/predicted
lists from supplied snapshots, including one coalesced sample for an unbatched
move/raw event. Samples retain measurements, use the parent's pointer identity, and
follow trusted retargeting and shadow cleanup. Their flags, empty nested lists, and
independent identities are established before delivery. This does not accumulate
hardware inputs, predict motion, flush pending moves before later down/up events,
or schedule raw updates before corresponding moves. Author constructor lists and
redispatch remain unchanged; the source identifies the remaining producer work.

Pointer Events §10's lazy, Document-owned legacy mouse state now connects to
the internal pointer stream. Primary input produces trusted mouse boundaries and
mapped down/move/up, with per-pointer-type cancellation suppression and immediate
non-hover interleaving. Chorded button changes retain their mouse down/up meaning.
DOM removal repairs both the effective position and the pending mapped target
before reinsertion; an unchanged position allocates no boundary notifications.
The mouse-button processor supplies hover capability and uses explicit click
qualification/count inputs. Qualifying releases dispatch click/auxclick in the
same task as mouseup, including chorded releases that produce pointermove.
An explicit double-click flag sends a primary dblclick MouseEvent after click,
retaining its selected target unless it remains disconnected. A click count alone
does not recognize a double-click. Selection/editing default actions remain unconnected.
Gesture recognition and native input acquisition remain adapter work.
Click/auxclick delivery now stops if mouseup leaves its selected target disconnected,
including captured targets. Immediate reinsertion allows delivery, as in Firefox;
Chromium/WebKit also suppress that reinserted case. DOM activation remains specific
to click. Auxiliary link actions and concrete form-control activation remain HTML
work; dblclick does not repeat the generic click hook, and click does not repeat focus
after a canceled mousedown. The native checkbox/focus probes support these choices.
The same processor accepts normalized position updates. It delivers secure raw
input before pointermove/mousemove, including raw updates for chorded button
changes, with receipt-time buttons and realm-relative timestamps. Window motion
updates once per position even when compatibility mousemove is suppressed.
Each update is unbatched; prediction and display-aligned coalescing are not supplied.
Pointer Lock's queueRelativeMove path accepts measured deltas and freezes absolute
coordinates; absolute queueMove input while locked throws. Exit resets unlocked
motion history. Native interruption notification and normalization remain adapter duties.
Adapter-selected context menus now dispatch on press or release, independently of
down cancellation and before any qualifying auxclick. An uncanceled contextmenu
reaches `showContextMenu()`, which throws until a native UI adapter supplies menu
display, positioning, and modal input handling. A canceled menu needs no UI effect.
The selected pointer target is retained across layout changes; a still-disconnected
target suppresses delivery, whereas browsers can re-hit-test and retarget the menu.
Its Pointer Lock query now reads the shared controller. Layout hit testing,
HTML activation notification, and click-focus steps still throw until connected.
The tests supply those missing capabilities; they do not demonstrate physical
mouse input, real focus, menus, or cross-document coordinate translation.
Synthetic dispatch neither produces compatibility events nor changes suppression state.

WheelEvent has its §12.1 constructor, inherited MouseEvent data, delta unit
constants, and momentum field. Document.wheelInput accepts normalized input and
explicit gesture-start/end notifications, retains the initial target, and queues
trusted delivery. Actual DOM-path listeners determine cancelability. Removal,
inactivity, and destruction clear retained state. This does not yet scroll:
`hitTest()` and `applyDefaultAction()` throw until layout and scrolling/zooming
owners are connected. `getLockedElement()` reads UserAgent's lock state; queued
locked wheel input uses its frozen coordinates. Tests control the missing effects. Native units/signs/inertia, gesture timing for devices without
phases, and routing across Documents still need a GUI or automation adapter.
Synthetic dispatch does not enter transactions or default actions. Native events
use null relatedTarget like all three browsers, inherited which=1 like Firefox/WebKit,
and noncancelable passive-only delivery like Chromium/Firefox. Constructor deltaMode
follows unsigned-long IDL conversion, including values outside the three native
units, as all three browsers do. Negative zero is preserved like Firefox; momentum
is exposed like the draft and Chromium, while Firefox/WebKit do not yet implement it.

The [Selection API slice](browlet/interaction/selection/ROADMAP.md) exposes the
single Document/Window selection, its getters, range attachment/removal, live DOM
updates, composed StaticRange snapshots, collapse methods, and coalesced Document
selectionchange events. extend and setBaseAndExtent support directed selection,
including a separate composed span across shadow roots. The public Range remains
ordinary and collapsed at the later point; getComposedRanges exposes the full span.
Explicit public Range edits replace that extra span, while automatic DOM mutations
retain it. State-preserving moves retain and reorder the span; extend and collapse
replace it using the ordinary Range. These cross-root choices differ from some
browser behavior, as recorded in the owning roadmap. selectAllChildren selects direct
children (including connected shadow trees), leaving childless/CharacterData nodes
at offset zero with forward direction. modify is only partially implemented:
invalid arguments and empty selections are handled; valid movement throws from the
named editing/text-layout dependency before changing state. Rendered caret positions,
UAX9 embedding direction/affinity, and granularity navigation remain missing, with
two approved expected-failure regressions preserving required movement results.
deleteFromDocument mutates the retained ordinary Range, including connected shadow
selections; cross-root spans remain unchanged. containsNode uses approved DOM
whole-node enclosure/intersection and ordinary-document membership, without layout
normalization. The stringifier returns empty for empty selections/ordinary carets;
rendered content reaches a named throwing dependency, with two additional approved
expected failures. Rendered text and input/textarea value selection remain missing.
§4.3 onselectstart/onselectionchange properties and content handlers now use the
existing GlobalEventHandlers machinery. SVG attributes work like Chromium/WebKit;
body attributes stay local like Firefox. §§6–6.1 now provide the internal
selectFromUser entry for a producer-supplied same-tree Range and direction. It
copies into Selection's realm, honors selectstart cancellation, tracks live DOM
adjustment, and rejects lifetime invalidation. This does not produce native
selection gestures. §§6.2.1–6.2.2 now share notification scheduling/firing across
Document, input, and textarea. Controls retain their own bubbling, non-composed
event inside shadow trees and remain deliverable across detachment/adoption and
Document inactivity, independently of callback-realm activity. HTML selection
setters and value/editing steps must call that internal entry once their actual
control state exists. Cross-root user proposals, document.open reset, input/editing
endpoint selection, control state, and caret/highlight rendering remain unfinished.
Source TODOs identify these owners;
this slice supplies programmatic state without claiming user-input or
rendered-selection support.

The Pointer Lock draft audit covers §§1–12; §§9–12 add no runtime algorithms.
Pointer Lock §§2–5 supply ordered request/release, Document handlers and shadow
retargeting. A real native lock cannot yet be acquired: HTML focus/transient
activation and native cursor acquisition/restoration/raw-motion support remain
throwing operations. §§6–7 now deliver normalized locked input, with frozen
coordinates and measured relative motion. Mouse boundaries are suppressed per the
draft/Firefox; ordinary pointer boundaries remain. §8 now releases disconnected
targets, rechecks queued requests, and retains notification Documents after adoption.
Native default-unlock/focus-loss signals and HTML unloading/destruction remain
unconnected; synthetic keyboard/blur events do not supply them. Tests control the
unfinished native effects and focus/activation queries. Exact dependencies and approved
browser conflicts are in [the Pointer Lock roadmap](browlet/interaction/pointer-lock/ROADMAP.md).

§3.3.12 now supplies internal click/auxclick/contextmenu creation and pointer-based
target selection. The stream retains per-button press/release facts across capture release and
author reinitialization; a producer explicitly requests activation and supplies
its click count. Non-pointer creation keeps the supplied target and uses ID -1
with an empty pointer type. This does not detect clicks or implement default actions;
the mouse adapter now supplies menu timing explicitly. Keyboard-triggered menus
still need the keyboard/focus owners' current target, modifiers, and UI placement;
the mouse entry requires actual input rather than substituting zero coordinates.
HTML §8.1.8.3 now supplies Element.fireSyntheticPointerEvent()/fireClick(),
including current UserAgent keyboard modifiers and the optional untrusted flag.
The approved HTML rule retains modifiers even for untrusted firing, unlike the
three browsers' HTMLElement.click(). HTMLElement.click() itself remains unexposed:
HTML §6.5 still owns disabled-control handling and the click-in-progress guard.
KeyboardInputProcessor.applyDefaultAction() still throws for the missing focus,
activation and editing policies; concrete element activation remains with HTML.
CSSOM View's unimplemented page/offset coordinates remain unexposed.

Pointer Events §3.2 now provides internal event initialization and creation.
The reached MouseEvent initializer requires mapped coordinates and a button/modifier
snapshot from the input owner; no adapter supplies them yet. Creation retains
target-environment allocation, while initialization follows DOM's trust reset;
the producer must establish trust before dispatch. MouseEvent conversion requires
an already-selected Node or Window target and explicit bubbles/cancelable flags;
it copies input data into a fresh event with default pointer data and empty samples.
It does not register a source or dispatch input.

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
exist. javascript: navigation now runs the default-policy/CSP check and evaluates
the rewritten URL through ClassicScript; string-result document replacement is
still unfinished. Markup parsing, script
compilation, string timers, complete navigation, and Worker integrations retain
the separate gates in the [Trusted Types roadmap](browlet/browsing/policy/trusted-types/ROADMAP.md).
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
[Permissions Policy](browlet/browsing/policy/permissions-policy/ROADMAP.md) has feature
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
Body/frameset handler aliases and inline compilation are connected. Storage
synchronization across separate threads/processes remains pending.
Storage keys are origin-only; third-party partitioning/blocking, expiry,
per-site storage access policies, and coordinated cookie/storage clearing
remain unimplemented privacy-policy integrations.
See the [Web Storage roadmap](browlet/storage/ROADMAP.md).

## DataTransfer and clipboard prerequisites

HTML DataTransfer, DataTransferItemList, and DataTransferItem support author-created
string/File data, mode checks, stable identities, frozen types, and queued string
callbacks. setDragImage() reaches an explicit throwing rendering dependency after
its access checks; natural-image bitmaps, rendered Element snapshots, and native
drag feedback are not available. Native DragEvent production, shared-store
association across events, and effect copy-back/detachment integration remain
unimplemented. ClipboardEvent now retains a supplied DataTransfer and supports
synthetic dispatch through existing cut/copy/paste handlers. Those events do not
access the system clipboard or edit the selection. ClipboardChangeEvent supports
copied types, stable frozen-array identity and a supplied bigint changeId. Its
constructor follows the draft's type/init and Window exposure rules rather than
Chromium's init-only secure-context interface. SystemClipboard supplies queued
trusted notifications, focus replay, mandatory-format filtering and 128-bit IDs
derived from Storage keys. Native snapshot access, persistent read consent and
Document focus tracking still throw; no OS clipboard observer or HTML focus-gain
caller is installed. Synthetic construction remains available on HTTP; native
notification delivery requires a secure, fully active Document. Actual clipboard
reads/writes and end-to-end copy/cut/paste remain unfinished. Trusted copy/cut/paste
now have event dispatch, writable/read-only stores, clear bookkeeping and revoked
post-dispatch access. SystemClipboard.getEventTarget() and readForPaste() throw
for missing editing/rendered-selection targeting and native paste preparation,
including HTML processing. §8 action admission, cancellation/default branching,
write/clear decisions and queued notifications now exist. Command adapters and
execCommand callers are not connected. Script paste permission, rendered selection
extraction, editable-state queries, cut/paste editing/event delivery and native
replacement/clearing remain named throwing methods. Script copy/cut now queries
the Window's actual transient activation; input notification remains unfinished.
Secure-Window ClipboardItem construction, presentationStyle, frozen types,
getType() and supports() now operate on author-supplied data. MIME names are
parsed/serialized, custom types stay distinct, strings become UTF-8 Blobs, and
supplied Blobs retain their identity/realm. supports() recognizes the specified
format vocabulary; it does not establish native adapter availability.
Appendix A.3/A.4 standard format mappings and A.7/A.8 custom-format names now
exist for Windows, macOS, Linux, ChromeOS and Android. They are pure translation
helpers. A.5 custom-map decoding and A.6 validated map/payload preparation now
exist, including malformed-map recovery and rejection above 100 custom formats.
A.2 writeItems now combines standard formats and custom batches per item,
preserving styles and binary Blobs. Platform selection (getPlatform), optional
format mapping (getAdditionalFormat, including text/uri-list omitted by A.3),
and OS encoding/registration/collective commit (writeFormats) still throw.
Actual format enumeration and payload reading likewise remain unfinished.
SystemClipboard.readItems(document, unsanitizedTypes) now creates metadata-only
system clipboard items with generation/lifetime checks, shared concurrent reads and cached
promises, and item-realm Blob delivery on the clipboard task source. Native
format enumeration, byte access and HTML/SVG preparation still throw from
readFormatSnapshot, readItemBytes and prepareReadData. readItemMetadata now maps
standard/custom formats and each item retains its selected OS formats. PNG, permitted
unsanitized HTML and custom bytes bypass rich-format preparation. Secure-Window Navigator.clipboard
and Clipboard now exist; read() validates options, captures §9.1 permission facts,
and delivers through the permissions/clipboard task sources. Real reads still
reject at named unfinished dependencies: Document focus, Window transient
activation, SystemClipboard.isPasteInteraction(), or readFormatSnapshot(). readText() now
shares that admission flow, resolves absent text as empty, preserves DOMStrings,
and decodes Blob bytes through File's UTF-8 reader. readTextData() now selects
the first standard text format from the shared format snapshot without fetching
the custom map, then uses readItemBytes(). The captured generation and original
Document are checked through final delivery, including absent-text results.
OS enumeration, text decoding to UTF-8 at the adapter boundary, payload access
and generation queries still throw from readFormatSnapshot(), readItemBytes()
and readChangeState(); real system clipboard access remains unavailable.
write() now implements §9.2 permission
admission, representation joining/validation, item grouping, format preparation
and queued commit delivery. Its native Cut/Copy provenance, multi-item support,
rich-format preparation and asynchronous OS format writer remain throwing dependencies;
HTML/SVG sanitization, image decoding, OS format registration and final native
writes are not implemented. The registered clipboard-write descriptors use the
existing store and prompt hook, whose default denies consent. writeText() now
shares write admission and native commit, encoding a text/plain;charset=utf-8
Blob and normalizing Windows line endings. It reaches the same throwing native
writer; real OS clipboard writes remain unavailable. The §§10–11/Appendix A
audit retains OS encoding/registration and collective writing, lazy-read byte
access and HTML paste processing as unfinished work at those throwing methods. Paste source provenance
and referenced-file restrictions, read-side image preservation, and native
size/count rejection are required before the adapter can supply real effects.
The Clipboard task source follows HTML activity gating and Document destruction;
it does not force rejected promises to execute author callbacks in an inactive or
destroyed Document.
See the [data API boundary](browlet/interaction/drag-drop/ROADMAP.md)
and [Clipboard event slice](browlet/interaction/clipboard/ROADMAP.md).

## Image data and graphics

[ImageData](graphics/ROADMAP.md#imagedata) stores RGBA pixel arrays and metadata;
it does not decode images, convert color values, render pixels, or implement a
canvas consumer. Both pixel formats and all four current HTML color-space
labels are exposed in Windows and workers. Half-float allocation requires the
existing realm Float16Array intrinsic; a host without it reaches an explicit
InternalError instead of receiving another representation.

Supplied arrays retain their identity and realm. Structured cloning preserves
view offsets and aliases through the existing graph memory, following the
approved HTML/Firefox rule rather than Chromium/WebKit's separate pixel copy.
Only the backing ArrayBuffer is transferable. Detached pixels cannot be cloned
or passed to the data constructor. Worker-realm cloning is available internally;
worker forwarding of the public structuredClone API remains HTML §10.3 work.

[ImageBitmap's lifetime surface](graphics/ROADMAP.md#imagebitmap-lifetime) supplies
dimensions, close, cloning, and transfer for prepared owned pixels. Closed and
tainted bitmaps reject cloning/transfer; successful transfer clears the sender.
There is no author constructor, and createImageBitmap remains unexposed until
its complete source union and adapters are available. The global mixin's internal
ImageData/ImageBitmap entry snapshots during the call and delivers a typed Promise
on the receiving global's bitmap task source. Its Blob branch now reads bytes in
parallel, sniffs the image MIME type, and queues result delivery, but nonempty
inputs reach the named throwing BitmapData.decode dependency. Empty inputs and
backing-read failures reject with InvalidStateError. Internal preparation supports
ImageData/ImageBitmap snapshots, cropping, transparent padding, and vertical
flipping, all four resize qualities, and unorm8/float16 alpha conversion with
the approved sampling, rounding, and zero-alpha rules. Format/color/origin-clean
metadata and source pixels are preserved. Medium/high use widened triangle/cubic
filters; byte output clamps overshoot while half-floats retain it, including in
alpha. Other source extraction, decoding, canvas readback, and rendering remain explicit in the
[dependency map](browlet/graphics/ROADMAP.md#imagebitmap-creation-dependencies).

## HTML integration gates

- **Element content handlers retain explicit dependencies.** HTML, SVG, and MathML
  elements expose HTML's GlobalEventHandlers, with lazy Document/element scopes
  and body/frameset Window forwarding.
  Form-associated elements stop at the explicit `getFormOwner()` stub until
  §4.10.18.3 supplies association; assigned function handlers remain usable.
  Exact diagnostic source locations remain unfinished. Handler contributions
  from other specifications and native input/media/layout event producers retain
  their respective owners; exposing a handler does not implement its producer.
  `onbeforeunload` is connected on Window/body/frameset, including inline source
  and nullable-string returns. Document's trusted beforeunload producer is implemented,
  and navigation/top-level closing now queue it through the cancellation coordinator.
  Anti-abuse prompt policy and host confirmation UI remain unfinished. BiDi prompt notification hooks
  have no active sessions. Synthetic dispatch alone does not show a prompt.
  See the [handler inventory](browlet/scripting/ROADMAP.md#html-8181-event-handler-idl-invocation).

- **Simple dialogs have no display host yet.** Window.alert(), confirm(), and
  prompt() supply conversion/defaults, text preparation, sandbox/activity/termination
  gates, automation routing, and task pause. Ordinary calls reach the throwing
  UserAgent.showAlert(), showConfirm(), or showPrompt() dependency until a host
  can display the dialog and synchronously await its response. BiDi sessions
  remain unfinished. See the
  [user-prompts audit](browlet/scripting/ROADMAP.md#html-user-prompts-simple-dialogs).

- **Printing has no renderer or output host yet.** Window.print() implements
  active/unload admission and pending-load requests. UserAgent runs beforeprint
  and afterprint through the requested frame subtree, suppresses reentrant printing,
  and pauses at the throwing obtainPhysicalForm() dependency. That boundary must
  capture the relevant document state, apply print media/paged layout, and supply
  preview/PDF or printer UI. A host failure stops before afterprint and restores
  the pause/reentrancy state. Deferred requests use a Document-owned DOM-manipulation
  task because the convenience loader can finish in a Promise checkpoint. Full
  stop-parsing task order and child-context destruction remain their existing
  lifecycle dependencies; printing checks connected frame ancestry locally.
  See the [printing audit](browlet/scripting/ROADMAP.md#html-user-prompts-printing).

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
  Window message handlers and MessagePort transfer are implemented. See the
  [§9.3 dependencies](browlet/communication/ROADMAP.md#93-cross-document-messaging).

- **BroadcastChannel connects Windows and dedicated Document-owned worker isolates
  in one UserAgent.** Eligibility uses closing/suspendability checks at send time;
  shared/nested worker ownership remains a prerequisite for their connection.
  Routing uses the existing
  origin-based StorageKey; it does not add browser-specific privacy partitioning. See the
  [§9.5 dependencies](browlet/communication/ROADMAP.md#95-broadcastchannel).

- **Channel messaging now includes isolate transport.** MessageChannel,
  MessagePort transfer, queued-message migration, and document cleanup work with
  existing Window realms. Dedicated-worker tests also cover native endpoint
  handoff, nested pending transfers, and shutdown across real isolates. Public
  worker startup, SharedWorker discovery, AudioWorklet lifecycle, and remote owner
  monitoring remain separate integrations. Entangled ports and pending tasks are
  retained conservatively; see [§9.4](browlet/communication/ROADMAP.md#94-channel-messaging).

- **EventSource lifetime is conservative.** Active sources remain retained until
  `close()`, permanent Document cleanup, or cooperative worker shutdown;
  listener-sensitive collection is not implemented. Shared-service Fetch routing,
  remote cancellation after forced termination, and navigation-driven destruction
  remain separate integration gates. See the [communication roadmap](browlet/communication/ROADMAP.md#92-eventsource).

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
Top-level Document creation does fetch resources selected by `Speculation-Rules`
headers, using Document-owned CORS requests with same-origin credentials and
HTML's CSP exemption. Status, MIME, decoding, and rule registration are connected;
successful response bodies still reach the explicit parser dependency. Inactive
Documents defer their tasks and destruction removes queued requests. Document
abortion now terminates an in-flight rule request and delivers body failure;
the strict cancellation regression passes. Already-queued body delivery is also
removed, including after request completion, with failure releasing its consumer.
See the
[header-loading audit](browlet/loader/ROADMAP.md#speculation-rules-header-loading).
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
content navigable only when supplied internally; public child accessors are
present, but automatic child navigation remains unfinished. Named-property regressions
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
separately and do not wait for all load-delaying resources. XML parsing remains
missing. Single and recursive Document unloading supply privacy-filtered timing
around explicit visibility and cache-admission dependencies. See the
[loading-status audit](browlet/html/ROADMAP.md#section-315-document-loading-status).

Initial iframe and auxiliary contexts now inherit creator state. Automatic child
creation still needs element and history lifecycles. Ancestor-origin calculation
and referrer-policy masking accept
the known parent document before activation; they do not complete those
[child-navigation dependencies](browlet/html/ROADMAP.md#section-313-ancestor-origins).
Browsing-context groups now hold agent clusters weakly while retaining each
origin's historical keying decision. Automatic context removal remains an explicit
`UserAgent.collectBrowsingContexts()` dependency: it needs destroyed-Document
tracking and WindowProxy collection eligibility, which the current strong group
membership does not supply. Weak cluster storage is not evidence that retired
Windows or native realms are collectible. See the
[grouping audit](browlet/browsing/navigation/ROADMAP.md#html-7323-groupings-of-browsing-contexts).
Full activity follows the actual container Document through every ancestor,
including retained inactive Documents; History, Location, and task gates use
that predicate. Host input targeting/delivery and WebDriver input commands
remain absent, so §7.3.3's user-interaction restriction still needs those
[consumers](browlet/interaction/ROADMAP.md).
`Window.open()` supports empty-URL calls to existing `_self`, `_parent`, and `_top`
targets. The [existing named-target lookup](browlet/browsing/navigation/ROADMAP.md#html-7317-target-names-and-existing-target-lookup)
now coordinates subtree/group searches and applies context familiarity and sandbox
permission, but still throws at its source-activation dependency. New-target
selection now applies
browser policy, consumes activation, handles COOP/noopener, and retains sandbox
state. The default popup blocker still needs activation notification/expiry;
both auxiliary and null-opener targets can use their context factories when those
earlier checks are supplied or popup blocking is disabled. Nonempty-URL navigation
remains unfinished.
Feature processing and the new/existing
opening branches are connected. Synchronous URL/history updates now work, while
CSSOM View geometry and queued history application remain unfinished.
`close()` and `stop()` also require their lifecycle operations;
see the [Window audit](browlet/browsing/window/ROADMAP.md#html-7221-opening-and-closing-windows).
`Window.history` exposes Document-owned length/state/scrollRestoration attributes.
The existing top-level commit path updates stored length/index, and entries retain
their scroll mode. `go/back/forward` perform conversion, activity checks, and
request preparation. Reload now dispatches its cancelable navigate event and
queues history application. Delta traversal captures the source and queues
target selection against the then-current distinct joint-history steps; out-of-range
requests do nothing. Script source capture reads the Window's transient activation.
Reload/traverse history application now checks sandbox permission and waits for
beforeunload/navigate cancellation, retaining the traversal queue until completion.
After admission it reselects affected navigables, advances their current entries,
and queues cross-document Navigation event/tracker cleanup without aborting or
settling those requests. Creation/destruction bookkeeping leaves pending navigation
and reload work to its owner (`history-bookkeeping-navigation`, HTML issue #12724).
Population and Fetch now recognize retained `traversal` ownership separately from
the null navigation ID (`history-population-navigation-id`); metadata keeps that
null ID, and superseding ownership still cancels pending work. Per-navigable
preparation now queues the Window task, validates the target, fires applicable
child traverse events, populates in parallel, and delivers retained continuation
state. It preserves reload inputs until request construction and treats null
Document results as update-only. The coordinator does not yet dispatch or consume
these jobs: ready continuations, synchronous queue jumping, and failure/discard
completion must be connected together. Eligible-step selection and nested
completion are implemented separately on Traversable; the coordinator still
needs to maintain the waiting set and wake when new eligible work arrives.
Preparation/population forward asynchronous failures and queued-task removal to
a waiting operation without duplicate reporting. Removed unload-check tasks also
reject their internal wait. In-flight Fetch/body reads, periods with no queued task,
and late callbacks after destruction still need teardown integration. The full
coordinator is not yet connected to these completion paths.
The separate history-entry activation operation connects the active entry,
Document/Window, and initial visibility, but its persisted-state capture still
throws before those changes. The provisional loader retains its existing path;
the full coordinator must call activation after any required unloading.
The outgoing `pageswap` producer is implemented, including origin/redirect
filtering and realm-owned activation. Document deactivation now orchestrates
its dispatch and the capture-to-unloading continuation. Recursive unloading now
returns completion through the traversal queue; CSS eligibility/setup and the full
coordinator, including failure/discard completion and teardown during capture,
remain unfinished. The ordinary loader does not yet call
this producer.
Admitted requests still reject explicitly before Document population and activation;
active entries and the final joint-history step remain unchanged. No successful
back/forward or cross-document reload is implied by these checks.
Ordinary reload request construction selects Fetch's `no-cache` mode, so fresh
cached Documents are revalidated and connection failures do not silently reuse
them. Explicit host forced reloads remain missing, including their cache-bypass,
subresource, and service-worker policies; setting the reload flag alone does not
implement those effects.
`pushState/replaceState` now serialize for storage,
validate URL rewriting, and dispatch a trusted navigate event. Cancellation leaves
the URL/state unchanged. Precommit handlers run and can reject the change.
Commit coordinates script execution, interception state, owner operations, and
transition settlement. Accepted History changes synchronously update the URL,
cached classic state, immediate length/index, and Navigation entries, then queue
finalization. The queued same-document history application still explicitly throws;
this does not yet support complete back/forward traversal. Reentrant callbacks
retain the original update order. Intercepted Navigation pushes/replacements clear
classic state as all three browsers do; ordinary helper calls with omitted state
retain it. See the [§7.4.4 audit](browlet/browsing/navigation/ROADMAP.md#html-744-non-fragment-synchronous-navigations).
Session history entries now retain separate serialized classic History and
Navigation states, including entries whose Document has not loaded. Scroll data
and optional persisted user state have explicit null-only fields. Capture and
restoration remain throwing operations. Existing-Document updates restore classic
state and dispatch history events, but those persistence boundaries still prevent
complete traversal and scrolling. Classic History-state commits and receiver-realm
deserialization are implemented. See the
[entry audit](browlet/browsing/navigation/ROADMAP.md#html-7411-session-history-entries).
`DocumentState` retains the recreation inputs and guards eviction of fully active
Documents. Eviction schedules recursive destruction on owning loops; automatic
cache selection and complete history restoration remain unfinished. Retained-Document
reactivation now has its Navigation/event sequence, with selective form reset and
visibility transitions still throwing. `Document.latestEntry` is maintained by the local commit path and both
Document history-update branches; full traversal coordination remains unfinished.
New-Document initialization still stops at persisted-state restoration before
releasing parser scripts. Fragment-scroll scheduling now returns immediately;
its later task reaches explicit user-interest, target-selection, and scrolling
dependencies. HTML also leaves child
history identification across reloads unspecified. See the
[Document state audit](browlet/browsing/navigation/ROADMAP.md#html-7412-document-state).
Session-history traversal queues now execute ordinary and target-tagged steps in
order, waiting for returned internal completion promises through their UserAgent.
History application still needs document-population waits and selective synchronous
navigation queue jumping. Existing callers now reach their unfinished history or
unloading operation on the queued background turn; the queue does not complete
those operations or settle their Navigation trackers. See the
[queue audit](browlet/browsing/navigation/ROADMAP.md#html-7413-centralized-modifications-of-session-history).
Low-level history lookup, forward clearing, and used-step collection include
retained descendant histories. Their traversal-queue precondition is still
unenforced while initial creation and provisional local commits call them
synchronously; full finalization/history application must establish those paths.
See the [low-level audit](browlet/browsing/navigation/ROADMAP.md#html-7414-low-level-operations-on-session-history).
History-step selection now resolves gaps and selects changing/reloading,
possible cross-document, and length/index-only navigables. These are foundations
for the still-unfinished history coordinator; recursive teardown releases completed
child associations, while restoration must still maintain that collection. See the
[selection audit](browlet/browsing/navigation/ROADMAP.md#html-7461-history-step-selection).
Cross-document finalization now inserts into child and grandchild history lists
and retains a replacement's Navigation API key only for the same origin. History
application still activates only the supplied entry: it does not unload old
Documents, update every other affected Document, restore cached Documents, or
deliver their lifecycle/history events on the appropriate event loops. The local
loader still commits synchronously; the finalizer's traversal-queue assertion
cannot yet be enforced. See the
[finalization audit](browlet/browsing/navigation/ROADMAP.md#html-74231-cross-document-finalization).
Fragment navigation now dispatches the real navigate event, carries method
trackers and Navigation state, preserves interception, and prepares push/replace
entries. An uncanceled hash change still throws at Document history-step
application; scrolling and joint same-document history application also remain
explicit throwing owners. Queued finalization now inserts/replaces entries and
preserves rapid same-document updates, but cannot apply their joint history step
yet. The provisional new-Document path explicitly rejects that work rather than
reinitializing Navigation. The coordinator wires the BiDi completion hook, but
does not yet deliver history events or complete ordinary fragment loads. See the
[fragment audit](browlet/browsing/navigation/ROADMAP.md#html-74233-fragment-navigation-coordination)
and [same-document finalization audit](browlet/browsing/navigation/ROADMAP.md#html-74233-same-document-finalization).
Non-fetch navigation now has an internal external/inline routing operation and
the specified child-sandbox handoff gate. Handler selection, external confirmation
and launch, and inline browser-page rendering each throw at explicit owners.
§7.4.5 population now constructs direct non-fetch params and calls that routing
operation on the target Window's task after its stale-ID check. It also accepts
non-fetch Fetch results; the actual Fetch/redirect factory and redirect-origin
capture remain unfinished. This does not enable end-to-end
mailto/custom-protocol navigation or launch external applications. See the
[non-fetch audit](browlet/browsing/navigation/ROADMAP.md#html-74234-non-fetch-schemes-and-external-software).
Navigation target snapshots retain sandbox/referrer inputs independently of later
container changes and response CSP. The full navigate algorithm must still capture
and carry them before parallel loading. Source capture reads Window activation;
input notification remains unfinished. Object/embed/frame target sandbox inheritance,
complete navigation-param assembly, navigation-ID propagation/BiDi delivery, and hyperlink/form
activation callers remain explicit dependencies. Event's trusted-click involvement
helper does not implement those callers. See the
[supporting-concepts audit](browlet/browsing/navigation/ROADMAP.md#html-7421-navigation-supporting-concepts).
`Navigable.navigate()` now captures source inputs, checks sandbox admission, and
continues immediately on the same Agent or queues target work using an explicit
caller environment. It implements unload/throttle cancellation, lazy-load cleanup,
history selection, and fragment dispatch. Non-fragment navigation sets child load
delay, captures target policy, rejects an ongoing traversal, and replaces the
ongoing navigation ID through the existing Navigation API abortion operation.
javascript: requests now queue a separate target task, ignore stale IDs, clear the
matching ongoing navigation, and apply the live destination's origin-domain check.
Captured source policies now apply form-action, Trusted Types URL rewriting,
and inline CSP checks with both dispositions' reports. Allowed requests execute
through ClassicScript in the live target environment. Abrupt/non-string results
leave the Document and history intact. Primitive strings assemble a UTF-8 HTML
response and inherited navigation params. Script-free replacements now load and
activate, including supplied bodies at about:blank. Enabled script encounters
still throw at §4.12.1 parser-script preparation; template and foster-parenting
adapter hooks also remain unfinished. These internal failures surface after
aborting the load. The normal empty about:blank path stays synchronous and uses
quirks mode. Complete encoding selection/restart, parser stop/deferred-script/load
coordination, and shared Fetch cancellation remain explicit dependencies; the
source-route script evaluator remains provisional. Completion queues container load
events when a node navigable supplies the container, including iframe mute/progress
flags and Permissions Policy reporting. Pending iframe fallback resource timing
still throws. Initial empty-iframe notification remains with §4.8.5 attribute processing.
These internal algorithms do not connect unfinished iframe insertion/loading.
Shared Document creation now preserves final params' null reservation and inherits
child Window top-level metadata from the container's environment. Initial Window
reuse and existing reservation transfer retain their separate paths. Without a
reservation, Origin-Agent-Cluster now uses the shared incoming-Window security
calculation; existing reservations retain their fixed decision. Browlet keeps
HTML/WebKit's secure-context gate where Chromium/Firefox honor an HTTPS child's
header beneath an insecure parent. The null-reservation input remains a documented
specification gap, not an unfinished implementation. The local-route response-policy
adapter remains until that producer supplies complete params.
Refresh headers now use the shared Document parser: malformed and javascript
targets are ignored, and valid input sets first-valid admission state. Accepted
HTTP refreshes wait for complete loading and their requested delay, then queue a
Document-owned navigation task. Same-URL refreshes use reload; other targets use
replacement. Abortion, destruction, and unsalvageable cleanup cancel pending work.
Meta Refresh uses the same scheduler, counting from the later of insertion and
complete loading and checking the captured Document's automatic-features sandbox
flag when due. Only Document-tree insertion processes it, as HTML/Firefox specify;
attribute changes alone and shadow-tree insertion do not. Removal or adoption does
not cancel a Refresh already accepted by the original Document.
Ordinary navigation now captures the actual Window activation state; the strict
Refresh delivery regression passes without an activation fixture. Existing
downstream loading/unloading dependencies are unchanged. Window.stop() now reaches
recursive abortion and Refresh cancellation. Other meta pragma/name processing, full bfcache timer policy,
and optional host preferences/manual redirect UI remain explicit.
See the [Refresh audit](browlet/browsing/navigation/ROADMAP.md#html-751-refresh-input-preparation).
Navigation Timing now creates and buffers entries before loader callbacks, with
live completion/body/milestone data, destination-visible response metadata, and
HTML's separate taint/client/referrer/TAO redirect gate. Load completion notifies
observers without inserting the entry again; early and later buffered replays
retain that live entry. Full parser task sequencing, initial pageshow, and BiDi
load-complete ordering remain explicit loader dependencies. Without a Fetch
controller, the entry retains supplied response metadata while unavailable fetch
phases and transferSize remain zero. Initial about:blank intentionally has no entry,
following HTML/WebKit; Chromium/Firefox expose one. Explicit later about:blank
navigations receive entries. Original fetch timing for supplied network responses and synthetic
loader-completion measurements remain explicit. Target-history diagnostics before
activation and Critical-CH measurements remain explicit. Recursive unloading now
coordinates descendant tasks; unloading updates the shared timing record after privacy checks;
skipped unloads and unavailable other-loop measurements remain zero.
The legacy `performance.timing` view exposes whole epoch milliseconds from these
same measurements; unavailable observations remain zero. It retains recorded values
after frame removal (Firefox/WebKit; Chromium zeros them), and hides legacy redirect
and unload timestamps across foreign redirects even with TAO. WebKit exposes the
TAO-authorized redirects; Firefox can expose preceding same-origin unload timestamps.
The legacy `performance.navigation` view retains the Document's classification
and hides foreign redirect counts even with TAO. It retains values after removal
(Firefox; Chromium/WebKit reset) and preserves the classification on retained
Document restoration (Chromium; Gecko's restoration code changes it). Ordinary
fragments reset the legacy type to navigate as Chromium/WebKit do; Firefox keeps
the load type. History state updates, intercepted commits, and the modern entry
retain their existing type. See the [legacy timing audit](browlet/performance/ROADMAP.md#navigation-timing-legacy-performancetiming)
and [legacy navigation audit](browlet/performance/ROADMAP.md#navigation-timing-legacy-performancenavigation).
Available diagnostics are captured in the entry's realm. The confidence API retains one randomized
result with a fixed 50% noise trigger, but the explicit UserAgent measurement
hook has no host instrumentation yet: confidence remains null until a real
assessment of that navigation is available after interactive. Window now advertises
navigation and resource in supportedEntryTypes. Resource Timing supplies its derived
entry, getters, default JSON, and time-origin conversion for prepared Fetch inputs.
Its buffer controls clear retained resource entries and resize the per-global limit.
Resource-specific insertion retains overflow entries until a coalesced Timeline
task fires the trusted buffer-full event, then promotes or discards those entries.
Observers receive entries independently of that storage limit. The full event
uses the shared HTML handler machinery and can notify again after discarded overflow.
Completed HTTP Fetches now produce resource entries, with TAO/CORS filtering,
cache-phase normalization, byte counts, and observer delivery. MIME support
classification remains provisional: the explicit UserAgent support-policy stub
means text/plain contentType is empty; its strict regression is an approved
expected failure. Server Timing now parses captured response headers into retained
metrics and a frozen resource-entry array, with Fetch's secure-context and TAO
filtering. HTTP trailer delivery and worker-producer
acceptance remain dependencies. Body completion still belongs to Fetch's consumption and
cancellation lifecycle; timing delivery does not force inaccessible bodies to drain.
Performance Timeline now supplies
the base entry, per-global buffers, synchronous `getEntries*()` queries, observer
registration/record retrieval, buffered replay, observer-list queries, and shared
task delivery, entry insertion, and initial navigation-ID association. The withdrawn
numeric PerformanceEntry.id is omitted, following upstream issue #218 and browsers;
navigationId follows the newer Soft Navigations model. Early producer capture and
soft-navigation ID advancement remain explicit dependencies. Fetch resources and
Document navigation populate those buffers; other producers
are not advertised. Outside Window, supportedEntryTypes retains resource only.
Synthetic and supplied-response
navigations without a controller still need fallback timing; retained start time
does not reconstruct prior network measurements. Response-header processing and
the remaining Document lifecycle steps still need their §7.5 audits; see the
[shared-creation slice](browlet/browsing/navigation/ROADMAP.md#html-751-window-selection-and-environment-inputs).
Ordinary navigation now fires the gated navigate event, forwards state/tracker
and POST-only form entries, and stops for cancellation or interception. Immediate
interception now updates URL/History/Navigation state before queued history application; a pending
precommit handler can hold it without starting a load. Accepted non-intercepted
navigation reserves deferred-fetch quota for container-initiated loads, then enters
parallel work and waits for unload checks on the relevant Document loops. After that
check, the coordinator rechecks the navigation ID before queued recursive abortion,
pending history-entry and supplied-response preparation, and a population completion
callback that queues finalization. Recursive abortion now queues descendant work
on each Window's loop and propagates unsalvageability. Population
now selects its source, assembles srcdoc params, queues target work, and completes
stale/non-fetch results. Response admission runs CSP, COEP when a reservation
exists, and X-Frame-Options in order. Failed responses construct an isolated inline
Document and reach its unfinished renderer; cleanup after that owner returns is implemented, including
unsalvageability, reservation discard, BiDi notification, and retained history
metadata. Sandbox-blocked downloads and ordinary 204/205 responses now complete
without creating a Document. Permitted attachments reach explicit UserAgent
dependencies for download admission and handling: source-URL selection for mixed
downloads, hostile-download policy, filename selection, BiDi decisions, and host
saving remain unfinished. Conflicting Content-Disposition fields also stop at
an explicit Fetch response-rejection dependency. Ordinary responses now call the
general Document loader after MIME preparation, preserving the sniffed bytes and
resuming on the destination task with a navigation-ID recheck. Population accepts
its nullable result and saves a loaded Document's origin and history-required
policy before completion. Dispatch selects HTML/XML/text/multipart, supported media,
PDF, configured inline content, or external handling. HTML and text now load through
the existing parser/lifecycle integration. Text uses a locked no-quirks pre and
PLAINTEXT mode, preserving literal markup and flushing streamed characters before
EOF. BOM/transport decoding works; full fallback selection and MIME-specific text
decoding remain explicit dependencies, as does the full parser completion lifecycle.
XML is deliberately deferred until the parser-spec work, with no added XML parser
dependency. Media Documents now create the specified no-quirks HTML tree and
img/audio/video host with src, pass the prepared reader to its element owner,
process media Link headers, and gate provisional completion on script readiness.
Image and audio/video resource adoption still throw until decoding, element events,
load-event delays, and cancellation are implemented. application/ogg also needs
track classification; UserAgent still claims no decoder support. Inline browser
pages and PDF viewers now construct a fresh opaque-origin Document with empty
response policies and the caller's destination URL, without consuming the
original resource. The UserAgent rendering hook still throws: browser UI,
diagnostic inputs, PDF decoding, resource lifetime, and viewer script exclusion
are unfinished. Ordinary HTML loading already runs headlessly without this
hook; browser-owned content can also use a nonvisual representation. Once that
presentation exists, completion uses the current activation gate and provisional
finish path. Complete loading now queues the container's load notification on
its owning Document's loop; iframe delivery includes mute/progress flags and
the post-handler Permissions Policy check. Pending iframe fallback timing still
throws, while its navigation inputs, `document.open()`'s mute producer, automatic
container insertion/loading, and the full stop-parsing lifecycle remain explicit
dependencies. XML loading, unsupported-resource host policy, and external
handoff also remain throwing boundaries.
Single-Document unloading now brackets pagehide/visibility/unload with counters,
records unload timing, runs cleanup, collects top-level restoration diagnostics,
and destroys unsalvageable Documents. Salvageable candidates still reach an
explicit UserAgent cache-admission dependency, and shown Documents reach the
unfinished visibility-update operation. Recursive unloading now dispatches parent
events first, visits children in retained order, and keeps the selected tree alive
through cleanup and diagnostic collection before destroying leaves upward. Its
InternalPromise holds the traversal queue through final completion and rejects on
task failure, discard, or unexpected destruction. Full history application and cache
policy remain unfinished; this does not provide an
end-to-end back/forward cache. See the
[unloading audit](browlet/loader/ROADMAP.md#html-759-recursive-document-unloading).
Single-Document destruction now clears only the active or retained Document's
history references, preserving the replacement page's state, tasks, and evaluation
context. Recursive destruction now shares completion across repeated requests,
collects inactive-page diagnostics, destroys children before the parent, and releases
completed child associations. Browser-owned cleanup and child-destruction abortion
notifications bypass the Document activity gate on the owning loop; ordinary page
tasks retain that gate. Retired initial-Document destruction now preserves the reused
Window's resources while removing the old Document's state and tasks. Keepalive and
the remaining resource-owner cleanup are unfinished. See the
[destruction audit](browlet/loader/ROADMAP.md#html-7510-recursive-document-destruction).
Window.stop() now clears an ordinary navigation ID, preserves traversal ownership,
and invokes recursive abortion; calls during unloading are ignored. Descendant
abortion retains the ordinary global-task activity gate and does not delay the
caller's return. FetchGroup.cancel() now stops ordinary pending requests, discards
their transport's buffered/future bytes, and invalidates queued successful Fetch
callback delivery. Window keepalive requests survive stop; destruction retires page
delivery while browser-owned uploads, redirects, and response draining continue.
Author abort/cancel still terminates transport. Worker keepalive still throws at
the missing parent-browser handoff; a worker-local sandbox cannot survive shutdown.
Queued Fetch-owned body tasks are removed and their internal waits fail once, including
after request completion or destruction of the failure-delivery task. Later author
consumption of a completed response remains independent of that cancellation.
Stopping from the owning loop's Promise checkpoint is also supported. Queued upload
progress and response/completion callbacks are now removed on cancellation; required
failure completion runs once, including after destination Document destruction.
Queued HTTP stream teardown now errors pending response reads and releases upload
readers, including cleanup queued during destruction. Discarded preparation,
cache/dispatch work, and response handoff also settle failure completion.
Byte/cache production now fails unfinished reads when its tasks are discarded,
and ignores backing-read results after cancellation. Completed streams and shared
cache data survive. Destruction now also cancels subresource Fetch execution and
unfinished Blob production with no queued task, including pending preload selection
and work whose separate Fetch client remains active. FileReader now stops unfinished
reads without events during Document destruction, retains completed results, and
rejects later readAs* calls with AbortError. Destruction inside a FileReader callback
also suppresses remaining notifications. In-flight EventSources now fail permanently
on Document cancellation; an already-scheduled retry with no pending request survives
stop(), while destruction closes all sources. Cooperative dedicated/shared worker
shutdown now runs the same local destruction hooks after the final checkpoint, and
discards queued/late work without restarting the loop. Cross-isolate service shutdown,
forced termination, worker keepalive handoff, and interruption of the backing host read
itself remain unfinished. See the
[abortion audit](browlet/loader/ROADMAP.md#html-7511-recursive-abortion-and-stopping-navigation).
Multipart framing now feeds independently readable part responses into the
Document loaders. First-part admission and per-part EOF/load delivery work while
the outer HTTP response stays open; later parts enter replacement navigation.
The full synthetic replacement route still needs §7.4.5's history-referrer capture;
its strict integration test is expected-failing. The shutdown handoff passes with
that metadata supplied and controlled visibility/cache inputs. HTTP parts
retain the outer and every earlier part's CSP as independent restrictions,
including report-only policies. First-part sandbox/origin preparation and
frame-ancestors checks precede Window creation; later supplied responses carry
those cumulative policies into the normal admission checks. Added part CSP on
local URLs still throws pending inherited-policy composition. Blocked embedding
and sandbox/COOP conflicts retain the explicit error-page/network-error owners.
Non-identity transfer decoding, nested multipart, malformed-response recovery,
and full timing attribution remain explicit dependencies. Canceling a part or
aborting its Document retires only that part. Navigable owns whole-load
cancellation for Stop, superseding navigation, and teardown, including child loads
and a first part awaiting commitment. A destroyed first Document rejects its
admission wait. Declined replacements discard their bodies and permit later parts;
implementation failures cancel the load and remain reported after transport EOF.
Completed streams release navigation ownership.
Linked reader cancellation now completes across addon queues: native Promise
observation wakes its destination for both pending and already-settled sources.
The strict multipart regression requires completion without a manual checkpoint.
Media decoder support is not claimed, and no PDF viewer exists.
ResourceReader now rejects its internal wait and releases its source lock when
destruction discards a read or cancellation task. Removed cancellation tasks do
not invoke the source algorithm or report successful cancellation. Producer-owned
I/O cleanup retains its producer owner. Parser task removal now stops input and
rejects completion; late finalization runs only internal cleanup on its original
owning loop. See the [remaining teardown connections](browlet/loader/ROADMAP.md#shared-ownership-shutdown).
Navigation request construction now retains the
history/source inputs with UserAgent-owned execution. Child requests retain the
initiating client's origin, following browsers instead of HTML's broken container
override (`SPEC_CLASH(navigation-container-origin)`, HTML #4703).
Initial reservation now creates a client identity, target context, top-level
metadata, and security decision without allocating a realm. Cross-origin redirects
discard and replace the reservation and clear its Early Hints callback; same-origin
redirects retain both. Service Worker association and Early Hints resource loading remain
unfinished. Navigation-request CSP checks
captured source policies and reports to the source Document. Enforcing failure
returns null through the browser-owned promise; its error-Document loader remains
unfinished. Allowed requests now dispatch Fetch with parallel callbacks and abort
when the ongoing navigation ID changes, including direct history assignments.
Network failure returns null; cancellation returns no params and completes without
an error Document. Received responses now parse policies, combine captured sandbox
flags, determine origins, enforce top-level COOP, and check HTTP(S) child CORP against
the container Document. Policy rejection returns null; configured COOP reporting
endpoints still reach the unfinished URL-scoped Reporting queue. Controllers are
released on rejection or an unfinished operation. Manual redirects reuse the Fetch
controller, repeat request/response policy checks, replace only the redirected
entry's DocumentState, and let Fetch handle method/body changes and redirect limits.
Form-action checks the pending redirect target before Fetch sends it, following
Chromium/WebKit rather than HTML's previous-URL ordering or Firefox's initial-target
check (`SPEC_CLASH(navigation-redirect-csp-url)`). Non-fetch redirects retain the
last response's origin and reach the existing external/inline handler dependencies;
non-HTTP Fetch redirects fail. Admitted final responses return complete params with
the live controller/body, selected policy, reservation, timing, and captured inputs.
Fetch retains full timing for all navigation destinations, including children,
following the approved correction to Fetch's document-only condition
(`SPEC_CLASH(navigation-fetch-full-timing)`). Timing exposure checks remain unchanged.
Allowed iframe timing clears the pending fallback start, but its iframe-navigation
producer and fallback reporting still need §4.8.5 integration. Early Hints retain
the producing request's URL history before queued delivery or later redirects.
HTML's reserved-environment hook forwards to the loader, which extracts Link
relations, applies header attributes and early policy, and returns the Document
callback. Empty/ignored or invalid-only hints no longer abort navigation, and later 103 responses remain
ignored. Preload, preconnect, and modulepreload still throw at their named resource
operations; preload/module-map commitment is unfinished. Final-response Link
processing now selects each phase and prepares options from the incoming Document.
Empty/ASCII-whitespace media matches directly; nonempty queries and responsive-image
source-set construction throw at their named dependencies. Reserved-client Fetch
construction also remains unfinished. See the
[Link audit](browlet/loader/ROADMAP.md#link-header-preparation) for approved browser differences.
Top-level Document requests bypass generic connect-src/default-src checks, following
Fetch and all three browsers instead of CSP's fallback; form-action remains separate
(`SPEC_CLASH(csp-document-fetch-directive)`). The loader preserves null initiators from openerless
initial about:blank history and the provisional local loader; external handoff
still needs to distinguish absent attribution from verified browser-UI initiation. Resolving an
unspecified history referrer from a synthetic null request also remains explicitly
unfinished. X-Frame-Options uses the response URL's origin and Fetch's quoted
header splitting. CSP's frame-ancestor matcher and reporting
without an incoming global now exist, including both real Fetch report formats.
The full response-policy checker now aggregates violations, including synthetic
null-request inputs, and is connected to HTML response admission. Legacy reports
use the approved internal no-cors/error exception, with redirects still blocked;
clientless keepalive bodies retain a per-request 64 KiB bound without a client
group budget. These specification gaps are recorded in the CSP and Fetch roadmaps.
Srcdoc cookie-URL inheritance and null reserved-environment handling
must be resolved before enabling its synthetic loader. See the
[population audit](browlet/browsing/navigation/ROADMAP.md#html-745-population-selection-srcdoc-and-task-delivery).
Prompt policy/UI, full history application, and releasing waits whose tasks
are discarded by future teardown remain explicit dependencies.
Quota accounting and creation-time release exist;
fetchLater(), body validation/buffering, activation, and deferred request delivery
remain unavailable. Actual fragment scrolling still throws after target selection. This is not end-to-end navigation. Traversal's own state writes, later ID
checks, and complete history application/load-delay cleanup remain
unfinished. The generated UUID reaches provisional BiDi started/failed hooks,
which emit no protocol events.
See the [beginning-navigation audit](browlet/browsing/navigation/ROADMAP.md#html-7422-beginning-navigation-admission-and-handoff).
`UserAgent.createFreshTopLevelTraversable()` prepares an unnamed initial
about:blank context and requests navigation with its own active Document as
source. It still reaches the unfinished `Navigable.navigate()` operation.
Top-level registration now calls a provisional BiDi creation hook; original-opener
state, automation cache overrides, and subscribed context-created events remain
unimplemented. HTML and BiDi also disagree on the hook's required inputs; the
[top-level audit](browlet/browsing/navigation/ROADMAP.md#html-7312-top-level-traversables)
keeps that conflict explicit.
Iframe, object, and legacy frame `contentDocument`/`contentWindow` accessors now
project a retained child, including same-origin-domain filtering for Documents
and stable WindowProxy identity. Creating that child automatically remains
unfinished: the creation operation still reaches joint-history application after
its queued history insertion. Object/frame context
creation, element lifecycle callers, and BiDi delivery are also still missing;
see the [child audit](browlet/browsing/navigation/ROADMAP.md#html-7313-child-navigables).
`Window.navigation` exposes its
replaceable, nonconstructible EventTarget identity, entry-list reads, and
NavigationHistoryEntry metadata/state. New top-level Document commits initialize
the contiguous same-origin list; initial about:blank, inactive, and opaque-origin
Documents expose no entries. Request-referrer-policy capture for hiding older
entry URLs is still missing, although the getter consumes stored policies.
`updateCurrentEntry()` now stores state and fires a trusted current-entry-change
event. Reactivation reconciliation, queued disposal, and the Document's persisted
`pageshow` caller are implemented around explicit form/visibility dependencies.
The full history/bfcache coordinator remains unfinished. Same-document
entry commits and Navigation EventTarget teardown during
Document destruction remain unfinished. `navigation.activation` now retains its
entry pair and navigation type, populated by the existing top-level push/replace
commit before parser scripts and refreshed during retained-Document reactivation.
Updates preserve activation identity and hide ineligible predecessors. Full
traversal/reload completion remains unconnected; same-document updates must leave
the retained activation alone. `navigate()` and `reload()` now perform
conversion/validation, prepare serialized state, and own commit/completion promises,
but valid requests still throw at the unfinished Navigable operations. Tracker
settlement and event acceptance/cancellation are implemented; commit/completion
producers remain unfinished. Single and recursive unloading maintain Document's
unload counter, including release after asynchronous failure or task discard.
`traverseTo()`, `back()`, and `forward()` now select destinations,
resolve the current-entry case, and reuse pending requests. Their new-request
path captures the Window's transient activation, then reaches the unfinished history-step
application within the traversal queue. Source capture and queued failure handling are
implemented, including protection against an obsolete failure deleting a newer
request. `navigation.transition`, NavigationTransition, and NavigationDestination
now expose retained state and realm-owned commit/completion promises. Intercepted
event dispatch creates the transition; commit settles its committed promise
after its owner operation returns. Entry/history effects and the success producer
that settles finished and clears the transition remain unfinished. Precommit
execution delivers the owner controller, waits for converted handler promises,
and processes rejection. Commit rejects later use of the retained controller.
NavigateEvent now exposes its constructor/data, and internal cancellation aborts
its signal, fires navigateerror, and rejects the original tracker/transition without
clearing replacements created by callbacks. Navigable's notification entry points
now run cancellation on the active Window's loop or queue it there, repeatedly
cancel reentrant navigation, and reject pending traversals for child destruction.
The executing-loop parameter remains provisional until real callers establish
whether their existing Document/environment ownership can supply it internally.
NavigateEvent now validates `intercept()` and `scroll()`, registers converted
precommit/postcommit handlers, and retains focus/scroll choices.
NavigationPrecommitController redirects the retained destination/options and
appends postcommit handlers, protecting replacement trackers from reentrant
state getters. Controller creation/delivery and its commit-state invalidation
are connected; destination effects and actual scroll processing still throw explicitly.
Traversal, push/replace/reload, and download event preparation now create their
destinations; History reaches the preparation operation and aborts ongoing
navigation before rechecking activity. Disabled Navigation entries skip dispatch;
enabled entries initialize data, dispatch, cancel, or create an intercepted transition.
History-action and transient activation consumption now cover the top-level traversable,
including shadow trees and other origins. The sticky predicate uses the Window's
activation timestamp. Transient activation uses a five-second interval, and
`navigator.userActivation` exposes a stable live view of both states. Input/automation
notification and its close-watcher integration remain explicit dependencies.
`hasUAVisualTransition` is false because
Browlet does not display cached history renderings; adding that UI must supply its
presentation state. Commit selects URL/history update, same-document reload
entry update, or queued traversal resumption. Navigation's same-document entry
mutation, tracker notification, currententrychange/disposal, and postcommit
handler coordinator and finishing policy are implemented. Nonintercepted and
manually managed intercepted completion work. Automatic focus reset still needs
the shared §6.6 focus model and its focus-change producer. Scrolling selects
active-entry restoration or beginning/fragment scrolling, but saved positions,
non-HTML MIME fragment rules, and CSSOM View viewport effects remain explicit stubs.
HTML fragment selection and retained `:target` state now work, including legacy
anchor names and raw-before-decoded matching. Missing fragments clear the target;
top fragments clear it before the viewport-scrolling dependency. Element targets
are retained before the explicit ancestor-revealing/scroll/focus boundary. This
does not supply hidden-until-found/details revelation, layout scrolling, focus
chains, or automatic rendering invalidation. Selectlet and Stylelet hosts without the optional
retained-target DOM operation still use their previous URL approximation.
Queued joint-history application, traversal resumption, and the other navigation/child-
destruction lifecycle callers remain unfinished. Precommit
completion has idle-progress coverage through the supported host bridge after
integrating the scheduling repairs. Node-injected callbacks between independent
Browlet Agents retain a separate failing Experimental probe; same-Agent
cross-Window callbacks pass. See the [Navigation API inventory](./browlet/browsing/navigation/api/ROADMAP.md).
History-step application,
persisted/scroll-state restoration, navigation lifecycle cancellation, and
actual scrolling remain explicit dependencies. Inactive access follows HTML's SecurityError rule,
including the recorded browser disagreement for retained `state`. See the
[History audit](browlet/browsing/navigation/ROADMAP.md#html-725-history-foundations)
and [method preparation](browlet/browsing/navigation/ROADMAP.md#html-725-pushreplace-state-preparation).
`PopStateEvent` and `HashChangeEvent` expose their constructors and payloads;
DOM's legacy event factory also creates HashChangeEvent. Existing-Document history
updates now restore classic state, update the URL, notify Navigation, fire trusted
popstate, and queue trusted hashchange. Persisted-state restoration now respects
History's manual mode and Navigation's suppression, and scroll restoration stops
when the Document's user-scroll flag is set. Actual position capture/restoration
still throws after popstate and after hashchange is queued. Input production and
the flag's same-document reset lifecycle remain unconnected; unloading now clears
the flag. Synthetic scroll events do not supply that state. Optional form persistence remains absent.
New-Document initialization
now orders classic state, persistence, Navigation entries/activation, a provisional
BiDi committed notification, fragment-scroll scheduling, and parser-script permission.
Automatic position restoration still throws; scroll scheduling queues a delayed navigation task without
blocking script permission. User-interest policy, non-HTML target selection, and actual
scrolling remain throwing owners inside that task. BiDi sessions and protocol
attribution remain absent. The local loader releases the same script gate through its existing
provisional commit path. Retained-Document reactivation refreshes Navigation entries
and activation before persisted pageshow, but selective form reset and visibility
transitions still throw. Full traversal coordination, cache retention, and scrolling
remain unfinished; these producers do not make end-to-end back/forward traversal
work. Browlet has no cached
rendering UI, so hasUAVisualTransition remains false. The Window handler attributes
are supplied by §8.1.8. See the
[event-interface audit](browlet/browsing/navigation/events/ROADMAP.md).
`PageSwapEvent` exposes its nullable activation/transition payloads; its outgoing
producer is connected to recursive unloading around unfinished CSS, visibility,
and cache-admission dependencies.
`Document.reveal()` now guards once-per-activation delivery, fires PageRevealEvent,
and wraps transition activation in the existing script/checkpoint boundary.
The rendering caller remains unconnected. Inbound CSS resolution and transition
activation explicitly throw, so this does not yet provide automatic pagereveal.
The Document sets its reveal flag before resolution and clears it on reactivation.
The approved [target/trust conflict](browlet/browsing/navigation/ROADMAP.md#html-7463-revealing-the-document)
follows HTML/Chromium's trusted Window event rather than WebKit's untrusted Document target.
ViewTransition currently supplies
interface identity only: its promises, methods, and rendering lifecycle remain
unfinished. See the [rendering dependency](browlet/rendering/ROADMAP.md#viewtransition-dependency-identity).
`PageTransitionEvent` and Window's trusted pageshow/pagehide firing method are
implemented, including the legacy Document target. Retained-Document reactivation
now maintains `pageShowing` and calls persisted pageshow around explicit form/visibility
dependencies. Single and recursive unloading clear the flag and supply pagehide;
initial pageshow remains unfinished.
Cache-retention decisions remain absent; constructing or
firing the event does not provide those lifecycle effects.
`BeforeUnloadEvent` has its legacy factory and independent string `returnValue`.
Its special handler processing, automatic dispatch, activation/sandbox admission,
BiDi/UI confirmation, and navigation cancellation remain unfinished. Generated
typings use `any` for this one inherited property to preserve Event assignability;
the runtime still converts and stores a string.
`NotRestoredReasons` and `NotRestoredReasonDetails` expose their nonconstructible
interfaces and support recursive creation from retained records, including
realm-owned frozen arrays and default JSON behavior. Navigation Timing now
captures the incoming top-level history entry's masked diagnostics before Document
activation and loader callbacks. Child entries retain null; redirected entries
drop the old diagnostics with their replaced DocumentState. History-lifecycle
callers, unfinished inline/error-page loaders, and back/forward-cache decisions
remain unfinished. Document collects tree
records into active history state, including shadow-tree frames;
TopLevelTraversable masks foreign subtrees and retains a generic root reason
for hidden blockers. Approved collection/masking corrections are in the
[masking audit](browlet/browsing/navigation/ROADMAP.md#html-7462-masking-not-restored-reasons).
Document `hidden` and `visibilityState` expose retained state, initially hidden
for newly constructed Documents. Navigable initialization and the existing
cross-document history commit select the traversable's system visibility.
This implements the state-assignment part of initial visibility setup only:
the timestamp-zero `VisibilityStateEntry` and its insertion into Performance
Timeline, host-driven visibility updates, their cross-specification hooks,
and `visibilitychange` delivery remain unfinished. The existing traversable
default is visible; assigning its internal system state does not update current
Documents. See the [navigable audit](browlet/browsing/navigation/ROADMAP.md#html-73-and-731-navigable-foundations).
`Window.length` now counts current document-tree child navigables, using retained
iframe/object/embed/frame associations. Those associations still require internal
creation/destruction producers; appending a container alone creates no child.
`UserAgent.createChildNavigable()` provides the element-to-navigation entry,
but non-iframe contexts and queued history
application still throw. Embed's `setup()` also throws explicitly for its missing
Fetch/content-selection/navigation lifecycle; its retained child state and
collection integration do not imply automatic loading. See the
[child-navigable dependencies](browlet/browsing/navigation/ROADMAP.md#html-7313-child-navigables).
`UserAgent.destroyChildNavigable()` supplies the removal coordinator and schedules
recursive teardown after clearing the container and notifying Navigation.
Automatic removal is not connected. Full history application and BiDi delivery remain explicit
[destruction dependencies](browlet/browsing/navigation/ROADMAP.md#html-7316-child-navigable-destruction).
Top-level destruction and closing now have coordinators; unload cancellation waits
for queued Document checks. Prompt policy/UI still throws;
descendant unloading coordinates Document tasks around explicit visibility and
cache-admission dependencies. The traversal queue executes definite closing's
unload request on a later background turn and retains its asynchronous completion.
Window's script-closing authorization remains unfinished. UI removal and BiDi
delivery are provisional hooks. See the
[top-level audit](browlet/browsing/navigation/ROADMAP.md#html-7316-top-level-destruction-and-closing).
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
now query Window transient activation. Reload returns for a null relevant
Document, checks the entry origin, and calls the live Document's navigable.
Its coordinator now supplies Navigation API cancellation, state/tracker inputs,
reloadPending, and traversal queuing. The queued reload history application still
throws explicitly; dispatching population, unloading, replacement, and Navigation
entry/activation updates remain unfinished. Reload request construction already
selects Fetch revalidation. Stock Node still needs an explicit
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
modeled cluster selection, without native execution isolation. Structured data
enforces cluster IDs, including Wasm Module and shared-memory transport across
real isolates. MessagePort transport and public Document-owned dedicated startup
are connected on add-on runtimes; shared/nested startup remains unfinished.
`Origin.from()` supports strings, URL, Origin, and Window
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
and nested worker startup still prevent complete enforcement through those lifecycles.
WorkerGlobalScope, DedicatedWorkerGlobalScope, and SharedWorkerGlobalScope have declared members and
can be projected for internally supplied implementations. Public `new Worker()`
starts Document-owned classic/module execution on add-on runtimes, and public
SharedWorker starts or reuses execution for Window clients of the same UserAgent.
Stock Node rejects missing suspension before allocating a channel or thread;
nested dedicated construction retains its startup boundary. SharedWorker exposes its connection
port and ordinary outside error handler; it does not expose global messaging or
termination methods. Shared globals retain creation fields and expose `onconnect`.
The UserAgent's manager supplies discovery matching, native port connections,
and a shared owner set integrated with Document destruction. Port closure does
not remove its Document, and native exit releases registrations. Combined owner
activity and extension/between-loads deadlines now drive suspension and closing
across isolates, using browser-clock timers and Document activity/loading notifications.
Public SharedWorker ports require start()/onmessage, failed loads notify every
waiting client with noncancelable ordinary error events, and runtime errors stay
at the shared global/console. The worker roadmap records the browser/spec conflicts.
Dedicated globals forward messaging
through a hidden port and can close their agent's task queues; public dedicated
startup connects native channel transport and thread teardown.
WorkerLocation's read-only URL surface
is implemented; WorkerNavigator also supplies
[NavigatorID](browlet/navigator/ROADMAP.md#client-identification). Identification
uses the approved Chrome compatibility profile and configurable common `Win32`
platform, while User-Agent text retains its existing Fetch configuration/emulation
owner. [NavigatorLanguage](browlet/navigator/ROADMAP.md#language-preferences)
provides stable frozen lists, scoped initial BiDi selection, and queued per-global
change notifications. The default list and HTTP Accept-Language are `en-US`;
configured preference updates share the same ordered list. The producer must
supply all recipients and valid BCP 47 tags. OS preference watching, complete
recipient discovery, BiDi change routing, and cross-isolate change notifications
remain explicit dependencies. Initial preferences and live identification/connectivity
reads use the existing worker-to-browser service connection. [NavigatorOnLine](browlet/navigator/ROADMAP.md#browser-state)
reads Fetch's existing offline state immediately and queues trusted online/offline
events on each affected global's networking task source. Its producer supplies
complete recipients and previous effective state for scoped emulation updates.
OS network monitoring, BiDi connectivity change routing, and cross-isolate
notifications remain explicit dependencies; the default assumes connectivity.
Window's [NavigatorCookies](browlet/navigator/ROADMAP.md#cookies) reads the live
UserAgent cookie policy already used by Fetch and `Document.cookie`. True does
not guarantee that a particular Document or cookie can store data. Retained
Navigators keep reporting that browser policy after context detachment, following
the approved HTML/Firefox rule. WorkerNavigator does not expose this member.
Window's [PDF compatibility objects](browlet/navigator/ROADMAP.md#pdf-compatibility)
share navigation's `UserAgent.pdfViewerSupported` flag. It defaults to false,
so `pdfViewerEnabled` is false and `plugins`/`mimeTypes` are empty. Configured
support creates HTML's fixed compatibility objects for each new Window; this
does not implement PDF viewing. Inline document creation/rendering and external
software handoff remain throwing dependencies. Live preference changes have no
Window-list refresh contract yet. Retained collections preserve their identity;
MIME objects are shared across all plugin aliases with the generic enabledPlugin.
Secure Window Navigators expose
[NavigatorContentUtils](browlet/navigator/ROADMAP.md#custom-scheme-handlers): both
protocol-handler methods synchronously validate and normalize their arguments,
then queue browser-owned registration/removal. Those UserAgent operations
now retain exact-pair candidates and declined decisions in a lazy registry for
one UserAgent's lifetime. Duplicate pending requests share consent; removal
invalidates a late decision and forgets that pair. Each Document has the specified
automation mode, defaulting to `none`. Consent UI and automation verification
remain named throwing dependencies; setting the mode alone cannot bypass them.
Accepted pairs can prepare an invocation URL by stripping input credentials from
a copy, component-encoding its serialization, and replacing the first `%s`.
The WebDriver mode command validates decoded JSON and updates the selected active
Document, but its session-admission and current-context dependencies still throw.
HTTP routing and session lifecycle are not implemented. Durable storage, default
selection, OS integration, and actual handler navigation remain unfinished.
The [closing audit](browlet/navigator/ROADMAP.md#closing-custom-handler-audit)
also assigns cross-site registration-spam policy, safe consent UI, and optional
administrator restrictions to those unfinished hosts. Remembering a pair and
preparing its URL do not complete these policies or automatically select a default.
Workers do not expose these methods. Navigator and WorkerNavigator report the browser-owned
hardware concurrency. Worker Permissions and Storage still need service integration.
`importScripts()` now performs Trusted Types and URL validation, rejects module
workers, and executes imported scripts in order. Isolated workers use browser-side
Fetch through their private UserAgent channel; only the requesting worker blocks.
Ordered/nested imports, worker CSP, cross-origin no-cors responses, captured Blob
URLs, and termination during the wait have focused coverage. Same-isolate callers
still require a synchronously completed host hook. Resource Timing transport and
background-revalidation CSP reporting remain explicit dependencies. Worker CSP violations capture root
URL/status and dispatch on the worker global, while network reporting remains
a shared-service dependency. Dedicated/shared realm and settings
composition is available internally, including initial ownership and separate resource
state. It leaves execution readiness false; the separate-isolate startup path
now also uses this composition with transported creator values and reserved identity.
JS Engine can start a separate isolate and stop blocked execution. Browlet's host
adapter reloads the existing package bundle with a private startup marker,
creates its worker agent/loop, and
acknowledges host readiness. A creator environment snapshot, existing Origin/URL
records, and owner-assigned cluster IDs cross the startup channel; the parent
retains the actual owner. Dedicated workers inherit the cluster ID, shared workers get a
fresh one, and subsequent capture preserves those identities. Cluster membership
sets remain local. Creator policy snapshots also cross the channel and are
reconstructed as local policy implementations, retaining CSP self origins,
enforcement/reporting state, COEP, referrer policy, and integrity policies.
Configured startup now composes its inside environment from those values, without
a replacement creator Window or UserAgent. The retained inside UserAgent
connection supplies local timers and the shared lifetime clock without creating
another browser. It implements the full UserAgent surface, with explicit throws
for facilities that have no worker connection yet.
Report delivery and shared/nested lifetime updates remain dependencies; dedicated
Document activity and owner removal are connected. The original owner is retained
outside rather than replaced by an inside owner placeholder.
Copied URL records omit cached Blob registrations; resolving Blob URLs still
requires access to the original UserAgent's store.
An internally configured initial script can now be requested from the worker
through the creator's real Fetch client and shared stores. The creator retains
captured Blob registrations and reserves the inside Fetch client; its ID crosses
the startup channel. Complete response/local/Blob policy containers and the
creator-side COEP outcome now reach the inside environment's policy initializer.
It applies CSP and isolation decisions without recreating the creator's stores.
Production now composes that environment, adopts the reserved identity, requests
the initial script automatically, and applies response policies on its networking
task. Network and policy rejection discard the inside environment, queue an
ordinary error event on a dedicated outside Worker, and terminate the isolate.
Explicit termination suppresses late fetch failure delivery. Shared-root cleanup
also notifies every loading SharedWorker client and releases outside associations.
The browser's scripting preference is shared live with the inside environment;
script creation and later entry checks no longer require a local UserAgent.
The creator Document's sandbox stays separate from that preference and response CSP.
BiDi scripting overrides remain provisional: worker scope and transport are pending,
and disabling the preference does not interrupt an already-running script.
Response processing uses the existing script processors and module loader for
HTTP status, body, MIME, parse, and link failures. Valid roots and their module
graphs are loaded and linked before execution. Dedicated Document-owned startup
connects owner monitoring, script execution, and execution readiness.
Environment URL parsing delegates to its UserAgent connection. Synchronous Blob
lookup/revocation, live scalar preferences, configured trust and loading queries
reach the original browser owner. Inside module-resolution cases pass through
the normal environment UserAgent delegation. Data workers use their own opaque
origin for revocation checks. Captured
registrations survive revocation and are released when URL records are collected,
or when the connection closes. Initial-graph fetches retain and consume those
captures. The owner host queue must be able to answer synchronous calls; nested
connection forwarding, independent service execution, and general worker
Fetch/shared-store services remain unimplemented. Worker-created memory-backed
Blob URLs now register synchronously in the original browser store and are
removed when their worker exits. Their entries retain the worker's origin and
response policies, including a data worker's distinct opaque origin.
Memory-backed Blob/File messages now cross isolates through File API byte-segment
records. Host-backed files still need portable source descriptors: local cloning
preserves their lazy reads, but their records explicitly reject native transport.
Active FileReaders stop during permanent Document destruction and cooperative
worker shutdown through the shared global destruction hook, without author
events. Canceling a Blob stream prevents further reads/delivery but cannot
interrupt a host byte-source read already in progress.
FileReaderSync now reads memory-backed Blob/File data in dedicated/shared workers,
including cloned data. Host-selected sources need synchronous backing I/O; an
async-only source fails explicitly rather than blocking on its own Promise queue.
Worker Blob entries retain the full public type, but only origin and capture
identity are connected locally. Obtaining the Blob, checking another caller's
partition, or reading the creator's URL, UserAgent or policies throws an explicit
dependency error; the owner-side entry still provides these operations normally.
Rejected native serialization of an unsupported host-backed source leaves the
service connection usable. The worker global exposes `fetch` through WindowOrWorkerGlobalScope;
its general worker network/service transport remains unfinished.
Private initial-graph fetch transport now supports concurrent requests through
the creator's actual Fetch client, delivery on the worker networking queue, and
cancellation on exit. The graph loader now uses it, retaining its inside module
map and the actual outside creator as the initial graph's client. Dynamic
imports require the worker's own Fetch client; general worker Fetch and
nested-worker service forwarding also remain unconnected.
The configured bootstrap now executes downloaded classic/module code for
dedicated Document owners on add-on runtimes. Unsupported private host commands
are rejected. Public Document-owned construction uses this same bootstrap;
shared/nested startup remains unfinished.
Its internal Node-cloned messages are not HTML MessagePort transport. HTML
serialization records now carry cluster IDs and survive that channel for ordinary
graphs, transferred ArrayBuffers, shared memory, and native Wasm Module tokens.
Real-isolate tests reconstruct them with the existing HTML/Binding operations;
Other interface-owned resources require their own transport support.
The dedicated worker's hidden channel now connects native endpoints to HTML
MessagePort delivery, including disabled startup queues, receiving-realm
reconstruction, messageerror, and cleanup. Author-created MessagePorts now carry
native endpoints and pending HTML deliveries across isolates, including nested
transfers and repeated handoff. Public-constructor tests also exercise immediate
messaging, termination, load errors, and Document cleanup; relocated CJS/ESM
package tests use `new Worker()` without a test bootstrap. Shared UserAgent
services remain a separate dependency.
The host adapter can now fetch a prepared initial-script request in the creator
isolate and hand its consumed response to an explicit worker networking-task
consumer. Fetch retains the original stores and client; host-owned body streams
and parallel callback delivery avoid depending on creator Document activity.
Blob creator policies travel as values, and thread teardown cancels pending
fetching. The production script driver prepares complete initial graphs and
runs them after lifetime monitoring is connected. Nested-worker service routing
remains unwired. The reserved
inside-client identity is retained.
WorkerThreadRuntime loads the root script or linked module graph, delegates response
URL/CSP/isolation initialization to WorkerGlobalImpl, and discards the inside
environment on a failed load. WorkerThread queues the outside error and releases
the rejected isolate. Successful startup connects lifetime monitoring before
WorkerGlobalImpl.runScript() marks readiness, evaluates the script, and activates
messaging. The dedicated outside port is activated through a private host instruction;
top-level await does not delay activation. Public SharedWorker startup connects
discovery, outside associations, and connect events across isolates while preserving
explicit outside-port activation. Nested ownership and ServiceWorkerContainer's
client message queue remain dependencies.
The older in-process WorkerEnvironment fetch/completion path has been removed.
The dedicated `Worker` outside interface now has its hidden port, messaging
overloads, and error/message handlers, with ordinary Web IDL conversion and
constructor Trusted Types/URL checks. Public construction delegates to the
integration factory on its UserAgent. `terminate()` forwards through
the outside Worker's retained WorkerThread. Local-agent interface tests
exercise existing ports and script completion, not cross-isolate transport.
The dedicated/shared worker event-loop tail now performs cooperative shutdown:
after closing, all queues must empty and the final checkpoint must finish before
timers, external ports, local EventSources, and owners are released. Already-sent
outgoing messages remain deliverable. Later tasks, microtasks, and spinning continuations cannot
restart that HTML loop. The final cleanup now disconnects the runtime's private
endpoints so its native isolate can exit. This does not abort a blocking script;
rendering and Service Worker teardown remain dependencies.
`WorkerThread.terminate()` now connects native interruption to dedicated outside
port cleanup: it clears pending deliveries immediately and disconnects on native
exit, even if Fetch cleanup fails. Actual HTML classic/module runner tests verify
interruption without catch/finally or pending reactions through the public
Worker method. Native exit releases its host association. The public constructor
supplies the outside Worker before returning, so immediate termination reaches
the same execution owner. Remaining shared-service transport and shared-worker
connection cleanup are unimplemented. Natural native exit preserves
already-queued outside deliveries.
Dedicated runtime errors now cross the native channel as diagnostics, without
the original exception. Outside Worker delivery and uncanceled reporting through
live owners use HTML tasks and the normal ErrorEvent binding. Production startup
attaches the inside global's reporter. Propagation through terminated parents
still needs a route that survives their isolates; source filename/line/column
extraction remains the existing diagnostic metadata dependency.
Worker common-global API forwarding is connected through Web IDL, including
microtasks, structured cloning, Base64, security getters, Performance, and
Trusted Types. Worker timers count non-suspended elapsed time; string timer handlers require Trusted
Types/CSP/script preparation. General Fetch needs the remaining worker browser
services. Cross-thread messaging and separate-isolate execution have focused
coverage. Configured dedicated Document-owned startup now advances readiness,
executes the initial script, and activates messaging on add-on runtimes, including
public construction. Shared/nested construction and remaining shared-service APIs
are still unfinished. Worker event
producers remain separate dependencies. Inheritance
reports omit CORP's destination member and preserve local observation even with
an empty endpoint or outbound delivery disabled. Private Network Access and
Opaque Response Blocking remain absent; the
[COEP audit](browlet/browsing/policy/ROADMAP.md#html-714-cross-origin-embedder-policies)
records these dependencies without claiming physical isolation.

Worker lifetime ownership now selects a creating Document or worker and lists
ports connected outside the worker, including peers in transit. Ownerless and
Document-inactive periods, shared-worker timeout policies, and extended-lifetime/
actively-needed decisions are implemented. Protected/permissible/suspendable
checks now use owners, external ports, uncanceled timers, pending Fetch completion,
EventSources, and loading navigables. IndexedDB transactions and WebSocket/WebTransport
activity remain explicit inputs to add when those subsystems exist. Shared-owner
activity/deadline monitoring and public SharedWorker startup are connected; nested
ownership and Service Worker enforcement of the shared no-client lifetime ceiling remain
pending; see the
[worker lifetime review](browlet/workers/ROADMAP.md#document-order-review).

Configured dedicated isolates now retain an ownership registration in their
original Document. `Document.destroy()` removes that owner and requests orphan
closing through the existing loop cleanup; native exit releases the registration
even on startup failure. Aborting a Document or making it inactive does not remove
membership. Document activity reaches the inside lifetime predicates through
a shared atomic cell, including during a busy script. On addon bases, dedicated
startup connects this activity to stack-preserving suspension/resumption after
script loading and before the initial-script continuation. Closing disables
pending and future suspension, and owner removal resumes a paused worker for
cooperative cleanup. Stock Node rejects unsupported suspension. Worker timers
exclude accepted suspension periods, including the wait for an idle isolate's
next JavaScript entry; ordinary idle time still counts. The native wait blocks
Node messages too. JSThread coordinates resume, termination, and owner exit from
outside the wait; raw termination by an unrelated Node owner bypasses this
coordination. There is no nested native control loop or interruption of blocking
native I/O.
Recursive destruction still stops at the explicit HTML §7.5.10 stub;
its worker-exit regression is an expected failure with unexpected-pass detection.
Shared/nested owner monitoring and the forced-stop policy for an orphan blocked
in JavaScript remain pending. No Document lifecycle algorithm is replaced here.

Sandbox parsing, iframe attribute state, and creation-flag propagation exist,
but complete sandbox enforcement does not. Navigation admission and named lookup
now enforce the [sandbox navigation predicate](browlet/browsing/navigation/ROADMAP.md#html-7424-sandbox-navigation-permission),
including captured activation and permitted popup creators. Actual activation
tracking, history-application and close callers, forms, pointer lock, automatic
features, dialogs, orientation, presentation, and downloads remain incomplete.
Policy-container response creation, inheritance selection, local history retention,
and worker initialization are implemented independently of the missing full
iframe/navigation/history/worker lifecycles. Unassociated containers still use
an absent CSP list until a self origin is available. The
[§§7.1.5–7.1.7 audit](browlet/browsing/policy/ROADMAP.md#html-715-sandboxing)
maps every flag and remaining owner; service worker globals still await
their own declaration, and all workers await startup integration.
