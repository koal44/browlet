import { TypeError, internalType, type InternalPromise } from '../../../infra/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface, defineTypedef,
  dictMember, emptyDictionary, frozenArray, idlType, impl, op, promise, record,
  reference, roAttr, staticOp, union, xattr, DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';
import { utf8Encode } from '../../../encoding/index';
import { parseMIMEType, serializeMIMEType } from '../../../mime/index';
import { BlobData, BlobImpl } from '../../../file/index';

import type { BrowletEnvironment } from '../../environment/index';

/** Author-supplied representations; native lazy items enter through SystemClipboard.readItems(). */
// https://w3c.github.io/clipboard-apis/#clipboard-item-interface
export class ClipboardItemImpl {
  #env: BrowletEnvironment;
  #presentationStyle: PresentationStyle;
  #types: string[];
  /** Serialized MIME keys include the web prefix, keeping native and custom representations distinct. */
  #representations = new Map<string, ClipboardItemData>();

  constructor(items: Record<string, ClipboardItemData>, options: ClipboardItemOptions, env: BrowletEnvironment) {
    this.#env = env;
    this.#presentationStyle = options.presentationStyle;
    for (const [type, data] of Object.entries(items)) {
      const key = normalizeType(type);
      if (this.#representations.has(key)) throw new TypeError('Duplicate ClipboardItem representation');
      this.#representations.set(key, data);
    }
    if (this.#representations.size === 0) throw new TypeError('ClipboardItem requires at least one representation');
    // SPEC_CLASH(clipboard-item-types-identity): Keep the specified frozen value, like Firefox;
    // Chromium and WebKit allocate a new array on each access.
    this.#types = [...this.#representations.keys()];
  }

  // https://w3c.github.io/clipboard-apis/#dom-clipboarditem-supports
  static supports(type: string): boolean {
    // SPEC_CLASH(clipboard-item-supports): Recognize the draft's mandatory and optional vocabulary;
    // browsers expose different subsets. This does not establish native read/write availability.
    switch (type) {
      case 'text/plain': case 'text/html': case 'image/png':
      case 'text/uri-list': case 'image/svg+xml':
        return true;
      default:
        return type.startsWith('web ') && parseMIMEType(type.slice(4)) !== null;
    }
  }

  // SPEC_CLASH(clipboard-item-presentation-style): Follow the draft and Firefox/WebKit; Chromium omits this member and options.
  get presentationStyle(): PresentationStyle { return this.#presentationStyle; }
  get types(): readonly string[] { return this.#types; }

  // https://w3c.github.io/clipboard-apis/#dom-clipboarditem-gettype
  getType(type: string): InternalPromise<BlobImpl> {
    // SPEC_CLASH(clipboard-item-result-realms): The draft and Firefox use the item's realm
    // for results, but invalid syntax throws in the method realm through Binding.
    // Chromium uses the method realm for missing-type errors; WebKit also allocates successful results there.
    const key = normalizeType(type);
    const result = this.#env.InternalPromise.withResolvers(reference(BlobImpl));
    const data = this.#representations.get(key);
    if (!data) {
      result.reject(new DOMExceptionImpl('ClipboardItem has no matching representation', DOMExceptionNames.notFound));
      return result.promise;
    }
    // This is the author-constructed branch. SystemClipboard.readItems() must supply
    // the separate native branch with generation checks, cached reads and sanitization;
    // its throwing dependency prevents native reads from masquerading as author data.
    // SPEC_CLASH(clipboard-item-data-conversion): Web IDL converts at each reaction, like Chromium;
    // Firefox caches conversion and WebKit rejects non-string/non-Blob fulfillment values.
    // SPEC_GAP(clipboard-item-conversion-failure): The draft leaves p pending when IDL conversion
    // fails before the fulfilled steps. The third callback rejects it with that failure instead.
    data.observe((value) => {
      try {
        if (typeof value === 'string') {
          // SPEC_CLASH(clipboard-item-string-blob): Encode valid UTF-8 and strip the custom prefix,
          // as specified; Chromium/WebKit include the prefix, and Chromium decodes a lone surrogate as three replacements.
          const bytes = BlobData.fromOwnedBytes(utf8Encode(value));
          const mimeType = key.startsWith('web ') ? key.slice(4) : key;
          result.resolve(BlobImpl.create(bytes, mimeType, bytes.captureSnapshotState(), this.#env));
        } else {
          result.resolve(value);
        }
      } catch (error) { result.reject(error); }
    }, () => {
      // SPEC_CLASH(clipboard-item-data-rejection): The draft requires NotFoundError;
      // Chromium propagates the reason, Firefox uses DataError, and WebKit uses AbortError.
      result.reject(new DOMExceptionImpl('ClipboardItem representation data is unavailable', DOMExceptionNames.notFound));
    }, result.reject);
    return result.promise;
  }
  /** Resolve author representations for §7.3.3 without getType's NotFoundError policy. */
  getWriteData(): InternalPromise<ClipboardWriteItem> {
    const P = this.#env.userAgent.HostPromise;
    const representations = [...this.#representations].map(([key, data]) => {
      const result = P.withResolvers(internalType<ClipboardWriteRepresentation>());
      const isCustom = key.startsWith('web ');
      data.observe((value) => {
        try {
          let blob: BlobImpl;
          if (typeof value === 'string') {
            const bytes = BlobData.fromOwnedBytes(utf8Encode(value));
            blob = BlobImpl.create(bytes, isCustom ? key.slice(4) : key, bytes.captureSnapshotState(), this.#env);
          } else { blob = value; }
          // SPEC_CLASH(clipboard-write-blob-type): §7.3.3 uses Blob.type; browsers
          // select the entry's format instead, and Blink additionally checks that the Blob matches.
          const type = blob.type;
          // SPEC_CLASH(clipboard-write-custom-identity): The main algorithm filters
          // custom formats out before Appendix A can write them. Retain their separate flag.
          if (isCustom ? parseMIMEType(type) === null : type.startsWith('web ') || !ClipboardItemImpl.supports(type)) {
            throw new DOMExceptionImpl('Unsupported clipboard write format', DOMExceptionNames.notAllowed);
          }
          result.resolve({ type, isCustom, data: blob });
        } catch (error) { result.reject(error); }
      }, () => {
        // §7.3.3 rejects NotAllowedError, unlike getType's NotFoundError.
        result.reject(new DOMExceptionImpl('Clipboard write data is unavailable', DOMExceptionNames.notAllowed));
      }, result.reject);
      return result.promise;
    });
    return P.all<ClipboardWriteRepresentation>(representations, internalType<ClipboardWriteRepresentation[]>()).then(
      (items) => ({ representations: items, presentationStyle: this.#presentationStyle }),
      undefined, internalType<ClipboardWriteItem>(),
    );
  }
}

/** One resolved item, retaining the native/custom distinction independently of Blob.type. */
export interface ClipboardWriteItem {
  representations: ClipboardWriteRepresentation[];
  presentationStyle: PresentationStyle;
}
export interface ClipboardWriteRepresentation {
  type: string;
  isCustom: boolean;
  data: BlobImpl;
}

/** Binding supplies the typed Promise and converts fulfillment values when its reactions run. */
export type ClipboardItemData = InternalPromise<string | BlobImpl>;
export type PresentationStyle = 'unspecified' | 'inline' | 'attachment';
export interface ClipboardItemOptions {
  presentationStyle: PresentationStyle;
}

/** Canonical lookup key, including the custom-format discriminator. */
function normalizeType(type: string): string {
  const isCustom = type.startsWith('web ');
  const mime = parseMIMEType(isCustom ? type.slice(4) : type);
  // SPEC_CLASH(clipboard-item-mime-validation): Follow the draft's parsing, like Firefox for ordinary
  // MIME types; Chromium/WebKit retain arbitrary raw strings. Firefox does not yet accept custom types.
  if (mime === null) throw new TypeError('Invalid ClipboardItem MIME type');
  // SPEC_GAP(clipboard-item-mime-equality): Compare serialized MIME types, retaining parameter order,
  // like Firefox. The draft compares records without defining equality for their parameter maps.
  const serialized = serializeMIMEType(mime);
  return isCustom ? 'web ' + serialized : serialized;
}

/*
 * typedef Promise<(DOMString or Blob)> ClipboardItemData;
 */
export const clipboardItemDataIDL = defineTypedef({
  name: 'ClipboardItemData', type: promise(union(idlType.DOMString, reference('Blob'))),
});

/*
 * enum PresentationStyle { "unspecified", "inline", "attachment" };
 */
export const presentationStyleIDL = defineEnumeration({
  name: 'PresentationStyle', values: ['unspecified', 'inline', 'attachment'],
});

/*
 * dictionary ClipboardItemOptions {
 *   PresentationStyle presentationStyle = "unspecified";
 * };
 */
export const clipboardItemOptionsIDL = defineDictionary({
  name: 'ClipboardItemOptions',
  members: [dictMember('presentationStyle', reference('PresentationStyle'), { default: 'unspecified' })],
});

/*
 * [SecureContext, Exposed=Window]
 * interface ClipboardItem {
 *   constructor(record<DOMString, ClipboardItemData> items, optional ClipboardItemOptions options = {});
 *   readonly attribute PresentationStyle presentationStyle;
 *   readonly attribute FrozenArray<DOMString> types;
 *   Promise<Blob> getType(DOMString type);
 *   static boolean supports(DOMString type);
 * };
 */
export const clipboardItemIDL = defineInterface<BrowletEnvironment>({
  name: 'ClipboardItem', exposed: 'Window', ...xattr('SecureContext'),
  implementation: impl(ClipboardItemImpl, { constructWith: [atArg(2, (env) => env)] }),
  members: [
    ctor([
      arg('items', record(idlType.DOMString, reference('ClipboardItemData'))),
      arg('options', reference('ClipboardItemOptions'), { optional: true, default: emptyDictionary }),
    ]),
    roAttr('presentationStyle', reference('PresentationStyle')),
    roAttr('types', frozenArray(idlType.DOMString)),
    op('getType', promise(reference('Blob')), [arg('type', idlType.DOMString)]),
    staticOp('supports', idlType.boolean, [arg('type', idlType.DOMString)]),
  ],
});
