import { asciiLower } from '../../../infra/index';
import {
  arg, defineInterface, DOMExceptionImpl, DOMExceptionNames, idlType, impl, indexedGetter,
  nullable, op, reference, roAttr,
} from '../../../web-idl/core/index';
import type { FileImpl } from '../../../file/index';

import type { DataTransferImpl } from './data-transfer';
import type { DataTransferItemImpl } from './data-transfer-item';

/** The transfer's live, indexed item view; store mode governs every mutation. */
// https://html.spec.whatwg.org/multipage/dnd.html#the-datatransferitemlist-interface
export class DataTransferItemListImpl {
  /** One owning transfer for the entire lifetime of this view. */
  #transfer: DataTransferImpl;

  constructor(transfer: DataTransferImpl) { this.#transfer = transfer; }

  get length(): number { return this.#transfer.itemCount; }

  getItem(index: number): DataTransferItemImpl | undefined { return this.#transfer.getItem(index); }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransferitemlist-add
  addString(data: string, type: string): DataTransferItemImpl | null {
    if (this.#transfer.mode !== 'read/write') return null;
    // SPEC_CLASH(data-transfer-item-type): Follow HTML/Firefox/WebKit lowercase; Chromium preserves case.
    // SPEC_CLASH(data-transfer-item-aliases): HTML/Chromium/WebKit keep literal text/url types here; Firefox applies legacy aliases.
    type = asciiLower(type);
    for (let index = 0; index < this.length; index++) {
      const item = this.getItem(index)!;
      if (item.kind === 'string' && item.type === type) throw new DOMExceptionImpl('', DOMExceptionNames.notSupported);
    }
    return this.#transfer.appendItem({ kind: 'string', type, data });
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransferitemlist-add
  addFile(data: FileImpl): DataTransferItemImpl | null {
    if (this.#transfer.mode !== 'read/write') return null;
    return this.#transfer.appendItem({ kind: 'file', type: asciiLower(data.type), data });
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransferitemlist-remove
  remove(index: number): void {
    if (this.#transfer.mode !== 'read/write') throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    this.#transfer.removeItem(index);
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransferitemlist-clear
  clear(): void {
    if (this.#transfer.mode === 'read/write') this.#transfer.clearItems();
  }
}

/*
 * [Exposed=Window]
 * interface DataTransferItemList {
 *   readonly attribute unsigned long length;
 *   getter DataTransferItem (unsigned long index);
 *   DataTransferItem? add(DOMString data, DOMString type);
 *   DataTransferItem? add(File data);
 *   undefined remove(unsigned long index);
 *   undefined clear();
 * };
 */
export const dataTransferItemListIDL = defineInterface({
  name: 'DataTransferItemList', exposed: 'Window', implementation: impl(DataTransferItemListImpl),
  members: [
    roAttr('length', idlType.unsignedLong),
    op(undefined, reference('DataTransferItem'),
      [arg('index', idlType.unsignedLong)],
      {
        method: 'getItem', ...indexedGetter(function* (list: DataTransferItemListImpl) {
          for (let index = 0; index < list.length; index++) yield index;
        }, { unsupportedValue: undefined }),
      },
    ),
    op('add', nullable(reference('DataTransferItem')),
      [arg('data', idlType.DOMString), arg('type', idlType.DOMString)],
      { method: 'addString' },
    ),
    op('add', nullable(reference('DataTransferItem')),
      [arg('data', reference('File'))],
      { method: 'addFile' },
    ),
    op('remove', idlType.undefined, [arg('index', idlType.unsignedLong)]),
    op('clear', idlType.undefined),
  ],
});
