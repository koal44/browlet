import { TextEncoder as ExodusTextEncoder } from '@exodus/bytes/encoding.js';
import {
  getBufferSourceByteLength, writeArrayBufferView,
} from '../js-engine/index';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, dictMember, idlType, impl, newBufferResult, op,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';

/*
 * interface mixin TextEncoderCommon {
 *   readonly attribute DOMString encoding;
 * };
 */
/*
 * dictionary TextEncoderEncodeIntoResult {
 *   unsigned long long read;
 *   unsigned long long written;
 * };
 *
 * [Exposed=*]
 * interface TextEncoder {
 *   constructor();
 *
 *   [NewObject] Uint8Array encode(optional USVString input = "");
 *   TextEncoderEncodeIntoResult encodeInto(USVString source, [AllowShared] Uint8Array destination);
 * };
 * TextEncoder includes TextEncoderCommon;
 */
export class TextEncoderImpl {
  readonly #encoder = new ExodusTextEncoder();

  get encoding(): string {
    return 'utf-8';
  }

  /** Encode bytes; the member binding allocates the returned typed array. */
  encode(input: string): Uint8Array {
    return this.#encoder.encode(input);
  }

  encodeInto(
    source: string,
    destination: object,
  ): Map<keyof TextEncoderEncodeIntoResult, number> {
    const bytes = new Uint8Array(getBufferSourceByteLength(destination));
    const result = this.#encoder.encodeInto(source, bytes);
    writeArrayBufferView(
      destination,
      bytes.subarray(0, result.written),
    );
    return new Map([
      ['read', result.read],
      ['written', result.written],
    ]);
  }
}

export type TextEncoderEncodeIntoResult = {
  read: number;
  written: number;
};

export const textEncoderCommonIDL = defineInterfaceMixin({
  name: 'TextEncoderCommon',
  members: [roAttr('encoding', idlType.DOMString)],
});

export const textEncoderIDL = defineInterface({
  name: 'TextEncoder',
  exposed: '*',
  implementation: impl(TextEncoderImpl),
  members: [
    ctor(),
    op('encode', idlType.Uint8Array,
      [arg('input', idlType.USVString, { default: '', optional: true })],
      { ...xattr('NewObject'), ...newBufferResult() },
    ),
    op('encodeInto', reference('TextEncoderEncodeIntoResult'), [
      arg('source', idlType.USVString),
      arg('destination', idlType.Uint8Array, xattr('AllowShared')),
    ]),
  ],
});

export const textEncoderIncludesCommonIDL = defineIncludes({
  interface: 'TextEncoder',
  mixin: 'TextEncoderCommon',
});

export const textEncoderEncodeIntoResultIDL = defineDictionary({
  name: 'TextEncoderEncodeIntoResult',
  members: [
    dictMember('read', idlType.unsignedLongLong),
    dictMember('written', idlType.unsignedLongLong),
  ],
});
