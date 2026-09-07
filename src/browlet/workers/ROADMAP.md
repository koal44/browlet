# Workers roadmap

HTML §10 workers are not a prerequisite for Browlet's first single-Window
lifecycle, but they are an early proof of the execution boundaries established
by `scripting/`, `loader/`, and `communication/`. They must reuse those
boundaries instead of creating a worker-specific scheduler, script loader, or
structured-clone implementation.

## Present

- `service-worker-global-scope.ts` implements only the DOM legacy-listener
  warning hook needed by current event-listener behavior. Full service workers
  are owned by the Service Workers specification, not HTML §10.
- `scripting/agents.ts` reserves dedicated- and shared-worker agent types with
  the specified true `[[CanBlock]]` value. It does not yet obtain those agents
  or run workers.

## Execution and lifetime constraints

- A dedicated worker gets a new agent in its creator's agent cluster. A shared
  worker gets a new origin-keyed agent cluster. Every worker still owns a
  distinct worker event loop; neither arrangement means sharing the creator's
  queues or realm.
- Creating a worker establishes the agent, realm, `WorkerGlobalScope`, worker
  environment settings object, and inside/outside `MessagePort` pair around a
  Fetch-backed classic script or module graph. Fetch and script parsing may do
  realm-neutral work in parallel, but success and failure return through named
  tasks on the appropriate outside or worker global.
- `WorkerGlobalScope` owns its URL, type, name, owner set, policy container,
  embedder policy, module map, cross-origin-isolated capability, and closing
  flag. `WorkerLocation` and `WorkerNavigator` are stable worker-global objects,
  not aliases for their Window counterparts.
- A worker's owner is the creating `Document`, or the creating
  `WorkerGlobalScope` for a nested worker. Active-needed, protected,
  permissible, and suspendable state derives transitively from those owners,
  fully-active Documents, entangled ports, timers, database transactions, and
  network connections. JavaScript wrapper reachability alone is insufficient.
- Closing discards already-queued tasks and sets a flag that prevents new tasks
  from entering the worker queues. Termination additionally aborts the running
  script and clears the dedicated worker's pending outside messages. These are
  different lifecycle operations.
- Dedicated-worker messaging is the implicit entangled port. Shared workers
  receive one port per connection and are discovered by storage key, URL, and
  name through a serialized shared-worker manager. That manager is not a
  process-wide name-only registry.
- Worker realms must be projected with their Web IDL global names
  (`Worker` plus `DedicatedWorker` or `SharedWorker`). Exposure must continue to
  flow through Web IDL rather than ad hoc constructor installation.

## Planned ownership

| Planned source | Contract | Specification |
| --- | --- | --- |
| `worker-global-scope.ts` | Common worker-global state, `self`/`location`/`navigator`, event handlers, closing, and `importScripts()` | HTML §§10.2.1.1, 10.2.2, and 10.3 |
| `dedicated-worker-global-scope.ts` | Name, implicit inside port, `postMessage()`, `close()`, and `MessageEventTarget` behavior | HTML §10.2.1.2 |
| `shared-worker-global-scope.ts` | Name, constructor identity fields, extended lifetime, `close()`, and connection events | HTML §10.2.1.3 |
| `worker.ts` | `Worker`, options/type declarations, outside port, construction, messaging, and explicit termination | HTML §10.2.6.3 |
| `shared-worker.ts` | `SharedWorker`, options, exposed port, and connection to an existing or new shared global | HTML §10.2.6.4 |
| `shared-worker-manager.ts` | Serialized storage-key/URL/name discovery, option compatibility, and connection dispatch | HTML §10.2.6.4; Storage |
| `lifetime.ts` if the algorithms outgrow the global-scope modules | Owner/port discovery and active-needed, protected, permissible, suspendable, close, and termination decisions | HTML §§10.2.2–10.2.3 |
| `processing-model.ts` | Agent/realm/settings creation, worker-script fetching and execution, queue enablement, monitoring, and teardown | HTML §§10.2.4–10.2.5 |
| `worker-location.ts` | Immutable URL view over a worker global's final response URL | HTML §10.3.3 |
| `web-idl.ts` | Worker interfaces, dictionaries, mixins, global names, and exposure contributions | HTML §10 |

Worker settings extend `scripting/environment.ts`; worker-agent acquisition
extends `scripting/agents.ts`; `WorkerNavigator` and its shared capability
mixins belong under `navigator/`. Keeping those owners explicit prevents the
worker processing model from turning into a second browser kernel.

Worker messaging consumes `communication/message-port.ts` and
`scripting/structured-data/`. The outside port queue stays disabled until the
worker script has loaded; shared-worker `connect` events and all cross-agent
messages are queued through the destination event loop.

Node `worker_threads` can eventually supply an execution backend, but it must
not define public identity, task ordering, lifetime, or error propagation.
Blink similarly separates worker globals and messaging proxies from execution
threads, script loading, and storage-backed shared-worker discovery.

## Delivery order

1. Complete task sources, environment-targeted queuing, MessagePort transfer,
   and classic/module script fetching.
2. Implement worker settings/global construction and the dedicated-worker
   path, including realm exposure, inside/outside ports, errors, close, and
   terminate.
3. Add owner-derived lifetime and Document-destruction behavior before relying
   on garbage collection or host-thread exit.
4. Add storage-key derivation and the serialized shared-worker manager, then
   shared connection, mismatch, and extended-lifetime behavior.
5. Complete `importScripts()`, `WorkerNavigator`, `WorkerLocation`, and the
   remaining global event surfaces over the same machinery.

## Removal condition

Burn this file after dedicated/shared workers have tested realm, messaging,
event-loop, owner-derived lifetime, and termination behavior, and
service-worker work has its own specification roadmap.
