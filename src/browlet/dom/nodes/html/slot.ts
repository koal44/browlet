import { HTML_NAMESPACE } from '../../../../infra/index';
import { WeakOrderedSet } from '../../../../infra/collections';
import {
  arg, attr, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl,
  op, reference, reflect, sequence, union, xattr,
} from '../../../../web-idl/index';

import type { ElementImpl } from '../element';
import type { TextImpl } from '../text';
import { HTMLElementImpl } from './html-element';

/** Named/manual assignment, flattened fallback content, and slot-change signaling. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-slot-element
export class HTMLSlotElementImpl extends HTMLElementImpl {
  /** Name matched against slottables; distinct from this element's own slot assignment name. */
  // https://dom.spec.whatwg.org/#slot-name
  slotName = '';
  /** Slottables assigned by the DOM's assignment algorithm, initially empty. */
  // https://dom.spec.whatwg.org/#slot-assigned-nodes
  assignedNodesList: (ElementImpl | TextImpl)[] = [];
  /** Explicit assignments preserve order without retaining detached nodes. */
  // https://html.spec.whatwg.org/multipage/scripting.html#slot-manually-assigned-nodes
  manuallyAssignedNodes = new WeakOrderedSet<ElementImpl | TextImpl>();

  /** Return current assignments, optionally flattening nested slots and fallback children. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-slot-assignednodes
  assignedNodes(options: AssignedNodesOptions): (ElementImpl | TextImpl)[] {
    return options.flatten ? this.findFlattenedSlottables() : this.assignedNodesList;
  }

  /** Return only elements from the selected assignment list. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-slot-assignedelements
  assignedElements(options: AssignedNodesOptions): ElementImpl[] {
    return this.assignedNodes(options).filter((node) => node.isElement());
  }

  /** Replace explicit assignments, moving each node from its previous manual slot. */
  // https://html.spec.whatwg.org/multipage/scripting.html#dom-slot-assign
  assign(...nodes: (ElementImpl | TextImpl)[]): void {
    for (const node of this.manuallyAssignedNodes.values()) node.manualSlotAssignment = null;
    const assigned = new WeakOrderedSet<ElementImpl | TextImpl>();
    const slot = new WeakRef(this);
    const root = this.getRoot();
    const previousSlots = new Set<HTMLSlotElementImpl>();
    for (const node of nodes) {
      const reference = node.getManualReference();
      const previous = node.manualSlotAssignment?.deref();
      if (previous) {
        previous.manuallyAssignedNodes.delete(reference);
        if (previous.getRoot() !== root) previousSlots.add(previous);
      }
      node.manualSlotAssignment = slot;
      assigned.add(reference);
    }
    this.manuallyAssignedNodes = assigned;
    root.assignSlottablesForTree();
    // SPEC_CLASH(manual-slot-cross-root): follow Firefox/WebKit and refresh previous slots that HTML/Chromium leave stale.
    for (const previous of previousSlots) previous.assignSlottables();
  }

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

  /** Find host children assigned to this slot, in named or explicit order. */
  // https://dom.spec.whatwg.org/#find-slotables
  findSlottables(): (ElementImpl | TextImpl)[] {
    const result: (ElementImpl | TextImpl)[] = [];
    const root = this.getRoot();
    if (!root.isShadowRoot()) return result;
    if (root.slotAssignment === 'manual') {
      for (const node of this.manuallyAssignedNodes.values()) {
        if (node.parentNode === root.host) result.push(node);
      }
    } else {
      for (let node = root.host.firstChild; node; node = node.nextSibling) {
        if ((node.isElement() || node.isText()) && node.findSlot() === this) result.push(node);
      }
    }
    return result;
  }

  /** Recursively replace slots in this assignment with their assignments or fallback. */
  // https://dom.spec.whatwg.org/#find-flattened-slotables
  findFlattenedSlottables(): (ElementImpl | TextImpl)[] {
    const result: (ElementImpl | TextImpl)[] = [];
    if (!this.getRoot().isShadowRoot()) return result;
    const nodes = this.findSlottables();
    if (nodes.length === 0) {
      for (let node = this.firstChild; node; node = node.nextSibling) {
        if (node.isElement() || node.isText()) nodes.push(node);
      }
    }
    for (const node of nodes) {
      if (node.isSlot() && node.getRoot().isShadowRoot()) {
        for (const flattened of node.findFlattenedSlottables()) result.push(flattened);
      } else {
        result.push(node);
      }
    }
    return result;
  }

  /** Recompute this slot's assignments and notify changes. */
  // https://dom.spec.whatwg.org/#assign-slotables
  assignSlottables(): void {
    const nodes = this.findSlottables();
    if (nodes.length !== this.assignedNodesList.length ||
      nodes.some((node, index) => node !== this.assignedNodesList[index])) {
      this.signalSlotChange();
    }
    // SPEC_CLASH(stale-assigned-slot): browsers clear obsolete links; DOM only sets the new assignments.
    // Another slot may already have claimed a node while the tree's slots are being reassigned.
    for (const node of this.assignedNodesList) {
      if (node.getAssignedSlot() === this) node.setAssignedSlot(null);
    }
    this.assignedNodesList = nodes;
    for (const node of nodes) node.setAssignedSlot(this);
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
// HTMLConstructor remains with custom-element construction.
export const htmlSlotElementIDL = defineInterface({
  name: 'HTMLSlotElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSlotElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['slot'],
  members: [
    attr('name', idlType.DOMString, xattr('CEReactions', reflect())),
    op('assignedNodes', sequence(reference('Node')),
      [arg('options', reference('AssignedNodesOptions'), { optional: true, default: emptyDictionary })],
    ),
    op('assignedElements', sequence(reference('Element')),
      [arg('options', reference('AssignedNodesOptions'), { optional: true, default: emptyDictionary })],
    ),
    op('assign', idlType.undefined, [arg('nodes', union(reference('Element'), reference('Text')), { variadic: true })]),
  ],
});

/** Converted options shared by the two slot-query methods. */
export type AssignedNodesOptions = {
  flatten: boolean;
};

/*
 * dictionary AssignedNodesOptions {
 *   boolean flatten = false;
 * };
 */
export const assignedNodesOptionsIDL = defineDictionary({
  name: 'AssignedNodesOptions',
  members: [dictMember('flatten', idlType.boolean, { default: false })],
});
