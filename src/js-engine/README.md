# JS Engine boundary

This project owns Browlet's JavaScript-engine substrate. It sits below Web IDL
and has no knowledge of HTML Agents, environment settings objects, tasks,
Documents, Windows, or platform-object projection.

The [JS Engine roadmap](./roadmap.md) inventories HTML's complete
ECMAScript dependency list and separates ordinary engine behavior from the
small set of inaccessible runtime facts and genuine host hooks.
Its work proceeds by coherent consumers. The first runtime slice established
explicit versus ambient microtask-queue backends. The compatibility addon also
supplies the `ContextHandle` and global-proxy lifecycle; the current slice
adopts that substrate in Browlet before the Promise-job host-hook audit
continues. It does not implement imported ECMAScript terms or host hooks as
undifferentiated families.

The [compatibility addon](../../node-compat/README.md) now supplies explicit
queues and reusable native context handles on stock Node 24. NodeRuntime loads
it only when the embedder sets BROWLET_NODE_ADDON to its absolute module path;
NodeRealm delegates evaluation to that selected backend. The addon does not
make node:vm recognize its handles and does not yet supply post-creation
prototype immutability. References to stock fallbacks below mean plain Node
without the addon. References to source-patched Node describe the original
Node branch, whose additional immutable-prototype operation is still missing
from the addon.

## Admission rule

Classify code by ownership before extracting it:

| Home | Admission test | Examples |
| --- | --- | --- |
| `js-engine/` | An ECMAScript abstract operation, realm or isolate fact, captured intrinsic, or bounded substitute for an inaccessible engine operation whose contract does not import another platform subsystem | `IsObject`, realm-owned function creation, ArrayBuffer slot inspection |
| `shared/` | A specification-, realm-, and engine-neutral convenience with genuine cross-domain reuse | `assertNever`, tuple mapping, text cursors |
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
In particular, `NodeRuntime.getAssociatedRealm()` reports the realm evidence
available to this embedder; it is not a faithful `GetFunctionRealm`. The Web
IDL iterator state machines likewise remain Web IDL behavior rather than being
presented as `CreateIteratorFromClosure` until the JavaScript layer can supply
that operation independently of Web IDL records and conversion policy.

The stable contract uses JavaScript vocabulary. The concrete backend remains
explicitly Node-shaped:

- `NodeRuntime` is the isolate-scoped owner of engine feature selection and the
  object-to-realm associations Node cannot expose directly;
- `NodeRealm` owns one Node VM context, its captured intrinsics, evaluation,
  function creation, and global-object bridge, and receives the selected
  microtask queue when its context is created; and
- Web IDL or HTML hosts subclass `NodeRealm` to add their own policy without
  introducing a forwarding realm object.

There is one exported `nodeRuntime` instance per module instance. Node workers
load separate module instances and therefore receive separate runtime owners.
Do not construct per-Agent, per-AgentCluster, or per-BindingWorld realm maps:
objects can cross those boundaries synchronously within one isolate.

The JavaScript-facing queue contract is deliberately independent of Node's VM
handle:

```ts
interface JavaScriptMicrotaskQueue {
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

## Node/V8 accommodations

`node-v8-object-realms` records realm associations for objects the host sees
and follows prototype chains for evaluated objects. It falls back to the realm
of an active `NodeRealm.evaluate()` call when a Proxy prevents inspection.
Replace the associations and fallback together if Node exposes arbitrary
objects' `[[Realm]]` or Browlet moves to a direct V8 embedder.

`node-vm-global-proxy` bridges a supplied global object and global-this value
through Node's context global. Stock Node cannot install an existing
WindowProxy as the VM context's true global-this, so free names reach the
modeled global graph while top-level `this` remains the VM global. A
compatibility backend instead exposes an opaque `ContextHandle` for the
replaceable execution context and a separate `globalProxy` identity. The
handle can detach that proxy; supplying the detached handle as
`reuseGlobalProxyFrom` transfers the proxy once to a fresh Realm with fresh
intrinsics and global state. The handle itself proves provenance, so the
runtime needs no global proxy registry. `NodeRealm` uses this handle whenever
compatible context creation is available. On source-patched Node, the runtime's
`makePrototypeImmutable()` operation seals each fresh backing global after
Browlet installs its global graph; the addon cannot yet perform that operation.
This follows Gecko's create, project, then
seal ordering; Blink instead creates its global from a generated V8 template
which already contains the binding graph.

The experimental contexts deliberately use Node's ordinary VM principal token
so host code can configure the global proxy. That is an embedder-access choice,
not browser origin isolation: `origin` remains inspector metadata, and the API
does not supply WindowProxy cross-origin access callbacks. V8 also cancels jobs
still queued for an old Realm when its global is detached. Browlet must reach
the required HTML checkpoint before reuse, give Web IDL a distinct native
global-proxy exposure target, and implement the remaining WindowProxy exotic
and origin-policy contracts before navigation can adopt this substrate. The
API cannot accept Browlet's existing arbitrary JavaScript `Proxy` as a
shortcut.

`node-v8-checkpoint` is now the stock/ambient fallback. Stock Node has no
supported synchronous V8 microtask-checkpoint operation, so that backend uses
private `process._tickCallback()`. The addon or source-patched Node instead gives an
explicit queue both `enqueueMicrotask()` and `runMicrotasks()`; the runtime maps
those to the queue contract above. Replace or remove only
the ambient backend when the supported stock baseline gains the same complete
surface—HTML's checkpoint guard and post-checkpoint work remain specification
behavior in either mode.

`node-v8-promise-reactions` supplies `installPromiseReactions()`, Browlet's
approximation of `PerformPromiseThen` without a result capability. JavaScript
exposes only `Promise.prototype.then`, so the operation invokes the captured
realm intrinsic. This installs the required reactions, but also creates an
unreachable derived promise and can consult an author-overridden `constructor`
or `@@species`. Web IDL retains its typed promise records, conversions,
reaction steps, and result-capability policy. Replace only this JavaScript
operation if Node or a direct V8 embedder exposes `PerformPromiseThen`.

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
[`built-in-primitives.test.ts`](../../test/js-engine/unit/built-in-primitives.test.ts)
and
[`serialize.test.ts`](../../test/browlet/unit/scripting/structured-data/serialize.test.ts).

`node-v8-error-stack` approximates access to the inaccessible Error `[[Stack]]`
state. It reads V8's realm-specific own stack accessor and restores the
observable stack as an own data property because Node exposes no internal-slot
write. The JavaScript operation returns the raw value; HTML remains responsible
for choosing its implementation-defined serialized string. Replace the read
and write operations together if Node exposes Error stack state directly.

`node-v8-array-buffer-slots` exposes cross-realm ArrayBuffer and view facts
through captured intrinsic accessors. Web IDL retains conversion, allocation,
copying, detachment, and transfer policy; HTML retains the structured-data
record shape and reconstruction rules. V8's fixed-versus-length-tracking view
bit is not exposed by Node, so the runtime uses a synchronous reversible resize
probe for resizable ArrayBuffers and restores the original length and bytes
before returning. Growable SharedArrayBuffer views cannot be probed this way
because growth is irreversible. Replace only these engine-fact operations if
Node or a direct V8 embedder exposes the missing slots. The boundary is covered
by
[`array-buffer-primitives.test.ts`](../../test/js-engine/unit/array-buffer-primitives.test.ts)
and the HTML structured-data tests.

The runtime contracts, explicit-queue behavior, and known ambient fallback
limits are exercised in
[`node-realm.test.ts`](../../test/js-engine/unit/node-realm.test.ts) and
[`node-runtime.test.ts`](../../test/js-engine/unit/node-runtime.test.ts).
