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

One private binding record connects those identities without changing the
implementation's class prototype. Its `BindingWorld` supplies the identity
scope; its realm binding supplies prototypes and member functions. Browlet's
composition root owns one main world spanning its hosted realms. HTML Agents
own execution and event loops; AgentClusters define shared-memory boundaries.
Neither is the owner of platform-object identity. Separate worlds need a real
isolated-world or separate-runtime consumer.

Each registered realm has one `RealmBinding`. `BindingContext` is its public type,
exposing boundary operations without adding another object or lifecycle.

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
| HTML [`EnvironmentRecord`](browlet/scripting/environment.ts) | Concrete early browser state: identity, owner, creation/security state, readiness, and partition derivation |
| [`JSEnvironment`](js-engine/environment.ts) | `realm: JSRealm`, `exec: RealmExecution`, and `queueNetworkingTask(steps, destination)` for a JavaScript execution owner |
| [`DOMEnvironment`](browlet/dom/environment.ts) | `realm: EventRealm` and `exec: EventExecution` for event timing and allocation |
| [`ScriptingEnvironment`](browlet/scripting/environment.ts) | Realm-only view for HTML algorithms such as structured data |
| [`FetchEnvironment`](fetch/environment.ts) | Extends FetchEnvironmentRecord and JSEnvironment with Fetch execution facilities and client settings |
| [`BrowletEnvironment`](browlet/scripting/environment.ts) | Full browser environment; extends EnvironmentRecord and satisfies Scripting, JS Engine, DOM, Fetch, Stylelet, and Selectlet contracts |
| `WindowEnvironment` | Specializes BrowletEnvironment with its Window and live queries of the associated Document |
| `SandboxEnvironment` | Implements the same binding contract for internal execution; unavailable browser client settings throw explicitly |

The early HTML record intentionally has no realm or `exec`. It is not an
ECMAScript lexical Environment Record. A reserved navigation client can use it
for partitioning and security before full settings exist. BrowletEnvironment
inherits the class and preserves the reservation's identity and security
classification; it is not a wrapper around a second settings object.

Interfaces do not provide method implementations. Shared browser behavior such
as `determineNetworkPartitionKey()` lives directly on HTML's EnvironmentRecord.
Portable contracts describe that behavior without making Fetch depend on HTML.
Use the same approach for other owners; introduce inheritance or a mixin only
for an actual shared implementation, not to simulate multiple class inheritance.

### Realm execution

[`RealmExecution`](js-engine/realm-execution.ts) groups facilities belonging to
one execution owner: Promises, buffers, JSON, microtasks, background scheduling,
task delivery, abort construction, and structured data. JS Engine defines the
contract; [`createExecution(realm)`](browlet/scripting/environment.ts) constructs
the realm facilities. [`createBoundExecution(context)`](browlet/bindings.ts)
adds the bound Promise, DOM allocations, and structured data at the composition
root. Defining a contract below HTML does not transfer ownership of HTML
algorithms to JS Engine.

Subsystems declare independent execution contracts. Web IDL Core's
[`WebIDLExecution`](web-idl/core/execution.ts) supplies `DOMException` through
its `DOMExceptionConstructor` contract, and DOM's
[`EventExecution`](browlet/dom/environment.ts) supplies event allocation.
`BrowletExecution` combines these with `RealmExecution` and `StyleletExecution`
on the same `env.exec` object. JS Engine does not depend on Web IDL; Core does
not depend on JS Engine. Web IDL's realm and callback environment contracts
remain in its full entry point.

Fetch's `FetchExecution` combines engine facilities and Web IDL exception
construction on `FetchEnvironment.exec`. Fetch receives the existing environment
as its execution owner; the request's optional client remains a separate selection.
The same `FetchEnvironment` contract supplies base URL, origin, policies, and
UserAgent when used as client settings. BrowletEnvironment implements it directly.

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
Browlet supplies `URLImpl`; standalone composition captures the native constructor
or accepts a supplied provider. Stylelet retains only the `StyleletURL` contract
(`href`) and passes the selected constructor through CSS value contexts. Resource
URLs resolve at the computed stage; serialization formats the resulting value.
CSSOM URL attributes expose strings, so these internal URLs require no platform
projection. Stylelet does not import the URL implementation or its runtime graph.
Stylelet also uses Encoding Core's portable label lookup and canonical encoding
type. Its existing UserAgent supplies `EncodingCapability.decodeText(bytes, fallback)`:
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
The constructor's result uses Core's shared `DOMException` contract for
`name`, `message`, and `code` while retaining the host-created exception.
Infra's `TimerHost` describes a native wake-up request returning a `TaskHandle`.
`remove()` cancels pending work; native timer tokens remain private to the
provider. Hosts may limit requested delays, so consumers enforcing a deadline
must recheck their clock. Browlet supplies its Node provider explicitly to
`GlobalTimers`, which retains HTML activity, deadline, and ordering rules.
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

`DOMOperations` distinguishes the host's node, element, attribute, document,
document-fragment, and shadow-root types. Its predicates narrow those roles, and each lookup
accepts only the receiver kinds it supports. Engine internals use opaque role
types with an optional, type-only symbol; no node is tagged or inspected through
that symbol. CSSOM retains element or processing-instruction owners through the
corresponding opaque roles. The separate [standard adapter](infra/dom-standard.ts) owns the
structural browser interfaces it reads, including separate form and media views.
Browlet's adapter supplies concrete implementation types instead.

### Construction and lifetime

[`createWindowEnvironment()`](browlet/bindings.ts) assembles the early record,
WindowRealm, binding, execution, and full settings before constructing Window
with that environment. Binding registration
accepts an environment factory because execution composition needs the new
Binding Context. Declarations and their binding world name one environment type;
that type supplies the realm type too. The factory returns the actual environment;
declarations subsequently obtain it through `ctx.getEnvironment()`. A standalone
binding needing only a realm can return `{ realm }` from its environment factory.
Event construction captures the binding in an execution facility, without
attaching it to Realm. Event targets require that facility through their constructor's
environment; document factories pass their environment explicitly to node constructors,
which forward it through the inheritance chain. Standalone
EventTarget implementation tests can supply a real sandbox environment; Document
tests need browser settings for its HTML operations. Every target retains one
`env` field. Derived implementations can narrow its declared type to the stronger
contract their constructor requires, without adding another field or owner lookup.
Global projection and global-scope mixin setup finish before consumers receive the Window environment.
Document creation retains its own HTML initialization steps.

`Realm.hostDefined` permits the absence of HTML settings; `Realm.env` requires
them and throws if they are unattached. Each UserAgent constructs its sandbox
eagerly, with a real Realm, Agent, event loop, and SandboxEnvironment, but no
Window, Document, or attached HTML settings object. It supplies execution for
retained browser work such as Reporting uploads and retains that UserAgent explicitly.
SandboxEnvironment extends BrowletEnvironment so binding declarations retain
their full contract. Passing no browser record leaves its creation URL and
standalone UserAgent unavailable; guarded accessors throw rather than return
incorrectly typed nulls. Origins, API base URLs, policies, module maps, ancestry,
time origins, and Window/Worker global-scope state also fail explicitly.
Top-level associations and reporting/referrer sources are null. Window
construction still requires a complete EnvironmentRecord.

Fetch makes three separate choices: the request's client supplies policy and
lifetime state; `FetchParams.env` supplies execution; the callback destination
selects a global or parallel queue. A null client does not imply missing
execution. Early records, full settings, and sandbox environments must not be
substituted for one another just because an algorithm can reach a UserAgent.

The global-scope mixin owns each global's timers, Reporting state, and resource
associations. BrowletEnvironment supplies settings, execution, and browser context.
UserAgent owns shared transport, caches, credentials, stores, and BiDi hooks;
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
`env.queueNetworkingTask()` accepts an explicit global or parallel queue, so
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

[Browlet's bindings](browlet/bindings.ts) and
[integration modules](browlet/integration/README.md) are explicit composition
boundaries. They can know both sides of a dependency and capture Binding Context
in boundary closures. Ordinary algorithms cannot rediscover collaborators
through the assembled bindings singleton. Outside Web IDL, mark genuine binding
integration with `BINDING_INTEGRATION:`; unresolved implementation leakage uses
`TODO(BINDING_INTEGRATION):`.

Interface serialization and transfer steps live beside their implementations and
attach to the Web IDL declaration through portable contracts. HTML supplies the
active clone's traversal and identity memory; Binding supplies platform identity
and target construction. These hooks need no separate capability registry.

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

A partial interface/dictionary/namespace amends its primary implementation.
Co-locate its members when practical; an external package can export a declaration
contribution and use an explicit integration seam. A stateful interface mixin
gets a `FooMixin` composed into each includer. Declaration-only mixins need no
runtime class. Binding projects this complete implementation graph.

Use `Impl` for a projected implementation, `Record` for specification records,
`Value` for retained converted values, `Steps` for callable algorithms,
`Capability` for narrow cross-owner behavior, and `Host`/`Port` for external
effects. `Context` needs cohesive identity or lifecycle; `Environment` names a
real environment. Avoid generic `Semantic`/`Resolved` substitutes for these roles.

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
| `SPEC_MISMATCH: <original signature>` | Unreviewed callable/record shape; remove after acceptance. An owning environment alone needs no marker. |
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
