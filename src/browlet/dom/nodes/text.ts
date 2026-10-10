import { arg, atArg, ctor, defineIncludes, defineInterface, idlType, impl } from '../../../web-idl/index';

import type { EventImpl } from '../events/index';
import type { DOMEnvironment } from '../environment';

import { type NodeImpl, NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';
import { SlottableMixin, slottableIDL } from './slottable';
import type { HTMLSlotElementImpl } from './html/index';

/** Text content in a document tree, with slot assignment for shadow trees. */
// https://dom.spec.whatwg.org/#interface-text
export class TextImpl extends CharacterDataImpl {
  /** Slot assignment shared with element nodes. */
  #slottableMixin = new SlottableMixin();

  constructor(data: string, ownerDoc: DocumentImpl, env: DOMEnvironment) {
    super(NodeType.Text, data, ownerDoc, env);
  }

  static is(value: unknown): value is TextImpl {
    return value instanceof TextImpl;
  }

  /** Author-facing slot lookup excludes closed shadow roots. */
  // https://dom.spec.whatwg.org/#dom-slotable-assignedslot
  get assignedSlot(): HTMLSlotElementImpl | null {
    return this.#slottableMixin.findSlot(this, true);
  }

  setAssignedSlot(slot: HTMLSlotElementImpl | null): void {
    this.#slottableMixin.assignedSlot = slot;
  }

  /** Update named slot assignment through the shared slottable behavior. */
  assignSlot(): void {
    this.#slottableMixin.assignSlot(this);
  }

  override getAssignedSlot(): HTMLSlotElementImpl | null {
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
  members: [
    ctor(
      [arg('data', idlType.DOMString, { default: '', optional: true })],
      {
        constructWith: [
          atArg(1, (ctx) => ctx.realm.getAssociatedDocument()),
          atArg(2, (ctx) => ctx.getEnvironment()),
        ],
      },
    ),
  ],
});

/*
 * Text includes Slottable;
 */
export const textIncludesSlottableIDL = defineIncludes({
  interface: 'Text', mixin: slottableIDL.name,
});
