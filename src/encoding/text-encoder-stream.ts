import { TextEncoder as ExodusTextEncoder } from '@exodus/bytes/encoding.js';
import {
  ctor, defineIncludes, defineInterface, idlType, impl,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import { createArrayBufferView } from '../web-idl/buffer-source';
import {
  createTransformStream, enqueueTransformStream, GenericTransformStreamMixin,
  type ReadableStreamImpl, type TransformStreamImpl, type WritableStreamImpl,
} from '../streams/index';

/*
 * [Exposed=*]
 * interface TextEncoderStream {
 *   constructor();
 * };
 * TextEncoderStream includes TextEncoderCommon;
 * TextEncoderStream includes GenericTransformStream;
 */
export class TextEncoderStreamImpl {
  readonly #encoder = new ExodusTextEncoder();
  readonly #context: BindingContext;
  readonly #generic: GenericTransformStreamMixin;
  #leadingSurrogate = '';

  // SPEC_MISMATCH: TextEncoderStream() -> TextEncoderStream
  constructor(context: BindingContext) {
    this.#context = context;
    const transform: TransformStreamImpl = createTransformStream(
      context,
      (chunk) => {
        this.#encodeAndEnqueue(
          context.convert(chunk, idlType.DOMString) as string,
          (value) => enqueueTransformStream(transform, value),
        );
      },
      () => {
        if (this.#leadingSurrogate === '') return;
        enqueueTransformStream(transform, this.#encode('\uFFFD'));
        this.#leadingSurrogate = '';
      },
    );
    this.#generic = new GenericTransformStreamMixin(
      transform,
    );
  }

  get encoding(): string {
    return 'utf-8';
  }

  get readable(): ReadableStreamImpl {
    return this.#generic.readable;
  }

  get writable(): WritableStreamImpl {
    return this.#generic.writable;
  }

  // SPEC_MISMATCH: encode and enqueue a chunk(encoder, chunk) -> void
  #encodeAndEnqueue(
    chunk: string,
    enqueue: (value: object) => void,
  ): void {
    let input = this.#leadingSurrogate + chunk;
    this.#leadingSurrogate = '';
    if (input === '') return;

    const last = input.charCodeAt(input.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) {
      this.#leadingSurrogate = input.at(-1) ?? '';
      input = input.slice(0, -1);
    }
    if (input !== '') enqueue(this.#encode(input));
  }

  #encode(input: string): object {
    return createArrayBufferView(
      'Uint8Array',
      this.#encoder.encode(input),
      this.#context.realm,
    );
  }
}

export const textEncoderStreamIDL = defineInterface({
  name: 'TextEncoderStream',
  exposed: '*',
  implementation: impl(TextEncoderStreamImpl, {
    constructWith: [bindingContext],
  }),
  members: [ctor()],
});

export const textEncoderStreamIncludesCommonIDL = defineIncludes({
  interface: 'TextEncoderStream',
  mixin: 'TextEncoderCommon',
});

export const textEncoderStreamIncludesGenericTransformStreamIDL =
  defineIncludes({
    interface: 'TextEncoderStream',
    mixin: 'GenericTransformStream',
  });
