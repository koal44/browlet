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
| Global state | `BrowletGlobalObject` requires the error-reporting flag, both rejected-promise collections, import map, and resolved module set. Window and the service-worker global skeleton initialize them; future worker/worklet globals must do so too. Error reporting and the translated rejection algorithms consume their state; engine rejection delivery and import-map processing remain unwired. |
| Realm creation | `createBrowletRealm()` and production Window composition share `BrowletRealm.initialize()`: bracket global creation with the retained context, pop it, then remove SharedArrayBuffer when required. The ordinary factory accepts omitted customizations and returns the retained context. |
| Retained context | `BrowletRealm.executionContext` is stable for the realm's lifetime. Environment settings return that same record. The existing VM context and `env.exec` facilities are separate. |
| Entry | `entryExecutionContext` selects the most recently pushed retained realm context, including a nested HTML entry. Its `.realm` supplies entry realm, `.realm.env` entry settings, and `.realm.globalObject` entry global. Missing entry context throws. |
| Incumbent | The topmost non-null ScriptOrModule and its skip counter select script settings or the backup stack; missing backup settings throw. Callback preparation/cleanup maintain the counter and backup settings. Callback capture uses its binding environment for direct Node-host calls when both modeled stacks are empty; that accommodation stays outside the specification lookup. |
| Current | `runningExecutionContext.realm` gives the top modeled realm; that realm's `.env` and `.globalObject` supply current settings and global. It is only current for the transitions recorded in this stack; arbitrary author/built-in calls do not yet maintain it. |
| Relevant | A platform object's `PlatformRecord.realm` supplies its relevant realm independently of the stack; that realm's `.env` and `.globalObject` supply relevant settings and global. The binding records ownership, so changing the object's prototype does not change it. |

`JSScriptOrModule` carries the realm and HTML host-defined script. Complete
Script/Module records and active-script restoration remain §§8.1.4 and 8.1.6
work; the temporary record in `runScriptEvaluation()` has null `script`
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

The entry/incumbent/current/relevant audit stops before §8.1.3.4, audited separately
below. Broader consumer regressions can follow when
[Window messaging](../communication/ROADMAP.md) exists.

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

`UserAgent.webDriver` now contains BiDi's create/prepare/ScriptEvaluation command
sequence, stopping at explicit unfinished dependencies. `JSScriptRecord.evaluate()`
is the retained-record execution boundary; it throws rather than recompiling source.
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
| Retained execution | `JSScriptRecord.evaluate()` still throws. `JSModuleRecord.evaluate()` now supplies an explicit throwing boundary for linked graph execution, dependencies, top-level await, and context restoration. |
| Runtime errors | The run algorithms invoke `env.reportException`; §8.1.4.6 now supplies ErrorEvent dispatch, cancellation, and muting. Classic runners retain their script explicitly for parse errors and unwound evaluation. Source attribution and worker propagation remain unfinished. |
| Termination | A null evaluation outcome selects the specified QuotaExceededError completion/rejected promise. Binding allocates that exception in the script's realm. Actual termination and unwinding remain §8.1.4.5/runtime work. |

**Approved provisional activity check:** an active child Document now passes
`isFullyActive()` until Section 7 supplies the actual container-document association
and recursive ancestor checks. A Document with no browsing context or one that is
not its navigable's active entry still fails. Do not use `parent.activeDocument` as
a substitute for the embedding element's node document. This affects every existing
consumer of `isFullyActive`, including task/timer eligibility, not just scripts.

**Representation review:** the evaluation boundaries use null for termination
without a completion/promise; ordinary author exceptions remain throw completions
or promise rejections. The current runner branch assumes the retained realm context
is present for HTML's cleanup. Actual termination and modeled-state reconciliation
remain the §8.1.4.5 dependency below. BiDi has an explicit unfinished termination branch.
`emptyCompletionValue` distinguishes ECMAScript's empty from JavaScript undefined.
The module operation uses the established InternalPromise contract.

[Calling tests](../../../test/browlet/scripting/script-calling.test.ts) exercise
real script creation, settings, task preparation, cleanup, and realm-owned exception
allocation. They replace only the unfinished record evaluation and error reporter
to inspect those handoffs. They do not prove executable compiled code, module
graphs, termination, or browser error events. The child-document expectation was
observed failing before applying the approved provisional behavior. No new skipped
or expected-failure tests were introduced.

Script-element/worker startup still needs production callers for these runners.

## HTML §8.1.4.5 killing scripts

`Agent.abortRunningScript()` names the operation on the execution owner, shared
by its realms. It explicitly throws an InternalError until runtime termination
is available. That throw reports an unfinished implementation; it is not the
specified abortion. No callers are wired to claim successful termination.

**Decision:** retain direct synchronous host access on Node's JavaScript thread
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
| Unhandled exception | Cancellation suppresses console reporting. Otherwise log the original exception to the Node console, the permitted developer sink. Dedicated-worker propagation has an explicit throwing boundary instead. |
| Dedicated-worker propagation | Still needs the associated Worker object, its relevant global, DOM-manipulation task delivery, and implicit-port disentanglement state. The task must fire an event without the error value, then recursively report an unhandled exception with `omitError=true`. Continue through terminated/collected parents while suppressing handlers as specified. |
| `reportError()` | Window calls its environment's reporter directly. Binding supplies the required argument and receiver ownership. Worker exposure awaits concrete worker globals. |
| ErrorEvent | DOM event implementation and HTML IDL contribution provide the five attributes and constructor dictionary. An omitted `error` starts as undefined, unlike the explicit null used for muting/omission. |

**Representation review:** extraction returns a typed attribute record in place
of the specification's ordered map keyed by IDL attributes; its `SPEC_MISMATCH`
marker remains pending review. Reporting through the global's environment is an
accepted ownership translation. The additional final script argument is retained:
`ClassicScript.run()` already reports before our cleanup pops the realm context,
but that context's `scriptOrModule` is null, and a parse failure has no script
record to push. Keeping the argument preserves muting without inventing a parsed
record for a failed parse. Other callers default to the modeled running script.
Revisit the explicit runner argument when retained-record evaluation supplies
script contexts and their lifetime. This is a boundary in Browlet's current
implementation, not a conclusion about which frames V8 retains.

**SPEC_CLASH(report-error-muting):** follow the written
[reportError algorithm](https://html.spec.whatwg.org/multipage/webappapis.html#dom-reporterror),
including classic-script muting. Its note reports that Firefox does not mute,
whereas Chrome and Safari do. Eric approved following the algorithm on
2026-10-26. This records the specification's browser evidence, not a new browser
comparison performed by this audit.

Window's special five-argument `onerror` callback and return-true cancellation
remain §8.1.8.1 work. `addEventListener('error', ...)` and `preventDefault()` work
through existing DOM dispatch. Source-location extraction, complete active-script
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
the modeled running script when present. Neither currently receives automatic
engine notifications. Global state remains on the global implementation.

| Requirement | Implementation or explicit dependency |
| --- | --- |
| Rejection notification | Clone and clear the pending list, then queue a DOM-manipulation task for the global. Skip handled promises, fire a trusted cancelable `unhandledrejection`, optionally report an uncanceled reason to the console, and retain still-unhandled promises in the weak set. Recheck handled state after listeners run. |
| HostPromiseRejectionTracker | Ignore a muted running classic script; otherwise select its settings or the current settings. Reject appends to the pending list. Handle removes an unnotified promise, or removes a previously reported promise from the weak set and queues a noncancelable `rejectionhandled` event. The native notification entry remains unwired in `installHostHooks()`. |
| PromiseRejectionEvent | The DOM event implementation and HTML IDL declarations expose `promise` as an opaque object and `reason` as any. Constructor conversion requires an object-valued promise but deliberately does not adopt thenables or require an actual Promise. Omitted reason is undefined. |
| Engine slot reads | `isPromiseHandled()` and `getPromiseResult()` explicitly throw until JS Engine provides non-observing reads. Attaching a reaction to learn the result would itself change handled state. |
| Checkpoint integration | §8.1.7.3 requires notification for each settings object's global served by the loop. That enumeration and the production caller remain explicit TODOs; no new environment registry is introduced for this slice. |
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
The native dependency is the stopping point for this audit; no addon changes
are part of this slice. Window and WorkerGlobalScope inherit EventTarget;
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
| Parse an import map string | `ImportMap.parse()` calls `env.exec.parseJSONStringToInfra()`, validates object shapes, and normalizes imports, scopes, and integrity. |
| Normalize keys, specifier maps, scopes, and integrity | Private helpers preserve URL alias behavior, use descending code-unit ordering, and distinguish ignored entries from null entries that block resolution. Integrity keys compare by URL value. |
| Merge module specifier maps / import maps | `global.mergeImportMap()` forwards to the shared body. Earlier definitions win, including null blocks. Copies of incoming mappings are filtered against completed resolutions; the existing global ImportMap object is retained. |

Infra retains the [JSON value types and realm-independent conversion](../../infra/json.ts).
The §6 string and object-conversion algorithms live on [JSRealm](../../js-engine/realm.ts)
and are exposed through `env.exec`, preserving realm-owned SyntaxErrors. The four
[JSON-byte algorithms on BrowletEnvironment](../environment.ts) combine Encoding's
UTF-8 primitives with those string operations through `this.exec`. Fetch calls
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
- §8.1.6 module hooks must call the resolver for static/dynamic dependencies and
  `import.meta.resolve`. Module parser, dependency loading, linking, and engine
  evaluation remain separate unfinished boundaries; no addon changes were made.
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

## Present

| Source | Current responsibility |
| --- | --- |
| `agents.ts` | Agent/cluster records, Window inventory, one EventLoop per Agent, observer creation counters, and batched MutationObserver/slot-change notification |
| `realm.ts` | Relevant/incumbent ownership and controlled script/callback entry; environment bases and full browser settings live in [`../environment.ts`](../environment.ts) |
| `execution-context.ts`, `script.ts` | Explicit contexts, HTML script state/creation, compiled classic records, synthetic export inputs, ModuleRequests, and module-parser boundaries |
| `script-fetch-options.ts`, `script-fetching.ts`, `module-map.ts` | Fetch options, classic/worker/single-module fetching, document/worker/worklet module-graph orchestration, and cached results/pending callbacks; the environment forwards fetch calls and owns integrity lookup/type permission |
| [`../worklets/module-responses-map.ts`](../worklets/module-responses-map.ts) | Downloaded responses and pending notifications shared across a Worklet's globals; separate from their per-environment module maps |
| `global-object.ts`, `import-map.ts` | Shared HTML global state, import-map parsing/normalization/merging, module specifier resolution, and parse-result creation; Window owns registration |
| [`../environment.ts`](../environment.ts), [`../dom/events/error-event.ts`](../dom/events/error-event.ts) | Global exception reporting and ErrorEvent; the realm callback and global-scope operation delegate to the environment |
| `event-loop.ts`, `tasks.ts` | Task records, source/queue associations, fully-active gating, deterministic turns, checkpoints, incumbent stack, timing hooks, and coalesced wake-ups |
| `host-hooks.ts` | Custom-engine make/call hooks plus Promise, generic, and timeout job delivery |
| [`../global-scope.ts`](../global-scope.ts), `timers.ts` | Higher-level global API composition; lower-level active-time waits and Window function timers |
| `rendering-opportunity.ts` | Independent opportunity producer, Document render-blocking filter, and ordered rendering pipeline seams |
| `speculation-rules.ts` | Parse-result creation and an empty-only rule-set record with an explicit parser boundary; Document owns registered sets and Window owns registration/removal/replacement |
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
The HTML run algorithms consume the same predicate through `canRunScript`;
script-element preparation and the parser still need integration. Existing direct
evaluation and automation do not acquire this gate automatically.

## Remaining implementation

| Owner | Missing contract |
| --- | --- |
| Script records/classic scripts | Retained compiled execution, production fetch/run callers, script-context restoration, worker-imported synchronous pause, timing, and runtime errors |
| Module scripts/maps | Engine parse/load/link/evaluate, import attributes, dynamic import, host hooks, and script-element callers; HTML fetch/run orchestration and import-map algorithms are present |
| Error reporting | Source locations, complete script attribution, dedicated-worker propagation, native rejection notifications/slot queries, and checkpoint notification integration |
| Event handlers | Content-attribute compilation, Window/body/frameset targeting, global handler mixins, and special error/beforeunload behavior |
| DOM checkpoint consumers | Custom-element reactions; MutationObserver and signal-slot delivery already use the existing checkpoint |
| Task routing/lifecycle | Element-task wrapper using the relevant global, worker restrictions, and complete loop teardown |
| Global utilities/timers | Origin/base64/image APIs and isolation exposure; worker suspension; handler timing; TrustedScript/CSP/classic-script string timers |
| Rendering/idle | AnimationFrameProvider, real rendering hooks, idle callbacks, deadlines, and lifecycle cleanup |
| Workers/worklets | Real globals/settings, production callers of Agent allocation, execution readiness, termination, and engine enforcement |

Secure-context exposure, structured cloning, Fetch, reportError, and function timers already
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
   callback preparation/cleanup, task settings sets, empty-stack checkpoints,
   ErrorEvent dispatch, and muting. Complete active-script/source provenance and
   dedicated-worker propagation with their consumers. Forced termination stays deferred.
3. **Rejected promises (§8.1.4.7).** The HTML tracker, notification tasks, and
   PromiseRejectionEvent are translated. Connect the rejection engine hook,
   non-observing slot reads, and checkpoint environment enumeration. Node's
   process-wide events cannot supply that ownership.
4. **Modules/import maps (§8.1.4.8 and §§8.1.5–8.1.6).** Build on the module map
   and single-module fetchers with graph loading, engine linking/evaluation,
   and dynamic-import hooks. Import-map parsing, merging, resolution, parse
   results, and Window registration are translated; connect script-element
   callers and module hooks to them.
5. **Speculation rules (§8.1.4.9).** Creation/error capture and Window registration,
   removal, and replacement are translated. Complete the §7.6 rule model/parser
   and Document's speculative-load processing, then connect §4.12.1 script
   preparation, execution, and removal. The current rule set is empty-only.

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
