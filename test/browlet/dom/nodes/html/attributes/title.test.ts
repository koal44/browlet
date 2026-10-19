import { assert, describe, expect, it } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../../../src/infra/index';
import { Browlet } from '../../../../../../src/browlet/browlet';
import { HTMLElementImpl } from '../../../../../../src/browlet/dom/nodes/html/html-element';
import { unwrap } from '../../../../../support/browlet-binding';
import { createTestDocument, parseTestDocument } from '../../../../../support/dom';

// https://html.spec.whatwg.org/multipage/dom.html#the-title-attribute
describe('HTML title advisory information', () => {
  it('uses the nearest title, including an empty title that blocks inheritance', () => {
    const document = parseTestDocument('<article title="outer"><p title="near"><span></span></p></article>');
    const article = document.querySelector('article');
    const parent = document.querySelector('p');
    const element = document.querySelector('span');
    assert(article instanceof HTMLElementImpl && parent instanceof HTMLElementImpl && element instanceof HTMLElementImpl);

    expect(element.getAdvisoryInformation()).toBe('near');
    element.setAttribute('title', 'own');
    expect(element.getAdvisoryInformation()).toBe('own');
    element.setAttribute('title', '');
    expect(element.getAdvisoryInformation()).toBe('');
    element.removeAttribute('title');
    parent.setAttribute('title', '');
    expect(element.getAdvisoryInformation()).toBe('');
    parent.removeAttribute('title');
    expect(element.getAdvisoryInformation()).toBe('outer');
    article.removeAttribute('title');
    expect(element.getAdvisoryInformation()).toBe('');
  });

  it('normalizes line endings without trimming, collapsing, or changing the attribute', () => {
    const document = createTestDocument();
    const parent = document.createElementNS(HTML_NAMESPACE, 'div');
    const element = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(parent instanceof HTMLElementImpl && element instanceof HTMLElementImpl);
    parent.appendChild(element);
    const raw = '  first\r\nsecond\rthird\nfourth\t\u2028\uD800 ';
    parent.setAttribute('title', raw);
    expect(parent.getAdvisoryInformation()).toBe('  first\nsecond\nthird\nfourth\t\u2028\uD800 ');
    expect(element.getAdvisoryInformation()).toBe(parent.getAdvisoryInformation());
    expect(parent.getAttribute('title')).toBe(raw);
    element.setAttribute('title', ' \t\n ');
    expect(element.getAdvisoryInformation()).toBe(' \t\n ');
  });

  it('uses current ancestry after reparenting, detachment, and adoption', () => {
    const document = createTestDocument();
    const first = document.createElementNS(HTML_NAMESPACE, 'div');
    const second = document.createElementNS(HTML_NAMESPACE, 'div');
    const element = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(element instanceof HTMLElementImpl);
    first.setAttribute('title', 'first');
    second.setAttribute('title', 'second');
    first.appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('first');
    second.appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('second');
    element.remove();
    expect(element.getAdvisoryInformation()).toBe('');

    const other = createTestDocument(document.env);
    const otherParent = other.createElementNS(HTML_NAMESPACE, 'div');
    otherParent.setAttribute('title', 'adopted');
    otherParent.appendChild(element);
    expect(element.nodeDocument).toBe(other);
    expect(element.getAdvisoryInformation()).toBe('adopted');
    other.createDocumentFragment().appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('');
  });

  it('skips foreign-element titles and ignores namespaced or differently cased lookalikes', () => {
    const document = createTestDocument();
    const ancestor = document.createElementNS(HTML_NAMESPACE, 'div');
    const foreign = document.createElementNS(SVG_NAMESPACE, 'svg');
    const element = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(element instanceof HTMLElementImpl);
    ancestor.setAttribute('title', 'HTML ancestor');
    foreign.setAttribute('title', 'foreign');
    element.setAttributeNS('urn:other', 'other:title', 'namespaced');
    element.setAttribute('TITLE', 'uppercase in XML');
    ancestor.appendChild(foreign);
    foreign.appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('HTML ancestor');
    foreign.setAttribute('title', '');
    expect(element.getAdvisoryInformation()).toBe('HTML ancestor');
    ancestor.removeAttribute('title');
    expect(element.getAdvisoryInformation()).toBe('');
  });

  // SPEC_CLASH(title-shadow-ancestry): Follow browser flat-tree ancestry; WHATWG HTML #13035.
  it.each(['open', 'closed'] as const)('inherits through %s shadow roots and assigned slots', (mode) => {
    const document = createTestDocument();
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    host.setAttribute('title', 'host');
    const shadow = host.attachShadow({
      mode, delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const shadowChild = document.createElementNS(HTML_NAMESPACE, 'span');
    const shadowParent = document.createElementNS(HTML_NAMESPACE, 'p');
    shadow.appendChild(shadowParent);
    shadowParent.appendChild(shadowChild);
    const slot = document.createElementNS(HTML_NAMESPACE, 'slot');
    slot.setAttribute('title', 'slot');
    shadowParent.appendChild(slot);
    const lightChild = document.createElementNS(HTML_NAMESPACE, 'span');
    host.appendChild(lightChild);
    assert(shadowChild instanceof HTMLElementImpl && lightChild instanceof HTMLElementImpl);

    expect(lightChild.getAssignedSlot()).toBe(slot);
    expect(shadowChild.getAdvisoryInformation()).toBe('host');
    expect(lightChild.getAdvisoryInformation()).toBe('slot');
    slot.setAttribute('title', '');
    expect(lightChild.getAdvisoryInformation()).toBe('');
    slot.removeAttribute('title');
    expect(lightChild.getAdvisoryInformation()).toBe('host');
    shadowParent.setAttribute('title', 'shadow ancestor');
    expect(shadowChild.getAdvisoryInformation()).toBe('shadow ancestor');
    expect(lightChild.getAdvisoryInformation()).toBe('shadow ancestor');
    shadowParent.removeAttribute('title');
    host.removeAttribute('title');
    expect(lightChild.getAdvisoryInformation()).toBe('');
  });

  it('updates inherited titles when named or manual slot assignment changes', () => {
    const document = createTestDocument();
    for (const slotAssignment of ['named', 'manual'] as const) {
      const host = document.createElementNS(HTML_NAMESPACE, 'div');
      host.setAttribute('title', 'host');
      const shadow = host.attachShadow({
        mode: 'open', delegatesFocus: false, slotAssignment, clonable: false, serializable: false,
      });
      const first = document.createElementNS(HTML_NAMESPACE, 'slot');
      const second = document.createElementNS(HTML_NAMESPACE, 'slot');
      assert(first.isSlot() && second.isSlot());
      first.setAttribute('name', 'first');
      second.setAttribute('name', 'second');
      first.setAttribute('title', 'first slot');
      second.setAttribute('title', 'second slot');
      shadow.append(first, second);
      const element = document.createElementNS(HTML_NAMESPACE, 'span');
      assert(element instanceof HTMLElementImpl);
      host.appendChild(element);
      expect(element.getAdvisoryInformation()).toBe(''); // No assignment: absent from the flat tree.

      if (slotAssignment === 'manual') first.assign(element);
      else element.setAttribute('slot', 'first');
      expect(element.getAssignedSlot()).toBe(first);
      expect(element.getAdvisoryInformation()).toBe('first slot');
      if (slotAssignment === 'manual') second.assign(element);
      else element.setAttribute('slot', 'second');
      expect(element.getAssignedSlot()).toBe(second);
      expect(element.getAdvisoryInformation()).toBe('second slot');
      if (slotAssignment === 'manual') second.assign();
      else element.removeAttribute('slot');
      expect(element.getAssignedSlot()).toBeNull();
      expect(element.getAdvisoryInformation()).toBe('');
      element.setAttribute('title', 'own');
      expect(element.getAdvisoryInformation()).toBe('own');
    }
  });

  it('uses slot fallback only while the slot has no assigned content', () => {
    const document = createTestDocument();
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const slot = document.createElementNS(HTML_NAMESPACE, 'slot');
    slot.setAttribute('title', 'fallback title');
    const fallback = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(fallback instanceof HTMLElementImpl);
    shadow.appendChild(slot);
    slot.appendChild(fallback);
    expect(fallback.getAdvisoryInformation()).toBe('fallback title');
    const assigned = document.createTextNode('assigned text');
    host.appendChild(assigned);
    expect(fallback.getAdvisoryInformation()).toBe('');
    assigned.removeNode();
    expect(fallback.getAdvisoryInformation()).toBe('fallback title');
  });

  it('follows a slot that is itself assigned through another shadow tree', () => {
    const document = createTestDocument();
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    host.setAttribute('title', 'outer host');
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const innerHost = document.createElementNS(HTML_NAMESPACE, 'div');
    shadow.appendChild(innerHost);
    const outerSlot = document.createElementNS(HTML_NAMESPACE, 'slot');
    innerHost.appendChild(outerSlot);
    const innerShadow = innerHost.attachShadow({
      mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const innerSlot = document.createElementNS(HTML_NAMESPACE, 'slot');
    innerSlot.setAttribute('title', 'inner slot');
    innerShadow.appendChild(innerSlot);
    const element = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(element instanceof HTMLElementImpl);
    host.appendChild(element);
    expect(element.getAssignedSlot()).toBe(outerSlot);
    expect(outerSlot.getAssignedSlot()).toBe(innerSlot);
    expect(element.getAdvisoryInformation()).toBe('inner slot');
    outerSlot.setAttribute('title', 'outer slot');
    expect(element.getAdvisoryInformation()).toBe('outer slot');
    outerSlot.setAttribute('title', '');
    expect(element.getAdvisoryInformation()).toBe('');
    outerSlot.removeAttribute('title');
    innerSlot.removeAttribute('title');
    expect(element.getAdvisoryInformation()).toBe('outer host');
  });

  it.each(['link', 'style'])('%s does not inherit a title, including when its own title is removed', (tag) => {
    const document = parseTestDocument('<html><head title="ancestor"></head><body></body></html>');
    const element = document.createElementNS(HTML_NAMESPACE, tag);
    assert(element instanceof HTMLElementImpl && document.head !== null);
    document.head.appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('');
    element.setAttribute('title', 'own\r\ntitle');
    expect(element.getAdvisoryInformation()).toBe('own\ntitle');
    expect(element.getAttribute('title')).toBe('own\r\ntitle');
    element.setAttribute('title', '');
    expect(element.getAdvisoryInformation()).toBe('');
    element.removeAttribute('title');
    element.setAttributeNS('urn:other', 'other:title', 'namespaced');
    expect(element.getAdvisoryInformation()).toBe('');

    // DOM mutation permits these descendants even though HTML's content models do not.
    const child = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(child instanceof HTMLElementImpl);
    element.appendChild(child);
    expect(child.getAdvisoryInformation()).toBe('');
    element.setAttribute('title', 'own');
    expect(child.getAdvisoryInformation()).toBe('own');
  });

  it('ignores a style title outside a document tree, including a connected shadow tree', () => {
    const document = parseTestDocument('<div></div>');
    const element = document.createElementNS(HTML_NAMESPACE, 'style');
    assert(element instanceof HTMLElementImpl && document.head !== null);
    element.setAttribute('title', 'own');
    expect(element.getAdvisoryInformation()).toBe('');
    document.head.appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('own');
    const host = document.querySelector('div');
    assert(host !== null);
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    shadow.appendChild(element);
    expect(element.isConnected).toBe(true);
    expect(element.getAdvisoryInformation()).toBe('');
    expect(element.getAttribute('title')).toBe('own');
    document.head.appendChild(element);
    expect(element.getAdvisoryInformation()).toBe('own');
  });

  it('keeps IDL title reflection local and raw while advisory information inherits and normalizes', async () => {
    const browser = new Browlet({ route: () => '' });
    const { inheritedTitle, ownTitle } = await browser.evaluate((raw) => {
      const parent = document.createElement('div');
      const element = document.createElement('span');
      element.id = 'title-target';
      parent.title = raw;
      parent.append(element);
      document.body.append(parent);
      const inheritedTitle = element.title;
      element.title = raw;
      return { inheritedTitle, ownTitle: element.title };
    }, 'one\r\ntwo\rthree');

    const element = browser.window.document.getElementById('title-target');
    assert(element instanceof browser.window.HTMLElement);
    const implementation = unwrap<HTMLElementImpl>(element);
    expect(inheritedTitle).toBe('');
    expect(ownTitle).toBe('one\r\ntwo\rthree');
    expect(implementation.getAdvisoryInformation()).toBe('one\ntwo\nthree');
    element.removeAttribute('title');
    expect(element.title).toBe('');
    expect(implementation.getAdvisoryInformation()).toBe('one\ntwo\nthree');
  });
});
