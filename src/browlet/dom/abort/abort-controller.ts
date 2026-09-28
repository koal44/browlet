import type { JSEnvironment } from '../../../js-engine/index';
import {
  arg, atArg, ctor, defineInterface, idlType, op, roAttr, reference, xattr,
  impl, invokeWith,
} from '../../../web-idl/index';
import { AbortSignalImpl } from './abort-signal';

// https://dom.spec.whatwg.org/#interface-abortcontroller
export class AbortControllerImpl
{
  #signal: AbortSignalImpl;

  constructor(signal: AbortSignalImpl) {
    this.#signal = signal;
  }

  get signal(): AbortSignalImpl {
    return this.#signal;
  }

  // https://dom.spec.whatwg.org/#dom-abortcontroller-abort
  abort(reason: unknown = undefined, env?: JSEnvironment): void {
    this.#signal.signalAbort(reason, env);
  }
}

// -- Web IDL ------------------------------------------------------------

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
export const abortControllerIDL = defineInterface({
  name: 'AbortController',
  exposed: '*',
  implementation: impl(AbortControllerImpl, {
    constructWith: [atArg(0, (ctx) => ctx.construct(AbortSignalImpl))],
  }),
  members: [
    ctor(),
    roAttr('signal', reference('AbortSignal'), xattr('SameObject')),
    op('abort', idlType.undefined,
      [arg('reason', idlType.any, { optional: true })],
      invokeWith(atArg(1, (_receiver, method) => method.getEnvironment())),
    ),
  ],
});
