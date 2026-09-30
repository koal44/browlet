# Web IDL

Web IDL connects specification implementations to their author-facing JavaScript
interfaces. It owns declarations, conversion, member installation, platform
identity, realm selection, and boundary behavior. [Project architecture](../ARCHITECTURE.md)
defines dependency and environment conventions; [LIMITATIONS.md](../LIMITATIONS.md)
records backend constraints and unresolved behavior.

## Entry points and layout

| Entry | Intended consumer |
| --- | --- |
| [`core/index.ts`](core/index.ts) | Host-neutral declarations, type/member helpers, IDL serialization, and DOMException requests; no engine or binding runtime |
| [`index.ts`](index.ts) | Core plus BindingWorld, binding contracts, stamped-object types, and runtime definitions |

Stylelet and Selectlet can use Core without loading Browlet's runtime. The full
entry augments declaration callbacks with typed `BindingContext` arguments.
Core and full-binding type fixtures are compiled separately so the augmentation
cannot hide a dependency in the standalone surface.

| Modules | Responsibility |
| --- | --- |
| `core/declarations.ts`, `core/helpers.ts`, `core/types.ts` | Definition records, declaration builders, members, and Web IDL result descriptors |
| `core/structured-data.ts` | Portable contracts for interface serialization and transfer steps |
| `assembly.ts` | Combine definitions, partials, includes, marker validation, and implementation-class lookup |
| `binding-world.ts`, `binding-context.ts` | Register realms and expose their shared boundary operations |
| `realm-binding.ts`, `definition-binding.ts` | Realm-owned prototypes, functions, allocation, and member adapters |
| `implementation-binding.ts`, `platform-object.ts` | Construction dependencies, implementation adaptation, and stamped identity |
| `conversion.ts`, `overload.ts`, `callback-value.ts`, `promise.ts` | Author values, invocation, and Promise conversion |
| `legacy-platform-object.ts`, `collection.ts`, `observable-array.ts`, `async-sequence.ts` | Specialized property and iteration behavior |

## Declaring an interface

Keep declarations beside the implementation they describe, preserving their
source IDL or specification reference. `defineInterface()`, `defineDictionary()`,
and their peers create definitions; `attr()`, `roAttr()`, `op()`, `ctor()`, and
type helpers describe the boundary. `serializeDefinitions()` emits IDL syntax.

Automatic member binding calls implementation methods and accessors. A readonly
attribute may also expose a stored implementation field. Use explicit bindings
for boundary adaptation or forwarding to an existing primitive, not to move
independently meaningful specification behavior out of the implementation.

Declarations take one environment type, which also determines their realm type.
For example, `defineInterface<DOMEnvironment>()` gives its callbacks both
`ctx.getEnvironment().exec.createEvent()` and `ctx.realm.eventTimeStamp()`.
The host's binding world must supply that environment contract.

Custom operation and constructor bindings infer converted argument types from
`arg()` declarations, including optional, defaulted, and variadic arguments.
`reference(BlobImpl)` identifies the interface through its registered implementation
class and infers `BlobImpl` for converted arguments and Promise results. It takes
no interface declaration or separate type assertion. `reference('Name')` covers
named IDL types such as dictionaries, callbacks, and typedefs, and forward references.
The interface declaration continues to specify only its environment type.

The [TextEncoder declaration](../encoding/text-encoder.ts) uses `JSEnvironment`.
Its constructor dependency is declared once:

```ts
implementation: impl(TextEncoderImpl, {
  constructWith: [atArg(0, (ctx) => ctx.getEnvironment())],
}),
```

`atArg()` inserts the dependency into the implementation argument list; converted
author arguments fill the remaining positions. Both public construction and
`ctx.construct()` use the declaration. Operation-specific dependencies use
`invokeWith()`. Keep implementation-only arguments last when translating a spec
signature. Ordinary implementations receive `env`, never the Binding Context.
An `atArg()` resolver receives `(receiver, method)` contexts. Select
`receiver.getEnvironment()` for owner dependencies or `method.getEnvironment()`
for allocations belonging to the invoked member's realm.

For automatically bound legacy getters, `indexedGetter()` and `namedGetter()`
declare their live supported-property algorithms. Do not infer dense indices
from `length` or duplicate the operation in a custom binding. Use `attrFn()` for
an attribute whose value is a retained built-in function. `cbDict()` selects the
original dictionary object as the receiver for its callback members.

Partials amend a primary construct; mixin declarations contribute members to
includers. Meaningful mixin state belongs to their composed `FooMixin`, and the
includer explicitly exposes it. Binding must not manufacture missing state.

## Registration and environment composition

`new BindingWorld<Env>(definitions, hostDefinedInterfaces?)` assembles definitions
requiring that environment, plus any supplied host-defined interfaces.
`world.register(env)` returns one Binding Context per realm in that world.
Repeated registration returns the existing context; `world.forRealm(realm)`
only looks it up.

Every registration supplies an environment. Its minimum shape is `{ realm }`;
pure conversion hosts need no execution facilities. Declarations requiring more
name their environment type explicitly. `ctx.realm` has type `Env['realm']`,
and `ctx.getEnvironment()` returns the actual registered object as `Env`.

Use `world.register(realm, createEnvironment)` when execution composition needs
the new context. The factory must return an environment for that same realm;
the environment getter is unavailable until the factory returns. Composition
and declaration setup must succeed before the realm binding is published.

Registration and global installation are distinct. `ctx.install(target)` installs
exposed definitions; `ctx.projectGlobalObject()` can project into an engine
allocation. A sandbox can register for internal allocations without installing
author interfaces. [Browlet's composition root](../browlet/bindings.ts) demonstrates
both the sandbox and Window paths.

Interfaces attach HTML's `serialization` and `transfer` steps directly to their
declarations. The steps live with the owning implementation and run for the exact
primary interface; inherited state must be included explicitly. Both directions
are required by each step type. Assembly validates the matching no-argument
`Serializable` or `Transferable` marker. A marker without steps can still describe
unfinished support, such as stream transfer; it does not enable the operation.

The contracts contain interface-owned record fields and narrow nested-operation
callbacks. A declaration's environment determines the deserialization target
realm type. HTML supplies traversal, shared identity memory, storage mode, and
transfer ordering; Web IDL retains the hooks and supplies platform identity and
construction. Steps do not capture a realm or Binding Context in the shared
declaration, and standalone subsystems do not import HTML's implementation.

Each provider can name its fields through `SerializableSteps<Impl, Fields>` or
`TransferableSteps<Impl, Fields>`. The backing record remains a Map; its typed
view checks field names and values. Deserialization receives the completed record
from the matching serializer, not arbitrary author input. Required fields must
be populated by that serializer; TypeScript does not prove that every path writes
them. The HTML traversal keeps the interface-specific shape opaque.

## Identity and construction

One [`PlatformRecord`](platform-object.ts) is privately stamped onto both an
implementation and its eventual platform object. It retains the owning realm
binding and primary interface. The implementation keeps its class prototype and
private state; public subclassing changes the platform prototype, not the
implementation constructor's `newTarget`.

Creating the record runs inherited implementation initializers before stamping.
Failed initialization leaves the implementation unstamped and can be retried.
Implementation dependencies such as EventTarget's environment are constructor
arguments, supplied by construction declarations or direct callers.
Private stamping works on frozen objects without adding public keys;
stamping a Proxy does not stamp its target.

Prefer direct implementation construction when typed return projection can
establish ownership. Use `ctx.construct()` at a binding/composition boundary
when callbacks, retained state, or internal creation require ownership earlier.
An implementation can therefore be stamped but not yet projected. Structured
serialization can dispatch from that record without creating a platform object.
HTML separately owns transferable detached state.

`ctx.associate(Impl, value)` establishes that record without projection, reusing
the same interface and owner checks as `ctx.project()`. Nested serialization can
name an implementation with `context.subserialize(value, Impl)`. A fresh value
uses the containing object's binding; an associated value keeps its owner.
Ordinary JavaScript values still use the one-argument form without implementation
discovery. Both forms share the enclosing operation's identity memory.

`world.project()` and `world.unwrap()` enforce world membership. One implementation
belongs to one world and retains one platform identity; another world must
construct its own implementation. Stamp lookup itself is not an ownership check.
`StampedImplInstance<T>` and `StampedPlatformObject<T>` retain concrete types.

### Why the world spans realms

Browlet's main world supports compatible receivers borrowed across hosted realms,
including realms with different HTML Agents. The receiver keeps its relevant
realm. This follows Web IDL's [cross-realm platform-object model](https://github.com/whatwg/webidl/blob/fad9b4ce284fd034b719c1c8576e1c692bc97de3/index.bs#L13794-L13934);
HTML's [Agent and AgentCluster roles](https://github.com/whatwg/html/blob/24c5e48bf66ea61bc199ec6338c81258275ba9c6/source#L116607-L116726)
do not assign either actor a platform-identity cache.

The ownership decision also retains these pinned browser examples:
[Blink's isolate main world](https://chromium.googlesource.com/chromium/src/+/1136757f47c7e2b6cc593f871a5d79fc0e9834b4/third_party/blink/renderer/platform/bindings/dom_wrapper_world.cc#160),
[WebKit's VM normal world](https://github.com/WebKit/WebKit/blob/713192fabebfdd2955aa596c262c33bfbf3d50be/Source/WebCore/bindings/js/DOMWrapperWorld.cpp#L84-L90),
and [Gecko's native wrapper identity](https://github.com/mozilla-firefox/firefox/blob/d92a7ec0e622782fe62529bb3a4809780da01d6c/dom/base/nsWrapperCache.h#L52-L75).
These are evidence for the boundary, not templates for Browlet's process model.
Add worlds for actual isolation/runtime lifetimes, not merely for new Agent types.

## Conversion and realms

| Boundary | Owner |
| --- | --- |
| Arguments, overloads, synchronous invocation errors | Executing member's realm |
| Implementation receiver | Recognized receiver's realm binding; argument injection can also select the method's environment |
| Fresh implementation returned as a declared interface | Receiver owner; an already stamped implementation keeps its owner |
| Ordinary result containers | Receiver by default; `allocateIn('method' \| 'receiver')` can select allocation |
| Declared implementation Promise | Its creation environment selects allocation and conversion; returning it preserves the native Promise |
| Invocation failure of a Promise-returning method | Rejected Promise in the method's realm |
| Constructor fallback for non-object `newTarget.prototype` | Constructor's associated realm selects the interface prototype |

Conversion retains platform ownership separately from ordinary allocation.
For example, a callback in realm B can receive a B-owned array containing an
A-owned platform object. A nested interface return projects through its declared
dictionary, sequence, union, or Promise type. A genuine `object`/`any` result
preserves its JavaScript value; Binding cannot infer an undeclared interface.

Implementations receive converted callbacks and dictionaries, not original
author inputs. Callback adapters retain original identity, invocation receiver,
realm, and exception behavior. Do not wrap or revalidate them in implementations.
Later conversions explicitly required by an algorithm remain at that later step.

## Promises, iteration, and exceptions

Every `InternalPromise<T>` stores its runtime result descriptor in `type`.
Select its owner's constructor: `env.exec.Promise.withResolvers(idlType.Uint8Array)`.
The descriptor determines the resolver's TypeScript payload too:
`reference(BarImpl)` supplies both the interface identity and its implementation type.
Named dictionary results can use `implementationType<MyRecord>(reference('MyRecord'))`.
Web IDL owns those descriptors and their payload mappings; Infra retains them
through a generic result-type contract. `all(values, sequence(idlType.long))`
takes the complete array result descriptor.
`then()` and `catch()` keep the descriptor. To change it, use
`then(fulfill, reject, type)`, passing `undefined` when no rejection handler is needed.
TypeScript requires the new descriptor when the callback changes the payload
type. An explicit descriptor also permits changes such as DOMString to USVString,
whose TypeScript payloads are both `string`.
`P.fromInternal(source)` changes the view's constructor and reaction destination while
retaining its descriptor, native backing, and source fulfillment conversion.
Its next `then()` allocates through the destination constructor.

Binding supplies a `WebIDLPromise` subclass of the realm's constructor, inheriting
observation and overriding typed creation. Resolution converts to JavaScript and
immediately calls the native resolver. Internal
reactions convert that native Promise's actual fulfillment back to `T` inside
the reaction. Both consumers share adoption, rejection, identity, and handled
state. Binding checks the result descriptor and returns the view's `backing`
directly; it owns the allocation and conversion contract. There is no projection
cache or second settlement, and returning the backing cannot change its realm.

Implementation records outside IDL use named `internalType<T>(name)` descriptors
through the same static methods. Their boxed values retain implementation identity and
do not adopt arbitrary `then` properties. A host without Binding also retains
values without IDL conversion; their backing Promises retain implementation
payloads. `P.fromValue(value, env.exec.NativePromise, type)` uses native Promise
resolution; `NativePromise` is the owner's captured JavaScript constructor. Forwarding
through `try()` or `fromValue()` preserves an existing internal Promise's contract.
There is no untyped creation path or separate Promise class for private methods.
Resolving functions remain in `InternalPromiseWithResolvers`; importing an existing
native Promise through `P.fromNative(source, convert, type)` does not allocate
another backing or manufacture settlement controls.

For synchronous pair iterables, the implementation exposes live entries and
Binding owns the author's cursor and result conversion. Value iterables use
the required Array iteration surface. For async iterables, an internal iterator
owns traversal/resources; Binding owns author identity, call ordering, method
realm Promises, and result projection. It observes internal completions directly
rather than projecting an intermediate `Promise<any>` that could adopt values.

Infra exception requests and Core DOMException requests are realm-neutral.
Realize a failure once, at its first realm-owned observable boundary; the private
realization record preserves identity on later delivery. Author-thrown values
retain their identity. When an algorithm stores or shares a newly created error
before returning, allocate it through the selected `env.exec.TypeError`,
`RangeError`, or `DOMException` constructor. Binding supplies the original
`DOMException` independently of its writable global property.
Later Promise delivery must not decide that error's realm.
`InternalError` diagnoses an implementation contract failure.
DOMException's engine Error allocation and legacy/global exotic behavior are
explicit special cases, not reasons to merge ordinary platform and implementation
identities. WindowProxy remains HTML-owned and distinct from WindowImpl.

## Tests and remaining integration

```powershell
npm.cmd run test:types
node scripts/with-node.mjs vitest run --project=unit test/web-idl
```

Use [binding-world tests](../../test/web-idl/binding-world.test.ts) for ownership,
[constructor tests](../../test/web-idl/constructor-realm.test.ts) for allocation,
and [callback](../../test/web-idl/callback.test.ts)/[Promise projection](../../test/web-idl/promise-projection.test.ts)
tests for conversion. [DOM binding](../../test/browlet/dom-binding.test.ts) and
[File API](../../test/browlet/file-api.test.ts) prove the browser composition,
including borrowed methods, repeated identity, nested results, and realm-owned
buffers, streams, and errors. Implementation tests use post-conversion values.

Still to do: generate platform TypeScript declarations from the IDL definitions
and add independent compile-only API fixtures to `typecheck`. For example,
`CSSStyleSheet.replace()` exposes `Promise<CSSStyleSheet>`, while its implementation
returns `InternalPromise<CSSStyleSheetImpl>`. Existing contract tests check the
declaration/binding machinery, not that generated author-facing surface; WPT and
projected runtime tests continue to check actual exposure and behavior.

CSSOM projection and restoring `ObservableArray<CSSStyleSheet>` remain with
[style integration](../browlet/style/ROADMAP.md#next-boundary-change).
`[CEReactions]` belongs to [HTML custom elements](../browlet/html/custom-elements/ROADMAP.md),
security policy to [Window](../browlet/browsing/window/ROADMAP.md), and new platform
transfer types to [structured data](../browlet/scripting/structured-data/ROADMAP.md).
Declarations or provisional hooks alone do not establish those behaviors.
The [shared limitations catalog](../LIMITATIONS.md) retains the unresolved
Symbol-overload case and the engine-sensitive tests.
