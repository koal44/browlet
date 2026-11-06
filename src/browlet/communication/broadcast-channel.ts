import {
  arg, atArg, ctor, defineInterface, DOMExceptionImpl, idlType, impl, op, roAttr,
} from '../../web-idl/core/index';
import { StorageKey } from '../../storage/index';

import { EventTargetImpl } from '../dom/events/index';
import { domManipulationTaskSource, eventHandlerAttr, EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import type { BrowletEnvironment } from '../environment/index';

import { MessageEventImpl } from './message-event';

/** Broadcasts cloned messages to matching channels in the same user agent. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#broadcastchannel
export class BroadcastChannelImpl extends EventTargetImpl {
  /** Supported handler names shared by all channels. */
  static #handlerDefinitions = new Map([
    ['onmessage', 'message'], ['onmessageerror', 'messageerror'],
  ]);

  declare env: BrowletEnvironment;
  name: string;
  /** Message handlers backed by this channel's listener registrations. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, BroadcastChannelImpl.#handlerDefinitions);
  /** Closing prevents subsequent sends and delivery of previously queued messages. */
  #closed = false;
  /** Weak discovery entry owned by this channel's UserAgent. */
  #reference = new WeakRef(this);

  /** Register this channel for discovery by globals using the same local UserAgent. */
  constructor(name: string, env: BrowletEnvironment) {
    super(env);
    this.name = name;
    env.userAgent.broadcastChannels.add(this.#reference);
  }

  get onmessage(): EventHandlerCallback | null { return this.eventHandlers.get('onmessage'); }
  set onmessage(callback: EventHandlerCallback | null) { this.eventHandlers.set('onmessage', callback); }

  get onmessageerror(): EventHandlerCallback | null { return this.eventHandlers.get('onmessageerror'); }
  set onmessageerror(callback: EventHandlerCallback | null) { this.eventHandlers.set('onmessageerror', callback); }

  /** Whether this channel's global currently participates in broadcasting. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#eligible-for-messaging
  get isEligibleForMessaging(): boolean {
    if (this.env.realm.isWindow()) return this.env.realm.getAssociatedDocument().isFullyActive();
    const global = this.env.globalImplementation;
    return EventTargetImpl.is(global) && global.isWorkerGlobal() && !global.closing && !global.isSuspendable();
  }

  /** Serialize once, then queue a separate reconstruction for each destination. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-broadcastchannel-postmessage
  postMessage(message: unknown): void {
    if (!this.isEligibleForMessaging) return;
    if (this.#closed) throw new DOMExceptionImpl('BroadcastChannel is closed', 'InvalidStateError');
    const serialized = this.env.serialize(message);
    const sourceOrigin = this.env.origin;
    const sourceStorageKey = StorageKey.obtainForNonStoragePurposes(this.env);

    // The weak registry preserves creation order across the user agent, which
    // also supplies the required oldest-first order within each agent.
    // TODO(HTML §§9.5, 10): Discover and deliver to other isolates through the shared UserAgent service.
    for (const destination of this.env.userAgent.broadcastChannels.values()) {
      if (destination === this || destination.name !== this.name || !destination.isEligibleForMessaging) continue;
      if (!StorageKey.obtainForNonStoragePurposes(destination.env).equals(sourceStorageKey)) continue;
      destination.env.realm.queueGlobalTask(domManipulationTaskSource, () => {
        if (destination.#closed) return;
        let data;
        try {
          data = destination.env.deserialize(serialized);
        } catch {
          destination.fireEvent('messageerror', MessageEventImpl, (event) => {
            event.setOrigin(sourceOrigin);
          });
          return;
        }
        destination.fireEvent('message', MessageEventImpl, (message) => {
          message.data = data;
          message.setOrigin(sourceOrigin);
        });
      });
    }
  }

  /** Stop receiving and release discovery and listener-based retention. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-broadcastchannel-close
  close(): void {
    this.#closed = true;
    this.env.userAgent.broadcastChannels.delete(this.#reference);
    this.env.getWindowOrWorkerGlobalScopeMixin().broadcastChannels.delete(this);
  }

  /** Retain listening channels for their global's lifetime, independently of weak discovery. */
  protected override eventListenerListChanged(type: string): void {
    if (this.#closed || (type !== 'message' && type !== 'messageerror')) return;
    const channels = this.env.getWindowOrWorkerGlobalScopeMixin().broadcastChannels;
    if (this.hasEventListener('message') || this.hasEventListener('messageerror')) channels.add(this);
    else channels.delete(this);
  }
}

export const broadcastChannelIDL = defineInterface<BrowletEnvironment>({
  name: 'BroadcastChannel',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  implementation: impl(BroadcastChannelImpl, { constructWith: [atArg(1, (env) => env)] }),
  members: [
    ctor([arg('name', idlType.DOMString)]),
    roAttr('name', idlType.DOMString),
    op('postMessage', idlType.undefined, [arg('message', idlType.any)]),
    op('close', idlType.undefined, []),
    eventHandlerAttr('onmessage'), eventHandlerAttr('onmessageerror'),
  ],
});
