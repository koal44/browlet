import {
  getBufferSourceByteLength, getBufferSourceByteOffset, getBufferSourceUnderlyingBuffer,
} from '../js-engine/index';
import { utf8Encode, utf8EncodeInto } from './codecs/utf-8';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, dictMember, idlType, impl, newBufferResult, op,
  roAttr, reference, xattr,
} from '../web-idl/declaration/index';

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
 *
 * TextEncoder includes TextEncoderCommon;
 *
 * interface mixin TextEncoderCommon {
 *   readonly attribute DOMString encoding;
 * };
 */
export class TextEncoderImpl {
  get encoding(): string {
    return 'utf-8';
  }

  /** Encode bytes; the member binding allocates the returned typed array. */
  encode(input: string): Uint8Array {
    return utf8Encode(input);
  }

  encodeInto(
    source: string,
    destination: Uint8Array,
  ): Map<keyof TextEncoderEncodeIntoResult, number> {
    // An internal view of the same storage bypasses author-shadowed properties.
    const bytes = new Uint8Array(
      getBufferSourceUnderlyingBuffer(destination), getBufferSourceByteOffset(destination),
      getBufferSourceByteLength(destination),
    );
    const result = utf8EncodeInto(source, bytes);
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

// -- Web IDL ------------------------------------------------------------

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
