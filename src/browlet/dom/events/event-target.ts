import {
  domExceptionName, throwDOMException,
} from '../../../web-idl/exceptions/dom-exception-core';
import { bind } from '../../../web-idl/index';
import {
  arg, ctor, defineCallbackInterface, defineDictionary, defineInterface,
  dictMember, emptyDictionary, idlType, nullable, op, reference, union,
} from '../../../web-idl/declaration/index';
import { EventImpl, type EventPathItem } from './event';
import { MouseEventImpl } from './ui-event';
import {
  unsafeSharedCurrentTime,
} from '../../performance/high-resolution-time';
import {
  type AbortAlgorithmHandle, type AbortSignalImpl,
} from '../abort/abort-signal';

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
export class EventTargetImpl {
  #eventListenerList: EventListenerRecord[] = [];
  #createEvent: EventFactory = createStandaloneEvent;
  readonly #virtuals: EventTargetVirtuals;

  constructor(virtuals: EventTargetVirtuals = {}) {
    this.#virtuals = virtuals;
  }

  addEventListener(
    type: string,
    callback: EventListenerInput | null,
    options: AddEventListenerOptionsRecord | boolean | null = {},
  ): void {
    const { capture, passive, once, signal } = flattenMore(options);
    const listener: EventListenerRecord = {
      abortAlgorithm: null,
      type,
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
    callback: EventListenerInput | null,
    options: EventListenerOptionsRecord | boolean | null = {},
  ): void {
    const capture = flatten(options);
    const callbackValue = callback === null
      ? null
      : EventListenerValue.from(callback);
    const listener = this.#eventListenerList.find((candidate) =>
      candidate.type === type &&
      sameEventListener(candidate.callback, callbackValue) &&
      candidate.capture === capture);

    if (listener) this.#removeListener(listener);
  }

  dispatchEvent(event: EventImpl): boolean {
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
    eventConstructor?: EventImplConstructor,
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
    event: EventImpl,
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
        // This legacy algorithm returns the original author callback objects,
        // not EventTarget or EventListener implementation objects.
        callbacks.push(
          listener.callback.object as EventListenerOrEventListenerObject,
        );
      }
    }

    return callbacks;
  }

  static hasEventListener(
    target: EventTargetImpl,
    type: string,
  ): boolean {
    return target.#eventListenerList.some(
      (listener) => !listener.removed && listener.type === type,
    );
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
    event: EventImpl,
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
      if (currentTarget === null || callback === null) continue;

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

    if (
      listener.signal?.aborted ||
      listener.callback === null
    ) return;

    listener.passive ??= this.#getDefaultPassiveValue(listener.type);

    const duplicate = this.#eventListenerList.some((candidate) =>
      candidate.type === listener.type &&
      sameEventListener(candidate.callback, listener.callback) &&
      candidate.capture === listener.capture);

    if (duplicate) return;

    this.#eventListenerList.push(listener);
    if (listener.signal) {
      listener.abortAlgorithm = listener.signal.addAlgorithm(
        () => this.#removeListener(listener),
      );
    }
    this.#virtuals.eventListenerListChanged?.(this, listener.type);
  }

  #removeListener(listener: EventListenerRecord): void {
    if (listener.removed) return;

    this.#virtuals.removingEventListener?.(this, listener.type);

    listener.removed = true;
    listener.abortAlgorithm?.remove();
    listener.abortAlgorithm = null;

    const index = this.#eventListenerList.indexOf(listener);
    if (index !== -1) this.#eventListenerList.splice(index, 1);
    this.#virtuals.eventListenerListChanged?.(this, listener.type);
  }
}

// -- Web IDL ------------------------------------------------------------

export const eventTargetIDL = defineInterface({
  name: 'EventTarget',
  exposed: '*',
  // Projection supplies the realm-correct trusted-event factory to every
  // implementation whose primary interface inherits EventTarget.
  implementation: bind(EventTargetImpl, {
    initializeImplementation(context, value) {
      EventTargetImpl.setEventFactory(
        value as EventTargetImpl,
        (EventConstructor = EventImpl) => {
          const event = context.construct(
            EventConstructor,
            '',
            {},
          );
          EventImpl.setTrusted(event, true);
          return event;
        },
      );
    },
  }),
  members: [
    ctor(),
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
});

export const eventListenerIDL = defineCallbackInterface({
  name: 'EventListener',
  // Event dispatch retains the callback realm and original object identity in
  // addition to the callback-interface invocation steps.
  adapter: bind({
    adapt(_context, callback) {
      return new EventListenerValue(
        callback.object,
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
});

export const eventListenerOptionsIDL = defineDictionary({
  name: 'EventListenerOptions',
  members: [dictMember('capture', idlType.boolean, { default: false })],
});

export const addEventListenerOptionsIDL = defineDictionary({
  name: 'AddEventListenerOptions',
  inherits: 'EventListenerOptions',
  members: [
    dictMember('passive', idlType.boolean),
    dictMember('once', idlType.boolean, { default: false }),
    dictMember('signal', reference('AbortSignal')),
  ],
});

export function fireEvent(
  name: string,
  target: EventTargetImpl,
  eventConstructor?: EventImplConstructor,
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
  relatedTarget: EventTargetImpl | null,
  touchTargetList: readonly (EventTargetImpl | null)[],
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
  initialTarget: EventTargetImpl | null,
  against: EventTargetImpl,
): EventTargetImpl | null {
  let target = initialTarget;

  while (target !== null && EventTargetImpl.isNode(target)) {
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

function isNodeInShadowTree(target: EventTargetImpl | null): boolean {
  if (target === null || !EventTargetImpl.isNode(target)) {
    return false;
  }

  const root = EventTargetImpl.getTreeRoot(target);
  return root !== null && EventTargetImpl.getShadowRootHost(root) !== null;
}

export type EventTargetVirtuals = {
  readonly getParent?: (
    target: EventTargetImpl,
    event: EventImpl,
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
  readonly eventListenerListChanged?: (
    target: EventTargetImpl,
    type: string,
  ) => void;
  readonly activationBehavior?: (
    target: EventTargetImpl,
    event: EventImpl,
  ) => void;
  readonly legacyPreActivationBehavior?: (
    target: EventTargetImpl,
  ) => void;
  readonly legacyCanceledActivationBehavior?: (
    target: EventTargetImpl,
  ) => void;
};

type EventListenerInput =
  | ((this: EventTargetImpl, event: EventImpl) => void)
  | { handleEvent(event: EventImpl): void; }
  | EventListenerValue;

type EventListenerRecord = {
  abortAlgorithm: AbortAlgorithmHandle | null;
  readonly type: string;
  readonly callback: EventListenerValue | null;
  readonly capture: boolean;
  passive: boolean | null;
  readonly once: boolean;
  readonly signal: AbortSignalImpl | null;
  removed: boolean;
};

export type EventImplConstructor = {
  readonly prototype: EventImpl;
} & (abstract new (
  type: string,
  init?: EventInit,
  timeStamp?: DOMHighResTimeStamp,
) => EventImpl);

type EventPhase = 'capturing' | 'bubbling';

type EventFactory = (
  eventConstructor?: EventImplConstructor,
) => EventImpl;

type EventListenerRealm = {
  readonly callbacks: {
    reportException(exception: unknown): void;
  };
  readonly global: object;
  readonly globalNames: ReadonlySet<string>;
};

type WindowEventListenerRealm = EventListenerRealm & {
  getCurrentEvent(global: object): EventImpl | undefined;
  recordTimingInfo(
    global: object,
    event: EventImpl,
    callback: object,
  ): void;
  setCurrentEvent(global: object, event: EventImpl | undefined): void;
};

function flatten(
  options: EventListenerOptionsRecord | boolean | null,
): boolean {
  return typeof options === 'boolean'
    ? options
    : options?.capture ?? false;
}

function flattenMore(
  options: AddEventListenerOptionsRecord | boolean | null,
): FlattenedEventListenerOptions {
  const capture = flatten(options);
  let passive: boolean | null = null;
  let once = false;
  let signal: AbortSignalImpl | null = null;

  if (typeof options === 'object' && options !== null) {
    once = options.once ?? false;
    const passiveValue = options.passive;
    const signalValue = options.signal;

    if (passiveValue !== undefined) passive = passiveValue;
    if (signalValue !== undefined) signal = signalValue;
  }

  return { capture, passive, once, signal };
}

type FlattenedEventListenerOptions = {
  readonly capture: boolean;
  readonly passive: boolean | null;
  readonly once: boolean;
  readonly signal: AbortSignalImpl | null;
};

type EventListenerOptionsRecord = {
  readonly capture?: boolean;
};

type AddEventListenerOptionsRecord = EventListenerOptionsRecord & {
  readonly once?: boolean;
  readonly passive?: boolean;
  readonly signal?: AbortSignalImpl;
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
  EventConstructor: EventImplConstructor = EventImpl,
): EventImpl {
  const event = Reflect.construct(
    EventConstructor,
    ['', {}, unsafeSharedCurrentTime().milliseconds],
  ) as EventImpl;
  EventImpl.setTrusted(event, true);
  return event;
}

class EventListenerValue {
  readonly object: object;
  readonly realm: EventListenerRealm | undefined;
  readonly #invoke: (
    event: EventImpl,
    currentTarget: EventTargetImpl,
  ) => void;

  constructor(
    object: object,
    realm: EventListenerRealm | undefined,
    invoke: (event: EventImpl, currentTarget: EventTargetImpl) => void,
  ) {
    this.object = object;
    this.realm = realm;
    this.#invoke = invoke;
  }

  invoke(event: EventImpl, currentTarget: EventTargetImpl): void {
    this.#invoke(event, currentTarget);
  }

  static from(callback: EventListenerInput): EventListenerValue {
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
