// @rollup-cycle streams-readable
import {
  arg, defineInterfaceMixin, idlType, op, promise, roAttr,
} from '../web-idl/declaration/index';
import type { BindingContext } from '../web-idl/projection';
import type { StreamPromise } from './promise';
import type { ReadableStreamImpl } from './readable-stream';
import {
  readableStreamReaderGenericCancel,
} from './readable-stream-operations';

export class ReadableStreamGenericReaderMixin {
  readonly #context: BindingContext;
  #state?: ReadableStreamGenericReaderState;

  constructor(context: BindingContext) {
    this.#context = context;
  }

  get closed(): StreamPromise {
    return ReadableStreamGenericReaderMixin.getState(this).closedPromise;
  }

  cancel(reason?: unknown): StreamPromise {
    const state = ReadableStreamGenericReaderMixin.getState(this);
    if (!state.stream) {
      return this.#context.createRejectedPromise(
        new this.#context.realm.intrinsics.typeError(
          'Cannot cancel a stream using a released reader',
        ),
        idlType.undefined,
      );
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  // -- Friends ----------------------------------------------------------

  static getContext(
    reader: ReadableStreamGenericReaderMixin,
  ): BindingContext {
    return reader.#context;
  }

  static getState(
    reader: ReadableStreamGenericReaderMixin,
  ): ReadableStreamGenericReaderState {
    if (!reader.#state) {
      throw new Error('ReadableStreamGenericReader is not set up');
    }
    return reader.#state;
  }

  static setState(
    reader: ReadableStreamGenericReaderMixin,
    state: ReadableStreamGenericReaderState,
  ): void {
    reader.#state = state;
  }
}

export type ReadableStreamGenericReaderState = {
  closedPromise: StreamPromise;
  stream?: ReadableStreamImpl;
};

// -- Web IDL ------------------------------------------------------------

export const readableStreamGenericReaderIDL = defineInterfaceMixin({
  name: 'ReadableStreamGenericReader',
  members: [
    roAttr('closed', promise(idlType.undefined)),
    op('cancel', promise(idlType.undefined), [
      arg('reason', idlType.any, { optional: true }),
    ]),
  ],
});
