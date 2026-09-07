# Browlet limitations

## Realm, Window, and WindowProxy integration

Browlet's HTML realm model records a distinct Window global object and stable
WindowProxy global-this value. The existing `WindowImpl` is projected through
Web IDL's global-object machinery, and WindowProxy forwards its public surface
to that projected Window while lifecycle code derives the implementation
through their shared platform-object association. Compatible mode uses the
native WindowProxy; plain Node retains a userland proxy and its forwarding
accommodations.

### `node-vm-global-proxy`

Stock Node's VM creates an inaccessible global proxy for every context and
cannot reuse Browlet's WindowProxy as the context's actual global-this. As an
accommodation, `NodeRealm` keeps that VM global private, points its
`globalThis` property at the modeled WindowProxy, and inherits free global
names through it.

A Browlet-compatible Node now exposes an opaque `ContextHandle` for one
execution context and a separately stable `globalProxy`. Detaching a handle and
passing that handle once as `reuseGlobalProxyFrom` preserves the proxy identity
while creating fresh intrinsics and global state. The handle carries the reuse
provenance without a global proxy registry. The addon allocates immutable Window
objects/prototypes at creation and Web IDL projects into them. Browlet no longer
needs the historical post-creation immutability patch for its Window lifecycle.

The native handle contexts use Node's ordinary VM principal token so
host code can configure the proxy. This is not a same-origin implementation:
the `origin` option remains inspector metadata, and Node supplies none of the
authoritative WindowProxy access callbacks that browsers apply before a shared
security token can be used as an optimization. Compatible Node therefore proves
the identity and lifecycle substrate without yet proving retained old-Realm
same- or cross-origin access.

V8 also cancels microtasks still queued for a Realm when its global is detached.
Browlet must therefore place reuse after the checkpoint required by the HTML
navigation lifecycle rather than asking the generic VM primitive to drain work.
The current top-level navigation path does this and reuses the native proxy.
Complete cross-origin and nested-context access remain Priority 7 work.

The plain-Node accommodation has two observable limitations. Ordinary Browlet scripts
can reach the modeled Window graph, but top-level `this` remains the VM global
proxy rather than Browlet's modeled WindowProxy. A focused expected-failure
test records that mismatch. The provisional JavaScript WindowProxy must also
report forwarded own descriptors as
configurable to satisfy `Proxy` target invariants while its Window can be
replaced. Exact nonconfigurable `[LegacyUnforgeable]` descriptors across
retargeting require native global-proxy machinery, and a second focused
expected-failure test records that mismatch.

The compatible path resolves those identity/descriptor mismatches through
native allocation; it does not complete browser origin policy. The engine
bridge is implemented in
[`node-realm.ts`](../js-engine/node-realm.ts), below Web IDL; Browlet's
[`realm.ts`](./scripting/realm.ts) retains the HTML global and task
associations. The current observable mismatches are recorded in
[`document-lifecycle.test.ts`](../../test/browlet/browsing/document-lifecycle.test.ts)
and [`dom-binding.test.ts`](../../test/browlet/dom-binding.test.ts).

The current handler implements only the same-origin, top-level lifecycle
foundation. Indexed child navigables, cross-origin access checks, and the
remaining specified WindowProxy internal methods enter with navigation and
nested browsing-context support.

Window named properties currently preserve Browlet's implemented ID-based
surface, now dynamically through Web IDL's named-properties object. Element
`name` contributions, child navigables, and the multiple-match HTMLCollection
result remain for their corresponding HTML machinery.

## Node/V8 event-loop integration

The completed integration introduces one
`JavaScriptMicrotaskQueue` contract with `explicit` and `ambient` backends. A
Browlet-compatible Node creates one explicit V8 queue for each configured HTML
EventLoop and gives every Realm of its Agent the same queue. HTML
microtasks and native Promise jobs then share one FIFO, and a checkpoint drains
only that EventLoop's queue.

Stock Node retains the `node-v8-microtask-queue` and `node-v8-checkpoint`
accommodations. Its runtime factory gives every EventLoop the one ambient queue
and uses private `process._tickCallback()`. Besides draining
unrelated isolate work, that function runs next-tick and promise-rejection
machinery. A nested call made while V8 is already draining microtasks can
consequently report a temporarily unhandled rejection before its adoption job
runs. Focused stock-mode expected-failure tests preserve the ambient, nested,
fake-clock, and rejection-reporting mismatches. The corresponding
compatible-mode unit suite passes, and all 1,193 selected WPT assertions pass
with a clean process exit. Stock Node completes those assertions but still
reports the parser/Promise-job `boo!` rejection as unhandled and exits nonzero.
Explicit queue ownership fixes the observed queue-isolation and checkpoint
defect. The custom engine now supplies separate Promise-job lifecycle hooks.

These fallback limitations are not changes to HTML's checkpoint algorithm or
permission to alter Web IDL promise conversion. Both backends remain below the
HTML checkpoint guard and post-checkpoint work in Browlet. With custom Node,
make/call/Promise enqueue now retain each registration's incumbent and run
jobs as HTML microtask tasks with callback/script cleanup. Official Node plus
the addon provides queue ownership but no job hooks. HTML Script records,
active-script restoration, rejection reporting, and arbitrary author versus
host-frame distinctions remain incomplete. Affected code and removal conditions are recorded in
[the event-loop architecture](./scripting/EVENT-LOOP-ARCHITECTURE.md#runtime-integration-and-accommodations).

On the custom engine, Browlet also installs generic and timeout enqueue hooks
for HTML realms. These hooks own scheduling across the isolate and cannot
decline individual jobs. Atomics.waitAsync in an ordinary Node/VM realm while
Browlet's hooks are installed is unsupported and reports a host-hook error.
HTML realm waits use the global's task queue and fully-active timeout steps.

Direct calls from a Node host into a projected Browlet API are not, by
themselves, HTML tasks or script-evaluation entries. An explicit queue therefore
does not automatically checkpoint merely because such a call returned a
Promise, and a Promise supplied by the host can require another Browlet event
loop boundary before its continuation runs. Unit tests which deliberately make
these out-of-model calls attach a host observer and explicitly finish the
test-controlled queue. A future general embedder API must define that entry and
Promise-interoperability contract; production code must not hide it by
checkpointing after every Web IDL operation.

## Bounded cross-document navigation

Browlet now derives the active Document, Window, realm, and bindings from its
top-level traversable. Cross-document navigation preserves the browsing
context and WindowProxy, creates the usual fresh Window/realm/Document graph,
commits it through session history, and only then feeds the local response body
to the parser. The first navigation replaces the initial `about:blank` entry;
later ordinary navigations push entries.

The local route represents an already-obtained, headerless HTML response. The
request, fetch controller, early hints, and reserved environment slots remain
explicitly null. COOP browsing-context-group switching, nested navigables,
Permissions-Policy/OAC/Refresh/Link/Speculation-Rules header processing, CSP,
Navigation Timing entries, deferred-fetch quota, unload, and navigation
cancelation are named boundaries rather than silently approximated behavior.
The readiness/load completion path is synchronous and does not yet model the
HTML event loop or the separate `DOMContentLoaded` steps.
Fragment and `javascript:` navigation still take the cross-document host path;
their specified same-document and script-URL branches remain to be connected.

Browlet's host exposures are intentionally reinstalled on each new Window;
they are host configuration, not Document or Window lifecycle state.

## Initial browsing-context dependencies

The null-opener top-level `about:blank` path is connected. Nested and auxiliary
creation deliberately stop at named gaps until Browlet has iframe sandboxing,
permissions-policy inheritance, referrer-policy lookup, ancestor navigables,
and storage-shed cloning. The initial `CustomElementRegistry` preserves the
specified actor and identity, but its Web IDL projection and upgrade behavior
enter with HTML custom elements. The WebDriver BiDi notification is likewise
deferred until Browlet exposes that integration.
