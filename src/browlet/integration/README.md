# Browlet integration

Browlet connects specification implementations, their JavaScript platform, and
the host through these adapters. Each provider implements contracts owned by its
consumer; implementations receive the resulting facilities through their
environment or UserAgent. See the [composition rules](../../ARCHITECTURE.md#choosing-a-dependency).

| Owner | Responsibility |
| --- | --- |
| [`web-idl/`](web-idl/README.md) | Compose environments, realms, and the shared BindingWorld; collect declarations from their feature owners |
| [`web-idl/bindings/`](web-idl/bindings/index.ts) | HTML reflection, constructors, cross-origin access, and WindowProxy/Location binding rules |
| [`host/`](host/index.ts) | Node task turns, timer wake-ups, and browser-owned Promise continuations |
| [`host/network/`](host/network/index.ts) | Node/Undici HTTP transport and native response decoders |
| [`file/`](file/index.ts) | FileReader, the browser's Blob URL store, and URL's object-URL declaration contribution |
| [`xhr/`](xhr/index.ts) | ProgressEvent's browser implementation, declaration, and trusted event firing |
| [`permissions/`](permissions/index.ts) | PermissionStatus with browser event delivery and lifetime handling |
| [`dom.ts`](dom.ts) | Implementation access supplied to other subsystems through `userAgent.dom` |

UserAgent consumes host facilities, Blob URL storage, and the DOM adapter directly.
It creates its sandbox through Web IDL composition and exposes the Window factory
to browsing algorithms. Web IDL composition consumes the host and feature adapters
and installs the lower binding hooks. Adapters and binding hooks do not import
composition; the import hierarchy enforces that direction.

FileReader stays whole here because it combines File API behavior with Browlet's
EventTarget, task delivery, timing, and ProgressEvent. Its declarations remain
beside its implementation. Blob URL entries can retain browser-owned MediaSource
implementations when the [media foundation](../media/ROADMAP.md) exists. UserAgent
supplies parsing and captured-entry acquisition to URL and Fetch without exposing
store mutation to Fetch.

The host supplies Node facilities, while HTML retains scheduling policy. UserAgent
creates Window Agents and composition creates the sandbox Agent; both supply
`queueNodeTask` for EventLoop wake-ups. JS Engine separately owns the microtask-queue
backend. Each global's [environment-owned mixin](../environment/global-scope.ts)
constructs and retains its timer state using the UserAgent's timer host.

The [worker subsystem](../workers/ROADMAP.md) owns its interfaces, lifetime,
creator-side thread, inside runtime, and private transport protocol together.
JS Engine owns native thread/channel operations; Web IDL composition registers
the existing package entry and supplies the inside environment factory.

Fetch owns request processing and stream delivery. The network adapters own
connections, TLS, native I/O, and compression facilities. Their separate network
entry point lets composition use task facilities without loading the transport.
