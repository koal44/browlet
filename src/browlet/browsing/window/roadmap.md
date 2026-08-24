# Window roadmap

## Present

- `window.ts`: Window implementation and its current Web IDL contributions.
- `window-proxy.ts`: stable outer identity and retargeting across navigation.
- `location.ts`: Location identity and currently supported URL accessors.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| `security.ts` | Cross-origin property descriptor/access/call checks shared by Window and Location | HTML §7.2.1.1 |
| `named-properties.ts` | Window named properties object and supported-property-name ordering | HTML §7.2.2.3 |
| `bars.ts` | `BarProp` objects | HTML §7.2.2.4 |
| `opening.ts` only if it outgrows `window.ts` | `open()`, auxiliary/top-level traversable creation, target selection, opener relationships, session-storage shed cloning, and closing | HTML §7.2.2.1; HTML §7.3; Storage |
| existing `window.ts` | Complete Window members, event-handler mixins, opener/parent/top/frame relationships | HTML §7.2.2 |
| existing `window-proxy.ts` | Complete exotic internal methods and same-origin/cross-origin switching | HTML §7.2.3 |
| existing `location.ts` | Complete navigation setters/methods, ancestor origins, and exotic internal methods | HTML §7.2.4 |

The Node/V8 global-proxy limitation remains an expected failure; do not deform
these contracts to hide it. Blink owns Window/Location in `core/frame` and the
actual V8 WindowProxy in `bindings/core/v8/window_proxy.*`, reinforcing that
the proxy is binding/engine machinery attached to—but not identical with—the
Window implementation.

`Window.postMessage()` is declared on Window but implemented by
`communication/window-messaging.ts`; it consumes the single structured-data
implementation and the target agent's event loop. It must not add a
Window-local cloning format. User activation and focus likewise associate state
with Window while retaining their algorithms under `interaction/`.

## Removal condition

Burn this file after the Window, WindowProxy, and Location observable
contracts are complete for Browlet's supported realm/navigation model.
