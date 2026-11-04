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
| [JS Engine](../../js-engine/ROADMAP.md) | Realm identity, captured Wasm namespace/operations and constructors, promises, and source-text/synthetic module adapters | Capture further Wasm facilities as host algorithms need them and expose the addon's Wasm module adapter. Keep browser policy above this layer. |
| This directory and [Binding](../../web-idl/README.md) | Namespace operations and `JSTag` use Web IDL on the native namespace; Module/Instance/Memory/Table/Global construction and `Module.customSections()` are bound; native objects can fill both roles in a shared `PlatformRecord` | Review the remaining APIs and native interface members. Without the addon, objects created outside the constructor adapters retain the ownership limitation below. Cross-realm JSTag behavior remains an engine limitation below. |
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

**Native interface boundary:** Module and Instance supply `interfaceOverride.isInstance(platformObject)`
recognition for arguments, result dictionaries, unions, and overload selection.
The declarations retain the same native object for implementation and platform;
constructor/static member coverage is tracked in §5.1 below. JS Engine selects the Module check once at initialization,
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
is needed. Remaining native interface member coverage is reviewed in document
order; value recognition alone is deliberately not a complete API description.

### §5 audit: JavaScript exception tag

The [`JSTag` getter](webassembly.ts) returns the realm's captured native Tag.
The engine owns the exception-tag address, its `externref` signature, and Wasm
catching; Browlet supplies the namespace binding. The getter retains the original
tag after author replacement of the public property. Capturing it on `JSRealm`
also prevents the installed getter from recursively reading itself. This records
V8's current context-local value, not a new Browlet rule about tag ownership.
Tag uses the same `interfaceOverride.isInstance` predicate, with no constructor adapter yet.
Node/V8 has no public Tag
predicate, so JS Engine uses a captured `Exception.prototype.is()` with a private
empty exception: a non-Tag throws, while a different valid Tag returns false.
This checks native state without reading author properties or enumerating data.
The full Tag and Exception interfaces remain §§5.7 and 5.9 dependencies.

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
Browlet deliberately keeps the browser behavior. Two normal regression tests
assert that chosen order; a change in the native results will fail those tests
and prompt review. The alphabetical specification requirement remains documented
here as a continuing clash. No binding or engine repair has been added for it.

`customSections()` and the constructor follow in textual algorithm order; the
former is covered below. Constructor conversion/options and the unadapted static
members' complete declarations/descriptors remain explicit review work. Native
value recognition and one adapted method do not constitute a complete interface binding.

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
the adapted function's descriptors. Unadapted import/export reflection retains
the previously chosen browser property order.

**Binding dependency implemented:** `interfaceOverride.getInterfaceObject(env)` supplies the captured
native Module constructor. Binding installs the declared static operation on that
object and retains its prototype; the namespace exposes the original constructor,
without a separate global `Module`. The override also supplies its `isInstance` predicate;
constructor support follows below. Value-only interfaces remain untouched, including
inside a supplied namespace. Tests cover native constructor/prototype preservation
and generated static-operation types. No addon, Node, or V8 changes are involved.

### §5.1 Module constructor

The [Module constructor](https://webassembly.github.io/spec/js-api/#dom-module-module)
now applies the declared buffer-source and compile-options conversions, then
delegates synchronous compilation and native object creation to the captured
engine constructor. `WebAssemblyImpl.createModule()` borrows the source's current
byte range after conversion and rejects duplicate builtins. V8 copies that range
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

**Binding dependency implemented:** A native interface may declare a constructor
with the existing `overrideConstruct` hook. Binding wraps the supplied constructor
in a Proxy, keeping its native prototype and static members. It converts arguments,
selects the `newTarget` prototype, and records the native result as both identities
of one `PlatformRecord` before applying that prototype. The public constructor becomes that Proxy and
the native prototype's `constructor` points to it. The captured engine constructor
remains the internal compilation entry. Static-only interfaces still retain their
original constructor identity. No new declaration hook, addon, Node, or V8 patch
is needed.

**Native tracking:** Constructed Modules are associated immediately on every
backend. Binding explicitly associates compiled Modules and other native values
when the existing addon can recover their
registered creation realm. The record keeps the native identity and owner across
realms, prototype changes, and freezing. No additional Promise reaction or
resolution is inserted into `compile()`. Without the addon, exact ownership of
untracked native objects is unavailable; these values remain usable without a
record rather than acquiring a guessed owner. This also leaves values from
unregistered realms unassociated and preserves records belonging to another world.
The [tracking tests](../../../test/browlet/webassembly/module-tracking.test.ts)
cover construction, compiled results, input/output conversion, generic lookups,
foreign realms, frozen objects, and the stock ownership limitation.

The [constructor tests](../../../test/browlet/webassembly/module-construction.test.ts)
cover native usability, retained bytes, DataView/shared inputs, `new` enforcement,
errors and objects in the invoked realm, subclassing, cross-realm prototype fallback,
lookup/copy ordering, saved constructors, reflection, and the conversion regressions.
CSP compilation policy remains the explicit cross-entry-point dependency below.

### §5.2 reviewed: Instance constructor and exports

The [Instance constructor](https://webassembly.github.io/spec/js-api/#dom-instance-instance)
now uses the same `interfaceOverride` and `overrideConstruct` facilities as Module.
Binding converts the required Module and optional imports object, selects
`newTarget.prototype`, and delegates to `WebAssemblyImpl.createInstance()`.
The realm retains its original native Instance constructor before installation.
V8 reads the imports, uses the Module's retained builtin/string-import choices,
links, runs the start function synchronously, and creates the native instance and
exports object. Browlet does not duplicate those algorithms or store their state.

Binding records the resulting Instance's owner immediately, including on stock
Node without the addon, before applying the selected prototype. The object keeps
its native slots and prototype behavior. Async instantiation still returns native
Instances through its existing path; the stock ownership limitation for objects
created outside a constructor adapter remains unchanged. Capturing the constructor
also keeps saved constructors and subclasses usable after public replacement.
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

**Binding/type dependency:** The native getter works on Instances that have no
Browlet `PlatformRecord`, including externally created Instances and asynchronous
results on stock Node. Ordinary Binding receiver dispatch requires a record;
replacing the getter with that dispatch would reject currently valid receivers.
Its declaration and generated `Platform.Instance.exports` member therefore remain
pending explicit support for retained native instance members. This is a generated
type gap, not a missing author-visible getter. Do not fabricate an owner or install
a redundant getter solely to fill the declaration. No Node/V8 patch is required
for the working native getter.

### §5.3 reviewed: Memories

The [Memory constructor](https://webassembly.github.io/spec/js-api/#dom-memory-memory)
now uses the existing native-interface constructor adapter. Binding converts
`MemoryDescriptor`, including the `AddressType` enum, before prototype selection.
Its `AddressValue` members deliberately remain ordinary JavaScript values until
V8 performs the constructor's `AddressValueToU64` steps. `WebAssemblyImpl.createMemory()`
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
its descriptor, and address types. The native `grow`, `buffer`, and conversion
members remain installed by V8; their generated members retain the same explicit
native-instance-declaration dependency as `Instance.exports`. Those working native
members must continue accepting genuine objects outside registered Browlet realms.

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

**Remaining dependencies:** The native `grow`, `get`, `set`, and `length` remain
installed by V8; generated native-instance member declarations are still the
same unfinished Binding/type integration identified for Instance and Memory.
The generated Table constructor and descriptor are checked by type contracts.
Objects created outside constructor adapters still require the addon for exact
ownership association. Cross-Agent storage and advanced reference-type exposure
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
receiver checks. Binding recognizes native Globals through `interfaceOverride`
and reuses the existing `PlatformRecord` association, including vector exports.
Adapted construction records the constructor's realm before applying a foreign
prototype. Other native results acquire a record only when the addon identifies
their registered creation realm; stock mode leaves that owner unknown.

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

Generated constructor/dictionary types are connected. As for the preceding
native interfaces, generated types for the retained native instance members
remain a Binding dependency. The next section is §5.6, Exported Functions.

### §5.6 first slice: Exported Functions and the host-callback boundary

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
entry-time incumbent capture with `overrideCapturesIncumbent: true`. Binding cannot
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
conversion. Exported GC-object and exception-reference behavior still needs its
type-specific review in §§5.8–5.9. This slice does not complete §5.6 or establish
that a Node/V8 patch is necessary for the remaining host integration.

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
The remaining native constructors and interface members remain separate review work.

The `JSTag` getter and Module/Instance/Memory/Table/Global constructors are now bound;
the cross-realm JSTag limitations above are accepted engine limitations for now.
§5.5's Global binding fixes its three constructor regressions. §5.6's imported
callback lifecycle now encloses native result conversion with the addon; stock
mode and unsupported experimental binary encodings remain explicit limitations.
The native imports()/exports() reflection methods retain
their reviewed behavior; their generated static-method types remain to be connected
without replacing the accepted native descriptor property order.
Retain the accepted compiled-module startup timing limitation.
Future slices should distinguish engine-provided behavior, connected browser
behavior, and open dependencies.
Use author-facing Browlet tests for conversion, identity, policy, promises,
streaming, cloning, and imports; retain native tests for backend contracts.
Runtime-sensitive changes follow the existing
[runtime matrix](../../../node-compat/README.md#runtime-test-matrix).
