import { asciiLower, InternalError, lineEndingPattern, surroundingASCIIWhitespacePattern } from '../../../infra/index';
import {
  arg, atArg, attr, ctor, defineInterface, frozenArray, idlType, impl, op, reference, roAttr, xattr,
} from '../../../web-idl/core/index';
import { FileListImpl, type FileImpl } from '../../../file/index';

import type { ElementImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment/index';

import { DataTransferItemImpl, type DragDataItem } from './data-transfer-item';
import { DataTransferItemListImpl } from './data-transfer-item-list';

/** An author-created transfer and its owned data store, independent of native dragging. */
// https://html.spec.whatwg.org/multipage/dnd.html#the-datatransfer-interface
export class DataTransferImpl {
  env: BrowletEnvironment;
  /** Null after the owner ends access; retained lists/items then become disabled. */
  #store: DragDataStore | null;
  /** One list object for this transfer, including after detachment. */
  #items: DataTransferItemListImpl;
  /** One live FileList, updated immediately even when callers retain it. */
  #files = new FileListImpl();
  /** New list identity only when contents change; Binding freezes it in the receiver's realm. */
  #types: string[] = [];
  /** Per-transfer feedback attributes; the drag processing model later consumes them. */
  #dropEffect = 'none';
  #effectAllowed = 'none';

  constructor(env: BrowletEnvironment) {
    this.env = env;
    this.#store = createDragDataStore();
    this.#store.mode = 'read/write';
    this.#items = new DataTransferItemListImpl(this);
  }

  get dropEffect(): string { return this.#dropEffect; }
  set dropEffect(value: string) {
    // SPEC_CLASH(data-transfer-effects): Follow HTML/Firefox for constructed transfers; Chromium/WebKit ignore their effect setters.
    if (value === 'none' || value === 'copy' || value === 'link' || value === 'move') this.#dropEffect = value;
  }

  get effectAllowed(): string { return this.#effectAllowed; }
  set effectAllowed(value: string) {
    if (this.mode !== 'read/write') return;
    switch (value) {
      case 'none': case 'copy': case 'copyLink': case 'copyMove': case 'link':
      case 'linkMove': case 'move': case 'all': case 'uninitialized':
        this.#effectAllowed = value;
    }
  }

  // SPEC_CLASH(data-transfer-list-identity): Follow HTML's SameObject; Chromium returns a different items object in the probe.
  get items(): DataTransferItemListImpl { return this.#items; }
  get files(): FileListImpl { return this.#files; }
  // SPEC_CLASH(data-transfer-types-identity): Follow HTML/Chromium/Firefox; WebKit creates a fresh frozen array on each read.
  get types(): readonly string[] { return this.#types; }
  get mode(): DragDataStoreMode | null { return this.#store?.mode ?? null; }
  get itemCount(): number { return this.#store?.items.length ?? 0; }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransfer-setdragimage
  setDragImage(image: ElementImpl, x: number, y: number): void {
    if (this.mode !== 'read/write') return;
    this.#createDragImage(image, x, y);
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransfer-getdata
  getData(format: string): string {
    if (this.mode === null || this.mode === 'protected') return '';
    const url = asciiLower(format) === 'url';
    const type = normalizeFormat(format);
    const data = this.#store!.items.find((item) => item.kind === 'string' && item.type === type)?.getText() ?? '';
    return url ? firstURIListEntry(data) : data;
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransfer-setdata
  setData(format: string, data: string): void {
    const store = this.#store;
    if (store?.mode !== 'read/write') return;
    const type = normalizeFormat(format);
    const index = store.items.findIndex((item) => item.kind === 'string' && item.type === type);
    // SPEC_CLASH(data-transfer-replacement): HTML/Chromium/WebKit remove and append; Firefox edits the existing item in place.
    if (index !== -1) store.items.splice(index, 1)[0]!.disable();
    this.appendItem({ kind: 'string', type, data });
  }

  // https://html.spec.whatwg.org/multipage/dnd.html#dom-datatransfer-cleardata
  clearData(format?: string): void {
    const store = this.#store;
    if (store?.mode !== 'read/write') return;
    const type = format === undefined ? undefined : normalizeFormat(format);
    let changed = false;
    for (let index = store.items.length - 1; index >= 0; index--) {
      const item = store.items[index]!;
      if (item.kind === 'string' && (type === undefined || item.type === type)) {
        store.items.splice(index, 1);
        item.disable();
        changed = true;
      }
    }
    if (changed) this.#updateLists();
  }

  // TODO(HTML §6.11.5 / native drag delivery): associate a per-event transfer with
  // the shared drag store, initialize feedback attributes from the processing
  // model, copy effectAllowed back, and detach after dispatch. The public
  // constructor here owns an independent store; it does not start native dragging.

  /** Select the store access allowed by an owning delivery algorithm. */
  setMode(mode: DragDataStoreMode): void {
    if (!this.#store || this.#store.mode === mode) return;
    this.#store.mode = mode;
    this.#updateFiles();
  }

  /** End this transfer's access, disabling retained items and emptying its live lists. */
  detach(): void {
    if (!this.#store) return;
    for (const item of this.#store.items) item.disable();
    this.#store = null;
    this.#types = [];
    this.#files.replace([]);
  }

  /** The indexed item is stable while it remains in this transfer's store. */
  getItem(index: number): DataTransferItemImpl | undefined {
    return this.#store?.items[index];
  }

  /** Append post-conversion data after the caller's access and duplicate checks. */
  appendItem(data: DragDataItem): DataTransferItemImpl {
    const item = new DataTransferItemImpl(data, this);
    this.#store!.items.push(item);
    this.#updateLists();
    return item;
  }

  /** Remove an item after the caller has checked write access. */
  removeItem(index: number): void {
    const item = this.#store!.items[index];
    if (!item) return;
    this.#store!.items.splice(index, 1);
    item.disable();
    this.#updateLists();
  }

  /** Clear strings and files after the caller has checked write access. */
  clearItems(): void {
    const store = this.#store!;
    if (store.items.length === 0) return;
    for (const item of store.items) item.disable();
    store.items = [];
    this.#updateLists();
  }

  #updateLists(): void {
    const types: string[] = [];
    let hasFiles = false;
    for (const item of this.#store!.items) {
      if (item.kind === 'string') types.push(item.type);
      else hasFiles = true;
    }
    if (hasFiles) types.push('Files');
    this.#types = types;
    this.#updateFiles();
  }

  #updateFiles(): void {
    const files: FileImpl[] = [];
    if (this.mode === 'read/write' || this.mode === 'read-only') {
      for (const item of this.#store!.items) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    this.#files.replace(files);
  }

  #createDragImage(_image: ElementImpl, _x: number, _y: number): never {
    // TODO(HTML drag feedback / rendering): obtain an img's natural-size bitmap,
    // or render another Element, then store that bitmap and its hot spot together.
    // No bitmap/default-feedback owner exists yet; do not pretend these steps succeeded.
    throw new InternalError('DataTransfer drag-image rendering is not implemented');
  }
}

/** Access belongs to the store; null on DataTransfer denotes the separate disabled state. */
export type DragDataStoreMode = 'read/write' | 'read-only' | 'protected';

/** Store entries use their one-to-one item implementations while this transfer owns the store. */
interface DragDataStore {
  items: DataTransferItemImpl[];
  mode: DragDataStoreMode;
  allowedEffects: string;
  // These remain absent until the explicit rendering dependency can supply them.
  defaultFeedback: null;
  bitmap: null;
  hotSpot: null;
}

// https://html.spec.whatwg.org/multipage/dnd.html#create-a-drag-data-store
function createDragDataStore(): DragDataStore {
  return { items: [], mode: 'protected', allowedEffects: 'uninitialized', defaultFeedback: null, bitmap: null, hotSpot: null };
}

/** Legacy aliases apply to DataTransfer's string methods, never to items.add(). */
function normalizeFormat(format: string): string {
  const type = asciiLower(format);
  return type === 'text' ? 'text/plain' : type === 'url' ? 'text/uri-list' : type;
}

// https://www.rfc-editor.org/rfc/rfc2483.html#section-5
function firstURIListEntry(data: string): string {
  // SPEC_CLASH(data-transfer-uri-list): Firefox/WebKit keep a malformed first entry; Chromium skips invalid URLs. RFC 2483 assumes URI lines without defining recovery.
  for (const line of data.split(lineEndingPattern)) {
    const value = line.replace(surroundingASCIIWhitespacePattern, '');
    if (value && !value.startsWith('#')) return value;
  }
  return '';
}

/*
 * [Exposed=Window]
 * interface DataTransfer {
 *   constructor();
 *   attribute DOMString dropEffect;
 *   attribute DOMString effectAllowed;
 *   [SameObject] readonly attribute DataTransferItemList items;
 *   undefined setDragImage(Element image, long x, long y);
 *   readonly attribute FrozenArray<DOMString> types;
 *   DOMString getData(DOMString format);
 *   undefined setData(DOMString format, DOMString data);
 *   undefined clearData(optional DOMString format);
 *   [SameObject] readonly attribute FileList files;
 * };
 */
export const dataTransferIDL = defineInterface<BrowletEnvironment>({
  name: 'DataTransfer', exposed: 'Window',
  implementation: impl(DataTransferImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    ctor([]),
    attr('dropEffect', idlType.DOMString), attr('effectAllowed', idlType.DOMString),
    roAttr('items', reference('DataTransferItemList'), xattr('SameObject')),
    op('setDragImage', idlType.undefined,
      [arg('image', reference('Element')), arg('x', idlType.long), arg('y', idlType.long)],
    ),
    roAttr('types', frozenArray(idlType.DOMString)),
    op('getData', idlType.DOMString, [arg('format', idlType.DOMString)]),
    op('setData', idlType.undefined, [arg('format', idlType.DOMString), arg('data', idlType.DOMString)]),
    op('clearData', idlType.undefined, [arg('format', idlType.DOMString, { optional: true })]),
    roAttr('files', reference('FileList'), xattr('SameObject')),
  ],
});
