import {
  arg, ctor, defineIncludes, defineInterface, emptyDictionary, idlType,
  impl, reference,
} from '../web-idl/declaration/index';
import { GenericTransformStreamMixin } from '../streams/generic-transform-stream';
import { TransformStreamImpl } from '../streams/transform-stream';
import type { ReadableStreamImpl } from '../streams/readable-stream';
import {
  transformStreamDefaultControllerEnqueue,
} from '../streams/transform-stream-operations';
import type { WritableStreamImpl } from '../streams/writable-stream';
import {
  encodingEnvironment, type EncodingEnvironment,
} from './environment';
import {
  TextDecoderCommonMixin, type TextDecoderOptions,
} from './text-decoder';

/*
 * [Exposed=*]
 * interface TextDecoderStream {
 *   constructor(optional DOMString label = "utf-8", optional TextDecoderOptions options = {});
 * };
 * TextDecoderStream includes TextDecoderCommon;
 * TextDecoderStream includes GenericTransformStream;
 */
export class TextDecoderStreamImpl {
  readonly #common: TextDecoderCommonMixin;
  readonly #generic: GenericTransformStreamMixin;

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
    this.#generic = new GenericTransformStreamMixin(
      TransformStreamImpl.fromAlgorithms(environment.streams, {
        transform: (chunk, controller) => {
          const input = environment.convert(
            chunk,
            reference('AllowSharedBufferSource'),
          ) as object;
          const output = this.#common.decode(input, true);
          if (output !== '') {
            transformStreamDefaultControllerEnqueue(controller, output);
          }
        },
        flush: (controller) => {
          const output = this.#common.decode();
          if (output !== '') {
            transformStreamDefaultControllerEnqueue(controller, output);
          }
        },
      }),
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

  get readable(): ReadableStreamImpl {
    return this.#generic.readable;
  }

  get writable(): WritableStreamImpl {
    return this.#generic.writable;
  }
}

export const textDecoderStreamIDL = defineInterface({
  name: 'TextDecoderStream',
  exposed: '*',
  implementation: impl(TextDecoderStreamImpl, {
    withArgs: [encodingEnvironment],
  }),
  members: [ctor([
    arg('label', idlType.DOMString, {
      default: 'utf-8',
      optional: true,
    }),
    arg('options', reference('TextDecoderOptions'), {
      default: emptyDictionary,
      optional: true,
    }),
  ])],
});

export const textDecoderStreamIncludesCommonIDL = defineIncludes({
  interface: 'TextDecoderStream',
  mixin: 'TextDecoderCommon',
});

export const textDecoderStreamIncludesGenericTransformStreamIDL =
  defineIncludes({
    interface: 'TextDecoderStream',
    mixin: 'GenericTransformStream',
  });
