# Browlet limitations

## Realm, Window, and WindowProxy integration

Browlet's HTML realm model records a distinct Window global object and stable
WindowProxy global-this value. The existing `WindowImpl` is projected through
Web IDL's global-object machinery, and WindowProxy forwards its public surface
to that projected Window while lifecycle code derives the implementation
through their shared platform-object association. WindowProxy still supplies
stable event-method forwarding because the userland outer proxy cannot itself
carry the Window platform-object brand.

### `node-vm-global-proxy`

Node's VM creates an inaccessible global proxy for every context and cannot
reuse Browlet's WindowProxy as the context's actual global-this. As an
accommodation, the Node adapter keeps that VM global private, points its
`globalThis` property at the modeled WindowProxy, and inherits free global
names through it.

This accommodation has two observable limitations. Ordinary Browlet scripts
can reach the modeled Window graph, but top-level `this` remains the private VM
global. A focused expected-failure test records that mismatch. The provisional
JavaScript WindowProxy must also report forwarded own descriptors as
configurable to satisfy `Proxy` target invariants while its Window can be
replaced. Exact nonconfigurable `[LegacyUnforgeable]` descriptors across
retargeting require native global-proxy machinery, and a second focused
expected-failure test records that mismatch.

Replace the private VM global, inheritance bridge, and proxy-invariant
compromises together only when Node exposes a compatible global-proxy API or
Browlet uses a direct V8 embedder. The Window/WindowProxy identity and
cross-navigation lifecycle tests remain the required contract. The boundary is
implemented in [`realm.ts`](./scripting/realm.ts); the observable mismatches
are recorded in
[`document-lifecycle.test.ts`](../../test/browlet/unit/browsing/document-lifecycle.test.ts)
and [`dom-binding.test.ts`](../../test/browlet/unit/dom-binding.test.ts).

The current handler implements only the same-origin, top-level lifecycle
foundation. Indexed child navigables, cross-origin access checks, and the
remaining specified WindowProxy internal methods enter with navigation and
nested browsing-context support.

Window named properties currently preserve Browlet's implemented ID-based
surface, now dynamically through Web IDL's named-properties object. Element
`name` contributions, child navigables, and the multiple-match HTMLCollection
result remain for their corresponding HTML machinery.

## Node/V8 event-loop integration

The `node-v8-microtask-queue` accommodation preserves V8's real Promise and
microtask FIFO order by using its ambient queue, but Browlet cannot isolate the
queue per HTML event loop. Unrelated host work and work from another Browlet
instance in the same isolate can therefore interleave.

The `node-v8-checkpoint` accommodation uses private
`process._tickCallback()` because Node exposes no supported synchronous V8
checkpoint operation. Besides draining the ambient queue, that function runs
next-tick and promise-rejection machinery. A nested call made while V8 is
already draining microtasks can consequently report a temporarily unhandled
rejection before its adoption job runs. Focused expected-failure tests preserve
the ambient, nested, fake-clock, and rejection-reporting mismatches.

These are Node integration limitations, not changes to HTML's checkpoint
algorithm or permission to alter Web IDL promise conversion. Their affected
code and removal conditions are recorded in
[the event-loop architecture](./scripting/event-loop-architecture.md#runtime-accommodations).

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
