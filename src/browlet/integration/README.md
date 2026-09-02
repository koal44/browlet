# Browlet integration

This directory contains Browlet's cross-specification integrations. The
top-level [`bindings.ts`](../bindings.ts) is the composition root which
assembles their capability providers with Web IDL definitions, host-defined
interfaces, and realm bindings.

A standalone subsystem owns the contract for each capability it consumes. A
provider module here connects that contract to Browlet-owned behavior. The
provider may know both sides of that boundary, but it must not import the
assembled `browletBindings` singleton or rediscover a Realm Context already
available to the consuming algorithm.

Integration modules contain cross-owner behavior and wiring, not the core state
or algorithms of either subsystem. Domain behavior remains with its owning
specification, and substantial domain-local integrations such as Stylelet
remain with that domain rather than moving into this directory.

- `file/` connects File API algorithms to HTML scheduling and structured data,
  plus platform line ending policy.
- `streams.ts` connects Streams to DOM AbortController construction and HTML
  structured cloning.
- `dom-exception.ts` connects Web IDL DOMException records to HTML structured
  data.
