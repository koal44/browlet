import { forgivingBase64Decode } from '../infra/base64';
import { InternalError } from '../infra/internal-error';
import { surroundingASCIIWhitespacePattern } from '../infra/patterns';
import { isomorphicDecode } from '../js-engine/index';
import { type MIMEType, parseMIMEType } from '../mime/index';
import { type URLRecord, percentDecodeString, serializeURL } from '../url/index';

/** Process a data: URL into its MIME type and bytes, or return null on failure. */
// https://fetch.spec.whatwg.org/#data-url-processor
export function processDataURL(url: URLRecord): DataURLStruct | null {
  if (url.scheme !== 'data') throw new InternalError('Data URL processing requires a data: URL');
  const input = serializeURL(url, true).slice(5);
  const comma = input.indexOf(',');
  if (comma === -1) return null;

  let mimeType = input.slice(0, comma).replace(surroundingASCIIWhitespacePattern, '');
  let body: Uint8Array = Uint8Array.from(percentDecodeString(input.slice(comma + 1)));
  const base64Suffix = base64SuffixPattern.exec(mimeType);
  if (base64Suffix !== null) {
    const decoded = forgivingBase64Decode(isomorphicDecode(body));
    if (decoded === null) return null;
    body = decoded;
    mimeType = mimeType.slice(0, base64Suffix.index);
  }
  if (mimeType.startsWith(';')) mimeType = `text/plain${mimeType}`;
  return {
    mimeType: parseMIMEType(mimeType) ?? {
      type: 'text', subtype: 'plain', parameters: new Map([['charset', 'US-ASCII']]),
    },
    body,
  };
}

/** Result of Fetch's data: URL processor. */
export type DataURLStruct = {
  /** Parsed media type, including the processor's default when omitted or invalid. */
  mimeType: MIMEType;
  /** Decoded resource bytes. */
  body: Uint8Array;
};

const base64SuffixPattern = /; *base64$/i;
