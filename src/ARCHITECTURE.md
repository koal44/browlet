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

| Contract or class | What it supplies |
| --- | --- |
| [`StorageEnvironment`](storage/environment.ts) | UserAgent, creation URL, and an origin when available; usable before realm creation |
| [`FetchEnvironmentRecord`](fetch/environment.ts) | Extends the Storage view with top-level partition inputs and `determineNetworkPartitionKey()` |
| HTML [`BrowletEnvironmentRecord`](browlet/environment.ts) | Concrete early browser state: identity, owner, creation/security state, readiness, and partition derivation |
| [`JSEnvironment`](js-engine/environment.ts) | `realm: JSRealm` and `exec: RealmExecution` for a JavaScript execution owner |
| [`StreamsEnvironment`](streams/environment.ts) | Extends JSEnvironment with DOM abort and HTML structured-data execution contracts on `exec` |
| [`FileEnvironment`](file/environment.ts) | Extends the Streams view with native line endings for Blob text processing |
| [`DOMEnvironment`](browlet/dom/environment.ts) | `realm: DOMRealm` for event behavior and the associated-document query; its Window specialization exposes the Agent's DOM notification state; `exec: DOMExecution` for event allocation |
| [`FetchEnvironment`](fetch/environment.ts) | Extends FetchEnvironmentRecord and FileEnvironment with Fetch task delivery, exception allocation, and client settings |
| [`BrowletEnvironment`](browlet/environment.ts) | Full browser environment; extends BrowletEnvironmentRecord and satisfies JS Engine, DOM, Fetch, Stylelet, and Selectlet contracts |
| `WindowEnvironment` | Specializes BrowletEnvironment with its Window and live queries of the associated Document |
| `SandboxEnvironment` | Implements the same binding contract for internal execution; unavailable browser client settings throw explicitly |

[`BrowletRealm`](browlet/scripting/realm.ts) extends `JSRealm` with HTML ownership,
callback lifecycle, and task routing; `WindowRealm` specializes it for a Window global.

The early HTML record intentionally has no realm or `exec`. It is not an
ECMAScript lexical Environment Record. A reserved navigation client can use it
for partitioning and security before full settings exist. BrowletEnvironment
inherits the class and preserves the reservation's identity and security
classification; it is not a wrapper around a second settings object.

Interfaces do not provide method implementations. Shared browser behavior such
as `determineNetworkPartitionKey()` lives directly on HTML's BrowletEnvironmentRecord.
Portable contracts describe that behavior without making Fetch depend on HTML.
Use the same approach for other owners; introduce inheritance or a mixin only
for an actual shared implementation, not to simulate multiple class inheritance.

### Realm execution

[`RealmExecution`](js-engine/realm-execution.ts) groups JavaScript facilities for
one execution owner: Promises, errors, buffers, JSON, microtasks, background
scheduling, and task delivery. Infra's [`execution.ts`](infra/execution.ts)
separately defines `AbortExecution` and `StructuredDataExecution`; these
contracts have no dependency on DOM, HTML, or JS Engine. The corresponding
algorithms remain in DOM and HTML.

`StreamsExecution` combines realm facilities with these execution contracts.
`FileExecution` extends it with `nativeLineEnding`, required by Blob processing
and supplied by the host. They describe the same `env.exec` object; there are no
additional execution objects or forwarding layers. Operations that only need
JavaScript facilities, such as releasing an existing reader, keep `JSEnvironment`.
[`createBrowletExecution(context)`](browlet/bindings.ts) composes the complete
browser execution object, including the bound Promise, DOM allocations, Fetch
task delivery, and structured data. Standalone `AsyncExecution` does not require
abort or structured-data facilities.
`BrowletExecution` implements the existing `DOMNodeFactory` contract, shared by
its Documents, and supplies `createAbortSignal()`. Both establish binding
ownership during allocation, before a different realm can first project the result.

Subsystems declare independent execution contracts. Web IDL Core's
[`WebIDLExecution`](web-idl/core/execution.ts) supplies `DOMException` through
its `DOMExceptionConstructor` contract, and DOM's
[`DOMExecution`](browlet/dom/environment.ts) supplies event allocation.
`BrowletExecution` combines these with `RealmExecution`, `FetchExecution`, and `StyleletExecution`
on the same `env.exec` object. JS Engine does not depend on Web IDL; Core does
not depend on JS Engine. Web IDL's realm and callback environment contracts
remain in its full entry point.

Fetch's `FetchExecution` combines File/Streams facilities, Web IDL exception
construction, and `queueGlobalFetchTask(global, steps)` on `env.exec`.
Fetch's `queueFetchTask(steps, destination, env)` selects parallel-queue or global
delivery; HTML supplies the global route. Fetch receives the existing environment
as its execution owner; the request's optional client remains a separate selection.
The same `FetchEnvironment` contract supplies base URL, origin, policies, and
UserAgent when used as client settings. BrowletEnvironment implements it directly.
Request CSP violations use the client's `exec.reportCSPViolation(policy, request)`.
Fetch treats the policy as opaque; Browlet's composition validates it and supplies
the concrete environment to CSP's violation construction and reporting.

Implementations use `env.exec`. It exposes no Binding Context, realm object,
callback adapter, conversion API, or projection registry. Supply lifetime
dependencies last to constructors and pass the same environment to derived
implementations. Supply an invocation-selected environment last to the operation
instead. Deserialization reconstructs values using the destination environment.
Realm-neutral backing storage such as `BlobData` needs no retained environment.

An environment may forward a useful operation such as `parseURL()` to its
UserAgent. Do not put ordinary imports behind environment properties or copy
another owner's complete API into a facade. Stylelet consumes the existing
`StyleletEnvironment` view: `userAgent.dom` supplies host DOM operations,
`userAgent.URL` supplies URL construction, and `exec` supplies execution.
`getAssociatedDocument()` supplies the owning global's Document as Infra's
`DOMDocument`, or null for unbound and non-Window environments. Browlet forwards
the query to its realm; standalone engines already retain their explicit Document.
Browlet supplies `URLImpl`; standalone composition captures the native constructor
or accepts a supplied provider. Stylelet retains only the `StyleletURL` contract
(`href`) and passes the selected constructor through CSS value contexts. Resource
URLs resolve at the computed stage; serialization formats the resulting value.
CSSOM URL attributes expose strings, so these internal URLs require no platform
projection. Stylelet does not import the URL implementation or its runtime graph.
Stylelet also uses Encoding Core's portable label lookup and canonical encoding
type. Its existing UserAgent supplies `decodeText(bytes, fallback)`, typed as `DecodeText`:
Browlet forwards to Encoding's `decode`, while standalone composition supplies
the native decoder adapter. CSS retains fallback-encoding selection; Encoding
owns BOM override, byte decoding, and replacement handling. Encoding Core depends
only on Infra; Stylelet does not load the full codecs or their Node dependencies.
`RealmExecution` and `StyleletExecution` both extend
Infra's [`AsyncExecution`](infra/execution.ts) for Promise creation, background
work, and `queueTask(source, steps, options?)` delivery. The source keyword selects
a shared task source; `env.exec` selects the owning destination. Browlet's
[`scripting/tasks.ts`](browlet/scripting/tasks.ts) maps these keys to shared source
identities; HTML retains task queues and scheduling policy. Optional task metadata
carries timer nesting levels without moving timer initialization into Infra.
`StyleletExecution` also extends `WebIDLExecution`. Its supplied `DOMException`
constructor creates platform exceptions in the owning environment while CSSOM
implementations remain directly exposed. Full CSSOM member bindings must replace
this interim allocation with method-realm exception projection.
MediaList now follows that final arrangement: its implementation reports
Core DOMExceptionImpl failures, and its host binding realizes them in the
invoked method's realm. It no longer needs an environment solely for errors.
The constructor's result uses Core's shared `DOMException` contract for
`name`, `message`, and `code` while retaining the host-created exception.
Infra's `TimerHost` describes a native wake-up request returning a `TaskHandle`.
`remove()` cancels pending work; native timer tokens remain private to the
provider. Hosts may limit requested delays, so consumers enforcing a deadline
must recheck their clock. UserAgent supplies Browlet's Node provider through
`timerHost`; each global's `GlobalTimers` retains HTML activity, deadline, and
ordering rules.
Infra's `createAsyncExecution(timerHost)` composes standalone Promise observation,
background work, and task delivery around a supplied provider. Its `nativeTimerHost`
captures scheduling and cancellation together, retaining their original receiver;
it requires native timers only when scheduling work, not during module import.
Stylelet composes this shared execution with its host's DOMException constructor.
Standalone Stylelet composes native facilities without requiring HTML settings
or loading the engine runtime. `SelectletEnvironment` uses the same `userAgent.dom`
owner and currently needs no execution facilities. `SelectletContext` retains
that environment alongside its query state and caches. Stylelet and Selectlet share Infra's
[`DOMOperations`](infra/dom-operations.ts); standalone engines accept a `dom`
option and Browlet supplies its UserAgent's provider. Engines retain the host's
node identities and access their trees,
attributes, and live HTML state only through those operations. The standard
provider uses platform DOM APIs; [Browlet's provider](browlet/integration/dom.ts)
uses implementations, including class checks for HTML elements. There are no
per-node adapters or required fields on host nodes.
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
Computed-style results have their own blocks and remain owned by their callers,
not by the inline-style mixin. Until CSSOM projection owns indexed properties,
attribute input synchronizes the indices of an existing CSSOM object explicitly.
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

Stylelet whole values retain data, while whole-value definitions own shared
parsing, resolution, and serialization operations. Built-in property records pair
that value definition with inheritance and typed initial-value metadata; their
registry keys supply the property names. The records live in the property-family
modules. Custom-property registrations retain their own definitions and metadata.
Initial values remain shared Declared representations; resolution must not
mutate them. Engine defaulting and inheritance remain unfinished.
Property parsing returns values ready to retain in a declaration: ordinary
grammars prepare the Declared representation, while deferred forms retain
their syntax. Registered-property grammar validation waits until Computed.
Resolution receives stage and context at invocation. Serialization describes
the retained representation without resolving it or selecting a later stage.

Stylelet's StylesheetContext supplies rule grammar decisions to Syntax during
consumption. It retains the existing environment for CSSOM allocation and the
enclosing selectors for nested rules; it is per-parse state, not a host service
on the environment. Selector and property grammars receive that same object
directly. Child rule contexts retain the environment and constructed-sheet
status while selecting their enclosing
selectors. Declaration-block parsing accepts PropertyContext directly and does
not construct a CSSOM rule context.
Rule entry points and their consumers use StylesheetContext through a
type-only import and return CSSOM rules and interpreted property declarations.
Selector and value grammars declare their own context requirements; generic
consumer adapters and combinators preserve those requirements.
All parser entry points require an explicit context; root callers with no
settings pass `{}`. Consumers read and forward their context from TokenCursor.
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
uses `env.exec.createDocument()`, preserving the binding-owned node factory without
passing Binding Context into the lifecycle algorithms. Main-world inspection for
tests lives in `test/support/browlet-binding.ts`.

[`createWindowEnvironment()`](browlet/bindings.ts) assembles the early record,
WindowRealm, binding, execution, and full settings before constructing Window
with that environment. Binding registration
accepts an environment factory because execution composition needs the new
Binding Context. Declarations and their binding world name one environment type;
that type supplies the realm type too. The factory returns the actual environment;
declarations subsequently obtain it through `ctx.getEnvironment()`. A standalone
binding needing only a realm can return `{ realm }` from its environment factory.
Event construction captures the binding in an execution facility, without
attaching it to BrowletRealm. Event targets require that facility through their constructor's
environment. Character-data and document-fragment constructors take their environment
from their initial document; shadow roots use the host's current document. The node
retains that environment when adoption changes its document. Constructors whose
document and environment are independent, such as Range, retain both parameters. Standalone
EventTarget implementation tests can supply a real sandbox environment; Document
tests need browser settings for its HTML operations. Every target retains one
`env` field. Derived implementations can narrow its declared type to the stronger
contract their constructor requires, without adding another field or owner lookup.
Global projection and global-scope mixin setup finish before consumers receive the Window environment.
Document creation retains its own HTML initialization steps.

The early browser record and complete environment live together in
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
their full contract. Passing no browser record leaves its creation URL and
standalone UserAgent unavailable; guarded accessors throw rather than return
incorrectly typed nulls. Origins, API base URLs, policies, module maps, ancestry,
time origins, and Window/Worker global-scope state also fail explicitly.
Top-level associations and reporting/referrer sources are null. Window
construction still requires a complete BrowletEnvironmentRecord.

Fetch makes three separate choices: the request's client supplies policy and
lifetime state; `FetchParams.env` supplies execution; the callback destination
selects a global or parallel queue. A null client does not imply missing
execution. Early records, full settings, and sandbox environments must not be
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
and observation. `env.exec.Promise` supplies the owner's
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
| Execution or allocation for an implementation | Existing environment's `exec` |
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

Import across subsystems through the owner's index. Infra's independent modules
and test imports are exceptions; narrower indexes such as Web IDL Core are
deliberate entry points. Group code by responsibility and real consumers, not
by one folder per specification or one file per algorithm.

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
packages first, then other subsystems and foundations (Infra before JS Engine and
Web IDL), then sibling components, then the current component's collaborators.
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
Document selects a constructor and uses its existing node factory for allocation;
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
`BindingWorld`. Its `prepareReflectedAttribute` hook prepares accessors once after resolving declaration
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
no distinction here. Keep meaningful names such as `URLRecord`, `PropertyRecord`,
and `BrowletEnvironmentRecord`.

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
