import { toString, type RuntimeContext } from '../js-engine/index';
import { utf8Encode } from './codecs/utf-8';
import { atArg, ctor, defineIncludes, defineInterface, impl } from '../web-idl/index';
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
  readonly #generic: GenericTransformStreamMixin;
  readonly #runtime: RuntimeContext;
  readonly #transform: TransformStreamImpl;
  #leadingSurrogate = '';

  constructor(runtime: RuntimeContext) {
    this.#runtime = runtime;
    const transform = this.#transform = new TransformStreamImpl(null, {}, {}, runtime);
    transform.setUp(
      (chunk) => {
        this.#encodeAndEnqueue(toString(chunk));
      },
      () => {
        if (this.#leadingSurrogate === '') return;
        transform.enqueue(utf8Encode('\uFFFD', runtime));
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
    if (input !== '') this.#transform.enqueue(utf8Encode(input, this.#runtime));
  }
}

// -- Web IDL ------------------------------------------------------------

export const textEncoderStreamIDL = defineInterface({
  name: 'TextEncoderStream',
  exposed: '*',
  implementation: impl(TextEncoderStreamImpl, {
    constructWith: [atArg(0, (ctx) => ctx.getRuntime())],
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
