import { impl } from '../../../web-idl/index';
import {
  arg, ctor, defineInterface, idlType, op, roAttr, reference, xattr,
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
  readonly #signal: AbortSignalImpl;

  constructor(signal: AbortSignalImpl) {
    this.#signal = signal;
  }

  get signal(): AbortSignalImpl {
    return this.#signal;
  }

  abort(reason: unknown = undefined): void {
    AbortSignalImpl.signalAbort(this.#signal, reason);
  }
}

// -- Web IDL ------------------------------------------------------------

export const abortControllerIDL = defineInterface({
  name: 'AbortController',
  exposed: '*',
  implementation: impl(AbortControllerImpl, {
    constructWith: [AbortSignalImpl],
  }),
  members: [
    ctor(),
    roAttr('signal', reference('AbortSignal'), xattr('SameObject')),
    op('abort', idlType.undefined, [
      arg('reason', idlType.any, { optional: true }),
    ]),
  ],
});
