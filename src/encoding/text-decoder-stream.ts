import { isFixedBufferSource } from '../js-engine/index';
import {
  arg, atArg, contextValue, ctor, defineIncludes, defineInterface, emptyDictionary, idlType,
  impl, reference,
} from '../web-idl/declaration/index';
import { TypeError } from '../js-engine/simple-exception';
import type { StreamAbortController } from '../streams/abort';
import { createStreamAbortController } from '../streams/integration';
import {
  GenericTransformStreamMixin, TransformStreamImpl,
  type ReadableStreamImpl, type WritableStreamImpl,
} from '../streams/index';
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

  // SPEC_MISMATCH: TextDecoderStream(label = "utf-8", options = {}) -> TextDecoderStream
  constructor(
    label: string,
    options: TextDecoderOptions,
    abortController: StreamAbortController,
  ) {
    this.#common = new TextDecoderCommonMixin(label, options);
    const transform = new TransformStreamImpl(null, {}, {}, abortController);
    transform.setUp(
      (chunk) => {
        if (!isFixedBufferSource(chunk)) {
          throw new TypeError('Chunk is not a fixed-length buffer source');
        }
        const output = this.#common.decode(chunk, true);
        if (output !== '') transform.enqueue(output);
      },
      () => {
        const output = this.#common.decode();
        if (output !== '') transform.enqueue(output);
      },
    );
    this.#generic = new GenericTransformStreamMixin(
      transform,
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

  // -- Friends ----------------------------------------------------------

  static getAssociatedTransform(
    stream: TextDecoderStreamImpl,
  ): TransformStreamImpl {
    return GenericTransformStreamMixin.getAssociatedTransform(stream.#generic);
  }
}

export const textDecoderStreamIDL = defineInterface({
  name: 'TextDecoderStream',
  exposed: '*',
  implementation: impl(TextDecoderStreamImpl, {
    constructWith: [atArg(2, contextValue(createStreamAbortController))],
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
