// @rollup-cycle streams-readable
import {
  arg, defineInterface, idlType, impl, nullable, op, roAttr, reference,
  xattr,
} from '../web-idl/declaration/index';
import { isBufferSourceDetached } from '../web-idl/buffer-source';
import {
  bindingContext, type BindingContext,
} from '../web-idl/projection';
import { ReadableByteStreamControllerImpl } from './readable-byte-stream-controller';
import {
  readableByteStreamControllerRespond,
  readableByteStreamControllerRespondWithNewView,
} from './readable-byte-stream-operations';

export class ReadableStreamBYOBRequestImpl {
  readonly #context: BindingContext;
  #controller?: ReadableByteStreamControllerImpl;
  #view?: object;

  constructor(context: BindingContext) {
    this.#context = context;
  }

  get view(): object | null {
    return this.#view ?? null;
  }

  respond(bytesWritten: number): void {
    if (!this.#controller || !this.#view) {
      throw new this.#context.realm.intrinsics.typeError(
        'This BYOB request has been invalidated',
      );
    }
    const context = ReadableByteStreamControllerImpl.getContext(
      this.#controller,
    );
    if (isBufferSourceDetached(this.#view)) {
      throw new context.realm.intrinsics.typeError(
        'The BYOB request\'s buffer has been detached and cannot be used',
      );
    }
    readableByteStreamControllerRespond(this.#controller, bytesWritten);
  }

  respondWithNewView(view: object): void {
    if (!this.#controller) {
      throw new this.#context.realm.intrinsics.typeError(
        'This BYOB request has been invalidated',
      );
    }
    const context = ReadableByteStreamControllerImpl.getContext(
      this.#controller,
    );
    if (isBufferSourceDetached(view)) {
      throw new context.realm.intrinsics.typeError(
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
  exposed: ['Window', 'Worker', 'Worklet'],
  implementation: impl(ReadableStreamBYOBRequestImpl, {
    constructWith: [bindingContext],
  }),
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
