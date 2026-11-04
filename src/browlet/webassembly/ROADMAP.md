# WebAssembly roadmap

This directory owns Browlet's WebAssembly browser integration. V8 owns binary
validation, compilation, execution, and the native JavaScript objects; Browlet
owns browser policy, scheduling, Fetch integration, and connections to HTML
modules and structured data.
Native API availability is a starting point for review, not a claim that every
draft requirement is satisfied by every supported runtime.

The JavaScript API document has been reviewed through its closing material.
Web API §§1–3 and Response-URL diagnostics are implemented; §§4–7 and closing
material are reviewed. Native diagnostic caching follows the accepted Chromium
behavior below. Generated declarations, compilation CSP, and HTML source-phase
URL imports are connected; the remaining dependencies and runtime limitations
are explicit below. Reaching the end is not a full-conformance claim.
The ESM opening through §9 is reviewed below. Its namespace-to-instance operation
is connected to the addon bridge, and native Module/source-object reflection is
verified. §10 parsing now supplies real HTML Wasm records and ordinary fetched
graphs, with callback-aware instantiation. §§10.1–10.5 are reviewed below,
retaining the known native binding limitations. §10.6 is reviewed and deferred
for the proposal/engine boundary below. The closing history and conformance
material are reviewed; they add no further feature algorithm. Stock module
support remains an explicit dependency.

## Implementation/platform migration

Module, Instance, Memory, Table, Global, and Tag now use ordinary Web IDL
implementations with private `#backing` engine objects. Binding owns their separate
platform objects, including known creation realms on stock Node. Public
constructor calls, asynchronous results, cloning, and engine-produced exports
all project those implementations. Raw Node objects are not accepted as browser
platform objects.

The WebAssembly namespace is also ordinary: one `WasmImpl` per realm, shared by
its primary and partial namespace declarations. Web IDL installs its members and
`[LegacyNamespace]` constructors. There is no supplied namespace object or
namespace registry. The small browser binding integration still installs the
ECMAScript error constructors and ESM's AbstractModuleSource parent links.

Opaque import objects and export objects require explicit boundary conversion:
Web IDL's `object` and `any` types do not recursively unwrap or project values.
The implementations cache native-object associations, unwrap typed imports, and
project engine-produced export values through the environment's generic `unwrap`
and `project` operations. CSS module exports use the same projection operation.
Composition supplies these Binding operations; implementations do not retain a
BindingContext. Wasm import-kind checks remain in Wasm's import processing.
Function exports and externref values
retain their engine/author identities. The ESM bridge keeps native dependency
exports internally and obtains its public JavaScript exports from the same
Instance implementation.

Exception has a separate `WasmExceptionImpl`, with the native exception itself as
its platform object. The local
[Exception binding](../integration/web-idl/bindings/wasm-exception.ts) installs the
generated Web IDL methods on V8's original prototype before global installation.
Native throws therefore use the public prototype immediately, without intercepting
throws or wrapping exported functions. Construction uses the existing overload
resolver and implementation steps, attaching the native backing to the record
instead of allocating an ordinary object. Tagged catches, exception identity,
subclassing, and V8's own traced stack are preserved. The former `interfaceOverride`,
`retainNative`, native-constructor Proxy, and generic adoption hooks remain removed.

Native receivers are associated only at the Exception member entry, before the
generated method performs its usual receiver checks, Tag conversion, and index
conversion. With the addon, exact creation-realm lookup allows a permanent record
in that realm. Without that information, stock Node uses a private temporary
platform receiver for the call; the native exception returned to author code is
unchanged and receives no guessed owner. This also supports borrowed methods on
frozen foreign exceptions whose prototype has been removed. The extra temporary
allocation and unavailable permanent ownership remain explicit stock-Node
limitations. No addon or engine patch is needed.

Structured serialization rejects native Exceptions directly, even before a member
call associates a record. An unassociated exception with enumerable author
properties must not fall through to ordinary-object cloning or invoke its getters
([HTML StructuredSerializeInternal](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal)).

Record lookup now follows main's `0ec6cc04` contract: `getPlatformRecord(value,
PlatformRecordSource)` only reads the requested identity, including declared
proxies when explicitly selected. Normal construction and projection establish
records. The caller migration reuses Vin's lookup changes while keeping the
separate Wasm implementations. The Exception-only generic hooks, types, setup
loops, and both BindingWorld maps have been removed. PlatformRecord keeps its
simpler three-argument constructor: ordinary allocation goes through
`attachPlatformObject()`. Its captured projection override is private again; the
existing Window projection and Location allocation hooks remain intact.

Table's TypeScript declarations again use optional value parameters. Its runtime
IDL overloads still distinguish omission from explicit undefined. The generator
combines only signatures whose accepted calls and return types are unchanged.

Ordinary Wasm implementations obtain the incumbent through the existing
injected-argument mechanism, retaining it across compilation and restoring it
during import processing. Member overrides retain their explicit
`overrideCapturesIncumbent` opt-in; overrides such as Streams' size getters do
not need the native entry and lookup cost.
The callback/result-conversion bridge remains necessary and unchanged.

**Private compilation boundary:** Hidden native Module and Instance prototypes
have an own fixed `then: undefined` so native Promise resolution cannot expose
backings through author getters. The distinct public objects retain normal
thenable lookup. Compilation resolution stays on the required task source.

The rollback baseline in `fb950fd0` retained nine ordinary Exception failures in
all six configurations. The local prototype binding fixes those cases without
changing their expectations. Additional regressions retain typed function identity
through a Table, native throws after replacing the namespace's constructor, and
Web IDL conversion and error realms on frozen engine-created receivers.

Validation on 3 November 2026: all 107 affected Web IDL, WebAssembly, and
structured-data files pass in all six configurations after the serialization fix
(1,289 successful checks with the addon; 1,287 without, including unchanged
expected failures). All 43 Exception assertions pass normally. Before the final
serialization guard and its two regressions, the full Node 26/addon unit run
passed 704 files with 19,073 successful checks, 18 existing skips, and five TODOs.
Type checking, type contracts, generated declarations, changed-file lint, import
boundaries, and whitespace checks pass. No tests were reclassified.

The following three validation entries record earlier migration states.

Preceding migration validation on 3 November 2026: the affected Wasm, Binding, realm, Window, and
reflection suites pass in all six runtime configurations. The full Node 26/addon
unit run reports 19,072 passes, no failures, 18 existing skips, and five TODOs.
Native addon suites pass on all three bases (387 on each official version;
386 plus one existing skip on custom). Type contracts, generated declarations,
lint, import boundaries, and whitespace checks pass. Existing expected failures
remain explicit. A full custom/addon run reproduced the already documented
[optimized Promise-job snapshot crash](../../js-engine/ROADMAP.md#optimized-promise-job-snapshots);
that run is not counted as passing, and no engine workaround was introduced.

Exception/generator follow-up validation on 3 November 2026: all 102 WebAssembly
and Web IDL files pass across the six runtime configurations, with only the
previously documented expected failures. The final ownership correction also
passes the focused Exception/native-platform tests on each official configuration;
the custom runs include that correction. Related Window, Location, DOMException,
Streams, and reflection checks on Node 26/addon report 701 passes and five existing
expected failures. Type checking, type contracts, generated declarations, changed-file
lint, import boundaries, and whitespace checks pass. This follow-up does not repeat
the preceding full-unit or native-addon runs.

Lookup-alignment validation on 3 November 2026: the affected 108 Web IDL,
WebAssembly, and structured-data files pass across all six runtime configurations,
retaining existing expected failures. Vin's proxy target-switching regression also
passes in each configuration. Type checking, type contracts, generated declarations,
changed-file lint, import boundaries, and whitespace checks pass. The full Node
26/addon rerun reports 18,971 passes, 106 existing expected failures, 18 skips,
and five TODOs. An earlier full run overlapped another runtime selection and hit
the Atomics ownership child's 15-second timeout; that test passed alone and in
the full rerun without another concurrent selection. Its timeout and expectations
were not changed. This lookup follow-up changes no addon or engine source.

## References and review order

Work through each document in order, choosing bounded slices as the review
progresses. Sections supplied by the engine still need an ownership and
observable-behavior review; their algorithms do not require duplicate TypeScript
implementations merely because the specification uses Web IDL.

1. [JavaScript API](https://webassembly.github.io/spec/js-api/), draft dated
   2 November 2026: audit engine facilities and establish the host boundaries.
2. [Web API](https://webassembly.github.io/spec/web-api/), draft dated
   2 November 2026: implement streaming API and serialization integration.
3. [ES-module integration](https://webassembly.github.io/esm-integration/js-api/),
   draft dated 10 October 2026: review additions to the JavaScript API and connect
   HTML's loader. Reuse the earlier audit for unchanged text; review differences
   where they appear, including additions before the module-record section.

The initial source snapshots are WebAssembly/spec
[`6057acd`](https://github.com/WebAssembly/spec/tree/6057acdb1a213f85369c64454c078a15f11ac4b1/document)
and WebAssembly/esm-integration
[`b141a95`](https://github.com/WebAssembly/esm-integration/tree/b141a95/document).
Both contain `document/js-api/index.bs` and `document/web-api/index.bs`.
Local copies are under `C:\Users\rando\source\repos\_web-platform\specs`:

| Document | Local Bikeshed source |
| --- | --- |
| JavaScript API | `webassembly-spec/document/js-api/index.bs` |
| Web API | `webassembly-spec/document/web-api/index.bs` |
| ES-module integration | `webassembly-esm-integration/document/js-api/index.bs` |

The clean spec checkout was refreshed on 2 November 2026 to
[`0148af7`](https://github.com/WebAssembly/spec/tree/0148af713f24eb68768a2f3fb86608555924d61c);
its JavaScript API source is unchanged from the initial snapshot. The ESM
checkout was confirmed current at `b141a95` on 2 November. Three documents require only these two checkouts.
Refresh the references when resuming after upstream changes. The
[Core specification](https://webassembly.github.io/spec/core/) supplies engine
semantics to consult as needed, rather than another browser implementation plan.

## Ownership and current state

| Owner | Existing support | Missing work here |
| --- | --- | --- |
| V8 and the selected Node runtime | Native Wasm compiler, instances, memories, tables, globals, functions, and related JavaScript APIs | Audit the selected runtime's draft coverage, realm behavior, and observable host obligations. |
| [JS Engine](../../js-engine/ROADMAP.md) | Realm identity, captured Wasm namespace/operations and constructors, promises, and source-text/synthetic module adapters | Capture further Wasm facilities as host algorithms need them and expose the addon's Wasm module adapter. Keep browser policy above this layer. |
| This directory and [Binding](../../web-idl/README.md) | An ordinary namespace and separate implementation/platform identities for every Wasm interface. Exception uses a native platform object and local prototype binding. Generated types include all declared members and ECMAScript error constructors. | Stock Node cannot establish permanent ownership of an engine-created Exception without exact creation-realm information. Cross-realm JSTag behavior remains an engine limitation below. |
| [HTML scripting](../scripting/ROADMAP.md) | Module resolution, import maps, fetching, caching, supplied-graph execution, and source-phase URL imports; §10 connects Wasm parsing and callback-aware instantiation | Deferred phases, object-valued source lookup, worker startup, and the known native binding limits remain explicit boundaries. Dynamic imports need the existing Node forwarding export. |
| [Node compatibility addon](../../../node-compat/README.md#webassembly-modules) | Wasm records compile and execute supplied mixed graphs; direct Wasm dependencies preserve native export identities | Consume the maintained bridge through JS Engine. Node's public VM API has no equivalent Wasm record class; the stock-without-addon path needs a deliberate solution or an explicit unsupported boundary. |

Browser operations use the existing owning `env` and its realm. Engine adapters
stay in JS Engine, policy checks in CSP, and generic loading/serialization in
their existing HTML owners. This integration creates no new environment,
registry, or alternate loader.

Generated platform declarations preserve `[LegacyNamespace]`: instance and constructor
types live under `Platform.WebAssembly`, without flat aliases. Supporting dictionaries
and enums retain their declared module-level names; they have no namespace ownership
attribute. Ordinary bindings convert arguments before delegating to the implementations' native backing objects.

The section-by-section notes below record the original audits and implementation
slices. The implementation/platform migration above supersedes their earlier
native-interface adapter descriptions; the engine findings and spec clashes remain relevant.

## 1. JavaScript API

| Sections, in order | Review and implementation responsibility |
| --- | --- |
| §§1–3: introduction, examples, notation | Establish the embedding boundary and terminology. Infra and Web IDL already supply the common foundations. |
| §§4.1–4.2: store and object caches | Engine-owned state and identities. Check how native objects map to Browlet's modeled Agents and realms; do not create a second Wasm store or object cache. |
| §5: namespace, validation, compilation, instantiation | Use an ordinary namespace and capture internal engine operations before author replacement. Audit conversion, compile options, promise/error realms, and asynchronous completion; identify the host work needed for the Web API. |
| §§5.1–5.6: Modules, Instances, Memories, Tables, Globals, Exported Functions | Audit native constructors, accessors, imports/exports, identity, and buffer behavior in this order. Record missing engine capabilities separately from missing browser connections. |
| §§5.7–5.10: Tags, GC Objects, Exceptions, Error Objects | Audit native exposure and cross-language behavior; retain engine-version limits explicitly. |
| §6: builtins | Verify supported builtin sets and compile options using the engine. Reuse this evidence for the ESM draft's prescribed string builtins. |
| §§7–8: error mappings and implementation-defined limits | Preserve native failures and document relevant backend limits; avoid adding a second runtime error model. |
| §§9–10 and conformance/reference material | Review security, privacy, and change history against the earlier audit. Record cross-specification requirements with their owners. |

### Reviewed: §§1–4, embedding and internal storage

Sections 1–3 establish the embedding boundary, a non-normative example, and
Infra list notation. The example combines Fetch/body consumption, asynchronous
Wasm instantiation, and JavaScript imports/exports. It is not an ES-module
import. Fetch remains its existing owner's responsibility; compilation and
completion ordering belong to the later namespace/Web API review. This slice
does not claim that the complete example or its scheduling has been verified.
No new runtime representation is needed for the notation.

Section 4's store and eight object/value caches belong to the engine. Browlet
retains native Wasm objects instead of adding TypeScript stores or projection
maps. The [storage tests](../../../test/browlet/webassembly/storage.test.ts)
exercise author code in two same-Agent Window realms:

- Wasm and JavaScript observe each other's writes to a memory's backing data.
- Importing and re-exporting memory, table, global, and exported-function
  addresses preserves their objects across realms and repeated instantiation.
  Reading the function back through a table preserves its identity too.
- `externref` round-trips primitive values, JavaScript objects/functions, and
  Browlet platform objects without changing their identity.

These three checks pass in all six supported runtime configurations. They are
focused integration checks, not full coverage of each native API.
Tag, GC-object, and Exception cache behavior is covered in §§5.7–5.9 below.

**Native Agent dependency:** `BrowletRealm` creates a context on its Agent's
queue, but [`runtime.createContext()`](../../js-engine/runtime.ts) uses the
current Node isolate for both stock and addon contexts. Modeled Agents and
AgentClusters do not establish separate native Wasm stores or memory barriers;
see [the existing agent limitation](../../LIMITATIONS.md#scheduling-and-callback-context).
The same-Agent tests do not validate worker transport or cross-Agent isolation.
Worker execution must establish native isolation; structured data must enforce
the permitted transfers.
Separate isolates would also prevent direct sharing of ordinary objects and
functions with the Node host. That requires a deliberate host-interaction API;
an isolate migration is outside this audit.

### §5 in progress: namespace and synchronous validation

[`validate()`](webassembly.ts) is connected through Web IDL conversion to the captured
native validator. The [namespace tests](../../../test/browlet/webassembly/namespace.test.ts)
cover input conversion, validation, namespace/constructor identity, operation
realms and descriptors, and author replacement of the public validator.
Asynchronous compilation, both instantiation overloads, and `JSTag` are covered
below. Generated platform declarations describe these three operations, their
result types, and the getter; the remaining native members are preserved
but not adapted.

**SPEC_CLASH(wasm-validate-bindings):** The draft's `AllowSharedBufferSource`,
compile-options dictionary, and `sequence<USVString>` conversion differ from
native V8 behavior. The retained requirements are:

- Accept `DataView` and raw `SharedArrayBuffer` inputs, as well as typed arrays.
- Reject primitive options, iterate `builtins`, convert strings, and propagate
  exceptions from author getters/iterators/conversion instead of returning false.
- Reject duplicate builtin names by returning false, including unknown names.
- Copy input bytes after argument conversion, so option getters' mutations or
  detachment affect the bytes being validated.

Direct Node controls reproduce these mismatches without Browlet. V8's
`GetAndCopyFirstArgumentAsBytes()` accepts ArrayBuffer and TypedArray but not
DataView or raw shared buffers. `CompileTimeImportsFromArgument()` reads builtin
names as an array-like rather than a Web IDL sequence; `WebAssemblyValidateImpl()`
turns option-reading exceptions into false. Node 24 observes ordinary byte
mutations during options access, while Node 26 and custom Node snapshot earlier;
all three retain the original bytes if options detach the input.

Browser probes on 31 October 2026 used Playwright's Windows Chromium
156.0.8078.4, Firefox 157.0, and WebKit 27.2:

| Boundary | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| DataView/raw shared-buffer acceptance | TypeError | Accepted | Accepted |
| Primitive options | Accepted | TypeError | TypeError |
| Throwing builtin getter/iterator | Getter becomes false; iterator ignored | Original exception | Original exception |
| Builtin object string conversion | Ignored | Converts and propagates exceptions | Rejects the object with TypeError |
| Duplicate `js-string` / unknown names | Both accepted | TypeError / accepted | Both return false |
| Bytes mutated/detached by options | Uses the original bytes | Uses the changed/empty bytes | Uses the original bytes |

Firefox additionally reads `importedStringConstants` before `builtins`, whereas
Web IDL dictionary conversion orders those members alphabetically. No probed
engine supplies the complete draft contract.

These conversion requirements were discussed in
[js-string-builtins #18](https://github.com/WebAssembly/js-string-builtins/issues/18)
in January 2024, including the need for handwritten engine bindings. V8's
[August 2025 byte-copy change](https://github.com/v8/v8/commit/4293cb47afcbb1575f51e1cbd63c7cf8f21f85ff)
explicitly prevents use-after-free when option access detaches the input, but
copies before Web IDL conversion. The
[DataView/shared-buffer report](https://github.com/whatwg/webidl/pull/1529#issuecomment-5476722427)
also identifies Chromium's input-brand mismatch. These establish specific
implementation gaps, not a general browser decision to disregard Web IDL.

The adapter reuses Web IDL conversion, normalizes accepted buffers through
JS Engine's existing byte-view helper, rejects duplicate names, and delegates
binary/builtin type validation to the captured native operation. No author
accessors remain in the converted options, so V8 can safely read/copy the bytes
after conversion without an additional TypeScript copy. Binding registers
namespace operation steps and can install them on a supplied realm-owned
namespace. Native constructors and Wasm object identities remain intact.
The namespace/identity tests and generic namespace binding checks pass in all
six supported runtime configurations.

Out-of-bounds DataView handling still follows the shared buffer-source helper;
the newer Web IDL/ECMAScript proposal tracked in Web IDL #1529 needs a separate
common-conversion review. No Node/V8 patch is required by this adapter.

### §5 audit: asynchronous compilation

`compile()` reuses the validator's buffer/options conversion and delegates to
the captured native compiler. The
[compilation regressions](../../../test/browlet/webassembly/compilation.test.ts)
cover argument conversion, byte-copy order, Promise/Module realms, rejection
timing, and asynchronous completion.

The [native completion handoff](../scripting/ROADMAP.md#native-webassembly-completion)
now connects every addon base to the owning HTML task, including Module thenable
assimilation before the compilation Promise settles. It uses V8's existing
`SetWasmAsyncResolvePromiseCallback`; no Node/V8 patch was needed. Stock mode
continues to make progress through Node's queue, without the addon's HTML task
and Document-lifetime guarantees. The native completion and delivery tests own
that scheduling contract; the separate raw Node/Window Promise handoff limitation
does not block this integration.

Web IDL handles dictionary/sequence/string conversion and rejects conversion
errors through the invoked realm's Promise, preserving author exceptions.
Only after conversion does the adapter borrow a byte view, including DataView
and shared storage. The native compiler copies it synchronously before returning.
Duplicate builtin names reject on the existing JavaScript-engine task source,
without allocating a Module or running its `then` getter. The error constructor
is captured before author code can replace the public property.

The private native Promise is observed internally. Its Module is wrapped in
`WasmModuleImpl` and used to resolve a typed `Promise<Module>` on the required task
source. Ordinary Binding projects the result before author code sees it.
This replaces the earlier direct-native-Promise exposure.

All twelve compilation regressions pass in the six-runtime matrix, including
the eight original conversion failures. Namespace, binding, completion, and
engine-job checks retain their existing capability expectations.

The JS API's asynchronous-compilation algorithm takes an optional task source;
`compile()` supplies none, whereas streaming compilation supplies networking.
Keep that distinction when connecting streaming completion. Compilation remains
asynchronous; the adapter does not replace it with a deferred synchronous constructor.

[`WasmImpl`](webassembly.ts) owns these operations and their compile
options. Namespace bindings forward converted arguments to the per-realm implementation
instance and install ordinary Web IDL operations. The
[standalone tests](../../../test/browlet/webassembly/implementation.test.ts)
cover conversion and controlled task delivery without Browlet, and direct
implementation calls with converted inputs.

### §5 audit: imports and compiled-module instantiation

The [instantiation tests](../../../test/browlet/webassembly/instantiation.test.ts)
exercise the native `instantiate(module, imports)` overload through author code.
They cover foreign Modules and the invoked realm's Promise/Instance, synchronous
ordered import getters (including repeated names), retained import values,
frozen null-prototype exports, and original getter/start exceptions. Missing
import containers produce TypeError; a noncallable function import produces
LinkError. The adapter uses the captured native instantiator after Binding selects
the overload and converts its arguments.

**SPEC_CLASH(wasm-instantiate-arity):** The earlier audit incorrectly treated V8's
ignored third argument with a Module as a specification requirement. Web IDL's
effective overload set leaves only the three-argument byte overload in that case,
so a Module must reject with TypeError before reading options. The adapter follows
that rule; the corrected tests separate ordinary cross-realm Module use from this
extra-argument rejection.

**SPEC_CLASH(wasm-module-start-timing):** The draft's
[asynchronous instantiation algorithm](https://webassembly.github.io/spec/js-api/#asynchronously-instantiate-a-webassembly-module)
reads imports synchronously, then queues the core instantiation in a later task.
That includes the module's start function, which can invoke author JavaScript.
The required trace is `import, returned, microtask, start`; V8 produces
`import, start, returned, microtask`. On 1 November 2026, local Playwright probes
found the V8 order in Chromium 156.0.8078.4 and the draft order in Firefox 157.0
and WebKit 27.2. Browlet accepts the existing V8 limitation for now and retains
the specification expectation as an approved expected failure. It still runs and
reports an unexpected pass if the engine changes; no timing repair is planned in
this slice.

This ordering was explicitly discussed in
[issue #741](https://github.com/WebAssembly/spec/issues/741) and
[PR #745](https://github.com/WebAssembly/spec/pull/745). JavaScriptCore sometimes
needed compilation after reading imports; the
[September 2018 discussion](https://github.com/WebAssembly/meetings/blob/main/main/2018/CG-09-18.md)
favored a consistent task boundary over optional timing that could force other
engines to copy Chrome. The discussion considered the extra turn's performance
cost, and Firefox implemented the change in 2019 without reported breakage at
that follow-up. The broader PR reached the main specification branch through
[#1606](https://github.com/WebAssembly/spec/pull/1606) in February 2023, but the
compiled-Module overload already explicitly queued core instantiation in
[March 2019](https://github.com/WebAssembly/spec/commit/16a91bd79e389bf88c3a69523b510476f6ab9868).
The research found no published V8 rationale for retaining immediate startup;
this remains a specification discrepancy, not an established exception.

In the local Node source, `deps/v8/src/wasm/wasm-engine.cc`'s
`WasmEngine::AsyncInstantiate()` calls `SyncInstantiate()` before notifying its
resolver. `InstantiateModuleResultResolver` in `wasm-js.cc` then reaches the
existing `SetWasmAsyncResolvePromiseCallback`. Our completion handoff consequently
controls Promise resolution, not the preceding start function. Delaying the entire
native call would also delay import getters and is not a correct replacement.
Separating import capture/validation from core instantiation is an explicit engine
integration boundary to investigate before adding a purported timing repair.
No Node/V8 timing patch was added by this audit or the subsequent binding adapter.
The original six-runtime audit observed five passes and this one failure in each
configuration, now classified as an approved expected failure. Typechecking and
focused lint pass.

The later Module/Instance interface review still owns their constructors and full
object contracts.

### §5 audit: byte-input instantiation

The [byte-instantiation tests](../../../test/browlet/webassembly/byte-instantiation.test.ts)
exercise `instantiate(bytes, imports, options)` through its namespace binding.
The passing checks establish the invoked realm's Promise, result object, Module,
and Instance; a synchronous byte snapshot before returning; import reads after
compilation; and original import/start exceptions. Invalid bytes reject before
reading imports. Builtin functions and string constants bypass the author import
object, and their options remain attached to the Module when it is instantiated
again. These are focused checks, not complete coverage of all builtin types.

Eight regressions initially reproduced **SPEC_CLASH(wasm-validate-bindings)**
on every runtime: DataView and raw shared-buffer acceptance, rejection of primitive
options, dictionary/sequence/string conversion, duplicate builtin rejection, and
copying bytes after options can mutate or detach them. The adapter now reuses
`WasmImpl.compile()` and its conversion rules. It calls the captured native
compiler, so replacing public `compile()` does not redirect instantiation.

**SPEC_CLASH(wasm-byte-module-promise):** The draft's
[byte-input algorithm](https://webassembly.github.io/spec/js-api/#dom-webassembly-instantiate-bytes-importobject-options)
compiles to a Promise of a Module before reading imports. Resolving that Promise
must observe the Module's `then` property. Node 24.19.0 skips that observation;
Node 26.8.1 and custom Node 27.0.0-pre perform it. Direct Node controls reproduce
the difference without Browlet or the addon. All three runtimes observe `then`
when calling their native `compile()` directly. The combined native byte operation
also skips Instance thenable assimilation in the audited custom runtime. These are
separate from the accepted startup-timing limitation. The adapter observes the
projected compilation Promise, then the native Module-instantiation Promise, and
resolves its typed result dictionary. Module and Instance `then` lookups occur once
each, and a thenable that replaces the compiled Module with bytes is rejected
instead of accidentally triggering another compilation.

**Interface boundary:** Module now uses normal implementation/platform conversion
for arguments, result dictionaries, unions, and overload selection. Instance
now follows the same ordinary implementation/platform split.
The engine-level Module predicate remains available for internal native values,
including explicitly accepted raw Modules during structured cloning.
JS Engine selects that check once at initialization,
using the addon's `isWebAssemblyModule()` predicate when available on any supported
base. It calls V8's existing `IsWasmModuleObject()` directly,
without enumerating exports. Without the addon, the captured Module `exports()`
intrinsic performs the initial check and a `WeakSet` caches successful recognition.
The fallback therefore allocates export descriptors once per recognized Module;
the cache does not keep Modules alive. Instance recognition uses its captured
`exports` getter. These native checks accept genuine foreign objects and reject prototype
lookalikes and JavaScript proxies. Changing an object's prototype or replacing
the public methods does not change its brand.

The implementation retains asynchronous native compilation and the existing
completion handoff. The addon exports an existing V8 predicate; no Node/V8 patch
is needed. Remaining native interface member coverage is reviewed in document
order; value recognition alone is deliberately not a complete API description.

### §5 audit: JavaScript exception tag

The [`JSTag` getter](webassembly.ts) projects a `WasmTagImpl` over the realm's captured native Tag.
The engine owns the exception-tag address, its `externref` signature, and Wasm
catching; Browlet supplies the namespace binding. The getter retains the original
tag after author replacement of the public property. Capturing it on `JSRealm`
also prevents the installed getter from recursively reading itself. This records
V8's current context-local value, not a new Browlet rule about tag ownership.
Public Tags use ordinary Binding; the native predicate is only for internal backings.
Node/V8 has no public Tag
predicate, so JS Engine uses a captured `Exception.prototype.is()` with a private
empty exception: a non-Tag throws, while a different valid Tag returns false.
This checks native state without reading author properties or enumerating data.
Exception construction and members remain a §5.9 dependency.

**SPEC_CLASH(wasm-js-tag-descriptor):** The draft declares a readonly namespace
attribute, hence an enumerable getter with no setter. V8 supplies a nonenumerable
readonly data property. The binding installs the draft getter, preserving the
native namespace, constructor, and tag. Firefox supplies an enumerable data
property; WebKit supplies the specified getter.

**SPEC_CLASH(wasm-js-tag-realms):** The draft's
[JavaScript exception tag](https://webassembly.github.io/spec/js-api/#js-exceptions)
is shared by the surrounding Agent, and its
[Tag object cache](https://webassembly.github.io/spec/js-api/#object-caches)
returns the same JavaScript object for that address. Browlet tests use sibling
Window realms in the same modeled Agent; the browser probes use a same-origin
iframe. The native engines disagree:

| Requirement | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
| --- | --- | --- | --- |
| Same `JSTag` object in same-Agent realms | Different objects | Different objects | Different objects |
| `new Exception(foreign.JSTag, [value])` throws TypeError | Does not throw | Throws | Throws |
| Wasm catches a JavaScript throw using an imported foreign `JSTag` | Does not catch | Does not catch | Catches |

These local Playwright probes ran on Windows on 1 November 2026. The same module
catches the original JavaScript value with its own realm's tag in every engine.
The [Browlet regressions](../../../test/browlet/webassembly/js-tag.test.ts)
also verify same-realm primitive/platform-object identity and rejection of
`new Exception(JSTag, ...)`.

V8's `wasm-js.cc` allocates `WasmExceptionTag` in each native context and stores it
in `wasm_js_tag`; its Exception constructor compares against that context's tag.
The Wasm compilers likewise load the instance's native-context tag for catching
JavaScript exceptions. Merely returning one Agent-wide public object would leave
those native comparisons unchanged and break other realms' native use of the tag.
The getter therefore retains each realm's engine-provided tag. Browlet accepts
these V8/Chromium limitations for now. The three cross-realm regressions retain
the draft assertions as approved expected failures, including unexpected-pass
detection. The getter adapter does not repair them.

An Exception-constructor adapter could reject the other Browlet realms' reserved
tags, but that alone would not repair native Wasm catching. The public addon API
cannot replace V8's internal context tag or its compiled exception comparisons.
A complete repair needs V8 work; aliasing the public property is insufficient.
No Node/V8 patch or second Wasm tag cache is introduced in this slice.

### §5.1 audit: Module import and export metadata

The opening IDL introduces import/export kinds and descriptors, followed by the
Module interface. The `AddressType` and `AddressValue` declarations support the
later memory/table APIs. This slice reviews the extern-kind mapping and the
`exports()` and `imports()` algorithms; it does not complete the Module interface.

The [reflection regressions](../../../test/browlet/webassembly/module-reflection.test.ts)
verify all five kinds, declaration order, repeated imports, Unicode and empty
names, empty lists, fresh results, and retention of metadata after source-buffer
mutation. Cross-realm calls allocate arrays, ordinary descriptor objects, and
errors in the invoked function's realm. Genuine Modules remain recognizable
after prototype replacement; lookalikes and proxies fail without author property
access. Compiled builtin/string-constant options filter imports independently
and leave exports intact, even if the original options object changes.

V8's `GetImports()` and `GetExports()` read the compiled module's tables and stored
compile-time imports, constructing fresh results in the current native context.
Those algorithmic behaviors need no second parser, descriptor cache, or Browlet
implementation.

**SPEC_CLASH(wasm-module-descriptor-order):** The JS API declares these results as
sequences of dictionaries. [Web IDL dictionary output conversion](https://webidl.spec.whatwg.org/#dictionary-to-es)
creates member properties in lexicographical order: `kind, name` for exports and
`kind, module, name` for imports. Native V8 instead creates `name, kind` and
`module, name, kind`, matching the JS API algorithms' written map order. Local
browser probes on 1 November 2026 found the same order in Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2. Values and module declaration order are unaffected;
the difference is visible through `Object.keys()` and JSON serialization.
The implementation/platform migration now deliberately uses ordinary Web IDL
dictionary conversion and its alphabetical property order. Two normal regressions
assert that order. The observed browser disagreement remains documented here;
native metadata is still read by V8, but public results are created by Binding.

`customSections()` and the constructor follow in textual algorithm order; the
former is covered below. Later slices review constructor conversion/options and
the native static descriptors; the declaration follow-up supplies their types.
Native value recognition and one adapted method alone do not constitute a complete interface binding.

### §5.1: Module custom sections

[`customSections()`](webassembly.ts) delegates section decoding, name matching,
and copying to the captured native reader. Binding converts the Module argument
and DOMString section name first. Its `sequence<ArrayBuffer>` result supplies an
array in the invoked realm while preserving the native buffers allocated there.
The retained module bytes remain engine-owned; no parser or byte cache is added.

**SPEC_CLASH(wasm-custom-section-name):** V8's `WebAssemblyModuleCustomSectionsImpl`
rejects an undefined second value, treating an explicit argument like an omitted
one. Web IDL instead converts explicit `undefined` to `"undefined"`; an omitted
required argument still throws. Local probes on 1 November 2026 reproduced V8's
behavior in Chromium 156.0.8078.4; Firefox 157.0 and WebKit 27.2 follow Web IDL.
The ordinary Browlet regression initially failed with `Argument 1 is required`.
The adapter now follows Web IDL and the latter two browsers without changing V8.

The [custom-section tests](../../../test/browlet/webassembly/custom-sections.test.ts)
cover repeated/empty/absent names, section ordering, payload-only copies, names
with supplementary characters, BOMs, NULs and unpaired-surrogate queries, fresh
fixed-length buffers, source/result mutation, cross-realm allocations and errors,
conversion ordering and exceptions, saved methods after public replacement, and
the bound function's descriptors. Import/export reflection now uses normal
Web IDL dictionary conversion, as described above.

**Binding:** The generated static method unwraps its Module argument, then calls
`WasmModuleImpl.customSections()`. The implementation invokes the captured native
operation with its private Module and the invoked realm. Binding converts the
returned sequence; no native constructor/prototype override is involved.

### §5.1 Module constructor

The [Module constructor](https://webassembly.github.io/spec/js-api/#dom-module-module)
now applies the declared buffer-source and compile-options conversions, then
delegates synchronous compilation and native object creation to the captured
engine constructor. The constructor binding borrows the source's current byte
range after conversion and rejects duplicate builtins. V8 copies that range
and owns validation, native slots, and the retained module bytes. The constructor
signature is included in the generated platform types.

**SPEC_CLASH(wasm-validate-bindings):** The first constructor run had eight ordinary
failures: raw shared-buffer acceptance, primitive dictionaries, iterable/string
conversion and iterator exceptions, duplicate known/unknown builtins, and source
mutation/detachment during option conversion. These repeat the namespace gaps
described above. The adapter follows Web IDL and the written Module algorithm;
the failures now have passing regression coverage.

Local browser controls on 1 November 2026 used Chromium 156.0.8078.4, Firefox 157.0,
and WebKit 27.2. Chromium accepted primitive options, skipped iterable/string
conversion, accepted duplicate builtins, and copied bytes before option getters.
Firefox rejected primitive dictionaries, converted iterables/strings, and copied
after option getters, but read `importedStringConstants` before `builtins` and
accepted duplicate unknown builtins. WebKit rejected primitive dictionaries and
duplicate unknown builtins, required a primitive imported-string option, and
copied bytes before the builtin getter. Its first probe rejected the object-valued
imported-string option before reaching the builtin getter. These are observations
of the selected browsers, not claims that their complete option handling agrees.

**SPEC_CLASH(wasm-module-constructor-order):** Web IDL resolves and converts the
constructor arguments before reading `newTarget.prototype`. Chromium reads the
prototype first. Firefox and WebKit read it after options, while reversing the
dictionary-member order as noted above. Browlet follows Web IDL; a regression
also changes the source bytes in the prototype getter to establish that the copy
occurs after both conversion and prototype selection.

**Binding:** The ordinary Module interface creates `WasmModuleImpl` around the
native compiler result. Binding allocates a separate platform object, selects
its subclass prototype, and retains the normal shared record. Static reflection
methods call instance methods; Module uses neither `interfaceOverride` nor
`retainNative`.

**Tracking:** Constructors, compiler results, and deserialization establish the
implementation/platform record before exposing the Module. Its original owner
survives cross-realm calls, prototype changes, and freezing on every backend.
Raw Modules from unregistered host realms require explicit implementation wrapping
and projection instead of automatic native-interface recognition.
The [tracking tests](../../../test/browlet/webassembly/module-tracking.test.ts)
cover those boundaries without relying on the addon to infer creation realms.

The [constructor tests](../../../test/browlet/webassembly/module-construction.test.ts)
cover native usability, retained bytes, DataView/shared inputs, `new` enforcement,
errors and objects in the invoked realm, subclassing, cross-realm prototype fallback,
lookup/copy ordering, saved constructors, reflection, and the conversion regressions.
CSP compilation policy is now connected across entry points; see the dependencies below.

### §5.2 reviewed: Instance constructor and exports

The [Instance constructor](https://webassembly.github.io/spec/js-api/#dom-instance-instance)
uses `WasmInstanceImpl` and ordinary Binding. Binding unwraps the required Module
to `WasmModuleImpl`, converts the optional imports object, and the Instance
implementation delegates to the Module implementation's `createInstance()` method.
The realm retains its original native Instance constructor before installation.
V8 reads the imports, uses the Module's retained builtin/string-import choices,
links, runs the start function synchronously, and creates the native instance and
exports object. Browlet does not duplicate those algorithms or store their state.

Binding records the public Instance's owner, including on stock Node without the
addon. Native slots stay on the implementation's private backing. Async results
use the same implementation and ordinary projection. Capturing the native
constructor keeps saved constructors and subclasses usable after public replacement.
Generated platform types now expose the constructor on `WebAssembly`.

**SPEC_CLASH(wasm-instance-constructor-order):** The first regression run showed
V8 reading `newTarget.prototype` before rejecting missing/invalid Modules or
primitive import objects. Web IDL converts the arguments first. On 1 November
2026, local Chromium 156.0.8078.4 reproduced V8's order; Firefox 157.0 and WebKit
27.2 rejected all five invalid argument cases without reading the prototype.
All three read it once for valid input. Browlet follows Web IDL and the latter
two browsers, consistently with the preceding Module constructor decision.
With valid input, prototype selection still precedes import-property reads.

The [constructor tests](../../../test/browlet/webassembly/instance-construction.test.ts)
cover argument/prototype ordering, foreign Modules and prototype lookalikes,
optional and extra arguments, repeated imports, retained builtin/string choices,
synchronous start execution, linking/runtime error realms, original author
exceptions, subclassing, saved constructors, and immediate ownership. No new
Binding hooks or addon/Node/V8 changes are required.

The [exports getter](https://webassembly.github.io/spec/js-api/#dom-instance-exports)
and [create an exports object](https://webassembly.github.io/spec/js-api/#create-an-exports-object)
algorithm remain engine-owned. The getter returns the receiver's retained object;
it does not rebuild the mapping or consult the receiver's visible properties.
The [exports tests](../../../test/browlet/webassembly/instance-exports.test.ts)
cover:

- Getter descriptors, function realm, nonconstructibility, and receiver checks,
  including foreign getters, prototype lookalikes, and Proxies.
- Retained identity after prototype changes, property shadowing, and public
  getter replacement; exported functions keep their originating realm.
- Separate, stable exports objects through synchronous construction and both
  asynchronous instantiation overloads, including empty modules.
- Null prototypes, frozen data properties, function aliases, ordinary integer-key
  ordering, and literal empty, Unicode, NUL-containing, `__proto__`, and `constructor`
  names. Freezing the mapping does not freeze a mutable exported Global's state.
- Genuine engine Instances created outside Browlet's registered realms.

All seven checks pass on Node 24.19.0, 26.8.1, and the custom build, each with
and without the addon. There are no expected failures in this exports suite.

No runtime adapter is needed for these checks. The earlier store tests cover
memory, table, global, and exported-function object reuse across imports/exports.
Their complete APIs, along with tags and their cache, retain their later
type-specific reviews; this slice does not claim to implement those sections.

**Binding boundary:** The public getter requires an ordinary Instance platform
object. `WasmInstanceImpl` builds one frozen, null-prototype exports object and
projects engine-produced Memory/Table/Global/Tag values through Binding. Exported
functions and externrefs retain identity. Raw Node Instances are not browser
platform objects; native receiver dispatch stays private to the implementation.

### §5.3 reviewed: Memories

The [Memory constructor](https://webassembly.github.io/spec/js-api/#dom-memory-memory)
now uses the existing native-interface constructor adapter. Binding converts
`MemoryDescriptor`, including the `AddressType` enum, before prototype selection.
Its `AddressValue` members deliberately remain ordinary JavaScript values until
V8 performs the constructor's `AddressValueToU64` steps. `WasmImpl.createMemory()`
calls the captured native constructor; V8 owns allocation, limits, the Memory
cache, and all backing storage. The resulting native object gets its immediate
`PlatformRecord` before applying the selected prototype, including in stock mode.
Native Memory recognition borrows the captured `grow` method with a private
coercion sentinel. V8 checks the receiver before converting the delta; the
sentinel stops that conversion before any growth or buffer mutation. A buffer
getter is unsuitable for recognition because it can allocate a previously lazy
buffer in the inspecting realm. No author properties are read, and no new Binding
hooks or addon/Node/V8 changes are required.

**Memory recognition hack:** This deliberately uses `grow` for its receiver check,
not for growth. The supported-runtime regressions found no correctness problems
or observable buffer side effects. The throw/catch may cost more than a direct
predicate; performance has not been measured. V8 already exposes
`IsWasmMemoryObject()` on all supported bases, so the addon could provide that
predicate without an engine patch. We chose the simple JavaScript alternative
instead of adding another addon export and rebuild requirement. Reconsider if
profiling or a failing regression supplies a concrete reason.

**SPEC_CLASH(wasm-memory-constructor-order):** The draft's Web IDL first reads
`address`, `initial`, and `maximum` (plus `shared` below), then selects
`newTarget.prototype`, then numerically converts the size values. The initial
regressions found Node reading the prototype first and converting each size before
reading the next descriptor member. Local browsers on 1 November 2026 produced:

| Runtime | Descriptor/prototype trace with object-valued sizes |
| --- | --- |
| Chromium 156.0.8078.4 / Node 24.19.0, 26.8.1, custom | prototype, address, initial, initial conversion, maximum, maximum conversion, shared |
| Firefox 157.0 | address, initial, initial conversion, maximum, maximum conversion, shared, prototype |
| WebKit 27.2 | prototype, address, initial, initial conversion, maximum, maximum conversion, shared |
| Browlet, following the current draft | address, initial, maximum, shared, prototype, initial conversion, maximum conversion |

This also rejects missing required members and invalid address enums before
author prototype access. Allocation failures and valid numeric inputs remain
the engine's responsibility; no buffer or store is duplicated in TypeScript.

**SPEC_CLASH(wasm-memory-initial-buffer-realm):** The draft's
[initialize a memory object](https://webassembly.github.io/spec/js-api/#initialize-a-memory-object)
creates its fixed buffer during construction. V8 instead creates that buffer
lazily, using the realm of the first getter that requests it. Borrowing another
realm's getter can therefore give a newly constructed Memory a foreign buffer.
The same browser builds above produced these results:

| Runtime | First buffer's realm when a foreign getter requests it |
| --- | --- |
| Chromium / WebKit | Getter's realm |
| Firefox | Constructor's realm |
| Browlet | Constructor's realm |

The adapter calls the captured constructor-realm getter immediately after native
construction, following the draft and Firefox without replacing any native
instance members. Regressions cover this first-buffer behavior and ensure that
recognizing an external native Memory does not materialize its buffer. Memories
created through other engine paths and later buffer refresh remain engine-owned;
this change does not claim to repair all native cross-realm buffer allocation.

**Shared-memory contribution:** The base draft does not include `shared`.
The [threads proposal](https://github.com/WebAssembly/threads/blob/main/document/js-api/index.bs)
adds `boolean shared = false`; the reader captured that source at
[`8deee832`](https://github.com/WebAssembly/threads/commit/8deee83209c24b20d977722ab6016d53ba303b98).
Keep this already-supported native option by composing its field as a partial
dictionary with the current address-aware base definition. The proposal's older
numeric descriptor spelling does not replace the base draft's `AddressValue`
members. Actual shared data, nondetachment of older shared buffers, and their
visibility remain native. Worker transport, Agent isolation, and browser policy
are separate integration dependencies; this change does not claim to finish them.

The [Memory tests](../../../test/browlet/webassembly/memory.test.ts) cover
descriptor/prototype ordering, conversion errors and author exceptions,
subclassing and exact construction ownership, nonmutating native recognition
after prototype changes, initial buffer realm, zero-initialization, byte
preservation, fixed-buffer detachment on growth
including zero, failure atomicity, i64/BigInt sizes, Wasm-instruction growth,
shared-buffer visibility, foreign receivers, buffer-mode switching, prohibited
author transfer, and page-aligned `ArrayBuffer.resize()` integration.

**Node 24 availability:** Its native prototype has neither `toFixedLengthBuffer()`
nor `toResizableBuffer()`. The two approved Node-24-only expected failures keep
the specification assertions and unexpected-pass detection. Node 26 and custom
Node provide both methods; all three tested browsers also expose them. A copied
ArrayBuffer cannot substitute for a live Wasm backing store. This slice adds no
polyfill or engine patch.

**Binding/type dependency:** The generated types now expose Memory construction,
its descriptor, and address types. Ordinary member bindings call `WasmMemoryImpl`,
which delegates to captured engine methods on its private backing. Buffer
conversion uses the invoked method's realm; the `buffer` getter retains the owner
of the already-created buffer. Node 24's absent engine operations remain an
explicit capability limitation.

Validation on 1 November 2026 ran all 182 WebAssembly, native-interface Binding,
and realm tests in each supported configuration, with no unexpected failures:

| Node base | Stock: pass / expected failure | Compat: pass / expected failure |
| --- | --- | --- |
| 24.19.0 | 170 / 12 | 172 / 10 |
| 26.8.1 | 174 / 8 | 178 / 4 |
| Custom 27.0.0-pre | 174 / 8 | 178 / 4 |

Of the 14 new Memory tests, 12 pass and the two unavailable methods are expected
failures on Node 24; all 14 pass on Node 26 and custom, with or without the addon.
The remaining expected failures predate this slice. Typechecking, generated
platform declarations, type contracts, focused ESLint, and import boundaries pass.

### §5.4 reviewed: Tables

The [Table constructor](https://webassembly.github.io/spec/js-api/#dom-table-table)
uses the existing native constructor adapter. Binding converts `TableDescriptor`
and its enums, selects `newTarget.prototype`, and stamps the engine object with
its constructor realm before applying the selected prototype. `AddressValue`
sizes and the optional initializer pass to V8 for numeric/reference conversion.
V8 owns the table's entries, growth, function identities, and Table object cache;
importing and re-exporting a table retains that same native object across realms.

The captured native `length` getter recognizes Tables without consulting author
properties, allocating a buffer, or changing any entries. This does not need
Memory's coercion hack, a new Binding hook, or an addon/engine patch.

**SPEC_CLASH(wasm-table-constructor-order):** The draft's Web IDL reads `address`,
then reads and string-converts `element`, then reads `initial` and `maximum`.
Only after that does it select `newTarget.prototype` and numerically convert the
sizes. In the same 1 November 2026 browser builds used above:

| Runtime | Descriptor/prototype trace |
| --- | --- |
| Chromium 156.0.8078.4 | prototype, element, element conversion, address, initial, initial conversion, maximum, maximum conversion |
| Firefox 157.0 | element, element conversion, address, initial, initial conversion, maximum, maximum conversion, prototype |
| WebKit 27.2 | prototype, address, element, element conversion, initial, initial conversion, maximum, maximum conversion |
| Browlet, following the draft | address, element, element conversion, initial, maximum, prototype, initial conversion, maximum conversion |

**SPEC_CLASH(wasm-empty-table-initializer):** The draft converts the supplied
initializer even when `initial` is zero. V8 skips that conversion and accepts
invalid function references such as `42`; Firefox and WebKit throw `TypeError`.
After native construction of an empty table with a supplied initializer, Browlet
calls the captured native `grow` with a zero delta and that initializer. This
validates the reference without adding entries or exposing the intermediate
table. Unlike Memory growth, Table zero growth has no buffer-detachment effect.
Tests cover i32/i64 tables, maximum zero, valid Wasm functions, and replacement
of the public length getter and grow method. V8 still performs type validation;
Browlet does not infer Wasm function identity from JavaScript function properties.

**SPEC_CLASH(wasm-table-undefined-value):** Web IDL treats explicit `undefined`
for an optional argument without a default as missing. Combined with the draft's
`DefaultValue`, `Table.grow(1, undefined)` and `Table.set(0, undefined)` on an
`anyfunc` table would use null. All three browsers instead treat the argument as
supplied and throw `TypeError`; omitting it still uses null. Keep that shared
native member behavior, as approved by Eric. Constructor handling already treats
explicit undefined like omission and requires no additional accommodation.

**SPEC_CLASH(wasm-table-set-error-order):** The draft converts the supplied
reference before `table_write` reports an invalid index. With both invalid,
`new WebAssembly.Table({ element: 'anyfunc', initial: 0 }).set(0, 42)` would throw
`TypeError`. All three browsers check the index first and throw `RangeError`.
Keep that shared native behavior, as approved by Eric. These two clashes have
three ordinary compatibility tests, not expected failures; changes to the
accepted behavior will therefore fail the suite.

**SPEC_CLASH(wasm-table-kind-values):** Bind the current draft's `TableKind`
values, `externref` and `anyfunc`. Chromium and Firefox also accept GC reference
names such as `anyref`; WebKit rejected `anyref` in the comparison. Proposal-only
constructor spellings are not exposed by this declaration. Native tables created
by Wasm can still carry other reference types; those types' engine-specific JS
conversion rules have not received independent coverage in this slice.

The [Table tests](../../../test/browlet/webassembly/table.test.ts) cover descriptor
conversion and exceptions, realm-owned errors and construction, subclassing,
captured methods, nonmutating recognition, function and externref identity,
default entries, failure atomicity, BigInt tables, foreign receivers, native
object-cache reuse, and growth initiated from both JavaScript and Wasm.

Ordinary `grow`, `get`, `set`, and `length` bindings delegate through `WasmTableImpl`.
Separate overload methods preserve the accepted omitted-versus-undefined behavior.
The generated Table constructor and descriptor are checked by type contracts.
Engine-produced Tables are wrapped and projected with an explicit owner. Cross-Agent storage and advanced reference-type exposure
remain outside these same-Agent tests.

Validation on 1 November 2026: all 15 Table tests pass in each configuration.
The 197-test WebAssembly, native-interface Binding, and realm runs have no
unexpected failures and retain only the pre-existing expected failures:

| Node base | Stock: pass / expected failure | Compat: pass / expected failure |
| --- | --- | --- |
| 24.19.0 | 185 / 12 | 187 / 10 |
| 26.8.1 | 189 / 8 | 193 / 4 |
| Custom 27.0.0-pre | 189 / 8 | 193 / 4 |

Typechecking, generated declarations, type contracts, focused ESLint, and import
boundary checks pass. No addon rebuild or Node/V8 patch was needed.

### §5.5 reviewed: Globals

The [Global tests](../../../test/browlet/webassembly/global.test.ts) review the
native constructor, `value` accessors, `valueOf()`, and the Agent's Global object
cache through Browlet author realms. Binding now converts the constructor's
descriptor, selects `newTarget.prototype`, and calls the captured native
constructor with the converted initializer. V8 retains typed storage, value
accessors, `valueOf()`, and the Global object cache; there is no second store.

The passing coverage includes numeric defaults/conversion, immutable writes,
conversion-failure atomicity, externref and function identity, subclassing,
foreign native receivers and errors, and shared mutable storage across
JavaScript, Wasm, and import/re-export aliases. Exported vector Globals exist
and can be imported by Wasm, even though JavaScript cannot read their values;
the tests cover their existence and rejected reads/writes, not vector imports.
This is separate from the recorded ES-module live-binding limitations below.

**SPEC_CLASH(wasm-global-construction-order):** Web IDL converts the descriptor
before reading `newTarget.prototype`; the constructor then converts the initial
value. V8 instead reads the prototype first. Missing/invalid descriptor values
therefore also trigger a prototype getter that should not run. A local comparison
on 1 November 2026 found Chromium 156.0.8078.4 and WebKit 27.2 doing this;
Firefox 157.0 converted both the descriptor and the initializer before reading
the prototype. None gave the complete draft order. The constructor adapter
follows Web IDL; the original regression now passes as an ordinary test.

**SPEC_CLASH(wasm-global-undefined-initializer):** For the optional `any v`
argument, Web IDL treats explicit `undefined` as missing. Thus
`new WebAssembly.Global({ value: 'anyfunc' }, undefined)` should use the default
`null`. Chromium and Firefox throw `TypeError`; WebKit returns a Global holding
`null`. The adapter omits the native second argument when the converted optional
argument is undefined, preserving that default. Numeric defaults and externref
`undefined` continue to work. The original regression now passes.

**SPEC_CLASH(wasm-global-value-types):** Chromium and Firefox accept `anyref`,
an engine extension outside the current seven-entry `ValueType` enum; WebKit
rejects it. The Global descriptor now enforces the draft's enum, consistently
with Table. Recognition still accepts real engine-created Globals with extended
types; rejecting a constructor spelling does not invalidate those objects.

**Native recognition:** Unlike Modules and Memories, the current public V8
`Value` API offers no Global predicate. There is no portable, harmless getter
probe to substitute:

- Valid exported `v128` Globals throw when their value is read. The native getter
  and `valueOf()` therefore cannot distinguish all real Globals from invalid
  receivers. Chromium and Firefox throw `TypeError`; WebKit throws `RuntimeError`
  in the same browser probe. V8's exception type matches the draft.
- Reading a function-valued Global can create its first JavaScript function
  wrapper. The regression creates a Global in another realm whose function has
  no separate export: the first getter chooses the function wrapper's realm,
  and later reads retain that identity. A recognition probe would perform that
  observable work before author code does. This is a reason not to use the
  getter as a predicate, not a claim that an ordinary author read is erroneous.
- The experimental type-reflection `Global.prototype.type()` method is absent
  by default on the checked runtimes and all three browser installations.

The relevant native paths are `WebAssemblyGlobalImpl`,
`WebAssemblyGlobalGetValueCommon`, and `WebAssemblyGlobalSetValue` in V8's
`src/wasm/wasm-js.cc`. Existing native methods continue to enforce their own
receiver checks on private backings. Ordinary Binding recognizes public Globals
and unwraps `WasmGlobalImpl`. Engine-produced Globals use the same wrapper cache
and projection, including vector exports, so their public owner is known on stock
Node too. Getter/setter bindings preserve the invoked method's realm.

The investigation is retained in the shared experimental repository's
`wasm-global-recognition` directory. The maintained addon exports
`isWebAssemblyGlobal()` using V8's private instance-type helpers and
a genuine Global's sampled tag. The implementation comment records the hack,
its Node/V8 version dependency, and the two alternatives: a public V8 predicate
patch, or an allocating public Wasm import/re-export probe.

JS Engine selects the addon predicate once, falling back to that public probe
only without the addon. An immutable externref import re-exports a matching
Global by identity; other real Globals produce a native type/mutability
`LinkError`. Ordinary objects become externref values in different Globals.
The module has no start function or imported callbacks. Captured constructors,
exports getter, and error prototype avoid author replacements. Its inline hack
note records the per-check Instance/error allocation cost. No engine patch,
persistent context, value getter, or second object registry was added.

The native regressions cover all three Node bases, including vector/function
Globals, VM/addon realms, hostile properties and proxies, collection, and worker
initialization. The full native suite passes: 338 tests on each official base,
337 passes and one existing skip on custom. These results validate the addon
before connecting the Global binding.

The audit initially reproduced three ordinary constructor failures. The binding
fixes them without reclassifying or weakening their assertions. Additional
checks cover captured intrinsics, construction ownership, external/foreign
Globals, frozen vector exports, and function materialization after recognition.
All 20 Global binding/recognition tests pass in each of the six configurations.
The broader 221-test Wasm/native-interface/realm selection has no unexpected
failures: Node 24 stock/compat report 209/211 passes and 12/10 existing expected
failures; Node 26 and custom stock/compat report 213/217 passes and 8/4 existing
expected failures. No expectation was reclassified.

Generated constructor/dictionary types are connected. Retained native instance
members now have generated types without replacement bindings.
The next section is §5.6, Exported Functions.

### §5.6 reviewed: Exported Functions and the host-callback boundary

The [exported-function tests](../../../test/browlet/webassembly/exported-functions.test.ts)
exercise native functions through Browlet's author realms. The function object,
address/cache, Wasm execution, and primitive conversions belong to V8; there is
no Web IDL interface to generate. Exported functions retain their native
identities; the adapter below wraps their JavaScript imports.

Thirteen passing checks cover builtin name/length descriptors and nonconstruction;
alias and cross-realm re-export identity; numeric conversion and argument order;
missing/surplus arguments; scalar and multiple-result shapes and allocation realms;
externref/funcref identity; vector-signature rejection before coercion; callee-realm
traps; strict host-call receivers; multi-value host iterables and arity checking;
and preservation of JavaScript/Wasm exception identities. The fixtures spell out
their Wasm declarations and build only small, closed binary sections.
**Host integration:** The specification's “create a host function” algorithm
captures incumbent settings when a JavaScript function is imported. Each later
invocation prepares script execution in the function's realm, prepares a callback
with those stored settings, and cleans up both on return or throw. These steps
are the browser embedder's responsibility. V8's successful call/conversion behavior
does not supply Browlet's modeled HTML entries.

`createInstance()` and `instantiateModule()` share a lazy import adapter;
byte-input instantiation reaches the latter. It uses captured native import
metadata to wrap only JavaScript function imports as V8 reads their fields.
Fresh proxy targets preserve frozen import objects, getter receivers, duplicate
lookup order, and abrupt completion. Native metadata omits the same compile-time
builtins and string constants as V8's import lookup. Function-valued externref
globals remain ordinary data.

Native Wasm functions pass through unchanged: `InstanceBuilder::ProcessImportedFunction()`
retains native function references before resolving the call specifically to
preserve their identity. JS Engine recognizes these through zero growth of a
private zero-length funcref table. That check accepts native Wasm functions,
rejects JS/bound/proxied functions without reading author properties, and neither
stores the candidate nor changes the table. The inline HACK comment records why
this public-API check is used instead of a V8 patch or internal headers.

For JavaScript imports, the adapter captures settings at registration and uses
the original callable's realm hooks on each invocation. Associated-realm lookup
is deferred until invocation, so even an already-revoked callable Proxy can be
imported and fails only when called. Preparation and cleanup now pass for all
three instantiation paths and for nested callbacks that throw. Re-export identity,
frozen data/accessor imports, builtin/import alignment, bound/proxied callbacks,
revocation timing, and captured-intrinsic checks protect the integration.

Byte-input instantiation saves its initiating settings across compilation and
restores them around the later import reads. The internal Promise observer is
a Node host function, so the custom engine's Promise hooks do not supply its
HTML incumbent automatically. Without this local accommodation, callback capture
throws during the continuation. A foreign-compilation regression verifies that
both import getters and later callbacks retain the initiating settings instead
of adopting the compiler's realm; cleanup restores the preceding state.

The consolidated adapter uses `captureEnvironment()` and its
`WebIDLEnvironment | null` result, including null for unbound hosts. Attached
browser environments still use the same incumbent lookup; the typed callback
environment does not supply the missing settings in this internal Promise
continuation, so the local accommodation remains necessary.

The import argument is intentionally an IDL `object`, not a recursively converted
callback dictionary. Both the native-interface constructor override and the
namespace operation still perform their declared Web IDL conversion. The adaptation
belongs to Wasm's type-directed import algorithm; functions can also be
ordinary externref-global data and must not all be wrapped indiscriminately.
The Instance constructor and both instantiate overloads now explicitly request
entry-time incumbent capture with an injected incumbent environment. Binding cannot
infer that requirement from an opaque `object` type. The existing native function entry observes B before the
host implementation runs, so A calling B to register C's callback saves B while
later invocation enters C. The constructor uses a native function as its existing
Proxy's construct trap; it needs neither a second constructor Proxy nor a new
addon API. Byte-input registration also saves B through later compilation and
import reads.

Member overrides receive `{ relevant, callee, incumbent }` followed by converted
values. Capture stays opt-in because native entry and incumbent lookup add work;
ordinary overrides such as the Fetch constructors leave it disabled. Binding
never parses override signatures. Its existing callback conversions and injected
arguments still supply their own capture requirements, and forwarding accessors
propagate those requirements. See [Web IDL's contract](../../web-idl/README.md).

The shared function factory preserves the receiver through a native apply trap.
The broader tests exposed an existing raw-native-entry normalization of undefined,
null, and primitive receivers; passing the original receiver as a trap argument
fixes that without changing the addon. Explicit capture also works with the
ordinary constructible function factory, preserving prototype identity, newTarget,
and argument transport without consulting author iterators. Automatic selection
for other callback-typed constructors remains its separate documented dependency.
The independent Web IDL callback suite passes its 15 cases on Node 24 with the
addon, including its existing preparation/cleanup checks.

**Result-conversion integration:** V8's `src/builtins/wasm-to-js.tq` converts the
result after calling JavaScript. The addon now reads the compiled Module's bytes
through public V8 APIs and generates an import/re-export bridge with the original
signature. JS Engine supplies that converted call; the existing HTML callback
`try/finally` encloses scalar coercion and multi-value iteration, including throws.
No Node or V8 patch is needed. A weak cache owns decoded metadata and compiled
bridges per Module/signature; individual callbacks keep their own instances.

The reader preserves recursive groups and indexed reference types rather than
implementing Wasm conversion. Native reflection still determines visible import
order, excluding compile-time builtins and string constants. A captured Instance
exports getter and private tuple iterable protect conversion from author prototype
replacement. Native tests cover mixed imports, canonical reference identity,
conversion-error realms, revoked Proxies, disabled author compilation, GC lifetime,
and worker isolates. [The addon contract](../../../node-compat/README.md#webassembly-imported-function-conversion)
records the supported encodings and the extra call/instantiation cost.

**Remaining boundaries:** Stock Node cannot recover signatures from arbitrary
Modules and retains the four stock-only expected result-scope failures. Unknown experimental
binary encodings fail explicitly on first adapted invocation. Extend the reader
before enabling shared-everything, descriptor, continuation, or string-view types
and exact-function imports, or adopting a runtime that enables those proposals
by default. These are known limits, not an exhaustive proposal audit. Custom
page-size limits are future compatibility work beyond the current V8 decoder;
ordinary shared memories and memory64 already work.

Production validation on 2 November 2026: all 33 exported-function/callback
tests pass with each rebuilt addon. The 382-test WebAssembly/JS Engine selection
has no ordinary failures with Node 24, Node 26, or custom Node plus addon; the
existing engine-dependent expected failures remain. All three stock runs retain
exactly the same seven ordinary failures (four result scopes and three incumbents).
The 355-case native suite passes on all three bases, with the existing custom-only
installer skip. Typechecking, Web IDL type contracts, and scoped ESLint pass.

The A-to-B-to-C regressions cover constructor, Module, and byte instantiation.
They pass with the addon; stock backends still save A because JavaScript alone
cannot observe B's author frame at entry. The foreign async fixture supplies an
active Document so completion tasks can run. No Node or V8 patch or addon rebuild was needed.

After consolidation review on 2 November, Eric approved classifying those seven
stock-only limitations as expected failures. The required assertions remain
unchanged: result conversion requires `wasmImportCalls`, and incumbent capture
requires `platformEntries`. All three addon builds still require ordinary passes.

Earlier validation on 2 November 2026, before the result-conversion bridge,
including the grouped override environments:
the 32 exported-function/callback checks report 28 passes and four ordinary
result-conversion failures on all three addon builds. Without the addon, the three
incumbent checks also fail (25 passes, seven ordinary failures). The final
211-test selection covers explicit capture, native interface and namespace overrides,
JS Engine, WebAssembly, Window messaging, and Location across all six configurations,
with no additional failures. Complete Node 24/addon and custom/addon unit runs each
cover 18,426 tests with only those four ordinary failures; existing expected failures
and idle skips remain unchanged. Both full runs complete unsharded with two workers.
Those earlier runs used an 8 GiB launcher workaround. Consolidation replaces it
with Vitest 5.0.5, which fixes the strong mock registry retaining discarded Window
realms in reused workers. The launcher again preserves Node's normal heap limit
and caller options. Typechecking, the separate Web IDL type contracts, scoped
ESLint, and whitespace checks pass.

The full §5.6 text was read, including the value/address conversion algorithms.
Numeric/reference cases and earlier Memory/Table address checks retain native
conversion. Exported GC-object and exception-reference behavior is reviewed in
§§5.8–5.9. The callback integration above completes this
section's current work, with the documented stock-only and proposal-encoding
boundaries retained. No further engine patch is required to proceed to Tags.

### §5.7 reviewed: Tags

The full Tags section, including §5.7.1 and its cache/allocation algorithms,
has been reviewed. `TagType.parameters` now passes through the existing Web IDL
sequence and `ValueType` conversions. `WasmTagImpl` allocates with the realm's
captured native constructor and ordinary Binding creates the separate public
object, including subclassing and ownership. V8 still owns tag addresses,
signatures, and allocation; the implementation cache preserves engine-exported
Tag identity. No addon capability or engine patch is needed.

`SPEC_CLASH(wasm-tag-constructor)`: the draft specifies an iterable sequence,
converted before `newTarget.prototype` is read. V8 reads array-like length and
indices, reads the prototype first, and then returns a Tag with the native
prototype instead of the requested derived prototype. Browlet follows Web IDL,
using ordinary constructor binding as for the earlier Wasm interfaces.
The `ValueType` enum also rejects engine-only reference names such as `anyref`,
as already chosen for Global construction.

Observed on 2 November 2026 with Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2:

| Probe | Chromium | Firefox | WebKit | Browlet choice |
| --- | --- | --- | --- | --- |
| Custom iterable with a throwing `length` getter | Reads `length`, throws | Iterates successfully | Iterates successfully | Iterate, as Web IDL requires |
| Array-like parameters without an iterator | Accepted | TypeError | TypeError | TypeError |
| Descriptor versus prototype lookup | Prototype first | Descriptor first | Descriptor first | Descriptor first |
| Derived constructor's prototype | Discarded | Preserved | Preserved | Preserve |
| `anyref` parameter type | Accepted | Accepted | TypeError | Reject the extension |
| `v128` parameter type | Accepted | Accepted | Accepted | Accept; payload conversion belongs to Exceptions |

The native source agrees with those observations: V8's
[`WebAssemblyTagImpl`](https://github.com/v8/v8/blob/main/src/wasm/wasm-js.cc)
uses `GetIterableLength` and indexed reads, while
[`WasmTagObject::construct`](https://github.com/mozilla-firefox/firefox/blob/main/js/src/wasm/WasmJS.cpp)
and WebKit's
[`constructJSWebAssemblyTag`](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/wasm/js/WebAssemblyTagConstructor.cpp)
consume iterable types and preserve derived construction.
On an element-conversion exception, Firefox and Web IDL propagate it without
closing the iterator; WebKit closes it. The existing sequence converter follows
Web IDL and preserves the thrown value. This slice does not change that shared algorithm.

The [Tag regressions](../../../test/browlet/webassembly/tag.test.ts) cover
conversion order and abrupt completion, all seven draft value kinds, signature
snapshots, distinct tags, constructor metadata/subclassing, error and ownership
realms, captured constructors, cross-realm import/re-export identity, mismatched
imports, and recognition of frozen engine-created tags. Six failing constructor
checks were reproduced before binding the constructor; the adapter resolves them.
Generated platform types expose `WebAssembly.Tag` and require its parameter
sequence, with no separate global `Tag` constructor.

Validation on 2 November 2026: all 14 Tag tests pass in all six runtime
configurations. The 22-file, 310-test WebAssembly/realm/Binding selection has no
ordinary failures: Node 24 passes 300 with 10 expected failures using the addon,
and 291 with 19 expected failures without it; Node 26 and the custom build each
pass 306 with 4 expected failures using the addon, and 295 with 15 expected
failures without it. The expected failures are previously documented cases;
this slice adds none. Typechecking, platform type contracts, and focused ESLint
also pass.

**Dependencies:** Native tag recognition already exists through the captured
`Exception.is()` check. Externally created tags keep the existing stock-Node
ownership limitation; their values and import identities still work. Full
Exception construction, payload conversion, and exception-reference behavior
are covered in §5.9 below. The three
previously accepted cross-realm `JSTag` limitations are unchanged.

### §5.8 reviewed: Garbage Collected Objects

The full [section](https://webassembly.github.io/spec/js-api/#gc-exotic-objects)
defines the internal methods and identity cache for structs and arrays exported
to JavaScript. These are native exotic objects, with no public constructor or
Web IDL interface to bind. V8 supplies their internal slots, typed reference
checks, storage and object identities. No additional `PlatformRecord` family,
recognition predicate, projection wrapper or TypeScript cache is needed here.

The [regressions](../../../test/browlet/webassembly/gc-objects.test.ts) exercise
both kinds through Browlet author code. They check all eleven internal methods,
opaque fields, null prototypes, collection-key use, cross-realm exceptions,
typed-reference rejection without coercion, native mutation, distinct allocations,
and identity across repeated calls, globals, tables and same-Agent realms.
GC references also round-trip through the existing two-result host callback
bridge, exercising its preserved struct/array type declarations. The related
§5.6 `i31` conversions are checked for signed Number representation, valid bounds,
nulls and rejected non-integer/non-number inputs.

`SPEC_CLASH(wasm-gc-reflection)`: the draft returns `false` from the internal
`[[PreventExtensions]]` and `[[DefineOwnProperty]]` methods. V8 throws `TypeError`
instead. `Object.preventExtensions()` and `Object.defineProperty()` throw either
way; the difference is observable through their `Reflect` counterparts. Ordinary
assignment and deletion are supposed to throw and already do.

Observed on 2 November 2026 with Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2;
both struct and array objects give the same results:

| Operation | Draft | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- |
| `Reflect.preventExtensions(value)` | `false` | TypeError | `false` | TypeError |
| `Reflect.defineProperty(value, "x", { value: 1 })` | `false` | TypeError | `false` | `false` |
| `Reflect.setPrototypeOf(value, null)` | `false` | `false` | `true` | `false` |

V8's [`JSReceiver::PreventExtensions` and `DefineOwnProperty`](https://github.com/v8/v8/blob/main/src/objects/js-objects.cc)
explicitly throw for Wasm objects, and its
[`gc-js-interop-objects.js`](https://github.com/v8/v8/blob/main/test/mjsunit/wasm/gc-js-interop-objects.js)
tests require those exceptions. Firefox's
[`WasmGcObject::obj_defineProperty`](https://github.com/mozilla-firefox/firefox/blob/main/js/src/wasm/WasmGcObject.cpp)
returns a failed property operation; WebKit's
[`WebAssemblyGCObjectBase`](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/wasm/js/WebAssemblyGCObjectBase.cpp)
likewise returns failure for definition but throws for extension prevention.

Browlet deliberately follows Chromium for extension prevention and property
definition. The four cases (two operations on both object kinds) are ordinary
passing compatibility tests that require `TypeError`, following the established
Module descriptor-order and Table compatibility-test policy. The `SPEC_CLASH`
notes retain the draft's `false` result and the other browsers' behavior. A change
in V8's behavior will fail these ordinary assertions and prompt review.

Browlet retains the native objects.
A JavaScript Proxy cannot transparently repair these operations: typed Wasm
parameters reject a Proxy around a valid GC object, as the regression confirms.
An addon cannot replace these native internal methods through the public API;
a direct repair would change V8. No engine or addon patch is proposed for this
reflection-only difference.

Node 24.19.0's V8 13.6 also throws from `Reflect.setPrototypeOf()` for both null
and a different prototype. Node 26 and the custom build return the required
`false`. Eric approved the two isolated assertions as expected failures on Node
24 only; newer engines run them normally. These two expected assertions retain
the draft's result and unexpected-pass detection. This is an older-engine gap
against the selected newer-V8 behavior, distinct from the two deliberately
retained Chromium compatibility choices above. The operation is rejected in
every version; only throwing versus returning `false` differs. Leave Node 24's
gap documented rather than adding a separate engine build or intercepting
`Reflect.setPrototypeOf()` in Browlet realms for this case.

Validation on 2 November 2026: all 21 GC-object cases ran in each of the six
runtime configurations. Node 24 reports 19 passes and 2 approved expected
failures; Node 26 and the custom build report 21 passes, both with and without
the addon. There are no ordinary failures.
Typechecking, platform type contracts, focused ESLint and whitespace checks pass.

**Dependencies:** Same-Agent identity is verified; native isolation between
modeled Agents and worker transport remain the existing Agent/serialization
boundaries. Keeping reference identities alive during these tests is not a
garbage-collector stress test. Exception construction and reference behavior
follow below.

### §5.9 reviewed: Exception construction

The constructor uses the existing native-interface adapter. Binding converts
`Tag`, `sequence<any>`, and `ExceptionOptions`, selects `newTarget.prototype`,
and records native identity and constructor-realm ownership. The captured V8
constructor rejects its reserved `JSTag`, checks payload length, converts native
payload values, and optionally captures the stack. There is no duplicate
exception store, payload conversion implementation, or object cache.

`SPEC_CLASH(wasm-exception-constructor)`: V8 reads payload `length` and indices,
does not consume its iterator, converts native values before reading options,
and discards derived prototypes. The same binding machinery used for Tags
repairs these boundary differences. Four failing regression cases were observed
before the adapter was added; all four then passed.

Local browser probes on 2 November 2026 used Chromium 156.0.8078.4,
Firefox 157.0, and WebKit 27.2:

| Probe | Chromium | Firefox | WebKit | Browlet |
| --- | --- | --- | --- | --- |
| `Set` payload | Rejects | Accepts | Accepts | Accepts |
| Array-like payload without iterator | Accepts | Rejects | Rejects | Rejects |
| Derived Exception prototype | Discarded | Preserved | Preserved | Preserved |
| Constructor conversion order | prototype → value → options | options → prototype → iterator → value | iterator → value → options → prototype | iterator → options → prototype → value |

The selected order follows [the constructor's Web IDL declaration](https://webassembly.github.io/spec/js-api/#exceptions)
and the existing constructor binding: convert arguments, select the prototype,
then execute the constructor steps (including native value conversion).
V8's `WebAssemblyExceptionImpl` / `EncodeExceptionValues` in `wasm-js.cc`
confirm its array-like and options ordering. Browser disagreement is documented;
this slice adds no expected failures.

`isWebAssemblyException()` reuses the captured native `Exception.prototype.is`
with the existing private Tag probe. It checks the receiver without reading
author properties or payloads; a mismatching tag still proves the receiver is an
Exception. Tests cover foreign objects, replaced public intrinsics, frozen
objects, hostile prototypes, forged receivers, and revoked Proxies. No addon
or engine patch is needed. Exceptions thrown directly by foreign Wasm code are
recognized too. Exact ownership of such
externally created objects requires the existing addon; stock Node accepts
them without assigning a guessed `PlatformRecord` owner.

Validation on 2 November 2026: 15 constructor/ownership cases and two native
recognition cases pass on Node 24, Node 26, and the custom build, with and without
the addon. The broader custom/addon WebAssembly and native-binding selection
reports 277 passes and four existing expected failures. Typechecking, platform
type contracts, focused lint, and whitespace checks pass.

### §5.9 reviewed: Native methods and exception references

The [method tests](../../../test/browlet/webassembly/exception-methods.test.ts)
cover tag-address matching rather than signature matching; typed payload reads;
receiver/tag checks before index conversion; conversion before mismatching-tag
rejection; bounds errors; author-thrown values; borrowed-method error realms;
method/accessor descriptors; and captured/uncaptured stacks. The native methods
already supply these operations. Three draft assertions first failed, then
became ordinary compatibility tests after Eric approved retaining Chromium's
behavior on 2 November 2026:

| Probe | Draft | Chromium 156.0.8078.4 | Firefox 157.0 | WebKit 27.2 |
| --- | --- | --- | --- | --- |
| `getArg(tag, -0.9)` for a one-value payload | Reads index 0 | TypeError | Reads index 0 | Reads index 0 |
| `getArg(tag, 0xffffffff + 0.5)` | Truncates, then RangeError for payload bounds | TypeError before truncation | RangeError | RangeError |
| Traced stack read with the prototype getter directly | Same stored value as ordinary access | undefined; ordinary access reads an own stack property | Same string | Same string |

`SPEC_CLASH(wasm-exception-index-range)` now follows Web IDL's `[EnforceRange]`:
truncate first, then check the Number's range. The ordinary Tag binding requires
member argument conversion; there is no native conversion bypass. The two
fractional regressions assert this specification behavior. V8/Chromium still
checks the untruncated Number first.
`SPEC_CLASH(wasm-exception-stack)` retains V8's instance stack capture and its
prototype getter, which always returns `undefined` for a genuine Exception.
The browser probes above ran locally on 2 November. WebKit additionally returns
RangeError for NaN/undefined indices, unlike the draft, Chromium, and Firefox;
Browlet retains V8's TypeError. V8 sources are `EnforceUint32`,
`WebAssemblyExceptionGetArgImpl`, `WebAssemblyExceptionGetStackImpl`, and
`WebAssemblyExceptionImpl` in `wasm-js.cc`. These are accepted differences,
not new expected failures or requests for an engine patch.

The [reference tests](../../../test/browlet/webassembly/exception-references.test.ts)
exercise the native Exception object cache through `try_table`, `catch_all_ref`,
a mutable `exnref` global, and `throw_ref`. Repeated throws of one stored address
return the same object, including across same-Agent realms; distinct new throws
produce distinct objects. Constructed subclasses retain their properties and
identity. JavaScript-thrown primitive values and objects survive native catch
and rethrow unchanged, while tagged exceptions can be caught by their tag and
their payload extracted. V8 rejects direct JavaScript `exnref` function arguments
and results, rejects extraction/construction of `v128` or `exnref` payloads,
and reports a RuntimeError for throwing a null exception reference.

This also reviews §5.9.1 against the existing JavaScript exception tag tests.
The three accepted cross-realm `JSTag` expected failures remain unchanged;
catch-all rethrows passing does not repair catches using another realm's JSTag.
No second exception cache, payload store, or runtime adapter was added.

Validation on 2 November 2026: all 21 new method/reference tests pass on each of
the six runtime configurations. Together with the constructor and JSTag suites,
each configuration reports 40 passes and the same three existing expected
failures. No ordinary failures or new expected failures remain. Typechecking,
focused lint, and whitespace checks pass.

**Remaining dependencies:** The native method/cache audit above predates the
ordinary implementation migration. After removing the special adoption bridge,
native throws, tagged catches, and captured stacks need integration on every
backend; their behavioral regressions are retained as ordinary failures. See the
[current migration baseline](#implementationplatform-migration). Native Agent
isolation and worker transport remain separate work.

### §5.10 reviewed: Error Objects

The [Error Objects section](https://webassembly.github.io/spec/js-api/#error-objects)
defines `CompileError`, `LinkError`, and `RuntimeError` using ECMAScript's
[NativeError Object Structure](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-nativeerror-object-structure).
It explicitly states that Web IDL cannot express this behavior. Browlet keeps
the realm's native error constructors on the public namespace, including calls without `new`,
subclassing, message conversion, and `cause`; no additional binding is needed.
V8's `WasmJs::PrepareForSnapshot()` uses the same `InstallError()` helper in
`src/init/bootstrapper.cc` as its ordinary JavaScript error constructors.

The [error-object tests](../../../test/browlet/webassembly/error-objects.test.ts)
cover constructor/prototype descriptors, native Error identity, omitted messages,
inherited and primitive cause options, conversion order and abrupt completion,
subclasses, and cross-realm construction with a missing `newTarget.prototype`.
Real invalid modules, invalid imports, start traps, and exported-function traps
produce the correct realm's errors. Asynchronous rejection retains those errors,
and replacing the public constructors does not redirect native failures or the
adapter's existing duplicate-builtin check.

Validation on 2 November 2026: **21 tests pass in all six runtime configurations**,
with no new expected failures or spec clashes. Typechecking, focused lint, and
whitespace checks pass. Runtime code, addons, and engine patches are unchanged.
Generated types now describe these ECMAScript namespace properties through
`ErrorConstructor`, preserving call/new signatures without inventing Web IDL interfaces.

### §6 foundation and §§6.1.1–6.1.3 reviewed: Builtin selection, cast, and test

The [builtin algorithms](https://webassembly.github.io/spec/js-api/#builtins)
belong to the engine. Existing bindings convert `WebAssemblyCompileOptions` and
reject duplicate builtin-set names; native compilation selects the recognized
imports and validates their function signatures. The Module retains those
choices, and instantiation supplies builtin functions without consulting author
import getters. Unknown sets and unmatched names remain ordinary imports. No
additional runtime adapter is needed for this slice.

V8's `ValidateAndSetBuiltinImports()` in `src/wasm/module-compiler.cc` recognizes
`wasm:js-string` and compares canonical function signatures.
`InstanceBuilder::SanitizeImports()` supplies the selected functions.
`src/builtins/wasm-strings.tq` implements `cast` with a primitive-string check
and a `RuntimeError` trap, and `test` with a primitive-string check returning
zero or one. They do not call author conversion methods. `UnwrapString` is
covered through `cast`; §6.1.1's `FromCharCode` and `CharCodeAt` helpers are
covered by the array and scalar operations below.

The [builtin tests](../../../test/browlet/webassembly/builtins.test.ts) cover
constructor, asynchronous compilation, and byte instantiation; retained options;
exact name matching; disabled/unknown sets; invalid signatures; and ordinary
scalar/multi-result callbacks interleaved with builtin imports. Both direct
re-exports and calls from Wasm preserve string code units and reject nonstrings
without coercion. Native functions and trap errors retain their instantiating
realm. Replacing public `String` or `WebAssembly.RuntimeError` does not redirect
the builtin operations.

**SPEC_CLASH(wasm-nonfunction-builtin-import):** The draft's
[find a builtin](https://webassembly.github.io/spec/js-api/#find-a-builtin)
matches names without filtering import kind. Its subsequent type validation
therefore rejects `(import "wasm:js-string" "test" (global i32))` when
`builtins: ['js-string']` is enabled. V8's validation explicitly skips
non-function imports, so this remains an ordinary global import, visible in
`Module.imports()` and supplied by the author at instantiation.

Live comparisons on 2 November 2026 found Chromium 156.0.8078.4 accepts this
global at all four entry points (`validate`, `Module`, `compile`, and byte
`instantiate`); Firefox 157.0 and WebKit 27.2 reject it as the draft requires.
A correctly typed builtin control works in all three engines. Plain Node 26
without Browlet or the addon also accepts the global. Eric approved retaining
Chromium's behavior: the regression is an ordinary passing compatibility test,
with the disagreement recorded beside the test and native forwarding code.

**Connected through the engine:** [Instantiate a builtin set](https://webassembly.github.io/spec/js-api/#instantiate-a-builtin-set)
describes the internal export object consumed by builtin import lookup. The ESM
bridge already compiles with `builtins: ['js-string']` and the prescribed string
constant namespace; V8 supplies those imports without external module requests.
The [HTML graph test](../../../test/browlet/scripting/wasm-modules.test.ts) and
[addon test](../../../node-compat/test/wasm.test.cjs) cover that connection.
No separately exposed builtin-set object or second JavaScript implementation is needed.

Validation: **24 tests pass in all six runtime configurations**, with no ordinary
or expected failures in this suite. Typechecking, focused lint, and whitespace
checks pass. This slice changes tests and notes only.

### §§6.1.4–6.1.5 reviewed: String/array operations

[`fromCharCodeArray`](https://webassembly.github.io/spec/js-api/#js-string-fromCharCodeArray)
and [`intoCharCodeArray`](https://webassembly.github.io/spec/js-api/#js-string-intoCharCodeArray)
remain native. They operate on Wasm GC arrays with the canonical mutable `i16`
array type in its own recursive group. JavaScript arrays, typed arrays, proxies,
and incompatible Wasm array types cannot substitute for that reference. V8 owns
the array storage, reference conversion, bounds checks, and copying of UTF-16
code units; Browlet needs no additional binding or array representation.

The [32 string/array tests](../../../test/browlet/webassembly/string-arrays.test.ts)
exercise both direct re-exports and calls from Wasm: exact ranges, empty ranges,
supplementary characters and lone surrogates, untouched surrounding elements,
whole-range validation before writing, unsigned offsets and overflow, null and
wrong-type references, nonstring rejection without coercion, argument conversion
order, original conversion errors, and equivalent arrays from another realm.
Import validation rejects wrong element types, immutability, and a larger
recursive group even when the module is otherwise valid Wasm.

This also covers §6.1.1's `FromCharCode` and `CharCodeAt` helpers through the
array operations: replacing `String.fromCharCode` or `String.prototype.charCodeAt`
does not redirect them. The engine paths are `WebAssemblyStringFromWtf16Array`
and `WebAssemblyStringToWtf16Array` in `src/builtins/wasm-strings.tq`, with native
array checks and copying below those entry points.

Validation on 2 November 2026: **32 tests pass in all six runtime configurations**,
with no ordinary failures, expected failures, or new spec clashes. Typechecking,
focused lint, and whitespace checks pass. This slice changes tests and notes only;
there are no new integration dependencies. The ESM bridge's native compile options
supply the builtin import connection, as covered by the graph tests.

### §§6.1.6–6.1.14 reviewed: Remaining string operations

`fromCharCode`, `fromCodePoint`, `charCodeAt`, `codePointAt`, `length`, `concat`,
`substring`, `equals`, and `compare` remain native. V8 owns UTF-16 handling,
Wasm argument conversion, string checks, traps, and result allocation through
`src/builtins/wasm-strings.tq` and its runtime helpers. No new adapter is needed.

The [42 string tests](../../../test/browlet/webassembly/strings.test.ts) cover
direct re-exports and calls from Wasm: code-unit/code-point boundaries, lone
surrogates, unsigned offsets, invalid ranges, exact comparison without Unicode
normalization, nullable equality, and nonstring rejection without coercion.
They also check argument-conversion order, original author errors, trap recovery,
instantiating-realm errors, and independence from replaced public String methods.

**SPEC_CLASH(wasm-from-code-point-result):** [§6.1.7](https://webassembly.github.io/spec/js-api/#js-string-fromCodePoint)
declares a nullable `externref` result. Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2 all reject that signature and accept non-nullable `(ref extern)` in
live comparisons on 2 November 2026. Browlet retains their non-nullable signature,
matching the [original proposal](https://github.com/WebAssembly/js-string-builtins/blob/main/proposals/js-string-builtins/Overview.md).
WebKit deliberately corrected its signature in [PR #56362](https://github.com/WebKit/WebKit/pull/56362),
merged on 9 January 2026: these operations cannot return null. This evidence
suggests a stale draft signature; it does not establish an editor-confirmed erratum.

**SPEC_CLASH(wasm-substring-unsigned-offsets):** [§6.1.12](https://webassembly.github.io/spec/js-api/#js-string-substring)
first compares unsigned Wasm offsets, then passes them through `ToJSValue`,
which interprets `i32` as signed. Chromium and Firefox instead keep unsigned
offsets, as the original proposal explicitly specifies. For `"abcd"`, the live
comparisons above gave these results through both direct re-exports and Wasm calls:

| Start, end (JavaScript arguments) | Current draft | Chromium / Firefox | WebKit |
| --- | --- | --- | --- |
| `0, -1` | `""` | `"abcd"` | `""` |
| `1, 0x80000000` | `"a"` | `"bcd"` | `""` |
| `-1, 4` | `""` | `""` | `"abcd"` |

WebKit's signed-offset behavior is therefore not fully aligned with the draft
either. Browlet retains Chromium's unsigned behavior. Both approved choices are
ordinary passing compatibility tests with adjacent `SPEC_CLASH` comments.

Validation: **42 tests pass in all six runtime configurations**, with no ordinary
or expected failures in this suite. Typechecking and focused lint pass. This
finishes §6's operation review; the ESM bridge supplies the native builtin imports.

### §§7–8 reviewed: Error conditions and implementation limits

[Error mapping](https://webassembly.github.io/spec/js-api/#errors) remains native.
The [error-condition tests](../../../test/browlet/webassembly/error-conditions.test.ts)
check JavaScript/Wasm stack-overflow class agreement, the exported function's
error realm, state changes surviving a trap, and exact imported-exception identity
including non-Error values. Each failure is followed by a successful call on the
same instance. V8's `Runtime_ThrowWasmStackOverflow()` delegates to the ordinary
`Isolate::StackOverflow()` path, producing a native `RangeError`.

§7.2 permits process-fatal out-of-memory behavior. Browlet cannot promise recovery
from exhausted native resources in its shared Node process. This review does not
deliberately exhaust the heap or allocate multi-gigabyte memories. Existing
Memory/Table tests cover deterministic failed growth and preserved storage.

[§8's limits](https://webassembly.github.io/spec/js-api/#limits) are enforced by
V8's `src/wasm/wasm-limits.h`, module decoder, and function-body decoder. The
[limit tests](../../../test/browlet/webassembly/limits.test.ts) check valid and
invalid boundaries for parameters, results, locals including parameters, struct
fields, `array.new_fixed` operands, subtype depth, declared memory32 pages, and
initial table entries. Excessive signatures also reject asynchronously with
`CompileError`. Modules are compiled without instantiating their large declared
storage. Large module/body byte limits and million-entry counts were reviewed in
source rather than tested by resource-heavy allocations.

Two differences were reproduced in Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2 on 2 November 2026, using tiny modules and no memory instantiation:

| Declaration | Current draft | Chromium / V8 | Firefox / WebKit |
| --- | --- | --- | --- |
| 101 memories, each initially empty | Reject above 100 | Accept; V8's cap is 100,000 | Reject |
| memory64 maximum above 262,144 pages, initial zero | Permit up to 2^37 − 1 pages | Reject above 262,144 pages (16 GiB) | Accept through the draft maximum |

**SPEC_CLASH(wasm-module-memory-count):** Retain Chromium's higher memory count.
**SPEC_CLASH(wasm-memory64-declaration-limit):** Retain V8's restriction on
declarations as well as runtime allocation. Both approved choices have ordinary
compatibility tests and nearby comments. The memory64 difference concerns
validation, not allocating more than 16 GiB. The separate discussion in
[spec issue #1892](https://github.com/WebAssembly/spec/issues/1892) concerns
raising actual runtime storage limits and does not resolve this declaration gap.

**SPEC_CLASH(wasm-growth-limit-errors):** §8's blanket `RuntimeError` wording
conflicts with the specific JavaScript `Memory.grow()`/`Table.grow()` algorithms
(`RangeError`) and Wasm growth instructions (failure result `-1`). §7.2 itself
acknowledges those alternatives. Retain the specific behavior already covered by
the [Memory](../../../test/browlet/webassembly/memory.test.ts) and
[Table](../../../test/browlet/webassembly/table.test.ts) tests; do not remap it.

Validation: **15 tests pass in all six runtime configurations**, with no ordinary
or expected failures in these suites. Typechecking and focused lint pass. This
slice adds tests and documentation only. Subsequent slices complete native interface
declarations, ordinary ESM loading, streaming, and same-isolate serialization.

### §§9–10 and closing material reviewed

[§9](https://webassembly.github.io/spec/js-api/#security-considerations) is
non-normative. The engine obtains host facilities through supplied imports;
`WasmModuleImpl.#adaptImports()` preserves native lookup and only adapts callable
function imports for the existing HTML script/callback lifecycle. CSP's separate
compilation policy is now connected through JS Engine and the addon; stock mode
checks Browlet's entry points. Worker isolation and shared-process resource limits
remain open.

[§10](https://webassembly.github.io/spec/js-api/#change-history) is non-normative
release history. Existing exported-function, Global, and Table tests cover
multi-value results, BigInt, and reference values; the §6 suites cover string
builtins. Three additional [Instance export tests](../../../test/browlet/webassembly/instance-exports.test.ts)
combine two memories, two tables, and an interleaved JavaScript callback through
constructor, Module, and byte instantiation. They verify import/export identity,
independent state, indexed Wasm access, and the callback adapter together.

The closing conformance text permits equivalent implementations, which supports
retaining native algorithms; accepted observable differences still need their
`SPEC_CLASH` records. The term/reference indexes add no separate algorithms.
The IDL index repeats earlier declarations, and the issues index repeats §7.2's
allocation-failure alternatives. Comparing that IDL index with `webassembly.ts`
and generated `platform.d.ts` identified the following declarations, now completed:

| Native surface already available at runtime | Completed generated declarations |
| --- | --- |
| Module metadata | `imports()`, `exports()`, `ImportExportKind`, and their descriptor dictionaries |
| Instance | `exports` |
| Memory | `grow()`, buffer conversion methods, and `buffer`; retain Node 24's documented capability gap |
| Table and Global | Table `grow/get/set/length`; Global `valueOf/value` |
| Exception | `getArg()`, `is()`, and `stack` |
| Native errors | `CompileError`, `LinkError`, and `RuntimeError`, defined through ECMAScript rather than IDL |

The initial declaration follow-up used `retainNative` for native attributes and
operations. The migration now uses ordinary binding for every interface except
Exception, whose `stack` remains retained and whose operations unwrap public Tags.
Memory buffers include the threads proposal's `SharedArrayBuffer` possibility;
Node 24's missing engine conversion operations remain explicit expected failures. ECMAScript error properties use the generator's
namespace supplement with `ErrorConstructor`, rather than fictitious Web IDL interfaces.
`[LegacyNamespace=WebAssembly]` remains intact. No addon or engine patch is needed.

Declaration follow-up validation on 2 November 2026: the Wasm/native-interface/HTML
module suites pass in all six configurations. Custom/compat and Node 26/compat
report **529 passed, 4 expected failures**; Node 24/compat reports **525 passed,
8 expected failures**. Custom/stock and Node 26/stock report **493 passed,
11 expected failures**; Node 24/stock reports **489 passed, 15 expected failures**.
All **706 Web IDL tests** pass on custom/compat. Generated-type freshness, project
typechecking, all type contracts, focused ESLint, and whitespace checks pass.
No expected-failure classification changed.

The earlier Instance export suite has **10 passing tests in all
six configurations**, including the three new cases, with no ordinary or expected
failures. Typechecking and focused lint pass.

The next document is the Web API, from §1 into streaming compilation. CSP,
Fetch/body/task integration, Module serialization, HTML Wasm loading, ESM binding
gaps, and native Agent isolation retain their owners in the tables below.

## 2. Web API

| Sections, in order | Browser work |
| --- | --- |
| §1: introduction | Confirm the JavaScript API prerequisites identified above. |
| §2: streaming compilation and instantiation | Bind `compileStreaming()` and `instantiateStreaming()` to Browlet `Response` objects. Enforce the specified header, CORS-same-origin, status, and body checks; pass compile options to the engine and deliver results on the required task source. The specified whole-body consumption model is sufficient initially. |
| §3: serialization | Native Module cloning is connected to structured data, including storage rejection, target-realm allocation, exposure preflight, and agent-cluster restrictions. Cross-isolate worker transport remains a separate integration. |
| §§4–7 and conformance/reference material | Reviewed below. Native names/locations and streaming Response URLs are connected, retaining Chromium's diagnostic cache behavior. MIME handling, native-member declarations, and CSP compilation checks are connected; worker isolation remains a dependency. |

### §§1–2 implemented: streaming compilation and instantiation

The introduction builds on the reviewed JavaScript API. A separate Web API
partial namespace now binds `compileStreaming()` and `instantiateStreaming()`
to the existing `WasmImpl`. Web IDL supplies an internal Promise of a
converted `ResponseImpl`; its internal headers, filtered response type, status,
and body drive the algorithm, without consulting replaceable author properties.

The methods enforce the exact `application/wasm` header rule (ASCII case and
surrounding HTTP tabs/spaces are accepted; parameters are not), CORS-same-origin
eligibility, and ok status before consuming the body. Fetch owns locked/disturbed
body rejection and stream errors. Whole-body consumption follows the specified
model; incremental compilation is not required for this implementation.
Native compilation, option handling, Module Promise adoption, and the shared
instantiate-a-promise-of-a-module path preserve the earlier callback work.

The addon completion callback now also supplies the original Promise. JS Engine
retains a weak per-Promise task-source association, with a call-scoped source for
V8 failures reported before `compile()` returns. HTML delivers response compilation
on networking and ordinary compilation/instantiation on the engine source, before
the first author `then` lookup. No Node/V8 patch was needed. The same Document
activity/destruction rules apply to both sources. Stock mode still lacks this
native task handoff and keeps its documented automatic scheduling behavior.

The [streaming suite](../../../test/browlet/webassembly/streaming.test.ts) covers
Responses from Fetch, promises/thenables, filtered views, chunked and unusable
bodies, error identity, converted compile options, imported callbacks, cross-realm
results, Module thenables, and independent native completion sources. CSP's Wasm
compilation policy is now connected; worker startup/isolation remains a dependency.
Subsequent slices complete native-member declarations, §3 serialization, and ordinary ESM loading.

Validation: **32 streaming tests pass in all six configurations**. The wider
103-case compilation/instantiation/callback/completion selection passes on every
addon base; stock configurations retain seven existing expected callback failures
(96 passing). All three addons were rebuilt. Their full native suites pass:
375 on each official base and 374 with one existing installer skip on custom.
Typechecking, focused lint, and diff checks pass. No new expected failures were added.

### §3 implemented: Module serialization

`Module` now carries the Web API's `[Serializable]` augmentation. HTML's existing
structured-data traversal recognizes Module implementations and explicitly
accepted raw native host Modules. Constructor, compiler, and streaming results
are ordinary platform objects; deserialization always projects an implementation.
Storage serialization throws `DataCloneError`. Records use the serializing realm's
AgentCluster; deserialization checks the destination cluster and Module exposure.
Message preflight includes `Module` before consuming any receiving transfer holders.
Modules remain non-transferable.

**Review choice:** Modules use a dedicated native graph record, like shared buffers.
Ordinary interface `serialSteps` allocate an empty implementation and then restore
its fields, which cannot initialize immutable native Module slots. The record
retains a fresh host Module as a compiled-code token instead of separately saving
the wire bytes. This uses the draft's allowed compiled-code reuse and preserves
compile options, builtin selection, and imported-string constants. Taking that
snapshot drops author expandos and avoids retaining the source Module object.
Repeated references share one clone within a graph; separate deliveries create
distinct objects.

JS Engine's `cloneWebAssemblyModule()` allocates in the target realm. The addon
uses public V8 `GetCompiledModule()` / `FromCompiledModule()`; stock Node uses the
same temporary, synchronously received MessagePort path as shared-buffer cloning.
Neither path reads author constructors or changes prototypes after allocation.
Deserialization wraps the fresh native result in `WasmModuleImpl` and projects its
platform object through the destination binding. The former native-object
argument to `createPlatformRecord()` is removed. No Node/V8 patch was needed.

The [serialization tests](../../../test/browlet/webassembly/serialization.test.ts)
cover public cloning and MessagePort delivery, preserved code/options, graph
identity, ignored author properties, target ownership, storage/cluster/exposure
rejection, receiving preflight, and non-transferability. All **11 tests pass in
all six configurations**. The 182-case clone/binding/buffer/message selection has
182 passes on custom/addon and 180 passes plus two existing expected failures on
each other configuration. No new expected failures were added.
All three full native suites pass: 378 tests on Node 24/26, and 377 passes plus
one existing skip on the custom build. Typechecking and affected-file lint pass.

The compiled token is an in-process representation. Real worker transport across
isolates and HTML Wasm/ESM loading remain explicit dependencies. This slice stops
before §4's developer-facing display conventions.

### §§4–7 and closing material reviewed

[§4](https://webassembly.github.io/spec/web-api/#conventions) is non-normative:
it recommends understandable function names, decimal function indices, and
hexadecimal instruction offsets, while leaving the full stack-string format to
engines. The [display tests](../../../test/browlet/webassembly/display.test.ts)
verify the native components with absent, module-only, function-only, and combined
name subsections. The imported function occupies index 0, so the trapping export
is index 1; `0x2e` is its instruction offset in the complete binary. Diagnostic
names do not change the exported function's numeric JavaScript `name`. Asynchronous
compilation and Module cloning preserve those names and offsets.

**Connected diagnostic attribution:** after validating and consuming the Browlet
Response, `compileStreaming()` supplies its internal URL with the private bytes
to the realm's captured native streaming compiler. `instantiateStreaming()` uses
the same path. Fresh compilations now retain the fetched URL in trap stacks;
Module cloning retains that attribution. This repairs a browser connection,
without changing the native execution or introducing an addon/engine patch.

On 2 November 2026, the same tiny named module fetched from a `data:` URL produced:

| Native path | Diagnostic frame |
| --- | --- |
| Node 24, Chromium 156.0.8078.4, Firefox 157.0 | Includes the fetched URL, `wasm-function[1]`, and `0x2e` |
| WebKit 27.2 | `crash@diagnostics:wasm-function[1]`; omits the fetched URL and byte offset |
| Browlet's connected path | Includes the fetched URL, native name, index, and offset |

**SPEC_CLASH(wasm-cached-source-url):** V8 and Chromium cache a diagnostic script
for identical bytes. If byte compilation happened first, later streaming retains
the generated Wasm URL. If one URL was streamed first, identical bytes loaded from
another URL retain the first URL. Firefox preserves each streaming URL; WebKit's
named-module frames still omit it. These cases were reproduced with a local HTTP
server in the same browser versions above. Eric approved preserving Chromium's
cache behavior; the two regressions are ordinary compatibility tests. Fresh-URL
tests use distinct bytes so they exercise attribution rather than this cache.

**ACCOMMODATION(node-wasm-response-url):** Node requires its own Response brand.
The adapter creates a private Node `Response` from the already-consumed bytes and
defines its URL as an own property, since that constructor has no URL option.
Node's callback forwards the property to V8's public `WasmStreaming::SetUrl()`.
This adds a Response/body copy and Node's body consumption, but no second fetch;
the object never escapes to author code. Header/CORS/status validation remains
with Browlet, and the existing native Promise identity selects networking
completion. Direct byte compilation keeps its previous path.

Node streaming creates malformed-byte `CompileError`s in Node's realm, even when
invoked from another VM/addon context. The rejection handler realizes those
failures in the requested realm at the private compiler boundary, before
projecting or resolving a public Module. Author `then` rejections therefore
remain separate and retain their identity without revalidating the input bytes.
Source and body rejections never enter that correction. On success, compilation
resolves the streaming API's existing Promise directly; no intermediate public
Module Promise causes a second thenable lookup.

All **10 display and 35 streaming tests pass in all six configurations**. The
broader 95-test compilation/instantiation/cloning/ownership selection also passes
in all six, with no ordinary or expected failures. Typechecking and affected-file
lint pass. No addon source or build changed.

Relevant local sources are Node's `lib/internal/wasm_web_api.js`
(`streamState.setURL(response.url)`) and `src/node_wasm_web_api.cc`, plus V8's
`include/v8-wasm.h` and shared `AsyncCompilationResolver` in `src/wasm/wasm-js.cc`.

[§5](https://webassembly.github.io/spec/web-api/#mediaType) registers
`application/wasm`, no parameters, the `.wasm` extension, and binary magic
`00 61 73 6d`. It adds no MIME-sniffing fallback. The existing streaming suite
already checks exact header eligibility, case/HTTP whitespace, rejected
parameters and missing/wrong headers, and invalid-binary `CompileError`s.

[§6](https://webassembly.github.io/spec/web-api/#security-considerations) is
non-normative. Wasm uses supplied imports and native objects; this review adds no
ambient filesystem, network, UI, or persistence access. Fetch owns response
filtering, CORS, transport, and delivery policy. The streaming tests cover opaque
response rejection, while the serialization tests reject Memory and other
non-serializable native objects. CSP's separate Wasm compilation check is now
connected. Native isolation between modeled Agents/worker threads remains an
explicit dependency identified in the JavaScript API closing review.

[§7](https://webassembly.github.io/spec/web-api/#change-history) records completed
MIME registration. The closing conformance text permits equivalent algorithms;
the indexes/references add no further algorithms. The IDL index repeats the two
streaming operations already declared in the partial namespace. §3's Serializable
augmentation is explicit on Module, although it is prose rather than a separate
IDL fragment in that index. The native-member declaration follow-up and ESM loader
connection are recorded in their own slices.

## 3. ES-module integration

### ESM opening review: sections 1 through 5

Reviewed the refreshed ESM source from the introduction through the namespace,
before §5.1 Modules. §§1–4 are textually identical to the main JavaScript API;
the previous store/cache audit and native-isolation dependencies still apply.
§5 factors builtin/string import preparation and import-value reading into shared
algorithms for the later ESM consumer. Native instantiation and the existing
browser import adapter still own the direct JS API path; no second Wasm store,
cache, or binary-instantiation implementation is needed.

`SPEC_CLASH(wasm-esm-option-defaults)`: the ESM fork omits the main JS API's
`null`/`[]` compile-option defaults while continuing to read those dictionary
members unconditionally. Retain the reviewed main-spec defaults. Other core
notation and link-markup differences do not call for changing V8 semantics.
The added Module `[[ModuleRecord]]` association starts absent for ordinary JS
compilation; source-to-record lookup remains §10.6 work. Do not infer it merely
from a native Module or its exported values.

`WebAssembly.namespaceInstance(namespace)` is now bound and returns the existing
Instance behind a bridge-owned Wasm namespace. The addon registers the actual
namespace at linking, including dependencies left linked after a parent error.
Lookup neither reads author properties nor evaluates the module. Proxies,
forgeries, `instance.exports`, ordinary JavaScript namespaces, and synthetic
namespaces are rejected. A weak namespace-to-record association preserves the
Instance after the public module wrapper is collected; separate instantiations
of identical bytes remain separate. No C++ addon, Node, or V8 change is needed.

`SPEC_GAP(wasm-namespace-before-execution)`: §5 returns `[[Instance]]`, whereas
§10 initializes that slot to `~empty~` until execution. Cyclic graphs and host
namespace access can expose the namespace earlier. There is no specified JS
result for that state. The provisional choice is an invoked-realm ReferenceError,
without beginning evaluation; normal lookup succeeds once the Instance exists.
On 2 November 2026, Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2 all
reported `typeof WebAssembly.namespaceInstance === "undefined"`, so they supply
no behavior oracle for this gap. This choice is for review, not a claimed browser
consensus. The exact algorithm is in
[§5](https://webassembly.github.io/esm-integration/js-api/#dom-webassembly-namespaceinstance)
and the empty slot in
[§10](https://webassembly.github.io/esm-integration/js-api/#parse-a-webassembly-module).

Integration boundaries remain explicit:

- The opening slice tested real namespaces directly from the native bridge.
  HTML's parser and ordinary fetched Wasm graph connection are now covered by
  §10 below; script-element startup remains a separate HTML consumer.
- Stock Node exposes neither a public Wasm VM record nor the namespace/Instance
  association. Namespaces from Node's own filesystem loader are also outside the
  bridge registry; export inspection cannot distinguish Wasm from JS re-exports.
- Graph instantiation now uses HTML callback preparation as described in §10
  below. The bridge's default native constructor remains appropriate only for
  standalone hosts without that browser lifecycle.
- Module-source reflection is verified below. Source-to-record association
  remains deferred §10.6 work; current binding limitations are catalogued below.

The new namespace tests cover the browser binding on all six runtime modes,
with real Wasm namespace/Instance identity and pre-execution checks on the three
addon modes. Native tests separately cover imports, parent-link failure,
cross-context identity, spoof/proxy rejection, and collection. The standalone
JS API fixture now excludes the streaming partial namespace, whose Response
dependency belongs to browser Fetch integration; its existing assertions remain.
The focused namespace/standalone selection passes **31 tests per addon mode** and
**29 per stock mode** across Node 24, Node 26, and the custom build. Full native
suites pass **384 tests** on both official bases and **383 with one existing
installer skip** on custom. Existing expected-failure assertions retain their
classification. Typechecking, focused lint, and whitespace checks pass.

### ESM §§5.1–9: source objects and repeated JavaScript API material

[§5.1 Modules](https://webassembly.github.io/esm-integration/js-api/#modules)
adds two prototype links: `WebAssembly.Module` inherits from
`%AbstractModuleSource%`, and `WebAssembly.Module.prototype` inherits from that
intrinsic's prototype. Browlet's binding integration installs those links on
the generated Module constructor and platform prototype. It also extends the
intrinsic's source-kind getter to recognize Module implementations by their
existing Binding records. The [Source Phase Imports proposal](https://tc39.es/proposal-source-phase-imports/)
defines the intrinsic without a global name, rejects direct calls/construction,
and supplies a `Symbol.toStringTag` getter that recognizes actual source objects.
The intrinsic itself remains engine-owned; no addon or engine patch is needed.

The [source-object tests](../../../test/browlet/webassembly/module-source.test.ts)
cover those links and descriptors, platform identity despite author prototype/tag
changes, rejection of forgeries/proxies without author callbacks, subclassing,
cross-realm intrinsic/error ownership, and Modules from construction, compile,
instantiate, streaming, and structured cloning. All eight pass on Node 24,
Node 26, and custom, with and without the addon. This verifies reflection; it
did not itself connect HTML source-phase imports. The URL-import slice below
now supplies those; the `[[ModuleRecord]]` object-valued lookup remains deferred.

On 2 November 2026, the installed Chromium 156.0.8078.4, Firefox 157.0, and
WebKit 27.2 did not expose this source-object prototype chain under their default
settings. V8 gates its installation on `js_source_phase_imports`; Node's startup
enables that flag, and all six selected runtime modes supply the required chain.
Retain the working native behavior rather than imitating the browsers' absent
feature. Browser feature availability is separate from Node's capability.

The rest of the document through §9 was compared with the already reviewed main
JavaScript API at the source revisions above:

| Section | ESM difference and disposition |
| --- | --- |
| §5.1 reflection | `Module.imports()` factors out the core external-import list, still excluding builtin/string imports. Keep native reflection; the factored helper's module-record consumer belongs to §10. |
| §§5.2–5.10 | Existing constructors, native members, conversions, and caches retain the earlier review. Differences in address/type/limit notation and completion assertions do not introduce a new browser operation. The exposure conflict below is the observable declaration difference. |
| §6 builtins | Same builtin operations/signatures, with markup/assertion changes. The native ESM compile options supply builtin/string imports; the HTML and addon graph tests cover that consumer. Retain the earlier tests and accepted clashes. |
| §§7–9 | Error conditions, implementation limits, and security text are unchanged; reuse the preceding audit and tests. |

`SPEC_CLASH(wasm-esm-exposure)`: the ESM fork declares Tag and Exception only for
Window, Worker, and Worklet, while the main JavaScript API uses `Exposed=*`.
Keep the already reviewed main-spec declaration, including standalone hosts.
This does not implement worker/worklet startup. Source-phase URL loading is now
connected below; deferred loading and the remaining native binding limitations
remain open. Repeated text does not close those dependencies.

This slice changes tests and explanatory comments only. Typechecking, focused
lint, and whitespace validation pass; no failure classification changes.

### ESM §10 opening: parsed Wasm records in HTML

`BrowletRealm.parseWebAssemblyModule()` now delegates byte compilation to
`JSRealm.compileWebAssemblyModule()` and the existing addon record. The source
copy, fixed `js-string`/`wasm:js/string-constants` options, external-import
filtering, and reserved import/export name checks remain in that bridge. Native
CompileError and LinkError reach the HTML script's `parseError`; missing backend
facilities remain explicit InternalErrors rather than invalid-source failures.
Disabled scripting still substitutes the empty module before compilation.

`JSWasmModuleRecord` retains the compiled record, owning realm, exact
HTML script, and dependency requests. The draft's set of module-name strings is
represented as HTML's existing `JSModuleRequest` records, with empty attributes
and evaluation phase. The backend preserves
first-occurrence order and hides its private instantiation helper. No second
source-object registry or duplicate binding implementation is introduced.

The addon's optional `createInstance(module, imports)` callback lets HTML enter
the exact Wasm record and call `WasmModuleImpl.createInstance()`. That entry
supplies the missing modeled module context while imports are adapted and start
runs. The first integration regressions exposed an empty incumbent stack without
it; successful/throwing result conversion and delayed instantiation after an
awaited dependency now retain the callback scope and unwind it. The standalone
addon default still uses its captured native constructor. Only JavaScript addon
code changed; no native rebuild or Node/V8 patch is required.

The [HTML record tests](../../../test/browlet/scripting/wasm-modules.test.ts)
cover source-copy/realm/URL ownership, request order/deduplication, builtin/string
imports, parse failures, disabled scripting, start timing, callback cleanup, and
a fetched JS → Wasm → JS graph through the existing HTML loader. Source-phase
support was added in the later URL-import slice below. Deferred imports,
`import(moduleObject)`, and the known native binding limitations remain separate.

Stock mode has no public Wasm VM class, so this parser requires the addon on all
three bases. The fifteen new integration cases pass on Node 24, Node 26, and
custom with the addon; stock tests retain the explicit capability failure while
ordinary JS module loading continues to pass. The selected HTML/engine module
suites report 132 passes plus one existing import-meta expected failure on both
official addon bases, 133 passes on custom/addon, and 119 passes per stock mode.
The complete native addon suites pass on all three bases (386 each on official
Node; 385 plus the existing installer skip on custom, including existing
expected-failure checks). Typecheck, import lint, changed-code lint, and whitespace
validation pass. No expected-failure classification changed.

### ESM §§10.1–10.5: module-record methods

The existing source-text/synthetic bridge delegates module environments and
bindings to V8. No duplicate HTML `ResolveExport` or environment implementation
is needed. The retained-record tests now cover the following:

| Method | Owner and evidence |
| --- | --- |
| `GetExportedNames` / `ResolveExport` | The bridge generates one export per Wasm export; V8 resolves names and re-exports. Tests cover arbitrary/default names, identical-binding diamonds, missing/ambiguous exports, and imports that must not leak as exports. |
| `GetModuleSourceKind` | The backend supplies a retained Module source to V8 and rejects other module kinds. HTML now projects its WasmModuleImpl through the optional `getSource` callback; default addon clients keep the native source. Static/dynamic imports retain identity without evaluation. |
| `InitializeEnvironment` | V8 creates immutable bindings before evaluation. Tests read them in the importing realm, check their initial TDZ, and retain the same namespace after initialization. |
| `ExecuteModule` | V8 supplies dependency order and native instantiation; HTML supplies callback lifecycle. Tests cover mixed cycles, direct mutable-global/memory identity, import matching, and one-time start with retained thrown/trapping failures. |

The new mixed-cycle regression found a Browlet bug: `#adaptImports()` used Node's
`Reflect.get` to read an uninitialized binding, producing a Node ReferenceError.
Both import reads now use the already captured `env.realm.reflectGet`. Native
property failures belong to the instantiating realm; author-thrown values remain
unchanged. This is a two-call-site TypeScript fix, with no addon or engine change.

`SPEC_CLASH(wasm-esm-import-subtyping)`: [ESM §10.5](https://webassembly.github.io/esm-integration/js-api/#module-execution)
tests import-type <: export-type, but its own closing note requires JS API
semantics, whose native instantiation checks the supplied type against the
required type. [Core limits matching](https://webassembly.github.io/spec/core/valid/matching.html#limits)
requires the supplied minimum to be at least the requested minimum. Keep native
Core/JS API matching: supplying two pages for a one-page import succeeds; one
page for a two-page import fails with LinkError. These are ordinary Core
conformance checks; no extra reversed check is added from the contradictory line.
Native JS API probes on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2
agree: an exported two-page memory satisfies one- and two-page imports, retains
identity, and rejects a three-page import with LinkError. This checks native
matching, not those browsers' full ESM proposal support.

This review reproduced three binding gaps in the addon and Node's independent
loader. The later guarded binding-identity integration below repairs re-exports
in the addon. Public V8 APIs expose neither
Wasm-global mutation notifications nor resolved binding identities; synthetic
export setters alone cannot provide those requirements. The generated `const`
bindings also cannot remain in TDZ after successful evaluation for inaccessible
global types (`v128`, and the draft's `exnref` case). Keep these as backend
dependencies; no partial replacement of the module implementation is introduced.

Validation: the final HTML record suite has 28 passing cases on each addon base,
including 13 added here. The affected eight-suite selection passes across all
six configurations, retaining one existing expected failure per addon mode and
eight per stock mode. The native Wasm suites pass 24 ordinary cases and the six
existing expected-failure checks on each base. Typecheck and changed-code lint
pass; no expected-failure classification changed.

### ESM §10.6: reviewed; implementation deferred

Decision (2026-11-02): defer [HostGetModuleSourceModuleRecord](https://webassembly.github.io/esm-integration/js-api/#hostgetmodulesourcemodulerecord)
and author `import(moduleObject)`. The unconnected implementation and its
feature-specific tests were rolled back: only tests reached the new lookup;
existing fetched Wasm graphs did not need its registry or script-less records.

V8 converts an import operand to a string before calling Node or the addon
(`RunHostImportModuleDynamicallyCallback`, `src/execution/isolate.cc`). In-memory
probes confirmed this on Node 24.19.0, 26.8.1, custom 27, Chromium 156, Firefox
157, and WebKit 27.2. A Node-only or addon-only change cannot recover the object.
The [Source Phase Imports draft](https://tc39.es/proposal-source-phase-imports/)
still specifies string conversion. Object-valued imports belong to the newer
[Stage 2.7 ECMAScript Module Phase Imports proposal](https://tc39.es/proposal-esm-phase-imports/),
which also replaces this hook with `HostGetModuleSourceRecord` and a different
record model. Treat this as a proposal/engine dependency, not a V8 conformance bug.

Keep existing engine behavior; no V8 patch is planned. Revisit when the drafts
are reconciled and the engine supplies the needed boundary. Ordinary fetched
Wasm graphs, native source reflection, and namespace lookup remain implemented.
Source-phase URL imports are connected below. Deferred-phase loading and the
known binding limits remain separate.

### HTML source-phase URL imports

HTML's existing resolver, import maps, Fetch policy/MIME checks, and module map
now handle `import source code from "./module.wasm"` and
`import.source("./module.wasm")`. This follows the
[Source Phase Imports graph algorithms](https://tc39.es/proposal-source-phase-imports/#sec-InnerModuleLoading):
source requests load one record without traversing dependencies, linking, or
evaluating it. A later ordinary import traverses that same cached record normally.
The loader carries the request phase directly instead of a separate single-load
versus recursive-load enum. Source imports of JavaScript records fail with a
realm-owned SyntaxError; Fetch and compile failures keep their existing paths.

JSWasmModuleRecord retains one WasmModuleImpl as `moduleSource`; it also uses that
implementation when eventually instantiating. The addon's optional `getSource()`
callback projects this implementation through existing Binding. No new Web IDL
machinery or native-object adoption is needed. The private C++ source linker now
accepts an object rather than requiring V8's private Wasm brand, matching V8's
public source-resolution callback. It still rejects compiled evaluation handles;
the public addon linker still requires a WebAssemblyModule dependency. Existing
addon callers receive the native `.source` unless they provide the callback.

The [HTML source-import tests](../../../test/browlet/scripting/wasm-source-imports.test.ts)
and [record test](../../../test/browlet/scripting/wasm-modules.test.ts) cover public
Module identity and manual instantiation, both mixed-phase request orders,
later evaluation, an earlier evaluation failure, import maps, MIME/fetch/compile
errors, compilation CSP, and the dynamic continuation. Author dynamic-import
tests cover static/dynamic identity, a missing ModuleSource, and exactly one
Promise thenable adoption while static imports do not consult `then`.

Static source imports work on Node 24/26/custom with the addon. Dynamic source
imports work on custom/compat and retain the same official-addon forwarding
limitation as ordinary `import()`. Stock mode still lacks the Wasm VM record
class; its boundary is tested explicitly. No Node or V8 patch is required.
This does not enable object-valued `import(moduleObject)` (§10.6), deferred
imports, or repair ESM binding limitations. The subsequent binding-identity work
below repairs one of those limitations. Script-element and
worker/worklet startup remain separate HTML consumers: this work connects the
existing graph-loading entry points, not those unfinished startup algorithms.

Validation: the 45-file Wasm/module selection passes across all six configurations,
with known runtime limitations retained as expected failures. The three new author
dynamic-import cases use the existing official-addon capability gate. All three
native addon suites, typecheck/type contracts, import lint, and changed-code lint
pass. No ordinary failures remain in this selection.

## Dependencies and integration gates

| Dependency | Available foundation and remaining gate |
| --- | --- |
| [Fetch](../../fetch/ROADMAP.md) | Response records, headers, CORS filtering, body consumption, and cancellation exist. Use them directly; Node's own Response acceptance does not establish support for Browlet Responses. |
| [Scheduling](../scripting/EVENT-LOOP-ARCHITECTURE.md) | All addon bases deliver native completion through the owning HTML task and Document lifetime, selecting networking for response compilation. Stock mode supplies automatic progress without HTML task ownership. |
| [CSP](../browsing/policy/csp/ROADMAP.md#wasm-compilation-consumer-451) | §4.5.1 is connected: live policy/reporting, realm-correct CompileError, browser byte/response APIs, and native entry points/HTML Wasm parsing on all addon bases. Stock Node checks Browlet's entry points only. No Node/V8 patch; Node's own checks remain intact. URL/Fetch policy remains separate; worker startup and global violation reporting retain their owners. |
| [Structured data](../scripting/structured-data/ROADMAP.md) | Module graph serialization/deserialization, target-realm cloning, storage rejection, cluster checks, and MessagePort delivery are implemented in Web API §3. Cross-isolate worker transport remains a separate dependency. |
| [Module loading](../scripting/module-loading.ts) | Ordinary fetched Wasm graphs and source-phase URL imports are connected. Static source imports need the addon; dynamic source imports also need the existing forwarding export. Deferred phases remain throwing boundaries. §10.6 source-object lookup and `import(moduleObject)` are reviewed and deferred above. |
| [Workers](../workers/ROADMAP.md) and native isolation | Worker startup, cross-thread transport, and correspondence between modeled Agents and native execution domains remain separate dependencies. Window integration can proceed; its tests do not certify cross-agent Wasm behavior. |

## Known ES-module binding limitations

The maintained [addon gap suite](../../../node-compat/test/wasm-gaps.test.cjs)
and independent [Node controls](../../../node-compat/test/wasm-node-gaps.test.cjs)
retain the required assertions. They concern ES-module bindings, not
ordinary `WebAssembly.Global` access through the JavaScript API.

| Required behavior | Recorded limitation |
| --- | --- |
| Mutable Wasm globals remain live in JavaScript imports | The exported binding retains its initial value after Wasm changes the global. |
| `v128` exports remain uninitialized | Access returns `undefined` instead of throwing `ReferenceError`; other exports remain usable. |
| A Wasm global re-exported through JavaScript retains its native binding | Fixed on reviewed Windows x64 addon builds by the guarded lookup below. Unknown builds and Node's own loader retain the LinkError. |

The live-JavaScript-global and permanent `v128` TDZ assertions remain approved
expected failures. Recovering a native v128 Global for a Wasm consumer does not
fix reading that export from JavaScript. Node's independent loader still fails
all three requirements.

### Guarded native-global re-exports

`vm-module-bindings.cc` compares V8's resolved binding Cells without reading
their values. This is explicitly a **private-layout hack**, pinned at compile
and runtime to the engines listed in the [addon contract](../../../node-compat/README.md#webassembly-modules).
No startup self-test or Node/V8 patch is added. Unknown builds keep the old
limitation; a same-version custom layout change still requires manual review.

`vm-modules.cjs` retains supplied dependency records after linking and assigns
one optional resolver. Its companion `vm-module-bindings.cjs` owns enablement and
the evaluation-edge search for a matching Wasm export, including through
previously linked barrels and parent-link failures, with no context-wide registry.
Removing the assignment restores the ordinary namespace-value fallback.
`vm-wasm.cjs` passes the original native Global to the consumer. V8 continues to
resolve aliases, star exports, ambiguity, and cycles. Equal-valued copies do not
qualify. The existing HTML instantiation adapter needs no production change.
The [re-export suite](../../../node-compat/test/wasm-reexports.test.cjs) exercises
identity, TDZ, invalid inputs, collection, worker initialization, and fallback;
the [HTML suite](../../../test/browlet/scripting/wasm-modules.test.ts) covers the
full browser record path. Large-graph lookup performance remains unmeasured.

Validation on Node 24.19.0, 26.8.1, and custom 27.0.0-pre: the five native/module
suites pass 61 ordinary cases and retain five expected-failure checks (two addon
gaps and three independent Node controls) per configuration. The HTML record
suite passes 32 cases on each addon base; stock mode passes its explicit missing
Wasm-record boundary. Typechecking, focused lint, and whitespace checks pass.
The lifetime regression uses the same cache-flushing GC step as the existing
Wasm collection tests before asserting the graph is collectible.

## Validation and next review

The Module-constructor slice has **15 passing constructor tests** across all six
runtime configurations. The WebAssembly/native-interface selection reports
**114 passed and 4 existing expected failures**; the broader custom/addon run of
all Web IDL and WebAssembly suites reports **792 passed and 4 expected failures**.
Typechecking, declaration contracts, focused lint, and whitespace checks pass.
No expected-failure classification changed. Earlier slice results follow for context.

The preceding JSTag review's WebAssembly, Module/Tag-recognition, native-interface,
and namespace suites produced the same result in all six runtime configurations: **78 passed
and 4 approved expected failures** (three JSTag cases and startup timing).
The JSTag getter and same-realm behavior pass. Its three cross-realm limitations
are listed above. Typechecking, declaration contracts, focused lint, and the
diff whitespace check pass. That slice changed no addon or engine source.

The Module reflection slice reports **13 passed** in each of the six runtime
configurations, including the chosen browser property order. Typechecking, focused
lint, and whitespace checks pass. This slice changes tests and notes only; the
metadata operations remain native.

The custom-section slice passes its ten new checks on all six runtime
configurations. The focused WebAssembly, native recognition, native-interface,
and namespace checks have **104 passing cases and the same 4 expected failures**.
The broader custom/addon run, including all Web IDL tests, reports **780 passed
and 4 expected failures**. Typechecking, declaration contracts, focused lint, and
whitespace checks pass. No new expected failure was introduced.

The earlier Module-recognition review verified zero export enumeration with the
addon and one enumeration per distinct Module in the fallback. All three rebuilt
addons passed their full native suites with existing expected failures; the custom
base retained its official-installer test skip. The preceding binding review also
passed all Web IDL tests and the WebAssembly completion handoff (750 passed, one
expected failure). Those native suite results predate this JSTag slice.
The native constructors and interface members have since been reviewed above;
their completed native declarations are listed in the closing review.

The `JSTag` getter and Module/Instance/Memory/Table/Global/Tag/Exception constructors are now bound;
the cross-realm JSTag limitations above are accepted engine limitations for now.
§5.5's Global binding fixes its three constructor regressions. §5.6's imported
callback lifecycle now encloses native result conversion with the addon; stock
mode and unsupported experimental binary encodings remain explicit limitations.
§5.8 retains native GC objects and tests the accepted Chromium reflection
behavior normally. Only Node 24's older prototype-change behavior retains two
approved expected failures. §5.9's Exception constructor and recognition use the
existing adapter; native methods and exception-reference/cache behavior are
reviewed with the accepted index/stack differences above. §5.10 retains the
verified native Error constructors. §6's builtin selection and all string operations
are reviewed, retaining the documented native import-kind, `fromCodePoint`
signature, and unsigned `substring` choices. The ESM bridge supplies builtin/string
imports through its native compile options. §§7–8's error and limit review is complete with the native
memory-count/declaration choices above. §§9–10 and the closing material are now
reviewed. Web API §§1–3 and §4's Response-URL integration are implemented, retaining
the accepted native diagnostic cache behavior. Its closing sections are reviewed.
ESM §§1–10.5 and the HTML parser connection are reviewed, with the bridge-backed
namespace lookup, native source-object reflection, ordinary fetched graphs, and
explicit integration gates above. §10.6 is reviewed and deferred. The
[closing history and conformance material](https://webassembly.github.io/esm-integration/js-api/#change-history)
adds no further feature algorithm. The generated declarations, CSP compilation
hook, and HTML source-phase URL imports complete the outstanding work within
the current scope; the dependencies and limitations above remain. The shared
[optimized Promise-job snapshot crash](../../js-engine/ROADMAP.md#optimized-promise-job-snapshots)
also remains an open runtime investigation, not a completed WebAssembly fix.
The implementation/platform migration at the top of this roadmap supersedes
the native Module arrangement: generated reflection methods unwrap Module
implementations and convert their metadata through normal Web IDL dictionaries.
Retain the accepted compiled-module startup timing limitation.
Future slices should distinguish engine-provided behavior, connected browser
behavior, and open dependencies.
Use author-facing Browlet tests for conversion, identity, policy, promises,
streaming, cloning, and imports; retain native tests for backend contracts.
Runtime-sensitive changes follow the existing
[runtime matrix](../../../node-compat/README.md#runtime-test-matrix).
