import { isomorphicDecode } from '@exodus/bytes/encoding-lite.js';

import { decode, getEncoding } from '../encoding/hooks';
import { parseMIMEType } from '../mime/index';
import { forgivingBase64Encode } from '../shared/base64';
import { createArrayBuffer } from '../web-idl/buffer-source';
import type { BindingContext } from '../web-idl/projection';

/** File API §6.3 — Package data. */
export function packageData(
  bytes: Uint8Array,
  type: FileReadType,
  mimeType: string,
  encodingLabel: string | undefined,
  context: BindingContext,
): string | ArrayBuffer {
  switch (type) {
    case 'DataURL': {
      /*
       * File API issue 104 leaves the empty-type spelling underspecified.
       * FileAPI WPT and Blink, Gecko, and WebKit agree on this fallback.
       */
      const mediaType = mimeType || 'application/octet-stream';
      return `data:${mediaType};base64,${forgivingBase64Encode(bytes)}`;
    }
    case 'Text':
      return packageText(bytes, mimeType, encodingLabel);
    case 'ArrayBuffer':
      return createArrayBuffer(bytes, context.realm);
    case 'BinaryString':
      return isomorphicDecode(bytes);
  }
}

export type FileReadType =
  | 'DataURL'
  | 'Text'
  | 'ArrayBuffer'
  | 'BinaryString';

function packageText(
  bytes: Uint8Array,
  mimeType: string,
  encodingLabel: string | undefined,
): string {
  let encoding = encodingLabel === undefined
    ? null
    : getEncoding(encodingLabel);
  if (encoding === null) {
    const charset = parseMIMEType(mimeType)?.parameters.get('charset');
    if (charset !== undefined) encoding = getEncoding(charset);
  }
  return decode(bytes, encoding ?? 'UTF-8');
}
