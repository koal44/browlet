import {
  attr, defineInterface, idlType, impl, nullable, reference, roAttr, xattr,
} from '../../../web-idl/index';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import { NodeImpl, NodeType } from './node';
import type { DOMEnvironment } from '../environment';

/** An attribute's name, namespace, value, and association with an element. */
// https://dom.spec.whatwg.org/#interface-attr
export class AttrImpl extends NodeImpl {
  /** Element carrying this attribute, or null while detached. */
  ownerElement: ElementImpl | null = null;
  /** Attribute name without its namespace prefix. */
  localName: string;
  /** Namespace URI, or null for an attribute without a namespace. */
  namespaceURI: string | null;
  /** Prefix used in the qualified name, or null when absent. */
  prefix: string | null;
  /** Stored text; changes through value notify the owning element. */
  #value: string;

  constructor(
    localName: string,
    value: string,
    namespaceURI: string | null = null,
    prefix: string | null = null,
    ownerDoc: DocumentImpl,
    env: DOMEnvironment,
  ) {
    super(NodeType.Attribute, ownerDoc, env);
    this.localName = localName;
    this.#value = value;
    this.namespaceURI = namespaceURI;
    this.prefix = prefix;
  }

  static is(value: unknown): value is AttrImpl {
    return value instanceof AttrImpl;
  }

  /** Attribute text; assigning it notifies the owning element of the change. */
  // https://dom.spec.whatwg.org/#dom-attr-value
  get value(): string {
    return this.#value;
  }

  set value(value: string) {
    const oldValue = this.#value;
    this.#value = value;
    this.ownerElement?.attributeChanged(this.localName, oldValue, value, this.namespaceURI);
  }

  /** Qualified name, including the prefix when present. */
  // https://dom.spec.whatwg.org/#concept-attribute-qualified-name
  get name(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }

  /** Historical flag that always reports true. */
  // https://dom.spec.whatwg.org/#dom-attr-specified
  get specified(): boolean {
    return true;
  }
}

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
export const attrIDL = defineInterface({
  name: 'Attr',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(AttrImpl),
  members: [
    roAttr('namespaceURI', nullable(idlType.DOMString)),
    roAttr('prefix', nullable(idlType.DOMString)),
    roAttr('localName', idlType.DOMString),
    roAttr('name', idlType.DOMString),
    attr('value', idlType.DOMString, xattr('CEReactions')),
    roAttr('ownerElement', nullable(reference('Element'))),
    roAttr('specified', idlType.boolean),
  ],
});
