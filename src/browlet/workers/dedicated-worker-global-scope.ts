import {
  arg, defineIncludes, defineInterface, emptyDictionary, idlType, impl, op, reference, roAttr, sequence, xattr,
} from '../../web-idl/core/index';
import type { FetchResponse } from '../../fetch/index';

import { EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import { EmbedderPolicy, queueCOEPInheritanceViolation } from '../browsing/policy/index';
import { MessageEventTargetMixin, MessagePortImpl } from '../communication/index';
import type { BrowletEnvironment } from '../environment/index';
import type { StructuredSerializeOptions } from '../scripting/structured-data/index';

import { WorkerGlobalImpl, type WorkerType } from './worker-global-scope';

/** Inside global of a dedicated worker, communicating through its hidden channel endpoint. */
// https://html.spec.whatwg.org/multipage/workers.html#dedicatedworkerglobalscope
// TODO(HTML §10.2.4): Startup must use worker environment composition, entangle the inside port,
// and enable delivery after script execution. Independent execution remains pending.
export class DedicatedWorkerGlobalImpl extends WorkerGlobalImpl {
  /** Common worker handlers plus the MessageEventTarget mixin's two handlers. */
  static #handlerDefinitions = new Map([
    ...WorkerGlobalImpl.handlerDefinitions, ...MessageEventTargetMixin.handlerDefinitions,
  ]);

  /** Strongly retained, unexposed endpoint; startup supplies its outside peer and enables it. */
  insidePort: MessagePortImpl;
  /** One handler map for inherited worker events and dedicated-worker messages. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, DedicatedWorkerGlobalImpl.#handlerDefinitions);
  /** Implements the messaging handler attributes without starting the inside port. */
  messageEventTargetMixin = new MessageEventTargetMixin(this.eventHandlers);

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

  /** Apply the corresponding MessagePort postMessage overload to the hidden inside port. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-dedicatedworkerglobalscope-postmessage
  postMessage(message: unknown, options: StructuredSerializeOptions | object[]): void {
    this.insidePort.postMessage(message, options);
  }

  // https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy
  override checkEmbedderPolicy(ownerEnv: BrowletEnvironment, response: FetchResponse): boolean {
    const ownerPolicy = ownerEnv.policyContainer.embedderPolicy;
    const compatible = EmbedderPolicy.isCompatibleWithCrossOriginIsolation(this.embedderPolicy.value);
    if (EmbedderPolicy.isCompatibleWithCrossOriginIsolation(ownerPolicy.reportOnlyValue) && !compatible) {
      queueCOEPInheritanceViolation(response, 'worker initialization', ownerPolicy.reportOnlyReportingEndpoint, 'reporting', ownerEnv);
    }
    if (!EmbedderPolicy.isCompatibleWithCrossOriginIsolation(ownerPolicy.value) || compatible) return true;
    queueCOEPInheritanceViolation(response, 'worker initialization', ownerPolicy.reportingEndpoint, 'enforce', ownerEnv);
    return false;
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
