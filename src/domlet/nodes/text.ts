import { withTextStub } from '../stubs/interfaces';
import {
  defineInterface,
} from '../../web-idl/binding';
import {
  isText, NodeImpl, type NodeOptions, NodeType,
} from './node';
import { characterDataIDL, CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { SlottableMixin } from './slottable';

export const textIDL = defineInterface({
  name: 'Text',
  parent: characterDataIDL,
  exposed: ['Window'],
  constructible: true,
  members: {},
});

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
    return text.#slottable.assignedSlot ?? text.parentNode;
  }
}
