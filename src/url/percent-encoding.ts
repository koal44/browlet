import '@exodus/bytes/encoding.js';
import {
  percentEncodeAfterEncoding as encodeAfterEncoding,
} from '@exodus/bytes/whatwg.js';

/*
 * Percent-encoded bytes.
 *
 * https://url.spec.whatwg.org/#percent-encoded-bytes
 */
export type PercentEncodeSet =
  | 'c0_control'
  | 'fragment'
  | 'query'
  | 'special_query'
  | 'path'
  | 'userinfo'
  | 'component'
  | 'form_urlencoded';

export function percentEncodeByte(byte: number): string {
  return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function percentDecodeBytes(input: ArrayLike<number>): number[] {
  const output: number[] = [];

  for (let i = 0; i < input.length; i++) {
    const byte = input[i]!;
    const firstHex = input[i + 1];
    const secondHex = input[i + 2];

    if (
      byte !== 0x25 ||
      !isASCIIHexDigit(firstHex) ||
      !isASCIIHexDigit(secondHex)
    ) {
      output.push(byte);
      continue;
    }

    output.push(Number.parseInt(
      String.fromCharCode(firstHex, secondHex),
      16,
    ));
    i += 2;
  }

  return output;
}

export function percentDecodeString(input: string): number[] {
  return percentDecodeBytes(textEncoder.encode(input));
}

export function percentEncodeAfterEncoding(
  encoding: string,
  input: string,
  percentEncodeSet: PercentEncodeSet,
): string {
  const additionalASCII = String.fromCodePoint(
    ...additionalASCIIPercentEncodeCodePoints[percentEncodeSet],
  );
  return encodeAfterEncoding(
    encoding,
    input,
    additionalASCII,
    percentEncodeSet === 'form_urlencoded',
  );
}

export function utf8PercentEncode(
  input: string,
  percentEncodeSet: PercentEncodeSet,
): string {
  return percentEncodeAfterEncoding('UTF-8', input, percentEncodeSet);
}

const textEncoder = new TextEncoder();

const additionalASCIIPercentEncodeCodePoints: Record<
  PercentEncodeSet,
  number[]
> = {
  c0_control: [],
  fragment: [0x20, 0x22, 0x3c, 0x3e, 0x60],
  query: [0x20, 0x22, 0x23, 0x3c, 0x3e],
  special_query: [0x20, 0x22, 0x23, 0x27, 0x3c, 0x3e],
  path: [0x20, 0x22, 0x23, 0x3c, 0x3e, 0x3f, 0x5e, 0x60, 0x7b, 0x7d],
  userinfo: [
    0x20, 0x22, 0x23, 0x2f, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
    0x40, 0x5b, 0x5c, 0x5d, 0x5e, 0x60, 0x7b, 0x7c, 0x7d,
  ],
  component: [
    0x20, 0x22, 0x23, 0x24, 0x25, 0x26, 0x2b, 0x2c, 0x2f, 0x3a,
    0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x5b, 0x5c, 0x5d, 0x5e,
    0x60, 0x7b, 0x7c, 0x7d,
  ],
  form_urlencoded: [
    0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29,
    0x2b, 0x2c, 0x2f, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40,
    0x5b, 0x5c, 0x5d, 0x5e, 0x60, 0x7b, 0x7c, 0x7d, 0x7e,
  ],
};

function isASCIIHexDigit(byte: number | undefined): byte is number {
  return byte !== undefined && (
    byte >= 0x30 && byte <= 0x39 ||
    byte >= 0x41 && byte <= 0x46 ||
    byte >= 0x61 && byte <= 0x66
  );
}
