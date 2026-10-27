# Scripting roadmap

HTML [§8](https://html.spec.whatwg.org/multipage/webappapis.html) owns Agents,
settings, script execution, scheduling, global utilities, and timers.
The Window scheduling kernel, controlled script/callback entries, function
timers, and reached Fetch/Streams/Reporting consumers are implemented.
HTML script-state contracts and modeled active-script lookup exist. Parsing,
script/module execution, remaining checkpoint work, and other global lifecycles
remain open.

[Project priority](../../PRIORITY.md) orders cross-subsystem work.
[Event-loop architecture](EVENT-LOOP-ARCHITECTURE.md) owns scheduling boundaries;
[JS Engine](../../js-engine/ROADMAP.md) owns missing runtime primitives.
Do not restart the completed task/timer foundation when adding these consumers.

## HTML §§8.1.1–8.1.2 audit

Reviewed 2026-10-25. Continue through §8 with the specification's state and
relationships explicit, while leaving new addon/V8 work parked on
`research/html-agent-execution`. A modeled field is not proof that the engine
enforces it. Add tests of actual consuming behavior as that machinery arrives;
retain approved expected failures for unsupported runtime requirements.

### §8.1.1: routes into author code

This introduction inventories consumers; it does not define a new dispatcher.

| Entry | Present and missing dependencies |
| --- | --- |
| HTML script elements | [Script state](../dom/nodes/html/scripting/script.ts), parser handoff, and [Browlet's script handler](../browlet.ts) exist. Formal classic/module records, preparation/readiness, script fetching, and execution checks remain §§4.12 and 8.1.4 work. |
| `javascript:` navigation | The [navigation path](../browsing/navigation/ROADMAP.md) is missing; do not treat generic evaluation as its implementation. |
| Event listeners and handlers | DOM listeners and the [IDL-handler core](event-handlers.ts) run callbacks. Content-attribute compilation, global handler surfaces, and special error/beforeunload rules remain §8.1.8 work. |
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
| Window cluster selection | `BrowsingContextGroup.obtainSimilarOriginWindowAgent()` owns site/origin keys, historical OAC choices, isolation-mode inheritance, and per-group separation. Cross-origin access checks and `document.domain` are separate unfinished consumers. |
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
object and owns its composed execution facilities as `env.exec`. The associated
realm reaches those facilities through its environment. The explicit context
model below is separate; the existing facilities names remain unchanged during
this experiment. Internal sandboxes are not HTML settings objects.

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
| Realm execution context | `realmExecutionContext` returns the associated realm's retained `JSExecutionContext`. Controlled script entry pushes that context below the script's own context. `env.exec` remains the separate facilities object. |
| Module map | `moduleMap` returns the Document's `ModuleMap`; single-module fetching now stores pending callbacks and module results by URL value and type. Graph loading/linking remains unfinished. |
| API base URL | `apiBaseURL` queries the associated Document's current base URL. |
| Origin | `origin` queries the associated Document's origin. |
| Has cross-site ancestor | `hasCrossSiteAncestor` uses the Document's live ancestry query. |
| Policy container | `policyContainer` returns the associated Document's policies. |
| Cross-origin isolated capability | `crossOriginIsolatedCapability` returns false outside concrete isolation. The concrete branch explicitly throws until the Permissions Policy check exists. |
| Time origin | `timeOrigin` supplies the existing HRT `Moment` for navigation start. |
| Responsible event loop | `responsibleEventLoop` returns `realm.agent.eventLoop`, the same agent that owns the associated global. |

Window supplies the settings queries above. Worker/worklet settings must
implement the same settings contract when their globals are introduced.
[environment.test.ts](../../../test/browlet/environment.test.ts) covers the
discard flag, while the script/callback lifecycle tests cover the existing
entry and cleanup behavior.

## HTML §8.1.3.3: explicit context experiment

The current approach follows HTML's records and stack operations in JavaScript,
without adding Node/V8 hooks. It models the entries Browlet controls; it does not
claim that the engine supplies a record for every actual function invocation.

| Requirement | Present model and remaining dependency |
| --- | --- |
| Global state | `BrowletGlobalObject` requires the error-reporting flag, both rejected-promise collections, import map, and resolved module set. Window and the service-worker global skeleton initialize them; future worker/worklet globals must do so too. Error reporting, rejection tracking, and import-map processing remain unwired consumers. |
| Realm creation | `createBrowletRealm()` and production Window composition share `BrowletRealm.initialize()`: bracket global creation with the retained context, pop it, then remove SharedArrayBuffer when required. The ordinary factory accepts omitted customizations and returns the retained context. |
| Retained context | `BrowletRealm.executionContext` is stable for the realm's lifetime. Environment settings return that same record. The existing VM context and `env.exec` facilities are separate. |
| Entry | `entryExecutionContext` selects the most recently pushed retained realm context, including a nested HTML entry. Its `.realm` supplies entry realm, `.realm.env` entry settings, and `.realm.globalObject` entry global. Missing entry context throws. |
| Incumbent | The topmost non-null ScriptOrModule and its skip counter select script settings or the backup stack; missing backup settings throw. Callback preparation/cleanup maintain the counter and backup settings. Callback capture uses its binding environment for direct Node-host calls when both modeled stacks are empty; that accommodation stays outside the specification lookup. |
| Current | `runningExecutionContext.realm` gives the top modeled realm; that realm's `.env` and `.globalObject` supply current settings and global. It is only current for the transitions recorded in this stack; arbitrary author/built-in calls do not yet maintain it. |
| Relevant | A platform object's `PlatformRecord.realm` supplies its relevant realm independently of the stack; that realm's `.env` and `.globalObject` supply relevant settings and global. The binding records ownership, so changing the object's prototype does not change it. |

`JSScriptOrModule` carries the realm and HTML host-defined script. Complete
Script/Module records and active-script restoration remain §§8.1.4 and 8.1.6
work; the temporary record in `runScriptEvaluation()` has null `hostDefined`
until script creation and execution supply a parsed HTML script.
The generic realm factory alone does not construct an HTML global implementation
or attach settings; Window/worker/worklet composition owns those steps.

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
Revisit with the actual example pages and platform APIs when supported. Script
and module processing, execution, and host-hook algorithms still lie ahead;
continue in specification order. New native work remains parked.

The entry/incumbent/current/relevant audit stops before §8.1.3.4. Scripting
enablement still awaits its own audit. Broader consumer regressions can follow when
[Window messaging](../communication/ROADMAP.md) exists.

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
| ECMAScript records | Browlet's record classes distinguish kinds and carry realm/HostDefined. Classic records retain compiled code; synthetic records retain their default-export input. Module parsing, linking, evaluation, and remaining ECMAScript fields are still missing. |
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
[BrowletEnvironment](../environment.ts) supplies thin forwarding methods that
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
but are prerequisites for the fetchers. Parser production of ModuleRequests and
HostGetSupportedImportAttributes remain unconnected.

All five module creation operations are constructors. JavaScript and WebAssembly
still stop at explicit parser boundaries; CSS/JSON/text retain their synthetic
export inputs. [Module-fetch tests](../../../test/browlet/scripting/module-fetching.test.ts)
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
fetch client, and error slot for the later HostLoadImportedModule algorithm.

`JSModuleRecord.loadRequestedModules()` and `link()` are explicit throwing
dependencies. They do not walk imports, invent parsed records, or call V8.
Promise completion uses the record's existing `InternalPromise` observation path.
Internal implementation errors remain explicit rather than becoming author
link errors. [Graph tests](../../../test/browlet/scripting/module-graphs.test.ts)
replace the unfinished record operations and verify completion ordering,
fetch-client propagation, and the distinction between loading and module errors.
These tests establish orchestration only, not working module graphs.

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
Only script creation and the still-unimplemented module-record operations are
replaced; these are fetch orchestration tests, not worker/worklet startup tests.

**Remaining implementation dependencies:**

- `fetchClassicWorkerImportedScript()` is an explicit throwing skeleton. Unlike
  the two callback-based classic fetchers, this algorithm pauses synchronously
  until Fetch completes, then returns a script or throws NetworkError. The
  [event-loop pause dependency](#deferred-processing-model-tails) is not supplied by today's
  asynchronous Fetch task delivery. Do not substitute a Promise return or launch
  a fetch that cannot finish before this method returns.
- Descendant orchestration is translated, but its module-record operations
  `LoadRequestedModules(state)` and `Link()`, plus HostLoadImportedModule, remain
  unfinished. Successful single-module fetches do not satisfy these dependencies.

Calling remains §8.1.4.4; new native work remains parked.

## HTML §8.1.4.3: creating scripts

The constructors in [script.ts](script.ts) translate creation without evaluating
author code. Existing module-type/destination helpers already cover the section's
remaining algorithms.

| Creation | Implemented behavior and explicit boundary |
| --- | --- |
| Classic | Muted errors select `about:blank`; disabled scripting supplies empty source unless bypassed. Retains options, original source URL, realm, and HostDefined. Node's `vm.Script` compiles without executing. Syntax errors are allocated in the target realm and populate both error fields. |
| JavaScript module | Applies scripting policy and initializes state, then calls `BrowletRealm.parseModule()`. That parser still throws InternalError pending integration with the actual VM context. Error lists select the first parse error without setting `errorToRethrow`. |
| WebAssembly | Disabled scripting substitutes the eight-byte empty module. Calls an explicit, unfinished ESM parser; ordinary Wasm compilation alone would not provide the required module record/linking. Parse exceptions populate only `parseError`; implementation failures propagate. |
| CSS | Constructs a sheet with default options and calls `replaceSync`; replacement exceptions become `parseError`. Retains the sheet implementation as the synthetic default-export input. Binding must project it before module execution exposes an author value. |
| JSON | Uses the target realm's captured JSON parser, retaining the parsed value or realm-owned parse error. Does not blank source when scripting is disabled. |
| Text | Retains the supplied string unchanged as the default-export input, also independently of scripting enablement. |

Two representation boundaries remain marked for review: `JSRealm.parseScript()`
returns an opaque compiled artifact instead of a complete ECMAScript Script Record;
HTML wraps it with the realm/HostDefined. CSS retains an implementation until the
future module-execution binding projects its export. Synthetic records are still
models, not engine modules: their dependency-loading and linking methods throw.
Compiled classic code likewise still needs the §8.1.4.4 execution path, including
an addon-context execution operation and active-script metadata. No recompile or
fallback evaluation path was added here.

The Long Animation Frames creation hook retains `originalSourceURL`, but frame
timing records, pending-script entry creation, and reporting remain missing in
[Performance](../performance/ROADMAP.md). This is not a complete timing hook.

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

## Present

| Source | Current responsibility |
| --- | --- |
| `agents.ts` | Agent/cluster records, Window inventory, one EventLoop per Agent, observer creation counters, and batched MutationObserver/slot-change notification |
| `realm.ts` | Relevant/incumbent ownership and controlled script/callback entry; environment bases and full browser settings live in [`../environment.ts`](../environment.ts) |
| `execution-context.ts`, `script.ts` | Explicit contexts, HTML script state/creation, compiled classic records, synthetic export inputs, ModuleRequests, and module-parser boundaries |
| `script-fetch-options.ts`, `script-fetching.ts`, `module-map.ts` | Fetch options, classic/worker/single-module fetching, document/worker/worklet module-graph orchestration, and cached results/pending callbacks; the environment forwards fetch calls and owns integrity lookup/type permission |
| [`../worklets/module-responses-map.ts`](../worklets/module-responses-map.ts) | Downloaded responses and pending notifications shared across a Worklet's globals; separate from their per-environment module maps |
| `global-object.ts`, `import-map.ts` | Shared HTML global-state contract and import-map/specifier-resolution record shapes |
| `event-loop.ts`, `tasks.ts` | Task records, source/queue associations, fully-active gating, deterministic turns, checkpoints, incumbent stack, timing hooks, and coalesced wake-ups |
| `host-hooks.ts` | Custom-engine make/call hooks plus Promise, generic, and timeout job delivery |
| [`../global-scope.ts`](../global-scope.ts), `timers.ts` | Higher-level global API composition; lower-level active-time waits and Window function timers |
| `rendering-opportunity.ts` | Independent opportunity producer, Document render-blocking filter, and ordered rendering pipeline seams |
| `speculation-rules.ts` | Provisional parse-result record shared by HTML scripts, Document parsing, and Window updates; no rule-set parsing or registration yet |
| [Structured data](structured-data/ROADMAP.md) | Graph serialization/deserialization, ArrayBuffer transfer, and the Window structuredClone API |

`createWindowEnvironment()` composes the same Window/realm/execution boundary
for initial browsing and navigation. BrowletEnvironmentBase supplies security,
navigation state, network partitioning, and the UserAgent before a realm exists.
The base and full environments live in `browlet/environment.ts`; full environments
inherit the base state and add the actual realm, exec, global, and browser
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
Script preparation/execution must eventually consume the
same settings predicate; adding this consumer has not made all execution paths
respect the new preference.

## Remaining implementation

| Owner | Missing contract |
| --- | --- |
| Script records/classic scripts | Creation/run algorithms, worker-imported fetching, production fetch callers, active-script restoration, scripting-disabled checks, and runtime errors |
| Module scripts/maps | Parse/link/evaluate, graph fetching, import maps/attributes, dynamic import, and host hooks |
| Error reporting | ErrorEvent, PromiseRejectionEvent, muted-error handling, source locations, and rejection tracking |
| Event handlers | Content-attribute compilation, Window/body/frameset targeting, global handler mixins, and special error/beforeunload behavior |
| DOM checkpoint consumers | Custom-element reactions; MutationObserver and signal-slot delivery already use the existing checkpoint |
| Task routing/lifecycle | Element-task wrapper using the relevant global, worker restrictions, and complete loop teardown |
| Global utilities/timers | Origin/base64/reportError/image APIs and isolation exposure; worker suspension; handler timing; TrustedScript/CSP/classic-script string timers |
| Rendering/idle | AnimationFrameProvider, real rendering hooks, idle callbacks, deadlines, and lifecycle cleanup |
| Workers/worklets | Real globals/settings, production callers of Agent allocation, execution readiness, termination, and engine enforcement |

Secure-context exposure, structured cloning, Fetch, and function timers already
have their reached Window implementations. Origin/base64 and the other global
utilities above still need public implementations, even where their underlying
records or primitives exist.

The ordinary IDL-handler core used by onabort already exists. Extend it with the
actual HTML consumers above; event-handler storage is not a task scheduler.
Dynamic markup/parser, sanitization, Navigator, images, and speculation-rule
registration retain their own subsystem owners.

### Section 8.1.4 staging

Use bounded consumer slices within HTML's script algorithms:

1. **Classic-script records and creation (§§8.1.4.1–8.1.4.3).** Fetch, MIME,
   Encoding, referrer policy, integrity, and body transport now exist. Complete
   script preparation/readiness and connect the retained compiled code to execution.
   Classic and synthetic creation are translated; module parsing and creation timing remain open.
   The existing evaluation entry and parser ScriptHandler do not supply it.
2. **Calling scripts and errors (§§8.1.4.4–8.1.4.6).** Preserve implemented
   callback preparation/cleanup, task settings sets, and empty-stack checkpoints.
   Add formal active-script ownership, muted errors, ErrorEvent, and reliable
   source provenance. General termination needs an enforceable host primitive.
3. **Rejected promises (§8.1.4.7).** Obtain a faithful rejection host hook and
   per-global lifecycle. Node's process-wide events cannot supply that ownership.
4. **Modules/import maps (§8.1.4.8 and §§8.1.5–8.1.6).** Build on the module map
   and single-module fetchers with graph loading, engine linking/evaluation,
   registration, and dynamic-import hooks.
5. **Speculation rules (§8.1.4.9).** Replace the provisional Document parse-result
   factory and Window update with parsing/error capture and registration with the
   Document and loader policy that consume it. The record's rule-set field is
   currently null; extend it with the concrete §7.6 rule-set type at that point.

The early controlled-entry subset is complete. Custom host hooks extend it,
but neither they nor native queues reveal every arbitrary V8 frame. Retain the
[execution-context limitation](../../LIMITATIONS.md#scheduling-and-callback-context)
until Script records and transparent host entry provide the missing evidence.

## Deferred processing-model tails

HTML [§8.1.7.3](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)
has distinct remaining consumers:

The 2026-09-15 audit covered §§8.1.7.1–8.1.7.5 at HTML source
`24c5e48bf66ea61bc199ec6338c81258275ba9c6`; these are the retained follow-ups.

| Operation | Required next boundary |
| --- | --- |
| Window idle periods | No-runnable-task path, initial render/last-idle times, timer deadlines, animation-frame maps, refresh prediction, requestIdleCallback/IdleDeadline, and removal of destroyed Windows |
| Rendering | Production owners for the ordered hooks, child-document order, style/layout/display, animation callbacks, and observation delivery |
| Performance reporting | Real owners for task/long-task and checkpoint timing hooks |
| Worker rendering/shutdown | Actual globals, closing state, queue suppression/discard, run-a-worker continuation, and teardown |
| Await a stable state | Suspend parallel work, execute its synchronous section as a microtask on the right loop, then resume; first image/media consumer |
| Spin the event loop | Concrete continuation-based suspension/resumption for parser work; a general operation needs unavailable execution-stack capture |
| Pause | Embedder-controlled blocking/UI contract, pause-duration accounting, and a real modal or synchronous consumer |
| Checkpoint tails | Rejected promises, DOM notifications, and IndexedDB cleanup; resolve the native clear's [ordering and Agent isolation](EVENT-LOOP-ARCHITECTURE.md#node-v8-checkpoint) |

Preserve a single queue for Promise jobs and HTML microtasks. Do not put a
TypeScript microtask queue beside V8's queue or claim a worker closing flag
implements shutdown. Worker/worklet Agent records alone also do not configure
V8's CanBlock or shared-memory isolation; those gates remain with the engine.

The element-task wrapper must use the element's relevant global/creation realm,
not its mutable node document after adoption. Add it with a real caller and a
cycle-safe route to existing binding ownership.

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
