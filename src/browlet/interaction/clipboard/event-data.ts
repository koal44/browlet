import { asciiLower } from '../../../infra/index';
import type { FileListImpl } from '../../../file/index';

import {
  DataTransferImpl, type DataTransferItemImpl, type DataTransferItemListImpl,
  type DragDataItem, type DragDataStoreMode,
} from '../drag-drop/index';
import type { BrowletEnvironment } from '../../environment/index';

import type { ClipboardPasteData, SystemClipboard } from './system-clipboard';

/** Native Clipboard's DataTransfer, projected through the existing DataTransfer binding. */
// https://w3c.github.io/clipboard-apis/#to-fire-a-clipboard-event
export class ClipboardDataTransferImpl extends DataTransferImpl {
  clearWasCalled = false;
  typesToClear: string[] = [];
  #clipboard: SystemClipboard | null;
  #entry: Uint8Array | null = null;

  constructor(paste: ClipboardPasteData | null, clipboard: SystemClipboard, env: BrowletEnvironment) {
    super(env);
    this.#clipboard = clipboard;
    if (paste) {
      // Decoding, filtering, HTML processing and File creation belong to readForPaste().
      for (const item of paste.items) super.appendItem({ ...item });
      this.setMode('read-only');
      this.#entry = paste.entry?.slice() ?? null;
    }
  }

  override get mode(): DragDataStoreMode | null {
    if (this.#entry && !this.#clipboard!.isCurrentEntry(this.#entry)) {
      // Once revoked, access cannot return even if a host later reuses the token.
      this.#entry = null;
      this.setMode('protected');
    }
    return super.mode;
  }

  override get items(): DataTransferItemListImpl { this.#checkEntry(); return super.items; }
  override get files(): FileListImpl { this.#checkEntry(); return super.files; }
  override get types(): readonly string[] { this.#checkEntry(); return super.types; }
  override get itemCount(): number { this.#checkEntry(); return super.itemCount; }

  override getItem(index: number): DataTransferItemImpl | undefined {
    this.#checkEntry();
    return super.getItem(index);
  }

  override clearData(format?: string): void {
    if (this.mode !== 'read/write') return;
    super.clearData(format);
    const type = format === undefined ? undefined : asciiLower(format);
    this.#recordClear(type === 'text' ? 'text/plain' : type === 'url' ? 'text/uri-list' : type);
  }

  override clearItems(): void {
    super.clearItems();
    this.#recordClear();
  }

  override appendItem(data: DragDataItem): DataTransferItemImpl {
    const item = super.appendItem(data);
    if (this.clearWasCalled) {
      if (this.typesToClear.length === 0) { this.clearWasCalled = false; }
      else {
        const index = this.typesToClear.indexOf(data.type);
        if (index !== -1) this.typesToClear.splice(index, 1);
        if (this.typesToClear.length === 0) this.clearWasCalled = false;
      }
    }
    return item;
  }

  /** Retain data for the action without handing it the author-accessible transfer or item objects. */
  snapshotItems(): DragDataItem[] {
    const mode = this.mode;
    if (mode === null || mode === 'protected') return [];
    const items: DragDataItem[] = [];
    for (let index = 0; index < super.itemCount; index++) {
      const item = super.getItem(index)!;
      if (item.kind === 'string') { items.push({ kind: 'string', type: item.type, data: item.getText() }); }
      else {
        const file = item.getAsFile();
        if (file) items.push({ kind: 'file', type: item.type, data: file });
      }
    }
    return this.mode === 'protected' ? [] : items;
  }

  override detach(): void {
    this.#entry = null;
    this.#clipboard = null;
    super.detach();
  }

  #checkEntry(): void { void this.mode; }

  #recordClear(type?: string): void {
    // SPEC_GAP(clipboard-clear-formats): Normalize like DataTransfer; a clear-all replaces prior per-format requests.
    // A later narrower request cannot undo an outstanding clear-all.
    if (this.clearWasCalled && this.typesToClear.length === 0) return;
    this.clearWasCalled = true;
    if (type === undefined) this.typesToClear = [];
    else if (!this.typesToClear.includes(type)) this.typesToClear.push(type);
  }
}
