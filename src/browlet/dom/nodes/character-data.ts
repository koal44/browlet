import {
  annotated, attr, defineIncludes, defineInterface, idlType, impl, xattr,
} from '../../../web-idl/index';
import { NodeImpl, type NodeType } from './node';
import { ChildNodeMixin, childNodeIDL } from './child-node';
import {
  NonDocumentTypeChildNodeMixin, nonDocumentTypeChildNodeIDL,
} from './non-document-type-child-node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import type { DOMEnvironment } from '../environment';

/** Text storage and mutation behavior shared by character-data nodes. */
// https://dom.spec.whatwg.org/#interface-characterdata
export class CharacterDataImpl extends NodeImpl {
  /** Child-node mutation operations shared with other node classes. */
  #childNodeMixin = new ChildNodeMixin(this);
  /** Node text stored as UTF-16 code units. */
  #data: string;
  /** Element-sibling navigation that skips intervening non-elements. */
  #nonDocumentTypeChildNodeMixin = new NonDocumentTypeChildNodeMixin(this);

  constructor(
    nodeType: NodeType,
    data: string,
    ownerDoc: DocumentImpl | null,
    env: DOMEnvironment,
  ) {
    super(nodeType, ownerDoc, env);
    this.#data = data;
  }

  static is(value: unknown): value is CharacterDataImpl {
    return value instanceof CharacterDataImpl;
  }

  /** Node text; assigning it notifies the parent of the content change. */
  // https://dom.spec.whatwg.org/#dom-characterdata-data
  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    // TODO(DOM replace data): include range adjustment and mutation records.
    this.#data = value;
    this.notifyParentChildrenChanged();
  }

  get previousElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.previousElementSibling;
  }

  get nextElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.nextElementSibling;
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
    // The remaining members depend on the DOM replace-data algorithm.
    attr('data', annotated(idlType.DOMString, xattr('LegacyNullToEmptyString'))),
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
