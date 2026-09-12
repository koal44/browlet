import { getBufferSourceView, getBufferTypeName } from '../js-engine/index';
import {
  arg, ctor, defineDictionary, defineIncludes, defineInterface,
  defineInterfaceMixin, dictMember, emptyDictionary, idlType, impl, op,
  roAttr, reference,
} from '../web-idl/declaration/index';
import { RangeError, TypeError } from '../js-engine/simple-exception';
import { type Encoding, getDecoder, getEncoding } from './encodings';
import { endOfQueue, IOQueue, type Decoder } from './io-queue';

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
export class TextDecoderCommonMixin {
  readonly #encoding: Encoding;
  readonly #fatal: boolean;
  readonly #ignoreBOM: boolean;
  // The first decode initializes these through the same branch as a later reset.
  #decoder!: Decoder;
  #input!: IOQueue<Uint8Array>;
  #doNotFlush = false;
  #BOMSeen = false;

  constructor(label: string, options: TextDecoderOptions) {
    const encoding = getEncoding(label);
    if (encoding === null || encoding === 'replacement') {
      throw new RangeError(`Unsupported encoding label: ${label}`);
    }
    this.#encoding = encoding;
    this.#fatal = options.fatal;
    this.#ignoreBOM = options.ignoreBOM;
  }

  get encoding(): string {
    return this.#encoding.toLowerCase();
  }

  get fatal(): boolean {
    return this.#fatal;
  }

  get ignoreBOM(): boolean {
    return this.#ignoreBOM;
  }

  decode(input?: object, stream = false): string {
    let bytes = input === undefined ? undefined : getBufferSourceView(input);
    // Replacement mode consumes the input synchronously, retaining only numeric
    // decoder state. Shared memory and unread input after fatal errors need a copy.
    if (bytes && (this.#fatal || getBufferTypeName(bytes.buffer) === 'SharedArrayBuffer')) {
      bytes = new Uint8Array(bytes);
    }
    // §7.2: do not reset a streaming decoder after an error. The restored
    // byte and the copied, unread suffix still belong to this input queue.
    if (!this.#doNotFlush) {
      this.#decoder = getDecoder(this.#encoding);
      this.#input = new IOQueue<Uint8Array>();
      this.#BOMSeen = false;
    }
    this.#doNotFlush = stream;
    if (bytes) this.#input.push(bytes);
    if (!stream) this.#input.push(endOfQueue);
    const output = new IOQueue<string>();
    const result = this.#decoder.decode(this.#input, output, this.#fatal ? 'fatal' : 'replacement');
    if (typeof result === 'object') throw new TypeError(`Invalid ${this.#encoding} data`);
    return this.#serialize(output);
  }

  /** §7.1 — Serialize an I/O queue, omitting at most one initial Unicode BOM. */
  #serialize(output: IOQueue<string>): string {
    const text = output.takeString();
    if ((this.#encoding === 'UTF-8' || this.#encoding === 'UTF-16LE' || this.#encoding === 'UTF-16BE') &&
      !this.#ignoreBOM && !this.#BOMSeen && text !== '') {
      this.#BOMSeen = true;
      if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
    }
    return text;
  }
}

export type TextDecoderOptions = {
  fatal: boolean;
  ignoreBOM: boolean;
};

export type TextDecodeOptions = {
  stream: boolean;
};

// -- Web IDL ------------------------------------------------------------

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
