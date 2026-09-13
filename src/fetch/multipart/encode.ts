import { isomorphicDecode, isomorphicEncode } from '../../js-engine/byte-string';
import { type Encoding, encode } from '../../encoding/encodings';
import { BlobData } from '../../file/index';
import { percentEncodeByte } from '../../url/percent-encoding';
import type { FormDataEntry } from '../../xhr/index';

/*
 * HTML §4.10.22.8, multipart/form-data encoding algorithm.
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart/form-data-encoding-algorithm
 *
 * Encode headers and text while retaining File byte sources for later reads.
 * The boundary and encoded length are available immediately; normalization
 * never changes the entry list.
 */
// SPEC_MISMATCH: (entries, encoding) -> bytes
export function encodeMultipartFormData(
  entries: readonly FormDataEntry[],
  encoding: Encoding,
): MultipartEncoding {
  const boundary = crypto.randomUUID();
  const lineEnding = BlobData.fromOwnedBytes(isomorphicEncode('\r\n'));
  const parts: BlobData[] = [];
  for (const [name, value] of entries) {
    const normalizedName = name.replace(/\r\n|\r|\n/g, '\r\n');
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(normalizedName, encoding)}"`;
    if (typeof value === 'string') {
      parts.push(
        BlobData.fromOwnedBytes(isomorphicEncode(header + '\r\n\r\n')),
        BlobData.fromOwnedBytes(encode(value.replace(/\r\n|\r|\n/g, '\r\n'), encoding)),
      );
    } else {
      header += `; filename="${escapeName(value.name, encoding)}"\r\n`;
      header += `Content-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`;
      parts.push(BlobData.fromOwnedBytes(isomorphicEncode(header)), value.data);
    }
    parts.push(lineEnding);
  }
  parts.push(BlobData.fromOwnedBytes(isomorphicEncode(`--${boundary}--\r\n`)));
  return { boundary, data: BlobData.concatenate(parts) };
}

export type MultipartEncoding = {
  boundary: string;
  data: BlobData;
};

function escapeName(value: string, encoding: Encoding): string {
  return isomorphicDecode(encode(value, encoding)).replace(/[\r\n"]/g,
    (char) => percentEncodeByte(char.charCodeAt(0)));
}
