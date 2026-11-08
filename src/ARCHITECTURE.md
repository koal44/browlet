# Project architecture

This is the shared model for Browlet, Stylelet, Selectlet, and their supporting
subsystems. [PRIORITY.md](PRIORITY.md) orders the work;
[LIMITATIONS.md](LIMITATIONS.md) records observable runtime and integration
limits. Subsystem READMEs explain current contracts, and roadmaps retain
unfinished work. Detailed binding mechanics belong in [Web IDL](web-idl/README.md).

## Implementation, Binding, and Platform

| Role | Responsibility |
| --- | --- |
| Implementation | Specification state, internal relationships, and algorithms |
| Binding | Author conversion, receiver checks, callbacks, realm selection, exceptions, and projection |
| Platform | Realm-owned JavaScript objects exposed to authors |

An ordinary interface has two identities: `FooImpl` and its platform `Foo`.
Binding **projects** an implementation to its platform object and **unwraps** a
platform object to its implementation. Internal relationships use implementations
and other post-conversion values; they do not project and immediately unwrap
objects to call an internal operation.

WebAssembly Module follows this ordinary split: `WasmModuleImpl` holds a private
native Module; its platform Module has the generated constructor and static
methods. Those methods unwrap their Module argument and invoke instance methods
on the implementation. Compilation and cloning wrap native results before
ordinary projection, so every exposed Module has a known owner on all backends.
The native engine object and prototype stay private. ESM's intrinsic inheritance
and source-kind getter are composed separately in Browlet's binding integration.

All WebAssembly interfaces have separate implementations with private native
backing objects. Ordinary Binding installs their constructors, accessors, and
operations. Exception's dedicated binding uses the native exception as its platform
object and installs generated members on V8's original prototype, preserving
native throws, tagged catches, and traced stacks. Only Exception member entries
associate engine-created receivers; generic record lookup does not adopt them.
Stock Node uses a temporary receiver when exact creation-realm ownership is
unavailable. See the
[WebAssembly migration notes](browlet/webassembly/ROADMAP.md#implementationplatform-migration).

`getPlatformRecord(value, source)` only reads an existing association, with the source
selecting implementation, platform, declared proxy, or either direct stamp.
Normal construction and projection establish records; lookup does not adopt
unrecognized native objects or guess their creation realms.

Module deserialization wraps a fresh engine allocation in WasmModuleImpl and
projects it in the destination binding. HTML's Module graph record still owns
storage and AgentCluster restrictions and keeps compiled-code reuse private.
Compilation observes the private native result and resolves its typed public
Promise on the required task source.

Declared proxy values such as WindowProxy use an implementation handle internally.
Their binding declaration supplies `getHandle()` and `getProxy()` to convert
between public proxies and their retained handles. Receiver resolution selects
the handle's current platform target at invocation; retaining a handle does not
freeze that target.
Stock Node's WindowProxy handle also recognizes the exact VM globals associated
with it as receiver aliases for its public proxy. Weak identities remain valid
across navigation; arbitrary receivers keep their identity, including objects
inheriting from Window. This is the `node-vm-global-proxy` accommodation, not
caller-realm selection.
Native globals receive indexed descriptors, mutation rules, and keys at Window composition through
`JSRealm.setGlobalIndexedProperties()`. Both backends use Window's child lookup and
WindowProxy's descriptor helper. Native ordinary properties live in V8's actual
per-context global; a stable host view reflects into that store after proxy reuse.
Ordinary author accessors receive V8's original receiver. Binding registers global
attribute getters through `GlobalObjectAllocation.registerAttributeGetter`, without
replacing their functions. A retired context uses its original host view for bare
IDL attribute access; explicit public-proxy access selects the replacement Window.
Each indexed delegate likewise retains its original Window. Native Window contexts
receive global access checks with distinct security tokens. HTML supplies the
requested layout and WindowProxy policy; JS Engine selects the backend, reuses
native globals, and installs access checks without HTML inspecting addon exports.
JS Engine resolves the native accessing realm; HTML's WindowProxy binding supplies
the origin policy and foreign property view. Native ordinary access keeps V8's store and receivers.
Untyped `any` and `object` values keep their JavaScript representation.

Interface bindings can register outward projection through
`prepareProjectionOverride`. Each platform record captures its actual interface's
steps once; all outward projection uses its `project()` operation, including
typed results, callback receivers, and a Window returned as EventTarget.
HTML's Window integration exposes the public WindowProxy while it still selects
that Window, including after removal, and null after replacement, following Chromium.
The paired platform object remains the original Window property store for
installation, receiver ownership, and reflection.

One private binding record connects those identities without changing the
implementation's class prototype. Its `BindingWorld` supplies the identity
scope; its realm binding supplies prototypes and member functions. Browlet's
composition root owns one main world spanning its hosted realms. HTML Agents
own execution and event loops; AgentClusters define shared-memory boundaries.
Neither is the owner of platform-object identity. Separate worlds need a real
isolated-world or separate-runtime consumer.

Each registered realm has one `RealmBinding`. `BindingContext` is its public type,
exposing boundary operations without adding another object or lifecycle.

Web IDL Core owns complete declarations. Their constructor, accessor, operation,
and callback-adapter steps receive the specified environment, with converted
arguments and implementation receivers. Binding selects the environment and owns
conversion and projection. Reflection and HTML construction use composition-time
binding adapters selected by declarative annotations; declarations themselves
do not receive BindingContext.
Lazy Window and HTML/SVG/MathML element handlers use a composition-supplied
`WindowEnvironment.createEventHandler` factory. HTML selects the current node
Document and form owner, and owns raw source, policy, and caching. Binding
projects the Document/form/element scopes; JSRealm compiles in that Document's
realm. The factory supplies its own environment when creating the declared callback.
Implementations do not receive a Binding Context or perform author conversion.
Callback values retain a `WebIDLEnvironment | null`: the captured incumbent
environment, or null for an unbound host. Internal sandboxes skip HTML callback
bookkeeping without using their realm as an absence marker. Browser callbacks
still require an attached environment and the correct owning event loop.

FrozenArray attribute types automatically select list projection. Binding retains
each projected snapshot in the receiver's realm; arrays already created by Web
IDL preserve their identity and original realm.

Member overrides receive `{ relevant, callee, incumbent }` first, followed by
converted values. `relevant` owns the receiver; `callee` owns the invoked callable.
Constructors, static members and namespace members use the callee for both.
Overrides request capture with `overrideCapturesIncumbent: true`. Binding captures
before conversion and performs the host lookup afterward; a standalone host can
supply no incumbent. Without that flag, the override's `incumbent` is undefined
and Binding avoids the native-entry and lookup cost. Both accessors share the flag.
Ordinary implementation methods request only their necessary
dependencies through injected arguments. A resolver with a third positional
parameter requests the incumbent; callback conversions (including constructors)
and forwarding targets
also derive that requirement. Wasm retains the injected incumbent while its
opaque import object is processed, including after asynchronous compilation.
Location's bindings select entry and incumbent inputs separately before calling
its implementation.
Direct incumbent lookup stays in the lint-allowlisted composition, Binding, and
callback-lifecycle modules. Injected argument resolver parameters through the incumbent
cannot have defaults or rest syntax, because those inputs still use declared arity.

Specification-owned platform creation uses `preparePlatformObject` at the same
composition boundary. Web IDL installs the own members first; HTML can then add
Location's conversion safeguards or return an exotic object. Binding attaches
identity only to the final object. Implementations do not retain the allocation
or its binding context.

HTML's `CrossOriginObjectBinding` lives at the same integration boundary and owns
cross-origin descriptors. The current proof of concept uses interface
`[CrossOriginObject]` and member `[CrossOrigin]` annotations to select its objects
and permissions. `htmlExtendedAttributeHooks.prepareSecurityCheck` prepares each
protected interface's invocation policy once when the binding world is assembled.
Permission records and Window-name lookup share the assembled declarations,
including their partials and mixins. The same caller binding owns COOP access-report
eligibility: it filters names through those declarations and reads the supplied
browsing contexts' active ancestry. Policy owns the report dispatcher, whose input
record retains the selected document and top-level context state. Caller-bound
WindowProxy Get/Set run this check before property access. Native foreign access
selects those operations automatically; same-origin V8 access bypasses them and
still needs COOP reporting integration. Report delivery remains unfinished.
The caller binding's WindowProxy operations take
the stable proxy handle and resolve its current Window. Lookup reuses Window's
child-name selection; definition checks origin and rejects numeric indices before
ordinary definition. Get evaluates the selected descriptor and follows the Window
prototype for missing same-origin properties, preserving the supplied receiver.
Set rejects same-origin indices before ordinary Window assignment; foreign writes
require a setter in the caller-selected proxy descriptor.
Delete rejects foreign callers, protects present child indices, and uses ordinary
Window deletion for other same-origin properties.
OwnPropertyKeys prefixes current child-index strings to ordinary Window keys or
the declared cross-origin keys. It preserves list concatenation; the stock Proxy
trap retains its duplicate-key accommodation.
Native global access checks select the caller before entering host code, using
the same realm references as Location. HTML keeps its caller binding and applies
the chosen Chromium foreign-receiver and mutation rules. The native addon owns
one failed-access callback per isolate; context extras retain each selector, with
no global registry of Windows. Only the exact composition context has a host
exemption. Stock Node still lacks automatic caller selection. Descriptor
accommodation for JavaScript Proxy invariants belongs at its proxy trap.
Location's creation hook retains one ordinary property store and attaches the
platform record only to its final exotic object. Native Proxy-handler lookup
captures the accessing realm before entering JavaScript; the binding selects that
realm's existing context through its BindingWorld. HTML's caller-bound algorithms
take the public Location and its ordinary storage separately, avoiding recursive
descriptor lookup. Captured caller-realm Reflect operations preserve the realm
through inherited lookup and receiver definition. The Proxy's private native
target exposes the same descriptor/key view for invariant checking, without
copying or owning author properties. This supports foreign visibility of frozen
defaults while preserving exact receivers. Allocation uses a retained intrinsic
prototype as its realm anchor, so lazy projection also works after navigation
detaches the old context. Stock Node retains its explicit caller/visibility gap.
Realm supplies allocation and execution
facilities; the invoking member's binding selects the actual receiver's security
policy, including when the member is inherited from an unprotected interface.
`BindingContext.createMemberFunction()` creates fresh declared IDL
behavior in that binding's realm; HTML retains each function's identity for the
caller/target pair. Window and Location implementations do not receive Binding
Context. Their full exotic access paths remain in the
[Window roadmap](browlet/browsing/window/ROADMAP.md#html-721-cross-origin-objects).

HTML's `HTMLAllCollection` declares `documentAll: true` because a JavaScript
Proxy cannot preserve `[[IsHTMLDDA]]`. JS Engine allocates the undetectable callable;
Web IDL's `HTMLAllCollectionBinding` uses the declared `item` operation for call
conversion and implementation dispatch, and adapts the shared indexed/named property
algorithms to native handlers. HTML owns collection lookup. Ordinary properties remain on the native object so V8
preserves accessor receivers. The [nodes roadmap](browlet/dom/nodes/ROADMAP.md#htmlallcollection)
records the unsupported-backend policy and remaining enumeration-order clash.
JS Engine's `isObject` and `isCallable` operations recognize this exceptional
object wherever a runtime value needs classification. Recognition stays inside
these shared predicates and never creates a temporary Proxy. Web IDL uses the
same operations for conversion, callbacks and coercion.

Binding applies a private DOMException stamp during platform-object initialization
so Core can recognize exceptions without importing Binding's identity record.
The shared record still owns the implementation/platform association and realm.
DOMException failures use that implementation directly; Binding projects a fresh
exception in the selected invocation or delivery realm and reuses an existing
record on later delivery. Infra's ordinary JavaScript error requests retain
their separate realization mechanism.

Type implementation parameters for the values Binding actually supplies:
concrete implementations, converted dictionaries with defaults, and adapted
callbacks. Genuine Web IDL `object`/`any` and host-neutral DOM contracts remain
appropriate where specified. Do not widen an implementation to an ambient DOM
interface merely to make a direct test resemble author code.
Implementation classes need not satisfy their platform interfaces in `lib.dom`;
check author-facing types at the projected API boundary.

Source projects use the ECMAScript libraries without `lib.dom`. Define and import
implementation value types in their owning subsystem. Test and WPT projects
explicitly include DOM declarations to type author code; source projects retain
their separate compiler configurations.

## Environments and execution

The current convention passes the owning **environment**, named `env`, to an
implementation. It replaces the old practice of passing RuntimeContext or
Binding Context through implementation algorithms. The contracts are structural
views of existing owners, not a new environment object for each subsystem.
Stylelet resource operations put `env` before callbacks so inline response
handling can remain at the end of the call.

| Contract or class | What it supplies |
| --- | --- |
| [`StorageEnvironmentBase`](storage/environment.ts) | UserAgent, creation URL, and an origin when available; usable before realm creation |
| [`StorageEnvironment`](storage/environment.ts) | Full owner with realm, promises, storage maps, permission requests, and task delivery; HTML resolves session ownership and the destination global's event loop |
| [`PermissionEnvironment`](permissions/environment.ts) | One Permissions owner, policy/activity answers, descriptor conversion, result allocation, and task delivery |
| [`FetchEnvironmentBase`](fetch/environment.ts) | Extends the Storage view with top-level partition inputs and `determineNetworkPartitionKey()` |
| HTML [`BrowletEnvironmentBase`](browlet/environment/environment.ts) | Shared browser state before and after realm creation: identity, owner, creation/security state, readiness, and partition derivation |
| [`JSEnvironment`](js-engine/environment.ts) | `realm: JSRealm`, `InternalPromise`, background work, and task delivery for an existing owner |
| [`TimingEnvironment`](timing/environment.ts) | Time origin, isolation policy, and clock conversions exposed directly by the existing owner |
| [`StreamsEnvironment`](streams/environment.ts) | Extends JSEnvironment with DOM abort creation and HTML structured-data operations |
| [`FileEnvironment`](file/environment.ts) | Extends the Streams view with native line endings for Blob text processing |
| [`DOMEnvironment`](browlet/dom/environment.ts) | `realm: DOMRealm` for event behavior and the associated-document query; its Window specialization exposes the Agent's DOM notification state; `createEvent()` supplies event allocation |
| [`FetchEnvironment`](fetch/environment.ts) | Extends FetchEnvironmentBase and FileEnvironment with Fetch task delivery, exception allocation, and client settings |
| [`ScriptEnvironment`](browlet/scripting/environment.ts) | Source fetching through the actual client, locally or through the worker runtime's retained creator connection; parsing and module caching stay with the target environment |
| [`BrowletEnvironment`](browlet/environment/environment.ts) | Full browser environment; extends BrowletEnvironmentBase and satisfies JS Engine, DOM, Fetch, Scripting, Storage, Stylelet, and Selectlet contracts |
| `WindowEnvironment` | Specializes BrowletEnvironment with its Window and live queries of the associated Document |
| `SandboxEnvironment` | Implements the same binding contract for internal execution; unavailable browser client settings throw explicitly |

UserAgent owns `StoragePersistence` alongside its local storage shed. Persistence
decisions are keyed by security origin, independently of bucket lifetime and
storage partitioning; revocation updates retained buckets without requiring a live realm.

`UserAgent.permissionStore` owns the general [Permissions store](permissions/ROADMAP.md).
The user agent supplies `PermissionFeature` instances once; the store selects
comparison rules by descriptor name. Each feature owns its key rules, defaults,
query algorithm, and revocation cleanup. The environment's `PermissionsImpl`
owns state lookup, requests, and choosing options. Its single environment contract
supplies policy and activity answers; HTML resolves the associated Document.
State lookup applies secure-context and applicable policy checks before reading
the store. Missing entries use the feature default and
constraints; lookup does not prompt or mutate decisions. Storage's consent API
uses the same store and preserves requesting-origin scope. Its host setter still
applies Storage revocation. `PermissionStore.revoke()` runs the installed feature
cleanup before removing its decision; UserAgent binds Storage cleanup to that
browser's persistence owner. Direct store writes/removals notify the browser to
refresh queried statuses, but do not run feature revocation cleanup.

Permission requests reuse that lookup, then ask the Node host through
`BrowletConfig.permissionPrompt` when new consent is allowed. A browser-owned
`InternalPromise` carries the answer; a separate task on the requesting global's
permissions task source records it. Feature request restrictions do not overwrite
saved origin decisions. Public permission querying uses the same state lookup;
Storage's `persist()` consumes the returned decision to protect its captured
local bucket, independently of the queued permission-store write, then reports
the bucket's mode through a storage task.

Permission choices use `BrowletConfig.permissionChooser` to select original values
from a feature's offered set. They return a selection or denial without updating
the store; feature APIs own device discovery, presentation details, and use of the
selected values. The host is consulted even for an existing permission grant.

The environment owns one `PermissionsImpl`, and Navigator returns that same
implementation. Permissions supplies the interface and Navigator partials; HTML
provides the getter on its primary implementation. Binding preserves
the object's identity and receiver realm. Querying converts descriptors through
Binding, creates a fresh EventTarget-derived `PermissionStatusImpl` in the browser
integration layer, and resolves on the receiver global's permissions task source.
The invoked method's environment supplies current settings and result allocation.
UserAgent weakly tracks status results; each global strongly retains those with
change listeners. Updates reuse the feature query algorithm, suppress inactive
Documents, and queue trusted change events on the result's global. Document
reactivation rechecks its results. WorkerNavigator integration and non-store
invalidation from unfinished Permissions Policy/feature APIs remain pending.

`UserAgent.setPermission()` forwards automation to `PermissionStore.setPermission()`
with a resolved key and explicit candidate environments. Matching globals queue
permission tasks; the shared store applies
the decision and feature cleanup once, and HostPromise completion waits for all
target tasks. Without a matching global, the same store records the decision
immediately for future environments. WebDriver session lookup, input conversion,
environment enumeration, and cancellation remain separate dependencies.

[`BrowletRealm`](browlet/scripting/realm.ts) extends `JSRealm` with HTML ownership,
callback lifecycle, and task routing; `WindowRealm` specializes it for a Window global.

The HTML base requires no realm or realm-dependent facilities. A reserved navigation client can use it
for partitioning and security before full settings exist. BrowletEnvironment
inherits the class and preserves the reservation's identity and security
classification; it is not a wrapper around a second settings object.

`Base` names the shared contract; `reservedEnv` and `reservedClient` name a
destination's role during loading. Keep those role names: Fetch's reserved
client can be a base environment for navigation or a full environment for a worker.

Interfaces do not provide method implementations. Shared browser behavior such
as `determineNetworkPartitionKey()` lives directly on HTML's BrowletEnvironmentBase.
Portable contracts describe that behavior without making Fetch depend on HTML.
Use the same approach for other owners; introduce inheritance or a mixin only
for an actual shared implementation, not to simulate multiple class inheritance.

HTML origin extraction is `BrowletEnvironment.extractOrigin(value)`, invoked on
the entry environment for global access checks. `Origin.from()` selects that
environment through the modeled execution stack, then retains its specified
string parsing and result allocation. Each object's owner supplies its extraction rule.

HTML's script-fetch algorithms are grouped in `browlet/scripting/script-fetching.ts`.
BrowletEnvironment forwards its fetch methods there with itself as the target
settings. Its module map, integrity lookup, and realm-specific permissions remain
environment-owned; the separate fetch client is retained where HTML requires it.
Worklet graph fetching receives a caller-owned shared response map from `worklets/`.
That map retains downloaded bytes across globals; each environment's module map
still owns its separate script records. Pending response reuse resumes on the
waiting environment's networking task queue.

Module specifier resolution is an environment method, with its algorithm body
kept in `scripting/import-map.ts`. A global's `mergeImportMap()` method likewise
forwards to that module, operating on its import map and resolved-module set.
Private normalization helpers stay beside the map parser; globals gain no
additional Web IDL surface from these implementation methods.

Window opening follows the same arrangement: the Window binding selects the
entry environment and calls `env.openWindow()`. Its algorithm body and private
feature helpers remain in `browsing/window/opening.ts` while navigation ownership
is completed. Navigable owns target selection and navigation, Document owns
URL/history updates, and BrowsingContext owns feature setup.

### Realm execution

`BrowletEnvironment` retains internal Promise creation, task delivery, and
binding-owned allocations directly on `env`. Realm-owned operations are accessed
directly through `env.realm`: captured intrinsics, buffer allocation, JSON string
operations, and the live global object. There is no separate execution-facilities
object or interface hierarchy. HTML's modeled execution-context records remain
independent of these facilities.

[`JSExecutionContext`](browlet/scripting/execution-context.ts) separately models
the record used by HTML: realm, function, ScriptOrModule, and the incumbent skip
counter. Each `BrowletRealm` retains one context; the environment's
`realmExecutionContext` query returns it. EventLoop owns the agent's modeled
stack and backup incumbent stack. Controlled script entries push the retained
context followed by a script context. This does not intercept arbitrary author
function calls. Incumbent-sensitive platform bindings can opt into native entry
capture. A `JSExecutionContext` scopes that observation on the same stack with
the method's current realm and the observed `incumbentEnv`, but no
ScriptOrModule. It leaves retained entry selection and active-script provenance
unchanged; callback skipping applies to the observation as well as script records.
`Window.postMessage()` is the first consumer. JobCallback records retain
incumbent settings plus a fresh context for the active script. The addon resolves
its compilation metadata to retained VM code, and `JSScriptOrModule` owns the weak
association from that code to its HTML record. Absent metadata uses the modeled
stack; foreign/unassociated code does not inherit its script. Make/call hooks
restore the captured context across invocation and unwind it on return or throw.
Other binding surfaces and complete script provenance remain separate work.
The A-to-B callback-registration investigation is skipped pending
review of its observer and translation of HTML's examples; see the
[audit record](browlet/scripting/ROADMAP.md#html-8133-explicit-context-experiment).
There is no native interception of arbitrary author frames.

`UserAgent.webDriver` owns the remote-end command algorithms. BiDi script completion
uses `InternalPromise` through `UserAgent.HostPromise`. HTML's classic Set RPH
Registration Mode command instead takes decoded JSON and an explicit session,
then returns synchronous success/error records. Its session-admission check
precedes HTML's parameter validation; current-context lookup follows validation.
Both remain throwing dependencies, with HTTP routing and session lifecycle still
unimplemented. `PageEvaluation` owns Browlet's Node convenience API above the
driver boundary. Its existing local source evaluator remains in use until the
driver's Await operation, protocol values, and target/session lifecycles are
connected. Retained classic execution now runs
through JSRealm on both stock and addon contexts. Navigation currently notifies
the local evaluation clients through a UserAgent-owned weak map; cancellation and
Node callback reinstallation are convenience behavior, not BiDi events. The
[automation boundary](browlet/automation/README.md) records this temporary path and
the explicit driver dependencies; there is no fallback from failed driver commands.

HTML's per-global scripting state belongs to global implementations, described
by [`BrowletGlobalObject`](browlet/scripting/global-object.ts). Window initializes
it directly without changing EventTarget inheritance or projecting internal
fields onto the author-facing object. Worker/worklet global implementations must
provide the same state. Settings expose the module map: Window settings select
the current Document's map, and worker settings must select WorkerGlobalScope's
map. Import maps are a separate per-global record. `env.globalImplementation` selects that internal
global state; `env.global` remains the platform global used for author execution
and task routing. Neither lookup copies state or moves it onto the environment.

HTML's source-text, synthetic, and Wasm module records retain Node-shaped module
objects, supplied by Node or the addon; Wasm requires the addon extension and
the addon's native handles remain private.
JSRealm compiles, inspects requests, links supplied dependencies, evaluates, and
reads namespaces; V8 owns bindings, cycles, and top-level await. HTML converts
the native completion Promise through `env.InternalPromise`. CSS module creation
uses the environment's binding-supplied `project()` before retaining
the author-visible export. This does not change Stylelet's host-neutral state.
Import metadata uses Node's lazy `initializeImportMeta` callback, installed during
HTML source-text compilation. The initializer retains the exact HTML module
record and installs its `HostGetImportMetaProperties` results; its realm-owned
resolver uses that module's environment and base URL, without active-script lookup.
`module-loading.ts` owns HTML's `HostLoadImportedModule` and supported-attribute
policy. Static traversal calls it directly; the realm's installed dynamic-import
callbacks reach the same operation. `host-hooks.ts` owns engine callback installation
and its callback implementations. Loading uses the existing specifier resolver,
module map, and script fetchers. A modeled graph traversal
owns pending visits and cycles separately from HTML's fetch state; successful
loading supplies the dependency associations to the engine's linker. Completion
uses `env.InternalPromise`. Dynamic import uses the same hook with absent HTML
fetch state. Node-shaped compilation callbacks retain the exact classic/module
record; context and direct-evaluation callbacks supply the realm referrer.
ContinueDynamicImport loads descendants, links, and waits for evaluation through
internal promises. Only the Node callback boundary returns a native Promise for
the evaluated engine Module; Node converts it to a namespace and resolves the
author's import Promise. This avoids adopting a namespace's exported `then` twice.
Module-specific context/async restoration remains a separate dependency.

Wasm parsing retains the addon's source object, external requests, and HTML script
association. The bridge's optional `createInstance` callback enters that exact
Wasm record while applying the existing `WasmModuleImpl.createInstance()` import
adapter. This scopes callback capture, start, and result conversion at the known
instantiation entry, including after awaited dependencies. It does not supply
general native module-entry or asynchronous provenance hooks. Source-phase URL
loading is connected; deferred loading and source-object-to-record lookup remain
separate dependencies.

The addon retains supplied dependency records after linking so a Wasm consumer
can find the original native Global through JavaScript re-exports, including
previously linked barrels. It compares V8 binding identities using an isolated,
version-guarded private-layout hack; unknown engines retain the prior limitation.
This uses the existing GC-traced graph, with no context-wide registry or new HTML
binding path. Live JavaScript global bindings and v128 TDZ remain unsupported.

`BrowletEnvironment.reportException()` combines that global's reporting flag with
DOM ErrorEvent dispatch. The realm's existing reporting callback and Window's
`reportError()` method forward directly to it. ErrorEvent lives beside the
other DOM events; the environment owns its allocation and dispatch rather than
the scripting reporter. Classic runners report before their modeled realm
context is popped,
but that context has no script; parse failures also have no script record.
They therefore pass their script explicitly. Other callers use the modeled
running-script lookup. An unattached browser realm rejects reporting with an
InternalError; internal sandboxes deliberately retain console-only diagnostics.

Rejected-promise state also stays on each global. The environment's
`trackPromiseRejection()` translates HTML's rejection hook using captured
compiled-code identity, or the modeled running script when engine metadata is
absent, and current settings. The VM registry supplies this identity independently
of dynamic-import callbacks; the HTML association remains owned by scripting.
Unrecognized code does not inherit an unrelated outer script. No extra modeled
execution frame is required. `notifyAboutRejectedPromises()` schedules
the global's DOM notification task. `PromiseRejectionEvent` retains the original
promise as an IDL object, without adopting it or installing reactions. Window
composition registers the realm's native rejection hook after its environment
and global are ready. All addon bases supply reject/handle notifications and
non-observing Promise slot reads; checkpoints notify environments with pending
rejections. Internal sandboxes remain unregistered. Stock Node retains its own
reporting, with approved expected failures for the missing engine facilities.

[`JSEnvironment`](js-engine/environment.ts) declares internal Promise creation,
background scheduling, and task delivery directly on the existing environment.
It does not introduce another facilities object or execution-context record.
Captured constructors are direct realm fields, including `env.realm.NativePromise`,
`env.realm.TypeError`, and `env.realm.Uint8Array`. `realm.InternalPromise` supplies
the observation behavior extended by Binding's internal Promise constructor,
which Browlet supplies as `env.InternalPromise`. Buffer copying and transfer
remain methods on that realm. Microtask queues remain realm and event-loop
facilities. Infra's [`abort.ts`](infra/abort.ts) defines implementation-side
abort state; DOM and HTML retain abort and structured-data algorithms.

Infra §6's JSON string and object-conversion operations live on JSRealm and are
called directly through `env.realm`. They use that realm's captured intrinsics
and allocation; no JSON-specific execution contract or allocation forwarders are
needed. Infra retains `JSONValue`, `InfraValue`, and the realm-independent conversion to maps and
lists. BrowletEnvironment owns the four JSON-byte operations, combining Encoding's
UTF-8 helpers with its realm's string operations. FetchEnvironment
requires the two methods used by Body.json() and Response.json(), supplied by the
host environment. Parsed objects and errors retain the environment's realm;
serialized bytes remain internal. Neither Infra nor JS Engine depends on Encoding.
Encoding's UTF-8 helpers preserve the existing native Buffer paths and accept no
environment. TextEncoder and TextEncoderStream allocate their results through
their owning environments and fill that storage with the UTF-8 writer.

`StreamsEnvironment` extends `JSEnvironment` with abort creation and structured-data
operations. `FileEnvironment` adds `nativeLineEnding`, required by Blob processing
and supplied by the host. These interfaces describe the same existing owner.
Operations that only need
JavaScript facilities, such as releasing an existing reader, keep `JSEnvironment`.
[`createBrowletEnvironmentInit(context)`](browlet/integration/web-idl/composition.ts) supplies
construction inputs for the binding-aware Promise, DOM allocations, and structured
data. The environment assigns those functions directly; it retains neither the
initialization record nor a Binding Context. HTML scheduling and CSP reporting
are environment methods. `BrowletEnvironment` supplies `createDocument()`, `constructNode()`, and
`createAbortSignal()`. These establish binding ownership during allocation,
before a different realm can first project the result. Documents retain only
their environment and use it for descendant allocation; synchronous
HTML parsing uses the same document creation path.

Subsystem environment interfaces declare the operations they require. Web IDL
Core owns the structural `DOMExceptionConstructor` type; Fetch requires it as
`env.DOMException`. Browlet resolves that constructor lazily because interface
registration finishes after environment construction. `DOMEnvironment` requires
event allocation directly. JS Engine does not depend on Web IDL; Core does not
depend on JS Engine. Web IDL's realm and callback environment contracts remain
in its full entry point.

`FetchEnvironment` combines File/Streams facilities, Web IDL exception
construction, and `queueGlobalFetchTask(global, steps)` on the same owner.
Fetch's `queueFetchTask(steps, destination, env)` selects parallel-queue or global
delivery; HTML supplies the global route. Fetch receives the existing environment
as its execution owner; the request's optional client remains a separate selection.
The same `FetchEnvironment` contract supplies base URL, origin, policies, and
UserAgent when used as client settings. BrowletEnvironment implements it directly.
Request CSP violations use the client's `env.reportCSPViolation(policy, request)`.
Fetch treats the policy as opaque; Browlet's environment validates it and supplies
the concrete environment to CSP's violation construction and reporting.
Request-specific feature checks use `client.isPolicyFeatureEnabled(name, origin)`;
Browlet resolves the shared Permissions Policy definition and delegates to the
client's Document, including reporting, without exposing HTML types to Fetch.

Implementations use `env.realm` for realm operations and `env` directly for
environment facilities. Implementations receive no Binding Context, callback
adapter, conversion API, or projection registry. Supply lifetime
dependencies last to constructors and pass the same environment to derived
implementations. Supply an invocation-selected environment last to the operation
instead. Deserialization reconstructs values using the destination environment.
Realm-neutral backing storage such as `BlobData` needs no retained environment.

An environment may forward a useful operation such as `parseURL()` to its
UserAgent. Do not put ordinary imports behind environment properties or copy
another owner's complete API into a facade. Stylelet consumes the existing
`StyleletEnvironment` view: `userAgent.dom` supplies host DOM operations,
`userAgent.blobURLStore` supplies existing Blob URL registrations, and the environment
supplies promises and task delivery. URL parsing and text decoding are direct subsystem imports.
`getAssociatedDocument()` supplies the owning global's Document as Infra's
`DOMDocument`, or null for unbound and non-Window environments. Browlet forwards
the query to its realm; other hosts supply their own document association.
The host may supply `userAgent.systemColors`, a complete palette of absolute colors.
Browlet's configuration accepts this palette; other hosts set it on their
UserAgent. `createSystemColorPalette()` creates independent
fixed light defaults with optional entry overrides. An engine without a supplied
palette lazily retains its own defaults. No operating-system query is involved.
Palette entries are replaced, not mutated, so earlier computed snapshots retain
their colors. Per-element scheme selection and forced-color policy remain separate work.
Browlet's UserAgent and environment `parseURL()` return `URLRecord | null`, with
null as the default base. The lower-level URL parser retains validation diagnostics.
Stylelet retains records for stylesheet location and base URL. Its direct calls
to URL's parser use UTF-8 and supply the owning UserAgent for Blob URL lookup.
Hosts supply their existing Blob URL store.
Resource URLs resolve at the computed stage;
serialization formats the resulting value, retaining CSS URL modifiers separately.
CSSOM URL attributes expose strings, so these internal URLs require no platform
projection. Stylelet imports the full URL subsystem.

Stylelet's `fetchStyleResource()` imports Fetch directly and accepts the existing
owner as `StyleletEnvironment`, which extends `FetchEnvironment`.
`StyleletOptions` requires that environment; Stylelet does not construct a default
runtime or supply transport, security state, or execution on behalf of its consumer.
Fetch owns request execution, response delivery, and cancellation through its
controller. `UrlValue.applyRequestModifiers()` applies CSS request modifiers.
[DocumentImpl](browlet/dom/nodes/document.ts) owns CSSOM stylesheet header processing,
document-dependent fetching, and fetched-sheet creation. These methods use the
document's URL, origin, policies, live encoding, and quirks mode directly, with
`this.env` for execution. These facts are not inferred from the environment's
currently associated document. Stylelet retains recursive import coordination;
Document supplies its fetch callback through `loadStyleSheetImports()`.
HTML retains events, blockers, and owner lifetime.

URL Core owns `URLRecord` and its supporting host, origin, site, and blob-entry
types, together with record serialization, copying, and equality. Its independent
entry point has no subsystem dependencies; the full URL index re-exports it.
Parsing and platform implementations remain in the full URL subsystem.

Stylelet also imports Encoding's label lookup and complete-input `decode`
algorithm. CSS retains fallback-encoding selection; Encoding owns BOM override,
byte decoding, and replacement handling. Stylelet includes the full codecs and
their Node dependencies. Encoding sits above JS Engine; there is no separate
Encoding Core. Labels and BOM detection live in Encoding, and `codecs/utf-8.ts`
owns complete-input UTF-8 conversion and byte writing without realm allocation.
Infra has no Encoding dependency. Each `core` entry point retains its own
reviewed dependency level.
`JSEnvironment`, inherited through `FetchEnvironment` by `StyleletEnvironment`,
requires internal Promise creation, background work, and
`queueTask(source, steps, options?)` delivery. The source keyword selects
a shared task source; `env` selects the owning destination. Browlet's
[`scripting/tasks.ts`](browlet/scripting/tasks.ts) maps these keys to shared source
identities; HTML retains task queues and scheduling policy. Optional task metadata
carries timer nesting levels without moving timer initialization into Infra.
Stylelet uses Fetch's complete environment contract. CSSOM implementations
report Core `DOMExceptionImpl` failures; the active host binding realizes those
failures as Platform exceptions in the appropriate realm. MediaList needs no
environment solely for exception reporting.
Infra's `TimerHost` describes a native wake-up request returning a `TaskHandle`.
`remove()` cancels pending work; native timer tokens remain private to the
provider. Hosts may limit requested delays, so consumers enforcing a deadline
must recheck their clock. UserAgent supplies Browlet's Node provider through
`timerHost`; each global's `GlobalTimers` retains HTML activity, deadline, and
ordering rules.
Infra's [`tasks.ts`](infra/tasks.ts) supplies task types and `nativeTimerHost`,
which captures scheduling and cancellation together, retaining their original receiver;
it requires native timers only when scheduling work, not during module import.
The test host composes its controllable Promise observation and deferred work in
`test/support/scheduling.ts`; production environments provide their own scheduling.
Stylelet requires the consumer's complete environment, including execution.
The independently built package targets Node and does not require a Browlet
instance. It imports lower subsystem algorithms and engine helpers;
there is no browser-global bundle. `SelectletEnvironment` uses the same `userAgent.dom`
owner and currently needs no execution facilities. `SelectletContext` retains
that environment alongside its query state and caches. Stylelet and Selectlet share Infra's
[`DOMOperations`](infra/dom-operations.ts). Selectlet accepts a `dom` option, and Stylelet
uses the required environment's provider. Browlet supplies its UserAgent's adapter. Engines retain the host's
node identities and access their trees,
attributes, and live HTML state only through those operations. The standard
provider uses platform DOM APIs; [Browlet's provider](browlet/integration/dom.ts)
uses implementations, including class checks for HTML elements. There are no
per-node adapters or required fields on host nodes.

The optional `targetElement` DOM operation supplies retained navigation selection.
Browlet's Selectlet and Stylelet matchers read Document's HTML-owned target directly, so `:target` does not change
merely because History changes the URL or an element changes its ID. Providers
without this operation retain the matchers' older URL approximations; completing
their navigation-state integration is separate from Browlet's fragment algorithm.

Browlet's Document lazily retains its TreeScope and StyleletContext before any
style query needs a Stylelet engine. That engine consumes the existing scope.
ShadowRoot retains its own scope and uses its current node document's context;
adoption updates the context while preserving the collections. The context reads
HTML and quirks-mode state live rather than capturing document initialization state.

Attribute operations distinguish qualified-name access from namespace/local-name
access. Stylelet's `CSSDeclarationBlock` owns parsed property data independently
of `CSSStyleDeclarationImpl`, which exposes a supplied block through CSSOM.
Neither constructor reads an owner's attribute. Browlet's HTML, SVG, and MathML
elements own their inline-style mixins from construction. Attribute input checks
CSP and updates a retained block without creating CSSOM. Reading `.style`
lazily creates the retained CSSOM object around that same block. The cascade's
`getInlineStyleBlock()` query reads the block directly. The optional DOM
`inlineStyleBlock` provider returns null when there is no block; that result is
authoritative. Only an absent provider permits raw-attribute parsing.
Computed-style results retain a separate Stylelet-owned `ComputedStyle` collection
of property definitions and whole values, exposed through CSSOM without creating
authored declarations. Each query creates its own collection; it has no element
attachment or persistent cache. Binding reads supported indices from the current
authored or computed collection, so changes are visible through the existing Platform object.
A standalone host attaching to an existing element explicitly delivers its
initial attribute through `attributeChanged()`. CSSOM writes the null-namespace `style` attribute through
DOM operations so another namespace's `style` attribute cannot receive those writes.
Browlet's inline-style mixin checks CSP before supplying attribute input to
Stylelet. It first reads the declaration's CSSOM updating flag so write-back
bypasses both policy checking and parsing. Stylelet alone changes that flag;
its getter lets hosts recognize write-back without introducing another flag.
Removal clears an existing declaration without CSP checking or new allocation.
Stylelet has no attribute-policy callback; other hosts apply their own policy
before delivering input.

Stylelet's stylesheet and rule implementations own one retained rule tree.
Syntax records are temporary inputs to CSSOM's rule construction; the cascade
reads the same implementations that CSSOM mutates. Sheets own location/base URL
provenance, and rule attachment/removal updates parent-sheet associations through
their children. Binding projects these implementations rather than creating a
second representation of their state.

`CSSStyleSheetImpl.loadImports()` connects a loading root and starts one cancellable
`StyleSheetLoad`. Successful CSSOM insertion, deletion, and internal rule replacement
notify that connection synchronously. Added imports join an active attempt or start
a fresh one after completion; removed branches withdraw pending descendant requests.
The root retains the last attempt's fetching and notification callbacks. An optional
start callback receives each new attempt before requests begin; completion remains
once per attempt. Cancellation disconnects the current connection, even after normal
completion; sheet removal invokes it before clearing associations. Cancelling an old
handle does not disconnect or cancel a later attempt.
Stylelet owns recursive import association and completion; its supplied fetch step
reports a fresh parsed sheet separately from success, allowing failed loads to retain
empty sheets. `DocumentImpl.loadStyleSheetImports()` connects that step to its
document-dependent CSSOM fetcher, with request settings supplied by the owner for each request.
Fetched sheets retain their actual encoding, final base URL, and response-derived
referrer policy for child imports. Inline sheets use the document URL and current
document referrer policy; the document's other request policies remain with Fetch.
Fetch's referrer-policy module owns the complete policy list, type, and Web IDL
enumeration alongside header parsing, redirect updates, request referrer
selection, and URL stripping. Consumers import these through Fetch's index.
The client supplies its referrer source and the
UserAgent supplies trust decisions. An unspecified sheet policy remains empty
until import request construction selects the external-sheet default.
HTML owners must establish loading connections, manage document blocking,
and consume start/completion notifications. Parsing and parent assignment do not
initiate requests. Automatic HTML integration and imported-rule cascade traversal
remain unfinished.

Stylelet value classes implement `Value<Context>`: static parsing/consumption,
instance resolution and serialization, and a `repr` payload. Numeric literals
keep their magnitude directly on the instance, with a unit for dimensions.
Dimension and image grammars return concrete values through unions. Contexts
remain invocation inputs.
WholeValue retains its consuming parser for deferred reparsing and delegates
ordinary resolution and serialization to the contained value. AnyValue and the
declaration-value classes retain component lists; their raw component types and
validation belong to Syntax.
Named built-in property records own ordinary parsers, complete-value construction,
inheritance, typed initial values, and percentage-reference selection during
resolution. Interpreted declarations retain the record identified during parsing
and delegate value serialization to it. The engine resolves selected values through
their properties. Families supply ordinary
initial values, and shorthand expansion supplies
already-parsed components or pending occurrences. The record constructs each
complete value with its consuming grammar. Instances live in the property-family
modules. CustomProperty owns the Variables 1 defaults, declaration parsing,
substitution, and source-preserving value serialization. Its name is stable;
the current registration comes through PropertyContext's RegistryContext at
computation time. CascadeEngine combines active stylesheet registrations with
its explicit registeredPropertySet once per query and supplies that map directly.
Custom-property registrations retain their syntax, compiled whole-value parser,
and metadata separately from the retained property record.
BuiltInProperty and CustomProperty extend BaseProperty, which owns shared metadata,
operation contracts, percentage-context selection, and the animation-category guard.
Subclasses implement interpolation, addition, and accumulation directly, handling
their retained representations and contextual requirements without an operation selector.
The registry module owns built-in registry types and document-scoped custom
registrations; a registration overrides the unregistered custom-property defaults.
Ordinary values expose interpolation, addition, and accumulation directly.
Properties supply family-specific compatibility rules where necessary; otherwise
WholeValue invokes the contained value's operation. A null result requests discrete
fallback, while missing implementations throw. Results retain the property's grammar.
Combination leaves intermediate values unclamped; the future effect composer must
resolve the final result to apply limits. Timing and effect state belong to Animation.
Initial values remain shared Declared representations; resolution must not
mutate them. CascadeEngine owns declaration selection, registration lookup, and
value computation. Each style query uses local maps for selected declarations,
computed built-in/custom values, and pending shorthand expansions. Defaulting
uses property metadata and inheritance via DOMOperations' flat-tree parent. Property
dependency guards are query-local too; SubstitutionValue receives a guarded
lookup and composes component/source lists for `var()` replacement without
retokenizing serialized text. WholeValue and pending longhands receive that lookup
through `context.getCustomProperty`, preserving `resolve(stage, context)`.
Complete property values default to `PropertyContext`; ordinary grammars keep
their narrower context types. WholeValue reparses the resulting components with
its retained grammar. A pending longhand carries its original shorthand occurrence
and index as state on WholeValue, not as a subtype or contained value. The engine
caches expansion once per occurrence and element in the query; direct value resolution
can expand it independently. The resulting whole value has no pending state, and
the declared value remains unchanged.
Invalid winners default without reviving earlier declarations. Cascade rollback,
shadow-scope selection, registered values, and other arbitrary substitution
functions remain unfinished; full Cascade review follows the bounded
Variables work. This query state is separate from registration metadata and
the CSSOM result, which remains a snapshot.
Property parsing returns values ready to retain in a declaration: ordinary
grammars prepare the Declared representation, while deferred forms retain
their syntax. Registered-property grammar validation waits until Computed.
Resolution receives stage and context at invocation. Serialization describes
the retained representation without resolving it or selecting a later stage.
Interpreted declarations lazily cache their serialized value. Retained values and
their nested payloads must stay unchanged; CSSOM edits replace occurrences, while
resolution retains separate whole values in the computed-style collection.

Stylelet's RuleListContext forwards Syntax's interpretation requests to a supplied
CSSRuleListImpl. The context module imports only types; the list dispatches to
concrete rule and property grammars. Rule implementations and `context.ts` live
under `cssom/rules/`; the coordinating `rule-list.ts` remains one level above.
Shared property contracts and registries live in `props/`; `props/built-in/`
supplies the concrete property grammars and metadata. `props/base-property.ts`
owns shared property contracts. `props/builtin-property.ts` and
`props/custom-property.ts` own their respective value handling, independently of
each other. A built-in property can own a `Shorthand` helper from
`props/shorthand.ts`; `FourSidesShorthand` supplies the top/right/bottom/left pattern.
The helper parses shorthand input and expands the parsed result into longhand values.
Deferred occurrences reuse its parser with the computation's context; declaration
interpretation constructs the corresponding declaration occurrences.
`BuiltInProperty` owns serialization, accepting one whole value or the helper's
ordered longhand values. Shorthands have no separate computed value.
These classes sit below the concrete families. Constructing a shorthand property
calls its helper's `attach()` to link it to its longhands in CSSOM's preferred order.
A single property registry supplies name lookup for longhands and shorthands.
The engine computes only longhands; CSSOM and computed-style shorthand reads
call the shorthand property's serializer.
The helpers retain supplied longhands through type-only imports and do not load
the registry.
Declaration interpretation,
the resulting `InterpretedDeclaration` instances, the ordered collection, and its
CSSOM implementations live together in `cssom/declarations/`. Syntax keeps the
uninterpreted `SyntaxDeclaration` and imports interpretation result types only.
MediaList lives in `cssom/media/`. Both CSSOM families sit below
rules and sheets, alongside the type-only rule context. Their barrels provide
narrow entry points without loading the rule dispatcher. ESLint checks these
dependency directions; parent-rule and parent-sheet references remain type-only.
The context retains the existing environment for CSSOM
allocation and the enclosing selectors for nested rules. For each grouping rule,
the coordinating list creates a child list and supplies it to the concrete rule.
The rule's child context uses that list during block parsing, and the completed
rule retains it. Concrete rules import the list only as a type. Interpretation
does not mutate that list: Syntax supplies the preceding entries from the current
input, and the owner installs the completed result. Context is per-parse state,
not a host service on the environment. Selector and property grammars receive
that same object directly. Declaration-block parsing accepts PropertyContext and does
not construct a CSSOM rule context.
Rule entry points and their consumers use RuleListContext through a
type-only import and return CSSOM rules and interpreted property declarations.
Selector and value grammars declare their own context requirements; generic
consumer adapters and combinators preserve those requirements.
All parser entry points require an explicit context; generic syntax callers with no
settings pass `{}`. Value-processing contexts share `ValueContext` and require
the owning Stylelet environment as `env`, including during property parsing.
Consumers read and forward their context from TokenCursor.
An explicit parser argument takes precedence over the input cursor's context;
withContext restores the caller's context on return or failure. Declaration syntax
readers preserve that context without injecting an identity interpreter.
Each block interpretation method owns child
consumption and whole-rule validation. CSSOM supplies constructed-sheet status
as data on the same context class; the environment carries no per-operation
import permission.
Grammar checks return their parsed results, so construction does not repeat
selector/property interpretation. Unfinished standard at-rule grammars have
explicit throwing entry points; unknown syntax still follows CSS recovery.

The required `getLanguage()` operation supplies the host's determined element
language. Browlet delegates to `NodeImpl`, including document defaults.
`standardDOM` reads language attributes and ancestry, crossing shadow roots to
their hosts; platform DOM APIs do not expose retained HTTP or pragma defaults.
Custom hosts supply the query through their own adapter. Selectlet and Stylelet
own language-range matching, not language lookup or document metadata.

The required `getDirectionality()` operation similarly supplies HTML directionality,
independently of CSS `direction`. Browlet delegates to the element implementation;
`standardDOM` uses the host's ordinary DOM, live control values, and slot assignment.
Both use Infra's contained-text scan through `DOMOperations`, including its
`isAutoDirectionalityBoundary()` and `isSlot()` queries. Browlet forwards these
to its element methods, retaining their overrides and prototype metadata. The
caller supplies its existing provider as the scan's final argument. Control
values and slot assignments remain with their owners. Text queries include
CDATASection. Infra's Unicode lookup lazily expands the generated packed data
once; this caches the character table, not any element's direction. Selector engines compare
that result with the requested direction; they do not maintain another bidi scan
or call the host's native selector engine. Unfinished Browlet control values remain
explicit dependencies rather than falling back to default attributes.

`DOMOperations` distinguishes the host's node, element, attribute, document,
document-fragment, and shadow-root types. Its predicates narrow those roles, and each lookup
accepts only the receiver kinds it supports. Engine internals use opaque role
types with an optional, type-only symbol; no node is tagged or inspected through
that symbol. CSSOM retains element or processing-instruction owners through the
corresponding opaque roles. The separate [standard adapter](infra/dom-standard.ts) owns the
structural browser interfaces it reads, including separate form and media views.
Browlet's adapter supplies concrete implementation types instead.

### Construction and lifetime

[`Browlet`](browlet/browlet.ts) constructs UserAgent, which creates its sandbox on first use
through [Web IDL composition](browlet/integration/web-idl/composition.ts) and exposes that module's
Window-environment factory. Composition assembles environments for existing owners;
it does not construct UserAgent or serve as an implementation service entry.
UserAgent creates Window Agents; composition creates the sandbox Agent.
Each receives an EventLoop constructed with its host-turn callback. The loop
creates its engine microtask queue, reads the shared clock, and schedules work as
it arrives, without a separate start phase or per-turn options. Realm construction
requires its owning Agent. Browsing algorithms call their UserAgent's Window
factory; existing objects use their retained `env`, realm, and WindowProxy handle. Document allocation
uses `env.createDocument()`, preserving binding-owned allocation without
passing Binding Context into the lifecycle algorithms. Main-world inspection for
tests lives in `test/support/browlet-binding.ts`.

[`createWindowEnvironment()`](browlet/integration/web-idl/composition.ts) assembles the environment base,
WindowRealm, binding, and full settings before constructing Window
with that environment. Binding registration
accepts an environment factory because allocation and Promise composition need the new
Binding Context. Declarations and their binding world name one environment type;
that type supplies the realm type too. The factory returns the actual environment;
declarations subsequently obtain it through `ctx.getEnvironment()`. A standalone
binding needing only a realm can return `{ realm }` from its environment factory.
Event construction captures the binding in `env.createEvent`, without
attaching it to BrowletRealm. Event targets require that operation through their constructor's
environment. Character-data and document-fragment constructors take their environment
from their initial document; shadow roots use the host's current document. The node
retains that environment when adoption changes its document. Constructors whose
document and environment are independent, such as Range, retain both parameters. Standalone
EventTarget implementation tests can supply a real sandbox environment; Document
tests need browser settings for its HTML operations. Every target retains one
`env` field. Derived implementations can narrow its declared type to the stronger
contract their constructor requires, without adding another field or owner lookup.
Global projection and global-scope mixin setup finish before consumers receive the Window environment.
Document creation retains its own HTML initialization steps. Its relevant Window comes
from the retained environment's realm; changing the Window's associated document
does not require updating a second Window reference on Document. DOMImplementation
likewise takes its environment from its associated document.

The browser environment base and complete environment live together in
[`browlet/environment/environment.ts`](browlet/environment/environment.ts), above Scripting's realms and
event loops. The complete environment constructs its own `InsecureRequestsPolicy`
and implements `generateReport()` using its live settings and the concrete policy
report bodies. These are owned state and a browser algorithm, not additional
constructor dependencies. Reporting supplies shared records and observer behavior;
UserAgent owns outbound delivery. Policy report bodies depend on Reporting's base
classes, while the environment composes both owners above them.
Scripting's realms and event loops retain only type references to these browser
environments. HTML structured-data algorithms use the full `BrowletEnvironment`;
their standalone tests compose a real `SandboxEnvironment` with its execution
facilities instead of supplying a separate realm-only environment view.

`BrowletRealm.hostDefined` permits the absence of HTML settings; `BrowletRealm.env` requires
them and throws if they are unattached. UserAgent creates and retains one sandbox
on first access, with a real BrowletRealm, Agent, event loop, and SandboxEnvironment, but no
Window, Document, or attached HTML settings object. It supplies execution for
retained browser work such as Reporting uploads and retains that UserAgent explicitly.
SandboxEnvironment extends BrowletEnvironment so binding declarations retain
their full contract. Passing no environment base leaves its creation URL and
standalone UserAgent unavailable; guarded accessors throw rather than return
incorrectly typed nulls. Origins, API base URLs, policies, module maps, ancestry,
time origins, and Window/Worker global-scope state also fail explicitly.
Top-level associations and reporting/referrer sources are null. Window
construction still requires a complete BrowletEnvironmentBase.

Dedicated/shared worker composition accepts a selected agent and creates a
`WorkerEnvironment`, realm, and declared global. Creator-derived origin, ancestry,
security, and time-origin inputs are retained; response-dependent URL, module map,
policy, and isolation queries use the worker global. The environment owns its
global resource mixin. Setup attaches the initial owner but leaves execution
readiness false. This is not a worker launcher: independent execution, transporting
UserAgent services/owner identities between isolates, script fetching, and lifetime
monitoring remain the worker processing model's dependencies.

JS Engine's `JSThread` and `JSThreadEndpoint` own native isolate startup, internal
cloned-data channels, and native teardown. Node Worker/MessagePort objects and
startup globals remain private there. The host registers its module URL and
setup steps once through `JSThread.initialize()`; the engine owns native path
conversion, startup marking, and scheduling, so thread construction takes only
data and a receiver. Browlet's [worker integration](browlet/integration/workers/index.ts)
separates the creator-side thread from the inside runtime and their shared message
types. The thread owns the setup acknowledgement; its inside runtime creates the
dedicated/shared agent and EventLoop, then turns incoming commands into tasks. It does not create another
UserAgent or stand-in owner objects. Browlet reloads its existing
`index.mjs` or `index.cjs` bundle in the isolate, without eval or another built
entry. Private startup data identifies that exact bundle; ordinary imports in
other Node workers or another installed copy do not start the runtime. Host
setup runs after the bundle has finished evaluating. It starts the agent and loop
without a source loader or caller-selected file. `WorkerThread` retains the live
`creatorEnv` and exact original Document/worker owner locally. Its plain
`creatorEnvSnapshot` carries existing `Origin` and `URLRecord` values, security
flags, the environment ID, and cluster settings. Mutable record data is copied;
URL records omit cached Blob registrations, which remain with the UserAgent.
Opaque origins own private UUID identities that survive copying; public origin
serialization remains `"null"`.
`AgentCluster` likewise owns a portable ID. The receiving runtime associates its
dedicated agent with a local representation of that cluster, or gives a shared
worker a fresh origin-keyed cluster. Membership sets contain only local agents.
Nested capture therefore preserves inherited identity without a weak table or
new UserAgent, agent, or owner tokens. The control channel connects the worker to
its parent; identity alone grants no access to remote services. Inside composition
reconstructs the transported policies; the remaining UserAgent services still need
transport. HTML structured-clone records retain the existing cluster ID rather
than the local cluster object. The private host channel can carry ordinary
graphs, shared buffers, and native Wasm Module tokens for target-realm
reconstruction through HTML and Binding. Interface-owned resources require their
own transport; MessagePort now supplies it below. Startup snapshots do not replace it.
Host readiness and native termination are
separate from HTML execution readiness and termination cleanup.
JS Engine owns `NodePromise` and exposes one internal thread completion with a
private implementation result. Browlet chains local cleanup onto that completion;
readiness and cleanup use the creating isolate's host queue, independently of
page or worker activity. Native termination Promises stay inside JS Engine.
Completion notifications can cross the host channel; Promises and their resolvers stay local.

Initial module-graph fetch transport retains the real creator as the Fetch client.
Only resolved request inputs and consumed response values cross the private host
channel; request IDs select callbacks retained in the worker isolate. Fetch runs
beside the creator's shared stores and delivers on the worker networking queue.
Root policy initialization remains separate from dependency response delivery.
`BrowletEnvironment.parseURL()` delegates to its UserAgent. `BrowletUserAgent` is
the concrete browser owner; `UserAgent = Public<BrowletUserAgent>` declares its
complete public contract in one place. `new UserAgent()` keeps the constructor
export, and `WorkerUserAgent implements UserAgent` supplies the worker connection.
Infra's `Public<T>` excludes private class identity without narrowing public members.
Unavailable worker facilities throw explicit dependency errors.
Environments and existing consumers keep the same non-generic `userAgent` access.
The store uses `Public<BlobURLStore>`, and `resolve()` returns
`Public<BlobURLEntry>`. The browser keeps its actual entry; the worker reconstructs
that public shape from the captured handle and origin. Blob access, partition
checks and uncopied creator-environment fields explicitly throw in the worker.
Workers do not instantiate another browser or copy its stores. Timers,
continuations and the shared clock remain local, while scripting policy uses
the original atomic preference.
Blob resolution/revocation, live scalar preferences, origin/URL trust and loading
queries use a private service port. The outside reservation supplies the actual
worker origin for access checks, including data workers. JS Engine owns native
synchronous dequeue; waiting does not pump HTML tasks or Promise reactions.
The browser host queue must be free to answer: it cannot synchronously wait for a
worker that is itself waiting for this service. A dedicated service execution
owner is not implemented.
Captured Blob entries have per-record leases released by worker-side collection,
or collectively at connection close. Initial-graph Fetch retains captures through
the response and uses their IDs, preserving pre-revocation captures. Nested-worker
forwarding, worker-created Blob backing transport, general Fetch and shared
storage/permission/broadcast/report services remain explicit dependencies.
The script loader connects to this transport while retaining URL resolution,
its inside module map, parsing, and graph linking. Its `ScriptEnvironment` client
supplies `fetchModuleSource()`: BrowletEnvironment fetches locally, while the
existing WorkerThreadRuntime forwards inputs through its creator connection
before request construction. The already-fetched root response uses the same
loader; graph failures join ordinary worker load-failure cleanup directly.
Dynamic imports and general worker Fetch require the worker's own client, not
this initial-graph path. Only the unfinished successful-startup dependency error
is reported on the native host queue so it triggers thread teardown; ordinary
graph completion does not acquire another task.

`UserAgent.scriptingPolicy` owns the browser's live scripting preference.
`scriptingEnabled` remains its boolean getter/setter; the private startup channel
shares one atomic cell with the worker's local `ScriptingPolicy` representation.
This handle is separate from the creator snapshot and is never exposed through
author messaging or globals. `env.scriptingPolicy` supplies that same preference
to script creation and entry checks without a local UserAgent or a blocking RPC.
Window sandbox checks and worker response CSP retain their own owners. Event
handlers use the environment's BiDi gate; worker overrides retain the provisional
no-automation answer until worker scoping and live override transport are defined.

JS Engine also owns transferable native channels. `JSMessagePort` wraps a
native endpoint locally and exposes its native handle for internal transport;
`JSThread` and channel sends take explicit transfer lists. Moving the handle
retains its native queue and peer connection, including between two worker
isolates without a creator relay. Host receivers are removed before handoff,
and new receivers run on the destination's host queue. These handles must remain
private to implementations. The worker host establishes a native pair before
inside startup finishes, retaining immediate posts. The inside runtime attaches
its endpoint when the dedicated global has been composed. Native
receivers only enqueue HTML work: Browlet retains serialization, queue enablement,
activity/realm selection, event targets, and cleanup. Forced termination removes
host receivers before clearing pending outside deliveries. MessagePort owns its
transfer record: local channels stay local until crossing isolates, when the pair
is promoted to native endpoints. Ordered HTML deliveries travel separately from
the native pending queue, including nested transferred resources. Receipt installs
those deliveries before host reception resumes, with HTML delivery still disabled.
Endpoint IDs and private owner notifications retain peer identity across handoff;
unknown/in-transit owners count as external. No general Binding transport hook or
creator relay is needed. Remote worker-owner monitoring remains separate work.

Fetch makes three separate choices: the request's client supplies policy and
lifetime state; `FetchParams.env` supplies execution; the callback destination
selects a global or parallel queue. A null client does not imply missing
execution. `FetchRequest(url, env)` retains its owner independently and starts
with a null client. Initiating algorithms assign the client explicitly when
they have one; reporting can retain the sandbox owner with no client. Cloning
and preflights preserve both choices. Reserved clients, full settings, and sandbox environments must not be
substituted for one another just because an algorithm can reach a UserAgent.

The worker initial-script handoff uses those three choices: the prepared request
keeps its creator client and shared UserAgent stores, body execution uses that
UserAgent's sandbox, and parallel Fetch completion sends consumed bytes/metadata
to the receiving worker's networking task queue. Blob creator policies are copied
before stripping live registrations from response URLs. WorkerThread retains and
cancels Fetch controllers on teardown. Startup now composes the real inside
environment with its reserved client identity, initializes response policies,
and loads and links module descendants. Execution readiness, owner monitoring,
and nested workers remain processing-model work. The response handoff is not
general response or MessagePort serialization.

`WorkerEnvironment.completeScriptFetch()` handles failed-load error delivery and
environment discard, or entangles the startup ports and calls `runScript()`.
The outside target uses the EventTarget base for both Worker and future SharedWorker;
its original outside port retains the environment responsible for error delivery.
`runScript()` reuses the script runners, without awaiting module evaluation, and
activates ports or queues shared-worker connection delivery. The separate-isolate
startup caller, natural thread teardown, and
lifetime monitors remain explicit dependencies.

After a dedicated/shared global starts closing, its event loop finishes all
queued tasks and the final microtask checkpoint before becoming destroyed. The
global's `finishRunning()` continuation clears timers, disconnects external ports,
closes local EventSources (including retry timers), and empties its owners.
`close()` requests a loop wake-up after clearing queues;
new or resumed work cannot revive the destroyed loop. This is cooperative cleanup,
independent of native thread teardown.

The dedicated outside `WorkerImpl` retains its `WorkerThread` in the creating
isolate. Host startup accepts that Worker, derives its creator environment/port,
and installs the association after native creation succeeds, before readiness.
Public `terminate()` forwards to the host and returns undefined; host completion
stays on its internal promise. The host interrupts blocked native execution
without scheduling inside work and clears pending outside deliveries. Native
exit disconnects the port and releases the association, including when Fetch
cleanup throws. Natural exit preserves messages sent before closing. Production
startup must still supply the Worker before its constructor returns and connect
the inside environment and services; a local Agent is not a cross-isolate handle.

Dedicated error reporting uses a narrow `reportErrorToOwner` callback on the
inside global. The runtime sends only diagnostic attributes, with a null error
value, to the host's retained outside Worker. That object queues a DOM-manipulation
task and forwards uncanceled diagnostics through its creator environment's
existing error dispatch. Live nested workers use the same route at each hop;
there is no cloned exception, remote Environment, or new service registry.
Production startup must connect the callback before author execution. Routing
through a terminated parent's isolate still needs a surviving owner connection.

The [global-scope mixin](browlet/environment/global-scope.ts) composes each global's timers,
Performance object, Reporting state, and resource associations. It sits above
the scripting foundations and is not re-exported by their barrel.
BrowletEnvironment supplies settings, execution, and browser context.
UserAgent owns outbound report delivery, shared transport, caches, credentials, stores, and BiDi hooks;
that state can outlive one Window. Follow those existing associations instead
of adding reverse lookups or duplicate lifetime flags.

## Scheduling and asynchronous work

HTML owns tasks, activity gating, and checkpoint policy. JS Engine supplies the
microtask-queue backend; Node wake-ups do not choose HTML ordering. Each HTML
Agent's event loop shares its queue with the Agent's realms. The loop retains
its owning Agent; Window idle processing uses that Agent's existing Window set.
Each Window composes a `WindowIdleCallbacks` for its callback lists and timeout
races; the loop supplies the deadline and dispatches their document-gated idle tasks.
Binding owns callback conversion, exception reporting, and `IdleDeadline` projection. Rendering
predictions remain an explicit input from the unfinished rendering owner.
[The event-loop architecture](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md) owns
the detailed contract and backend accommodations.

Each Document and dedicated-worker global owns an `AnimationFrameController`
for its callback map and handle counter. Window forwards to its current Document;
worker support follows the existing owner set. Binding owns callback conversion,
invocation, reporting, and cleanup. The existing Window rendering phase supplies
the Document-relative timestamp and calls the controller directly. Permanent
target cleanup clears retained callbacks. Refresh opportunities and automatic
worker frame production remain separate, explicit rendering dependencies; the
controller does not create a timer or retain an additional environment.

The addon exposes native facilities; custom Node/V8 patches additionally enable
callback and job hooks consumed by HTML. The addon bridges the engine APIs;
HTML supplies the scheduling policy. Availability is checked per capability,
so an explicit microtask queue does not imply support for job interception.

Infra's `InternalPromise` retains its result descriptor without interpreting its
contents; Web IDL owns IDL descriptors. The Promise constructor selects creation
and observation. `env.InternalPromise` supplies the owner's
constructor with static creation methods, taking the descriptor last. `then()`
keeps that descriptor unless given a new one. JS Engine specializes observation;
Web IDL extends that constructor with declared-result conversion and checks the
descriptor and storage representation at exposure. Importing changes the view's
constructor while retaining the native backing, storage representation, and source
conversion; subsequent results use the destination. Declared adoption preserves
compatible native results and converts other representations in the destination.
Private fulfillment values stay on their internal Promise, shared by imported
views; its native backing signals completion without adopting the value.
Native async/await belongs at host boundaries; returning a Promise cannot repair work
already scheduled on the wrong queue.

`runInParallel()` schedules background steps. Completion enters the selected
owner task before changing realm-owned streams or delivering author callbacks.
Fetch's `queueFetchTask()` accepts an explicit global or parallel queue, so
it works for both full settings and sandbox execution. Host-owned continuations
use `HostPromise` without pretending to belong to a retired Document.

Session-history traversal queues retain their UserAgent across Document changes.
They serialize background algorithms, using that owner's `HostPromise` to observe
a suspended algorithm's completion. History application owns selection of tagged
synchronous-navigation steps from the pending set; the generic drain does not
decide when navigation may jump ahead.

## Choosing a dependency

| Need | Placement |
| --- | --- |
| State or behavior owned by this subsystem | Its implementation or ordinary algorithms |
| Realm-neutral shared algorithm | Direct import from its owner |
| Realm identity, intrinsics, JSON strings, or JavaScript buffer allocation | Existing environment's `realm` |
| Internal Promises, task delivery, DOM allocation, or structured data | Existing environment directly; binding-dependent functions supplied during construction |
| Conversion, callback adaptation, identity, projection | Web IDL declaration or member binding |
| Another specification's behavior | Direct owner API when permitted; a narrow capability for reverse/cyclic or host-specific dependencies |
| Native I/O, clocks, scheduling, or unavailable engine primitive | Narrow Host Port, composed by the embedder |

Planned shared engines have roadmap-only owners: [geometry](geometry/ROADMAP.md),
[fonts](fonts/ROADMAP.md),
[animation](animation/ROADMAP.md), and [layout](layout/ROADMAP.md). They own their
data and algorithms; Browlet connects document state, policy, scheduling, and
presentation. Stylelet owns CSS processing and [Typed OM](stylelet/cssom/typed/ROADMAP.md).
These folders establish responsibility, not new Environment/Context APIs.
Style/layout feedback needs explicit update ordering and invalidation, not
reciprocal engine imports or ambient service discovery.

[Graphics](graphics/ROADMAP.md) now owns ImageData's pixel storage and neutral
Web IDL declarations. Its existing `JSEnvironment` supplies realm intrinsics for
fresh arrays; supplied arrays retain their identity. Serialization steps share
HTML's graph memory, including pixel-view offsets and buffer aliases. Browlet
composes Window/worker exposure through its ordinary definitions. This does not
introduce a graphics Environment or select a decoding/rendering backend.

ImageBitmap owns a BitmapData instance with RGBA bytes, dimensions,
format/color/alpha metadata, and origin-clean state. Its interface steps copy
the pixels for serialization or move them for transfer; close releases them.
Transport uses plain BitmapDataRecord values and reconstructs the class on
receipt, without a source environment or decoder handle. ImageData and ImageBitmap
each implement prepareBitmapData for validated source access; BitmapData.create
and its instance operations supply independent crops, all four resize qualities,
vertical flips, and alpha conversion using the existing JSEnvironment. Color space
and pixel format belong to each image.
Other source extraction and async factory orchestration remain with their
future graphics/HTML producers.

[Browlet's bindings](browlet/integration/web-idl/composition.ts) and
[integration modules](browlet/integration/README.md) are explicit composition
boundaries. They can know both sides of a dependency and capture Binding Context
in boundary closures. Ordinary algorithms cannot rediscover collaborators
through the assembled bindings singleton. Outside Web IDL, mark genuine binding
integration with `BINDING_INTEGRATION:`; unresolved implementation leakage uses
`TODO(BINDING_INTEGRATION):`.

Interface serialization and transfer steps live beside their implementations and
attach to the Web IDL declaration through portable contracts. HTML supplies the
active clone's traversal, identity memory, and agent-cluster restrictions; Binding
supplies platform identity, exposure queries, and target construction. Interface
steps share a `StructuredData` object. HTML initializes its `shouldRestrict` boolean
from the primary interface's `SameAgentCluster` marker and applies that restriction
before the steps run. Steps can set the flag to request a conditional restriction;
HTML applies any new restriction afterward, before checking storage or completing
the transfer. The data retains no source environment or callback. These hooks need
no separate capability registry.

For example, Fetch owns request/response policy and transactions; HTTP owns
reusable protocol syntax and cache rules; the UserAgent supplies transport and
per-response native decoders. The adapter owns sockets and codecs, while Fetch
owns stream delivery, cancellation, and backpressure. This is an effect boundary,
not a second Fetch implementation. See [Fetch's contract](fetch/README.md).

## Source boundaries and vocabulary

Import across subsystems through the owner's index. Browlet imports all Infra
symbols through Infra's index. Other subsystems may use Infra's independent
modules directly, and test imports may use implementation modules. Narrower
indexes such as Web IDL Core are deliberate entry points. Group code by
responsibility and real consumers, not by one folder per specification or one
file per algorithm.

Do not import or re-export through the current folder's or an ancestor's barrel,
including type-only imports and implicit `.`/`..` directory imports. Named
entries such as `../assembly/index` identify the component being consumed.
Sibling folders can have different dependency levels: a shared foundation
needs an explicit home, rather than making the containing barrel appear to be
lower level. Review that ownership before substituting deep imports merely to
remove a lint error. `browlet/no-ancestor-barrel-imports` enforces this boundary.

Directory depth does not establish dependency direction. A component can keep a
shared base and its higher-level collector in the same directory: HTML's concrete
elements import `../html-element` at runtime, while the local `web-idl.ts` imports
those concrete elements to assemble declarations. Importing that directory's
index would also reach the collector. Type-only upward references concern the
reviewed dependency layers, not the number of `..` segments in an import.

`browlet/browsing` groups components with separate named entry points.
`navigation` owns browsing contexts,
navigables, document creation, and session-history state. Window owns Window,
WindowProxy, and Location. Their consumers use the corresponding component's
index; cooperating modules within navigation import each other directly.

Navigable owns its direct child collection alongside the parent link. Construction
and parent reassignment keep those links paired; child destruction removes the
child from the collection while retaining its historical parent reference. History
selection uses this graph, independently of Document's DOM-based child/descendant
collections. Recursive teardown and restoration must reconcile retained children
before full history application can rely on that lifecycle.
There is no umbrella browsing barrel.

`navigation/state/` owns source snapshots, document state, and session-history
records, with an export-only index. Both the Navigation API and navigation
coordinator use this foundation without loading Navigable or the loader. Source
snapshots capture the initiating Document's settings; history records retain the
Document or the inputs needed to restore it. Scroll restoration takes an existing
entry and acts through its Document and shared scrolling facilities. The complete
navigation index remains the higher-level coordinator entry point.

`history` owns Document-retained History objects; `navigation/api/` owns the
Window-retained Navigation EventTarget and its NavigationHistoryEntry objects.
Navigation owns its realm's entry list; each entry refers to a shared session-history
record owned by the navigation coordinator. That coordinator selects the contiguous
same-origin records and initializes the new Document's list after activation.
Both API components sit below Window and retain type-only
references to the higher navigation coordinator. Window constructs Navigation,
while Document lazily creates History. History uses its existing environment's
storage serializer, composed at the Binding boundary, then calls Navigation's
event operation and Document's URL/history update operation. Those effect owners
remain explicit dependencies; the API objects do not manipulate history arrays.

`navigation/events/` owns the history and document-lifecycle event payloads,
including NavigationCurrentEntryChangeEvent. It sits below DOM nodes so the
legacy Document event factory can construct its supported events without loading
navigation. API-specific event fields retain implementation types only.
NavigateEvent remains in `navigation/api/` because it also coordinates
interception, commit, and completion. These nested folders retain their distinct
dependency levels beneath the containing navigation coordinator.

Navigable coordinates response preparation, destination context and Window
selection, document loading, and history commit. NavigationParams carries the
per-navigation inputs; the destination is the receiving Navigable, rather than
a reference stored in those params. Resource consumption stays in `loader/`,
below navigation. Its ResourceReader collects a bounded prefix and retains the
complete chunks for the consumer. MIME owns supplied-type detection, the
metadata-only preservation rule, and classification through `sniffMIMEType()`;
it holds no per-resource state. ResourceReader owns the deadline and stores
the returned MIME type as a concrete value; body reads throw until that value
exists. They drain the retained chunks and continue from the same Fetch reader.
A read pending at the deadline remains available to the body consumer. Fetch
supplies source reads, byte copying, and task delivery. HTML parsing stays in
`html/parser/`. A navigable outlives
individual environments; the new document's environment can exist before it
becomes active. Document loading and parsing use that document's owner.
BrowsingContext creates the initial about:blank document before the navigable
is initialized.

History population admits a response before asking ResourceReader to determine
its MIME type. It resumes synchronous `loadDocument()` dispatch and retained-state
updates on the captured destination's navigation-and-traversal task, rechecking
the navigation ID after the wait. The dispatcher receives the prepared reader
alongside the specification inputs, so a loader or external handler consumes the
sniffed prefix and remaining bytes from one source. UserAgent owns configured
inline/external type choices and decoder/PDF support. Actual §7.5 loaders and
unsupported-resource host policy remain explicit dependencies; no handler or
per-navigation service object is constructed by this dispatch.

`Navigable.navigate()` receives the executing environment as `env` last; null denotes host
or parallel work without a surrounding HTML Agent. Source and destination
Documents do not identify the executing caller. The source-side admission and
snapshots precede the handoff; local variables retain them and a shallow copy of
the option arguments across scheduled steps. Target checks run immediately for
the same Agent or through the active Window's navigation-and-traversal task source
otherwise, selecting the live target state when the task runs. This uses existing
task delivery and adds no ambient current-Agent registry. After fragment selection,
`navigate()` captures target policy and sets the ongoing navigation through the
existing Navigation API abortion notification. Its executing environment selects
synchronous notification; independent host/parallel setter calls queue that notification.
The same method owns javascript: routing, ordinary navigate-event dispatch,
parallel unload checks, population, and queued finalization. DocumentState owns
pending navigation-state construction; NavigationParams owns its supplied-response
factory. BrowsingContext obtains the context for Document creation, associating a
replacement with its existing Navigable before creation-time consumers need that
relationship. These operations return their results to the coordinator without
advancing history or activating the incoming Document. Fragment history application,
recursive abortion, population, and full history application remain explicit
dependencies in the navigation roadmap. Unload cancellation now snapshots Documents,
queues their checks on the owning globals, and returns a UserAgent-owned HostPromise.
The UserAgent forwards to Navigable with its scheduling owner; no Document realm
owns the cross-loop wait. Navigation resumes its parallel steps after completion,
and definite closing queues teardown only after approval. Prompt policy/UI and
full teardown remain explicit. Removed unload-check tasks reject their internal
wait without firing author events or fabricating a cancellation result.
History-step admission also uses that browser-owned completion: the traversable
normalizes the joint step and checks sandbox permission before waiting for
Document cancellation tasks. Its queued caller returns completion so later history
requests wait, while other traversables remain free to run. Navigation interprets
failure results only after that wait. Admitted requests advance current entries
but still stop explicitly before dispatching population/activation jobs.
Synchronous navigation queue jumping shares the queue's execution admission;
selected completions retain the nested-operation flag without giving suspended
code execution admission. The coordinator's wake-ups and continuation processing
remain unfinished, and provisional push/replace activation stays separate until
full history application replaces it.
History preparation and population accept optional failure steps for a waiting
operation. Those steps take responsibility for asynchronous errors; without them,
the existing task/parallel owner reports the exception. Synchronous setup errors
still propagate to the direct caller. Late response-cancellation cleanup stays
with its task owner after population has completed. Queued tasks can supply internal
`discardSteps` through their environment; removal detaches the work before notifying
its owner, without entering the removed task or author script. Document-wide removal
detaches all matching tasks before notification and releases every waiter even if
one notification throws. Preparation/population reuse their failure callback for
this path. Inactive Documents retain their tasks; execution never invokes discard
steps. Connecting these completions to the full history coordinator, canceling
in-flight population, and rejecting late work for destroyed Documents remain unfinished.
`Navigable.activateHistoryEntry()` owns the active-entry switch, Document/Window
activation, and initial visibility after persisted-state capture. It does not
advance the current entry or joint step, or restore script-visible history state.
Persisted-state capture still throws; the full coordinator must supply its caller
after any required unloading, preserving the displayed Document through population.
Window owns outgoing `pageswap` production alongside its page-transition events.
It uses its associated Document and realm, filters the destination activation,
and dispatches through the existing trusted-event machinery. Document deactivation
supplies its caller, either through recursive unloading or in the task that sets
up an outgoing transition. CSS capture's continuation returns unloading to the
traversal queue before releasing ownership. CSS eligibility/setup and recursive
unloading still throw explicitly; coordinator failure/discard completion is not
connected. Event production itself neither unloads nor activates Documents.
Cross-document finalization inserts into the destination's own retained history,
including child lists, and preserves replacement keys only across the same origin.
The provisional history application still receives that destination and entry
explicitly; selecting all affected Documents from the joint step, updating them
on their own event loops, and queuing the local loader's commits remain unfinished.
Fragment navigation reuses Navigation's event dispatch and tracker handling, then
prepares the active same-document entry synchronously. Document owns script-visible
history application and scrolling; Traversable owns the later tagged finalization.
The finalizer inserts or replaces entries in the destination's retained history,
preserving queued changes within the active DocumentState. For existing Documents,
history application restores classic state in the owning realm, publishes the URL,
notifies Navigation, fires popstate, and queues hashchange. Unchanged entries only
reconcile length/index and activation; they retain the cached state object. New
Documents restore classic/persisted state, initialize Navigation and activation,
call the provisional BiDi committed hook, and request fragment-scroll scheduling
before permitting parser scripts. The Document owns that one-way script gate;
the streamed parser also checks whether it was stopped before resuming a waiting
script. Retained-Document reactivation refreshes Navigation entries before activation
and persisted pageshow, with Document-owned showing/reveal flags. Existing timers
resume when full activity returns; reactivation does not adjust them a second time.
Selective form reset and visibility transitions remain throwing dependencies, as do
persisted-state restoration and joint history application. Fragment-scroll scheduling
uses a delayed host wake-up followed by a navigation task, rechecking parser state
and user interest before attempting scroll/retry. It returns before parser scripts
are permitted; user-interest policy, target selection, and actual scrolling remain
explicit dependencies reached by that later task.
The provisional local loader releases the same gate at its existing synchronous commit point;
it rejects same-document changes before it can reinitialize Navigation's entries.

Non-fetch URL routing stays on Navigable, using captured target sandbox and source
activation inputs. UserAgent owns the external-handoff sandbox gate. Its handler
selection and confirmation/handoff methods are explicit unfinished host boundaries;
they do not invoke operating-system handlers. Inline browser-page creation remains
a separate Document-creation dependency. Population must connect these operations
on the destination's navigation-and-traversal task after checking its navigation ID.

`UserAgent.protocolHandlers` lazily owns Navigator's `ProtocolHandlerRegistry`.
It remembers exact normalized scheme/template pairs for that UserAgent's lifetime,
including declined requests. Pending consent uses the browser's `HostPromise`;
settled entries retain only their decision and string keys, without a Document or
realm. Removal invalidates an outstanding decision by entry identity, so a late
result cannot restore the removed handler or change a replacement request.
Each Document owns its protocol-handler automation mode. The registry requires
the explicit automation-verification hook before honoring a non-default mode.
Consent UI, a verified WebDriver session, durable storage, default selection,
OS integration, and navigation are separate unfinished dependencies. Accepting a
candidate does not select it as a default or hand anything to the OS. After a
caller selects an accepted pair, the registry's `getInvocationURL()` prepares
the destination using URL's existing copy, credential setters, component encoder,
serializer, and parser. It preserves the input/template records and performs no
navigation. The external-handler chooser remains an explicit throwing boundary.

[`import-hierarchy.mjs`](../scripts/eslint/import-hierarchy.mjs) records the reviewed
folder order for import layout and dependency review. Every entry ends in `/`
and names an existing directory; the longest matching folder owns a module.
Top-level files inherit their containing component. Browlet's UserAgent and browser
entry consume `integration/web-idl/` composition, which installs the lower
`integration/web-idl/bindings/` hooks and consumes host and feature adapters.
The generic Web IDL subsystem's environment contracts and generator remain in
`web-idl/`; they do not need individual layers.
Shared code uses its existing owner when that owner fits: JS Engine supplies host
compilation, Web IDL's `values/` owns platform identity records, and policy's `sandbox/`
owns HTML sandbox flags. CSP consumes sandboxing and owns source-expression matching;
PolicyContainer sits above CSP and restores each policy from its own snapshot.
Worker integration passes the snapshot without supplying policy reconstruction callbacks.
Policy's `permissions-policy/` groups feature policy state, inspection, and reporting;
`cross-origin/` groups COOP and COEP. Both inherit the enclosing policy component's
dependency level and expose their members through the existing policy index.
Browlet's `environment/`, `dom/lists/`, and navigation's
`state/` provide separate homes where their consumers need a distinct foundation.
Imports put external packages first, then other subsystems and foundations (Infra, JS Engine,
Web IDL, Streams, then Encoding), then sibling components, then the current component's
collaborators.
Use one blank line between those groups and keep type and runtime imports with
their owner. `browlet/import-order` enforces this layout without sorting imported
names or moving comments automatically.

`browlet/dependency-direction` checks runtime imports and re-exports against the
same map. Explicitly type-only references are allowed across dependency levels;
they still follow import ordering and the prohibition on self/ancestor barrels.
Separate components on the same layer are independent, not automatically permitted
to depend on each other at runtime.
An upward import can reveal misplaced code or an incorrect layer; review the
ownership before changing the map. `npm run lint:imports` groups outstanding
findings and fails while they remain; `npm run lint:imports -- --fix` fixes layout
only. Do not erase concrete types or merge components merely to silence those
findings.

Stylelet has its own [component barrels and dependency order](stylelet/README.md#entry-points-and-existing-layers).
The entry-point rule also checks those internal boundaries, including type-only
references. Changes to Stylelet's layer order require the same ownership review
as changes to subsystem dependencies.
`environment.ts` and `context.ts` remain deliberate named entries in the enclosing
Stylelet component. The property classes and custom-registration contracts remain
directly in `props/`, below its `built-in/` definitions and their registry.
The `props/index.ts` barrel exports the shared classes and contracts; consumers of
concrete properties or their registry use `props/built-in/index.ts`.
The package index composes its existing public API; internal
components do not import it.

The shared [Timing subsystem](timing/README.md) supplies clocks, coarsening,
and time-origin calculations below Fetch and Browlet. Its only dependencies are
Infra and Web IDL Core. `TimingEnvironment` describes the existing owner's time
origin, isolation boolean, and timing operations. Browlet's environment forwards
those operations to Timing's functions; callers and Performance retain that same
owner without a separate timing object. The browser selects the origin and
isolation policy; Timing retains the shared epoch estimate.
The Performance API stays in Browlet and consumes Timing and DOM events.
Event and EventTarget form the shared
component in `browlet/dom/events`, below HTML scripting; its implementation
modules import each other directly. The [UI Events hierarchy](browlet/interaction/events/ROADMAP.md)
lives in `interaction/events/` as a foundation below DOM nodes,
separate from the higher interaction producers, following the navigation/storage
event pattern. DOM dispatch uses Event's `isMouseEvent()` predicate and retains
only a type reference to MouseEventImpl. HTML handler activation
uses DOM's `EventListenerCallback` with Binding-supplied callback-realm metadata, so DOM
owns current-event bookkeeping for handlers and ordinary listeners alike. The
event component retains only type references to HTML/node owners. XHR's
ProgressEvent lives in browser integration and reuses that event machinery.

Interaction groups keyboard values, mouse delivery, pointer processing, Pointer Lock,
wheel delivery, and Selection in their named folders. The root index composes their
exports. Event classes stay in the lower `events/` foundation. `mouse/legacy/` is
also a separate foundation: Document imports its narrow entry point without loading
`mouse/input.ts`. Pointer state/capture/streams and Pointer Lock precede the mouse
coordinator in the import hierarchy. Folder moves do not change the retained
UserAgent, Document, and top-level-context state owners. Each feature keeps its
implementation evidence and remaining work in its own `ROADMAP.md`.

UserAgent lazily owns SystemClipboard in interaction/clipboard. The controller
owns a session value for change IDs, while Document owns the pending-focus flag.
Explicit native/focus entries queue Document-associated user-interaction tasks;
DOM's trusted-event factory and Binding retain event and array realm ownership.
A single host snapshot supplies canonical MIME types and a per-write token.
StorageKey owns its byte encoding, reusing the UUID carried by each opaque origin;
Clipboard combines it with the session/token and hashes to 128 bits. Native
snapshot access, persistent read consent and HTML system focus remain named
throwing dependencies. HTML's future focus transition calls the explicit
Document notification; neither activity nor visibility substitutes for focus.
For trusted copy/cut/paste, SystemClipboard.fireEvent runs within an admitted
caller's task and returns cancellation, copied item data and clear bookkeeping.
A native-only ClipboardDataTransferImpl subclass uses the existing DataTransfer
binding, tracks native paste lifetime, and detaches in finally after dispatch.
Other transfers acquire no clipboard state. Target selection and native paste
preparation remain named throwing dependencies. SystemClipboard.runAction owns §8
admission and default/canceled branching; its required source distinguishes native
UI from script commands. Menu adapters use queueAction, while keyboard default
actions reuse their keydown task. Native writes report a generation change before
notification is queued. Rendering/editing/native-format effects remain explicit
throwing methods until their owners exist; no editor façade or Document state was
introduced. Synthetic dispatch does not enter the action layer.
ClipboardItem owns author-supplied representations under serialized MIME keys,
including the custom-format discriminator, with the already-converted internal
Promises supplied by Binding. Its environment owns result promises and newly
created Blobs; supplied Blobs keep their original identity and realm. MIME parsing
and UTF-8 encoding use their existing subsystem owners. There is no new registry,
callback adapter or native clipboard state in an author item. SystemClipboard's
readItems(document, unsanitizedTypes) now creates system clipboard items from one
metadata snapshot. Each item owns a copied generation token, original item index
and Document, MIME-to-OS-format map, read policy, and pending/settled typed promises. A null
index retains the draft's missing-origin case and rejects on lazy access. The
internal create factory allocates without author promises; the projected
constructor still requires a nonempty converted record. Full canonical MIME keys
keep parameters and custom formats distinct. For system clipboard items, getType
checks generation and Document focus/activity before cache reuse, byte access and
result delivery. It uses parallel work and the existing clipboard task source.
Result Blobs/promises belong to the item realm, while Binding owns projection
and exceptions. These items reuse their reads when written. readItemMetadata maps
one generation-bound format snapshot, appending decoded custom types to the first
eligible item. readFormatSnapshot takes a required includeCustomMap flag: item
metadata requests the map; plain-text reads do not. readFormatSnapshot,
readItemBytes and prepareReadData remain explicit throwing operations for the
adapter and rich-format owners. Lazy access passes
the saved OS format with its MIME key rather than looking up a new custom map;
no live OS handles or reverse registry enter Binding.
Clipboard format algorithms take an explicit ClipboardPlatform. ClipboardFormat
represents predefined Windows IDs or format names; registered OS IDs remain with
the adapter. Standard MIME translation and complete custom-format names are pure
algorithms in interaction/clipboard/formats.ts, with no implicit OS selection,
format registration or clipboard access. custom-formats.ts decodes A.5 maps and
prepares A.6 payload/name pairs plus UTF-8 JSON through the owning environment’s
captured JSON operations. Write preparation validates canonical MIME uniqueness
and the 100-format limit before returning a batch. SystemClipboard.writeItems
now selects one explicit platform and assembles standard representations plus a
custom batch for each selected item, retaining its presentation style and Blob
identities. Standard format collisions reject within an item; separate items may
reuse formats. getPlatform and optional getAdditionalFormat remain throwing host
queries. writeFormats receives all prepared items together and still throws for
OS encoding, format registration, capacity validation and the collective commit.
Navigator lazily owns ClipboardImpl, an EventTarget in the same environment. Clipboard.read captures the calling task's §9.1 permission facts,
uses the environment's parallel queue, and settles on the existing permissions
source for denied access or the new clipboard source for native completion.
Focus/activity checks retain the original Document before access and delivery.
The native Paste provenance query remains a throwing SystemClipboard dependency;
there is no new permission registry or implied persistent read grant.
Clipboard.readText shares the same admission/delivery helper. Its
SystemClipboard.readTextData(document) operation now selects the first standard
text/plain format from readFormatSnapshot(document, false), preserving the item's
original index. It reads only that payload through readItemBytes; no custom map
or ClipboardItem is needed. ClipboardTextSnapshot retains the copied generation
alongside string/Blob data or null for absence. The byte path copies data into a
Blob in the receiver's environment; Clipboard preserves strings and reuses File's Blob.text
UTF-8 decoding. SystemClipboard.validateRead shares the lazy-item activity/focus
and generation checks before access and after bytes arrive. The final clipboard
task rechecks the original Document and generation after decoding, even for absent
text. Stale data rejects InvalidStateError, lifetime loss rejects NotAllowedError,
and unreadable text rejects NotFoundError. Missing owner dependencies remain
observable rather than becoming data failures.
Clipboard.write captures §9.2 activation/native Cut-or-Copy facts during the
calling task and requests consent through the existing Permissions subsystem.
ClipboardWritePermission supplies the two descriptor levels and their relationship;
UserAgent installs it in its existing store. Public queries and write admission
apply the relationship without another registry or changes to store matching.
The existing host permission prompt defaults to denial. Native provenance still
throws. ClipboardItem.getWriteData resolves author representations without routing
through getType's different rejection policy. Clipboard keeps item grouping,
presentation style and custom-format identity, joins all selected data, prepares
rich formats, and commits once. SystemClipboard.supportsMultipleItems,
prepareWriteData and writeFormats are explicit throwing dependencies for the
item model, sanitization/codecs, and OS writing. Clipboard tasks recheck the
original Document's activity/focus before preparation, commit and delivery;
the adapter must also recheck immediately before an asynchronous native effect.
Changed commits use the existing change-notification route, with the same native
adapter echo-suppression requirement as event-driven writes. Clipboard.writeText
shares the write admission helper and commit method. It creates one
text/plain;charset=utf-8 Blob with unspecified presentation, using existing UTF-8
encoding and File's native line-ending conversion on CRLF hosts. Non-Windows
line endings are preserved. It does not require ClipboardItem representation
promises or rich-format preparation; SystemClipboard.writeItems maps its
parameterized plain-text Blob before reaching the same writeFormats host boundary.

Document lazily owns `SelectionImpl` in `interaction/selection/`, below DOM nodes.
Selection retains one public live Range and, only for cross-root spans, two internal
collapsed Ranges tracking its composed endpoints. Range directly references Selection through
a type-only import and reports boundary adjustments through its existing mutation
paths. Clearing Selection explicitly detaches every Range association. Future document.open
reset must detach those old associations before replacing the Selection.
Selection compares its prior endpoints; Document owns the coalescing flag and queues
selectionchange with its explicit Document/task-source association. The post-unlink
notification also clears selected shadow endpoints when their host is disconnected.
Binding preserves the Selection receiver's realm and the selected Range's identity.
Selection's collapse operations replace its Range and explicitly detach the old
notification link. Composed snapshots use DOM's StaticRange in the Selection's
realm, rescoping shadow endpoints according to the supplied roots. extend and
setBaseAndExtent use the same replacement path and retain anchor/focus direction
separately from ordered endpoints. Cross-root state reuses live DOM Ranges without
a second mutation registry or relaxing Range's single-root invariant. A notification
flag distinguishes automatic DOM adjustment, which preserves the composed span,
from explicit public Range edits, which replace it. Hidden endpoint changes also
schedule selectionchange. A completed state-preserving DOM move notifies the existing
Selection once before moving callbacks, so it can reorder the retained endpoints,
reverse direction, and refresh the same public Range without discarding the span.
Selection's extend and collapse operations retain their ordinary-Range rules and
replace the composed span; every replacement/clear detaches its hidden trackers.
selectAllChildren uses the same replacement path with direct child offsets. modify
keeps DOMString conversion in Binding and validates the specified tokens before
calling an explicit editing/text-layout dependency for rendered caret movement and
resolved bidi direction; that dependency currently throws without changing state.
Input/editing, rendering, and document.open reset remain separate owners in the
[Selection roadmap](browlet/interaction/selection/ROADMAP.md).

The global's retained `PerformanceImpl` owns its per-type Timeline buffers and
an ordered Set of registered observers; replacing the public `performance` value does
not replace that internal owner.
Buffers retain entry implementations. Binding projects query results and keeps
each entry's platform identity. Observers own their callbacks, options lists, and pending batches;
Binding supplies conversion and projects the static supported-types array in its
getter's realm. Buffered replay feeds the observer's pending batch. Performance
owns one coalesced delivery task per global; it snapshots observer membership and
drains each live batch before invoking its converted callback. Binding supplies
callback projection, exception reporting, and checkpoints. Entry queueing applies
producer admission independently to observer batches and capacity-limited global
storage. Resources queue observers first, then enter resource-specific storage
once. Performance also owns their secondary FIFO and pending overflow task;
the existing event machinery lets handlers clear or grow the primary buffer
before pending entries are promoted or discarded. Neither promotion nor discard
changes the already queued observer batch.
The same retained Performance owns its Window's current navigation ID;
entries preserve captured IDs, and non-Window owners use zero. Timing producers,
early ID capture, and soft-navigation advancement remain separate work in the
[Performance roadmap](browlet/performance/ROADMAP.md).

`PerformanceResourceTimingImpl` retains Fetch timing/body records prepared for
exposure and converts shared-clock observations using its own environment's
time origin. Missing observations remain zero; borrowing another Window's getter
does not select another clock. Fetch retains the completion timestamp on the
shared clock and preserves overall duration when hiding detailed timing. An
explicit timing-exposure flag controls the entry's transfer-size result; it does
not replace Fetch's TAO/CORS filtering. The environment forwards completed Fetch
records to its retained Performance, which owns resource storage, overflow, and
observer delivery.

Document lazily owns `LegacyMouseProcessor` in `interaction/mouse/legacy/`, a foundation
that uses event machinery and type-only node references without loading higher
input producers. All primary pointer types share its effective mouse position.
It snapshots flat-tree ancestor chains for compatibility boundary transitions;
DOM still owns dispatch, realm allocation, and target/relatedTarget retargeting.
Removal notifies existing state immediately after unlinking, with the former
parent, so recovery uses ancestry at removal time and survives reinsertion.
It allocates no state during removal, and state-preserving moves bypass the hook.
Document destruction clears retained targets and per-pointer-type suppression.
The §§10.2–10.3 mapper now brackets primary pointer dispatch: it updates mouse
boundaries before down/move/up and maps ordinary mouse events afterward.
A temporary selected target is retained before pointer boundary callbacks so
the same removal hook can repair the later mouse target. Canceled primary downs
suppress ordinary mouse events until up/cancel, independently of boundary and
activation events. The stream requires separate hover capability and mouse
click-count inputs; neither is inferred from pointerType or pointer detail.
Non-hover input uses the draft's immediate interleaving without gesture buffering.
Synthetic dispatch does not enter this machinery. The mouse producer queues button
actions as HTML user-interaction tasks and supplies a focusing continuation only
for an uncanceled mapped mousedown. Native input adapters, hit testing, click
counting, and focus/editing/drag default actions retain their explicit owners.

Document also lazily owns `WheelInputProcessor` in `interaction/wheel/`. Its
normalized input entry snapshots receipt data/time and queues user-interaction
tasks. The adapter identifies gesture starts and ends; the processor retains the
initial target across continuing/momentum updates. The existing post-unlink input
notification clears removed wheel targets without allocating unused state.
Inactivity invalidates queued input even if the Document is reactivated; destruction
also removes its tasks. DOM builds the dispatch path once, then an internal callback
observes effective non-passive listeners before delivery to choose cancelability.
Only uncanceled delivery requests the default action, using private input rather
than author-modifiable event properties. Hit testing and scrolling/zooming remain
named throwing owner dependencies. Pointer Lock supplies the actual locked target
and frozen coordinates. Device normalization,
native gesture timing, and cross-Document routing precede this internal entry.

UserAgent lazily owns `MouseInputProcessor` in `interaction/mouse/input.ts`, above
the event and legacy-mouse foundations. One aggregate mouse source supplies button
state across Windows; each input action snapshots that state at receipt, before
independent event loops can run their tasks in a different order. The processor
reserves mouse ID 1, explicitly permitted by Pointer Events, in each existing
top-level stream map. It adds no reverse registry. It allocates actual events at
the selected target, preserving creation realm separately from the current view.
The entries accept normalized button and position actions, not projected DOM
events or OS-specific records. A shared-clock reading is retained at receipt;
the existing realm timestamp facility maps it to each event's creation realm.
Unbatched movement delivers secure raw input before pointermove and mapped
mousemove, updating Window's coordinate history once. Raw listeners can change
capture or layout before the following move selects its target.
The adapter's context-menu flag selects press or release timing. The processor
dispatches a trusted contextmenu using private input and the triggering pointer
target, then requests native UI only if uncanceled. The menu precedes any click
from that transition and does not process capture again. The Pointer Lock query
reads UserAgent's controller. Layout targeting, HTML activation/focusing, and
native menu UI remain named throwing dependencies on this owner.
Tests control those dependencies and drive the real queue/stream/Binding/listener path. A native GUI
adapter and WebDriver Actions connection remain separate integration work.

UserAgent owns `ActivePointers` in `interaction/pointer/active-pointers.ts`. These retained input
sources own button state and primary-pointer selection independently of event
snapshots and Window lifetimes. They carry no author-visible pointerId: the
producer must separately map sources to IDs within each top-level context.
Activation/retirement and button transitions are implemented. `PointerCapture`
in `interaction/pointer/capture.ts` separately owns one pointer stream's pending
and effective targets. `PointerEventStream` composes that capture state with its
context-local ID, current buttons, and active Document. `TopLevelTraversable`
retains the active streams in `pointerEventStreams`, shared with its descendant
documents and cleared by top-level teardown. Individual Document.destroy() calls
the existing top-level owner to clear only that Document's capture, boundaries,
last-input view and button/activation history. This silent lifecycle cleanup
keeps the stream ID/device state and surviving Documents' targeting state.
The mouse producer registers ID 1; other device registration and retirement
remain with their future producers.
Author construction/dispatch cannot create these streams.
UserAgent's source collection retains no DOM targets. Element's public capture
methods resolve the receiver's current top-level context, reject unknown IDs,
and delegate to the stream. Their Pointer Events partial declaration remains
with the interaction owner; Binding performs the ordinary long conversion and
receiver-realm exception handling. Pending capture is visible immediately.
DOM removal notifies the top-level stream owner once after unlinking, before
removal steps. Its existing stream scan repairs previous boundary targets along
their retained dispatch paths and releases disconnected pending capture. It
dispatches no events and retains no reverse target registry.
Effective capture remains until processing, with loss at the reconnected element
or, if still disconnected, its Document. State-preserving moves bypass this hook.
Capture processing uses the target's existing DOM event creation and dispatch,
copying the triggering input attributes into a fresh notification in the target's
realm. Target preparation records current input buttons before capture callbacks,
so capture requests during pointerup see the released state. It processes capture
before selecting the effective target or invoking a required hit-test callable;
only down/move/up update the
stream's active Document. Direct-manipulation down events then request implicit
capture before listeners. The input owner supplies that device capability and
a required Pointer Lock query; requests check connectivity, lock state, pressed
buttons, and the active Document before changing pending capture. Geometry remains
the layout owner's dependency. `dispatchToTarget()` consumes the prepared,
realm-owned event and selected target, sends boundary notifications, dispatches
the input, and records its previous target. Raw delivery first checks the selected
target document's secure-context classification and retains no rejected input.
Native up attribute preparation zeros pressure before capture processing.
DOM dispatch has an optional internal path-capture callback before listeners;
pointer delivery retains only that path's nodes
for removal recovery after DOM clears the event's transient state. It does not
retain DOM path metadata's secondary targets or Window references. One private,
reusable event implementation holds input fields without being projected or
dispatched, protecting later cancellation from author reinitialization. Suppression
creates a fresh trusted cancel event, releases capture, and exits. After up, the
producer's required hover-target query returns the current hit target or null for
non-hover input/outside the context; the stream restores boundaries after loss
notifications and retains the over event's path for removal recovery.
The stream separately retains the press target and a reusable, unprojected down/up
snapshot with its actual target and capture state. `dispatchActivation()` consumes
those facts after release without processing capture again or changing boundary
state. It selects the live common ancestor for uncaptured click/auxclick, crossing
slots and shadow hosts, and preserves the interaction target for captured releases
and contextmenu. `PointerEventImpl.createActivation()` allocates at the selected
target, copies only mouse/UI input, and leaves pointer-specific defaults; the
stream supplies the retained pointer ID/type, while non-pointer producers keep
the reserved -1/empty identity. Gesture qualification, click count, and current
keyboard state remain explicit producer responsibilities.
`updateAfterLayout()` performs one stationary-pointer boundary pass with a required
hit-test callable and caller-realm timestamp. It generates no move event; the
layout/input owners must arrange invalidation, coalescing, and subsequent passes.
Mouse registration, queued delivery, DOM-removal recovery and individual
Document cleanup are connected. Recursive/inactive Document destruction remains
HTML §7.5.10 work; its lifecycle integration must preserve the existing cleanup.
Other devices still need ID assignment, registration/retirement and delivery
through these stream operations.

UserAgent lazily owns one `PointerLock` shared by its Documents. The controller
retains lock state, a weak per-Document API-release exemption, and an Infra
parallel queue. Element/Document APIs delegate to it; the DocumentOrShadowRoot
mixin owns getter retargeting. Bindings supply conversion and relevant-realm
Promise/error projection; element user-interaction tasks notify then settle.
Mouse/capture and wheel queries read this owner; successful acquisition releases
pending capture through existing stream methods. Acquisition supplies frozen
screen/client coordinates; MouseInputProcessor.queueRelativeMove accepts measured
deltas and reuses the existing pointer/mouse pipeline. A locked-delivery flag
suppresses mouse boundaries, retaining pointer dispatch and the locked activation
target. Generations discard queued input after lock changes; exit resets unlocked
motion history. Native effects and HTML focus are explicit throwing dependencies;
the focus query lives on Document.hasFocus(), not the PointerLock controller.
Document's existing removal notification asks UserAgent to release its already-created
controller's disconnected target, without allocating a controller on unused paths.
Queued requests recheck their original Document and focus before acquisition;
notification tasks retain the affected Document across adoption. Native unlock/
focus-loss signals and HTML teardown remain unfinished in the [Pointer Lock roadmap](browlet/interaction/pointer-lock/ROADMAP.md).

Native stream delivery accepts an optional `PointerEventSamples` input containing
coalesced and predicted snapshots. `PointerEventImpl.initializeSampleLists()` creates
independent events through the selected target's event factory, preserving measured
input while assigning the parent's pointer identity. Unbatched move/raw delivery
has one coalesced sample; predictions are optional and limited to pointermove.
The producer supplies chronological timestamps in the parent's time coordinate.
DOM's Event target setter invokes an overridable target-change hook; PointerEvent
uses it to maintain both sample lists across retargeting and shadow cleanup.
DOM does not import the pointer implementation. Author redispatch clears only the
parent's trust, so its sample targets and trust remain unchanged by that dispatch.
Device batching, raw/move correspondence, prediction, and queue order remain
explicit input-producer dependencies.

`DirectManipulation` captures one contact's touch-action permissions before author
delivery. It reads Stylelet's computed values through the owning documents and
requires layout facts for applicability, scroll containers, and local pan directions.
It retains permission bits, not DOM targets, style values, or live layout callbacks.
Pan restrictions stop at the nearest inclusive scroll container or child-document
boundary; zoom restrictions continue through embedding elements. The first recognized
pan direction fixes acceptance for the contact, with reversal subject to the frozen
axis restrictions. The producer separately elects to consume input and calls
`PointerEventStream.suppressForDirectManipulation()` before viewport takeover. That
guard requires a delivered down with no later up/cancel; author cancellation does not
alter it. Native gesture recognition, actual layout/viewport operations, and multi-touch
grouping remain unfinished, and Stylelet's existing shadow-scope query stub still throws.

MouseEvent and PointerEvent initialization consume a required `MouseEventInput` snapshot:
screen/viewport coordinates already mapped to CSS pixels, held buttons, and
modifier state. It does not discover an adapter or device state. The static
creation algorithms use the target's existing event-allocation facility; inherited
UIEvent initialization selects the current view and clears trust through DOM's
reset operation. The producer establishes trust and supplies event-specific data
before dispatch. These facilities do not change author constructors or register
input sources. `MouseEventImpl.create()` supplies both cancelable and
non-cancelable creation through explicit bubbles/cancelable arguments, matching
the PointerEvent factory's callable shape.

MouseEvent-to-PointerEvent creation likewise uses the source's selected target
for allocation. It copies inherited mouse/UI fields through the base copier,
retaining fresh pointer/dispatch state and the new realm's creation timestamp.
The caller supplies bubbles/cancelable explicitly; input conversion does not
infer firing policy or create an active pointer.

HTML's `eraseAllEventListenersAndHandlers()` is an EventTarget operation.
Each target retains one nullable `eventHandlers` association. Concrete targets
construct their map with one complete name-to-event-type table, composed once
per target type and shared without mutation. Handler records are allocated
only on assignment or content-attribute input. GlobalEventHandlers and WindowEventHandlers
are declaration-only mixins: their member bindings call the existing target
resolver and handler map directly. They need no separate implementation objects
or per-name forwarding accessors. Other interfaces retain their implementation
setters when those own additional behavior, such as starting a MessagePort.
Pointer Events contributes its handler names and a partial GlobalEventHandlers
declaration from `interaction/events/pointer-event-handlers.ts`. Each includer
composes the names into its shared table once, without per-instance merging or
mutating HTML's original table. SecureContext controls raw-update IDL exposure;
its content attribute still uses HTML's ordinary handler pipeline in insecure
contexts. Native raw delivery retains its separate secure-context gate.
Each includer's handlers share one map. The inherited erasure
method deactivates the associated map before removing listeners. DOM retains only
a type reference to HTML's map, with no runtime import or handler registry. Targets without
handlers allocate no map. DOM's separate `removeAllEventListeners()` operation
continues to remove registrations only. The later `document.open()` algorithm owns
selecting the Document's shadow-including inclusive descendants and associated Window.

Handler target selection is an EventTarget operation overridden by HTMLElement
for body/frameset forwarding. It resolves the current node Document on access,
so adoption changes the alias without moving or erasing the old Window's handler.
Forwarded handler values and listeners stay on the Window's map. Their callback adapter checks
the actual invocation target's environment, independently of the element's binding
realm and the callback's realm. The Window handlers and six Window-reflecting body
handlers use this path; ordinary HTML element `onclick` stays local. Beforeunload's
special invocation rules remain in the scripting roadmap.

Web Storage's `storage/events` is a separate component below DOM nodes and
`storage`. Document's legacy event factory imports that narrow entry point;
StorageEvent retains only a type reference to Storage. The feature's higher-level
`storage/web-idl.ts` collects the event, Storage, and Window mixin declarations.
Window composes `WindowSessionStorageMixin` and `WindowLocalStorageMixin` and
forwards its storage getters to them. The mixins acquire the substrate's bottle
maps and retain the resulting Storage objects in the associated Document's
holders. Document's Storage dependency remains type-only. Acquired maps retain
their bottle and shelf for quota accounting; writes check those owners before
mutation without re-acquiring storage through the Window's current settings.
UserAgent weakly tracks live Storage objects for broadcast discovery, including
objects retained after Document replacement. Mutations queue recipient-owned
StorageEvents through the existing DOM-manipulation task source; the registry
does not retain storage maps or introduce another scheduler.
WindowEventHandlers binds `onstorage` to Window's existing `EventHandlerMap`
for callbacks and listener registration. The declaration-only mixin does not
create storage objects or add another delivery path.
The EventHandler declaration's callback adapter checks the receiving environment's
BiDi policy and the callback realm's Document activity before invocation. Web IDL
retains that callback's realm and author identity; the handler map does not receive
Binding Context or discover ownership through a registry.

Policy and CSP sit below the node implementations that construct and retain their
state. CSP's `source-expressions.ts` provides matching shared with Permissions Policy;
the matching algorithms need only Infra and URL.
Their event and report implementations depend on DOM events and shared
Reporting, which sit below policy. CSP keeps type references to supplied Documents
and environments without loading their concrete classes. Document retains policy
initialization; the complete browser environment generates reports above those owners.
Before an incoming global exists, CSP instead captures response metadata and
Reporting-Endpoints using its UserAgent. Its reports use the browser's reporting
scheduler and sandbox execution without assigning a parent/departing global as
their client, event target, or observer owner.

Browlet's style mixins sit among its lowest foundations: they load Stylelet and
retain type references to supplied DOM nodes. Element and style/link elements
compose these mixins; the mixins do not construct browser environments or nodes.

HTML microsyntaxes are value algorithms depending only on Infra and Stylelet's
color facilities. They sit one level above Browlet's platform, DOM infra,
and style foundations, below DOM nodes and lifecycle components.
Tree lookup belongs with its HTML consumer: hash-name parsing returns text,
while image-map lookup lives under `dom/nodes/html/embedded` and consumes that parser.
Embedded HTML element classes participate in the cooperating node implementation
family, including element selection and Web IDL declaration collection. The earlier
separate layer contained only image-map lookup; it no longer describes this family.

Element declarations carry optional `namespaceURI` and `localNames` metadata.
These identify public interfaces. The node family's element lookup derives its
namespace/name mappings from the HTML, SVG, and MathML declaration collections.
Shared-interface tags list their concrete classes in `implementation`, each with
a static `localName`; the interface supplies their namespace. Small families live
beside their interface declaration, without empty intervening implementation
classes. The 51 tags exposing HTMLElement stay in their topic folders, while
`html/web-idl.ts` declares their shared interface above `HTMLElementImpl` and
collects the complete HTML declaration set.
That base remains the implementation for autonomous custom elements, and
`HTMLUnknownElementImpl` remains the unknown-name fallback. Assembly links each
class to one public interface; all automatic instance members use property lookup
on the concrete receiver. Explicit member bindings can select a base algorithm.
There is no separately maintained
tag-to-constructor table.
Document selects a constructor and uses `env.constructNode()` for allocation;
Binding's internal construction uses the registered implementation or its nearest
declared base. Namespace and unknown-name fallbacks remain element-selection
rules. Declaration tests check that each specialized constructor is registered
for its tag. Typed class references remain available when one declared class
covers every implementation; unrelated classes can reference the same implementation
array used by their declaration, preserving the union of their instance types.

`dom/nodes/element-definitions/` owns the shared tag IDs, content categories and model
rules, and sanitization metadata types. It sits below the node implementations
and retains only type imports of supplied nodes. Text, HTML, SVG, and MathML
consume this vocabulary; tag-specific values remain on the concrete prototypes.
ElementImpl exposes each element's categories, declared content model, and small
child-content queries. The definitions folder owns transparency resolution in
`content-model.ts` and paragraph discovery in `paragraphs.ts`, using supplied
nodes through type-only imports. HTML attribute permission and tag omission stay
on HTMLElementImpl; sanitization policy stays with the sanitizer.

`dom/nodes/html/attributes/` owns shared HTML element attribute definitions and
closely related state rules. This directory sits above microsyntaxes and below
node implementations in the dependency hierarchy despite its physical location.
Microsyntaxes retain generic keyword/state interpretation; `html/reflection/`
owns reusable reflection machinery. Element implementations select the attribute
definitions; resource lifecycles remain in the loader and their HTML consumers.
Shared attribute rules do not retain elements or environments.

HTML declarations retain `[Reflect]` annotations; Browlet's `[ReflectEnumerated]`
spells out prose-defined reflection limited to known values, and `[ReflectTokens]`
identifies DOMTokenList reflection through a shared attribute definition. Web IDL Core owns
these annotation records and declaration helpers. The helpers tag reflection
records with `kind: 'reflection'`, so the HTML hook selects them directly without
a registry of annotation names. Numeric defaults and ranges are
nested on their applicable reflection annotation; serialization expands them into
HTML's separate `[ReflectDefault]` and `[ReflectRange]` syntax. They carry enumerated
and token-list definitions as `unknown`; declaration tests check those definitions
and reflection constraints. Browlet supplies
`htmlExtendedAttributeHooks` from `integration/web-idl/bindings/` when constructing its
`BindingWorld`. Its `prepareAttribute` hook prepares accessors once after resolving declaration
types, retaining them across realm registrations without mutating declarations.
`BindingWorld` alone owns the prepared-accessor map. Realm registration retrieves
accessors from that world; `RealmBinding` does not retain another map reference.
Preparation receives all declaring or including interfaces for each member. HTML
selects ordinary or internal attribute operations from each owner's implementation
class through adapters in `integration/web-idl/bindings/reflection-target.ts`, so accessors
need no Element/ElementInternals discriminator at invocation.
Declaration tests check the owner contracts. Shared mixins retain one preparation
and projected-array cache across their includers.
Generic Web IDL supplies the extension point; HTML owns the reflection rules.
The same attribute hook retains MessageEvent's frozen ports array in its receiver
realm, replacing it only when initialization supplies a new implementation snapshot.
The same composition supplies `prepareHTMLConstructor`: HTML selects definitions
and consumes construction stacks, while Web IDL retains the prepared overrides,
passes constructor identities, selects platform prototypes, and projects objects.
Definitions and stacks remain with CustomElementRegistry/Element; the active
constructor-to-registry map belongs to WindowAgent. Public registration, upgrade,
and reaction delivery must still supply and complete those lifecycles.
Element owns token views and explicit weak element associations. Internal callers
and reflected bindings use the same `TokenListAttribute` record, containing the
attribute name and supported tokens; lookup never supplies a separate optional configuration.
The integration
owns cached projected frozen arrays. Binding's existing converters supply their
receiver realm and element projection. Internal HTML algorithms read raw
attributes/state or the specified associated-element methods, never the projected
reflection getter. ElementInternals owns separate associations and the read/write/delete
operations over its target element's internal attribute map;
ordinary DOM attribute changes leave those associations intact. `[CEReactions]`
entry/exit surrounds the originally specified member steps after author argument
conversion, not the lower-level mutation primitives.
Reaction delivery remains unimplemented; the new attribute-preparation hook does
not provide a no-op reaction handler or yet wrap operation/setter/deleter steps.

Lazy-loading continuation state belongs to the image, iframe, and media element
implementations; video retains an additional poster continuation. Document owns
one internal Intersection Observer, with concrete implementation targets and
entries. Its provisional implementation owns callback/options, ordered targets,
Element registrations, and queued entries. Rendering input, complete entry
objects, and scheduled notification remain unfinished; observing a target never
guesses its visibility. The implementation will consume real rendering inputs
and the existing rendering-update phase. UserAgent supplies the implementation-defined
scroll margin. The element uses its original environment's scripting policy and
its current node document's browsing-context association after adoption.

Document, Element, and the HTML, SVG, and MathML element implementations live
under `browlet/dom/nodes`, alongside their element-selection table. Namespace
directories retain their indexes and declaration collections. `NodeImpl` owns
its tree links directly and extends `EventTargetImpl`; tree storage is part of
the node implementation, not DOM's independent name and ordered-set helpers.
HTML custom-element names and registry machinery live under
`dom/nodes/html/custom-elements` with that same family. Parsing remains a separate
consumer under `browlet/html/parser`;
HTML's remaining roadmap-only areas keep their provisional locations.

NodeList, HTMLCollection, and HTMLAllCollection stay with the node family; form
and options collections stay beside their concrete element owners.
[DOMStringList](browlet/dom/lists/string-list.ts) is independent string storage below
nodes, alongside the other standalone DOM interfaces. Its associated list's
owner determines updates; Document ancestor origins retain a serialized snapshot.

`NodeImpl` keeps raw link operations private, so subclasses and parser consumers
use its ordered insertion/removal/adoption path and node-specific extension
steps. Structural mutations update live Range and NodeIterator participants;
CharacterData replacement, text splitting, and normalization also update live ranges.
Nodes create mutation records through one ordinary-ancestor walk. Observers own
registrations, transient detached-subtree cleanup, record queues, and converted
callbacks. `WindowAgent` owns the pending-observer and signal-slot sets and queues
one notification through its existing EventLoop. DOM's structural Agent view
does not add an owner or scheduler. Notification snapshots both sets, drains each
observer immediately before its callback, and then dispatches slot-change events.
Shadow assignment and custom-element reactions remain unfinished. Their
remaining behavior and the recorded compatibility choices are listed in the
[nodes roadmap](browlet/dom/nodes/ROADMAP.md).

Ranges and traversal occupy explicit layers below nodes. Their mutation
participants retain concrete node types and operate on supplied instances;
type-only dependencies do not load node implementation classes. Future Range
parsing and geometry integrations must be reviewed against those boundaries.

A partial interface/dictionary/namespace amends its primary implementation.
Keep each contribution as a separate partial declaration with its feature owner,
or beside the primary declaration until that owner exists. Its implementation
members belong to the primary object, which can delegate cohesive state and
behavior to an owned object, as Window does with `WindowIdleCallbacks`. Binding
still targets the primary object's members. An external package can export a
declaration contribution and use an explicit integration seam. A stateful interface mixin
gets a `FooMixin` composed into each includer. Includers forward its members through
their own API; callers do not need access to the composed mixin. Declaration-only
mixins need no runtime class. Binding projects this complete implementation graph.

Use `Impl` for a projected implementation, `Record` for a distinct record role,
`Value` for retained converted values, `Steps` for callable algorithms,
`Capability` for narrow cross-owner behavior, and `Host`/`Port` for external
effects. `Context` needs cohesive identity or lifecycle; `Environment` names a
real environment. Avoid generic `Semantic`/`Resolved` substitutes for these roles.

Dictionary implementation types use their specified names, such as
`CSSStyleSheetInit` and `GetRootNodeOptions`. Their fields describe converted
values; a convenience API may accept `Partial<CSSStyleSheetInit>` and supply
defaults before entering the implementation. A mechanical `Record` suffix adds
no distinction here. Keep meaningful record names such as `URLRecord`.
Shared environment foundations use `Base`, as in
`BrowletEnvironmentBase` and `FetchEnvironmentBase`.

Keep `index.ts` barrels export-only. A subsystem's `web-idl.ts` collects its
declarations for assembly and can own declarations without an implementation
owner. Individual declarations stay beside their implementations; the barrel
re-exports the collection.

## Review and evidence

Tests should exercise pure algorithms directly, implementation behavior with
post-conversion inputs, and author conversion/realm identity through real
bindings. Fake only the narrow capability or Host Port under test. Integration
tests must prove that the provider is actually connected. Use functions for
ordinary `Browlet.evaluate()` tests.

Architecture refactors should reduce concepts and call depth, or identify the
new invariant requiring growth. Repeated conversion, platform round trips,
service discovery, and miniature runtime test doubles are reasons to inspect
a boundary, not automatic reasons to add another abstraction.

### Review markers

| Marker | Meaning and disposition |
| --- | --- |
| `SPEC_MISMATCH: <original signature>` | Non-obvious, unreviewed callable/record changes; remove after acceptance. An owning environment or a straightforward conversion to an instance method needs no marker. |
| `SPEC_CLASH(identifier)` | Competing spec passages or browser behavior; retain the chosen rule and evidence until the conflict resolves. |
| `SPEC_GAP(identifier)` | The specifications leave a behavior unanswered; retain the question, evidence, and chosen/pending rule. |
| `TODO` / `PROVISIONAL` | Missing implementation or temporary integration, owned by the relevant roadmap. |
| `UNUSED` | No production consumer; investigate the intended consumer before deleting work. |
| `ACCOMMODATION(identifier)` | A substitute for a missing runtime primitive; document consequences, tests, and what to remove when replaced. |
| `DEVIATION(identifier)` | Deliberate departure without an existing clash record; do not double-label the same choice. |

Use stable kebab-case identifiers. Put caller contracts in JSDoc and spec URLs
and implementation rationale in ordinary comments. Keep local invariants near
the code; retain decision evidence and replacement conditions in the owning
roadmap or [limitations catalog](LIMITATIONS.md). New regressions remain ordinary
failures until a maintainer approves their classification. Completed journals and
obsolete designs remain in Git rather than accumulating in the current architecture.
