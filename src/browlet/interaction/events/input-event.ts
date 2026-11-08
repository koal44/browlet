import { InternalError } from '../../../infra/index';
import {
  arg, atArg, ctor, defineDictionary, defineInterface, definePartialDictionary, definePartialInterface,
  dictMember, emptyDictionary, emptySequence, idlType, impl, nullable, op, reference, roAttr, sequence,
} from '../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../timing/index';

import { DataTransferImpl, type DragDataItem } from '../drag-drop/index';
import type { StaticRangeImpl } from '../../dom/ranges/index';
import type { ElementImpl } from '../../dom/nodes/index';
import type { DOMEnvironment } from '../../dom/environment';

import { UIEventImpl, type UIEventInit } from './ui-event';

/** Input notification data, independent of the editing operation that produces it. */
// https://w3c.github.io/uievents/#interface-inputevent
// TODO(HTML §6.8, Input Events §6): Editing must select the host, data, inputType, and composition
// state, dispatch cancelable beforeinput where required, apply the edit, then dispatch input.
// Synthetic construction/dispatch does not run those steps or start a composition session.
// TODO(Input Events §§6.1.2–6.2, §7): The editing producer must compute affected ranges and
// prepare text/HTML/file/link representations for create(), and own IME sequencing.
// KeyboardInputProcessor.applyDefaultAction/handleCompositionKey and SystemClipboard's
// editing operations retain explicit throwing dependencies until those owners are connected.
// TODO(Input Events §6.2): beforeinput reflects attempted user editing, not system or
// programmatic changes. Send input immediately after an actual browser-performed edit;
// a canceled/no-op edit or a listener's own DOM mutation does not supply that step.
// Automatic delivery and composition are deferred to those owners (approved 2026-11-06).
export class InputEventImpl extends UIEventImpl {
  /** Text supplied after Web IDL conversion; null and the empty string remain distinct. */
  data: string | null;
  /** Whether the producer or constructor marks this notification as part of a composition. */
  isComposing: boolean;
  /** Input operation name, without restricting author-created events to known editing operations. */
  inputType: string;
  /** Constructor-supplied transfer data, or a read-only store prepared for trusted input. */
  dataTransfer: DataTransferImpl | null;

  /** Converted snapshots associated with this event, independent of later DOM mutations. */
  #targetRanges: StaticRangeImpl[];

  constructor(type: string, eventInitDict: InputEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.data = eventInitDict.data ?? null;
    this.isComposing = eventInitDict.isComposing ?? false;
    // SPEC_CLASH(input-event-input-type): Preserve DOMString input as Firefox/WebKit do; Chromium filters unrecognized names to empty.
    this.inputType = eventInitDict.inputType ?? '';
    // SPEC_CLASH(input-event-transfer-init): Follow the draft/Chromium/Firefox; WebKit ignores the supplied dataTransfer.
    this.dataTransfer = eventInitDict.dataTransfer ?? null;
    // SPEC_CLASH(input-event-target-ranges): Follow the draft/Firefox: retain supplied snapshots; Chromium copies/normalizes/clears them and WebKit ignores them.
    this.#targetRanges = eventInitDict.targetRanges ?? [];
  }

  /** Prepare a trusted notification from an editing owner's selected operation and payload. */
  // https://w3c.github.io/input-events/#interface-InputEvent-Attributes
  // https://w3c.github.io/input-events/#interface-InputEvent-Methods
  // https://w3c.github.io/input-events/#event-definitions
  // This implementation factory applies the tables; it does not select an editing host,
  // dispatch an event, or perform the default edit described by the event definitions.
  static create(type: InputEventType, target: ElementImpl, input: EditingInput): InputEventImpl {
    if (input.host === 'edit-context') {
      throw new InternalError('InputEvent preparation requires the EditContext editing owner');
    }

    const event = target.createTrustedEvent(InputEventImpl);
    // https://w3c.github.io/uievents/#event-type-beforeinput
    // https://w3c.github.io/uievents/#event-type-input
    // SPEC_CLASH(input-event-view): Follow UI Events/Firefox/WebKit's target Window; Chromium supplies null for trusted input events.
    event.initializeUIEvent(type, target, true, type === 'beforeinput' && input.inputType !== 'insertCompositionText');
    event.composed = true;
    event.isTrusted = true;
    event.inputType = input.inputType;
    event.isComposing = input.isComposing;

    let usesData = false;
    let usesTransfer = false;
    switch (input.inputType) {
      case 'insertText': case 'insertCompositionText':
      case 'formatSetInlineTextDirection': case 'formatSetBlockTextDirection':
      case 'formatBackColor': case 'formatFontColor': case 'formatFontName': case 'insertLink':
        usesData = true;
        break;
      case 'insertFromPaste': case 'insertFromPasteAsQuotation': case 'insertFromDrop':
      case 'insertTranspose': case 'insertReplacementText': case 'insertFromYank':
        // The normative attribute tables include insertTranspose; the overview omits it.
        usesData = input.host === 'text-control';
        usesTransfer = input.host === 'contenteditable';
        break;
    }
    if (usesData) {
      if (input.data === null) {
        throw new InternalError('InputEvent preparation requires the editing owner\'s text or format value');
      }
      event.data = input.data;
    }
    if (usesTransfer) {
      if (input.transferItems === null) {
        throw new InternalError('InputEvent preparation requires the editing owner\'s transfer representations');
      }
      const transfer = new DataTransferImpl(target.env);
      for (const item of input.transferItems) transfer.appendItem({ ...item });
      transfer.setMode('read-only');
      event.dataTransfer = transfer;
    }

    // SPEC_CLASH(input-event-trusted-ranges): Follow all three browsers' empty input ranges; the draft also describes affected ranges for input.
    if (type === 'beforeinput' && input.host === 'contenteditable' &&
      input.inputType !== 'historyUndo' && input.inputType !== 'historyRedo') {
      // SPEC_CLASH(input-event-beforeinput-retention): Retain snapshots after dispatch as Firefox/WebKit do; Chromium clears them.
      event.#targetRanges = input.targetRanges.slice();
    }
    return event;
  }

  /** The snapshots associated with this event; Binding creates each returned array. */
  // https://w3c.github.io/input-events/#interface-InputEvent-Methods
  getTargetRanges(): StaticRangeImpl[] {
    // SPEC_CLASH(input-event-range-array-realm): Keep Binding's receiver-realm array as Chromium/WebKit do; Firefox uses the borrowed method's realm.
    return this.#targetRanges;
  }
}

/** Converted constructor data; UI Events and Input Events retain separate IDL declarations. */
export interface InputEventInit extends UIEventInit {
  data?: string | null;
  isComposing?: boolean;
  inputType?: string;
  dataTransfer?: DataTransferImpl | null;
  targetRanges?: StaticRangeImpl[];
}

/** Required producer facts, already selected by the HTML editing or input-method owner. */
export interface EditingInput {
  /** The owner selects a supported editing host; EditContext remains an explicit dependency. */
  host: 'contenteditable' | 'text-control' | 'edit-context';
  /** Selected using the user's intention and the operation's selection/IME preconditions. */
  inputType: InputType;
  /** Actual composition-session state, rather than an inference from inputType. */
  isComposing: boolean;
  /** Prepared text, direction, CSS color/font value, or link URL; null when unused. */
  data: string | null;
  /**
   * Prepared, normalized drag data items with unique string types, or null when unused.
   * Rich insertion requires text/html and text/plain, plus a File or text/uri-list when
   * applicable. Rendering, clipboard/drag access, and kill-buffer lookup belong to the
   * producer; this factory copies records and preserves File identities.
   */
  transferItems: DragDataItem[] | null;
  /** Computed affected snapshots; controls, history operations, and input expose none. */
  targetRanges: StaticRangeImpl[];
}

export type InputEventType = 'beforeinput' | 'input';

/** Input Events §6.1.2's producer vocabulary; author-created inputType stays a DOMString. */
export type InputType =
  | 'insertText' | 'insertReplacementText' | 'insertLineBreak' | 'insertParagraph'
  | 'insertOrderedList' | 'insertUnorderedList' | 'insertHorizontalRule' | 'insertFromYank'
  | 'insertFromDrop' | 'insertFromPaste' | 'insertFromPasteAsQuotation' | 'insertTranspose'
  | 'insertCompositionText' | 'insertLink'
  | 'deleteWordBackward' | 'deleteWordForward' | 'deleteSoftLineBackward' | 'deleteSoftLineForward'
  | 'deleteEntireSoftLine' | 'deleteHardLineBackward' | 'deleteHardLineForward'
  | 'deleteByDrag' | 'deleteByCut' | 'deleteContent' | 'deleteContentBackward' | 'deleteContentForward'
  | 'historyUndo' | 'historyRedo'
  | 'formatBold' | 'formatItalic' | 'formatUnderline' | 'formatStrikeThrough'
  | 'formatSuperscript' | 'formatSubscript' | 'formatJustifyFull' | 'formatJustifyCenter'
  | 'formatJustifyRight' | 'formatJustifyLeft' | 'formatIndent' | 'formatOutdent' | 'formatRemove'
  | 'formatSetBlockTextDirection' | 'formatSetInlineTextDirection'
  | 'formatBackColor' | 'formatFontColor' | 'formatFontName';

/*
 * [Exposed=Window]
 * interface InputEvent : UIEvent {
 *   constructor(DOMString type, optional InputEventInit eventInitDict = {});
 *   readonly attribute USVString? data;
 *   readonly attribute boolean isComposing;
 *   readonly attribute DOMString inputType;
 * };
 */
export const inputEventIDL = defineInterface<DOMEnvironment>({
  name: 'InputEvent',
  inherits: 'UIEvent',
  exposed: 'Window',
  implementation: impl(InputEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('InputEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    // SPEC_CLASH(input-event-data-string): Match the DOMString constructor input and all three browsers' UTF-16 preservation, despite the USVString attribute above.
    roAttr('data', nullable(idlType.DOMString)),
    roAttr('isComposing', idlType.boolean),
    roAttr('inputType', idlType.DOMString),
  ],
});

/*
 * dictionary InputEventInit : UIEventInit {
 *   DOMString? data = null;
 *   boolean isComposing = false;
 *   DOMString inputType = "";
 * };
 */
export const inputEventInitIDL = defineDictionary({
  name: 'InputEventInit',
  inherits: 'UIEventInit',
  members: [
    dictMember('data', nullable(idlType.DOMString), { default: null }),
    dictMember('isComposing', idlType.boolean, { default: false }),
    dictMember('inputType', idlType.DOMString, { default: '' }),
  ],
});

// https://w3c.github.io/input-events/#interface-InputEvent
/*
 * partial interface InputEvent {
 *   readonly attribute DataTransfer? dataTransfer;
 *   sequence<StaticRange> getTargetRanges();
 * };
 */
export const inputEventLevel2IDL = definePartialInterface({
  name: 'InputEvent',
  members: [
    roAttr('dataTransfer', nullable(reference('DataTransfer'))),
    op('getTargetRanges', sequence(reference('StaticRange')), []),
  ],
});

/*
 * partial dictionary InputEventInit {
 *   DataTransfer? dataTransfer = null;
 *   sequence<StaticRange> targetRanges = [];
 * };
 */
export const inputEventLevel2InitIDL = definePartialDictionary({
  name: 'InputEventInit',
  members: [
    dictMember('dataTransfer', nullable(reference('DataTransfer')), { default: null }),
    dictMember('targetRanges', sequence(reference('StaticRange')), { default: emptySequence }),
  ],
});
