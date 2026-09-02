const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/*
 * Infra section 7, forgiving-base64 encode.
 *
 * https://infra.spec.whatwg.org/#forgiving-base64-encode
 */
export function forgivingBase64Encode(data: Uint8Array): string {
  let result = '';

  for (let index = 0; index < data.length; index += 3) {
    const first = data[index]!;
    const hasSecond = index + 1 < data.length;
    const hasThird = index + 2 < data.length;
    const second = hasSecond ? data[index + 1]! : 0;
    const third = hasThird ? data[index + 2]! : 0;
    const bits = first << 16 | second << 8 | third;

    result += alphabet[bits >> 18 & 0x3f];
    result += alphabet[bits >> 12 & 0x3f];
    result += hasSecond ? alphabet[bits >> 6 & 0x3f] : '=';
    result += hasThird ? alphabet[bits & 0x3f] : '=';
  }

  return result;
}

/*
 * Infra section 7, forgiving-base64 decode.
 *
 * https://infra.spec.whatwg.org/#forgiving-base64-decode
 */
export function forgivingBase64Decode(data: string): Uint8Array | null {
  data = removeASCIIWhitespace(data);

  if (data.length % 4 === 0) {
    if (data.endsWith('==')) data = data.slice(0, -2);
    else if (data.endsWith('=')) data = data.slice(0, -1);
  }

  if (data.length % 4 === 1) return null;

  const output = new Uint8Array(Math.floor(data.length * 6 / 8));
  let buffer = 0;
  let bufferLength = 0;
  let outputIndex = 0;

  for (let index = 0; index < data.length; index++) {
    const value = decodeCodePoint(data.charCodeAt(index));
    if (value === -1) return null;

    buffer = buffer << 6 | value;
    bufferLength += 6;

    if (bufferLength >= 8) {
      bufferLength -= 8;
      output[outputIndex++] = buffer >> bufferLength & 0xff;
    }
  }

  return output;
}

function removeASCIIWhitespace(value: string): string {
  return value.replace(/[\t\n\f\r ]/g, '');
}

function decodeCodePoint(codePoint: number): number {
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41;
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61 + 26;
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 52;
  if (codePoint === 0x2b) return 62;
  if (codePoint === 0x2f) return 63;
  return -1;
}
