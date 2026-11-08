# Scripting roadmap

HTML [§8](https://html.spec.whatwg.org/multipage/webappapis.html) owns Agents,
settings, script execution, scheduling, global utilities, and timers.
The Window scheduling kernel, controlled script/callback entries, function
timers, and reached Fetch/Streams/Reporting consumers are implemented.
HTML script-state contracts and modeled active-script lookup exist. Classic
execution and static/dynamic source-text/synthetic graph loading are connected.
Wasm ESM, complete module context restoration,
remaining checkpoint work, and other global lifecycles remain open.

[Project priority](../../PRIORITY.md) orders cross-subsystem work.
[Event-loop architecture](EVENT-LOOP-ARCHITECTURE.md) owns scheduling boundaries;
[JS Engine](../../js-engine/ROADMAP.md) owns missing runtime primitives.
Do not restart the completed task/timer foundation when adding these consumers.

## HTML §§8.1.1–8.1.2 audit

Reviewed 2026-10-25. Continue through §8 with the specification's state and
relationships explicit, while leaving agent execution-control research parked on
`research/html-agent-execution`. A modeled field is not proof that the engine
enforces it. Add tests of actual consuming behavior as that machinery arrives;
retain approved expected failures for unsupported runtime requirements.

### §8.1.1: routes into author code

This introduction inventories consumers; it does not define a new dispatcher.

| Entry | Present and missing dependencies |
| --- | --- |
| HTML script elements | [Script state](../dom/nodes/html/scripting/script.ts), parser handoff, and [Browlet's script handler](../browlet.ts) exist. Formal classic/module records, preparation/readiness, script fetching, and execution checks remain §§4.12 and 8.1.4 work. |
| `javascript:` navigation | [Queued admission](../browsing/navigation/ROADMAP.md#html-74232-queued-javascript-navigation-admission) now checks ID/origin and stops at the missing CSP navigation check. ClassicScript creation/run exists for the later consumer; decoding, string-result loading, and replacement remain navigation work. Do not substitute generic evaluation. |
| Event listeners and handlers | DOM listeners and the [IDL-handler core](event-handlers.ts) run callbacks. [GlobalEventHandlers](global-event-handlers.ts) is connected on Window, Document, HTML, SVG, and MathML. [WindowEventHandlers](window-event-handlers.ts) is connected on Window/body/frameset, along with Document-only handlers. Raw attributes and lazy compilation use the shared map. Window error handlers use five arguments and return-true cancellation; beforeunload converts nullable strings and preserves an existing returnValue. Form discovery, source locations, and event producers retain their explicit dependencies. |
| SVG scripting | [SVGScriptElement](../dom/nodes/svg/script-element.ts) supplies identity only. Its attributes, preparation, loading, and execution remain SVG-owned dependencies. |

### §8.1.2: agent state and allocation

| Requirement | Current contract and remaining dependency |
| --- | --- |
| `[[CanBlock]]` | Stored policy: only dedicated/shared workers use true. It does not configure V8. The Window regression below still fails. |
| `[[Signifier]]` / realm's agent | Immutable Browlet identity and direct `BrowletRealm.agent` ownership. Native signifiers and arbitrary surrounding-agent discovery are not connected. |
| `[[IsLockFree1/2/8]]`, `[[LittleEndian]]` | Read-only observations of the current runtime through Atomics and typed-array byte order. Future independently executing agents must report compatible facts for their cluster. ECMAScript §9.6 includes `[[IsLockFree8]]`; HTML's initialization list omits it. |
| `[[CandidateExecution]]` | ECMAScript's shared-memory execution model remains engine-owned. Browlet does not fabricate an empty event record or claim native memory events are tracked by its cluster objects. |
| Event loop | Every allocation creates its own loop. Existing explicit-queue support separates microtasks; stock Node's ambient queue remains a documented limitation. |
| Relevant agent | Existing platform binding ownership selects the relevant realm, then its agent. This does not solve incumbent or arbitrary active-script discovery. |
| Window cluster selection | `BrowsingContextGroup.obtainSimilarOriginWindowAgent()` owns site/origin keys, historical OAC choices, isolation-mode inheritance, and per-group separation. Navigation now processes the OAC header; `document.domain` and `originAgentCluster` consume the selected state. Cross-origin access checks remain unfinished. |
| Dedicated worker / worklet | Allocation creates a new agent and loop in the outside environment's cluster. The concrete global, settings, startup, and execution lifetime are still missing. |
| Shared / service worker | Each allocation creates a fresh origin-keyed cluster whose isolation mode starts at none. Shared-worker lookup/reuse belongs to its future manager, before this allocation. |
| Shared memory | Structured-data algorithms enforce cluster identity and isolation gates. That is not native memory isolation or a restriction on values directly supplied by the Node host. |

The three worker/worklet allocation methods on [UserAgent](../user-agent.ts)
create records and loops using the current host's task-turn scheduler;
they do not start a Node worker or provide independent forward progress.
The outside environment identifies the creator's cluster when needed.
Service-worker allocation needs no argument: its UserAgent owns the operation.
The [Workers](../workers/ROADMAP.md) and [Worklets](../worklets/ROADMAP.md) roadmaps
own the missing globals, scripts/modules, task delivery, suspension, and shutdown.
Those substantial integrations remain deferred.

[agents.test.ts](../../../test/browlet/scripting/agents.test.ts) exercises
allocation, immutable runtime facts, and the public Window blocking requirement.
The latter was first run as an ordinary failure: `Atomics.wait()` returned
`"timed-out"` instead of throwing TypeError. It now remains an expected failure
on all backends. A zero timeout prevents a hang; WebAssembly supplies shared
memory without relying on the conditionally exposed SharedArrayBuffer constructor.
The existing structured-data tests cover accepted same-cluster sharing and
rejected cross-cluster deserialization.

## HTML §§8.1.3.1–8.1.3.2 audit

Reviewed 2026-10-25. Every item in these two subsections is mapped to existing
code or an explicit implementation dependency. `BrowletEnvironmentBase` represents
HTML's environment; `BrowletEnvironment` represents its environment settings
object and owns its binding-aware promises, allocation functions, and task delivery
directly. The associated realm reaches those facilities through its environment.
The explicit context model below is separate. Internal sandboxes are not HTML
settings objects.

| §8.1.3.1 environment state | Code and remaining dependency |
| --- | --- |
| ID | `id` is allocated as a UUID and transferred from a reservation during Window setup. |
| Creation URL | `creationURL` survives independently of the live Document URL and API base URL. |
| Top-level creation URL | `topLevelCreationURL` retains the supplied URL or null. Worker/worklet setup must supply null. |
| Top-level origin | `topLevelOrigin` retains the supplied origin or null. Dedicated workers/worklets must inherit it; shared/service-worker startup must select the implementation-defined policy. |
| Target browsing context | `targetBrowsingContext` retains the navigation target or null. |
| Active service worker | `activeServiceWorker` retains a controller or null. Its `object` type is explicitly provisional until the service worker record and control lifecycle exist. |
| Execution ready flag | `executionReady` starts false; `markExecutionReady()` sets it during completed setup. |
| Environment discarding steps | `discard()` sets the Service Workers client `discarded` flag. Failed/aborted navigation, redirect reservation replacement, and failed worker startup still need to invoke it. This is not the teardown algorithm for an already-running global. |

Service Workers §2.4 supplies the discarding steps; it defines every HTML
environment as a service worker client, irrespective of registration or control.
No extension registry or worker startup machinery is needed to set that flag.

| §8.1.3.2 settings algorithm | Code and remaining dependency |
| --- | --- |
| Realm execution context | `realmExecutionContext` returns the associated realm's retained `JSExecutionContext`. Controlled script entry pushes that context below the script's own context. `env` remains the separate facilities object. |
| Module map | `moduleMap` returns the Document's `ModuleMap`; single-module fetching now stores pending callbacks and module results by URL value and type. Graph loading/linking remains unfinished. |
| API base URL | `apiBaseURL` queries the associated Document's current base URL. |
| Origin | `origin` queries the associated Document's origin. |
| Has cross-site ancestor | `hasCrossSiteAncestor` uses the Document's live ancestry query. |
| Policy container | `policyContainer` returns the associated Document's policies. |
| Cross-origin isolated capability | `crossOriginIsolatedCapability` returns false outside concrete isolation. The concrete branch calls `Document.isAllowedToUse()`: a Document without a browsing context or full activity returns false; fully active Documents check their Permissions Policy and report actual violations. |
| Time origin | `timeOrigin` supplies the existing HRT `Moment` for navigation start. |
| Responsible event loop | `responsibleEventLoop` returns `realm.agent.eventLoop`, the same agent that owns the associated global. |

Window supplies the settings queries above; its creation and live-Document
behavior are audited in [HTML §7.2.2.6](../browsing/window/ROADMAP.md#html-7226-script-settings-for-window-objects).
Worker/worklet settings must implement the same settings contract when their
globals are introduced.
[environment.test.ts](../../../test/browlet/environment.test.ts) covers the
discard flag, while the script/callback lifecycle tests cover the existing
entry and cleanup behavior.

## HTML §8.1.3.3: explicit context experiment

HTML's records and stack operations remain in JavaScript, with native incumbent
observations at opted-in platform entries. This models the entries Browlet
controls; the engine does not supply a record for every function invocation.

| Requirement | Present model and remaining dependency |
| --- | --- |
| Global state | `BrowletGlobalObject` requires the error-reporting flag, both rejected-promise collections, import map, and resolved module set. Window and `WorkerGlobalImpl` initialize them; future worklet globals must do so too. Runtime errors, native rejection delivery on addon backends, and import-map algorithms consume this state; script-element import-map callers remain unfinished. |
| Realm creation | `createBrowletRealm()` and production Window composition share `BrowletRealm.initialize()`: bracket global creation with the retained context, pop it, then remove SharedArrayBuffer when required. The ordinary factory accepts omitted customizations and returns the retained context. |
| Retained context | `BrowletRealm.executionContext` is stable for the realm's lifetime. Environment settings return that same record. The existing VM context and `env` facilities are separate. |
| Entry | `entryExecutionContext` selects the most recently pushed retained realm context, including a nested HTML entry. Its `.realm` supplies entry realm, `.realm.env` entry settings, and `.realm.globalObject` entry global. Missing entry context throws. |
| Incumbent | The latest script context or native platform observation and its skip counter select settings or the backup stack; missing backup settings throw. Callback preparation/cleanup maintain the counter and backup settings. Callback capture uses its binding environment for direct Node-host calls when both modeled stacks are empty; that accommodation stays outside the specification lookup. |
| Current | `runningExecutionContext.realm` gives the top modeled realm; that realm's `.env` and `.globalObject` supply current settings and global. It is only current for the transitions recorded in this stack; arbitrary author/built-in calls do not yet maintain it. |
| Relevant | A platform object's `PlatformRecord.realm` supplies its relevant realm independently of the stack; that realm's `.env` and `.globalObject` supply relevant settings and global. The binding records ownership, so changing the object's prototype does not change it. |

`JSScriptOrModule` carries the realm and HTML host-defined script. Complete
Script/Module records and active-script restoration remain §§8.1.4 and 8.1.6
work; the temporary record in `runScriptEvaluation()` has null `script`
until script creation and execution supply a parsed HTML script.
The generic realm factory alone does not construct an HTML global implementation
or attach settings; Window/worker/worklet composition owns those steps.

Native platform entry is now an additional incumbent source: a dependency-selected Binding
captures before JavaScript implementation frames, and a `JSExecutionContext`
scopes the observed environment in `incumbentEnv` on the HTML stack. Selection and
callback skip counters include these entries; retained entry and active-script
lookup do not change. `Window.postMessage()` passes the ABC and nested return/throw regressions
on every addon base. Stock Node keeps the approved attribution failures. This
does not supply a ScriptOrModule for the observed author function. The host-hook
audit now captures/restores scripts already visible to the modeled stack across
JobCallbacks; complete author-function provenance remains separate work.

Binding now derives capture from the incumbent parameter on injected resolvers and
accessors, synchronous callback conversion, and `[PutForwards]` dependencies. Browlet
supplies the event-loop lookup once when composing BindingWorld; Binding passes the
input after conversion. Location retains its explicit direct-host accommodation;
postMessage remains strict. The event-loop lookup remains public, with production
references lint-restricted to composition, Binding dispatch, and callback lifecycle.
Defaults/rest parameters that hide a binding callback's arity are lint errors.
Constructors still lack native incumbent capture; the [constructor regressions](#constructor-callback-incumbent)
now demonstrate the gap. Promise/async-sequence
conversions that run later rely on their own job/callback context.

[Callback lifecycle tests](../../../test/browlet/scripting/callback-lifecycle.test.ts)
cover creation/deletion ordering, distinct entry/incumbent/current/relevant realms,
settings and globals, direct-host capture, nested backup restoration, and failure
cleanup. The four-role test supplies execution records explicitly and uses a real
projected EventTarget for relevant ownership; it does not execute the example pages.
[DOM binding tests](../../../test/browlet/dom-binding.test.ts) also check relevant
ownership after prototype mutation.
[Window lifecycle tests](../../../test/browlet/browsing/navigation/document-lifecycle.test.ts)
also check that production Window installation runs with its retained context.
The A-to-B bound-listener investigation is **skipped by agreement** because its
translation of the examples is uncertain. Its `createFunction` observer is an
ordinary JavaScript forwarding function, not an established substitute for the
native API used to observe incumbent settings. Keep the original expectation
for review, without treating this probe as a settled conformance failure.
Revisit with the actual example pages and platform APIs when supported. The
[native browser probe and review qualification](../../../node-compat/experimental/browser-probes/callback-incumbent/README.md)
are retained separately from the synthetic test. The later sections below track
script/module processing and adopted engine operations. Native interception of
arbitrary author frames remains parked.

The entry/incumbent/current/relevant audit stops before §8.1.3.4, audited separately
below. Broader consumer regressions can follow when
[Window messaging](../communication/ROADMAP.md) exists.

### Constructor callback incumbent

The [regressions](../../../test/browlet/communication/window-messaging.test.ts) run
A's script calling an ordinary B-authored function that constructs C's
MutationObserver. Its callback is A's bound `postMessage`, so delivery exposes the
saved callback context through `MessageEvent.source` without an intervening author
function. Web IDL [callback conversion](https://webidl.spec.whatwg.org/#js-callback-function)
saves the incumbent at construction; [callback invocation](https://webidl.spec.whatwg.org/#invoke-a-callback-function)
restores that context. The expected source is B, independently of the A entry,
A callback realm, and C constructor realm.

All six runtime configurations report A. A-only controls pass. A separate
callback-taking legacy factory fixture exposes the same constructor boundary;
current HTML legacy factories (Image, Audio, Option) have no callback arguments.
These two regressions are approved expected failures on all backends; their
A-only controls remain ordinary passing tests. Fixing the gap requires a
constructible native entry and constructor dependency selection.

`SPEC_CLASH(mutation-observer-callback-incumbent)`: the expected result follows
Web IDL and Chromium/Firefox (B); WebKit reports A. The
[browser-only reproduction](../../../test/browlet/probes/constructor-incumbent.mjs)
confirmed the split on 2026-10-30, with A-only controls passing in all three.

## HTML §8.1.3.4 enabling and disabling scripting

`BrowletEnvironment.isScriptingEnabled()` checks the existing JavaScript support,
UserAgent preference, the relevant Window's current sandbox flags, and the BiDi
hook. Global disabling is sufficient; finer per-origin preferences are optional.
BiDi's approved no-session true result remains provisional until its scoped
overrides exist. A non-Window environment does not require a Document.

`env.isScriptingEnabledFor(object)` takes the implementation in its original
owning environment. In addition to settings policy, a Node's current node document
and a Window's associated document must have a browsing context. Adoption changes
the former without changing the object's relevant settings. Other platform-object
implementations need only the settings check. Image/iframe/media lazy-loading now
uses this shared predicate. Disabled is the negation of enabled; it needs no
separately stored state.

[Policy tests](../../../test/browlet/scripting/scripting-policy.test.ts) cover
settings versus object eligibility, live sandbox/preference/BiDi changes, adoption,
and replacement of a Window's associated document. The existing lazy-loading
suite exercises the real consumers. Parser `scriptingEnabled` configuration,
script-element preparation, and content event-handler compilation still need
their specified consumers; this audit does not route every execution path through
the predicate. Automation's explicit scripting bypass remains separate.

## HTML §8.1.3.5: secure contexts

The fixed classification on `BrowletEnvironmentBase` is read by the realm for
Web IDL exposure, by Fetch, and by the projected `isSecureContext` attribute.
Full settings retain the reserved classification rather than recomputing it.
`UserAgent.isURLPotentiallyTrustworthy()` already supplies the referenced URL
algorithm, including about/data URLs, loopback, and configured trust.

`SPEC_CLASH(secure-context-top-level-url)` preserves the existing Window
origin-and-ancestry checks by agreement. HTML's top-level-URL-only fallback
differs for creatorless about:blank, data documents, and insecure intermediate
ancestors. The [policy record](../browsing/policy/ROADMAP.md#trustworthiness)
contains the decision, source evidence, and existing regression coverage.

The other branches depend on missing globals/settings setup: a WorkerGlobalScope
uses its first owner's relevant settings; a WorkletGlobalScope is secure.
These requirements are marked on the environment query and in the worker/worklet
roadmaps. Do not infer them from a worker's own URL or opaque worklet origin.

## HTML §8.1.4.1: scripts

[script.ts](script.ts) owns the script classes, their creation algorithms, and partial
parsed-record classes; it does not evaluate code. `ScriptBase` holds shared state, `ClassicScript`
is concrete, and the abstract `ModuleScript` is the base for the module variants.
The base initializes `record` to null; subclasses only narrow its type. Concrete
JS records take their HTML script and derive the realm from its environment.

| Requirement | Code and remaining dependency |
| --- | --- |
| Classic or module script | `Script` is the union. Both retain `env`, `record`, `parseError`, `errorToRethrow`, `fetchOptions`, and `baseURL`; classic scripts also retain `mutedErrors`. |
| Parse failure versus evaluation failure | `record` can be null; creation retains the immediate failure in `parseError`. Classic creation also sets `errorToRethrow`; module creation leaves it null for graph loading to set. Calling scripts must consume these in §8.1.4.4. |
| ECMAScript records | Browlet's record classes distinguish kinds and carry realm/HostDefined. Classic, source-text, and synthetic records retain engine artifacts. Linking supplied graphs and evaluation work; automatic loading, Wasm ESM, and complete module-specific context restoration remain missing. |
| Module classifications | JavaScript and WebAssembly script classes have their corresponding record types. CSS/JSON/text share a synthetic-module base with null base URL and fetch options. See the creation slice below. |
| Fetch options | `ScriptFetchOptions` owns the seven fields, their defaults, request setup, and descendant copying; see the §8.1.4.2 slice below. |
| Active script | `EventLoop.activeScript` implements the lookup over the modeled stack: select the topmost non-null ScriptOrModule, then return its HostDefined. Built-in frames and incumbent skip counters do not change selection. |
| Existing consumers | HTMLScriptElement's result accepts `Script`; base-URL changes reparse only speculation-rule results. The current parser/Browlet evaluation path still supplies a provisional record with null HostDefined. Script creation/calling must establish actual records; job hooks must later capture and restore them. |

The callback lifecycle test exercises active-script selection across classic,
module, built-in, skipped-incumbent, and provisional entries, with restoration
after nested evaluation. It supplies records explicitly; it does not establish
dynamic import, actual module evaluation, or automatic author-call tracking.
[Base-URL regressions](../../../test/browlet/html/base-url.test.ts) also keep
classic/module parse failures out of speculation-rule reparsing. Both failed
before the result-kind check was added to the document's base-URL handler.

Module-map states, script creation/calling, error reporting, and module host hooks
retain their later audit boundaries. No Node/V8 work was added.

## HTML §8.1.4.2: fetching scripts

[script-fetch-options.ts](script-fetch-options.ts) implements default options,
classic/module request setup, and descendant option copying. Classic request
setup preserves the CORS setting's credentials; module setup uses the options'
credentials. Descendants inherit
the other options but select their own integrity and reset priority to auto.
`BrowletEnvironment.resolveModuleIntegrityMetadata()` reads the global
implementation's existing import map and compares URL keys by value.
Import-map parsing and normalization remain §8.1.5 work.

The fetch algorithms live together in [script-fetching.ts](script-fetching.ts).
[BrowletEnvironment](../environment/environment.ts) supplies thin forwarding methods that
select the target settings. Integrity lookup and realm-specific module-type
permission remain environment operations. The first two fetchers cover:

- **Classic script:** potential-CORS request, client/options setup, complete body
  consumption, HTTP/body failure checks, legacy charset selection with BOM
  override, and the script-creation handoff. Preserve the original response's
  CORS taint before unwrapping it; muted errors depend on that taint. Creation
  receives both the final response URL and the original source URL.
- **Classic worker script:** `env.fetchClassicWorkerScript()` uses the target
  environment as its receiver and retains the outside fetch client explicitly.
  It supplies a same-origin request,
  optional perform-fetch hook, HTTP(S)-only JavaScript MIME check, UTF-8 decoding,
  and creation in the supplied target settings with default fetch options.
  Hook responses undergo the same validation as ordinary Fetch responses.

Both reuse Fetch's policy, integrity, MIME blocking, and networking task delivery.
No parallel promise scheduler or alternate HTTP path was added.

`ClassicScript` now applies scripting policy and compiles without evaluation;
the creation slice below records its remaining timing and execution dependencies.
The existing `JSRealm.evaluate()` executes immediately and is not a replacement
for ParseScript. No HTML element or worker-startup caller is connected yet.

[Option tests](../../../test/browlet/scripting/script-fetch-options.test.ts) cover
defaults, request setup, descendant inheritance, and global/URL-key selection.
[Fetch tests](../../../test/browlet/scripting/script-fetching.test.ts) use real
Fetch with a controlled HTTP transport and replace only script creation. They
cover CORS credentials/taint, redirects, decoding, body/status failures, integrity,
nosniff, worker MIME checks, data URLs, and the custom hook. Successful tests prove
the fetch-to-creation handoff, not parsing, execution, or worker startup.

### Single-module fetching slice

`BrowletEnvironment.fetchSingleModuleScript()` and
`fetchSingleImportedModuleScript()` now implement request setup, type validation,
Fetch/custom-hook delivery, MIME selection, UTF-8 decoding, response referrer-policy
propagation, and the appropriate creation handoff. The receiver is the target
settings object; `fetchClient` remains the request's separate client and owner.
The optional module request occupies its specified position as an explicit
`undefined` when absent. Referrer arguments retain HTML's `client`/`no-referrer`
sentinels, translated to FetchRequest's existing representation at assignment.

[ModuleMap](module-map.ts) replaces the provisional `unknown` entries with module
scripts, null, or lists of waiting callbacks. It remains retained by the Document
and accessed through its environment. URL equality includes queries and fragments;
equal URL records share an entry. Different module types remain separate. Pending
requests share a callback list, and a successful result is stored before notifying
those callbacks. The map uses the original request URL; creation receives the final
response URL. The fetch algorithm removes HTTP/body/MIME failures before callbacks,
allowing a later attempt. Its initial lookup still honors a retained null, as
specified, although this fetcher does not produce one.

`JSModuleRequest` models ECMAScript's specifier and import-attribute list. Its
`getModuleType()` returns `ModuleType | null` (`javascript-or-wasm`, `css`, `json`,
or `text`). Explicit `javascript-or-wasm` attributes are invalid even though that
string is the internal default. Unsupported attribute strings also become null
here, moving HTML's supported-name check from `module type allowed` into type
selection. This keeps arbitrary strings out of the fetcher without a cast; all
unsupported imports still fail before fetching. `isModuleTypeAllowed()` checks
realm permission for a recognized type. The module map and destination helper
accept the same union. The CSS check uses
Web IDL's existing exposure predicate against the CSSStyleSheet declaration and
target realm, not a mutable global property.
The destination helper covers JSON, CSS, and text. These helpers live in §8.1.4.3
but are prerequisites for the fetchers. The parser now produces ModuleRequests.
HostGetSupportedImportAttributes supplies the shared supported-key policy and the
fetcher asserts it; loader rejection remains with §8.1.6.7.3 below.

All five module creation operations are constructors. JavaScript and CSS/JSON/text
now retain engine modules; WebAssembly still stops at an explicit ESM parser boundary.
[Module-fetch tests](../../../test/browlet/scripting/module-fetching.test.ts)
replace the constructors to isolate fetching and cover request/target separation,
top-level worker modes, creation dispatch, redirects, decoding, shared callbacks,
cache keys, failure/retry behavior, and target-realm exposure. They do not prove
module parsing, exports, dependency discovery, linking, or evaluation.

### Document module-graph orchestration

External, inline, and modulepreload graph entry points now connect root loading or
creation to `fetchDescendantsAndLink()`. External graphs report a failed root as
null. Inline graphs retain their source, base URL, options, and target settings
at the creation boundary. Modulepreload reports its root first, then takes HTML's
optional descendant-preloading branch without notifying its owner a second time.

The shared descendant algorithm retains root parse errors and link exceptions on
the script. A dependency loading rejection returns null unless the host loading
state records an error to rethrow, in which case the script carries that error.
`ModuleGraphLoadingState` retains the destination, optional custom fetch hook,
fetch client, and error slot consumed by HostLoadImportedModule.

`JSModuleRecord.loadRequestedModules()` now traverses static dependencies through
HostLoadImportedModule, and `link()` supplies the retained graph to the engine.
Promise completion uses the owning environment's `InternalPromise` observation path.
Internal implementation errors remain explicit rather than becoming author
link errors. [Graph tests](../../../test/browlet/scripting/module-graphs.test.ts)
replace record operations to isolate completion ordering,
fetch-client propagation, and the distinction between loading and module errors.
These tests establish orchestration only; the static-loader tests below exercise
actual parsing, fetching, linking, and evaluation.

### Worker and worklet module graphs

`fetchModuleWorkerScriptGraph()` and `fetchWorkletScriptGraph()` delegate to
`fetchWorkletModuleWorkerScriptGraph()`. The shared algorithm creates default
fetch options with the supplied credentials, fetches the root with the outside
client, and passes that client, destination, and optional custom fetch hook into
descendant loading. Each target environment retains its own created modules.

Worklet fetching supplies the custom hook. A caller-owned
[`ModuleResponsesMap`](../worklets/module-responses-map.ts) retains the specified
`fetching` state or response/body tuple by request URL, including failed downloads.
Pending consumers register completion callbacks and resume through their target
environment's networking task queue. Completed entries replay immediately, as the
algorithm specifies. Updating the map precedes notification, so reentrant and later
consumers see the retained response. This map shares bytes, not per-global module
records, and the same hook is carried into descendant loading.

The class lives with Worklets, but no `Worklet`, `WorkletGlobalScope`, or `addModule()`
lifecycle is implied. Those owners must supply the shared map and distinct settings
when implemented. Access is serialized on the current Node thread; separate runtime
threads will need an explicit transport for the shared response state.

**SPEC_CLASH(script-fetch-hook-failure):** The general
[`perform the fetch` hook](https://html.spec.whatwg.org/multipage/webappapis.html#fetching-scripts-perform-fetch)
says its callback receives null or bytes. The
[worklet algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-worklet-script-graph)
and [module responses map](https://html.spec.whatwg.org/multipage/worklets.html#concept-Worklet-module-responses-map)
explicitly retain and forward Fetch's `failure` sentinel too. The approved choice
follows that worklet algorithm: `PerformScriptFetch` accepts all three body results,
and existing fetchers handle `failure` as a failed fetch. Revisit when the preamble
and detailed algorithm agree.

[Worker/worklet graph tests](../../../test/browlet/scripting/worker-worklet-graphs.test.ts)
use real Fetch with a controlled transport. They cover separate request/target
environments, credentials/default options, retained descendant hooks, simultaneous
and later consumers, per-global completion tasks, and cached HTTP/body/MIME failures.
Only script creation and module-record operations are
replaced; these are fetch orchestration tests, not worker/worklet startup tests.

**Remaining implementation dependencies:**

- `fetchClassicWorkerImportedScript()` is an explicit throwing skeleton. Unlike
  the two callback-based classic fetchers, this algorithm pauses synchronously
  until Fetch completes, then returns a script or throws NetworkError. The
  [synchronous host wait](#html-8173-pausing) is not supplied by today's asynchronous
  Fetch task delivery. Do not substitute a Promise return or launch
  a fetch that cannot finish before this method returns.
- Descendant loading connects static/dynamic JavaScript/CSS/JSON/text/Wasm graphs
  through HostLoadImportedModule. Source-phase URL imports stop at the compiled
  record; deferred requests, object-valued source lookup, and worker/worklet
  startup retain their separate owners.

Calling is tracked under §8.1.4.4 below.

## HTML §8.1.4.3: creating scripts

The constructors in [script.ts](script.ts) translate creation without evaluating
author code. Existing module-type/destination helpers already cover the section's
remaining algorithms.

| Creation | Implemented behavior and explicit boundary |
| --- | --- |
| Classic | Muted errors select `about:blank`; disabled scripting supplies empty source unless bypassed. Retains options, original source URL, realm, and HostDefined. The selected backend compiles without executing: `vm.Script` for stock contexts, a native UnboundScript handle for addon contexts. Syntax errors belong to the target realm and populate both error fields. |
| JavaScript module | Applies scripting policy, compiles in the existing VM context, and retains engine requests including attributes and phase. Syntax failures belong to the target realm and select the first parse error without setting `errorToRethrow`. |
| WebAssembly | Disabled scripting substitutes the eight-byte empty module. JSRealm and the addon now compile a retained Wasm record with its ordered external requests, source object, and HTML association. Parse exceptions populate only `parseError`; missing backend capabilities propagate. Instantiation uses HTML's existing callback adapter. |
| CSS | Constructs a sheet with default options and calls `replaceSync`; replacement exceptions become `parseError`. Binding projects the sheet before the real synthetic module retains its default export. |
| JSON | Uses the target realm's captured JSON parser, retaining the parsed value or realm-owned parse error. Does not blank source when scripting is disabled. |
| Text | Retains the supplied string unchanged as the default-export input, also independently of scripting enablement. |

The classic representation boundary remains marked for review: `JSRealm.parseScript()`
returns an opaque compiled artifact instead of a complete ECMAScript Script Record;
HTML wraps it with the realm/HostDefined. Module records likewise retain opaque
engine modules. Their requested-module list comes from the engine, and a Map from
request records to loaded records supplies the dependency associations for linking.
This is an internal representation of ECMAScript's loaded-module relationships;
automatic static and dynamic loading now supplies those associations.
Compiled classic code now uses the §8.1.4.4 execution path through
`JSRealm.runScript()`, without recompiling. The record supplies its modeled
script context; complete native active-script metadata remains unfinished.

Source-text and synthetic execution now uses Pip's promoted addon implementation,
or stock Node's VM modules with `--experimental-vm-modules`. V8 handles cycles,
live bindings, pending/rejected top-level await, and evaluation order. The native
evaluation Promise becomes an `env.InternalPromise`; CSS projection remains a
binding effect supplied by the environment. The runner's retained realm context
does not identify the currently executing dependency or its resumed async body.
Module-specific entry/restore hooks and Wasm ESM remain explicit
work rather than being approximated by the root module. `import.meta` instead
retains its exact module record through Node's lazy initializer; §8.1.6.7.1 below
supplies `url` and `resolve` without reconstructing the active script.

[Engine tests](../../../test/js-engine/modules.test.ts) and
[HTML execution tests](../../../test/browlet/scripting/module-execution.test.ts)
exercise real records, including a dependency-free inline graph through the
HTML entry point and a supplied graph importing JSON, text, and a CSSStyleSheet
platform object. [Native tests](../../../node-compat/test/modules.test.cjs)
retain the original 23 engine/lifetime cases. Pip's Wasm and string-hook bridges
are now adopted in the addon; their HTML connections remain separate work.
The maintained [Wasm gaps](../../../node-compat/test/wasm-gaps.test.cjs),
[independent Node controls](../../../node-compat/test/wasm-node-gaps.test.cjs), and
[string-hook gaps](../../../node-compat/test/code-generation-gaps.test.cjs)
retain the approved expected failures.

`UserAgent.webDriver` now contains BiDi's create/prepare/ScriptEvaluation command
sequence, stopping at explicit unfinished dependencies. `JSScriptRecord.evaluate()`
is the retained-record execution boundary and runs the compiled artifact.
ECMAScript Await must also suspend/resume the modeled context before asynchronous
command completion can work. Browlet's local `PageEvaluation` remains separate
until the driver is executable. The [automation boundary](../automation/README.md)
records target/session, serialization, activation, and exception requirements,
plus the reviewed BiDi parse-error choice: a null record returns the retained
parse error through the normal exception-result path, following browser and WPT
behavior despite the omitted branch in the command algorithms.

The Long Animation Frames creation hook retains `originalSourceURL`, but frame
timing records, pending-script entry creation, and reporting remain missing in
[Performance](../performance/ROADMAP.md). This is not a complete timing hook.

**SPEC_CLASH(css-module-base-url):** HTML §8.1.4.3 creates the sheet with empty
constructor options, which select the document base URL. Blink, Gecko, WebKit's
CSS-module implementation, and WPT instead use the fetched module's final URL.
Follow that behavior: single-module fetching passes the response URL into
`CSSModuleScript`, which supplies it as the constructed sheet's `baseURL` option.
The synthetic module script's `baseURL` and the sheet's `href` remain null.
[WHATWG issue #11629](https://github.com/whatwg/html/issues/11629) and
[the proposed spec correction](https://github.com/whatwg/html/pull/11706) track
the conflict; the issue links the relative-URL WPT and Gecko's implementation.
The [module-fetching regression](../../../test/browlet/scripting/module-fetching.test.ts)
uses distinct document, request, and final response URLs, then checks a relative
resource request from the created sheet. It invokes the resource loader directly;
property-driven image loading remains unfinished.

**SPEC_CLASH(css-module-imports):** HTML's creation note says `replaceSync` throws
for `@import`, while [CSSOM's algorithm](https://drafts.csswg.org/cssom/#dom-cssstylesheet-replacesync)
discards imports. Eric approved following the invoked CSSOM algorithm and retaining
the existing Stylelet behavior. The creation test verifies the remaining rules
survive; no import load or adoption is started.

[Creation tests](../../../test/browlet/scripting/script-creation.test.ts) use real
classic compilation, CSS parsing, and realm-owned JSON parsing. JavaScript-module
and Wasm tests replace only the explicit parser dependencies to check policy,
state, and error handoffs. These tests do not establish module execution or an
HTML script-element/worker startup lifecycle.

## HTML §8.1.4.4 calling scripts

The HTML control flow now lives on `ClassicScript.run(rethrowErrors)` and
`ModuleScript.run(preventErrorReporting)`. These use the script's own environment;
they do not replace Browlet's convenience evaluator or BiDi's distinct command
algorithms.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Check if we can run script | `env.canRunScript()` returns a boolean, checking a Window's fully-active document before scripting policy; non-Window globals have no document gate. |
| Run a classic script | Returns an empty normal completion when disallowed, prepares the realm, selects the retained error or ScriptEvaluation result, reports or rethrows as specified, and cleans up before returning/rethrowing. Muted rethrows become a realm-owned NetworkError. |
| Run a module script | Returns a fulfilled internal promise when disallowed; otherwise prepares the realm, rejects with the retained error or requests graph evaluation, attaches optional rejection reporting before cleanup, and returns the same evaluation promise. Cleanup does not wait for settlement. |
| Preparation and cleanup | Existing EventLoop methods retain the realm context and task's settings set. Direct Node-host entries still have the documented nullable-task/checkpoint accommodation; uncontrolled JavaScript entries are not made observable by this audit. |
| Running script | `EventLoop.runningScript` reads only the running context's ScriptOrModule.HostDefined. Unlike `activeScript`, it does not search lower frames. |
| Execution timing | Explicit TODOs at both run entry points; Long Animation Frames needs document frame timing and pending-script entries. |
| Retained execution | `JSScriptRecord.evaluate()` pushes a script context, executes its compiled code through JSRealm, converts the result/exception to a completion, and restores the stack before HTML cleanup. `JSModuleRecord.evaluate()` executes linked graphs and adapts their native Promise; module-specific context entry and restoration remain unfinished. |
| Runtime errors | The run algorithms invoke `env.reportException`; §8.1.4.6 now supplies ErrorEvent dispatch, cancellation, and muting. Classic runners retain their script explicitly for parse errors and unwound evaluation. Source attribution and worker propagation remain unfinished. |
| Termination | A null evaluation outcome selects the specified QuotaExceededError completion/rejected promise. Binding allocates that exception in the script's realm. Actual termination and unwinding remain §8.1.4.5/runtime work. |

**Activity check:** the Section 7 related-window pass replaced the approved
provisional child result with actual container-document associations and recursive
ancestor checks. An unassociated child, a Document without a browsing context, or
an inactive history entry fails. The embedding element's node Document can differ
from `parent.activeDocument`. This affects task/timer eligibility as well as scripts.
Automatic child creation/destruction and ancestor-activity notification propagation
remain [navigation dependencies](../browsing/navigation/ROADMAP.md#missing).

**Representation review:** the evaluation boundaries use null for termination
without a completion/promise; ordinary author exceptions remain throw completions
or promise rejections. The current runner branch assumes the retained realm context
is present for HTML's cleanup. Actual termination and modeled-state reconciliation
remain the §8.1.4.5 dependency below. BiDi has an explicit unfinished termination branch.
`emptyCompletionValue` distinguishes ECMAScript's empty from JavaScript undefined.
The module operation uses the established InternalPromise contract.

[Calling tests](../../../test/browlet/scripting/script-calling.test.ts) now execute
retained classic code through both backends, checking its realm, active script,
nested restoration, thrown identity, and task-cleanup checkpoint. Control-flow
tests still replace evaluation/reporting where needed; module graphs and
termination remain unfinished. Native compilation, lexical bindings, independent
queues, GC, and worker teardown have [addon regressions](../../../node-compat/test/retained-scripts.test.cjs).
The new execution expectations first failed at the missing retained-evaluation boundary.

Eric approved stock-only expected failures for the separate Window/VM global
properties and synchronous checkpoint during a Node microtask. The global-var
test also exercises the unchanged source evaluator as a control; these limits
are not hidden by weakening the expected results. Native contexts/queues pass.
The child-document expectation was previously observed failing before applying
the approved provisional behavior.

Script-element/worker startup still needs production callers for these runners.

## HTML §8.1.4.5 killing scripts

`Agent.abortRunningScript()` names the operation on the execution owner, shared
by its realms. This local operation still throws an InternalError; a Window
sharing its Node caller's thread has no independent stop source. That throw
reports an unfinished implementation; it is not the specified abortion.

Independent workers now use their outside `WorkerThread.terminate()` owner to
stop native execution without sending a task to the blocked inside agent. Native
exit discards that agent's entire isolate; the host clears the dedicated outside
port queue immediately and disconnects it after exit. Classic and module runner
regressions verify that catch/finally, pending reactions, and error handlers do
not run. This whole-worker lifetime operation does not supply interruption that
preserves a Window's shared Node thread. See the [worker termination review](../workers/ROADMAP.md#document-order-review).

**Decision for the shared Node thread:** retain direct synchronous host access
and defer forced script interruption. No addon termination work, watchdog, or
move of Browlet into a worker is planned for this audit. An infinite loop can
therefore block both the page and its Node caller indefinitely. Node does not
automatically impose a script execution deadline.

The missing piece is an independently runnable stop source, not merely another
VM context. A native thread could enforce a pre-armed deadline or receive an
external command without moving Browlet into a worker. It cannot make a timer or
abort listener on the blocked JavaScript thread run. Chromium has independently
runnable browser/IO control and can interrupt page execution; that capability
does not establish an equivalent control channel or safe unwind boundary here.
Revisit this only for a concrete independent-control requirement or a future
worker lifecycle, rather than treating it as a prerequisite for the next section.

| Requirement or permitted policy | Current disposition |
| --- | --- |
| Abort a running script | Must immediately stop ScriptEvaluation or source-text-module Evaluate, empty the real JavaScript execution stack, and bypass author catch/finally. Agent exposes the explicit runtime dependency. A JavaScript throw, rejected Promise, or clearing our context array does not implement this. |
| Resource limits | CPU, memory, execution-time, and bandwidth quotas are optional. This audit introduces no script-specific quota, throttle, or watchdog. Existing Fetch cancellation is not script termination. |
| Response to exceeding a limit | The permitted QuotaExceededError, silent abort, prompt, or throttle choices remain with a future resource-policy owner. The calling algorithms' existing termination result is separate from choosing or enforcing a quota. |
| Offer disabling at a prompt | Encouraged UI behavior; dialogs and unresponsive-script prompts are not implemented. No artificial prompt callback or configuration is added here. |
| Disable scripting during execution | `UserAgent.scriptingEnabled` gates later HTML entries, but does not interrupt an executing script. Its TODO requires targeting affected Agents once runtime interruption exists, including policy changes made while a host prompt is active. |
| Close without executing further scripts | Optional close-time policy, including suppressing unload handlers. Browsing-context closing/unload integration remains with Section 7; no global disable-and-restore workaround is installed. |

The runtime boundary must preserve the host's ability to continue. The local V8
headers expose isolate-wide `TerminateExecution` and `CancelTerminateExecution`;
our multiple HTML Agents and Node host currently share an isolate. A direct call
does not establish safe targeting or containment. The addon has no abort entry
point, and Node callbacks on the same blocked thread cannot act as a watchdog.

Termination also needs an explicit return boundary for our JavaScript host
implementation. `EventLoop.cleanUpAfterRunningScript()` assumes its retained realm
context is still present; ordinary controlled entries use try/finally. Clearing
the modeled stack alone would both leave author code executing and break cleanup.
The backend and HTML integration must agree how actual unwinding reconciles
retained contexts, script-entry task bookkeeping, and backup incumbent state.
The previous null-outcome tests only exercise the runner branch with the retained
context intact; they do not prove that reconciliation or suppression of finally.

`LocalEvaluation.dispose()` removes queued delivery and rejects pending host
commands. It is not an implementation of aborting running JavaScript. Worker and
worklet termination will also need the Agent operation when their lifecycles are
implemented.

If this work is reopened, runtime acceptance must cover a bounded hostile loop
stopped externally, author catch/finally suppression, nested script/callback
entry, cleanup of the modeled state, and subsequent unrelated Node/realm progress.
Such probes require a separate process with an external timeout; this audit does
not run an unbounded loop in the test runner or add tests asserting that termination
works.

This completes the section's inventory with termination explicitly unfinished.
The deferred termination work does not block script creation, execution, or the
remaining HTML audit.

## HTML §8.1.4.6 runtime script errors

`BrowletEnvironment.reportException()` coordinates the owning global's reporting
state and DOM events. The existing `BrowletRealm.reportException()` callback
forwards to it, so DOM/Web IDL callback failures reach the same reporter as
classic/module runners and the public `reportError()` operation. Internal
sandboxes without an HTML global retain console-only reporting. A browser realm
without its environment throws an InternalError instead of falling back to the
console. The realm exposes that environment as `env`; its setter also replaces
the early environment base. HTML's `[[HostDefined]]` name remains a spec reference.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Extract error information | `ErrorEventImpl.extractErrorInformation()` retains the exception and derives a message by string conversion, using `Unknown error` if conversion throws. Source filename, line, and column remain empty/zero pending runtime diagnostic metadata; Node stack text is not parsed as author-source metadata. |
| Muted classic errors | Replace author-visible details with `Script error.`, an empty filename, zero positions, and a null error. Classic runners supply their script explicitly, including parse failures without an evaluated frame; other callers use the modeled running-script lookup. Uncontrolled engine transitions still limit that lookup. |
| Omit the error | `omitError` clears only the error value, preserving the other diagnostic attributes. |
| Dispatch and recursion | Set the global's `inErrorReportingMode`, fire a trusted cancelable ErrorEvent when the global is an EventTarget, then clear the flag. Nested reporting does not dispatch another event on that global; different globals retain independent flags. |
| Unhandled exception | Cancellation suppresses further reporting. Dedicated workers forward diagnostic attributes through their startup-supplied owner reporter; outside Worker delivery and live-owner propagation use DOM-manipulation tasks. Other globals retain original-value console reporting. The worker roadmap tracks the remaining production connection and terminated-parent route. |
| Dedicated-worker propagation | Local worker reporting/cancellation is covered by the §10.2.5 audit. The associated outside Worker, cross-isolate diagnostic transport, and DOM-manipulation task delivery remain pending. The task must fire an event without the error value, then recursively report an unhandled exception with `omitError=true`. Continue through terminated/collected parents while suppressing handlers; port disentanglement exists, but its error-propagation consumer does not. |
| `reportError()` | Window calls its environment's reporter directly. Binding supplies the required argument and receiver ownership. Worker globals and their environment reporter exist; public worker exposure still needs WindowOrWorkerGlobalScope inclusion/forwarding. |
| ErrorEvent | DOM event implementation and HTML IDL contribution provide the five attributes and constructor dictionary. An omitted `error` starts as undefined, unlike the explicit null used for muting/omission. |

**Representation review:** extraction returns a typed attribute record in place
of the specification's ordered map keyed by IDL attributes; its `SPEC_MISMATCH`
marker remains pending review. Reporting through the global's environment is an
accepted ownership translation. The additional final script argument is retained:
`ClassicScript.run()` already reports before our cleanup pops the realm context,
but that context's `scriptOrModule` is null, and a parse failure has no script
record to push. Keeping the argument preserves muting without inventing a parsed
record for a failed parse. Other callers default to the modeled running script.
Retained-record evaluation now supplies and pops its script context before
returning a completion. The explicit argument still preserves muting when the
runner reports that completion. This is Browlet's chosen lifetime, independent
of which frames V8 retains.

**SPEC_CLASH(report-error-script-selection):** retain the explicitly supplied
script when a runner reports an exception; otherwise use the modeled running
script, or null. HTML leaves this selection implementation-defined. If classic
script A defines a function that calls `reportError('private message')` and script
B invokes it, Browlet consequently uses B's muted-errors flag. The
[runtime-error regressions](../../../test/browlet/scripting/runtime-errors.test.ts)
give A and B opposite flags and preserve the browser expectation in both
directions. Eric approved skipping these comparisons on 2026-10-31: matching
that behavior is not a chosen requirement. Keep the runtime unchanged and add
no native capture for these cases.

Live pages with same-origin and cross-origin script loads in Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2 all used A for that string case.
The behavior is not a general executing-script rule: when B creates an Error
object and A reports it, Chromium and WebKit use B's error origin, while Firefox
exposes the Error details even for a cross-origin B. Firefox's sanitized string
events also retain the filename and use undefined for the error; Chromium and
WebKit use an empty filename and null. Uncaught-throw and direct-report controls
confirmed that the script loads exercised muting.

These cases document compatibility differences, not an unmet normative demand
for broader execution-stack tracking. Job-registration compilation identity
remains a separate, implemented host-hook requirement. The comparison previously
observed both differences in all six configurations (custom/24.19.0/26.8.1,
each stock and compat). The two cases are now intentionally idle; their skipped
status is not evidence of browser alignment.

**SPEC_CLASH(report-error-muting):** follow the written
[reportError algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror),
including classic-script muting. Its note reports that Firefox does not mute,
whereas Chrome and Safari do. Eric approved following the algorithm on
2026-10-26. The live comparison above narrows that note: Firefox also mutes the
string case, but differs for the reported Error object and sanitized event fields.

Window's special five-argument `onerror` callback and return-true cancellation
are connected through §8.1.8.1's handler processing. `addEventListener('error', ...)`
and `preventDefault()` use the same DOM dispatch. Source-location extraction, complete active-script
provenance, and dedicated-worker ownership are the remaining dependencies of
this section; no new native bridge is introduced.

[Runtime-error tests](../../../test/browlet/scripting/runtime-errors.test.ts)
cover public projection, trusted events, cancellation, recursion, independent
globals, borrowed receivers, classic parse-error muting, modeled running-script
muting, omission, and constructor defaults/conversion. The first event-dispatch
expectation was observed failing against the prior console-only reporter. The
tests do not claim retained-script execution or worker propagation.

## HTML §8.1.4.7 unhandled promise rejections

`BrowletEnvironment.notifyAboutRejectedPromises()` translates this section's
notification algorithm. `trackPromiseRejection()` supplies the corresponding
HTML §8.1.6.4 hook body, treating its receiver as the current settings and using
the modeled running script when present. Window composition calls
`installRealmHostHooks()` to bind this two-argument tracker once the environment
and global are ready. Internal sandboxes do not register HTML hooks; future worker
composition must do so explicitly. All addon bases deliver native notifications;
global state remains on the global implementation.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Rejection notification | Clone and clear the pending list, then queue a DOM-manipulation task for the global. Skip handled promises, fire a trusted cancelable `unhandledrejection`, optionally report an uncanceled reason to the console, and retain still-unhandled promises in the weak set. Recheck handled state after listeners run. |
| HostPromiseRejectionTracker | Ignore a muted running classic script; otherwise select its settings or the current settings. Reject appends to the pending list. Handle removes an unnotified promise, or removes a previously reported promise from the weak set and queues a noncancelable `rejectionhandled` event. Native registration is per realm, independent of the patched job hooks. |
| PromiseRejectionEvent | The DOM event implementation and HTML IDL declarations expose `promise` as an opaque object and `reason` as any. Constructor conversion requires an object-valued promise but deliberately does not adopt thenables or require an actual Promise. Omitted reason is undefined. |
| Engine slot reads | `isPromiseHandled()` and `getPromiseResult()` use V8's non-observing reads on every addon base; stock Node explicitly throws. Neither attaches reactions nor reads author properties. |
| Checkpoint integration | After draining microtasks, notify environments with pending rejections. The loop retains only those environments until the checkpoint; notifying all other environments would be a no-op. Listener-created rejections receive a later notification task. |
| Global lifecycle | Window event delivery is exercised. Worker/worklet globals and their lifetime integration remain with their owners; notification dispatch currently requires an EventTarget global. Event-handler attributes remain §8.1.8 work. |

The outstanding weak set has no implementation-specific capacity limit. No
Node process listener or Promise prototype replacement intercepts existing
reporting. Internal sandboxes have no HTML global and are not tracker targets.

[Rejection tests](../../../test/browlet/scripting/promise-rejections.test.ts)
exercise public constructor conversion/identity and the real DOM task/event
path, with only the missing engine slot reads substituted. They explicitly
call the tracker and notification operation using pending native Promises as
identity-bearing fixtures; they do not claim native rejection tracking. Cases
cover early/late handling, handling during notification, cancellation,
rejections added during dispatch, script-selected settings, and muted scripts.
The separate [integration suite](../../../test/browlet/scripting/promise-rejection-integration.test.ts)
uses real native rejections, slot reads, checkpoints, event bindings, and
`Browlet.evaluate()`. Stock-only expected failures preserve the missing engine
boundary. Native tests also cover Node forwarding, collection, worker teardown,
and callback/job-hook coexistence. Complete running-script restoration in jobs
remains separate. The [Window event-target regression](../../../test/browlet/browsing/window-event-target.test.ts)
now passes through shared Window/Binding conversion, independently of native rejection tracking.
Window and WorkerGlobalScope inherit EventTarget;
WorkletGlobalScope does not. Keep the common global-state contract independent
of EventTarget and review worklet rejection delivery with its eventual consumer.

## HTML §8.1.4.8 import map parse results

[`ImportMapParseResult`](import-map.ts) retains either a normalized
import map or the parser's exception. It is a class with the specification's
two fields, separate from `Script`; HTMLScriptElement's result union includes it.
Creation neither registers the map nor reports parse errors. As with script
creation, InternalError escapes rather than masquerading as invalid author input.

`WindowImpl.registerImportMap()` reports a retained error through the Window's
environment and returns; otherwise it calls that Window's `mergeImportMap()`
with the parsed map. This does not replace the global's map by assignment or add a
new author-facing API.

The §8.1.5 parser and merger are now implemented in
[`import-map.ts`](import-map.ts), so explicit creation and registration produce
a usable map. §4.12.1 script-element preparation must still call these operations;
this does not yet implement `<script type="importmap">` processing.

`ImportMap` owns empty-map construction and its static parser; the parse-result
class lives beside it. The merge algorithm updates the global's existing map,
using copies of the incoming mappings. The global contract exposes
`mergeImportMap()` because merging needs its map and resolved-module set together.
Window and the existing service-worker global shell forward to the shared
algorithm body in this module; neither gains an author-facing API.

[Tests](../../../test/browlet/scripting/import-map-parse-results.test.ts)
control parser and merger results, checking the handoffs, deferred error
reporting, and real trusted/cancelable ErrorEvent dispatch at the registering
Window, including a different Window from the one used for parsing. They do not
establish import-map parsing, merging, or module resolution.

## HTML §8.1.4.9 speculation rules parse results

[`SpeculationRulesParseResult`](speculation-rules.ts) retains a rule set or its
parse exception, separately from `Script`. Its constructor supplies the input,
Document, and current document base URL to `SpeculationRuleSet.parse()` without
registering the result or reporting errors. InternalError escapes rather than
becoming an author parse error. The existing Document factory now calls this
constructor instead of returning an unparsed, apparently successful result.

Window owns the three lifecycle algorithms:

- `registerSpeculationRules()` reports a parse error synchronously by default,
  or queues a DOM manipulation task when requested. Success appends the rule set
  to the Window's associated Document and calls `considerSpeculativeLoads()`.
- `unregisterSpeculationRules()` ignores failed results; otherwise it removes
  all occurrences of that rule set, as Infra list removal requires, and calls
  `considerSpeculativeLoads()` even if the set was already absent.
- `updateSpeculationRules()` removes the old set and registers the new result
  with queued errors. Following the written algorithm, a failed replacement
  queues its error without an additional call to `considerSpeculativeLoads()`.

The approved §7.6 dependency is deliberately bounded. `SpeculationRuleSet` lives
beside the parse result and can currently represent only an empty `prefetchRules`
list. Expand it with the actual SpeculationRule model, URL-pattern/selector
predicates, requirements, tags, and No-Vary-Search hints when implementing §7.6.
Its static parser explicitly throws; no source string can produce a usable rule
set yet. Keeping the record/parser in Scripting lets the higher Loader consume
it without a reverse runtime dependency.

Document owns `speculationRuleSets`; its existing `considerSpeculativeLoads()`
remains an explicit no-op pending coalesced microtasks, rule matching, candidate
selection, and speculative resource lifecycles. §4.12.1 must connect script
preparation, execution, and removal to these entry points. Base-URL changes
already call creation and replacement, using the current Document for parsing
and the script's relevant Window for registration, including after adoption.

[Tests](../../../test/browlet/scripting/speculation-rules-parse-results.test.ts)
supply controlled parser results and exercise document ownership, list removal,
replacement, real Window ErrorEvents, and delayed DOM-task delivery. The
[base-URL suite](../../../test/browlet/html/base-url.test.ts) retains its ordering
and adoption checks. These establish the §8.1.4.9 lifecycle, not §7.6 parsing or
loading.

## HTML §8.1.5 module specifier resolution

Reviewed 2026-10-26. [`import-map.ts`](import-map.ts) translates the complete
section's algorithms. Import maps select URLs; the separate per-environment
`ModuleMap` caches fetched scripts and pending fetches. Resolution does not
fetch, link, or evaluate a module.

| Algorithm or state | Implementation |
| --- | --- |
| Resolve a module specifier | `env.resolveModuleSpecifier()` selects the referring script's environment and captured base, or this current environment and its API base. It checks scoped maps, top-level imports, then the URL fallback. The environment forwards to the algorithm body in `import-map.ts`. |
| Resolve an imports match / URL-like specifier | Private helpers implement exact and slash-prefix matches, special-scheme restrictions, blocked entries, invalid suffixes, and prevention of backtracking above a mapped prefix. A blocking error terminates resolution rather than trying a broader scope. |
| Resolved module set | Successful Window resolutions retain the normalized original specifier, original URL interpretation, and serialized base. Failures and non-Window resolutions add nothing. |
| Parse an import map string | `ImportMap.parse()` calls `env.realm.parseJSONStringToInfra()`, validates object shapes, and normalizes imports, scopes, and integrity. |
| Normalize keys, specifier maps, scopes, and integrity | Private helpers preserve URL alias behavior, use descending code-unit ordering, and distinguish ignored entries from null entries that block resolution. Integrity keys compare by URL value. |
| Merge module specifier maps / import maps | `global.mergeImportMap()` forwards to the shared body. Earlier definitions win, including null blocks. Copies of incoming mappings are filtered against completed resolutions; the existing global ImportMap object is retained. |

Infra retains the [JSON value types and realm-independent conversion](../../infra/json.ts).
The §6 string and object-conversion algorithms live on [JSRealm](../../js-engine/realm.ts)
and are exposed through `env.realm`, preserving realm-owned SyntaxErrors. The four
[JSON-byte algorithms on BrowletEnvironment](../environment/environment.ts) combine Encoding's
UTF-8 primitives with those string operations through `this.realm`. Fetch calls
the two operations it needs through its environment contract. Neither Infra nor
JS Engine depends on Encoding.
The explicit current
environment also allocates resolver TypeErrors, even when the referring script
selects a different environment's map. URL exports its existing `isSpecialURL()`
predicate instead of duplicating the special-scheme list in Scripting.

### Specification conflicts and browser evidence

Eric approved the Chromium/WebKit choices for the two merge conflicts:

- **`import-map-resolved-prefix`:** HTML removes a new key when it starts with
  an already resolved name. That can reject unrelated later names and allow a
  shorter prefix to remap a resolved URL. Browlet instead removes exact keys and
  slash-delimited prefixes of an already resolved name, matching Chromium/WebKit.
  Gecko references [WHATWG issue #11875](https://github.com/whatwg/html/issues/11875)
  and reverses the test, but still treats partial bare names as prefixes.
- **`import-map-merge-order`:** Resolution requires descending, most-specific
  ordering. HTML's merge steps append new entries without restoring it. Browlet
  re-sorts merged specifier maps and scopes, matching Chromium/WebKit's selection.

A live probe on 2026-10-26 used Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2. Start with `foo -> /foo.js` and `pkg/ -> /old/`, resolve `foo` and
`https://maps.test/untouched/a.js`, then add `f -> /f.js`, `foo/ -> /foo-sub/`,
`https://maps.test/untouched/ -> /changed/`, and `pkg/deep/ -> /specific/`.
The [merge regression](../../../test/browlet/scripting/import-maps.test.ts)
retains this sequence with Browlet's approved expectations.

| Later resolution | Chromium / WebKit / Browlet choice | Firefox observed |
| --- | --- | --- |
| `f` | `/f.js` | TypeError |
| `foo/x.js` | `/foo-sub/x.js` | TypeError |
| `https://maps.test/untouched/a.js` | Original URL | Original URL |
| `pkg/deep/x.js` | `/specific/x.js` | `/old/deep/x.js` |

Source evidence: Blink's `DocumentModulatorImpl::AddModuleToResolvedModuleSet`
and `ImportMap::MergeExistingAndNewImportMaps` retain slash-delimited prefixes
and reinitialize scope ordering; WebKit's `ImportMap.cpp` uses the same prefix
sets. Gecko's `js/loader/ImportMap.cpp` contains the reversed prefix comparison.
These observations establish the listed cases, not general browser conformance.

Two smaller editorial conflicts follow the algorithms:
`import-map-bare-address-example` rejects the bare address accepted by HTML's
normalization example; `import-map-scope-keys` uses the serialized string keys
produced and consumed by the algorithms despite the record definition saying
URLs. The integrity-normalization signature also omits `baseURL`, although its
caller supplies it and its steps use it. Our helper accepts it explicitly and
retains a pending `SPEC_MISMATCH` for that signature repair.

### Remaining integration

- §4.12.1 script preparation must create/register import maps. Existing tests call
  the real parse-result and Window registration path explicitly.
- §8.1.6 module hooks now call the resolver for static dependencies;
  `import.meta.resolve` is connected through `HostGetImportMetaProperties`.
  Dynamic-import routing remains unfinished.
- Normalization routes warnings through `env.reportConsoleWarning()`. Console's
  internal Printer/output is still provisional, so those warnings are not visible.
  Optional merge warnings are omitted.
- Worker/worklet globals and production module consumers remain unfinished. A
  real Sandbox environment tests the non-Window resolver path without inventing
  an HTML global or claiming worker loading support.

[Tests](../../../test/browlet/scripting/import-maps.test.ts) cover normalization,
scope fallback/blocking, prefix escapes, captured bases and realms, merge
conflicts, integrity, and actual registration. [Infra tests](../../../test/infra/json.test.ts)
cover nested conversion and object-key behavior. Continue with §8.1.6,
JavaScript specification host hooks.

Validation: the 43 focused tests across these suites, parse-result lifecycle,
and script-fetch options pass on 24.19.0, 26.8.1, and custom Node, each in stock
and compat mode. Typechecking, declaration-contract checks, and touched-file
ESLint also pass. This does not establish engine module execution or HTML
script-element integration.

## HTML §8.1.6: JavaScript host-hook audit

### Outstanding connections before event loops (2026-10-31)

This snapshot distinguishes adopted engine facilities from HTML connections.
It does not treat reaching §8.1.7 as completion of the earlier dependencies.

| Area | Current implementation | Remaining work and disposition |
| --- | --- | --- |
| Temporal clock (§8.1.6.5) | Window composition installs `BrowletEnvironment.getSystemUTCEpochNanoseconds()` through JS Engine and the existing addon in every isolation mode. Live policy checks, reporting, borrowing, and navigation are covered. | The native callback accepts only signed-int64 nanoseconds and requires custom/compat. Native AgentCluster isolation remains a separate engine boundary. See §8.1.6.5 below. |
| String compilation (§8.1.6.2) | Binding-owned TrustedScript extraction and CSP source-list checks/reporting are connected; Node's own checks remain in force. | The preceding Trusted Types/default-policy validation still needs compilation kind and original Function inputs absent from the engine callback. Keep the four approved input-gap failures and unsupported-backend limits; further native work is parked. This is not a later event-loop algorithm. |
| Execution attribution | Job registration and rejection notifications capture compilation identity and select the associated HTML script. The two ordinary-call rejection regressions now pass on every addon base; direct `reportError` selection retains its accepted compatibility limitation. | Rejection muting follows the approved Chromium/Firefox choice; WebKit and the literal built-in-context reading differ. Complete attribution across async resumptions and security-token boundaries remains unfinished. Constructor incumbent capture and borrowed-Function import-error realms retain their already approved expected failures. Do not turn these into an unbounded goal of mirroring every author frame. |
| WebAssembly modules | HTML parsing, ordinary graph loading, and source-phase URL imports use the addon's retained record. Evaluation has callback-aware instantiation; source imports expose the projected Module without traversing its graph. | Stock mode lacks the Wasm VM class; dynamic source imports require the existing Node forwarding export. Deferred phases, object-valued source lookup, and ESM binding limitations stay explicit in the [Wasm roadmap](../webassembly/ROADMAP.md). |
| Other adopted hooks | Promise rejection delivery, job routing, module imports, import metadata, cleanup-exception reporting, and idle cleanup wake-ups have their documented integrations. Generic/timeout hooks decline unrelated Node jobs. | Keep the existing private-element choice and unaudited whole-registry cleanup scheduling explicit. A missing task record alone does not justify another native handoff. |

Temporal's Window connection is complete; its backend and range limits remain
explicit. Permissions Policy is a different dependency from
the implemented Permissions API used by Storage; `Document.isAllowedToUse()` now
checks active Documents and reports violations. CSP source-list enforcement is connected;
complete Trusted Types compilation validation remains parked on its engine-input
dependency. Event-loop implementation has not resumed.

### §§8.1.6.1–8.1.6.3: private elements and string compilation

The first slice implements §8.1.6.3 `HostGetCodeForEval`. Window composition
supplies Binding-owned TrustedScript recognition to the realm's native
source-extraction callback. Binding unwraps a genuine platform object in the
main BindingWorld and reads retained data; author stringifiers, properties, and
prototypes do not participate. `undefined` represents the specification's
`no-code` result. Native direct eval retains its lexical scope, and borrowed
eval selects its own realm. The global eval/Function functions are unchanged.

[Regressions](../../../test/browlet/scripting/code-extraction.test.ts) cover direct
and indirect evaluation, foreign trusted values, empty source, realm-owned syntax
errors, forged/proxied values, and ordinary native compilation. Extraction needs
custom Node plus the addon; stock and official-addon cases retain the already
approved missing-forwarding-export expected failures.

Two boundaries remain explicit in [host-hooks.ts](host-hooks.ts):

- §8.1.6.1 `HostEnsureCanAddPrivateElement` stays unimplemented under the approved
  `SPEC_CLASH(html-private-elements)` choice. See the
  [engine decision](../../js-engine/ROADMAP.md#private-elements-on-host-objects).
- §8.1.6.2 `HostEnsureCanCompileStrings` delegates to CSP's
  [EnsureCSPDoesNotBlockStringCompilation](https://w3c.github.io/webappsec-csp/#can-compile-strings),
  whose source-list portion is now connected to the native callback. CSP selects
  script-src/default-src, interprets unsafe-eval/trusted-types-eval, and reports
  every violation; only enforcing policies block. The existing denial result
  creates EvalError in the compilation realm. See the
  [CSP consumer](../browsing/policy/csp/ROADMAP.md#string-compilation-consumer).
  The preceding Trusted Types validation remains unfinished: the native callback
  has only `(source, isCodeLike)`, not compilation kind or original Function arguments.
  Retain the four approved [input-gap regressions](../../../node-compat/test/code-generation-gaps.test.cjs).
  Do not reconstruct missing inputs from generated source. TrustedScript extraction
  and source-list checks do not enforce require-trusted-types-for on eval/Function,
  or invoke/validate the default policy. Stock and official addon modes retain the
  approved code-generation-hook availability failures.

Keep the compilation-policy boundary open before treating §8.1.6.2 as done.

Validation: the full custom/compat unit suite passes (515 files; 16,280 passing
tests). The extraction, Trusted Types, and callback-lifecycle suites pass across
all six runtime configurations with approved expected failures. Typechecking,
declaration contracts, touched-file ESLint, and the native code-generation suites
also pass; the latter retain their four approved input gaps.

### §8.1.6.4: Promise rejection tracking

Audited the hook against the current HTML algorithm and the native notification
entry. Its existing implementation needs no algorithm change: the executing
realm supplies current settings, a non-null running script supplies its own
settings, and a muted running classic script suppresses both operations. A
scriptless top context does not inherit a lower active script's muting/settings.

The pending-list and outstanding-weak-set branches match the specified order.
`rejectionhandled` is queued on the selected global's DOM-manipulation task
source, retaining the original Promise and its engine result. Unknown handles
are ignored. A borrowed Promise method can report handling in a different
global; notification still checks the engine's handled flag before firing.

The [algorithm tests](../../../test/browlet/scripting/promise-rejections.test.ts)
and [native integration tests](../../../test/browlet/scripting/promise-rejection-integration.test.ts)
now cover scriptless current-settings fallback above a muted script, unknown
handle notifications, borrowed `then`, and two fully active Windows sharing one
Agent/event loop with separate rejection state. Native notification and slot
reads work on all three addon bases; stock-mode limitations remain expected
failures under the existing approval.

The native rejection boundary now supplies retained compiled-code identity for
ordinary calls, as described below. Missing metadata still uses the modeled
running script. The §8.1.6.6 slice separately captures/restores active-script
context across callbacks. Complete author-function provenance and the existing
Worker/global lifecycle gates remain separate work.

At the original hook audit, both rejection suites passed across all six runtime configurations:
29 passing tests on each addon base; 16 passing and 13 approved expected failures
in each stock configuration. Touched-file ESLint and `git diff --check` pass.

#### Ordinary-call rejection attribution probe (31 October 2026)

SPEC_CLASH(promise-rejection-script-selection): Chromium/Firefox mute by the defining script in this probe; WebKit never mutes it, and the literal ECMAScript built-in context is scriptless. Browlet follows Chromium/Firefox using captured compilation identity.

Script A defines `function rejectFromDefinition() { return Promise.reject(42); }`;
script B calls it. The native integration regression gives A and B opposite
`mutedErrors` values. Before the repair, all three addon bases failed both
Chromium/Firefox comparisons: muted A/unmuted B emitted `[42]`, while unmuted
A/muted B emitted `[]`. The retained ordinary regressions now pass: A's muting
controls the result. Stock mode lacks the already-documented tracking facility.

The reproducible [browser probe](../../../node-compat/experimental/browser-probes/html/promise-rejection-attribution.mjs)
uses two HTTP origins and external classic scripts without CORS. Chromium
156.0.8078.4 and Firefox 157.0 select A's muting in all four A/B combinations.
WebKit 27.2 delivers `[42]` whether A and B are both unmuted, only A is muted,
only B is muted, or both are muted. The probe checks that both scripts ran;
the rejection reason is a primitive, so this result does not establish a general
policy for Error objects, async resumptions, or cross-realm reporting.

This is an approved browser-compatibility choice, not a settled normative reading.
[HTML's hook](https://html.spec.whatwg.org/multipage/webappapis.html#the-hostpromiserejectiontracker-implementation)
uses the [running context's ScriptOrModule](https://html.spec.whatwg.org/multipage/webappapis.html#running-script),
but ECMAScript's [BuiltinCallOrConstruct](https://tc39.es/ecma262/#sec-builtincallorconstruct)
sets that field to null. `Promise.reject` calls a built-in rejecting function
before entering the hook. Reading those steps literally therefore selects no
script here, rather than either author script. The browser comparison alone
does not justify treating the defining-script expectation as a settled normative
requirement.

The addon reads V8's public `GetCurrentHostDefinedOptions()` at rejection/handling,
before entering JavaScript. A VM-owned weak registry resolves that metadata to
retained compiled code on all three addon bases, independently of import-loader
support. HTML uses its existing compiled-code association to supply the script
to the tracker. Missing metadata falls back to the modeled running script;
unrecognized code selects no HTML script. The modeled execution stack is unchanged,
and no Node/V8 patch or universal platform-entry capture is needed.

Native regressions cover script/module identity without import callbacks, adapter
reloads, retained functions, and collection after flushing V8's compilation cache.
The engine query is security-token-sensitive; the ordinary same-realm cases do
not establish complete cross-realm or async provenance. The broader script-selection
questions above remain explicit rather than being inferred from these passing cases.

### §8.1.6.5: Temporal clock calculation and installation boundary

`BrowletEnvironment.getSystemUTCEpochNanoseconds()` implements the HTML algorithm
using this global's relevant settings. It reads `env.currentWallTime()`, which
already applies the environment's isolation-sensitive coarsening, converts the
reading to integer nanoseconds, and clamps it to Temporal's full Instant range
(±8.64 × 10²¹ ns). Integral milliseconds are converted to bigint before scaling;
multiplying the whole Number reading would lose low bits at today's epoch.
The fractional millisecond remainder is rounded to the nearest nanosecond.

The [tests](../../../test/browlet/scripting/temporal-clock.test.ts)
cover live readings, both precision policies, signed rounding, present-day epoch
precision, and both range endpoints and out-of-range inputs. Author calls to
native `Temporal.Now` now exercise automatic registration, live coarsening,
method-realm ownership when borrowed, and retained clocks after navigation.
`installRealmHostHooks()` registers the environment method through `JSRealm`
using the existing addon. No additional native code is needed. The integration
exposed and corrected lazy global descriptor capture: collecting Temporal's
descriptor in Node initialized its methods in Node's realm. JS Engine now
uses its captured realm-owned Reflect intrinsic for default descriptors and
initializes both Temporal and `Date.prototype.toTemporalInstant` before host
inspection. The latter also has a regression for page-visible Instant identity.

Concrete isolation is connected after the Permissions Policy integration. HTML's
[Window settings algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object)
returns false without a policy query for non-concrete isolation. Concrete
isolation calls `Document.isAllowedToUse('cross-origin-isolated')`, including its
[activity gates](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#allowed-to-use)
and violation reporting. Registration only retains the callback; it does not
query the Document before attachment. Navigation installs the associated Document
and response policies before author execution. Each reading uses live settings:
denied policy or an inactive/removed Document selects coarser precision, while a
report-only restriction reports without reducing permitted precision. Retained
native methods continue using their own environment after WindowProxy reuse.
The tests explicitly supply concrete isolation; configuring native AgentCluster
isolation and completing child navigation remain separate work. See the
[policy connection](../browsing/policy/permissions-policy/ROADMAP.md#permissions-policy-clock-prerequisite).

Eric accepted the remaining native limits on 2026-10-31:

- **Native timestamps must fit int64** (roughly 1677–2262). HTML specifies rounding
  and clamping to ±8.64 × 10²¹ ns; this is not a gap. The existing engine callback
  returns signed 64-bit nanoseconds, just like Chromium's callbacks in
  [V8Initializer](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/v8_initializer.cc).
  Today's timestamps fit, but the full HTML range requires an engine-boundary
  extension. Preserve the HTML clamp instead of silently narrowing it or
  fabricating a timestamp. The native contract tests cover both int64 endpoints
  and fatal overflow/throw behavior. No new patch is proposed for this limit.

Sources: [HTML HostSystemUTCEpochNanoseconds](https://html.spec.whatwg.org/multipage/webappapis.html#hostsystemutcepochnanoseconds),
[High Resolution Time coarsening](https://w3c.github.io/hr-time/#dfn-coarsen-time), Temporal's
[Instant range](https://tc39.es/proposal-temporal/#sec-temporal-instant-range), and
the [native clock contract](../../../node-compat/README.md#temporal-clock).
Official Node 24/26 lack the setter, and stock mode does not load it. Their HTML
clock assertions retain the approved backend limitation as expected failures.
Node 24's disabled-by-default Temporal also retains that approved availability
limit; namespace ownership passes wherever native Temporal is enabled.

Regression evidence: before removing the isolation guard, concrete registration
was absent and four native clock cases returned V8's system time instead of the
fixture's coarsened wall clock. All 24 Temporal tests now pass on custom/compat,
including enforced/report-only policy, reports, borrowing, and retained inactive
or detached Documents. No native code or clock calculation changes were needed.
The affected Temporal, HRT, Window-settings, policy-enforcement, and Document
lifecycle suites pass in all six runtime configurations (85 cases each), with
only approved backend expected failures. Typechecking, type contracts, touched-file
ESLint, and `git diff --check` pass.

The backend/range and Trusted Types compilation limits remain explicit in the
[outstanding-connections audit](#outstanding-connections-before-event-loops-2026-10-31).

### §8.1.6.6.1 and §8.1.6.6.6: JobCallback invocation and capture

Audited `HostCallJobCallback` together with its producer, `HostMakeJobCallback`.
Each HTML registration now retains incumbent settings and a fresh execution
context for the active script, or null when no HTML script is active. The new
context has null Function, the script's settings realm, and the script's record;
it does not retain the registration frame's mutable incumbent-skip counter.

Invocation prepares the stored incumbent, pushes the saved script context when
present, calls the original callback with its receiver and arguments, and pops
the context before callback cleanup. `finally` preserves that order on thrown
completions. Non-HTML registrations keep their existing direct-call path.

The [regressions](../../../test/browlet/scripting/job-callbacks.test.ts) observed
an author-visible failure before the correction: a muted classic script's
`pending.promise.then(reportError)` exposed the original exception and message.
The same foreign platform method registered by two scripts now applies each
script's own muting. Tests also cover fresh context identity, throwing reactions,
thenable receivers, nested registration, scriptless callbacks, and unrelated
Node Promise progress. Unsupported backends retain the existing approved
missing-host-hook expectations; the uncertain ABC listener test remains skipped.

The native registration snapshot supplies incumbent identity. The later
[active-script capture follow-up](#active-script-capture-at-job-registration)
also maps compilation metadata to HTML records. Neither reconstructs arbitrary
author frames. The later HostLoadImportedModule slice connects dynamic import,
including the retained referrer used by the spec's built-in eval example.

Validation: the callback, Promise-job, lifecycle, and runtime-error suites pass
across all six configurations (custom/compat: 41 passing and one existing skip;
official compat: 33 passing, eight expected failures, one skip; stock: 32 passing,
nine expected failures, one skip). The full custom/compat unit run passes:
517 files, 16,302 passing tests, 17 existing expected failures, 16 skips, and one
TODO. Typechecking, declaration contracts, touched-file ESLint, and diff checks
also pass. No addon or engine changes were needed.

### §8.1.6.6.2: FinalizationRegistry cleanup scheduling

Audited `HostEnqueueFinalizationRegistryCleanupJob(finalizationRegistry)` against
the HTML algorithm and the maintained native bridge. The confirmed exception
reporting defect is repaired on addon bases. Full HTML scheduling integration
remains unaudited; no separate browser-confirmed, author-visible scheduling
failure has been demonstrated.

The required path is:

1. Select the registry's `[[Realm]]` global and queue a global task on the
   JavaScript engine task source. This selects the task's Document and activity
   gating independently of the callback's realm.
2. In that task, prepare to run script using the cleanup callback's realm's
   environment. It need not be the registry's realm or the captured incumbent.
3. Run the whole `CleanupFinalizationRegistry` operation. Its individual calls
   still use the existing `HostCallJobCallback` machinery.
4. Clean up after running script, then report an abrupt completion to the
   registry's global. Reporting follows script cleanup and its checkpoint.

The current V8 patch exposes callback capture at construction and invocation
with one held value. It does not expose a registry cleanup enqueue callback,
the registry's stored cleanup callback, or an operation that resumes the whole
cleanup. V8's `FinalizationRegistryCleanupTask::RunInternal()` still dequeues
dirty registries, enters their contexts, runs cleanup, and requeues remaining
work. `JSFinalizationRegistry::Cleanup()` removes each cleared cell before our
call hook and stops on an abrupt callback completion. These are in the regular
Node checkout's `deps/v8/src/heap/finalization-registry-cleanup-task.cc` and
`deps/v8/src/objects/js-weak-refs.cc`.

Queuing individual callbacks from `callJobCallback` would let V8 consume cells
before author code runs. It would lose abrupt-completion control of the cleanup
loop and prevent intervening `unregister()` calls from removing those cells.
The native registry must remain the owner of its cells and cleanup operation.
If a future behavioral regression establishes a need to transfer scheduling,
that handoff must defer the operation as a unit, preserve both realms, and
account for rescheduling and context disposal. No new hook shape or engine patch
is required merely by the absence of a modeled HTML task.

The existing native FinalizationRegistry regression verifies capture/invocation
of the same construction record for multiple held values. It does not establish
HTML task scheduling, entry settings, Document gating, checkpoint ordering, or
exception reporting. Garbage collection timing remains implementation-defined;
that latitude does not supply these missing HTML responsibilities.

Follow-up probes (2026-10-29) established a concrete reporting difference. Before
the repair, a real Window's cleanup callback ran and threw, but the exception
reached Node's `uncaughtException` listener rather than the Window's `error`
listener. A `reportError()` control reached that Window listener correctly. The
maintained [Window regression](../../../test/browlet/scripting/finalization-errors.test.ts)
first failed at the missing event, then passed with the context reporter.

The [browser-only probe](../../../node-compat/experimental/finalization-cleanup/browser-reporting.cjs), enabled
explicitly with `--run`, passes on Chromium 156.0.8078.4, Firefox 157.0, and
Playwright WebKit 27.2. Each runs cleanup and dispatches a cancelable Window
`error` event containing the same thrown Error. With `preventDefault()`, the
automation client's unhandled page-error report is suppressed; without it,
that report also occurs. Every case observes an actual cleanup invocation after
requesting GC, rather than treating an absent callback as success.

This reporting requirement is not a specification gap. ECMAScript's
`CleanupFinalizationRegistry` propagates a throwing callback, and its
`HostEnqueueFinalizationRegistryCleanupJob` delegates error reporting to the
host. HTML §8.1.6.6.2 supplies that reporting step for the registry's global;
§8.1.4.6 dispatches the cancelable ErrorEvent. The browser results agree on this
case. They do not establish all cross-realm, lifecycle, or checkpoint behavior.

The adopted [context reporter](../../../node-compat/README.md#native-cleanup-error-reporting)
uses V8's entered/microtask context to select the registry owner. HTML registers
`env.reportException` during realm composition; the context retains it without
a global-proxy reverse lookup or additional native root. Custom Node routes
messages through `node::SetContextExceptionReporter` before process handlers and
abort policy. Official Node 24/26 use the approved private `_fatalException`
fallback. Their explicit abort flag runs earlier, so the stronger isolation
assertion remains an expected failure there. The stock-mode Window failure is
also approved: no addon means no context reporter. No new V8 patch is needed.

The native tests preserve registry/callback realm distinction, thrown value
identity, Node's monitor/capture/async behavior, reporter disposal, and removal.
The real Window test also verifies cancellation and that its error listener can
unregister remaining cells before another cleanup callback runs. These tests do
not establish every lifecycle or checkpoint ordering rule. The experimental
missing-task assertion is not evidence of a second browser-consensus failure or
a reason by itself to replace V8's cleanup scheduling.

The later idle-progress audit found a concrete missing wake-up on official
Node 24/26 addon builds: cleanup ran and queued a Promise reaction, but that
reaction remained pending until unrelated HTML work arrived. The
[Window regression](../../../test/browlet/scripting/finalization-wakeup.test.ts)
observed that failure before the repair. Custom Promise-job hooks already woke
the loop; stock Node's ambient queue also progressed.

The addon now offers a guarded `AddCallCompletedCallback` notification on the
existing microtask queue. It selects only the completing context's registered
queue, coalesces until the next checkpoint, and ignores checkpoint reentry.
`EventLoop.requestMicrotaskCheckpoint()` schedules the existing host turn;
the native callback neither runs jobs nor creates an HTML task. JS Engine omits
this fallback when native Promise-job hooks are installed. The
[native tests](../../../node-compat/test/microtask-wakeup.test.cjs) cover shared
queues, unrelated cleanup, rearming, collection, and worker teardown.

This completion signal can request a checkpoint when no jobs arrived, and it
does not observe every cross-context enqueue. The latter remains part of the
separate direct-host Promise interoperability boundary. It does not replace the
Wasm handoff, which must enter an HTML task before Promise resolution can invoke
an author `then` getter. Neither that boundary nor the separate Atomics hook
ownership defect requires expanding this cleanup repair.

### §8.1.6.6.3: Generic jobs

Audited `HostEnqueueGenericJob(job, realm)`. Both HTML steps are already
implemented: select the supplied realm's global, then queue `job()` on the
JavaScript engine task source. `BrowletRealm.queueGlobalTask()` selects that
global's event loop and associated Document. Task selection supplies the
fully-active Document gate. No script preparation or callback-state capture is
added to this hook; a resulting Promise reaction has its own enqueue hook.

The native consumer is `Atomics.waitAsync` notification delivery. V8's wakeup
enters the waiting context, retains the Promise in a single-use job, and hands
the job and realm to the addon. JS Engine maps the stable realm reference to
the HTML realm; the task later resolves the Promise. This slice changes no
runtime behavior or engine API.

The [engine-job regressions](../../../test/browlet/scripting/engine-jobs.test.ts)
verify task-source identity, the associated Document, and subsequent Promise
reaction delivery. The additional case borrows another same-agent Window's
`Atomics.waitAsync`: notification belongs to that function's realm, while the
reaction belongs to its callback's realm. Keeping the wait-owning Document
inactive leaves the task queued and the reaction unrun; reactivation permits
the task and its checkpoint. The fixture uses real Window bindings and explicit
activity relationships because auxiliary-window creation is still unfinished.

Without custom job hooks, notification is not handed to HTML. The ownership
follow-up below repairs the installed hook's handling of unrelated Node/VM jobs.

Validation: the 35 engine-job, task, and Promise-job cases pass across all six
runtime configurations, retaining the approved unsupported-backend expectations.
Custom/compat passes all 35 normally. Typechecking, type contracts, touched-file
ESLint, and diff checks pass.

### §8.1.6.6.4: Promise jobs

Audited `HostEnqueuePromiseJob(job, realm)` against HTML and the maintained
engine bridge. A non-null job realm selects the environment prepared before
invocation and cleaned up afterward. The operation queues an HTML microtask;
it does not add a `canRunScript()` gate. Handlerless propagation has a null job
realm and skips script preparation/cleanup. Callback incumbent and active-script
restoration remain with the make/call hooks audited above.

The hook retains an implementation-only third argument, `queueRealm`, and can
return `false` to decline a job. JS Engine derives that realm from the native
job's creation context. It preserves the engine's queue selection even for a
null job realm, while unrelated Node/VM jobs stay in their original queues.
These are native ownership adaptations, not additional HTML algorithm inputs.
The callable-shape review is marked at `enqueuePromiseJob()`.

One reporting bug was reproduced and repaired. A Promise registered in Window A
with a revoked fulfillment Proxy and a rejection function from Window B can
produce a job realm of A but a queue realm of B. ECMAScript's
[NewPromiseReactionJob](https://tc39.es/ecma262/#sec-newpromisereactionjob)
selects the current realm when `GetFunctionRealm` throws for the revoked Proxy.
V8 independently falls back to the other handler for queue selection. If a
custom Promise species supplies a throwing reject function, the whole job
completes abruptly. Browlet previously dispatched the error event in B. The
regression observed that wrong destination before the repair; reporting now
uses the supplied job realm A after script cleanup. No native change is needed.

The [Promise-job tests](../../../test/browlet/scripting/promise-jobs.test.ts)
also verify separate thenable/reaction microtasks, both directions of handlerless
propagation, cross-realm entry versus incumbent settings, and independent Window
queues. The [isolated error regression](../../../test/support/promise-job-error-child.ts)
checks ordinary and revoked handlers, cleanup before reporting, thrown-value
identity, continued microtask delivery, and isolation from Node's uncaught-error
path. An ordinary handler throw is still a rejection of its derived Promise,
not an uncaught job error. Unsupported backends retain the existing approved
missing-host-hook expectations; all assertions run on those configurations too.

`SPEC_GAP(promise-job-null-realm)` records the separate case where a handlerless
job completes abruptly. HTML explicitly leaves the reporting global unresolved;
[WHATWG issue #10526](https://github.com/whatwg/html/issues/10526) remains open
and reports browser disagreement. Browlet retains its existing queue-realm
reporting fallback. This audit does not establish that fallback as a shared
browser requirement or resolve the cross-realm policy question. The fixed
revoked-Proxy case has a non-null job realm and is not part of that gap.

Validation: all five focused suites pass in all six runtime configurations:
custom/compat has 58 ordinary passes, official compat has 44 passes and 14
approved missing-capability expected failures, and stock has 43 passes and 15
expected failures. No tests are skipped and no unhandled test errors remain.
Typechecking, type contracts, touched-file ESLint, and diff checks pass.

### §8.1.6.6.5: Timeout jobs

Audited `HostEnqueueTimeoutJob(job, realm, milliseconds)`. Its three steps are
already implemented: select the supplied realm's global, construct a completion
that queues `job()` on the JavaScript engine task source, and run that completion
after a timeout using the global's `"JavaScript"` ordering group. This uses
`GlobalTimers.runStepsAfterTimeout()`, not `setTimeout()` initialization, so it
does not inherit timer nesting or delay clamping. No runtime behavior changed.

The [engine-job regressions](../../../test/browlet/scripting/engine-jobs.test.ts)
now cover both local and borrowed `Atomics.waitAsync` timeout delivery. The
waiting function's Window owns the active-time clock even when another Window
calls it. Inactivity suspends the wait; becoming inactive again after expiration
also prevents the already queued engine task from running. Only that task
invokes the native timeout operation, followed by the Promise reaction's
separate microtask in its callback's realm.

A second regression lets the timer expire and enqueue its task, then calls
`Atomics.notify()` before that task runs. The native waiter cancels the pending
timeout. Running the older timeout task does nothing; the later notification
task settles the Promise once with `"ok"`. The existing native tests additionally
cover single-use jobs and cancellation of retained timeouts. Timer tests cover
ordering, active-time accounting, and destruction independently of the addon.

Generic/timeout hooks can now decline unrelated Node/VM jobs; see the ownership
follow-up below. Unsupported backends retain their approved missing-host-hook
expectations. Worker globals/settings/startup are
still incomplete; `GlobalTimers` now marks the missing non-suspended-worker-time
connection explicitly. The [worker roadmap](../workers/ROADMAP.md#execution-and-lifetime-constraints)
owns that lifecycle work. This Window audit does not supply worker execution or
suspension machinery.

Validation: all 10 engine-job/timer cases pass normally on custom/compat. Each
other configuration passes the five timer cases and retains five approved
missing-host-hook expected failures. All six runs exit successfully, with no
skips. Typechecking, type contracts, touched-file ESLint, and diff checks pass.

### Generic/timeout job ownership follow-up

The isolate-wide installation also intercepts ordinary Node and VM waits.
The [production regression](../../../test/browlet/scripting/atomics-ownership.test.ts)
first failed on custom/compat: constructing Browlet caused those waits to report
`HTML timeout jobs require an HTML realm` or `HTML generic jobs require an HTML
realm`, with neither expected result delivered. Official addon and stock modes
already retain native delivery because they do not install these custom hooks.

HTML now returns `false` for a realm without HTML settings, matching the existing
Promise-job ownership convention. JS Engine and the addon pass that decision
through the two existing V8 hooks. A declined notification continues native
Promise resolution; a declined timeout returns the same cancelable task to V8's
foreground task runner. Its original deadline, cancellation ID, and native range
are preserved. The offered callable is invalidated, so it cannot deliver twice
or retain the waiter after fallback. No Node JavaScript timer is introduced.

The maintained native handoff test covers accepted HTML-style scheduling beside
declined Node/VM jobs, notification cancelling native timers, delays beyond
Node's JavaScript timer range and V8's finite range, and process exit with a
pending native wait. Existing HTML tests retain active-time accounting,
inactive-Document gating, borrowed-realm selection, and the timeout/notification
race. This repairs ownership within the existing custom engine patch; it does
not add generic/timeout interception to official Node builds.

Validation: the 47 focused scheduling cases pass across all six configurations,
retaining 12 approved expected failures on official addon builds and 18 in stock
mode; custom/compat passes all 47. The 325-case native suite passes on all three
bases with its existing expected failures and one existing custom-only skip.
Initial concurrent official-addon runs timed out starting the cleanup child;
both focused reruns pass without code changes. Typechecking and type contracts
also pass. The custom engine and all three matching addons were rebuilt.

### §8.1.6.6.6: JobCallback capture follow-up

Reviewed all five `HostMakeJobCallback(callable)` steps after the job-scheduling
audit. The producer already implements the required record creation from the
earlier `HostCallJobCallback` slice; no runtime changes were needed:

- The native registration snapshot supplies incumbent identity before entering
  Node's JavaScript hook frames. Our trailing `registration` argument makes this
  dependency explicit; it is marked for signature review. Unrelated Node and
  sandbox registrations retain null host state and ordinary engine invocation.
- Active-script lookup is independent of that incumbent and of the callback's
  realm. For a modeled active script, a fresh context retains its settings realm
  and script record, with null Function and an initially zero incumbent skip
  counter. With no active script, the stored context is null.
- Each registration retains its own record and the unchanged callable. Settlement
  does not recapture the incumbent or script state.

The added [callback regression](../../../test/browlet/scripting/job-callbacks.test.ts)
uses a foreign built-in `eval`, following the subsection's example but reporting
an error instead of importing a module. A muted classic script registers the
reaction; a different, unmuted classic script later settles the Promise. The
foreign Window receives the muted error, proving that the registering script
survives the built-in callback and is not replaced by the settling script.
Existing tests cover distinct registrations, fresh context identity, callback
throws, thenable receivers, scriptless jobs, and unrelated Node callbacks.

The later [active-script capture follow-up](#active-script-capture-at-job-registration)
uses native compilation metadata at registration. Ordinary author calls/module
resumptions remain incompletely represented outside that boundary. The later
HostLoadImportedModule slice supplies native import callbacks with exact retained
referrers; it does not reconstruct all active-script frames. The event-handler
example additionally needs compiled content handlers. This callback audit used
error reporting to test its registering-script restoration.

Validation: the callback and Promise-job suites pass in all six configurations.
Custom/compat has 18 ordinary passes; each official compat base has six ordinary
passes and 12 approved expected failures; each stock base has five ordinary
passes and 13 approved expected failures. There are no skips or new failure
classifications. Typechecking, declaration contracts, touched-file ESLint, and
diff checks pass.

### Active-script capture at job registration

The cross-script regression exposed a real muting error: muted script A defines
a function which registers a Promise callback, and unmuted script B calls it.
The hook previously captured B from the outer modeled stack, exposing the private
message through a foreign `reportError` callback. The reverse muting case is also
covered, so registration does not merely inherit whichever script is muted.

The existing native snapshot already carries the compilation's import-loader
identity. The VM adapter resolves it to retained Script/SourceTextModule code;
JS Engine supplies that code to the HTML hook, where `JSScriptOrModule` owns its
weak association with the HTML record. No new C++ or V8 hooks are required.
Missing metadata preserves the modeled-stack fallback needed by built-ins;
foreign metadata or code without an HTML association does not inherit that script.
HTML's retained classic and source-text compilations install import callbacks on
the custom backend, so their identities are available at this boundary.

Tests cover both muting directions, independent same-filename compilations,
foreign/missing metadata, and module registrations before and after top-level
await. This resolves registration-time capture; it does not add arbitrary author
frames to the modeled stack or supply direct platform calls with script attribution.
Official/stock backends retain the approved missing-host-hook expectations.

Validation: the six focused scripting suites have no unexpected failures across
all six configurations: custom/compat has 78 ordinary passes and one existing
expected failure; official compat has 44 passes and 35 expected failures; stock
has 50 passes and 29 expected failures. The unmuted control passes ordinarily on
every backend. All three native suites, typechecking, declaration contracts,
touched-file ESLint, and diff checks pass with existing native limitations retained.

### §8.1.6.7.1: Import metadata

`JSSourceTextModuleRecord.getImportMetaProperties()` implements
`HostGetImportMetaProperties(moduleRecord)`. It returns the serialized module
base URL and a realm-owned, non-constructible `resolve` function with length one.
The function performs ToString, calls the module environment's existing specifier
resolver, and serializes its result. This uses the module's base and current import
map, ignores the receiver, preserves author-thrown values, and does not fetch.
Resolution records still constrain later import-map merges.

`BrowletRealm.parseModule()` installs these properties through Node's
`initializeImportMeta(meta, module)` option. The closure retains the exact HTML
record; Node/V8 creates and caches the metadata lazily, including in exported
functions and after top-level await. ECMAScript's property-creation steps remain
in the adapter, separate from HTML's list of key/value records. No active-script
guess, extra execution context, or C++/V8 change is required.

Custom/compat and stock VM modules support this path. Official addon bases lack
the already documented Node forwarding export. `realm.supportsImportMeta` keeps
ordinary compilation available there without an initializer; metadata remains
empty, and the approved expected failures retain the required assertions.

The [HTML regressions](../../../test/browlet/scripting/import-meta.test.ts) cover
metadata identity/descriptors, lazy initialization, equal-URL records, relative
and scoped import-map resolution, conversion/errors, cross-Window calls, and a
dependency's own metadata after top-level await. The
[engine regression](../../../test/js-engine/modules.test.ts) checks Node's callback
arguments and lazy invocation. Graphs are supplied explicitly; these tests do not
claim automatic loading or general active-script restoration.

Validation: the four focused suites have 50 ordinary passes on custom/compat and
each stock base. Each official compat base has 43 ordinary passes and seven
approved expected failures, with no skips or new failure classifications. The
native suite exits successfully on all three bases with its existing expected
failures; custom skips the official-runtime installer control. Typechecking, declaration contracts,
touched-file ESLint, and diff checks pass.

### §8.1.6.7.2: Supported import attributes

`getSupportedImportAttributes()` implements `HostGetSupportedImportAttributes()`
with the list containing only `"type"`. The existing single-imported-module fetcher
now obtains its assertion policy from this hook. This is name validation, separate
from `JSModuleRequest.getModuleType()` and the target environment's module-type
permission check. A supported key with an unsupported value still fails type
selection; a differently cased or otherwise unknown key fails the key check.

Node's VM API and the addon expose parsed attribute records without installing
HTML's loading policy. The parser preserves unknown names in imports and
re-exports, rather than reporting them as parse errors. ECMAScript's
`AllImportAttributesSupported` calls this host hook from two loading paths:

- `InnerModuleLoading` rejects an unsupported key with a `SyntaxError` before
  loading that request. HTML's next hook also preflights the full request list
  when it receives the first static request, before starting dependency fetches.
- Dynamic `import()` rejects its Promise with a `TypeError` before the host load
  call. Its option access, value checks, and abrupt-completion ordering must be
  preserved when connecting the existing native import callback.

The static and dynamic error-completion paths are now connected in the loader slices below.
The fetcher's `InternalError` is a specification
assertion for internal callers, not an author-facing substitute for either rejection.
The attribute hook itself adds no native hook or engine patch.

[Parser tests](../../../test/browlet/scripting/module-execution.test.ts) retain
unknown attributes from imports, named re-exports, and star re-exports.
[Fetcher tests](../../../test/browlet/scripting/module-fetching.test.ts) cover
unsupported names before side effects, accepted names/values, rejected values,
and requests without attributes. Both suites pass on all six runtime
configurations: 60 ordinary passes each, without skips or expected failures.
Typechecking, declaration contracts, touched-file ESLint, and diff checks pass.

### §8.1.6.7.3: Static HostLoadImportedModule

`loadImportedModule()` in [module-loading.ts](module-loading.ts) resolves each static
request with its referring module's environment and base URL. Its first call for
a cyclic record preflights every request's attribute keys, specifier, and allowed
module type before fetching any dependency. Descendant options inherit the
referrer's settings, select integrity from its import map, and reset fetch priority.
The existing single-imported-module fetcher retains the separate fetch client,
destination, custom fetch operation, and target module map supplied by HTML.

[module-loading.ts](module-loading.ts) supplies ECMAScript's GraphLoadingState,
InnerModuleLoading, and ContinueModuleLoading bookkeeping. This is separate from
HTML's ModuleGraphLoadingState (fetch options and first error). Pending visits and
a visited set close cycles and wait for all dependencies. Node's `unlinked` status
covers both ECMAScript's `new` and `unlinked` states, so each record additionally
retains `requestedModulesLoaded` after a successful traversal. V8 still owns
linking, live bindings, evaluation, and top-level await.

`finishLoadingImportedModule()` retains successful request/record
associations even when their traversal has already failed. Later completions do
not restart or settle that traversal again. Equivalent requests compare specifiers
and attribute entries by value, independently of attribute order, while retaining
the native request phase. A later attempt can reuse downloaded records and retry
failed fetches through the existing module map.

Failure categories retain the existing HTML contract: fetch/MIME failures return
null without setting ErrorToRethrow; preflight and parse failures retain the first
exception on the graph's script; link exceptions are retained after successful
loading. ECMAScript rejects an unsupported key on the first request before entering
the HTML hook, so that specific rejection does not populate HTML's error slot.
The regression checks the SyntaxError directly at LoadRequestedModules rather than
mistaking the fetcher's assertion for an author exception.

**Callable shapes:** LoadRequestedModules accepts optional HTML load state and
returns `env.InternalPromise`. HostLoadImportedModule and FinishLoadingImportedModule
accept Script/Module/Realm referrers and static or dynamic completion payloads.
Wasm parsing and source-phase URL imports now use these same paths. Deferred
imports and object-valued source lookup remain explicit boundaries. Script
elements and worker/worklet startup must invoke the graph entry points; these
loader slices do not implement those owners.

[Static-loader tests](../../../test/browlet/scripting/module-loading.test.ts)
exercise transitive graphs, cycles and diamonds, concurrent graphs sharing pending
fetches, preflight failures, parse/link errors, late completion and retry, redirected
bases and scoped maps, inherited options with separate clients, synthetic exports,
and equivalent requests. An external-root case uses real Fetch with only HTTP
transport controlled. The existing graph/fetch suites retain their narrower
orchestration checks. No Node, addon, or V8 changes are required.

Validation: the six focused module loading/execution/fetching/graph/import-map
suites pass on custom Node, 24.19.0, and 26.8.1, each in stock and compat mode:
127 ordinary passes per configuration, with no skips or expected failures.
Typechecking, declaration contracts, touched-file ESLint, and diff checks pass.

### §8.1.6.7.3: Dynamic HostLoadImportedModule

Node-shaped `importModuleDynamically` callbacks now connect native `import()` to
the same HTML hook. Classic/source-text compilation captures the exact retained
record; context and direct-evaluation callbacks supply a Realm referrer and use
the environment's base URL. HostLoadImportedModule selects default fetch options,
client, destination, and referrer when HTML load state is absent. Dynamically
loaded descendants also retain absent load state, as ECMAScript requires.
Worklet/ServiceWorker environment predicates reject dynamic imports before Fetch;
their actual global implementations and startup remain unfinished.

The VM performs import-expression evaluation, ToString, and attribute-value
conversion. The boundary then rejects unsupported attribute names with TypeError,
without disturbing native getter/abrupt-completion ordering. Unsupported module
types, resolution, Fetch, parse, link, and evaluation failures reject the import.
They do not become HTML runtime script-error reports.

`DynamicModuleImport` supplies ContinueDynamicImport's descendant loading, linking,
and evaluation wait through `env.InternalPromise`. Node owns the import Promise
and final namespace resolution, so the adapter returns a native Promise for the
evaluated engine Module. Pending SPEC_MISMATCH markers identify that representation
and Node's callback inputs. Returning a Module avoids an additional adoption of
a namespace's exported `then` function. Successful associations are retained on
Script/Module/Realm records, independently of the HTML module map.

The [dynamic regressions](../../../test/browlet/scripting/dynamic-import.test.ts)
cover actual Fetch graphs, classic/module/evaluation entry points, cross-Window
calls after await, generated Function provenance, concurrent imports, cached
evaluation, top-level await fulfillment/rejection, JSON exports, namespace `then`,
failure categories, attribute evaluation order, and global restrictions.
The Node-owned Function control matters: calling a Window's constructor from
Node does not erase Node's active-script metadata. That import must keep Node's
loader; it is not a missing-metadata context-fallback case.

One new regression is an approved expected failure: a script in A borrowing B's
Function constructor produces an unsupported-attribute TypeError in A instead of
B. Compilation metadata correctly retains A as the referrer, but Node's callback
does not separately expose B as the executing realm. This is a missing runtime
input, not a specification gap. The hook also marks the initial current-settings
selection needed by future worker/worklet globals. Do not infer that input from
the script's filename or rewrite the expected error prototype. Resolve the
boundary separately before expanding the addon API.

Custom/compat and stock VM contexts support these callbacks. Official addon
bases lack the previously recorded forwarding export; their integration cases
retain the approved expected failures. No C++ or Node/V8 changes are needed.
HTML Wasm parsing and source-phase URL imports are now connected; source imports
retain their module-map entry without recursively loading, linking, or evaluating
the Wasm record. A later evaluation request loads its dependencies normally.
Deferred phases and object-valued source lookup remain separate dependencies.
Module-specific active-script restoration retains its engine boundary.

Validation: dynamic-import regressions have 22 ordinary passes and one approved
expected failure on custom/compat and all three stock configurations. Each
official compat base has two ordinary passes and 21 approved expected failures,
including its unavailable forwarding export. The existing module suites pass in
all six configurations, and native suites pass on all three addon bases.
The full custom/compat unit run passes with four workers: 16,362 ordinary passes,
18 expected failures, 16 existing skips, and one existing TODO. An initial run
alongside the matrix timed out the finalization subprocess; it passed alone and
in the bounded full rerun. No timeout or regression classification was changed.
Typechecking, declaration contracts, touched-file ESLint, and diff checks pass.

### HTML §8.1.7 event-loop entry audit

The 2026-10-31 pass checks §§8.1.7.1–8.1.7.2 and the task-turn portion of
§8.1.7.3 against HTML source `404b3eb14a7a936dddefb2d78e224dbeb01d2358`.
Task records, fixed per-source queues, first-runnable selection, explicit
global/Document routing, and the shared engine microtask queue are already
connected. Microtasks do not acquire the ordinary task's fully-active gate.

The missing connection was waking loops when Document activity changes.
`Document.notifyFullyActiveStateChanged()` now wakes its own loop when active
and notifies active child Documents recursively, including containers in shadow
trees and children of a now-inactive ancestor. `Navigable.setContainer()` reaches
that notification too. Timer observers still pause/resume their active-time
waits; they no longer own task wake-ups for every source.

The [task-activity regressions](../../../test/browlet/scripting/task-activity.test.ts)
first failed with no wake-up after attaching a child, and only the ancestor's
loop waking after restoration. They retain blocked tasks and per-source order
through restoration across three distinct agents. Their graphs use the existing
container seam; this does not implement automatic iframe creation or history
traversal. The later element-task slice below supplies its routing operation. Idle,
rendering, worker lifecycle, and checkpoint-tail dependencies remain below.

Validation: the six focused task, timer, lifecycle, indexed-access, and permission
status suites pass across all six runtime configurations. Each addon run has 112
ordinary passes and two existing expected failures; each stock run has 111 passes
and three existing expected failures. All three new regressions pass everywhere.
Typechecking, declaration contracts, touched-file ESLint, and diff checks pass.

### HTML §8.1.7.2 element tasks

`ElementImpl.queueTask(source, steps)` implements
[queue an element task](https://html.spec.whatwg.org/multipage/webappapis.html#queue-an-element-task)
through the element's retained environment and existing global-task routing.
Adoption changes its node document, not its relevant global. The task therefore
keeps the creation Window's event loop and associated Document, including that
Document's fully-active gate. An element created in a Document without a browsing
context still uses its creation Window's associated Document for task delivery.

The [element-task regressions](../../../test/browlet/scripting/element-task.test.ts)
use real projected HTML/SVG elements and public document creation/adoption,
with controlled host turns. They cover shared-source ordering with global tasks,
creation in a detached Document, adoption between distinct agent loops before
and after queueing, and independent source/destination Document activity.
This is an internal HTML operation; no author-facing member or native change
is needed. Future element algorithms can call it directly.

Validation: all 34 focused element-task, task-routing, and Document-activity
cases pass on all six runtime configurations, including six new cases.
Typechecking, declaration contracts, touched-file lint, and diff checks pass.

### HTML §8.1.7.3 rendering document order

The next bounded pass uses the same HTML revision for
[update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering).
`WindowRenderingProducer` now orders fully active Documents before applying its
renderability filters. Parents precede children; sibling containers follow
shadow-including tree order. It computes sibling-position paths through container
and shadow-host ancestry once per task, without scanning document subtrees or
maintaining a second child index. Unrelated roots retain first-seen order.

Rendering phases share that snapshot even when an earlier phase moves a frame.
The next task observes the changed container order. A filtered or other-agent
parent does not discard its eligible children, and the autofocus phase applies
only to top-level traversables. Regression tests first observed wrong parent and
sibling order, stale order after a move, and autofocus dispatch to a child.

This completes document ordering within the existing producer, not production
rendering. The refresh host is not installed by UserAgent, and real phase owners
(resize/scroll, animation frames, layout, painting, and the other hooks) remain
dependencies. Tests compose real Window/Document bindings with a controlled
opportunity host and observation hooks; automatic child creation is still absent.

Validation: all 40 focused rendering and task tests pass on each of the six
runtime configurations, including six new rendering cases. Typechecking,
declaration contracts, touched-file ESLint, and diff checks pass.

### HTML §8.1.7.3 idle-period processing

The [idle branch](https://html.spec.whatwg.org/multipage/webappapis.html#idle-deadline-computation)
now runs after task accounting, on a turn with no runnable task, and after a
checkpoint-only host turn. The loop retains its Agent to select Window loops
and their existing Window collection. Both render/idle timestamps start at zero.
Blocked Document tasks do not prevent idleness; work queued during a checkpoint
does. Idle processing does not request another turn unless its consumer queues work.

The supplied deadline callback recomputes the 50ms cap from the period's start,
the earliest timer estimate across same-loop Windows, and the next refresh when
rendering is pending. It coarsens the result for each receiving Window's isolation
capability. Timer estimates stay with GlobalTimers and reflect its existing
completion, destruction, and active-time suspension behavior.

`SPEC_CLASH(idle-timer-time-origin)`: HTML's
[run steps after a timeout](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#run-steps-after-a-timeout)
stores current-high-resolution-time-plus-delay in the active-timer map. That
timestamp is relative to the global's time origin. The idle algorithm compares
it directly with an unsafe shared timestamp. Browlet adds the timer owner's
time origin before comparing, preserving the intended wait when Windows have
different origins. The regression checks 40ms and 12ms timers with distinct
origins and a shorter timer on an unrelated loop. This choice reconciles the
two clock domains; it does not rely on a browser-behavior comparison.

The subsequent Request Idle Callback slice connects this calculation directly
to each Window's pending/runnable lists and delivery. `EventLoopInit.idleRendering`
now contains only the remaining rendering prediction: the Window's
[animation-frame callback map](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#list-of-animation-frame-callbacks)
or the rendering host's predicted updates, plus its refresh rate. AnimationFrameProvider
and the production rendering host remain unfinished. The headless runtime supplies
no fake rendering state or display rate; its 50ms and timer bounds still apply.
The [idle-period tests](../../../test/browlet/scripting/idle-period.test.ts) cover
live timer/render changes, per-Window precision, task/checkpoint ordering,
inactive Documents, non-Window agents, and retained deadlines across periods.

Initial-slice validation: all 68 focused idle-period, timer, task, activity, rendering, and
stable-state cases pass on all six runtime configurations, including 14 new
idle-period cases. Checkpoint tests run in real host turns, outside the test
runner's microtasks. Typechecking, declaration contracts, touched-file lint,
and diff checks pass.

### Request Idle Callback §§4–7

The [21 May 2025 draft](https://www.w3.org/TR/2025/WD-requestidlecallback-20250521/)
is checked out at `_web-platform/specs/w3c-requestidlecallback`, commit `c460478`.
Sections 1–2 are informative; section 3 establishes conformance rules. Sections
4–5 are implemented by a `WindowIdleCallbacks` owned by each Window, a separate
Window partial declaration, and `IdleDeadlineImpl`. Window retains the two API
forwarding methods; the owned object holds the lists, counter, deadline, and
delivery/wake-up bookkeeping. Binding converts callbacks,
options, handles, and deadline arguments and reports callback exceptions.

Pending callbacks become runnable at the next eligible period. Existing runnable
callbacks precede reposted work; each callback is a separate idle-source task.
Ordinary runnable work can end a period early. A single host timer waits for that
period's deadline before trying another period; no idle polling is installed.
Expired or unavailable budgets leave registrations pending, as permitted by the
specification; a positive timeout supplies an independent delivery path.

Unlike HTML timers, §4.1 waits elapsed time, not fully-active time. Expired waits
queue tasks in absolute-deadline order, with registration order breaking ties;
delivery still uses HTML's Document activity gate. Idle, timeout, and cancellation
all remove the same registration, so a queued losing task cannot deliver twice.
Unsalvageable Document cleanup cancels retained callbacks and native wake-ups.

The internal getDeadline callback returns our existing coarsened `Moment` rather
than an untyped DOM timestamp. `timeRemaining()`
subtracts precision-limited readings in the same shared clock domain, clamps at
zero, and exposes milliseconds. §6's isolation-dependent precision is applied to
both readings. Each period retains its own start: a regression first observed an
old deadline incorrectly moving from 1050 to 1110 when a later period began.
That closure is corrected. Section 7 contains only a security placeholder.

`SPEC_CLASH(idle-deadline-time-origin)`: Request Idle Callback §4.3 subtracts
[current high resolution time](https://www.w3.org/TR/hr-time-3/#dfn-current-high-resolution-time),
which is relative to a global's time origin, from the shared absolute deadline
supplied by HTML. Browlet subtracts two coarsened shared moments, preserving the
specified remaining duration independently of the Window's time origin. Blink's
`core/scheduler/idle_deadline.cc` likewise subtracts `TimeTicks::Now()` from its
`TimeTicks` deadline (and coarsens the resulting duration). This clock-domain
repair is separate from the timer-estimate conflict described above.

Optional hidden-page throttling and timeout padding are not enabled. Rendering
prediction remains the dependency described above; this does not add animation
frames, a renderer, polling, or addon/engine facilities.

Validation: 91 focused idle-callback, idle-period, timer, task, activity,
rendering, and stable-state cases pass in each of the six runtime configurations
(official Node 24/26 and custom Node, addon off/on). The 22 new idle-callback
cases cover projected API behavior and controlled scheduling, cancellation,
timeout races, callback exceptions, inactivity, cleanup, and clock precision.
The retained-deadline regression also passes. Typechecking, declaration contracts,
touched-file lint, and diff checks pass; no new expected failures were needed.

### HTML §8.1.7.3 microtask-checkpoint audit

The checkpoint's reentrancy guard, shared-queue drain, current-task bookkeeping,
and rejected-promise notification are already connected. DOM observer and
slot-change delivery run on that same queue, rather than in a separate tail.
This audit adds integration coverage without changing runtime behavior.

The [checkpoint tests](../../../test/browlet/scripting/microtask-checkpoint.test.ts)
exercise nested Promise reactions, explicit microtasks, and MutationObserver
batches before the next ordinary task. A throwing callback reports its exception
and finishes the error listener before continuing the queue, including work
queued by that listener. Internal microtask steps still drain when their Document
becomes inactive, while ordinary tasks remain queued; author callback invocation
retains its separate can-run-script check. Existing rejection tests cover the
post-drain notification task, same-checkpoint handling, and multiple Windows.

Two specification-owned consumers remain absent:

- [IndexedDB §2.7.1 transaction cleanup](https://w3c.github.io/IndexedDB/#cleanup-indexed-database-transactions)
  needs transaction state and the cleanup-event-loop association. It must mark
  matching transactions inactive and clear that association after the drain.
- [Long Animation Frames §3.2.2 checkpoint timing](https://w3c.github.io/long-animation-frames/#record-timing-info-for-microtask-checkpoint)
  finishes pending script entries on Documents belonging to this loop. Those
  entries and Document frame timing state do not exist yet; this is not merely
  measuring how long `performMicrotaskCheckpoint()` takes.

The native drain still bundles `ClearKeptObjects()` ahead of HTML's
post-processing. Its [ordering and Agent-isolation questions](EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint)
remain explicit; these tests do not establish complete checkpoint conformance
or justify additional engine changes. No new runtime limitation was found.

Validation: the five focused suites contain 60 cases. All pass on each addon
base; each stock base has 43 ordinary passes and the same 17 approved expected
failures. The three new cases pass on all six configurations. Typechecking,
declaration contracts, touched-file ESLint, and diff checks pass.

### HTML §8.1.7.3 stable-state scheduling

`BrowletEnvironment.awaitStableState()` now queues the supplied synchronous
section on its realm's shared microtask queue. The initiating parallel algorithm
must return after the call. The section returns either the remaining parallel
steps or nothing; the environment schedules a returned continuation through
`runInParallel()`. This makes the specification's conditional resumption explicit
without returning an author Promise. The continuation representation is reviewed.

An idle-loop regression first failed because `queueMicrotask()` requested no
host turn. EventLoop now coalesces a checkpoint wake-up for microtasks arriving
outside a task/checkpoint. The wake-up drains the existing engine queue before
selecting another ordinary task; it does not create an HTML task or a second
microtask queue. Work queued during a task uses that task's checkpoint, and
nested microtasks drain in the same checkpoint. An explicit earlier checkpoint
also clears the pending request.

The [stable-state tests](../../../test/browlet/scripting/stable-state.test.ts)
cover idle wake-up, coalescing, FIFO/nested delivery, no extra turn during a task,
ordering before ordinary work, owning-loop and inactive-Document metadata, optional
resumption, and automatic delivery through the real Node host. Internal synchronous
sections are not gated on Document activity; calling author code still goes through
its separate Binding/script checks. Image and media algorithms remain callers to
connect when their own steps are implemented.

SPEC_CLASH(stable-state-microtask-agent): HTML queues a microtask from parallel work here, while its queue-a-microtask algorithm asserts it is not called in parallel.
Browlet follows the stable-state requirement with an explicitly retained owning
environment and loop, rather than infer a surrounding Agent in parallel work.
The host checkpoint wake-up supplies delivery when that loop has no ordinary task.
No addon or engine change is needed.

Validation: all eight new cases pass across the six runtime configurations. The
six focused suites contain 68 cases: 68 ordinary passes on every addon base,
and 53 ordinary passes plus the same 15 approved expected failures on every
stock base. Typechecking, declaration contracts, touched-file ESLint, and diff
checks pass. The official HTML reference was refreshed and remains at
`404b3eb14a7a936dddefb2d78e224dbeb01d2358`.

### Native WebAssembly completion

The [completion tests](../../../test/browlet/scripting/wasm-completion.test.ts)
exercise the existing native global on main, independently of the separate
WebAssembly API implementation. Successful compilation, CompileError delivery,
and compiled-Module thenable assimilation originally stalled on official Node
24.19.0 and 26.8.1 with the addon. All three stock configurations and custom Node
with the addon already delivered them automatically.

The initial control observed V8's read of the Module's `then` getter: compilation
had finished and Promise resolution had started. Queueing one microtask through
the owning HTML loop delivered the result on all six configurations, without
polling or manually running a checkpoint. This identified a missing notification
at the native-completion boundary, not a failure to drain an already notified loop.

The addon creates explicit V8 microtask queues. V8's default asynchronous Wasm
resolver resolves/rejects under `kDoNotRunMicrotasks`; ordinary Node subsequently
drains its own queue, but does not drive Browlet's explicit queue. Custom Node's
`HostEnqueuePromiseJob` bridge routes these jobs through `EventLoop.queueMicrotask()`
and its idle wake-up. Official addon builds lack that bridge. The idle-loop fix
supplied the receiving side; the native completion handoff below supplies the producer.

The addon now uses public V8 `SetWasmAsyncResolvePromiseCallback` on every base.
`JSRealm.setWasmAsyncCompletionCallback()` registers the owning host's scheduler
per context. The native callback retains the resolver and result in a traced,
one-shot completion; it neither changes the compiled object nor drains microtasks.
HTML queues that completion on the selected task source (engine by default), with
its global's Document and paired script preparation/cleanup. Resolution and the synchronous
Module `then` lookup consequently happen inside that task. Its checkpoint drains
the resulting reactions, independently of the custom Promise job hooks.

Inactive Documents retain their queued work. Destruction removes pending tasks
and discards later arrivals; native detachment also makes retained completions
inert. The [delivery tests](../../../test/browlet/scripting/wasm-completion-delivery.test.ts)
control the external completion notification while exercising real HTML task and
Document lifetimes on each runtime. Stock Node keeps native delivery and cannot
install this HTML handoff; its automatic progress remains covered separately.

The WebAssembly JS API's [asynchronous compilation algorithm](https://webassembly.github.io/spec/js-api/#asynchronously-compile-a-webassembly-module)
requires task delivery. Its optional task source is absent for ordinary compile;
HTML uses the existing engine-task source there. Web API response compilation
selects the networking source for its native Promise through JS Engine; concurrent
ordinary compilation and instantiation keep their engine source. Native V8 still owns compilation,
result allocation, and instantiation; this hook transfers Promise resolution, not
those algorithms. No Node/V8 source patch is needed.

The isolate-wide native dispatcher forwards unregistered contexts with V8's
default Resolve/Reject behavior. V8 provides no getter for chaining another
embedder's replacement callback; Node's default is the supported coexistence
contract. Per-context callbacks and pending completions are garbage-collectable.
The [native tests](../../../node-compat/test/wasm-completion.test.cjs) cover
success/error handoff, thenable order, independent contexts, Node/VM defaults,
removal, detachment/proxy reuse, collection, and worker teardown. Existing addon
reload tests also protect cleanup-hook registration.

Observing only the final compilation Promise is insufficient: a Module's
author-defined `then` can require a browser microtask before that Promise settles.
The assimilation regression preserves this case. Pip owns Wasm input conversion
and API algorithms; Vin owns this runtime/HTML scheduling connection.

Validation: 18 focused Wasm/task/checkpoint cases pass on all six configurations.
All eight native completion tests pass on all three addon builds. The full native
suite has no unexpected failures: official bases retain 218 ordinary passes and
102 approved expected failures; custom has 307 ordinary passes, 12 approved
expected failures, and its one existing skip. Typechecking, declaration contracts,
touched-file ESLint, and diff checks pass. No new failure classifications were added.

### Native Atomics completion progress

The [idle Atomics regressions](../../../test/browlet/scripting/atomics-wakeup.test.ts)
first failed on both official addon bases: timeout and notification completed
natively, but their Window Promise reactions stayed queued. Custom job hooks and
all stock configurations already supplied progress. The existing completion
observer only covered outer V8 API calls; internal Futex Promise resolution need
not finish such a call in the waiting context.

The addon now also requests the owning queue's checkpoint when its Promise
settles, using Node's public Promise-hook multiplexer and the existing coalescing
guard. HTML still selects the checkpoint turn. This adds no timer, polling,
Promise reaction, author-property lookup, or Node/V8 patch. JS Engine omits the
fallback when native enqueue hooks are installed. Native regressions cover
coalescing, non-reentrancy, other queues, Node hook changes, detached owners,
collection, and worker teardown.

This repairs ordinary official-addon progress, not the separate generic/timeout
hooks' HTML task source, Document gating, or active-time policy. Those stronger
requirements retain their existing capability-based tests. Raw Node Promises
given Window callbacks still lack a destination-queue signal on official bases;
the supported `exposeFunction()` bridge passes fulfillment and rejection controls.
The reproducible counterexamples remain ordinary failures in Experimental.

Validation: the six affected suites contain 27 cases. Custom/compat passes all;
official addons have 15 passes and the same 12 approved expected failures;
stock modes have 14 passes and the same 13 approved expected failures. The two
new Atomics progress cases pass everywhere. The 328-case native suite has no
unexpected failures on any base, retaining its prior expected failures and the
one existing custom-only skip. Typechecking, type contracts, touched-file lint,
and diff checks pass. No new failure classifications were introduced.

### Raw host Promise handoffs (on hold)

The [maintained regressions](../../../test/browlet/scripting/host-promise-handoff.test.ts)
retain four raw host registrations: Node and already-fulfilled Window Promises,
each with default species or species that returns an ordinary object. All four
first failed on both official addon bases: the reaction remained queued until
an explicit rescue checkpoint. They are approved TODOs on those configurations;
passing stock/custom cases remain enabled. TODOs retain the desired assertions
but do not execute them on the affected bases.

These registrations originate in Node outside HTML task delivery. They are
possible through retained Window references, but are not evidence of a stall
from ordinary page calls or the supported `exposeFunction()` bridge. Adoption
is on hold until we define the direct host/Window Promise contract or identify
a supported caller that requires it. Promise settlement and initialization
observers do not provide a general destination-queue arrival signal; an ordinary
object species can avoid creating a native Promise altogether. The custom
enqueue hook supplies the missing notification.

The targeted production repairs remain in place. The failing probes, chained
cross-agent handoffs, guarded-broadcast prototype, and overhead/lifecycle
results remain in Experimental. No broadcast or additional lifecycle hook is
adopted for these TODOs.

### HTML §8.1.7.3 continuation-based spinning

`EventLoop.spinUntil(waitForGoal, continuation)` implements the
[spin-the-event-loop macro](https://html.spec.whatwg.org/multipage/webappapis.html#spin-the-event-loop)
for algorithms lowered into explicit continuations. It saves the modeled stack,
empties it, checkpoints, and starts the wait on a later host turn. The wait must
register a completion callback without blocking; calling that callback queues
the continuation once on the original task source. A spinning microtask resumes
as an ordinary task. Other tasks remain eligible while the goal is pending.

The caller must return immediately and place all remaining steps, including
paired script/callback cleanup, in the continuation. This does not suspend an
arbitrary author function or defer a synchronous caller's `finally`. The existing
`runScriptEvaluation()` and Binding call scopes therefore cannot surround a
suspension without first lowering their remaining work into a continuation.

The callback pair represents HTML's goal and remaining steps; this signature
and representation are reviewed. Browlet moves the
saved stack together with its script-entry task links and callback backup stack,
so unrelated work cannot inherit suspended callbacks or impose a common cleanup
order on independently suspended algorithms. It requeues the original Task to
retain its source, Document, script-evaluation environments, and other metadata;
HTML's microtask definition explicitly needs those fields when spinning moves a
microtask to a regular task queue. The continuation retains its async context.

The [spinning tests](../../../test/browlet/scripting/event-loop-spin.test.ts)
cover progress during a pending goal, completion coalescing, saved entries and
balanced cleanup on success/throw, microtask promotion, nested independent
suspensions, inactive-Document gating, repeated spinning, and real host delivery.
No addon or engine change is required. The parser's existing stylesheet/script
continuations have not yet been migrated; its preparation, readiness, nesting,
and abort requirements remain explicit in the [parser roadmap](../html/parser/ROADMAP.md).

Validation: all eight new cases pass on all six runtime configurations. The six
focused scheduling/lifecycle suites have 63 ordinary passes and one existing skip
on custom/compat; the other configurations retain 61 ordinary passes, two approved
expected failures, and that same skip. Typechecking, declaration contracts,
touched-file ESLint, and diff checks pass.

### HTML §8.1.7.3 pausing

`EventLoop.pauseUntil(waitForGoal, env)` implements the loop-owned portion of
[pause](https://html.spec.whatwg.org/multipage/webappapis.html#pause): it samples
the supplied current global's clock, retains the task and modeled execution
stack, suppresses task/checkpoint delivery throughout a synchronous host wait,
and measures the elapsed duration before restoring delivery. It neither spins
the Node loop nor performs a checkpoint at entry or return. Exceptions from the
host still restore delivery.

The callable shape uses a synchronous wait instead of an abstract goal. Its
`undefined` result excludes asynchronous callbacks. The caller must supply a
wait that returns only after the goal is met; Promise settlement or callbacks
queued on the blocked Node thread cannot provide that wait. A test uses an
independent Node worker and an atomic notification to exercise actual blocking
and resumption without polling. No addon or engine changes are required.

The remaining dependencies stay explicit:

- A UI host must reflect pending rendering/UI state when necessary (pause step
  3); the headless runtime has no UI to update. Dialog and synchronous Fetch
  consumers still need their concrete host waits. This operation does not make
  `importScripts()` fetching synchronous, nor does it create independent HTML
  workers. A blocking host effect also blocks other work sharing its Node thread.
- [Long Animation Frames §3.2.2](https://w3c.github.io/long-animation-frames/#record-pause-duration)
  owns pause accounting. The optional `TaskTimingHooks.recordPauseDuration`
  receives the elapsed `Duration` and running script explicitly, instead of
  finding an event loop through ambient state. Document frame timing and
  pending-script records remain unimplemented; supplying this hook is not an
  implementation of their accounting algorithm.

The [pause tests](../../../test/browlet/scripting/event-loop-pause.test.ts) cover
real blocking, retained execution state, suppressed delivery and coalesced
wake-ups, clock/attribution inputs, host failure cleanup, and loop-local guarding.
An already-requested checkpoint also leaves the idle-period timestamp unchanged
until the paused task resumes. All seven cases and the adjacent scheduling suites
pass on all six runtime configurations (86 tests per configuration). Typechecking,
type contracts, touched-file ESLint, and diff checks pass.

### HTML §§8.1.7.4–8.1.7.5 task sources and cross-specification delivery

All five generic sources have shared identities in `tasks.ts`: DOM manipulation,
user interaction, networking, navigation and traversal, and rendering. Each
EventLoop owns its queues and source associations. Their existence does not
implement the corresponding producers: trusted input and the production refresh
host remain absent. Author `dispatchEvent()` stays synchronous; §8.1.7.4's
user-interaction requirement applies to events caused by user input.

§8.1.7.5's return from parallel work uses the existing global-task boundary.
`runInParallel()` schedules a later Node turn without entering an HTML task;
`env.queueTask()` selects the owner's global and Document. Fetch and Storage
also support explicit destination globals. The Node host is cooperative, not
a worker pool; CPU-heavy work needs its own data/worker boundary.

The [parallel-delivery tests](../../../test/browlet/scripting/parallel-delivery.test.ts)
use a controlled Blob byte source with real File API, Streams, Binding, and
event-loop machinery. Both successful reads and backend errors finish while
their Document is inactive, but leave the author Promise pending. File-reading
tasks retain that Document and deliver realm-owned results/errors after its
activity is restored. Existing Fetch tests cover a different destination global
and retained Windows across navigation; Storage and Permissions retain their
specified task sources. No runtime correction was needed for these paths.

The 2026-10-31 follow-up audit covers §8.1.7.5 itself: capture author inputs before
yielding, perform background work on realm-neutral data, and return through a task
with an explicit source and global before creating observable results. Its example
encryption API illustrates this composition; it does not add another scheduler
operation. The existing environment, Binding, and global-task machinery provide
the required boundaries. Individual consumers still need to obey them.

Permissions' initial query conflicts with that guidance:
it explicitly creates and populates a realm-owned status in parallel. The
[Permissions roadmap](../../permissions/ROADMAP.md#62-querying-permissions) records
`SPEC_CLASH(permissions-query-parallel-allocation)`. Browlet now follows HTML's
task boundary and the browsers' confinement of object work to its owning context:
the initial query allocates, populates, and settles inside one permissions task.
The installed query reads local state, so it needs no separate background turn.
This correction uses the existing global-task machinery.

These tests cover the task-source and cross-specification delivery paths above.
The subsequent element-task, idle-period/requestIdleCallback, and pause slices
complete the currently available §8.1.7 operations. The
[outstanding-work inventory](#outstanding-event-loop-work) retains specific
missing owners and host effects; those boundaries remain explicit as the audit
continues into §8.1.8.1.

The original delivery slice validated 44 focused task/Fetch/Storage/Permissions cases on each of six
runtime configurations. All 44 pass on addon bases; stock bases have 40 ordinary
passes and four existing expected failures. Both new delivery cases pass
everywhere. Typechecking, declaration contracts, ESLint, and diff checks pass.
The follow-up audit reran all 44 cases on custom/addon and Node 26.8.1/stock with
the same results. It changes only comments and documentation; lint and diff checks pass.

## HTML §8.1.8.1: event-handler IDL invocation

Audited 2026-11-01 against [Event handlers](https://html.spec.whatwg.org/multipage/webappapis.html#event-handler-attributes).
This first slice covers the existing IDL-handler path, not the entire subsection.

`EventHandlerMap` already retains null/callback values and stable listener
registrations. Replacing a non-null callback keeps its listener position;
deactivation removes it, and reactivation appends a listener. Web IDL supplies
legacy nullable conversion, author identity, argument/receiver projection, and
callback environment. Returning exactly `false` uses DOM's cancellation operation,
which respects both `cancelable` and passive listeners. Chromium, Firefox, and
WebKit agree with that behavior; no cancellation correction was needed.

The shared Web IDL callback value now retains `callbackEnv: WebIDLEnvironment | null`.
`captureEnvironment()` captures the incumbent environment; unbound realms and the
internal sandbox return null rather than a realm object. Callback preparation
still validates the browser environment and its event-loop ownership. The sandbox
regression exercises real Binding conversion and invocation without entering HTML
callback bookkeeping; standalone Web IDL fixtures use bound environments when
testing captured identity and null when no host environment is needed.

The processing algorithm's target BiDi scripting check and callback-realm
fully-active check were missing. Both now run in the event-handler declaration's
`overrideCbConversion` adapter before Web IDL prepares script/callback entry. The receiver's
Binding Context supplies its environment even when a setter is borrowed; the
converted callback separately retains its associated realm. The map does not
retain Binding Context or perform another realm lookup. Exceptions continue to
be reported in the callback realm, and dispatch continues to later listeners.
`UserAgent.webDriverBiDiScriptingIsEnabled()` remains the existing provisional
allow result until BiDi session/user-context overrides are implemented; the
algorithm now consults it instead of bypassing it.

The [regressions](../../../test/browlet/scripting/event-handlers.test.ts) first
observed both missing gates: handlers ran and canceled events when they should
have been skipped. Coverage also retains non-callable object identity, listener
position across inactivity, an active callback on an inactive target, borrowed
setters, callback-realm exception reporting, and the public Window receiver.
The two-realm fixture composes existing same-agent Window bindings explicitly;
automatic auxiliary/child browsing-context creation is still §7 work.

### Window error handlers

The next slice implements `OnErrorEventHandler` and Window's `onerror` member,
the first declaration in the §8.1.8.2 `GlobalEventHandlers` mixin. Its composed
implementation retains the handler state; Window forwards the attribute.

The shared callback adapter still receives one implementation Event. For an
ErrorEvent whose type is `error` and current target is Window, it supplies the
author callback's five arguments: message, filename, line, column, and error.
Binding projects those values and the receiver, preserves callback identity,
and applies the existing target-policy and callback-activity gates. The handler
map cancels this special case only for boolean `true`; plain Events, other event
types, and non-global targets retain ordinary one-argument/return-false handling.
Event owns the ErrorEvent type predicate so scripting need not load DOM classes.

Six new regressions first failed because Window had no bound `onerror`: assigning
it created an ordinary property and registered no listener. They now cover the
five arguments and Window identity, exact-true cancellation, ordinary cases,
object/null conversion and listener order, `reportError()` delivery, borrowed
setters, activity/policy gates, and callback-realm exception reporting.

Validation: 85 focused handler, runtime-error, Storage, FileReader, and Web IDL
callback tests pass in each of the six Node 24/26/custom stock/addon
configurations. Two existing implementation-defined `reportError` attribution
comparisons remain skipped. Typechecking, declaration contracts, touched-file
ESLint, and diff checks pass. No new failure was reclassified or skipped.

### Activated listener realm and current event

Audited 2026-11-01 against HTML's
[activate an event handler](https://html.spec.whatwg.org/multipage/webappapis.html#activate-an-event-handler)
and DOM's [inner invoke](https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke).
The handler map registered an ordinary internal function, so its DOM listener had
no associated realm. Handler callbacks consequently saw no `window.event`, even
though `addEventListener()` callbacks already used DOM's save/set/restore logic.

Binding's existing callback adapter now carries the author callback's realm on
the internal callable. The handler map gives that realm to its stable
`EventListenerCallback` and updates it when the handler changes. Callback identity
and listener position stay intact. DOM continues to own current-event restoration,
nested dispatch, and the shadow-tree exclusion; no second dispatch path or
engine/addon change is needed. Direct implementation callbacks can still omit a
realm, like other internal DOM listeners.

`SPEC_CLASH(event-handler-current-event-realm)`: a same-origin iframe probe assigns
the iframe's function to the parent's `onstorage`, then replaces it with a parent
function. Chromium and WebKit expose the event in the current callback's Window;
Firefox exposes it in the target Window. All three restore the previous value.
Browlet follows Chromium/WebKit, as approved. HTML permits an arbitrary callback
context for the internal listener, but that does not settle the associated realm
used by DOM's current-event steps. Blink's
[JSEventHandler](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/js_event_handler.h)
likewise selects the callback's relevant script state for its shared
[listener dispatch](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/bindings/core/v8/js_based_event_listener.cc).

Four regressions first failed on missing current-event values. They cover nested
handlers, handler exceptions reported through `onerror`, a ShadowRoot handler,
and replacement across callback realms without changing listener order.

Validation: nine affected suites pass across Node 24/26/custom, with 180 passing
tests on each addon build and 179 plus the existing WindowProxy-descriptor
expected failure in each stock mode. The four new regressions pass everywhere.
Typechecking and Web IDL declaration contracts pass; 112 import-hierarchy tests
also pass. No failure was reclassified or skipped.

### Erasing listeners and handlers

HTML's [erase all event listeners and handlers](https://html.spec.whatwg.org/multipage/webappapis.html#erase-all-event-listeners-and-handlers)
is now `EventTargetImpl.eraseAllEventListenersAndHandlers()`. The receiver is the
specified target. Each target has one nullable `eventHandlers` association.
Concrete targets construct their maps with complete shared handler definitions.
Window combines the GlobalEventHandlers and WindowEventHandlers definitions once;
Document adds its two dedicated names. MessagePort supplies MessageEventTarget's
shared definitions and passes its callback map to that mixin. EventHandlerMap
leaves these definitions unchanged; there is no later registration phase.
The inherited operation deactivates that map before removing listeners, with no
target-specific overrides. Every handler owner participates. Targets
without handlers allocate no map. DOM retains only a type reference to the HTML
implementation, preserving the runtime dependency direction.

`EventHandlerMap.deactivateAll()` nulls values and unregisters their listeners
while preserving the supported names for later assignment. This resets handler
activation as well as author-visible values. DOM's `removeAllEventListeners()`
stays a separate operation that removes registrations only. Both paths use DOM's
normal removal steps, including abort-algorithm removal, dispatch-snapshot
invalidation, and listener-observation hooks. There is no handler registry or
additional lookup during dispatch. Handler attributes still use one map lookup;
the nullable association adds one field to EventTarget, and Window allocates
one handler map instead of two.

The [erasure tests](../../../test/browlet/scripting/event-handler-erasure.test.ts)
exercise actual projected handler attributes on every existing
owner, reactivation after repeated erasure, ordinary listeners with abort signals,
and removal/replacement during a dispatch. A handler already executing can finish
and its return value still participates in cancellation. Erased registrations
are skipped in an existing dispatch snapshot; replacements are absent from that
snapshot. Erasing one target does not erase its descendants or global.

The production caller remains explicit: [document.open()](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-document-open)
in §8.4 must call this operation on each shadow-including inclusive descendant
of the Document, then on its relevant global only when that Document is the
global's associated Document. Its navigation/parser gates, replacement, and
parsing lifecycle are not implemented by this helper. A TODO beside Document's
pending dynamic-markup declarations records that connection. Future handler
owners contribute their definitions to the shared map and inherit erasure.

Validation: all 16 new erasure regressions pass on Node 24/26/custom in stock and
addon modes. The nine affected suites have 138 passing tests per addon run and
137 plus the existing WindowProxy-descriptor expected failure per stock run.
Typechecking, Web IDL declaration contracts, touched-file ESLint, and diff checks
pass. No failure was reclassified or skipped.

### Handler targets and body/frameset forwarding

HTML's [determine the target of an event handler](https://html.spec.whatwg.org/multipage/webappapis.html#determining-the-target-of-an-event-handler)
is `EventTargetImpl.getEventHandlerTarget(name)`, overridden by HTMLElement for
body and frameset. It recognizes WindowEventHandlers names and the Window-reflecting
body set. Other names and targets keep their original target. Forwarding requires
an **active** node Document, not a fully active Document or a connected element.
The resolver checks the current Document each time, including after adoption or
navigation; it does not cache a Window alongside the element's construction realm.

HTMLBodyElement and HTMLFrameSetElement now include the existing WindowEventHandlers
declaration and forward `onstorage` to that target's existing map. No forwarded
entry is allocated on the element. Erasing its listeners leaves the Window's
handler intact; erasing the Window clears all its aliases. Broader handler
declarations remain §8.1.8.2 work, including HTMLElement's GlobalEventHandlers
inclusion before exposing body/frameset `onerror` and the other Window-reflecting
body attributes. Content-attribute changes and lazy compilation are described below.

The adoption regressions also exposed a callback-adapter error: the BiDi gate
used the receiving element's construction environment after its handler had been
forwarded to another Window. Both body and frameset tests ran a callback despite
the destination Window's disabled scripting policy. The adapter now gets that
environment from the invocation target. Callback realm, activity checks,
current-event bookkeeping, exception reporting, and identity remain Binding-owned.

The [target tests](../../../test/browlet/scripting/event-handler-targets.test.ts)
cover detached elements, Documents without browsing contexts, adoption, borrowed
accessors, inactive history Documents, active children of inactive Documents,
listener order and cancellation, separate element/Window erasure, target policy,
and non-forwarding names. No engine or addon change is involved.

Validation: all 16 target regressions pass across Node 24/26/custom in stock and
addon modes. Seven affected suites have 94 passing tests per addon run and 93
plus the existing WindowProxy-descriptor expected failure per stock run.
Typechecking, Web IDL declaration contracts, touched-file ESLint, and diff checks
pass. No failure was reclassified or skipped.

The next dependency check found that the existing CSP inline check supported only
style attributes. The [shared attribute policy check](../browsing/policy/csp/ROADMAP.md#script-attribute-policy-prerequisite)
now also supports `script attribute`, including its directive fallbacks, hashes,
and violation reporting. HTML now calls it before storing source on the currently
supported body/frameset Window handlers.

Raw values retain the body and Document URL without executing or parsing them.
The IDL getter and dispatch share `EventHandlerMap.get()`: sandboxed or detached
Documents leave raw source intact, syntax errors clear the value but retain the
listener position, and successful compilation caches the converted callback.
`WindowEnvironment.createEventHandler` is a composition-supplied Binding
factory: JSRealm compiles the body; the factory passes its own environment to
Binding, independent of whichever script first requests it. The BiDi gate
now precedes that lazy path in dispatch. The existing callback adapter still
owns argument selection, activity checks, exception policy, and identity.

The addon exposes Node-shaped `compileFunction` using public V8 APIs, with an
additional retained-source `name` option. No engine patch was added. Stock Node
compiles and invokes handlers but omits the name from intrinsic source text;
that exact assertion is an approved expected failure. A retained-script import
regression verifies the document API base, rather than the getter caller's script
base. Official addon imports retain their existing forwarding-export limitation.

Remaining §8.1.8.1 work is explicit:

| Algorithm or state | Remaining work and owner |
| --- | --- |
| Determine an event handler's target | Implemented for the §8.1.8.2 declarations. Both member bindings and the content-attribute path use this resolver, including body/frameset forwarding. |
| Content-attribute changes and raw handler values | Connected for Window handlers via body/frameset and GlobalEventHandlers on HTML, SVG, and MathML elements. `ElementImpl.attributeChanged()` uses the target resolver and CSP before storing source; only elements with a supported handler map participate. DOM-created Documents' initially empty CSP lists do not block storage. The parser already retains source locations in `getSourceCodeLocation()`; delivery into the raw handler record/compiler offsets is still missing. The raw record retains only its Document URL. |
| Get the current event-handler value | Window and element compilation, syntax errors, caching, and callback creation are connected. Elements select their current node Document and Binding supplies projected Document/form/element scopes. `HTMLElementImpl.getFormOwner()` explicitly throws for form-associated elements until §4.10.18.3 supplies association. ErrorEvent source URL/line/column extraction remains the explicit §8.1.4.6 TODO in `ErrorEventImpl.extractErrorInformation()`. |
| Special processing and callback types | Window's OnErrorEventHandler path is implemented; ordinary element onerror receives one Event and uses false cancellation. WorkerGlobalScope's author projection, handler declarations, and settings/startup remain worker-owner dependencies. OnBeforeUnloadEventHandler's nullable-string conversion and returnValue rules are connected to [BeforeUnloadEvent](../browsing/navigation/events/before-unload-event.ts). Navigation still owns producing it and deciding whether to prompt. |
| Erase all event listeners and handlers | Implemented for every current handler owner. The caller selecting descendants and the associated Window is `document.open()` in §8.4 and remains unconnected. |

The beforeunload handler connection is complete. Form-owner discovery remains
a concrete prerequisite in §4.10.18.3. `integration/dom.ts` and
`HTMLFormElementImpl.getListedElements()` also retain their form-association stubs.
Do not replace ownership with ancestor lookup or silently omit a form scope.

Ordinary element handlers share the GlobalEventHandlers declaration with Window
and Document. The member binding resolves the target on each IDL access, so
body/frameset onerror still forwards while onclick stays on the element.
Before first compilation, adoption updates the listener realm used for
`window.event`; after compilation, callback realm and captured scopes stay fixed.

Real platform scope tests exposed a compiler prerequisite that plain-object
probes missed: V8 `CompileFunction` returns an empty result for JSProxy context
extensions, and Node's VM API asserts that it must have thrown. JS Engine now
validates the original body and compiles a factory with actual `with` scopes when
any scope is a Proxy. The addon now creates a named declaration through pristine
eval, captures it, and deletes the temporary name binding. Exact named source,
live lookup, receiver identity, and document-relative imports are preserved;
there is no per-invocation wrapper. Its private native compilation entry restores
author string-compilation policy. The captured scope owns the import registration
so V8's eval cache does not retain discarded contexts or loader callbacks.
Stock Node retains its anonymous factory and the approved
`proxy-function-source-name` expected failure. Experimental's `function-bodies/`
preserves the independent probes and browser comparison. No Node/V8 patch was added.

The original element-slice validation covered ten affected suites (180 cases)
across all six Node 24/26/custom stock/addon configurations. Functional cases pass, with the
approved source-name expectation and existing capability failures/skip retained.
The declaration-inventory test now includes onclick/onerror; the final Node 24
rerun covered that changed suite and the expanded erasure suite. Custom's existing
dynamic-import rejection-reporting assertion failed once during parallel
validation, then passed alone and in the full ten-suite rerun. It remains an
ordinary assertion, unchanged. Typechecking, declaration contracts, touched-file
ESLint, and diff checks pass.

Named Proxy-scope adoption: four focused suites contain 32 handler/compiler
cases plus 26 dynamic-import cases. All 32 handler/compiler cases pass normally
on each addon base. Custom has 57 normal passes and one existing import expected
failure; official addon bases have 34 normal passes and 24 existing import
expected failures. Each stock base has 54 normal passes and four expected
failures (three source-name assertions and the import error-realm case).
The full native suites also complete without unexpected failures, retaining
their existing capability expectations. Native compiler regressions cover
policy restoration, adapter reloads, retained descendants, pending-import
completion after function collection, and collection of loader-owned contexts.

Window lazy-compilation validation: nine affected unit suites pass across all
six Node 24/26/custom stock/addon configurations, retaining the approved runtime
failures. All thirteen inline-handler cases pass everywhere, including parser
delivery. The 88 selected native checks pass on each addon base (with existing
unsupported-hook/import expectations). Typechecking, Web IDL contracts, ESLint,
and diff checks pass. Experimental retains the initial public-V8 compiler probe.

Initial guard-slice validation: 140 focused handler, Storage, AbortSignal, FileReader,
BroadcastChannel, EventSource, and Web IDL callback tests pass in each of the
six Node 24/26/custom stock/addon configurations. Typechecking, declaration
contracts, touched-file ESLint, and diff checks pass. No new failure was
reclassified or skipped.

§8.1.8.2's declarations and inclusions are connected. §8.1.8.3 is now implemented
by Element.fireSyntheticPointerEvent() and fireClick(), using PointerEvent,
UserAgent's current keyboard modifier snapshot, and DOM's existing dispatch and
activation hooks. The event is allocated in the current node Document's realm,
is trusted unless requested otherwise, and returns dispatch's cancellation result.
HTMLElement.click() and keyboard activation still need their HTML §6.5 caller
policies; this does not implement disabled controls, focus, or element actions.
See the [event-firing audit](../interaction/events/ROADMAP.md#html-8183-synthetic-pointer-and-click-firing)
for the approved browser conflicts, validation, and consolidation stopping point.

### HTML §8.1.8.1: beforeunload handler processing

`OnBeforeUnloadEventHandlerNonNull` declares the specified nullable DOMString
result. Binding performs that conversion for assigned callbacks and lazily
compiled content attributes. Window, body, and frameset share the same handler;
ordinary elements do not acquire it. Original callback identity, listener order,
erasure, callback activity, and BiDi gates use the existing machinery.

The processing branch requires both BeforeUnloadEvent and the `beforeunload`
type. A converted string requests cancellation and fills `returnValue` only
when its current value is empty. Null/undefined returns do neither. Empty-string
returns still request cancellation; false becomes `"false"`. Noncancelable
events retain their string without becoming canceled. Direct writes to the
event's string remain independent of cancellation.

The shared HTML callback adapter now invokes with `rethrow` and reports failures
in the callback realm, as the ordinary DOM listener adapter does. Web IDL only
permits `report` for undefined/any results. Invocation or conversion errors end
handler processing without preventing later listeners. No generic Web IDL,
addon, or engine change was required.

Browser checks on 2 November used Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2. All three agree on nullable returns, string conversion of false/0,
empty-string cancellation, and cancelable versus noncancelable event handling.
`SPEC_CLASH(beforeunload-plain-event-conversion)` records one synthetic edge:
with `onbeforeunload = () => ({ toString() { conversions++; return 'stay'; } })`,
dispatching an ordinary `new Event('beforeunload', { cancelable: true })` invokes
`toString()` in Chromium/Firefox but not WebKit. None cancels this plain Event.
Eric approved following [HTML's declared return conversion and processing rules](https://html.spec.whatwg.org/multipage/webappapis.html#the-event-handler-processing-algorithm)
and Chromium/Firefox; the focused regression retains the conversion assertion.

Document now implements the [steps to fire beforeunload](https://html.spec.whatwg.org/multipage/browsing-the-web.html#steps-to-fire-beforeunload):
trusted dispatch reuses this handler processing, maintains unload/termination
counters, and applies the sandbox, sticky-activation, and request gates. Prompt
admission policy and host confirmation remain throwing UserAgent dependencies;
BiDi prompt hooks have no active sessions. `Navigable.checkIfUnloadingIsCanceled()`
now queues the Document checks and optional traversal event pair with a
UserAgent-owned completion promise; navigation and definite closing await it.
Removed check tasks now reject that internal completion without firing events;
full history application and cancellation of in-flight population remain dependencies. See the
[producer audit](../browsing/navigation/ROADMAP.md#html-7424-beforeunload-production).
Synthetic event dispatch does not show dialogs.

Validation: all 114 cases in the eight focused handler, BeforeUnloadEvent, and
Web IDL callback suites pass on custom Node, Node 24.19.0, and Node 26.8.1, with
and without the addon. This includes 13 new beforeunload cases; there are no
expected failures or skips in this selected set. Declaration generation,
typechecking, touched-file ESLint, import checks, and whitespace checks pass.

### HTML §8.1.8.2: handler declarations and inclusions

The refreshed HTML source (`404b3eb`) defines 76 GlobalEventHandlers, 18
WindowEventHandlers, and two Document-only handlers. All are connected, including
`onbeforeunload` with its distinct callback conversion and return-value rules.

GlobalEventHandlers is included on Window, Document, HTMLElement, SVGElement,
and MathMLElement. WindowEventHandlers is included on Window, HTMLBodyElement,
and HTMLFrameSetElement. The existing target resolver implements all six
Window-reflecting body names and the ordinary Window-only names. Document owns
`onreadystatechange` and `onvisibilitychange`. The mouseenter/mouseleave and
readystatechange accessors retain LegacyLenientThis. The four legacy WebKit
handlers register their specified mixed-case event types.

These two mixins now need declarations only: their bindings adapt existing
EventHandlerMap operations, leaving additional implementation setters such as
MessagePort's start behavior alone. One complete name-to-event-type table is shared
per target type; each target uses keyed lookup and allocates records only for
names it actually uses. DOM listener erasure still deactivates all records while
preserving the supported names. Common Element attribute processing and Node
adoption keep HTML/SVG/MathML source and callback
realm behavior aligned without extra per-namespace hooks.

The regression inventory exercises every declared name through real bindings,
content attributes, forwarding, case-sensitive dispatch, lenient receivers,
and SVG/MathML adoption and cloning. DOM's default-passive rules apply to the
activated listener, including wheel on Window/Document. This slice exposes
handlers; it does not implement missing media, input, rendering, navigation,
or other event producers. Other specifications' partial mixins and SVGSVGElement's
WindowEventHandlers contribution remain with their owners.

Validation: the nine focused handler/dispatch/storage suites exercise 115 cases
per runtime. All 115 pass on the three addon bases; each stock base has 114
ordinary passes and the existing expected source-text naming failure. The 13 new
cases pass everywhere. Generated declarations, typechecking, Web IDL contracts,
touched-file ESLint, and diff checks pass. No new failure was reclassified.

The reviewed lookup cleanup replaces definition-list scans with one shared Map
per target type. Window and Document flatten their contributions once; element
types reuse the general table directly. The other targets also share their fixed
definitions. EventHandlerMap no longer has a `define()` operation, so construction
supplies the complete table without a later mutation phase. All 289 focused
handler and target cases pass on custom/addon; custom/stock has 288 passes and the
existing source-text expected failure. Typechecking, declaration generation
checks, and touched-file lint also pass.

Before consolidation, the full custom/addon unit run was not green: after updating the intended
prototype inventory, it has 18,320 passes, 23 existing expected failures,
18 skips, one TODO, and eight ordinary failures caused by duplicate native host
hook installation. `wasm-module-brand.test.ts` called
`vi.resetModules()`, clearing HTML's module-local installation guard while native
hooks remain installed in the shared worker isolate. A subsequent Browlet import
therefore tries to install them again. This reproduces using only unchanged test
files: run `test/js-engine/wasm-module-brand.test.ts`,
`test/browlet/html/parser/parse.test.ts`, and
`test/browlet/streams/promise-dependency.test.ts` with the custom/compat unit runner,
`--maxWorkers=1 --sequence.shuffle.files --sequence.seed=2`. Three parser cases
failed; seeds 1 and 3 passed all seven cases. Consolidation moves the intrinsic
instrumentation into a child process and removes both module resets. The same
seed-2 selection now passes all seven cases, without changing the production
installation guard. The corrected full custom/addon run passes 18,719 tests,
with 26 existing expected failures, 18 skips, and one TODO.
An earlier consolidation run hit the open
[optimized Promise-job snapshot crash](../../js-engine/ROADMAP.md#optimized-promise-job-snapshots);
the successful rerun does not establish that this native failure is fixed.
An earlier full run also hit the recorded dynamic-import reporting intermittency;
that case passed both its isolated rerun and the next full run.

## HTML §8.2: global settings origin

The local HTML reference was refreshed from upstream on 2026-11-06 at
`5fcc2318395821db61e353705e6368ad9a000af5`.
[§8.2](https://html.spec.whatwg.org/multipage/webappapis.html#windoworworkerglobalscope-mixin)
now exposes Window's missing origin attribute through the existing
[WindowOrWorkerGlobalScopeMixin](../environment/global-scope.ts). The getter
serializes its environment's current origin with URL's existing serializer;
Window forwards to that owner. It adds no origin cache or mutable security state.

Web IDL's existing Replaceable binding lets assignment install an ordinary own
property without string conversion. A retained getter still returns the settings
origin, and author replacement does not affect extractOrigin() or access checks.
Inherited about:blank origins can therefore differ from location.origin. Opaque
origins serialize as "null"; document.domain relaxation does not replace the
serialized host/port. Borrowed getters retain the receiver's settings and the
existing Window same-origin-domain guard.

The [browser probe](../../../node-compat/experimental/browser-probes/html/global-origin.mjs)
agrees on Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2 for opaque and
inherited origins, replacement descriptors and identity, the retained getter,
and rejected foreign/non-Window receivers. It does not exercise the existing
document.domain policy or native navigation teardown. The focused regression
initially failed with ReferenceError because origin was absent.

This is a bounded getter/exposure slice. §8.2's existing isSecureContext,
crossOriginIsolated and extract-origin operations retain their current owners.
The mixin's reportError, timers, microtasks and structuredClone forward to their
already implemented algorithms and recorded dependencies. Its remaining members
refer to later sections: §8.3's atob/btoa are covered below; createImageBitmap
still needs the image/graphics owner, its source types and decoding. Worker global inclusion
and forwarding remain the worker composition owner's explicit dependency; this
slice neither adds worker exposure nor changes Pip's startup work.

Nine new [origin cases](../../../test/browlet/scripting/global-origin.test.ts)
and eight existing global-scope cases pass in all six Node 24.19.0/26.8.1/custom
stock/compat configurations. No expected failures or skips were introduced.

## HTML §8.3: Base64 utility methods

The clean local HTML reference was refreshed from upstream on 2026-11-06 and
remains at `5fcc2318395821db61e353705e6368ad9a000af5`.
[§8.3](https://html.spec.whatwg.org/multipage/webappapis.html#base64-utility-methods)
now has its shared algorithms on WindowOrWorkerGlobalScopeMixin and explicit
Window forwarding. btoa() rejects characters above U+00FF with
InvalidCharacterError, converts the binary string to bytes, and uses Infra's
forgiving Base64 encoder. atob() uses Infra's forgiving decoder, throws
InvalidCharacterError on failure, and converts the bytes to a binary string
through JS Engine's existing isomorphic decoder.

Web IDL owns DOMString argument conversion, receiver checks, and exception
realization in the method's realm. The atob() ByteString result uses the existing
string representation; no new conversion contract is needed. Generated platform
declarations expose both methods with a required string argument.

The [browser probe](../../../node-compat/experimental/browser-probes/html/base64.mjs)
agrees on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 for byte values,
Unicode rejection, omitted padding, ASCII whitespace, unused trailing bits,
malformed input, coercion, receivers, descriptors, and borrowed-method exception
realms. No specification conflict was found. The new exposure regression first
failed because both methods were absent.

Eleven [Base64 cases](../../../test/browlet/scripting/base64.test.ts), eight
existing global-scope cases, and 23 Infra codec cases pass in all six Node
24.19.0/26.8.1/custom stock/compat configurations. No expected failures or skips
were introduced. Platform type contracts cover both signatures.

This slice needs no OS, editing, or layout dependency. Worker-global inclusion
and forwarding remain the worker composition owner's explicit dependency, as
recorded in §8.2. Eric subsequently deferred §§8.4–8.6 to Ged and moved Vin's
audit to §8.7 below.

## HTML §8.7: microtask queuing

The [section's normative operation](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#microtask-queuing)
queues the supplied callback, invokes it with no arguments, and reports any
exception. The rest of the section explains ordering and gives examples; it
adds no timer, parsing, rendering, or editing requirement. The local reference
remains the refreshed `5fcc2318395821db61e353705e6368ad9a000af5` source.

Window already forwards queueMicrotask() to WindowOrWorkerGlobalScopeMixin.
Binding's VoidFunction conversion requires a callable, supplies undefined as
the callback receiver, ignores its return value, and uses the declared report
exception behavior. EventLoop owns the existing shared queue, nested-checkpoint
guard, current-task state, and host wake-up.

The mixin previously queued directly on EventLoop without the Window Document.
It now uses the existing realm queueMicrotask() helper, which carries that
association (null for non-Window realms). The focused regression first failed
because the queued task's document was null. Document activity does not gate
the initial checkpoint; retaining it matters if an internal algorithm later
spins that microtask into an ordinary task. This does not extend the existing
continuation-based spin API to suspend arbitrary author callbacks.

The [new tests](../../../test/browlet/scripting/queue-microtask.test.ts) cover
empty callback arguments, undefined receiver/return, ignored thenable results,
required callable arguments, and retained task Document/activity metadata.
Existing global-scope and checkpoint regressions cover Promise/DOM interleaving,
nested FIFO delivery, receiver conversion, callback failure reporting, and
continuing the queue after a failure. The 14 focused cases pass in all six
Node 24.19.0/26.8.1/custom stock/compat configurations, without new expected
failures or skips.

The [browser probe](../../../node-compat/experimental/browser-probes/html/microtask-queuing.mjs)
agrees in Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 on an HTTPS
Document: invocation, ignored results, ordering, and reported exception identity.
An initial blank-page probe exposed a WebKit error-reporting context difference;
using an ordinary same-origin Document removed it without changing expectations.
The probe does not inspect browsers' internal task metadata.

Worker-global inclusion/forwarding remains with the worker composition owner.
The [checkpoint audit](#html-8173-microtask-checkpoint-audit) retains the missing
IndexedDB transaction cleanup and Long Animation Frames timing consumers, and
the native checkpoint limitations remain in
[LIMITATIONS](../../LIMITATIONS.md#scheduling-and-callback-context).
Those are existing owner dependencies, not prerequisites from §§8.4–8.6.
Eric has left those three sections with Ged; Vin's user-prompts audit continues below.

## HTML user prompts: simple dialogs

The [simple-dialog section](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#simple-dialogs)
was §8.8 at the previous checkpoint and is §8.9 in the current rendered standard.
The clean local HTML reference was refreshed on 2026-11-06 and remains
`5fcc2318395821db61e353705e6368ad9a000af5`; the stable algorithm anchors identify
the work independently of numbering. alert(), confirm(), prompt(), and the
shared cannot-show-simple-dialogs check are implemented at their local owners.
Printing follows; actual dialog UI and BiDi sessions remain explicit dependencies.

Window exposes the two specified alert overloads: omission supplies an empty
message, while explicit undefined converts to "undefined". Binding owns argument
conversion and receiver checks before dialog admission. Window normalizes newlines,
keeps the complete message under the permitted optional-truncation choice, calls
the existing BiDi opened hook, and reports the alert closed with accepted=true
for either automation decision. The ordinary host path uses EventLoop.pauseUntil()
around UserAgent.showAlert(), preserving the current task and stalling tasks and
microtasks until acknowledgement. Internal host failure restores the pause and
does not report a completed prompt.

The common admission algorithm rejects sandboxed-modals. Browlet also selects
HTML's permitted suppression while termination nesting is nonzero or the associated
Document is no longer fully active. No additional opt-out UI or truncation policy
is installed. Tests include sandbox state changed during message conversion.

`SPEC_CLASH(alert-newlines)`: HTML explicitly normalizes CR and CRLF to LF.
The [browser probe](../../../node-compat/experimental/browser-probes/html/simple-dialogs.mjs)
observed normalized dialog messages in Chromium 156.0.8078.4 and Firefox 157.0;
WebKit 27.2's dialog notification retained the supplied CR/CRLF. Eric approved
the HTML/Chromium/Firefox rule on 2026-11-06. All three agree on omission versus
undefined, coercion, ignored extra arguments, method descriptors, invalid receivers,
Symbol errors, sandbox suppression after conversion, and detached-Window suppression.
The probe observes notification text, not the platform UI's final rendering.

confirm() and prompt() use Web IDL's optional empty-string defaults, so explicit
undefined uses the default rather than alert's string conversion. Suppression
returns false or null, respectively. prompt() keeps its complete default text;
an ordinary accepted host response is returned exactly, including an empty string.
The written automation branches return true/false for confirm(), and empty string/null
for prompt(), independent of the default text. Closed notifications retain those
results. No host dependency is invoked for either automatic decision.

`SPEC_CLASH(confirm-prompt-newlines)` and `SPEC_CLASH(prompt-default-newlines)`:
the [confirm/prompt probe](../../../node-compat/experimental/browser-probes/html/confirm-prompt.mjs)
found the same message-newline split as alert. Firefox additionally stripped line
breaks from prompt's default text before notification; Chromium/WebKit retained
them. Eric approved HTML message normalization and unchanged default text on
2026-11-06. All three agree on optional defaults, conversion order, ignored extra
arguments, invalid receivers/Symbol errors, sandbox suppression, and inactive
Window results. Playwright accept-without-text results differ by transport; they
are not evidence about BiDi's configured automatic handler. Explicit supplied
responses and dismissal are recorded separately.

`SPEC_CLASH(simple-dialog-automation-display)`: the HTML confirm/prompt algorithms
list UI display before consulting automation. Browlet instead reuses alert's
combined display-and-wait boundary, calling the host only for handler=none.
Eric approved this ordering on 2026-11-06; it avoids requiring UI for automation
and keeps all blocking host work inside the existing event-loop pause.

`SPEC_GAP(prompt-bidi-default)`: HTML omits the fourth argument when invoking the
[BiDi opened hook](https://w3c.github.io/webdriver-bidi/#event-browsingContext-userPromptOpened),
although BiDi accepts optional default text for its notification. Firefox's
`remote/shared/listeners/PromptListener.sys.mjs` supplies the prompt input text.
Eric approved passing the untruncated default through the existing hook on
2026-11-06. This does not add an automation session or a new hook contract.

Missing dependencies remain explicit. UserAgent.showAlert(), showConfirm(), and
showPrompt() throw until a host can display the dialog and synchronously await
its response without executing author code or relying on queued callbacks on
the blocked thread. Script callers
must enter through the existing HTML task/evaluation machinery for that pause.
The BiDi hooks still have no active sessions, so ordinary production calls reach
the host dependency. Pending UI reflection and pause-duration reporting retain
their existing EventLoop TODOs. This does not implement an OS dialog or automate
one through the test mocks.

The initial exposure regressions failed because the methods were absent. The
focused suite covers overloads/defaults, live gates, automation, returned responses,
pause/resumption, and explicit display failure; generated platform contracts claim
all three methods but still exclude unimplemented printing. All 31 cases pass on
Node 24.19.0, 26.8.1, and custom 27.0.0-pre in both stock and compat modes. The
alert checkpoint also passed 17 adjacent beforeunload cases on Node 26.8.1 compat.
Typechecking and focused lint pass; no new expected failures or skips were introduced.

## Present

| Source | Current responsibility |
| --- | --- |
| `agents.ts` | Agent/cluster records, Window inventory, one EventLoop per Agent, observer creation counters, and batched MutationObserver/slot-change notification |
| `realm.ts` | Relevant/incumbent ownership and controlled script/callback entry; environment bases and full browser settings live in [`../environment.ts`](../environment/environment.ts) |
| `execution-context.ts`, `script.ts` | Explicit contexts, HTML script state/creation, compiled classic/source-text/synthetic records, ModuleRequests, supplied dependency linking, and the Wasm ESM boundary |
| `script-fetch-options.ts`, `script-fetching.ts`, `module-map.ts` | Fetch options, classic/worker/single-module fetching, document/worker/worklet module-graph orchestration, and cached results/pending callbacks; the environment forwards fetch calls and owns integrity lookup/type permission |
| `module-loading.ts` | HostLoadImportedModule and supported import attributes, graph pending/visited state, and static/dynamic completion; separate from HTML fetch state |
| [`../worklets/module-responses-map.ts`](../worklets/module-responses-map.ts) | Downloaded responses and pending notifications shared across a Worklet's globals; separate from their per-environment module maps |
| `global-object.ts`, `import-map.ts` | Shared HTML global state, import-map parsing/normalization/merging, module specifier resolution, and parse-result creation; Window owns registration |
| [`../environment.ts`](../environment/environment.ts), [`../dom/events/error-event.ts`](../dom/events/error-event.ts) | Global exception reporting and ErrorEvent; the realm callback and global-scope operation delegate to the environment |
| `event-loop.ts`, `tasks.ts` | Task records, source/queue associations, fully-active gating, deterministic turns, checkpoints, incumbent stack, timing hooks, and coalesced wake-ups |
| `host-hooks.ts` | Native callback installation for TrustedScript extraction, rejection and exception reporting; custom-engine make/call hooks plus Promise, generic, and timeout job delivery |
| [`../environment/global-scope.ts`](../environment/global-scope.ts), `timers.ts` | Higher-level global API composition; lower-level active-time waits and Window function timers |
| `rendering-opportunity.ts` | Independent opportunity producer, Document render-blocking filter, and ordered rendering pipeline seams |
| `speculation-rules.ts` | Parse-result creation and an empty-only rule-set record with an explicit parser boundary; Document owns registered sets and Window owns registration/removal/replacement |
| [Structured data](structured-data/ROADMAP.md) | Graph serialization/deserialization, ArrayBuffer transfer, and the Window structuredClone API |

`createWindowEnvironment()` composes the same Window/realm/execution boundary
for initial browsing and navigation. BrowletEnvironmentBase supplies security,
navigation state, network partitioning, and the UserAgent before a realm exists.
The base and full environments live in `browlet/environment/environment.ts`; full environments
inherit the base state and add the actual realm, allocation facilities, global, and browser
policy/reporting operations. They sit above the scripting foundations, which retain
type-only references to them, and are not re-exported by Scripting's barrel.
SandboxEnvironment supplies internal execution through the same binding
contract without attaching HTML settings. Browser client fields that have no
sandbox meaning currently throw; add them only with an actual consumer and
defined ownership. UserAgent-owned sandboxes retain their owner, while
standalone sandboxes have no UserAgent until one is supplied at construction.
Workers/worklets must use their own specified origin, policy, isolation, and
time-origin inputs rather than substitute the global for its settings object.

Settings satisfy narrow subsystem contracts. Browser-owned work can retain its
UserAgent independently of a live Document. BiDi hooks live on that UserAgent,
with explicit scoped inputs and provisional no-session results. The lazy-loading
slice adds `BrowletEnvironment.isScriptingEnabled()`:
it checks the UserAgent preference and the relevant Window's current sandbox,
then calls `webDriverBiDiScriptingIsEnabled(env)`. That hook provisionally returns
true, the no-session/no-override result, alongside the existing network hooks.
BiDi's top-level traversable/user-context override selection remains unimplemented.
The HTML run algorithms consume the same predicate through `canRunScript`;
script-element preparation and the parser still need integration. Existing direct
evaluation and automation do not acquire this gate automatically.

## Remaining implementation

| Owner | Missing contract |
| --- | --- |
| Script records/classic scripts | Production fetch/run callers, complete active-script/source metadata, worker-imported synchronous pause, and timing; retained compiled execution and modeled context restoration are connected |
| Module scripts/maps | Engine parse/load/link/evaluate, import attributes, dynamic import, host hooks, and script-element callers; HTML fetch/run orchestration and import-map algorithms are present |
| Error reporting | Source locations, complete script attribution, and dedicated-worker propagation; native rejection notifications, slot queries, and checkpoint delivery are connected on addon bases |
| Event handlers | Form-owner discovery, source locations, worker error handlers, and later event producers; content-attribute compilation, the global handler declarations, beforeunload conversion/return-value behavior, and Window/body/frameset targeting are connected |
| DOM checkpoint consumers | Custom-element reactions; MutationObserver and signal-slot delivery already use the existing checkpoint |
| Task routing/lifecycle | Worker restrictions and complete loop teardown; element-task routing through the retained relevant global is implemented |
| Global utilities/timers | Image APIs; worker-global inclusion/forwarding and suspension; handler timing; TrustedScript/CSP/classic-script string timers |
| Rendering/idle | Idle API, callback delivery, timeouts, and cleanup are connected; AnimationFrameProvider and the production rendering/refresh host remain |
| Workers/worklets | Real globals/settings, production callers of Agent allocation, execution readiness, termination, and engine enforcement |

Secure-context/isolation exposure, origin, Base64, structured cloning, Fetch,
reportError, and function timers already have their reached Window implementations.
The remaining global utilities above still need public implementations, even
where their underlying records or primitives exist.

The ordinary IDL-handler core used by onabort already exists. Extend it with the
actual HTML consumers above; event-handler storage is not a task scheduler.
Dynamic markup/parser, sanitization, Navigator, images, and speculation-rule
registration retain their own subsystem owners.

### Section 8.1.4 staging

Use bounded consumer slices within HTML's script algorithms:

1. **Classic-script records and creation (§§8.1.4.1–8.1.4.3).** Fetch, MIME,
   Encoding, referrer policy, integrity, and body transport now exist. Complete
   script preparation/readiness; retained compiled execution is connected.
   Classic/source-text/synthetic creation is connected; Wasm ESM and creation timing remain open.
   The existing evaluation entry and parser ScriptHandler do not supply it.
2. **Calling scripts and errors (§§8.1.4.4–8.1.4.6).** Preserve implemented
   callback preparation/cleanup, task settings sets, empty-stack checkpoints,
   ErrorEvent dispatch, and muting. Complete active-script/source provenance and
   dedicated-worker propagation with their consumers. Forced termination stays deferred.
3. **Rejected promises (§8.1.4.7).** The HTML tracker, notification tasks, and
   PromiseRejectionEvent are connected to native notifications, slot reads, and
   checkpoints on addon bases. Preserve stock-only expected failures and finish
   script attribution and worker/worklet integration with their consumers.
4. **Modules/import maps (§8.1.4.8 and §§8.1.5–8.1.6).** Build on the module map
   and static/dynamic graph loader with module-specific context restoration and
   the remaining source/Wasm paths. Import-map parsing, merging, resolution, parse
   results, and Window registration are translated; connect script-element callers.
5. **Speculation rules (§8.1.4.9).** Creation/error capture and Window registration,
   removal, and replacement are translated. Complete the §7.6 rule model/parser
   and Document's speculative-load processing, then connect §4.12.1 script
   preparation, execution, and removal. The current rule set is empty-only.

The early controlled-entry subset is complete. Custom host hooks extend it,
but neither they nor native queues reveal every arbitrary V8 frame. Retain the
[execution-context limitation](../../LIMITATIONS.md#scheduling-and-callback-context)
until Script records and transparent host entry provide the missing evidence.

## Outstanding event-loop work

HTML [§8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)
still has unimplemented algorithm steps, not just missing consumers.

The 2026-10-31 review read §§8.1.7.1–8.1.7.5 at HTML source
`404b3eb14a7a936dddefb2d78e224dbeb01d2358`. This is not a completion claim.
Implement the available steps; identify each missing dependency at the step
that needs it, including its owner and specification algorithm. An absent image,
media, or parser caller is not by itself a reason to omit the scheduling operation.

| Operation | Work available in Browlet | Exact remaining dependency or boundary |
| --- | --- | --- |
| [Queue an element task](https://html.spec.whatwg.org/multipage/webappapis.html#queue-an-element-task) | Implemented on `ElementImpl.queueTask()`, forwarding to its retained creation realm's global-task operation. | No missing scheduling dependency. Adoption changes the node document but not the task's global; future element algorithms supply the source and steps. |
| [Await a stable state](https://html.spec.whatwg.org/multipage/webappapis.html#await-a-stable-state) | Implemented on `env.awaitStableState()`, with shared-queue idle wake-ups and optional parallel continuation. | Image/media algorithms still need to supply their own synchronous sections and continuations; the scheduling operation itself is implemented. |
| [Spin the event loop](https://html.spec.whatwg.org/multipage/webappapis.html#spin-the-event-loop) | Implemented on `EventLoop.spinUntil()`: suspend modeled state, checkpoint, register the wait, and resume on the original task source with saved state and metadata. | Callers must lower their remaining steps and cleanup into the continuation. The parser already has stylesheet/script continuations to migrate; complete preparation, readiness, nesting, and abort handling belong to its [script runner](../html/parser/ROADMAP.md). Arbitrary synchronous author calls are not resumable through this helper. |
| [Pause](https://html.spec.whatwg.org/multipage/webappapis.html#pause) | `EventLoop.pauseUntil()` retains the task/stack, samples the current global's clock, and suppresses tasks/checkpoints throughout a caller-supplied synchronous wait. | Dialog and synchronous Fetch callers need real blocking host effects whose goals can progress without this thread's callbacks. A UI host must reflect pending state where necessary. [Record pause duration](https://w3c.github.io/long-animation-frames/#record-pause-duration) separately needs Document frame timing and a pending script entry; its call site is present. |
| [Window idle periods](https://html.spec.whatwg.org/multipage/webappapis.html#idle-deadline-computation) | Implemented timestamps, idle branch, live 50ms/timer/render deadline, and per-Window coarsening. Window's idle API, callback lists, task delivery, timeout races, and cleanup are connected. | `WindowIdleRendering` still needs AnimationFrameProvider state and the production rendering/refresh host. Headless delivery uses the 50ms and timer bounds without a fake display rate; see the [idle-period slice](#html-8173-idle-period-processing) and [Request Idle Callback](#request-idle-callback-47). |
| [Rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering) | Document ordering and the ordered update pipeline are present. | The production refresh host and the owners of individual resize, scroll, animation, layout, paint, and observation steps remain absent; an ordered hook is not an implementation of its operation. |
| Performance reporting | Task timing and long-task call sites are present. | [Long Tasks reporting](https://w3c.github.io/longtasks/#report-long-tasks) and Long Animation Frames task/script/frame records and algorithms are missing. |
| Worker rendering/shutdown | Dedicated/shared globals and settings can be composed. `close()` discards queued tasks, loops reject new tasks, and the empty-loop tail destroys the loop after its final checkpoint, then runs the global's timer/port/owner cleanup. The outside `WorkerThread` can forcibly stop native execution and clear/disconnect a supplied dedicated outside port. | [Worker event-loop processing](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model) still needs automatic lifetime/suspension monitoring, supported dedicated-worker animation callbacks, and natural native teardown. Outside Worker association and the separate-isolate startup caller remain unfinished; see the [worker processing-model review](../workers/ROADMAP.md#document-order-review). |
| Checkpoint tails | Rejection notification and DOM delivery are connected. | [IndexedDB transaction cleanup](https://w3c.github.io/IndexedDB/#cleanup-indexed-database-transactions) needs transaction state and the cleanup-event-loop association. [Long Animation Frames checkpoint timing](https://w3c.github.io/long-animation-frames/#record-timing-info-for-microtask-checkpoint) needs pending script/frame entries. The native clear's [ordering and Agent isolation](EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint) remain separate engine questions. |

The stable-state operation and its parallel-microtask specification clash are
recorded [above](#html-8173-stable-state-scheduling), followed by the controlled
spinning operation. These implementations do not close the remaining processing
model. Element-task routing, HTML's idle-period calculation, and Request Idle
Callback's API and delivery are also implemented. Pause now supplies the
loop-owned synchronous guard and timing; its host effects and performance owner
remain separate. Worker, performance, rendering, and checkpoint operations have
the exact owner dependencies recorded above.

The available loop-owned scheduling operations in this audit are now covered.
Continue in document order with §8.1.8 Events. Keep the listed owner/host
dependencies and native checkpoint questions open; this does not establish
complete §8.1.7 conformance.

Preserve a single queue for Promise jobs and HTML microtasks. Do not put a
TypeScript microtask queue beside V8's queue or claim a worker closing flag
implements shutdown. Worker/worklet Agent records alone also do not configure
V8's CanBlock or shared-memory isolation; those gates remain with the engine.

## Validation

Keep deterministic queue selection, inactive-Document retention, per-source order,
same-Agent cross-realm FIFO, checkpoint reentrancy, and cancellation coverage.
Callback tests must distinguish stored incumbent settings from an ordinary
author function's active script context. Automation tests cover host completion,
idle-page wake-ups, navigation cancellation, and unrelated Node progress.

Future consumers should prove their full lifecycle through the existing loop:
classic parser scripts before modules; DOM notification state before delivery;
worker teardown before claiming worker scheduling; rendering callbacks before
idle prediction. Backend constraints and their replacement conditions belong to
[the architecture note](EVENT-LOOP-ARCHITECTURE.md#runtime-integration-and-accommodations)
and [JS Engine](../../js-engine/README.md), rather than another completed-slice plan.
