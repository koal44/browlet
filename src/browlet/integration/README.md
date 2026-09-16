# Browlet integration

This directory contains Browlet's cross-specification integrations. The
top-level [`bindings.ts`](../bindings.ts) is the composition root which
assembles their capability providers with Web IDL definitions, host-defined
interfaces, and realm bindings.

The named functions exported by `bindings.ts` forward to its main
`BrowletBindings` instance. HTML lifecycle code selects the Window and owns its
document/settings state. `createWindowRealm()` composes that Window's engine
allocation and bindings; `createDocument()` obtains the node factory and
Stylelet runtime through Document's existing construction declaration. Record
creation initializes its realm-owned event factory without projecting it. Environment
setup receives prepared structured-clone steps, rather than a Binding Context
or the complete realm binding.

A standalone subsystem owns the contract for each capability it consumes. A
provider module here connects that contract to Browlet-owned behavior. The
provider may know both sides of that boundary, but it must not import the
assembled `browletBindings` singleton or use its forwarding functions to
rediscover a Binding Context already available to the consuming algorithm.

Integration modules contain cross-owner behavior and wiring. They may also
contain Browlet's completion of a standalone subsystem when one concrete
platform implementation inherently depends on Browlet-owned facilities. Keep
that implementation whole on the Browlet side of the boundary rather than
splitting its state into a host-neutral facade and a browser-specific object.
Domain-local behavior still remains with its owning subsystem.

- `file/` connects File API algorithms to HTML scheduling and structured data,
  supplies platform line ending policy, and owns `FileReader`, whose concrete
  implementation depends on Browlet's EventTarget, tasks, timing, and events.
- `runtime.ts` composes each Window's implementation Runtime Context from its
  engine facilities, DOM AbortController construction, HTML task delivery, and
  structured cloning. Binding registration retains that one context and
  declaration bindings supply it to implementations. It also prepares the
  global's structured-clone steps with explicit destination-realm bindings;
  HTML environment setup owns the global-scope mixin which consumes them.
- `scripting.ts` supplies the Node task-turn request beneath HTML's event-loop
  scheduling policy; JS Engine separately supplies the selected
  microtask-queue backend, including its enqueue and checkpoint operations.
- `xhr.ts` supplies the realm-sensitive File construction used by HTML's form
  entry algorithms when XHR's FormData entry-list operations invoke them.
- `dom-exception.ts` connects Web IDL DOMException records to HTML structured
  data.
