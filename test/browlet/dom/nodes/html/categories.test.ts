import { assert, describe, expect, it } from 'vitest';

import { ContentCategory } from '../../../../../src/browlet/dom/nodes/html/content-model';
import { HTMLElementImpl } from '../../../../../src/browlet/dom/nodes/html/html-element';
import { MathMLMathElementImpl } from '../../../../../src/browlet/dom/nodes/mathml/element';
import { ElementTag } from '../../../../../src/browlet/dom/nodes/element-tag';
import { HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE } from '../../../../../src/infra/index';
import { createTestDocument } from '../../../../support/dom';

describe('HTML content categories', () => {
  // Category expectations from the individual element definitions.
  // https://html.spec.whatwg.org/multipage/sections.html#the-article-element
  // https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element
  // https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-q-element
  // https://html.spec.whatwg.org/multipage/grouping-content.html#the-div-element
  // https://html.spec.whatwg.org/multipage/form-elements.html#the-optgroup-element
  it.each([
    ['article', [true, false, true, true]],
    ['blockquote', [true, false, false, true]],
    ['q', [true, true, false, true]],
    ['div', [true, false, false, true]],
    ['optgroup', [false, false, false, false]],
  ] as const)('reads %s categories from its concrete implementation', (name, expected) => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, name);
    const other = document.createElementNS(HTML_NAMESPACE, name);
    assert(element instanceof HTMLElementImpl);
    assert(other instanceof HTMLElementImpl);
    expect(element.categories).toBe(other.categories);
    expect(Object.hasOwn(element, 'categories')).toBe(false);
    expect(Object.hasOwn(other, 'categories')).toBe(false);
    const categories: ContentCategory[] = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Sectioning, ContentCategory.Palpable,
    ];
    expect(categories.map((category) => element.hasCategory(category))).toEqual(expected);
  });

  it('updates anchor interactivity with a namespace-less href attribute', () => {
    const anchor = createTestDocument().createElementNS(HTML_NAMESPACE, 'a');
    assert(anchor instanceof HTMLElementImpl);
    expect(anchor.hasCategory(ContentCategory.Interactive)).toBe(false);
    anchor.setAttribute('tabindex', '0');
    anchor.setAttributeNS('urn:other', 'x:href', '/target');
    expect(anchor.hasCategory(ContentCategory.Interactive)).toBe(false);
    anchor.setAttribute('href', '');
    expect(anchor.hasCategory(ContentCategory.Interactive)).toBe(true);
    anchor.removeAttribute('href');
    expect(anchor.hasCategory(ContentCategory.Interactive)).toBe(false);
    expect(anchor.hasCategory(ContentCategory.Phrasing)).toBe(true);
    expect(anchor.hasCategory(ContentCategory.Palpable)).toBe(true);
  });

  it('uses the parsed input type without changing its fixed form categories', () => {
    const input = createTestDocument().createElementNS(HTML_NAMESPACE, 'input');
    assert(input instanceof HTMLElementImpl);
    const conditional: ContentCategory[] = [
      ContentCategory.Interactive, ContentCategory.Labelable, ContentCategory.Palpable,
    ];
    expect(conditional.map((category) => input.hasCategory(category))).toEqual([true, true, true]);
    input.setAttribute('type', 'HiDdEn');
    expect(conditional.map((category) => input.hasCategory(category))).toEqual([false, false, false]);
    for (const category of [
      ContentCategory.FormAssociated, ContentCategory.Listed, ContentCategory.Submittable, ContentCategory.Resettable,
    ]) {
      expect(input.hasCategory(category)).toBe(true);
    }
    input.setAttribute('type', 'not-a-type');
    expect(conditional.map((category) => input.hasCategory(category))).toEqual([true, true, true]);
    input.removeAttribute('type');
    expect(input.hasCategory(ContentCategory.Labelable)).toBe(true);
  });

  it.each(['audio', 'video', 'img'])('uses current namespace-less controls on %s', (name) => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, name);
    expect(element.hasCategory(ContentCategory.Interactive)).toBe(false);
    expect(element.hasCategory(ContentCategory.Palpable)).toBe(name !== 'audio');
    element.setAttributeNS('urn:other', 'x:controls', '');
    expect(element.hasCategory(ContentCategory.Interactive)).toBe(false);
    element.setAttribute('controls', 'false');
    expect(element.hasCategory(ContentCategory.Interactive)).toBe(true);
    expect(element.hasCategory(ContentCategory.Palpable)).toBe(true);
    element.removeAttribute('controls');
    expect(element.hasCategory(ContentCategory.Interactive)).toBe(false);
    if (name === 'img') {
      element.setAttribute('usemap', '');
      expect(element.hasCategory(ContentCategory.Interactive)).toBe(true);
      element.removeAttribute('usemap');
      expect(element.hasCategory(ContentCategory.Interactive)).toBe(false);
    }
  });

  it.each<[string | null, boolean]>([
    [null, false], ['', true], [' \t\n', true], ['STYLESHEET preload', true],
    ['dns-prefetch modulepreload pingback preconnect prefetch preload stylesheet', true],
    ['alternate stylesheet', false], ['stylesheet icon', false], ['unknown', false],
  ])('classifies link rel=%j as allowed in the body: %s', (rel, allowed) => {
    const link = createTestDocument().createElementNS(HTML_NAMESPACE, 'link');
    if (rel !== null) link.setAttribute('rel', rel);
    for (const category of [ContentCategory.Flow, ContentCategory.Phrasing]) {
      expect(link.hasCategory(category)).toBe(allowed);
    }
    expect(link.hasCategory(ContentCategory.Metadata)).toBe(true);
    link.setAttribute('itemprop', '');
    expect(link.hasCategory(ContentCategory.Phrasing)).toBe(true);
    link.removeAttribute('itemprop');
    expect(link.hasCategory(ContentCategory.Phrasing)).toBe(allowed);
  });

  it('reads namespace-less itemprop on meta and preserves its metadata membership', () => {
    const meta = createTestDocument().createElementNS(HTML_NAMESPACE, 'meta');
    meta.setAttributeNS('urn:other', 'x:itemprop', '');
    expect(meta.hasCategory(ContentCategory.Flow)).toBe(false);
    meta.setAttribute('itemprop', '');
    expect(meta.hasCategory(ContentCategory.Flow)).toBe(true);
    expect(meta.hasCategory(ContentCategory.Phrasing)).toBe(true);
    meta.removeAttribute('itemprop');
    expect(meta.hasCategory(ContentCategory.Phrasing)).toBe(false);
    expect(meta.hasCategory(ContentCategory.Metadata)).toBe(true);
  });

  it('updates area membership when its map ancestry changes', () => {
    const document = createTestDocument();
    const area = document.createElementNS(HTML_NAMESPACE, 'area');
    const container = document.createElementNS(HTML_NAMESPACE, 'div');
    const map = document.createElementNS(HTML_NAMESPACE, 'map');
    const foreignMap = document.createElementNS(SVG_NAMESPACE, 'map');
    container.appendChild(area);
    foreignMap.appendChild(container);
    expect(area.hasCategory(ContentCategory.Flow)).toBe(false);
    map.appendChild(container);
    expect(area.hasCategory(ContentCategory.Flow)).toBe(true);
    expect(area.hasCategory(ContentCategory.Phrasing)).toBe(true);
    map.removeChild(container);
    expect(area.hasCategory(ContentCategory.Flow)).toBe(false);
  });

  it('requires an actual heading descendant for hgroup heading membership', () => {
    const document = createTestDocument();
    const group = document.createElementNS(HTML_NAMESPACE, 'hgroup');
    const container = document.createElementNS(HTML_NAMESPACE, 'div');
    container.appendChild(document.createElementNS(SVG_NAMESPACE, 'h1'));
    group.appendChild(container);
    expect(group.hasCategory(ContentCategory.Heading)).toBe(false);
    const heading = document.createElementNS(HTML_NAMESPACE, 'h6');
    container.appendChild(heading);
    expect(group.hasCategory(ContentCategory.Heading)).toBe(true);
    container.removeChild(heading);
    expect(group.hasCategory(ContentCategory.Heading)).toBe(false);
    expect(group.hasCategory(ContentCategory.Palpable)).toBe(true);
  });

  it('includes qualifying selectedcontent in both phrasing and flow', () => {
    const document = createTestDocument();
    const selected = document.createElementNS(HTML_NAMESPACE, 'selectedcontent');
    const span = document.createElementNS(HTML_NAMESPACE, 'span');
    const button = document.createElementNS(HTML_NAMESPACE, 'button');
    const select = document.createElementNS(HTML_NAMESPACE, 'select');
    span.appendChild(selected);
    button.appendChild(span);
    expect(selected.hasCategory(ContentCategory.Phrasing)).toBe(false);
    select.appendChild(button);
    expect(selected.hasCategory(ContentCategory.Phrasing)).toBe(true);
    expect(selected.hasCategory(ContentCategory.Flow)).toBe(true);
    select.removeChild(button);
    expect(selected.hasCategory(ContentCategory.Flow)).toBe(false);
  });

  it.each(['menu', 'ol', 'ul'])('requires a direct li child for palpable %s content', (name) => {
    const document = createTestDocument();
    const list = document.createElementNS(HTML_NAMESPACE, name);
    const wrapper = document.createElementNS(HTML_NAMESPACE, 'div');
    const item = document.createElementNS(HTML_NAMESPACE, 'li');
    wrapper.appendChild(item);
    list.appendChild(wrapper);
    list.appendChild(document.createElementNS(SVG_NAMESPACE, 'li'));
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(false);
    list.appendChild(item);
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(true);
    list.removeChild(item);
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(false);
  });

  it('recognizes dl groups through direct div children, including incomplete groups', () => {
    const document = createTestDocument();
    const list = document.createElementNS(HTML_NAMESPACE, 'dl');
    const div = document.createElementNS(HTML_NAMESPACE, 'div');
    const span = document.createElementNS(HTML_NAMESPACE, 'span');
    const value = document.createElementNS(HTML_NAMESPACE, 'dd');
    span.appendChild(value);
    div.appendChild(span);
    list.appendChild(div);
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(false);
    div.appendChild(value);
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(true);
    div.removeChild(value);
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(false);
    list.appendChild(document.createElementNS(HTML_NAMESPACE, 'dt'));
    expect(list.hasCategory(ContentCategory.Palpable)).toBe(true);
  });

  it('does not confuse category membership with hidden or disabled state', () => {
    const button = createTestDocument().createElementNS(HTML_NAMESPACE, 'button');
    button.setAttribute('hidden', '');
    button.setAttribute('disabled', '');
    expect(button.hasCategory(ContentCategory.Palpable)).toBe(true);
    expect(button.hasCategory(ContentCategory.Interactive)).toBe(true);
  });

  it('handles autonomous custom elements without changing customized built-in categories', () => {
    const document = createTestDocument();
    const custom = document.createElementNS(HTML_NAMESPACE, 'x-widget');
    expect(() => custom.hasCategory(ContentCategory.Flow)).toThrow('Content categories for x-widget are not implemented');
    custom.customElementDefinition = {
      name: 'x-widget', localName: 'x-widget', constructor: class {}, constructionStack: [],
    };
    custom.customElementState = 'custom';
    for (const category of [ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable]) {
      expect(custom.hasCategory(category)).toBe(true);
    }
    expect(custom.hasCategory(ContentCategory.Metadata)).toBe(false);
    expect(() => custom.hasCategory(ContentCategory.FormAssociated)).toThrow('Custom-element form association is not implemented');
    const button = document.createElementNS(HTML_NAMESPACE, 'button');
    button.customElementDefinition = {
      name: 'x-button', localName: 'button', constructor: class {}, constructionStack: [],
    };
    button.customElementState = 'custom';
    expect(button.hasCategory(ContentCategory.Interactive)).toBe(true);
    expect(button.hasCategory(ContentCategory.FormAssociated)).toBe(true);
  });

  it('queries foreign roots through Element and keeps unsupported vocabularies explicit', () => {
    const document = createTestDocument();
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    const math = document.createElementNS(MATHML_NAMESPACE, 'math');
    expect(math).toBeInstanceOf(MathMLMathElementImpl);
    expect(math.tag).toBe(ElementTag.MathMLMath);
    expect(math.cloneNode(false)).toBeInstanceOf(MathMLMathElementImpl);
    for (const element of [svg, math]) {
      for (const category of [ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable]) {
        expect(element.hasCategory(category)).toBe(true);
      }
      expect(element.hasCategory(ContentCategory.Metadata)).toBe(false);
    }
    const rdf = document.createElementNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'RDF');
    expect(() => rdf.hasCategory(ContentCategory.Metadata)).toThrow('Content categories for RDF are not implemented');
    const obsolete = document.createElementNS(HTML_NAMESPACE, 'center');
    expect(() => obsolete.hasCategory(ContentCategory.Flow)).toThrow('Content categories for center are not implemented');
  });

  it('queries Text and CDATA categories from their current data', () => {
    const document = createTestDocument();
    for (const text of [document.createTextNode(' \t'), document.createCDATASection(' \n')]) {
      expect(text.hasCategory(ContentCategory.Flow)).toBe(true);
      expect(text.hasCategory(ContentCategory.Phrasing)).toBe(true);
      expect(text.hasCategory(ContentCategory.Palpable)).toBe(false);
      text.data = '\u00a0';
      expect(text.hasCategory(ContentCategory.Palpable)).toBe(true);
      expect(text.hasCategory(ContentCategory.Metadata)).toBe(false);
      text.data = '';
      expect(text.hasCategory(ContentCategory.Palpable)).toBe(false);
    }
  });
});
