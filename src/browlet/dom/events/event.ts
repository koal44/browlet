import {
  arg, attr, constant, ctor, defineDictionary, defineInterface, defineTypedef,
  dictMember, emptyDictionary, idlType, integer, nullable, op, readonlyAttr,
  reference, sequence, xattr,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';

/*
 * typedef double DOMHighResTimeStamp;
 */

export const domHighResTimeStampIDL = defineTypedef({
  name: 'DOMHighResTimeStamp',
  type: idlType.double,
});

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

// -- Web IDL ------------------------------------------------------------

export const eventIDL = defineInterface({
  binding: bind(EventImpl, {
    create(context, newTarget) {
      if (!newTarget) throw new Error('Event construction requires newTarget');
      return Reflect.construct(
        EventImpl,
        [
          '',
          {},
          (context.realm as typeof context.realm & EventRealm)
            .eventTimeStamp(),
        ],
        newTarget as NewTarget,
      );
    },
  }),
  exposed: '*',
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('EventInit'), {
        default: emptyDictionary,
        optional: true,
      }),
    ], bind({
      invoke(_context, type, init) {
        const dictionary = init as Record<PropertyKey, unknown>;
        EventImpl.initializeForBinding(
          this as EventImpl,
          type as string,
          Boolean(dictionary.bubbles),
          Boolean(dictionary.cancelable),
          Boolean(dictionary.composed),
        );
      },
    })),
    readonlyAttr('type', idlType.DOMString),
    readonlyAttr('target', nullable(reference('EventTarget'))),
    readonlyAttr('srcElement', nullable(reference('EventTarget'))),
    readonlyAttr('currentTarget', nullable(reference('EventTarget'))),
    op('composedPath', sequence(reference('EventTarget'))),
    constant('NONE', idlType.unsignedShort, integer(0)),
    constant('CAPTURING_PHASE', idlType.unsignedShort, integer(1)),
    constant('AT_TARGET', idlType.unsignedShort, integer(2)),
    constant('BUBBLING_PHASE', idlType.unsignedShort, integer(3)),
    readonlyAttr('eventPhase', idlType.unsignedShort),
    op('stopPropagation', idlType.undefined),
    attr('cancelBubble', idlType.boolean),
    op('stopImmediatePropagation', idlType.undefined),
    readonlyAttr('bubbles', idlType.boolean),
    readonlyAttr('cancelable', idlType.boolean),
    attr('returnValue', idlType.boolean),
    op('preventDefault', idlType.undefined),
    readonlyAttr('defaultPrevented', idlType.boolean),
    readonlyAttr('composed', idlType.boolean),
    readonlyAttr('isTrusted', idlType.boolean, xattr('LegacyUnforgeable')),
    readonlyAttr('timeStamp', reference('DOMHighResTimeStamp')),
    op('initEvent', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('bubbles', idlType.boolean, { default: false, optional: true }),
      arg('cancelable', idlType.boolean, {
        default: false,
        optional: true,
      }),
    ]),
  ],
  name: 'Event',
});

export const eventInitIDL = defineDictionary({
  members: [
    dictMember('bubbles', idlType.boolean, { default: false }),
    dictMember('cancelable', idlType.boolean, { default: false }),
    dictMember('composed', idlType.boolean, { default: false }),
  ],
  name: 'EventInit',
});

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

// -- Web IDL ------------------------------------------------------------

export const customEventIDL = defineInterface({
  binding: bind(CustomEventImpl, {
    create(context, newTarget) {
      if (!newTarget) {
        throw new Error('CustomEvent construction requires newTarget');
      }
      return Reflect.construct(
        CustomEventImpl,
        [
          '',
          {},
          (context.realm as typeof context.realm & EventRealm)
            .eventTimeStamp(),
        ],
        newTarget as NewTarget,
      );
    },
  }),
  exposed: '*',
  inherits: 'Event',
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('CustomEventInit'), {
        default: emptyDictionary,
        optional: true,
      }),
    ], bind({
      invoke(_context, type, init) {
        const dictionary = init as Record<PropertyKey, unknown>;
        CustomEventImpl.initializeCustomForBinding(
          this as CustomEventImpl,
          type as string,
          Boolean(dictionary.bubbles),
          Boolean(dictionary.cancelable),
          Boolean(dictionary.composed),
          dictionary.detail,
        );
      },
    })),
    readonlyAttr('detail', idlType.any),
    op('initCustomEvent', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('bubbles', idlType.boolean, { default: false, optional: true }),
      arg('cancelable', idlType.boolean, {
        default: false,
        optional: true,
      }),
      arg('detail', idlType.any, { default: null, optional: true }),
    ]),
  ],
  name: 'CustomEvent',
});

export const customEventInitIDL = defineDictionary({
  inherits: 'EventInit',
  members: [dictMember('detail', idlType.any, { default: null })],
  name: 'CustomEventInit',
});

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

type EventRealm = {
  eventTimeStamp(): DOMHighResTimeStamp;
};

type NewTarget = new (...argumentsList: never[]) => object;
