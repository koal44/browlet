import { normalizeEncoding } from '@exodus/bytes/encoding.js';

import {
  percentDecodeBytes, percentEncodeAfterEncoding,
} from './percent-encoding';

export type FormTuple = [name: string, value: string];

/*
 * application/x-www-form-urlencoded parser.
 *
 * https://url.spec.whatwg.org/#concept-urlencoded-parser
 */
export function parseFormUrlEncoded(
  input: ArrayLike<number>,
): FormTuple[] {
  const output: FormTuple[] = [];
  let start = 0;

  for (let end = 0; end <= input.length; end++) {
    if (end !== input.length && input[end] !== 0x26) continue;
    if (end !== start) output.push(parseTuple(input, start, end));
    start = end + 1;
  }

  return output;
}

/*
 * application/x-www-form-urlencoded string parser.
 *
 * https://url.spec.whatwg.org/#concept-urlencoded-string-parser
 */
export function parseFormUrlEncodedString(input: string): FormTuple[] {
  return parseFormUrlEncoded(textEncoder.encode(input));
}

/*
 * application/x-www-form-urlencoded serializer.
 *
 * https://url.spec.whatwg.org/#concept-urlencoded-serializer
 */
export function serializeFormUrlEncoded(
  tuples: FormTuple[],
  encoding = 'UTF-8',
): string {
  let outputEncoding = normalizeEncoding(encoding);
  if (outputEncoding === null) {
    throw new RangeError(`Unknown encoding: ${encoding}`);
  }
  if (
    outputEncoding === 'replacement' ||
    outputEncoding === 'utf-16be' ||
    outputEncoding === 'utf-16le'
  ) {
    outputEncoding = 'utf-8';
  }
  const output: string[] = [];

  for (const [tupleName, tupleValue] of tuples) {
    const name = percentEncodeAfterEncoding(
      outputEncoding,
      tupleName,
      'form_urlencoded',
    );
    const value = percentEncodeAfterEncoding(
      outputEncoding,
      tupleValue,
      'form_urlencoded',
    );
    output.push(`${name}=${value}`);
  }

  return output.join('&');
}

const textEncoder = new TextEncoder();
const utf8DecoderWithoutBOM = new TextDecoder('UTF-8', { ignoreBOM: true });

function parseTuple(
  input: ArrayLike<number>,
  start: number,
  end: number,
): FormTuple {
  let equals = start;
  while (equals < end && input[equals] !== 0x3d) equals++;

  const nameEnd = equals;
  const valueStart = equals < end ? equals + 1 : end;
  const name = copyReplacingPlus(input, start, nameEnd);
  const value = copyReplacingPlus(input, valueStart, end);

  return [decodeFormBytes(name), decodeFormBytes(value)];
}

function copyReplacingPlus(
  input: ArrayLike<number>,
  start: number,
  end: number,
): number[] {
  const output = new Array<number>(end - start);
  for (let i = start; i < end; i++) {
    output[i - start] = input[i] === 0x2b ? 0x20 : input[i]!;
  }
  return output;
}

function decodeFormBytes(input: number[]): string {
  return utf8DecoderWithoutBOM.decode(
    Uint8Array.from(percentDecodeBytes(input)),
  );
}
