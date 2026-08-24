import { withTextStub } from '../stubs/interfaces';
import { arg, ctor, defineInterface, idlType } from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import {
  isText, NodeImpl, type NodeOptions, NodeType,
} from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { SlottableMixin } from './slottable';

/*
 * [Exposed=Window]
 * interface Text : CharacterData {
 *   constructor(optional DOMString data = "");
 *
 *   [NewObject] Text splitText(unsigned long offset);
 *   readonly attribute DOMString wholeText;
 * };
 */
export class TextImpl
  extends withTextStub(CharacterDataImpl)
  implements Text
{
  readonly #slottable = new SlottableMixin();

  constructor(data = '', ownerDocument: DocumentImpl | null = null) {
    super(NodeType.Text, data, ownerDocument, TextImpl.#nodeOptions);
  }

  // -- Virtual ----------------------------------------------------------

  static readonly #nodeOptions: NodeOptions = {
    eventTargetVirtuals: NodeImpl.createEventTargetVirtuals({
      getParent: (target, event) => NodeImpl.is(target) && isText(target)
        ? TextImpl.getEventParent(target, event)
        : null,
      getAssignedSlot: (target) => NodeImpl.is(target) && isText(target)
        ? TextImpl.getAssignedSlot(target)
        : null,
    }),
  };

  // -- Friends ----------------------------------------------------------

  static setAssignedSlot(text: TextImpl, slot: ElementImpl | null): void {
    text.#slottable.setAssignedSlot(slot);
  }

  static getAssignedSlot(text: TextImpl): ElementImpl | null {
    return text.#slottable.assignedSlot;
  }

  static getEventParent(
    text: TextImpl,
    _event: Event,
  ): NodeImpl | null {
    return text.#slottable.assignedSlot ?? NodeImpl.getParentNode(text);
  }
}

// -- Web IDL ------------------------------------------------------------

export const textIDL = defineInterface({
  binding: bind(TextImpl),
  exposed: 'Window',
  inherits: 'CharacterData',
  members: [ctor([
    arg('data', idlType.DOMString, { default: '', optional: true }),
  ], bind({
    invoke(_context, data) {
      (this as TextImpl).data = data as string;
    },
  }))],
  name: 'Text',
});
