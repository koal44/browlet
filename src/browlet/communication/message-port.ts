import { assertNever, InternalError } from '../../infra/index';
import {
  isArrayBuffer, JSMessageChannel, JSMessagePort, randomUUID, type JSMessagePortHandle, type JSTransferable,
} from '../../js-engine/index';
import {
  arg, atArg, defineIncludes, defineInterface, DOMExceptionImpl, emptyDictionary,
  idlType, impl, op, reference, sequence, xattr, type StructuredData, type TransferSteps,
} from '../../web-idl/core/index';

import { EventTargetImpl } from '../dom/events/index';
import {
  createTaskSource, DetachedTransferableStamper, EventHandlerMap, type EventHandlerCallback, type QueuedTaskHandle,
} from '../scripting/index';
import type { BrowletEnvironment } from '../environment/index';
import type { StructuredSerializeOptions, StructuredSerializeWithTransferResult } from '../scripting/structured-data/index';

import { MessageEventImpl } from './message-event';
import { MessageEventTargetMixin } from './message-event-target';

/** One endpoint of a channel, with a queue that can move to another realm. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#messageport
export class MessagePortImpl extends EventTargetImpl {
  /** Relevant environment for serialization, delivery tasks, and receiving-realm objects. */
  declare env: BrowletEnvironment;
  /** Target for delivery; worker integrations can supply their global instead. */
  messageEventTarget: EventTargetImpl = this;
  /** Per-port handlers using the messaging mixin's shared definitions. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, MessageEventTargetMixin.handlerDefinitions);
  /** Shared implementation of the message and messageerror handler attributes. */
  messageEventTargetMixin = new MessageEventTargetMixin(this.eventHandlers);
  /** Initially disabled; start() enables delivery permanently for this port object. */
  #enabled = false;
  /** Independent task source used after this endpoint or its peer has been shipped. */
  #taskSource = createTaskSource('port message');
  /** Stable queue and peer identity, retained while the receiving object is in transit. */
  #endpoint = createPortEndpoint(this);

  /** Create a disconnected endpoint with an initially disabled message queue. */
  constructor(env: BrowletEnvironment) {
    super(env);
  }

  /** Move the endpoint out of the sending object, preserving messages in flight. */
  static transferSteps(this: void, value: MessagePortImpl, dataHolder: StructuredData<PortTransferFields>): void {
    const endpoint = value.#endpoint;
    endpoint.hasBeenShipped = true;
    const remote = endpoint.remote;
    if (remote !== null) {
      if (remote.port !== null) remote.port.#ship();
      else remote.hasBeenShipped = true;
    }
    // Cancel source-realm deliveries. They resume only when the receiving port
    // acquires this endpoint and is started in its own realm.
    for (const [message, task] of endpoint.messages) {
      if (task === null || task.remove()) endpoint.messages.set(message, null);
      else endpoint.messages.delete(message);
    }
    endpoint.native?.send({ type: 'owner', id: endpoint.id, envId: null });
    endpoint.removeListeners?.();
    endpoint.removeListeners = null;
    endpoint.port = null;
    value.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.delete(value);
    value.#endpoint = createPortEndpoint(value);
    dataHolder.fields.Endpoint = endpoint;
    endpoint.transferData = dataHolder;
  }

  /** Move pending messages into the receiving port's initially disabled queue. */
  static transferReceivingSteps(this: void, dataHolder: StructuredData<PortTransferFields>, value: MessagePortImpl): void {
    const saved = dataHolder.fields.Endpoint;
    const endpoint = saved.kind === 'local' ? saved : createPortEndpoint(value);
    if (saved.kind === 'portable') {
      endpoint.id = saved.id;
      endpoint.remoteId = saved.remoteId;
      endpoint.remoteEnvId = saved.remoteEnvId;
      endpoint.hasBeenShipped = true;
      endpoint.native = saved.handle === null ? null : new JSMessagePort(saved.handle);
      for (const message of saved.messages) {
        endpoint.messages.set({ ...message, endpoints: [] }, null);
      }
    }
    value.#endpoint = endpoint;
    endpoint.port = value;
    endpoint.transferData = null;
    for (const message of endpoint.messages.keys()) value.#enqueue(message);
    if (endpoint.native !== null) value.#listen();
    if (endpoint.remote !== null || endpoint.native !== null) value.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.add(value);
  }

  /** Remove only this endpoint's deliveries, including those retained during transfer. */
  static #clearMessageQueue(endpoint: PortEndpoint): void {
    // Ports can share a task source. Null handles are messages waiting for a
    // transferred port to be received, without a task in any event loop yet.
    for (const [message, task] of endpoint.messages) {
      task?.remove();
      MessagePortImpl.#discardMessage(message);
    }
    endpoint.messages.clear();
  }

  /** Prepare only this message's transferred resources; never traverse author objects or generic IDL fields. */
  static #prepareMessage(message: PortMessage): PortMessageSnapshot {
    if (message.transferList === null) {
      const transferList: JSTransferable[] = message.serialized?.transferDataHolders.flatMap((holder) =>
        holder.type === 'platform-object' ? [] : [holder.buffer]) ?? [];
      for (const endpoint of message.endpoints) transferList.push(...MessagePortImpl.#prepareEndpoint(endpoint));
      message.endpoints = [];
      message.transferList = [...new Set(transferList)];
    }
    return { serialized: message.serialized, transferList: message.transferList };
  }

  /** Replace a transferred local endpoint with portable state and collect its nested native resources. */
  static #prepareEndpoint(endpoint: PortEndpoint): JSTransferable[] {
    const holder = endpoint.transferData;
    if (holder === null) throw new InternalError('Port transport requires an unreceived transfer');
    const remote = endpoint.remote;
    if (remote !== null) {
      const channel = new JSMessageChannel<MessagePortTransportMessage>();
      endpoint.native = channel.port1;
      remote.native = channel.port2;
      endpoint.remoteId = remote.id;
      remote.remoteId = endpoint.id;
      endpoint.remoteEnvId = remote.port?.env.id ?? null;
      remote.remoteEnvId = null;
      endpoint.remote = null;
      remote.remote = null;
      // The other endpoint may also be in transit. Its eventual receiver owns
      // listening; an existing peer can immediately send through the new pipe.
      if (remote.port !== null) remote.port.#listen();
    }
    const messages = [...endpoint.messages.keys()].map((message) => MessagePortImpl.#prepareMessage(message));
    const handle = endpoint.native?.handle ?? null;
    holder.fields.Endpoint = {
      kind: 'portable', id: endpoint.id, remoteId: endpoint.remoteId,
      remoteEnvId: endpoint.remoteEnvId, handle, messages,
    };
    endpoint.transferData = null;
    endpoint.messages.clear();
    return [...(handle === null ? [] : [handle]), ...messages.flatMap((message) => message.transferList)];
  }

  /** Release transferred channels when a delivery is discarded or cannot be reconstructed. */
  static #discardMessage(message: PortMessage): void {
    for (const endpoint of message.endpoints) {
      MessagePortImpl.#disentangle(endpoint);
      MessagePortImpl.#clearMessageQueue(endpoint);
    }
    for (const resource of message.transferList ?? []) {
      if (!isArrayBuffer(resource)) new JSMessagePort(resource).close();
    }
  }

  /** Disconnect live or in-transit state, preserving messages already queued at either endpoint. */
  static #disentangle(endpoint: PortEndpoint): void {
    endpoint.removeListeners?.();
    endpoint.removeListeners = null;
    endpoint.native?.close();
    endpoint.native = null;
    endpoint.remoteId = null;
    endpoint.remoteEnvId = null;
    const owner = endpoint.port;
    owner?.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.delete(owner);
    const other = endpoint.remote;
    if (other === null) return;
    endpoint.remote = null;
    other.remote = null;
    if (other.port !== null) other.port.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.delete(other.port);
  }

  /** Current message handler; assigning it, including null, also enables delivery. */
  get onmessage(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessage; }
  /** Set the handler and perform HTML's implicit start operation. */
  set onmessage(callback: EventHandlerCallback | null) {
    this.messageEventTargetMixin.onmessage = callback;
    this.start();
  }

  /** Handler for messages that cannot be reconstructed in this port's realm. */
  get onmessageerror(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessageerror; }
  /** Set the error handler without enabling the message queue. */
  set onmessageerror(callback: EventHandlerCallback | null) { this.messageEventTargetMixin.onmessageerror = callback; }

  /** Whether the channel extends beyond this global, including a peer in transit. */
  isEntangledOutsideGlobal(): boolean {
    if (this.#endpoint.native !== null) return this.#endpoint.remoteEnvId !== this.env.id;
    const remote = this.#endpoint.remote;
    // A missing remote endpoint means disconnected. A missing remote port means
    // its endpoint is in transit: the channel still exists, but no global owns
    // that end until receipt. Do not discard the local worker's connection or
    // retain the detached sender's environment as the peer's current owner.
    return remote !== null && (remote.port === null || remote.port.env !== this.env);
  }

  /** Serialize synchronously, then add delivery work to the entangled port. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#message-port-post-message-steps
  postMessage(message: unknown, options: StructuredSerializeOptions | object[]): void {
    const transfer = Array.isArray(options) ? options : options.transfer ?? [];
    const target = this.#endpoint.remote;
    const remoteChannel = this.#endpoint.native;
    const ports = this.env.getMessagePorts(transfer);
    if (ports.includes(this)) throw new DOMExceptionImpl('A port cannot transfer itself', 'DataCloneError');
    const endpoints = ports.map((port) => port.#endpoint);
    const doomed = endpoints.some((endpoint) => endpoint === target || endpoint.id === this.#endpoint.remoteId);
    const serialized = this.env.serializeWithTransfer(message, transfer);
    const delivery: PortMessage = { serialized, endpoints, transferList: null };
    if (doomed || (target === null && remoteChannel === null)) {
      MessagePortImpl.#discardMessage(delivery);
      return;
    }
    if (remoteChannel !== null) {
      const snapshot = MessagePortImpl.#prepareMessage(delivery);
      remoteChannel.send({ type: 'message', message: snapshot }, snapshot.transferList);
      return;
    }
    if (target === null) return;
    if (target.port === null) target.messages.set(delivery, null);
    else target.port.#enqueue(delivery);
  }

  /** Enable delivery without changing the order in which messages were queued. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-messageport-start
  start(): void {
    if (this.#enabled) return;
    this.#enabled = true;
    this.env.responsibleEventLoop.notifyTaskRunnabilityChanged();
  }

  /** Discard queued deliveries at the entangled endpoint without disconnecting it. */
  // https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker
  clearOutgoingMessages(): void {
    // Step 4, extracted for the dedicated worker's implicit inside port. Ordinary
    // close/disentangle must preserve queued messages. The separate-isolate host
    // owns the outside port directly and uses clearMessageQueue() instead.
    if (this.#endpoint.native !== null) {
      throw new InternalError('Remote worker deliveries must be cleared by their outside execution owner');
    }
    const remote = this.#endpoint.remote;
    if (remote === null) return;
    MessagePortImpl.#clearMessageQueue(remote);
  }

  /** Discard this port's pending deliveries; host termination owns the outside port directly. */
  clearMessageQueue(): void {
    MessagePortImpl.#clearMessageQueue(this.#endpoint);
  }

  /** Disconnect this endpoint and prevent any further transfer of it. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-messageport-close
  close(): void {
    DetachedTransferableStamper.stamp(this);
    this.disentangle();
  }

  /** Form a channel, replacing either endpoint's previous connection. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#entangle
  entangle(other: MessagePortImpl): void {
    this.disentangle();
    other.disentangle();
    this.#endpoint.remote = other.#endpoint;
    other.#endpoint.remote = this.#endpoint;
    this.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.add(this);
    other.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.add(other);
  }

  /** Connect a native peer without enabling HTML delivery; startup uses this for the implicit worker channel. */
  // The native pipe replaces the local peer reference. HTML still owns serialization,
  // the task source, queue activation, receiver realm, and MessageEvent construction.
  entangleRemote(channel: JSMessagePort<MessagePortTransportMessage>): void {
    this.disentangle();
    this.#ship();
    this.#endpoint.native = channel;
    this.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.add(this);
    this.#listen();
  }

  /** Disconnect both ends; also used during permanent document destruction. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#disentangle
  disentangle(): void {
    MessagePortImpl.#disentangle(this.#endpoint);
  }

  /** Resume host reception after queued HTML deliveries have been installed on their new owner. */
  #listen(): void {
    const endpoint = this.#endpoint;
    const channel = endpoint.native;
    if (channel === null) return;
    endpoint.removeListeners = channel.listen({
      onMessage: (packet) => {
        switch (packet.type) {
          case 'owner':
            endpoint.remoteId = packet.id;
            endpoint.remoteEnvId = packet.envId;
            break;
          case 'message':
            this.#enqueue({ ...packet.message, endpoints: [] });
            break;
          default:
            assertNever(packet, 'Unknown MessagePort transport message');
        }
      },
      onMessageError: () => { this.#enqueue({ serialized: null, endpoints: [], transferList: [] }); },
      onClose: () => { this.disentangle(); },
    });
    channel.send({ type: 'owner', id: endpoint.id, envId: this.env.id });
  }

  /** Retain one HTML delivery task, gated by this port's start state and receiving environment. */
  #enqueue(message: PortMessage): void {
    const source = this.#endpoint.hasBeenShipped ? this.#taskSource : unshippedPortMessageTaskSource;
    const task = this.env.realm.queueGlobalTask(source, () => {
      this.#endpoint.messages.delete(message);
      if (message.serialized === null) {
        this.messageEventTarget.fireEvent('messageerror', MessageEventImpl);
        return;
      }
      let received;
      try {
        received = this.env.deserializeWithTransfer(message.serialized);
      } catch {
        MessagePortImpl.#discardMessage(message);
        this.messageEventTarget.fireEvent('messageerror', MessageEventImpl);
        return;
      }
      this.messageEventTarget.fireEvent('message', MessageEventImpl, (message) => {
        message.data = received.deserialized;
        message.ports = received.transferredValues.filter((value): value is MessagePortImpl => value instanceof MessagePortImpl);
      });
    }, { isRunnable: () => this.#enabled });
    this.#endpoint.messages.set(message, task);
  }

  /** Move pending deliveries off the shared unshipped source onto this port's own source, in order. */
  #ship(): void {
    const endpoint = this.#endpoint;
    if (endpoint.hasBeenShipped) return;
    endpoint.hasBeenShipped = true;
    const messages = endpoint.messages;
    endpoint.messages = new Map();
    for (const [message, task] of messages) {
      if (task !== null && task.remove()) this.#enqueue(message);
    }
  }
}

// Stable channel endpoints keep peers paired when both objects are transferred.
// No port owns an endpoint in flight; sends accumulate until it is received.
// SPEC_MISMATCH: MessagePort transfer dataHolder.[[PortMessageQueue]], dataHolder.[[RemotePort]]
/** Endpoint retained locally or prepared for transport between transfer and receipt. */
type PortTransferFields = { Endpoint: PortEndpoint | TransferredPortEndpoint; };

/** Local channel identity and pending deliveries, independent of the current port object. */
type PortEndpoint = {
  /** Live implementation state; never placed on a native channel. */
  kind: 'local';
  /** Portable endpoint identity for detecting a peer posted to itself after transfer. */
  id: string;
  /** Current receiver, or null while the endpoint is in transit. */
  port: MessagePortImpl | null;
  /** Paired local endpoint; promoted to a native pipe when either side crosses isolates. */
  remote: PortEndpoint | null;
  /** Native peer identity, retained across transfer even while no receiving object exists. */
  remoteId: string | null;
  /** Most recently reported native peer owner; null denotes an endpoint in transit or not yet attached. */
  remoteEnvId: string | null;
  /** Local native handle after promotion; null for an ordinary local channel or a disconnected endpoint. */
  native: JSMessagePort<MessagePortTransportMessage> | null;
  /** Stops host delivery before moving the handle, without closing its queue. */
  removeListeners: (() => void) | null;
  /** Matching interface-owned holder, rewritten with portable state only when crossing isolates. */
  transferData: StructuredData<PortTransferFields> | null;
  /** Selects the independent task source once either endpoint has been transferred. */
  hasBeenShipped: boolean;
  /** Null task handles denote messages waiting for a receiving realm. */
  messages: Map<PortMessage, QueuedTaskHandle | null>;
};

/** One HTML delivery and the transferred resources whose ownership it carries. */
interface PortMessage {
  /** Null denotes a native deserialization failure, delivered as messageerror. */
  serialized: StructuredSerializeWithTransferResult | null;
  /** Local transfer endpoints captured before serialization detaches their sending objects. */
  endpoints: PortEndpoint[];
  /** Native resources after preparation or receipt; null means the local endpoints still need preparation. */
  transferList: JSTransferable[] | null;
}

/** Portable delivery record, including resources nested in a transferred port's pending queue. */
interface PortMessageSnapshot {
  serialized: StructuredSerializeWithTransferResult | null;
  /** Handles remain private; HTML deserialization alone supplies author-facing values. */
  transferList: JSTransferable[];
}

/** Pending HTML messages move explicitly; the native handle retains messages not yet received by the host. */
interface TransferredPortEndpoint {
  kind: 'portable';
  id: string;
  remoteId: string | null;
  remoteEnvId: string | null;
  /** Null for a disconnected endpoint, which may still have queued HTML deliveries. */
  handle: JSMessagePortHandle | null;
  /** Ordered deliveries without any source-realm task handles or live implementations. */
  messages: PortMessageSnapshot[];
}

/** Private channel protocol; ownership notifications never become author events. */
export type MessagePortTransportMessage =
  | { type: 'message'; message: PortMessageSnapshot; }
  | { type: 'owner'; id: string; envId: string | null; };

/** Allocate fresh local channel state without a peer or any queued deliveries. */
function createPortEndpoint(port: MessagePortImpl): PortEndpoint {
  return {
    kind: 'local', id: randomUUID(), port, remote: null, remoteId: null, remoteEnvId: null,
    native: null, removeListeners: null, transferData: null, hasBeenShipped: false, messages: new Map(),
  };
}

/** Shared FIFO source for all unshipped ports in an event loop; shipped endpoints use their own. */
const unshippedPortMessageTaskSource = createTaskSource('unshipped port message');

const messagePortTransferSteps = {
  transferSteps: MessagePortImpl.transferSteps,
  transferReceivingSteps: MessagePortImpl.transferReceivingSteps,
} satisfies TransferSteps<MessagePortImpl, PortTransferFields>;

// [Exposed=(Window,Worker,AudioWorklet), Transferable] interface MessagePort : EventTarget { ... };
export const messagePortIDL = defineInterface<BrowletEnvironment>({
  name: 'MessagePort',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker', 'AudioWorklet'],
  ...xattr('Transferable'),
  transferSteps: messagePortTransferSteps,
  implementation: impl(MessagePortImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    op('postMessage', idlType.undefined, [arg('message', idlType.any), arg('transfer', sequence(idlType.object))]),
    op('postMessage', idlType.undefined, [
      arg('message', idlType.any),
      arg('options', reference('StructuredSerializeOptions'), { optional: true, default: emptyDictionary }),
    ]),
    op('start', idlType.undefined, []),
    op('close', idlType.undefined, []),
  ],
});

export const messagePortIncludesMessageEventTargetIDL = defineIncludes({
  interface: 'MessagePort', mixin: 'MessageEventTarget',
});
