import { InternalError } from '../../../infra/index';
import { computeHash, randomUUID } from '../../../js-engine/index';
import { utf8Encode } from '../../../encoding/index';
import { StorageKey } from '../../../storage/index';

import { userInteractionTaskSource } from '../../scripting/index';
import type { DragDataItem } from '../drag-drop/index';
import type { DocumentImpl, ElementImpl } from '../../dom/nodes/index';

import { ClipboardChangeEventImpl } from './change-event';
import { ClipboardEventImpl } from './event';
import { ClipboardDataTransferImpl } from './event-data';

/** System clipboard event algorithms and identifier lifetime, owned by one UserAgent. */
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
  // https://w3c.github.io/clipboard-apis/#to-process-html-paste-event
  // The snapshot contains no live native data source; a null token never permits later clipboard reads.
  readForPaste(_document: DocumentImpl): ClipboardPasteData {
    throw new InternalError('Native clipboard paste decoding and HTML processing are not implemented');
  }

  /** Check a captured paste entry; copy/cut use independent empty stores, as browser producers do. */
  isCurrentEntry(entry: Uint8Array): boolean {
    const current = this.readChangeState().token;
    return current.length === entry.length && current.every((byte, index) => byte === entry[index]);
  }

  /** Consult existing synchronous command permission; neither transient activation nor change-listener consent grants paste. */
  // https://w3c.github.io/clipboard-apis/#allow-read-clipboard
  // TODO(Clipboard command permissions): supply the implementation-specific site/app decision.
  // §6's synchronous event API cannot prompt or wait here; permission UI belongs to its owner.
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
