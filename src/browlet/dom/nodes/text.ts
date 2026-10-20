import { firstStrongDirection, isAsciiWhitespace, type TextDirection } from '../../../infra/index';
import { arg, atArg, ctor, defineIncludes, defineInterface, idlType, impl, op, reference, roAttr } from '../../../web-idl/core/index';

import { ContentCategory } from './element-definitions/index';
import type { EventImpl } from '../events/index';
import { RangeImpl } from '../ranges/index';
import type { DOMEnvironment } from '../environment';

import { type NodeImpl, NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { SlottableMixin, slottableIDL } from './slottable';
import type { HTMLSlotElementImpl } from './html/index';

/** Text content in a document tree, with slot assignment for shadow trees. */
// https://dom.spec.whatwg.org/#interface-text
export class TextImpl extends CharacterDataImpl {
  /** Slot assignment shared with element nodes. */
  #slottableMixin = new SlottableMixin();

  constructor(data: string, ownerDoc: DocumentImpl) {
    super(NodeType.Text, data, ownerDoc);
  }

  static is(value: unknown): value is TextImpl {
    return value instanceof TextImpl;
  }

  /** Concatenate this node and adjacent Text nodes, including CDATA sections. */
  // https://dom.spec.whatwg.org/#dom-text-wholetext
  get wholeText(): string {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Walk backward from this node to the start of the text run.
    let first: TextImpl = this;
    while (first.previousSibling?.isText()) first = first.previousSibling;
    let content = '';
    for (let node: NodeImpl | null = first; node?.isText(); node = node.nextSibling) content += node.data;
    return content;
  }

  /** Author-facing slot lookup excludes closed shadow roots. */
  // https://dom.spec.whatwg.org/#dom-slotable-assignedslot
  get assignedSlot(): HTMLSlotElementImpl | null {
    return this.#slottableMixin.findSlot(this, true);
  }

  /** Explicit assignment owner, retained weakly even while this node is detached. */
  get manualSlotAssignment(): WeakRef<HTMLSlotElementImpl> | null {
    return this.#slottableMixin.manualSlotAssignment;
  }

  set manualSlotAssignment(slot: WeakRef<HTMLSlotElementImpl> | null) {
    this.#slottableMixin.manualSlotAssignment = slot;
  }

  /** Direction of the first strong character, or null when this text has no strong character. */
  // https://html.spec.whatwg.org/multipage/dom.html#text-node-directionality
  getDirectionality(): TextDirection | null {
    return firstStrongDirection(this.data);
  }

  /** Whether this node is empty or contains only ASCII whitespace, including for CDATA sections. */
  // https://html.spec.whatwg.org/multipage/dom.html#inter-element-whitespace
  isInterElementWhitespace(): boolean {
    const data = this.data;
    for (let i = 0; i < data.length; i++) {
      if (!isAsciiWhitespace(data.charCodeAt(i))) return false;
    }
    return true;
  }

  /** Text is flow and phrasing content; only non-whitespace text is palpable. */
  // https://html.spec.whatwg.org/multipage/dom.html#text-content
  // https://html.spec.whatwg.org/multipage/dom.html#palpable-content
  hasCategory(category: ContentCategory): boolean {
    return category === ContentCategory.Flow || category === ContentCategory.Phrasing ||
      (category === ContentCategory.Palpable && !this.isInterElementWhitespace());
  }

  /** Split at a UTF-16 offset; the new Text belongs to this node's current document. */
  // https://dom.spec.whatwg.org/#concept-text-split
  splitText(offset: number): TextImpl {
    const count = this.length - offset;
    const data = this.substringData(offset, count);
    const newNode = this.nodeDocument.createTextNode(data);
    const parent = this.parentNode;
    if (parent !== null) {
      parent.insert(newNode, this.nextSibling);
      RangeImpl.adjustForSplitText(this, newNode, offset);
    }
    this.replaceData(offset, count, '');
    return newNode;
  }

  setAssignedSlot(slot: HTMLSlotElementImpl | null): void {
    this.#slottableMixin.assignedSlot = slot;
  }

  /** Stable weak identity used by slots' manual assignment sets. */
  getManualReference(): WeakRef<ElementImpl | TextImpl> {
    return this.#slottableMixin.getManualReference(this);
  }

  /** Find an applicable slot, optionally excluding a closed shadow root. */
  findSlot(open = false): HTMLSlotElementImpl | null {
    return this.#slottableMixin.findSlot(this, open);
  }

  /** Update slot assignment through the shared slottable behavior. */
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
  implementation: impl(TextImpl),
  members: [
    ctor(
      [arg('data', idlType.DOMString, { default: '', optional: true })],
      {
        constructWith: [
          atArg(1, (env) => env.realm.getAssociatedDocument()),
        ],
      },
    ),
    op('splitText', reference('Text'), [arg('offset', idlType.unsignedLong)]),
    roAttr('wholeText', idlType.DOMString),
  ],
});

/*
 * Text includes Slottable;
 */
export const textIncludesSlottableIDL = defineIncludes({
  interface: 'Text', mixin: slottableIDL.name,
});
