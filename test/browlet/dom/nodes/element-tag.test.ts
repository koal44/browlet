import { assert, describe, expect, it } from 'vitest';

import { ElementTag } from '../../../../src/browlet/dom/nodes/element-definitions/element-tag';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../src/infra/index';
import { createTestDocument } from '../../../support/dom';

describe('Element tag identities', () => {
  it('distinguishes HTML and SVG identities and retains them through cloning and adoption', () => {
    const source = createTestDocument();
    const target = createTestDocument();
    const cases: [string, string, ElementTag][] = [
      [HTML_NAMESPACE, 'title', ElementTag.HTMLTitle],
      [HTML_NAMESPACE, 'style', ElementTag.HTMLStyle],
      [HTML_NAMESPACE, 'script', ElementTag.HTMLScript],
      [SVG_NAMESPACE, 'title', ElementTag.SVGTitle],
      [SVG_NAMESPACE, 'style', ElementTag.SVGStyle],
      [SVG_NAMESPACE, 'script', ElementTag.SVGScript],
      [SVG_NAMESPACE, 'svg', ElementTag.SVGSvg],
    ];
    for (const [namespace, name, tag] of cases) {
      const element = source.createElementNS(namespace, name);
      expect(element.tag).toBe(tag);
      expect(Object.hasOwn(element, 'tag')).toBe(false);
      const clone = element.cloneNode(false);
      assert(clone.isElement());
      expect(clone.tag).toBe(tag);
      expect(Object.hasOwn(clone, 'tag')).toBe(false);
      target.adoptNode(element);
      expect(element.nodeDocument).toBe(target);
      expect(element.tag).toBe(tag);
    }
  });

  it('uses Other for arbitrary names and names outside their registered namespace or case', () => {
    const document = createTestDocument();
    const cases: [string | null, string][] = [
      [HTML_NAMESPACE, 'x-widget'], [HTML_NAMESPACE, 'unknown'], [HTML_NAMESPACE, 'DIV'],
      [SVG_NAMESPACE, 'li'], ['urn:other', 'div'], [null, 'div'],
    ];
    for (const [namespace, name] of cases) {
      const element = document.createElementNS(namespace, name);
      expect(element.tag, `${namespace}: ${name}`).toBe(ElementTag.Other);
      expect(Object.hasOwn(element, 'tag')).toBe(false);
      const clone = element.cloneNode(false);
      assert(clone.isElement());
      expect(clone.tag).toBe(ElementTag.Other);
    }
  });
});
