import { getBufferSourceView, type JSEnvironment } from '../js-engine/index';
import { utf8Encode, utf8EncodeInto } from './codecs/utf-8';
import {
  arg, atArg, ctor, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, dictMember, idlType, impl, op,
  roAttr, reference, xattr,
} from '../web-idl/index';

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
  #env: JSEnvironment;

  constructor(env: JSEnvironment) {
    this.#env = env;
  }

  get encoding(): string {
    return 'utf-8';
  }

  /** Encode directly into the returned typed array in the receiver's realm. */
  encode(input: string): Uint8Array {
    return utf8Encode(input, this.#env);
  }

  encodeInto(
    source: string,
    destination: Uint8Array,
  ): TextEncoderEncodeIntoResult {
    // Borrow intrinsic storage; a detached destination exposes no writable bytes.
    return utf8EncodeInto(source, getBufferSourceView(destination));
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

export const textEncoderIDL = defineInterface<JSEnvironment>({
  name: 'TextEncoder',
  exposed: '*',
  implementation: impl(TextEncoderImpl, {
    constructWith: [atArg(0, (ctx) => ctx.getEnvironment())],
  }),
  members: [
    ctor(),
    op('encode', idlType.Uint8Array,
      [arg('input', idlType.USVString, { default: '', optional: true })],
      xattr('NewObject'),
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
