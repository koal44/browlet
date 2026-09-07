# Cross-subsystem composition architecture

This is the architectural vocabulary for composing Browlet's specification
subsystems. Read it before introducing an `Environment`, `Host`, service bag,
callback registry, or reverse lookup between packages. Update it when a new
integration demonstrates that one of these roles or decision rules is
incomplete.

This is the controlling target architecture, not a claim that every current
subsystem already follows it. The temporary migration ledger in
[platform-object-architecture.md](./platform-object-architecture.md#migration-ledger-temporary)
records known transitions.

For the object identities and conversion boundary between an implementation
and its author-facing JavaScript API, see
[platform-object-architecture.md](./platform-object-architecture.md). This
document describes the wider dependency graph around that boundary.

## One object model, several dependency roles

Browlet has three object-model layers:

| Layer | Owns |
| --- | --- |
| **Implementation** | Specification state, internal relationships, and algorithms |
| **Binding** | Web IDL conversion, realm selection, identity, and projection |
| **Platform** | The realm-owned JavaScript objects visible to authors |

The flow is **Implementation -> Binding -> Platform**. A Binding Context,
cross-specification capability, Host Port, or Composition Root can supply a
dependency to the Implementation or Binding layer, but none of them creates an
additional object-model layer.

That distinction matters. A dependency edge explains how an existing
implementation obtains work it does not own. It must not manufacture another
representation of the same platform object.

## The actors

### Implementation

An implementation owns the state and algorithms assigned to its specification.
It works with implementation objects and other post-Web-IDL-conversion values.
It may directly import realm-neutral algorithms.

It must not:

- wrap or unwrap platform objects;
- repeat author-facing conversion or overload selection;
- call an author API in order to recover an internal primitive; or
- reach through a registry to rediscover an implementation dependency which
  composition could have supplied explicitly.

### JS Engine

[`js-engine/`](./js-engine/README.md) is the engine substrate beneath Web
IDL. A `JavaScriptRealm` exposes realm-owned globals, intrinsics, function
creation, and evaluation. The concrete `NodeRealm` owns one backend context
(a `node:vm` context or a native context supplied by the compatibility addon),
while the isolate-scoped `NodeRuntime` owns feature selection and the
provisional object-to-realm associations shared across those realms. It also
supplies `JavaScriptMicrotaskQueue` backends without owning their HTML
lifecycle: each EventLoop asks the runtime factory for one queue and shares it
with all Realms of its Agent. The factory selects an explicit queue under
compatible Node or stock Node plus the addon, or the one ambient fallback queue
under plain stock Node. Enqueue and
checkpoint operations travel together on that contract so the event loop
cannot mix queue backends.
Engine-specific built-in branding and internal-slot access also belong here;
the consuming specification retains the decisions it makes from those facts.

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
`Realm` subclasses `NodeRealm` to add its Agent, environment settings object,
callback lifecycle, and global task associations. The JS Engine project must
not import Web IDL or HTML, and HTML event-loop state must not move into the
runtime merely because its concrete checkpoint primitive is Node-specific.

Window creation and navigation with the addon follow that division: the engine
allocates immutable objects and forwards native property operations; Binding
supplies interface members and Web IDL named-property behavior; HTML associates
the native WindowProxy with the current Window. The allocation passed into
Binding is a one-time construction input, not another environment or registry.
`createWindowRealm` is the HTML composition point for this allocation and its
binding; it does not put Window policy in the engine or construct Window
implementation state inside Binding.
See the [global-object notes](./platform-object-architecture.md#special-object-categories)
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

It projects implementation state. It does not construct the semantic state
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
Subsystems operating in that realm share its context. It carries
generic services whose behavior inherently depends on that realm, for example:

- the realm and its intrinsics;
- the binding/interface domain;
- conversion operations which an internal specification algorithm explicitly
  invokes;
- promise creation, reaction, and settlement;
- realm-owned function and exception creation;
- microtask integration; and
- realm-sensitive buffer allocation.

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

When a complete platform implementation spans a host-neutral subsystem and
Browlet-owned facilities, keep its implementation state and IDL together on
the Browlet side of that seam. Do not invent separate facade and browser
objects solely so each specification can retain a source directory.

### Cross-specification capability

A cross-specification capability is a narrow semantic operation owned by one
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
HTML scheduling capability. The underlying platform's native line ending is
an immutable composition value, while File's wall-clock default is the
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
ordering and Fetch semantics remain specification behavior even when they use
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
- cross-specification capability registrations;
- Host Ports; and
- the globals and implementation roots which consume them.

Resolve dependencies at one of these explicit integration boundaries.
Implementation algorithms must not perform ambient discovery of the same
objects later.

Browlet's concrete composition root is
[`browlet/bindings.ts`](browlet/bindings.ts). Its
[`browlet/integration/`](browlet/integration/README.md) modules may import both
a standalone subsystem's capability contract and the Browlet-owned
implementation that satisfies it. They may also complete a platform
implementation which cannot remain host-neutral, as FileReader does with DOM
events and HTML tasks. Integrations must remain acyclic: they consume the
Binding Context or global passed by the calling algorithm and must not import
the assembled `browletBindings` singleton to rediscover either.

## Composition map

```text
Composition Root(s)
  |-- Binding Context --------------+--> Implementation
  |                                 `--> Binding
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
   the shared `JavaScriptRealm` or `JavaScriptRuntime` operation.
4. **Is it Web IDL behavior tied to the current binding realm?** Use the shared
   Binding Context.
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

A large object containing buffers, promises, callbacks, dictionaries,
exceptions, iteration, scheduling, and unrelated host operations is not one
capability. It is usually a Binding Context partially copied into a subsystem,
mixed with cross-specification capabilities and Host Ports. Classify and route
the members independently.

### Miniature runtime test doubles

Do not make every subsystem test reconstruct a private Web IDL runtime. Test
realm-neutral algorithms directly; test implementations with the shared Realm
Context and narrow capability or Host Port fakes; test projection and
author-facing conversion through the Binding layer.

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
- **Surrogate construction dependency:** do not accept a host policy value in
  place of the Binding Context and repair ownership later. Require the context
  when a realm-owned implementation is created; consult transient policy such
  as native line endings only while the operation that needs it is running.
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
| **Limitation** | Which observable requirement can Browlet not currently provide? | The owning `limitations.md` or roadmap plus a focused expected-failure test when practical |
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
- Use the real shared Binding Context when realm identity, promises, callbacks,
  exceptions, or buffers are part of the behavior.
- Fake only the narrow cross-specification capability or Host Port whose effect
  the test must control.
- Test author coercion, overloads, realm identity, projection, and wrapper
  stability through the Platform API.
- Include at least one integrated test for each capability registration at the
  Composition Root so a locally correct provider cannot remain disconnected.

## Controlling principle

Subsystems operating in the same realm share that realm's runtime context;
realms in one Binding World share platform-object identity. They directly import
ordinary realm-neutral algorithms and declare only genuine cross-owner or host
dependencies as capabilities or ports. Add another abstraction layer only when
it has its own coherent identity, lifecycle, or policy.
