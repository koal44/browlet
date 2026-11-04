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
- `error-event.ts` and `promise-rejection-event.ts`: HTML event payloads and
  Web IDL declarations. Scripting owns their reporting and notification algorithms.

[ProgressEvent](../../integration/xhr/progress-event.ts) belongs to XHR
integration and is also used by FileReader. It imports DOM's shared event
machinery; DOM does not collect its declarations.

[Navigation event interfaces](../../browsing/navigation/events/ROADMAP.md)
likewise retain their navigation owner. The payload foundation is below DOM
nodes so Document's legacy factory can construct HashChangeEvent and
BeforeUnloadEvent without loading navigation. PopStateEvent is not in that table.
Event's boolean `returnValue` binding adapts its cancellation state independently
of BeforeUnloadEvent's string attribute. The base implementation's
`isBeforeUnloadEvent()` predicate supports HTML's connected special handler processing.

[`DOMEnvironment`](../environment.ts) requires a `DOMRealm` and `createEvent()` for
the whole DOM subsystem. The realm supplies timestamps and the associated-document
query; `WindowDOMRealm` adds current-event operations and the shared Window Agent.
Non-Window globals return null for the associated document; Window-exposed node
constructors use the Window's document. HTML's realms implement these alongside
Web IDL's independent realm contract. The environment supplies event allocation
directly through a function provided by Browlet's binding composition. These
contracts describe existing owners, not additional runtime objects.
Binding supplies the listener's associated realm, which can differ from the
event target's realm.
The listener adapter handles author invocation and exception reporting;
dispatch manages event state around that call.

Targets receive their owning environment during construction. Window composition
prepares the environment before constructing its implementation.

The public Browlet tests already cover realm-specific constructors, trusted
event creation, callback-interface identity, legacy `Window.event`, exception
reporting, and Web IDL dictionary access order. Lower-level tests cover the
dispatch path and shadow retargeting.

## UI Events and Pointer Events audit

The [interaction events roadmap](../../interaction/events/ROADMAP.md) owns the
UI Events reading inventory and event hierarchy. UIEvent's interface and
initializers live there, alongside the still-incomplete MouseEvent identity.
DOM dispatch uses `Event.isMouseEvent()` plus the event type to select click
activation. Only type references connect DOM's foundation to those event classes.

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

HTML §8.1.8.1's `eraseAllEventListenersAndHandlers()` uses the existing removal
path after deactivating the target's shared `eventHandlers` map. Concrete targets
construct their map with one complete shared definition table; records are
allocated on first assignment or content-attribute input. Definition groups are
composed once per target type. GlobalEventHandlers and WindowEventHandlers are now
declaration-only: their bindings use the target resolver and map directly.
Erasure is inherited without
target-specific overrides. The HTML map is a type-only dependency, and targets
without handlers retain null. The separate DOM
`removeAllEventListeners()` operation does not reset handler values. Selection
of descendants and the associated Window remains with `document.open()` in
HTML §8.4; see the [handler audit](../../scripting/ROADMAP.md#erasing-listeners-and-handlers).

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
their producers remain owned by `scripting/`. `MessageEvent` retains its
`communication/` owner. Generic dispatch must not acquire their payload, realm,
or task-delivery state.

Dispatch and firing stay synchronous. HTML, Fetch, timers, workers, and other
producers own any task that precedes the call into this machinery.

## Removal condition

Burn this file when each remaining exercised host hook has an observable owner
without weakening the public event contract.
