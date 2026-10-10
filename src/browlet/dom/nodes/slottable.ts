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
  /** Explicit assignment owner, retained weakly even while the node is detached. */
  // https://dom.spec.whatwg.org/#slottable-manual-slot-assignment
  manualSlotAssignment: WeakRef<HTMLSlotElementImpl> | null = null;
  /** Stable weak identity allocated only when an author manually assigns this node. */
  #manualReference: WeakRef<ElementImpl | TextImpl> | undefined;

  /** Reuse the node's weak identity when transferring it between manual assignment sets. */
  getManualReference(node: ElementImpl | TextImpl): WeakRef<ElementImpl | TextImpl> {
    return this.#manualReference ??= new WeakRef(node);
  }

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
    if (shadow.slotAssignment === 'manual') {
      const slot = this.manualSlotAssignment?.deref();
      return slot?.getRoot() === shadow ? slot : null;
    }
    for (let descendant = shadow.firstChild; descendant; descendant = descendant.nextDescendant(shadow)) {
      if (descendant.isSlot() && descendant.slotName === this.name) return descendant;
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
