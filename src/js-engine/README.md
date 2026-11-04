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
| [realm.ts](realm.ts) | `JSRealm`, captured built-ins, JSON, classic compilation/evaluation, function/object allocation, buffers, and global-object integration |
| [runtime.ts](runtime.ts) | Isolate associations, microtask queues, realm lookup, Promise observation, and host-hook adaptation |
| [node-addons.ts](node-addons.ts) | Typed optional backend operations, bound once when loaded |
| [environment.ts](environment.ts) | Portable realm, internal Promise, and scheduling requirements on existing environments |
| [buffers.ts](buffers.ts) | Buffer/view brands, slot inspection, and byte operations |
| [abstract-operations.ts](abstract-operations.ts), [built-in-primitives.ts](built-in-primitives.ts) | Shared JavaScript operations and bounded built-in state inspection |
| [byte-string.ts](byte-string.ts), [crypto.ts](crypto.ts) | Native byte/string conversion, digest computation, and UUID generation |
| [index.ts](index.ts) | Entry point for other subsystems |

## Environments and allocation

`JSRealm.compileFunction(body, parameters, options)` compiles a FunctionBody in
its owning context without executing it or consulting eval/Function policy.
Object scopes are live, ordered outermost first, and honor `Symbol.unscopables`.
The addon uses public V8 `CompileFunction` and `SetName`; stock Node uses
`vm.compileFunction`. Stock compilation preserves the function's own name but
cannot put that name into `Function.prototype.toString()` (an approved expected
failure). HTML selects the scope and Binding supplies platform objects and
creates the callback with its explicit callback context. Host-compiled functions
carry no HTML ScriptOrModule; dynamic import uses the context's loader unless
the addon caller supplies an explicit function loader.

V8 rejects JavaScript Proxies in `CompileFunction`'s context extensions. JS Engine
handles those scopes by validating the original FunctionBody, then compiling a
factory with real `with` environments. This preserves live Proxy operations,
method receivers, strict bodies, and scope order without native changes or
additional named bindings. The factory does not execute the handler body. Its
anonymous function has the correct `.name`, but intrinsic `toString()` omits the
name on every backend; that exact source-text assertion is an approved expected
failure. Ordinary object scopes continue through the direct compiler path.

`JSEnvironment` supplies `realm: JSRealm`, `InternalPromise`, `runInParallel()`,
and `queueTask()`. The environment can be HTML settings, a sandbox, or another host's owner;
the portable contract requires no browser state. Fetch owns its additional
contract for task delivery to an explicit global or parallel queue.

Pass the existing `env` to implementations and derived objects. Use `env.realm`
for buffer allocation, JSON string operations, and the live global object. Its
captured constructors are direct fields, such as `realm.TypeError`,
`realm.ArrayBuffer`, and `realm.Uint8Array`. `realm.NativePromise` is the original
JavaScript constructor; `realm.InternalPromise` supplies realm-aware observation
for implementation promises. Binding extends the latter with result conversion.
Writable built-in methods and prototypes are captured separately, so later
author replacements do not affect internal operations. `env.InternalPromise`
retains Binding's result conversion as well as the realm's observation behavior.
Microtask queues remain on realms and event loops. Subsystem environment interfaces
add the DOM abort and HTML structured-data operations they require directly to
the same owner. Browser composition supplies binding-dependent functions during
environment construction; implementations never receive the Binding Context.
Web IDL Core owns the `DOMExceptionConstructor` type used by higher-level
environment contracts. JS Engine has no Web IDL dependency.

Use `new realm.ArrayBuffer(length)` or `new realm.Uint8Array(length)` for zeroed
storage. `new realm.Uint8Array(bytes)` copies a byte array, while
`new realm.Uint8Array(buffer, offset, length)` shares the supplied buffer.
`createView(name, buffer, offset, length)` retains that operation for dynamically
selected view types. Length counts elements for typed arrays and bytes for
DataView; omitting it uses the remaining range and tracks resizing where
applicable. The view's realm does not change the buffer's identity.

`copyArrayBuffer()`, `copySharedArrayBuffer()`, and `copyArrayBufferView()` copy
raw bytes into fresh storage. In particular, `copyArrayBufferView('Uint16Array',
bytes)` preserves the bytes rather than converting each source byte into a
16-bit element, as the typed-array constructor would.

`JSRealm.cloneSharedArrayBuffer()` allocates a distinct object in the destination
realm while sharing the original backing store, including its growability.
The addon enters that context and uses V8's shared-store constructor. Stock Node
uses a temporary [MessagePort moved into the context](https://nodejs.org/api/worker_threads.html#workermovemessageporttocontextport-contextifiedsandbox),
receives synchronously, and closes both ports. Neither path changes prototypes
after allocation or retains a channel on the realm.

`copyWebAssemblyModule()` snapshots a compiled Module into a fresh host-owned
native token without copying its author properties. `JSRealm.cloneWebAssemblyModule()`
allocates another Module in the destination realm, reusing code and compile options.
The addon uses V8's public compiled-module APIs; stock Node uses the same temporary
MessagePort receipt path as shared buffers. HTML owns storage, interface-exposure,
and AgentCluster restrictions; these engine primitives do not decide them.

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
implementations call them through the owning environment's `realm`. Infra
retains the `JSONValue`/`InfraValue` types and the realm-independent conversion to
maps and lists.
Captured JSON intrinsics preserve parse errors and ignore author replacements of
the global methods. Infra lists become arrays in this realm; maps become
null-prototype objects, with entries defined as data properties.

`stringifyJSON()` retains the intrinsic's possible undefined result.
`serializeJavaScriptValueToJSONString()` instead implements Infra's required
TypeError for a value without a JSON representation. Both preserve exceptions
from author getters and toJSON. Serializers add neither a replacer nor spacing.

[BrowletEnvironment's JSON-byte operations](../browlet/environment/environment.ts) combine
these string operations with Encoding's UTF-8 conversion. JS Engine has
no Encoding dependency. String parsing does not strip a BOM; the byte algorithms
apply their own decoding rules before entering the realm's JSON parser.

## Runtime and realm ownership

`JSRealm.parseScript()` compiles classic code without executing it, returning an
retained `Script` object or target-realm syntax errors. Stock contexts use Node's
`vm.Script`; addon contexts use its matching addon class over a V8 UnboundScript.
`JSRealm.runScript()` executes that artifact in the existing context without
reparsing or performing a checkpoint. HTML owns the Script Record, script
association, modeled execution-context entry, and completion handling.
`evaluate()` remains the separate source-text convenience path. When it installs
a dynamic-import callback, the realm retains compiled code for its 32 most
recent source texts, requiring the same filename and line offset for reuse.
Every call executes again; objects, closures, and global declaration checks remain
fresh. The cache is local to the realm and its fixed loader, so replacement
realms start empty. `parseScript()` never uses it: distinct HTML script records
must retain distinct compilation identities. Without an evaluation import
callback, the existing direct backend path keeps V8's normal cache behavior.
This avoids repeated fresh import identities colliding in V8's compilation
cache. Larger working sets can still evict entries and require recompilation;
this does not repair V8's general cache behavior for separately compiled scripts.

`compileModule()` and `createDefaultExportModule()` retain real engine modules.
`getModuleRequests()` exposes their unresolved dependencies, `linkModule()` links
an explicitly supplied graph, and `evaluateModule()` returns its native completion
Promise without a checkpoint. `getModuleNamespace()` preserves live bindings.
`getWebAssemblyNamespaceInstance()` retrieves the original Instance from the
addon's Wasm namespace association, without executing or re-instantiating anything.
It realizes invalid-namespace errors in the invoked realm. The draft leaves an
unexecuted record's empty Instance slot unspecified; the provisional choice is
ReferenceError, documented in the WebAssembly roadmap. Stock Node and foreign
Node-loader Wasm namespaces lack this association. HTML's Wasm parser remains
a separate integration dependency.
Both backends expose `SourceTextModule` and `SyntheticModule` objects with
`moduleRequests`, `linkRequests()`, `instantiate()`, `evaluate()`, and `namespace`
as applicable. The addon keeps its native handles private; stock Node uses its VM
classes with `--experimental-vm-modules`. HTML owns URL resolution, loading, its script
records, and conversion of the evaluation Promise to `env.InternalPromise`.
CSS exports are projected by Binding before entering the synthetic module.

`compileModule()` also accepts Node's optional `initializeImportMeta(meta, module)`
callback. Node/V8 invokes it lazily with the engine-created object and that module;
it does not run during compilation or linking. `realm.supportsImportMeta` reports
whether this context supports the callback. HTML closes over its source-text
record to supply `url` and `resolve`, independently of active-script tracking.
Stock VM contexts support it; official addon bases require a missing forwarding
export and retain their approved expected failures.

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

`JSRealm.createExoticObject(selectHandlers)` optionally allocates an extensible,
noncallable exotic object. Native trap lookup observes the actual accessing
realm before entering JavaScript, including calls through borrowed builtins;
the selector receives that JSRealm, or undefined for an unregistered Node host.
Its private native target uses the selected descriptor/key view to validate
Proxy results. The host retains one ordinary property store and supplies all
internal methods; engine code owns no HTML origin policy. The target argument
is private machinery and must never be exposed or mutated. Descriptor and key
handlers must be side-effect-free views, since Proxy validation can invoke them
again. Allocation anchors to a retained intrinsic prototype rather than an
attached context handle, allowing creation after global detachment. Stock Node
returns undefined; consumers own their explicitly limited fallback.

With native lookup, ordinary objects use their creation context and function
lookup follows bound/proxy targets without author traps. Context realm references
are stamped with the JSRealm and remain distinct across global-proxy reuse.
The global map is still needed for assigned globals and detached/reused proxies.
Plain Node uses allocation stamps plus incomplete prototype/evaluation evidence;
evaluating a known foreign value must not overwrite its existing association.

Native context handles separate the replaceable realm from the reusable global
proxy. A requested `globalAllocation` holds a stable host view of the actual
per-context global and prototype objects for Web IDL to populate. It is undefined
when no layout was requested or the backend cannot allocate one. `globalObject`
is the installed global, while `globalThis` is the host-selected this value.
`GlobalObject` and `GlobalThis` name those roles
without requiring a particular property shape. Plain Node keeps the modeled
global bridge. HTML requests its prototype layout and supplies origin policy;
JS Engine selects the backend without exposing addon exports to HTML composition.
`reuseGlobalProxyFrom` detaches and reuses the prior proxy when supported; stock
Node keeps its existing modeled-proxy path. Detachment cancels queued V8 work,
so HTML owns the checkpoint-before-reuse boundary.
The addon preserves the detached context's existing embedder token for retained
functions accessing a reused proxy. `setGlobalIndexedProperties()` supplements a
native realm's ordinary property store with owner-supplied indexed reads, mutation
callbacks, and keys. Mutation callbacks cover every array index, including absent
ones; HTML supplies WindowProxy's rejection and child-presence rules. A native
write with a different receiver uses V8's attribute lookup instead of the setter,
so an absent index can still create a property on that receiver.
`registerGlobalGetter()` identifies global IDL attribute functions so retired bare
lookup can invoke them with their original Window view. Explicit public-proxy
lookup and author accessors use V8's ordinary receivers. Original-global capture
is private to the addon, uses no engine patch, and is described in its
[allocation contract](../../node-compat/README.md#native-global-property-storage).

The `globalAccess` realm option supplies an accessing-realm policy. JS Engine
enables native checks and distinct security tokens, installs the selector, and
resolves the native caller through the existing realm stamper. Allowed access
stays in V8; denied access selects the host's foreign Get/Set, descriptors, keys,
and exception. JS Engine splits keys into V8's named/indexed interceptor lists.
Stock Node cannot enforce the policy; its automatic caller-selection gap remains.
HTML supplies WindowProxy policy during composition. The addon owns the
isolate-wide failed-access hook and its registration lifetime; see the
[access contract](../../node-compat/README.md#native-global-access-checks).
`compileHostFunction()` compiles trusted code in the host, independently of the
currently executing author realm. `compileHostSteps()` captures explicit
dependencies and a caller-encoded source URL around a generated function;
Web IDL supplies its own labels and algorithms. Author functions keep their
realm-owned compilation and policy.

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

`createMicrotaskQueue(requestCheckpoint?)` can notify the owner after native
execution, such as FinalizationRegistry cleanup, that bypasses its task runner.
It also observes settlement of an owned Promise, including native Atomics
completion, without attaching a reaction or reading author properties.
The addon coalesces notifications per queue until a checkpoint; HTML schedules
that checkpoint through its existing host turn. JS Engine omits the fallback
when native Promise-job hooks are installed. Stock mode keeps Node's scheduling.
It is not a general signal for jobs arriving from another context: a raw Node
Promise can enqueue a Window callback without settling a Window-owned Promise.

`setHostHooks` is optional. It maps native references to known JSRealms; unknown
references become null. Promise routing follows the **job's queue realm**, which
can differ from a handlerless reaction's null specification realm. Returning
false preserves the original V8 queue. Generic/timeout enqueue hooks also accept
`false`, leaving native notification delivery or the original cancelable timer
with V8. HTML accepts only jobs belonging to its realms and chooses their task policy.

`JSRealm.setPromiseRejectionTracker()` installs a reject/handle callback for the
executing context. Its third argument identifies the retained compiled code:
`undefined` means no engine metadata; `null` means unrecognized code. The hook
works on every addon base without the job-hook patches. Internal sandboxes
remain unregistered. `isPromiseHandled()`
and `getPromiseResult()` read native slots without changing handled state or
consulting author properties. Stock Node retains Node reporting and explicitly
throws for those unavailable slot reads; it does not substitute process events.

`JSRealm.setWasmAsyncCompletionCallback()` supplies native Wasm completion as a
one-shot `complete()` operation and a task-source key for the owning host to schedule.
`compileWebAssembly()` selects that source for each native Promise, including
failures delivered before the native call returns. Ordinary native calls retain
the engine source; response compilation selects networking. This requires
only the addon on every base; stock Node retains native scheduling. HTML returns
through a task before Promise resolution and possible author `then` lookup.
The bridge does not allocate replacement results, poll, or drain microtasks.
See the [native contract](../../node-compat/README.md#native-webassembly-completion).

An optional Response URL selects the realm's captured native `compileStreaming()`.
The runtime adapts privately consumed bytes to a Node Response and supplies its
URL without another fetch. This keeps the existing completion hook and native
Promise. Node-owned malformed-byte errors are realized in the caller's realm
before the browser adapter resolves its public Module. That separation preserves
author rejections without validating bytes a second time. Direct byte compilation
is unchanged. The source comments document the Response accommodation and V8's
accepted first-URL cache behavior; see the
[Web API review](../browlet/webassembly/ROADMAP.md#4–7-and-closing-material-reviewed).

Each realm supplies an `InternalPromise` constructor extending
Infra's [`InternalPromise`](../infra/promises.ts) with realm-owned observation. Static creation
methods and instance chaining retain that constructor. `InternalPromise.fromInternal()`
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
It is available without an environment or Binding; registration builds the
binding constructor before composing its environment. Browser implementations
use that binding constructor through `env.InternalPromise`, including for private
results, rather than choosing `realm.InternalPromise` to bypass conversion. Neither
internal constructor is the captured native `realm.NativePromise`.

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
- `realm.createWebAssemblyImportCall(module, importIndex, callback)` completes
  native result conversion within the returned call, using that realm for
  conversion errors. The addon owns signature decoding and cached Wasm bridges;
  HTML retains the original callback's script/settings lifecycle. Stock mode
  returns the callback unchanged, so V8 performs conversion after scope cleanup.
  [The addon contract](../../node-compat/README.md#webassembly-imported-function-conversion)
  records supported binary encodings and the extra Wasm call cost.

Tests in [test/js-engine](../../test/js-engine/) cover these contracts. Browser
integration tests additionally establish actual realm, binding, and HTML task
behavior; a narrow backend test alone does not establish those connections.
