import {
  arg, defineInterfaceMixin, definePartialInterfaceMixin, defineTypedef,
  idlType, integer, op, readonlyAttr, reference, union, xattr,
} from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import type { InterfaceBindingContext } from '../../web-idl/projection';
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
  readonly #performance: PerformanceImpl;
  readonly #timerThisValue: object;
  readonly #timers: GlobalTimers;

  constructor(initialization: WindowOrWorkerGlobalScopeInitialization) {
    this.#performance = new PerformanceImpl(initialization.timing);
    this.#timerThisValue = initialization.timerThisValue;
    this.#timers = new GlobalTimers({
      eventLoop: initialization.eventLoop,
      global: initialization.global,
      time: initialization.timing,
    });
    mixinsByGlobal.set(initialization.global, this);
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

  get timerThisValue(): object {
    return this.#timerThisValue;
  }

  // -- Friends ----------------------------------------------------------

  static getPerformanceImplementation(
    mixin: WindowOrWorkerGlobalScopeMixin,
  ): PerformanceImpl {
    return mixin.#performance;
  }

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
  readonly timerThisValue: object;
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
  members: [
    op('setTimeout', idlType.long, [
      arg('handler', reference('TimerHandler')),
      arg('timeout', idlType.long, { default: integer(0), optional: true }),
      arg('arguments', idlType.any, { variadic: true }),
    ], bind({
      invoke(context, handler, timeout, ...argumentsList) {
        const mixin = requireMixin(context.realm.global);
        return mixin.setTimeout(
          createTimerAction(context, handler, mixin.timerThisValue),
          timeout as number,
          argumentsList,
        );
      },
    })),
    op('clearTimeout', idlType.undefined, [
      arg('id', idlType.long, { default: integer(0), optional: true }),
    ], bind({
      invoke(context, id) {
        requireMixin(context.realm.global).clearTimer(id as number);
      },
    })),
    op('setInterval', idlType.long, [
      arg('handler', reference('TimerHandler')),
      arg('timeout', idlType.long, { default: integer(0), optional: true }),
      arg('arguments', idlType.any, { variadic: true }),
    ], bind({
      invoke(context, handler, timeout, ...argumentsList) {
        const mixin = requireMixin(context.realm.global);
        return mixin.setInterval(
          createTimerAction(context, handler, mixin.timerThisValue),
          timeout as number,
          argumentsList,
        );
      },
    })),
    op('clearInterval', idlType.undefined, [
      arg('id', idlType.long, { default: integer(0), optional: true }),
    ], bind({
      invoke(context, id) {
        requireMixin(context.realm.global).clearTimer(id as number);
      },
    })),
    op(
      'queueMicrotask',
      idlType.undefined,
      [arg('callback', reference('VoidFunction'))],
      bind({
        invoke(context, callback) {
          context.realm.queueMicrotask(
            () => context.callbacks.invokeFunction(callback, [], 'report'),
          );
        },
      }),
    ),
  ],
  name: 'WindowOrWorkerGlobalScope',
});

export const highResolutionTimeWindowOrWorkerGlobalScopeIDL =
  definePartialInterfaceMixin({
    members: [readonlyAttr(
      'performance',
      reference('Performance'),
      xattr('Replaceable'),
    )],
    name: windowOrWorkerGlobalScopeIDL.name,
  });

const mixinsByGlobal = new WeakMap<
  object,
  WindowOrWorkerGlobalScopeMixin
>();

function requireMixin(global: object): WindowOrWorkerGlobalScopeMixin {
  const mixin = mixinsByGlobal.get(global);
  if (mixin === undefined) {
    throw new Error('A global object must have a WindowOrWorkerGlobalScope mixin');
  }
  return mixin;
}

function createTimerAction(
  context: InterfaceBindingContext,
  handler: unknown,
  thisValue: object,
): TimerAction {
  if (typeof handler === 'string') {
    return () => {
      throw new Error(
        'String timer handlers await Trusted Types, CSP, and classic scripts',
      );
    };
  }

  return (argumentsList) => {
    context.callbacks.invokeFunction(
      handler,
      argumentsList,
      'report',
      thisValue,
    );
  };
}
