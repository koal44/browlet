import {
  arg, defineCallbackFunction, defineInterface, idlType, impl, nullable, onError, op, reference, roAttr,
} from '../../../web-idl/core/index';
import type { FileImpl } from '../../../file/index';

import { userInteractionTaskSource } from '../../scripting/index';

import type { DataTransferImpl } from './data-transfer';

/** One store entry and its stable platform identity, disabled when removed. */
// https://html.spec.whatwg.org/multipage/dnd.html#the-datatransferitem-interface
export class DataTransferItemImpl {
  /** Converted item data, released on removal instead of retaining inaccessible files/text. */
  #data: DragDataItem | null;
  /** The transfer supplies mode and callback-task ownership; removal breaks this link. */
  #transfer: DataTransferImpl | null;

  constructor(data: DragDataItem, transfer: DataTransferImpl) {
    this.#data = data;
    this.#transfer = transfer;
  }

  get kind(): string { return this.#data?.kind ?? ''; }
  get type(): string { return this.#data?.type ?? ''; }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransferitem-getasstring
  getAsString(callback: FunctionStringCallback | null): void {
    if (!callback || this.#data?.kind !== 'string' || this.#transfer?.mode === 'protected') return;
    const data = this.#data.data;
    // SPEC_GAP(data-transfer-callback-task-source): HTML does not name a task source; use user interaction, matching Blink.
    // Capture data now: later removal or detachment must not revoke already-queued delivery.
    this.#transfer!.env.realm.queueGlobalTask(userInteractionTaskSource, { run: () => callback(data) });
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransferitem-getasfile
  getAsFile(): FileImpl | null {
    if (this.#data?.kind !== 'file' || this.#transfer?.mode === 'protected') return null;
    // SPEC_CLASH(data-transfer-file-identity): All three browsers retain the supplied File; HTML instead says to create a new File on each call.
    return this.#data.data;
  }

  /** Read text after DataTransfer's access check; this is not an author-facing method. */
  getText(): string {
    return this.#data?.kind === 'string' ? this.#data.data : '';
  }

  /** Removal permanently disables this item, even if identical data is subsequently added. */
  disable(): void {
    // SPEC_CLASH(data-transfer-removed-items): Follow HTML/WebKit; Chromium/Firefox retain removed item metadata/data.
    this.#data = null;
    this.#transfer = null;
  }
}

/** Post-conversion values of the two HTML drag data item kinds. */
export type DragDataItem = { kind: 'string'; type: string; data: string; } | { kind: 'file'; type: string; data: FileImpl; };
export type FunctionStringCallback = (data: string) => void;

/*
 * [Exposed=Window]
 * interface DataTransferItem {
 *   readonly attribute DOMString kind;
 *   readonly attribute DOMString type;
 *   undefined getAsString(FunctionStringCallback? _callback);
 *   File? getAsFile();
 * };
 */
export const dataTransferItemIDL = defineInterface({
  name: 'DataTransferItem', exposed: 'Window', implementation: impl(DataTransferItemImpl),
  members: [
    roAttr('kind', idlType.DOMString), roAttr('type', idlType.DOMString),
    op('getAsString', idlType.undefined,
      [arg('callback', nullable(reference('FunctionStringCallback')), onError('report'))],
    ),
    op('getAsFile', nullable(reference('File'))),
  ],
});

/*
 * callback FunctionStringCallback = undefined (DOMString data);
 */
export const functionStringCallbackIDL = defineCallbackFunction({
  name: 'FunctionStringCallback', returns: idlType.undefined, arguments: [arg('data', idlType.DOMString)],
});
