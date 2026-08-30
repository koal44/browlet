# Streams cycles

The readable-stream import cycle is retained deliberately. It is evaluated
only after module initialization, is acknowledged explicitly by the
`streams-readable` marker, and is not a reason to steer future work away from
the Streams Living Standard.

This decision separates two different meanings of "cycle":

- The Streams object model is necessarily cyclic.
- The Streams specification does not require a cyclic source-module graph.

The current source cycle came from preserving the WHATWG reference
implementation's division between interface implementations and shared
abstract operations. No smaller, clearer removal has been found.

## Normative object graph

The [Streams Living Standard](https://streams.spec.whatwg.org/) creates
bidirectional relationships in §§4.2–4.8:

| Owner | Forward reference | Back reference |
| --- | --- | --- |
| `ReadableStream` | `[[controller]]` | each controller has `[[stream]]` |
| `ReadableStream` | `[[reader]]` | each generic reader has `[[stream]]` |
| `ReadableByteStreamController` | `[[byobRequest]]` | each BYOB request has `[[controller]]` |

These relationships exist simultaneously, so a faithful implementation must
support a cyclic runtime graph. JavaScript garbage collection, Blink's Oilpan,
Gecko's cycle collector, and WebKit's garbage-collected or weak back-references
all provide that support.

The standard is a collection of algorithms, not a module-layout prescription.
Its algorithms also refer in both directions--interface methods invoke abstract
operations, while those operations inspect and construct the interface
objects--but that does not mandate cyclic imports.

## Reference implementation

The reference implementation at
`b9ba9f49d95b4280be0dc2372377a006c3a91c18` has a loader-visible CommonJS
cycle:

```text
ReadableStream-impl.js
    -> abstract-ops/readable-streams.js
    -> generated/ReadableStream.js
    -> ReadableStream-impl.js
```

The same pattern covers the readable controllers, readers, and BYOB request.
The generated wrappers are produced by `compile-idl.js`; the abstract-operation
module imports those wrappers to allocate and recognize the corresponding
objects, while each implementation delegates behavior back to the abstract
operations.

The reference implementation's `ReadableStream.new(globalThis)` and related
`.new()` calls are internal allocation operations. `CreateReadableStream`,
`CreateReadableByteStream`, `ReadableStreamFromIterable`, and both tee
algorithms use that route rather than invoking the author-facing constructor.

## Browlet

Browlet retained the same basic division:

```text
interface implementations --invoke-------------> specification operations
interface implementations <--construct/inspect-- specification operations
```

The ordinary operations module constructs and inspects `ReadableStreamImpl`,
its default controller, and its readers. Those implementations delegate their
methods back to the operations module. The byte operations module adds the byte
controller, BYOB reader, and BYOB request to the same strongly connected
component.

The cycle is therefore inherited in architecture, not merely copied as a
warning. Browlet contributes its concrete TypeScript module split and the
static access needed to reach class-private state, but the audit found no
Browlet-only import edge whose removal would break the cycle. Type-only imports
do not participate, and the Realm Context, HTML structured-cloning capability,
and DOM abort capability do not add edges to this cycle.

The recent `ReadableStream.from()` and tee failures were a separate boundary
mistake. Browlet had translated an internal reference-implementation `.new()`
path into construction through an author-style underlying-source record. That
sent already-converted callbacks and promises through Web IDL conversion a
second time. The corrected `createReadableStream()` and
`createReadableByteStream()` operations allocate an implementation in the
proper Realm Context and run the specification setup algorithms directly.
This removed the wrong Binding round trip, but it did not create or remove an
import edge.

The build suppresses a circular-dependency warning only when every module in
the reported cycle has the same first-line group marker. New or partially
acknowledged cycles remain visible. Participating modules must not execute a
cross-cycle binding at module initialization time.

## Browser comparison

The browser implementations confirm the semantic model and the internal
construction boundary, but none provides a directly reusable TypeScript module
layout.

| Engine snapshot | Architecture and cycle handling | Internal creation |
| --- | --- | --- |
| Blink `1136757f47c7e2b6cc593f871a5d79fc0e9834b4` | Native C++ interface classes with static specification operations and dedicated `TeeEngine`, `ByteStreamTeeEngine`, and pipe engines. `ReadableStream` traces its controller and reader; each controller and reader traces the stream. Oilpan owns the cyclic object graph. Cross-file type dependencies are compiled and linked, not evaluated as JavaScript modules. | The public `ReadableStream::Create` overload accepts script values and runs constructor conversion. A separate overload accepts start, pull, cancel, and strategy algorithms; tee uses that overload. Byte tee uses `CreateByteStream`. |
| Gecko `d92a7ec0e622782fe62529bb3a4809780da01d6c` | Native C++ interface classes plus free operations in `streams_abstract`, `*Abstract.h` surfaces, `TeeState`, and pipe helpers. `ReadableStream`, controllers, readers, and BYOB requests hold reciprocal `RefPtr`s and explicitly participate in cycle collection. Headers and the linker absorb mutual source references without a module-initialization cycle. | `ReadableStream::Constructor` performs author conversion. `CreateAbstract` and `CreateByteAbstract` allocate and set up internal streams; `ReadableStreamFromIterable` and tee call those internal factories. |
| WebKit `713192fabebfdd2955aa596c262c33bfbf3d50be` | A hybrid. Ordinary streams use private JSC builtin JavaScript reached through `InternalReadableStream`; byte streams and their tee pipeline are native C++. Builtins resolve `@`-private names from one engine namespace rather than ES-module imports. Native stream/controller and stream/reader back-references are weak on one side, while JSC garbage collection owns the private-JavaScript graph. | Ordinary tee calls the private `createInternalReadableStreamFromUnderlyingSource` builtin with private pull/cancel properties, bypassing author property conversion. That helper still carries a FIXME to model `CreateReadableStream` directly. Native byte tee calls `ReadableStream::createReadableByteStream`, which allocates and sets up the branch without invoking the public constructor. |

Browlet is closest to the reference implementation in physical file layout.
Gecko is the closest conceptual comparison for implementation classes plus
separate abstract operations, although C++ compilation removes the JavaScript
loader constraint. WebKit is the closest implementation-language comparison,
but its private builtin namespace and hybrid native byte streams make its
dependency structure materially different. Blink is more class- and
engine-oriented. All three nevertheless agree with Browlet's corrected rule:
an internal specification algorithm creates and sets up a stream through an
internal factory, never by replaying the public Web IDL constructor boundary.

## Decision and removal threshold

Keep the acknowledged cycle while it remains evaluated-late and behaviorally
covered. Do not introduce a service bag, constructor registry, or factory
protocol solely to make the import graph acyclic.

There are three credible ways to remove it:

1. co-locate the readable implementation family and its operations;
2. move readable state onto the implementation objects while keeping reverse
   operation imports type-only, as the writable implementation does; or
3. invert construction, state, and brand access behind a narrow protocol.

Each currently costs either a very large module, a broader state-ownership
rewrite, or more abstraction than the cycle itself. Revisit the decision only
when substantive readable-stream work makes one of those ownership changes
independently valuable, or when a build/runtime failure disproves the
no-top-level-execution invariant.

The Sections 6–8 audit removed the separate `streams-transform` cycle.
`TransformStreamImpl` and its controller now own their specification state
directly, controller allocation stays with the implementation boundary, and
the abstract-operations module imports both implementation types only. This
matches Blink and Gecko's state-owning interface classes and WebKit's private
stream slots without importing their physical layouts. The build therefore
needs no Transform cycle marker; only the Readable/BYOB group remains
acknowledged.

## Evidence locations

The comparisons above use these files from the pinned local snapshots:

- WHATWG: `index.bs`,
  `reference-implementation/lib/abstract-ops/readable-streams.js`, the readable
  `*-impl.js` files, and `reference-implementation/compile-idl.js`;
- Blink: `readable_stream.{h,cc}`, `tee_engine.cc`,
  `byte_stream_tee_engine.cc`, and the readable controller/reader headers;
- Gecko: `ReadableStream.{h,cpp}`, `ReadableStreamTee.cpp`, `TeeState.*`,
  `ReadableStreamControllerBase.h`, `ReadableStreamGenericReader.h`, and the
  BYOB controller/request headers; and
- WebKit: `ReadableStreamInternals.js`,
  `bindings/js/InternalReadableStream.cpp`, `ReadableStream.{h,cpp}`, and
  `StreamTeeUtilities.cpp`; and
- the corresponding Transform comparison: Blink's `transform_stream.*` and
  controller, Gecko's `TransformStream*` classes and abstract-operation
  headers, and WebKit's `TransformStreamInternals.js` and native wrapper.
