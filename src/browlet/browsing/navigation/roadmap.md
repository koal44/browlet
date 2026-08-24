# Navigation roadmap

## Present

- `session-history.ts` models the history/document-state records needed by the
  active top-level traversable.
- `navigation.ts` implements the bounded route-backed cross-document
  navigation and push/replace path.

## Missing

| Planned source | Contract | Specification |
| --- | --- | --- |
| `history.ts` | `History`, `ScrollRestoration`, state serialization through `scripting/structured-data/`, length/state/go/back/forward, and push/replace state | HTML §7.2.5 and §2.7 |
| `navigation-api.ts` | `Navigation`, results/options, destination, entries, ongoing navigation, intercept/precommit controllers, transition, activation, and focus/scroll behavior | HTML §7.2.6 |
| `navigation-history-entry.ts` | `NavigationHistoryEntry`, keys/IDs/state, disposal, and same-document identity | HTML §7.2.6 |
| `navigation-events.ts` | `NavigateEvent`, current-entry-change, navigate success/error, destination and intercept/precommit callback surfaces | HTML §7.2.6 |
| `lifecycle-events.ts` | `PopStateEvent`, `HashChangeEvent`, `PageSwapEvent`, `PageRevealEvent`, `PageTransitionEvent`, and `BeforeUnloadEvent` | HTML §7.2.7 |
| `not-restored-reasons.ts` | `NotRestoredReasonDetails`, recursive `NotRestoredReasons`, and history-entry association | HTML §7.2.8 |
| `traversal.ts` | Traversal queue, apply history step, back/forward/reload | HTML §§7.4.1, 7.4.3, and 7.4.6 |
| `document-state.ts` if records outgrow session-history.ts | Complete document/session-history state and persisted user state | HTML §§7.4.1–7.4.2 |

Existing modules still need fragment navigation, `javascript:` URLs,
download/POST handling, nested navigables, reload, traversal, unloading,
ongoing-navigation cancellation, and full history-step application (HTML
§7.4).

All push, replace, traversal, reload, and cross-/same-document commits must
converge on the centralized session-history modification and history-step
algorithms. Public History or Navigation methods must not mutate the arrays
directly, even while only a single top-level traversable is supported.

Blink spreads this path across `core/frame` and `core/loader`; Browlet keeps
the state machine here while response acquisition and resource loading belong
in `loader/`.

## Removal condition

Burn this file once all supported navigation kinds share the specified
history-step machinery and the public History/Navigation APIs exist.
