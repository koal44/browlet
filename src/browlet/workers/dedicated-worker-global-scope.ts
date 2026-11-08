import {
  arg, defineIncludes, defineInterface, DOMExceptionImpl, DOMExceptionNames,
  emptyDictionary, idlType, impl, op, reference, roAttr, sequence, xattr,
} from '../../web-idl/core/index';
import type { FetchResponse } from '../../fetch/index';

import type { ErrorInformation } from '../dom/events/index';
import { AnimationFrameController, EventHandlerMap, type EventHandlerCallback, type FrameRequestCallback } from '../scripting/index';
import { MessageEventTargetMixin, MessagePortImpl } from '../communication/index';
import type { BrowletEnvironment } from '../environment/index';
import type { StructuredSerializeOptions } from '../scripting/structured-data/index';

import { WorkerGlobalImpl, type WorkerType } from './worker-global-scope';

/** Inside global of a dedicated worker, communicating through its hidden channel endpoint. */
// https://html.spec.whatwg.org/multipage/workers.html#dedicatedworkerglobalscope
// TODO(HTML §10.2.4): Connect owner monitoring and initial script execution before
// enabling delivery. Configured isolate startup already composes and entangles this global.
export class DedicatedWorkerGlobalImpl extends WorkerGlobalImpl {
  /** Common worker handlers plus the MessageEventTarget mixin's two handlers. */
  static #handlerDefinitions = new Map([
    ...WorkerGlobalImpl.handlerDefinitions, ...MessageEventTargetMixin.handlerDefinitions,
  ]);

  /** Strongly retained, unexposed endpoint; startup supplies its outside peer and enables it. */
  insidePort: MessagePortImpl;
  /** Host delivery to the outside Worker; startup connects this before author execution. */
  reportErrorToOwner: ((errorInfo: ErrorInformation) => void) | null = null;
  /** One handler map for inherited worker events and dedicated-worker messages. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, DedicatedWorkerGlobalImpl.#handlerDefinitions);
  /** Implements the messaging handler attributes without starting the inside port. */
  messageEventTargetMixin = new MessageEventTargetMixin(this.eventHandlers);
  /** Frame requests retained by this worker rather than by its creating Document. */
  animationFrameController = new AnimationFrameController();

  constructor(type: WorkerType, name: string, env: BrowletEnvironment) {
    super(type, name, env);
    // Allocate the hidden endpoint with its owning global. The run-a-worker
    // algorithm still owns entanglement and queue enablement, not this constructor.
    this.insidePort = new MessagePortImpl(env);
    this.insidePort.messageEventTarget = this;
  }

  get onmessage(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessage; }
  set onmessage(callback: EventHandlerCallback | null) { this.messageEventTargetMixin.onmessage = callback; }

  get onmessageerror(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessageerror; }
  set onmessageerror(callback: EventHandlerCallback | null) { this.messageEventTargetMixin.onmessageerror = callback; }

  /** Reuse the dedicated global's hidden endpoint instead of creating a new connection port. */
  override connectPort(outsidePort: MessagePortImpl): MessagePortImpl {
    outsidePort.entangle(this.insidePort);
    return this.insidePort;
  }

  /** Apply the corresponding MessagePort postMessage overload to the hidden inside port. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-dedicatedworkerglobalscope-postmessage
  postMessage(message: unknown, options: StructuredSerializeOptions | object[]): void {
    this.insidePort.postMessage(message, options);
  }

  /** A supported worker has a Document owner, directly or through dedicated-worker owners. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#concept-animationframeprovider-supported
  isAnimationFrameProviderSupported(): boolean {
    const pending: DedicatedWorkerGlobalImpl[] = [this];
    const visited = new Set<DedicatedWorkerGlobalImpl>();
    while (pending.length !== 0) {
      const worker = pending.pop()!;
      if (visited.has(worker)) continue;
      visited.add(worker);
      for (const owner of worker.ownerSet) {
        if (!(owner instanceof WorkerGlobalImpl)) return true;
        if (owner instanceof DedicatedWorkerGlobalImpl) pending.push(owner);
      }
    }
    return false;
  }

  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-animationframeprovider-requestanimationframe
  requestAnimationFrame(callback: FrameRequestCallback): number {
    this.#requireAnimationFrameSupport();
    return this.animationFrameController.request(callback);
  }

  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animationframeprovider-cancelanimationframe
  cancelAnimationFrame(handle: number): void {
    // SPEC_CLASH(animation-frame-worker-cancel): Follow HTML/Firefox's support check; Chromium cancellation does not check support.
    this.#requireAnimationFrameSupport();
    this.animationFrameController.cancel(handle);
  }

  override finishRunning(): void {
    this.animationFrameController.clear();
    super.finishRunning();
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy
  override checkEmbedderPolicy(response: FetchResponse, ownerEnv: BrowletEnvironment): boolean {
    return this.embedderPolicy.checkWorkerInheritance(response, ownerEnv);
  }

  #requireAnimationFrameSupport(): void {
    if (!this.isAnimationFrameProviderSupported()) {
      throw new DOMExceptionImpl('This worker has no Document or supported dedicated-worker owner', DOMExceptionNames.notSupported);
    }
  }
}

/*
 * [Global=(Worker,DedicatedWorker),Exposed=DedicatedWorker]
 * interface DedicatedWorkerGlobalScope : WorkerGlobalScope {
 *   [Replaceable] readonly attribute DOMString name;
 *   undefined postMessage(any message, sequence<object> transfer);
 *   undefined postMessage(any message, optional StructuredSerializeOptions options = {});
 *   undefined close();
 * };
 * DedicatedWorkerGlobalScope includes MessageEventTarget;
 */
export const dedicatedWorkerGlobalScopeIDL = defineInterface<BrowletEnvironment>({
  name: 'DedicatedWorkerGlobalScope',
  inherits: 'WorkerGlobalScope',
  exposed: 'DedicatedWorker',
  ...xattr(['Global', ['Worker', 'DedicatedWorker']]),
  implementation: impl(DedicatedWorkerGlobalImpl),
  members: [
    roAttr('name', idlType.DOMString, xattr('Replaceable')),
    op('postMessage', idlType.undefined, [arg('message', idlType.any), arg('transfer', sequence(idlType.object))]),
    op('postMessage', idlType.undefined,
      [arg('message', idlType.any), arg('options', reference('StructuredSerializeOptions'), { optional: true, default: emptyDictionary })],
    ),
    op('close', idlType.undefined),
  ],
});

export const dedicatedWorkerIncludesMessageEventTargetIDL = defineIncludes({
  interface: 'DedicatedWorkerGlobalScope', mixin: 'MessageEventTarget',
});
