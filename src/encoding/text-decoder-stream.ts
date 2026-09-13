import { isFixedBufferSource, type RuntimeContext } from '../js-engine/index';
import {
  arg, atArg, ctor, defineIncludes, defineInterface, emptyDictionary, idlType, impl,
  reference,
} from '../web-idl/index';
import { TypeError } from '../js-engine/simple-exception';
import {
  GenericTransformStreamMixin, TransformStreamImpl, type ReadableStreamImpl,
  type WritableStreamImpl,
} from '../streams/index';
import { TextDecoderCommonMixin, type TextDecoderOptions } from './text-decoder';

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
    label: string,
    options: TextDecoderOptions,
    runtime: RuntimeContext,
  ) {
    this.#common = new TextDecoderCommonMixin(label, options);
    const transform = new TransformStreamImpl(null, {}, {}, runtime);
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

  getAssociatedTransform(): TransformStreamImpl {
    return this.#generic.getAssociatedTransform();
  }
}

// -- Web IDL ------------------------------------------------------------

export const textDecoderStreamIDL = defineInterface({
  name: 'TextDecoderStream',
  exposed: '*',
  implementation: impl(TextDecoderStreamImpl, {
    constructWith: [
      atArg(2, (ctx) => ctx.getRuntime()),
    ],
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
