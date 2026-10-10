import { HTML_NAMESPACE } from '../../../../infra/index';
import { InternalError } from '../../../../infra/internal-error';
import { defineInterface, impl } from '../../../../web-idl/index';

import { defineElementInterface, type ElementImpl } from '../element';
import type { TextImpl } from '../text';
import { HTMLElementImpl } from './html-element';

/** Slot identity and retained assignment state; shadow assignment is unfinished. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-slot-element
export class HTMLSlotElementImpl extends HTMLElementImpl {
  /** Slottables assigned by the DOM's assignment algorithm, initially empty. */
  // https://dom.spec.whatwg.org/#slot-assigned-nodes
  assignedNodesList: (ElementImpl | TextImpl)[] = [];

  override isSlot(): this is HTMLSlotElementImpl {
    return true;
  }

  /** Recompute this slot's assignments and notify changes. */
  // https://dom.spec.whatwg.org/#assign-slotables
  assignSlottables(): void {
    // PROVISIONAL(DOM shadow trees): outside a shadow tree, an empty slot stays empty.
    if (this.getRoot().isShadowRoot() || this.assignedNodesList.length !== 0) {
      throw new InternalError('DOM slot assignment is not implemented');
    }
  }

  /** Add this slot to its agent's pending slot-change set. */
  // https://dom.spec.whatwg.org/#signal-a-slot-change
  signalSlotChange(): void {
    // PROVISIONAL(DOM shadow trees): delivery must join mutation-observer notification.
    throw new InternalError('DOM slot-change delivery is not implemented');
  }
}

/*
 * [Exposed=Window]
 * interface HTMLSlotElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *   [CEReactions, Reflect] attribute DOMString name;
 *   sequence<Node> assignedNodes(optional AssignedNodesOptions options = {});
 *   sequence<Element> assignedElements(optional AssignedNodesOptions options = {});
 *   undefined assign((Element or Text)... nodes);
 * };
 */
// PROVISIONAL: expose slot identity only; its author operations await shadow assignment.
export const htmlSlotElementIDL = defineInterface({
  name: 'HTMLSlotElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSlotElementImpl),
  members: [],
});

export const htmlSlotElementInterface = defineElementInterface({
  definition: htmlSlotElementIDL,
  namespaceURI: HTML_NAMESPACE,
  localNames: ['slot'],
});
