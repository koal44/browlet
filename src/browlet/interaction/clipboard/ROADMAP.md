# Clipboard API roadmap

## Opening review, 2026-11-05

Read [Clipboard API and events](https://w3c.github.io/clipboard-apis/) §§1–4
through the first interface boundary at
[§5.1](https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces).
The clean official checkout at _web-platform/specs/clipboard-apis was refreshed
with a fast-forward-only pull and is current at
6201fd15cf28cfefbcf3b920dd04edfc0fa61753. Its Bikeshed source is index.bs.

- §§1–2 are non-normative introduction and use cases. They distinguish
  event-driven cut/copy/paste from permission-controlled asynchronous access.
- §3 defines editable context: an editing host, textarea, or an input in one of
  the listed states. This is not a new editable-state implementation; HTML owns
  control state and editing-host discovery.
- §4 defines the system clipboard as items containing named byte representations,
  with a change count that changes on modification. Native data access and change
  notifications need a host adapter. No in-memory stand-in or new host contract
  is introduced by this reading slice.
- §5.1 is the first exposed API work: ClipboardEvent extends Event, with nullable
  DataTransfer clipboardData and a default of null. Its synthetic dispatch does
  not itself modify the clipboard or document. The example dereferences
  clipboardData without supplying it; implementation should check the actual IDL
  and browser evidence rather than copying that example.

The opening review introduced no Clipboard implementation. The §5.1 slice below
now supplies the event interface after the DataTransfer prerequisite.

## Next bounded work and ownership

Eric approved a dependency detour before implementing ClipboardEvent:

1. Review HTML [§6.11.2, the drag data store](https://html.spec.whatwg.org/multipage/dnd.html#the-drag-data-store)
   and [§6.11.3, DataTransfer](https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface),
   including DataTransferItemList and DataTransferItem. Begin with the shared data
   model and accessible string-item operations; retain explicit owner dependencies
   for operations outside that bounded slice. The [data API slice](../drag-drop/ROADMAP.md)
   now provides strings, Files, mode/lifetime checks, and all three data interfaces.
   Drag-image rendering remains an explicit throwing dependency.
2. Keep that HTML-owned model under interaction/drag-drop. Clipboard operation
   policy belongs here; ClipboardEvent follows the existing event-class foundation.
   This does not require implementing drag gestures or the whole HTML §6 chapter.
3. Clipboard §5.1 now uses real DataTransfer conversion and identity. Constructor
   and event-handler regressions exercise that data-bearing API. Native event
   production and clipboard actions remain separate owner work.

Later clipboard delivery will consume HTML focus/activation, permission decisions,
rendered selection extraction, and cut/paste editing. Those owners are unfinished.
The existing keyboard processor already calls a throwing default-action boundary;
Clipboard command integration must not turn every keydown into a clipboard action.
Introduce source-side throwing dependencies when implementing the algorithms that
need these effects. This roadmap does not substitute for those executable contracts.

The asynchronous ClipboardItem/Clipboard API is a separate later part of this
specification. It need not wait for native dragging, but still requires its own
permissions, native clipboard formats, and data-lifetime decisions.

## §5.1 ClipboardEvent, 2026-11-05

The clean official Clipboard checkout was refreshed again and remains at
6201fd15cf28cfefbcf3b920dd04edfc0fa61753. This slice implements
[§5.1](https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces):

- ClipboardEvent extends DOM Event, is exposed on Window, and uses the event
  constructor realm's timestamp. ClipboardEventInit extends EventInit.
- clipboardData defaults to null. A supplied DataTransfer is converted by Binding
  and retains its identity, mutability, and realm, including its File objects.
  Event initialization and dispatch do not clone or detach an author-owned store.
- The existing oncopy/oncut/onpaste properties and content handlers deliver these
  events without new handler definitions. DOM owns bubbling, shadow retargeting,
  and cancellation. Synthetic events do not edit the selection or start clipboard
  actions, even when listeners do not cancel them. Author-provided flags apply;
  names such as paste do not imply native flags or trusted status.
- DOM's legacy createEvent table does not include ClipboardEvent; all three
  browsers reject that name. The inherited initEvent() preserves clipboardData.

SPEC_CLASH(clipboard-event-data): follow the draft/Chromium/WebKit constructor
contract. Firefox ignores clipboardData, including invalid values, reads the
older data/dataType options, and supplies its own transfer even when the input
is omitted or null. Eric approved following the specified nullable interface
and preserving supplied identity. The draft's example dereferences omitted
clipboardData; that illustrative example does not override the dictionary's
explicit null default.

The browser-only probe is Experimental input-delivery/clipboard-event.mjs, run
on Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It does not touch the
system clipboard. It records constructor defaults/conversion order, identity,
synthetic cancellation, legacy construction, and borrowed getters.

The source-side producer TODO distinguishes DOM's generic trusted-event factory
from Clipboard's later fire-a-clipboard-event algorithm. KeyboardInputProcessor's
applyDefaultAction() still throws until editing/clipboard commands have owners.
This slice needs no fake host adapter: its constructor and synthetic dispatch
require no system clipboard access.

Validation: all 17 focused ClipboardEvent regressions pass on custom Node 27,
Node 24.19.0, and Node 26.8.1, each stock and compat. No expected failures or
skips were added. Generated platform types, typecheck, type contracts, scoped
ESLint, repository-wide import boundaries, and patch whitespace checks pass.

## §5.2.1 ClipboardChangeEvent data, 2026-11-05

This bounded slice implements the interface and
[constructor steps](https://w3c.github.io/clipboard-apis/#h-clipboardchange-event-steps)
inside §5.2.1. It does not finish the subsection's native notification algorithms.
The clean local Clipboard checkout was refreshed with a fast-forward-only pull;
its head remains 6201fd15cf28cfefbcf3b920dd04edfc0fa61753.

- ClipboardChangeEvent extends Event and is exposed on Window. Its required
  type and optional init dictionary follow the draft; no event name is inferred.
- types defaults to an empty list, is cloned at construction, and projects as
  one receiver-realm FrozenArray. changeId defaults to 0n. Binding performs
  sequence/DOMString/bigint conversion, getter validation, and array allocation.
- Author values retain spelling, duplicate strings, UTF-16 text and arbitrary
  bigint magnitude/sign. Mandatory-format filtering and 128-bit identifier
  generation apply to native notifications; constructing an event does neither.
- Inherited flags, cancellation, retargeting and initEvent() use DOM machinery.
  initEvent() preserves both data fields and the frozen array's identity.
  DOM's legacy createEvent table does not gain a ClipboardChangeEvent alias.
- Synthetic construction/dispatch does not read, write, or observe the system
  clipboard. DOM's existing typed trusted-event factory can allocate the data
  object but does not implement native clipboard notification policy.

Eric approved these continuing disagreements:

- SPEC_CLASH(clipboard-change-constructor): the draft requires (type, init).
  Chromium 156 instead accepts only init and always sets type to clipboardchange.
- SPEC_CLASH(clipboard-change-exposure): the draft exposes the constructor on
  Window, including insecure contexts. Chromium exposes it only in secure
  contexts; Firefox 157 and WebKit 27.2 do not expose it yet.
- SPEC_CLASH(clipboard-change-types-identity): Web IDL's FrozenArray conversion
  retains the represented object. Keep Binding's stable receiver-realm array;
  Chromium returns a new frozen array on every access.

Experimental input-delivery/clipboard-change.mjs contains the constructor-only
browser probe. Its HTTP/HTTPS pages are intercepted locally; it neither grants
clipboard permissions nor reads/writes the system clipboard. The accompanying
CLIPBOARD-CHANGE.md records browser versions, observations and source links.

The [TAG privacy review](https://github.com/w3ctag/design-reviews/issues/1017#issuecomment-2774608569)
requires real notifications to retain focus/activation gates and coalesce
unfocused changes; it favors format metadata over clipboard content access.
The [specification review](https://github.com/w3c/clipboard-apis/pull/239)
also discusses storage partitioning of change IDs. Neither discussion supplied
an explicit rationale for restricting the synthetic constructor to HTTPS.
Consistent exposure with the secure Clipboard interface is an inference, not a
stated constructor-specific rationale. Synthetic constructor exposure does not
settle the secure-context eligibility of future native notifications.

Validation: all 13 new data/binding regressions and 17 existing ClipboardEvent
regressions pass on custom Node 27, Node 24.19.0 and Node 26.8.1, each in stock
and compat mode. No skips or expected failures were added. Generated platform
declarations, typecheck, type contracts, scoped ESLint, import boundaries and
patch whitespace checks pass.

## Next: remaining §5.2.1 notification algorithms

The data interface is now implemented. Before moving to §5.2.2, implement the
remaining notification/focus algorithms and storage-key-specific changeId. Their
executable dependencies must cover
observing the system clipboard, obtaining mandatory formats and a changing
global identifier, system focus, sticky activation/clipboard-read permission,
and storage-key-based hashing. Document focus replay and pending notifications
need an explicit owner connection before those algorithms can be claimed.

The draft currently fires at the relevant global, but its example listens on
navigator.clipboard. Review that target disagreement and actual browser behavior
before selecting the notification contract; do not infer a target from the example.
The native copy/cut/paste producers and asynchronous Clipboard API follow later.

The dependency audit found reusable Window.hasStickyActivation(),
StorageKey.obtainForNonStoragePurposes(), and JS Engine.computeHash().
Document.hasFocus() already throws for unfinished HTML focus tracking; there is
no completed focus-gain notification connection. The Permissions store has no
clipboard-read feature yet. Native mandatory-format discovery, change observation,
and a per-clipboard-state identifier have no host adapter. These requirements
remain a source-side producer TODO at ClipboardChangeEventImpl; this slice does
not add a callable notification algorithm with guessed answers. The next slice
must establish its owner and provide named throwing dependencies where needed.

Change-ID generation also needs a deliberate storage-key byte representation.
Current StorageKey equality uses origins, including distinct opaque-origin Symbol
identities; serializing every opaque origin to the string null would collapse
unrelated keys. Reuse storage ownership rather than inventing identity in the
event data object. Review focus-replay eligibility as well: the written replay
steps do not repeat the activation/permission gate, while Blink does.
