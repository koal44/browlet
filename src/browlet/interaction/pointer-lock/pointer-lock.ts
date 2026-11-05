import { InternalError, ParallelQueue, type InternalPromise, type InternalPromiseWithResolvers } from '../../../infra/index';
import {
  arg, defineDictionary, definePartialInterface, definePartialInterfaceMixin, dictMember,
  DOMExceptionImpl, DOMExceptionNames, type DOMExceptionName, emptyDictionary, idlType, nullable, op, promise, reference, roAttr,
} from '../../../web-idl/core/index';

import { eventHandlerMapAttr, userInteractionTaskSource } from '../../scripting/index';
import type { MousePosition, ScreenPosition } from '../events/index';
import type { DocumentImpl, ElementImpl } from '../../dom/nodes/index';
import type { UserAgent } from '../../user-agent';

/** The UserAgent's pointer lock and its ordered request queue. */
// https://w3c.github.io/pointerlock/#pointerlockandinterfaces
export class PointerLock {
  #userAgent: UserAgent;
  #requests: ParallelQueue;
  #lock: PointerLockState | null = null;
  /** Invalidates queued native input after acquisition, retargeting, or exit. */
  #generation = 0;
  /** The draft grants this Document an activation exemption after a successful API release. */
  #releasedDocuments = new WeakSet<DocumentImpl>();

  constructor(userAgent: UserAgent) {
    this.#userAgent = userAgent;
    this.#requests = new ParallelQueue((steps) => userAgent.runInParallel(steps));
  }

  /** Locked element before Document/ShadowRoot retargeting, or null while unlocked. */
  get target(): ElementImpl | null { return this.#lock?.target ?? null; }

  /** Acquisition snapshot; callers must not change the coordinates frozen for this lock. */
  get position(): Readonly<MousePosition> | null { return this.#lock?.position ?? null; }

  /** Identity of the current native input destination/mode, including intervening exits. */
  get generation(): number { return this.#generation; }

  /** Apply the public request's preconditions, then serialize native acquisition. */
  // https://w3c.github.io/pointerlock/#requestPointerLock
  requestPointerLock(element: ElementImpl, options: PointerLockOptions): InternalPromise<void> {
    const result = element.env.InternalPromise.withResolvers(idlType.undefined);
    const document = element.nodeDocument;
    const realm = element.env.realm;
    const window = realm.isWindow() ? realm.windowImplementation : null;
    // SPEC_CLASH(pointer-lock-document-checks): Reject detached/inactive targets with WrongDocumentError like Chromium/WebKit; the focus precondition is unclear and Firefox uses InvalidStateError for detached targets.
    if (element.getShadowIncludingRoot() !== document || !document.isFullyActive() || window === null ||
      !document.hasFocus()) {
      this.#reject(element, result, DOMExceptionNames.wrongDocument);
      return result.promise;
    }
    // HTML owns the transient activation model; successful API release supplies
    // the separate Pointer Lock exemption, without fabricating activation.
    if (!this.#releasedDocuments.has(document) && !window.hasTransientActivation()) {
      this.#reject(element, result, DOMExceptionNames.notAllowed);
      return result.promise;
    }
    if (document.activeSandboxingFlagSet.has('sandboxed-pointer-lock')) {
      this.#reject(element, result, DOMExceptionNames.security);
      return result.promise;
    }
    if (options.unadjustedMovement && !this.supportsUnadjustedMovement()) {
      this.#reject(element, result, DOMExceptionNames.notSupported);
      return result.promise;
    }

    const requestedOptions = { ...options };
    this.#requests.enqueue(() => {
      // SPEC_GAP(pointer-lock-pending-lifetime): The draft does not recheck queued targets; validate original-Document membership, activity and focus before acquisition.
      // SPEC_CLASH(pointer-lock-pending-result): Recheck like Firefox, retaining our WrongDocumentError policy; Chromium can fulfill a removed request without a lock.
      // Reinsertion into the original Document before processing remains valid.
      if (element.getShadowIncludingRoot() !== document || !document.isFullyActive() ||
        !document.hasFocus()) {
        this.#reject(element, result, DOMExceptionNames.wrongDocument, document);
        return;
      }
      const current = this.#lock;
      // SPEC_CLASH(pointer-lock-conflicting-document): Keep the draft's InvalidStateError for another Document; Blink instead uses WrongDocumentError.
      if (current !== null && current.target.getShadowIncludingRoot() !== element.getShadowIncludingRoot()) {
        this.#reject(element, result, DOMExceptionNames.invalidState);
        return;
      }
      const sameInput = current !== null && current.target === element &&
        current.options.unadjustedMovement === requestedOptions.unadjustedMovement;
      if (current !== null && current.options.unadjustedMovement === requestedOptions.unadjustedMovement) {
        current.target = element;
      } else {
        const position = this.acquire(element, requestedOptions);
        if (position === null) {
          this.#reject(element, result, DOMExceptionNames.notSupported);
          return;
        }
        this.#lock = { target: element, options: requestedOptions, position: { ...position } };
      }
      if (!sameInput) this.#generation++;
      // https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture
      // Applying pointer lock releases pending capture; existing capture processing
      // delivers effective loss on the next pointer event, without author code here.
      for (const top of this.#userAgent.topLevelTraversableSet) {
        for (const stream of top.pointerEventStreams.values()) {
          const pending = stream.capture.pendingTargetOverride;
          if (pending !== null) stream.releasePointerCapture(pending);
        }
      }
      this.#notify(element, 'pointerlockchange', () => { result.resolve(undefined); }, document);
    });
    return result.promise;
  }

  /** Document.exitPointerLock() only releases a lock rooted in the calling Document. */
  // https://w3c.github.io/pointerlock/#extensions-to-the-document-interface
  exitForDocument(document: DocumentImpl): void {
    const target = this.target;
    if (target === null || target.getShadowIncludingRoot() !== document) return;
    this.exitPointerLock(target);
    this.#releasedDocuments.add(document);
  }

  /** Restore the native cursor, queue notification, and clear the current lock. */
  // https://w3c.github.io/pointerlock/#dfn-exit-pointer-lock
  // DOM disconnection calls this through the existing post-unlink notification.
  // TODO(Pointer Lock §8 / native input adapter): a trusted default-unlock gesture
  // or browser/window/tab focus loss must call this with the current target.
  // Author-dispatched key/blur events are not native unlock signals. HTML §6.6
  // focus movement within a page (including frames) must preserve lock. Fullscreen
  // entry/exit alone also preserves it; release only for its native UI interaction,
  // shared unlock gesture, or actual top-level focus loss. Those producers are absent.
  // HTML unloading/destruction must call this before detaching the locked Document;
  // that lifecycle connection remains with its owner, not DOM removal.
  exitPointerLock(element: ElementImpl): void {
    const lock = this.#lock;
    if (lock === null || lock.target !== element) return;
    this.restoreCursor({ x: lock.position.screenX, y: lock.position.screenY });
    this.#notify(element, 'pointerlockchange');
    this.#lock = null;
    this.#generation++;
    // Locked relative input cannot supply the next unlocked absolute-position delta.
    const window = element.nodeDocument.getRelevantGlobalObject();
    if (window !== null) window.lastMouseMove = undefined;
  }

  /** Whether native acquisition supports unadjusted relative mouse motion. */
  // https://w3c.github.io/pointerlock/#dom-pointerlockoptions-unadjustedmovement
  // TODO(native input adapter): report actual raw-motion support.
  supportsUnadjustedMovement(): boolean {
    throw new InternalError('Pointer Lock requires native raw-motion support information');
  }

  /**
   * Acquire/change native lock and hide the cursor, returning its saved screen
   * and client coordinates on success or null on refusal. Runs in the lock requests queue;
   * completion must precede return, without invoking author code. A successful host
   * must provide the §8 default unlock gesture and native focus-loss notifications
   * to exitPointerLock(); ordinary author keyboard/focus events cannot supply them.
   */
  // TODO(native input adapter): supply acquisition, native input routing, and
  // assistive-technology notification. Prevent mouse-driven native focus changes
  // while locked (§2.1); escape instructions and optional prompt/relock policy
  // belong to the native UI (§10). No Node/V8 change supplies these OS effects.
  acquire(_element: ElementImpl, _options: PointerLockOptions): MousePosition | null {
    throw new InternalError('Pointer Lock requires native cursor acquisition');
  }

  /** Release native lock and restore the visible cursor synchronously, without invoking author code. */
  // TODO(native input adapter): cursor visibility/restoration and relative-input shutdown.
  restoreCursor(_position: ScreenPosition): void {
    throw new InternalError('Pointer Lock requires native cursor restoration');
  }

  #reject(
    element: ElementImpl, result: InternalPromiseWithResolvers<void>, name: DOMExceptionName,
    document: DocumentImpl = element.nodeDocument,
  ): void {
    this.#notify(element, 'pointerlockerror', () => { result.reject(new DOMExceptionImpl('', name)); }, document);
  }

  #notify(
    element: ElementImpl, type: 'pointerlockchange' | 'pointerlockerror', settle?: () => void,
    document: DocumentImpl = element.nodeDocument,
  ): void {
    element.queueTask(userInteractionTaskSource, () => {
      // SPEC_CLASH(pointer-lock-event-flags): Use DOM's default false flags and Chromium; Firefox/WebKit bubble these notifications.
      // SPEC_CLASH(pointer-lock-notification-document): Retain the affected Document like Chromium/Firefox; a late node-document lookup would redirect notifications after adoption.
      document.fireEvent(type);
      // SPEC_CLASH(pointer-lock-promise-order): The draft fires the event before settling; all three browser probes settle before the notification.
      settle?.();
    });
  }
}

export type PointerLockOptions = { unadjustedMovement: boolean; };

type PointerLockState = {
  target: ElementImpl;
  options: PointerLockOptions;
  position: MousePosition;
};

/*
 * dictionary PointerLockOptions {
 *   boolean unadjustedMovement = false;
 * };
 */
export const pointerLockOptionsIDL = defineDictionary({
  name: 'PointerLockOptions',
  members: [dictMember('unadjustedMovement', idlType.boolean, { default: false })],
});

/*
 * partial interface Element {
 *   Promise<undefined> requestPointerLock(optional PointerLockOptions options = {});
 * };
 */
export const elementPointerLockIDL = definePartialInterface({
  name: 'Element',
  members: [
    op('requestPointerLock', promise(idlType.undefined),
      [arg('options', reference('PointerLockOptions'), { optional: true, default: emptyDictionary })],
    ),
  ],
});

/*
 * partial interface Document {
 *   attribute EventHandler onpointerlockchange;
 *   attribute EventHandler onpointerlockerror;
 *   undefined exitPointerLock();
 * };
 */
export const documentPointerLockIDL = definePartialInterface({
  name: 'Document',
  members: [
    eventHandlerMapAttr('onpointerlockchange'),
    eventHandlerMapAttr('onpointerlockerror'),
    op('exitPointerLock', idlType.undefined),
  ],
});

/*
 * partial interface mixin DocumentOrShadowRoot {
 *   readonly attribute Element? pointerLockElement;
 * };
 */
export const documentOrShadowRootPointerLockIDL = definePartialInterfaceMixin({
  name: 'DocumentOrShadowRoot',
  members: [roAttr('pointerLockElement', nullable(reference('Element')))],
});
