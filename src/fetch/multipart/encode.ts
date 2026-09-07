import { isomorphicDecode, isomorphicEncode } from '@exodus/bytes/encoding-lite.js';

import { encode } from '../../encoding/hooks';
import { readBlobBytes } from '../../file/index';
import { percentEncodeByte } from '../../url/percent-encoding';
import type { FormDataEntry } from '../../xhr/index';

/*
 * HTML §4.10.22.8, multipart/form-data encoding algorithm.
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm
 *
 * The caller supplies boundary generation. Entries and file metadata are
 * captured before awaiting byte reads; normalization never changes the list.
 */
export async function encodeMultipartFormData(
  entries: readonly FormDataEntry[],
  generateBoundary: () => string,
  encoding = 'UTF-8',
): Promise<MultipartEncoding> {
  const parts = await Promise.all(entries.map(async ([name, value]) => {
    const normalizedName = name.replace(/\r\n|\r|\n/g, '\r\n');
    let header = `Content-Disposition: form-data; name="${escapeName(normalizedName, encoding)}"`;
    if (typeof value === 'string') {
      return [
        isomorphicEncode(header + '\r\n\r\n'),
        encode(value.replace(/\r\n|\r|\n/g, '\r\n'), encoding),
      ];
    }
    header += `; filename="${escapeName(value.name, encoding)}"\r\n`;
    header += `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`;
    return [isomorphicEncode(header), await readBlobBytes(value)];
  }));

  // RFC 2046 §5.1.1 and RFC 7578 §4.1: a delimiter must not occur in a part.
  let boundary: string;
  let delimiter: Uint8Array;
  do {
    boundary = generateBoundary();
    if (!/^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/.test(boundary)) {
      throw new TypeError('Invalid multipart boundary');
    }
    delimiter = isomorphicEncode(`--${boundary}`);
  } while (parts.some((part) => part.some((bytes) => contains(bytes, delimiter))));

  const separator = isomorphicEncode(`--${boundary}\r\n`);
  const lineEnding = isomorphicEncode('\r\n');
  const chunks: Uint8Array[] = [];
  for (const part of parts) chunks.push(separator, ...part, lineEnding);
  chunks.push(isomorphicEncode(`--${boundary}--\r\n`));

  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, boundary };
}

export type MultipartEncoding = {
  bytes: Uint8Array;
  boundary: string;
};

function escapeName(value: string, encoding: string): string {
  return isomorphicDecode(encode(value, encoding)).replace(/[\r\n"]/g,
    (char) => percentEncodeByte(char.charCodeAt(0)));
}

function contains(bytes: Uint8Array, delimiter: Uint8Array): boolean {
  candidate: for (
    let index = bytes.indexOf(delimiter[0]!);
    index !== -1;
    index = bytes.indexOf(delimiter[0]!, index + 1)
  ) {
    for (let offset = 1; offset < delimiter.length; offset++) {
      if (bytes[index + offset] !== delimiter[offset]) continue candidate;
    }
    return true;
  }
  return false;
}
