import { arg, definePartialInterface, idlType, op } from '../../web-idl/core/index';

import { PointerEventImpl } from './events/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../dom/nodes/index';

/** Capture state for one pointer stream in one top-level context, separate from its UserAgent input source. */
// https://w3c.github.io/pointerevents/#process-pending-pointer-capture
// TODO(Pointer Events §§3.1.3, 8): the input producer must register active streams
// on their TopLevelTraversable and route delivery through PointerEventStream,
// which processes capture before ordinary input and after pointerup/pointercancel. Capture
// notifications themselves must not re-enter pending-capture processing.
export class PointerCapture {
  /** Next requested target; PointerEventStream validates requests before assigning it. */
  pendingTargetOverride: ElementImpl | null = null;
  /** Effective target selected by the most recent processing pass. */
  #targetOverride: ElementImpl | DocumentImpl | null = null;

  get targetOverride(): ElementImpl | DocumentImpl | null { return this.#targetOverride; }

  /** Deliver capture changes using the pointer event that triggered this processing pass. */
  processPendingPointerCapture(event: PointerEventImpl): void {
    this.clearDisconnectedTargets();
    const previous = this.#targetOverride;
    // SPEC_CLASH(pointer-capture-pending-snapshot): Snapshot like all three browsers; a literal live-state reading of the draft can apply listener requests in this pass.
    const pending = this.pendingTargetOverride;
    if (previous === pending) return;

    this.#targetOverride = null;
    if (previous) {
      this.#fireEvent('lostpointercapture', previous, event);
    }
    // A loss listener can disconnect the snapshotted new target. Do not gain capture there.
    // SPEC_CLASH(pointer-capture-removed-pending): Follow Chromium/Firefox; WebKit can emit a later loss for a target that never received capture.
    if (pending?.isConnected) {
      this.#fireEvent('gotpointercapture', pending, event);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The gain listener can disconnect the target.
      if (pending.isConnected) this.#targetOverride = pending;
      else this.#fireEvent('lostpointercapture', pending.nodeDocument, event);
    }
    this.clearDisconnectedTargets();
  }

  /** Correct connectivity when processing capture and redirect a still-disconnected effective target to its Document. */
  // https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture
  // DOM removal immediately releases pending requests through the top-level
  // stream owner. Effective capture remains until this processing pass.
  // SPEC_CLASH(pointer-capture-reinserted-loss): Follow Chromium/Firefox's deferred loss at a reconnected element; §8.5 recommends Document redirection on removal, and WebKit adds Document notifications.
  clearDisconnectedTargets(): void {
    const target = this.#targetOverride;
    if (target && !target.isConnected) {
      this.#targetOverride = target.nodeDocument;
      if (this.pendingTargetOverride === target) this.pendingTargetOverride = null;
    }
    // Avoid walking the same node's ancestry twice when the two overrides agree.
    if (this.pendingTargetOverride && this.pendingTargetOverride !== target && !this.pendingTargetOverride.isConnected) {
      this.pendingTargetOverride = null;
    }
  }

  /** Fire a capture notification at its explicit target without running the ordinary targeting algorithm. */
  #fireEvent(type: 'gotpointercapture' | 'lostpointercapture', target: NodeImpl, source: PointerEventImpl): void {
    target.fireEvent(type, PointerEventImpl, (event) => {
      const notification = event as PointerEventImpl;
      notification.copyInputFrom(source);
      notification.setPointerEventAttributes(type);
    });
  }
}

/*
 * partial interface Element {
 *   undefined setPointerCapture(long pointerId);
 *   undefined releasePointerCapture(long pointerId);
 *   boolean hasPointerCapture(long pointerId);
 * };
 */
export const elementPointerCaptureIDL = definePartialInterface({
  name: 'Element',
  members: [
    op('setPointerCapture', idlType.undefined, [arg('pointerId', idlType.long)]),
    op('releasePointerCapture', idlType.undefined, [arg('pointerId', idlType.long)]),
    op('hasPointerCapture', idlType.boolean, [arg('pointerId', idlType.long)]),
  ],
});
