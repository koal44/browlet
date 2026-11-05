import { InternalError, internalType, type InternalPromise, type InternalPromiseWithResolvers } from '../../../infra/index';
import {
  arg, atArg, defineDictionary, defineInterface, definePartialInterface, defineTypedef,
  dictMember, emptyDictionary, idlType, impl, op, promise, reference, roAttr, sequence, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';
import { utf8Encode } from '../../../encoding/index';
import { BlobData, BlobImpl, convertLineEndingsToNative } from '../../../file/index';

import { EventTargetImpl } from '../../dom/events/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment/index';

import { ClipboardItemImpl, type ClipboardWriteItem, type ClipboardWriteRepresentation } from './item';

/** One Navigator's asynchronous clipboard interface; the UserAgent owns native access. */
// https://w3c.github.io/clipboard-apis/#clipboard-interface
export class ClipboardImpl extends EventTargetImpl {
  declare env: BrowletEnvironment;

  constructor(env: BrowletEnvironment) {
    super(env);
  }

  /** Admit a read now, then enumerate native item metadata and deliver on the clipboard task source. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-read
  read(formats: ClipboardUnsanitizedFormats): InternalPromise<ClipboardItemImpl[]> {
    const env = this.env;
    const result = env.InternalPromise.withResolvers<ClipboardItemImpl[]>(sequence(reference(ClipboardItemImpl)));
    // SPEC_CLASH(clipboard-read-unsanitized-duplicates): Validate each entry as written;
    // Blink rejects lists longer than one, including repeated text/html.
    const unsanitizedTypes = formats.unsanitized ?? [];
    // §6.6 supplies this vocabulary to §7.3.1; these are exact MIME strings, not a MIME parser input.
    if (unsanitizedTypes.some((type) => type !== 'text/html')) {
      // SPEC_GAP(clipboard-read-invalid-options-abort): The draft rejects without aborting.
      // Stop before permission/native access, as Blink does.
      result.reject(new DOMExceptionImpl('Unsupported unsanitized clipboard format', DOMExceptionNames.notAllowed));
      return result.promise;
    }

    this.#runRead(result, (document) => env.userAgent.systemClipboard.readItems(document, unsanitizedTypes));
    return result.promise;
  }

  /** Read the first standard plain-text representation after admitting the request. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-readtext
  readText(): InternalPromise<string> {
    const env = this.env;
    const result = env.InternalPromise.withResolvers(idlType.DOMString);
    this.#runRead(result, (document) => {
      // The native owner selects a stable text representation; readText does not
      // create ClipboardItems or touch unrelated payloads through read().
      return env.userAgent.systemClipboard.readTextData(document).then<string>((data) => {
        // SPEC_CLASH(clipboard-readtext-empty): Firefox/WebKit return an empty string
        // when no plain text exists; the draft unconditionally rejects NotFoundError.
        if (data === null) return '';
        if (typeof data === 'string') return data;
        // File already implements the specified UTF-8 decoding, including BOM removal
        // and malformed-sequence replacement, independent of Blob.type/charset.
        return data.text();
      }, undefined, idlType.DOMString).catch(() => {
        // SPEC_CLASH(clipboard-readtext-data-failure): Keep the draft's NotFoundError
        // for unreadable data; Gecko routes native data failures through NotAllowedError.
        throw new DOMExceptionImpl('Clipboard text could not be read', DOMExceptionNames.notFound);
      });
    });
    return result.promise;
  }

  /** Write converted ClipboardItems after write permission and representation preparation. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-write
  write(data: ClipboardItemImpl[]): InternalPromise<void> {
    const env = this.env;
    const result = env.InternalPromise.withResolvers(idlType.undefined);
    this.#runWrite(result, (document) => {
      if (data.length === 0) { result.resolve(undefined); return; }
      const systemClipboard = env.userAgent.systemClipboard;
      // SPEC_CLASH(clipboard-write-multiple-items): The draft selects the first
      // item on single-item hosts; Chromium/Firefox instead reject multiple items.
      const items = data.length > 1 && !systemClipboard.supportsMultipleItems() ? data.slice(0, 1) : data;
      const P = env.userAgent.HostPromise;
      // SPEC_CLASH(clipboard-write-await-data): The draft continues before its
      // promise reactions finish and reuses lists across items. Await all data,
      // preserve each item's grouping, and commit together like WebKit.
      P.all<ClipboardWriteItem>(items.map((item) => item.getWriteData()), internalType<ClipboardWriteItem[]>()).observe(
        (resolved) => {
          env.queueTask('clipboard', () => { this.#prepareWrite(resolved, document, result); });
        }, (error) => { env.queueTask('clipboard', () => { result.reject(error); }); },
      );
    });
    return result.promise;
  }

  /** Encode one plain-text representation, then use the admitted native commit. */
  // https://w3c.github.io/clipboard-apis/#dom-clipboard-writetext
  writeText(data: string): InternalPromise<void> {
    const env = this.env;
    const result = env.InternalPromise.withResolvers(idlType.undefined);
    this.#runWrite(result, (document) => {
      // SPEC_CLASH(clipboard-writetext-windows-newlines): The draft's literal LF
      // replacement doubles existing CRLF. Follow Blink: normalize CR, LF and CRLF
      // on Windows, using File's existing host-supplied native line-ending rule.
      const text = env.nativeLineEnding === '\r\n' ? convertLineEndingsToNative(data, env) : data;
      const type = 'text/plain;charset=utf-8';
      const bytes = BlobData.fromOwnedBytes(utf8Encode(text));
      const blob = BlobImpl.create(bytes, type, bytes.captureSnapshotState(), env);
      this.#commitWrite([{
        representations: [{ type, isCustom: false, data: blob }], presentationStyle: 'unspecified',
      }], document, result);
    });
    return result.promise;
  }

  /** Shared permission admission and initial clipboard task for §§7.3.3–7.3.4. */
  #runWrite(result: InternalPromiseWithResolvers<void>, writeData: (document: DocumentImpl) => void): void {
    const env = this.env;
    try {
      const realm = env.realm;
      if (!realm.isWindow()) throw new InternalError('Clipboard requires a Window realm');
      const document = realm.windowImplementation.getAssociatedDocument();
      this.#requireFocusedDocument(document);
      // Capture native interaction and activation in this task, before parallel consent.
      env.userAgent.systemClipboard.checkWritePermission(document).observe((allowed) => {
        if (!allowed) {
          env.queueTask('permissions', () => {
            result.reject(new DOMExceptionImpl('Clipboard write permission denied', DOMExceptionNames.notAllowed));
          });
          return;
        }
        env.queueTask('clipboard', () => {
          try {
            this.#requireFocusedDocument(document);
            writeData(document);
          } catch (error) { result.reject(error); }
        });
      }, (error) => { env.queueTask('permissions', () => { result.reject(error); }); });
    } catch (error) { result.reject(error); }
  }

  /** Prepare rich formats without writing any partial result to the native clipboard. */
  #prepareWrite(items: ClipboardWriteItem[], document: DocumentImpl, result: InternalPromiseWithResolvers<void>): void {
    const env = this.env;
    const P = env.userAgent.HostPromise;
    const systemClipboard = env.userAgent.systemClipboard;
    try {
      this.#requireFocusedDocument(document);
      const prepared = items.map((item) => {
        const representations = item.representations.map((representation) => {
          const { type, isCustom, data } = representation;
          // Standard plain text and URI lists need no rich-content processing.
          // Custom data remains opaque to the browser's sanitizers.
          if (isCustom || type === 'text/plain' || type === 'text/uri-list') {
            return P.resolve(representation, internalType<ClipboardWriteRepresentation>());
          }
          // Capture a synchronous missing dependency too, so all already-started
          // preparations remain observed by the join below if a later one throws.
          return P.try(() => systemClipboard.prepareWriteData(data, document).then(
            (blob) => ({ type, isCustom, data: blob }),
            () => { throw new DOMExceptionImpl('Clipboard format preparation failed', DOMExceptionNames.notAllowed); },
            internalType<ClipboardWriteRepresentation>(),
          ), internalType<ClipboardWriteRepresentation>());
        });
        return P.all<ClipboardWriteRepresentation>(representations, internalType<ClipboardWriteRepresentation[]>()).then(
          (representations) => ({ representations, presentationStyle: item.presentationStyle }),
          undefined, internalType<ClipboardWriteItem>(),
        );
      });
      P.all<ClipboardWriteItem>(prepared, internalType<ClipboardWriteItem[]>()).observe((ready) => {
        env.queueTask('clipboard', () => { this.#commitWrite(ready, document, result); });
      }, (error) => { env.queueTask('clipboard', () => { result.reject(error); }); });
    } catch (error) { result.reject(error); }
  }

  #commitWrite(items: ClipboardWriteItem[], document: DocumentImpl, result: InternalPromiseWithResolvers<void>): void {
    const env = this.env;
    const systemClipboard = env.userAgent.systemClipboard;
    try {
      this.#requireFocusedDocument(document);
      systemClipboard.writeItems(items, document).observe((changed) => {
        env.queueTask('clipboard', () => {
          // A completed native effect remains a change even if focus was lost afterward.
          if (changed) systemClipboard.queueChange(document);
          try {
            this.#requireFocusedDocument(document);
            result.resolve(undefined);
          } catch (error) { result.reject(error); }
        });
      }, (error) => { env.queueTask('clipboard', () => { result.reject(error); }); });
    } catch (error) { result.reject(error); }
  }

  /** Shared admission and task delivery for §7.3.1 and §7.3.2. */
  // SPEC_CLASH(clipboard-readtext-settlement): §7.3.2 tests uninitialized representation
  // fields and rejects without waiting for data. Await the selected text and decoding,
  // then settle in the clipboard task, as native read completion does in browsers.
  #runRead<T>(result: InternalPromiseWithResolvers<T>, readData: (document: DocumentImpl) => InternalPromise<T>): void {
    const env = this.env;
    try {
      const realm = env.realm;
      if (!realm.isWindow()) throw new InternalError('Clipboard requires a Window realm');
      const document = realm.windowImplementation.getAssociatedDocument();
      this.#requireFocusedDocument(document);
      const systemClipboard = env.userAgent.systemClipboard;
      // §9.1 refers to the current script's Paste interaction. Capture it while
      // its task is still running, instead of consulting another task in parallel.
      const allowed = systemClipboard.checkReadPermission(document);
      env.runInParallel(() => {
        if (!allowed) {
          env.queueTask('permissions', () => {
            result.reject(new DOMExceptionImpl('Clipboard read permission denied', DOMExceptionNames.notAllowed));
          });
          return;
        }
        try {
          this.#requireFocusedDocument(document);
          readData(document).observe((value) => {
            env.queueTask('clipboard', () => {
              try {
                this.#requireFocusedDocument(document);
                result.resolve(value);
              } catch (error) { result.reject(error); }
            });
          }, (error) => {
            env.queueTask('clipboard', () => { result.reject(error); });
          });
        } catch (error) {
          env.queueTask('clipboard', () => { result.reject(error); });
        }
      });
    } catch (error) { result.reject(error); }
  }

  // https://w3c.github.io/clipboard-apis/#privacy-async
  // SPEC_GAP(clipboard-read-document-lifetime): §7.3 does not place §11.2's focus
  // check or specify later lifetime checks. Require the original Document to
  // remain fully active and focused before native access, write preparation/commit, and result delivery.
  #requireFocusedDocument(document: DocumentImpl): void {
    if (!document.isFullyActive() || !document.hasFocus()) {
      throw new DOMExceptionImpl('Clipboard access requires an active, focused Document', DOMExceptionNames.notAllowed);
    }
  }
}

export interface ClipboardUnsanitizedFormats {
  unsanitized?: string[];
}

/*
 * partial interface Navigator {
 *   [SecureContext, SameObject] readonly attribute Clipboard clipboard;
 * };
 */
export const navigatorClipboardIDL = definePartialInterface({
  name: 'Navigator', exposed: 'Window',
  members: [roAttr('clipboard', reference('Clipboard'), xattr('SecureContext', 'SameObject'))],
});

/*
 * typedef sequence<ClipboardItem> ClipboardItems;
 */
export const clipboardItemsIDL = defineTypedef({
  name: 'ClipboardItems', type: sequence(reference('ClipboardItem')),
});

/*
 * dictionary ClipboardUnsanitizedFormats {
 *   sequence<DOMString> unsanitized;
 * };
 */
export const clipboardUnsanitizedFormatsIDL = defineDictionary({
  name: 'ClipboardUnsanitizedFormats',
  members: [dictMember('unsanitized', sequence(idlType.DOMString))],
});

/*
 * [SecureContext, Exposed=Window]
 * interface Clipboard : EventTarget {
 *   Promise<ClipboardItems> read(optional ClipboardUnsanitizedFormats formats = {});
 *   Promise<DOMString> readText();
 *   Promise<undefined> write(ClipboardItems data);
 *   Promise<undefined> writeText(DOMString data);
 * };
 */
export const clipboardIDL = defineInterface<BrowletEnvironment>({
  name: 'Clipboard', inherits: 'EventTarget', exposed: 'Window', ...xattr('SecureContext'),
  implementation: impl(ClipboardImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    op('read', promise(reference('ClipboardItems')),
      [arg('formats', reference('ClipboardUnsanitizedFormats'), { optional: true, default: emptyDictionary })],
    ),
    op('readText', promise(idlType.DOMString), []),
    op('write', promise(idlType.undefined), [arg('data', reference('ClipboardItems'))]),
    op('writeText', promise(idlType.undefined), [arg('data', idlType.DOMString)]),
  ],
});
