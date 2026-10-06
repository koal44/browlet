import { detectBOM, type BOMEncoding, type Encoding } from './core/index';
import { RangeError } from '../infra/exceptions';
import { internalType, type InternalPromise } from '../infra/promises';
import type { JSEnvironment } from '../js-engine/index';
import { endOfQueue, IOQueue, processQueue, type Decoder, type Encoder } from './io-queue';
import { GB18030Decoder, GB18030Encoder } from './codecs/gb18030';
import { Big5Decoder, Big5Encoder } from './codecs/big5';
import { EUCJPDecoder, EUCJPEncoder } from './codecs/euc-jp';
import { ISO2022JPDecoder, ISO2022JPEncoder } from './codecs/iso-2022-jp';
import { ShiftJISDecoder, ShiftJISEncoder } from './codecs/shift-jis';
import { EUCKRDecoder, EUCKREncoder } from './codecs/euc-kr';
import { ReplacementDecoder, XUserDefinedCodec } from './codecs/miscellaneous';
import { getSingleByteCodec } from './codecs/single-byte';
import { UTF8Decoder, UTF8Encoder, utf8Decode, utf8Encode } from './codecs/utf-8';
import { UTF16Decoder } from './codecs/utf-16';

export { getEncoding, getOutputEncoding, type Encoding, type OutputEncoding } from './core/index';

/** Create a decoder for any canonical encoding. Stateful decoders are never shared. */
export function getDecoder(encoding: Encoding): Decoder {
  switch (encoding) {
    case 'UTF-8': return new UTF8Decoder();
    case 'GBK':
    case 'gb18030': return new GB18030Decoder();
    case 'Big5': return new Big5Decoder();
    case 'EUC-JP': return new EUCJPDecoder();
    case 'ISO-2022-JP': return new ISO2022JPDecoder();
    case 'Shift_JIS': return new ShiftJISDecoder();
    case 'EUC-KR': return new EUCKRDecoder();
    case 'replacement': return new ReplacementDecoder();
    case 'UTF-16BE': return new UTF16Decoder(true);
    case 'UTF-16LE': return new UTF16Decoder();
    case 'x-user-defined': return new XUserDefinedCodec();
    default: return getSingleByteCodec(encoding)!;
  }
}

/** §6.1 — Get an encoder. Call getOutputEncoding first for decoder-only encodings. */
export function getEncoder(encoding: Encoding): Encoder {
  switch (encoding) {
    case 'UTF-8': return new UTF8Encoder();
    case 'GBK': return new GB18030Encoder(true);
    case 'gb18030': return new GB18030Encoder();
    case 'Big5': return new Big5Encoder();
    case 'EUC-JP': return new EUCJPEncoder();
    case 'ISO-2022-JP': return new ISO2022JPEncoder();
    case 'Shift_JIS': return new ShiftJISEncoder();
    case 'EUC-KR': return new EUCKREncoder();
    case 'x-user-defined': return new XUserDefinedCodec();
    case 'replacement':
    case 'UTF-16BE':
    case 'UTF-16LE': throw new RangeError(`${encoding} has no encoder`);
    default: return getSingleByteCodec(encoding)!;
  }
}

/** Complete-input convenience for Encoding §6.1 — Decode, including BOM override. */
export function decode(
  bytes: Uint8Array,
  fallbackEncoding: Encoding,
): string {
  const bom = detectBOM(bytes);
  const encoding = bom ?? fallbackEncoding;
  if (encoding === 'UTF-8') return utf8Decode(bytes);
  const output = new IOQueue<string>();
  getDecoder(encoding).decode(IOQueue.from(bom ? bytes.subarray(2) : bytes), output, 'replacement');
  return output.takeString();
}

/** §6.1 — Decode into supplied output as input arrives; one leading BOM overrides the fallback. */
export function decodeQueue(
  input: IOQueue<Uint8Array>, encoding: Encoding,
  output: IOQueue<string> = new IOQueue<string>(), env: JSEnvironment,
): InternalPromise<IOQueue<string>> {
  return input.waitFor(3, env).then(() => {
    const bom = bomSniff(input);
    if (bom) input.readAvailable(bom === 'UTF-8' ? 3 : 2);
    const decoder = getDecoder(bom ?? encoding);
    return processQueue(input, () => decoder.decode(input, output, 'replacement'), env).then(() => output, undefined, internalType<IOQueue<string>>());
  }, undefined, internalType<IOQueue<string>>());
}

/** §6.1 — BOM sniff; undefined requests more input, without consuming it. */
export function bomSniff(input: IOQueue<Uint8Array>): BOMEncoding | null | undefined {
  const bytes = input.peek(3);
  return bytes === undefined ? undefined : detectBOM(bytes);
}

/** Complete-input convenience for Encoding §6.1 — Encode, with HTML error handling. */
export function encode(input: string, encoding: Encoding): Uint8Array {
  if (encoding === 'UTF-8') return utf8Encode(input);
  const output = new IOQueue<Uint8Array>();
  getEncoder(encoding).encode(IOQueue.from(input), output, 'html');
  return output.takeBytes();
}

/** §6.1 — Encode with HTML error handling, appending to the caller's output. */
export function encodeQueue(
  input: IOQueue<string>, encoding: Encoding, output: IOQueue<Uint8Array> = new IOQueue<Uint8Array>(), env: JSEnvironment,
): InternalPromise<IOQueue<Uint8Array>> {
  const encoder = getEncoder(encoding);
  return processQueue(input, () => encoder.encode(input, output, 'html'), env).then(() => output, undefined, internalType<IOQueue<Uint8Array>>());
}

/** §6.1 — Encode or fail for complete input, as used by synchronous URL parsing. */
export function encodeOrFailSync(input: IOQueue<string>, encoder: Encoder, output: IOQueue<Uint8Array>): number | null {
  const result = encoder.encode(input, output, 'fatal');
  output.push(endOfQueue);
  return typeof result === 'object' ? result.error : null;
}

/** §6.1 — Encode or fail; end this output even when encoding stops at an error. */
export function encodeOrFail(
  input: IOQueue<string>, encoder: Encoder, output: IOQueue<Uint8Array>, env: JSEnvironment,
): InternalPromise<number | null> {
  return processQueue(input, () => encoder.encode(input, output, 'fatal'), env).then((result) => {
    output.push(endOfQueue);
    return typeof result === 'object' ? result.error : null;
  }, undefined, internalType<number | null>());
}
