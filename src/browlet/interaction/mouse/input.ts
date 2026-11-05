import { InternalError } from '../../../infra/index';

import { unsafeSharedCurrentTime, type UnsafeMoment } from '../../timing/index';
import { userInteractionTaskSource } from '../../scripting/index';
import { PointerEventImpl, type EventModifierState, type MouseInput, type PointerInputEventType } from '../events/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../dom/nodes/index';
import type { TopLevelTraversable } from '../../browsing/navigation/index';
import { PointerButton, PointerEventStream, type ActivePointer, type PointerButtonChange } from '../pointer/index';
import type { UserAgent } from '../../user-agent';

/** Browlet's mouse-input entry point and delivery coordinator for one UserAgent. */
// The queue methods own browser integration; the handlers compose the specification's
// delivery steps through the existing pointer/mouse machinery. Neither is an OS adapter.
export class MouseInputProcessor {
  /** Browser lifetime owns the aggregate mouse source, independently of Window streams. */
  #userAgent: UserAgent;
  /** Mouse button state is shared even when queued deliveries belong to different event loops. */
  #source: ActivePointer;

  constructor(userAgent: UserAgent) {
    this.#userAgent = userAgent;
    this.#source = userAgent.activePointers.activate('mouse');
  }

  /**
   * Browlet entry point: queue a normalized transition for the receiving Window's Document.
   * Coordinates are CSS pixels in that Window; click recognition/counting comes from the adapter.
   * A qualifying release delivers click/auxclick and any primary dblclick in the same task, after mouseup.
   * The adapter can request a context menu on either press or release, before any qualifying click.
   * Locked input must be routed to the lock's Document; acquisition supplies its frozen coordinates.
   * Repeated reports of the same button state do not produce another task or event.
   */
  // Ownership checks, record snapshots, duplicate filtering, and lazy stream
  // registration are Browlet integration, not steps in the native down/up algorithms.
  queueButton(input: MouseButtonInput, document: DocumentImpl): void {
    const traversable = this.#getTraversable(document);
    // §§11.2.12–11.2.13 require updating held buttons. Browlet does this at receipt
    // and retains the result so independent Window task queues cannot reorder input state.
    const change = this.#source.changeButton(input.button, input.pressed);
    if (change === null) return;
    // Modifier snapshots have no mutators. Copy the action so a host reusing its
    // input buffer cannot change coordinates, click count, or the transition later.
    const lock = this.#userAgent.pointerLock;
    const target = lock.target?.nodeDocument === document ? lock.target : null;
    const generation = lock.generation;
    const action = { ...input, ...(target === null ? null : lock.position) };
    const time = unsafeSharedCurrentTime();
    this.#queueTask(document, traversable, (stream) => {
      if (target !== null && (lock.generation !== generation || target.nodeDocument !== document)) return;
      this.#handleButton(action, change, time, stream, document, target);
    });
  }

  /**
   * Queue one normalized position update, retaining the held buttons and receipt time.
   * Each update delivers raw input (in secure contexts), pointermove, and mapped mousemove
   * in one task, without coalescing. The adapter supplies actual updates, not polling samples.
   */
  // Receipt snapshots and HTML task entry are Browlet integration. Native/automation
  // acquisition stays with the adapter; #handleMove owns the adapted delivery algorithm.
  queueMove(input: MouseInput, document: DocumentImpl): void {
    const traversable = this.#getTraversable(document);
    const action = { ...input };
    const buttons = this.#source.buttons;
    const time = unsafeSharedCurrentTime();
    this.#queueTask(document, traversable, (stream) => {
      this.#handleMove(action, buttons, time, stream, document);
    });
  }

  /**
   * Queue native relative motion for the current lock. The adapter selects raw or
   * accelerated deltas according to acquisition options; it must not derive these
   * values from frozen absolute coordinates. Native gaps must supply a zero delta.
   */
  // https://w3c.github.io/pointerlock/#extensions-to-the-mouseevent-interface
  // Routing, snapshotting and task lifetime are Browlet integration. Discard input
  // from an old lock rather than delivering it into a new destination or mode.
  queueRelativeMove(input: RelativeMouseInput): void {
    const lock = this.#userAgent.pointerLock;
    const { target, position, generation } = lock;
    if (target === null || position === null) throw new InternalError('Relative mouse input requires pointer lock');
    const document = target.nodeDocument;
    const traversable = this.#getTraversable(document);
    const action = { ...position, ...input };
    const buttons = this.#source.buttons;
    const time = unsafeSharedCurrentTime();
    this.#queueTask(document, traversable, (stream) => {
      if (lock.generation !== generation || target.nodeDocument !== document) return;
      this.#handleMove(action, buttons, time, stream, document, target, action);
    });
  }

  /** Select an input target using the receiving Document's viewport coordinates. */
  // https://w3c.github.io/pointerevents/#dfn-hit-test
  // TODO(CSSOM View elementFromPoint / HTML inertness and disabled controls):
  // connect layout hit testing and input eligibility; a default body target is not equivalent.
  // Pointer Events §11.4 requires text-run hits to target their containing Element,
  // rather than dispatching user-agent mouse events directly on Text nodes.
  // Pointer Lock targeting and cross-document coordinate translation also belong
  // at this input/layout boundary, not in a fallback to the receiving Document.
  hitTest(_document: DocumentImpl, _clientX: number, _clientY: number): NodeImpl {
    throw new InternalError('Mouse input requires layout hit testing and input eligibility');
  }

  /** Query the supplied Document's Pointer Lock owner before movement or capture. */
  // https://w3c.github.io/pointerlock/#dfn-lock-target
  hasLockedElement(document: DocumentImpl): boolean {
    return this.#userAgent.pointerLock.target?.nodeDocument === document;
  }

  /** Notify HTML of an activation-triggering mouse press before its listeners run. */
  // https://html.spec.whatwg.org/multipage/interaction.html#activation-notification
  // TODO(HTML §6.4): propagate activation to ancestors/same-origin descendants and close watchers.
  notifyUserActivation(_document: DocumentImpl): void {
    throw new InternalError('Mouse input requires HTML user activation notification');
  }

  /** Apply click-focus eligibility and focusing steps after an uncanceled mousedown. */
  // https://html.spec.whatwg.org/multipage/interaction.html#click-focusable
  // https://html.spec.whatwg.org/multipage/interaction.html#focusing-steps
  // SPEC_CLASH(mouse-click-focus): Use §11.2.12's mousedown focus like all three browsers; §11.4 also lists focus as a click default action.
  // TODO(HTML §6.6): connect focusable areas, click focusability, and the shared focus chain.
  focusOnMouseDown(_target: NodeImpl): void {
    throw new InternalError('Mouse input requires HTML click focusability and focusing steps');
  }

  /** Dispatch a mouse context menu from private input, then request native UI if uncanceled. */
  // https://w3c.github.io/pointerevents/#dfn-maybe-show-context-menu
  // Browlet supplies the normalized pointer snapshot rather than an OS event.
  // TODO(keyboard input / HTML §6.6): the null-native caller needs the currently
  // focused target, current modifiers, and keyboard menu placement from those owners.
  // This mouse entry requires measured input; it must not invent keyboard coordinates.
  maybeShowContextMenu(input: PointerEventImpl, target: NodeImpl): void {
    // SPEC_CLASH(native-context-menu-target): Retain §3.3.12's triggering target; browsers can hit-test again after mouse listeners change layout.
    // SPEC_CLASH(native-context-menu-removal): Suppress while disconnected per §11.3; browsers retarget to the exposed element.
    if (!target.isConnected) return;
    const event = PointerEventImpl.createActivation('contextmenu', target, input);
    event.pointerId = input.pointerId;
    event.pointerType = input.pointerType;
    // SPEC_CLASH(native-context-menu-detail): Follow §11.4 and Chromium/WebKit's zero; Firefox supplied 1 in the probe.
    event.detail = 0;
    if (target.dispatch(event)) this.showContextMenu(target, input.screenX, input.screenY);
  }

  /** Show native UI for this target at the adapter's screen position, in CSS pixels. */
  // https://w3c.github.io/pointerevents/#dfn-maybe-show-context-menu
  // TODO(native GUI adapter): provide the UA menu, positioning, and modal input handling.
  // The private input coordinates survive author reinitialization of contextmenu.
  showContextMenu(_target: NodeImpl, _screenX: number, _screenY: number): void {
    throw new InternalError('Mouse input requires native context-menu UI');
  }

  /** Deliver a received button transition through pointer/mouse dispatch and its default-action continuations. */
  // https://w3c.github.io/pointerevents/#dfn-handle-native-mouse-down
  // https://w3c.github.io/pointerevents/#dfn-handle-native-mouse-up
  // https://w3c.github.io/pointerevents/#dfn-handle-native-mouse-click
  // https://w3c.github.io/pointerevents/#dfn-send-click-event
  // https://w3c.github.io/pointerevents/#dfn-handle-native-mouse-double-click
  // Adapted delivery portion of §§11.2.12–11.2.13: the button-state update has
  // already run at receipt. The adapter supplies §11.2.10's normalized button;
  // §11.2.11's changed-button field is applied by the existing mouse mapper.
  // §§11.2.14–11.2.16 then send adapter-qualified clicks, using §3.3.12's
  // existing attributes/targeting and DOM's activation-behavior dispatch.
  #handleButton(
    input: MouseButtonInput, change: PointerButtonChange, time: UnsafeMoment, stream: PointerEventStream, document: DocumentImpl,
    lockedTarget: ElementImpl | null,
  ): void {
    // Browlet representation: an undispatched snapshot lets capture notifications
    // precede hit testing without allocating the author-visible event in the wrong realm.
    const sample = new PointerEventImpl('', {});
    sample.initializePointerEvent(change.type, document, true, true, { ...input, buttons: change.buttons });
    sample.isTrusted = true;
    sample.button = change.button;
    sample.pointerType = 'mouse';
    sample.isPrimary = this.#source.isPrimary;
    // §3.1's required pressure for a mouse without pressure hardware.
    sample.pressure = change.buttons === 0 ? 0 : 0.5;
    sample.timeStamp = document.env.realm.eventTimeStamp(time);

    // §3.1.3 supplies capture processing and target selection; the native handlers
    // describe the ordinary hit-test case without duplicating those pointer rules.
    const generation = this.#userAgent.pointerLock.generation;
    const hitTest = () => lockedTarget ?? this.hitTest(document, input.clientX, input.clientY);
    // §3.3.5 includes chorded button changes: they produce pointermove rather
    // than down/up, so secure input needs a preceding raw update too.
    if (change.type === 'pointermove' && document.env.isSecureContext) {
      const rawTarget = stream.prepareTarget('pointerrawupdate', sample, hitTest);
      const raw = this.#createEvent('pointerrawupdate', rawTarget, sample, time);
      stream.dispatchToTarget(raw, rawTarget, hitTest, input.clickCount, undefined, undefined, lockedTarget !== null);
    }
    if (lockedTarget !== null && this.#userAgent.pointerLock.generation !== generation) return;
    const target = stream.prepareTarget(change.type, sample, hitTest);
    // HTML §6.4 adds activation notification before press listeners.
    if (input.pressed) this.notifyUserActivation(target.nodeDocument);

    const event = this.#createEvent(change.type, target, sample, time);

    // §§11.2.12–11.2.13 request pointer then mouse dispatch. Reuse §§3/10's
    // existing pipeline, including chords/suppression; mousedown's actual result
    // controls the §11.2.12 focusing continuation.
    stream.dispatchToTarget(event, target, hitTest, input.clickCount, undefined,
      (mouseTarget) => this.focusOnMouseDown(mouseTarget), lockedTarget !== null,
    );
    // §§11.2.18/11.4 permit platform-selected press or release timing. The adapter
    // requests the menu independently of pointerdown/mousedown cancellation.
    // SPEC_CLASH(native-context-menu-order): Follow §11.4's contextmenu-before-auxclick rule; Chromium's release-timed menu follows auxclick.
    if (input.contextMenu) this.maybeShowContextMenu(sample, target);
    // §§11.2.14–11.2.15: native click recognition is an adapter input, not a
    // consequence of an uncanceled mouseup. Keep it in this release's task.
    // §3.3.12 overrides the ordinary hit-test target with the stream's retained
    // press/release or capture target; no additional hit test can change that choice.
    if (!input.pressed && input.click) {
      stream.dispatchActivation(input.button === PointerButton.Primary ? 'click' : 'auxclick', input.clickCount, input.doubleClick);
    }
  }

  /** Deliver absolute or locked-relative motion through the shared pointer/mouse algorithms. */
  // https://w3c.github.io/pointerevents/#dfn-handle-native-mouse-move
  // §11.2.17 describes ordinary hit testing and mouse boundaries. §§3.1.3 and 10
  // supply capture-aware target selection and interleaving in the existing stream.
  // §3.3.5 additionally requires secure raw delivery before its corresponding move.
  #handleMove(
    input: MouseInput, buttons: number, time: UnsafeMoment, stream: PointerEventStream, document: DocumentImpl,
    lockedTarget: ElementImpl | null = null, relative: RelativeMouseInput | null = null,
  ): void {
    if (lockedTarget === null && this.hasLockedElement(document)) {
      throw new InternalError('Pointer Lock movement requires native relative input through queueRelativeMove()');
    }
    const window = document.getRelevantGlobalObject();
    if (window === null) throw new InternalError('Mouse movement requires a Window');

    const sample = new PointerEventImpl('', {});
    sample.initializePointerEvent('pointermove', document, true, true, { ...input, buttons });
    sample.isTrusted = true;
    sample.button = -1;
    sample.pointerType = 'mouse';
    sample.isPrimary = this.#source.isPrimary;
    sample.pressure = buttons === 0 ? 0 : 0.5;
    sample.timeStamp = document.env.realm.eventTimeStamp(time);
    // Update once, including when canceled pointerdown suppresses mapped mousemove.
    // The undispatched snapshot survives author reinitialization of either event.
    if (relative === null) { window.setPointerLockAttributesForMousemove(sample); }
    else {
      sample.movementX = relative.movementX;
      sample.movementY = relative.movementY;
    }

    const generation = this.#userAgent.pointerLock.generation;
    const hitTest = () => lockedTarget ?? this.hitTest(document, input.clientX, input.clientY);
    if (document.env.isSecureContext) {
      const rawTarget = stream.prepareTarget('pointerrawupdate', sample, hitTest);
      const raw = this.#createEvent('pointerrawupdate', rawTarget, sample, time);
      stream.dispatchToTarget(raw, rawTarget, hitTest, 0, undefined, undefined, lockedTarget !== null);
    }
    if (lockedTarget !== null && this.#userAgent.pointerLock.generation !== generation) return;
    // Raw listeners can change layout or pending capture; select the move target afterward.
    const target = stream.prepareTarget('pointermove', sample, hitTest);
    const event = this.#createEvent('pointermove', target, sample, time);
    stream.dispatchToTarget(event, target, hitTest, 0, undefined, undefined, lockedTarget !== null);
    // TODO(HTML §6.11 / Selection API): connect drag initiation and selection extension
    // at their native movement/default-action owners; emitting mousemove does not implement them.
    // Pointer Lock §2.1 forbids drag/drop while locked; that future owner must honor lockedTarget.
  }

  /** Allocate input in the selected target's creation realm, independently of its current Document view. */
  // Browlet allocation, not a separate specification step. The shared receipt
  // time is translated and coarsened by each receiving realm, including after adoption.
  #createEvent(type: PointerInputEventType, target: NodeImpl, sample: PointerEventImpl, time: UnsafeMoment): PointerEventImpl {
    const event = target.createTrustedEvent(PointerEventImpl);
    event.copyInputFrom(sample);
    event.timeStamp = target.env.realm.eventTimeStamp(time);
    event.view = target.nodeDocument.getRelevantGlobalObject();
    event.setPointerEventAttributes(type);
    return event;
  }

  /** Validate receipt before it can change the UserAgent's shared input state. */
  #getTraversable(document: DocumentImpl): TopLevelTraversable {
    const traversable = document.getNodeNavigable()?.topLevelTraversable;
    if (document.env.userAgent !== this.#userAgent || traversable === undefined ||
      !this.#userAgent.topLevelTraversableSet.has(traversable)) {
      throw new InternalError('Mouse input requires a live browsing context owned by this UserAgent');
    }
    return traversable;
  }

  /** Queue delivery through the existing context-local stream while preserving destination lifetime. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#user-interaction-task-source
  // Lifetime checks and lazy registration are Browlet's composition with HTML scheduling.
  #queueTask(document: DocumentImpl, traversable: TopLevelTraversable, deliver: (stream: PointerEventStream) => void): void {
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => {
      if (!this.#userAgent.topLevelTraversableSet.has(traversable)) return;
      // §3.1 expressly permits reserving 1 for the primary mouse. Other device
      // producers must allocate different IDs in this existing context-local map.
      let stream = traversable.pointerEventStreams.get(1);
      if (stream === undefined) {
        stream = new PointerEventStream(1, false, true, (targetDocument) => this.hasLockedElement(targetDocument));
        traversable.pointerEventStreams.set(1, stream);
      }
      deliver(stream);
    });
  }
}

/** OS adapters normalize logical button roles before entering the browser. Pen erasers are not mouse buttons. */
export type MouseButton = PointerButton.Primary | PointerButton.Auxiliary | PointerButton.Secondary |
  PointerButton.Back | PointerButton.Forward;

/** Measured relative motion, already adjusted (or unadjusted) by the native adapter. */
export interface RelativeMouseInput {
  movementX: number;
  movementY: number;
  modifiers: EventModifierState;
}

/** One button action; held buttons are computed from the UserAgent's source, not supplied by callers. */
export interface MouseButtonInput extends MouseInput {
  button: MouseButton;
  pressed: boolean;
  /** False for presses; true only when the adapter recognizes this release as a click. */
  click: boolean;
  /** Requires click=true on a release recognized as a double-click; non-primary buttons cannot emit dblclick. */
  doubleClick: boolean;
  /** The adapter recognized a menu request on this transition, whether press or release. */
  contextMenu: boolean;
  /** UI Events detail for this gesture: 1 for the first click, 2 for the second; counted by the adapter. */
  clickCount: number;
}
