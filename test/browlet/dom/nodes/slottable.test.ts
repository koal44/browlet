import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('Slottable', () => {
  it('exposes assignedSlot on Element and Text and returns null outside a shadow host', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('div');
      const element = document.createElement('span');
      const text = document.createTextNode('text');
      parent.appendChild(element);
      parent.appendChild(text);
      return [
        Object.hasOwn(Element.prototype, 'assignedSlot'),
        Object.hasOwn(Text.prototype, 'assignedSlot'),
        document.createElement('detached').assignedSlot,
        element.assignedSlot,
        text.assignedSlot,
      ];
    })).toEqual([true, true, null, null, null]);
  });

  it('creates the HTML slot identity without treating an XML slot as an HTML slot', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const slot = document.createElement('slot');
      const parent = document.createElement('div');
      parent.appendChild(slot);
      return [slot instanceof HTMLSlotElement, slot.parentNode === parent, slot.assignedSlot];
    })).toEqual([true, true, null]);

    const document = createTestDocument();
    expect(document.createElementNode('slot', HTML_NAMESPACE).isSlot()).toBe(true);
    expect(document.createElementNS('urn:test', 'slot').isSlot()).toBe(false);
    expect(document.createTextNode('slot').isSlot()).toBe(false);
  });

  it('allows empty shadow trees and hides closed-root slot lookup', () => {
    const document = createTestDocument();
    const host = document.createElementNode('div', HTML_NAMESPACE);
    const text = document.createTextNode('text');
    host.shadowRoot = new ShadowRootImpl(host, 'open', document.env);
    host.appendChild(text);
    expect(text.assignedSlot).toBeNull();

    // attachShadow is a later slice; this is the implementation state it supplies.
    const closed = new ShadowRootImpl(host, 'closed', document.env);
    host.shadowRoot = closed;
    expect(text.assignedSlot).toBeNull();
    expect(text.getAssignedSlot()).toBeNull();
  });
});
