/*
 * [Exposed=*]
 * interface EventTarget {
 *   constructor();
 *
 *   undefined addEventListener(DOMString type, EventListener? callback, optional (AddEventListenerOptions or boolean) options = {});
 *   undefined removeEventListener(DOMString type, EventListener? callback, optional (EventListenerOptions or boolean) options = {});
 *   boolean dispatchEvent(Event event);
 * };
 *
 * callback interface EventListener {
 *   undefined handleEvent(Event event);
 * };
 *
 * dictionary EventListenerOptions {
 *   boolean capture = false;
 * };
 *
 * dictionary AddEventListenerOptions : EventListenerOptions {
 *   boolean passive;
 *   boolean once = false;
 *   AbortSignal signal;
 * };
 */
import { toDOMString } from './event';
import {
  defineInterface, operation,
} from '../../web-idl/binding';

export const eventTargetIDL = defineInterface({
  name: 'EventTarget',
  exposed: '*',
  constructible: true,
  members: {
    addEventListener: operation(),
    removeEventListener: operation(),
    dispatchEvent: operation(),
  },
});

export class EventTargetImpl implements EventTarget
{
  #eventListenerList: EventListenerRecord[] = [];
  readonly #hooks: EventTargetHooks;

  constructor(hooks: EventTargetHooks = {}) {
    this.#hooks = hooks;
  }

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options: AddEventListenerOptions | boolean | null = {},
  ): void {
    const convertedType = toDOMString(type);
    const { capture, passive, once, signal } = flattenMore(options);
    const listener: EventListenerRecord = {
      type: convertedType,
      callback,
      capture,
      passive,
      once,
      signal,
      removed: false,
    };

    this.#addListener(listener);
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options: EventListenerOptions | boolean | null = {},
  ): void {
    const convertedType = toDOMString(type);
    const capture = flatten(options);
    const listener = this.#eventListenerList.find((candidate) =>
      candidate.type === convertedType &&
      candidate.callback === callback &&
      candidate.capture === capture);

    if (listener) this.#removeListener(listener);
  }

  // TODO(DOM section 2.9): Replace this deliberate failure with the dispatch
  // algorithm. Listener invocation cannot be implemented faithfully as a
  // second, target-only dispatch loop.
  dispatchEvent(_event: Event): boolean {
    throw new Error('DOM section 2.9 event dispatch is not implemented');
  }

  static removeAllEventListeners(target: EventTargetImpl): void {
    for (const listener of [...target.#eventListenerList]) {
      target.#removeListener(listener);
    }
  }

  #getDefaultPassiveValue(type: string): boolean {
    return DEFAULT_PASSIVE_EVENT_TYPES.has(type) &&
      (this.#hooks.isDefaultPassiveTarget?.(this) ?? false);
  }

  #addListener(listener: EventListenerRecord): void {
    this.#hooks.addingEventListener?.(this, listener.type);

    if (listener.signal?.aborted || listener.callback === null) return;

    listener.passive ??= this.#getDefaultPassiveValue(listener.type);

    const duplicate = this.#eventListenerList.some((candidate) =>
      candidate.type === listener.type &&
      candidate.callback === listener.callback &&
      candidate.capture === listener.capture);

    if (!duplicate) this.#eventListenerList.push(listener);

    listener.signal?.addEventListener(
      'abort',
      () => this.#removeListener(listener),
      { once: true },
    );
  }

  #removeListener(listener: EventListenerRecord): void {
    this.#hooks.removingEventListener?.(this, listener.type);

    listener.removed = true;

    const index = this.#eventListenerList.indexOf(listener);
    if (index !== -1) this.#eventListenerList.splice(index, 1);
  }
}

export type EventTargetHooks = {
  readonly isDefaultPassiveTarget?: (target: EventTargetImpl) => boolean;
  readonly addingEventListener?: (
    target: EventTargetImpl,
    type: string,
  ) => void;
  readonly removingEventListener?: (
    target: EventTargetImpl,
    type: string,
  ) => void;
};

type EventListenerRecord = {
  readonly type: string;
  readonly callback: EventListenerOrEventListenerObject | null;
  readonly capture: boolean;
  passive: boolean | null;
  readonly once: boolean;
  readonly signal: AbortSignal | null;
  removed: boolean;
};

function flatten(
  options: EventListenerOptions | boolean | null,
): boolean {
  return typeof options === 'boolean'
    ? options
    : Boolean(options?.capture);
}

function flattenMore(
  options: AddEventListenerOptions | boolean | null,
): FlattenedEventListenerOptions {
  const capture = flatten(options);
  let passive: boolean | null = null;
  let once = false;
  let signal: AbortSignal | null = null;

  if (typeof options === 'object' && options !== null) {
    once = Boolean(options.once);
    const passiveValue = options.passive;
    const signalValue = options.signal;

    if (passiveValue !== undefined) passive = Boolean(passiveValue);
    if (signalValue !== undefined) signal = signalValue;
  }

  return { capture, passive, once, signal };
}

type FlattenedEventListenerOptions = {
  readonly capture: boolean;
  readonly passive: boolean | null;
  readonly once: boolean;
  readonly signal: AbortSignal | null;
};

const DEFAULT_PASSIVE_EVENT_TYPES = new Set([
  'touchstart',
  'touchmove',
  'wheel',
  'mousewheel',
]);
