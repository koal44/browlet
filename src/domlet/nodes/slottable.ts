import type { ElementImpl } from './element';

// DOM section 4.2.2. Element and Text own one of these; other Node types do
// not have slottable state.
export class SlottableMixin {
  #assignedSlot: ElementImpl | null = null;

  get assignedSlot(): ElementImpl | null {
    return this.#assignedSlot;
  }

  setAssignedSlot(slot: ElementImpl | null): void {
    this.#assignedSlot = slot;
  }
}
