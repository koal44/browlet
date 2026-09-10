import { TextEncoder as ExodusTextEncoder } from '@exodus/bytes/encoding.js';
import { toString, type RuntimeContext } from '../js-engine/index';
import { runtimeContext } from '../web-idl/projection';
import { ctor, defineIncludes, defineInterface, impl } from '../web-idl/declaration/index';
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

  constructor(runtime: RuntimeContext) {
    const transform = new TransformStreamImpl(null, {}, {}, runtime);
    const enqueue = (bytes: Uint8Array): void => {
      transform.enqueue(runtime.buffers.copyUint8Array(bytes));
    };
    transform.setUp(
      (chunk) => {
        this.#encodeAndEnqueue(
          toString(chunk),
          enqueue,
        );
      },
      () => {
        if (this.#leadingSurrogate === '') return;
        enqueue(this.#encoder.encode('\uFFFD'));
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
      runtimeContext,
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
