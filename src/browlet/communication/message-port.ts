import {
  arg, atArg, defineIncludes, defineInterface, DOMExceptionImpl, emptyDictionary,
  idlType, impl, op, reference, sequence, xattr, type StructuredData, type TransferSteps,
} from '../../web-idl/core/index';

import {
  createTaskSource, DetachedTransferableStamper, type EventHandlerCallback, type QueuedTaskHandle,
} from '../scripting/index';
import { EventTargetImpl } from '../dom/events/index';
import type { BrowletEnvironment } from '../environment';
import type { StructuredSerializeOptions, StructuredSerializeWithTransferResult } from '../scripting/structured-data/index';

import { MessageEventImpl } from './message-event';
import { MessageEventTargetMixin } from './message-event-target';

/** One endpoint of a channel, with a queue that can move to another realm. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#messageport
export class MessagePortImpl extends EventTargetImpl {
  declare env: BrowletEnvironment;
  /** Target for delivery; worker integrations can supply their global instead. */
  messageEventTarget: EventTargetImpl = this;
  messageEventTargetMixin = new MessageEventTargetMixin(this);
  #enabled = false;
  #taskSource = createTaskSource('port message');
  #endpoint = createPortEndpoint(this);

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
    for (const [serialized, task] of endpoint.messages) {
      if (task === null || task.remove()) endpoint.messages.set(serialized, null);
      else endpoint.messages.delete(serialized);
    }
    endpoint.port = null;
    value.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.delete(value);
    value.#endpoint = createPortEndpoint(value);
    dataHolder.fields.Endpoint = endpoint;
  }

  /** Move pending messages into the receiving port's initially disabled queue. */
  static transferReceivingSteps(this: void, dataHolder: StructuredData<PortTransferFields>, value: MessagePortImpl): void {
    const endpoint = dataHolder.fields.Endpoint;
    value.#endpoint = endpoint;
    endpoint.port = value;
    for (const serialized of endpoint.messages.keys()) value.#enqueue(serialized);
    if (endpoint.remote !== null) value.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.add(value);
  }

  get onmessage(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessage; }
  set onmessage(callback: EventHandlerCallback | null) {
    this.messageEventTargetMixin.onmessage = callback;
    this.start();
  }

  get onmessageerror(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessageerror; }
  set onmessageerror(callback: EventHandlerCallback | null) { this.messageEventTargetMixin.onmessageerror = callback; }

  /** Serialize synchronously, then add delivery work to the entangled port. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#message-port-post-message-steps
  postMessage(message: unknown, options: StructuredSerializeOptions | object[]): void {
    const transfer = Array.isArray(options) ? options : options.transfer ?? [];
    const target = this.#endpoint.remote;
    const ports = this.env.getMessagePorts(transfer);
    if (ports.includes(this)) throw new DOMExceptionImpl('A port cannot transfer itself', 'DataCloneError');
    const doomed = target !== null && ports.some((port) => port.#endpoint === target);
    const serialized = this.env.serializeWithTransfer(message, transfer);
    if (target === null || doomed) return;
    if (target.port === null) target.messages.set(serialized, null);
    else target.port.#enqueue(serialized);
  }

  /** Enable delivery without changing the order in which messages were queued. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#dom-messageport-start
  start(): void {
    if (this.#enabled) return;
    this.#enabled = true;
    this.env.responsibleEventLoop.notifyTaskRunnabilityChanged();
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

  /** Disconnect both ends; also used during permanent document destruction. */
  // https://html.spec.whatwg.org/multipage/web-messaging.html#disentangle
  disentangle(): void {
    const other = this.#endpoint.remote;
    if (other === null) return;
    this.#endpoint.remote = null;
    other.remote = null;
    this.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.delete(this);
    if (other.port !== null) other.port.env.getWindowOrWorkerGlobalScopeMixin().messagePorts.delete(other.port);
  }

  #enqueue(serialized: StructuredSerializeWithTransferResult): void {
    const source = this.#endpoint.hasBeenShipped ? this.#taskSource : unshippedPortMessageTaskSource;
    const task = this.env.realm.queueGlobalTask(source, () => {
      this.#endpoint.messages.delete(serialized);
      let received;
      try {
        received = this.env.deserializeWithTransfer(serialized);
      } catch {
        this.messageEventTarget.fireEvent('messageerror', MessageEventImpl);
        return;
      }
      this.messageEventTarget.fireEvent('message', MessageEventImpl, (event) => {
        const message = event as MessageEventImpl;
        message.data = received.deserialized;
        message.ports = received.transferredValues.filter((value): value is MessagePortImpl => value instanceof MessagePortImpl);
      });
    }, { isRunnable: () => this.#enabled });
    this.#endpoint.messages.set(serialized, task);
  }

  #ship(): void {
    const endpoint = this.#endpoint;
    if (endpoint.hasBeenShipped) return;
    endpoint.hasBeenShipped = true;
    const messages = endpoint.messages;
    endpoint.messages = new Map();
    for (const [serialized, task] of messages) {
      if (task !== null && task.remove()) this.#enqueue(serialized);
    }
  }
}

// Stable channel endpoints keep peers paired when both objects are transferred.
// No port owns an endpoint in flight; sends accumulate until it is received.
// SPEC_MISMATCH: MessagePort transfer dataHolder.[[PortMessageQueue]], dataHolder.[[RemotePort]]
type PortTransferFields = { Endpoint: PortEndpoint; };

type PortEndpoint = {
  port: MessagePortImpl | null;
  remote: PortEndpoint | null;
  hasBeenShipped: boolean;
  /** Null task handles denote messages waiting for a receiving realm. */
  messages: Map<StructuredSerializeWithTransferResult, QueuedTaskHandle | null>;
};

function createPortEndpoint(port: MessagePortImpl): PortEndpoint {
  return { port, remote: null, hasBeenShipped: false, messages: new Map() };
}

// A single source identity produces one FIFO queue per event loop, across all
// unshipped ports. A shipped endpoint uses its own source instead.
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
