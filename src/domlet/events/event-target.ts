import {
  domExceptionName, throwDOMException,
} from '../../shared/dom-exception';
import { bind } from '../../web-idl/index';
import {
  arg, ctor, defineCallbackInterface, defineDictionary, defineInterface,
  dictMember, emptyDictionary, idlType, nullable, op, reference, union,
} from '../../web-idl/declaration/index';
import {
  EventImpl, type EventPathItem, toDOMString,
} from './event';
import { MouseEventImpl } from './ui-event';

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
export class EventTargetImpl implements EventTarget
{
  #eventListenerList: EventListenerRecord[] = [];
  #createEvent: EventFactory = createStandaloneEvent;
  readonly #virtuals: EventTargetVirtuals;

  constructor(virtuals: EventTargetVirtuals = {}) {
    this.#virtuals = virtuals;
  }

  addEventListener(
    type: string,
    callback: EventListenerCallback | null,
    options: AddEventListenerOptions | boolean | null = {},
  ): void {
    const convertedType = toDOMString(type);
    const { capture, passive, once, signal } = flattenMore(options);
    const listener: EventListenerRecord = {
      type: convertedType,
      callback: callback === null
        ? null
        : EventListenerValue.from(callback),
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
    callback: EventListenerCallback | null,
    options: EventListenerOptions | boolean | null = {},
  ): void {
    const convertedType = toDOMString(type);
    const capture = flatten(options);
    const callbackValue = callback === null
      ? null
      : EventListenerValue.from(callback);
    const listener = this.#eventListenerList.find((candidate) =>
      candidate.type === convertedType &&
      sameEventListener(candidate.callback, callbackValue) &&
      candidate.capture === capture);

    if (listener) this.#removeListener(listener);
  }

  dispatchEvent(event: Event): boolean {
    if (!EventImpl.is(event)) {
      throw new TypeError('The event is not a DOM Event implementation');
    }

    if (EventImpl.isDispatching(event) || !EventImpl.isInitialized(event)) {
      throwDOMException(domExceptionName.invalidState);
    }

    EventImpl.setTrusted(event, false);
    return dispatch(event, this);
  }

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is EventTargetImpl {
    return typeof value === 'object' &&
      value !== null &&
      #eventListenerList in value;
  }

  static setEventFactory(
    target: EventTargetImpl,
    createEvent: EventFactory,
  ): void {
    target.#createEvent = createEvent;
  }

  static createEvent(
    target: EventTargetImpl,
    eventConstructor?: EventImplementationConstructor,
  ): EventImpl {
    return target.#createEvent(eventConstructor);
  }

  static removeAllEventListeners(target: EventTargetImpl): void {
    for (const listener of [...target.#eventListenerList]) {
      target.#removeListener(listener);
    }
  }

  static getParent(
    target: EventTargetImpl,
    event: Event,
  ): EventTargetImpl | null {
    return target.#virtuals.getParent?.(target, event) ?? null;
  }

  static getEventListenerCallbacks(
    target: EventTargetImpl,
    type: string,
  ): EventListenerOrEventListenerObject[] {
    const callbacks: EventListenerOrEventListenerObject[] = [];

    for (const listener of target.#eventListenerList) {
      if (listener.type === type && listener.callback !== null) {
        callbacks.push(listener.callback.object);
      }
    }

    return callbacks;
  }

  static getTreeRoot(target: EventTargetImpl): EventTargetImpl | null {
    return target.#virtuals.getTreeRoot?.(target) ?? null;
  }

  static getShadowRootHost(
    target: EventTargetImpl,
  ): EventTargetImpl | null {
    return target.#virtuals.getShadowRootHost?.(target) ?? null;
  }

  static getShadowRootMode(
    target: EventTargetImpl,
  ): ShadowRootMode | null {
    return target.#virtuals.getShadowRootMode?.(target) ?? null;
  }

  static getAssignedSlot(
    target: EventTargetImpl,
  ): EventTargetImpl | null {
    return target.#virtuals.getAssignedSlot?.(target) ?? null;
  }

  static isNode(target: EventTargetImpl): boolean {
    return target.#virtuals.isNode?.(target) ?? false;
  }

  static isWindow(target: EventTargetImpl): boolean {
    return target.#virtuals.isWindow?.(target) ?? false;
  }

  static getLegacyTargetOverride(
    target: EventTargetImpl,
  ): EventTargetImpl {
    return target.#virtuals.getLegacyTargetOverride?.(target) ?? target;
  }

  static isShadowIncludingInclusiveAncestor(
    ancestor: EventTargetImpl,
    target: EventTargetImpl,
  ): boolean {
    return target.#virtuals.isShadowIncludingInclusiveAncestor?.(
      ancestor,
      target,
    ) ?? false;
  }

  static invoke(
    pathItem: EventPathItem,
    event: EventImpl,
    phase: EventPhase,
  ): void {
    const path = EventImpl.getPath(event);
    let targetItemIndex = path.indexOf(pathItem);

    while (path[targetItemIndex]?.shadowAdjustedTarget === null) {
      targetItemIndex--;
    }

    const targetItem = path[targetItemIndex];
    if (!targetItem) throw new Error('An event path has no adjusted target');

    EventImpl.setTarget(event, targetItem.shadowAdjustedTarget);
    EventImpl.setRelatedTarget(event, pathItem.relatedTarget);
    EventImpl.setTouchTargetList(event, pathItem.touchTargetList);

    if (EventImpl.propagationStopped(event)) return;

    const currentTarget = pathItem.invocationTarget;
    if (!EventTargetImpl.is(currentTarget)) {
      throw new Error('An event path target must be an EventTarget implementation');
    }

    EventImpl.setCurrentTarget(event, currentTarget);
    const listeners = [...currentTarget.#eventListenerList];
    const found = EventTargetImpl.#innerInvoke(
      event,
      listeners,
      phase,
      pathItem.invocationTargetInShadowTree,
    );

    if (found || !event.isTrusted) return;

    const legacyType = LEGACY_EVENT_TYPES.get(event.type);
    if (!legacyType) return;

    const originalType = event.type;
    EventImpl.setType(event, legacyType);
    EventTargetImpl.#innerInvoke(
      event,
      listeners,
      phase,
      pathItem.invocationTargetInShadowTree,
    );
    EventImpl.setType(event, originalType);
  }

  static hasActivationBehavior(target: EventTargetImpl): boolean {
    return target.#virtuals.activationBehavior !== undefined;
  }

  static runActivationBehavior(
    target: EventTargetImpl,
    event: Event,
  ): void {
    target.#virtuals.activationBehavior?.(target, event);
  }

  static hasLegacyPreActivationBehavior(target: EventTargetImpl): boolean {
    return target.#virtuals.legacyPreActivationBehavior !== undefined;
  }

  static runLegacyPreActivationBehavior(target: EventTargetImpl): void {
    target.#virtuals.legacyPreActivationBehavior?.(target);
  }

  static hasLegacyCanceledActivationBehavior(
    target: EventTargetImpl,
  ): boolean {
    return target.#virtuals.legacyCanceledActivationBehavior !== undefined;
  }

  static runLegacyCanceledActivationBehavior(target: EventTargetImpl): void {
    target.#virtuals.legacyCanceledActivationBehavior?.(target);
  }

  // -- Private ----------------------------------------------------------

  static #innerInvoke(
    event: EventImpl,
    listeners: readonly EventListenerRecord[],
    phase: EventPhase,
    invocationTargetInShadowTree: boolean,
  ): boolean {
    let found = false;

    for (const listener of listeners) {
      if (listener.removed || event.type !== listener.type) continue;

      found = true;
      if (phase === 'capturing' && !listener.capture) continue;
      if (phase === 'bubbling' && listener.capture) continue;

      const currentTarget = EventImpl.getCurrentTarget(event);
      const callback = listener.callback;
      if (!EventTargetImpl.is(currentTarget) || callback === null) continue;

      if (listener.once) currentTarget.#removeListener(listener);

      const callbackRealm = callback.realm;
      const global = callbackRealm?.global;
      const windowRealm = callbackRealm?.globalNames.has('Window')
        ? callbackRealm as WindowEventListenerRealm
        : undefined;
      const currentEvent = windowRealm && global
        ? windowRealm.getCurrentEvent(global)
        : undefined;

      if (windowRealm && global && !invocationTargetInShadowTree) {
        windowRealm.setCurrentEvent(global, event);
      }
      if (listener.passive) EventImpl.setInPassiveListener(event, true);
      if (windowRealm && global) {
        windowRealm.recordTimingInfo(
          global,
          event,
          callback.object,
        );
      }

      try {
        callback.invoke(event, currentTarget);
      } catch (exception) {
        if (callbackRealm) {
          callbackRealm.callbacks.reportException(exception);
        } else {
          console.error(exception);
        }
      } finally {
        EventImpl.setInPassiveListener(event, false);
        if (windowRealm && global) {
          windowRealm.setCurrentEvent(global, currentEvent);
        }
      }

      if (EventImpl.immediatePropagationStopped(event)) break;
    }

    return found;
  }

  #getDefaultPassiveValue(type: string): boolean {
    return DEFAULT_PASSIVE_EVENT_TYPES.has(type) &&
      (this.#virtuals.isDefaultPassiveTarget?.(this) ?? false);
  }

  #addListener(listener: EventListenerRecord): void {
    this.#virtuals.addingEventListener?.(this, listener.type);

    if (listener.signal?.aborted || listener.callback === null) return;

    listener.passive ??= this.#getDefaultPassiveValue(listener.type);

    const duplicate = this.#eventListenerList.some((candidate) =>
      candidate.type === listener.type &&
      sameEventListener(candidate.callback, listener.callback) &&
      candidate.capture === listener.capture);

    if (!duplicate) this.#eventListenerList.push(listener);

    listener.signal?.addEventListener(
      'abort',
      () => this.#removeListener(listener),
      { once: true },
    );
  }

  #removeListener(listener: EventListenerRecord): void {
    this.#virtuals.removingEventListener?.(this, listener.type);

    listener.removed = true;

    const index = this.#eventListenerList.indexOf(listener);
    if (index !== -1) this.#eventListenerList.splice(index, 1);
  }
}

// -- Web IDL ------------------------------------------------------------

export const eventTargetIDL = defineInterface({
  binding: bind(EventTargetImpl, {
    initialize(context, value) {
      const realm = context.realm as typeof context.realm & EventRealm;
      EventTargetImpl.setEventFactory(
        value as EventTargetImpl,
        (EventConstructor = EventImpl) => {
          const event = context.objects.construct(
            EventConstructor,
            ['', {}, realm.eventTimeStamp()],
          );
          EventImpl.setTrusted(event, true);
          return event;
        },
      );
    },
  }),
  exposed: '*',
  members: [
    ctor(bind({ invoke() {} })),
    op('addEventListener', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('callback', nullable(reference('EventListener'))),
      arg(
        'options',
        union(reference('AddEventListenerOptions'), idlType.boolean),
        {
          default: emptyDictionary,
          optional: true,
        },
      ),
    ]),
    op('removeEventListener', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('callback', nullable(reference('EventListener'))),
      arg(
        'options',
        union(reference('EventListenerOptions'), idlType.boolean),
        {
          default: emptyDictionary,
          optional: true,
        },
      ),
    ]),
    op('dispatchEvent', idlType.boolean, [
      arg('event', reference('Event')),
    ]),
  ],
  name: 'EventTarget',
});

export const eventListenerIDL = defineCallbackInterface({
  binding: bind({
    adapt(_context, callback) {
      return new EventListenerValue(
        callback.object as EventListenerOrEventListenerObject,
        callback.realm,
        (event, currentTarget) => {
          callback.callUserObjectOperation(
            'handleEvent',
            [event],
            currentTarget,
          );
        },
      );
    },
  }),
  members: [op('handleEvent', idlType.undefined, [
    arg('event', reference('Event')),
  ])],
  name: 'EventListener',
});

export const eventListenerOptionsIDL = defineDictionary({
  members: [dictMember('capture', idlType.boolean, { default: false })],
  name: 'EventListenerOptions',
});

export const addEventListenerOptionsIDL = defineDictionary({
  inherits: 'EventListenerOptions',
  members: [
    dictMember('passive', idlType.boolean),
    dictMember('once', idlType.boolean, { default: false }),
    // TODO(DOM section 3): Use AbortSignal once its interface is bound.
    dictMember('signal', idlType.object),
  ],
  name: 'AddEventListenerOptions',
});

export function fireEvent(
  name: string,
  target: EventTargetImpl,
  eventConstructor?: EventImplementationConstructor,
  initialize?: (event: EventImpl) => void,
  legacyTargetOverride = false,
): boolean {
  const event = EventTargetImpl.createEvent(target, eventConstructor);

  EventImpl.setType(event, name);
  initialize?.(event);
  return dispatch(event, target, legacyTargetOverride);
}

function dispatch(
  event: EventImpl,
  initialTarget: EventTargetImpl,
  legacyTargetOverride = false,
): boolean {
  EventImpl.beginDispatch(event);

  let target = initialTarget;
  const targetOverride = legacyTargetOverride
    ? EventTargetImpl.getLegacyTargetOverride(target)
    : target;
  let activationTarget: EventTargetImpl | null = null;
  let relatedTarget = retarget(EventImpl.getRelatedTarget(event), target);
  let clearTargets = false;

  if (
    target !== relatedTarget ||
    target === EventImpl.getRelatedTarget(event)
  ) {
    let touchTargets = EventImpl.getTouchTargetList(event)
      .map((touchTarget) => retarget(touchTarget, target));
    appendToEventPath(
      event,
      target,
      targetOverride,
      relatedTarget,
      touchTargets,
      false,
    );

    const isActivationEvent = MouseEventImpl.is(event) &&
      event.type === 'click';

    if (
      isActivationEvent &&
      EventTargetImpl.hasActivationBehavior(target)
    ) {
      activationTarget = target;
    }

    let slottable = EventTargetImpl.getAssignedSlot(target) === null
      ? null
      : target;
    let slotInClosedTree = false;
    let parent = EventTargetImpl.getParent(target, event);

    while (parent !== null) {
      if (slottable !== null) {
        slottable = null;
        const parentRoot = EventTargetImpl.getTreeRoot(parent);
        if (
          parentRoot !== null &&
          EventTargetImpl.getShadowRootMode(parentRoot) === 'closed'
        ) {
          slotInClosedTree = true;
        }
      }

      if (EventTargetImpl.getAssignedSlot(parent) !== null) {
        slottable = parent;
      }

      relatedTarget = retarget(EventImpl.getRelatedTarget(event), parent);
      const parentForRetarget = parent;
      touchTargets = EventImpl.getTouchTargetList(event)
        .map((touchTarget) => retarget(touchTarget, parentForRetarget));

      const targetRoot = EventTargetImpl.getTreeRoot(target);
      const sameShadowIncludingTree = EventTargetImpl.isWindow(parent) || (
        targetRoot !== null &&
        EventTargetImpl.isNode(parent) &&
        EventTargetImpl.isShadowIncludingInclusiveAncestor(
          targetRoot,
          parent,
        )
      );

      if (sameShadowIncludingTree) {
        if (
          isActivationEvent &&
          event.bubbles &&
          activationTarget === null &&
          EventTargetImpl.hasActivationBehavior(parent)
        ) {
          activationTarget = parent;
        }

        appendToEventPath(
          event,
          parent,
          null,
          relatedTarget,
          touchTargets,
          slotInClosedTree,
        );
      } else if (parent === relatedTarget) {
        parent = null;
      } else {
        target = parent;

        if (
          isActivationEvent &&
          activationTarget === null &&
          EventTargetImpl.hasActivationBehavior(target)
        ) {
          activationTarget = target;
        }

        appendToEventPath(
          event,
          parent,
          target,
          relatedTarget,
          touchTargets,
          slotInClosedTree,
        );
      }

      if (parent !== null) {
        parent = EventTargetImpl.getParent(parent, event);
      }
      slotInClosedTree = false;
    }

    const clearTargetsItem = EventImpl.getPath(event)
      .findLast((item) => item.shadowAdjustedTarget !== null);

    if (clearTargetsItem) {
      clearTargets = isNodeInShadowTree(clearTargetsItem.shadowAdjustedTarget) ||
        isNodeInShadowTree(clearTargetsItem.relatedTarget) ||
        clearTargetsItem.touchTargetList.some(isNodeInShadowTree);
    }

    if (
      activationTarget !== null &&
      EventTargetImpl.hasLegacyPreActivationBehavior(activationTarget)
    ) {
      EventTargetImpl.runLegacyPreActivationBehavior(activationTarget);
    }

    for (const item of [...EventImpl.getPath(event)].reverse()) {
      EventImpl.setPhase(
        event,
        item.shadowAdjustedTarget === null
          ? EventImpl.CAPTURING_PHASE
          : EventImpl.AT_TARGET,
      );
      EventTargetImpl.invoke(item, event, 'capturing');
    }

    for (const item of EventImpl.getPath(event)) {
      if (item.shadowAdjustedTarget !== null) {
        EventImpl.setPhase(event, EventImpl.AT_TARGET);
      } else {
        if (!event.bubbles) continue;
        EventImpl.setPhase(event, EventImpl.BUBBLING_PHASE);
      }

      EventTargetImpl.invoke(item, event, 'bubbling');
    }
  }

  EventImpl.finishDispatch(event, clearTargets);

  if (activationTarget !== null) {
    if (!EventImpl.isCanceled(event)) {
      EventTargetImpl.runActivationBehavior(activationTarget, event);
    } else if (
      EventTargetImpl.hasLegacyCanceledActivationBehavior(activationTarget)
    ) {
      EventTargetImpl.runLegacyCanceledActivationBehavior(activationTarget);
    }
  }

  return !EventImpl.isCanceled(event);
}

function appendToEventPath(
  event: EventImpl,
  invocationTarget: EventTargetImpl,
  shadowAdjustedTarget: EventTargetImpl | null,
  relatedTarget: EventTarget | null,
  touchTargetList: readonly (EventTarget | null)[],
  slotInClosedTree: boolean,
): void {
  const root = EventTargetImpl.getTreeRoot(invocationTarget);

  EventImpl.appendToPath(event, {
    invocationTarget,
    invocationTargetInShadowTree: root !== null &&
      EventTargetImpl.getShadowRootHost(root) !== null,
    shadowAdjustedTarget,
    relatedTarget,
    touchTargetList,
    rootOfClosedTree: EventTargetImpl.getShadowRootMode(invocationTarget) ===
      'closed',
    slotInClosedTree,
  });
}

function retarget(
  initialTarget: EventTarget | null,
  against: EventTargetImpl,
): EventTarget | null {
  let target = initialTarget;

  while (EventTargetImpl.is(target) && EventTargetImpl.isNode(target)) {
    const root = EventTargetImpl.getTreeRoot(target);
    if (root === null) return target;

    const host = EventTargetImpl.getShadowRootHost(root);
    if (host === null) return target;

    if (
      EventTargetImpl.isNode(against) &&
      EventTargetImpl.isShadowIncludingInclusiveAncestor(root, against)
    ) {
      return target;
    }

    target = host;
  }

  return target;
}

function isNodeInShadowTree(target: EventTarget | null): boolean {
  if (!EventTargetImpl.is(target) || !EventTargetImpl.isNode(target)) {
    return false;
  }

  const root = EventTargetImpl.getTreeRoot(target);
  return root !== null && EventTargetImpl.getShadowRootHost(root) !== null;
}

export type EventTargetVirtuals = {
  readonly getParent?: (
    target: EventTargetImpl,
    event: Event,
  ) => EventTargetImpl | null;
  readonly isDefaultPassiveTarget?: (target: EventTargetImpl) => boolean;
  readonly isNode?: (target: EventTargetImpl) => boolean;
  readonly isWindow?: (target: EventTargetImpl) => boolean;
  readonly getLegacyTargetOverride?: (
    target: EventTargetImpl,
  ) => EventTargetImpl;
  readonly getTreeRoot?: (
    target: EventTargetImpl,
  ) => EventTargetImpl | null;
  readonly getShadowRootHost?: (
    target: EventTargetImpl,
  ) => EventTargetImpl | null;
  readonly getShadowRootMode?: (
    target: EventTargetImpl,
  ) => ShadowRootMode | null;
  readonly getAssignedSlot?: (
    target: EventTargetImpl,
  ) => EventTargetImpl | null;
  readonly isShadowIncludingInclusiveAncestor?: (
    ancestor: EventTargetImpl,
    target: EventTargetImpl,
  ) => boolean;
  readonly addingEventListener?: (
    target: EventTargetImpl,
    type: string,
  ) => void;
  readonly removingEventListener?: (
    target: EventTargetImpl,
    type: string,
  ) => void;
  readonly activationBehavior?: (
    target: EventTargetImpl,
    event: Event,
  ) => void;
  readonly legacyPreActivationBehavior?: (
    target: EventTargetImpl,
  ) => void;
  readonly legacyCanceledActivationBehavior?: (
    target: EventTargetImpl,
  ) => void;
};

type EventListenerCallback =
  | EventListenerOrEventListenerObject
  | EventListenerValue;

type EventListenerRecord = {
  readonly type: string;
  readonly callback: EventListenerValue | null;
  readonly capture: boolean;
  passive: boolean | null;
  readonly once: boolean;
  readonly signal: AbortSignal | null;
  removed: boolean;
};

export type EventImplementationConstructor = {
  readonly prototype: EventImpl;
} & (abstract new (
  type: string,
  init?: EventInit,
  timeStamp?: DOMHighResTimeStamp,
) => EventImpl);

type EventPhase = 'capturing' | 'bubbling';

type EventFactory = (
  eventConstructor?: EventImplementationConstructor,
) => EventImpl;

type EventRealm = {
  eventTimeStamp(): DOMHighResTimeStamp;
};

type EventListenerRealm = {
  readonly callbacks: {
    reportException(exception: unknown): void;
  };
  readonly global: object;
  readonly globalNames: ReadonlySet<string>;
};

type WindowEventListenerRealm = EventListenerRealm & {
  getCurrentEvent(global: object): Event | undefined;
  recordTimingInfo(
    global: object,
    event: Event,
    callback: EventListenerOrEventListenerObject,
  ): void;
  setCurrentEvent(global: object, event: Event | undefined): void;
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

const LEGACY_EVENT_TYPES = new Map([
  ['animationend', 'webkitAnimationEnd'],
  ['animationiteration', 'webkitAnimationIteration'],
  ['animationstart', 'webkitAnimationStart'],
  ['transitionend', 'webkitTransitionEnd'],
]);

function createStandaloneEvent(
  EventConstructor: EventImplementationConstructor = EventImpl,
): EventImpl {
  const event = Reflect.construct(
    EventConstructor,
    ['', {}, performance.now()],
  ) as EventImpl;
  EventImpl.setTrusted(event, true);
  return event;
}

class EventListenerValue {
  readonly object: EventListenerOrEventListenerObject;
  readonly realm: EventListenerRealm | undefined;
  readonly #invoke: (event: Event, currentTarget: EventTarget) => void;

  constructor(
    object: EventListenerOrEventListenerObject,
    realm: EventListenerRealm | undefined,
    invoke: (event: Event, currentTarget: EventTarget) => void,
  ) {
    this.object = object;
    this.realm = realm;
    this.#invoke = invoke;
  }

  invoke(event: Event, currentTarget: EventTarget): void {
    this.#invoke(event, currentTarget);
  }

  static from(callback: EventListenerCallback): EventListenerValue {
    if (callback instanceof EventListenerValue) return callback;

    return new EventListenerValue(
      callback,
      undefined,
      (event, currentTarget) => {
        if (typeof callback === 'function') {
          callback.call(currentTarget, event);
        } else {
          callback.handleEvent.call(callback, event);
        }
      },
    );
  }
}

function sameEventListener(
  left: EventListenerValue | null,
  right: EventListenerValue | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.object === right.object;
}
