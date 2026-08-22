# Browlet limitations

## Realm, Window, and WindowProxy integration

Browlet's HTML realm model records a distinct Window global object and stable
WindowProxy global-this value, but Window still uses its direct implementation
surface rather than Web IDL's `projectGlobalObject()`. The global projection
must eventually wrap `WindowImpl`, place the projected public Window in the
WindowProxy's `[[Window]]` slot, and remove the direct named-property and event
method shims.

Node's VM creates an inaccessible global proxy for every context and cannot
currently reuse Browlet's WindowProxy as a replacement context's actual
global-this. The Node adapter therefore keeps that VM global private, points
its `globalThis` property at the modeled WindowProxy, and inherits free global
names through it. Ordinary Browlet scripts can reach the modeled Window graph,
but top-level `this` remains the private VM global. A focused expected-failure
test records the mismatch.

The provisional JavaScript WindowProxy must report forwarded own descriptors
as configurable to satisfy `Proxy` target invariants while its Window can be
replaced. Exact nonconfigurable `[LegacyUnforgeable]` descriptors across
retargeting require native global-proxy machinery. Add a focused expected
failure when Window's Web IDL projection reaches those descriptors.

The current handler implements only the same-origin, top-level lifecycle
foundation. Indexed child navigables, cross-origin access checks, and the
remaining specified WindowProxy internal methods enter with navigation and
nested browsing-context support.

## Transitional ownership

Browlet still retains the active Realm, Window, Document, bindings, and parser
services directly. Initial creation now places the Document under its
top-level traversable, browsing context, Window, realm, and environment as
specified; navigation and parser inversion must still make Browlet derive the
active services from that graph. `updateWindowNamedProperties()` remains only
until Window uses Web IDL's global named-properties projection.

## Initial browsing-context dependencies

The null-opener top-level `about:blank` path is connected. Nested and auxiliary
creation deliberately stop at named gaps until Browlet has iframe sandboxing,
permissions-policy inheritance, referrer-policy lookup, ancestor navigables,
and storage-shed cloning. The initial `CustomElementRegistry` preserves the
specified actor and identity, but its Web IDL projection and upgrade behavior
enter with HTML custom elements. The WebDriver BiDi notification is likewise
deferred until Browlet exposes that integration.

Initial navigation timing currently uses Node's monotonic `performance.now()`
without High Resolution Time's implementation-defined coarsening and jitter.
The coarsening boundary is explicit in browsing-context creation so the clock
backend can replace that identity operation later.
