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

## §7.2 author-created ClipboardItem, 2026-11-05

Read §7.1 and §7.2 against the same current official checkout, 6201fd15.
This bounded slice completes the author-constructor path in
[§7.2](https://w3c.github.io/clipboard-apis/#clipboard-item-interface).
§7.1 Navigator.clipboard needs the §7.3 Clipboard object, so it remains the next
slice rather than returning a placeholder object.

- ClipboardItem is exposed only on secure Window globals. Binding supplies the
  nonempty record's Promise<(DOMString or Blob)> values and defaulted options.
  Constructor getters, conversion order, enum validation and error ownership
  use the existing Web IDL machinery.
- MIME parsing and serialization produce the stored representation keys and
  stable frozen types. The web prefix is a separate custom-format discriminator;
  ordinary and custom forms can coexist. Normalized duplicates throw TypeError.
- getType() creates an item-realm Promise, reacts to the selected input, creates
  a fresh UTF-8 Blob for each string result, or retains a supplied Blob/File and
  its original realm. MIME parameter values preserve their case. No global Blob
  constructor or author-overridable encoding primitive is invoked internally.
- Missing representations reject with item-realm NotFoundError. Invalid MIME
  syntax throws through Binding, which turns the method failure into a rejected
  Promise in the method's realm. Data rejections become NotFoundError; a failed
  Web IDL fulfillment conversion instead rejects with that conversion failure.
- supports() recognizes the exact mandatory/optional names plus valid custom MIME
  formats. Its answer is format recognition, not a claim that a native host adapter
  or permission grant is available. Ordinary names are not case-normalized here.

### Browser choices approved by Eric

The author-only probe runs in intercepted HTTP/HTTPS pages, without reading or
writing native clipboard data. Installed versions: Chromium 156.0.8078.4,
Firefox 157.0, WebKit 27.2. Reproduction and findings live in Experimental's
input-delivery/clipboard-item.mjs and input-delivery/CLIPBOARD-ITEM.md.

- SPEC_CLASH(clipboard-item-mime-validation): follow the draft's parsing,
  normalization and duplicate checks, like Firefox for ordinary types. Chromium
  and WebKit retain arbitrary raw spellings, including invalid MIME types;
  Firefox does not accept custom web-prefixed types yet.
- SPEC_GAP(clipboard-item-mime-equality): compare serialized MIME values, including
  parameter order, as Firefox does. The draft compares parsed records without
  defining equality of their parameter maps. Differently ordered parameter lists
  therefore remain distinct; parameter-name casing and quoting normalize first.
- SPEC_CLASH(clipboard-item-presentation-style): implement the specified enum and
  options, like Firefox/WebKit. Chromium omits both the member and options.
- SPEC_CLASH(clipboard-item-types-identity): retain one frozen value per item,
  following the draft/Firefox. Chromium/WebKit return a fresh frozen array.
- SPEC_CLASH(clipboard-item-string-blob): use UTF-8 replacement for lone surrogates
  and omit the web prefix from Blob.type. Firefox/WebKit replace a lone surrogate
  with one U+FFFD; Chromium's result decoded as three. Chromium/WebKit retain the
  web prefix in string-backed Blob types; Firefox rejects that constructor input.
- SPEC_CLASH(clipboard-item-data-rejection): follow the draft's NotFoundError.
  Chromium propagates the original reason, Firefox uses DataError and WebKit
  AbortError. Supplied Blob identity is preserved by all three browsers.
- SPEC_CLASH(clipboard-item-supports): recognize the full specified vocabulary.
  Chromium lacks text/uri-list; Firefox exposes only the mandatory set; this
  Windows WebKit build reports only text/plain. Do not generalize that platform
  result to every WebKit port.
- SPEC_CLASH(clipboard-item-result-realms): use item-realm successful results,
  like Chromium/Firefox, and item-realm missing-type errors, like Firefox.
  Chromium uses the borrowed method realm for missing-type errors; WebKit also
  uses that realm for successful Promises and newly created Blobs. Invalid MIME
  TypeErrors use the method realm, matching Firefox. Frozen arrays use the item
  realm in all three, and supplied foreign Blobs retain identity in all three.
- SPEC_CLASH(clipboard-item-data-conversion): retain Web IDL's conversion at each
  promise reaction, like Chromium. A mutable object's toString can therefore run
  separately on repeated getType calls. Firefox caches the first conversion;
  WebKit rejects object/null fulfillments instead of converting the DOMString arm.
- SPEC_GAP(clipboard-item-conversion-failure): Web IDL's reaction can fail before
  the Clipboard algorithm's fulfilled steps. The draft does not settle its
  separately allocated p in that case. Reject p with the conversion failure rather
  than leaving it pending; use the existing InternalPromise conversion-failure
  callback. The [Web IDL reaction algorithm](https://webidl.spec.whatwg.org/#dfn-perform-steps-once-promise-is-settled)
  remains unchanged.

### Explicit native boundary and next work

Eric approved SystemClipboard.readItems(document, unsanitizedTypes), an internal
entry returning an InternalPromise of ClipboardItem implementations. It currently
throws: native format enumeration must retain an originating item and clipboard
change count without eagerly reading payload bytes. Those native items then need
§7.2 getType's generation checks, per-type cached reads, custom-map decoding and
sanitization/unsanitized policy. Author-created items must never stand in for this
native path. Its caller will own permission admission and task-source delivery.
No new expected failures or silent fallbacks were introduced for this boundary.

Next: §7.1 and §7.3 Navigator.clipboard/Clipboard, followed by a bounded
asynchronous read/write slice and §9 permission algorithms. The existing event
and action layer still retains its explicit native, rendering and editing stubs.

### Validation and fixture investigation

The first focused run exposed an incorrect test expectation: an invalid MIME
TypeError from a borrowed method belongs to the method realm, unlike the explicit
NotFoundError created by the item. Firefox and existing Binding confirm this;
no Binding change was necessary.

Five initial Node 24/compat cases then timed out because the tests made sequential
raw Node-to-Window Promise calls, outside HTML task delivery. This is the existing
[raw host handoff limitation](../../scripting/ROADMAP.md#raw-host-promise-handoffs-on-hold),
not a newly classified failure. The Clipboard tests now execute author calls
through Browlet.evaluate and use same-agent sibling Windows for borrowed methods.
The unchanged raw-handoff regressions remain in test/browlet/scripting.
Pip's separate TSX cache/loader work does not apply to these Vite-loaded tests.

Final validation: all 82 selected cases in ClipboardItem, action and system-clipboard
coverage pass across custom Node 27, Node 24.19.0 and Node 26.8.1, each stock and
compat (492 passing executions). The 27 new cases have no skips or expected
failures. Generated declarations, typecheck, type contracts, scoped ESLint and
import-boundary checks pass.

## §§7.1/7.3.1 Clipboard object and asynchronous read, 2026-11-05

This slice supplies [Navigator.clipboard](https://w3c.github.io/clipboard-apis/#h-navigator-clipboard)
and [read()](https://w3c.github.io/clipboard-apis/#dom-clipboard-read), against
6201fd15. It also implements the small [§9.1 permission algorithm](https://w3c.github.io/clipboard-apis/#h-clipboard-read-permission)
needed for that flow. It does not supply a native clipboard backend.

- Navigator lazily owns one ClipboardImpl in its existing environment. Clipboard
  extends EventTarget, has no public constructor, and both the interface and the
  Navigator attribute require a secure context. The partial IDL stays with
  Clipboard and Navigator explicitly assembles it.
- Binding supplies the converted options and sequence. Only exact text/html is
  accepted in unsanitized. An unsupported entry rejects before focus, permission,
  parallel work or native access. Empty options remain distinct from malformed
  dictionary/sequence inputs; repeated allowed entries are preserved.
- The request captures transient activation and native Paste-interaction provenance
  during its calling task. The specification places the permission check inside
  parallel work but refers to the current script; this approved timing adaptation
  retains the originating interaction instead of consulting a later task.
- SystemClipboard.checkReadPermission applies §9.1's activation-plus-Paste rule.
  Its native isPasteInteraction(document) query throws until the adapter can
  distinguish a UA/OS Paste interaction from synthetic events or script commands.
  The persistent consent query used by clipboardchange remains separate. §9 only
  registers clipboard-write; this read slice introduces no new permission feature.
- The existing readItems(document, unsanitizedTypes) stub retains responsibility
  for native format enumeration, generation/origin tracking, lazy representation
  reads, caching, custom formats and sanitization. Its InternalPromise result is
  delivered on the dedicated clipboard task source. Denied permission settles on
  the existing permissions task source (called singular permission in this draft).
  Native exceptions/rejections reject the author promise rather than escaping
  the background callback or leaving the promise pending.
- The original Document must be fully active and focused at entry, before native
  access and before successful delivery. HTML still controls task runnability and
  removes queued tasks on destruction; the API does not bypass that lifecycle.
- readText, write and writeText have their specified IDL plus named throwing
  implementation stubs. Their algorithms are the next bounded sections.

### Approved gaps and browser evidence

The interface-only probe in Experimental's input-delivery/clipboard-read.mjs
never reads/writes the OS clipboard or requests permission. Chromium 156.0.8078.4,
Firefox 157.0 and WebKit 27.2 agree on secure exposure, stable Navigator identity,
EventTarget inheritance, illegal construction, method lengths, borrowed getters,
and method-realm rejected promises/TypeErrors for invalid receivers. Successful
read result realms are exercised by Browlet tests with the controlled native port;
the probe does not claim native browser read results.

- SPEC_GAP(clipboard-read-invalid-options-abort): §7.3.1 omits an abort after
  rejecting unsupported options. Stop immediately, like Blink HandleRead.
- SPEC_CLASH(clipboard-read-unsanitized-duplicates): §7.3.1 validates every entry;
  Blink HandleRead rejects any list longer than one. Preserve repeated text/html
  as specified, without adding a deduplication rule.
- SPEC_CLASH(clipboard-read-permission): follow §9.1's narrow admission. Blink
  ValidatePreconditions additionally accepts extension/persistent read grants.
- SPEC_GAP(clipboard-read-document-lifetime): [§11.2](https://w3c.github.io/clipboard-apis/#privacy-async)
  requires focus but does not place the check in §7.3.1 or specify later lifetime
  checks. Retain the original fully active, focused Document at the three points
  above. Blink checks focus at entry; the additional rechecks are Browlet's
  explicitly approved policy, not a claim of browser consensus.

Source evidence: [Blink clipboard_promise.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/clipboard/clipboard_promise.cc),
HandleRead and ValidatePreconditions. All four choices and the ownership/timing
contract were reviewed with Eric before adoption.

### Validation

The 27 new tests cover exposure, conversion and receiver errors, option snapshots,
permission facts, task sources, native completion/failure, realm identity, focus
and activity changes, explicit missing dependencies and task destruction. Initial
fixture failures counted evaluate's automation task or bypassed HTML's activity
wake-up; they were corrected using existing scheduling facilities. No production
scheduler change or failure reclassification was needed.

All 164 Clipboard tests pass on custom Node 27, Node 24.19.0 and Node 26.8.1,
each stock and compat: 984 passing executions, with no skips or expected failures.
Generated declarations, typecheck, type contracts, scoped ESLint, import-boundary
checks and patch whitespace checks pass. The final test typing cleanup was also
rechecked in custom/compat (27 new cases passing).

Next: §7.3.2 readText; audit its native text extraction/decoding and rejection
steps separately. §§7.3.3–7.3.4 and §9.2 remain explicit write work.

## §7.3.2 asynchronous plain-text read, 2026-11-05

Refreshed the clean official checkout with a fast-forward-only pull; it remains
at 6201fd15. This slice implements [readText()](https://w3c.github.io/clipboard-apis/#dom-clipboard-readtext)
while keeping actual native selection and snapshot acquisition explicit.

- read and readText share one private admission/task helper. The already reviewed
  activation/Paste snapshot, focus/activity rechecks, permission task rejection,
  clipboard completion source and Document task lifetime are unchanged.
- The new SystemClipboard.readTextData(document) host dependency throws until
  an adapter supplies a stable clipboard snapshot. It selects the first standard
  text/plain representation by mapped MIME essence, excluding custom web types;
  null means no plain text, while a rejected data promise means unreadable text.
  It must retain generation consistency and avoid fetching unrelated formats.
- Native OS text decoding belongs to that host boundary. It may return a DOMString
  or a Blob containing UTF-8 bytes. readText preserves strings and uses Blob.text()
  for the specified UTF-8 decoding, including BOM stripping and replacement of
  malformed sequences. It ignores Blob.type/charset for this decoding rule.
- The reader waits for both data and Blob bytes, then delivers through the
  clipboard source with a final Document check. It never calls public read(),
  creates author ClipboardItems, or uses author-replaced Blob prototype methods.
- Input representation failures become receiver-realm NotFoundError. Synchronous
  missing-owner exceptions remain visible; denied permission and lost focus
  remain NotAllowedError. write/writeText are unchanged explicit stubs.

### Approved specification conflicts

The current draft checks a new representation's MIME field before assigning it,
reads its uninitialized data promise, and rejects unconditionally after attaching
fulfillment reactions. It therefore cannot literally implement its intended text
read. Eric approved selecting native text explicitly and awaiting completion.

- SPEC_CLASH(clipboard-readtext-empty): return an empty string for absent text,
  following Gecko and WebKit's source, instead of the draft's final NotFoundError.
- SPEC_CLASH(clipboard-readtext-settlement): await the selected representation and
  UTF-8 decoding before final settlement, instead of racing the unconditional
  rejection. Native completion in Blink/Gecko/WebKit similarly supplies the text
  before fulfillment. Browlet uses its existing clipboard task source.
- SPEC_CLASH(clipboard-readtext-data-failure): retain the draft's explicit
  NotFoundError for unreadable representation data. Gecko's native error callback
  instead uses NotAllowedError. Permission denial remains distinct in Browlet.

Source inspection, not a native browser clipboard probe:

- [Gecko Clipboard.cpp](https://github.com/mozilla/gecko-dev/blob/master/dom/events/Clipboard.cpp),
  local d92a7ec0e622: ClipboardGetCallbackForReadText resolves a default-empty
  nsAutoString if the text flavor is absent; ClipboardGetCallback::OnError maps
  native failures to NotAllowedError.
- [WebKit Clipboard.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/async-clipboard/Clipboard.cpp),
  local 713192fa: readText selects the first text/plain item, retains empty text
  when none exists, checks the pasteboard generation, then queues fulfillment.
- [Blink clipboard_promise.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/clipboard/clipboard_promise.cc):
  HandleReadTextWithPermission performs a direct asynchronous plain-text read;
  OnReadPlainText resolves after native completion.

The existing Experimental interface probe already covers readText's method shape
and receiver errors. No system clipboard contents were inspected or overwritten.
The new regression fixture supplies the native dependency and exercises real
Blob storage, streams, encoding, bindings and task delivery.

### Validation

The 16 new cases cover absent/empty text, unchanged DOMStrings, UTF-8 BOM and
malformed sequences, delayed native and Blob reads, data failure mapping,
permission denial, focus loss, concurrent reads, borrowed realms and the named
native stub. All 180 Clipboard tests pass across custom Node 27, Node 24.19.0 and
Node 26.8.1, each stock and compat: 1,080 passing executions, no skips or expected
failures. Generated declarations remain current; typecheck, type contracts,
scoped ESLint, import boundaries and patch whitespace checks pass.

Next: §§7.3.3–7.3.4 asynchronous writes and their §9.2 permission dependency.

## §§7.3.3/9.2 asynchronous item writing, 2026-11-05

The approved readText slice, including the private helper name #runRead and its
readData callback, was committed as 73ee9845. This next slice implements write()
and write permission; writeText remains the explicit §7.3.4 stub.

- ClipboardPermissionDescriptor is a separate contributing dictionary with
  allowWithoutGesture=false. UserAgent registers ClipboardWritePermission in
  the existing store. Both aspects default to prompt; the existing host prompt
  hook defaults to denial. There is no clipboard-specific decision registry.
- The feature's query and write admission resolve the descriptor relationship:
  a stronger grant grants both; a weaker denial denies both. Contradictory raw
  entries use denial precedence. Exact store lookup and unrelated features remain
  unchanged. This feature-level state operation must also be used by future
  Clipboard permission consumers rather than reading an exact store entry.
- SystemClipboard.checkWritePermission(document) returns an InternalPromise of
  boolean, adapting the draft's boolean/PermissionState mixture. It captures
  activation/native provenance while the calling script's task is current, then
  runs consent through the existing parallel queue. Only granted means true.
  Denial/error completion uses the permissions task source.
- write() collects the selected items' data through ClipboardItem.getWriteData,
  which retains the converted representation promises and uses write's rejection
  rule rather than invoking public getType. Strings become UTF-8 Blob data;
  supplied Blobs retain identity. Failed fulfillment conversion remains an
  observable rejection, consistent with the approved ClipboardItem policy.
- Item and representation ordering, presentationStyle, and the separate custom
  flag survive asynchronous resolution. All selected data is joined before rich
  preparation; all preparation completes before one native commit. Empty writes
  are admitted no-ops. Single-item hosts select only the first item.
- Activity/focus is checked for the original Document at entry, after permission,
  before preparation, before commit, and at completion. Every asynchronous phase
  returns through a clipboard task. A committed change still queues notification
  if focus was lost afterward; that notification uses its existing eligibility
  checks. Native completion must report whether contents actually changed.

### Explicit dependencies and accepted callable boundaries

- SystemClipboard.isCopyInteraction(document): throwing task-scoped UA/OS
  Cut-or-Copy provenance. Neither activation nor synthetic event names supply it.
- supportsMultipleItems(): throwing native clipboard item-model query, needed
  only for multiple requested items.
- prepareWriteData(blob, document): throwing rich-format owner dependency for
  standard HTML/SVG sanitization and PNG decoding/preparation. Plain text/URI-list
  bytes and custom opaque data bypass rich sanitization. Supplied Blobs are never
  mutated. Rejected preparation becomes NotAllowedError; a synchronous missing
  dependency remains visible as its implementation error.
- writeItems(items, document): throwing asynchronous native operation returning
  whether contents changed. It must implement standard/custom OS format mapping,
  custom-format limits, presentation styles, text conventions, binary encoding,
  and collective commit. A delayed adapter must recheck the Document immediately
  before changing the OS clipboard. Native echo suppression for the initiating
  Document is the already-approved event-write contract.
- Document.hasFocus(), Window.hasTransientActivation(), and broader permission
  prompt/revocation lifetimes retain their existing owners. No fake system
  clipboard or permissive native fallback is introduced.

### Conflicts, gaps and evidence

Eric approved each choice before implementation:

- SPEC_CLASH(clipboard-write-permission): follow §9.2's descriptor-based rules;
  Firefox/WebKit primarily admit writes through transient activation. Blink also
  supports persistent grants. The descriptor registration/default and task-time
  provenance capture are explicit integration choices.
- SPEC_GAP(clipboard-permission-conflicting-decisions): weaker denial takes
  precedence when the store has contradictory decisions. Permissions §4 specifies
  the descriptor implications but not conflict resolution between stored entries.
- SPEC_CLASH(clipboard-write-await-data): §7.3.3 proceeds past asynchronous
  representation reactions without awaiting them and accumulates item lists
  outside the item loop. Await all selected data, preserve item boundaries, and
  commit collectively. Blink uses PromiseAll before writing, Gecko joins native
  entries, and WebKit waits for every item before its pasteboard write.
- SPEC_CLASH(clipboard-write-multiple-items): follow the draft's first-item
  selection on a single-item host. Blink/Gecko instead reject multiple items;
  WebKit has a multi-item collection path. Follow the draft and Blink/Gecko for
  empty-input no-op behavior, retaining admission before completion.
- SPEC_CLASH(clipboard-write-blob-type): use the supplied Blob.type as §7.3.3
  directs. Blink validates it against the ClipboardItem key and then writes by
  that key; Gecko/WebKit select by the key. Strings use the entry's canonical MIME
  type. Standard formats use the exact mandatory/optional vocabulary.
- SPEC_CLASH(clipboard-write-custom-identity): the main algorithm's format filter
  would discard the custom formats Appendix A writes. Preserve isCustom separately
  from the Blob MIME type; custom data stays opaque. Native custom mapping/limits
  remain unfinished at writeItems rather than being claimed as implemented.
- Existing SPEC_GAP(clipboard-read-document-lifetime) now covers write's later
  preparation/commit boundaries as approved. Missing focus and native lifetime
  effects remain executable dependencies.

Sources: the current local Clipboard index.bs at 6201fd15cf28; Blink
[ClipboardPromise](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/clipboard/clipboard_promise.cc)
(HandleWrite, HandleWriteWithPermission, WriteClipboardItemData,
WriteNextRepresentation); Gecko
[Clipboard.cpp](https://github.com/mozilla/gecko-dev/blob/master/dom/events/Clipboard.cpp)
(Write, GetClipboardNativeItem, GetNativeEntry); WebKit
[Clipboard.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/async-clipboard/Clipboard.cpp)
and
[ClipboardItemBindingsDataSource.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/async-clipboard/ClipboardItemBindingsDataSource.cpp)
(ItemWriter, collectDataForWriting); and
[Permissions §4](https://w3c.github.io/permissions/#dfn-stronger-than).
The browser comparisons here are source inspections; tests never read or replace
the developer's real OS clipboard.

### Regression evidence

A new mixed-failure test reproduced an unobserved rejection: an earlier rich
preparation rejected asynchronously while a later one threw synchronously, so the
array join was never reached. Capturing each preparation in HostPromise.try
preserves every result for the join. The isolated regression failed with an
unhandled NotAllowedError before the repair and passed afterward. Synchronous
missing-dependency errors remain visible; no failure was reclassified.

Validation: all 223 Clipboard cases in 10 files pass on custom Node 27,
Node 24.19.0 and Node 26.8.1, stock and compat (1,338 case executions).
The combined Clipboard and Permissions run passes all 362 cases in 27 files on
custom compat. There are no new expected failures or disabled regressions.
The full typecheck, test-contract typecheck, scoped ESLint, import-boundary check
and diff whitespace check pass. The write slice was reviewed and approved before check-in.

Next: §7.3.4 writeText(), reusing write permission and native commit ownership,
then the remaining security/privacy and Appendix audit. Native clipboard effects
remain unfinished until their explicit dependencies are implemented.

## §7.3.4 asynchronous text writing, 2026-11-05

The approved §§7.3.3/9.2 write/permission slice is committed as 95a43291.
The clean Clipboard specification checkout was refreshed with a fast-forward-only
pull and remains current at 6201fd15cf28. This slice implements writeText().

- Binding supplies the converted DOMString. The shared private #runWrite helper
  captures permission facts in the calling task, uses the existing consent flow,
  and enters the clipboard task only after admission. The existing write() path
  now uses that same helper without changing its representation preparation.
- writeText constructs a Blob with type text/plain;charset=utf-8, UTF-8 bytes,
  isCustom=false, and unspecified presentation. Empty text still writes one
  zero-byte representation; it is not write([])'s no-op case. UTF-8 encoding
  replaces unpaired surrogates and retains NUL and supplementary characters.
- On CRLF hosts, the existing File convertLineEndingsToNative operation normalizes
  CR, LF and CRLF using env.nativeLineEnding. On other hosts the supplied line
  endings remain unchanged. The environment's already-composed host value is
  sufficient; there is no new OS detection or native-text service.
- Text goes directly to the existing #commitWrite method. No author ClipboardItem,
  Blob constructor override, Clipboard.write method, or rich-format preparation
  participates in this path. Native failure, notification, lifetime rechecks,
  promise ownership and completion-task behavior remain shared with write().
- The existing SystemClipboard.writeItems dependency still throws. Its required
  format mapping uses MIME essence, as Appendix A specifies, so writeText's
  charset parameter maps to standard plain text. Native text encoding, clipboard
  access and write completion remain that owner's unfinished work. Focus,
  activation and native Cut/Copy provenance retain their existing explicit
  dependencies. No real OS clipboard was read or modified during validation.

### Approved newline interpretation and source evidence

SPEC_CLASH(clipboard-writetext-windows-newlines): the draft note literally replaces
LF with CRLF, which would duplicate CR in an existing CRLF pair. Eric approved
Blink's normalization of all three newline spellings on Windows. Source evidence:

- [Blink SystemClipboard::WritePlainText](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/clipboard/system_clipboard.cc)
  calls NormalizeLineEndingsToCrLf under the Windows build flag; its
  [line-ending tests](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/wtf/text/line_ending_test.cc)
  explicitly cover LF, CRLF and lone CR becoming one CRLF.
- [Blink ClipboardPromise](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/clipboard/clipboard_promise.cc)
  writes plain text after permission and commits before resolving.
- [Gecko Clipboard::WriteText](https://github.com/mozilla/gecko-dev/blob/master/dom/events/Clipboard.cpp)
  builds a plain-text item and reuses Write; [WebKit Clipboard::writeText](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/async-clipboard/Clipboard.cpp)
  writes standard plain text through its pasteboard owner after admission.
  These are implementation-source observations, not a new live native clipboard
  probe or a claim that all engines agree on every platform's newline handling.

### Validation and stopping point

The focused writeText/write/write-permission run passes all 64 cases. New coverage
includes UTF-8 bytes, empty text, both host newline rules, argument conversion,
author API overrides, permission denial and delayed consent, focus lifetime,
asynchronous native completion/failure, change notifications, borrowed-method
realms and the still-throwing writer dependency.

All 244 Clipboard cases in 11 files pass across custom Node 27, Node 24.19.0
and Node 26.8.1, with stock and compat runtimes (1,464 case executions). There
are no new expected failures or disabled regressions. Full typechecking,
binding-contract typechecking, scoped ESLint, the import-boundary check, and
whitespace validation pass. The writeText slice was reviewed and approved before check-in.

Next: audit §§10–11 and Appendix A, cross-checking already implemented §§8–9.
All four async Clipboard entry points now have their local flow, but native
reads/writes, lazy native items, rich-format preparation, HTML focus/activation,
editing operations and the native adapter remain explicit unfinished owners.

## §§10–11 and Appendix A audit, 2026-11-05

The approved writeText slice is committed as ebc6287e. The clean official
Clipboard checkout was refreshed and remains at 6201fd15cf28. This audit reads
[§10](https://w3c.github.io/clipboard-apis/#security),
[§11](https://w3c.github.io/clipboard-apis/#privacy), and every
[Appendix A algorithm](https://w3c.github.io/clipboard-apis/#algorithms),
and cross-checks the implemented §§8–9 actions and permissions.

### Security and privacy requirements

- §10.1 explicitly labels its HTML/multipart policy table non-normative. It does
  not supply a sanitizer or authorize arbitrary resource reads. §10.2's normative
  rules prohibit fetching referenced online resources and exposing their contents
  as Files/items, and prohibit exposing referenced local files from web-origin
  clipboard markup. The existing throwing readForPaste dependency now records
  these requirements and the native source-provenance requirement in code.
- §10.3 permits write-side image transcoding but recommends preserving read-side
  images and their metadata. readItems/readForPaste and prepareWriteData record
  the separate responsibilities. Native getType must also obey §7.2.3's image/png
  and requested text/html sanitization exceptions. The current native read stubs
  remain throwing; author ClipboardItems do not sanitize supplied Blobs.
- §10.4 requires graceful handling of excessive data. Both native writer stubs
  now explicitly require size/count validation before mutation. No arbitrary
  browser-wide quota or speculative OS limit is introduced. The adapter must
  implement actual limits and errors before these stubs can be removed.
- §11.1's data-access lifetime is implemented by fireEvent's finally-detach path:
  retained transfers cannot read/write data, lists empty, and retained items are
  disabled. Existing captured File/string and queued callback behavior retains
  the previously approved HTML rules. HTML's DataTransferItemList.remove still
  throws outside read/write mode; that list method is not a new clipboard effect.
  Synthetic ClipboardEvents use only author-supplied data and cannot enter native
  action admission merely through DOM dispatch.
- §11.2's focus requirement is checked at async entry and before native work and
  completion. §9 read/write decisions remain distinct, with consent delivery on
  the existing permissions machinery. Optional permission-expiration policies
  are not additional mandatory algorithms or newly enabled grants.
- §§8.3/11.3 require explicit permission for script paste. runAction checks the
  existing throwing hasScriptPastePermission dependency before dispatch/reading;
  its code now records that any owner-provided prompt must name the requesting
  hostname. Synthetic paste and activation alone do not establish this consent.

### Appendix coverage and executable dependencies

| Algorithm | Current owner and remaining work |
| --- | --- |
| A.1 write content | writeContentToClipboard implements replacement versus clear decisions. replaceNativeContents and clearNativeContents throw for native encoding/line endings, standard/custom formats, and whole/per-format OS mutation. |
| A.2 write blobs and option | Clipboard joins all selected representations and preserves item/style/custom identity before writeItems. That native writer still throws for OS encoding and collective commit. |
| A.3 standard native format | The read/write native dependencies own MIME-essence mapping to actual OS identifiers, including parameterized writeText plain text. Actual native name/handle mapping remains unfinished. |
| A.4 MIME from native format | readChangeState, readForPaste and readItems still throw for discovery and mapping; unmapped formats cannot be guessed from their names. |
| A.5 read custom formats | readItems still throws for custom-map discovery and lazy native item construction; later getType needs the originating item/generation and map lookup. |
| A.6 write custom formats | writeItems still throws for native custom payloads and JSON map commit, including format-count limits. |
| A.7–A.8 custom map/name | The native adapter must supply the specified platform map and indexed format names used by A.5/A.6. These are part of the throwing native mapping operations, not a completed host adapter. |
| A.9 fire clipboard event | fireEvent and ClipboardDataTransferImpl implement trusted dispatch, modes, clear bookkeeping, sequence checks and detachment. getEventTarget/readForPaste remain explicit throwing targeting/decoding dependencies. |
| A.10 HTML paste | readForPaste still throws for parser/serializer integration, source-relative URL resolution, source-qualified file/part access and deduplicated cid: references. The source now records required names, timestamps, fallback MIME and §10.2 restrictions. |

A.1's native replacement must fail before cut can proceed to editing. A.2 uses the
already approved collective commit rather than independent per-representation
writes. A.9 shares the existing DataTransfer model; there is no second item store
or new access registry. No live OS clipboard was read or modified by this audit.

### Unresolved native work and draft questions

This is a complete reading/audit checkpoint, not complete native Clipboard support.
The remaining code dependencies above are executable throws, not documentation-only
placeholders. HTML system focus/activation, native command provenance, persistent
read consent, rendering/editing and adapter notification routing also remain with
the owners recorded in earlier slices.

SPEC_CLASH(clipboard-appendix-binary): A.2 UTF-8-decodes every payload despite
§6.4's mandatory image/png support. The approved writer contract preserves binary
data; its native encoding still throws. A.2 also attempts to mutate read-only
Blob.type and leaves variables unset in its custom branch. The approved records
already retain bytes, MIME and custom identity separately.

SPEC_GAP(clipboard-custom-map-failures): A.5 does not specify how malformed JSON
or invalid map values affect discovery. The policy remains pending at readItems.
SPEC_GAP(clipboard-native-target): A.2 explicitly leaves selection among multiple
OS clipboards undefined. The policy remains pending at writeItems and the native
adapter. Neither gap is resolved by exposing the author APIs.

A.6 literally permits 101 entries: it writes index 0 first and breaks only after
incrementing the count beyond 100. Check that rule against the actual adapter
before choosing its format limit. A.8's Linux custom-format prefix has incomplete
quoting; its final native spelling also needs resolution at that implementation.

The next useful local implementation slice is native ClipboardItem state and lazy
getType delivery: retain the original item/generation, check staleness before cached
results, share concurrent reads, and deliver results in the item's realm. Native
format enumeration, byte access and rich-content processing can remain explicit
host dependencies. Review its callable contract before introducing the native item
representation; author items must retain their current independent behavior.

Validation: all 244 existing Clipboard regressions in 11 files pass on custom
Node 27 with compat (9.97 seconds). Patch whitespace and scoped ESLint checks
pass. This audit changes dependency comments and roadmap/status notes, not
runtime behavior; it adds no tests, expected failures or skips. The approved
writeText slice's six-runtime validation is recorded above and was not repeated
for these comment/documentation edits. The audit was reviewed and approved before check-in.
