import { isomorphicDecode, type JSEnvironment } from '../js-engine/index';

import { decode, getEncoding } from '../encoding/index';
import { parseMIMEType } from '../mime/index';
import { forgivingBase64Encode } from '../infra/index';
import { DOMExceptionImpl, DOMExceptionNames } from '../web-idl/core/index';

/** Package Blob bytes in the requested FileReader result format. */
// https://w3c.github.io/FileAPI/#package-data
export function packageData(
  bytes: Uint8Array,
  type: FileReadType,
  mimeType: string,
  encodingLabel: string | undefined,
  env: JSEnvironment,
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
      try {
        return env.exec.buffers.copyArrayBuffer(bytes);
      } catch (error) {
        if (!(error instanceof env.exec.RangeError)) throw error;
        // SPEC_CLASH(filereader-allocation-error): retain a DOMException for allocation failure.
        // Follow WebKit's NotReadableError mapping; see the File API roadmap.
        throw new DOMExceptionImpl('', DOMExceptionNames.notReadable);
      }
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
