import {
  defineInterfaceMixin, roAttr, reference,
} from '../web-idl/declaration/index';
import type { ReadableStreamImpl } from './readable-stream';
import type { TransformStreamImpl } from './transform-stream';
import type { WritableStreamImpl } from './writable-stream';

/**
 * Streams Standard, "Wrapping into a custom class".
 *
 * Other specifications compose this mixin when they expose a custom transform
 * stream with additional API surface.
 */
export class GenericTransformStreamMixin {
  readonly #transform: TransformStreamImpl;

  constructor(transform: TransformStreamImpl) {
    this.#transform = transform;
  }

  get readable(): ReadableStreamImpl {
    return this.#transform.readable;
  }

  get writable(): WritableStreamImpl {
    return this.#transform.writable;
  }

  // -- Friends ----------------------------------------------------------

  static getAssociatedTransform(
    stream: GenericTransformStreamMixin,
  ): TransformStreamImpl {
    return stream.#transform;
  }
}

export const genericTransformStreamIDL = defineInterfaceMixin({
  name: 'GenericTransformStream',
  members: [
    roAttr('readable', reference('ReadableStream')),
    roAttr('writable', reference('WritableStream')),
  ],
});
