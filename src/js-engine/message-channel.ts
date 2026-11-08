/// <reference types="node" preserve="true" />

import { markAsUncloneable as nodeMarkAsUncloneable, MessageChannel, receiveMessageOnPort, type MessagePort } from 'node:worker_threads';

/** A native channel for internal data; HTML owns serialization, task queues, and events. */
export class JSMessageChannel<Message = unknown> {
  port1: JSMessagePort<Message>;
  port2: JSMessagePort<Message>;

  constructor() {
    const channel = new MessageChannel();
    this.port1 = new JSMessagePort(channel.port1);
    this.port2 = new JSMessagePort(channel.port2);
  }
}

/** Local operations on a native endpoint that can move between isolates. */
export class JSMessagePort<Message = unknown> {
  /** The local native endpoint used for sending and receiving. */
  #backing: MessagePort;

  /** Adopt a handle received through internal transport, without starting message delivery. */
  constructor(handle: JSMessagePortHandle) {
    this.#backing = handle;
  }

  /**
   * Include this handle in both the outgoing data and its transfer list to move ownership.
   * Stop the old owner's listener first. Reading the handle alone does not detach it;
   * native sending performs the transfer, and a failed send leaves ownership unchanged.
   */
  get handle(): JSMessagePortHandle { return this.#backing; }

  /** Clone internal data and move the listed resources, using the native backend. */
  send(message: Message, transferList: JSTransferable[] = []): void {
    this.#backing.postMessage(message, transferList);
  }

  /**
   * Remove one queued host message without running listeners or a task checkpoint.
   * Use on an endpoint without a message listener. The envelope distinguishes an
   * empty queue from an actual undefined message; its type trusts the host protocol.
   */
  receive(): { message: Message; } | undefined {
    return receiveMessageOnPort(this.#backing);
  }

  /**
   * Receive on the local host queue. The consumer must queue any browser work itself.
   * Removing the last receiver stops delivery without closing the channel; native queued
   * messages remain available to a later receiver, including after endpoint transfer.
   * This pauses host delivery; it does not disable an HTML port's task queue.
   */
  listen(handlers: JSMessagePortHandlers<Message>): () => void {
    const { onMessage, onMessageError, onClose } = handlers;
    if (onClose !== undefined) this.#backing.on('close', onClose);
    if (onMessageError !== undefined) this.#backing.on('messageerror', onMessageError);
    this.#backing.on('message', onMessage);
    return () => {
      this.#backing.off('message', onMessage);
      if (onMessageError !== undefined) this.#backing.off('messageerror', onMessageError);
      if (onClose !== undefined) this.#backing.off('close', onClose);
    };
  }

  /** Disconnect the native channel. This does not implement HTML MessagePort.close(). */
  close(): void { this.#backing.close(); }
}

/** Reject native transport of an internal object whose state only exists in this isolate. */
export function markAsUncloneable(value: object): void {
  nodeMarkAsUncloneable(value);
}

/** Trusted internal message contract; native cloning does not validate its TypeScript shape. */
export interface JSMessagePortHandlers<Message> {
  onMessage: (message: Message) => void;
  onMessageError?: (error: unknown) => void;
  onClose?: () => void;
}

/** Native endpoint identity carried by internal transport; operate on it through JSMessagePort. */
export type JSMessagePortHandle = MessagePort;

/** Resources whose ownership this backend can move; shared buffers are cloned, not transferred. */
export type JSTransferable = ArrayBuffer | JSMessagePortHandle;
