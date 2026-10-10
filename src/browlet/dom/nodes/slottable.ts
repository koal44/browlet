import { InternalError } from '../../../infra/internal-error';
import { defineInterfaceMixin, nullable, reference, roAttr } from '../../../web-idl/index';

import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import type { HTMLSlotElementImpl } from './html/index';

/** Slot assignment state shared by element and text nodes. */
// https://dom.spec.whatwg.org/#concept-slotable
export class SlottableMixin {
  /** Name selected by an element's slot attribute; Text always keeps the empty name. */
  // https://dom.spec.whatwg.org/#slotable-name
  name = '';
  /** Slot receiving this node, or null while unassigned. */
  // https://dom.spec.whatwg.org/#slotable-assigned-slot
  assignedSlot: HTMLSlotElementImpl | null = null;

  /** Update the slottable name after a null-namespace slot attribute changes. */
  // https://dom.spec.whatwg.org/#slotable-name
  attributeChanged(node: ElementImpl, oldValue: string | null, value: string | null): void {
    if ((oldValue ?? '') === (value ?? '')) return;
    this.name = value ?? '';
    this.assignedSlot?.assignSlottables();
    this.assignSlot(node);
  }

  /** Find an applicable slot, optionally excluding a closed shadow root. */
  // https://dom.spec.whatwg.org/#find-a-slot
  findSlot(node: ElementImpl | TextImpl, open = false): HTMLSlotElementImpl | null {
    const parent = node.parentNode;
    const shadow = parent?.isElement() ? parent.shadowRoot : null;
    if (shadow === null || (open && shadow.mode !== 'open')) return null;
    for (let descendant = shadow.firstChild; descendant; descendant = descendant.nextDescendant(shadow)) {
      if (descendant.isSlot()) {
        // PROVISIONAL(DOM shadow trees): naming/manual assignment needs the complete slot algorithms.
        throw new InternalError('DOM slot lookup is not implemented');
      }
    }
    return null;
  }

  /** Find this slottable's slot and update that slot's assigned nodes. */
  // https://dom.spec.whatwg.org/#assign-a-slot
  assignSlot(node: ElementImpl | TextImpl): void {
    this.findSlot(node)?.assignSlottables();
  }
}

/*
 * interface mixin Slottable {
 *   readonly attribute HTMLSlotElement? assignedSlot;
 * };
 */
export const slottableIDL = defineInterfaceMixin({
  name: 'Slottable',
  members: [roAttr('assignedSlot', nullable(reference('HTMLSlotElement')))],
});
