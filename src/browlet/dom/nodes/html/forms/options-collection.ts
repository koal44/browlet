import {
  arg, attr, defineInterface, DOMExceptionImpl, DOMExceptionNames, idlType, impl, nullable, op,
  reference, union, xattr,
} from '../../../../../web-idl/core/index';

import { HTMLCollectionImpl } from '../../collections';
import { HTMLElementImpl } from '../html-element';
import { HTMLOptGroupElementImpl } from './optgroup';
import { HTMLOptionElementImpl } from './option';
import type { HTMLSelectElementImpl } from './select';

/** Live options owned by a select, with mutations performed through the DOM mutation algorithms. */
// https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#htmloptionscollection
export class HTMLOptionsCollectionImpl extends HTMLCollectionImpl {
  #select: HTMLSelectElementImpl;

  constructor(select: HTMLSelectElementImpl) {
    super({ root: select, collect: () => select.getOptionList() });
    this.#select = select;
  }

  // https://html.spec.whatwg.org/#dom-htmloptionscollection-length
  override get length(): number { return super.length; }
  override set length(value: number) {
    const current = this.length;
    if (value > current) {
      if (value > 100000) return;
      this.#select.appendNewOptions(value - current);
    } else if (value < current) {
      // Snapshot before removal so each mutation does not recollect the live list.
      const removed = this.items.slice(value);
      for (const option of removed) option.removeNode();
    }
  }

  // https://html.spec.whatwg.org/#dom-htmloptionscollection-selectedindex
  get selectedIndex(): number { return this.#select.selectedIndex; }
  set selectedIndex(value: number) { this.#select.selectedIndex = value; }

  /** Assign an indexed option, padding gaps with blank options; null removes it. */
  // https://html.spec.whatwg.org/#dom-htmloptionscollection-setter
  setOption(index: number, option: HTMLOptionElementImpl | null): void {
    if (option === null) {
      this.remove(index);
      return;
    }
    const delta = index - this.length;
    if (delta > 0) this.#select.appendNewOptions(delta);
    if (delta >= 0) {
      this.#select.appendChild(option);
    } else {
      const old = this.item(index)!;
      old.parentNode!.replaceChild(option, old);
    }
  }

  /** Insert before an option index or a descendant element, preserving its parent. */
  // https://html.spec.whatwg.org/#dom-htmloptionscollection-add
  add(element: HTMLOptionElementImpl | HTMLOptGroupElementImpl, before: HTMLElementImpl | number | null): void {
    if (element.contains(this.#select)) {
      throw new DOMExceptionImpl('', DOMExceptionNames.hierarchyRequest);
    }
    if (before !== null && typeof before !== 'number' &&
      (before === this.#select || !this.#select.contains(before))) {
      throw new DOMExceptionImpl('', DOMExceptionNames.notFound);
    }
    if (element === before) return;
    const reference = typeof before === 'number' ? this.item(before) : before;
    const parent = reference === null ? this.#select : reference.parentNode!;
    parent.insertBefore(element, reference);
  }

  /** Remove the indexed option from its actual parent; out-of-range indices do nothing. */
  // https://html.spec.whatwg.org/#htmloptionscollection-remove-an-option
  remove(index: number): void {
    this.item(index)?.removeNode();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLOptionsCollection : HTMLCollection {
 *   [CEReactions] attribute unsigned long length;
 *   [CEReactions] setter undefined (unsigned long index, HTMLOptionElement? option);
 *   [CEReactions] undefined add((HTMLOptionElement or HTMLOptGroupElement) element,
 *                              optional (HTMLElement or long)? before = null);
 *   [CEReactions] undefined remove(long index);
 *   attribute long selectedIndex;
 * };
 */
export const htmlOptionsCollectionIDL = defineInterface({
  name: 'HTMLOptionsCollection',
  inherits: 'HTMLCollection',
  exposed: 'Window',
  implementation: impl(HTMLOptionsCollectionImpl),
  members: [
    // TODO: [CEReactions] entry/exit awaits the custom-element reaction machinery.
    attr('length', idlType.unsignedLong, xattr('CEReactions')),
    op(undefined, idlType.undefined,
      [arg('index', idlType.unsignedLong), arg('option', nullable(reference(HTMLOptionElementImpl)))],
      {
        ...xattr('CEReactions'),
        special: 'setter',
        invoke(_env, index, option) {
          (this as HTMLOptionsCollectionImpl).setOption(index, option);
        },
      },
    ),
    op('add', idlType.undefined,
      [
        arg('element', union(reference(HTMLOptionElementImpl), reference(HTMLOptGroupElementImpl))),
        arg('before', nullable(union(reference(HTMLElementImpl), idlType.long)), { optional: true, default: null }),
      ],
      xattr('CEReactions'),
    ),
    op('remove', idlType.undefined, [arg('index', idlType.long)], xattr('CEReactions')),
    attr('selectedIndex', idlType.long),
  ],
});
