# WebAssembly roadmap

This directory owns Browlet's WebAssembly browser integration. V8 owns binary
validation, compilation, execution, and the native JavaScript objects; Browlet
owns browser policy, scheduling, Fetch integration, and connections to HTML
modules and structured data.
Native API availability is a starting point for review, not a claim that every
draft requirement is satisfied by every supported runtime.

## References and review order

Work through each document in order, choosing bounded slices as the review
progresses. Sections supplied by the engine still need an ownership and
observable-behavior review; their algorithms do not require duplicate TypeScript
implementations merely because the specification uses Web IDL.

1. [JavaScript API](https://webassembly.github.io/spec/js-api/), draft dated
   28 October 2026: audit engine facilities and establish the host boundaries.
2. [Web API](https://webassembly.github.io/spec/web-api/), draft dated
   28 October 2026: implement streaming API and serialization integration.
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

Both checkouts were clean and already current after an upstream refresh on
1 November 2026. Three documents require only these two checkouts.
Refresh the references when resuming after upstream changes. The
[Core specification](https://webassembly.github.io/spec/core/) supplies engine
semantics to consult as needed, rather than another browser implementation plan.

## Ownership and current state

| Owner | Existing support | Missing work here |
| --- | --- | --- |
| V8 and the selected Node runtime | Native Wasm compiler, instances, memories, tables, globals, functions, and related JavaScript APIs | Audit the selected runtime's draft coverage, realm behavior, and observable host obligations. |
| [JS Engine](../../js-engine/ROADMAP.md) | Realm identity, captured Wasm namespace/operations and CompileError constructor, promises, and source-text/synthetic module adapters | Capture further Wasm facilities as host algorithms need them and expose the addon's Wasm module adapter. Keep browser policy above this layer. |
| This directory and [Binding](../../web-idl/README.md) | `validate()`, `compile()`, and both `instantiate()` overloads use Web IDL conversion on the existing native namespace; value-only Module/Instance declarations preserve native identity | Review the remaining APIs and native interface members. Native Wasm objects have no Browlet implementation/platform pairing. |
| [HTML scripting](../scripting/ROADMAP.md) | Module resolution, import maps, fetching, caching, and supplied-graph execution | Connect `BrowletRealm.parseWebAssemblyModule()` and `JSWebAssemblyModuleRecord`, which still throw. Source/deferred phases also remain explicit boundaries. |
| [Node compatibility addon](../../../node-compat/README.md#webassembly-modules) | Wasm records compile and execute supplied mixed graphs; direct Wasm dependencies preserve native export identities | Consume the maintained bridge through JS Engine. Node's public VM API has no equivalent Wasm record class; the stock-without-addon path needs a deliberate solution or an explicit unsupported boundary. |

Browser operations use the existing owning `env` and its realm. Engine adapters
stay in JS Engine, policy checks in CSP, and generic loading/serialization in
their existing HTML owners. This integration creates no new environment,
registry, or alternate loader.

## 1. JavaScript API

| Sections, in order | Review and implementation responsibility |
| --- | --- |
| §§1–3: introduction, examples, notation | Establish the embedding boundary and terminology. Infra and Web IDL already supply the common foundations. |
| §§4.1–4.2: store and object caches | Engine-owned state and identities. Check how native objects map to Browlet's modeled Agents and realms; do not create a second Wasm store or object cache. |
| §5: namespace, validation, compilation, instantiation | Preserve the native namespace and capture internal operations before author replacement. Audit conversion, compile options, promise/error realms, and asynchronous completion; identify the host work needed for the Web API. |
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
Tag, Exception, and GC-object cache behavior still needs its type-specific
review in §§5.7–5.9, alongside the remaining constructor and conversion rules.

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
Asynchronous compilation and both instantiation overloads are covered below;
`JSTag` remains next. Generated platform declarations describe these three
operations and their result types; the remaining native members are preserved
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

The native Promise is exposed through an `InternalPromise.fromNative()` view;
the adapter neither attaches reactions nor resolves its Module a second time.
The declaration now uses `Promise<Module>` with native value recognition instead
of the former `Promise<object>` placeholder. Module retains its native identity;
the interface review in §5.1 still owns its constructor and member contracts.

All twelve compilation regressions pass in the six-runtime matrix, including
the eight original conversion failures. Namespace, binding, completion, and
engine-job checks retain their existing capability expectations.

The JS API's asynchronous-compilation algorithm takes an optional task source;
`compile()` supplies none, whereas streaming compilation supplies networking.
Keep that distinction when connecting streaming completion. Compilation remains
asynchronous; the adapter does not replace it with a deferred synchronous constructor.

[`WebAssemblyImpl`](webassembly.ts) owns these operations and their compile
options. Namespace bindings forward converted arguments to its static methods
and install them on the native namespace. The
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
`WebAssemblyImpl.compile()` and its conversion rules. It calls the captured native
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
native compilation Promise, then the native Module-instantiation Promise, and
resolves its typed result dictionary. Module and Instance `then` lookups occur once
each, and a thenable that replaces the compiled Module with bytes is rejected
instead of accidentally triggering another compilation.

**Native interface boundary:** Module and Instance use Binding's `isInstance(value)`
recognition for arguments, result dictionaries, unions, and overload selection.
The declarations add no implementation/platform pair and install no constructors
or interface members. JS Engine selects the Module check once at initialization,
using the addon's `isWebAssemblyModule()` predicate when available on any supported
base. It calls V8's existing `IsWasmModuleObject()` directly,
without enumerating exports. Without the addon, the captured Module `exports()`
intrinsic performs the initial check and a `WeakSet` caches successful recognition.
The fallback therefore allocates export descriptors once per recognized Module;
the cache does not keep Modules alive. Instance recognition uses its captured
`exports` getter. Both paths accept genuine foreign objects and reject prototype
lookalikes and JavaScript proxies. Changing an object's prototype or replacing
the public methods does not change its brand.

The implementation retains asynchronous native compilation and the existing
completion handoff. The addon exports an existing V8 predicate; no Node/V8 patch
is needed. Native interface member/constructor coverage remains a §§5.1–5.2
dependency; these value declarations are deliberately incomplete API descriptions.
`JSTag` is the next namespace member.

## 2. Web API

| Sections, in order | Browser work |
| --- | --- |
| §1: introduction | Confirm the JavaScript API prerequisites identified above. |
| §2: streaming compilation and instantiation | Bind `compileStreaming()` and `instantiateStreaming()` to Browlet `Response` objects. Enforce the specified header, CORS-same-origin, status, and body checks; pass compile options to the engine and deliver results on the required task source. The specified whole-body consumption model is sufficient initially. |
| §3: serialization | Add native `WebAssembly.Module` support to existing structured serialization. Reject storage serialization and cross-agent-cluster delivery; reconstruct in the target realm. Engine module/byte access and native identity remain dependencies. |
| §§4–7 and conformance/reference material | Review developer-facing display conventions, MIME registration, security/privacy, and history. Delegate engine diagnostics where appropriate and record browser-specific omissions. |

## 3. ES-module integration

Follow the draft from its beginning, accounting for unchanged JavaScript API
sections through the earlier review. Its added namespace and Module operations,
including `namespaceInstance()` and source-object reflection, are not supplied
by the current bridge merely because ordinary graph execution works.

At §10, proceed through record creation/parsing, `GetExportedNames`,
`ResolveExport`, `GetModuleSourceKind`, `InitializeEnvironment`, `ExecuteModule`,
and `HostGetModuleSourceModuleRecord` in document order. Connect these through
the existing HTML records and JS Engine/backend adapters, keeping native graph
linking and evaluation authoritative. Then review the remaining history and
conformance material.

Prove the path from fetched Wasm bytes through compilation, dependency loading,
linking, evaluation, and author-visible exports. Cover static/dynamic imports
and source-phase handling without treating source requests as evaluation
requests. `import(moduleObject)`, deferred imports, module-source reflection,
and namespace-to-instance lookup each need a capability and integration review;
the current bridge does not establish their support in Browlet. Check what the
engine already supplies before deciding whether implementation is needed.

## Dependencies and integration gates

| Dependency | Available foundation and remaining gate |
| --- | --- |
| [Fetch](../../fetch/ROADMAP.md) | Response records, headers, CORS filtering, body consumption, and cancellation exist. Use them directly; Node's own Response acceptance does not establish support for Browlet Responses. |
| [Scheduling](../scripting/EVENT-LOOP-ARCHITECTURE.md) | All addon bases deliver native completion through the owning HTML task and Document lifetime. Reuse that handoff; stock mode supplies automatic progress without HTML task ownership. Streaming still needs its specified networking task source. |
| [CSP](../browsing/policy/csp/ROADMAP.md) | Policies and violation reporting exist; Wasm byte-compilation enforcement is missing. Connect [the Wasm compilation check](https://w3c.github.io/webappsec-csp/#can-compile-wasm-bytes) at native compilation entry points as well as browser methods. Keep module URL/fetch policy distinct from compilation-sink policy, and preserve Node's own checks in any addon callback. |
| [Structured data](../scripting/structured-data/ROADMAP.md) | Graph identity, target realms, storage rejection, and cluster restrictions already have owners. Native Wasm brand recognition, module extraction/reconstruction, and registration with that machinery remain missing. V8's public module APIs are candidates for a bounded addon adapter, not an implemented facility. |
| [Module loading](../scripting/module-loading.ts) | URL resolution, import maps, module maps, and ordinary graph loading exist. Connect the Wasm parser and source-phase paths deliberately; their present throwing boundaries must remain visible until replaced. |
| [Workers](../workers/ROADMAP.md) and native isolation | Worker startup, cross-thread transport, and correspondence between modeled Agents and native execution domains remain separate dependencies. Window integration can proceed; its tests do not certify cross-agent Wasm behavior. |

## Known ES-module binding limitations

The maintained [addon gap suite](../../../node-compat/test/wasm-gaps.test.cjs)
and independent [Node controls](../../../node-compat/test/wasm-node-gaps.test.cjs)
retain these approved expected failures. They concern ES-module bindings, not
ordinary `WebAssembly.Global` access through the JavaScript API.

| Required behavior | Recorded limitation |
| --- | --- |
| Mutable Wasm globals remain live in JavaScript imports | The exported binding retains its initial value after Wasm changes the global. |
| `v128` exports remain uninitialized | Access returns `undefined` instead of throwing `ReferenceError`; other exports remain usable. |
| A Wasm global re-exported through JavaScript retains its native binding | A consuming Wasm module receives a JavaScript value and fails to link. Direct Wasm-to-Wasm imports work. |

Reassess these at the ESM execution/binding review, rather than making their
repair a prerequisite for the JavaScript or Web API work. Re-run the existing
evidence on the selected backends and pursue a bounded repair if one exists.
A change requiring new engine binding primitives is separate backend work;
completion of browser integration does not imply these limitations are fixed.
Preserve the required assertions and unexpected-pass detection.

## Validation and next review

The focused Module-recognition, native-interface, and WebAssembly suites pass in
all six runtime configurations: 70 passed and the one approved startup-timing
expected failure. The recognition test verifies zero export enumeration with the
addon and one enumeration per distinct Module in the fallback. All three rebuilt
addons pass their full native suites with existing expected failures; the custom
base retains its official-installer test skip. The earlier binding review also
passed all Web IDL tests and the WebAssembly completion handoff (750 passed, one
expected failure). Typechecking, declaration contracts, and focused lint pass.
Native constructors and interface members remain explicitly outside this slice.

The current integration stops immediately before §5's `JSTag` getter, as requested
for consolidation. Its review and the following §5.1 Module interface are pending.
Retain the accepted compiled-module startup timing limitation.
Future slices should distinguish engine-provided behavior, connected browser
behavior, and open dependencies.
Use author-facing Browlet tests for conversion, identity, policy, promises,
streaming, cloning, and imports; retain native tests for backend contracts.
Runtime-sensitive changes follow the existing
[runtime matrix](../../../node-compat/README.md#runtime-test-matrix).
