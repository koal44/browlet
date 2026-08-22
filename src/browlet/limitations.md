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
services directly. Document/parser inversion, initial navigable construction,
and navigation must move those objects under their specification-defined
owners. `updateWindowNamedProperties()` remains only until Window uses Web
IDL's global named-properties projection.
