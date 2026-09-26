# Browlet integration

This directory contains Browlet's cross-specification integrations. The
top-level [`bindings.ts`](../bindings.ts) is the composition root which
assembles their capability providers with Web IDL definitions, host-defined
interfaces, and realm bindings.

The named functions exported by `bindings.ts` forward to its main
`BrowletBindings` instance. `createWindowEnvironment()` constructs the Window,
allocates its realm and execution facilities, and installs its platform global.
The Realm initially reads security from an `EnvironmentRecord` instance.
Registration constructs the complete `WindowEnvironment` before global projection;
it inherits the record state and adds `realm`, `exec`, and `window`. The composition
root then constructs its shared global-scope mixin. The Document lifecycle
algorithms retain their own initialization. `createDocument()` obtains the node factory and
Stylelet execution facilities through Document's existing construction declaration. Record
creation initializes its realm-owned event factory without projecting it.
The mixin uses `env.exec.clone()` and derives timer ownership from
`env.realm`, without retaining a Binding Context or a separate execution
argument.

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
  It also owns the UserAgent's Blob URL store and entries, allowing them to
  retain browser-owned MediaSource implementations alongside portable Blobs
  when the [media foundation](../media/ROADMAP.md) is implemented. Its partial
  URL declaration exposes Blob registration and revocation using the static
  method's environment. UserAgent supplies parsing and captured-entry
  acquisition to URL and Fetch without exposing store mutation to Fetch.
- `execution.ts` composes engine facilities, DOM AbortController construction,
  HTML task delivery, and structured cloning into `RealmExecution`. The binding's
  `getEnvironment()` retains the actual browser environment; declarations supply
  it to portable implementations through the `JSEnvironment` contract and its
  `exec` field. Clone and serialization
  operations capture the explicit destination binding here.
- `scripting.ts` supplies the Node task-turn request beneath HTML's event-loop
  scheduling policy; JS Engine separately supplies the selected
  microtask-queue backend, including its enqueue and checkpoint operations.
- `fetch.ts` resolves an explicit global task destination to its existing Realm
  and queues through that Realm, which can differ from the body owner's Realm.
  It also realizes deserialized abort reasons at the destination binding boundary.
- `dom-exception.ts` connects Web IDL DOMException records to HTML structured
  data.
