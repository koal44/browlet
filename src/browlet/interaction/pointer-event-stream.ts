import { DOMExceptionImpl, DOMExceptionNames } from '../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../timing/index';
import type { EventPathItem } from '../dom/events/index';
import {
  PointerEventImpl, type PointerInputEventType, type PointerActivationEventType, type PointerEventSamples,
} from './events/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../dom/nodes/index';

import { PointerCapture } from './pointer-capture';

/** Targeting state for one pointer ID within one top-level context. */
// https://w3c.github.io/pointerevents/#firing-events-using-the-pointerevent-interface
// TODO(Pointer Events §3.1 / input producer): register each active context-local
// ID in TopLevelTraversable.pointerEventStreams, independently of UserAgent's source
// identity. Retirement and individual Document teardown must release capture and
// Document references; top-level teardown clears the retained stream map.
export class PointerEventStream {
  /** Context-local identifier assigned by the input owner, not the global source identity. */
  pointerId: number;
  /** Device capability supplied by the input owner, independent of its pointerType string. */
  isDirectManipulation: boolean;
  /** Whether the device can hover, supplied independently of direct-manipulation capability or pointerType. */
  supportsHover: boolean;
  /** Current normalized buttons for this context, updated before capture notifications or input listeners. */
  buttons = 0;
  /** Pending and effective capture belonging to this stream. */
  capture = new PointerCapture();
  /** Document selected by the most recent pointerdown, pointermove, or pointerup. */
  activeDocument: DocumentImpl | null = null;
  /** Last ordinary dispatch target, repaired along its dispatch path after removal. */
  previousTarget: NodeImpl | null = null;
  /** A removed target requires a new over notification even at the same surviving ancestor. */
  needsOverEvent = false;
  /** Pointer Lock's current locked-element state for the supplied Document. */
  // TODO(Pointer Lock): supply the owning Document's locked-element query when
  // composing the input producer. Do not assume an unlocked Document if unavailable.
  #hasLockedElement: (document: DocumentImpl) => boolean;
  /** Actual DOM dispatch path retained until the next ordinary input or stream retirement. */
  #previousPath: EventPathItem[] = [];
  /** Reused input snapshot, never projected or dispatched, so author reinitialization cannot change it. */
  #lastInput: PointerEventImpl | null = null;
  /** Press target retained until cancellation, the next press, or stream retirement. */
  #pointerDownTarget: NodeImpl | null = null;
  /** A delivered down awaiting up/cancel; activation history alone also survives pointerup. */
  #pointerDownSent = false;
  /** Private down/up snapshot survives capture release, hover restoration, and author reinitialization. */
  #activation: { input: PointerEventImpl; target: NodeImpl; captured: boolean; } | null = null;

  constructor(
    pointerId: number, isDirectManipulation: boolean, supportsHover: boolean, hasLockedElement: (document: DocumentImpl) => boolean,
  ) {
    this.pointerId = pointerId;
    this.isDirectManipulation = isDirectManipulation;
    this.supportsHover = supportsHover;
    this.#hasLockedElement = hasLockedElement;
  }

  /** Element ancestry follows the flattened tree used for pointer boundaries, including slots and hosts. */
  static #boundaryAncestors(target: NodeImpl | null): ElementImpl[] {
    const ancestors: ElementImpl[] = [];
    if (target === null || !target.isConnected) return ancestors;
    // SPEC_CLASH(pointer-boundary-document-entry): Notify Elements like the draft/Firefox/WebKit; Chromium also sends pointerenter to Document.
    for (let node: NodeImpl | null = target; node !== null; node = node.getFlatTreeParent()) {
      if (node.isElement()) ancestors.push(node);
    }
    return ancestors;
  }

  /**
   * Prepare normalized input, select its target, and request implicit capture before
   * boundary events or dispatch. Hit testing must use the current input position
   * and Document when called, after capture listeners have had a chance to run.
   */
  // Extract the preparation/target-selection steps; the caller supplies the
  // input snapshot and the hit-test dependency instead of implicit device state.
  // The input owner must supply a prepared event in the selected target's realm
  // to dispatchToTarget(). This method does not dispatch.
  // TODO(Pointer Events §§3.3.4–3.3.5 / input producer): changes to pressure,
  // angles, contact geometry, or chorded buttons also require move/raw updates.
  // Deliver raw before the corresponding move, using final coordinates for each
  // hit test. Task scheduling/coalescing remain producer work: provide the same
  // chronological inputs to raw and corresponding move delivery, flushing prior
  // movement before a later down/up. These primitives process one supplied event.
  // TODO(Pointer Events §§9.1–9.2 / input producer): accumulate those measured
  // snapshots, map timestamps to the delivery realm, and optionally predict future
  // samples. initializeSampleLists() enforces list invariants; it does not collect
  // device input, choose a prediction algorithm, or schedule delivery.
  // TODO(Pointer Events §§7.2–7.3 / input producer): capture DirectManipulation
  // permissions at the hit-tested element before down's author callbacks and
  // retain them for this contact. Consult every participant before pinch zoom;
  // use suppressForDirectManipulation() immediately before viewport takeover.
  // Selection and link/control activation do not consult touch-action permission.
  prepareTarget(type: PointerInputEventType, event: PointerEventImpl, hitTest: () => NodeImpl): NodeImpl {
    event.pointerId = this.pointerId;
    // SPEC_CLASH(pointer-capture-up-buttons): Use the released state per §8.2 and Chromium/WebKit; Firefox permits recapture during pointerup.
    this.buttons = event.buttons;
    event.setPointerEventAttributes(type);
    this.capture.processPendingPointerCapture(event);

    // https://w3c.github.io/pointerevents/#determine-the-target
    // TODO(Pointer Events hit test / CSSOM View elementFromPoint): the producer
    // must supply real geometry, including inert/disabled-element targeting.
    // The required callable keeps that dependency explicit without a default target.
    // SPEC_CLASH(pointer-hit-test-after-capture): Follow the draft/Firefox's post-notification hit test; Chromium/WebKit retain the earlier hit result for this event.
    const target = this.capture.targetOverride ?? hitTest();
    if (type === 'pointerdown' || type === 'pointermove' || type === 'pointerup') {
      this.activeDocument = target.nodeDocument;
    }
    // https://w3c.github.io/pointerevents/#implicit-pointer-capture
    if (type === 'pointerdown' && this.isDirectManipulation && target.isElement()) {
      this.setPointerCapture(target, event.buttons);
    }
    return target;
  }

  /**
   * Complete target preparation with boundary notifications and ordinary dispatch.
   * The input owner supplies the prepared non-boundary event in the target's realm.
   * Use suppress() to construct cancellation from the last delivered input.
   * After pointerup, getHoverTarget must hit test the current position, returning
   * null for a device without hover or a pointer outside this context.
   * A null hover target lets the next contact enter again before pointerdown.
   * Raw updates to insecure target documents are suppressed without retaining input.
   * Optional sample lists contain measured inputs and predictions, not dispatched events.
   * mouseClickCount comes from the input producer; pointer detail remains zero.
   * Returns false when the ordinary event was canceled; boundary cancellation is independent.
   */
  // https://w3c.github.io/pointerevents/#firing-events-using-the-pointerevent-interface
  // This extracts the dispatch/previous-target steps for an already prepared event and target.
  // §9 sample lists are supplied explicitly by the input producer as a final argument.
  // TODO(Pointer Events §11 / input producer): supply real click counting and mapped
  // relative movement. Compatibility dispatch does not infer timing/distance thresholds.
  dispatchToTarget(
    event: PointerEventImpl, target: NodeImpl, getHoverTarget: () => NodeImpl | null, mouseClickCount: number,
    samples?: PointerEventSamples,
  ): boolean {
    const type = event.type;
    // https://w3c.github.io/pointerevents/#the-pointerrawupdate-event
    // This is a native delivery restriction; author dispatch remains ordinary DOM dispatch.
    if (type === 'pointerrawupdate' && !target.nodeDocument.env.isSecureContext) return true;
    event.initializeSampleLists(samples, target);
    const input = this.#lastInput ??= new PointerEventImpl('', {}, 0);
    input.copyInputFrom(event);
    input.type = type;
    const mouse = input.isPrimary ? target.nodeDocument.legacyMousePointer : null;
    mouse?.preparePointerEvent(target);
    this.clearDisconnectedTarget();
    // §§3.3.1–3.3.2 require entry before a first non-hover pointerdown as well as
    // movement into a new target. Pressing while already hovering does not re-enter.
    // SPEC_CLASH(pointer-rawupdate-boundary-order): Follow the shared firing algorithm and Firefox; Chromium sends raw before the boundary transition.
    this.#sendBoundaryEvents(input, target);
    if (mouse !== null && (type === 'pointerdown' || type === 'pointermove' || type === 'pointerup')) {
      mouse.updatePosition(input, mouse.pointerTarget);
    }
    if (type === 'pointerdown' || type === 'pointerup') {
      if (type === 'pointerdown') this.#pointerDownTarget = target;
      const activation = this.#activation ??= { input: new PointerEventImpl('', {}, 0), target, captured: false };
      activation.input.copyInputFrom(input);
      activation.input.type = type;
      activation.target = target;
      activation.captured = this.capture.targetOverride !== null;
    } else if (type === 'pointercancel') {
      this.#pointerDownTarget = null;
      this.#activation = null;
    }
    let path: EventPathItem[] = [];
    if (type === 'pointerdown') this.#pointerDownSent = true;
    else if (type === 'pointerup' || type === 'pointercancel') this.#pointerDownSent = false;
    // SPEC_CLASH(pointer-target-after-boundary-mutation): Keep the selected target like the draft/Chromium/Firefox; WebKit can redirect after reparenting in a boundary listener.
    const result = target.dispatch(event, false, (dispatchPath) => { path = dispatchPath; });
    // The source snapshot survives author reinitialization and DOM retargeting.
    mouse?.dispatchAfterPointer(input, !result, mouseClickCount);
    this.previousTarget = target;
    this.needsOverEvent = false;
    this.#previousPath = path;
    this.clearDisconnectedTarget();
    if (type === 'pointerup' || type === 'pointercancel') {
      // https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture
      // SPEC_CLASH(pointer-implicit-release-order): Follow §8.5 and Chromium/Firefox: release immediately after up/cancel; §3.1.3.3 lists release after out/leave.
      this.capture.pendingTargetOverride = null;
      this.capture.processPendingPointerCapture(input);
      this.clearDisconnectedTarget();
      // Suppression exits even for a hover-capable device; do not re-enter a hit target.
      // SPEC_CLASH(pointer-up-hover-target): Restore the hit target per §8.5 and Chromium/Firefox; WebKit missed the destination in the captured-mouse probe.
      const hoverTarget = type === 'pointerup' ? getHoverTarget() : null;
      const hoverPath = this.#sendBoundaryEvents(input, hoverTarget);
      mouse?.updatePosition(input, hoverTarget);
      if (hoverPath !== null) this.#previousPath = hoverPath;
      this.previousTarget = hoverTarget;
      this.needsOverEvent = false;
      this.clearDisconnectedTarget();
      if (hoverTarget === null) {
        this.#previousPath = [];
        this.#lastInput = null;
      }
    }
    // TODO(Pointer Events §11 / UI Events and HTML): connect the mapped mouse
    // events to their default-action owners; cancellation does not undo input state.
    return result;
  }

  /**
   * Dispatch a producer-selected activation from the last down/up, returning whether it was uncanceled.
   * The producer supplies UI Events' click count (or context-menu detail). A canceled
   * stream or a click without a completed press/release pair produces no event.
   */
  // https://w3c.github.io/pointerevents/#event-dispatch
  // The stream retains userEvent's input/target/capture facts before author callbacks
  // and creates event in the selected target's realm instead of accepting a mutable event.
  // TODO(UI Events click/auxclick/contextmenu / input producer): invoke when a gesture
  // qualifies, including the platform's down-versus-up context-menu convention. This
  // operation does not recognize gestures, count clicks, or run unfinished default actions.
  // Do not route keyboard/voice activation through a pointer stream: its producer uses
  // PointerEventImpl.createActivation() with its unchanged target and non-pointer identity.
  dispatchActivation(type: PointerActivationEventType, detail: number): boolean {
    const activation = this.#activation;
    if (activation === null) return true;
    const { input, captured } = activation;
    if (type !== 'contextmenu' && (input.type !== 'pointerup' || this.#pointerDownTarget === null)) return true;
    let target: NodeImpl | null = activation.target;
    if (type !== 'contextmenu' && !captured) {
      // SPEC_CLASH(pointer-activation-live-ancestry): Use the current ancestry per the draft/Firefox; Chromium/WebKit suppress the probed reparented press.
      // SPEC_CLASH(pointer-activation-shadow-ancestry): Follow all three browsers through slots and shadow hosts; literal DOM ancestry cannot connect those targets.
      const ancestors = new Set<NodeImpl>();
      for (let node = this.#pointerDownTarget; node !== null; node = node.getFlatTreeParent()) ancestors.add(node);
      while (target !== null && !ancestors.has(target)) target = target.getFlatTreeParent();
    }
    if (target === null) return true;
    const event = PointerEventImpl.createActivation(type, target, input);
    event.pointerId = input.pointerId;
    event.pointerType = input.pointerType;
    event.detail = detail;
    // Capture may already be released. Activation neither processes pending capture
    // nor changes the ordinary stream's last-input, previous-target, or boundary state.
    return target.dispatch(event);
  }

  /**
   * Suppress an active direct-manipulation contact immediately before viewport takeover.
   * The producer must first accept the gesture using its DirectManipulation snapshot.
   * Returns whether a delivered down was still active and therefore required cancellation.
   */
  // https://w3c.github.io/pointerevents/#the-touch-action-css-property
  // Canceling pointerdown does not prohibit viewport manipulation. This checks
  // delivery state, independently of buttons, capture, or the canceled flag.
  suppressForDirectManipulation(hitTest: () => NodeImpl): boolean {
    if (!this.isDirectManipulation || !this.#pointerDownSent) return false;
    this.suppress(hitTest);
    return true;
  }

  /** Cancel the delivered stream using its retained input, release capture, and leave its boundaries. */
  // https://w3c.github.io/pointerevents/#suppressing-a-pointer-event-stream
  // The input owner supplies hit testing at the last input position, after capture processing.
  // TODO(Pointer Events §3.1.3.3 / input producer): invoke for device loss, modal UI,
  // HTML drag initiation, and other suppression triggers. Viewport takeover uses
  // suppressForDirectManipulation() after the producer's touch-action decision.
  suppress(hitTest: () => NodeImpl): void {
    const input = this.#lastInput;
    if (input === null) return;
    const target = this.prepareTarget('pointercancel', input, hitTest);
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    const timeStamp = event.timeStamp;
    // SPEC_CLASH(pointer-cancel-last-input): Preserve §3.3.7's last-input fields; Chromium resets pressure and sometimes coordinates, while Firefox can use a newer drag position.
    event.copyInputFrom(input);
    event.timeStamp = timeStamp;
    event.setPointerEventAttributes('pointercancel');
    this.dispatchToTarget(event, target, hitTest, 0);
  }

  /**
   * Refresh a stationary pointer's boundaries after layout, without dispatching a move.
   * Hit testing uses the retained input position; null means no target in this context.
   * The caller supplies its realm's current event timestamp and may coalesce layout changes.
   */
  // https://w3c.github.io/pointerevents/#events-from-layout-changes
  // §3.1.4 specifies this requirement without defining a separate callable algorithm.
  // TODO(Pointer Events §3.1.4 / layout and input producers): invoke after relevant
  // layout invalidation for retained streams. Supply real hit testing; schedule a
  // later pass for changes caused by listeners instead of recursing during dispatch.
  updateAfterLayout(hitTest: () => NodeImpl | null, timeStamp: DOMHighResTimeStamp): void {
    const input = this.#lastInput;
    if (input === null) return;
    input.timeStamp = timeStamp;
    input.button = -1;
    input.movementX = 0;
    input.movementY = 0;
    // SPEC_CLASH(pointer-layout-pending-capture): Follow the draft's capture-first order; Chromium interleaves boundaries before gain, while Firefox/WebKit deferred the request in the probe.
    this.capture.processPendingPointerCapture(input);
    this.clearDisconnectedTarget();
    const target = this.capture.targetOverride ?? hitTest();
    const path = this.#sendBoundaryEvents(input, target);
    if (path === null) return;
    if (input.isPrimary) {
      const document = target?.nodeDocument ?? this.previousTarget?.nodeDocument;
      document?.legacyMousePointer.updatePosition(input, target);
    }
    this.#previousPath = path;
    this.previousTarget = target;
    this.needsOverEvent = false;
    this.clearDisconnectedTarget();
  }

  /** Repair a removed previous target using its original dispatch path and require another over event. */
  // TODO(Pointer Events §3.1.3 / DOM removal): invoke during removal, before reinsertion.
  // The dispatch boundary also checks connectivity, but cannot detect a missed remove/reinsert.
  clearDisconnectedTarget(): void {
    if (this.previousTarget === null || this.previousTarget.isConnected) return;
    let passedPrevious = false;
    for (const item of this.#previousPath) {
      const node = item.invocationTarget;
      if (node === this.previousTarget) {
        passedPrevious = true;
      } else if (passedPrevious && node.isNode() && node.isConnected) {
        this.previousTarget = node;
        this.needsOverEvent = true;
        return;
      }
    }
    this.previousTarget = null;
    this.needsOverEvent = true;
  }

  /** Request capture for this resolved active pointer using its current button state. */
  // https://w3c.github.io/pointerevents/#setting-pointer-capture
  // Element.setPointerCapture resolves the active ID before calling this operation.
  setPointerCapture(element: ElementImpl, buttons: number): void {
    if (!element.isConnected || this.#hasLockedElement(element.nodeDocument)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    }
    if (buttons === 0 || element.nodeDocument !== this.activeDocument) return;
    this.capture.pendingTargetOverride = element;
  }

  /** Release this element's pending capture without delivering notifications yet. */
  // https://w3c.github.io/pointerevents/#releasing-pointer-capture
  // Element.releasePointerCapture resolves the active ID before calling this operation.
  // TODO(Pointer Events §8.5 / Pointer Lock success): when the unfinished lock
  // owner applies a lock, release each affected stream's pending capture here.
  // Effective loss is delivered by the next pending-capture processing pass.
  releasePointerCapture(element: ElementImpl): void {
    if (this.capture.pendingTargetOverride === element) this.capture.pendingTargetOverride = null;
  }

  /** Send a transition and return the over event's path, or null when no transition was needed. */
  #sendBoundaryEvents(event: PointerEventImpl, target: NodeImpl | null): EventPathItem[] | null {
    const previous = this.previousTarget;
    if (previous === target && !this.needsOverEvent) return null;

    // SPEC_CLASH(pointer-boundary-ancestor-snapshot): Snapshot before notifications like Firefox/WebKit; Chromium rebuilds after pointerout.
    const exited = PointerEventStream.#boundaryAncestors(previous);
    const entered = PointerEventStream.#boundaryAncestors(target);
    let leaveCount = exited.length;
    let enterCount = entered.length;
    while (leaveCount > 0 && enterCount > 0 && exited[leaveCount - 1] === entered[enterCount - 1]) {
      leaveCount--;
      enterCount--;
    }

    if (previous !== null && !this.needsOverEvent) this.#fireBoundary('pointerout', previous, target, event);
    for (let index = 0; index < leaveCount; index++) {
      this.#fireBoundary('pointerleave', exited[index]!, target, event);
    }
    if (target === null) return [];
    let path: EventPathItem[] = [];
    // SPEC_CLASH(pointer-boundary-removed-related-target): Keep the repaired previous target like Chromium/Firefox; WebKit uses null after removal.
    this.#fireBoundary('pointerover', target, previous, event, (dispatchPath) => { path = dispatchPath; });
    for (let index = enterCount - 1; index >= 0; index--) {
      this.#fireBoundary('pointerenter', entered[index]!, previous, event);
    }
    return path;
  }

  /** Allocate each notification in its target's realm; related-target retargeting remains DOM dispatch work. */
  #fireBoundary(
    type: PointerInputEventType, target: NodeImpl, relatedTarget: NodeImpl | null, source: PointerEventImpl,
    capturePath?: (path: EventPathItem[]) => void,
  ): void {
    if (type === 'pointerover' && source.isPrimary && !this.supportsHover && !this.#pointerDownSent) {
      target.nodeDocument.legacyMousePointer.dispatchInitialMove(source, target);
    }
    const notification = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    notification.copyInputFrom(source);
    notification.setPointerEventAttributes(type);
    // SPEC_CLASH(pointer-boundary-related-target): Use the opposite target like all browsers; the draft's boundary tables reverse the entering/leaving descriptions.
    notification.relatedTarget = relatedTarget;
    target.dispatch(notification, false, capturePath);
  }
}
