import { withTextStub } from '../../stubs';
import type { EventImpl } from '../events/event';
import { arg, ctor, defineInterface, idlType, impl } from '../../../web-idl/index';
import { type NodeImpl, NodeType } from './node';
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
export class TextImpl extends withTextStub(CharacterDataImpl) {
  #slottableMixin = new SlottableMixin();

  constructor(data: string, ownerDocument: DocumentImpl | null = null) {
    super(NodeType.Text, data, ownerDocument);
  }

  static is(value: unknown): value is TextImpl {
    return value instanceof TextImpl;
  }

  // -- Internal ---------------------------------------------------------

  setAssignedSlot(slot: ElementImpl | null): void {
    this.#slottableMixin.setAssignedSlot(slot);
  }

  override getAssignedSlot(): ElementImpl | null {
    return this.#slottableMixin.assignedSlot;
  }

  override getEventParent(_event: EventImpl): NodeImpl | null {
    return this.#slottableMixin.assignedSlot ?? this.parentNode;
  }
}

// -- Web IDL ------------------------------------------------------------

export const textIDL = defineInterface({
  name: 'Text',
  inherits: 'CharacterData',
  exposed: 'Window',
  implementation: impl(TextImpl),
  members: [ctor([
    arg('data', idlType.DOMString, { default: '', optional: true }),
  ])],
});
