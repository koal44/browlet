import { HTML_NAMESPACE } from '../../../../infra/index';
import { InternalError } from '../../../../infra/internal-error';
import { defineInterface, impl } from '../../../../web-idl/index';

import { defineElementInterface, type ElementImpl } from '../element';
import type { TextImpl } from '../text';
import { HTMLElementImpl } from './html-element';

/** Slot identity and retained assignment state; shadow assignment is unfinished. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-slot-element
export class HTMLSlotElementImpl extends HTMLElementImpl {
  /** Name matched against slottables; distinct from this element's own slot assignment name. */
  // https://dom.spec.whatwg.org/#slot-name
  slotName = '';
  /** Slottables assigned by the DOM's assignment algorithm, initially empty. */
  // https://dom.spec.whatwg.org/#slot-assigned-nodes
  assignedNodesList: (ElementImpl | TextImpl)[] = [];

  override isSlot(): this is HTMLSlotElementImpl {
    return true;
  }

  override attributeChanged(
    localName: string, oldValue: string | null, value: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, value, namespace);
    if (localName !== 'name' || namespace !== null || (oldValue ?? '') === (value ?? '')) return;
    this.slotName = value ?? '';
    this.getRoot().assignSlottablesForTree();
  }

  /** Recompute this slot's assignments and notify changes. */
  // https://dom.spec.whatwg.org/#assign-slotables
  assignSlottables(): void {
    // PROVISIONAL(DOM shadow trees): assignment supports only an empty slot outside a shadow tree.
    if (this.getRoot().isShadowRoot() || this.assignedNodesList.length !== 0) {
      throw new InternalError('DOM slot assignment is not implemented');
    }
  }

  /** Queue this slot's change event for delivery after the Agent's mutation observers. */
  // https://dom.spec.whatwg.org/#signal-a-slot-change
  signalSlotChange(): void {
    const realm = this.env.realm;
    if (realm.isWindow()) {
      realm.agent.signalSlots.add(this);
      realm.agent.queueMutationObserverMicrotask();
    }
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
