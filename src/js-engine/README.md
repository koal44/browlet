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
| [realm.ts](realm.ts) | `JSRealm`, captured intrinsics, evaluation, function/object allocation, runtime buffers, and global-object integration |
| [runtime.ts](runtime.ts) | Isolate associations, microtask queues, realm lookup, Promise observation, and host-hook adaptation |
| [node-addons.ts](node-addons.ts) | Typed optional backend operations, bound once when loaded |
| [environment.ts](environment.ts), [realm-execution.ts](realm-execution.ts) | Portable environment and execution contracts supplied to implementations |
| [buffers.ts](buffers.ts) | Buffer/view brands, slot inspection, and byte operations |
| [abstract-operations.ts](abstract-operations.ts), [built-in-primitives.ts](built-in-primitives.ts) | Shared JavaScript operations and bounded built-in state inspection |
| [byte-string.ts](byte-string.ts), [crypto.ts](crypto.ts) | Native byte/string conversion, digest computation, and UUID generation |
| [index.ts](index.ts) | Entry point for other subsystems |

## Environments and allocation

`JSEnvironment` supplies `exec: RealmExecution` and
`queueNetworkingTask(steps, destination)`. The shared method either enqueues on
an explicit parallel queue or delegates global delivery to `exec.networking`.
The environment can be HTML settings, sandbox execution, or another host's
standalone owner; the portable contract requires no browser state.

Pass the existing `env` to implementations and derived objects. Use `env.exec`
for Promises, buffers, JSON, microtasks, background work, file/network task
delivery, abort construction, and structured data. Browser composition supplies
the HTML/DOM operations; declaring the contract here does not move their
algorithms into JS Engine. Binding Context and projection stay outside `exec`.
Web IDL's `DOMException` constructor belongs to its separate Core execution
contract; higher layers combine it with `RealmExecution` on the same object.
JS Engine has no Web IDL dependency.

`JSRealm.createRuntimeBuffers()` provides realm-owned operations without exposing
the realm. `allocateArrayBuffer()` creates zeroed fixed storage. `createView()`
uses the supplied buffer without copying it; its length counts elements for
typed arrays and bytes for DataView. Omitted length uses the remaining range
and tracks resizing where applicable. The view's realm does not change the
buffer's identity.

Copy operations preserve input; `transferArrayBuffer()` consumes exclusive
storage and detaches old views, preserving resizability. The consuming
specification decides which inputs may be transferred. Allocate final storage
directly when possible. Structured `serialize`/`deserialize` retain an opaque
owner-defined record and reconstruct in the destination environment; `clone`
performs the immediate operation.

## Runtime and realm ownership

One private `JSRuntime` per module instance owns isolate-level associations and
the ambient queue. Consumers use named functions; realm-owned operations stay
on `JSRealm`. Hosts subclass JSRealm to add policy. Node workers load independent
module instances. Do not add per-Agent or per-BindingWorld realm registries:
values can cross those boundaries synchronously within an isolate.

`NodeAPI.getMethod(name)` reports actual availability; calling an unavailable
typed operation throws. Backend selection is configured before loading the
module. Native facilities and build instructions belong to
[Node compatibility](../../node-compat/README.md).

With native lookup, ordinary objects use their creation context and function
lookup follows bound/proxy targets without author traps. Context realm references
are stamped with the JSRealm and remain distinct across global-proxy reuse.
The global map is still needed for assigned globals and detached/reused proxies.
Plain Node uses allocation stamps plus incomplete prototype/evaluation evidence;
evaluating a known foreign value must not overwrite its existing association.

Native context handles separate the replaceable realm from the reusable global
proxy. Window allocation creates the immutable prototype chain before Web IDL
populates it. Plain Node keeps the modeled global bridge. Neither path supplies
browser cross-origin security. Detachment cancels queued V8 work, so HTML owns
the checkpoint-before-reuse boundary.

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
backing and source conversion. Private payloads
are boxed to avoid thenable adoption. The `withResolvers()` result's `isResolved`
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
- `writeUTF8Into()` retains native bulk conversion and finishes an underfilled
  prefix with a scalar writer. Remove that repair when all supported engines
  supply the correct fitting behavior.

Tests in [test/js-engine](../../test/js-engine/) cover these contracts. Browser
integration tests additionally establish actual realm, binding, and HTML task
behavior; a narrow backend test alone does not establish those connections.
