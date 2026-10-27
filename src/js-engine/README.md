# JS Engine

The JavaScript-engine substrate below Web IDL and the web-platform subsystems.
It supplies realm-owned allocation, captured intrinsics, engine facts, and the
Node/native backend. HTML owns Agents, settings, tasks, and script policy;
Web IDL owns conversion, platform identity, and projection.

The shared [architecture](../ARCHITECTURE.md) defines composition rules.
[LIMITATIONS.md](../LIMITATIONS.md) records observable backend constraints;
the [roadmap](ROADMAP.md) identifies remaining engine/HTML integration work.

## Module guide

| Module | Responsibility |
| --- | --- |
| [realm.ts](realm.ts) | `JSRealm`, captured intrinsics, JSON, classic compilation/evaluation, function/object allocation, runtime buffers, and global-object integration |
| [runtime.ts](runtime.ts) | Isolate associations, microtask queues, realm lookup, Promise observation, and host-hook adaptation |
| [node-addons.ts](node-addons.ts) | Typed optional backend operations, bound once when loaded |
| [environment.ts](environment.ts), [realm-execution.ts](realm-execution.ts) | Portable environment and execution contracts supplied to implementations |
| [buffers.ts](buffers.ts) | Buffer/view brands, slot inspection, and byte operations |
| [abstract-operations.ts](abstract-operations.ts), [built-in-primitives.ts](built-in-primitives.ts) | Shared JavaScript operations and bounded built-in state inspection |
| [byte-string.ts](byte-string.ts), [crypto.ts](crypto.ts) | Native byte/string conversion, digest computation, and UUID generation |
| [index.ts](index.ts) | Entry point for other subsystems |

## Environments and allocation

`JSEnvironment` supplies `realm: JSRealm` and `exec: RealmExecution`. The environment
can be HTML settings, sandbox execution, or another host's standalone owner;
the portable contract requires no browser state. Fetch owns its additional
contract for task delivery to an explicit global or parallel queue.

Pass the existing `env` to implementations and derived objects. Use `env.exec`
for Promises, errors, buffers, JSON, microtasks, background work, and task delivery.
Subsystems add Infra's `AbortExecution` and `StructuredDataExecution` contracts
where needed; those requirements are absent from `RealmExecution`.
Browser composition supplies the DOM/HTML operations on the same `env.exec`.
Binding Context and projection stay outside `exec`.
Web IDL's `DOMException` constructor belongs to its separate Core execution
contract; higher layers combine it with `RealmExecution` on the same object.
JS Engine has no Web IDL dependency.

`JSRealm.createRuntimeBuffers()` provides realm-owned operations without exposing
the realm. `allocateArrayBuffer()` creates zeroed fixed storage. `createView()`
uses the supplied buffer without copying it; its length counts elements for
typed arrays and bytes for DataView. Omitted length uses the remaining range
and tracks resizing where applicable. The view's realm does not change the
buffer's identity.

`JSRealm.cloneSharedArrayBuffer()` allocates a distinct object in the destination
realm while sharing the original backing store, including its growability.
The addon enters that context and uses V8's shared-store constructor. Stock Node
uses a temporary [MessagePort moved into the context](https://nodejs.org/api/worker_threads.html#workermovemessageporttocontextport-contextifiedsandbox),
receives synchronously, and closes both ports. Neither path changes prototypes
after allocation or retains a channel on the realm.

Engine predicates accept unknown inputs and preserve their native kind in the
type system. `isObject` and `isCallable` include the native HTMLAllCollection
despite its misleading `typeof`; recognition does not allocate or invoke author
code. There are no separate predicates for author and implementation values.
Buffer and built-in state operations take already validated values;
keep that type after Web IDL conversion or a brand check. A known kind does not
guarantee that its backing storage remains attached or in bounds. View allocation
also preserves the backing buffer type, including shared storage.

Copy operations preserve input; `transferArrayBuffer()` consumes exclusive
storage and detaches old views, preserving resizability. The consuming
specification decides which inputs may be transferred. Allocate final storage
directly when possible. Structured `serialize`/`deserialize` retain an opaque
owner-defined record and reconstruct in the destination environment; `clone`
performs the immediate operation.

## JSON

JSRealm implements Infra §6's JSON string and object-conversion algorithms;
`RealmExecution` exposes them through the owning environment's `exec`. Infra
retains the `JSONValue`/`InfraValue` types and the realm-independent conversion to
maps and lists.
Captured JSON intrinsics preserve parse errors and ignore author replacements of
the global methods. Infra lists become arrays in this realm; maps become
null-prototype objects, with entries defined as data properties.

`stringifyJSON()` retains the intrinsic's possible undefined result.
`serializeJavaScriptValueToJSONString()` instead implements Infra's required
TypeError for a value without a JSON representation. Both preserve exceptions
from author getters and toJSON. Serializers add neither a replacer nor spacing.

[BrowletEnvironment's JSON-byte operations](../browlet/environment.ts) combine
these string operations with Encoding's UTF-8 conversion. JS Engine has
no Encoding dependency. String parsing does not strip a BOM; the byte algorithms
apply their own decoding rules before entering the realm's JSON parser.

## Runtime and realm ownership

`JSRealm.parseScript()` compiles classic code with Node's `vm.Script` without
executing it, returning an opaque artifact or target-realm syntax errors. HTML
wraps successful code with its Script Record, realm, and HostDefined. Execution
of retained compiled artifacts remains separate, unfinished work; `evaluate()`
still takes source text and is not used as a parser.

One private `JSRuntime` per module instance owns isolate-level associations and
the ambient queue. Consumers use named functions; realm-owned operations stay
on `JSRealm`. Hosts subclass JSRealm to add policy. Node workers load independent
module instances. Do not add per-Agent or per-BindingWorld realm registries:
values can cross those boundaries synchronously within an isolate.

`NodeAPI` exposes supplied operations as bound functions and leaves unavailable
operations `undefined`. Callers check those properties directly to select a
fallback; native-only entry points report unsupported operations explicitly.
Backend selection is configured before loading the module. Native facilities and
build instructions belong to
[Node compatibility](../../node-compat/README.md).

With native lookup, ordinary objects use their creation context and function
lookup follows bound/proxy targets without author traps. Context realm references
are stamped with the JSRealm and remain distinct across global-proxy reuse.
The global map is still needed for assigned globals and detached/reused proxies.
Plain Node uses allocation stamps plus incomplete prototype/evaluation evidence;
evaluating a known foreign value must not overwrite its existing association.

Native context handles separate the replaceable realm from the reusable global
proxy. A requested `globalAllocation` holds the engine-created global target and
prototype objects for Web IDL to populate; accessing it without requesting a
prototype layout throws. `globalObject` is the installed global, while `globalThis`
is the host-selected this value. `GlobalObject` and `GlobalThis` name those roles
without requiring a particular property shape. Plain Node keeps the modeled
global bridge. Neither path supplies browser cross-origin security. Detachment
cancels queued V8 work, so HTML owns the checkpoint-before-reuse boundary.

Captured host intrinsics can throw host-realm errors. Buffer metadata operations
translate detached/out-of-bounds DataView failures into Infra TypeError requests;
Binding realizes them in the invocation's realm. Keep these catches around the
intrinsic only, preserving author-thrown errors. The consuming algorithm still
chooses its policy: Streams rejects invalid storage, while `getBufferSourceView()`
supplies an empty view for detached input used by Encoding.
Length helpers report current intrinsic lengths, including resizing, rather than
raw stored lengths. The [buffer-length contract](ROADMAP.md#buffer-source-byte-length)
records the discrepancy with Web IDL's current definition.

## Queues and Promises

`JSMicrotaskQueue` exposes its `ambient`/`explicit` kind, `enqueueMicrotask()`,
and `performMicrotaskCheckpoint()`. HTML gives each Agent's realms the same
event-loop queue. Native queues retain their handles directly. Without that
facility, event loops share Node's ambient queue and its checkpoint substitute;
HTML checkpoint guards and post-checkpoint work still belong to HTML.

`setHostHooks` is optional. It maps native references to known JSRealms; unknown
references become null. Promise routing follows the **job's queue realm**, which
can differ from a handlerless reaction's null specification realm. Returning
false preserves the original V8 queue. Generic/timeout enqueue hooks transfer
all scheduling and have no per-job fallback. HTML chooses settings and task policy.

Each realm supplies a `Promise` constructor extending
Infra's [`InternalPromise`](../infra/promises.ts) with realm-owned observation. Static creation
methods and instance chaining retain that constructor. `Promise.fromInternal()`
selects the consumer's reaction destination while sharing the existing native
backing, source conversion, and private fulfillment storage. Private values stay
on their original internal Promise; the native backing signals completion without
adopting them. The `withResolvers()` result's `isResolved`
becomes true when the first `resolve()` or `reject()` call is accepted, even while
waiting for another Promise's outcome; it does not inspect native settlement.

Binding extends the realm's constructor with declared-result conversion.
[Declared results](../web-idl/README.md#promises-iteration-and-exceptions) share
one native Promise between implementation and author code. JS Engine's own
constructor has no binding conversion and continues to serve private work.

Native observation installs reactions in the observer's realm; plain Node uses
the captured `then` intrinsic. Their constructor/species differences and the
discarded derived Promise are documented under
[Promise observation](../LIMITATIONS.md#promise-observation). Web IDL retains
typed fulfillment conversion.

`bindAsyncContext(steps)` preserves Node scheduling-time AsyncLocalStorage state
across explicit task handoff. It does not choose a Promise queue or establish
HTML execution ownership. Node diagnostics must remain able to complete without
an HTML checkpoint.

## Admission rule

An operation belongs here when it exposes an engine fact, preserves a realm or
intrinsic invariant, or isolates a necessary backend accommodation. Ordinary
`Reflect` calls, type checks, and language evaluation do not need wrappers merely
because a specification names their ECMAScript counterparts.

Keep realm-neutral foundations in Infra; keep policy, state, and lifecycle with
their specification owner. External scheduling/I/O enters through a narrow Host
Port. Do not give a bounded substitute the name of a complete abstract operation:
`getAssociatedRealm()` reports only the evidence available for registered realms.

## Node/V8 accommodations

The [limitations catalog](../LIMITATIONS.md) owns detailed consequences, tests,
and replacement conditions. The remaining implementation boundaries are:

- Native realm lookup replaces prototype/evaluation inference when available.
- Native queues and global allocation replace the ambient checkpoint and
  modeled global bridge independently; queue support does not supply job hooks.
- `createCollectionIterator()` uses the patched native factory when available.
  Web IDL supplies live iteration and conversion; the Proxy fallback preserves
  ordinary iteration but cannot satisfy borrowed native Map/Set `next()`.
- Native length-mode inspection avoids mutation. Other backends use reversible
  resizing only for ordinary resizable buffers; shared growth is irreversible.
  The non-destructive detach-key predicate remains unavailable.
- Captured intrinsic/brand probes support structured data without taking over
  HTML graph traversal, serialization policy, or DataCloneError construction.

Tests in [test/js-engine](../../test/js-engine/) cover these contracts. Browser
integration tests additionally establish actual realm, binding, and HTML task
behavior; a narrow backend test alone does not establish those connections.
