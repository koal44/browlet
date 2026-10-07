# Browlet integration

Browlet's cross-specification adapters. [`bindings.ts`](../bindings.ts) composes
interface and proxy definitions, realm bindings, and execution facilities through
one module-private `BindingWorld`.

`createWindowEnvironment()` allocates the realm and
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

Providers implement contracts owned by the consuming subsystem. Browser-dependent
implementations such as FileReader stay whole here; domain-local behavior stays
with its subsystem. See the [composition rules](../../ARCHITECTURE.md#choosing-a-dependency).

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
- `network/` supplies the UserAgent's Node/Undici HTTP transport and per-response
  native content decoders. Fetch owns request processing and stream delivery;
  the adapters own connections, TLS, native I/O, and compression facilities.
