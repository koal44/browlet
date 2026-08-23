import {
  defineDictionary, defineInterface, defineTypedef, emptyDictionary, idlType,
  integer, nullable, reference, sequence,
} from '../../web-idl/definition';

/*
 * typedef double DOMHighResTimeStamp;
 *
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

export const domHighResTimeStampIDL = defineTypedef({
  name: 'DOMHighResTimeStamp',
  type: idlType.double,
});

export const eventInitIDL = defineDictionary({
  members: [
    { default: false, name: 'bubbles', type: idlType.boolean },
    { default: false, name: 'cancelable', type: idlType.boolean },
    { default: false, name: 'composed', type: idlType.boolean },
  ],
  name: 'EventInit',
});

export const eventIDL = defineInterface({
  exposed: '*',
  members: [
    {
      arguments: [
        { name: 'type', type: idlType.DOMString },
        {
          default: emptyDictionary,
          name: 'eventInitDict',
          optional: true,
          type: reference('EventInit'),
        },
      ],
      kind: 'constructor',
    },
    { kind: 'attribute', name: 'type', readonly: true, type: idlType.DOMString },
    {
      kind: 'attribute', name: 'target', readonly: true,
      type: nullable(reference('EventTarget')),
    },
    {
      kind: 'attribute', name: 'srcElement', readonly: true,
      type: nullable(reference('EventTarget')),
    },
    {
      kind: 'attribute', name: 'currentTarget', readonly: true,
      type: nullable(reference('EventTarget')),
    },
    {
      arguments: [], kind: 'operation', name: 'composedPath',
      returns: sequence(reference('EventTarget')),
    },
    {
      kind: 'constant', name: 'NONE', type: idlType.unsignedShort,
      value: integer(0),
    },
    {
      kind: 'constant', name: 'CAPTURING_PHASE', type: idlType.unsignedShort,
      value: integer(1),
    },
    {
      kind: 'constant', name: 'AT_TARGET', type: idlType.unsignedShort,
      value: integer(2),
    },
    {
      kind: 'constant', name: 'BUBBLING_PHASE', type: idlType.unsignedShort,
      value: integer(3),
    },
    {
      kind: 'attribute', name: 'eventPhase', readonly: true,
      type: idlType.unsignedShort,
    },
    {
      arguments: [], kind: 'operation', name: 'stopPropagation',
      returns: idlType.undefined,
    },
    { kind: 'attribute', name: 'cancelBubble', type: idlType.boolean },
    {
      arguments: [], kind: 'operation', name: 'stopImmediatePropagation',
      returns: idlType.undefined,
    },
    { kind: 'attribute', name: 'bubbles', readonly: true, type: idlType.boolean },
    { kind: 'attribute', name: 'cancelable', readonly: true, type: idlType.boolean },
    { kind: 'attribute', name: 'returnValue', type: idlType.boolean },
    {
      arguments: [], kind: 'operation', name: 'preventDefault',
      returns: idlType.undefined,
    },
    {
      kind: 'attribute', name: 'defaultPrevented', readonly: true,
      type: idlType.boolean,
    },
    { kind: 'attribute', name: 'composed', readonly: true, type: idlType.boolean },
    {
      extendedAttributes: [{ kind: 'no-arguments', name: 'LegacyUnforgeable' }],
      kind: 'attribute', name: 'isTrusted', readonly: true,
      type: idlType.boolean,
    },
    {
      kind: 'attribute', name: 'timeStamp', readonly: true,
      type: reference('DOMHighResTimeStamp'),
    },
    {
      arguments: [
        { name: 'type', type: idlType.DOMString },
        { default: false, name: 'bubbles', optional: true, type: idlType.boolean },
        {
          default: false, name: 'cancelable', optional: true,
          type: idlType.boolean,
        },
      ],
      kind: 'operation',
      name: 'initEvent',
      returns: idlType.undefined,
    },
  ],
  name: 'Event',
});

// -- Implementation -----------------------------------------------------

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

  static initializeForBinding(
    event: EventImpl,
    type: string,
    bubbles: boolean,
    cancelable: boolean,
    composed: boolean,
  ): void {
    event.#initialize(type, bubbles, cancelable);
    event.#composed = composed;
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

  static getCurrentTarget(event: EventImpl): EventTarget | null {
    return event.#currentTarget;
  }

  static isComposed(event: EventImpl): boolean {
    return event.#composed;
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
export const customEventInitIDL = defineDictionary({
  inherits: 'EventInit',
  members: [{ default: null, name: 'detail', type: idlType.any }],
  name: 'CustomEventInit',
});

export const customEventIDL = defineInterface({
  exposed: '*',
  inherits: 'Event',
  members: [
    {
      arguments: [
        { name: 'type', type: idlType.DOMString },
        {
          default: emptyDictionary,
          name: 'eventInitDict',
          optional: true,
          type: reference('CustomEventInit'),
        },
      ],
      kind: 'constructor',
    },
    { kind: 'attribute', name: 'detail', readonly: true, type: idlType.any },
    {
      arguments: [
        { name: 'type', type: idlType.DOMString },
        { default: false, name: 'bubbles', optional: true, type: idlType.boolean },
        {
          default: false, name: 'cancelable', optional: true,
          type: idlType.boolean,
        },
        { default: null, name: 'detail', optional: true, type: idlType.any },
      ],
      kind: 'operation',
      name: 'initCustomEvent',
      returns: idlType.undefined,
    },
  ],
  name: 'CustomEvent',
});

// -- Implementation -----------------------------------------------------

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

  // -- Friends ----------------------------------------------------------

  static initializeCustomForBinding<T>(
    event: CustomEventImpl<T>,
    type: string,
    bubbles: boolean,
    cancelable: boolean,
    composed: boolean,
    detail: T,
  ): void {
    EventImpl.initializeForBinding(
      event,
      type,
      bubbles,
      cancelable,
      composed,
    );
    event.#detail = detail;
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
