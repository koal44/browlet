import {
  arg, ctor, defineCallbackInterface, defineDictionary, defineInterface,
  dictMember, emptyDictionary, idlType, impl, nullable, op, reference, union,
  DOMExceptionNames, throwDOMException,
} from '../../../web-idl/index';
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

  static is(value: unknown): value is EventTargetImpl {
    return typeof value === 'object' &&
      value !== null &&
      #eventListenerList in value;
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
    if (event.isDispatching() || !event.isInitialized()) {
      throwDOMException(DOMExceptionNames.invalidState);
    }

    event.setTrusted(false);
    return dispatch(event, this);
  }

  // -- Internal methods -------------------------------------------------

  setEventFactory(createEvent: EventFactory): void {
    this.#createEvent = createEvent;
  }

  createEvent(eventConstructor?: EventImplConstructor): EventImpl {
    return this.#createEvent(eventConstructor);
  }

  removeAllEventListeners(): void {
    for (const listener of [...this.#eventListenerList]) {
      this.#removeListener(listener);
    }
  }

  getParent(event: EventImpl): EventTargetImpl | null {
    return this.#virtuals.getParent?.(this, event) ?? null;
  }

  getEventListenerCallbacks(type: string): EventListenerOrEventListenerObject[] {
    const callbacks: EventListenerOrEventListenerObject[] = [];

    for (const listener of this.#eventListenerList) {
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

  hasEventListener(type: string): boolean {
    return this.#eventListenerList.some(
      (listener) => !listener.removed && listener.type === type,
    );
  }

  getTreeRoot(): EventTargetImpl | null {
    return this.#virtuals.getTreeRoot?.(this) ?? null;
  }

  getShadowRootHost(): EventTargetImpl | null {
    return this.#virtuals.getShadowRootHost?.(this) ?? null;
  }

  getShadowRootMode(): ShadowRootMode | null {
    return this.#virtuals.getShadowRootMode?.(this) ?? null;
  }

  getAssignedSlot(): EventTargetImpl | null {
    return this.#virtuals.getAssignedSlot?.(this) ?? null;
  }

  isNode(): boolean {
    return this.#virtuals.isNode?.(this) ?? false;
  }

  isWindow(): boolean {
    return this.#virtuals.isWindow?.(this) ?? false;
  }

  getLegacyTargetOverride(): EventTargetImpl {
    return this.#virtuals.getLegacyTargetOverride?.(this) ?? this;
  }

  hasShadowIncludingInclusiveAncestor(ancestor: EventTargetImpl): boolean {
    return this.#virtuals.isShadowIncludingInclusiveAncestor?.(
      ancestor,
      this,
    ) ?? false;
  }

  invoke(
    pathItem: EventPathItem,
    event: EventImpl,
    phase: EventPhase,
  ): void {
    const path = event.getPath();
    let targetItemIndex = path.indexOf(pathItem);

    while (path[targetItemIndex]?.shadowAdjustedTarget === null) {
      targetItemIndex--;
    }

    const targetItem = path[targetItemIndex];
    if (!targetItem) throw new Error('An event path has no adjusted target');

    event.setTarget(targetItem.shadowAdjustedTarget);
    event.setRelatedTarget(pathItem.relatedTarget);
    event.setTouchTargetList(pathItem.touchTargetList);

    if (event.propagationStopped()) return;

    event.setCurrentTarget(this);
    const listeners = [...this.#eventListenerList];
    const found = this.#innerInvoke(
      event,
      listeners,
      phase,
      pathItem.invocationTargetInShadowTree,
    );

    if (found || !event.isTrusted) return;

    const legacyType = LEGACY_EVENT_TYPES.get(event.type);
    if (!legacyType) return;

    const originalType = event.type;
    event.setType(legacyType);
    this.#innerInvoke(
      event,
      listeners,
      phase,
      pathItem.invocationTargetInShadowTree,
    );
    event.setType(originalType);
  }

  hasActivationBehavior(): boolean {
    return this.#virtuals.activationBehavior !== undefined;
  }

  runActivationBehavior(event: EventImpl): void {
    this.#virtuals.activationBehavior?.(this, event);
  }

  hasLegacyPreActivationBehavior(): boolean {
    return this.#virtuals.legacyPreActivationBehavior !== undefined;
  }

  runLegacyPreActivationBehavior(): void {
    this.#virtuals.legacyPreActivationBehavior?.(this);
  }

  hasLegacyCanceledActivationBehavior(): boolean {
    return this.#virtuals.legacyCanceledActivationBehavior !== undefined;
  }

  runLegacyCanceledActivationBehavior(): void {
    this.#virtuals.legacyCanceledActivationBehavior?.(this);
  }

  // -- Private ----------------------------------------------------------

  #innerInvoke(
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

      const callback = listener.callback;
      if (callback === null) continue;

      if (listener.once) this.#removeListener(listener);

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
      if (listener.passive) event.setInPassiveListener(true);
      if (windowRealm && global) {
        windowRealm.recordTimingInfo(
          global,
          event,
          callback.object,
        );
      }

      try {
        callback.invoke(event, this);
      } catch (exception) {
        if (callbackRealm) {
          callbackRealm.callbacks.reportException(exception);
        } else {
          console.error(exception);
        }
      } finally {
        event.setInPassiveListener(false);
        if (windowRealm && global) {
          windowRealm.setCurrentEvent(global, currentEvent);
        }
      }

      if (event.immediatePropagationStopped()) break;
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
  implementation: impl(EventTargetImpl, {
    initializeImplementation(context, value) {
      (value as EventTargetImpl).setEventFactory((EventConstructor = EventImpl) => {
        const event = context.construct(EventConstructor, '', {});
        event.setTrusted(true);
        return event;
      });
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
  adapt(_ctx, callback) {
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
  members: [
    op('handleEvent', idlType.undefined, [arg('event', reference('Event'))]),
  ],
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
  const event = target.createEvent(eventConstructor);

  event.setType(name);
  initialize?.(event);
  return dispatch(event, target, legacyTargetOverride);
}

function dispatch(
  event: EventImpl,
  initialTarget: EventTargetImpl,
  legacyTargetOverride = false,
): boolean {
  event.beginDispatch();

  let target = initialTarget;
  const targetOverride = legacyTargetOverride
    ? target.getLegacyTargetOverride()
    : target;
  let activationTarget: EventTargetImpl | null = null;
  let relatedTarget = retarget(event.getRelatedTarget(), target);
  let clearTargets = false;

  if (
    target !== relatedTarget ||
    target === event.getRelatedTarget()
  ) {
    let touchTargets = event.getTouchTargetList()
      .map((touchTarget) => retarget(touchTarget, target));
    event.appendToPath(target, targetOverride, relatedTarget, touchTargets, false);

    const isActivationEvent = MouseEventImpl.is(event) &&
      event.type === 'click';

    if (
      isActivationEvent &&
      target.hasActivationBehavior()
    ) {
      activationTarget = target;
    }

    let slottable = target.getAssignedSlot() === null
      ? null
      : target;
    let slotInClosedTree = false;
    let parent = target.getParent(event);

    while (parent !== null) {
      if (slottable !== null) {
        slottable = null;
        const parentRoot = parent.getTreeRoot();
        if (
          parentRoot !== null &&
          parentRoot.getShadowRootMode() === 'closed'
        ) {
          slotInClosedTree = true;
        }
      }

      if (parent.getAssignedSlot() !== null) {
        slottable = parent;
      }

      relatedTarget = retarget(event.getRelatedTarget(), parent);
      const parentForRetarget = parent;
      touchTargets = event.getTouchTargetList()
        .map((touchTarget) => retarget(touchTarget, parentForRetarget));

      const targetRoot = target.getTreeRoot();
      const sameShadowIncludingTree = parent.isWindow() || (
        targetRoot !== null &&
        parent.isNode() &&
        parent.hasShadowIncludingInclusiveAncestor(targetRoot)
      );

      if (sameShadowIncludingTree) {
        if (
          isActivationEvent &&
          event.bubbles &&
          activationTarget === null &&
          parent.hasActivationBehavior()
        ) {
          activationTarget = parent;
        }

        event.appendToPath(parent, null, relatedTarget, touchTargets, slotInClosedTree);
      } else if (parent === relatedTarget) {
        parent = null;
      } else {
        target = parent;

        if (
          isActivationEvent &&
          activationTarget === null &&
          target.hasActivationBehavior()
        ) {
          activationTarget = target;
        }

        event.appendToPath(parent, target, relatedTarget, touchTargets, slotInClosedTree);
      }

      if (parent !== null) {
        parent = parent.getParent(event);
      }
      slotInClosedTree = false;
    }

    const clearTargetsItem = event.getPath()
      .findLast((item) => item.shadowAdjustedTarget !== null);

    if (clearTargetsItem) {
      clearTargets = isNodeInShadowTree(clearTargetsItem.shadowAdjustedTarget) ||
        isNodeInShadowTree(clearTargetsItem.relatedTarget) ||
        clearTargetsItem.touchTargetList.some(isNodeInShadowTree);
    }

    if (
      activationTarget !== null &&
      activationTarget.hasLegacyPreActivationBehavior()
    ) {
      activationTarget.runLegacyPreActivationBehavior();
    }

    for (const item of [...event.getPath()].reverse()) {
      event.setPhase(
        item.shadowAdjustedTarget === null
          ? EventImpl.CAPTURING_PHASE
          : EventImpl.AT_TARGET,
      );
      item.invocationTarget.invoke(item, event, 'capturing');
    }

    for (const item of event.getPath()) {
      if (item.shadowAdjustedTarget !== null) {
        event.setPhase(EventImpl.AT_TARGET);
      } else {
        if (!event.bubbles) continue;
        event.setPhase(EventImpl.BUBBLING_PHASE);
      }

      item.invocationTarget.invoke(item, event, 'bubbling');
    }
  }

  event.finishDispatch(clearTargets);

  if (activationTarget !== null) {
    if (!event.defaultPrevented) {
      activationTarget.runActivationBehavior(event);
    } else if (
      activationTarget.hasLegacyCanceledActivationBehavior()
    ) {
      activationTarget.runLegacyCanceledActivationBehavior();
    }
  }

  return !event.defaultPrevented;
}

function retarget(
  initialTarget: EventTargetImpl | null,
  against: EventTargetImpl,
): EventTargetImpl | null {
  let target = initialTarget;

  while (target !== null && target.isNode()) {
    const root = target.getTreeRoot();
    if (root === null) return target;

    const host = root.getShadowRootHost();
    if (host === null) return target;

    if (
      against.isNode() &&
      against.hasShadowIncludingInclusiveAncestor(root)
    ) {
      return target;
    }

    target = host;
  }

  return target;
}

function isNodeInShadowTree(target: EventTargetImpl | null): boolean {
  if (target === null || !target.isNode()) {
    return false;
  }

  const root = target.getTreeRoot();
  return root !== null && root.getShadowRootHost() !== null;
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
  event.setTrusted(true);
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
