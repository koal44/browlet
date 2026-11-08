import { WeakOrderedSet } from '../../infra/index';
import {
  arg, atArg, ctor, defineInterface, DOMExceptionImpl, idlType, impl, op, roAttr,
} from '../../web-idl/core/index';
import type { Origin } from '../../url/index';
import { StorageKey } from '../../storage/index';

import { EventTargetImpl } from '../dom/events/index';
import { domManipulationTaskSource, eventHandlerAttr, EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import type { BrowletEnvironment } from '../environment/index';
import type { SerializedRecord } from '../scripting/structured-data/index';

import { MessageEventImpl } from './message-event';

/** Broadcasts cloned messages to matching channels in the same user agent. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#broadcastchannel
export class BroadcastChannelImpl extends EventTargetImpl implements BroadcastChannelDestination {
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
  /** Release this channel's local or remote discovery registration on close. */
  #unregister: () => void;

  /** Register this channel with its original UserAgent, including across isolates. */
  constructor(name: string, env: BrowletEnvironment) {
    super(env);
    this.name = name;
    this.#unregister = env.userAgent.broadcastChannels.register(this);
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

  /** Select the non-storage partition without consulting storage permission. */
  get storageKey(): StorageKey { return StorageKey.obtainForNonStoragePurposes(this.env); }

  /** Serialize once, then queue a separate reconstruction for each destination. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-broadcastchannel-postmessage
  postMessage(message: unknown): void {
    if (!this.isEligibleForMessaging) return;
    if (this.#closed) throw new DOMExceptionImpl('BroadcastChannel is closed', 'InvalidStateError');
    const serialized = this.env.serialize(message);
    const sourceOrigin = this.env.origin;
    this.env.userAgent.broadcastChannels.postMessage(this, serialized, sourceOrigin);
  }

  /** Queue reconstruction in this channel's realm after the sender has selected destinations. */
  receiveMessage(serialized: SerializedRecord, sourceOrigin: Origin): void {
    this.env.realm.queueGlobalTask(domManipulationTaskSource, {
      run: () => {
        if (this.#closed) return;
        let data;
        try {
          data = this.env.deserialize(serialized);
        } catch {
          this.fireEvent('messageerror', MessageEventImpl, (event) => {
            event.setOrigin(sourceOrigin);
          });
          return;
        }
        this.fireEvent('message', MessageEventImpl, (message) => {
          message.data = data;
          message.setOrigin(sourceOrigin);
        });
      },
    });
  }

  /** Stop receiving and release discovery and listener-based retention. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-broadcastchannel-close
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unregister();
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

/** Browser-owned discovery, preserving creation order without retaining unobserved channels. */
export class BroadcastChannelRegistry {
  /** Local channels and private remote endpoints share the same ordered registry. */
  #destinations = new WeakOrderedSet<BroadcastChannelDestination>();

  /** Register until explicit close, endpoint teardown, or collection; return the removal steps. */
  register(destination: BroadcastChannelDestination): () => void {
    const reference = new WeakRef(destination);
    this.#destinations.add(reference);
    return () => { this.#destinations.delete(reference); };
  }

  /** Select destinations at send time; each destination owns its task and reconstruction. */
  postMessage(source: BroadcastChannelSource, serialized: SerializedRecord, origin: Origin): void {
    const key = source.storageKey;
    for (const destination of this.#destinations.values()) {
      if (destination === source || destination.name !== source.name || !destination.isEligibleForMessaging) continue;
      if (destination.storageKey.equals(key)) destination.receiveMessage(serialized, origin);
    }
  }
}

/** Sender identity and partition, retained even if serialization closed its channel. */
export interface BroadcastChannelSource {
  name: string;
  /** Non-storage partition used when selecting destinations. */
  storageKey: StorageKey;
}

/** Local channel or private remote endpoint; author objects and environments do not cross isolates. */
export interface BroadcastChannelDestination extends BroadcastChannelSource {
  /** Current global eligibility, read when a sender selects recipients. */
  isEligibleForMessaging: boolean;
  /** Queue this already-selected delivery on the destination's HTML event loop. */
  receiveMessage(serialized: SerializedRecord, origin: Origin): void;
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
