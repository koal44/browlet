# DOM events roadmap

## Present

- `event.ts`: `Event`, `CustomEvent`, initialization dictionaries,
  construction, dispatch state, and `composedPath()` (DOM §§2.2 and 2.4–2.5).
- `event-target.ts`: `EventTarget`, listener records, dispatching, and firing
  (DOM §§2.7 and 2.9–2.10), including shadow-tree retargeting, passive and
  once listeners, activation hooks, callback-realm invocation, and trusted
  host-created events.
- `ui-event.ts`: the currently required UI Events specializations.

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
| `dom/abort/` and existing `event-target.ts` | Bind `AddEventListenerOptions.signal` as `AbortSignal` and remove listeners with internal abort algorithms, which run before the signal's public `abort` event | DOM §§2.7 and 3.2 |
| `performance/` and the event binding | Produce every public event timestamp from the event's relevant global and shared coarse high-resolution clock | DOM §2.5; High Resolution Time |
| `browsing/window/` | Own the legacy Window `event` attribute and default-passive Window/Document/body targets | DOM §§2.3 and 2.7 |
| concrete HTML elements | Supply activation, legacy pre-activation, and canceled-activation behavior only for the elements that define it | DOM §§2.7 and 2.9; HTML |
| `scripting/` and Web IDL | Prepare/clean up callback execution and report listener exceptions in the callback's realm | DOM §2.9; HTML §8.1; Web IDL callbacks |
| `performance/` | Record event-listener timing when the Event Timing and Long Animation Frames producers exist | DOM §2.9; Event Timing; Long Animation Frames |
| workers/service workers | Apply the late-listener warning and legacy fetch-listener inspection at their specified globals | DOM §§2.7–2.8; Service Workers |

The two abort tests that spy on native `AbortSignal.addEventListener()` encode
the temporary mechanism, not the DOM contract. Replace them while implementing
§3 with public behavior that proves an already-aborted signal suppresses
registration, abort removes a live listener, and internal abort algorithms run
before `abort` event listeners.

The test which directly exercises activation virtuals is useful only as a
temporary integration seam. Replace it with observable element activation
coverage when the first HTML activation consumer lands.

The legacy Window event extensions in DOM §2.3 belong with Window projection,
not in the generic event implementation. Blink similarly separates generic
events (`core/events`) from Window/frame ownership (`core/frame`).

HTML's `ErrorEvent`, `PromiseRejectionEvent`, and `MessageEvent` reuse this
event machinery but remain owned by `scripting/` and `communication/`. Generic
dispatch must not acquire their payload, realm, or task-delivery state.

Dispatch and firing stay synchronous. HTML, Fetch, timers, workers, and other
producers own any task that precedes the call into this machinery.

## Removal condition

Burn this file when the AbortSignal shortcut and shared-time source are gone,
and each exercised host hook has an observable owner without weakening the
public event contract.
