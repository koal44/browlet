import { assert, describe, expect, it } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE } from '../../../../../../src/infra/index';
import { Browlet } from '../../../../../../src/browlet/browlet';
import { HTMLElementImpl } from '../../../../../../src/browlet/dom/nodes/html/html-element';
import { createTestDocument, parseTestDocument } from '../../../../../support/dom';

// https://html.spec.whatwg.org/multipage/dom.html#the-translate-attribute
describe('HTML translation mode', () => {
  // SPEC_CLASH(translate-empty-value): Empty enables translation even beneath translate=no.
  it.each([
    [null, null], ['', true], ['yes', true], ['YES', true], ['YeS', true],
    ['no', false], ['NO', false], ['No', false],
    ['true', null], ['false', null], ['inherit', null], [' yes', null], ['no ', null],
    ['\t', null], ['yeſ', null],
  ] satisfies [string | null, boolean | null][])('interprets %j without trimming or Unicode folding', (value, own) => {
    const document = createTestDocument();
    const parent = document.createElementNS(HTML_NAMESPACE, 'div');
    const child = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(parent instanceof HTMLElementImpl && child instanceof HTMLElementImpl);
    parent.appendChild(child);
    if (value !== null) child.setAttribute('translate', value);
    for (const inherited of [false, true]) {
      parent.translate = inherited;
      expect(child.isTranslationEnabled()).toBe(own ?? inherited);
      expect(child.translate).toBe(own ?? inherited);
      expect(child.getAttribute('translate')).toBe(value);
    }
  });

  it('inherits through foreign elements, whose translate attributes do not change the mode', () => {
    const document = createTestDocument();
    const parent = document.createElementNS(HTML_NAMESPACE, 'div');
    parent.setAttribute('translate', 'no');
    for (const namespace of [SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:foreign']) {
      const foreign = document.createElementNS(namespace, 'container');
      const child = document.createElementNS(HTML_NAMESPACE, 'span');
      assert(child instanceof HTMLElementImpl);
      foreign.setAttribute('translate', 'yes');
      child.setAttributeNS('urn:other', 'other:translate', 'yes');
      child.setAttribute('TRANSLATE', 'yes'); // XML attribute names preserve case.
      parent.appendChild(foreign);
      foreign.appendChild(child);
      expect(foreign.isTranslationEnabled()).toBe(false);
      expect(child.translate).toBe(false);
      child.translate = true;
      expect(child.isTranslationEnabled()).toBe(true);
      expect(foreign.isTranslationEnabled()).toBe(false);
    }
  });

  it('uses current ancestry after attribute mutation, reparenting, detachment, and adoption', () => {
    const document = parseTestDocument('<article translate=no><p><span></span></p></article><aside></aside>');
    const article = document.querySelector('article')!;
    const parent = document.querySelector('p')!;
    const child = document.querySelector('span')!;
    const aside = document.querySelector('aside')!;
    expect(child.isTranslationEnabled()).toBe(false);
    parent.setAttribute('translate', '');
    expect(child.isTranslationEnabled()).toBe(true);
    parent.removeAttribute('translate');
    article.removeAttribute('translate');
    expect(child.isTranslationEnabled()).toBe(true);
    article.setAttribute('translate', 'no');
    expect(child.isTranslationEnabled()).toBe(false);
    aside.appendChild(parent);
    expect(child.isTranslationEnabled()).toBe(true);
    article.appendChild(parent);
    document.createDocumentFragment().appendChild(parent);
    expect(child.isTranslationEnabled()).toBe(true);
    const other = createTestDocument(document.env);
    const otherParent = other.createElementNS(HTML_NAMESPACE, 'section');
    otherParent.setAttribute('translate', 'no');
    otherParent.appendChild(parent);
    expect(child.nodeDocument).toBe(other);
    expect(child.isTranslationEnabled()).toBe(false);
    parent.remove();
    expect(child.isTranslationEnabled()).toBe(true);
  });

  it.each(['open', 'closed'] as const)('uses ordinary parents in a %s shadow tree', (mode) => {
    const document = createTestDocument();
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    host.setAttribute('translate', 'no');
    const shadow = host.attachShadow({
      mode, delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const slot = document.createElementNS(HTML_NAMESPACE, 'slot');
    const fallback = document.createElementNS(HTML_NAMESPACE, 'span');
    const assigned = document.createElementNS(HTML_NAMESPACE, 'span');
    shadow.appendChild(slot);
    slot.appendChild(fallback);
    host.appendChild(assigned);
    expect(assigned.getAssignedSlot()).toBe(slot);
    expect(slot.isTranslationEnabled()).toBe(true); // The host is not the slot's parent element.
    expect(fallback.isTranslationEnabled()).toBe(true);
    expect(assigned.isTranslationEnabled()).toBe(false); // Assignment does not replace its parent.
    slot.setAttribute('translate', 'no');
    host.setAttribute('translate', 'yes');
    expect(fallback.isTranslationEnabled()).toBe(false);
    expect(assigned.isTranslationEnabled()).toBe(true);
  });

  it('exposes the inherited boolean and writes canonical keywords through the platform binding', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const child = document.createElement('span');
      parent.append(child);
      parent.translate = false;
      const inherited = [child.translate, child.getAttribute('translate')];
      child.translate = true;
      const enabled = [child.translate, child.getAttribute('translate')];
      child.translate = false;
      const disabled = [child.translate, child.getAttribute('translate')];
      child.removeAttribute('translate');
      parent.removeAttribute('translate');
      return [inherited, enabled, disabled, child.translate, child.hasAttribute('translate')];
    })).toEqual([[false, null], [true, 'yes'], [false, 'no'], true, false]);
  });

  it('lets Web IDL convert author values to booleans without invoking object coercion hooks', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const object = { [Symbol.toPrimitive]() { throw new Error('Boolean conversion must not call this'); } };
      return [false, 0, '', null, undefined, true, 1, 'false', object].map((value) => {
        Reflect.set(element, 'translate', value);
        return [element.translate, element.getAttribute('translate')];
      });
    })).toEqual([
      [false, 'no'], [false, 'no'], [false, 'no'], [false, 'no'], [false, 'no'],
      [true, 'yes'], [true, 'yes'], [true, 'yes'], [true, 'yes'],
    ]);
  });
});

describe('HTML translatable attributes', () => {
  it.each([
    ['th', ['abbr']], ['area', ['alt', 'download']], ['img', ['alt']],
    ['input', ['alt', 'placeholder']], ['a', ['download']], ['optgroup', ['label']],
    ['option', ['label']], ['track', ['label']], ['textarea', ['placeholder']],
    ['iframe', ['srcdoc']], ['div', []], ['td', []], ['x-widget', []], ['unknown', []],
  ] satisfies [string, string[]][])('classifies the inventory for %s independently of translation mode', (tag, own) => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, tag);
    const expected = ['lang', 'style', 'title', ...own];
    for (const name of ['abbr', 'alt', 'content', 'download', 'label', 'lang', 'placeholder', 'srcdoc', 'style', 'title', 'value', 'id']) {
      element.setAttribute(name, 'text');
      const attribute = element.getAttributeNode(name)!;
      expect(element.isTranslatableAttribute(attribute), name).toBe(expected.includes(name));
      element.setAttribute('translate', 'no');
      expect(element.isTranslatableAttribute(attribute), name).toBe(expected.includes(name));
    }
  });

  it('only translates input values in the Button and Reset Button states', () => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, 'input');
    element.setAttribute('value', 'label');
    const attribute = element.getAttributeNode('value')!;
    for (const type of [null, 'text', 'submit', 'image', 'hidden', 'invalid', 'button', 'BUTTON', 'reset', 'ReSeT', ' button']) {
      if (type === null) element.removeAttribute('type');
      else element.setAttribute('type', type);
      expect(element.isTranslatableAttribute(attribute), String(type))
        .toBe(type === 'button' || type === 'BUTTON' || type === 'reset' || type === 'ReSeT');
    }
  });

  it('does not give foreign, differently cased, or namespaced attributes HTML translation rules', () => {
    const document = createTestDocument();
    for (const namespace of [HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:foreign']) {
      const element = document.createElementNS(namespace, 'input');
      for (const name of ['title', 'alt', 'lang']) {
        element.setAttribute(name, 'text');
        expect(element.isTranslatableAttribute(element.getAttributeNode(name)!)).toBe(namespace === HTML_NAMESPACE);
        element.setAttribute(name.toUpperCase(), 'text');
        expect(element.isTranslatableAttribute(element.getAttributeNode(name.toUpperCase())!)).toBe(false);
        element.setAttributeNS('urn:other', `other:${name}`, 'text');
        expect(element.isTranslatableAttribute(element.getAttributeNodeNS('urn:other', name)!)).toBe(false);
      }
    }
  });

  it('keeps metadata-name and ARIA translation dependencies explicit', () => {
    const document = createTestDocument();
    const meta = document.createElementNS(HTML_NAMESPACE, 'meta');
    meta.setAttribute('content', 'text');
    const content = meta.getAttributeNode('content')!;
    expect(meta.isTranslatableAttribute(content)).toBe(false);
    meta.setAttribute('http-equiv', 'refresh');
    expect(meta.isTranslatableAttribute(content)).toBe(false);
    meta.setAttribute('name', 'description');
    expect(() => meta.isTranslatableAttribute(content)).toThrow('Metadata-name translation rules are not implemented');
    for (const namespace of [HTML_NAMESPACE, SVG_NAMESPACE]) {
      const element = document.createElementNS(namespace, 'a');
      element.setAttribute('aria-label', 'text');
      expect(() => element.isTranslatableAttribute(element.getAttributeNode('aria-label')!))
        .toThrow('ARIA attribute translation rules are not implemented');
    }
  });
});
