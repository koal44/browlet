# Worklets roadmap

HTML §11 defines specification infrastructure, not a directly constructible
general-purpose worker. Concrete specifications such as CSS Painting and Web
Audio create particular `Worklet` instances, global-scope subclasses,
registration APIs, and invocation rules. Browlet should implement this base
only when the first concrete consumer can prove it.

## Architecture constraints to preserve now

- One `Worklet` owns zero or more `WorkletGlobalScope` objects. Each scope has
  its own realm, false-`[[CanBlock]]` agent, event loop, module map, and
  environment settings object. Never equate a Worklet with one persistent
  global or realm.
- Worklet agents can be scheduled on any suitable host thread. Their HTML
  identity and queues remain separate even if Node executes several agents on
  one thread.
- Worklet settings inherit the creator's API base URL and a cloned policy
  container, but use a unique opaque origin, always report a cross-site
  ancestor, and expose no time origin. They are intentionally not reduced
  Window settings objects.
- Worklets load module scripts only. A Worklet retains an ordered added-modules
  list and a shared module-responses map so every existing scope evaluates the
  same source and every later replacement scope can replay it without a new
  network fetch.
- `addModule()` resolves only after the module has run in every current scope.
  Fetch, evaluation, failure, and final promise settlement cross explicit
  networking tasks between the outside global and each worklet global.
- A worklet event loop only coordinates `addModule()` tasks, host invocation of
  author-defined methods, and microtasks. It does not inherit the full Window
  rendering/event task surface.
- A Document owns the set of worklet globals created on its behalf. Destroying
  the Document terminates them; a concrete worklet specification may also
  create or terminate scopes at any time. Code that assumes durable per-scope
  state is therefore invalid for worklet types that require idempotence.
- A concrete worklet type supplies its Web IDL global-scope subclass, Fetch
  destination, registration surface, invocation algorithm, and any stronger
  lifetime guarantee. Those pieces stay with the consuming subsystem rather
  than accumulating in this generic directory.
- Web IDL projection uses `Worklet` and the concrete worklet's global name,
  together with `SecureContext`. Do not install concrete APIs by probing the
  global object at runtime.

The existing `WorkletAgent.globalScope` slot in `scripting/agents.ts` is
correctly one scope per agent. The future `Worklet` object—not the agent—owns
the collection of agents/scopes.

## Planned ownership

| Planned source | Contract | Specification |
| --- | --- | --- |
| `worklet-global-scope.ts` | Base global object and per-scope module map | HTML §11.3.1 |
| `worklet.ts` | `Worklet`, `WorkletOptions`, scope collection, added-modules list, shared response map, and `addModule()` | HTML §11.3.2 |
| `processing-model.ts` | Scope creation/termination, environment settings, module replay, task coordination, and Document association | HTML §§11.3.1.1–11.3.1.3 and 11.3.3 |
| `web-idl.ts` | Base Worklet interfaces, dictionary, exposure, and global names | HTML §11.3 |

`scripting/environment.ts`, `scripting/agents.ts`, the module loader, Fetch,
and the event loop provide the shared machinery. This directory coordinates
those facilities but does not duplicate them.

Blink keeps the generic Worklet and WorkletGlobalScope beside its worker
execution infrastructure, while concrete paint, animation, layout, audio, and
shared-storage worklet scopes remain in their owning subsystems. Browlet's
smaller source tree can use a separate `worklets/` domain while preserving that
same ownership distinction.

## Delivery order

1. Wait for module-graph fetching, environment-targeted tasks, and disposable
   realm/event-loop teardown.
2. Implement the base Worklet records and choose one concrete worklet consumer
   to define the global type, destination, registration, and invocation hook.
3. Test at least two scopes, one network fetch, evaluation in every scope,
   late scope creation with module replay, and scope destruction/recreation.
4. Connect Document destruction and concrete subsystem lifetime rules.

## Removal condition

Burn this file after a concrete worklet type proves multi-scope creation,
module replay, task routing, invocation, and Document-owned teardown.
