import { InternalError } from '../../../infra/index';
import { unsafeSharedCurrentTime, type UnsafeMoment } from '../../../timing/index';

import { userInteractionTaskSource } from '../../scripting/index';
import { EventModifierState, KeyboardEventImpl, type KeyboardEventInput } from '../events/index';
import type { DocumentImpl, NodeImpl } from '../../dom/nodes/index';
import type { UserAgent } from '../../user-agent';

import { selectKey, type KeyboardKeyInput, type KeyboardCode } from './values';

/** Browser input entry point for page-directed key presses/releases, shared by one UserAgent. */
// https://w3c.github.io/uievents/#keyboardevent-global-ua
// Queueing, receipt snapshots, and destination checks are Browlet integration;
// the delivery method below composes UI Events §§3.5.5–3.5.6 with HTML scheduling.
export class KeyboardInputProcessor {
  /** Browser lifetime owns device state independently of any receiving Window. */
  #userAgent: UserAgent;
  /** Latest received held/toggled state; immutable snapshots also belong to queued events. */
  #modifiers = new EventModifierState();

  constructor(userAgent: UserAgent) {
    this.#userAgent = userAgent;
  }

  get modifiers(): EventModifierState { return this.#modifiers; }

  /**
   * Queue a normalized key transition for its receiving Document.
   * The adapter supplies layout facts, post-transition modifier state, and repeat/
   * composition/shortcut classification. A release needs fresh key facts, not a
   * replay of its press. Host-only shortcuts are handled before this page entry.
   * Cross-document focus routing belongs to the adapter/HTML focus owner; focus
   * within this Document is selected when the task runs, not when it is queued.
   */
  // https://html.spec.whatwg.org/multipage/webappapis.html#user-interaction-task-source
  // A complete native modifier snapshot accounts for two-sided keys, lock keys,
  // and state changed outside the page. Synthetic dispatch never enters here.
  queueKey(input: KeyboardInput, document: DocumentImpl): void {
    const traversable = document.getNodeNavigable()?.topLevelTraversable;
    if (document.env.userAgent !== this.#userAgent || traversable === undefined ||
      !this.#userAgent.topLevelTraversableSet.has(traversable)) {
      throw new InternalError('Keyboard input requires a live browsing context owned by this UserAgent');
    }
    const action = { ...input };
    this.#modifiers = action.modifiers;
    const time = unsafeSharedCurrentTime();
    document.env.realm.queueGlobalTask(userInteractionTaskSource, () => {
      if (!this.#userAgent.topLevelTraversableSet.has(traversable)) return;
      this.#deliver(action, document, time);
    });
  }

  /** Notify HTML of an activation-triggering press before its author listeners run. */
  // https://html.spec.whatwg.org/multipage/interaction.html#activation-notification
  // TODO(HTML §6.4): connect the same ancestor/descendant notification and close-
  // watcher steps required by MouseInputProcessor.notifyUserActivation().
  notifyUserActivation(_document: DocumentImpl): void {
    throw new InternalError('Keyboard input requires HTML user activation notification');
  }

  /** Perform the ordinary key's default action after uncanceled keydown. */
  // https://w3c.github.io/uievents/#event-type-keydown
  // TODO(HTML §§6.5–6.8 / Input Events / Clipboard): classify native shortcuts;
  // invoke Tab traversal, element activation, clipboard commands, or editing.
  // Eligible element activation calls Element.fireClick(); key/element policy
  // remains here, separate from HTML §8.1.8.3's completed firing operation.
  // Recognized clipboard shortcuts call SystemClipboard.runAction(type, document, 'user')
  // in this keydown task; queueAction is for menu entry and could run after an already queued keyup.
  // TODO(Input Events §6.2): identify the editing host and prepared EditingInput, then
  // use InputEventImpl.create for beforeinput -> edit -> input with its own cancellation.
  // Dispatch input only when the browser's edit actually changed content; a no-op or
  // an author's DOM mutation inside beforeinput does not count as that edit.
  // The private input survives author reinitialization of the dispatched event.
  applyDefaultAction(_target: NodeImpl, _input: KeyboardInput): void {
    throw new InternalError('Keyboard input requires focus traversal, activation, clipboard, and editing default actions');
  }

  /** Pass a composition key and its cancellation result to the future IME owner. */
  // https://w3c.github.io/uievents/#keys-during-composition
  // TODO(UI Events §3.6 / Input Events): maintain the actual composition session,
  // interpret cancellation with the IME, and deliver composition/text effects.
  // A boolean on a KeyboardEvent cannot establish that session. Text commits
  // without key events need a separate adapter entry; do not infer them from key.
  // Input Events §7 additionally needs the active composition passage, replacement
  // and commit/cancel effects, and input-event ordering around each actual edit.
  // Resolve SPEC_CLASH(composition-input-order) before connecting that sequence.
  handleCompositionKey(_target: NodeImpl, _input: KeyboardInput, _canceled: boolean): void {
    throw new InternalError('Keyboard input requires IME composition processing');
  }

  /** Deliver one key using live focus and captured input; a canceled press never suppresses its release. */
  // https://w3c.github.io/uievents/#events-keyboard-event-order
  // https://w3c.github.io/uievents/#event-type-keydown
  // https://w3c.github.io/uievents/#event-type-keyup
  #deliver(input: KeyboardInput, document: DocumentImpl, time: UnsafeMoment): void {
    // Document's existing HTML §6.6 stubs remain the focus owners. In particular,
    // do not use activeElement: its shadow-retargeted answer hides the true target.
    if (!document.hasFocus()) return;
    const anchor = document.focusedArea.domAnchor;
    const target = anchor.isDocument() ? document.body ?? document.documentElement ?? document : anchor;
    if (target.nodeDocument !== document || !target.isConnected) return;
    const key = selectKey(input);
    // https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event
    if (input.pressed && key !== 'Escape' && !input.reservedShortcut) this.notifyUserActivation(document);
    const event = KeyboardEventImpl.create(input.pressed ? 'keydown' : 'keyup', target, key, input);
    event.timeStamp = target.env.realm.eventTimeStamp(time);
    const canceled = !target.dispatch(event);
    if (!input.pressed) return;
    if (input.isComposing) this.handleCompositionKey(target, input, canceled);
    else if (!canceled) this.applyDefaultAction(target, input);
  }
}

/** Adapter facts for one page-directed transition, including fresh layout and aggregate device state. */
export interface KeyboardInput extends KeyboardKeyInput, KeyboardEventInput {
  code: KeyboardCode;
  location: 0 | 1 | 2 | 3;
  pressed: boolean;
  /** Whether HTML excludes this OS/browser shortcut from activation-triggering input. */
  reservedShortcut: boolean;
}
