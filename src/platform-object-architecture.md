# Cross-subsystem platform-object architecture

This is a living description of the boundary between Browlet's implementation
subsystems, Web IDL, and platform objects. Read it before adding a platform
object, connecting a standalone subsystem to Browlet, or introducing an
integration dependency. Update it when a new integration proves that one of
these rules is incomplete.

For the wider dependency model around these objects--Realm Contexts, shared
algorithms, cross-specification capabilities, Host Ports, and the Composition
Root--see [subsystem-architecture.md](./subsystem-architecture.md). This
document remains focused on object identity and projection.

The objective is not merely to make a projected API work. The implementation
object graph must remain usable and intelligible without pretending that its
objects are already the realm-owned JavaScript objects exposed to an author.

## Vocabulary

Use these three layer names consistently:

| Layer | Punchy name | Contains |
| --- | --- | --- |
| Specification state and algorithms | **Implementation** | `FooImpl`, private state, internal relationships, and subsystem algorithms |
| Web IDL boundary machinery | **Binding** | conversion, overloads, receiver resolution, realm selection, and projection |
| Realm-owned JavaScript API | **Platform** | the `Foo` platform object, its prototype, author-visible properties, and exotic behavior |

The corresponding flow is **Implementation -> Binding -> Platform**. Projection
names the Binding operation which associates an implementation object with, or
recovers, its platform object. Projection is not a third object identity.

Use *author* for the JavaScript consumer, not for a layer. Use *platform object*
for the exposed object. Reserve *wrapper* for discussions of the concrete
wrapping mechanism, native-engine comparisons, or special wrapper allocation;
it is not Browlet's general name for the Platform layer.

## The model

An ordinary platform object has two object identities across the three layers:

| Identity | Owns |
| --- | --- |
| Implementation object, such as `AbortSignalImpl` | Specification state, private fields, implementation methods, internal relationships, and subsystem algorithms |
| Platform object, such as the JavaScript `AbortSignal` object | Realm-facing prototype identity, author properties, Web IDL member exposure, and any required exotic object behavior |

The Binding layer connects them. One binding world's `PlatformObjectRegistry`
records one stable platform-object/implementation pair. The implementation
keeps its own class prototype; ordinary projection does not turn it into the
platform object.

```text
author call
    ↓
platform object
    ↓ receiver and argument conversion
FooImpl and other post-conversion values
    ↓
implementation algorithms

implementation result
    ↓ type-directed result projection
stable platform object
    ↓
author JavaScript
```

This resembles the structural division used by Blink's wrapper/native objects,
Gecko's wrapper cache, and WebKit's `JSDOMWrapper`. Browlet does not yet model
their complete wrapper-world, compartment, garbage-collection, or tracing
lifecycle.

## Ownership

### Implementation layer

A subsystem owns the state and algorithms described by its specification:

- implementation classes and their private state;
- implementation-to-implementation relationships;
- internal factories and algorithms;
- validation not already guaranteed by Web IDL; and
- deliberately host-neutral contracts needed to run the subsystem elsewhere.

Implementation methods use the values which exist after Web IDL conversion.
An argument declared as `Foo` is therefore normally a `FooImpl` inside the
Implementation layer. A dictionary containing `Foo` contains `FooImpl`. Converted
callbacks and dictionaries remain their Web IDL adapter and record values.

Implementation classes must not widen these values back to ambient `Foo`
interfaces merely to satisfy TypeScript's `lib.dom` declarations or direct
tests. They also need not `implements Foo` when doing so would falsely require
the implementation object to have the platform signature.

Because the implementation and platform object are distinct identities,
implementation state does not need a sidecar map merely to hide it from an
author. Prefer direct implementation-owned fields when cross-module algorithms
need that state, and use type-only reverse imports to keep the runtime module
graph acyclic. Retain private fields or static friends only when their internal
boundary is independently useful.

### Binding layer

Web IDL owns the boundary into the Platform layer:

- interface objects, prototypes, and member placement;
- platform-object allocation and stable platform/implementation identity;
- receiver checks and unwrapping;
- argument and return conversion, overload resolution, and defaults;
- callback invocation, callback realms, and exception behavior;
- promise records, settlement conversion, and reaction conversion;
- realm ownership and host-exception realization; and
- legacy indexed, named, collection, and other exotic surfaces.

Bindings project a complete implementation object graph; they do not construct
the implementation state which makes a partial interface or mixin function.

### Binding worlds

A `BindingWorld` owns one platform-object registry and the realm registrations
which share that identity. Definitions and capability implementations may be
reused by many worlds; platform-object associations may not. Within one world,
an implementation always recovers the same platform object. Another world may
project its own platform object for the same underlying implementation.

HTML does not define wrapper worlds, so neither an HTML Agent nor AgentCluster
is the generic owner. Browlet's current composition root owns one main binding
world spanning the realms hosted in its Node VM. This is intentionally broader
than an Agent: host code can apply a method from one Browlet realm to a platform
object from another, and Binding must still unwrap the receiver while preserving
its relevant realm. It is not an AgentCluster either; clusters define shared
memory and do not define platform-object identity.

This matches the useful ownership boundary in browser engines without copying
their process models. Blink's main DOM wrapper world belongs to a V8 isolate,
WebKit's normal DOM wrapper world belongs to a JavaScriptCore VM, and both span
realms. Gecko separates native wrapper identity from its per-global
prototype/interface cache. None makes an HTML AgentCluster the platform-object
identity owner.

#### Ownership decision record

**Status:** accepted for Browlet's main world. The number and lifecycle of
future isolated worlds remains open; Agent or AgentCluster ownership does not.

The standards assign adjacent responsibilities, but do not assign platform
identity to either HTML concept:

- Web IDL associates each platform object with a Realm. It also explicitly
  permits an operation from one Realm to accept an implementation-compatible
  platform object from another Realm. Web IDL does not define a wrapper cache
  or give one to an Agent. See [platform objects implementing
  interfaces](https://github.com/whatwg/webidl/blob/fad9b4ce284fd034b719c1c8576e1c692bc97de3/index.bs#L13794-L13934).
- HTML describes an Agent as an idealized execution thread and an AgentCluster
  as the shared-memory boundary which groups agents. Its Agent creation
  algorithm owns execution state and an event loop, not Web IDL platform-object
  associations. See [agents and agent
  clusters](https://github.com/whatwg/html/blob/24c5e48bf66ea61bc199ec6338c81258275ba9c6/source#L116607-L116726).

The current browser implementations use different machinery but agree on a
broader or orthogonal identity boundary:

| Engine | Evidence | Ownership consequence |
| --- | --- | --- |
| Blink | `DOMWrapperWorld` is a collection of wrappers for one world. `MainWorld(isolate)` obtains the main world from `V8PerIsolateData`, and the world owns its `DOMDataStore`. See [`DOMWrapperWorld::MainWorld`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/platform/bindings/dom_wrapper_world.cc#160) and [`DOMWrapperWorld`](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/platform/bindings/dom_wrapper_world.h#65). | The main wrapper store is world/isolate-scoped, not stored on an HTML Agent or AgentCluster. |
| WebKit | `normalWorld(VM&)` returns `JSVMClientData`'s normal-world singleton, and `DOMWrapperWorld` owns `m_wrappers`. See [`normalWorld`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/bindings/js/DOMWrapperWorld.cpp#L84-L90) and [`DOMWrapperWorld::m_wrappers`](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/bindings/js/DOMWrapperWorld.h#L83-L103). | The normal wrapper store follows a JavaScriptCore VM world, not an HTML Agent. |
| Gecko | A native object which supports `nsWrapperCache` stores its non-security wrapper directly; interface objects and prototypes are separately cached on each global by `ProtoAndIfaceCache`. See [`nsWrapperCache`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/nsWrapperCache.h#L52-L75) and [`ProtoAndIfaceCache`](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/bindings/BindingUtils.h#L451-L578). | Wrapper recognition follows native identity while prototype/interface identity remains per global; neither cache is Agent-owned. |

Browlet's own evidence is intentionally kept executable. Two `Browlet`
instances create separate UserAgents, browsing-context groups, Window agents,
and Realms inside the same Node/V8 runtime. This is a Browlet embedding
invariant, not a claim that web author code can synchronously exchange objects
between isolated browser agent clusters. The
[binding contract](../test/web-idl/unit/binding.contract.test.ts),
[registration](../test/web-idl/unit/registration.test.ts), and
[File API](../test/browlet/unit/file-api.test.ts) tests require:

- a method borrowed from one Browlet Realm to recognize a compatible platform
  receiver created by the other;
- lazy projection through another Realm to retain the implementation's
  originating Realm and stable platform identity; and
- borrowed Blob methods to create promises, byte objects, streams, and slices
  in the Blob's relevant Realm rather than the caller's Realm.

A temporary per-Agent registry broke these invariants. That experiment proved
that the current registry cannot be partitioned by Agent; it was not, by
itself, the reason to choose the broader lifetime. The standards and engine
ownership above are the independent architectural evidence.

Keeping separate Agent registries would require a second shared mechanism to
recognize foreign receivers and retain implementation-origin metadata. That
mechanism would become the real identity owner while the Agent maps merely
duplicated it. Browlet therefore keeps:

- execution and the event loop on `Agent`;
- Realm-specific interface objects and prototypes on `RealmBindings`; and
- stable implementation/platform associations and origin tracking on the main
  `BindingWorld` owned by the Node/V8 composition root.

Reopen the number of binding worlds only when Browlet gains a concrete isolated
world, a separate runtime/VM, or another embedding boundary which intentionally
requires a distinct platform object for the same implementation. Do not reopen
Agent or AgentCluster ownership merely because a new Agent type is added.

### Integration dependencies

When a standalone subsystem cannot own or obtain a required facility, classify
the dependency using
[the cross-subsystem decision rules](./subsystem-architecture.md#decision-rules):

- use the shared Realm Context for realm intrinsics and generic Web IDL promise
  machinery;
- use a cross-specification capability for AbortController construction, HTML
  task queueing, or HTML structured cloning; and
- use a Host Port for clocks, I/O, native scheduling, or an engine operation.

Keep every capability or port minimal and name the behavior or effect, not the
current adapter. It must not recreate a second object model around values Web
IDL has already converted.

The Streams/Abort integration is the controlling example. Streams accepts a
small structural `StreamAbortSignal` contract and directly reads `aborted`,
`reason`, and `addAlgorithm()`. It does not resolve an author AbortSignal back
through a capability registry. `createAbortController()` is a narrow
cross-specification capability because standalone Streams cannot import or
construct Browlet's implementation.

## Boundary flows

### Public construction

For a constructible interface:

1. Web IDL converts author arguments.
2. The implementation constructor or declared creation steps create `FooImpl`.
3. Web IDL allocates the platform object in the target realm.
4. The registry associates the two identities.
5. The author receives the platform object.

An author subclass changes the platform object's prototype chain. It must not replace
the implementation constructor's `newTarget` or implementation prototype.

### Internal creation

Internal algorithms create and pass implementations. They should use
implementation constructors, implementation factories, or the binding's
internal object-creation
adapter when realm-owned dependencies must be injected. They must not call a
public constructor and then unwrap its result.

Projection can remain lazy until an implementation crosses an author-observable
boundary. Returning an already-associated implementation recovers its stable
platform object. Returning a fresh implementation associates it before JavaScript
conversion.

Lazy projection must not let the binding whose method happened to expose the
value claim its realm. When an internal algorithm creates a realm-owned
platform implementation, it uses the originating Realm Context's
implementation-construction adapter. Binding records that origin without
allocating a platform object and later projects through the same realm, even
when the exposing method was borrowed from another realm. A raw implementation
constructor remains suitable for state that is deliberately realm-neutral
until an explicit projection boundary.

### Return projection

Return projection follows the declared Web IDL type. It currently descends
through:

- nullable interface references and unions;
- sequences;
- records and dictionaries; and
- promise creation, resolution, and reaction results.

Repeated references to one implementation must produce one platform object.

`object` and `any` do not identify a platform interface, so Web IDL cannot infer
which implementation to project. Do not use either merely to postpone defining
a known platform interface. If the specification genuinely declares `object`
or `any`, the owning binding or algorithm must deliberately decide what value
crosses the boundary.

### Callbacks

Implementation algorithms invoke the converted callback adapter, not the original
author function directly. The adapter:

- converts implementation arguments back to platform objects;
- projects an associated implementation used as `this` to its platform object;
- enters the callback's realm and lifecycle; and
- applies the declared report/rethrow/promise exception policy.

An author-observable callback receiver must already be associated with a
platform object. A direct implementation test can invoke converted callbacks with
implementation values, but that is not a substitute for a projected callback
test.

### Exceptions

Implementation code throws implementation or host-neutral failures. Realize a realm-owned
exception once, where that failure first crosses into an author-observable
return, callback, or promise. Do not repeatedly realize it while forwarding it
through internal algorithms.

`DOMException` is a specialized platform-object-allocation case: its
implementation state is ordinary `DOMExceptionImpl`, while the platform object
is allocated as an Error exotic
in the owning realm.

## Special object categories

The ordinary two-object path is the default. Exceptions must be explicit.

- **Legacy platform objects:** indexed and named Proxy behavior belongs to the
  platform object's Proxy target. The implementation supplies the supported
  names, indices, and implementation values.
- **Global objects:** `Window` is currently a deliberate exception. Browlet
  uses the host-provided global implementation as the global target and changes
  its prototype during projection. This is not evidence that ordinary platform
  objects should be self-backed. Because this discards `WindowImpl.prototype`
  from normal lookup, Window and the EventTarget behavior it inherits cannot
  participate in the ordinary static-friend cleanup yet.
- **WindowProxy:** this is a stable exotic identity which forwards to the
  current Window platform object. It is not a second Window implementation.
- **Native-exotic platform objects:** DOMException's Error object uses an
  explicit allocator. Future native-exotic cases should do likewise rather
  than contaminating their implementation.

## Cross-specification declarations

A specification which contributes a partial interface or mixin exports the
declaration contribution. The package owning the primary implementation object
provides the integration seam and behavior.

For example, Stylelet should own CSSOM implementation state and export its
CSSOM Web IDL definitions. Browlet owns the active platform objects and connects
Stylelet to DOM objects. Browlet must not patch individual raw CSSOM returns,
and Stylelet must not import Browlet implementations merely to manufacture
platform objects.

## Type names at the boundary

Name a platform interface's implementation `FooImpl`. Do not use `FooImpl` for
a callback interface, dictionary, union, or other converted value which has no
separate platform-object identity.

Use the smallest suffix which states what a non-platform value actually is:

- `FooValue` for a converted or retained Web IDL value;
- `FooRecord` for a converted dictionary or specification record;
- `FooSteps` for an algorithm or callable steps;
- `FooHost` for a genuine host contract; and
- `FooImpl` only for the implementation paired with a `Foo` platform object.

Avoid `SemanticFoo` and `ResolvedFoo`. They describe a moment in the author's
reasoning rather than the value's role. Avoid ambient `Foo` inside the
Implementation layer when the value is actually `FooImpl`. Conversely, do not
invent `EventListenerImpl`: a callback interface becomes a callback adapter or
value, not a platform implementation.

## Warning signs

Stop and trace the boundary when any of these appear:

- a known platform interface is declared as `object` or `any`;
- one implementation signature mixes ambient `Foo` and concrete `BarImpl`;
- an implementation algorithm calls an author-facing method to reach another
  primitive;
- a subsystem adds `resolveFoo()`, a reverse interface lookup, a retention
  WeakMap, or per-instance adapter closures around an already-converted value;
- an implementation class is forced to `implements Foo` and consequently
  widens post-conversion arguments;
- an implementation factory returns only ambient `Foo`, erasing its concrete
  type;
- code manually projects one return value because its IDL declaration is too
  weak to express the real interface;
- a test casts `FooImpl` to `Foo` and calls that a projection test; or
- a binding constructs mixin or partial-interface state which the primary
  implementation does not itself possess.

These are heuristics, not automatic proof of a bug. They are recurring symptoms
of a missed or duplicated boundary.

## Required tests

A new platform integration should normally prove:

- platform-object identity differs from implementation identity;
- the implementation retains its class prototype and private state;
- the platform object has the correct realm prototype and author subclass
  behavior;
- repeated and `[SameObject]` results reuse the platform object;
- nested interface results project through unions, collections, dictionaries,
  and promises where applicable;
- callback arguments and `this` have author identity;
- implementation tests operate on implementations without author coercion;
- legacy indexed or named properties return projected values; and
- specialized platform objects preserve their native observable behavior.

## Migration ledger (temporary)

Keep this section until the existing code has been audited against this model.
It records migration work, not permanent architecture.

| Area | Current state | Remaining check |
| --- | --- | --- |
| Ordinary platform identity | Core registry and recursive result projection use separate implementation and platform objects | Extend the same rule to unprojected CSSOM and later interfaces |
| Binding-world ownership | Browlet's composition root owns one main `BindingWorld` spanning its Node VM realms; it is neither Agent- nor AgentCluster-owned | Add explicit additional worlds only with an isolated-world or separate-runtime consumer |
| Post-conversion implementation types | AbortSignal and the EventTarget signal path retain `AbortSignalImpl` | Remove remaining ambient platform types which reappear inside implementation algorithms |
| Ambient `implements` and stubs | Removed from Window, EventTarget, Event, and CustomEvent | Audit `asDocument`, `Document & DocumentImpl`, factory overload intersections, and similar type fictions |
| Static friends | Separate platform objects remove the need to use statics merely to hide operations from an author prototype, but a static friend can still usefully announce internal-only access and reach private state | Evaluate receiver-taking friends case by case rather than mechanically converting them. Prefer an instance member for a natural implementation capability; retain a static friend when its internal-only signal or lexical private access clarifies the boundary. Retain predicates, factories, cross-instance algorithms, and specification-level static operations. Defer EventTarget and Window because global Window projection still replaces the implementation prototype |
| Callback vocabulary | Callback conversion retains an adapter, original object identity, and realm | Replace temporary `SemanticFoo` and `ResolvedFoo` names with role-based `Value`, `Record`, or `Steps` names; never create callback `Impl` types |
| Legacy collections | HTMLCollection and NamedNodeMap now have declared platform interfaces, stable projected identity, and declarative supported-name/index hooks over automatically bound getters | Review Array-backed storage and the bindings which exist only to expose Array's own `length`; keep real legacy named/indexed-property algorithms explicit |
| Standalone subsystem integration | Streams uses the shared Realm Context, direct shared algorithms, and narrow capabilities for DOM AbortController creation and HTML structured cloning; its copied runtime-service bag is gone | Apply the same dependency classification when another standalone subsystem crosses a specification or host boundary |
| Weak declaration escapes | DOM collection returns no longer use `object` | Continue replacing known platform returns declared as `object` or `any`; leave genuine Web IDL `object` and `any` alone |

## Current limits and next applications

- One implementation has one platform object per `BindingWorld`. Browlet
  currently creates one host-wide main world; isolated extension worlds or
  separate runtime instances remain future work.
- Global Window projection remains a special self-backed host path.
- A bare `object` or `any` result cannot be projected generically.
- CSSOM interfaces such as `StyleSheetList`, `CSSStyleSheet`, and
  `CSSStyleDeclaration` are not yet projected. They should be migrated as one
  coherent Stylelet-owned interface slice.

When applying this model to another subsystem, first identify its
implementations, its platform interfaces, and the exact conversion boundary.
Then use the
[cross-subsystem decision rules](./subsystem-architecture.md#decision-rules) to
classify every requested operation as implementation behavior, a direct shared
algorithm, a Realm Context service, a cross-specification capability, a Host
Port, or Web IDL boundary work. Update these notes when a new case changes the
model.
