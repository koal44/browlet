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

## §5.2.1 notification algorithms, 2026-11-05

SystemClipboard now implements the subsection's firing, focus-replay and
change-ID algorithms. UserAgent lazily owns the controller and its random
session value. Document owns the pending flag; no listener or Document registry
is introduced. Native routing supplies each recipient explicitly through
queueChange(document). Both change and focus entries queue user-interaction
tasks associated with that Document, so native callbacks do not invoke author
code directly. Full inactivity clears deferred replay; destruction also removes
queued Document tasks through the existing lifecycle cleanup.

Delivery requires a secure, fully active Document with sticky activation or
persistent clipboard-read consent. Unfocused changes set one pending flag
without reading clipboard state. On focus replay, the flag clears before the
eligibility/focus recheck and before listeners. Losing focus again restores the
flag; withdrawn consent drops the replay. A current focused notification also
satisfies an earlier pending change. The event is trusted, targets Window, and
has bubbles/cancelable/composed all false. Only text/plain, text/html and
image/png enter its types list; unknown/optional formats are excluded.

readChangeState() requires canonical MIME types and a per-write token from one
native snapshot. generateChangeId(document, token) takes that captured token
explicitly instead of rereading native state inside the draft's one-argument
algorithm. This prevents formats and ID from describing different writes.
SHA-256 combines the UA session value, a length-delimited native token and the
StorageKey byte representation; the first 128 bits become the bigint result.
Equal keys in one UserAgent receive equal IDs for the same write, while new
writes and UserAgent lifetimes change them. Native tokens must change even for
identical content or clearing the clipboard; content hashes cannot replace them.

Storage owns toBytes(), alongside key equality. Tuple origins use their stable
serialization without document.domain relaxation. Opaque origins carry their
own random UUID identity, so Storage encodes that value directly without a
WeakMap or second token. This adopts the narrow identity and map-key changes
from Pip's worker commit 9e2db54a; copied/transported origins retain equality,
while public origin serialization remains null. Worker transport and the broader
origin-copy helpers remain on Pip's branch for consolidation. Future key partition
components must update equality and encoding together. This uses the current
origin-only Storage model; it does not claim additional partitioning.

Eric approved these continuing choices:

- SPEC_CLASH(clipboard-change-target): use the written relevant-global target,
  Window. Blink and the draft's example instead use navigator.clipboard.
- SPEC_CLASH(clipboard-change-native-eligibility): secure/full-activity checks
  gate native delivery; the written Window-target algorithm omits them. Blink
  receives through its secure Clipboard owner. Synthetic constructor exposure
  retains the separately approved draft behavior on HTTP.
- SPEC_CLASH(clipboard-change-focus-recheck): repeat activation/permission checks
  on replay, as Blink does; the draft's replay omits that gate.
- SPEC_GAP(clipboard-change-task-source): the draft does not name a task source.
  The approved integration uses the recipient's user-interaction task source.

Blink's [controller source](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/clipboard/clipboard_change_event_controller.cc)
provides the target, focus and permission evidence. This is source inspection,
not a native-notification browser probe. No system clipboard contents were read
or written during this slice.

### Explicit remaining dependencies

- SystemClipboard.readChangeState() throws until a host adapter provides native
  format mapping and one per-write token. Native observation registration and
  routing to Documents are called out at queueChange(); no OS listener exists.
- SystemClipboard.hasPersistentReadPermission(document) throws until the
  permission owner supplies existing consent without prompting. The draft's
  §9 registers clipboard-write, not a persistent clipboard-read feature; its
  transient Paste permission check is not a substitute for this decision.
- Document.hasFocus() still throws for unfinished HTML system-focus tracking.
  notifySystemFocusGained() supplies Clipboard's queued contribution, with an
  explicit TODO for HTML §6.6 to call it after a real focus transition. Visibility
  and full activity are not treated as focus signals.

The implementation tests use real platform bindings and the manual HTML event
loop, controlling only these unfinished owner effects. They cover native flags,
format filtering, snapshot consistency, activation/permission/focus gates,
reentrancy, inactive/destroyed Documents, and identifier equality/isolation.
Storage tests separately cover tuple/opaque byte encoding and returned-buffer
mutation. These local algorithms do not make native clipboard access available.

Validation after UUID alignment: all 195 focused origin, StorageKey,
agent-cluster and clipboard tests pass on custom Node 27, Node 24.19.0 and
Node 26.8.1, each in stock and compat mode. The new host-transport regression
first failed with DataCloneError for the old Symbol; it now preserves identity
and public null serialization. The suite includes 20 new notification/identifier
tests and six new key-encoding cases, with no skips or expected failures.
Generated platform declarations, typecheck, type contracts, scoped ESLint,
import boundaries and patch whitespace checks pass.

## §§5.2.2–5.2.4 trusted delivery, 2026-11-05

This slice implements the event-delivery portion of the
[copy](https://w3c.github.io/clipboard-apis/#clipboard-event-copy),
[cut](https://w3c.github.io/clipboard-apis/#clipboard-event-cut), and
[paste](https://w3c.github.io/clipboard-apis/#clipboard-event-paste) definitions,
following their references to §8 and the Appendix's
[fire a clipboard event](https://w3c.github.io/clipboard-apis/#to-fire-a-clipboard-event)
algorithm. It does not complete the §8 actions. The local official spec remains
at 6201fd15cf28cfefbcf3b920dd04edfc0fa61753, refreshed earlier today.

SystemClipboard.fireEvent(type, document) runs synchronously inside a later
admitted action's task. An inactive Document or absent target produces no event.
Otherwise it dispatches a trusted, bubbling, cancelable, composed ClipboardEvent.
DOM still owns propagation, shadow retargeting, listener exception reporting and
cancellation. The operation neither grants permission nor performs a default
action. No keyboard, menu or execCommand caller is connected yet.

Eric approved these concrete contracts:

- Replace the draft's implicit event/items/clear variables with a result containing
  cancellation, copied item data, clearWasCalled and typesToClear. These are the
  inputs the §8 action needs after author access has ended. Files retain their
  existing identity; the result does not retain DataTransfer or its item objects.
- ClipboardDataTransferImpl specializes HTML's DataTransfer only for native
  dispatch. Existing Binding projects that subclass as the ordinary DataTransfer
  interface; it adds no Web IDL interface, registry or state to other transfers.
- Copy/cut start with empty writable stores and do not read existing native data.
  Paste receives one materialized, decoded snapshot in read-only mode. Sequence
  changes revoke paste data access permanently for that dispatch. This uses the
  already required native change-state token. Without a sequence token, the store
  contains only captured data and has no way to read future clipboard contents.
- Strings, item records and the sequence token are captured on entry. Retained
  host records cannot change the data being dispatched. Author getters, item
  methods and lists continue through normal Binding conversion and realm rules.
- In a finally block, detach the native transfer and disable its saved items and
  live lists. Captured strings/Files and already queued getAsString callbacks keep
  their HTML-defined lifetime. Author-created transfers are never detached by
  generic synthetic ClipboardEvent dispatch.

SPEC_GAP(clipboard-event-access-lifetime): the Appendix does not specify when
post-dispatch access ends. Follow Blink/Gecko/WebKit by revoking it before returning
from native delivery. Browlet uses the existing HTML detach behavior, including
its previously approved disabled item metadata and captured callback lifetime.

SPEC_GAP(clipboard-clear-formats): the Appendix does not explain how its extra
clear bookkeeping interacts with HTML's format normalization or a later clear-all.
Use lowercase and text/URL aliases for clearData, as HTML's data methods do.
Duplicate per-format clear requests collapse; clearData()/items.clear() replace
earlier per-format requests with clear-all. Later narrower clears leave that
clear-all pending. Adding matching data removes pending
format clears; adding data after clear-all resets its flag, as the Appendix says.
An ordinary items.remove() is not a clearData request. Read-only/disabled mutations
do not contribute clear requests. Eric approved these choices.

### Browser implementation evidence

This slice inspected local sources; it did not read or write the OS clipboard or
run a native-clipboard browser probe:

- [Blink ClipboardCommands](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/editing/commands/clipboard_commands.cc),
  DispatchClipboardEvent: copy/cut use an empty writable DataObject; paste captures
  a sequence and uses readable data; delivery ends by setting the transfer numb.
- [Gecko nsCopySupport](https://searchfox.org/mozilla-central/source/dom/base/nsCopySupport.cpp),
  FireClipboardEvent, and [DataTransfer](https://searchfox.org/mozilla-central/source/dom/events/DataTransfer.cpp),
  Disconnect: use scope-exit cleanup, protected mode and item clearing. Paste data
  is explicitly cleared even when the protected-data preference is disabled.
- [WebKit Editor](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/editing/Editor.cpp),
  createDataTransferForClipboardEvent/dispatchClipboardEvent: writable static
  copy/cut data versus readable paste data, followed by makeInvalidForSecurity().

### Explicit boundary and next slice

- SystemClipboard.getEventTarget(document) throws until HTML editing and rendered
  Selection can choose the visible selection/caret container, including text
  controls, or the focused node/body fallback. Document.focusedArea is itself an
  existing throwing HTML dependency. Ordinary Range endpoints and activeElement
  cannot stand in for these decisions.
- SystemClipboard.readForPaste(document) throws until native snapshots, permitted
  format mapping/text decoding and File creation exist. Its source also names the
  Appendix's HTML processing dependency: parser/serializer work, source-relative
  URL resolution and local file/clipboard-part references. Tests supply decoded
  data only at this unfinished owner boundary; no raw HTML sanitizer is implied.
- At this delivery checkpoint, §8 action admission, default copying, native writes
  and editing were still separate work. The action slice below now connects the
  branching and leaves the actual host/rendering/editing effects explicit.

The following slice connects §5.3 admission and §6 override behavior to the
§8 action flow. Event delivery alone is not an end-to-end clipboard command.

Validation: 25 new delivery regressions plus the existing Clipboard and DataTransfer
suites (100 tests total) pass in the six supported runtime configurations. No
skips or expected failures were added. The new host-record reuse regression first
observed later data leaking into the current paste; copying the input record fixes
it. Typecheck, type contracts, scoped ESLint, import boundaries and diff checks pass.

## §5.3, §§6.1–6.3 and §8 action flow, 2026-11-05

The clean official checkout was refreshed with a fast-forward-only pull and remains
at 6201fd15cf28cfefbcf3b920dd04edfc0fa61753. The draft has §5.3 integration rules;
there is no §5.4. This slice implements those rules with §6's event overrides,
[§8 actions](https://w3c.github.io/clipboard-apis/#clipboard-actions), and the
branching in Appendix A.1's write-content algorithm.

- runAction(type, document, source) is synchronous. Its required user/script source
  determines script-triggered. Script copy/cut use the owning Window's existing
  transient-activation query; script paste consults a separate synchronous command
  permission. Denial returns false before an event or any native read/write.
  Native UI commands do not consult those script gates. Optional write grants
  beyond activation are not enabled; change-event read consent is not paste permission.
- queueAction(type, document) is an adapter entry for native menu commands on the
  existing Document-associated user-interaction source. Destruction removes queued
  commands through ordinary Document task cleanup. Keyboard default actions must
  call runAction within their keydown task, after uncanceled keydown and before
  keyup. Shortcut classification and execCommand remain explicit caller TODOs;
  their entire APIs or default actions are not implemented by these entry points.
- Canceled copy/cut write the captured listener data and clear bookkeeping; cut
  does not delete. Uncanceled copy/cut ignore edits to clipboardData and extract
  the current visible selection after listeners. Cut requires a currently enabled
  editable selection, writes first, then invokes deletion/collapse. Copy never
  invokes editing or edit-event scheduling.
- Canceled paste returns false. An uncanceled paste also returns false without an
  eligible editable selection/caret. Otherwise it inserts the captured entry's
  most suitable representation; an empty/revoked entry causes no edit. Insertion
  must not reread native contents. Its default-action target follows the current
  selection/focus, not the earlier ClipboardEvent target.
- writeContentToClipboard preserves the Appendix's priority: nonempty items replace
  contents; an empty list with clear-was-called clears all/named formats; otherwise
  no host call occurs. A native write reports whether its generation advanced.
  Only an actual completed change queues notification. A failure propagates before
  cut can delete; an edit failure after a successful write does not retract that
  write's notification. Selective clear must preserve unlisted formats.
- Editing and its resulting input/change/validation event scheduling stay together
  in each named editing dependency. That owner must honor beforeinput cancellation,
  recheck lifetime around its author callbacks, and schedule events only for a real
  edit. No Clipboard code fabricates generic input events or applies Range deletion
  as a substitute for editing text controls, undo and rendered selection.

Eric approved the command/owner contracts and these continuing policies:

- SPEC_GAP(clipboard-script-write-activation): interpret the draft's old
  popup-allowed condition using current HTML transient activation, as Blink's
  CanWriteClipboard does. The existing Window query remains an explicit §6.4 stub.
- SPEC_CLASH(clipboard-action-change-notification): follow §5.2.1's actual-change
  requirement for all action writes, including canceled copy. §8 omits that copy
  branch and can request notifications without a write. Use the existing queued
  change path; its secure/activity/activation/focus gates still apply. The future
  native adapter must suppress its echo for the initiating Document and route
  other affected Documents normally.
- SPEC_CLASH(clipboard-action-document-lifetime): stop before effects if the
  Document became inactive during its clipboard listener. The written §8 flow
  has no recheck. Gecko rechecks presentation destruction before copy/cut writes;
  Blink commits canceled-event data during dispatch. These are local source
  observations, not a live native-clipboard probe.

The prior clear-format policy also needed a repair: clearData() followed by a
narrower clearData(type) must not narrow the outstanding clear-all. The new action
regression first observed a native clear of only text/html; it now receives the
required empty list meaning clear-all. Adding data still resets the flag as before.

### Required dependencies still throwing

In addition to getEventTarget(), readForPaste(), readChangeState(), existing
persistent-read consent and HTML focus/activation:

- hasScriptPastePermission(document): configured site/app command permission.
  The synchronous event API cannot prompt or wait here; permission UI remains
  with its owner, including the §8 requirement to identify the requesting host.
- getSelectedContents(document): rendered text/plain and text/html extraction,
  control selections and copying restrictions, without changing the selection.
- canEditSelection(type, document): HTML editing-host/control state and enabled
  cut/paste at the live selection/caret.
- deleteSelectedContents(document) and insertPasteContents(items, document): actual
  edits, caret collapse, beforeinput/lifetime handling, and resulting event work.
- replaceNativeContents(items, document) and clearNativeContents(types, document):
  native format mapping, required text/plain/text/html/image/png representations,
  native text encoding/line endings, File materialization, optional/custom format
  policy, whole/per-format clearing, and notification echo suppression. The boolean
  result reports a changed native generation; failure must throw, not masquerade
  as successful no-op work.

The tests use real Binding, DOM dispatch, Selection changes and HTML task queues,
replacing only these unfinished owner effects. No OS clipboard contents were read
or written. Blink's clipboard_commands.cc (CanReadClipboard, CanWriteClipboard,
ExecuteCopy, ExecuteCut and Paste) and Gecko's nsCopySupport.cpp supplied source
checks for permission, live selection, edit ordering and lifetime.

### Next boundary

§§6.4–6.5's required/optional formats are named in the native preparation and
writing contracts; actual encoding remains unavailable. §6.6's non-normative
unsanitized-format discussion informs §7's later asynchronous read options;
this slice does not implement those options or claim sanitization support.
Next is §7: begin with Navigator.clipboard and a bounded
ClipboardItem data/binding slice, keeping async permission and native clipboard
operations explicit. The current action layer is testable, but does not yet make
native copy/cut/paste work without the listed owners and adapters.

Validation: 35 new action regressions pass alongside Clipboard delivery,
DataTransfer and keyboard-input coverage: 153 tests in seven files on custom Node
27, Node 24.19.0 and Node 26.8.1, each stock and compat. No skipped or expected-
failure cases were added. Typecheck, generated platform declarations, type
contracts, scoped ESLint, import boundaries and patch whitespace checks pass.
