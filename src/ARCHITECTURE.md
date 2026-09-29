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

Type implementation parameters for the values Binding actually supplies:
concrete implementations, converted dictionaries with defaults, and adapted
callbacks. Genuine Web IDL `object`/`any` and host-neutral DOM contracts remain
appropriate where specified. Do not widen an implementation to an ambient DOM
interface merely to make a direct test resemble author code.
Implementation classes need not satisfy their platform interfaces in `lib.dom`;
check author-facing types at the projected API boundary.

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
| [`BrowletEnvironment`](browlet/scripting/environment.ts) | Common HTML realm and composed execution view for full settings and sandboxes; `ScriptingEnvironment` is its realm-only view |
| [`FetchEnvironment`](fetch/environment.ts) | Extends both FetchEnvironmentRecord and JSEnvironment with the client settings Fetch consumes |
| HTML [`Environment`](browlet/scripting/environment.ts) | Extends EnvironmentRecord and implements FetchEnvironment; adds the realm, execution, timing, policies, and Fetch group |
| `WindowEnvironment` | Specializes Environment with its Window and live queries of the associated Document |

The early HTML record intentionally has no realm or `exec`. It is not an
ECMAScript lexical Environment Record. A reserved navigation client can use it
for partitioning and security before full settings exist. The full Environment
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
contract; [Browlet's execution integration](browlet/integration/execution.ts)
composes the engine operations with HTML and DOM behavior. Defining a contract
below HTML does not transfer ownership of HTML algorithms to JS Engine.

Subsystems can declare independent execution contracts, such as DOM's
[`EventExecution`](browlet/dom/environment.ts). `BrowletExecution` combines it
with `RealmExecution` on the same `env.exec` object; neither base contract depends
on the other.

Implementations use `env.exec`. It exposes no Binding Context, realm object,
callback adapter, conversion API, or projection registry. Supply lifetime
dependencies last to constructors and pass the same environment to derived
implementations. Supply an invocation-selected environment last to the operation
instead. Deserialization reconstructs values using the destination environment.
Realm-neutral backing storage such as `BlobData` needs no retained environment.

An environment may forward a useful operation such as `parseURL()` to its
UserAgent. Do not put ordinary imports behind environment properties or copy
another owner's complete API into a facade. Stylelet consumes the existing
`StyleletEnvironment` view: `userAgent.dom` supplies host DOM operations and
`exec` supplies execution. `RealmExecution` and `StyleletExecution` both extend
Infra's `AsyncExecution` for Promise creation and background work; the stylesheet
task destination uses Infra's `TaskScheduling`. Browlet composes these on the
same `env.exec` object.
Its provisional CSSOM exception factory preserves requests for method-realm
realization rather than eagerly allocating in the receiver's realm.
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

### Construction and lifetime

[`createWindowEnvironment()`](browlet/bindings.ts) assembles the early record,
WindowRealm, binding, execution, and full settings before constructing Window
with that environment. Binding registration
accepts an environment factory because execution composition needs the new
Binding Context. Declarations and their binding world name one environment type;
that type supplies the realm type too. The factory returns the actual environment;
declarations subsequently obtain it through `ctx.getEnvironment()`. A standalone
binding needing only a realm can register `{ realm }` directly.
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
them and throws if they are unattached. A UserAgent-owned sandbox has a real
Realm, Agent, event loop, and JSEnvironment, but no Window, Document, or HTML
settings object. It supplies execution for retained browser work such as
Reporting uploads. Optional host settings do not weaken full Environment types.

Fetch makes three separate choices: the request's client supplies policy and
lifetime state; `FetchParams.env` supplies execution; the callback destination
selects a global or parallel queue. A null client does not imply missing
execution. Early records, full settings, and sandbox environments must not be
substituted for one another just because an algorithm can reach a UserAgent.

The global-scope mixin owns each global's timers, Reporting state, and resource
associations. Environment supplies settings, execution, and browser context.
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
descriptor at exposure. Importing changes the view's constructor while retaining
the native backing and source conversion; subsequent results use the destination.
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
failures until Eric agrees otherwise. Completed journals and obsolete designs
remain in Git rather than accumulating in the current architecture.
