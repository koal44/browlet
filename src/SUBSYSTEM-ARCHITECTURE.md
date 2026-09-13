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

Browlet has three object-model layers:

| Layer | Owns |
| --- | --- |
| **Implementation** | Specification state, internal relationships, and algorithms |
| **Binding** | Web IDL conversion, realm selection, identity, and projection |
| **Platform** | The realm-owned JavaScript objects visible to authors |

The flow is **Implementation -> Binding -> Platform**. Cross-specification
capabilities and Host Ports supply implementation dependencies at a Composition
Root. Binding Context stays in Binding code. None of these creates an additional
object-model layer.

That distinction matters. A dependency edge explains how an existing
implementation obtains work it does not own. It must not manufacture another
representation of the same platform object.

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
while the private, isolate-scoped `JSRuntime` owns realm associations, the active
evaluation realm, and the shared ambient queue. Its module exposes named operations.
[`NodeAPI`](./js-engine/node-addons.ts) loads and types the optional backend methods;
the shared `addon` instance exposes typed calls and `getMethod(name)` for availability.
Direct calls to unavailable add-on operations throw; runtime operations choose
their documented stock-Node fallbacks before making those calls.
Operations that do not use isolate state are implemented directly as module
functions. Explicit host-object associations remain available;
plain Node uses provisional prototype evidence when native lookup is absent. It also
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
Buffer inspection and writes are realm-neutral functions in `buffers.ts`;
allocation and native Promise observation use the selected realm's methods.
Composition exposes the required operations through `runtime.buffers` and
`runtime.promises`, without passing a realm into implementation algorithms.
JS Engine also owns internal simple-exception requests; their realization into
realm-owned errors remains [binding work](./PLATFORM-OBJECT-ARCHITECTURE.md#exceptions).

Asynchronous implementations receive JS Engine's `Promises` dependency for
allocation, adoption, and continuation placement. A realm owns one facility;
Binding supplies it through Runtime Context at construction or operation
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

Stylelet's options contain `document`, `element`, `tree`, and `runtime`
capabilities. Its document `StyleletContext` normalizes DOM callbacks and
retains the selected `RuntimeCaps` for promises, deferred execution, and DOM
exception creation; it does not retain the options object. Standalone construction
selects one complete native runtime provider when none is supplied. Cascades and
stylesheets receive that existing context instead of a separate runtime argument;
declarations and media lists receive the owner's runtime capabilities directly.
Browlet composes it from the Document owner's existing Promise facility, HTML's
cooperative parallel scheduling, and neutral DOMException requests. Initial,
navigated, and author-constructed Documents supply those capabilities at construction.
This embedding contract does not expose Binding Context or require standalone
hosts to implement Browlet's unrelated runtime facilities.

The HTML document parser receives its EventLoop and Runtime Context explicitly.
Node stream completion only queues an HTML networking task; parser waits and
load completion use `PromiseValue`. The public `Browlet.navigate()` bridges the
finished internal operation to a native Promise for its Node caller. That
outer Promise does not schedule the DOM lifecycle.

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
callback lifecycle, and global task associations. The JS Engine project must
not import Web IDL or HTML, and HTML event-loop state must not move into the
runtime merely because its concrete checkpoint primitive is Node-specific.

Window creation and navigation with the addon follow that division: the engine
allocates immutable objects and forwards native property operations; Binding
supplies interface members and Web IDL named-property behavior; HTML associates
the native WindowProxy with the current Window. The allocation passed into
Binding is a one-time construction input, not another environment or registry.
`createWindowRealm()` in Browlet's composition root is the entry point for this
allocation and its binding; it does not put Window policy in the engine or
construct Window implementation state inside Binding.
See the [global-object notes](./PLATFORM-OBJECT-ARCHITECTURE.md#special-object-categories)
for the current adoption boundary.

### Binding

The Binding layer owns the Web IDL boundary:

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
one platform-object registry and can contain several realm registrations.
Definitions and capability registrations can be shared across worlds, but a
platform-object association belongs to exactly one world.

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

The concrete type is `BindingContext`, created once for each registered Web IDL
realm. Its `realm` property identifies that realm; Binding assembles and owns
the rest of the operations on the context.

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
dependencies through the Runtime Context below. Track the remaining migration in the
[platform-object ledger](./PLATFORM-OBJECT-ARCHITECTURE.md#migration-ledger-temporary).

### Runtime Context

`RuntimeContext` groups the facilities composed for one owning realm/global:
Promises, buffer allocation, microtasks, task delivery, abort-controller
construction, structured cloning/serialization/deserialization, and immutable
native-line-ending configuration.
It contains no Binding Context, realm object,
conversion, callback adaptation, or platform-object registry.

The neutral contract and engine-owned buffer operations live in `js-engine/`.
HTML task policy, DOM aborting, and HTML structured data retain their implementations in
Browlet. [`integration/runtime.ts`](browlet/integration/runtime.ts) assembles
them once during Window realm registration, reusing that realm's existing
Promise facility. Binding exposes the same object through `context.getRuntime()`;
the `runtimeContext` declaration value supplies it to constructors or methods.

Implementations keep lifetime dependencies in a final constructor argument and
pass the same runtime to children they create. Blob slices retain their source
runtime; deserialized Blobs receive the destination runtime while sharing or
copying `BlobData` as serialization requires. FileReader obtains a stream from
the Blob, while retaining its own runtime for result allocation and event tasks.
Invocation-specific information, such as Fetch's explicit task destination,
remains an operation argument. Borrowing another realm's method does not change
the receiver's runtime.

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

Prefer allocating final storage directly through `runtime.buffers` when the
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

Likewise, group related foundations by their consumers and dependency direction.
`infra/` contains Infra Standard algorithms and small realm-neutral foundations
such as text cursors, general utilities, and HTML's parallel queue. Preserve
each algorithm's specification provenance; consumers supply host scheduling
and retain their own policy and lifecycle.
See the [Infra translation notes](./infra/NOTES.md) for representation and
algorithm-translation guidance.
[HTTP](./http/ROADMAP.md) owns reusable protocol algorithms below Fetch; MIME
imports its syntax directly. Structured Fields keeps a nested build boundary.
Fetch-specific policy and transactions remain with Fetch rather than creating
a reverse dependency from the HTTP foundation.

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

File reading demonstrates why these roles must stay separate. Running read
steps in parallel and queueing results on File's task source form one narrow
HTML scheduling capability. Once integration selects the global and task source,
consumers use Infra's shared `TaskScheduling` and removable `TaskHandle` contracts.
FileReader retains that dependency; EventTarget owns synchronous dispatch, not
task scheduling. The underlying platform's native line ending is
an immutable Runtime Context value, while File's wall-clock default is the
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

### Composition Root

The Composition Root is the logical role allowed to know the complete concrete
system. A repository may have nested, explicit composition boundaries for
individual packages, but implementation algorithms must not replace them with
ambient runtime discovery. A Composition Root assembles:

- Web IDL definitions and binding contributions;
- Binding Contexts;
- Runtime Contexts for implementation owners;
- cross-specification capability registrations;
- Host Ports; and
- the globals and implementation roots which consume them.

Resolve dependencies at one of these explicit integration boundaries.
Implementation algorithms must not perform ambient discovery of the same
objects later.

Promise placement follows this rule too. Binding supplies the receiver's
Runtime Context with its existing `Promises` facility; HTML task creation selects its event loop. A consumer
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

Initial-document and navigation algorithms select their Window and retain HTML
state initialization. Named functions on the composition-root module delegate
to its main binding world. Document creation reuses the dependencies declared
for its Web IDL constructor; the root also prepares structured-clone steps
through `integration/runtime.ts`. Environment-settings setup accepts those steps and
constructs its global-scope mixin without receiving a realm binding. The
Document retains its node factory, and creation still projects eagerly to
initialize its realm-owned event factory.

## Composition map

```text
Composition Root(s)
  |-- Binding Context -----------------> Binding
  |-- Runtime Context -----------------> Implementation
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
The Runtime Context deliberately groups facilities sharing an implementation
owner and lifecycle. Keep the ownership of each facility explicit. Adding
callbacks, dictionary conversion, projection, or registries would copy Binding
into it and erase the distinction that the context is meant to preserve.

### Miniature runtime test doubles

Do not make every subsystem test reconstruct a private Web IDL runtime. Test
implementations with post-conversion values and narrow capability or Host Port
fakes; test projection, realm behavior, and author-facing conversion through
the real Binding layer.

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
implementations receive Runtime Context, while declaration/member bindings
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

## Accommodations, limitations, and deviations

These labels answer different questions and must not be used interchangeably:

| Label | Question | Required record |
| --- | --- | --- |
| **Accommodation** | Which implementation structure exists because the runtime or embedder does not expose a required primitive? | A searchable code marker and an entry in the owning architecture or limitations note |
| **Limitation** | Which observable requirement can Browlet not currently provide? | The owning `LIMITATIONS.md` or roadmap plus a focused expected-failure test when practical |
| **Deviation** | Where does Browlet deliberately behave differently from the governing specification? | The owning architecture or roadmap with the rationale, relevant interoperability evidence, and a regression test |

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
accommodation. Use the parallel `DEVIATION(identifier)` marker when a code path
deliberately implements behavior other than the specification's requirement;
a browser's divergence is evidence, not a Browlet deviation when Browlet still
follows the specification. Limitations remain primarily documentation and
expected-failure records because a missing operation may have no code boundary
to mark. Search the complete source tree with:

```powershell
rg -n "(ACCOMMODATION|DEVIATION)\(" src
```

The owning Markdown entry must identify the intended specification behavior,
the unavailable primitive, Browlet's substitute, observable consequences,
affected code and tests, and the condition for replacement. Its replacement
notes must say which implementation pieces are deleted or reevaluated so the
substitute does not survive after its cause disappears. If the accommodation
also creates an observable limitation or deliberate deviation, cross-reference
that separate record rather than weakening the distinction.

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
