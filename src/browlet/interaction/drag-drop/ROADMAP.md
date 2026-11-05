# Drag-and-drop data API

## HTML §§6.11.2–6.11.3, 2026-11-05

Reviewed the [drag data store](https://html.spec.whatwg.org/multipage/dnd.html#the-drag-data-store)
and [DataTransfer](https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface),
including §6.11.3.1 DataTransferItemList and §6.11.3.2 DataTransferItem.
The clean official HTML checkout was refreshed with a fast-forward-only pull;
source revision 5955a33 was already current.

This slice provides author-created DataTransfer objects and their data operations:

- A private store, initially created protected with uninitialized allowed effects;
  the author constructor selects read/write access and sets the two public effect
  attributes to none. The effects remain per-transfer attributes, separate from
  the store state consumed by the future drag processing model.
- Ordered text/File items, ASCII-lowercase types, text uniqueness, legacy format
  aliases, replacement/removal, and permanent disabling of removed items.
- Stable item/list identities, frozen types snapshots allocated by existing Binding
  machinery, and a live FileList updated on mutation, mode changes, and detachment.
  Added Files retain their original identity and realm.
- Protected, read-only, and disabled access checks. Internal setMode() and detach()
  express the lifetime boundary without manufacturing native drag events.
- Asynchronous getAsString() with captured text, nullable callbacks, callback-realm
  invocation, exception reporting, and the existing user-interaction task source.
  The transfer's environment owns task scheduling; queued reads survive item
  removal or detachment, subject to ordinary Document task runnability.
- Both add() overloads and all declared members are exposed through Web IDL.
  Item/list objects have no public constructor. Binding retains receiver-realm
  allocation when getters or methods are borrowed.

The current author-created transfer owns one store, whose entries use their
one-to-one DataTransferItem implementations. This does not yet model a native
store shared across successive event-specific DataTransfer objects. No generic
observer registry or host clipboard API was introduced for that later producer.

## Explicit unfinished dependencies

setDragImage() performs conversion and write-access checks, then reaches the
named throwing createDragImage dependency in data-transfer.ts. Rendering must
provide an img's natural-size bitmap or an image of another Element and commit
that bitmap together with the hot spot. Default native drag feedback also needs
its UI owner; these store fields remain absent. The regression checks that the
missing dependency is reached, not that drag-image rendering works.

HTML §§6.11.4–6.11.5 remain separate work: DragEvent, native drag production,
shared-store association, effect initialization/copy-back, dispatch-time modes,
and post-dispatch detachment. The source-side TODO names these requirements.
Native filesystem acquisition and drag feedback need their host owners. There is
no native drag path that silently treats those effects as implemented.

Clipboard §5.1 can now accept a real DataTransfer through its declared interface
rather than substitute a placeholder. Clipboard access policy, system formats,
permissions, and native clipboard effects remain with the
[Clipboard owner](../clipboard/ROADMAP.md).

## Approved specification and browser decisions

Browser-only evidence: Experimental input-delivery/data-transfer.mjs, run on
Chromium 156.0.8078.4, Firefox 157.0, and WebKit 27.2. It records observations;
it is not a Browlet acceptance test. Eric approved these choices.

| Source marker | Selected behavior and competing evidence |
| --- | --- |
| data-transfer-effects | Follow HTML/Firefox: setters work on constructed transfers. Chromium/WebKit leave both attributes at none in the probe. |
| data-transfer-item-type | Follow HTML/Firefox/WebKit: items.add() lowercases types. Chromium preserves case. |
| data-transfer-item-aliases | Follow HTML/Chromium/WebKit: items.add() keeps text/url literal. Firefox applies the legacy aliases there too. |
| data-transfer-list-identity | Follow HTML's SameObject items and stable indexed item identities. Chromium fails the probed identities; Firefox/WebKit preserve them. |
| data-transfer-types-identity | Follow HTML/Chromium/Firefox: reads and no-op removals retain the array. WebKit creates new arrays. Actual list mutations replace it even if the formats remain equal. |
| data-transfer-replacement | Follow HTML/Chromium/WebKit: setData() removes the old item and appends a new one. Firefox changes it in place. |
| data-transfer-removed-items | Follow HTML/WebKit: removed item objects become disabled. Chromium/Firefox retain their old metadata/data. |
| data-transfer-file-identity | Follow all three browsers: files and getAsFile() return the supplied File. HTML's getAsFile() says to create a new File each time. |
| data-transfer-uri-list | Follow Firefox/WebKit: getData('URL') selects the first trimmed nonempty non-comment line; Chromium skips invalid URLs. RFC 2483 assumes valid URI lines and supplies no malformed-line recovery algorithm. |
| data-transfer-callback-task-source (SPEC_GAP) | HTML says queue a task without naming its source. Use user interaction, matching Blink's DataTransferItem::getAsString(). |

URI-list format reference: [RFC 2483 §5](https://www.rfc-editor.org/rfc/rfc2483.html#section-5).
Blink scheduling reference:
[DataTransferItem::getAsString](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/clipboard/data_transfer_item.cc).
Queued text remains captured after removal in all three browsers. All three also
allocate borrowed types getters' arrays in the receiver's realm, matching Binding.

## Validation and next boundary

25 focused DataTransfer tests pass in each of the six supported configurations:
custom Node 27, Node 24.19.0, and Node 26.8.1, each stock and compat. No skips or
expected failures were added. Typecheck, generated platform declarations, type
contracts, scoped ESLint, repository-wide import hierarchy, and whitespace
checks pass.

[Clipboard §5.1 ClipboardEvent](../clipboard/ROADMAP.md) now consumes these data
interfaces. Native dragging and the rest of HTML §6 remain separate work.
