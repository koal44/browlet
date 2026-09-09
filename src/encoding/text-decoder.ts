import { TextDecoder as ExodusTextDecoder } from '@exodus/bytes/encoding.js';
import { getBufferSourceCopy } from '../web-idl/buffer-source';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, dictMember, emptyDictionary, idlType, impl, op,
  roAttr, reference,
} from '../web-idl/declaration/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';

/*
 * dictionary TextDecoderOptions {
 *   boolean fatal = false;
 *   boolean ignoreBOM = false;
 * };
 *
 * dictionary TextDecodeOptions {
 *   boolean stream = false;
 * };
 *
 * [Exposed=*]
 * interface TextDecoder {
 *   constructor(optional DOMString label = "utf-8", optional TextDecoderOptions options = {});
 *
 *   USVString decode(optional AllowSharedBufferSource input, optional TextDecodeOptions options = {});
 * };
 * TextDecoder includes TextDecoderCommon;
 */
export class TextDecoderImpl {
  readonly #common: TextDecoderCommonMixin;

  constructor(label: string, options: TextDecoderOptions) {
    this.#common = new TextDecoderCommonMixin(label, options);
  }

  get encoding(): string {
    return this.#common.encoding;
  }

  get fatal(): boolean {
    return this.#common.fatal;
  }

  get ignoreBOM(): boolean {
    return this.#common.ignoreBOM;
  }

  decode(
    input: object | undefined,
    options: TextDecodeOptions,
  ): string {
    return this.#common.decode(input, options.stream);
  }
}

/*
 * interface mixin TextDecoderCommon {
 *   readonly attribute DOMString encoding;
 *   readonly attribute boolean fatal;
 *   readonly attribute boolean ignoreBOM;
 * };
 */
/** Shared TextDecoder and TextDecoderStream state. */
export class TextDecoderCommonMixin {
  readonly #decoder: InstanceType<typeof ExodusTextDecoder>;

  constructor(label: string, options: TextDecoderOptions) {
    try {
      this.#decoder = new ExodusTextDecoder(label, options);
    } catch (error) {
      rethrowEncodingError(error);
    }
  }

  get encoding(): string {
    return this.#decoder.encoding;
  }

  get fatal(): boolean {
    return this.#decoder.fatal;
  }

  get ignoreBOM(): boolean {
    return this.#decoder.ignoreBOM;
  }

  decode(input?: object, stream = false): string {
    const bytes = input === undefined ? undefined : getBufferSourceCopy(input);
    try {
      return this.#decoder.decode(bytes, { stream });
    } catch (error) {
      rethrowEncodingError(error);
    }
  }
}

export type TextDecoderOptions = {
  fatal: boolean;
  ignoreBOM: boolean;
};

export type TextDecodeOptions = {
  stream: boolean;
};

export const textDecoderCommonIDL = defineInterfaceMixin({
  name: 'TextDecoderCommon',
  members: [
    roAttr('encoding', idlType.DOMString),
    roAttr('fatal', idlType.boolean),
    roAttr('ignoreBOM', idlType.boolean),
  ],
});

export const textDecoderIDL = defineInterface({
  name: 'TextDecoder',
  exposed: '*',
  implementation: impl(TextDecoderImpl),
  members: [
    ctor([
      arg('label', idlType.DOMString, {
        default: 'utf-8',
        optional: true,
      }),
      arg('options', reference('TextDecoderOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    op('decode', idlType.USVString, [
      arg('input', reference('AllowSharedBufferSource'), { optional: true }),
      arg('options', reference('TextDecodeOptions'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
  ],
});

export const textDecoderIncludesCommonIDL = defineIncludes({
  interface: 'TextDecoder',
  mixin: 'TextDecoderCommon',
});

export const textDecoderOptionsIDL = defineDictionary({
  name: 'TextDecoderOptions',
  members: [
    dictMember('fatal', idlType.boolean, { default: false }),
    dictMember('ignoreBOM', idlType.boolean, { default: false }),
  ],
});

export const textDecodeOptionsIDL = defineDictionary({
  name: 'TextDecodeOptions',
  members: [
    dictMember('stream', idlType.boolean, { default: false }),
  ],
});

function rethrowEncodingError(error: unknown): never {
  if (error instanceof globalThis.RangeError) {
    throw new RangeError(error.message);
  }
  if (error instanceof globalThis.TypeError) {
    throw new TypeError(error.message);
  }
  throw error;
}
