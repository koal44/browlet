// Maintained locally against https://encoding.spec.whatwg.org/#names-and-labels.
// WHATWG source/data attribution and BSD-3-Clause terms: src/encoding/scripts/WHATWG-LICENSE.txt.

/*!
Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).

BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

import { asciiLower } from '../infra/ascii';
import { RangeError } from '../js-engine/simple-exception';
import type { PromiseValue } from '../js-engine/promises';
import type { RuntimeContext } from '../js-engine/runtime-context';
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

/** A canonical encoding name; labels are resolved by getEncoding. */
export type Encoding =
  | 'UTF-8'
  | 'IBM866'
  | 'ISO-8859-2' | 'ISO-8859-3' | 'ISO-8859-4' | 'ISO-8859-5'
  | 'ISO-8859-6' | 'ISO-8859-7' | 'ISO-8859-8' | 'ISO-8859-8-I'
  | 'ISO-8859-10' | 'ISO-8859-13' | 'ISO-8859-14' | 'ISO-8859-15' | 'ISO-8859-16'
  | 'KOI8-R' | 'KOI8-U' | 'macintosh'
  | 'windows-874' | 'windows-1250' | 'windows-1251' | 'windows-1252'
  | 'windows-1253' | 'windows-1254' | 'windows-1255' | 'windows-1256'
  | 'windows-1257' | 'windows-1258' | 'x-mac-cyrillic'
  | 'GBK' | 'gb18030' | 'Big5'
  | 'EUC-JP' | 'ISO-2022-JP' | 'Shift_JIS' | 'EUC-KR'
  | 'replacement' | 'UTF-16BE' | 'UTF-16LE' | 'x-user-defined';

/** §4.3 — An encoding with an encoder, after output-encoding selection. */
export type OutputEncoding = Exclude<Encoding, 'replacement' | 'UTF-16BE' | 'UTF-16LE'>;

/** Encoding Standard §4.2 — Get an encoding. */
export function getEncoding(label: string): Encoding | null {
  const normalized = asciiLower(label.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''));
  switch (normalized) {
    case 'unicode-1-1-utf-8': case 'unicode11utf8': case 'unicode20utf8':
    case 'utf-8': case 'utf8': case 'x-unicode20utf8':
      return 'UTF-8';
    case '866': case 'cp866': case 'csibm866': case 'ibm866':
      return 'IBM866';
    case 'csisolatin2': case 'iso-8859-2': case 'iso-ir-101': case 'iso8859-2':
    case 'iso88592': case 'iso_8859-2': case 'iso_8859-2:1987': case 'l2': case 'latin2':
      return 'ISO-8859-2';
    case 'csisolatin3': case 'iso-8859-3': case 'iso-ir-109': case 'iso8859-3':
    case 'iso88593': case 'iso_8859-3': case 'iso_8859-3:1988': case 'l3': case 'latin3':
      return 'ISO-8859-3';
    case 'csisolatin4': case 'iso-8859-4': case 'iso-ir-110': case 'iso8859-4':
    case 'iso88594': case 'iso_8859-4': case 'iso_8859-4:1988': case 'l4': case 'latin4':
      return 'ISO-8859-4';
    case 'csisolatincyrillic': case 'cyrillic': case 'iso-8859-5': case 'iso-ir-144':
    case 'iso8859-5': case 'iso88595': case 'iso_8859-5': case 'iso_8859-5:1988':
      return 'ISO-8859-5';
    case 'arabic': case 'asmo-708': case 'csiso88596e': case 'csiso88596i':
    case 'csisolatinarabic': case 'ecma-114': case 'iso-8859-6': case 'iso-8859-6-e':
    case 'iso-8859-6-i': case 'iso-ir-127': case 'iso8859-6': case 'iso88596':
    case 'iso_8859-6': case 'iso_8859-6:1987':
      return 'ISO-8859-6';
    case 'csisolatingreek': case 'ecma-118': case 'elot_928': case 'greek': case 'greek8':
    case 'iso-8859-7': case 'iso-ir-126': case 'iso8859-7': case 'iso88597':
    case 'iso_8859-7': case 'iso_8859-7:1987': case 'sun_eu_greek':
      return 'ISO-8859-7';
    case 'csiso88598e': case 'csisolatinhebrew': case 'hebrew': case 'iso-8859-8':
    case 'iso-8859-8-e': case 'iso-ir-138': case 'iso8859-8': case 'iso88598':
    case 'iso_8859-8': case 'iso_8859-8:1988': case 'visual':
      return 'ISO-8859-8';
    case 'csiso88598i': case 'iso-8859-8-i': case 'logical':
      return 'ISO-8859-8-I';
    case 'csisolatin6': case 'iso-8859-10': case 'iso-ir-157': case 'iso8859-10':
    case 'iso885910': case 'l6': case 'latin6':
      return 'ISO-8859-10';
    case 'iso-8859-13': case 'iso8859-13': case 'iso885913':
      return 'ISO-8859-13';
    case 'iso-8859-14': case 'iso8859-14': case 'iso885914':
      return 'ISO-8859-14';
    case 'csisolatin9': case 'iso-8859-15': case 'iso8859-15': case 'iso885915':
    case 'iso_8859-15': case 'l9':
      return 'ISO-8859-15';
    case 'iso-8859-16':
      return 'ISO-8859-16';
    case 'cskoi8r': case 'koi': case 'koi8': case 'koi8-r': case 'koi8_r':
      return 'KOI8-R';
    case 'koi8-ru': case 'koi8-u':
      return 'KOI8-U';
    case 'csmacintosh': case 'mac': case 'macintosh': case 'x-mac-roman':
      return 'macintosh';
    case 'dos-874': case 'iso-8859-11': case 'iso8859-11': case 'iso885911':
    case 'tis-620': case 'windows-874':
      return 'windows-874';
    case 'cp1250': case 'windows-1250': case 'x-cp1250':
      return 'windows-1250';
    case 'cp1251': case 'windows-1251': case 'x-cp1251':
      return 'windows-1251';
    case 'ansi_x3.4-1968': case 'ascii': case 'cp1252': case 'cp819': case 'csisolatin1':
    case 'ibm819': case 'iso-8859-1': case 'iso-ir-100': case 'iso8859-1': case 'iso88591':
    case 'iso_8859-1': case 'iso_8859-1:1987': case 'l1': case 'latin1':
    case 'us-ascii': case 'windows-1252': case 'x-cp1252':
      return 'windows-1252';
    case 'cp1253': case 'windows-1253': case 'x-cp1253':
      return 'windows-1253';
    case 'cp1254': case 'csisolatin5': case 'iso-8859-9': case 'iso-ir-148':
    case 'iso8859-9': case 'iso88599': case 'iso_8859-9': case 'iso_8859-9:1989':
    case 'l5': case 'latin5': case 'windows-1254': case 'x-cp1254':
      return 'windows-1254';
    case 'cp1255': case 'windows-1255': case 'x-cp1255':
      return 'windows-1255';
    case 'cp1256': case 'windows-1256': case 'x-cp1256':
      return 'windows-1256';
    case 'cp1257': case 'windows-1257': case 'x-cp1257':
      return 'windows-1257';
    case 'cp1258': case 'windows-1258': case 'x-cp1258':
      return 'windows-1258';
    case 'x-mac-cyrillic': case 'x-mac-ukrainian':
      return 'x-mac-cyrillic';
    case 'chinese': case 'csgb2312': case 'csiso58gb231280': case 'gb2312':
    case 'gb_2312': case 'gb_2312-80': case 'gbk': case 'iso-ir-58': case 'x-gbk':
      return 'GBK';
    case 'gb18030':
      return 'gb18030';
    case 'big5': case 'big5-hkscs': case 'cn-big5': case 'csbig5': case 'x-x-big5':
      return 'Big5';
    case 'cseucpkdfmtjapanese': case 'euc-jp': case 'x-euc-jp':
      return 'EUC-JP';
    case 'csiso2022jp': case 'iso-2022-jp':
      return 'ISO-2022-JP';
    case 'csshiftjis': case 'ms932': case 'ms_kanji': case 'shift-jis': case 'shift_jis':
    case 'sjis': case 'windows-31j': case 'x-sjis':
      return 'Shift_JIS';
    case 'cseuckr': case 'csksc56011987': case 'euc-kr': case 'iso-ir-149': case 'korean':
    case 'ks_c_5601-1987': case 'ks_c_5601-1989': case 'ksc5601': case 'ksc_5601': case 'windows-949':
      return 'EUC-KR';
    case 'csiso2022kr': case 'hz-gb-2312': case 'iso-2022-cn': case 'iso-2022-cn-ext':
    case 'iso-2022-kr': case 'replacement':
      return 'replacement';
    case 'unicodefffe': case 'utf-16be':
      return 'UTF-16BE';
    case 'csunicode': case 'iso-10646-ucs-2': case 'ucs-2': case 'unicode':
    case 'unicodefeff': case 'utf-16': case 'utf-16le':
      return 'UTF-16LE';
    case 'x-user-defined':
      return 'x-user-defined';
    default: return null;
  }
}

/** Encoding Standard §4.3 — Get an output encoding. */
export function getOutputEncoding(encoding: Encoding): OutputEncoding {
  return encoding === 'replacement' || encoding === 'UTF-16BE' || encoding === 'UTF-16LE'
    ? 'UTF-8' : encoding;
}

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
  output: IOQueue<string> = new IOQueue<string>(), runtime: RuntimeContext,
): PromiseValue<IOQueue<string>> {
  return input.waitFor(3, runtime).then(() => {
    const bom = bomSniff(input);
    if (bom) input.readAvailable(bom === 'UTF-8' ? 3 : 2);
    const decoder = getDecoder(bom ?? encoding);
    return processQueue(input, () => decoder.decode(input, output, 'replacement'), runtime).then(() => output);
  });
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
  input: IOQueue<string>, encoding: Encoding, output: IOQueue<Uint8Array> = new IOQueue<Uint8Array>(), runtime: RuntimeContext,
): PromiseValue<IOQueue<Uint8Array>> {
  const encoder = getEncoder(encoding);
  return processQueue(input, () => encoder.encode(input, output, 'html'), runtime).then(() => output);
}

/** §6.1 — Encode or fail for complete input, as used by synchronous URL parsing. */
export function encodeOrFailSync(input: IOQueue<string>, encoder: Encoder, output: IOQueue<Uint8Array>): number | null {
  const result = encoder.encode(input, output, 'fatal');
  output.push(endOfQueue);
  return typeof result === 'object' ? result.error : null;
}

/** §6.1 — Encode or fail; end this output even when encoding stops at an error. */
export function encodeOrFail(
  input: IOQueue<string>, encoder: Encoder, output: IOQueue<Uint8Array>, runtime: RuntimeContext,
): PromiseValue<number | null> {
  return processQueue(input, () => encoder.encode(input, output, 'fatal'), runtime).then((result) => {
    output.push(endOfQueue);
    return typeof result === 'object' ? result.error : null;
  });
}

type BOMEncoding = 'UTF-8' | 'UTF-16BE' | 'UTF-16LE';

/** The §6.1 BOM table, shared by immediate bytes and queue lookahead. */
function detectBOM(bytes: Uint8Array | readonly number[]): BOMEncoding | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'UTF-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'UTF-16BE';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'UTF-16LE';
  return null;
}
