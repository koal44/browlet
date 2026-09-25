# Cross-subsystem composition architecture

This is the architectural vocabulary for composing Browlet's specification
subsystems. Read it before introducing an `Environment`, `Host`, service bag,
callback registry, or reverse lookup between packages. Update it when a new
integration demonstrates that one of these roles or decision rules is
incomplete.

This is the controlling target architecture, not a claim that every current
subsystem already follows it. The temporary migration ledger in
[PLATFORM-OBJECT-ARCHITECTURE.md](./PLATFORM-OBJECT-ARCHITECTURE.md#migration-ledger-temporary)
records known transitions.

For the object identities and conversion boundary between an implementation
and its author-facing JavaScript API, see
[PLATFORM-OBJECT-ARCHITECTURE.md](./PLATFORM-OBJECT-ARCHITECTURE.md). This
document describes the wider dependency graph around that boundary.

## One object model, several dependency roles

Browlet has two object-model layers:

| Layer | Owns |
| --- | --- |
| **Implementation** | Specification state, internal relationships, and algorithms |
| **Platform** | The realm-owned JavaScript objects visible to authors |

Binding connects **Implementation** and **Platform** through Web IDL conversion,
realm selection, identity, and projection. Cross-specification capabilities and
Host Ports supply implementation dependencies at a Composition Root. Binding
Context stays in Binding code. These are machinery and dependency roles within
the two-layer object model.

That distinction matters. A dependency edge explains how an existing
implementation obtains work it does not own. It must not manufacture another
representation of the same platform object.

Binding stamps a `PlatformRecord` onto an implementation instance through a
private field, independently of its implementation class. That record selects
the owning realm and retains the eventual platform object;
implementation methods still receive their execution dependencies explicitly
through `env.exec`. Stamping does not inject Binding Context into
implementation constructors or change their prototypes.
Creating the record runs inherited implementation initializers before attaching
the stamp. An initialized implementation can therefore remain unprojected.
During projection, Binding stamps the same record onto the platform object.
Each identity carries its record directly, without a platform-object lookup
map. Stamp lookup needs only the object. World APIs, receiver validation, and
conversion boundaries enforce ownership when accepting an object.

Infra's `Stamper` base supplies the shared constructor-return mechanism. Each
concrete stamper owns its private fields and record types in its subsystem;
Infra has no dependency on those records.

Binding's `PromiseProjectionStamper` attaches projection records to source
promises without adding public properties. The records preserve author Promise
identity per world, realm, result type, and allocation policy; Infra's `PromiseValue`
continues to carry only implementation execution state in its own fields.

## The actors

### Implementation

An implementation owns the state and algorithms assigned to its specification.
It works with implementation objects and other post-Web-IDL-conversion values.
It may directly import realm-neutral algorithms.

An algorithm can explicitly require a later Web IDL conversion, such as Encoding
converting a chunk received through a generic writable stream. Use a shared
context-free conversion at that specified point, with internal exception requests;
do not move it to the earlier author call or inject Binding Context.

It must not:

- accept or retain a Binding Context; conversion and projection belong in
  declarations and member bindings;
- wrap or unwrap platform objects;
- repeat author-facing conversion or overload selection;
- call an author API in order to recover an internal primitive; or
- reach through a registry to rediscover an implementation dependency which
  composition could have supplied explicitly.

### JS Engine

[`js-engine/`](./js-engine/README.md) is the engine substrate beneath Web
IDL. The `JSRealm` class exposes realm-owned globals, intrinsics, function and
iterator-result creation, buffer allocation/transfer, Promise observation,
and evaluation. It owns one backend context
(a `node:vm` context or a native context supplied by the compatibility addon),
while the private, isolate-scoped `JSRuntime` owns global-to-realm associations, the active
evaluation realm, and the shared ambient queue. Its module exposes named operations.
Each backend context's stable realm reference privately carries its `JSRealm`
through `RealmStamper`; native lookup and host hooks read that stamp
without a context registry, including after global-proxy detachment and reuse.
[`NodeAPI`](./js-engine/node-addons.ts) loads and types the optional backend methods;
the shared `addon` instance exposes typed calls and `getMethod(name)` for availability.
Direct calls to unavailable add-on operations throw; runtime operations choose
their documented stock-Node fallbacks before making those calls.
Operations that do not use isolate state are implemented directly as module
functions. The global association map covers VM globals and supplied global
objects/global-this values, including reassigned WindowProxies. Ordinary objects
use native creation contexts when available; plain Node stores known origins
through `RealmStamper`, with provisional prototype and evaluation evidence for
unrecognized values. These realm-lookup and allocation-recording functions are
selected once at module initialization. The runtime also
supplies `JSMicrotaskQueue` backends without owning their HTML
lifecycle: each EventLoop asks the runtime factory for one queue and shares it
with all Realms of its Agent. The factory selects an explicit queue under
compatible Node or stock Node plus the addon, or the one ambient fallback queue
under plain stock Node. Enqueue and
checkpoint operations travel together on that contract so the event loop
cannot mix queue backends.
Engine-specific built-in branding and internal-slot access also belong here;
the consuming specification retains the decisions it makes from those facts.
Collection iterators follow this rule: JS Engine owns native allocation and
the stock fallback; Web IDL supplies live iteration and per-step conversion.
The stock fallback carries private state on each Map/Set iterator, so another
realm's fallback method can recognize it without a realm-local state map.
For synchronous pair iterables, the providing subsystem exposes its current
entry tuples through `getEntryList()`; Web IDL owns the author iterator's index
and result projection. The iterator carries its private state; borrowed methods
recognize it across realms within the target's binding world.
For asynchronous iterable declarations, the providing subsystem creates an
internal iterator that owns its traversal state. Streams' `ReadableStreamIterator`
owns the reader and cancellation policy. The declaration names the implementation
factory and whether to expose `return()`. Web IDL adapts the internal iterator's
methods and owns author identity, call ordering, and result projection; it has
no dependency on Streams. That binding state lives privately on each author
iterator, retaining its owning `BindingWorld` to check world membership.
Internal iterator completions reach Binding without outgoing promise projection.
Binding observes them in the method's realm, converts the item, and resolves the
author's result Promise. Streams owns the explicit adoption of author thenable
chunks in its read steps.
Buffer inspection and writes are realm-neutral functions in `buffers.ts`;
allocation and native Promise observation use the selected realm's methods.
Composition exposes the required operations through `exec.buffers` and
`exec.promises`, without passing a realm into implementation algorithms.
Native hashing is a realm-neutral operation in `hash.ts`; consumers such as
SRI own algorithm selection and verification policy. It does not invoke the
public Web Crypto API or allocate author-visible results.
Infra owns internal simple-exception requests; their realization into
realm-owned errors remains [binding work](./PLATFORM-OBJECT-ARCHITECTURE.md#exceptions).

Asynchronous implementations receive Infra's `Promises` dependency for
allocation, adoption, and continuation placement. A realm owns one facility;
Binding supplies it through the owning environment at construction or operation
composition. Streams and Blobs retain that context and pass it to derived
streams and slices. Returned
`PromiseValue<T>` chains retain that destination, so `.then()` and `.observe()`
need no scheduling argument. Result conversion and projection remain Binding
work. Native backend I/O stays outside this implementation contract and hands
completion back through an explicit task or Promise import.

`Promises` itself accepts a Promise constructor and a native settlement
observer. It does not import JSRealm or JSRuntime; JSRealm composes it with its
own observation operation. Standalone hosts can reuse the same small internal
Promise implementation with native scheduling.

Stylelet's options contain `document`, `element`, `tree`, and `exec`
capabilities. Its document `StyleletContext` normalizes DOM callbacks and
retains the selected `ExecutionCaps` for promises, background execution, task delivery, and DOM
exception creation; it does not retain the options object. Standalone construction
selects one complete native execution provider when none is supplied. Cascades and
stylesheets receive that existing context instead of a separate execution argument;
declarations and media lists receive the owner's execution capabilities directly.
Browlet composes it from the Document owner's existing Promise facility, shared
background scheduling, DOM-manipulation task delivery, and neutral DOMException requests. Initial,
navigated, and author-constructed Documents supply those capabilities at construction.
This embedding contract does not expose Binding Context or require standalone
hosts to implement Browlet's unrelated execution facilities. Stylelet owns
`ExecutionCaps`: stylesheet task delivery and exception creation differ from the
members of `RealmExecution`. The typed `createStyleletExecution()` adapter checks
both contracts; changing a field on either side is caught at that boundary.
Their shared Promise machinery is already defined in Infra.

The HTML document parser receives its EventLoop and owning environment explicitly.
Node stream completion only queues an HTML networking task; parser waits and
load completion use `PromiseValue`. The public `Browlet.navigate()` bridges the
finished internal operation to a native Promise for its Node caller. That
outer Promise does not schedule the DOM lifecycle.

Host evaluation follows the same boundary. `Browlet.evaluate()` queues a page
command, awaits its page-owned result, and copies data back to Node.
`Browlet.exposeFunction()` keeps the callback in Node and installs a page
function returning a page-owned Promise. Callback completion queues a task
on that page's HTML event loop before settling the Promise. The
[automation boundary](./browlet/automation/README.md) owns this
transport and navigation cancellation; HTML retains task execution and
checkpoint policy. Direct Node/page object sharing is not its transport.

This is an asynchronous dependency, not a requirement on all stored values.
`BlobData` is runtime-neutral backing storage. A Blob or File implementation
retains a runtime for reading that storage, including when constructed by
multipart parsing or FormData. Deserialization supplies the destination runtime
without transferring the source object's runtime. A consumer that only chains an incoming
`PromiseValue` also needs no separate stored dependency.

The custom engine's job hooks follow the same division. JS Engine associates
opaque native context references with its existing realm objects and adapts
make/call and all three enqueue callbacks. Browlet installs the HTML policy at its
composition root: incumbent settings, callback cleanup, and Agent microtask
tasks stay in `scripting/host-hooks.ts` and `EventLoop`. Generic jobs use the
JavaScript engine task source; timeout jobs reach it through the global's
active-time timer primitive. These two handlers require HTML realms; Node
Promise jobs retain their native queues.
This mapping reports an engine identity;
it does not discover HTML collaborators from platform objects.

This is a dependency layer, not a fourth platform-object identity. Web IDL
extends the JavaScript realm contract with binding policy, and Browlet's HTML
`Realm` subclasses `JSRealm` to add its Agent, environment settings object,
callback lifecycle, and global task routing. Its `queueGlobalTask()` method
uses those existing owner links and captures the associated Document at queueing.
The global-scope mixin owns `GlobalTimers` and derives timer task delivery from
its settings object's realm. AbortSignal's declaration supplies its
timeout-scheduling dependency.
The JS Engine project must
not import Web IDL or HTML, and HTML event-loop state must not move into the
runtime merely because its concrete checkpoint primitive is Node-specific.
Web IDL's `BindingContext<Realm>` preserves that concrete host type through
declaration callbacks and realm registration without extending the minimal
Web IDL host contract with HTML-specific methods.

Window creation and navigation with the addon follow that division: the engine
allocates immutable objects and forwards native property operations; Binding
supplies interface members and Web IDL named-property behavior; HTML associates
the native WindowProxy with the current Window. The allocation passed into
Binding is a one-time construction input, not another environment or registry.
`createWindowEnvironment()` in Browlet's composition root constructs the Window,
allocates and binds its realm, and returns its complete `WindowEnvironment`.
That environment owns `realm`, `exec`, and `window`; engine allocation and Web IDL
projection retain their existing owners. The two Document creation algorithms
keep their own Document initialization.
See the [global-object notes](./PLATFORM-OBJECT-ARCHITECTURE.md#special-object-categories)
for the current adoption boundary.

### Binding

Binding machinery owns the Web IDL boundary:

- receiver and argument conversion;
- overload selection and dictionary defaults;
- callback invocation and exception policy;
- promise projection and settlement conversion;
- target-realm selection and exception realization;
- stable platform-object/implementation identity; and
- legacy indexed, named, and other exotic behavior.

It projects implementation state. It does not construct the state
which makes a subsystem work.

### Binding World

A Binding World is the lifecycle boundary for platform-object identity. It owns
the realm-to-binding WeakMap and can contain several realm registrations.
It also indexes host-defined interfaces once, sharing their realm-neutral hooks
with each realm binding.
Definitions and capability registrations can be shared across worlds, but a
platform-object association belongs to exactly one world.

Each Realm Binding owns its Binding Context, including runtime composition;
the world's index receives the binding only after declaration setup succeeds.

Browlet's composition root currently owns one main `BindingWorld` spanning the
realms in its Node VM. It is not owned by an HTML Agent: the host can synchronously
pass platform objects between Browlet realms associated with different agents,
and receiver unwrapping must continue to work. It is not owned by an AgentCluster:
that boundary governs shared memory, not platform-object identity. Future
isolated worlds or separate runtime instances can introduce additional worlds
without adding Binding state to either HTML concept.

### Platform

The Platform layer is the author-facing, realm-owned JavaScript surface. It
contains the interface objects, prototypes, properties, and exotic objects
required by the specifications. It is the result of projection, not the value
which internal algorithms should pass around.

### Binding Context

A Binding Context is one cohesive handle to a particular JavaScript/Web IDL realm.
Binding code operating in that realm shares its context. It carries
generic services whose behavior inherently depends on that realm, for example:

- the realm and its intrinsics;
- the binding/interface domain;
- conversion operations which an internal specification algorithm explicitly
  invokes;
- promise creation, reaction, and settlement;
- realm-owned function and exception creation;
- microtask integration; and
- realm-sensitive buffer allocation.

Binding Context belongs in code that connects implementation values to
realm-owned JavaScript objects. This includes declaration bindings, browser
composition, and structured cloning's platform-object handling. Implementation
algorithms receive ordinary values and explicit dependencies instead.

Outside Web IDL's binding machinery, label these uses with
`BINDING_INTEGRATION:`. Use `TODO(BINDING_INTEGRATION):` for an implementation
dependency that still needs removal or a boundary awaiting design review.
An `integration.ts` file is a useful home for capability resolution, but its
name does not justify passing Binding Context through implementation algorithms.

The `BindingContext` class in `web-idl/binding-context.ts` is instantiated once
per realm within a Binding World. `world.register(realm)` returns that context
directly. It retains the realm's binding and composed runtime, and provides
installation, conversion, construction, and projection methods. Browlet's
`getBindingContext(realm)` selects its main world's context; a realm can have
different contexts in different worlds.

Structured-data operations receive `BindingContext<Realm>` directly. They use
`ctx.realm` for allocation and `ctx.realm.agent.agentCluster` for shared-memory
identity; no separate structured-data environment duplicates that ownership.
Serializable capabilities operate on implementation instances. Their attached
binding records supply interface dispatch before or after platform projection;
serialization itself does not require a source platform object.
HTML's transferable module owns the private `[[Detached]]` marker on the
implementation instance; it is independent of Web IDL's platform record.

The exact TypeScript shape may evolve. The important property is its identity:
one shared context describes one binding realm. Several Binding Contexts can
belong to one Binding World. A subsystem must not
copy selected context operations into a private `FooEnvironment` merely to
rename or forward them.

Declared-member conversion and callback-adapter creation remain Binding work.
A converted callback adapter is a post-conversion value passed to an
implementation, not a service which that implementation recreates through the
Binding Context.

A Binding Context is also not a service locator for unrelated specification
subsystems. If an operation belongs to another owner, use a cross-specification
capability. If it reaches outside the runtime, use a Host Port.

Existing implementation uses are migration work, not a pattern to extend.
Move conversion and projection into declaration bindings, and supply execution
dependencies through the owning environment below. Track the remaining migration in the
[platform-object ledger](./PLATFORM-OBJECT-ARCHITECTURE.md#migration-ledger-temporary).

### Realm execution

`RealmExecution` groups the facilities composed for one owning realm/global:
Promises, buffer allocation, JSON parsing/serialization, microtasks, background
execution, task delivery, abort-controller and dependent-signal construction,
structured cloning/serialization/deserialization, and native-line-ending
configuration.
Its `global` identifies that owner when a specification selects it as a task
destination. In Browlet this is the Window platform object, distinct from its
Window implementation and the stable WindowProxy.
The neutral contract exposes no Binding Context, realm object, conversion,
callback adaptation, or platform-object registry.

The neutral contract and engine-owned buffer operations live in `js-engine/`.
HTML task policy, DOM aborting, and HTML structured data retain their
implementations in Browlet. `Environment` owns this contract as `exec`, alongside
its `realm` and browser state. Portable implementations accept `JSEnvironment`,
whose shared contract is `exec: RealmExecution`. Browser algorithms accept the
existing `Environment` when they need HTML state. Both use `env.exec`;
the browser environment satisfies the portable contract directly, without a
second environment object. Environment operations such as `parseURL()` can
forward to their owner; execution facilities remain grouped in `exec`.
Name environment parameters, locals, and stored references `env`, qualifying
them when multiple owners are in scope (`sourceEnv`, `targetEnv`). Keep type
and factory names descriptive, such as `JSEnvironment` and `createWindowEnvironment()`.

[`integration/execution.ts`](browlet/integration/execution.ts) assembles the
execution object during Window realm registration, reusing that realm's existing
Promise facility. The registration factory constructs the actual WindowEnvironment
and returns it to Binding; `context.getEnvironment()` retains that same object.
Binding-dependent closures are assembled here; neither Environment nor
portable implementations retain Binding Context. The execution object's `global`
getter reads the Realm's installed platform global. Declaration bindings supply
`context.getEnvironment()` to portable constructors and methods. Other hosts
supply a standalone JavaScript environment with their execution facilities,
without implementing HTML state. Early `EnvironmentRecord` values precede realm
construction and deliberately do not implement `JSEnvironment`.
`exec.clone(value, transferList?)` invokes HTML's structured-clone algorithm
with that realm's binding, including transfer processing when requested.

High Resolution Time and Fetch connection timing directly import the stateless
`coarsenTime(timestamp, crossOriginIsolatedCapability)` calculation from
[`infra/time.ts`](infra/time.ts). Consumers select the isolation capability;
`EnvironmentTiming` keeps browser clocks and time origins. `RealmExecution`
has no timing member.

Implementations keep lifetime dependencies in a final constructor argument and
pass the same environment to children they create. Blob slices retain their source
environment; deserialized Blobs receive the destination environment while sharing or
copying `BlobData` as serialization requires. FileReader obtains a stream from
the Blob, while retaining its own environment for result allocation and event tasks.
Invocation-specific information, such as Fetch's explicit task destination,
remains an operation argument. Borrowing another realm's method does not change
the receiver's execution owner.

Fetch's Body mixin selects `exec.global` for consumption task delivery.
The global identifies the owning Realm; the networking task source selects a
task category within its event loop. Body reading can also receive another global
or a parallel queue explicitly. FormData implements HTML's create-an-entry
algorithm alongside its entry list; string and Blob/File normalization need
only its environment's `exec`. Fetch constructs FormData directly, without an
entry-creation capability on constructors or RealmExecution. Constructing an
entry list from an HTML form remains browser-owned work deferred until forms exist.
`exec.parseJSON(text)` uses the owning realm's captured intrinsic, so nested
objects and syntax failures have that realm without a second parse or clone.
`exec.stringifyJSON(value)` likewise retains the factory realm for JSON
serialization failures while preserving exceptions thrown by author code.
Byte-backed Fetch bodies already have their bytes and queue a networking task
directly on their owning global to allocate the JavaScript chunk and update
the stream. The task's checkpoint then runs stream reactions; no separate
background turn is needed. `exec.runInParallel()` schedules background steps
without entering an HTML task or performing the owner's microtask checkpoint.
File-reading and networking task delivery remain separate facilities. Background
I/O returns through those facilities before updating owner state or settling
page-visible results. Parallel queues use the same background scheduler without
requiring a Window task destination.
Multipart extraction and Blob streaming use `BlobData.stream(env)`;
backing data retains no execution owner and each stream uses its caller's environment.
Blob constructor part processing stays on `BlobImpl`, which owns the part and
option interpretation, including native line ending policy.

Fetch constructor declarations obtain their relevant HTML settings through a
registered capability. Request's factory accepts one
`FetchEnvironment`, which extends `JSEnvironment`. That environment supplies the new
request's client; its `exec` supplies signal construction and allocation. Internal
Request construction still accepts an explicit environment owner: a retained
request client can differ from the result's allocation owner or be absent.
Response.redirect receives that same Fetch environment, including its API base URL
and `parseURL()` operation. Client policy and URL inputs remain outside the neutral
execution contract. Dependent-signal construction
belongs to `RealmExecution`: Browlet allocates the signal in that owner and calls DOM's
existing dependency algorithm, without a parallel Fetch-owned signal graph.

Fetch's CORP check submits violations through the actual settings object's
`queueReport()` capability. Browlet connects that recipient to Reporting's
document/worker lifecycle and global-owned observer state; Fetch supplies
the report type, endpoint name, and body without receiving the global itself.
Integrity Policy uses the same seam with boolean report fields. Settings supply
the Document/Worker URL through `getReportingSource()`; Window settings read
their live associated Document rather than substituting its base/referrer URL.
This dependency belongs to Reporting, not RealmExecution.

Mixed Content likewise asks the actual Fetch client whether its origin or a
Window ancestor prohibits mixed security contexts. This is independent of the
fixed `isSecureContext` flag: an HTTPS child of an HTTP parent still restricts
its own subresources. Request and Response own the blocking predicates;
Environment owns browser ancestry. `InsecureRequestsPolicy` groups the upgrade
flag and host/port targets for Environment and BrowsingContext, with explicit
inheritance during Document creation. CSP initialization enables that same policy value;
it does not require another environment object or a realm-execution facility.

The existing `WindowOrWorkerGlobalScopeMixin` owns Reporting endpoint and report
lists, observer registrations, and the per-type bounded report buffer. Its
initialization method parses the actual Fetch response using the
settings object's UserAgent for trust decisions; there is no additional global
registry or Reporting environment facade. Automatic response delivery remains
with the HTML loader. Settings route submissions to the actual global's mixin;
the mixin calls `Environment.generateReport()`, notifies observers, and queues outbound data when the
UserAgent's delivery preference permits it. ReportingObserver receives its
owning settings object at construction and obtains the existing global-scope
mixin from it. Each observer retains its own pending list of shared `ReportImpl`
instances; buffered replay preserves those same report and body identities.
Observers do not construct another mixin or duplicate report implementations.
Web IDL adapts callbacks and HTML delivers them as global tasks. No Binding
Context enters the observer implementation.
Document destruction cancels its queued tasks, hands off pending outbound data,
and releases local Reporting state; ordinary inactivity is not destruction.
`sendReports(reports, env)` gives browser-owned tasks fresh `ReportImpl`
copies containing JSON data and report metadata, alongside endpoint configuration. These copies omit
the observer body and carry no binding record, so delivery retains no reference
to the generating realm or global. Clientless upload requests carry raw bytes for later Fetch extraction.
Response handlers update the original endpoint configuration; replacing the
global's configuration cannot redirect those results into a new list.
UserAgent's reporting scheduler yields to runnable work in its started HTML
event loops, then runs on a later host turn without a Document association.
`UserAgent.attemptReportDelivery()` returns an internal Promise of a delivery
result; its caller owns endpoint bookkeeping. Integration composes `hostPromises`
from Infra's Promise machinery and Node's host queue for this browser-owned work.
These continuations have no HTML realm and do not replace page Promise routing.
Fetch response processing selects a parallel queue, independent of the retiring
Window. UserAgent lazily creates a sandbox `JSEnvironment` for browser-owned
body streams. `createSandboxEnvironment()` composes a real Realm, its own
`SandboxAgent` with an automatically running event loop, and execution facilities
from the main binding world. This environment has no Window, Document, or HTML
settings object; its global does not expose author-facing platform interfaces.
The request retains its original origin and clientless state. The
[Reporting roadmap](browlet/reporting/ROADMAP.md#c-delivery-serialization-and-retirement)
compares Gecko's separate sandbox with Chromium/WebKit's native network paths.
Fetch's `environment.ts` owns the consumer contracts for browser environments
and UserAgent facilities. Override fetch calls the request owner's
`potentiallyOverrideResponse(request, env)` method; its specified default returns
null. The environment supplies execution if a browser policy constructs a body.
A supplied response follows normal main-fetch processing; null dispatches the
same FetchParams to scheme or HTTP fetch. This does not replace Service Worker
or BiDi interception and does not install a process-wide callback.
Main-fetch background waits use `hostPromises`, then
enter the supplied owner's networking task before realm-owned stream work.
Both pre-dispatch and in-flight Document destruction are covered through Fetch
without manual checkpoints. Later dispatch and transport still gate actual
network report delivery.
Periodic collection and retirement remain consumer work. The current
active-document destruction scaffold does not settle inactive history disposal.
`ReportImpl` and derived `ReportBodyImpl` classes are composed in Browlet.
Fetch supplies plain report data; `Environment.generateReport()` captures its
environment metadata and constructs the concrete body. Browser-owned CSP
supplies its concrete, JSON-serializable `ReportBodyImpl` directly; generation
retains it without reconstructing a duplicate record. Delivery copies still
contain only JSON data, never the observer body or its binding identity. Web IDL preserves the
derived interface during projection and provides default JSON conversion;
`ReportImpl.serialize()` produces the outbound representation independently.
Its stateless URL sanitization algorithm lives in URL, retaining its Reporting
citation, so both policy checks and Reporting can import it directly.

`serialize(value)` captures a value using the source runtime;
`deserialize(record)` reconstructs it in the destination runtime's realm.
Consumers retain the record opaquely; HTML owns its representation. Fetch uses
these separate stages for abort reasons. Runtime integration realizes exception
requests before serialization, and Fetch integration realizes a fallback error
before delivering a deserialized reason. No Binding Context enters the controller.

Allocation is an implementation dependency when a value can reach callbacks or
be retained before return projection. FileReader stores its final buffer once;
its getter returns that buffer without a projection cache. TextEncoderStream
allocates bytes before enqueueing them to downstream callbacks. Binding still
owns author conversion, platform identity, and exception/result projection.

Prefer allocating final storage directly through `exec.buffers` when the
implementation controls its creation. Copying and ownership transfer remain
distinct operations; see the [engine buffer contract](js-engine/README.md).

Do not introduce subsystem-specific copies of this context or route ordinary
imports through it. Standalone tests compose real engine facilities with narrow
task/abort/structured-data fakes; HTML ownership tests use Browlet's actual composition.

### Shared algorithm

A shared algorithm is realm-neutral and has no independent identity, lifecycle,
or hidden ambient state. It may mutate records or buffers supplied explicitly
by its caller. Import and call it directly. Examples include byte copying,
numeric helpers, and data transformations whose result does not depend on a
realm, global, embedder, or author-visible object identity.

Do not hide an ordinary import behind an environment field. Doing so obscures
ownership and creates a second call graph without adding an abstraction.

### Source placement and specification provenance

A specification defining an interface does not by itself require a separate
source package. When a reusable platform type is structurally part of an
existing implementation family and introduces no independent subsystem
lifecycle, colocate its implementation and IDL with that family and preserve
the contributing specification in a nearby citation. `ProgressEvent`, for
example, is an `EventImpl` subtype shared by XHR and FileReader; its consumers
own their event sequencing and throttling, but the event type lives with DOM
events.

Do not split a declaration from its implementation merely to reproduce the
document boundary between specifications. Introduce an integration seam only
for a genuine dependency edge or composition decision.

Cross-subsystem imports go through the owner's index, including type imports.
Infra is an explicit exception: consumers may select its independent foundation
modules directly. Internal imports and tests can also use implementation modules
directly. Narrower entry points, such as `web-idl/core/index`, are deliberate
subsystem surfaces. ESLint enforces these boundaries across source subsystems.
Source indexes serve internal composition; package entry points separately
choose their public exports.

Likewise, group related foundations by their consumers and dependency direction.
`infra/` contains Infra Standard algorithms and small realm-neutral foundations
such as text cursors, general utilities, `InternalError` diagnostics, exception
requests, internal Promise values, and HTML's parallel queue. Preserve
each algorithm's specification provenance; consumers supply host scheduling
and retain their own policy and lifecycle.
See the [Infra translation notes](./infra/NOTES.md) for representation and
algorithm-translation guidance.
[HTTP](./http/ROADMAP.md) owns reusable protocol algorithms below Fetch,
including syntax consumed by MIME. One TypeScript project covers its modules;
one index exposes the public algorithms and types. Fetch-specific policy and
transactions remain with Fetch. The UserAgent owns its cookie store alongside
its networking state; Fetch/HTML will supply browser access policy.

When a complete platform implementation spans a host-neutral subsystem and
Browlet-owned facilities, keep its implementation state and IDL together on
the Browlet side of that seam. Do not invent separate facade and browser
objects solely so each specification can retain a source directory.

### Cross-specification capability

A cross-specification capability is a narrow operation owned by one
specification and required by another. It is an explicit dependency edge, not
a general runtime layer.

When the owning subsystem is an allowed direct dependency, import its explicit
other-specifications entry point. File and Encoding use `src/streams/index.ts`
this way; Streams retains the state and controller invariants behind that
surface. Introduce an injected capability only when a direct import would
invert the package dependency, create a cycle, or make a standalone subsystem
depend on a concrete host composition. Streams therefore imports neither HTML
structured cloning nor Browlet's DOM AbortController implementation; those
reverse edges remain capabilities.

A good capability:

- is named for the behavior it supplies;
- accepts and returns implementation-layer or specification-record values;
- exposes only the operations the consumer requires;
- is resolved at composition or integration time; and
- does not expose Web IDL registries, platform wrappers, or reverse lookup.

Examples include HTML structured cloning used by Streams, constructing an
AbortController owned by DOM/Browlet, or queueing work on HTML's event loop.
The provider retains ownership of the behavior; the consumer retains ownership
of its own state and algorithms.

File reading demonstrates why these roles must stay separate. The runtime's
shared `runInParallel()` starts background reads. Once integration selects the
global and file-reading task source, Infra's `TaskScheduling` supplies only task
delivery, with removable `TaskHandle` results.
FileReader retains that dependency; EventTarget owns synchronous dispatch, not
task scheduling. The underlying platform's native line ending is
an immutable RealmExecution value, while File's wall-clock default is the
directly available ECMAScript `Date.now()` operation. Neither needs a
subsystem-wide host facade.

### Host Port

A Host Port represents a genuine effect supplied by the embedder or execution
host rather than another specification subsystem. Examples include:

- monotonic native time readings and wake-up primitives;
- raw network transport, file-system, or operating-system I/O;
- native scheduling primitives; and
- an engine operation which JavaScript cannot express.

Host Ports should be narrow, replaceable, and named for the external effect.
Do not call a dependency a Host Port merely because it lives in another
package. Structured cloning and abort construction are cross-specification
capabilities; reading a monotonic native clock is a Host Port. HTML timer/task
ordering and Fetch remain specification behavior even when they use
host primitives underneath.

Likewise, do not promote an immutable host configuration value or an operation
already supplied by ECMAScript into a Host Port merely to make it injectable.

Fetch's `HTTPTransport` is a concrete example. UserAgent composes a Node Undici
adapter owning sockets, TLS verification, and connection reuse. The adapter
negotiates HTTP/2 and lets Undici multiplex its session while preserving original
field boundaries. Fetch owns protocol-independent transaction rules and the
bounded response byte buffer and schedules stream creation/delivery on the
execution owner's networking task source. Native callbacks retain bytes and
update neutral records; they do not enter page Streams or allocate page objects.
Pause/resume/abort functions cross this boundary without exposing Undici objects.
Closing the transport belongs to its UserAgent lifetime, not an individual Window.
An upload source returns one neutral byte chunk per native write demand by
queuing a read on that body's HTML owner. Native async iteration exists only
inside the Node adapter. UserAgent also supplies a per-response content decoder;
native transforms retain codec state, while Fetch controls coding selection,
byte accounting, backpressure, and page-owned stream failure. Releasing an
unused redirect/retry response stops its exchange without canceling the shared
Fetch controller.

### Composition Root

The Composition Root is the logical role allowed to know the complete concrete
system. A repository may have nested, explicit composition boundaries for
individual packages, but implementation algorithms must not replace them with
ambient runtime discovery. A Composition Root assembles:

- Web IDL definitions and binding contributions;
- Binding Contexts;
- RealmExecution objects for implementation owners;
- cross-specification capability registrations;
- Host Ports; and
- the globals and implementation roots which consume them.

Resolve dependencies at one of these explicit integration boundaries.
Implementation algorithms must not perform ambient discovery of the same
objects later.

Promise placement follows this rule too. Binding supplies the receiver's
RealmExecution with its existing `Promises` facility; HTML task creation selects its event loop. A consumer
imports another owner's result into its own facility before chaining work on
it. Neither establishes ambient ownership over ordinary Node Promise
continuations. The boundary contract lives in
[return projection](./PLATFORM-OBJECT-ARCHITECTURE.md#return-projection).

Browlet's concrete composition root is
[`browlet/bindings.ts`](browlet/bindings.ts). Its
[`browlet/integration/`](browlet/integration/README.md) modules may import both
a standalone subsystem's capability contract and the Browlet-owned
implementation that satisfies it. They may also complete a platform
implementation which cannot remain host-neutral, as FileReader does with DOM
events and HTML tasks. Integrations must remain acyclic: they consume the
Binding Context or global passed by the calling algorithm and must not import
the assembled `browletBindings` singleton or use its forwarding functions to
rediscover either.

HTML's pre-realm state is an `EnvironmentRecord`, created by
`createEnvironmentRecord()`. It includes the owning `UserAgent`, identity,
creation URLs, and `isSecureContext` decision. It has no realm or execution
facilities. The HTML Realm initially references this record so Web IDL can read
the security decision before installing properties.

`createWindowEnvironment()` constructs the Window and `WindowRealm`, then
registers the realm with a factory that constructs its execution facilities and
`WindowEnvironment`. Environment construction attaches itself to the same Realm.
Execution reads the global lazily, after the factory installs it. The factory
transfers any reserved identity, initializes the shared global-scope mixin, and returns the
environment. No partial settings object or placeholder realm is needed. The
early record is never `[[HostDefined]]`. Document-dependent getters remain live
queries of the associated Document and are used after document initialization.
Code names the full object `env` and the early state `envRecord`.
Navigation's `reservedEnv` retains HTML's reserved-environment role.
`WindowRealm` requires its Window at construction and owns Window-only
event state access and associated-Document lookup. `WindowEnvironment.window`
reads that same reference. A plain Realm has no Window state and returns null
for its associated Document. The Window's Document and global-scope mixin
accessors still enforce their own initialization requirements. Browser-facing
`getRelevantRealm()` returns `WindowRealm` for Windows and DOM nodes, and
`Realm` for other browser objects. The same realm is retained throughout
projection and environment attachment. Every realm has an optional
`hostDefined` lookup for callers that allow absence and a checked `env`
getter for callers that require attachment. Realm lookup itself does not
require an environment; browser consumers access `realm.env` when they
need it. `Environment` declares the global-scope mixin accessor abstractly;
`WindowEnvironment` retrieves its Window's existing mixin. AbortSignal and
engine timeout scheduling use this environment accessor, including for
non-Window globals.
Initial Window creation and navigation supply the target browsing-context
group's owner.
This makes HTML's implicit user agent explicit without a Document lookup or a
process-wide singleton. Fetch's `FetchEnvironment` and
`FetchUserAgent` types describe narrow views of those same objects; a request
retains its actual HTML settings object when it has a client, and always retains
its owning UserAgent. The UserAgent owns its live connectivity assumption and
all BiDi hooks. Scoped queries receive the environment explicitly; callers reach
the UserAgent directly, without forwarding methods on Environment. Navigation
notifications receive their navigable and status on the same owner.
Host connectivity detection and BiDi session lookup are provisional; their replacement work is
tracked in the [Fetch roadmap](fetch/ROADMAP.md#slice-1--control-and-task-delivery).

The UserAgent also owns the configured default identification header value.
Fetch's environment-default User-Agent algorithm asks that owner for the
settings object's scoped BiDi override. Request-header insertion, Reporting
generation, and the future NavigatorID getter share this selector. Reporting
captures a string at generation time; an explicit per-request header does not
change environment identity. No identification state belongs in RealmExecution
or a separate Navigator-owned copy.

The same settings object exposes its HTML-owned policy container. Window
settings read it from the associated Document; `FetchPolicyContainer` exposes
the embedder-policy value, typed referrer policy, integrity policy fields, and
an HTML-owned `clone()` without importing Browlet. HTML's `PolicyContainer`
class implements that structural type. Client population clones it once into the request; the
UserAgent supplies fresh default containers for requests without a client.
Fetch's `policy/` modules own its cookie rules, Origin-header disclosure,
COEP/CORP decisions and reporting, Integrity Policy checks, mixed-content
checks, and URL upgrades. Request and Response retain small delegating methods;
the modules work directly with their records and existing browser contracts.
Policy modules import those records as types and call their own helpers directly,
without a policy manager or a runtime dependency on Browlet.
Integrity Policy owns concrete, independently copied policy lists. The request's
`isBlockedByIntegrityPolicy()` delegates to Fetch's policy module, which submits
reports through its client's Reporting seam. CSP lists copy their policies independently
while retaining the origin for inherited `'self'` checks. A default container
has no CSP list until the resource origin is known; every constructed list has
a required origin. Response parsing and Document initialization establish it.
Fetch uses the optional `FetchCSPList` contract for request reporting and
request/response blocking. Source matching and directive selection stay with
Browlet's CSP model. CSP violations retain the protected Document and original
resource URL for deferred DOM events, then use shared Reporting or legacy Fetch
uploads. Document creation consumes actual Fetch request/response records and
retains the protected resource's HTTP status; navigation timing belongs to the
Fetch controller. Sandbox restrictions are combined before origin/Window
selection, while document initialization enables the existing upgrade policy.
Internal developer warnings enter through their owning environment's provisional
`reportConsoleWarning()` method. Console's internal Printer must preserve that
document/worker identity when a shared output sink is added; author console
properties are not that sink. CSP hash reporting reads a separate body branch,
queues completion on the client's HTML loop, and captures sanitized attribution.
Request tainting protects opaque internal responses from hash disclosure. These
reports use ordinary Reporting data but remain invisible to ReportingObservers.
Fetch's embedder-policy module owns the COEP credentials decision, which needs
the request's mode, origin, and redirect history as well as that policy value.

An undefined request origin, policy container, or referrer represents Fetch's
deferred client value. A null referrer explicitly suppresses disclosure. These
are stored states resolved at the prescribed algorithm steps, not automatic
fallback getters. `Request.referrer` still exposes the specified empty string
or `about:client`, and `ReferrerPolicy` retains its specified string values.

The prompt target likewise uses undefined for deferred selection and null for
suppressed prompts. The settings object's `getTraversableForUserPrompts()` returns
the actual Window navigable's nearest traversable ancestor, or null for a
non-Window client or a Window without a navigable. `FetchPromptTarget` is an
opaque reference to that actual traversable. A type-only brand declared on
`TraversableNavigable` excludes ordinary navigables without exposing unused
properties or adding runtime state. Request construction provisionally
retains a selected target when the source request's resolved origin matches the
new constructor's environment; otherwise it defers selection. The specification
still describes the old environment-object target in that constructor check.
The target's current Document origin does not replace the initiating origin.

Referrer Policy asks the same client for `getReferrerSource()`. Window settings
select the live Document URL, reject opaque-origin disclosure, and follow srcdoc
container Documents; other settings supply their creation URL. Fetch's structural
types expose this source query and the UserAgent's existing URL trustworthiness
method without importing Window, Document, or browser policy into Fetch. Referrer
stripping copies URL records; it does not change the client's stored URL. The
provisional iframe/container lifecycle remains in the browsing roadmap.

For cookies, Window settings expose HTML's live cross-site-ancestor query.
Fetch classifies the request's initiator and current target; it selects
outbound cookies separately from accepting response cookies. The UserAgent
owns the shared `CookieStore` and `cookiesEnabled` setting. Request construction
receives that owner explicitly, including for requests without a client, and
cloning preserves it. The author Request constructor selects the new client's
owner even when copying another Request. Sending cookies uses the request's
owner; processing a response's Set-Cookie headers takes that request and uses
the same store. Responses do not retain a request or UserAgent. Cookie parsing,
matching, eviction, and access timestamps remain HTTP's responsibility; no
runtime or binding lookup is needed.

Each `Environment` also owns a `FetchGroup`, exposed through its
`FetchEnvironment` view. The group retains request/controller
records and owns group termination; it has no reverse lookup into HTML. Request
registration and lifecycle termination calls join through the consuming
Fetch/HTML algorithms.

`EnvironmentRecord` satisfies `FetchEnvironmentRecord`, including top-level origin
and creation URL before a realm exists. Requests retain this actual record as
their reserved client. Fetch derives network partition keys from it, retaining
opaque-origin identity. The UserAgent owns its connection pool and HTTP cache
partitions; they outlive an individual environment. Connection establishment
and cache response storage remain deferred under Fetch's HTTP roadmap.

Storage's `StorageKey` similarly consumes a narrow structural view of the actual
`Environment` or `EnvironmentRecord`. Full settings supply their security origin;
earlier records supply their creation URL. Storage acquisition also consults
`UserAgent.storageEnabled`; non-storage acquisition preserves opaque identities
and ignores that preference. Key comparison belongs to Storage, separate from
Fetch's network partition keys. These are direct shared algorithms, without a
Binding capability, execution dependency, or browser-to-Storage adapter object.
`storage/environment.ts` defines the `StorageEnvironment` and `StorageUserAgent`
interfaces; the latter supplies the storage preference and UUID generation.
HTML's `EnvironmentRecord` extends `StorageEnvironment`, so both early records
and the full `Environment` implementing that record satisfy the same contract.

Browlet's File integration owns `BlobURLStore` and `BlobURLEntry` in
`browlet/integration/file/blob-url.ts`. The store retains each registered Blob
and its actual creating environment. The creator contract extends
`StorageEnvironment` with a required origin. Its `BlobURLEntry` accepts the
broader `StorageEnvironment` for object
acquisition and delegates partition comparison to Storage, including when only
an earlier environment record is available. Lookup returns the entry without exposing its
private object; origin inspection and authorized acquisition remain distinct.
Each UserAgent constructs its store with itself and supplies `generateUUID()`;
the store has no Node crypto import and is not module-global. Document unloading
removes entries by their creating environment's identity. `add()` returns the
serialized key; exact removal accepts that string directly or serializes an
existing URL record once. The browser placement permits the future concrete
`BlobImpl | MediaSourceImpl` union without making portable File depend on
Browlet's EventTarget or media objects. Portable Blob/File remain in `file/`;
MediaSource belongs to `browlet/media/` and remains deferred under its
[roadmap](browlet/media/ROADMAP.md). The store retains `BlobImpl` for now.
File's partial URL declaration lives in `browlet/integration/file/object-url.ts`;
its provisional Blob-only argument is converted by Web IDL, and its static
methods use the method realm's actual environment for registration and revocation.
Worker teardown is deferred until its lifecycle exists.

`UserAgent.parseURL()` supplies its actual owner through URL's narrow `URLUserAgent`
contract, which exposes the owner's Blob URL store. Environment's forwarding
method uses that same owner. URL retains an origin-facing entry view without importing File or
Browlet. Browser and Fetch consumers use that parser; URL's author API uses the
basic parser, as specified. `FetchUserAgent.obtainBlobObject()` bridges the
retained entry back to Browlet's concrete entry and its Storage authorization.
It never resolves the URL again: revocation removes future lookups, while an
already-parsed Request retains the original entry. Fetch's early environment
contract extends `StorageEnvironment` so reserved clients can use the same
authorization path without a second environment object.

Secure Contexts' origin/URL trustworthiness algorithms are methods on Browlet's
`UserAgent`, alongside its trust exceptions. URL owns the origin records,
including a trust flag on opaque origins; file origins set it without changing
their distinct identities. URL does not import browser policy. HTML Window
initialization combines the UserAgent's origin trust decision with the parent
Window's security decision, which includes its ancestry. Iframe/popup and
worker/worklet lifecycle completion remains in the browsing policy roadmap.

Initial-document and navigation algorithms select their Window and retain HTML
state initialization. Named functions on the composition-root module delegate
to its main binding world. Document creation reuses the dependencies declared
for its Web IDL constructor. After settings setup, `createWindowEnvironment()`
constructs the global-scope mixin with that environment. The mixin derives
timer routing from `env.realm` and calls `env.exec.clone()`
without a second execution argument or a retained Binding Context. The Document retains its
node factory. The factory uses `context.construct()`
to establish node ownership and initialize its realm-owned event factory.
Document and node platform objects are allocated when projection is needed.
Internal fragment creation supplies its owning
Document explicitly; only the public `DocumentFragment()` constructor injects
the realm's associated Document.

Document owns its initialization, loading completion, destruction, abortion,
and unloading cleanup methods. It reaches `env` through its retained
relevant Window's global-scope mixin, whose environment is supplied at
construction. Document does not import the binding composition root: that root
assembles Document's Web IDL declaration and would create an initialization
cycle. `NavigationParams` owns response/destination operations; the creation
factory remains in `document-lifecycle.ts` because it selects or creates the
Window and realm before constructing the Document. References to navigation
parameters in Document and to Document in navigation are type-only.

The global-scope mixin holds the provisional MessagePort, WebSocket, WebTransport,
and EventSource collections, alongside timer, Performance, and Reporting state.
These resources exist in both Windows and workers. Each global owns a distinct
mixin instance; the shared implementation does not share resources between
globals. Their registration and resource-specific cleanup belong to the
corresponding subsystems when implemented. Document and worker lifecycle
algorithms choose when to invoke that cleanup; common membership does not imply
identical teardown steps. Environment supplies execution, policy, and browser
context to algorithms without duplicating the global's resource collections.
Retained-history ownership and inactive-document disposal are a separate
[HTML lifecycle slice](browlet/browsing/ROADMAP.md#planned-slice-history-ownership-and-document-disposal).
Reporting consumes its destruction notification; it does not choose eviction
policy or introduce an independent history-to-Document relationship.

## Composition map

```text
Composition Root(s)
  |-- Binding Context -----------------> Binding
  |-- Environment (exec) -------------> Implementation
  |-- Cross-specification capabilities --> Implementation
  `-- Host Ports -----------------------> Implementation

Implementation --calls/results--> Binding --projection--> Platform
                                                            |
                                                            v
                                                      author JavaScript
```

The side dependencies feed existing layers. They do not sit between the
Implementation, Binding, and Platform layers.

## Browser precedent

Browser engines package these responsibilities differently, but they converge
on the same useful structural lesson:

| Engine | Cohesive realm/execution handle | General shape |
| --- | --- | --- |
| Blink | `ScriptState` and execution-context objects | Native implementations use shared DOM/V8 primitives; wrapper projection remains a distinct boundary |
| Gecko | `nsIGlobalObject` and realm/JS context facilities | Native DOM objects keep direct implementation relationships and use shared SpiderMonkey/DOM services |
| WebKit | `JSDOMGlobalObject` and `ScriptExecutionContext` | Native and JavaScript-built-in algorithms share a world/context while wrapper creation remains separate |

The engines do not all have Browlet's package boundaries, and their concrete
types are not templates to copy. The relevant precedent is that realm-sensitive
runtime facilities are cohesive, ordinary algorithms remain ordinary calls,
and cross-owner behavior is not reproduced as a nested environment facade for
every subsystem.

## Decision rules

Classify a new dependency in this order:

1. **Does the current specification own the state or behavior?** Put it on the
   Implementation object or in its algorithms.
2. **Is it stateless and realm-neutral?** Import a shared algorithm directly.
3. **Is it generic engine behavior tied to a JavaScript realm or runtime?** Use
   the shared `JSRealm` or `JSRuntime` operation.
4. **Is it Web IDL behavior tied to the current binding realm?** Put it in the
   declaration or member binding, using the shared Binding Context there.
5. **Does another specification subsystem own the semantic behavior?** Import
   its narrow other-specifications entry point when it is an allowed dependency;
   otherwise define a narrow cross-specification capability.
6. **Is it an actual embedder or external effect?** Define a narrow Host Port.
7. **Is it author-facing conversion, identity, or projection?** Keep it in the
   Binding and Platform layers.

If an operation seems to fit several categories, identify who owns its
semantics before choosing where the code happens to be easiest to reach.

## Anti-patterns

### Nested environment facades

```text
Implementation
  -> FooEnvironment
    -> BarEnvironment
      -> BindingContext
        -> Realm
```

This usually means each subsystem copied, grouped, and renamed services already
owned by a shared context or another subsystem. It increases the number of
concepts a maintainer must hold without adding an independently meaningful
lifecycle or identity.

Prefer:

```text
Implementation
  |-- direct implementation relationships
  |-- direct shared algorithms
  |-- one Binding Context
  |-- explicit cross-specification capabilities
  `-- explicit Host Ports
```

### The platform-object U-turn

```text
Implementation
  -> Binding creates a Platform object
    -> Binding unwraps the Platform object
      -> Implementation receives the original implementation object
```

This is a round trip through an author boundary to perform internal work.
Implementation relationships should remain implementation relationships.
Project only when a value actually crosses an author-observable boundary.

### Registries as runtime discovery

A registry may be appropriate inside Binding to maintain identity or resolve a
declared binding capability. It is not permission for implementation algorithms
to search globally for collaborators. Repeated `resolveFoo()`, unwrap, and
reverse-interface lookup calls usually indicate a missing direct relationship
or capability at the Composition Root.

### Capability bags

A context is not one capability merely because its members share an object.
The RealmExecution deliberately groups facilities sharing an implementation
owner and lifecycle. Keep the ownership of each facility explicit. Adding
callbacks, dictionary conversion, projection, or registries would copy Binding
into it and erase the distinction that the context is meant to preserve.

### Miniature runtime test doubles

Do not make every subsystem test reconstruct a private Web IDL runtime. Test
implementations with post-conversion values and narrow capability or Host Port
fakes; test projection, realm behavior, and author-facing conversion through
the real Binding machinery.

## Lessons from removing `StreamEnvironment`

`StreamEnvironment` began as a convenient integration seam and grew into a
33-operation façade over promises, buffers, callbacks, dictionaries,
exceptions, iteration, object construction, DOM aborting, and HTML structured
cloning. The architectural violation was not merely its size: it copied the
Binding Context, mixed several dependency roles, and made a consumer-specific
call graph around services which already had owners.

The removal established a repeatable diagnosis:

- **Forwarding ratio:** if most members only rename or forward another
  context's operations, the abstraction has no independent semantics.
- **Platform-object U-turn:** if internal construction projects an object only
  to unwrap it immediately, Binding has entered an implementation relationship
  which should remain direct.
- **Transitive environment nesting:** `FooEnvironment -> BarEnvironment ->
  Binding Context` means packages are copying access paths rather than composing
  dependencies.
- **Facade displacement:** deleting a subsystem environment is not a
  simplification if its forwarding methods reappear on the shared context or
  expand into repeated plumbing at every caller. Measure the combined
  production footprint and call depth, not merely the deleted file.
- **Test-double gravity:** when a subsystem fake recreates promises,
  conversion, buffers, projection, and exceptions, the production boundary has
  encouraged a second miniature runtime.
- **Context echo:** a call shaped like `context.operation(..., context, ...)`
  can be legitimate when the receiver and argument have distinct roles, but it
  is a strong sign that the API has failed to encode ownership or automatic
  context injection cleanly. Review it rather than normalizing the repetition.
- **Surrogate construction dependency:** establish required early ownership at
  the binding or composition boundary. Do not inject a policy value or another
  service bag merely to replace Binding Context. Consult transient policy only
  while the operation that needs it is running.
- **Split declaration authority:** if author construction and internal
  construction repeat the same hidden realm dependencies independently, they
  will drift. Declarative implementation dependencies must govern both paths;
  internal callers supply only their semantic arguments.
- **Boundary pre-pass:** do not recursively walk a result to prepare it for a
  conversion operation which immediately performs the same traversal. Extend
  the canonical conversion boundary with the missing projection behavior
  instead of maintaining a parallel type interpreter.

The successful removal sequence was:

1. classify every façade member by semantic owner;
2. turn realm-neutral services back into direct imports;
3. use the one shared Binding Context for generic realm-sensitive behavior;
4. retain only narrow capabilities for genuine cross-specification work;
5. construct implementation objects directly and project only at an actual
   Platform boundary; and
6. replace subsystem-private runtime fakes with the real shared context plus
   fakes only for the remaining narrow capabilities or Host Ports.

That removed the private façade, but left Binding Context in implementations.
The current migration separates runtime execution dependencies from Binding:
implementations receive their owning environment, while declaration/member bindings
retain conversion, callback adaptation, and projection.

### Refactor acceptance bar

An architecture-only refactor which adds no platform behavior should normally
reduce production source, concepts, and call depth. Review the `src` diff on
its own; additional tests do not offset production bloat. If production code
grows, name the new invariant or capability that requires it and show why an
existing boundary cannot express it. Better vocabulary and passing tests do
not by themselves prove that the implementation became simpler.

## Naming and lifecycle

Use `Environment` only for a real, independently meaningful environment with
identity or lifecycle described by the architecture or a specification. Do not
use it as a neutral-sounding suffix for a bag of callbacks.

Use these role names consistently:

- `FooImpl` for a platform interface's implementation identity;
- `FooCapability` for narrow behavior owned by another subsystem;
- `FooHost` or `FooPort` for a genuine embedder boundary; and
- `FooContext` only for cohesive contextual state whose members share an
  identity and lifecycle.

## Accommodations, limitations, and specification conflicts

These labels answer different questions and must not be used interchangeably:

| Label | Question | Required record |
| --- | --- | --- |
| **Accommodation** | Which implementation structure exists because the runtime or embedder does not expose a required primitive? | A searchable code marker and an entry in the owning architecture or limitations note |
| **Limitation** | Which observable requirement can Browlet not currently provide? | The owning `LIMITATIONS.md` or roadmap plus a focused expected-failure test when practical |
| **Deviation** | Where does Browlet deliberately behave differently from the governing specification? | The owning architecture or roadmap with the rationale, relevant interoperability evidence, and a regression test |
| **Specification clash** | Where do specification passages or browser implementations disagree, and which behavior did Browlet choose? | A searchable `SPEC_CLASH(identifier)` code marker, evidence and the chosen rule in the owning roadmap or issue notes, and focused tests |

An accommodation can preserve all observable behavior, or it can cause a
limitation. It is not automatically a deviation. A Host Port or
cross-specification capability is likewise not automatically an accommodation:
use that label only when the implementation would materially change if the
missing runtime or embedder primitive became available.

Mark the smallest surprising code boundary with a stable, kebab-case
identifier:

```ts
/*
 * ACCOMMODATION(node-v8-error-stack): Node does not expose Error [[Stack]].
 */
```

One identifier can mark several affected sites. Do not mark every caller, and
do not mark specification-required state merely because it borders an
accommodation. Use `SPEC_CLASH(identifier)` for a known disagreement regardless
of which side Browlet follows. State the competing rules and Browlet's choice
near the affected branch; link the detailed evidence from its owning roadmap.
Keep the marker after review until the conflict is resolved. For example:

```ts
// SPEC_CLASH(csp-path-segments): Split before decoding, as the draft and
// WebKit do; Chromium decodes whole paths, equating encoded and literal slashes.
```

Reserve `DEVIATION(identifier)` for an intentional departure that does not
already have a specification-clash record; do not double-label the same choice.
Neither label replaces `SPEC_MISMATCH`, the temporary flag for an unreviewed
callable shape or representation. Limitations remain primarily documentation
and expected-failure records because a missing operation may have no code
boundary to mark. Search the complete source tree with:

```powershell
rg -n "(ACCOMMODATION|DEVIATION|SPEC_CLASH)\(" src
```

An accommodation's owning Markdown entry must identify the intended
specification behavior, the unavailable primitive, Browlet's substitute,
observable consequences, affected code and tests, and the condition for replacement. Its replacement
notes must say which implementation pieces are deleted or reevaluated so the
substitute does not survive after its cause disappears. If the accommodation
also creates an observable limitation or deliberate deviation, cross-reference
that separate record rather than weakening the distinction.

A specification-clash entry records the competing requirements or observed
implementations, the selected behavior and its consequences, affected code and
tests, and what would justify reconsidering it. The label does not presume that
the specification is wrong, that browsers agree, or that the choice is unfinished.

## Testing consequences

- Test pure, realm-neutral algorithms without constructing Binding machinery.
- Test implementation algorithms with post-conversion implementation values.
- Exercise realm identity, promises, callbacks, exceptions, and buffers through
  real bindings rather than injecting context into implementations for tests.
- Fake only the narrow cross-specification capability or Host Port whose effect
  the test must control.
- Test author coercion, overloads, realm identity, projection, and wrapper
  stability through the Platform API.
- Include at least one integrated test for each capability registration at the
  Composition Root so a locally correct provider cannot remain disconnected.

## Controlling principle

Bindings operating in the same realm share its Binding Context; realms in one
Binding World share platform-object identity. Implementations directly import
realm-neutral algorithms and declare only genuine cross-owner or host
dependencies as capabilities or ports. Add another abstraction layer only when
it has its own coherent identity, lifecycle, or policy.
