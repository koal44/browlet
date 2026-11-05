import { InternalError } from '../../../infra/index';

import { unsafeSharedCurrentTime, type UnsafeMoment } from '../../timing/index';
import { userInteractionTaskSource } from '../../scripting/index';
import { WheelEventImpl, type MouseEventInput } from '../events/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../dom/nodes/index';

/** Queued wheel delivery and the current gesture target for one Document. */
// Document ownership, receipt snapshots, and task entry are Browlet integration.
// The delivery method below applies Pointer Events §12's transaction and event rules.
export class WheelInputProcessor {
  /** Receiving viewport and task/lifetime owner; cross-document routing precedes this entry. */
  #document: DocumentImpl;
  /** Initial target retained until the adapter ends/restarts the gesture or removal invalidates it. */
  #target: ElementImpl | null = null;
  /** Activity loss invalidates queued input, even if this Document becomes active again later. */
  #generation = 0;

  constructor(document: DocumentImpl) {
    this.#document = document;
  }

  /**
   * Queue normalized input in this Document's viewport coordinates.
   * The adapter identifies gesture starts, including any timeout for devices without phases;
   * momentum updates remain in that gesture. Buttons/modifiers describe input at receipt.
   * Locked input must arrive at the lock's Document; its acquisition snapshot supplies coordinates.
   */
  // https://w3c.github.io/pointerevents/#events-wheelevents
  // §12 leaves timing implementation-specific. A required flag makes the adapter's
  // decision explicit; no timer, polling, or guessed physical-unit conversion lives here.
  queue(input: WheelInput): void {
    const lock = this.#document.env.userAgent.pointerLock;
    const lockedTarget = lock.target?.nodeDocument === this.#document ? lock.target : null;
    const generation = lock.generation;
    const action = { ...input, ...(lockedTarget === null ? null : lock.position) };
    const time = unsafeSharedCurrentTime();
    this.#queueTask(() => {
      if (lockedTarget !== null && (lock.generation !== generation || lockedTarget.nodeDocument !== this.#document)) return;
      this.#deliver(action, time);
    });
  }

  /** Queue a gesture-end notification after earlier input, without inventing a zero-delta event. */
  queueEnd(): void {
    this.#queueTask(() => { this.#target = null; });
  }

  /** Release retained state and invalidate pending input during Document teardown or inactivity. */
  clear(): void {
    this.#target = null;
    this.#generation++;
  }

  /** End target retention as soon as its subtree is unlinked, including remove/reinsert. */
  // SPEC_GAP(wheel-removed-target): §12 does not define removal recovery; end retention before reinsertion, as Blink's ElementRemoved hook does.
  removedFrom(node: NodeImpl): void {
    if (this.#target?.hasShadowIncludingInclusiveAncestor(node)) this.#target = null;
  }

  /** Select the topmost eligible Element at these viewport coordinates, or no target. */
  // https://w3c.github.io/pointerevents/#events-wheelevents
  // https://drafts.csswg.org/cssom-view/#dom-document-elementfrompoint
  // TODO(CSSOM View hit testing / HTML inertness and input eligibility): connect
  // layout's painted target, text-run containment, and disabled/inert eligibility.
  // Native/automation routing and coordinate translation into child Documents
  // must precede queue(); this operation must return an Element of this Document.
  hitTest(_clientX: number, _clientY: number): ElementImpl | null {
    throw new InternalError('Wheel input requires layout hit testing and input eligibility');
  }

  /** Query this Document's actual locked pointer target, rather than assuming unlocked input. */
  // https://w3c.github.io/pointerlock/#dfn-pointer-lock-state
  // queue() retains Pointer Lock's frozen coordinates alongside the measured deltas.
  getLockedElement(): ElementImpl | null {
    const target = this.#document.env.userAgent.pointerLock.target;
    return target?.nodeDocument === this.#document ? target : null;
  }

  /** Apply the environment's scrolling or zooming action using private input after uncanceled delivery. */
  // https://w3c.github.io/pointerevents/#events-wheel-types
  // https://drafts.csswg.org/cssom-view/#scrolling
  // TODO(CSSOM View/layout / native input preferences): choose the scrollable
  // target, resolve line/page units and axis policy, or apply the platform zoom
  // action. Do not infer zoom from ctrlKey alone or change event deltas here.
  applyDefaultAction(_target: ElementImpl, _input: WheelInput): void {
    throw new InternalError('Wheel input requires scrolling or zooming from layout and native input owners');
  }

  /** Deliver one normalized wheel update through §12's retained-target and cancellation rules. */
  // https://w3c.github.io/pointerevents/#events-wheelevents
  // https://w3c.github.io/pointerevents/#events-wheel-types
  #deliver(input: WheelInput, time: UnsafeMoment): void {
    if (input.startsTransaction) this.#target = null;
    const locked = this.getLockedElement();
    if (locked !== null) this.#target = locked;
    const target = this.#target ?? this.hitTest(input.clientX, input.clientY);
    if (target === null) return;
    if (target.nodeDocument !== this.#document) {
      throw new InternalError('Wheel input target requires routing into its receiving Document');
    }
    if (!target.isConnected) {
      this.#target = null;
      return;
    }
    this.#target = target;

    // Creation belongs to the target's realm, even for an adopted Element.
    // The current Document supplies view; the receipt time is translated once.
    const event = target.createTrustedEvent(WheelEventImpl) as WheelEventImpl;
    event.initializeMouseEvent('wheel', target, true, false, input);
    event.timeStamp = target.env.realm.eventTimeStamp(time);
    event.composed = true;
    event.isTrusted = true;
    event.deltaX = input.deltaX;
    event.deltaY = input.deltaY;
    event.deltaZ = input.deltaZ;
    event.deltaMode = input.deltaMode;
    event.momentum = input.momentum;
    // SPEC_CLASH(wheel-related-target): Use null like all three browsers; §12's table names the pointer's current target.
    event.relatedTarget = null;
    // SPEC_CLASH(native-wheel-which): Keep MouseEvent's button+1 rule like Firefox/WebKit; Chromium reports zero for native wheel input.
    // No separate legacy state is needed: initializeMouseEvent supplies button=0.

    const uncanceled = target.dispatch(event, false, (path) => {
      // Observe DOM's actual path before listeners, including slots, shadow roots,
      // and Window. Do not rebuild ancestry or cache listener state separately.
      // https://dom.spec.whatwg.org/#observing-event-listeners
      // https://w3c.github.io/pointerevents/#cancelability-of-wheel-events
      // SPEC_CLASH(wheel-passive-cancelability): Follow the draft/Chromium/Firefox; WebKit still marks passive-only wheel input cancelable.
      event.cancelable = path.some((item) => item.invocationTarget.hasNonPassiveEventListener('wheel'));
    });
    // Cancellation blocks this action, not the whole gesture. Only adapter end/start
    // or owner lifetime/removal changes release the retained target.
    // SPEC_CLASH(wheel-canceled-transaction): Retain the gesture target under §12; Blink also clears its target when a wheel event is canceled.
    if (uncanceled && this.#isLive() && target.nodeDocument === this.#document) {
      this.applyDefaultAction(target, input);
    }
  }

  /** Use the existing user-interaction task source and discard stale Document input. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#user-interaction-task-source
  #queueTask(deliver: () => void): void {
    if (!this.#isLive()) throw new InternalError('Wheel input requires a live, fully active Document');
    const generation = this.#generation;
    this.#document.env.realm.queueGlobalTask(userInteractionTaskSource, () => {
      if (generation !== this.#generation || !this.#isLive()) return;
      deliver();
    });
  }

  #isLive(): boolean {
    const document = this.#document;
    const navigable = document.getNodeNavigable();
    return navigable !== null && document.isFullyActive() &&
      document.env.userAgent.topLevelTraversableSet.has(navigable.topLevelTraversable);
  }
}

/** Post-normalization native/automation data; these are not Web IDL constructor inputs. */
export interface WheelInput extends MouseEventInput {
  /** True on the first update of a new gesture; false on continuing and momentum updates. */
  startsTransaction: boolean;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  /** Native input must select pixels, lines, or pages; author-created events have ordinary unsigned-long conversion. */
  deltaMode: 0 | 1 | 2;
  momentum: boolean;
}
