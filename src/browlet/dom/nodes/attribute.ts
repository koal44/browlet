import { withAttrStub } from '../../stubs';
import {
  attr, defineInterface, idlType, nullable, readonlyAttr, reference, xattr,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { NodeImpl, NodeType } from './node';

/*
 * [Exposed=Window]
 * interface Attr : Node {
 *   readonly attribute DOMString? namespaceURI;
 *   readonly attribute DOMString? prefix;
 *   readonly attribute DOMString localName;
 *   readonly attribute DOMString name;
 *   [CEReactions] attribute DOMString value;
 *
 *   readonly attribute Element? ownerElement;
 *
 *   readonly attribute boolean specified; // historical; always returns true
 * };
 */
export class AttrImpl
  extends withAttrStub(NodeImpl)
  implements Attr
{
  #element: ElementImpl | null = null;
  readonly #localName: string;
  #value: string;
  readonly #namespaceURI: string | null;
  readonly #prefix: string | null;

  constructor(
    localName: string,
    value: string,
    namespaceURI: string | null = null,
    prefix: string | null = null,
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(NodeType.Attribute, ownerDocument);
    this.#localName = localName;
    this.#value = value;
    this.#namespaceURI = namespaceURI;
    this.#prefix = prefix;
  }

  get localName(): string {
    return this.#localName;
  }

  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    this.#value = value;
  }

  get namespaceURI(): string | null {
    return this.#namespaceURI;
  }

  get prefix(): string | null {
    return this.#prefix;
  }

  get name(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }

  get ownerElement(): ElementImpl | null {
    return this.#element;
  }

  get specified(): boolean {
    return true;
  }

  // -- Friends ----------------------------------------------------------

  static is(value: unknown): value is AttrImpl {
    return NodeImpl.is(value) && #localName in value;
  }

  static setOwnerElement(
    attribute: AttrImpl,
    element: ElementImpl | null,
  ): void {
    attribute.#element = element;
  }
}

// -- Web IDL ------------------------------------------------------------

export const attrIDL = defineInterface({
  binding: bind(AttrImpl),
  exposed: 'Window',
  inherits: 'Node',
  members: [
    readonlyAttr('namespaceURI', nullable(idlType.DOMString)),
    readonlyAttr('prefix', nullable(idlType.DOMString)),
    readonlyAttr('localName', idlType.DOMString),
    readonlyAttr('name', idlType.DOMString),
    attr('value', idlType.DOMString, xattr('CEReactions')),
    readonlyAttr('ownerElement', nullable(reference('Element'))),
    readonlyAttr('specified', idlType.boolean),
  ],
  name: 'Attr',
});
