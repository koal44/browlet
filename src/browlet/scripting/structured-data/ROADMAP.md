# Structured data roadmap

HTML [§2.7](https://html.spec.whatwg.org/multipage/structured-data.html) supplies
structured serialization, storage serialization, target-realm deserialization,
transfer, and structuredClone(). The generic algorithms, ArrayBuffer transfer,
and the current Window API are implemented, including the October 2026
same-agent-cluster contract. MessagePort-backed platform transfer and the remaining
history/worker/messaging consumers are still future work.

## October 2026 audit checkpoint

The October 15 audit found the new §2.7.3, restricting to the same agent
cluster. [HTML commit 790ce89](https://github.com/whatwg/html/commit/790ce89a0b95f3f6caed7fc2d1e3f352364e2791)
added this contract on October 14 UTC. Browlet's initial implementation
(`7e86efc1`, August 27) predates it; the local HTML reference checkout
(`24c5e48`, July 13) also lacks it. Check the published section when resuming.

The new contract is implemented:

- Serialized records and platform transfer holders carry the common restriction.
  `[SameAgentCluster]` applies to the exact primary interface and initializes
  `data.shouldRestrict` before interface steps run. Those steps can also request
  a restriction by setting the flag to true.
  SharedArrayBuffer applies the restriction directly, bound to the invoking agent's cluster.
- New object records are registered before recursive traversal and share one final
  storage check, after any conditional restriction from interface serialization steps.
  Deserialization checks the target cluster before reconstructing a value.
- Transfer results collect interface names and any cluster restriction across the
  complete memory. Receiving checks both before any buffer consumption or platform
  transfer-receiving steps, including restrictions in nested nontransferred values.

Focused regressions cover storage, same-cluster distinct agents, cross-cluster
rejection, exact-primary metadata, conditional restriction, cyclic/nested graphs,
interface-name ordering, and untouched buffer holders after rejection. They first
reproduced the missing restrictions and late receiving failures. Existing
agent-cluster identity supplies the dependency; MessagePort and workers were not
prerequisites for this update. Resume the remaining
§2.7 audit afterward; this checkpoint does not certify the whole current section.

## Current ownership

| Location | Responsibility |
| --- | --- |
| `records.ts` | Closed record families, graph memory, and the restriction operation |
| [Web IDL contracts](../../../web-idl/core/structured-data.ts) | Interface-owned serialization and transfer steps, with narrow nested-operation callbacks |
| `transferable.ts` | HTML-owned detached state |
| `serialize.ts`, `deserialize.ts` | Graph traversal, storage mode, target-realm reconstruction, and shared memory |
| `transfer.ts` | Structured cloning, transfer-list validation, serialization/transfer order, message-wide checks, and receiving steps |
| `web-idl.ts` | Shared StructuredSerializeOptions declaration |
| [`../../global-scope.ts`](../../global-scope.ts) | The public WindowOrWorkerGlobalScope contribution |
| [File](../../../file/index.ts), [DOMException](../../../web-idl/core/dom-exception.ts) | Concrete steps beside the contributing implementations and declarations |

[Web IDL](../../../web-idl/README.md) owns platform identity, exposure checks,
internal target-realm creation, and typed declaration hooks. HTML owns graph
records, memories, storage mode, transfer ordering, and sub-operations. Each
defining specification supplies its interface's steps. Dispatch uses the exact
primary interface; inherited interfaces do not each run an independent hook.

One internal `StructuredSerializer` owns the binding context, storage mode, and
memory for a traversal. It dispatches from each source value to typed methods;
recursive calls reuse that same instance. Those methods register records before
descending, and the outer `serialize()` performs the common storage check.
Serialized records remain plain data, independent of the traversal's lifetime.

`StructuredDeserializer` likewise owns the destination binding context and graph
memory for one traversal. Recursive branches allocate and remember their target
before populating it, including interface sub-deserialization. Transfer receiving
can supply the initial memory through the unchanged `structuredDeserialize()` entry point.

Serializable/Transferable/SameAgentCluster attributes remain declaration metadata. The same
declaration's `serialSteps` and `transferSteps` fields supply executable steps;
there is no separate registration table. Deserialization creates internal
instances without invoking public constructors or requiring public constructibility.
Native structuredClone cannot replace this graph/binding/exposure machinery.
Interface payloads use `StructuredData` objects with a typed `fields` record.
Providers access those fields directly. HTML initializes `shouldRestrict`
from the interface annotation and applies that restriction before interface steps.
It applies any newly requested restriction after those steps return. No callback or
source environment is retained. A restricted record may refer to cluster-local resources.

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
The complete message's cluster and interface-exposure checks run before receiving
any transfer. This does not make other receiving failures atomic.

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
serialization can invoke author getters. The existing BrowletRealm lifecycle supplies
that boundary. Streams' ordinary tee-with-cloning and Fetch body/abort handling
already use the shared implementation.

## Engine limits

[JS Engine](../../../js-engine/ROADMAP.md) and
[the limitations catalog](../../../LIMITATIONS.md) own missing engine primitives.
Keep their approved failures visible rather than weakening graph behavior.

- Built-in slot predicates recognize Array, String, and RegExp String iterators
  on the patched backend even when decorated. The bounded propertyless-object
  probe remains for unrecognized native types; decorated iterator helpers and
  other unsupported families remain limited. Probing an arbitrary property graph
  could invoke getters twice or misattribute a nested failure.
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
