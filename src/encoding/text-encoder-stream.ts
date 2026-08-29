import { TextEncoder as ExodusTextEncoder } from '@exodus/bytes/encoding.js';
import {
  ctor, defineIncludes, defineInterface, idlType, impl,
} from '../web-idl/declaration/index';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import { createArrayBufferView } from '../web-idl/buffer-source';
import { GenericTransformStreamMixin } from '../streams/generic-transform-stream';
import type { ReadableStreamImpl } from '../streams/readable-stream';
import { TransformStreamImpl } from '../streams/transform-stream';
import {
  transformStreamDefaultControllerEnqueue,
} from '../streams/transform-stream-operations';
import type { WritableStreamImpl } from '../streams/writable-stream';

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

  constructor(context: BindingContext) {
    this.#context = context;
    this.#generic = new GenericTransformStreamMixin(
      TransformStreamImpl.fromAlgorithms(context, {
        transform: (chunk, controller) => {
          this.#encodeAndEnqueue(
            context.convert(chunk, idlType.DOMString) as string,
            (value) => transformStreamDefaultControllerEnqueue(
              controller,
              value,
            ),
          );
        },
        flush: (controller) => {
          if (this.#leadingSurrogate === '') return;
          transformStreamDefaultControllerEnqueue(
            controller,
            this.#encode('\uFFFD'),
          );
          this.#leadingSurrogate = '';
        },
      }),
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
