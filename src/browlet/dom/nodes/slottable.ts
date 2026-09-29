import type { ElementImpl } from './element';

/** Slot assignment state shared by element and text nodes. */
// https://dom.spec.whatwg.org/#concept-slotable
export class SlottableMixin {
  /** Slot receiving this node, or null while unassigned. */
  // https://dom.spec.whatwg.org/#slotable-assigned-slot
  assignedSlot: ElementImpl | null = null;
}
