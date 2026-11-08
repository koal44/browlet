import {
  arg, defineCallbackFunction, defineIncludes, defineInterfaceMixin, idlType, onError, op, reference,
} from '../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../timing/index';

/** Owns the callback map and handle counter for one Document or dedicated-worker global. */
// https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames
export class AnimationFrameController {
  /** Pending requests in registration order, including callbacks in the current batch. */
  #callbacks = new Map<number, FrameRequestCallback>();
  /** The target's monotonically increasing animation frame callback identifier. */
  #identifier = 0;

  get hasPending(): boolean { return this.#callbacks.size !== 0; }

  /** Register a converted callback after the provider has checked support. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-animationframeprovider-requestanimationframe
  request(callback: FrameRequestCallback): number {
    const handle = ++this.#identifier;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  /** Remove a request, including one awaiting its turn in the current batch. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animationframeprovider-cancelanimationframe
  cancel(handle: number): void { this.#callbacks.delete(handle); }

  /** Deliver the current batch; requests added by callbacks wait for a later invocation. */
  // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#run-the-animation-frame-callbacks
  runCallbacks(now: DOMHighResTimeStamp): void {
    const handles = [...this.#callbacks.keys()];
    for (const handle of handles) {
      const callback = this.#callbacks.get(handle);
      if (callback === undefined) continue;
      this.#callbacks.delete(handle);
      // Binding supplies callback invocation, reporting, and its script cleanup/checkpoint.
      callback(now);
    }
  }

  /** Release retained callbacks on permanent target teardown without reusing identifiers. */
  clear(): void { this.#callbacks.clear(); }
}

export type FrameRequestCallback = (this: void, time: DOMHighResTimeStamp) => void;

// callback FrameRequestCallback = undefined (DOMHighResTimeStamp time);
export const frameRequestCallbackIDL = defineCallbackFunction({
  name: 'FrameRequestCallback', returns: idlType.undefined,
  arguments: [arg('time', reference('DOMHighResTimeStamp'))],
});

/*
 * interface mixin AnimationFrameProvider {
 *   unsigned long requestAnimationFrame(FrameRequestCallback callback);
 *   undefined cancelAnimationFrame(unsigned long handle);
 * };
 */
export const animationFrameProviderIDL = defineInterfaceMixin({
  name: 'AnimationFrameProvider',
  members: [
    op('requestAnimationFrame', idlType.unsignedLong, [arg('callback', reference('FrameRequestCallback'), onError('report'))]),
    op('cancelAnimationFrame', idlType.undefined, [arg('handle', idlType.unsignedLong)]),
  ],
});

export const windowIncludesAnimationFrameProviderIDL = defineIncludes({
  interface: 'Window', mixin: 'AnimationFrameProvider',
});

// SPEC_CLASH(animation-frame-worker-exposure): Follow HTML/Chromium/Firefox; the probed WebKit build omits both worker methods.
export const dedicatedWorkerIncludesAnimationFrameProviderIDL = defineIncludes({
  interface: 'DedicatedWorkerGlobalScope', mixin: 'AnimationFrameProvider',
});
