import { InternalError } from '../../infra/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineIncludes, defineInterface, dictMember,
  DOMExceptionImpl, emptyDictionary, idlType, impl, op, reference, sequence, union,
} from '../../web-idl/core/index';
import type { RequestCredentials } from '../../fetch/index';

import { ErrorEventImpl, EventTargetImpl, type ErrorInformation } from '../dom/events/index';
import { EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import type { TrustedScriptURLImpl } from '../browsing/policy/trusted-types/index';
import { MessageEventTargetMixin, MessagePortImpl } from '../communication/index';
import type { BrowletEnvironment } from '../environment/index';
import type { StructuredSerializeOptions } from '../scripting/structured-data/index';
import type { WorkerThread } from '../integration/workers/index';

import { AbstractWorkerMixin } from './abstract-worker';
import type { WorkerType } from './worker-global-scope';

/** Outside dedicated-worker object; its hidden port owns message delivery to this target. */
// https://html.spec.whatwg.org/multipage/workers.html#dedicated-workers-and-the-worker-interface
export class WorkerImpl extends EventTargetImpl {
  /** Outside error handlers and messages share the same listener registrations. */
  static #handlerDefinitions = new Map([
    ...AbstractWorkerMixin.handlerDefinitions, ...MessageEventTargetMixin.handlerDefinitions,
  ]);

  declare env: BrowletEnvironment;
  /** Strongly retained endpoint, unexposed and disabled until initial script execution finishes. */
  outsidePort: MessagePortImpl;
  /** Creating-isolate execution owner, installed by startup and released after native exit. */
  thread: WorkerThread | null = null;
  /** The outside onerror handler receives one Event, unlike WorkerGlobalScope.onerror. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, WorkerImpl.#handlerDefinitions);
  /** Error-handler behavior shared with other outside worker objects. */
  abstractWorkerMixin = new AbstractWorkerMixin(this.eventHandlers);
  /** Handler assignment must not enable the hidden port's queue. */
  messageEventTargetMixin = new MessageEventTargetMixin(this.eventHandlers);

  constructor(env: BrowletEnvironment) {
    super(env);
    // Allocate with the implementation, as for the dedicated global's inside port.
    // This has no connection or enabled queue until the processing model supplies them.
    this.outsidePort = new MessagePortImpl(env);
    this.outsidePort.messageEventTarget = this;
  }

  get onerror(): EventHandlerCallback | null { return this.abstractWorkerMixin.onerror; }
  set onerror(callback: EventHandlerCallback | null) { this.abstractWorkerMixin.onerror = callback; }

  get onmessage(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessage; }
  set onmessage(callback: EventHandlerCallback | null) { this.messageEventTargetMixin.onmessage = callback; }

  get onmessageerror(): EventHandlerCallback | null { return this.messageEventTargetMixin.onmessageerror; }
  set onmessageerror(callback: EventHandlerCallback | null) { this.messageEventTargetMixin.onmessageerror = callback; }

  /** Apply constructor checks after Web IDL conversion, before attempting worker startup. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-worker
  initialize(scriptURL: TrustedScriptURLImpl | string, _options: WorkerOptions): void {
    const compliantScriptURL = this.env.getWindowOrWorkerGlobalScopeMixin().trustedTypes.getCompliantString(
      'TrustedScriptURL', scriptURL, 'Worker constructor', 'script',
    );
    const workerURL = this.env.encodingParseURL(compliantScriptURL);
    if (workerURL === null) throw new DOMExceptionImpl('Invalid Worker URL', 'SyntaxError');
    // TODO(HTML §§10.2.4, 10.2.6.3): Run a worker in parallel with workerURL, this.env,
    // this.outsidePort, and options. The production isolate now composes its environment
    // and handles network/policy rejection, but still needs shared UserAgent services,
    // script creation/execution, and owner monitoring. Connect the hidden message channel
    // before execution. Supply this Worker to
    // WorkerThread before returning from construction so immediate termination can reach it.
    throw new InternalError('Dedicated worker startup is not implemented');
  }

  /** Abort the associated worker through its outside execution owner. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate
  terminate(): void {
    // Native interruption and outside-port cleanup belong to the execution owner.
    // Its host completion stays internal; the public operation returns undefined.
    void this.thread?.terminate();
  }

  /** Apply the corresponding MessagePort overload to the hidden outside port. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-worker-postmessage
  postMessage(message: unknown, options: StructuredSerializeOptions | object[]): void {
    this.outsidePort.postMessage(message, options);
  }

  /** Queue an inside error on this Worker, then report uncanceled diagnostics on its creator global. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception
  reportError(errorInfo: ErrorInformation): void {
    const diagnostics = { ...errorInfo, error: null };
    this.env.queueTask('dom-manipulation', () => {
      const notHandled = this.fireEvent('error', ErrorEventImpl, (event) => {
        event.initialize({ ...diagnostics, cancelable: true });
      });
      if (notHandled) this.env.reportErrorInformation(diagnostics);
    });
    // TODO(HTML §8.1.4.6): A terminated parent cannot run this task. Keep a route
    // to surviving owners outside that parent's isolate, suppressing dead-parent
    // handlers while continuing propagation. The current host channel is parent-local.
  }
}

/** Converted constructor options; credentials affect module workers only. */
export interface WorkerOptions {
  name: string;
  type: WorkerType;
  credentials: RequestCredentials;
}

/*
 * [Exposed=(Window,DedicatedWorker,SharedWorker)]
 * interface Worker : EventTarget {
 *   constructor((TrustedScriptURL or USVString) scriptURL, optional WorkerOptions options = {});
 *   undefined terminate();
 *   undefined postMessage(any message, sequence<object> transfer);
 *   undefined postMessage(any message, optional StructuredSerializeOptions options = {});
 * };
 */
export const workerIDL = defineInterface<BrowletEnvironment>({
  name: 'Worker',
  inherits: 'EventTarget',
  exposed: ['Window', 'DedicatedWorker', 'SharedWorker'],
  implementation: impl(WorkerImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    ctor(
      [
        arg('scriptURL', union(reference('TrustedScriptURL'), idlType.USVString)),
        arg('options', reference('WorkerOptions'), { optional: true, default: emptyDictionary }),
      ],
      {
        initialize(_env, scriptURL, options) {
          // Binding supplies the preallocated implementation and converted IDL arguments.
          const worker = this as WorkerImpl;
          worker.initialize(scriptURL as TrustedScriptURLImpl | string, options as WorkerOptions);
        },
      },
    ),
    op('terminate', idlType.undefined),
    op('postMessage', idlType.undefined, [arg('message', idlType.any), arg('transfer', sequence(idlType.object))]),
    op('postMessage', idlType.undefined,
      [arg('message', idlType.any), arg('options', reference('StructuredSerializeOptions'), { optional: true, default: emptyDictionary })],
    ),
  ],
});

/*
 * dictionary WorkerOptions {
 *   DOMString name = "";
 *   WorkerType type = "classic";
 *   RequestCredentials credentials = "same-origin"; // credentials is only used if type is "module"
 * };
 */
export const workerOptionsIDL = defineDictionary({
  name: 'WorkerOptions',
  members: [
    dictMember('name', idlType.DOMString, { default: '' }),
    dictMember('type', reference('WorkerType'), { default: 'classic' }),
    dictMember('credentials', reference('RequestCredentials'), { default: 'same-origin' }),
  ],
});

/*
 * enum WorkerType { "classic", "module" };
 */
export const workerTypeIDL = defineEnumeration({ name: 'WorkerType', values: ['classic', 'module'] });

/*
 * Worker includes AbstractWorker;
 * Worker includes MessageEventTarget;
 */
export const workerIncludesAbstractWorkerIDL = defineIncludes({ interface: 'Worker', mixin: 'AbstractWorker' });
export const workerIncludesMessageEventTargetIDL = defineIncludes({ interface: 'Worker', mixin: 'MessageEventTarget' });
