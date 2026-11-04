import { MouseEventImpl, type MouseBoundaryType, type PointerEventImpl } from '../events/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../dom/nodes/index';

/** One Document's compatibility mouse delivery, shared by all primary pointer types. */
// https://w3c.github.io/pointerevents/#tracking-the-effective-position-of-the-legacy-mouse-pointer
export class LegacyMousePointer {
  /** Owner of the shared position, suppression flags, and cancellation's Window target. */
  #document: DocumentImpl;
  /** Last target, or its surviving ancestor after removal. Null means outside the window. */
  #target: NodeImpl | null = null;
  /** Selected pointer target retained through boundary callbacks, before the mouse position is updated. */
  #pointerTarget: NodeImpl | null = null;
  /** Removal requires a fresh over notification even if hit testing selects the surviving ancestor. */
  #needsOverEvent = false;
  /** Canceled primary downs suppress ordinary compatibility events for their pointer type until up/cancel. */
  #preventMouseEvent = new Set<string>();

  constructor(document: DocumentImpl) {
    this.#document = document;
  }

  /** Replace a removed target using its ancestry at the unlink point. */
  static #repairTarget(target: NodeImpl | null, removed: NodeImpl, parent: NodeImpl): NodeImpl | null {
    if (target === null || target.isConnected || !removed.isShadowIncludingInclusiveAncestor(target)) return target;
    return parent.isConnected ? parent.isShadowRoot() ? parent.host : parent : null;
  }

  /** Snapshot Element ancestors in the flat tree, including assigned slots and shadow hosts. */
  static #ancestors(target: NodeImpl | null): ElementImpl[] {
    const ancestors: ElementImpl[] = [];
    if (target === null || !target.isConnected) return ancestors;
    // SPEC_CLASH(mouse-boundary-document-entry): Notify Elements per §11/Firefox/WebKit; Chromium also sends mouseenter to Document.
    for (let node: NodeImpl | null = target; node !== null; node = node.getFlatTreeParent()) {
      if (node.isElement()) ancestors.push(node);
    }
    return ancestors;
  }

  get target(): NodeImpl | null { return this.#target; }
  get pointerTarget(): NodeImpl | null { return this.#pointerTarget; }

  /** Retain a primary input's selected target before pointer boundary listeners can remove it. */
  preparePointerEvent(target: NodeImpl): void {
    this.#pointerTarget = target;
  }

  /**
   * Update from a primary input and its selected target in this Document, or null for window exit.
   * Boundary cancellation never suppresses the remaining transition or future input.
   */
  // The target is explicit because this runs before dispatch assigns E.target.
  // PointerEventStream calls before primary down/up/move and at window exit,
  // even when PREVENT MOUSE EVENT is set. Synthetic dispatch must not call it.
  // Layout/hit testing and native input scheduling remain required producer inputs;
  // this does not guess a target.
  updatePosition(event: PointerEventImpl, target: NodeImpl | null): void {
    if (!event.isPrimary) return;
    const previous = this.#target;
    const removed = this.#needsOverEvent;
    if (previous === target && !removed) return;

    // SPEC_CLASH(mouse-boundary-ancestor-snapshot): Snapshot before notifications like Firefox/WebKit; Chromium rebuilds after mouseout.
    const exited = LegacyMousePointer.#ancestors(previous);
    const entered = LegacyMousePointer.#ancestors(target);
    let leaveCount = exited.length;
    let enterCount = entered.length;
    while (leaveCount > 0 && enterCount > 0 && exited[leaveCount - 1] === entered[enterCount - 1]) {
      leaveCount--;
      enterCount--;
    }

    // Retain the selected target before author callbacks so removal can repair it
    // immediately, including a remove/reinsert. The snapshots still determine this transition.
    this.#target = target;
    this.#needsOverEvent = false;
    if (previous !== null && !removed) this.#fireBoundary('mouseout', previous, target, event);
    for (let index = 0; index < leaveCount; index++) {
      this.#fireBoundary('mouseleave', exited[index]!, target, event);
    }
    if (target === null) return;
    // SPEC_CLASH(mouse-boundary-removed-related-target): Chromium/Firefox retain the repaired ancestor; WebKit uses null after removal.
    this.#fireBoundary('mouseover', target, previous, event);
    for (let index = enterCount - 1; index >= 0; index--) {
      this.#fireBoundary('mouseenter', entered[index]!, previous, event);
    }
  }

  /** Send §10.3's initial mousemove before a non-hover contact's pointerover. */
  // §10 permits delayed gesture grouping; use its immediate interleaving algorithm.
  // SPEC_CLASH(compatibility-mouse-touch-timing): Chromium/Firefox defer touch mouse delivery until release; WebKit delivered none in the probe.
  // TODO(Touch Events §7): when implementing that producer, do not also emit its fallback mouse sequence.
  dispatchInitialMove(input: PointerEventImpl, target: NodeImpl): void {
    target.dispatch(MouseEventImpl.fromPointerEvent('mousemove', target, input, 0));
  }

  /** Map one primary pointer result, preserving the private input snapshot and pointer cancellation result. */
  // https://w3c.github.io/pointerevents/#mapping-for-devices-that-support-hover
  // https://w3c.github.io/pointerevents/#mapping-for-devices-that-do-not-support-hover
  // Dispatch preparation and completion straddle PointerEventStream's existing DOM
  // dispatch. The producer supplies mouse click count independently of pointer detail.
  // TODO(Pointer Events §11 / HTML focus, editing, drag-and-drop): dispatch alone
  // does not perform mouse default actions. Their owners must consume cancellation.
  dispatchAfterPointer(input: PointerEventImpl, canceled: boolean, clickCount: number): void {
    const { type, pointerType } = input;
    if (type === 'pointerdown' && canceled) this.#preventMouseEvent.add(pointerType);
    // §10 forbids suppressing hover; an outside release may have supplied no up.
    if (type === 'pointermove' && input.buttons === 0) this.#preventMouseEvent.delete(pointerType);

    if (!this.#preventMouseEvent.has(pointerType)) {
      let mouseType: 'mousedown' | 'mousemove' | 'mouseup' | null = null;
      if (type === 'pointerdown') { mouseType = 'mousedown'; }
      else if (type === 'pointerup' || type === 'pointercancel') { mouseType = 'mouseup'; }
      else if (type === 'pointermove') {
        if (input.button < 0) { mouseType = 'mousemove'; }
        else {
          // SPEC_CLASH(compatibility-mouse-chords): Preserve native button transitions per §11/all browsers; §10's literal list maps all pointermove to mousemove.
          const mask = input.button === 1 ? 4 : input.button === 2 ? 2 : 1 << input.button;
          mouseType = (input.buttons & mask) !== 0 ? 'mousedown' : 'mouseup';
        }
      }
      // SPEC_CLASH(compatibility-mouse-removed-target): Use the repaired ancestor even after reinsertion, like Chromium/Firefox; WebKit drops or retargets the probed down.
      const target = type === 'pointercancel' ? this.#document.getRelevantGlobalObject() : this.#pointerTarget;
      if (mouseType !== null && target !== null) {
        target.dispatch(MouseEventImpl.fromPointerEvent(mouseType, target, input, clickCount));
      }
    }
    if (type === 'pointerup' || type === 'pointercancel') this.#preventMouseEvent.delete(pointerType);
    this.#pointerTarget = null;
  }

  /** Repair the effective position immediately after unlinking, before removal callbacks or reinsertion. */
  // https://w3c.github.io/pointerevents/#compatibility-mapping-with-mouse-events
  // Use ancestry at removal time, not the old event's dispatch path. No event is fired here.
  removedFrom(removed: NodeImpl, parent: NodeImpl): void {
    const target = LegacyMousePointer.#repairTarget(this.#target, removed, parent);
    if (target !== this.#target) {
      this.#target = target;
      this.#needsOverEvent = true;
    }
    this.#pointerTarget = LegacyMousePointer.#repairTarget(this.#pointerTarget, removed, parent);
  }

  /** Release retained targets when the owning Document is destroyed. */
  clear(): void {
    this.#target = null;
    this.#pointerTarget = null;
    this.#needsOverEvent = false;
    this.#preventMouseEvent.clear();
  }

  /** Allocate each notification in its target's realm; DOM owns target and relatedTarget retargeting. */
  #fireBoundary(type: MouseBoundaryType, target: NodeImpl, relatedTarget: NodeImpl | null, source: PointerEventImpl): void {
    const event = MouseEventImpl.fromPointerEvent(type, target, source, 0);
    // SPEC_CLASH(mouse-boundary-related-target): Use the opposite target, following all browsers rather than the reversed §11 table wording.
    event.relatedTarget = relatedTarget;
    target.dispatch(event);
  }
}
