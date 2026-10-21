# Browlet integration

Browlet's cross-specification adapters. [`bindings.ts`](../bindings.ts) composes
interface and proxy definitions, realm bindings, and execution facilities through
one shared `BindingWorld`. Implementation algorithms receive their dependencies
through composition and do not import that module.

Outside this directory, bindings and UserAgent are the only production modules
that import its concrete integrations. Other implementations use the objects supplied by
their environment or UserAgent; browser-dependent classes can remain here.

`createWindowEnvironment()` allocates the realm and
execution facilities before constructing Window and installing its platform global.
`createBrowletExecution()` in `bindings.ts` composes realm facilities, the bound
Promise constructor, DOM document/event/abort allocation, Fetch task delivery,
and structured data. Fetch delivery resolves the supplied destination global's
BrowletRealm, which can differ from the execution owner's, and queues on HTML's networking
task source. The live global and DOMException accessors remain at that composition
boundary because global installation and interface registration finish later.
The BrowletRealm initially reads security from a `BrowletEnvironmentBase` instance.
Registration constructs the complete `WindowEnvironment` before global projection;
it inherits the base state and adds `realm` and `exec`. The composition root
then constructs Window with that environment, links it to the realm, and installs
the shared global-scope mixin. The Document lifecycle
algorithms retain their own initialization. `env.exec.createDocument()` supplies
the environment through Document's construction declaration; descendant allocation
uses that same environment's `exec.constructNode()`. Stylelet uses that
same environment, including `userAgent.dom` and `exec`. Event creation is
available before projection.
`Browlet` constructs UserAgent, which creates its sandbox through bindings and
exposes the Window-environment factory. Bindings receives the existing owner;
new browsing contexts use that factory through their UserAgent. UserAgent creates
Window Agents, while bindings creates the sandbox Agent. Both construct EventLoop
with `queueNodeTask` for host wake-ups. The loop owns its microtask queue and
selects the shared clock; integration supplies only the Node facilities.
The mixin uses `env.exec.clone()` and derives timer ownership from
`env.realm`, without retaining a Binding Context or a separate execution
argument. UserAgent supplies `timerHost`; the mixin constructs and retains each
global's timer state.

Providers implement contracts owned by the consuming subsystem. Browser-dependent
implementations such as FileReader stay whole here; domain-local behavior stays
with its subsystem. See the [composition rules](../../ARCHITECTURE.md#choosing-a-dependency).

- `web-idl/` supplies HTML's extended-attribute handlers to the `BindingWorld`
  composition in `bindings.ts`. Reflection is prepared after type resolution,
  once per world. Declarations retain annotations and typed metadata without
  importing this integration; invocations use the receiver's binding context.
  Reusable HTML value rules and DOM state remain with their existing owners.
  Custom-element reaction wrapping is still pending in its owning slice.
- `xhr/` owns ProgressEvent's browser implementation, declaration, and trusted
  firing over DOM events. FileReader consumes this same implementation; the
  standalone XHR package remains independent of Browlet. Binding composition
  includes its declarations alongside the standalone XHR contributions.
- `file/` connects File API algorithms to HTML scheduling
  and owns `FileReader`, whose concrete
  implementation depends on Browlet's EventTarget, tasks, timing, and events.
  It also owns the UserAgent's Blob URL store and entries, allowing them to
  retain browser-owned MediaSource implementations alongside portable Blobs
  when the [media foundation](../media/ROADMAP.md) is implemented. Its partial
  URL declaration exposes Blob registration and revocation using the static
  method's environment. UserAgent supplies parsing and captured-entry
  acquisition to URL and Fetch without exposing store mutation to Fetch.
- `node.ts` supplies Node task turns, timer wake-ups, and browser-owned Promise
  continuations. Composition assigns `queueNodeTask` to event-loop wake-ups and
  `runInParallel`; HTML keeps its scheduling policy. JS Engine separately supplies
  the microtask-queue backend, including enqueue and checkpoint operations.
- `network/` supplies the UserAgent's Node/Undici HTTP transport and per-response
  native content decoders. Fetch owns request processing and stream delivery;
  the adapters own connections, TLS, native I/O, and compression facilities.
