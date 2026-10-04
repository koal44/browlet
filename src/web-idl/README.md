# Web IDL

Web IDL connects specification implementations to their author-facing JavaScript
interfaces. It owns declarations, conversion, member installation, platform
identity, realm selection, and boundary behavior. [Project architecture](../ARCHITECTURE.md)
defines dependency and environment conventions; [LIMITATIONS.md](../LIMITATIONS.md)
records backend constraints and unresolved behavior.

## Entry points and layout

| Entry | Intended consumer |
| --- | --- |
| [`core/index.ts`](core/index.ts) | Host-neutral declarations, common definitions, IDL serialization, and DOMException state and recognition; no engine or binding runtime |
| [`index.ts`](index.ts) | Core plus BindingWorld, binding contracts, and stamped-object types |

Stylelet and Selectlet can use Core without loading Browlet's runtime. The full
entry augments declaration hooks with typed `BindingContext` arguments.
Core and full-binding type fixtures are compiled separately so the augmentation
cannot hide a dependency in the standalone surface.
Consumers needing only Core exports use `core/index.ts`; declarations needing
typed binding hooks use the full `index.ts`. Web IDL runtime modules import
Core through its index, while Core modules import their siblings directly.

| Modules | Responsibility |
| --- | --- |
| `core/declarations.ts`, `core/helpers.ts` | Complete definition records and declaration builders |
| `core/members.ts` | Member and argument records, permitted member sets, and legacy property hooks |
| `core/types.ts` | Type expressions, literals, extended attributes, implementation identity, and binding-hook contracts |
| `core/structured-data.ts` | Portable contracts for interface serialization and transfer steps |
| `core/dom-exception.ts`, `core/common.ts` | DOMException implementations, recognition, and shared Web IDL declarations |
| `core/execution.ts` | Host-neutral execution contract supplying the DOMException constructor |
| `assembly/assembly.ts` | Compose the assembled collections and cache declared type uses |
| `assembly/types.ts` | Realm-independent type contracts, conversion rules, comparison keys, and JSON classification |
| `assembly/interface.ts`, `dictionary.ts`, `namespace.ts`, `callback.ts`, `enumeration.ts`, `typedef.ts`, `proxy-object.ts` | Each definition family, its collection, and its construction and search logic |
| `assembly/member.ts` | Compile member and argument types, prepare callable contracts, and group overloads |
| `assembly/exposure.ts` | Exposure predicate shared by assembled definitions |
| `assembly/validation.ts` | Opt-in development checks for declaration composition, cycles, markers, and type references |
| `binding/world.ts` | Own definitions and identity across registered realms; expose their public BindingContext type |
| `environment.ts` | Environment, realm-facility, and callback-lifecycle contracts supplied to Web IDL |
| `binding/realm.ts` | Retain the environment, supply typed implementation Promises, and own allocation, conversion caches, identity, and invocation services |
| `binding/realm/implementation.ts`, `binding/realm/member.ts` | Registered implementation steps and the platform objects and functions that invoke them |
| `binding/register.ts` | Connect assembled declarations to implementation factories, members, and explicit bindings |
| `binding/realm/callback.ts` | Shared callback invocation, prepared conversions, captured-context restoration, and implementation-callable identity |
| `binding/realm/overload.ts` | Select a callable and convert its arguments for invocation |
| `converters/factory.ts` | Select the converter subclass for an assembled type |
| `compiler.ts` | Compile internal binding and conversion steps with explicit dependencies and separate optimization feedback |
| `converters/converter.ts` | Base Converter, shared rules and ownership, defaults, and conversion error boundaries |
| `converters/` | Type-specific Converter subclasses and IDL-to-implementation conversion |
| `values/` | Runtime IDL dictionaries, callbacks, promises, and iterable/iterator state |
| `values/value.ts` | IDL and author value typings, including plain record, sequence, and collection containers |
| `binding/platform.ts` | The identity record shared by an implementation and its platform object |
| `binding/realm/global.ts`, `binding/realm/legacy.ts` | Global and legacy platform-object behavior |
| `binding/realm/iterable.ts`, `binding/realm/async-iterable.ts`, `binding/realm/collection.ts`, `binding/realm/observable-array.ts` | Install interface members and retain their iterator or collection state |

The coordinating modules in `binding/` compose the subsystem: `BindingWorld` owns
assembly and realm registration, and each registered realm has one `RealmBinding`
retaining its environment, state, and services. `BindingContext` is a type selecting
that same object's public operations; there is no separate context object. Files
under `binding/realm/` are components of that realm binding. They retain a typed
reference to their owner and call its allocation, identity, conversion, and
exception services.

`RealmBinding` also owns declaration argument injection and the implementation
Promise constructor that uses its conversion operations. Platform records call
it directly to associate another implementation with their owner.
`converters/` owns the base `Converter` and reusable type-specific algorithms;
`ImplementationConverter` consumes IDL values into implementation values.
`values/` holds per-value state and lifecycle operations; converters and realm
bindings hold reusable machinery. `value.ts` describes plain records, sequences,
maplike/setlike entries, and the relationship between descriptors and value types.
Those containers need no additional wrapping.
`assembly/` owns the assembled definitions, compiled IDL types, and realm-independent
rules shared by bindings and converters. Converter subclasses retain those rules,
a binding, an allocation realm, and prepared input/output steps; their factory
lives with the converters it selects.
Runtime types distinguish `any`, `undefined`, `boolean`, `bigint`, `object`, and
`symbol` directly. Each has its own converter; integer, floating-point, and string
converters share their related algorithms and prepare fixed conversion choices
once. Core's compact `simple` declaration syntax does not survive assembly.

Member dispatch, single-callable argument conversion, and dictionary input conversion
compile specialized JavaScript when their existing binding or conversion plan is
prepared. Declaration strings enter generated bodies as encoded literals; runtime
objects enter as parameters. Exposed functions still come from the owning realm's
function factory. Generated bodies require runtime coverage because TypeScript
checks only the surrounding contracts.

Assembled interfaces, namespaces, and callback interfaces answer exposure queries
using `WebIDLRealm`'s global names, secure-context status, and cross-origin-isolation
status. The queries read the existing declarations; bindings supply their realm.
Member queries also apply the contributing
fragment's requirements and, for interfaces and namespaces, the including owner's.
The unrestricted `*` remains independent of the globals declared in the assembly.

Consumers use the `assembly/`, `converters/`, `values/`, and `binding/realm/` indexes;
modules within those folders import their siblings directly. Infra also offers
an index, while direct foundation imports remain available for narrow consumers,
including standalone Core.

Order imports from foundations upward: Infra, JS Engine, and Core share one
block, followed by environment and assembly contracts, values, converters, and
binding collaborators. Keep small import lists compact; a large group of sibling
imports can have its own block. Keep type-only owner references alongside their
related module imports.

## Declaring an interface

Keep declarations beside the implementation they describe, preserving their
source IDL or specification reference. `defineInterface()`, `defineDictionary()`,
and their peers create definitions; `attr()`, `roAttr()`, `op()`, `ctor()`, and
type helpers describe the boundary. `serializeDefinitions()` emits IDL syntax.
`defineInterface()` produces a `PrimaryInterfaceDefinition`; its partials and
included mixins are combined into an `AssembledInterface` during assembly.

Normal assembly trusts declarations. Call `validateDefinitions()` from
`assembly/index.ts` during development or tests to check duplicate primary names,
orphan partials or includes, inheritance and typedef cycles, serialization markers,
and unresolved types, including unused aliases and mixins. Browlet's complete
declaration set has a dedicated validation test. Required type resolution still
throws when assembly cannot produce a valid IDL type. Forward references and
recursive dictionary values remain valid; an unimplemented conversion for a
recognized type is a separate runtime limitation.
Composition must supply every referenced declaration, including type identities
whose implementations are still pending.

Automatic member binding calls implementation methods and accessors. A readonly
attribute may also expose a stored implementation field. Use explicit bindings
for boundary adaptation or forwarding to an existing primitive, not to move
independently meaningful specification behavior out of the implementation.

Declarations take one environment type, which also determines their realm type.
For example, `defineInterface<DOMEnvironment>()` gives its callbacks both
`ctx.getEnvironment().exec.createEvent()` and `ctx.realm.eventTimeStamp()`.
The host's binding world must supply that environment contract.

Binding recognizes `DOMExceptionImpl` and its subclasses during projection,
allocates their backing Error in the selected realm, and applies Core's
`DOMExceptionStamper` during platform-object initialization. This private stamp
retains the implementation so Core can recognize projected exceptions and their
names without reading author-overridden properties or importing Binding's identity
records. It also observes state restored during deserialization. DOMException
implementations are recognized by their private state; Infra's TypeError,
RangeError, and SyntaxError requests retain their separate request stamp.

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
`ctx.construct(Impl, argumentsList)` use the declaration; the latter accepts an
existing argument array without spreading or changing it. Operation-specific dependencies use
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

## From declaration to implementation arguments

Conversion names state both ends: `JS` is the author-facing representation,
`IDL` is the Web IDL value, and `Impl` is the implementation representation.
Both sides run in JavaScript. `project` and `unwrap` specifically connect an
implementation object with its platform object.

A runtime **IDL value** is the result of author-to-IDL conversion. Some values
already use the representation implementations consume; others retain information
needed for later conversion or invocation. Their declaration descriptors remain
in Core. The `IDL…` prefix identifies these values without boxing every value.

| Value | Payload and retained information |
| --- | --- |
| `IDLDictionary` | Converted member record, distinguished from ordinary objects during union conversion |
| `IDLCallbackFunction`, `IDLCallbackInterface` | Author object, declaration, callback realm, captured context, and a reference to the callback binding |
| `IDLPromise` | Realm-owned promise, fulfillment type, resolving functions, and settlement state |
| `IDLAsyncSequence` | Author iterable, selected iterator method, iteration kind, and element type |
| `IDLSequence`, `IDLRecord`, `IDLMapEntries`, `IDLSetEntries` | Existing Array, Map, or Set containers holding converted values |

Callback values expose invocation methods that delegate to `CallbackBinding`.
That realm component owns shared `CallbackInvoker` plans, dynamic operation
lookup, context restoration, and callback stamps. A callback interface's
`toImpl(ctx, cbValue)` hook still receives the value and can invoke its operations.
The value captures its own callback context; sharing a plan never shares that
context or the original author object.

`IDLAsyncSequence.open()` creates an `AsyncSequenceIterator` for each traversal.
It advances and closes the iterator and applies the caller's yielded-value
conversion. Its local `IteratorRecord` retains the captured `next` method and
owns synchronous-to-asynchronous iteration. Implementation code receives Infra's
[`AsyncIterator<T>`](../infra/iteration.ts): `next()` and `return()` return
`InternalPromise` results, and `endOfIteration` signals completion.

For an interface's `async iterable` declaration, `AsyncIterableBinding` installs
methods and checks receivers. Each projected iterator retains an
`AsyncIteratorRecord` that owns advancing, closing, operation sequencing, and
result conversion. The record retains the original receiver's binding for
projection; each call supplies the invoked method's binding for allocations,
including when that method is borrowed from another realm.

Maplike and setlike iteration use local `MapIteratorRecord` and `SetIteratorRecord`
classes for the live backing cursor and prepared entry converters. The converters
retain the collection's binding; pairs and result objects use the realm of the
method that created the iterator. Iterator methods retain their usual converters
at installation; borrowed methods select converters for the receiver's binding.
`MaplikeBinding` and `SetlikeBinding` install
their respective members. They and the iterable bindings share direct-platform
receiver validation through `RealmBinding`, without global fallback or proxy aliases.
JS Engine owns iterator identity, reentrancy, and completion.

`IDLPromise` owns resolution, rejection, and reactions. Its `react()` handles
JS values; callers supply conversions in their reaction steps. Convert an IDL
result with `converter.idlToJS()` before `resolve()`, which accepts a JS value
and may adopt another promise. `PromiseConverter.fromIDL()` combines conversion
and allocation when needed. `ImplementationConverter` converts typed fulfillment
values inside `InternalPromise` reactions. The promise value depends on neither
converters nor binding machinery.

An `AssembledCallable` supplies the prepared argument and return contract on a
compiled operation, constructor, callback, async iterable, or legacy factory.
The compiled member itself is the binding key; no separate callable wrapper or
lookup map is needed. Exposure-selected overload groups retain these members.
For example:

```webidl
callback Progress = undefined (double value);
dictionary Options {
  long limit = 3;
  Progress onprogress;
};
interface Work {
  undefined run([Clamp] octet count, optional Options options = {});
};
```

The assembled `run` callable has two arguments and a minimum argument count of
one. Its first argument's type retains `[Clamp]`; the second retains its default.
The assembled dictionary contains `limit` and `onprogress` in conversion order.
Its members needing implementation conversion include `onprogress`: an IDL callback
must become a callable before the implementation can use it.

| Stage for `run(300, { onprogress: fn })` | Representation |
| --- | --- |
| Author input | Number 300 and an arbitrary JavaScript object |
| `jsToIDL` | Number 255 and an `IDLDictionary` containing `limit: 3` and an `IDLCallbackFunction` for `fn` |
| `idlToImpl` | Number 255 and the member record, with `onprogress` replaced by a `StampedCallbackFunction` |

The `idlToImpl` step changes an already-converted IDL value into the
representation consumed by implementation code. It does not repeat author
coercion or validation. A callback's callable retains the original function,
realm, and captured context. Numbers and strings already have their implementation
representation. `ImplementationConverter.createArgumentConverter()` prepares those choices
for a callable; `createConverter()` prepares the choice for one argument or member type.
The one-shot `idlToImpl()` entry invokes those same rules. Installed members and
typed Promise fulfillment retain their prepared conversions; unions only identify
which converted representation needs them.

`BindingContext.jsToImpl()` combines the two input stages. On the return path,
`Converter.idlToJS()` produces author values; `BindingContext.implToJS()` uses that same
output converter for implementation results without creating a separate IDL container.

Concrete conversion descriptors retain known TypeScript results, including nested
sequence and record entries. For example, `record(idlType.DOMString, sequence(idlType.long))`
produces an `IDLRecord<number[]>`; implementation conversion consumes it as a
`Record<string, number[]>`. Output conversion accepts either representation and
projects its entries into a fresh object in the selected realm. Sequence conversion
consumes its fresh IDL array in place; it never modifies the author's input array.
Other retained results include a number for `idlType.long` and an `IDLPromise`
for `promise(...)`. Named references and dynamically selected types still need the runtime assembly;
their generic results remain `unknown` until the assembled category is known. A
converter for an assembled dictionary returns `IDLDictionary`, for example.
`ctx.jsToImpl()` additionally uses
the descriptor's implementation payload type, after consuming intermediate IDL representations. That payload must not be used to type the intermediate IDL value.
`ImplementationConverter` requires the assembled type's converted IDL input and
retains that type in its result contract: dictionaries become member records,
callbacks become stamped callables, and nested
sequences and records preserve their value types. Promise fulfillment and async-sequence
element types survive the same path: `promise(sequence(idlType.long))` supplies an
`InternalPromise<number[]>`, and `asyncSequence(sequence(idlType.long))` supplies an
`AsyncIterator<number[]>`. An `IDLPromise` retains its result descriptor, but its
native `promise` remains `Promise<unknown>` because fulfillment conversion has not
necessarily run. Custom callback-interface hooks
and unwrapping overrides keep an unknown result because they can replace that representation.

## Registration and environment composition

`new BindingWorld<Env>(definitions)` assembles definitions requiring that environment.
Each collection receives the same declarations array and owns its construction,
including its fragments and inheritance. Named lookups only read the completed
assembly. Declarations and their nested members and types must remain unchanged
after assembly. Dictionaries retain their members in conversion order;
callback interfaces index their operation declarations.
Callable arguments and dictionary members retain their assembled types, including
applicable conversion attributes such as `[Clamp]`, with names, defaults, and callback
policies directly on the compiled records. Callables also retain argument
optionality and minimum argument counts. This preparation happens during assembly;
invocation and implementation conversion reuse it while reading current values.
Optional input arguments without a supplied value or declared default remain
`undefined`. Callback invocation retains a separate missing-argument marker so
trailing absent arguments can be omitted from the author's argument list.
After realm exposure filtering, assembled overload groups prepare their argument-count
choices, distinguishing positions, and function lengths. Invocation selects from
these groups without rebuilding effective overload entries. One final group handles
all counts beyond the longest variadic declaration, reusing its final argument contract.
Compiled members remain the keys for member bindings.
Each realm retains an `ImplementationBinding` for an assembled construct. It owns
the construct's prototypes, constructor, and other cached platform objects;
its `MemberBinding` objects own registered steps and generated member functions.
`RealmBinding` supplies the realm-wide services they share. Declaration-only
analysis stays in assembly: for example, default-toJSON attribute candidates are
shared, while each implementation binding filters them for its realm's exposure
and reads current values on every invocation.
`registerImplementationBindings()` prepares the implementation steps;
`BindingWorld.register()` publishes the realm only after that succeeds.
Bindings prepare fixed input/result conversions while installing callables.
Dictionary conversion plans retain member converters on first use, while each
invocation reads the current author properties in specification order. Successful
primitive defaults can be reused; sequence and dictionary defaults remain fresh.
Each converter retains its declared type, rules, binding, and allocation realm. Borrowed calls
select the converter for the receiver binding and required allocation realm;
nested conversions preserve those owners while selecting their own type's rules.
IDL-to-implementation argument and attribute converters are prepared from those converted
types. Known callbacks and dictionaries use their specific representations;
known sequences retain an element converter and unpack their fresh lists in place.
Unions and `any` retain runtime discrimination. Recursive dictionary members and
callback and Promise results prepare their nested converters on first use.
Async sequences prepare element conversion when opened and preserve the argument's
callback exception policy. Each advance converts its author value in the iterator's
reaction; implementation conversion then retains that step's result or failure,
so observing the same step again does not consume its IDL containers twice.
Synchronous sources retain their opening realm on the iterator record and run
async-from-sync operations directly, without a private adapter object or generated
methods. Promise adoption and realm-owned result objects remain intact, including
the synthesized result when closing a source without a `return` method.
Converted dictionaries carry a member record; their converter retains the assembled definition.
IDL-to-implementation conversion updates that record in place. `type.canPassToImpl`
identifies values already in their implementation representation, including unwrapped
interfaces, ordinary objects, and sequences of such values. Binding overrides still apply.
`getMembersToConvert()` selects the remaining members, including records that need
unpacking; ordinary objects pass through unchanged.
Direct and prepared implementation conversion share dictionary member plans,
keyed by dictionary and fallback callback exception policy. The input record and
`cbDict()` receiver are supplied per conversion, never retained in those plans.
`cbDict()` must resolve to a dictionary during assembly; it preserves the argument's
fallback policy while allowing individual callback members to override it.
Assembled dictionaries record whether required/defaulted members guarantee a complete
shape after inheritance and partials are combined. Complete dictionaries reuse a property layout,
while sparse dictionaries collect only present entries
before creating the record. Both produce ordinary objects with own data properties,
including `__proto__`. Arbitrary Web IDL records still use a Map during conversion.
Each `CallbackInvoker` retains argument and return converters per callable and
callback realm. The callback value separately captures the current callback context;
that invocation state is never shared through a cached conversion plan.
Bound implementation callbacks retain the callback invoker and result converter,
so invocation does not rediscover the callback contract.
Plans identify primitive arguments that need no projection, allowing invocation
to reuse the internal argument list. Missing arguments, object projection, and
exception requests still take the conversion path. `ImplementationConverter` creates
an implementation callable from an `IDLCallbackFunction` and invocation policy;
it does not change the author's function realm or necessarily fix its `this` value.
Bound callbacks are ordinary functions privately stamped with their IDL callback;
projection reads that stamp without inspecting author function properties.
`IDLCallbackFunction.construct(args, currentRealm)` implements callback construction,
returning the converted IDL result, including primitives. It has no production
consumer yet; HTML custom-element upgrade will need this operation. Construction
uses the original author function, preserving callback realm and lifecycle handling.
The caller supplies the current realm because non-constructor rejection precedes
entry into the callback realm. Callback values retain the callback binding, realm, and
captured callback context; they do not retain the original conversion realm for
this later error.
Runtime consumers use assembled class instances,
which retain their original declarations as `primary`. All realms registered in
that world use these same instances, while their JavaScript constructors and
prototypes remain realm-owned. Realm binding caches use the assembled definitions
as keys. Member searches, operation grouping, inheritance, and legacy metadata
belong to the assembled definitions. Interfaces retain ancestry, member membership,
inherited attribute lookups, and collection declarations on first use, including
absent collection declarations. Collection contents remain per object.
Their collections own implementation-class
lookup, namespace membership, inheritance ordering, candidate-type searches,
typedef expansion, and proxy recognition. Assembly first indexes named definitions,
then compiles their member, argument, and result types. This permits forward
references and recursive dictionaries without retaining unresolved runtime types.
The temporary construction work is discarded when assembly finishes.

`WebIDLType` describes Core declaration syntax. `assembly.getIDLType(type)` is the
input boundary that produces a cached `IDLType`. The two contracts are independent:
an `IDLType` has no declaration generic or source descriptor. Names link directly
to assembled interfaces, dictionaries, callbacks, enumerations, or proxies.
Containers contain IDL element, key, or result types. Integer, string, and buffer
types carry their applicable conversion rules; annotations and aliases are no
longer runtime dispatch cases. Type inference preserves buffer and implementation
payload types without retaining declaration syntax.

Runtime type instances own lazy `candidates`: flattened branches, category selections,
nullability, and the actual numeric branch for integer defaults. Union conversion and
overload resolution read the same selections without querying the assembly.
Primitive representation and implementation pass-through are fixed type fields.
Integer types reference shared width, signedness, and conversion bounds; buffer types
record whether they describe a view. Nullable callback types retain their applicable
legacy callback declaration, while the setter selects attribute-specific conversion.
Comparison keys and completed JSON checks are cached on each IDL type; intermediate
dictionary traversal results are not retained. Assembly also retains derived sequence
descriptors used by Promise aggregates and observable array assignment.

`type.candidates.types` supplies flattened branches with conversion attributes
in their original order. Category selections retain those same types, including their
assembled definitions. Nullable and union branches inherit enclosing annotations; container
contents keep their own annotations. Shared declarations are never mutated, and
conversion does not merge or search attribute arrays per value.

Each converter retains its `type`, binding, and allocation/error realm. Its
specific IDL type is enforced by the subclass constructor. Converters in
different bindings and realms share the same IDL type for the same source use
in one assembly. `binding.getConverter(type, realm)` accepts only `IDLType`,
retaining its result typing and any sequence-specific conversion methods. The
realm defaults to `binding.realm`. Public `BindingContext` conversion methods
and Promise result declarations compile incoming declaration syntax before
entering this machinery. Shared converters and types remain unchanged after creation.
Each realm binding owns a WeakMap keyed by conversion realm, whose maps retain
converters by IDL type. This preserves sharing without keeping discarded
conversion realms alive. Runtime values and their container representations are
unchanged; assembling a type does not allocate a wrapper for each value.
Prepared input/output steps live on the converter and retain no incoming values.
Dictionary converters for different references share input and output preparation
by assembled dictionary, binding, and realm. Output steps retain member converters
while reading current member values on each return. Preparation remains lazy for recursive dictionaries.
`jsToIDL(value)` and `getJSToIDLSteps()` establish the conversion error boundary.
Nested input conversion uses `getInputSteps()` within that boundary; output uses
`idlToJS(value)` or retained `getIDLToJSSteps()`.
Each setter selects its input converter once when its cached function is created.
Ordinary attributes reuse the converter's prepared input steps. Nullable
`[LegacyTreatNonObjectAsNull]` callbacks use a specialized converter that maps
non-objects to null and retains objects without requiring callability. Both use
the same cached converter; no assignment mode is stored on it or passed through
nested conversion. Legacy callback eligibility is a cached declaration lookup.
Converter methods take the value; type and ownership come from the receiver.
`SequenceConverter.jsToIDLIterable()` also accepts the iterator method already
read by overload or union resolution. `FrozenArrayConverter` reuses iteration
and element conversion, then projects and freezes the converted entries.
Enumeration membership uses a retained set of values.
Returned candidate and inheritance lists are shared and must not be modified.
Assembled interfaces collect legacy factory names and lazily prepare their overload
groups; each realm separately retains its factory functions and implementation steps.
Default `toJSON` prepares its exposed attribute list once per realm and interface;
each invocation still reads current getters and converts their values into a new object.
Legacy indexed/named property metadata retains member bindings and prepared converters.
Traps check live property support before input conversion and read operation hooks at
invocation, preserving hook updates and missing-handler errors after projection.
Bindings supply the target facts and install exposed constructs; assembled definitions
evaluate declaration exposure. Member-selection queries can accept predicates using
those assembled methods. Mixins are temporary assembly inputs; contributed members
retain their source declarations for exposure checks. Proxy receiver resolution remains live and binding checks
each candidate's world before accepting it.

Name references to `DefinitionAssembly` `assembly` and references to individual
assembled definitions `assembled`. Qualify the role when several are needed
together, such as `expectedAssembled`; reserve `definition` and `definitions` for
complete raw declarations. Use `member` for a declared member, with more specific
names such as `attribute` or `operation` when useful. Runtime functions and binding
records use names such as `method`, `getter`, `steps`, or `memberBinding`.
`primary` identifies the original declaration retained by an assembled construct;
“declaration” remains useful in prose and contracts spanning several declaration kinds.

`defineProxyObject()` joins that same collection for proxies that stand in for
platform objects, such as HTML's WindowProxy. Conversion preserves the proxy's
identity, while an optional receiver resolver selects the platform object
supplying its interface members. These definitions install no global or prototype
and emit no IDL declaration text. Using JavaScript's `Proxy` alone does not need
this declaration: legacy indexed/named objects and observable arrays keep their
existing binding machinery.
`world.register(realm, createEnvironment)` returns the realm's binding through its
public `BindingContext` type. Repeated registration returns the same object without
calling the factory again; `world.getBindingContext(realm)` only looks it up.

Every registration supplies an environment. Its minimum shape is `{ realm }`;
pure conversion hosts need no execution facilities. Declarations requiring more
name their environment type explicitly. `ctx.realm` has type `Env['realm']`,
and `ctx.getEnvironment()` returns the actual registered object as `Env`.

The factory receives the new Binding Context so it can compose execution
facilities. It must return an environment for that same realm;
the environment getter is unavailable until the factory returns. Composition
and declaration setup must succeed before the realm binding is published.

Registration and global installation are distinct. `ctx.install(target)` installs
exposed definitions; `ctx.projectGlobalObject()` can project into an engine
allocation. A sandbox can register for internal allocations without installing
author interfaces. [Browlet's composition root](../browlet/bindings.ts) demonstrates
both the sandbox and Window paths.

Interfaces attach HTML's `serialSteps` and `transferSteps` directly to their
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

Each provider can name its fields through `SerialSteps<Impl, Fields>` or
`TransferSteps<Impl, Fields>`. The backing record remains a Map; its typed
view checks field names and values. Deserialization receives the completed record
from the matching serializer, not arbitrary author input. Required fields must
be populated by that serializer; TypeScript does not prove that every path writes
them. The HTML traversal keeps the interface-specific shape opaque.

## Identity and construction

One [`PlatformRecord`](binding/platform.ts) is privately stamped onto both an
implementation and its eventual platform object. It retains the owning realm
binding and assembled interface. `record.assembled` supplies its name and exact
serialization and transfer steps. `ctx.createPlatformRecord(name)` resolves the
interface in its own world and creates the object, returning `undefined` when
the interface is unknown or unexposed in that realm. The implementation keeps its
class prototype and private state; public subclassing changes the platform prototype, not the
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

Lazy projection asks the owning realm binding to allocate an object, then attaches
it directly to the existing record. Attachment initializes collection storage,
exception recognition, and unforgeable properties. New construction and global
adoption validate the platform object before creating or reusing that same record.

`ctx.associate(Impl, value)` establishes that record without projection, reusing
the same interface and owner checks as `ctx.project()`. Nested serialization can
name an implementation with `context.subserialize(value, Impl)`. A fresh value
uses the containing object's binding; an associated value keeps its owner.
`record.associateWithOwner(Impl, value)` applies that ownership choice without
requiring the caller to reach through the realm binding. Both association methods
retain the implementation's type in `PlatformRecord<T>`.
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
| Ordinary result containers | Receiver's realm; method's realm for static operations |
| Declared implementation Promise | Its creation environment selects allocation and conversion; returning it preserves the native Promise |
| Invocation failure of a Promise-returning method | Rejected Promise in the method's realm |
| Constructor fallback for non-object `newTarget.prototype` | Constructor's associated realm selects the interface prototype |

Conversion retains platform ownership separately from ordinary allocation.
For example, a callback in realm B can receive a B-owned array containing an
A-owned platform object. A nested interface return projects through its declared
dictionary, sequence, union, or Promise type. A genuine `object`/`any` result
preserves its JavaScript value; Binding cannot infer an undeclared interface.

Existing buffer results retain their identity and realm. When an algorithm needs
a new buffer, its implementation allocates through the owning environment's
execution facilities before returning it.

Implementations receive converted callbacks and dictionaries, not original
author inputs. Bound callbacks retain original identity, invocation receiver,
realm, and exception behavior. Do not wrap or revalidate them in implementations.
Later conversions explicitly required by an algorithm remain at that later step.

## Promises, iteration, and exceptions

Every `InternalPromise<T>` stores its runtime result descriptor in `type`.
Select its owner's constructor: `env.exec.Promise.withResolvers(idlType.Uint8Array)`.
The descriptor determines the resolver's TypeScript payload too:
`reference(BarImpl)` supplies both the interface identity and its implementation type.
Named dictionary results can use `implementationType<MyRecord>(reference('MyRecord'))`.
Web IDL owns those descriptors and their payload mappings; Infra retains them
through a generic result-type contract. Declare compound result types once, such
as `const resultType = sequence(idlType.long)`. `all(values, resultType)` takes
the complete array result descriptor.
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

An unassociated `DOMExceptionImpl` has no selected realm. Throw it directly with
`throw new DOMExceptionImpl(message, DOMExceptionNames.invalidState)`; Binding
projects it when the exception crosses its invocation or delivery boundary. Its
ordinary platform record preserves the selected owner and identity on later
delivery, including delivery through another binding world without associating
it with that world. An interface-valued result projects the same implementation
through normal conversion.
Infra's TypeError, RangeError, and SyntaxError requests remain realm-neutral and
use their private realization record. Author-thrown values retain their identity.
Output conversion realizes exception values for `any`,
`object`, and the object branch of a union. Containers delegate to their member
converters; an interface result projects its implementation directly. Thrown
failures and Promise rejections are realized at their invocation/delivery boundary.
When an algorithm stores or shares a newly created error before returning,
allocate it through the selected `env.exec.TypeError`,
`RangeError`, or `DOMException` constructor. Binding supplies the original
`DOMException` independently of its writable global property.
Core owns the structural `DOMException` and `DOMExceptionConstructor` types.
Its `WebIDLExecution` contract supplies that constructor on an existing `exec`
object without importing JS Engine or requiring a realm. Browlet and Fetch
combine it with engine execution; Stylelet combines it with Infra scheduling.
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
