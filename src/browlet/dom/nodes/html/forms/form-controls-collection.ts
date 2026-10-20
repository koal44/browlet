import {
  attr, defineInterface, idlType, impl, nullable, reference, union,
} from '../../../../../web-idl/core/index';

import { HTMLCollectionImpl, NodeListImpl, type LiveCollectionSource } from '../../collections';
import type { ElementImpl } from '../../element';
import type { NodeImpl } from '../../node';
import { HTMLInputElementImpl } from './input';

/** Live listed controls supplied by their owner, including controls outside its subtree. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#htmlformcontrolscollection
export class HTMLFormControlsCollectionImpl extends HTMLCollectionImpl {
  #root: NodeImpl;

  constructor(source: LiveCollectionSource<ElementImpl>) {
    super(source);
    this.#root = source.root;
  }

  /** Nonempty IDs and names in tree order, with each element's ID first. */
  override getSupportedPropertyNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const element of this.items) {
      const id = element.getAttributeNS(null, 'id');
      const name = element.getAttributeNS(null, 'name');
      if (id) names.add(id);
      if (name) names.add(name);
    }
    return names;
  }

  /** One matching control, a new live list of multiple matches, or null. */
  // https://html.spec.whatwg.org/#dom-htmlformcontrolscollection-nameditem
  namedItemOrItems(name: string): RadioNodeListImpl | ElementImpl | null {
    if (name === '') return null;
    const matches = (element: ElementImpl) =>
      element.getAttributeNS(null, 'id') === name || element.getAttributeNS(null, 'name') === name;
    let match: ElementImpl | null = null;
    for (const element of this.items) {
      if (!matches(element)) continue;
      if (match !== null) {
        return new RadioNodeListImpl({
          root: this.#root,
          collect: () => this.items.filter(matches),
        });
      }
      match = element;
    }
    return match;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLFormControlsCollection : HTMLCollection {
 *   getter (RadioNodeList or Element)? namedItem(DOMString name);
 * };
 */
export const htmlFormControlsCollectionIDL = defineInterface({
  name: 'HTMLFormControlsCollection',
  inherits: 'HTMLCollection',
  exposed: 'Window',
  implementation: impl(HTMLFormControlsCollectionImpl),
  members: [
    {
      kind: 'named-getter', name: 'namedItem', method: 'namedItemOrItems',
      returns: nullable(union(reference('RadioNodeList'), reference('Element'))),
    },
  ],
});

/** A live name-filtered node list; value only considers radio-button inputs. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#radionodelist
export class RadioNodeListImpl extends NodeListImpl {
  // https://html.spec.whatwg.org/#dom-radionodelist-value
  get value(): string {
    for (const node of this.items) {
      if (HTMLInputElementImpl.is(node) && node.typeState === 'radio' && node.checkedness) {
        return node.getAttributeNS(null, 'value') ?? 'on';
      }
    }
    return '';
  }

  set value(value: string) {
    for (const node of this.items) {
      if (HTMLInputElementImpl.is(node) && node.typeState === 'radio' &&
        (node.getAttributeNS(null, 'value') ?? 'on') === value) {
        // Unlike the author-facing checked setter, this does not set dirty checkedness.
        node.setCheckedness(true);
        return;
      }
    }
  }
}

/*
 * [Exposed=Window]
 * interface RadioNodeList : NodeList {
 *   attribute DOMString value;
 * };
 */
export const radioNodeListIDL = defineInterface({
  name: 'RadioNodeList',
  inherits: 'NodeList',
  exposed: 'Window',
  implementation: impl(RadioNodeListImpl),
  members: [attr('value', idlType.DOMString)],
});
