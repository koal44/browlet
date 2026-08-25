import { bind } from '../../../web-idl/index';
import {
  arg, ctor, defineInterface, idlType, op, readonlyAttr, reference, xattr,
} from '../../../web-idl/declaration/index';
import { AbortSignalImpl } from './abort-signal';

/*
 * [Exposed=*]
 * interface AbortController {
 *   constructor();
 *
 *   [SameObject] readonly attribute AbortSignal signal;
 *
 *   undefined abort(optional any reason);
 * };
 */
export class AbortControllerImpl
{
  #signal: AbortSignalImpl | null = null;

  get signal(): AbortSignalImpl {
    return this.#requireSignal();
  }

  abort(reason: unknown = undefined): void {
    AbortSignalImpl.signalAbort(this.#requireSignal(), reason);
  }

  // -- Friends ----------------------------------------------------------

  static initialize(
    controller: AbortControllerImpl,
    signal: AbortSignalImpl,
  ): void {
    controller.#signal = signal;
  }

  #requireSignal(): AbortSignalImpl {
    if (!this.#signal) {
      throw new Error('AbortController signal has not been initialized');
    }
    return this.#signal;
  }
}

// -- Web IDL ------------------------------------------------------------

export const abortControllerIDL = defineInterface({
  binding: bind(AbortControllerImpl),
  exposed: '*',
  members: [
    ctor(bind({
      invoke(context) {
        AbortControllerImpl.initialize(
          this as AbortControllerImpl,
          context.objects.create(AbortSignalImpl),
        );
      },
    })),
    readonlyAttr('signal', reference('AbortSignal'), xattr('SameObject')),
    op('abort', idlType.undefined, [
      arg('reason', idlType.any, { optional: true }),
    ]),
  ],
  name: 'AbortController',
});
