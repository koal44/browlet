# DOM events roadmap

## Present

- `event.ts`: `Event`, `CustomEvent`, initialization dictionaries,
  construction, dispatch state, and `composedPath()` (DOM §§2.2 and 2.4–2.5).
- `event-target.ts`: `EventTarget`, listener records, dispatching, and firing
  (DOM §§2.7 and 2.9–2.10), including shadow-tree retargeting, passive and
  once listeners, activation hooks, callback-realm invocation, and trusted
  host-created events. Signal-bound listeners use Browlet `AbortSignal`
  implementations and internal abort algorithms, which remove listeners
  before the signal's public `abort` event.
- [ui-event.ts](ui-event.ts): UIEvent and MouseEvent identities, defined by
  UI Events and used by DOM click activation. These extensions share the
  events component; their platform declarations remain unfinished.
- `error-event.ts` and `promise-rejection-event.ts`: HTML event payloads and
  Web IDL declarations. Scripting owns their reporting and notification algorithms.

[ProgressEvent](../../integration/xhr/progress-event.ts) belongs to XHR
integration and is also used by FileReader. It imports DOM's shared event
machinery; DOM does not collect its declarations.

[`DOMEnvironment`](../environment.ts) pairs `DOMRealm` with `DOMExecution` for
the whole DOM subsystem. The realm supplies timestamps and the associated-document
query; `WindowDOMRealm` adds current-event operations and the shared Window Agent.
Non-Window globals return null for the associated document; Window-exposed node
constructors use the Window's document. HTML's realms implement these alongside
Web IDL's independent realm contract. `DOMExecution` supplies event allocation;
Browlet composes it with `RealmExecution` on the same `env.exec` object. These
contracts describe existing owners, not additional runtime objects.
Binding supplies the listener's associated realm, which can differ from the
event target's realm.
The listener adapter handles author invocation and exception reporting;
dispatch manages event state around that call.

Targets receive their owning environment during construction. Window composition
prepares the environment and execution before constructing its implementation.

The public Browlet tests already cover realm-specific constructors, trusted
event creation, callback-interface identity, legacy `Window.event`, exception
reporting, and Web IDL dictionary access order. Lower-level tests cover the
dispatch path and shadow retargeting.

## Audit corrections

DOM §2.6 (`#defining-event-interfaces`) is guidance to other specification
authors, not a runtime component. Event-subclass construction steps should
remain with each subclass's declarative binding unless two real consumers
justify a shared helper; do not create `event-definition.ts` merely to mirror
the heading.

DOM §2.8 listener observation is an extension point. `EventTargetImpl` already
has addition/removal and default-passive hooks. A concrete Window, input,
worker, or service-worker consumer should implement the behavior it owns; do
not add a generic `listener-observation.ts` registry in advance.

## Remaining closure

| Owner | Contract | Specification |
| --- | --- | --- |
| `browsing/window/` and elements | Extend the existing Window.event/default-passive integration with complete body/element targets | DOM §§2.3 and 2.7 |
| concrete HTML elements | Supply activation, legacy pre-activation, and canceled-activation behavior only for the elements that define it | DOM §§2.7 and 2.9; HTML |
| `scripting/` | Complete runtime-error attribution and worker propagation; connect native rejection notifications and checkpoint delivery | DOM §2.9; HTML §8.1; Web IDL callbacks |
| `performance/` | Record event-listener timing when the Event Timing and Long Animation Frames producers exist | DOM §2.9; Event Timing; Long Animation Frames |
| workers/service workers | Apply the late-listener warning and legacy fetch-listener inspection at their specified globals | DOM §§2.7–2.8; Service Workers |

The activation dispatch test uses an implementation subclass until HTML
supplies a concrete consumer. Add observable element activation coverage
when that consumer lands.

The legacy Window event extensions in DOM §2.3 belong with Window projection,
not in the generic event implementation. Blink similarly separates generic
events (`core/events`) from Window/frame ownership (`core/frame`).

HTML's `ErrorEvent` and `PromiseRejectionEvent` implementations live here;
their producers remain owned by `scripting/`. `MessageEvent` remains future
`communication/` work. Generic dispatch must not acquire their payload, realm,
or task-delivery state.

Dispatch and firing stay synchronous. HTML, Fetch, timers, workers, and other
producers own any task that precedes the call into this machinery.

## Removal condition

Burn this file when each remaining exercised host hook has an observable owner
without weakening the public event contract.
