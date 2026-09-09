// @rollup-cycle streams-readable
import { InternalPromise, type InternalPromiseCapability, type PromiseReactions } from '../js-engine/internal-promise';
import {
  arg, defineInterfaceMixin, idlType, op, promise, roAttr,
} from '../web-idl/declaration/index';
import { TypeError } from '../js-engine/simple-exception';
import type { ReadableStreamImpl } from './readable-stream';
import {
  readableStreamReaderGenericCancel,
} from './readable-stream-operations';

export class ReadableStreamGenericReaderMixin {
  #state?: ReadableStreamGenericReaderState;

  // SPEC_MISMATCH: get closed() -> Promise<undefined>
  get closed(): InternalPromise<void> {
    return ReadableStreamGenericReaderMixin.getState(this).closedPromise.promise;
  }

  // SPEC_MISMATCH: cancel(reason?) -> Promise<undefined>
  cancel(reason?: unknown): InternalPromise<void> {
    const state = ReadableStreamGenericReaderMixin.getState(this);
    if (!state.stream) {
      return InternalPromise.reject(new TypeError(
        'Cannot cancel a stream using a released reader',
      ));
    }
    return readableStreamReaderGenericCancel(this, reason);
  }

  // -- Friends ----------------------------------------------------------

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
  readonly reactions: PromiseReactions;
  closedPromise: InternalPromiseCapability<void>;
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
