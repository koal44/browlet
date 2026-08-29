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

The flow is **Implementation -> Binding -> Platform**. A Realm Context,
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
Definitions and capability implementations can be shared across worlds, but a
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

### Realm Context

A Realm Context is one cohesive handle to a particular JavaScript/Web IDL realm.
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

The current concrete type is `BindingContext`, created once for each
registered Web IDL realm. “Realm Context” names its architectural role; the
concrete name records that Binding assembles and owns it.

The exact TypeScript shape may evolve. The important property is its identity:
one shared context describes one binding realm. Several Realm Contexts can
belong to one Binding World. A subsystem must not
copy selected context operations into a private `FooEnvironment` merely to
rename or forward them.

Declared-member conversion and callback-adapter creation remain Binding work.
A converted callback adapter is a post-conversion value passed to an
implementation, not a service which that implementation recreates through the
Realm Context.

A Realm Context is also not a service locator for unrelated specification
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

### Cross-specification capability

A cross-specification capability is a narrow semantic operation owned by one
specification and required by another. It is an explicit dependency edge, not
a general runtime layer.

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

### Composition Root

The Composition Root is the logical role allowed to know the complete concrete
system. A repository may have nested, explicit composition boundaries for
individual packages, but implementation algorithms must not replace them with
ambient runtime discovery. A Composition Root assembles:

- Web IDL definitions and binding contributions;
- Realm Contexts;
- cross-specification capability implementations;
- Host Ports; and
- the globals and implementation roots which consume them.

Resolve dependencies at one of these explicit integration boundaries.
Implementation algorithms must not perform ambient discovery of the same
objects later.

## Composition map

```text
Composition Root(s)
  |-- Realm Context ----------------+--> Implementation
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
3. **Is it generic JavaScript/Web IDL behavior tied to the current world?** Use
   the shared Realm Context.
4. **Does another specification subsystem own the semantic behavior?** Define
   a narrow cross-specification capability.
5. **Is it an actual embedder or external effect?** Define a narrow Host Port.
6. **Is it author-facing conversion, identity, or projection?** Keep it in the
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
  |-- one Realm Context
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
capability. It is usually a Realm Context partially copied into a subsystem,
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
Realm Context, mixed several dependency roles, and made a consumer-specific
call graph around services which already had owners.

The removal established a repeatable diagnosis:

- **Forwarding ratio:** if most members only rename or forward another
  context's operations, the abstraction has no independent semantics.
- **Platform-object U-turn:** if internal construction projects an object only
  to unwrap it immediately, Binding has entered an implementation relationship
  which should remain direct.
- **Transitive environment nesting:** `FooEnvironment -> BarEnvironment ->
  Realm Context` means packages are copying access paths rather than composing
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
3. use the one shared Realm Context for generic realm-sensitive behavior;
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

## Testing consequences

- Test pure, realm-neutral algorithms without constructing Binding machinery.
- Test implementation algorithms with post-conversion implementation values.
- Use the real shared Realm Context when realm identity, promises, callbacks,
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
