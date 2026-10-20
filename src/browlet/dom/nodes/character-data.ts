import {
  annotated, arg, attr, defineIncludes, defineInterface, idlType, impl, op, roAttr, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';

import { RangeImpl } from '../ranges/index';

import { NodeImpl, type NodeType } from './node';
import { ChildNodeMixin, childNodeIDL } from './child-node';
import {
  NonDocumentTypeChildNodeMixin, nonDocumentTypeChildNodeIDL,
} from './non-document-type-child-node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';

/** Text storage and mutation behavior shared by character-data nodes. */
// https://dom.spec.whatwg.org/#interface-characterdata
export class CharacterDataImpl extends NodeImpl {
  /** Child-node mutation operations shared with other node classes. */
  #childNodeMixin = new ChildNodeMixin(this);
  /** Node text stored as UTF-16 code units. */
  #data: string;
  /** Element-sibling navigation that skips intervening non-elements. */
  #nonDocumentTypeChildNodeMixin = new NonDocumentTypeChildNodeMixin(this);

  constructor(nodeType: NodeType, data: string, ownerDoc: DocumentImpl) {
    super(nodeType, ownerDoc, ownerDoc.env);
    this.#data = data;
  }

  static is(value: unknown): value is CharacterDataImpl {
    return value instanceof CharacterDataImpl;
  }

  /** Node text; assignment runs the full replace-data algorithm, even for an unchanged value. */
  // https://dom.spec.whatwg.org/#dom-characterdata-data
  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.replaceData(0, this.#data.length, value);
  }

  /** Number of UTF-16 code units, including individual surrogate code units. */
  // https://dom.spec.whatwg.org/#dom-characterdata-length
  get length(): number {
    return this.#data.length;
  }

  get previousElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.previousElementSibling;
  }

  get nextElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.nextElementSibling;
  }

  /** Read a UTF-16 span, truncating count at the end of the data. */
  // https://dom.spec.whatwg.org/#concept-cd-substring
  substringData(offset: number, count: number): string {
    if (offset > this.#data.length) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    return this.#data.slice(offset, offset + count);
  }

  // https://dom.spec.whatwg.org/#dom-characterdata-appenddata
  appendData(data: string): void {
    this.replaceData(this.#data.length, 0, data);
  }

  // https://dom.spec.whatwg.org/#dom-characterdata-insertdata
  insertData(offset: number, data: string): void {
    this.replaceData(offset, 0, data);
  }

  // https://dom.spec.whatwg.org/#dom-characterdata-deletedata
  deleteData(offset: number, count: number): void {
    this.replaceData(offset, count, '');
  }

  /** Replace a UTF-16 span, adjusting live ranges before notifying the parent. */
  // https://dom.spec.whatwg.org/#concept-cd-replace
  replaceData(offset: number, count: number, data: string, piAttributesAlreadyUpdated = false): void {
    const length = this.#data.length;
    if (offset > length) throw new DOMExceptionImpl('', DOMExceptionNames.indexSize);
    count = Math.min(count, length - offset);
    this.queueMutationRecord('characterData', null, null, this.#data, [], [], null, null);
    this.#data = this.#data.slice(0, offset) + data + this.#data.slice(offset + count);
    RangeImpl.adjustForReplaceData(this, offset, count, data.length);
    if (this.isProcessingInstruction() && !piAttributesAlreadyUpdated) this.updateAttributesFromData();
    this.notifyParentChildrenChanged();
  }

  before(...nodes: (NodeImpl | string)[]): void {
    this.#childNodeMixin.before(...nodes);
  }

  after(...nodes: (NodeImpl | string)[]): void {
    this.#childNodeMixin.after(...nodes);
  }

  replaceWith(...nodes: (NodeImpl | string)[]): void {
    this.#childNodeMixin.replaceWith(...nodes);
  }

  remove(): void {
    this.#childNodeMixin.remove();
  }
}

/*
 * [Exposed=Window]
 * interface CharacterData : Node {
 *   attribute [LegacyNullToEmptyString] DOMString data;
 *   readonly attribute unsigned long length;
 *   DOMString substringData(unsigned long offset, unsigned long count);
 *   undefined appendData(DOMString data);
 *   undefined insertData(unsigned long offset, DOMString data);
 *   undefined deleteData(unsigned long offset, unsigned long count);
 *   undefined replaceData(unsigned long offset, unsigned long count, DOMString data);
 * };
 */
export const characterDataIDL = defineInterface({
  name: 'CharacterData',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(CharacterDataImpl),
  members: [
    attr('data', annotated(idlType.DOMString, xattr('LegacyNullToEmptyString'))),
    roAttr('length', idlType.unsignedLong),
    op('substringData', idlType.DOMString, [arg('offset', idlType.unsignedLong), arg('count', idlType.unsignedLong)]),
    op('appendData', idlType.undefined, [arg('data', idlType.DOMString)]),
    op('insertData', idlType.undefined, [arg('offset', idlType.unsignedLong), arg('data', idlType.DOMString)]),
    op('deleteData', idlType.undefined, [arg('offset', idlType.unsignedLong), arg('count', idlType.unsignedLong)]),
    op('replaceData', idlType.undefined, [
      arg('offset', idlType.unsignedLong), arg('count', idlType.unsignedLong), arg('data', idlType.DOMString),
    ]),
  ],
});

/*
 * CharacterData includes ChildNode;
 */
export const characterDataIncludesChildNodeIDL = defineIncludes({
  interface: 'CharacterData',
  mixin: childNodeIDL.name,
});

/*
 * CharacterData includes NonDocumentTypeChildNode;
 */
export const characterDataIncludesNonDocumentTypeChildNodeIDL = defineIncludes({
  interface: 'CharacterData',
  mixin: nonDocumentTypeChildNodeIDL.name,
});
