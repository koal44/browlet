// @rollup-cycle streams-readable
import {
  arg, defineInterface, idlType, impl, nullable, op, roAttr, reference,
  xattr,
} from '../web-idl/declaration/index';
import { isBufferSourceDetached } from '../js-engine/index';
import { TypeError } from '../js-engine/simple-exception';
import type { ReadableByteStreamControllerImpl } from './readable-byte-stream-controller';
import {
  readableByteStreamControllerRespond,
  readableByteStreamControllerRespondWithNewView,
} from './readable-byte-stream-operations';

export class ReadableStreamBYOBRequestImpl {
  #controller?: ReadableByteStreamControllerImpl;
  #view?: object;

  get view(): object | null {
    return this.#view ?? null;
  }

  respond(bytesWritten: number): void {
    if (!this.#controller || !this.#view) {
      throw new TypeError(
        'This BYOB request has been invalidated',
      );
    }
    if (isBufferSourceDetached(this.#view)) {
      throw new TypeError(
        'The BYOB request\'s buffer has been detached and cannot be used',
      );
    }
    readableByteStreamControllerRespond(this.#controller, bytesWritten);
  }

  respondWithNewView(view: object): void {
    if (!this.#controller) {
      throw new TypeError(
        'This BYOB request has been invalidated',
      );
    }
    if (isBufferSourceDetached(view)) {
      throw new TypeError(
        'The supplied view has a detached buffer',
      );
    }
    readableByteStreamControllerRespondWithNewView(this.#controller, view);
  }

  // -- Friends ----------------------------------------------------------

  static initialize(
    request: ReadableStreamBYOBRequestImpl,
    controller: ReadableByteStreamControllerImpl,
    view: object,
  ): void {
    request.#controller = controller;
    request.#view = view;
  }

  static invalidate(request: ReadableStreamBYOBRequestImpl): void {
    request.#controller = undefined;
    request.#view = undefined;
  }

}

export const readableStreamBYOBRequestIDL = defineInterface({
  name: 'ReadableStreamBYOBRequest',
  exposed: '*',
  implementation: impl(ReadableStreamBYOBRequestImpl),
  members: [
    roAttr('view', nullable(idlType.Uint8Array)),
    op('respond', idlType.undefined, [
      arg('bytesWritten', idlType.unsignedLongLong, xattr('EnforceRange')),
    ]),
    op('respondWithNewView', idlType.undefined, [
      arg('view', reference('ArrayBufferView')),
    ]),
  ],
});
