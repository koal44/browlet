# Structured data roadmap

HTML [§2.7](https://html.spec.whatwg.org/multipage/structured-data.html) supplies
structured serialization, storage serialization, target-realm deserialization,
transfer, and structuredClone(). The generic algorithms, ArrayBuffer transfer,
and the current Window API are implemented. MessagePort-backed platform transfer
and the remaining history/worker/messaging consumers are still future work.

## Current ownership

| Location | Responsibility |
| --- | --- |
| `records.ts` | Closed record families and graph-memory types |
| [Web IDL contracts](../../../web-idl/core/structured-data.ts) | Interface-owned serialization and transfer steps, with narrow nested-operation callbacks |
| `transferable.ts` | HTML-owned detached state |
| `serialize.ts`, `deserialize.ts` | Graph traversal, storage mode, target-realm reconstruction, and shared memory |
| `transfer.ts` | Transfer-list validation, serialization/transfer order, and receiving steps |
| `structured-clone.ts` | The internal structured-cloning operation |
| `web-idl.ts` | Shared StructuredSerializeOptions declaration |
| `../global-scope.ts` | The public WindowOrWorkerGlobalScope contribution |
| [File](../../../file/index.ts), [DOMException](../../../web-idl/core/dom-exception.ts) | Concrete steps beside the contributing implementations and declarations |

[Web IDL](../../../web-idl/README.md) owns platform identity, exposure checks,
internal target-realm creation, and typed declaration hooks. HTML owns graph
records, memories, storage mode, transfer ordering, and sub-operations. Each
defining specification supplies its interface's steps. Dispatch uses the exact
primary interface; inherited interfaces do not each run an independent hook.

Serializable/Transferable attributes remain declaration metadata. The same
declaration's `serialSteps` and `transferSteps` fields supply executable steps;
there is no separate registration table. Deserialization creates internal
instances without invoking public constructors or requiring public constructibility.
Native structuredClone cannot replace this graph/binding/exposure machinery.

## Invariants to preserve

Serialization supports the specified primitive, boxed, built-in collection,
Error, buffer/view, ordinary object, and serializable-platform families.
Insert each shallow record into memory before descending; deserialization likewise
allocates and remembers the target value before recursively populating it.
Cycles and repeated identity must survive across graph and transfer memories.

Use captured target-realm intrinsics and exact interface steps rather than
active-host instanceof checks. DOMException, QuotaExceededError, Blob, File, and
FileList provide concrete serialization consumers. An interface restores its
specified data, not arbitrary author-added properties.

SharedArrayBuffer reconstruction uses a distinct wrapper over the retained
backing store, with the destination's captured prototype. Storage mode and
agent-cluster restrictions remain HTML decisions, not native-clone defaults.

Transfer-list shape/duplicate checks and graph serialization precede irreversible
transfers. ArrayBuffers detach once; platform detached state belongs to the
source implementation, shared by its implementation/platform identities. Received
implementations start undetached. Transfer receiving and the main graph share memory.

Detachedness validation in the transfer pass remains sequential. An earlier
buffer can transfer before a later already-detached item fails; the algorithm
does not promise list-wide atomicity. Chromium/WebKit preflight ArrayBuffer lists,
while Gecko follows sequential ordering; mixed transfer types can partially
transfer in all three. Retain the written order until a generic, non-mutating
validity phase exists. [HTML #3557](https://github.com/whatwg/html/pull/3557),
[WPT #9672](https://github.com/web-platform-tests/wpt/pull/9672), and
[WebKit #62527](https://github.com/WebKit/WebKit/pull/62527) establish
serialization-before-detachedness checks without establishing full-list atomicity.

Cross-specification consumers call the internal operations. An asynchronous
caller serializing arbitrary objects must prepare to run script and a callback:
serialization can invoke author getters. The existing Realm lifecycle supplies
that boundary. Streams' ordinary tee-with-cloning and Fetch body/abort handling
already use the shared implementation.

## Engine limits

[JS Engine](../../../js-engine/ROADMAP.md) and
[the limitations catalog](../../../LIMITATIONS.md) own missing engine primitives.
Keep their approved failures visible rather than weakening graph behavior.

- Built-in slot predicates and the bounded propertyless-iterator probe recognize
  supported families. Unknown native slot-bearing objects and decorated iterators
  remain limited; probing an arbitrary property graph could invoke getters twice
  or misattribute a nested failure.
- Native length-mode inspection preserves growable/shared view behavior. Without
  it, the reversible ordinary ArrayBuffer probe cannot safely recover ambiguous
  growable SharedArrayBuffer views. Do not clone an arbitrarily large backing
  buffer merely to inspect its view.
- A non-destructive ArrayBuffer detach-key predicate remains unavailable.
  Other detached-view and Error-slot constraints stay with the engine owner.

The native queue/context and host-hook work does not remove these slot limitations.

## Remaining work

1. **Real platform transfer.** Connect MessagePort transfer/receiving with its
   actual entanglement and lifecycle. Platform transfer tests are synthetic;
   ArrayBuffer success does not prove a platform consumer. Streams transfer
   depends on the same MessagePort machinery.
2. **Consumer integration.** History state, cross-document/channel/broadcast
   messaging, workers, and worklets must use these operations and the specified
   storage/realm/agent-cluster rules rather than caller-specific clone paths.
3. **Exposure.** Install the existing global contribution with real Worker
   settings and lifetime. Window exposure alone is not worker coverage.
4. **Conformance.** Extend focused WPT coverage as those globals/consumers become
   runnable. Preserve sequential partial-transfer failures; add atomicity coverage
   only when the specified validity contract supports it.
5. **Engine replacements.** Replace bounded slot accommodations when their
   real primitive becomes available, preserving observable failure and realm behavior.

## Validation

The structured-data suites cover record families, cross-realm reconstruction,
self/mutual cycles, repeated identity, sparse arrays, collection order, getter
failures, storage differences, detached buffers, and exact failure types.
Projected structuredClone tests cover receiver realms, serializable platforms,
ArrayBuffer transfer, duplicate rejection, and partial-transfer ordering.

A new platform type needs actual serialization/receiving and public-consumer
proof in addition to declaring hooks. Keep the missing platform-transfer
proof explicit until a real registered type supplies it.
