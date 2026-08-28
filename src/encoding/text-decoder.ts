import { TextDecoder as ExodusTextDecoder } from '@exodus/bytes/encoding.js';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, dictMember, emptyDictionary, idlType, impl, op,
  roAttr, reference,
} from '../web-idl/declaration/index';
import {
  encodingEnvironment, type EncodingEnvironment,
} from './environment';

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

  constructor(
    environment: EncodingEnvironment,
    label = 'utf-8',
    options: TextDecoderOptions = {},
  ) {
    this.#common = new TextDecoderCommonMixin(
      environment,
      label,
      options,
    );
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
    input?: object,
    options: TextDecodeOptions = {},
  ): string {
    return this.#common.decode(input, options.stream ?? false);
  }
}

/*
 * interface mixin TextDecoderCommon {
 *   readonly attribute DOMString encoding;
 *   readonly attribute boolean fatal;
 *   readonly attribute boolean ignoreBOM;
 * };
 */
/** Shared TextDecoder and TextDecoderStream semantic state. */
export class TextDecoderCommonMixin {
  readonly #decoder: InstanceType<typeof ExodusTextDecoder>;
  readonly #environment: EncodingEnvironment;

  constructor(
    environment: EncodingEnvironment,
    label: string,
    options: TextDecoderOptions,
  ) {
    this.#environment = environment;
    try {
      this.#decoder = new ExodusTextDecoder(label, options);
    } catch (error) {
      environment.realizeError(error);
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
    try {
      return this.#decoder.decode(
        input === undefined ? undefined : this.#environment.copyBytes(input),
        { stream },
      );
    } catch (error) {
      this.#environment.realizeError(error);
    }
  }
}

export type TextDecoderOptions = {
  fatal?: boolean;
  ignoreBOM?: boolean;
};

export type TextDecodeOptions = {
  stream?: boolean;
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
  implementation: impl(TextDecoderImpl, {
    withArgs: [encodingEnvironment],
  }),
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
