import {
  attribute, constant, defineInterface, operation, readonlyAttribute,
} from '../../web-idl/binding';

/*
 * [Exposed=*]
 * interface Event {
 *   constructor(DOMString type, optional EventInit eventInitDict = {});
 *
 *   readonly attribute DOMString type;
 *   readonly attribute EventTarget? target;
 *   readonly attribute EventTarget? srcElement; // legacy
 *   readonly attribute EventTarget? currentTarget;
 *   sequence<EventTarget> composedPath();
 *
 *   const unsigned short NONE = 0;
 *   const unsigned short CAPTURING_PHASE = 1;
 *   const unsigned short AT_TARGET = 2;
 *   const unsigned short BUBBLING_PHASE = 3;
 *   readonly attribute unsigned short eventPhase;
 *
 *   undefined stopPropagation();
 *            attribute boolean cancelBubble; // legacy alias of .stopPropagation()
 *   undefined stopImmediatePropagation();
 *
 *   readonly attribute boolean bubbles;
 *   readonly attribute boolean cancelable;
 *            attribute boolean returnValue;  // legacy
 *   undefined preventDefault();
 *   readonly attribute boolean defaultPrevented;
 *   readonly attribute boolean composed;
 *
 *   [LegacyUnforgeable] readonly attribute boolean isTrusted;
 *   readonly attribute DOMHighResTimeStamp timeStamp;
 *
 *   undefined initEvent(DOMString type, optional boolean bubbles = false, optional boolean cancelable = false); // legacy
 * };
 *
 * dictionary EventInit {
 *   boolean bubbles = false;
 *   boolean cancelable = false;
 *   boolean composed = false;
 * };
 */

export const eventIDL = defineInterface({
  name: 'Event',
  exposed: '*',
  constructible: true,
  members: {
    type: readonlyAttribute(),
    target: readonlyAttribute(),
    srcElement: readonlyAttribute(),
    currentTarget: readonlyAttribute(),
    composedPath: operation(),
    NONE: constant(),
    CAPTURING_PHASE: constant(),
    AT_TARGET: constant(),
    BUBBLING_PHASE: constant(),
    eventPhase: readonlyAttribute(),
    stopPropagation: operation(),
    cancelBubble: attribute(),
    stopImmediatePropagation: operation(),
    bubbles: readonlyAttribute(),
    cancelable: readonlyAttribute(),
    returnValue: attribute(),
    preventDefault: operation(),
    defaultPrevented: readonlyAttribute(),
    composed: readonlyAttribute(),
    isTrusted: readonlyAttribute(),
    timeStamp: readonlyAttribute(),
    initEvent: operation(),
  },
});

export class EventImpl implements Event
{
  #type = '';
  #target: EventTarget | null = null;
  #relatedTarget: EventTarget | null = null;
  #touchTargetList: (EventTarget | null)[] = [];
  #currentTarget: EventTarget | null = null;
  #path: EventPathItem[] = [];
  #eventPhase: 0 | 1 | 2 | 3 = EventImpl.NONE;

  #stopPropagation = false;
  #stopImmediatePropagation = false;
  #canceled = false;
  #inPassiveListener = false;
  #bubbles = false;
  #cancelable = false;
  #composed = false;

  #initialized = false;
  #dispatching = false;
  #isTrusted = false;
  #timeStamp: DOMHighResTimeStamp;

  constructor(
    type: string,
    eventInitDict: EventInit | null = {},
    timeStamp = performance.now(),
  ) {
    const convertedType = toDOMString(type);
    const init = eventInitDict ?? {};
    const bubbles = Boolean(init.bubbles);
    const cancelable = Boolean(init.cancelable);
    const composed = Boolean(init.composed);

    this.#timeStamp = timeStamp;
    this.#initialize(convertedType, bubbles, cancelable);
    this.#composed = composed;
  }

  get type(): string {
    return this.#type;
  }

  get target(): EventTarget | null {
    return this.#target;
  }

  /** @deprecated */
  get srcElement(): EventTarget | null {
    return this.#target;
  }

  get currentTarget(): EventTarget | null {
    return this.#currentTarget;
  }

  composedPath(): EventTarget[] {
    const composedPath: EventTarget[] = [];
    const path = this.#path;
    if (path.length === 0) return composedPath;

    const currentTarget = this.#currentTarget;
    if (currentTarget === null) {
      throw new Error('An event with a path must have a current target');
    }

    composedPath.push(currentTarget);

    let currentTargetIndex = 0;
    let currentTargetHiddenSubtreeLevel = 0;
    let index = path.length - 1;
    let foundCurrentTarget = false;

    while (index >= 0) {
      const item = path[index]!;

      if (item.rootOfClosedTree) currentTargetHiddenSubtreeLevel++;
      if (item.invocationTarget === currentTarget) {
        currentTargetIndex = index;
        foundCurrentTarget = true;
        break;
      }
      if (item.slotInClosedTree) currentTargetHiddenSubtreeLevel--;

      index--;
    }

    if (!foundCurrentTarget) {
      throw new Error('An event path must contain its current target');
    }

    let currentHiddenLevel = currentTargetHiddenSubtreeLevel;
    let maxHiddenLevel = currentTargetHiddenSubtreeLevel;
    index = currentTargetIndex - 1;

    while (index >= 0) {
      const item = path[index]!;

      if (item.rootOfClosedTree) currentHiddenLevel++;
      if (currentHiddenLevel <= maxHiddenLevel) {
        composedPath.unshift(item.invocationTarget);
      }
      if (item.slotInClosedTree) {
        currentHiddenLevel--;
        if (currentHiddenLevel < maxHiddenLevel) {
          maxHiddenLevel = currentHiddenLevel;
        }
      }

      index--;
    }

    currentHiddenLevel = currentTargetHiddenSubtreeLevel;
    maxHiddenLevel = currentTargetHiddenSubtreeLevel;
    index = currentTargetIndex + 1;

    while (index < path.length) {
      const item = path[index]!;

      if (item.slotInClosedTree) currentHiddenLevel++;
      if (currentHiddenLevel <= maxHiddenLevel) {
        composedPath.push(item.invocationTarget);
      }
      if (item.rootOfClosedTree) {
        currentHiddenLevel--;
        if (currentHiddenLevel < maxHiddenLevel) {
          maxHiddenLevel = currentHiddenLevel;
        }
      }

      index++;
    }

    return composedPath;
  }

  get NONE(): 0 { return EventImpl.NONE; }
  get CAPTURING_PHASE(): 1 { return EventImpl.CAPTURING_PHASE; }
  get AT_TARGET(): 2 { return EventImpl.AT_TARGET; }
  get BUBBLING_PHASE(): 3 { return EventImpl.BUBBLING_PHASE; }

  get eventPhase(): number {
    return this.#eventPhase;
  }

  stopPropagation(): void {
    this.#stopPropagation = true;
  }

  /** @deprecated */
  get cancelBubble(): boolean {
    return this.#stopPropagation;
  }

  set cancelBubble(value: boolean) {
    if (value) this.#stopPropagation = true;
  }

  stopImmediatePropagation(): void {
    this.#stopPropagation = true;
    this.#stopImmediatePropagation = true;
  }

  get bubbles(): boolean {
    return this.#bubbles;
  }

  get cancelable(): boolean {
    return this.#cancelable;
  }

  /** @deprecated */
  get returnValue(): boolean {
    return !this.#canceled;
  }

  set returnValue(value: boolean) {
    if (!value) this.#setCanceled();
  }

  preventDefault(): void {
    this.#setCanceled();
  }

  get defaultPrevented(): boolean {
    return this.#canceled;
  }

  get composed(): boolean {
    return this.#composed;
  }

  // TODO(Web IDL [LegacyUnforgeable]): Install this as a non-configurable own
  // property when Event is bound into a realm.
  get isTrusted(): boolean {
    return this.#isTrusted;
  }

  get timeStamp(): DOMHighResTimeStamp {
    return this.#timeStamp;
  }

  /** @deprecated */
  initEvent(type: string, bubbles = false, cancelable = false): void {
    const convertedType = toDOMString(type);
    const convertedBubbles = Boolean(bubbles);
    const convertedCancelable = Boolean(cancelable);

    if (this.#dispatching) return;

    this.#initialize(convertedType, convertedBubbles, convertedCancelable);
  }

  static get NONE(): 0 { return 0; }
  static get CAPTURING_PHASE(): 1 { return 1; }
  static get AT_TARGET(): 2 { return 2; }
  static get BUBBLING_PHASE(): 3 { return 3; }

  // -- Friends ----------------------------------------------------------

  static isDispatching(event: EventImpl): boolean {
    return event.#dispatching;
  }

  static is(value: unknown): value is EventImpl {
    return typeof value === 'object' && value !== null && #initialized in value;
  }

  static isInitialized(event: EventImpl): boolean {
    return event.#initialized;
  }

  static setTrusted(event: EventImpl, trusted: boolean): void {
    event.#isTrusted = trusted;
  }

  static beginDispatch(event: EventImpl): void {
    event.#dispatching = true;
  }

  static getRelatedTarget(event: EventImpl): EventTarget | null {
    return event.#relatedTarget;
  }

  static getTouchTargetList(event: EventImpl): readonly (EventTarget | null)[] {
    return event.#touchTargetList;
  }

  static getPath(event: EventImpl): readonly EventPathItem[] {
    return event.#path;
  }

  static appendToPath(event: EventImpl, item: EventPathItem): void {
    event.#path.push(item);
  }

  static setTarget(event: EventImpl, target: EventTarget | null): void {
    event.#target = target;
  }

  static setRelatedTarget(
    event: EventImpl,
    relatedTarget: EventTarget | null,
  ): void {
    event.#relatedTarget = relatedTarget;
  }

  static setTouchTargetList(
    event: EventImpl,
    targets: readonly (EventTarget | null)[],
  ): void {
    event.#touchTargetList = [...targets];
  }

  static setCurrentTarget(
    event: EventImpl,
    target: EventTarget | null,
  ): void {
    event.#currentTarget = target;
  }

  static setPhase(event: EventImpl, phase: 0 | 1 | 2 | 3): void {
    event.#eventPhase = phase;
  }

  static propagationStopped(event: EventImpl): boolean {
    return event.#stopPropagation;
  }

  static immediatePropagationStopped(event: EventImpl): boolean {
    return event.#stopImmediatePropagation;
  }

  static setInPassiveListener(event: EventImpl, passive: boolean): void {
    event.#inPassiveListener = passive;
  }

  static isCanceled(event: EventImpl): boolean {
    return event.#canceled;
  }

  static setType(event: EventImpl, type: string): void {
    event.#type = type;
  }

  static finishDispatch(event: EventImpl, clearTargets: boolean): void {
    event.#eventPhase = EventImpl.NONE;
    event.#currentTarget = null;
    event.#path = [];
    event.#dispatching = false;
    event.#stopPropagation = false;
    event.#stopImmediatePropagation = false;

    if (clearTargets) {
      event.#target = null;
      event.#relatedTarget = null;
      event.#touchTargetList = [];
    }
  }

  static getFirstPathInvocationTarget(
    event: EventImpl,
  ): EventTarget | null {
    return event.#path[0]?.invocationTarget ?? null;
  }

  // -- Private ----------------------------------------------------------

  #initialize(
    type: string,
    bubbles: boolean,
    cancelable: boolean,
  ): void {
    this.#initialized = true;
    this.#stopPropagation = false;
    this.#stopImmediatePropagation = false;
    this.#canceled = false;
    this.#isTrusted = false;
    this.#target = null;
    this.#type = type;
    this.#bubbles = bubbles;
    this.#cancelable = cancelable;
  }

  #setCanceled(): void {
    if (this.#cancelable && !this.#inPassiveListener) {
      this.#canceled = true;
    }
  }
}

/*
 * [Exposed=*]
 * interface CustomEvent : Event {
 *   constructor(DOMString type, optional CustomEventInit eventInitDict = {});
 *
 *   readonly attribute any detail;
 *
 *   undefined initCustomEvent(DOMString type, optional boolean bubbles = false, optional boolean cancelable = false, optional any detail = null); // legacy
 * };
 *
 * dictionary CustomEventInit : EventInit {
 *   any detail = null;
 * };
 */
export const customEventIDL = defineInterface({
  name: 'CustomEvent',
  parent: eventIDL,
  exposed: '*',
  constructible: true,
  members: {
    detail: readonlyAttribute(),
    initCustomEvent: operation(),
  },
});

export class CustomEventImpl<T = unknown>
  extends EventImpl
  implements CustomEvent<T>
{
  #detail: T;

  constructor(
    type: string,
    eventInitDict: CustomEventInit<T> | null = {},
    timeStamp = performance.now(),
  ) {
    const init = eventInitDict ?? {};

    super(type, init, timeStamp);
    this.#detail = (init.detail === undefined ? null : init.detail) as T;
  }

  get detail(): T {
    return this.#detail;
  }

  /** @deprecated */
  initCustomEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    detail: T = null as T,
  ): void {
    const convertedType = toDOMString(type);
    const convertedBubbles = Boolean(bubbles);
    const convertedCancelable = Boolean(cancelable);

    if (EventImpl.isDispatching(this)) return;

    this.initEvent(convertedType, convertedBubbles, convertedCancelable);
    this.#detail = detail;
  }
}

export type EventPathItem = {
  readonly invocationTarget: EventTarget;
  readonly invocationTargetInShadowTree: boolean;
  readonly shadowAdjustedTarget: EventTarget | null;
  readonly relatedTarget: EventTarget | null;
  readonly touchTargetList: readonly (EventTarget | null)[];
  readonly rootOfClosedTree: boolean;
  readonly slotInClosedTree: boolean;
};

export function toDOMString(value: unknown): string {
  if (typeof value === 'symbol') {
    throw new TypeError('A Symbol value cannot be converted to a DOMString');
  }

  return String(value);
}
