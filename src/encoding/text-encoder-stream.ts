import { TextEncoder as ExodusTextEncoder } from '@exodus/bytes/encoding.js';
import { toString, createPromiseReactions, type PromiseReactions } from '../js-engine/index';
import type { BindingContext } from '../web-idl/projection';
import {
  contextValue, ctor, defineIncludes, defineInterface, impl,
} from '../web-idl/declaration/index';
import type { StreamAbortController } from '../streams/abort';
import { createStreamAbortController } from '../streams/integration';
import {
  GenericTransformStreamMixin, TransformStreamImpl,
  type ReadableStreamImpl, type WritableStreamImpl,
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
  readonly #generic: GenericTransformStreamMixin;
  #leadingSurrogate = '';

  // SPEC_MISMATCH: TextEncoderStream() -> TextEncoderStream
  constructor(abortController: StreamAbortController, reactions: PromiseReactions) {
    const transform = new TransformStreamImpl(null, {}, {}, abortController, reactions);
    transform.setUp(
      (chunk) => {
        this.#encodeAndEnqueue(
          toString(chunk),
          (value) => transform.enqueue(value),
        );
      },
      () => {
        if (this.#leadingSurrogate === '') return;
        transform.enqueue(this.#encoder.encode('\uFFFD'));
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
    enqueue: (value: Uint8Array) => void,
  ): void {
    let input = this.#leadingSurrogate + chunk;
    this.#leadingSurrogate = '';
    if (input === '') return;

    const last = input.charCodeAt(input.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) {
      this.#leadingSurrogate = input.at(-1) ?? '';
      input = input.slice(0, -1);
    }
    if (input !== '') enqueue(this.#encoder.encode(input));
  }
}

export const textEncoderStreamIDL = defineInterface({
  name: 'TextEncoderStream',
  exposed: '*',
  implementation: impl(TextEncoderStreamImpl, {
    constructWith: [
      contextValue(createStreamAbortController),
      contextValue((context: BindingContext) => createPromiseReactions(context.realm)),
    ],
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
