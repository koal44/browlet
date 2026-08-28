import { TextEncoder as ExodusTextEncoder } from '@exodus/bytes/encoding.js';
import {
  ctor, defineIncludes, defineInterface, idlType, impl,
} from '../web-idl/declaration/index';
import { GenericTransformStreamMixin } from '../streams/generic-transform-stream';
import type { ReadableStreamImpl } from '../streams/readable-stream';
import { TransformStreamImpl } from '../streams/transform-stream';
import {
  transformStreamDefaultControllerEnqueue,
} from '../streams/transform-stream-operations';
import type { WritableStreamImpl } from '../streams/writable-stream';
import {
  encodingEnvironment, type EncodingEnvironment,
} from './environment';

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
  readonly #environment: EncodingEnvironment;
  readonly #generic: GenericTransformStreamMixin;
  #leadingSurrogate = '';

  constructor(environment: EncodingEnvironment) {
    this.#environment = environment;
    this.#generic = new GenericTransformStreamMixin(
      TransformStreamImpl.fromAlgorithms(environment.streams, {
        transform: (chunk, controller) => {
          this.#encodeAndEnqueue(
            environment.convert(chunk, idlType.DOMString) as string,
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
    return this.#environment.createUint8Array(this.#encoder.encode(input));
  }
}

export const textEncoderStreamIDL = defineInterface({
  name: 'TextEncoderStream',
  exposed: '*',
  implementation: impl(TextEncoderStreamImpl, {
    withArgs: [encodingEnvironment],
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
