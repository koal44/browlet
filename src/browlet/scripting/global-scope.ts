import {
  arg, defineInterfaceMixin, definePartialInterfaceMixin, idlType, op,
  readonlyAttr, reference, xattr,
} from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import { PerformanceImpl } from '../performance/performance';
import type { EnvironmentTiming } from '../performance/high-resolution-time';

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

  constructor(timing: EnvironmentTiming) {
    this.#performance = new PerformanceImpl(timing);
  }

  get performance(): Performance {
    return this.#performance;
  }

  // -- Friends ----------------------------------------------------------

  static getPerformanceImplementation(
    mixin: WindowOrWorkerGlobalScopeMixin,
  ): PerformanceImpl {
    return mixin.#performance;
  }
}

// -- Web IDL ------------------------------------------------------------

export const windowOrWorkerGlobalScopeIDL = defineInterfaceMixin({
  members: [op(
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
  )],
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
