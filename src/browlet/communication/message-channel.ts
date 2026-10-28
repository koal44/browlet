import { atArg, ctor, defineInterface, impl, reference, roAttr } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment';

import { MessagePortImpl } from './message-port';

/** A pair of newly entangled ports in the channel's realm. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#messagechannel
export class MessageChannelImpl {
  port1: MessagePortImpl;
  port2: MessagePortImpl;

  constructor(env: BrowletEnvironment) {
    this.port1 = new MessagePortImpl(env);
    this.port2 = new MessagePortImpl(env);
    this.port1.entangle(this.port2);
  }
}

export const messageChannelIDL = defineInterface<BrowletEnvironment>({
  name: 'MessageChannel',
  exposed: ['Window', 'Worker'],
  implementation: impl(MessageChannelImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    ctor([]),
    roAttr('port1', reference('MessagePort')),
    roAttr('port2', reference('MessagePort')),
  ],
});
