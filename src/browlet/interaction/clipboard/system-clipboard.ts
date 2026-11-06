import { InternalError, internalType, type InternalPromise } from '../../../infra/index';
import { computeHash, randomUUID } from '../../../js-engine/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../../../web-idl/core/index';
import { utf8Encode } from '../../../encoding/index';
import { StorageKey } from '../../../storage/index';
import { serializeMIMEType } from '../../../mime/index';
import { BlobData, BlobImpl } from '../../../file/index';

import { userInteractionTaskSource } from '../../scripting/index';
import type { DragDataItem } from '../drag-drop/index';
import type { DocumentImpl, ElementImpl } from '../../dom/nodes/index';

import { ClipboardChangeEventImpl } from './change-event';
import { ClipboardEventImpl } from './event';
import { ClipboardDataTransferImpl } from './event-data';
import { ClipboardItemImpl, type ClipboardWriteItem, type PresentationStyle } from './item';
import { clipboardWritePermission } from './permission';
import { getWellKnownFormat, getWellKnownMIMEType, type ClipboardFormat, type ClipboardPlatform } from './formats';
import { prepareCustomFormats, readCustomFormats, type ClipboardCustomWrite } from './custom-formats';

/** System clipboard algorithms and native effects, owned by one UserAgent. */
// https://w3c.github.io/clipboard-apis/#clipboard-event-clipboardchange
export class SystemClipboard {
  /** Mix a fresh UA-lifetime value into native tokens, even if the OS reuses a token after restart. */
  #sessionId = utf8Encode(randomUUID());

  /** Queue one native change for an explicitly routed Document. */
  // Browlet integration: adapters supply recipients; they must not dispatch author code from a native callback.
  // SPEC_GAP(clipboard-change-task-source): The draft omits notification scheduling. Use the owning Document's user-interaction source.
  // TODO(Clipboard host): register native change observation and route it to the affected Documents.
  queueChange(document: DocumentImpl): void {
    document.env.responsibleEventLoop.queueTask(userInteractionTaskSource, document, () => {
      this.fireChange(document);
    });
  }

  /** Queue an adapter-recognized native menu command for its receiving Document. */
  // Browlet integration: native callbacks never dispatch author code directly.
  // Keyboard default actions instead call runAction in their existing keydown task,
  // after uncanceled keydown and before keyup; queueing again could reverse that order.
  // https://w3c.github.io/clipboard-apis/#otherevents
  queueAction(type: ClipboardEventType, document: DocumentImpl): void {
    document.env.responsibleEventLoop.queueTask(userInteractionTaskSource, document, () => {
      this.runAction(type, document, 'user');
    });
  }

  /** Queue the Clipboard contribution after HTML reports that this Document gained system focus. */
  queueFocus(document: DocumentImpl): void {
    document.env.responsibleEventLoop.queueTask(userInteractionTaskSource, document, () => {
      this.runDocumentFocusSteps(document);
    });
  }

  /** Fire a change in the Document's owning task, or remember that focus replay is needed. */
  // https://w3c.github.io/clipboard-apis/#h-fire-clipboardchange-event
  fireChange(document: DocumentImpl): void {
    if (!this.#isEligible(document)) return;
    if (!document.hasFocus()) {
      document.clipboardChangePending = true;
      return;
    }
    // A current notification satisfies any earlier deferred change before listeners can reenter.
    document.clipboardChangePending = false;
    this.#dispatchChange(document);
  }

  /** Replay at most one pending notification, reading the current clipboard state at delivery. */
  // https://w3c.github.io/clipboard-apis/#h-document-focus-steps
  runDocumentFocusSteps(document: DocumentImpl): void {
    if (!document.clipboardChangePending) return;
    document.clipboardChangePending = false;
    // SPEC_CLASH(clipboard-change-focus-recheck): Recheck eligibility like Blink; the draft's replay skips activation/permission checks.
    // Losing focus before the task runs puts the flag back through the ordinary algorithm.
    this.fireChange(document);
  }

  /** Run an action synchronously; the caller must identify native UI versus a script command. */
  // https://w3c.github.io/clipboard-apis/#clipboard-actions
  // The source supplies script-triggered; the access check below supplies script-may-access-clipboard.
  // Synthetic DOM dispatch never calls this operation. Future execCommand must use 'script'
  // and return this result; native menu/shortcut adapters use 'user'.
  runAction(type: ClipboardEventType, document: DocumentImpl, source: ClipboardActionSource): boolean {
    if (!document.isFullyActive()) return false;
    if (source === 'script') {
      if (type === 'paste') {
        if (!this.hasScriptPastePermission(document)) return false;
      } else {
        const realm = document.env.realm;
        // SPEC_GAP(clipboard-script-write-activation): Interpret the draft's old popup-allowed condition
        // using HTML transient activation, as Blink does; optional site/app write grants are not enabled.
        if (!realm.isWindow() || !realm.windowImplementation.hasTransientActivation()) return false;
      }
    }

    const result = this.fireEvent(type, document);
    // SPEC_CLASH(clipboard-action-document-lifetime): Recheck before effects, like Gecko's destruction check;
    // §8 omits the check, and Blink commits canceled copy/cut data during dispatch.
    if (!result || !document.isFullyActive()) return false;

    if (type === 'paste') {
      // https://w3c.github.io/clipboard-apis/#paste-action
      if (result.canceled || !this.canEditSelection('paste', document)) return false;
      if (result.items.length !== 0) this.insertPasteContents(result.items, document);
      return true;
    }
    if (result.canceled) {
      // https://w3c.github.io/clipboard-apis/#override-copy
      // https://w3c.github.io/clipboard-apis/#override-cut
      // Canceled cut writes author data but never deletes the selection.
      this.writeContentToClipboard(result.items, result.clearWasCalled, result.typesToClear, document);
      return true;
    }
    // https://w3c.github.io/clipboard-apis/#cut-action
    if (type === 'cut' && !this.canEditSelection('cut', document)) return false;
    // https://w3c.github.io/clipboard-apis/#selection-mod
    // Read the live selection/focus after listeners. Uncanceled author DataTransfer writes are ignored.
    const items = this.getSelectedContents(document);
    this.writeContentToClipboard(items, false, [], document);
    if (type === 'cut') this.deleteSelectedContents(document);
    return true;
  }

  /** Apply the Appendix's replacement/clear decision after the action has admitted clipboard access. */
  // https://w3c.github.io/clipboard-apis/#to-write-content-to-clipboard
  // The previous delivery slice snapshots DataTransferItemList into these ordinary data records.
  writeContentToClipboard(items: DragDataItem[], clearWasCalled: boolean, typesToClear: string[], document: DocumentImpl): void {
    let changed: boolean;
    if (items.length !== 0) changed = this.replaceNativeContents(items, document);
    else if (clearWasCalled) changed = this.clearNativeContents(typesToClear, document);
    else return;
    if (!changed) return;
    // SPEC_CLASH(clipboard-action-change-notification): Follow §5.2.1 for every successful write,
    // including canceled copy; §8 omits that branch and can notify even when no data changed.
    // Use the existing queued path so change listeners cannot interrupt the action's edit steps.
    this.queueChange(document);
  }

  /** Dispatch within an admitted §8 action's task; return null when there is no active target. */
  // https://w3c.github.io/clipboard-apis/#to-fire-a-clipboard-event
  // The draft's implicit event/items/clear state is an explicit result for the later action.
  // This operation grants no permission and performs no copy/cut/paste default action.
  fireEvent(type: ClipboardEventType, document: DocumentImpl): ClipboardEventResult | null {
    if (!document.isFullyActive()) return null;
    const target = this.getEventTarget(document);
    if (!target) return null;
    const paste = type === 'paste' ? this.readForPaste(document) : null;
    const data = new ClipboardDataTransferImpl(paste, this, document.env);
    try {
      const uncanceled = target.fireEvent(type, ClipboardEventImpl, (event) => {
        event.clipboardData = data;
        event.bubbles = true;
        event.cancelable = true;
        event.composed = true;
      });
      return {
        canceled: !uncanceled, items: data.snapshotItems(),
        clearWasCalled: data.clearWasCalled, typesToClear: [...data.typesToClear],
      };
    } finally {
      // SPEC_GAP(clipboard-event-access-lifetime): Like Blink/Gecko/WebKit, revoke access before returning to the action.
      // Previously captured strings/Files and queued getAsString callbacks keep their existing HTML lifetimes.
      data.detach();
    }
  }

  /** Select the editable visible-selection start, or focused node, falling back to the body. */
  // TODO(HTML editing / rendered Selection): distinguish an editable context and obtain its visible
  // selection/caret container, including text controls. Otherwise use Document.focusedArea's anchor.
  // Neither activeElement nor the ordinary Selection Range supplies the complete target algorithm.
  getEventTarget(_document: DocumentImpl): ElementImpl | null {
    throw new InternalError('Clipboard event target selection requires editing and rendered selection');
  }

  /** Capture one paste entry as fully decoded, permitted DataTransfer items in this Document's realm. */
  // TODO(Clipboard host / mandatory formats): snapshot bytes and an optional sequence token, map native
  // formats, decode text, and create Files (using application/octet-stream for an unknown file type).
  // TODO(Clipboard / process an HTML paste event): parse/serialize markup, resolve source-relative URLs,
  // and process local-file/clipboard-part references before exposing text/html or application/xhtml+xml.
  // §10.2 forbids fetching referenced online resources or exposing their contents as items/Files.
  // Referenced local files are eligible only for local-application data; retain native origin
  // provenance until that decision. A file: URL in web-origin markup does not grant file access.
  // Appendix A.10 also requires deduplicated cid: item indices, File names/timestamps and
  // unknown-type fallback. §10.3 recommends preserving image bytes/metadata on reads.
  // https://w3c.github.io/clipboard-apis/#to-process-html-paste-event
  // The snapshot contains no live native data source; a null token never permits later clipboard reads.
  readForPaste(_document: DocumentImpl): ClipboardPasteData {
    throw new InternalError('Native clipboard paste decoding and HTML processing are not implemented');
  }

  /** Check whether a captured clipboard generation is still current. */
  isCurrentEntry(entry: Uint8Array): boolean {
    const current = this.readChangeState().token;
    return current.length === entry.length && current.every((byte, index) => byte === entry[index]);
  }

  /** Require an active, focused Document and, when captured, the same clipboard generation. */
  validateRead(entry: Uint8Array | null, document: DocumentImpl): void {
    // SPEC_GAP(clipboard-native-read-lifetime): Retain the approved lifetime/generation
    // checks before access and delivery. A null entry is only for admission before a snapshot.
    if (!document.isFullyActive() || !document.hasFocus()) {
      throw new DOMExceptionImpl('Clipboard access requires an active, focused Document', DOMExceptionNames.notAllowed);
    }
    if (entry !== null && !this.isCurrentEntry(entry)) {
      throw new DOMExceptionImpl('Clipboard contents have changed', DOMExceptionNames.invalidState);
    }
  }

  /** Consult existing synchronous command permission; neither transient activation nor change-listener consent grants paste. */
  // https://w3c.github.io/clipboard-apis/#allow-read-clipboard
  // TODO(Clipboard command permissions): supply the implementation-specific site/app decision.
  // §6's synchronous event API cannot prompt or wait here; permission UI belongs to its owner.
  // Any earlier §8.3 permission prompt must identify the requesting Document's hostname.
  hasScriptPastePermission(_document: DocumentImpl): boolean {
    throw new InternalError('Script clipboard paste permission is not implemented');
  }

  /** Read the current visible selection as clipboard representations, without changing it. */
  // TODO(Rendered Selection / HTML controls): extract text/plain and text/html where applicable,
  // including text-control selection and copy restrictions such as password fields. Empty selection
  // returns no items. Range.toString()/cloneContents() do not supply rendered clipboard serialization.
  getSelectedContents(_document: DocumentImpl): DragDataItem[] {
    throw new InternalError('Clipboard copying requires rendered selection and text-control extraction');
  }

  /** Test the live editable context: a selected range for cut, or a selection/caret for paste. */
  // TODO(HTML §6.8 / controls): resolve the editing host, applicable input state and enabled/read-only
  // rules at the current focus/selection, not at the ClipboardEvent's earlier dispatch target.
  canEditSelection(_type: ClipboardEditAction, _document: DocumentImpl): boolean {
    throw new InternalError('Clipboard actions require HTML editing eligibility');
  }

  /** Delete and collapse the current selection, including the editing owner's resulting event work. */
  // TODO(HTML editing / Input Events): perform deleteByCut with beforeinput cancellation and lifetime
  // checks, then schedule the resulting input/change/validation events only if an edit took place.
  // This is not Selection.deleteFromDocument(): editing also includes controls, undo and event policy.
  deleteSelectedContents(_document: DocumentImpl): void {
    throw new InternalError('Clipboard cutting requires editing, selection collapse and edit-event delivery');
  }

  /** Insert the most suitable captured representation at the current editable selection/caret. */
  // TODO(HTML editing / Input Events): select rich/plain content, perform insertFromPaste with its
  // beforeinput and lifetime checks, and schedule resulting events after clipboard dispatch finishes.
  // Data comes from the admitted paste entry; this operation must not reread the native clipboard.
  insertPasteContents(_items: DragDataItem[], _document: DocumentImpl): void {
    throw new InternalError('Clipboard pasting requires editing and edit-event delivery');
  }

  /**
   * Clear and replace native representations; report whether the native generation advanced.
   * False means a successful no-op. Failure must throw so cut cannot delete after a failed copy.
   */
  // TODO(Clipboard host / §6.4 and Appendix A.1): support text/plain, text/html and image/png,
  // map native format names, encode text and normalize native line endings, and materialize files.
  // Optional/custom formats need an explicit supported-format policy; never silently drop a required one.
  // §10.4 requires graceful handling of excessive data: reject unsupported native sizes/counts
  // before replacement, rather than clearing first and discovering an unrepresentable payload.
  // This action queues the initiating Document's change event. The adapter must suppress its native
  // observation echo for that Document while routing changes to other Documents through queueChange.
  replaceNativeContents(_items: DragDataItem[], _document: DocumentImpl): boolean {
    throw new InternalError('Native clipboard replacement and format encoding are not implemented');
  }

  /**
   * Clear named formats (all contents for an empty list); report a changed native generation.
   * False means a successful no-op; native failure must throw.
   */
  // TODO(Clipboard host / Appendix A.1): implement whole-clipboard clearing and the at-risk
  // per-format removal operation. Preserve unlisted formats; do not substitute clear-all.
  // The same initiating-Document notification/echo contract as replaceNativeContents applies.
  clearNativeContents(_types: string[], _document: DocumentImpl): boolean {
    throw new InternalError('Native clipboard clearing is not implemented');
  }

  /** Derive the identifier from the same native snapshot used for the event's formats. */
  // https://w3c.github.io/clipboard-apis/#h-changeid-generation
  // The captured native token is explicit so format discovery and ID generation cannot observe different writes.
  generateChangeId(document: DocumentImpl, token: Uint8Array): bigint {
    const key = StorageKey.obtainForNonStoragePurposes(document.env).toBytes();
    // Fixed-size session prefix and length-delimited native token avoid ambiguous concatenations.
    const input = new Uint8Array(this.#sessionId.length + 4 + token.length + key.length);
    input.set(this.#sessionId);
    new DataView(input.buffer).setUint32(this.#sessionId.length, token.length);
    input.set(token, this.#sessionId.length + 4);
    input.set(key, this.#sessionId.length + 4 + token.length);
    const hash = computeHash('sha256', input);
    let result = 0n;
    for (let index = 0; index < 16; index++) result = (result << 8n) | BigInt(hash[index]!);
    return result;
  }

  /** Read canonical MIME types and an opaque per-write token from one native clipboard snapshot. */
  // TODO(Clipboard host): obtain formats without reading content, map OS formats to MIME types,
  // and supply a different token for every write, including identical content and clipboard clearing.
  readChangeState(): ClipboardChangeState {
    throw new InternalError('Native clipboard change-state access is not implemented');
  }

  /** Read existing persistent consent without prompting; this is not §9.1's transient Paste check. */
  // TODO(Clipboard permissions): integrate the optional UA persistent clipboard-read permission with Permissions.
  // §5.2.1 refers to persistent read permission, but §9 only registers clipboard-write.
  hasPersistentReadPermission(_document: DocumentImpl): boolean {
    throw new InternalError('Persistent clipboard-read permission is not implemented');
  }

  /** Snapshot §9.1's facts during the requesting script's task. */
  // https://w3c.github.io/clipboard-apis/#h-clipboard-read-permission
  // SPEC_CLASH(clipboard-read-permission): Follow the draft's activation plus native-Paste rule;
  // Blink additionally accepts extension or persistent clipboard-read permission grants.
  checkReadPermission(document: DocumentImpl): boolean {
    const realm = document.env.realm;
    if (!realm.isWindow() || !realm.windowImplementation.hasTransientActivation()) return false;
    return this.isPasteInteraction(document);
  }

  /** Capture §9.2's task facts, then request any needed consent in parallel. */
  // https://w3c.github.io/clipboard-apis/#h-clipboard-write-permission
  // SPEC_CLASH(clipboard-write-permission): Follow the descriptor-based draft;
  // Gecko/WebKit primarily use transient activation, while Blink also accepts persistent grants.
  // The specification returns a boolean or PermissionState. This entry returns
  // an InternalPromise<boolean>, accepting only the granted decision from Permissions.
  checkWritePermission(document: DocumentImpl): InternalPromise<boolean> {
    const env = document.env;
    const P = env.userAgent.HostPromise;
    return P.try(() => {
      const granted = clipboardWritePermission.getState(true, env) === 'granted';
      const realm = env.realm;
      const hasGesture = !granted && realm.isWindow() && realm.windowImplementation.hasTransientActivation();
      const nativeCopy = hasGesture && this.isCopyInteraction(document);
      const descriptor = { name: clipboardWritePermission.name, allowWithoutGesture: !hasGesture };
      const result = P.withResolvers(internalType<boolean>());
      env.runInParallel(() => {
        try {
          if (granted || nativeCopy) { result.resolve(true); return; }
          if (clipboardWritePermission.getState(descriptor.allowWithoutGesture, env) === 'denied') {
            result.resolve(false); return;
          }
          env.permissions.requestPermission(descriptor).observe(
            (decision) => { result.resolve(decision === 'granted'); }, result.reject,
          );
        } catch (error) { result.reject(error); }
      });
      return result.promise;
    }, internalType<boolean>());
  }

  /** Whether the current script runs from a UA/OS Cut or Copy control. */
  isCopyInteraction(_document: DocumentImpl): boolean {
    // TODO(Clipboard host): task-scoped native provenance, distinct from activation
    // and from script-generated copy/cut events or execCommand calls.
    throw new InternalError('Native Cut/Copy interaction provenance is not implemented');
  }

  /** Whether one native clipboard transaction can retain multiple separate items. */
  supportsMultipleItems(): boolean {
    // TODO(Clipboard host): query the selected OS clipboard's item model.
    throw new InternalError('Native multi-item clipboard support is not implemented');
  }

  /** Prepare standard HTML/SVG/PNG data before any native clipboard mutation. */
  prepareWriteData(_data: BlobImpl, _document: DocumentImpl): InternalPromise<BlobImpl> {
    // TODO(Clipboard formats): decode/validate PNG and choose its native encoding;
    // sanitize HTML/SVG using their document/format owners. Return a prepared copy,
    // reject NotAllowedError on preparation failure, and never mutate the supplied Blob.
    throw new InternalError('Rich clipboard write preparation is not implemented');
  }

  /** Prepare each item's OS formats and commit all items together; resolve whether contents changed. */
  // https://w3c.github.io/clipboard-apis/#to-write-blobs-to-clipboard
  // The approved entry retains per-item styles and custom identity, then returns the host's
  // completion result instead of performing A.2's separate writes while preparing representations.
  writeItems(items: ClipboardWriteItem[], document: DocumentImpl): InternalPromise<boolean> {
    if (items.length === 0) return document.env.userAgent.HostPromise.resolve(false, internalType<boolean>());
    const platform = this.getPlatform();
    const prepared: ClipboardFormatWriteItem[] = [];
    for (const item of items) {
      const standard: ClipboardFormatData[] = [];
      const custom: BlobImpl[] = [];
      const formats = new Set<ClipboardFormat>();
      for (const { data, isCustom } of item.representations) {
        // Custom text/plain and image/png remain opaque custom formats, even though
        // their Blob types also have standard mappings. No Blob or payload is rewritten.
        if (isCustom) { custom.push(data); continue; }
        let format = getWellKnownFormat(data.type, platform);
        if (format === '') format = this.getAdditionalFormat(data.type, platform);
        if (format === '') throw new DOMExceptionImpl('Unsupported clipboard OS format', DOMExceptionNames.notAllowed);
        // SPEC_GAP(clipboard-standard-format-collision): A.2 does not define colliding
        // standard formats. Reject within an item; separate items keep their own formats.
        if (formats.has(format)) throw new DOMExceptionImpl('Duplicate standard clipboard format', DOMExceptionNames.notAllowed);
        formats.add(format);
        standard.push({ format, data });
      }
      // SPEC_CLASH(clipboard-appendix-binary): A.2 UTF-8-decodes every payload,
      // conflicting with image/png and opaque custom data. Retain the supplied Blobs.
      prepared.push({
        standard, custom: custom.length === 0 ? null : prepareCustomFormats(custom, platform, document.env),
        presentationStyle: item.presentationStyle,
      });
    }
    return this.writeFormats(prepared, platform, document);
  }

  /** Select the platform of this clipboard provider without registering formats or writing data. */
  getPlatform(): ClipboardPlatform {
    // TODO(Clipboard host): supply the selected provider's platform explicitly.
    throw new InternalError('Clipboard platform selection is not implemented');
  }

  /** Map an admitted standard type omitted by A.3; an empty name means unsupported. */
  getAdditionalFormat(_type: string, _platform: ClipboardPlatform): ClipboardFormat {
    // TODO(Clipboard host / §6.5): supply optional text/uri-list mapping and its OS
    // representation policy. A.3 has no entry for it; do not guess or treat it as custom.
    // This lookup must not register a format or mutate the clipboard.
    throw new InternalError('Additional clipboard format mapping is not implemented');
  }

  /** Write every prepared item, including its custom map and payloads, in one collective commit. */
  writeFormats(_items: ClipboardFormatWriteItem[], _platform: ClipboardPlatform, _document: DocumentImpl): InternalPromise<boolean> {
    // TODO(Clipboard host): resolve/register format names, preserving predefined Windows IDs;
    // apply standard OS text/binary encodings, and retain opaque custom bytes exactly.
    // Each item's custom map and indexed names belong to that item; do not merge items
    // or overwrite another item's payload when their format names coincide.
    // Read all Blobs and validate host size/count limits before any clipboard mutation.
    // Empty custom batches are null: do not write a fabricated empty custom map.
    // SPEC_GAP(clipboard-native-target): A.2 leaves selection among OS clipboards undefined;
    // the adapter must establish that policy and the platform's atomic commit mechanism.
    // Recheck the original Document's activity/focus immediately before mutation if
    // encoding or Blob reads suspend. No partially prepared result may be published.
    // Resolve only after completion, reporting whether contents changed; reject failures.
    // The caller queues change notification, so suppress the adapter's echo to that Document.
    throw new InternalError('OS clipboard format writing is not implemented');
  }

  /** Whether the current script runs from a UA/OS Paste control, not a synthetic paste event. */
  isPasteInteraction(_document: DocumentImpl): boolean {
    // TODO(Clipboard host): native menu/command provenance scoped to the running task.
    // Activation alone, an event name, or script execCommand('paste') does not establish it.
    throw new InternalError('Native Paste interaction provenance is not implemented');
  }

  /** Create lazy items from metadata after Clipboard has admitted this Document's read. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-read
  readItems(document: DocumentImpl, unsanitizedTypes: string[]): InternalPromise<ClipboardItemImpl[]> {
    // Retain the request's policy before a delayed metadata result; never read payloads here.
    const unsanitized = [...unsanitizedTypes];
    return this.readItemMetadata(document).then((snapshot) => {
      const items: ClipboardItemImpl[] = [];
      for (const item of snapshot.items) {
        if (item.formats.size !== 0) items.push(ClipboardItemImpl.create(item, snapshot.entry, unsanitized, document));
      }
      return items;
    }, undefined, internalType<ClipboardItemImpl[]>());
  }

  /** Map one generation to standard/custom MIME keys without reading representation payloads. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-read
  readItemMetadata(document: DocumentImpl): InternalPromise<ClipboardReadSnapshot> {
    return this.readFormatSnapshot(document, true).then((snapshot) => {
      const items: ClipboardReadItem[] = [];
      for (const item of snapshot.items) {
        const formats = new Map<string, ClipboardFormat>();
        for (const format of item.formats) {
          const mimeType = getWellKnownMIMEType(format, snapshot.platform);
          if (mimeType !== null) formats.set(serializeMIMEType(mimeType), format);
        }
        if (formats.size !== 0) items.push({ index: item.index, formats, presentationStyle: item.presentationStyle });
      }
      if (snapshot.customMap !== null) {
        const custom = readCustomFormats(snapshot.customMap, document.env);
        if (custom.size !== 0) {
          const first = items[0];
          if (first) {
            for (const [type, format] of custom) first.formats.set(type, format);
          } else {
            // Retain §7.3.1's custom-only item with no originating system item.
            items.push({ index: null, formats: custom, presentationStyle: 'unspecified' });
          }
        }
      }
      return { entry: new Uint8Array(snapshot.entry), items };
    }, undefined, internalType<ClipboardReadSnapshot>());
  }

  /** Enumerate one generation; read its custom JSON map only when includeCustomMap is true. */
  // TODO(Clipboard host): select the platform, retain original item indices and styles,
  // resolve registered format IDs to canonical names and preserve predefined Windows IDs.
  // When requested, read the format named by getCustomFormatMapName from this generation
  // as UTF-8 bytes (null if absent). Otherwise return customMap=null without reading it.
  // Never read representation payloads or combine different generations.
  // Enforce host metadata size/count limits before allocation and report failures explicitly (§10.4).
  readFormatSnapshot(_document: DocumentImpl, _includeCustomMap: boolean): InternalPromise<ClipboardFormatSnapshot> {
    throw new InternalError('System clipboard format snapshot reading is not implemented');
  }

  /** Read owned bytes for exactly this generation, item and canonical type; null means absent data. */
  // TODO(Clipboard host / §7.2.3): validate the generation at OS access and read the selected
  // format retained from discovery. Resolve/register names at the OS boundary; do not reload
  // the custom map. Return owned bytes and never substitute a newer clipboard entry.
  // Standard text must use UTF-8. Custom types (web prefix), binary data and image/png retain
  // their bytes/metadata; the MIME key distinguishes interpretation from the OS format name.
  // Throw/reject native failures; ClipboardItem keeps them observable on the clipboard task source.
  readItemBytes(
    _index: number, _type: string, _format: ClipboardFormat, _entry: Uint8Array, _document: DocumentImpl,
  ): InternalPromise<Uint8Array | null> {
    throw new InternalError('System clipboard representation bytes are not implemented');
  }

  /** Prepare standard HTML/SVG bytes before exposing a system clipboard read; never mutate the supplied bytes. */
  // TODO(Clipboard formats / §7.2.3): supply the read-side HTML/SVG policy through their owners.
  // ClipboardItem bypasses this operation for permitted unsanitized text/html, PNG and opaque
  // custom formats. Write-side image decoding/transcoding is not a read-side fallback (§10.3).
  prepareReadData(_data: Uint8Array, _type: string, _document: DocumentImpl): InternalPromise<Uint8Array> {
    throw new InternalError('Rich clipboard read preparation is not implemented');
  }

  /** Select the first standard plain-text representation, retaining its generation through delivery. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-readtext
  readTextData(document: DocumentImpl): InternalPromise<ClipboardTextSnapshot> {
    const env = document.env;
    const P = env.userAgent.HostPromise;
    this.validateRead(null, document);
    return P.try(() => this.readFormatSnapshot(document, false), internalType<ClipboardFormatSnapshot>()).then((snapshot) => {
      const entry = new Uint8Array(snapshot.entry);
      this.validateRead(entry, document);
      // Match A.3/A.4's standard text format directly, once per snapshot. Custom web
      // formats and their JSON map do not participate in plain-text selection.
      const format = getWellKnownFormat('text/plain', snapshot.platform);
      for (const item of snapshot.items) {
        if (!item.formats.includes(format)) continue;
        const index = item.index;
        return P.try(() => this.readItemBytes(index, 'text/plain', format, entry.slice(), document), internalType<Uint8Array | null>()).then((bytes) => {
          this.validateRead(entry, document);
          if (bytes === null) throw new DOMExceptionImpl('Clipboard text is unavailable', DOMExceptionNames.notFound);
          // Own the returned bytes before Blob decoding or queued result delivery.
          // The OS adapter supplies UTF-8; File retains BOM and malformed-input rules.
          const data = BlobData.fromBytes(bytes);
          return { entry, data: BlobImpl.create(data, 'text/plain', data.captureSnapshotState(), env) };
        }, undefined, internalType<ClipboardTextSnapshot>());
      }
      return { entry, data: null };
    }, undefined, internalType<ClipboardTextSnapshot>());
  }

  #isEligible(document: DocumentImpl): boolean {
    // SPEC_CLASH(clipboard-change-native-eligibility): Gate real notifications on a secure, fully active Document;
    // the draft's Window-target algorithm omits these checks, while Blink receives through secure Clipboard ownership.
    if (!document.env.isSecureContext || !document.isFullyActive()) return false;
    const realm = document.env.realm;
    if (!realm.isWindow()) return false;
    return realm.windowImplementation.hasStickyActivation() || this.hasPersistentReadPermission(document);
  }

  #dispatchChange(document: DocumentImpl): void {
    const state = this.readChangeState();
    // https://w3c.github.io/clipboard-apis/#mandatory-data-types-x
    // Custom/optional formats never enter a native change event; the event constructor remains unrestricted.
    const types = [...new Set(state.types.filter((type) => mandatoryTypes.has(type)))];
    const changeId = this.generateChangeId(document, state.token);
    const realm = document.env.realm;
    if (!realm.isWindow()) throw new InternalError('Clipboard change delivery requires a Window');
    // SPEC_CLASH(clipboard-change-target): Follow the written algorithm's relevant global; Blink and the draft's example use navigator.clipboard.
    realm.windowImplementation.fireEvent('clipboardchange', ClipboardChangeEventImpl, (event) => {
      event.types = types;
      event.changeId = changeId;
    });
  }
}

/** One prepared item; its standard representations and custom batch retain their own order. */
export interface ClipboardFormatWriteItem {
  standard: ClipboardFormatData[];
  custom: ClipboardCustomWrite | null;
  presentationStyle: PresentationStyle;
}
export interface ClipboardFormatData {
  format: ClipboardFormat;
  data: BlobImpl;
}

/** OS format discovery and the optional custom-map bytes, captured in one generation. */
export interface ClipboardFormatSnapshot {
  platform: ClipboardPlatform;
  entry: Uint8Array;
  items: ClipboardFormatItem[];
  customMap: Uint8Array | null;
}
export interface ClipboardFormatItem {
  index: number;
  formats: ClipboardFormat[];
  presentationStyle: PresentationStyle;
}

/** Metadata from one clipboard generation; canonical MIME keys preserve discovery order. */
export interface ClipboardReadSnapshot {
  entry: Uint8Array;
  items: ClipboardReadItem[];
}
export interface ClipboardReadItem {
  /** Original native index; null denotes the draft's custom item with no originating system item. */
  index: number | null;
  formats: Map<string, ClipboardFormat>;
  presentationStyle: PresentationStyle;
}

/** Standard text data and its captured generation, retained until the author result is delivered. */
export interface ClipboardTextSnapshot {
  entry: Uint8Array;
  data: ClipboardTextData;
}

/** Standard text data; null distinguishes absent text from a failed read. */
export type ClipboardTextData = string | BlobImpl | null;

/** Native snapshot; types are canonical MIME names, and token equality identifies one clipboard write. */
export interface ClipboardChangeState {
  types: readonly string[];
  token: Uint8Array;
}

/** Only these events use DataTransfer and §8's action algorithms. */
export type ClipboardEventType = 'copy' | 'cut' | 'paste';
/** Internal command provenance; user means a recognized native menu or shortcut action. */
export type ClipboardActionSource = 'user' | 'script';
/** Clipboard operations whose default action can change an editable Document. */
export type ClipboardEditAction = 'cut' | 'paste';

/** The admitted action consumes this result after author access to the transfer has ended. */
export interface ClipboardEventResult {
  canceled: boolean;
  items: DragDataItem[];
  clearWasCalled: boolean;
  typesToClear: string[];
}

/** Fully materialized data from one permitted native paste read, with an optional native sequence token. */
export interface ClipboardPasteData {
  items: DragDataItem[];
  entry: Uint8Array | null;
}

const mandatoryTypes = new Set(['text/plain', 'text/html', 'image/png']);
