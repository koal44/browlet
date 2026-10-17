import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, defineInterface, idlType, impl, reference, roAttr, xattr } from '../../../../../web-idl/index';

import type { NodeImpl } from '../../node';
import { HTMLElementImpl } from '../html-element';
import { HTMLHRElementImpl } from '../grouping/index';
import { HTMLDataListElementImpl } from './data-list';
import { HTMLOptGroupElementImpl } from './optgroup';
import { HTMLOptionElementImpl } from './option';
import { HTMLOptionsCollectionImpl } from './options-collection';

/** Select-owned option membership and explicit selected-index changes. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmlselectelement
// PROVISIONAL: automatic selectedness, form association, selectedcontent, and the remaining API await §4.10.
export class HTMLSelectElementImpl extends HTMLElementImpl {
  #options: HTMLOptionsCollectionImpl | undefined;

  override readonly isAllNamedElement = true;

  static is(value: unknown): value is HTMLSelectElementImpl {
    return value instanceof HTMLSelectElementImpl;
  }

  // https://html.spec.whatwg.org/#dom-select-options
  get options(): HTMLOptionsCollectionImpl {
    return this.#options ??= new HTMLOptionsCollectionImpl(this);
  }

  // https://html.spec.whatwg.org/#select-selected-index
  get selectedIndex(): number {
    return this.getOptionList().findIndex((option) => option.selectedness);
  }

  // https://html.spec.whatwg.org/#set-the-selected-index
  set selectedIndex(value: number) {
    const options = this.getOptionList();
    for (const option of options) option.selectedness = false;
    const selected = options[value];
    if (selected !== undefined) {
      selected.selectedness = true;
      selected.dirtiness = true;
    }
    this.updateSelectedContent();
  }

  /** Options in tree order, excluding the subtrees HTML omits from a select's list. */
  // https://html.spec.whatwg.org/#concept-select-option-list
  getOptionList(): HTMLOptionElementImpl[] {
    const options: HTMLOptionElementImpl[] = [];
    let node: NodeImpl | null = this.firstChild;
    while (node !== null) {
      let skipChildren = node instanceof HTMLSelectElementImpl || node instanceof HTMLHRElementImpl ||
        node instanceof HTMLDataListElementImpl;
      if (HTMLOptionElementImpl.is(node)) {
        options.push(node);
        skipChildren = true;
      }
      if (node instanceof HTMLOptGroupElementImpl) {
        for (let ancestor = node.parentNode; ancestor !== this && ancestor !== null; ancestor = ancestor.parentNode) {
          if (ancestor instanceof HTMLOptGroupElementImpl) {
            skipChildren = true;
            break;
          }
        }
      }
      if (!skipChildren) {
        node = node.nextDescendant(this);
      } else {
        while (node !== this && node.nextSibling === null) node = node.parentNode!;
        node = node === this ? null : node.nextSibling;
      }
    }
    return options;
  }

  /** Append blank options together, preserving existing optgroups. */
  // https://html.spec.whatwg.org/#append-new-option-elements
  appendNewOptions(count: number): void {
    const document = this.nodeDocument;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index++) {
      fragment.appendChild(document.createElementNode('option', HTML_NAMESPACE));
    }
    this.appendChild(fragment);
  }

  /** Normalize selectedness after option or select state changes. */
  // https://html.spec.whatwg.org/#selectedness-setting-algorithm
  resetSelectedness(): void {
    // TODO: Implement display-size, disabled-option, and single/multiple selection rules with their mutation hooks.
  }

  /** Update selectedcontent elements after an explicit selection change. */
  // https://html.spec.whatwg.org/#update-a-select's-selectedcontent
  updateSelectedContent(): void {
    // TODO: Implement selectedcontent ownership and cloning; do not fold this into options collection mutation.
  }

  protected override childrenChanged(): void {
    super.childrenChanged();
    this.resetSelectedness();
  }
}

/*
 * HTMLSelectElement's implemented fragment:
 * [SameObject] readonly attribute HTMLOptionsCollection options;
 * attribute long selectedIndex;
 */
export const htmlSelectElementIDL = defineInterface({
  name: 'HTMLSelectElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSelectElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['select'],
  members: [
    roAttr('options', reference(HTMLOptionsCollectionImpl), xattr('SameObject')),
    attr('selectedIndex', idlType.long),
  ],
});
