import {
  arg, atArg, ctor, defineCallbackInterface, defineDictionary, defineInterface,
  dictMember, emptyDictionary, idlType, impl, nullable, op, reference, union,
  DOMExceptionNames, throwDOMException,
} from '../../../web-idl/index';
import { EventPhase, type EventImpl, type EventPathItem } from './event';
import type { DOMEnvironment, EventImplConstructor, EventRealm } from '../environment';
import { MouseEventImpl } from './ui-event';
import {
  type AbortAlgorithmHandle, type AbortSignalImpl,
} from '../abort/abort-signal';
import { InternalError } from '../../../infra/internal-error';

/** Owns listener registrations and delivers events through the dispatch path. */
// https://dom.spec.whatwg.org/#interface-eventtarget
export class EventTargetImpl {
  /** Registrations in insertion order, including their signal cleanup handles. */
  #eventListenerList: EventListenerRecord[] = [];
  /** Environment that owns this target's event allocations. */
  env: DOMEnvironment;

  constructor(env: DOMEnvironment) {
    this.env = env;
  }

  static is(value: unknown): value is EventTargetImpl {
    return typeof value === 'object' &&
      value !== null &&
      #eventListenerList in value;
  }

  /** Register a listener unless its type, callback, and capture already match. */
  // https://dom.spec.whatwg.org/#dom-eventtarget-addeventlistener
  addEventListener(
    type: string,
    callback: EventListenerValue | EventListenerCallback | null,
    options: AddListenerOptionsRecord | boolean = { capture: false, once: false },
  ): void {
    // https://dom.spec.whatwg.org/#event-flatten-more
    if (typeof options === 'boolean') options = { capture: options, once: false };
    const { capture, passive = null, once, signal = null } = options;
    const listener: EventListenerRecord = {
      abortAlgorithm: null,
      type,
      callback: callback === null ? null : EventListenerValue.from(callback),
      capture,
      passive,
      once,
      signal,
      removed: false,
    };

    this.#addListener(listener);
  }

  /** Remove the registration matching type, callback, and capture. */
  // https://dom.spec.whatwg.org/#dom-eventtarget-removeeventlistener
  removeEventListener(
    type: string,
    callback: EventListenerValue | EventListenerCallback | null,
    options: ListenerOptionsRecord | boolean = { capture: false },
  ): void {
    // https://dom.spec.whatwg.org/#concept-flatten-options
    const capture = typeof options === 'boolean' ? options : options.capture;
    const callbackValue = callback === null
      ? null
      : EventListenerValue.from(callback);
    const listener = this.#eventListenerList.find((candidate) =>
      candidate.type === type &&
      EventListenerValue.same(candidate.callback, callbackValue) &&
      candidate.capture === capture);

    if (listener) this.#removeListener(listener);
  }

  /** Dispatch synchronously, returning false if the event was canceled. */
  // https://dom.spec.whatwg.org/#dom-eventtarget-dispatchevent
  dispatchEvent(event: EventImpl): boolean {
    if (event.dispatching || !event.initialized) {
      throwDOMException(DOMExceptionNames.invalidState);
    }

    event.isTrusted = false;
    return this.#dispatch(event);
  }

  // -- Internal methods -------------------------------------------------

  /** Create and dispatch a trusted event, returning false if canceled. */
  // https://dom.spec.whatwg.org/#concept-event-fire
  fireEvent(
    name: string,
    eventConstructor?: EventImplConstructor,
    initialize?: (event: EventImpl) => void,
    legacyTargetOverride = false,
  ): boolean {
    const event = this.createEvent(eventConstructor);
    event.type = name;
    initialize?.(event);
    return this.#dispatch(event, legacyTargetOverride);
  }

  /** Create a trusted event in the environment supplied at construction. */
  createEvent(eventConstructor?: EventImplConstructor): EventImpl {
    return this.env.exec.createEvent(eventConstructor);
  }

  // https://dom.spec.whatwg.org/#remove-all-event-listeners
  removeAllEventListeners(): void {
    for (const listener of [...this.#eventListenerList]) {
      this.#removeListener(listener);
    }
  }

  /** The next dispatch target; subclasses define their event ancestry. */
  getEventParent(_event: EventImpl): EventTargetImpl | null {
    return null;
  }

  /** Return the original callback objects for Service Worker's legacy lookup. */
  // https://dom.spec.whatwg.org/#legacy-obtain-service-worker-fetch-event-listener-callbacks
  getEventListenerCallbacks(type: string): EventListenerOrEventListenerObject[] {
    const callbacks: EventListenerOrEventListenerObject[] = [];

    for (const listener of this.#eventListenerList) {
      if (listener.type === type && listener.callback !== null) {
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
    return null;
  }

  getShadowRootHost(): EventTargetImpl | null {
    return null;
  }

  getShadowRootMode(): ShadowRootMode | null {
    return null;
  }

  getAssignedSlot(): EventTargetImpl | null {
    return null;
  }

  isNode(): boolean {
    return false;
  }

  /** Whether this target is a node rooted in a shadow tree. */
  isNodeInShadowTree(): boolean {
    if (!this.isNode()) return false;

    const root = this.getTreeRoot();
    return root !== null && root.getShadowRootHost() !== null;
  }

  isWindow(): boolean {
    return false;
  }

  /** The exposed target for legacy dispatch, overridden by Window with its Document. */
  getLegacyTargetOverride(): EventTargetImpl {
    return this;
  }

  hasShadowIncludingInclusiveAncestor(_ancestor: EventTargetImpl): boolean {
    return false;
  }

  hasActivationBehavior(): boolean {
    // Dispatch selects the first target with an activation override.
    return this.runActivationBehavior !== EventTargetImpl.prototype.runActivationBehavior;
  }

  runActivationBehavior(_event: EventImpl): void {}

  hasLegacyPreActivationBehavior(): boolean {
    return this.runLegacyPreActivationBehavior !== EventTargetImpl.prototype.runLegacyPreActivationBehavior;
  }

  runLegacyPreActivationBehavior(): void {}

  hasLegacyCanceledActivationBehavior(): boolean {
    return this.runLegacyCanceledActivationBehavior !== EventTargetImpl.prototype.runLegacyCanceledActivationBehavior;
  }

  runLegacyCanceledActivationBehavior(): void {}

  protected isDefaultPassiveTarget(): boolean {
    return false;
  }

  protected addingEventListener(_type: string): void {}

  protected removingEventListener(_type: string): void {}

  protected eventListenerListChanged(_type: string): void {}

  // -- Private ----------------------------------------------------------

  // https://dom.spec.whatwg.org/#concept-event-dispatch
  #dispatch(
    event: EventImpl,
    legacyTargetOverride = false,
  ): boolean {
    event.dispatching = true;

    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Track the target as dispatch crosses shadow boundaries.
    let target: EventTargetImpl = this;
    const targetOverride = legacyTargetOverride
      ? target.getLegacyTargetOverride()
      : target;
    let activationTarget: EventTargetImpl | null = null;
    let relatedTarget = retarget(event.relatedTarget, target);
    let clearTargets = false;

    if (
      target !== relatedTarget ||
      target === event.relatedTarget
    ) {
      let touchTargets = event.touchTargetList
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
      let parent = target.getEventParent(event);

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

        relatedTarget = retarget(event.relatedTarget, parent);
        const parentForRetarget = parent;
        touchTargets = event.touchTargetList
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
          parent = parent.getEventParent(event);
        }
        slotInClosedTree = false;
      }

      const clearTargetsItem = event.path
        .findLast((item) => item.shadowAdjustedTarget !== null);

      if (clearTargetsItem) {
        clearTargets = clearTargetsItem.shadowAdjustedTarget?.isNodeInShadowTree() ||
          clearTargetsItem.relatedTarget?.isNodeInShadowTree() ||
          clearTargetsItem.touchTargetList.some((target) => target?.isNodeInShadowTree());
      }

      if (
        activationTarget !== null &&
        activationTarget.hasLegacyPreActivationBehavior()
      ) {
        activationTarget.runLegacyPreActivationBehavior();
      }

      for (const item of [...event.path].reverse()) {
        event.eventPhase = item.shadowAdjustedTarget === null
          ? EventPhase.Capturing
          : EventPhase.AtTarget;
        item.invocationTarget.#invoke(item, event, 'capturing');
      }

      for (const item of event.path) {
        if (item.shadowAdjustedTarget !== null) {
          event.eventPhase = EventPhase.AtTarget;
        } else {
          if (!event.bubbles) continue;
          event.eventPhase = EventPhase.Bubbling;
        }

        item.invocationTarget.#invoke(item, event, 'bubbling');
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

  /** Invoke this target's listeners for one entry in the event's dispatch path. */
  // https://dom.spec.whatwg.org/#concept-event-listener-invoke
  #invoke(
    pathItem: EventPathItem,
    event: EventImpl,
    phase: InvocationPhase,
  ): void {
    const path = event.path;
    let targetItemIndex = path.indexOf(pathItem);

    while (path[targetItemIndex]?.shadowAdjustedTarget === null) {
      targetItemIndex--;
    }

    const targetItem = path[targetItemIndex];
    if (!targetItem) throw new InternalError('An event path has no adjusted target');

    event.target = targetItem.shadowAdjustedTarget;
    event.relatedTarget = pathItem.relatedTarget;
    event.touchTargetList = [...pathItem.touchTargetList];

    if (event.propagationStopped) return;

    event.currentTarget = this;
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
    event.type = legacyType;
    this.#innerInvoke(
      event,
      listeners,
      phase,
      pathItem.invocationTargetInShadowTree,
    );
    event.type = originalType;
  }

  // https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
  #innerInvoke(
    event: EventImpl,
    listeners: EventListenerRecord[],
    phase: InvocationPhase,
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
      const windowRealm = callbackRealm?.isWindow()
        ? callbackRealm
        : undefined;
      const currentEvent = windowRealm?.getCurrentEvent();

      if (windowRealm && !invocationTargetInShadowTree) {
        windowRealm.setCurrentEvent(event);
      }
      if (listener.passive) event.inPassiveListener = true;
      windowRealm?.recordEventListenerTiming(event, callback.object);

      try {
        callback.invoke(event, this);
      } finally {
        event.inPassiveListener = false;
        windowRealm?.setCurrentEvent(currentEvent);
      }

      if (event.immediatePropagationStopped) break;
    }

    return found;
  }

  // https://dom.spec.whatwg.org/#default-passive-value
  #getDefaultPassiveValue(type: string): boolean {
    return DEFAULT_PASSIVE_EVENT_TYPES.has(type) &&
      this.isDefaultPassiveTarget();
  }

  // https://dom.spec.whatwg.org/#add-an-event-listener
  #addListener(listener: EventListenerRecord): void {
    this.addingEventListener(listener.type);

    if (
      listener.signal?.aborted ||
      listener.callback === null
    ) return;

    listener.passive ??= this.#getDefaultPassiveValue(listener.type);

    const duplicate = this.#eventListenerList.some((candidate) =>
      candidate.type === listener.type &&
      EventListenerValue.same(candidate.callback, listener.callback) &&
      candidate.capture === listener.capture);

    if (duplicate) return;

    this.#eventListenerList.push(listener);
    if (listener.signal) {
      listener.abortAlgorithm = listener.signal.addAlgorithm(
        () => this.#removeListener(listener),
      );
    }
    this.eventListenerListChanged(listener.type);
  }

  // https://dom.spec.whatwg.org/#remove-an-event-listener
  #removeListener(listener: EventListenerRecord): void {
    if (listener.removed) return;

    this.removingEventListener(listener.type);

    listener.removed = true;
    listener.abortAlgorithm?.remove();
    listener.abortAlgorithm = null;

    const index = this.#eventListenerList.indexOf(listener);
    if (index !== -1) this.#eventListenerList.splice(index, 1);
    this.eventListenerListChanged(listener.type);
  }
}

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
export const eventTargetIDL = defineInterface<DOMEnvironment>({
  name: 'EventTarget',
  exposed: '*',
  implementation: impl(EventTargetImpl, {
    constructWith: [atArg(0, (ctx) => ctx.getEnvironment())],
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

export const eventListenerIDL = defineCallbackInterface<DOMEnvironment>({
  name: 'EventListener',
  // Event dispatch retains the callback realm and original object identity in
  // addition to the callback-interface invocation steps.
  adapt(_ctx, callback) {
    return new EventListenerValue(
      callback.object,
      callback.realm,
      (event, currentTarget) => {
        // https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
        try {
          callback.callUserObjectOperation(
            'handleEvent',
            [event],
            currentTarget,
          );
        } catch (exception) {
          callback.realm.reportException(exception);
        }
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

/** Return the visible target across shadow boundaries without modifying either argument. */
// https://dom.spec.whatwg.org/#retarget
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

type EventListenerCallback = (this: EventTargetImpl, event: EventImpl) => void;

// https://dom.spec.whatwg.org/#concept-event-listener
type EventListenerRecord = {
  /** Handle for unregistering this listener's signal abort steps. */
  abortAlgorithm: AbortAlgorithmHandle | null;
  /** Event name matched against event.type. */
  type: string;
  /** Listener identity and invocation steps; null callbacks are not registered. */
  callback: EventListenerValue | null;
  /** Selects the capturing pass rather than the bubbling pass. */
  capture: boolean;
  /** Prevents cancellation; null selects the target's default passive policy. */
  passive: boolean | null;
  /** Remove the registration before its first invocation. */
  once: boolean;
  /** Removes the listener when aborted. */
  signal: AbortSignalImpl | null;
  /** Tracks removal even in a dispatch snapshot of the listener list. */
  removed: boolean;
};

type InvocationPhase = 'capturing' | 'bubbling';

interface ListenerOptionsRecord {
  capture: boolean;
}

interface AddListenerOptionsRecord extends ListenerOptionsRecord {
  once: boolean;
  passive?: boolean;
  signal?: AbortSignalImpl;
}

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

/** Retains a listener's identity, callback realm, and invocation steps. */
class EventListenerValue {
  /** Original callback object used to match registrations and removals. */
  readonly object: object;
  /** Callback realm, absent for direct implementation listeners. */
  readonly realm: EventRealm | undefined;
  #invoke: (
    event: EventImpl,
    currentTarget: EventTargetImpl,
  ) => void;

  constructor(
    object: object,
    realm: EventRealm | undefined,
    invoke: (event: EventImpl, currentTarget: EventTargetImpl) => void,
  ) {
    this.object = object;
    this.realm = realm;
    this.#invoke = invoke;
  }

  invoke(event: EventImpl, currentTarget: EventTargetImpl): void {
    this.#invoke(event, currentTarget);
  }

  static from(callback: EventListenerValue | EventListenerCallback): EventListenerValue {
    if (callback instanceof EventListenerValue) return callback;

    return new EventListenerValue(
      callback,
      undefined,
      (event, currentTarget) => callback.call(currentTarget, event),
    );
  }

  /** Compare the original callback objects retained by listener conversions. */
  static same(left: EventListenerValue | null, right: EventListenerValue | null): boolean {
    if (left === null || right === null) return left === right;
    return left.object === right.object;
  }
}
