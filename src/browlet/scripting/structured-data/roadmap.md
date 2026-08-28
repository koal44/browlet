# Structured data roadmap

HTML §2.7 owns structured serialization, deserialization, transfer, and the
`structuredClone()` API. These operations serve realms, history, messaging,
workers, Streams, and Fetch, so their graph machinery belongs with scripting
rather than any one consumer.

The implementation should proceed in specification order, but in bounded
slices with an observable proof after each slice. Do not translate §2.7 into
one large recursive function before its Web IDL, realm, and host-capability
boundaries have been proved.

## Starting point

Browlet already has the following prerequisites:

- platform-object records containing the exact primary interface and realm;
- assembled-interface lookup, exposure checks, and per-realm bindings;
- a realm-bound interface adapter for resolving exact primary interfaces,
  consulting specification capabilities, and internally creating platform
  objects without invoking author-facing constructor steps;
- declarative preservation of `[Serializable]` and `[Transferable]`;
- typed serializable and transferable capability contracts;
- HTML-owned platform-object `[[Detached]]` state;
- concrete Realm, agent, and agent-cluster ownership;
- realm-aware BufferSource construction, copying, detachment, and transfer;
- realm-correct `DOMException` and `QuotaExceededError` implementations; and
- an expected-failure `DOMException` `structuredClone()` test that can become
  the first public platform-object proof.

The missing foundations are the closed structured-data record families, graph
memory, reliable built-in brand/slot operations, and the recursive HTML
algorithms themselves.

## Architecture boundaries

- Web IDL owns platform-object identity, target-realm creation, exposure, and
  a generic language-binding extension seam. It must not import HTML's graph
  records or structured-clone algorithms.
- HTML owns serialized records, memory maps, storage mode, sub-serialization,
  sub-deserialization, transfer ordering, and the public API.
- The specification defining an interface owns that interface's serialization,
  deserialization, transfer, and transfer-receiving steps. It implements those
  capabilities through the generic seam; HTML invokes them.
- Dispatch is by the platform object's exact primary interface. Inherited
  interfaces do not each run independent hooks; a derived interface's steps
  explicitly reuse inherited steps when its specification says to do so.
- `[Serializable]` and `[Transferable]` remain normative declaration metadata.
  Executable hooks are binding behavior. A concise registration helper is
  appropriate, but eliminating `bind()` is not a goal and callbacks must not
  be hidden inside the raw extended-attribute syntax tree.
- Internal Web IDL object creation is distinct from invoking an author-facing
  IDL constructor. Deserialization must never depend on an interface being
  publicly constructible.
- Native `structuredClone()` can supply a narrowly proved host primitive, such
  as ArrayBuffer detachment, but it cannot replace Browlet's graph, interface
  dispatch, exposure checks, or target-realm reconstruction.

## Planned source

The exact filenames may change when a slice reveals a clearer ownership
boundary. Do not create an otherwise empty module merely to satisfy this table.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `records.ts` | Serialized record families and graph-memory types | HTML §§2.7.3–2.7.8 |
| `serializable.ts` | Per-interface serialization/deserialization capabilities and lookup | HTML §§2.7.1, 2.7.3, 2.7.6 |
| `transferable.ts` | Per-interface transfer/receiving capabilities and detached state | HTML §§2.7.2, 2.7.7–2.7.8 |
| `platform-objects/` | HTML capability adapters for interfaces owned by lower-level specifications | HTML §§2.7.1–2.7.2 and the defining specification |
| `serialize.ts` | Structured serialization and storage mode | HTML §§2.7.3–2.7.5 |
| `deserialize.ts` | Target-realm reconstruction and graph population | HTML §2.7.6 |
| `transfer.ts` | Serialization and deserialization with transfer lists | HTML §§2.7.7–2.7.8 |
| `structured-clone.ts` | `structuredClone()` semantic operation | HTML §2.7.10 |
| `web-idl.ts` | `StructuredSerializeOptions` and `WindowOrWorkerGlobalScope` contribution | HTML §2.7.10 |

## Implementation slices

### 1. Establish serializable and transferable platform contracts

Status: complete. The generic Web IDL capability seam is keyed by exact
interface-definition identity; registered realms expose target-realm creation,
exposure checks, and primary-interface resolution. HTML owns the hook contracts
and detached state. DOMException and QuotaExceededError provide the first
standalone Serializable capability implementations and cross-realm proof.

Controlling sections: HTML §§2.7.1–2.7.2, "Serializable objects" and
"Transferable objects"; Web IDL §3.8, "Platform objects implementing
interfaces".

First establish the boundary that every later platform-object branch needs:

1. Document and test `createPlatformObject()` as Browlet's implementation of
   Web IDL's internal new-instance operation, separate from public constructor
   steps.
2. Add the smallest generic per-interface language-binding capability seam
   needed for a defining specification to register structured-data hooks.
   Web IDL preserves and indexes the implementation but does not understand its
   HTML-owned record or context types.
3. Let HTML resolve a platform object's exact primary interface, verify that it
   is exposed in a target realm, and create a target-realm instance through the
   registered realm binding.
4. Register the `DOMException` and `QuotaExceededError` Serializable
   capability implementations without implementing the recursive graph yet.

Proof: synthetic interface tests show exact-primary-interface lookup, inherited
interface behavior, target-realm identity, and that internal creation does not
run public constructor steps. Direct hook tests show that DOMException state can
be written to and restored from an HTML-owned record.

Stop and confer with Eric if `createPlatformObject()` cannot create valid blank
state for deserialization without observable constructor behavior. Do not add a
second allocator, a `create/setup/new` trio, or constructor-owned allocation as
an unreviewed workaround. A genuinely exceptional interface may retain a real
interface-level `create` binding.

### 2. Implement structured serialization

Status: complete, subject to the host limitations below. The implementation
uses V8's cross-realm brand predicates for exposed built-in slot tests, keeps
the HTML graph and storage mode independent of Node's native clone serializer,
and inserts shallow records into memory before every recursive traversal.

Controlling sections: HTML §2.7.3, `StructuredSerializeInternal`; HTML
§2.7.4, `StructuredSerialize`; HTML §2.7.5,
`StructuredSerializeForStorage`.

Implement §2.7.3 in normative order, then add its two small public wrappers.
This phase includes:

- caller-provided or fresh memory;
- duplicate-object lookup;
- primitives and rejection of Symbols;
- boxed Boolean, Number, BigInt, and String values;
- Date, RegExp, and Error records;
- ArrayBuffer, SharedArrayBuffer, DataView, and typed-array records;
- Map, Set, Array, and ordinary Object recursive data;
- insertion into memory before recursive traversal;
- sub-serialization bound to the same storage mode and memory;
- serializable platform-object dispatch, detached-state rejection, and the
  interface's serialization steps;
- rejection of callable and unsupported objects with a realm-correct
  `DataCloneError`; and
- the non-storage and storage wrappers with fresh graph memory.

Brand checks must work across Browlet realms and must not rely on `instanceof`
against the active Node realm. Add narrow realm/host intrinsic operations when
JavaScript does not expose the specification's internal-slot test directly.

Reuse the existing Web IDL BufferSource operations where they model the
required ECMAScript slots. Keep inaccessible `[[ArrayBufferDetachKey]]` and
detached-view limitations explicit rather than weakening the algorithm.

Proof: direct internal tests cover every record family, source-realm
independence, self- and mutual cycles, repeated identity, sparse arrays,
Map/Set ordering, Error accompanying data, getter failures, detached buffers,
storage-mode differences, DOMException records, and exact failure types.

JavaScript does not expose a general “has unsupported internal slots” query.
The Node host boundary rejects the available V8-branded families (including
Promise, WeakMap/WeakSet, generators, Map and Set iterators, WeakRef,
FinalizationRegistry, proxies, and crypto-key objects), but an unrecognized
Node-native slot-bearing object can still resemble an ordinary object. A
bounded native-clone probe rejects propertyless Array and String iterators
without advancing them and distinguishes real slots from prototype impostors.
Decorated iterators and the broader unknown-internal-slot category remain
expected failures because probing their full property graph could invoke
author code twice or attribute a nested clone failure to the wrong object.

V8 records a resizable-buffer view's internal length-tracking bit, but neither
its public API nor Node exposes that bit. For ordinary resizable ArrayBuffers,
Browlet recovers it with a synchronous, reversible intrinsic resize probe. The
probe grows or truncates at most one element, restores both size and bytes, and
runs no author code. Growable SharedArrayBuffer cannot use that technique
because growth is irreversible; its ambiguous fixed-at-end and auto-length
views still serialize as fixed-length. Do not replace the bounded probe with a
second native structured clone of an arbitrarily large backing buffer.

### 3. Implement target-realm deserialization

Status: complete.
Every closed record family reconstructs through captured target-realm
intrinsics, graph memory is populated before deep traversal, and exact
platform-interface capabilities receive a shared sub-deserialization context.

Controlling section: HTML §2.7.6, `StructuredDeserialize`; Web IDL §3.8,
"Platform objects implementing interfaces".

Mirror the serialized record families in §2.7.6 while preserving its critical
ordering:

1. resolve a prior memory entry;
2. create the shallow value in `targetRealm`;
3. insert it into memory; and only then
4. recursively populate containers or run interface deserialization steps.

Use target-realm intrinsic prototypes for boxed primitives, Date, RegExp,
buffers/views, Map, Set, Array, Object, and Error. For platform records, verify
exposure, create the exact primary interface through the target realm's Web IDL
binding, and run only that interface's registered deserialization steps.

Proof: every serialized family reconstructs in a second Browlet realm with the
correct intrinsic or platform prototype; cycles and repeated identity survive;
DOMException and QuotaExceededError restore only their specified state, not
author-added properties.

Node's native clone primitive creates the distinct SharedArrayBuffer wrapper
needed to retain its backing store. Before exposing that wrapper, Browlet gives
it the target realm's captured intrinsic prototype. Focused tests cover shared
memory, target-realm brand and prototype behavior, and target-realm `slice()`
construction.

### 4. Implement transfer and cross-specification operations

Status: complete for the generic algorithms and ArrayBuffer transfer. The
exact-interface platform hook is covered synthetically; retain the missing
real platform-transfer proof until MessagePort exists.

Controlling sections: HTML §2.7.7, `StructuredSerializeWithTransfer`; HTML
§2.7.8, `StructuredDeserializeWithTransfer`; HTML §2.7.9, "Performing
serialization and transferring from other specifications".

Implement §2.7.7 and §2.7.8 after ordinary serialization is stable:

- validate the complete transfer list and reject duplicates before mutation;
- serialize the input before any irreversible transfer;
- transfer fixed and resizable ArrayBuffers and detach the source;
- register platform transfer and receiving hooks by exact primary interface;
- maintain platform-object `[[Detached]]` state at its semantic owner;
- reconstruct transferred values in the target realm; and
- deserialize the main record using the shared transfer memory.

Proof: transfer-list shape and duplicate failures, and graph-serialization
failures, leave every source untouched. Successful ArrayBuffer transfer
detaches exactly once and preserves identity between the transferred list and
the cloned graph. The detached-state checks in the irreversible second pass
remain sequential as specified, so a later already-detached item can fail
after an earlier item has transferred; tests preserve that distinction rather
than promising stronger atomicity than HTML provides.

Decision: retain that literal ordering until the standard defines a generic,
non-mutating transfer-validation phase. Chromium and WebKit preflight lists of
ArrayBuffers, while Firefox follows the sequential order; mixed transfer types
can still partially transfer in all three engines. WHATWG HTML
[#3557](https://github.com/whatwg/html/pull/3557), WPT
[#9672](https://github.com/web-platform-tests/wpt/pull/9672), and WebKit
[#62527](https://github.com/WebKit/WebKit/pull/62527) establish
serialization-before-detachedness validation, but do not test or guarantee
list-wide atomicity. Add that WPT coverage when every list item has a
side-effect-free transfer-validity operation.

JavaScript exposes no non-destructive `[[ArrayBufferDetachKey]]` predicate.
Keep that limitation explicit. MessagePort is the first platform-transfer
consumer, but its absence must not block completion of the generic algorithm
or ArrayBuffer transfer. Do not claim platform-transfer coverage until a real
registered consumer exists.

Section 2.7.9 adds no new graph algorithm. It fixes the reusable operation
boundary: other specifications call these semantic operations rather than the
author-facing `structuredClone()` method or a caller-specific clone path.
An asynchronous caller serializing arbitrary objects must first prepare to run
script and a callback because serialization can invoke author accessors. That
lifecycle requirement remains deferred with HTML sections 8.1.4 and 8.1.5;
their current Realm hooks are deliberately no-ops. Cross-specification callers
must preserve this obligation rather than treating the semantic operation as
context-free.

### 5. Expose `structuredClone()` and connect the first consumers

Status: complete for the available platform surface. The projected
`WindowOrWorkerGlobalScope` API uses the receiver's realm, ArrayBuffer transfer
and Serializable platform objects share the same semantic implementation, and
Streams cross-specification tee clones its second branch through the realm
global's structured-data seam. Fetch body cloning is unblocked; MessagePort,
workers, history, and messaging remain with their owning future slices.

Controlling sections: HTML §2.7.10, "Structured cloning API"; WHATWG Streams
§4.9.1, readable-stream operations including `ReadableStreamTee`; Fetch
§2.2.4, "Bodies".

Implement §2.7.10 only after the internal algorithms are independently tested:

- declare `StructuredSerializeOptions`;
- co-locate the `WindowOrWorkerGlobalScope` partial contribution with its
  primary mixin according to project policy;
- keep `structuredClone()` as an author-facing boundary adapter that obtains
  the relevant realm and calls the semantic transfer algorithms; and
- expose it through Window now and Worker globals when those exist.

Proof: tests cover DOMException, cycles, repeated identity, target-realm
built-ins, ArrayBuffer transfer, duplicate transfers, failure atomicity, and
`this`/realm behavior through the projected Window API.

The first cross-specification consumer is connected:

- Streams' cross-specification tee with `cloneForBranch2 = true` uses the same
  semantic implementation and realizes clone failures in the stream realm; and
- Fetch body cloning and abort-reason serialization are unblocked.

Remaining consumers:

- add focused WPT coverage once Browlet's WPT harness can install and execute
  the required globals; and
- later connect history, messaging, workers, and MessagePort without creating
  caller-specific cloning paths.

## Commit boundaries

Each numbered slice is intended to be independently reviewable and normally
commit-sized. A slice may be divided when a host limitation or an unexpectedly
large record family appears, but the roadmap should retain these five semantic
phases rather than turning every record family into a separate project.

## Removal condition

Burn this file after structured serialization and transfer have cross-realm,
cycle, platform-object, failure-atomicity, and public-consumer coverage. Until
MessagePort exists, retain the explicit missing platform-transfer proof even if
ordinary `structuredClone()` and ArrayBuffer transfer are complete.
