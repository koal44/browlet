import {
  arg, defineInterfaceMixin, definePartialInterfaceMixin, defineTypedef,
  idlType, integer, op, roAttr, reference, union, xattr,
} from '../../web-idl/declaration/index';
import { callback } from '../../web-idl/index';
import { PerformanceImpl } from '../performance/performance';
import type { EnvironmentTiming } from '../performance/high-resolution-time';
import type { DocumentImpl } from '../dom/nodes/document';
import type { EventLoop } from './event-loop';
import { GlobalTimers, type TimerAction } from './timers';

/*
 * typedef (DOMString or Function or TrustedScript) TimerHandler;
 *
 * interface mixin WindowOrWorkerGlobalScope {
 *   [Replaceable] readonly attribute USVString origin;
 *   readonly attribute boolean isSecureContext;
 *   readonly attribute boolean crossOriginIsolated;
 *
 *   undefined reportError(any e);
 *
 *   DOMString btoa(DOMString data);
 *   ByteString atob(DOMString data);
 *
 *   long setTimeout(TimerHandler handler, optional long timeout = 0,
 *     any... arguments);
 *   undefined clearTimeout(optional long id = 0);
 *   long setInterval(TimerHandler handler, optional long timeout = 0,
 *     any... arguments);
 *   undefined clearInterval(optional long id = 0);
 *
 *   undefined queueMicrotask(VoidFunction callback);
 *
 *   Promise<ImageBitmap> createImageBitmap(ImageBitmapSource image,
 *     optional ImageBitmapOptions options = {});
 *   Promise<ImageBitmap> createImageBitmap(ImageBitmapSource image,
 *     long sx, long sy, long sw, long sh,
 *     optional ImageBitmapOptions options = {});
 *
 *   any structuredClone(any value,
 *     optional StructuredSerializeOptions options = {});
 * };
 *
 * High Resolution Time:
 *
 * partial interface mixin WindowOrWorkerGlobalScope {
 *   [Replaceable] readonly attribute Performance performance;
 * };
 */
export class WindowOrWorkerGlobalScopeMixin {
  readonly #eventLoop: EventLoop;
  readonly #performance: PerformanceImpl;
  readonly #timers: GlobalTimers;

  constructor(initialization: WindowOrWorkerGlobalScopeInitialization) {
    this.#eventLoop = initialization.eventLoop;
    this.#performance = new PerformanceImpl(initialization.timing);
    this.#timers = new GlobalTimers({
      eventLoop: initialization.eventLoop,
      global: initialization.global,
      time: initialization.timing,
    });
  }

  get performance(): Performance {
    return this.#performance;
  }

  setTimeout(
    action: TimerAction,
    timeout: number,
    argumentsList: readonly unknown[],
  ): number {
    return this.#timers.setTimeout(action, timeout, argumentsList);
  }

  setInterval(
    action: TimerAction,
    timeout: number,
    argumentsList: readonly unknown[],
  ): number {
    return this.#timers.setInterval(action, timeout, argumentsList);
  }

  clearTimer(id: number): void {
    this.#timers.clearTimer(id);
  }

  queueMicrotask(callback: VoidFunction): void {
    this.#eventLoop.queueMicrotask(() => { callback(); });
  }

  // -- Friends ----------------------------------------------------------

  static setAssociatedDocument(
    mixin: WindowOrWorkerGlobalScopeMixin,
    document: DocumentImpl,
  ): void {
    mixin.#timers.setAssociatedDocument(document);
  }
}

export type WindowOrWorkerGlobalScopeInitialization = {
  readonly eventLoop: EventLoop;
  readonly global: object;
  readonly timing: EnvironmentTiming;
};

// -- Web IDL ------------------------------------------------------------

/*
 * TrustedScript is the third arm of this typedef. Add it when Browlet owns
 * the Trusted Types interface and the timer string-compilation branch.
 */
export const timerHandlerIDL = defineTypedef({
  name: 'TimerHandler',
  type: union(idlType.DOMString, reference('Function')),
});

export const windowOrWorkerGlobalScopeIDL = defineInterfaceMixin({
  name: 'WindowOrWorkerGlobalScope',
  members: [
    op('setTimeout', idlType.long, [
      arg('handler', reference('TimerHandler'), callback('report')),
      arg('timeout', idlType.long, { default: integer(0), optional: true }),
      arg('arguments', idlType.any, { variadic: true }),
    ]),
    op('clearTimeout', idlType.undefined, [
      arg('id', idlType.long, { default: integer(0), optional: true }),
    ]),
    op('setInterval', idlType.long, [
      arg('handler', reference('TimerHandler'), callback('report')),
      arg('timeout', idlType.long, { default: integer(0), optional: true }),
      arg('arguments', idlType.any, { variadic: true }),
    ]),
    op('clearInterval', idlType.undefined, [
      arg('id', idlType.long, { default: integer(0), optional: true }),
    ]),
    op(
      'queueMicrotask',
      idlType.undefined,
      [arg('callback', reference('VoidFunction'), callback('report'))],
    ),
  ],
});

export const highResolutionTimeWindowOrWorkerGlobalScopeIDL =
  definePartialInterfaceMixin({
    name: windowOrWorkerGlobalScopeIDL.name,
    members: [roAttr(
      'performance',
      reference('Performance'),
      xattr('Replaceable'),
    )],
  });
