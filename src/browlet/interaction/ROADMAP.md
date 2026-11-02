# User interaction roadmap

HTML §6 combines several independent interaction systems. Keep their shared
cross-document state under `interaction/`, but do not turn the chapter into one
large manager or make input, editing, and drag-and-drop prerequisites for the
Document lifecycle.

## Constraints to preserve early

- Page visibility is mutable Document state initialized from the top-level
  traversable's system visibility state. Visibility transitions must run one
  ordered integration algorithm, fire `visibilitychange`, and create a
  `VisibilityStateEntry`; they are not inferred from whether a Window exists.
- A Window owns last-activation and last-history-action-activation timestamps.
  Activation notification and consumption operate across related navigables,
  so a process-global or element-local `isActive` boolean cannot implement the
  model.
- User activation and element activation are different systems. DOM event
  dispatch needs a narrow activation-behavior hook, while HTML elements own
  the action that hook invokes; neither should be encoded as a synthetic
  `click()` listener.
- Focus is a chain through focusable areas, Documents, shadow trees, child
  navigables, and the top-level traversable. `activeElement`, `hasFocus()`,
  autofocus, and Window focus must derive from that shared model rather than
  maintain independent answers.
- Inertness is a shared predicate consumed by focus, event targeting, text
  selection, find-in-page, editing, and accessibility. The `inert` and
  `hidden=until-found` attributes must not be approximated as CSS-only state.

Visibility initialization is reached by the current navigable skeleton and
should be connected while completing lifecycle. User activation enters before
activation-gated navigation or popup behavior; cross-document focus enters
with nested browsing. The rest of this chapter can wait for interaction work.

DOM event dispatch already provides overridable activation methods.
Section 6 work supplies the HTML element behaviors, commands, and
user-activation consequences.

## Planned ownership

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `visibility.ts` plus `performance/visibility.ts` | Document visibility state, initial/update steps, `visibilitychange`, and `VisibilityStateEntry` | HTML §6.2 |
| `inertness.ts` plus `html/global-attributes.ts` | Inert subtrees, modal blocking, `inert`, and `hidden=until-found` integration | HTML §§6.1 and 6.3 |
| `user-activation.ts` | Window activation timestamps, notification/consumption propagation, `UserActivation`, the Navigator contribution, and automation hooks | HTML §6.4 |
| `activation.ts` | HTML element activation behavior, command/invoker resolution, and use of the existing DOM click-dispatch hook | HTML §6.5 |
| `events.ts` | `ToggleEvent`, `CommandEvent`, and their initialization dictionaries | HTML §6.5 |
| `focus.ts` | Focusable-area model, focus chains, `tabindex`, `FocusOptions`, `activeElement`, `hasFocus()`, autofocus, and Window/element focus APIs | HTML §6.6 |
| `access-key.ts` | `accesskey`, label selection, assignment, and invocation | HTML §6.7 |
| `editing.ts` plus `html/global-attributes.ts` | `ElementContentEditable`, editing hosts, selection/editing commands, spellcheck, writing suggestions, autocapitalization, autocorrection, `inputmode`, and `enterkeyhint` | HTML §6.8 |
| `find.ts` | Find-in-page, `hidden=until-found`, details/dialog interaction, and selection updates through a user-agent search capability | HTML §6.9 |
| `close-watcher.ts` | Window close-watcher manager, internal watcher records, `CloseWatcher`, activation gating, abort integration, and close/cancel events | HTML §6.10 |
| `drag-drop/` | Drag data store, `DataTransfer`, item/list objects and callbacks, `DragEvent`, security modes, and input-event processing | HTML §6.11 |
| `popover.ts` | Popover state, top-layer transitions, invoker relationships, light dismiss, and `PopoverTargetAttributes` | HTML §6.12 |

For §6.11.5's `application/microdata+json` entry, use
[`extractMicrodataJSON(nodes)`](../html/microdata/json.ts) with the dragged node list.
The extractor is implemented; creating the drag data store entry remains drag-and-drop work.

`ToggleEvent`, `CommandEvent`, `DragEvent`, and `CloseWatcher` use Browlet's DOM
event machinery but remain HTML-owned interfaces. Generic event dispatch must
not acquire their state. Likewise, `VisibilityStateEntry` uses the shared
Performance timeline while the visibility transition itself remains an HTML
lifecycle concern.

## History-action activation dependency

Navigation event cancellation now uses Window's two retained activation
timestamps, `hasHistoryActionActivation()`, and
`consumeHistoryActionUserActivation()`. Consumption covers the active Windows
of the top-level traversable, including nested and shadow-tree navigables of
other origins. Document's `getInclusiveDescendantNavigables()` supplies that tree
with parents before children, including the top-level Window first; the
Window methods keep this foundation below the full interaction subsystem.

The timestamps still have no input-event or automation producer. Activation
notification must select ancestors and same-origin descendants, record current
high-resolution time, and notify close watchers before dispatch. Transient
duration/expiry/consumption, sticky activation, `UserActivation`/Navigator, and
the WebDriver notification hook remain §6.4 work. Tests supply activation times
directly; this does not claim that a click or an automation request activates a Window.

## Focused-area dependency

HTML §3.1.2 exposes `DocumentOrShadowRoot.activeElement`; its implementation
follows the [§6.6 getter](https://html.spec.whatwg.org/multipage/interaction.html#dom-document-activeelement)
in the DOM mixin. `focus.ts` currently describes only the focused area's DOM
anchor, which can be a Document (viewport) or an Element (including a control
subpart). It does not yet model the focusable area kinds or their lifecycles.

`Document.focusedArea` is an explicit throwing dependency. Replace that stub
with the shared focus state when implementing initialization, focusing and
unfocusing, removal/inertness fixup, focus events, and the navigable focus chain.
Keep the focused area distinct from the top-level traversable's system focus:
an inactive document can retain its focused area. `activeElement`, `hasFocus`,
selector state, and focus APIs must consume that same model.

The active-element tests supply only this missing state. Ordinary public
`activeElement` reads still throw, and no focus/blur API has been approximated.

Navigation's §7.2.6.10.5 finishing policy now consumes
`NavigationImpl.focusChangedDuringOngoingNavigation` before considering automatic
reset. Focus update steps must produce that flag; tests currently supply it.
Automatic reset still throws after its guards. Its remaining sequence is
autofocus delegate, body/document-element fallback, focusing with a viewport
fallback, then moving the sequential focus navigation starting point. Keep this
on the shared focus model, including focus-event reentrancy and Document teardown.
Fragment scrolling has a separate focusing step; manual navigation focus reset
does not suppress that step.

## Removal condition

Burn this file once visibility, activation, focus, and inertness have shared
state models and every deferred interaction family has implemented source or a
narrower surviving roadmap.
