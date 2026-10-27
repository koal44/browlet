import { toString } from '../js-engine/index';
import { atArg, ctor, defineIncludes, defineInterface, impl } from '../web-idl/core/index';
import {
  GenericTransformStreamMixin, TransformStreamImpl,
  type ReadableStreamImpl, type StreamsEnvironment, type WritableStreamImpl,
} from '../streams/index';

import { utf8ByteLength, writeUTF8 } from './codecs/utf-8';

/*
 * [Exposed=*]
 * interface TextEncoderStream {
 *   constructor();
 * };
 * TextEncoderStream includes TextEncoderCommon;
 * TextEncoderStream includes GenericTransformStream;
 */
export class TextEncoderStreamImpl {
  #generic: GenericTransformStreamMixin;
  #env: StreamsEnvironment;
  #transform: TransformStreamImpl;
  #leadingSurrogate = '';

  constructor(env: StreamsEnvironment) {
    this.#env = env;
    const transform = this.#transform = new TransformStreamImpl(null, {}, {}, env);
    transform.setUp(
      (chunk) => {
        this.#encodeAndEnqueue(toString(chunk));
      },
      () => {
        if (this.#leadingSurrogate === '') return;
        this.#enqueueEncoded('\uFFFD');
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

  /** §7.6 — Encode and enqueue a converted DOMString chunk. */
  #encodeAndEnqueue(chunk: string): void {
    let input = this.#leadingSurrogate + chunk;
    this.#leadingSurrogate = '';
    if (input === '') return;

    const last = input.charCodeAt(input.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) {
      this.#leadingSurrogate = input.at(-1) ?? '';
      input = input.slice(0, -1);
    }
    if (input !== '') this.#enqueueEncoded(input);
  }

  /** Create each chunk in the encoder's realm before downstream callbacks can observe it. */
  #enqueueEncoded(input: string): void {
    const length = utf8ByteLength(input);
    const buffer = this.#env.exec.buffers.allocateArrayBuffer(length);
    writeUTF8(input, buffer, 0, length);
    this.#transform.enqueue(this.#env.exec.buffers.createView('Uint8Array', buffer));
  }
}

// -- Web IDL ------------------------------------------------------------

export const textEncoderStreamIDL = defineInterface<StreamsEnvironment>({
  name: 'TextEncoderStream',
  exposed: '*',
  implementation: impl(TextEncoderStreamImpl, {
    constructWith: [atArg(0, (env) => env)],
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
