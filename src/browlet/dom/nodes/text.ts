import type { EventImpl } from '../events/event';
import { arg, atArg, ctor, defineInterface, idlType, impl } from '../../../web-idl/index';
import { type NodeImpl, NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { SlottableMixin } from './slottable';
import type { DOMEnvironment } from '../environment';

/** Text content in a document tree, with slot assignment for shadow trees. */
// https://dom.spec.whatwg.org/#interface-text
export class TextImpl extends CharacterDataImpl {
  /** Slot assignment shared with element nodes. */
  #slottableMixin = new SlottableMixin();

  constructor(data: string, ownerDoc: DocumentImpl | null = null, env: DOMEnvironment) {
    super(NodeType.Text, data, ownerDoc, env);
  }

  static is(value: unknown): value is TextImpl {
    return value instanceof TextImpl;
  }

  // -- Internal ---------------------------------------------------------

  setAssignedSlot(slot: ElementImpl | null): void {
    this.#slottableMixin.assignedSlot = slot;
  }

  override getAssignedSlot(): ElementImpl | null {
    return this.#slottableMixin.assignedSlot;
  }

  override getEventParent(_event: EventImpl): NodeImpl | null {
    return this.#slottableMixin.assignedSlot ?? this.parentNode;
  }
}

/*
 * [Exposed=Window]
 * interface Text : CharacterData {
 *   constructor(optional DOMString data = "");
 *
 *   [NewObject] Text splitText(unsigned long offset);
 *   readonly attribute DOMString wholeText;
 * };
 */
export const textIDL = defineInterface<DOMEnvironment>({
  name: 'Text',
  inherits: 'CharacterData',
  exposed: 'Window',
  implementation: impl(TextImpl, {
    constructWith: [atArg(2, (ctx) => ctx.getEnvironment())],
  }),
  members: [ctor([
    arg('data', idlType.DOMString, { default: '', optional: true }),
  ])],
});
