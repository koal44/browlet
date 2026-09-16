# Cross-subsystem platform-object architecture

This is a living description of the boundary between Browlet's implementation
subsystems, Web IDL, and platform objects. Read it before adding a platform
object, connecting a standalone subsystem to Browlet, or introducing an
integration dependency. Update it when a new integration proves that one of
these rules is incomplete.

For the wider dependency model around these objects--Binding Contexts, shared
algorithms, cross-specification capabilities, Host Ports, and the Composition
Root--see [SUBSYSTEM-ARCHITECTURE.md](./SUBSYSTEM-ARCHITECTURE.md). This
document remains focused on object identity and projection.

The objective is not merely to make a projected API work. The implementation
object graph must remain usable and intelligible without pretending that its
objects are already the realm-owned JavaScript objects exposed to an author.

## Vocabulary

Use these two layer names consistently:

| Layer | Punchy name | Contains |
| --- | --- | --- |
| Specification state and algorithms | **Implementation** | `FooImpl`, private state, internal relationships, and subsystem algorithms |
| Realm-owned JavaScript API | **Platform** | the `Foo` platform object, its prototype, author-visible properties, and exotic behavior |

Binding connects **Implementation** and **Platform** through conversion, overload
handling, receiver resolution, realm selection, and projection. To **project** an
implementation is to retrieve or create its platform object. To **unwrap** a
platform object is to retrieve its existing implementation.

Web IDL conversion maps between author JavaScript values and IDL values. Our
binding also adapts converted IDL values to implementation representations, such
as dictionary records and callable callback adapters. `convertToImpl()` performs
both steps; `adaptIDLToImpl()` handles the implementation adaptation. These
working representations belong to the binding machinery.

Use *author* for the JavaScript consumer, not for a layer. Use *platform object*
for the exposed object. Reserve *wrapper* for discussions of the concrete
wrapping mechanism, native-engine comparisons, or special wrapper allocation;
it is not Browlet's general name for the Platform layer.

The host automation boundary is separate from Binding. `Browlet.evaluate()`
executes author code in the page and copies its result to Node; the copy is
not another platform identity or an unwrapped implementation. Exposed host
callbacks also exchange copied data and return page-owned Promises. Passing
live platform objects across this boundary will require explicit handles.
See the [automation boundary](./browlet/automation/README.md).

## The model

An ordinary platform object has two object identities across these layers:

| Identity | Owns |
| --- | --- |
| Implementation object, such as `AbortSignalImpl` | Specification state, private fields, implementation methods, internal relationships, and subsystem algorithms |
| Platform object, such as the JavaScript `AbortSignal` object | Realm-facing prototype identity, author properties, Web IDL member exposure, and any required exotic object behavior |

Binding stamps one `PlatformRecord` onto each implementation instance
participating in binding.
`StampedImplInstance<T>` identifies the same instance after stamping;
it retains `T`'s members and is recognized by `isStampedImplInstance()`.
`stampImplementation()` and `BindingContext.construct()` return this
typed instance, as does unwrapping an existing platform object. The record's
`implInst` refers back to that instance.
Record creation runs the registered `initializeImplementation` callbacks in
parent-to-child inheritance order before attaching the implementation stamp.
Successful initialization happens once per record; later projection reuses it.
If initialization throws, the instance remains unstamped and can be retried.
The record retains its owning `RealmBinding`, primary interface, and, after
projection, platform object. One record class covers both stages; its optional
`platformObject` field is populated during association. The realm is obtained
from that owner. The implementation keeps its own class prototype; ordinary
projection does not turn it into the platform object. `getPlatformRecord()` and
`getImplementationRecord()` read that same record directly from the respective
object's private stamp, without a registry or a world-membership check.
`StampedPlatformObject<T>` retains the platform object's shape, independently
of `StampedImplInstance<T>`; projection returns the platform stamp type.
World APIs, receiver validation, and conversion boundaries enforce world
membership where they accept an object. Code reading an already-owned object
uses its stamp directly. Each object has one record and cannot be reassociated
in a second world. `PlatformRecord.implements()` checks its interface ancestry.

Entry points which select an interface by name accept `interfaceName: string`
and resolve it immediately. Internal projection and allocation take
`primaryInterface: AssembledInterfaceDefinition`; they do not also accept names.
Exact declaration identities remain `definition`, including capability keys.

```text
BlobImpl class -- construction --> blobImpl instance
                                      │ private field
                                      ▼
                               PlatformRecord
                               ├─ owning RealmBinding
                               └─ blob platform object (after projection)

blob platform object -- private field --> the same record --> blobImpl
window.Blob = realm-owned constructor function, cached separately
```

## Stamping

[`Stamper`](./infra/stamper.ts) provides the shared constructor that returns the
supplied object. JavaScript initializes a derived stamper's private fields on
that object without changing its prototype. Each concrete stamper stays with
the module that owns its record and accessors; the base owns no record or brand.
Its static `stamp(target, record)` attaches the state and returns the same target;
`get(target)` retrieves the state. Concrete constructors are private so call
sites consistently name the stamping operation.
Stamped types retain the target's members and use the concrete stamper's private
field as their type brand, without adding a runtime marker. `JSFunction<Result>`
preserves iterator stamp types through realm function creation. Receivers coming
back from author JavaScript still require stamp recognition.
`ImplementationStamper` and `PlatformObjectStamper` attach the shared record to
their respective identities; the iterator stampers attach iteration state.
Implementation instances and their platform objects are distinct objects;
association rejects using the same object for both roles. Private-field recognition
does not invoke proxy traps, and the field is absent from `Reflect.ownKeys`.
Frozen implementation instances and platform objects are supported. A proxy created
by Binding carries its own stamp. Its target and an author-created proxy around
it do not inherit that stamp; recognition also works after proxy revocation.

Synchronous pair iterators also carry private binding state on the iterator
object itself: target, interface, kind, and index. Borrowed `next()` methods
read that same state across realms, checking world membership through the
target's existing platform record. Iterator prototypes and result
allocation remain realm-owned; state recognition does not depend on the
method's realm or the iterator's mutable prototype.

Asynchronous iterators carry their internal iterator, interface, kind, ongoing
promise, and completion state in a private field on the author iterator. The
state also retains its owning `BindingWorld` to check world membership;
the internal iterator itself needs no binding record. There is no separate
iterator-state map. Promise ordering and result allocation remain
binding work.

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
graph acyclic. Prefer instance methods for operations on one implementation,
private methods for work confined to that class, and statics for factories,
predicates, or class-level algorithms. An internal operation does not need to be
static merely to distinguish it from the declared platform API.

### Binding machinery

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

Member dispatch preserves the recognized receiver record through registered
attribute and operation adapters. Their first argument is the record, or `null`
for static and namespace members. Adapters use its `implInst` as the actual
implementation receiver and its owning binding's context for receiver-owned
dependencies. The executing member's binding still handles argument conversion
and synchronous exceptions. Borrowing a method from another realm therefore
does not change the receiver's owner. Collections and observable arrays also
use the recognized record directly when they need its retained state or
platform object.

Legacy indexed/named property metadata is assembled once per interface in each
realm's `DefinitionBinding`. It retains the inherited operations,
registration-time callbacks, flags, and unforgeable names. Supported property
names and indices remain live queries against each implementation instance.
Ordinary interfaces retain a null result to avoid repeated legacy checks.

### Binding worlds

A `BindingWorld` owns the realm registrations which share platform-object
identity. Definitions and capability registrations may be
reused by many worlds. An implementation instance belongs to one world and
always recovers the same platform object. Attempting to associate it with a
second world throws; that world must construct its own implementation instance.

`new BindingWorld(definitions, options)` creates this owner. Its
`BindingWorldOptions` configures shared capabilities and host-defined interfaces;
realm registration supplies the realm-specific options.
The world indexes host-defined interfaces by name at construction. Every realm
binding shares that map and its realm-neutral recognition and receiver hooks.
Capability values live on the world's assembled interface definitions. Realm
bindings share those values; other worlds can configure the same raw declarations
independently.

`DefinitionAssembly` also owns the implementation-class-to-interface index,
built from the declarations once per world. Each `RealmBinding` owns a
`DefinitionBinding` for each definition it uses. That record holds the
realm's construction, initialization, and allocation adapters alongside its
generated interface objects and prototypes. Its `MemberBinding` records hold
attribute, operation, and other member adapters alongside their generated
platform functions. A member contributed by a mixin has a separate record for
each including interface; inherited member lookup follows the interface ancestry.

These adapters remain realm-owned because they capture runtime injection and
exception realization for that realm. Sharing the assembled declarations does
not share these callbacks. There is no separate implementation registry:
registration populates the realm's owned definition/member records directly.

Property installation creates and retains the corresponding member functions
and iterator prototypes in those records. Hidden-interface unforgeables and
regular global members can wait until their platform object is projected;
subsequent installations and instances reuse the retained functions.

`world.register(realm)` returns the world's shared `BindingContext` for that
realm; `world.forRealm(realm)` retrieves it without registering. Installation
and global-object projection are context methods. Registering the same realm
in another world produces a separate context for that world's own instances.

`BindingWorld` directly owns the single realm-to-binding WeakMap. Promise
projections live on their source promises. Record access and stamping belong
to module functions and the concrete stampers; they need no registry.
Each `RealmBinding` constructs and retains its `BindingContext` directly;
the world queries its index rather than retaining another context map.
Runtime composition and declaration setup complete before the binding enters
the index, so a failed setup leaves the realm unregistered. Low-level binding
setup uses the same owned context through `registerDefinitionBindings(binding)`.

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
and Realms inside the same isolate-scoped `JSRuntime`. This is a Browlet
embedding invariant, not a claim that web author code can synchronously
exchange objects between isolated browser agent clusters. The
[Browlet DOM binding](../test/browlet/dom-binding.test.ts),
[binding worlds](../test/web-idl/binding-world.test.ts), and
[File API](../test/browlet/file-api.test.ts) tests require:

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
- Realm-specific interface objects and prototypes on `RealmBinding`; and
- stable implementation/platform associations on each implementation instance,
  with platform-object lookup scoped to the main `BindingWorld` owned by the
  Browlet composition root.

The lower [`js-engine/`](./js-engine/README.md) project separately maps native
Node/V8 contexts to realms, with explicit host-object associations and a
prototype-based fallback when the addon is absent. `JSRuntime`
owns those isolate-scoped engine facts; `BindingWorld` owns Web IDL
implementation/platform identity. Neither map is Agent- or AgentCluster-owned,
and their different keys and responsibilities are not a reason to merge them.

Reopen the number of binding worlds only when Browlet gains a concrete isolated
world, a separate runtime/VM, or another embedding boundary which intentionally
requires a distinct platform object for the same implementation. Do not reopen
Agent or AgentCluster ownership merely because a new Agent type is added.

### Integration dependencies

When a standalone subsystem cannot own or obtain a required facility, classify
the dependency using
[the cross-subsystem decision rules](./SUBSYSTEM-ARCHITECTURE.md#decision-rules):

- keep conversion, callback adaptation, and projection in core/member
  bindings, where the shared Binding Context is available;
- supply implementation execution and allocation through the owner's
  `RuntimeContext`, assembled at realm registration;
- use a cross-specification capability for AbortController construction, HTML
  task queueing, or HTML structured cloning; and
- use a Host Port for clocks, I/O, native scheduling, or an engine operation.

Keep every capability or port minimal and name the behavior or effect, not the
current adapter. It must not recreate a second object model around values Web
IDL has already converted.

The Streams/Abort integration is the controlling example. Streams accepts a
small structural `AbortSignalCapability` contract and directly reads `aborted`,
`reason`, and `addAlgorithm()`. It does not resolve an author AbortSignal back
through a capability registry. `createAbortController()` is a narrow
cross-specification capability because standalone Streams cannot import or
construct Browlet's implementation. It is supplied as
`runtime.createAbortController()`; each writable controller creates its own
controller during setup. Runtime composition records the controller's realm
before any callback can expose its signal.

## Boundary flows

### Public construction

For a constructible interface:

1. Web IDL converts author arguments.
2. The implementation constructor or declared creation steps create `FooImpl`.
3. Web IDL allocates the platform object in the target realm.
4. Binding initializes the implementation and stamps the shared platform record
   onto both identities.
5. The author receives the platform object.

An author subclass changes the platform object's prototype chain. It must not replace
the implementation constructor's `newTarget` or implementation prototype.

For a non-object `newTarget.prototype`, Binding obtains the function's engine
realm and uses that realm's interface prototype through the existing binding-world
registration. The new platform object's own realm remains the constructor's realm.
The construction entry leaves allocation to Binding, avoiding an ordinary JS
constructor's preliminary receiver allocation and duplicate prototype read.

### Internal creation

Internal algorithms create and pass implementations. They should use
implementation constructors, implementation factories, or the binding's
internal object-creation
adapter when realm-owned dependencies must be injected. They must not call a
public constructor and then unwrap its result.

`RealmBinding.createPlatformRecord()` requires registered implementation creation
steps and returns the shared record from the ordinary projection path.
It does not manufacture an object to serve both identities. A declaration without
creation steps can still supply an interface object and prototype, but attempting
to instantiate it reports a configuration error.

`BindingContext.createPlatformRecord()` returns that same record directly.
Constructor initialization uses its implementation instance before returning
the platform object to the author.

Projection can remain lazy until an implementation crosses an author-observable
boundary. Returning an already-associated implementation recovers its stable
platform object. When a regular member returns a fresh, realm-neutral
implementation, IDL-to-JavaScript conversion associates it with the receiver's
relevant Realm. A method borrowed from another Realm therefore cannot
claim the result merely because it supplied the function object.

The same receiver rule applies to explicit instance-member bindings. Argument
conversion still belongs to the operation function's Realm, while its member
binding receives the receiver's Binding Context. Static operations have no
receiver Realm and use the context in which their function was installed.
Getters and operations use the receiver record's binding and its
`defaultConversionContext` for result conversion; they do not rediscover the
binding through a realm lookup.
Implementations must not accept or retain that context. Existing
`invokeWith(atArg(0, (ctx) => ctx))` dependencies are migration work. A future dependency
on the calling script or incumbent settings requires explicit invocation
information at the binding boundary.

`ConversionContext` explicitly pairs a `RealmBinding` with a conversion `realm`.
The binding supplies definitions, implementation projection, host-interface
recognition, and realization of internal failures. The realm selects ordinary
JavaScript allocation and conversion errors. A callback in B can therefore
receive a B array containing fresh platform objects projected through A's
binding. `RealmBinding.defaultConversionContext` retains the ordinary pair
`{ binding: this, realm: this.realm }`. Boundaries that select another conversion
realm form an explicit pair, without changing the default or the binding's own
realm. Nested conversions share the selected pair, and callbacks or continuations
retain it when needed.
This does not replace captured callback settings or an implementation's
RuntimeContext.

Web IDL promise resolution converts in the supplied context before calling the
stored resolve function. Promise reactions also convert and create their handlers
in the supplied context's realm, while allocating the result promise in the
source promise's realm. Importing an IDL promise into an implementation remains
a separate boundary: its fulfillment conversion uses the IDL promise record's
realm and retains the implementation's binding and runtime.

When a value needs a specified realm before any ordinary result projection,
the binding or composition boundary stamps its platform record with
`context.construct()`. Projection fills in that record's platform-object field;
it does not replace a temporary origin record. The instance record belongs to
Binding, while implementation methods receive only the `RuntimeContext`
dependencies they use. Raw implementation construction remains usable outside
Web IDL, and gains binding ownership when explicitly stamped or projected.
Borrowing a member alone does not establish a need for early stamping:
receiver-aware return conversion already handles it. Request and Response
therefore construct their Headers implementations directly; the typed getter
establishes platform identity and preserves `[SameObject]`.

`getObjectRecord()` retrieves the attached instance record through either
identity, including before projection. Structured serialization uses its
implementation and interface without allocating a platform object. Serialization
memory and transfer placeholders use the implementation instance as their key,
so internal references and author-visible references retain one cloned identity.

### Return projection

Return projection follows the declared Web IDL type. It currently descends
through:

- nullable interface references and unions;
- sequences;
- records and dictionaries; and
- promise creation, resolution, and reaction results.

Repeated references to one implementation must produce one platform object.

Conversion selects the declared interface or union member. The realm binding's
implementation projector validates interface membership and world ownership,
preserves an existing owner, and adopts fresh implementation results. Conversion
does not separately recover cached platform objects from implementation records.
Existing platform objects and host-defined interface values retain their own
conversion paths; an `object` result preserves the supplied JavaScript value.

Blob retains its Runtime Context at construction. Its `stream()` and private
read operation use that context; `text()`, `bytes()`, and `arrayBuffer()` share
the read result through JS Engine's `PromiseValue<T>`. Backing `BlobData` remains
runtime-neutral. Slices retain the source runtime, while deserialization creates
an implementation with the destination runtime before restoring its data.
The value retains native settlement state and the `Promises` facility from
the receiver's Runtime Context. It supports `.then()`, `.catch()`, and terminal
`.observe()` without per-call scheduling arguments. Shared promise projection consumes this value
through the existing result-type conversion, exception realization, and identity
cache; it does not add a Blob-specific adapter or another projection cache.
Capabilities own their settlement flag; stream writers query it instead of
mirroring it alongside ready/closed promises.
The byte-result methods retain `newBufferResult()` for their realm-owned
ArrayBuffer/Uint8Array allocation.
Streams uses these values throughout, with the Runtime Context retained
at construction and passed to derived streams. The existing dictionary-result
binding projects each reader's `{ value, done }` fulfillment.

FileReader differs from a fresh method return: it retains one final ArrayBuffer
created through `runtime.buffers` before firing completion events. Its plain
getter returns that same object, including after mutation or detachment; there
is no FileReader-specific projection map. Its error getter realizes the retained
failure through Binding. Likewise, TextEncoderStream allocates
its chunks before downstream callbacks can observe their realm. Buffer slot
inspection, copying, transfer, and allocation live in JS Engine; Web IDL owns
BufferSource conversion and result-declaration policy.

Unmigrated implementation methods return ordinary `Promise<T>` values. Binding adapts
their fulfillment through the declared `T` and creates the author-visible
promise in the receiver's relevant realm. A retained implementation promise
keeps one projection per result type and realm within its binding world.
That cache preserves observable identity for `reader.closed`, `writer.ready`,
and `writer.closed`, including borrowed getters and settlement. It also ensures
fulfillment conversion happens once. The exception stamp separately preserves
one realm-owned error when the same internal failure reaches multiple results,
including results observed in another realm.
Dictionary results can be ordinary records, including `{ value, done }` from
stream reads; binding creates the realm-owned result and projects its members.

`conversion.ts` owns `projectPromise` and its fulfillment conversion. Projection
returns the author Promise directly. `PromiseProjectionStamper` in `promise-record.ts`
privately attaches `PromiseProjectionRecord` entries to the source native
Promise or `PromiseValue`. Each entry
retains an `IDLPromiseRecord`, its binding world, and the buffer-allocation policy;
the IDL record supplies the realm, result type, and author Promise. Repeated
projection retrieves the matching record without stamping the source again.
The stamp changes neither visible properties nor the source's prototype and
also works on frozen sources. Records live with their source, so an externally
retained source also retains its projected promises and their binding owners,
even after the host drops the world. This differs from the former world-owned
WeakMap, which could release its entries when the world became unreachable.
`promise-record.ts` supplies the retained capability and settlement operations;
`promise.ts` builds the higher-level promise algorithms on those values and
conversion. Conversion does not depend on the promise algorithms.

Declared Promise arguments and Promise-returning callback functions supply
`PromiseValue<T>` results whose fulfillment has undergone the declared
conversion. Their continuation destination belongs to the receiving
implementation, including when its method was borrowed from another realm.
Argument conversion still uses the operation function's realm. Web IDL's
PromiseCapability records remain internal to its specification machinery;
implementations do not create or operate on them. Binding Context no longer
re-exports the old create/resolve/react Promise façade; its `promises` facility
and declared result projection supply that boundary. Async sequence arguments
supply iteration steps whose internal results carry converted element values.
The adapter retains dictionary and interface types through each fulfillment.

A synchronous pair `iterable` uses the implementation's `getEntryList()` method
to read its current `[key, value]` tuples. Binding retains the iterator's index,
consults the list on each `next()` and after each `forEach()` callback, and
converts only the selected pair. It creates fresh author-facing entry arrays
without copying the backing list. FormData also uses this entry-list accessor
for Fetch BodyInit extraction.

An `async iterable` declaration names its implementation factory with `create`.
Binding calls that method with converted arguments and adapts the internal
iterator's `next()` and `return()` methods. `return: true` declares the return
algorithm so Binding exposes that method on the author iterator prototype.
The implementation owns its cursor and resource state. Binding retains the
author iterator's identity, iteration kind, completion flag, and ongoing Promise
in its private stamp. Borrowed iterator methods therefore
share completion and call ordering across realms in that world. The method's
realm supplies the returned Promise and iterator result object.

The iterator's completion can be a `PromiseValue` or a native Promise. Binding
observes it in the method's realm and converts the item before resolving the
author's result Promise. It does not project the completion as `Promise<any>`:
native resolution must not inspect an implementation instance's `then` property.
ReadableStream explicitly adopts author chunks through `Promises.resolve()` in
its chunk-read steps; generic iterator binding does not supply that Streams rule.

The fulfillment adapters use native Promise observation in the destination
realm. A `PromiseValue` chain retains that destination. `Promises.import()`
selects the consumer's destination when a result crosses between owners;
adopting another internal result from a `.then()` callback does the same.
Internal fulfillment values are not subjected to JavaScript thenable adoption.
Use `Promises.resolve()` when an algorithm explicitly resolves an author value.
Native `async`/`await` still creates Node promises and is not an implementation
consumer of this API. Binding invocation
does not attach an ambient owner to ordinary `.then` or `await` continuations.
HTML's Promise enqueue hook uses the job's queue realm and leaves Node jobs on
Node's queue. This also keeps Node instrumentation and rejection reporting
independent of HTML checkpoints. HTML's incumbent settings and script/callback
lifecycle remain separate Binding and host-hook responsibilities.

HTML global tasks retain their scheduling-time Node async context, including
unrelated AsyncLocalStorage channels, without changing Promise routing. Node
backend completion returns through an explicit destination task. See
[JS Engine](./js-engine/README.md) for the runtime operations.

Unmigrated native implementation chains still run on Node. Projecting their final
result does not move the preceding work into HTML's checkpoint. Their delivery
failures remain migration work; do not restore ambient routing or pump Node's
queue from an HTML checkpoint to make them pass.

JavaScript buffers and typed arrays retain their existing identity through
ordinary conversion. A buffer-returning operation can declare
`newBufferResult()` when its implementation returns internal bytes instead.
This also applies to bytes delivered by an ordinary implementation promise.
Binding uses the result realm's engine methods to allocate a fresh buffer and,
for a view return type, its view. Buffer inspection and construction do not
belong to Web IDL; conversion and the choice to allocate do.
A retained promise keeps distinct projections for allocating
and identity-preserving results. This allocation policy is separate from `[NewObject]`, which
requires a fresh returned object without prescribing its backing buffer.

Function-valued attributes can declare `attrFn(createCallback)` to return
one built-in function per member and receiver realm, named after the attribute.
Binding retains it alongside the getter in its existing member cache. The
function receives ordinary JavaScript arguments and `this`; it is not an
interface operation and performs no receiver-brand check. The attribute getter
still validates its receiver, and borrowing it selects that receiver's realm.
Binding calls the factory once when creating the cached function, supplying the
receiver's Binding Context. The returned callback's `length` supplies the public
function's length. The declaration controls the getter; a writable attribute can
also declare its setter normally.

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

For callback interfaces, `CallbackInterfaceRecord` retains Web IDL's definition,
conversion context, and captured callback context. The declaration's `adapt` callback
receives a `CallbackInterfaceValue` with the original object, its realm, and
the operation-invocation method.

When a callback receiver is an implementation, it must already be associated
with a platform object. A direct implementation test can invoke converted
callbacks with implementation values, but that is not a substitute for a
projected callback test.

An object argument can declare `cbDict(name)` to convert to that
dictionary after ordinary IDL argument conversion. Its callback-function members,
including inherited members, use the original input object as `this`. The
existing callback adapter retains this receiver and preserves the original
function when projected back to JavaScript. Ordinary dictionary conversion
does not select this receiver policy.

Streams declares this on its source, sink, and transformer arguments. Automatic
construction supplies converted records and the runtime dependency. Shared
callback binding supplies controller platform objects and imports declared
Promise results; the implementation adopts start's `any` result through its runtime.

A constructor's `construct` option supplies custom implementation creation
steps. It returns the implementation; ordinary binding still owns platform
allocation, subclass prototypes, and association. Custom `get`, `set`, and
`invoke` steps are also declared directly on their respective members.

Declaration options have specific fields for constructor and operation
dependencies (`constructWith` and `invokeWith`), result policies, callback
conversion, and legacy getter support. They do not share a generic `binding`
payload. The Core project owns these option types; `web-idl/index`
supplies runtime-specific callback signatures by augmenting `DeclarationCallbacks`.
That augmentation applies to declarations throughout the consuming TypeScript
program. Source subsystems import through this full entry. ESLint forbids direct
declaration imports outside Web IDL itself, Stylelet, and Selectlet. Those standalone packages
can use `web-idl/core/index` without the runtime dependency.
`InterfaceDefinition.implementation` owns the class,
construction dependencies, and optional allocation/initialization hooks.
`impl(Class, options)` fills that field; its options and result types derive from
the field. Core also exports exception names, codes, and request helpers. It has
no dependency on runtime source files or other source projects.

The `BindingContext<Realm>` class retains the registered binding, its composed
runtime, and the host's concrete realm type. A declaration can
select it once with `defineInterface<Realm>`, and its nested callbacks infer the
same context. `BindingWorld<Realm>` only registers compatible realms. Definitions
without host-specific callbacks remain usable by any Web IDL host; the minimal
host contract does not acquire HTML document or timing methods.

Constructor and operation injections use the same `atArg(index, resolve)` record.
The index identifies the final implementation argument slot; converted author
arguments, or arguments supplied by internal construction, fill the remaining
slots in order. Each resolver receives the active Binding Context and returns
the injected argument. Selecting a global or constructing another implementation
is explicit in that callback. Duplicate injected slots are rejected.

`core/declarations.ts` pairs each definition with its `define…` function,
grouping primary and partial forms together. `core/helpers.ts` supplies member,
argument, type-expression, and implementation-option builders. Shared member
records, IDL types and their fixed values, extended attributes, and contextual
callback contracts live in `core/types.ts`. Helper option types stay private and
derive from those records. The Core entry exposes these declarations without
depending on runtime binding code.

### Exceptions

Implementation code throws implementation or host-neutral failures. Realize a realm-owned
exception once, where that failure first crosses into an author-observable
return, callback, or promise. Do not repeatedly realize it while forwarding it
through internal algorithms.

`DOMException` is a specialized platform-object-allocation case: its
implementation state is ordinary `DOMExceptionImpl`, while the platform object
is allocated as an Error exotic
in the owning realm.

Web IDL's `core/dom-exception.ts` owns the shared names, legacy codes,
and DOMException-request helpers. JS Engine's
[`exceptions.ts`](./js-engine/exceptions.ts) provides distinguishable
`RangeError`, `SyntaxError`, and `TypeError` requests without importing Web IDL.
Translate dependency failures into requests at the dependency call.

Both families use native exception subclasses with private brands. Their `is()`
predicates recognize our objects without reading public properties or walking
prototype chains; arbitrary errors, forged prototypes, and proxies pass through.
Realization reads the exception's own name and message without a separate snapshot.
Standalone DOMExceptions retain native inheritance; the binding supplies the
final realm-owned platform object.

IDL-to-JavaScript conversion realizes internal exceptions before handing them to
author callbacks or returning them as values. For example, a stream cancellation
callback and the subsequent pipe rejection must receive the same realm-owned
error, including any changes the callback makes to it. Web IDL §3.14.3 specifies
exception creation and realm selection, not an immutable original-message record.

Imported exception constructors request realm-owned failures from specification
algorithms. Native errors remain appropriate for internal invariant failures;
no import or declaration replaces the global error constructors.

The binding first realizes a request in the executing method's realm for
synchronous calls, or the promise's realm when rejecting an internal promise.
`ExceptionRealizationStamper` retains that realized error in a private field on the original
internal exception. Subsequent boundaries reuse the same error, even in another
realm, preserving both its identity and author changes. For example, a borrowed
stream `enqueue()` method throws the same error that later rejects the stream's
`read()` and `closed` promises. There is no per-realm exception lookup map.
Frozen internal exceptions support the stamp without acquiring visible properties.
Existing JavaScript exceptions, including author-thrown errors and errors already
realized by Binding, pass through unchanged.

## Special object categories

The ordinary two-object path is the default. Exceptions must be explicit.

- **Legacy platform objects:** indexed and named Proxy behavior belongs to the
  platform object's Proxy target. The implementation supplies the supported
  names, indices, and implementation values. Indexed-property declarations
  separate iterable enumeration from membership. Declare a support predicate,
  or explicitly identify `null` or `undefined` as an unsupported getter result
  when that getter is safe to call for support checks. Neither a nullable return
  type nor `length` implies which indices are supported.
- **Global objects:** Window retains its implementation prototype on both
  backends. The compatibility addon supplies a native platform object; the
  plain-Node binding allocates a separate ordinary target with the platform
  prototype and applies its existing immutable-prototype behavior. Projected
  operations can call internal instance methods without exposing those methods.
- **WindowProxy:** this is a stable exotic identity which forwards to the
  current Window platform object. It is not a second Window implementation.
- **Native-exotic platform objects:** DOMException's Error object uses an
  explicit allocator. Future native-exotic cases should do likewise rather
  than contaminating their implementation.

Normal Window creation and navigation use the native-global integration when
the addon is enabled. The engine preallocates the Window platform
object and the immutable prototype chain; `GlobalObjectAllocation` lets Binding
populate those objects with the normal Web IDL members. Binding also supplies
the named-properties behavior to the native layer. The reusable native proxy
is recognized through the existing host-defined WindowProxy receiver seam,
while each Window retains its own platform-object record in the same binding
world. `Realm` retains its Window implementation explicitly for settings and
callback lifecycle work.

`createWindowRealm()` in Browlet's composition root combines that allocation
with the Window binding. A browsing context receives its proxy once the initial realm exists;
later realms reuse that identity. Internal task scheduling retains the Window
implementation's task destination as well as the author-facing objects' associations.
The Node 24 API dependency and remaining limitations are described in
[`node-compat/README.md`](../node-compat/README.md#native-global-integration).
Cross-origin access checks and history traversal remain separate work.

The composition root's named functions also supply the selected realm's
Document and structured-clone steps. Document creation uses its existing
Web IDL construction declaration to supply dependencies. HTML lifecycle code
initializes Document state and the global-scope mixin; it does not assemble node projection
or retain a realm binding for cloning. Internal Document/node construction
initializes EventTarget's realm-owned event factory when it creates the record;
projection remains lazy. Window's implementation is constructed before its
realm exists and receives its initialized record during global projection.

## Cross-specification declarations

A specification which contributes a partial interface or mixin exports the
declaration contribution. The package owning the primary implementation object
provides the integration seam and behavior.

For example, Stylelet should own CSSOM implementation state and export its
CSSOM Web IDL definitions. Browlet owns the active platform objects and connects
Stylelet to DOM objects. Browlet must not patch individual raw CSSOM returns,
and Stylelet must not import Browlet implementations merely to manufacture
platform objects.

Exporting CSSOM implementations is intentional. Their `replace()` results are
internal `PromiseValue` objects; hosts adapt them when exposing a platform API.
Stylelet's runtime capabilities supply exception creation. Browlet supplies neutral
exception requests so the active binding still selects the observable exception
realm, including for borrowed methods. Standalone Stylelet uses native exceptions.
Incomplete CSSOM projection does not prevent implementation/runtime integration.

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
| Ordinary platform identity | Shared stamped records and recursive result projection connect separate implementation and platform objects | Extend the same rule to unprojected CSSOM and later interfaces |
| Binding-world ownership | Browlet's composition root owns one main `BindingWorld` spanning its Node VM realms; it is neither Agent- nor AgentCluster-owned | Add explicit additional worlds only with an isolated-world or separate-runtime consumer |
| Post-conversion implementation types | AbortSignal and the EventTarget signal path retain `AbortSignalImpl` | Remove remaining ambient platform types which reappear inside implementation algorithms |
| Ambient `implements` and stubs | Removed from Window, EventTarget, Event, and CustomEvent. Node and collection classes no longer repeat ambient `implements` clauses; unfinished node stubs remain | Audit `asDocument`, `Document & DocumentImpl`, factory overload intersections, and similar type fictions |
| Static friends | Separate platform objects remove the need to use statics to hide or label internal operations. Blob, File, Window, AbortSignal, EventTarget, Event, ProgressEvent, and the DOM node classes use instance members for implementation state and operations. Window preserves its implementation prototype on both backends | Prefer instance members for operations on one implementation; keep predicates, factories, cross-instance algorithms, and specification-level static operations. Continue reviewing existing friends in bounded passes |
| Callback vocabulary | Callback conversion retains an adapter, original object identity, and realm | Replace temporary `SemanticFoo` and `ResolvedFoo` names with role-based `Value`, `Record`, or `Steps` names; never create callback `Impl` types |
| Legacy collections | HTMLCollection and NamedNodeMap now have declared platform interfaces, stable projected identity, and declarative supported-name/index hooks over automatically bound getters | Review Array-backed storage and the bindings which exist only to expose Array's own `length`; keep real legacy named/indexed-property algorithms explicit |
| Implementation Binding Context removal | Encoding, streams, Blob reading, FileReader, and Fetch bodies receive one Runtime Context; Binding keeps conversion, callbacks, and projection. FileReader retains its final buffer; byte streams allocate through the runtime; Fetch error delivery and writer Promise identity have projected coverage. Fetch abort reasons use runtime serialization/deserialization; integration realizes fallback errors. Queuing-strategy size functions use shared declarative bindings. Promise bookkeeping and this architecture review are complete for the migrated paths | Connect Request/Response body consumption when its slice is reached. Streams' current contracts and deferred integrations are described in [README.md](./streams/README.md) |
| Weak declaration escapes | DOM collection returns no longer use `object` | Continue replacing known platform returns declared as `object` or `any`; leave genuine Web IDL `object` and `any` alone |

## Current limits and next applications

- One implementation instance belongs to one `BindingWorld` and has one
  platform object. Browlet currently creates one host-wide main world;
  sharing an implementation instance across isolated worlds is not supported.
- Plain Node still cannot make the modeled WindowProxy the VM context's actual
  top-level `this`; keeping a separate Window implementation does not change
  that engine limitation.
- A bare `object` or `any` result cannot be projected generically.
- CSSOM interfaces such as `StyleSheetList`, `CSSStyleSheet`, and
  `CSSStyleDeclaration` are not yet projected. They should be migrated as one
  coherent Stylelet-owned interface slice.

When applying this model to another subsystem, first identify its
implementations, its platform interfaces, and the exact conversion boundary.
Then use the
[cross-subsystem decision rules](./SUBSYSTEM-ARCHITECTURE.md#decision-rules) to
classify every requested operation as implementation behavior, a direct shared
algorithm, a Binding Context service, a cross-specification capability, a Host
Port, or Web IDL boundary work. Update these notes when a new case changes the
model.
