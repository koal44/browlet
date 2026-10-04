# Browlet integration

This directory contains Browlet's cross-specification integrations. The
top-level [`bindings.ts`](../bindings.ts) is the composition root which
assembles interface and proxy object definitions with realm bindings,
and connects execution facilities to their owners.

The functions exported by `bindings.ts` compose realms through one module-private
`BindingWorld`. `createWindowEnvironment()` allocates the realm and
execution facilities before constructing Window and installing its platform global.
`scripting/environment.ts` creates realm facilities; `bindings.ts` completes
them with its Promise constructor, DOM event/abort allocation, and structured
data. The live global and DOMException accessors remain at that composition
boundary because global installation and interface registration finish later.
The Realm initially reads security from an `EnvironmentRecord` instance.
Registration constructs the complete `WindowEnvironment` before global projection;
it inherits the record state and adds `realm` and `exec`. The composition root
then constructs Window with that environment, links it to the realm, and installs
the shared global-scope mixin. The Document lifecycle
algorithms retain their own initialization. `createDocument()` obtains the node factory and
environment through Document's construction declaration. Stylelet uses that
same environment, including `userAgent.dom` and `exec`. Event creation is
available before projection.
The mixin uses `env.exec.clone()` and derives timer ownership from
`env.realm`, without retaining a Binding Context or a separate execution
argument.

A standalone subsystem owns the contract for each capability it consumes. A
provider module here connects that contract to Browlet-owned behavior. The
provider may know both sides of that boundary, but it must not use the
composition root's functions to rediscover a Binding Context already
available to the consuming algorithm.

Integration modules contain cross-owner behavior and wiring. They may also
contain Browlet's completion of a standalone subsystem when one concrete
platform implementation inherently depends on Browlet-owned facilities. Keep
that implementation whole on the Browlet side of the boundary rather than
splitting its state into a host-neutral facade and a browser-specific object.
Domain-local behavior still remains with its owning subsystem.

- `file/` connects File API algorithms to HTML scheduling,
  supplies platform line ending policy, and owns `FileReader`, whose concrete
  implementation depends on Browlet's EventTarget, tasks, timing, and events.
  It also owns the UserAgent's Blob URL store and entries, allowing them to
  retain browser-owned MediaSource implementations alongside portable Blobs
  when the [media foundation](../media/ROADMAP.md) is implemented. Its partial
  URL declaration exposes Blob registration and revocation using the static
  method's environment. UserAgent supplies parsing and captured-entry
  acquisition to URL and Fetch without exposing store mutation to Fetch.
- `scripting.ts` supplies the Node task-turn request beneath HTML's event-loop
  scheduling policy; JS Engine separately supplies the selected
  microtask-queue backend, including its enqueue and checkpoint operations.
- `fetch.ts` resolves an explicit global task destination to its existing Realm
  and queues through that Realm, which can differ from the body owner's Realm.

File and DOMException serialization steps live beside their implementations and
attach directly to the Web IDL declarations. HTML invokes their portable step
contracts; they need no integration module or separate registration.
