import {
  arg, ctor, defineIncludes, defineInterface, emptyDictionary, idlType,
  impl, reference,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import {
  createTransformStream, enqueueTransformStream, GenericTransformStreamMixin,
  type ReadableStreamImpl, type TransformStreamImpl, type WritableStreamImpl,
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

  constructor(
    context: BindingContext,
    label: string,
    options: TextDecoderOptions,
  ) {
    this.#common = new TextDecoderCommonMixin(
      context,
      label,
      options,
    );
    const transform: TransformStreamImpl = createTransformStream(
      context,
      (chunk) => {
        const input = context.convert(
          chunk,
          reference('AllowSharedBufferSource'),
        ) as object;
        const output = this.#common.decode(input, true);
        if (output !== '') enqueueTransformStream(transform, output);
      },
      () => {
        const output = this.#common.decode();
        if (output !== '') enqueueTransformStream(transform, output);
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
}

export const textDecoderStreamIDL = defineInterface({
  name: 'TextDecoderStream',
  exposed: '*',
  implementation: impl(TextDecoderStreamImpl, {
    constructWith: [bindingContext],
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
