import { describe, expect, it } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../../../src/infra/index';
import { findImageMap } from '../../../../../../src/browlet/dom/nodes/html/embedded/index';
import { createTestDocument } from '../../../../../support/dom';

describe('HTML image-map references', () => {
  it('takes the first match in tree order without preferring id over name', () => {
    const document = createTestDocument();
    const root = document.createElementNS(HTML_NAMESPACE, 'div');
    const first = document.createElementNS(HTML_NAMESPACE, 'map');
    const second = document.createElementNS(HTML_NAMESPACE, 'map');
    const scope = document.createElementNS(HTML_NAMESPACE, 'img');
    first.setAttribute('name', 'target');
    second.setAttribute('id', 'target');
    root.append(first, second, scope);
    document.appendChild(root);
    expect(findImageMap('#target', scope)).toBe(first);
    root.insertBefore(second, first);
    expect(findImageMap('#target', scope)).toBe(second);
    first.remove();
    expect(findImageMap('#target', scope)).toBe(second);
    second.remove();
    expect(findImageMap('#target', scope)).toBeNull();
  });

  it('includes a detached element root when the context is its descendant', () => {
    const document = createTestDocument();
    const root = document.createElementNS(HTML_NAMESPACE, 'map');
    const scope = document.createTextNode('context');
    root.setAttribute('name', 'target');
    root.appendChild(scope);
    expect(findImageMap('#target', scope)).toBe(root);
    expect(findImageMap('#target', root)).toBe(root);
    expect(findImageMap('#target', document)).toBeNull();
  });

  it('matches the exact HTML local name and only null-namespace attributes', () => {
    const document = createTestDocument();
    const root = document.createDocumentFragment();
    const wrongTag = document.createElementNS(HTML_NAMESPACE, 'div');
    const foreign = document.createElementNS(SVG_NAMESPACE, 'map');
    const noNamespace = document.createElementNS(null, 'map');
    const wrongCase = document.createElementNS(HTML_NAMESPACE, 'MAP');
    const wrongAttributes = document.createElementNS(HTML_NAMESPACE, 'map');
    const target = document.createElementNS(HTML_NAMESPACE, 'prefix:map');
    for (const element of [wrongTag, foreign, noNamespace, wrongCase, target]) {
      element.setAttribute('name', 'target');
    }
    wrongAttributes.setAttributeNS('urn:other', 'name', 'target');
    wrongAttributes.setAttributeNS('urn:other', 'id', 'target');
    root.append(wrongTag, foreign, noNamespace, wrongCase, wrongAttributes, target);
    expect(findImageMap('#target', root)).toBe(target);
    target.remove();
    expect(findImageMap('#target', root)).toBeNull();
  });

  it('keeps light and shadow trees separate', () => {
    const document = createTestDocument();
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    const light = document.createElementNS(HTML_NAMESPACE, 'map');
    const shadowMap = document.createElementNS(HTML_NAMESPACE, 'map');
    light.setAttribute('name', 'light');
    shadowMap.setAttribute('name', 'shadow');
    host.appendChild(light);
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    shadow.appendChild(shadowMap);
    expect(findImageMap('#light', host)).toBe(light);
    expect(findImageMap('#shadow', host)).toBeNull();
    expect(findImageMap('#shadow', shadow)).toBe(shadowMap);
    expect(findImageMap('#light', shadowMap)).toBeNull();
  });

  it.each(['#target', 'prefix#target', 'https://other.example/#target', ' \n#target'])(
    'finds the map for %j by taking everything after the first hash', (input) => {
      const document = createTestDocument();
      const target = document.createElementNS(HTML_NAMESPACE, 'map');
      target.setAttribute('name', 'target');
      expect(findImageMap(input, target)).toBe(target);
    },
  );

  it.each(['', 'target', '#', 'prefix#', '#TARGET', '#target ', '#%74arget', '#other#target'])(
    'does not resolve %j to target', (input) => {
      const document = createTestDocument();
      const target = document.createElementNS(HTML_NAMESPACE, 'map');
      target.setAttribute('name', 'target');
      expect(findImageMap(input, target)).toBeNull();
    },
  );

  it('keeps additional hashes, whitespace, and percent escapes as literal name data', () => {
    const document = createTestDocument();
    const target = document.createElementNS(HTML_NAMESPACE, 'map');
    for (const value of ['#target', ' target ', '%74arget', 'café']) {
      target.setAttribute('name', value);
      expect(findImageMap(`#${value}`, target)).toBe(target);
    }
  });

  it('rejects an empty reference suffix even when a map has an empty name', () => {
    const document = createTestDocument();
    const target = document.createElementNS(HTML_NAMESPACE, 'map');
    target.setAttribute('name', '');
    expect(findImageMap('#', target)).toBeNull();
  });
});
