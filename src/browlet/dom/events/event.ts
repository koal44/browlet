import type { DOMEnvironment } from '../environment';
import {
  arg, atArg, attr, constant, ctor, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, nullable, op, roAttr, reference, sequence, xattr,
} from '../../../web-idl/index';
import { unsafeSharedCurrentTime, type DOMHighResTimeStamp } from '../../performance/high-resolution-time';
import type { EventTargetImpl } from './event-target';
import { InternalError } from '../../../infra/internal-error';

/** Carries event data and the state used by dispatch and cancellation. */
// https://dom.spec.whatwg.org/#interface-event
export class EventImpl {
  /** Name used to select registered listeners. */
  type = '';
  /** Dispatch target, retargeted for the current listener. */
  target: EventTargetImpl | null = null;
  /** Secondary target, retargeted for the current listener. */
  relatedTarget: EventTargetImpl | null = null;
  /** Touch targets, retargeted for the current listener. */
  touchTargetList: (EventTargetImpl | null)[] = [];
  /** Target whose listeners are currently being invoked. */
  currentTarget: EventTargetImpl | null = null;
  /** Dispatch entries in target-to-root order; cleared after dispatch. */
  path: EventPathItem[] = [];
  /** Current dispatch phase; None outside dispatch. */
  eventPhase: EventPhase = EventPhase.None;

  /** Prevents dispatch from invoking listeners on further targets. */
  propagationStopped = false;
  /** Also prevents the remaining listeners on the current target. */
  immediatePropagationStopped = false;
  /** Whether cancellation has been accepted. */
  defaultPrevented = false;
  /** Suppresses cancellation while a passive listener is running. */
  inPassiveListener = false;
  /** Whether ancestor listeners participate in the bubbling phase. */
  bubbles = false;
  /** Whether preventDefault() can cancel this event. */
  cancelable = false;
  /** Whether dispatch can cross shadow-root boundaries. */
  composed = false;

  /** Whether initialization has made the event eligible for dispatch. */
  initialized = false;
  /** Prevents redispatch and legacy reinitialization during dispatch. */
  dispatching = false;
  /** Whether the event was created by the user agent rather than author dispatch. */
  isTrusted = false;
  /** Creation time in milliseconds, using the event creator's clock. */
  timeStamp: DOMHighResTimeStamp;

  // https://dom.spec.whatwg.org/#dom-event-event
  constructor(
    type: string,
    eventInitDict: EventInitRecord | null = {},
    timeStamp = unsafeSharedCurrentTime().milliseconds,
  ) {
    const init = eventInitDict ?? {};

    this.timeStamp = timeStamp;
    this.#initialize(
      type,
      init.bubbles ?? false,
      init.cancelable ?? false,
    );
    this.composed = init.composed ?? false;
  }

  static is(value: unknown): value is EventImpl {
    return value instanceof EventImpl;
  }

  /** @deprecated Legacy alias of target. */
  // https://dom.spec.whatwg.org/#dom-event-srcelement
  get srcElement(): EventTargetImpl | null {
    return this.target;
  }

  /** Return dispatch targets visible from the current listener's shadow-tree position. */
  // https://dom.spec.whatwg.org/#dom-event-composedpath
  composedPath(): EventTargetImpl[] {
    const composedPath: EventTargetImpl[] = [];
    const path = this.path;
    if (path.length === 0) return composedPath;

    const currentTarget = this.currentTarget;
    if (currentTarget === null) {
      throw new InternalError('An event with a path must have a current target');
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
      throw new InternalError('An event path must contain its current target');
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

  /** Prevent dispatch from invoking listeners on further targets. */
  // https://dom.spec.whatwg.org/#dom-event-stoppropagation
  stopPropagation(): void {
    this.propagationStopped = true;
  }

  /** @deprecated Legacy propagation flag; assigning false cannot clear it. */
  // https://dom.spec.whatwg.org/#dom-event-cancelbubble
  get cancelBubble(): boolean {
    return this.propagationStopped;
  }

  set cancelBubble(value: boolean) {
    if (value) this.propagationStopped = true;
  }

  /** Stop propagation and skip remaining listeners on the current target. */
  // https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation
  stopImmediatePropagation(): void {
    this.propagationStopped = true;
    this.immediatePropagationStopped = true;
  }

  /** @deprecated False when canceled; assigning false requests cancellation. */
  // https://dom.spec.whatwg.org/#dom-event-returnvalue
  get returnValue(): boolean {
    return !this.defaultPrevented;
  }

  set returnValue(value: boolean) {
    if (!value) this.#setCanceled();
  }

  /** Cancel a cancelable event unless the current listener is passive. */
  // https://dom.spec.whatwg.org/#dom-event-preventdefault
  preventDefault(): void {
    this.#setCanceled();
  }

  /** @deprecated Reinitialize an idle event without changing its timestamp or composed flag. */
  // https://dom.spec.whatwg.org/#dom-event-initevent
  initEvent(type: string, bubbles = false, cancelable = false): void {
    if (this.dispatching) return;

    this.#initialize(type, bubbles, cancelable);
  }

  // -- Internal methods -------------------------------------------------

  /** Append a dispatch target with its retargeted values and shadow-tree visibility flags. */
  // https://dom.spec.whatwg.org/#concept-event-path-append
  appendToPath(
    invocationTarget: EventTargetImpl,
    shadowAdjustedTarget: EventTargetImpl | null,
    relatedTarget: EventTargetImpl | null,
    touchTargetList: (EventTargetImpl | null)[],
    slotInClosedTree: boolean,
  ): void {
    this.path.push({
      invocationTarget,
      invocationTargetInShadowTree: invocationTarget.isNodeInShadowTree(),
      shadowAdjustedTarget,
      relatedTarget,
      touchTargetList,
      rootOfClosedTree: invocationTarget.getShadowRootMode() === 'closed',
      slotInClosedTree,
    });
  }

  /** Set dispatch flags during internal event creation, retaining its trusted status. */
  setFlags(init: EventInitRecord): void {
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
    this.composed = init.composed ?? false;
  }

  /** Clear transient dispatch state and, when needed, targets hidden by shadow boundaries. */
  // Final cleanup from https://dom.spec.whatwg.org/#concept-event-dispatch
  finishDispatch(clearTargets: boolean): void {
    this.eventPhase = EventPhase.None;
    this.currentTarget = null;
    this.path = [];
    this.dispatching = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;

    if (clearTargets) {
      this.target = null;
      this.relatedTarget = null;
      this.touchTargetList = [];
    }
  }

  // -- Private ----------------------------------------------------------

  // https://dom.spec.whatwg.org/#concept-event-initialize
  #initialize(
    type: string,
    bubbles: boolean,
    cancelable: boolean,
  ): void {
    this.initialized = true;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
    this.defaultPrevented = false;
    this.isTrusted = false;
    this.target = null;
    this.type = type;
    this.bubbles = bubbles;
    this.cancelable = cancelable;
  }

  // https://dom.spec.whatwg.org/#set-the-canceled-flag
  #setCanceled(): void {
    if (this.cancelable && !this.inPassiveListener) {
      this.defaultPrevented = true;
    }
  }
}

/** The event's position in the dispatch sequence. */
// https://dom.spec.whatwg.org/#dom-event-eventphase
export enum EventPhase {
  None = 0,
  Capturing = 1,
  AtTarget = 2,
  Bubbling = 3,
}

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
 */
export const eventIDL = defineInterface<DOMEnvironment>({
  name: 'Event',
  exposed: '*',
  implementation: impl(EventImpl, {
    constructWith: [atArg(2, (ctx) => ctx.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('EventInit'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('type', idlType.DOMString),
    roAttr('target', nullable(reference('EventTarget'))),
    roAttr('srcElement', nullable(reference('EventTarget'))),
    roAttr('currentTarget', nullable(reference('EventTarget'))),
    op('composedPath', sequence(reference('EventTarget'))),
    constant('NONE', idlType.unsignedShort, integer(EventPhase.None)),
    constant('CAPTURING_PHASE', idlType.unsignedShort, integer(EventPhase.Capturing)),
    constant('AT_TARGET', idlType.unsignedShort, integer(EventPhase.AtTarget)),
    constant('BUBBLING_PHASE', idlType.unsignedShort, integer(EventPhase.Bubbling)),
    roAttr('eventPhase', idlType.unsignedShort),
    op('stopPropagation', idlType.undefined),
    attr('cancelBubble', idlType.boolean),
    op('stopImmediatePropagation', idlType.undefined),
    roAttr('bubbles', idlType.boolean),
    roAttr('cancelable', idlType.boolean),
    attr('returnValue', idlType.boolean),
    op('preventDefault', idlType.undefined),
    roAttr('defaultPrevented', idlType.boolean),
    roAttr('composed', idlType.boolean),
    roAttr('isTrusted', idlType.boolean, xattr('LegacyUnforgeable')),
    roAttr('timeStamp', reference('DOMHighResTimeStamp')),
    op('initEvent', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('bubbles', idlType.boolean, { default: false, optional: true }),
      arg('cancelable', idlType.boolean, {
        default: false,
        optional: true,
      }),
    ]),
  ],
});

/** Event flags accepted by constructors and internal event creation. */
export type EventInitRecord = {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
};

/*
 * dictionary EventInit {
 *   boolean bubbles = false;
 *   boolean cancelable = false;
 *   boolean composed = false;
 * };
 */
export const eventInitIDL = defineDictionary({
  name: 'EventInit',
  members: [
    dictMember('bubbles', idlType.boolean, { default: false }),
    dictMember('cancelable', idlType.boolean, { default: false }),
    dictMember('composed', idlType.boolean, { default: false }),
  ],
});

/** An event carrying an arbitrary value supplied by its creator. */
// https://dom.spec.whatwg.org/#interface-customevent
export class CustomEventImpl<T = unknown> extends EventImpl {
  /** Payload exposed unchanged to event listeners. */
  detail: T;

  // https://dom.spec.whatwg.org/#dom-customevent-customevent
  constructor(
    type: string,
    eventInitDict: CustomEventInitRecord<T> | null = {},
    timeStamp = unsafeSharedCurrentTime().milliseconds,
  ) {
    const init = eventInitDict ?? {};

    super(type, init, timeStamp);
    this.detail = (init.detail === undefined ? null : init.detail) as T;
  }

  /** @deprecated Reinitialize an idle event and replace its detail. */
  // https://dom.spec.whatwg.org/#dom-customevent-initcustomevent
  initCustomEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    detail: T = null as T,
  ): void {
    if (this.dispatching) return;

    this.initEvent(type, bubbles, cancelable);
    this.detail = detail;
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
 */
export const customEventIDL = defineInterface<DOMEnvironment>({
  name: 'CustomEvent',
  inherits: 'Event',
  exposed: '*',
  implementation: impl(CustomEventImpl, {
    constructWith: [atArg(2, (ctx) => ctx.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('CustomEventInit'), {
        default: emptyDictionary,
        optional: true,
      }),
    ]),
    roAttr('detail', idlType.any),
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
});

/** Event flags and payload accepted by custom-event creation. */
export interface CustomEventInitRecord<T = unknown> extends EventInitRecord {
  detail?: T;
}

/*
 * dictionary CustomEventInit : EventInit {
 *   any detail = null;
 * };
 */
export const customEventInitIDL = defineDictionary({
  name: 'CustomEventInit',
  inherits: 'EventInit',
  members: [dictMember('detail', idlType.any, { default: null })],
});

/** One dispatch target and the event values visible at that point in the path. */
// https://dom.spec.whatwg.org/#event-path
export type EventPathItem = {
  /** Target whose listeners this entry invokes. */
  invocationTarget: EventTargetImpl;
  /** Whether that target is a node inside a shadow tree, affecting Window.event. */
  invocationTargetInShadowTree: boolean;
  /** Target visible from this entry; null retains the preceding entry's target. */
  shadowAdjustedTarget: EventTargetImpl | null;
  /** Secondary target as seen from this invocation target. */
  relatedTarget: EventTargetImpl | null;
  /** Touch targets as seen from this invocation target. */
  touchTargetList: (EventTargetImpl | null)[];
  /** Whether this entry's target is a closed shadow root. */
  rootOfClosedTree: boolean;
  /** Whether dispatch reached this entry through a slot in a closed shadow tree. */
  slotInClosedTree: boolean;
};
