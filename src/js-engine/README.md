# JS Engine boundary

This project owns Browlet's JavaScript-engine substrate. It sits below Web IDL
and has no knowledge of HTML Agents, environment settings objects, tasks,
Documents, Windows, or platform-object projection.

It also defines the neutral [`RuntimeContext`](./runtime-context.ts) contract
shared by implementations. Browlet composes its task, abort, and structured-data
providers; their HTML/DOM policy stays above this layer. `serialize()` captures
an opaque record, `deserialize()` reconstructs it in the destination runtime's
realm, and `clone()` supplies immediate cloning. Engine-owned
buffer inspection and writes live in [`buffers.ts`](./buffers.ts). Realm-owned
allocation, view construction, and transfer belong to the
[`JSRealm`](./realm.ts) class. Its `createRuntimeBuffers()` method supplies
those operations to implementations without exposing the realm. Web IDL retains
BufferSource conversion. The composition and lifetime rules are authoritative
in [SUBSYSTEM-ARCHITECTURE.md](../SUBSYSTEM-ARCHITECTURE.md#runtime-context).

`JSRealm.createCollectionIterator(kind, next)` allocates a Map/Set iterator;
Web IDL supplies the live iteration and per-step conversion callback. The
patched V8 factory provides native `next()` branding and iterator lifecycle.
Without that factory, the engine layer retains the labeled Proxy fallback for
ordinary iteration; borrowing native Map/Set `next()` remains unsupported.

`runtime.buffers.allocateArrayBuffer(byteLength)` creates zero-initialized,
fixed-length storage in the owning realm. `createView(name, buffer, byteOffset?,
length?)` creates a concrete typed array or DataView over the supplied buffer
without copying or replacing it. Length counts elements for typed arrays and
bytes for DataView; omitting it uses the remaining range and tracks resizing.
The view belongs to the runtime's realm; its buffer keeps its existing identity.
Prefer allocating final storage directly when the implementation controls it.
The existing `copyArrayBuffer` and `copyUint8Array` operations preserve input;
`transferArrayBuffer` consumes an exclusively owned buffer and detaches its old
views. Ordinary transfer preserves resizability; consuming specifications still
determine which buffers are admissible.

The [JS Engine roadmap](./ROADMAP.md) inventories HTML's complete
ECMAScript dependency list and separates ordinary engine behavior from the
small set of inaccessible runtime facts and genuine host hooks.
Its work proceeds by coherent consumers. The first runtime slice established
explicit versus ambient microtask-queue backends. The compatibility addon also
supplies the `ContextHandle` and global-proxy lifecycle, now adopted by HTML
Window creation and navigation. The custom engine adds job hooks; the current
HTML integration consumes make/call and all three enqueue hooks. Script records,
module loading, and the remaining HTML job consumers follow their own roadmaps.

The [compatibility addon](../../node-compat/README.md) now supplies explicit
queues and reusable native context handles on Node 24 and 26. The `with-node`
launcher chooses the Node base through `NODE_BASE` and enables the addon for
`NODE_RUNTIME=compat`. It supplies the internal `BROWLET_NODE_ADDON` module path
to the runtime module; embedders can also supply that path directly.
`JSRealm` delegates evaluation to that selected backend. The addon does not
make node:vm recognize its handles and does not yet supply post-creation
prototype immutability. References to stock fallbacks below mean plain Node
without the addon. References to source-patched Node describe the original
Node branch. Browlet's Window creation and navigation now use the addon's
creation-time immutable allocation; they no longer require that branch's
post-creation immutable-prototype operation.

`setHostHooks()` adapts the make/call and three enqueue hooks
to known `JSRealm` identities. Context-handle references keep successive
realms distinct even when their WindowProxy is reused. `RealmStamper`
privately attaches the `JSRealm` to each backend realm reference; native lookup
and host hooks read it directly. The reference is an ordinary object distinct
from the reusable global proxy, so detachment and reuse preserve its state.
The Promise enqueue adapter also
identifies the realm owning the job's queue, which can differ from the null
specification realm of a handlerless reaction. HTML owns the settings and task
policy. Returning false from Promise enqueue retains its native V8 queue;
generic and timeout enqueue always transfer scheduling to the host. Unknown
realm references map to null. `setHostHooks` is absent when the backend cannot
install the hooks; callers check the function directly.

Promise routing uses the job's queue realm, without an ambient execution owner
or a saved-continuation-data lookup. Node reactions, including runtime diagnostics,
remain on Node's queue even when created during a platform operation or HTML task.
Each realm owns a `Promises` facility for allocation, adoption, and native
observation. Bindings supply it through Runtime Context to asynchronous implementations. A
`PromiseValue<T>` retains that facility through `.then()` and `.catch()`;
terminal `.observe()` needs no destination argument. `Promises.import()` brings
a native or another owner's internal result into the consumer's destination.
Internal payloads are boxed so they are not accidentally adopted as thenables.
Capabilities expose a read-only `pending` flag maintained by their resolving
functions, so callers do not duplicate settlement tracking. This describes
internal boxed settlement, not the resolution state of an adopted author Promise.
The generic machinery lives in [promises.ts](./promises.ts); see the shared
[return boundary](../PLATFORM-OBJECT-ARCHITECTURE.md#return-projection).

`bindAsyncContext(steps)` retains Node's scheduling-time async context for an
explicit task handoff. This preserves unrelated AsyncLocalStorage channels;
it neither selects a Promise queue nor adds a Browlet ownership channel.

## Admission rule

Classify code by ownership before extracting it:

| Home | Admission test | Examples |
| --- | --- | --- |
| `js-engine/` | An ECMAScript abstract operation, realm or isolate fact, captured intrinsic, or bounded substitute for an inaccessible engine operation whose contract does not import another platform subsystem | `IsObject`, realm-owned function creation, ArrayBuffer slot inspection |
| `infra/` | An Infra algorithm or a small realm-neutral foundation with reuse across subsystems | `assertNever`, tuple mapping, text cursors |
| Owning subsystem | Policy, state, or lifecycle defined by that specification | Web IDL conversion and overload policy, HTML task and serialization policy, Streams queues, File behavior |
| Integration or Host Port | An external effect supplied by the embedder or composition root | clocks, native line endings, scheduling, parser input and output |

Repetition alone is insufficient, and using an ECMAScript value does not make
an operation JavaScript-owned. Keep policy with its specification and external
effects at the composition boundary.

An engine effect can occupy both sides of a Host Port without merging their
ownership. The stable engine operation and its concrete Node accommodation
belong here; the consuming subsystem injects that narrow operation and retains
the specification policy which decides when to use it. The microtask-queue
backend below is the model.

Passing this rule permits an operation to live here; it does not require a
wrapper around every `Reflect` call, type test, or built-in conversion. Add a
JavaScript operation when it contains an engine accommodation, preserves an
observable realm or engine invariant, or removes a meaningful duplicate
implementation. Otherwise leave the native expression with its caller.

Do not give a partial substitute the name of a complete ECMAScript operation.
In particular, `getAssociatedRealm()` reports the realm evidence
available to this embedder. With the addon it follows ordinary, bound, and proxy
function targets through V8; plain Node still uses incomplete prototype evidence.
It returns only realms registered with this runtime. The Web
IDL iterator state machines likewise remain Web IDL behavior rather than being
presented as `CreateIteratorFromClosure` until the JavaScript layer can supply
that operation independently of Web IDL records and conversion policy.

The engine's realm and isolate state are backed by Node and the optional addon:

- The private [`JSRuntime`](./runtime.ts) owns global-to-realm associations,
  the active evaluation realm, and the shared ambient queue. Its module exposes
  named operations and defines host hooks, job records, and the microtask-queue
  contract;
- [`JSRealm`](./realm.ts) owns one Node VM context, its captured intrinsics,
  evaluation, function creation, and global-object bridge, and receives the
  selected microtask queue when its context is created; and
- Web IDL or HTML hosts subclass `JSRealm` to add their own policy without
  introducing a forwarding realm object.

There is one private `jsRuntime` instance per module instance. Consumers call
`createMicrotaskQueue()`, `getAssociatedRealm()`, and the other runtime functions
directly. Only operations that use isolate state forward to `jsRuntime`; the
remaining operations are implemented directly as module functions.
Realm-owned operations remain on `JSRealm`. The engine initializes
independently of Browlet. Node workers load separate module instances and
therefore receive separate runtime owners.

[`NodeAPI`](./node-addons.ts) loads the backend and binds each available method
once. The `addon` instance exposes typed calls such as `addon.getRealm(value)`;
calling an unavailable operation throws an error naming it. Callers and tests
use `addon.getMethod(name)` to get a supplied method or `undefined`. Availability
is checked per operation. Runtime operations such as
`createMicrotaskQueue()` remain available on plain Node through their documented
fallbacks. The realm-adapting `setHostHooks` operation is itself optional because
there is no fallback for installing engine hooks.
Do not construct per-Agent, per-AgentCluster, or per-BindingWorld realm maps:
objects can cross those boundaries synchronously within one isolate.

The JavaScript-facing queue contract is deliberately independent of Node's VM
handle:

```ts
interface JSMicrotaskQueue {
  readonly kind: 'explicit' | 'ambient';
  enqueueMicrotask(steps: () => void): void;
  performMicrotaskCheckpoint(): void;
}
```

The addon or source-patched Node supplies an explicit V8 queue. Each HTML EventLoop
asks the runtime factory for one queue, passes that same queue to every realm
belonging to its Agent, and uses it for both HTML `queueMicrotask()` and
checkpointing. The factory selects an explicit queue from either backend or
the one ambient queue backed by `queueMicrotask()` and the checkpoint
accommodation below under stock Node. The upper layer owns the queue according to
its lifecycle; the JS Engine project supplies its engine implementation
without importing HTML.

The private `AddonMicrotaskQueue` implementation retains its native handle
directly. Context creation uses that handle to attach the same V8 queue; there
is no separate queue-handle registry.

## Node/V8 accommodations

`node-utf8-encode-into` checks native `TextEncoder.encodeInto()` once for the
two sizing defects present in Node 26.8.1. Node 24.19.0 and our corrected custom
engine use the native writer. Affected builds retain the scalar writer behind
the same `writeUTF8Into` operation; both report consumed UTF-16 code units and
written bytes. No addon is required. Remove the probe and scalar fallback when
every supported Node build contains both corrections.

Realm lookup and allocation recording select their native or fallback functions
once when the runtime module loads. With native lookup, functions use V8's public
proxy-target, bound-target, and creation-context APIs without invoking author
traps. Ordinary objects use V8's creation context and need neither map entries nor
stamps. Evaluating a foreign value does not change its ownership.

`JSRuntime.#globalRealms` holds only the VM global and the supplied global object
and global-this value. Browlet supplies its projected Window and WindowProxy;
the plain-Node WindowProxy is created by host code, so its assigned realm differs
from its native creation realm. The map also preserves a detached native global
proxy's last realm until replacement construction associates it with the new
realm. Native creation-context lookup rejects that proxy while it is detached,
and its private fields do not survive reuse. This reverse lookup belongs to the
runtime because its callers have a global object without knowing its realm yet.

Without native lookup, `RealmStamper` attaches the realm to ordinary allocations
and intrinsic prototypes. `node-v8-object-realms` follows prototype chains and
falls back to an active `JSRealm.evaluate()` call when inspection fails. It stamps
the first evaluation association onto returned values, including frozen and
null-prototype objects, without overwriting known origins or inspecting author
properties. Repeated lookup reads the stamp directly; globals stay in their map.
These are incomplete clues: an unseen foreign result can still be assigned to
the returning realm, and hidden bound/proxy targets cannot be inspected. The
constructor-realm regressions expect failure when native function-realm lookup
is unavailable, using the `functionRealms` test requirement.

Constructible functions use a realm-owned Proxy construction entry so Binding
performs allocation and reads `newTarget.prototype` once. Construction steps
receive no preallocated receiver and must return their object. This fixes
construction behavior; the separate host-helper/author-script distinction in
the [roadmap](./ROADMAP.md#working-boundary-matrix) remains open.

`node-vm-global-proxy` bridges a supplied global object and global-this value
through Node's context global. Stock Node cannot install an existing
WindowProxy as the VM context's true global-this, so free names reach the
modeled global graph while top-level `this` remains the VM global. A
compatibility backend instead exposes an opaque `ContextHandle` for the
replaceable execution context and a separate `globalProxy` identity. The
handle can detach that proxy; supplying the detached handle as
`reuseGlobalProxyFrom` transfers the proxy once to a fresh Realm with fresh
intrinsics and global state. The handle itself proves provenance, so the
runtime needs no global proxy registry. `JSRealm` uses this handle whenever
compatible context creation is available. The addon allocates the immutable
Window prototype chain at context creation, then Web IDL projects into those
objects. Post-creation sealing survives only as historical backend support.

The native contexts deliberately use Node's ordinary VM principal token
so host code can configure the global proxy. That is an embedder-access choice,
not browser origin isolation: `origin` remains inspector metadata, and the API
does not supply WindowProxy cross-origin access callbacks. V8 also cancels jobs
still queued for an old Realm when its global is detached. Browlet navigation
checkpoints before reuse and Web IDL exposes the native proxy; the remaining
WindowProxy cross-origin and nested-context contracts are later HTML work.

`node-v8-checkpoint` is now the stock/ambient fallback. Stock Node has no
supported synchronous V8 microtask-checkpoint operation, so that backend uses
private `process._tickCallback()`. The addon or source-patched Node instead gives an
explicit queue both `enqueueMicrotask()` and `runMicrotasks()`; the runtime maps
those to the queue contract above. Replace or remove only
the ambient backend when the supported stock baseline gains the same complete
surface—HTML's checkpoint guard and post-checkpoint work remain specification
behavior in either mode.

`JSRealm.observePromise()` uses the addon's native `v8::Promise::Then` operation.
It installs forwarding functions in the observer's realm. Node 26.8.1 and the
custom engine bypass author `then`, `constructor`, and `@@species`; Node 24.19.0's
older V8 still consults `constructor`, retained as an expected failure. No
compatibility workaround is applied. The public V8 operation still
allocates a derived promise, which this boundary discards; it is not the exact
no-result-capability form of `PerformPromiseThen`. Web IDL retains its typed
promise records, conversions, reaction steps, and result-capability policy.
Without the addon, `node-v8-promise-reactions` retains the captured
`Promise.prototype.then` fallback so ordinary asynchronous work can finish.
That path also bypasses an overridden `then`, but reads `constructor` and
`@@species` and cannot isolate or synchronously drain Node's ambient queue
from an already running microtask. The conformance regressions remain visible;
the eventual-delivery test separately checks ordinary fulfillment and recovery.
Remove this fallback when native observation is available on every supported
backend, rather than turning a missing optional addon into a blanket throw.

`node-v8-exotic-object-slots` isolates the engine inspection needed by HTML
structured serialization. Node's `util.types` exposes many V8 object brands,
and captured intrinsic methods read or update built-in state without invoking
author methods. Node does not expose an exhaustive internal-slot or
exotic-object query, so a native structured-clone probe is safe only for
propertyless objects; a decorated Array or String iterator can still resemble
an ordinary object. The JS Engine project reports or updates these engine
facts, while HTML retains serializability decisions, graph traversal,
platform-object dispatch, and `DataCloneError` creation. Replace the
predicates, intrinsic probes, and native probe together if Node exposes
complete object-kind inspection or Browlet moves to a direct V8 embedder. The
bounded operation and its known limit are
exercised in
[`built-in-primitives.test.ts`](../../test/js-engine/built-in-primitives.test.ts)
and
[`serialize.test.ts`](../../test/browlet/scripting/structured-data/serialize.test.ts).

`node-v8-error-stack` approximates access to the inaccessible Error `[[Stack]]`
state. It reads V8's realm-specific own stack accessor and restores the
observable stack as an own data property because Node exposes no internal-slot
write. The JavaScript operation returns the raw value; HTML remains responsible
for choosing its implementation-defined serialized string. Replace the read
and write operations together if Node exposes Error stack state directly.

ArrayBuffer brands come from Node's `util.types`; captured intrinsic accessors
read the remaining buffer and view facts. Realm methods provide allocation,
copying, and transfer through runtime buffers. Web IDL retains conversion and projection;
HTML retains structured-data records and reconstruction rules.

The custom engine and addon expose `ArrayBufferView::IsLengthTracking()` for
typed arrays and DataView over ordinary or shared backing storage. It reads
V8's length-mode bit without mutation. `node-v8-array-buffer-slots` remains the
stock fallback: a synchronous reversible resize probe for ordinary resizable
ArrayBuffers, restoring their original length and bytes before returning.
Growable SharedArrayBuffer views cannot be probed this way because growth is
irreversible, and retain the existing expected failure only on backends without
the native query. Remove the probe when every supported backend exposes the
query. The boundary is covered by
[`buffers.test.ts`](../../test/js-engine/buffers.test.ts)
and the HTML structured-data tests.

The non-destructive `[[ArrayBufferDetachKey]]` query remains deferred engine
work. V8's `IsDetachable()` reports a different flag; the actual transfer is
authoritative until the engine can expose the missing key predicate.

The runtime contracts, explicit-queue behavior, and known ambient fallback
limits are exercised in
[`realm.test.ts`](../../test/js-engine/realm.test.ts) and
[`runtime.test.ts`](../../test/js-engine/runtime.test.ts).
