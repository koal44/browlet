import { InternalError } from '../../../infra/internal-error';
import { defineInterfaceMixin, nullable, reference, roAttr } from '../../../web-idl/index';

import type { ElementImpl } from './element';
import type { TextImpl } from './text';
import type { HTMLSlotElementImpl } from './html/index';

/** Slot assignment state shared by element and text nodes. */
// https://dom.spec.whatwg.org/#concept-slotable
export class SlottableMixin {
  /** Slot receiving this node, or null while unassigned. */
  // https://dom.spec.whatwg.org/#slotable-assigned-slot
  assignedSlot: HTMLSlotElementImpl | null = null;

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
