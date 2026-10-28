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

Declared proxy values such as WindowProxy use an implementation handle internally.
Their binding declaration supplies `getHandle()` and `getProxy()` to convert
between public proxies and their retained handles. Receiver resolution selects
the handle's current platform target at invocation; retaining a handle does not
freeze that target.
Untyped `any` and `object` values keep their JavaScript representation.

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
Explicit getters receive both the receiver's environment and the invoked getter's
environment, keeping receiver state distinct from current-realm checks.

HTML's `CrossOriginObjectBinding` lives at the same integration boundary and owns
cross-origin descriptors. The current proof of concept uses interface
`[CrossOriginObject]` and member `[CrossOrigin]` annotations to select its objects
and permissions. `htmlExtendedAttributeHooks.prepareSecurityCheck` prepares each
protected interface's invocation policy once when the binding world is assembled.
Permission records and Window-name lookup share the assembled declarations,
including their partials and mixins. Realm supplies allocation and execution
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
| [`StorageEnvironment`](storage/environment.ts) | UserAgent, creation URL, and an origin when available; usable before realm creation |
| [`FetchEnvironmentBase`](fetch/environment.ts) | Extends the Storage view with top-level partition inputs and `determineNetworkPartitionKey()` |
| HTML [`BrowletEnvironmentBase`](browlet/environment.ts) | Shared browser state before and after realm creation: identity, owner, creation/security state, readiness, and partition derivation |
| [`JSEnvironment`](js-engine/environment.ts) | `realm: JSRealm`, `InternalPromise`, background work, and task delivery for an existing owner |
| [`StreamsEnvironment`](streams/environment.ts) | Extends JSEnvironment with DOM abort creation and HTML structured-data operations |
| [`FileEnvironment`](file/environment.ts) | Extends the Streams view with native line endings for Blob text processing |
| [`DOMEnvironment`](browlet/dom/environment.ts) | `realm: DOMRealm` for event behavior and the associated-document query; its Window specialization exposes the Agent's DOM notification state; `createEvent()` supplies event allocation |
| [`FetchEnvironment`](fetch/environment.ts) | Extends FetchEnvironmentBase and FileEnvironment with Fetch task delivery, exception allocation, and client settings |
| [`BrowletEnvironment`](browlet/environment.ts) | Full browser environment; extends BrowletEnvironmentBase and satisfies JS Engine, DOM, Fetch, Stylelet, and Selectlet contracts |
| `WindowEnvironment` | Specializes BrowletEnvironment with its Window and live queries of the associated Document |
| `SandboxEnvironment` | Implements the same binding contract for internal execution; unavailable browser client settings throw explicitly |

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
function calls. The A-to-B callback-registration investigation is skipped pending
review of its observer and translation of HTML's examples; see the
[audit record](browlet/scripting/ROADMAP.md#html-8133-explicit-context-experiment).
Native interception of arbitrary author frames remains parked.

`UserAgent.webDriver` owns the BiDi remote-end command algorithms, whose completion
uses `InternalPromise` through `UserAgent.HostPromise`. `PageEvaluation`
owns Browlet's Node convenience API above that boundary. Its existing local source
evaluator remains in use until the driver's Await operation, protocol values,
and target/session lifecycles are connected. Retained classic execution now runs
through JSRealm on both stock and addon contexts. Navigation currently notifies
the local evaluation clients through a UserAgent-owned weak map; cancellation and
Node callback reinstallation are convenience behavior, not BiDi events. The
[automation boundary](browlet/automation/README.md) records this temporary path and
the explicit driver dependencies; there is no fallback from failed driver commands.

HTML's per-global scripting state belongs to global implementations, described
by [`BrowletGlobalObject`](browlet/scripting/global-object.ts). Window initializes
it directly without changing EventTarget inheritance or projecting internal
fields onto the author-facing object. Worker/worklet global implementations must
provide the same state. Module maps remain settings-owned; import maps are a
separate per-global record. `env.globalImplementation` selects that internal
global state; `env.global` remains the platform global used for author execution
and task routing. Neither lookup copies state or moves it onto the environment.

HTML's source-text and synthetic module records retain Node-shaped module objects,
supplied by Node or the addon; the addon's native handles remain private.
JSRealm compiles, inspects requests, links supplied dependencies, evaluates, and
reads namespaces; V8 owns bindings, cycles, and top-level await. HTML converts
the native completion Promise through `env.InternalPromise`. CSS module creation
uses the environment's binding-supplied `projectCSSStyleSheet()` before retaining
the author-visible export. This does not change Stylelet's host-neutral state.
Automatic dependency loading and module-specific context/async restoration are
still explicit dependencies; supplying a graph does not implement those hooks.

`BrowletEnvironment.reportException()` combines that global's reporting flag with
DOM ErrorEvent dispatch. The realm's existing reporting callback and Window's
`reportError()` method forward directly to it. ErrorEvent lives beside the
other DOM events, keeping scripting foundations independent of DOM implementation
imports. Classic runners report before their modeled realm context is popped,
but that context has no script; parse failures also have no script record.
They therefore pass their script explicitly. Other callers use the modeled
running-script lookup. An unattached browser realm rejects reporting with an
InternalError; internal sandboxes deliberately retain console-only diagnostics.

Rejected-promise state also stays on each global. The environment's
`trackPromiseRejection()` translates HTML's rejection hook using the modeled
running script and current settings; `notifyAboutRejectedPromises()` schedules
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
[`createBrowletEnvironmentInit(context)`](browlet/bindings.ts) supplies
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

[`Browlet`](browlet/browlet.ts) constructs UserAgent, which creates its sandbox
through [`bindings.ts`](browlet/bindings.ts) and exposes that module's
Window-environment factory. Bindings assembles environments for existing owners;
it does not construct UserAgent or serve as an implementation service entry.
UserAgent creates Window Agents; bindings creates the sandbox Agent.
Each receives an EventLoop constructed with its host-turn callback. The loop
creates its engine microtask queue, reads the shared clock, and schedules work as
it arrives, without a separate start phase or per-turn options. Realm construction
requires its owning Agent. Browsing algorithms call their UserAgent's Window
factory; existing objects use their retained `env`, realm, and WindowProxy handle. Document allocation
uses `env.createDocument()`, preserving binding-owned allocation without
passing Binding Context into the lifecycle algorithms. Main-world inspection for
tests lives in `test/support/browlet-binding.ts`.

[`createWindowEnvironment()`](browlet/bindings.ts) assembles the environment base,
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
[`browlet/environment.ts`](browlet/environment.ts), above Scripting's realms and
event loops. The complete environment constructs its
own `InsecureRequestsPolicy` and calls Reporting's
[`generateReport()`](browlet/reporting/generate.ts) with its live settings.
These are owned state and a browser algorithm, not additional constructor dependencies.
Reporting selects concrete report bodies; UserAgent owns outbound delivery.
Generation remains a separate, higher-level Reporting entry because policy report
bodies depend on the base classes exported by Reporting's shared barrel.
Scripting's realms and event loops retain only type references to these browser
environments. HTML structured-data algorithms use the full `BrowletEnvironment`;
their standalone tests compose a real `SandboxEnvironment` with its execution
facilities instead of supplying a separate realm-only environment view.

`BrowletRealm.hostDefined` permits the absence of HTML settings; `BrowletRealm.env` requires
them and throws if they are unattached. UserAgent composition creates its sandbox
eagerly, with a real BrowletRealm, Agent, event loop, and SandboxEnvironment, but no
Window, Document, or attached HTML settings object. It supplies execution for
retained browser work such as Reporting uploads and retains that UserAgent explicitly.
SandboxEnvironment extends BrowletEnvironment so binding declarations retain
their full contract. Passing no environment base leaves its creation URL and
standalone UserAgent unavailable; guarded accessors throw rather than return
incorrectly typed nulls. Origins, API base URLs, policies, module maps, ancestry,
time origins, and Window/Worker global-scope state also fail explicitly.
Top-level associations and reporting/referrer sources are null. Window
construction still requires a complete BrowletEnvironmentBase.

Fetch makes three separate choices: the request's client supplies policy and
lifetime state; `FetchParams.env` supplies execution; the callback destination
selects a global or parallel queue. A null client does not imply missing
execution. `FetchRequest(url, env)` retains its owner independently and starts
with a null client. Initiating algorithms assign the client explicitly when
they have one; reporting can retain the sandbox owner with no client. Cloning
and preflights preserve both choices. Reserved clients, full settings, and sandbox environments must not be
substituted for one another just because an algorithm can reach a UserAgent.

The [global-scope mixin](browlet/global-scope.ts) composes each global's timers,
Performance object, Reporting state, and resource associations. It sits above
the scripting foundations and is not re-exported by their barrel.
BrowletEnvironment supplies settings, execution, and browser context.
UserAgent owns outbound report delivery, shared transport, caches, credentials, stores, and BiDi hooks;
that state can outlive one Window. Follow those existing associations instead
of adding reverse lookups or duplicate lifetime flags.

## Scheduling and asynchronous work

HTML owns tasks, activity gating, and checkpoint policy. JS Engine supplies the
microtask-queue backend; Node wake-ups do not choose HTML ordering. Each HTML
Agent's event loop shares its queue with the Agent's realms.
[The event-loop architecture](browlet/scripting/EVENT-LOOP-ARCHITECTURE.md) owns
the detailed contract and backend accommodations.

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
[fonts](fonts/ROADMAP.md), [graphics](graphics/ROADMAP.md),
[animation](animation/ROADMAP.md), and [layout](layout/ROADMAP.md). They own their
data and algorithms; Browlet connects document state, policy, scheduling, and
presentation. Stylelet owns CSS processing and [Typed OM](stylelet/cssom/typed/ROADMAP.md).
These folders establish responsibility, not new Environment/Context APIs.
Style/layout feedback needs explicit update ordering and invalidation, not
reciprocal engine imports or ambient service discovery.

[Browlet's bindings](browlet/bindings.ts) and
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

`browlet/browsing` groups three components with separate named entry points:
`navigation`, `window`, and `policy`. Navigation owns browsing contexts,
navigables, document creation, and session-history state. Window owns Window,
WindowProxy, and Location. Their consumers use the corresponding component's
index; cooperating modules within navigation import each other directly.
There is no umbrella browsing barrel.

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

[`import-hierarchy.mjs`](../scripts/eslint/import-hierarchy.mjs) records the reviewed
component order for import layout and dependency review. Imports put external
packages first, then other subsystems and foundations (Infra, JS Engine,
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
`environment.ts` and `context.ts` remain deliberate named entries. The package
index composes its existing public API; internal components do not import it.

Browlet's [timing foundation](browlet/timing/README.md) supplies shared clocks,
precision, and time origins without importing DOM or Performance. The Performance
API consumes timing and DOM events. Event, EventTarget, and the UI Events
specializations form one component in `browlet/dom/events`; its implementation
modules import each other directly. XHR's ProgressEvent lives in browser
integration and reuses that event machinery.

Policy and CSP sit below the node implementations that construct and retain their
state. Their event and report implementations depend on DOM events and shared
Reporting, which sit below policy. CSP keeps type references to supplied Documents
and environments without loading their concrete classes. Document retains policy
initialization; Reporting's separate generator and the complete browser environment
remain higher consumers.

Browlet's style mixins sit among its lowest foundations: they load Stylelet and
retain type references to supplied DOM nodes. Element and style/link elements
compose these mixins; the mixins do not construct browser environments or nodes.

HTML microsyntaxes are value algorithms depending only on Infra and Stylelet's
color facilities. They sit one level above Browlet's platform, timing, DOM infra,
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
`htmlExtendedAttributeHooks` from `integration/web-idl/` when constructing its
`BindingWorld`. Its `prepareAttribute` hook prepares accessors once after resolving declaration
types, retaining them across realm registrations without mutating declarations.
`BindingWorld` alone owns the prepared-accessor map. Realm registration retrieves
accessors from that world; `RealmBinding` does not retain another map reference.
Preparation receives all declaring or including interfaces for each member. HTML
selects ordinary or internal attribute operations from each owner's implementation
class through adapters in `integration/web-idl/reflection-target.ts`, so accessors
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
[DOMStringList](browlet/dom/string-list.ts) is independent string storage below
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
members belong to the primary object. An external package can export a declaration
contribution and use an explicit integration seam. A stateful interface mixin
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
