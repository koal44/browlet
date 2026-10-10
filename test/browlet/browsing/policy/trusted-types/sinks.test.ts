import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';
import { HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE, XLINK_NAMESPACE } from '../../../../../src/infra/namespaces';

describe('Trusted Types sink metadata', () => {
  const factory = new Browlet({ route: () => '' }).window.trustedTypes;

  it.each([
    ['IFRAME', 'SRCDOC', undefined, undefined, 'TrustedHTML'],
    ['script', 'src', null, null, 'TrustedScriptURL'],
    ['ScRiPt', 'sRc', HTML_NAMESPACE, '', 'TrustedScriptURL'],
    ['iframe', 'srcdoc', SVG_NAMESPACE, null, null],
    ['iframe', 'src', HTML_NAMESPACE, null, null],
    ['script', 'src', HTML_NAMESPACE, 'urn:attribute', null],
    ['script', 'href', SVG_NAMESPACE, null, 'TrustedScriptURL'],
    ['SCRIPT', 'HREF', SVG_NAMESPACE, XLINK_NAMESPACE, 'TrustedScriptURL'],
    ['script', 'xlink:href', SVG_NAMESPACE, null, null],
    ['a', 'href', SVG_NAMESPACE, XLINK_NAMESPACE, null],
    ['script', 'src', MATHML_NAMESPACE, null, null],
    ['iframe', 'srcdoc', 'urn:element', null, null],
    ['script', 'text', HTML_NAMESPACE, null, null],
  ] as const)('classifies %s / %s with element namespace %s and attribute namespace %s', (tag, attr, elementNs, attrNs, type) => {
    expect(factory.getAttributeType(tag, attr, elementNs, attrNs)).toBe(type);
  });

  it.each([
    'onclick', 'onbeforeunload', 'onencrypted', 'onwaitingforkey', 'onbegin', 'onend', 'onrepeat',
    'onpointerrawupdate', 'ontouchstart', 'onanimationend', 'ontransitioncancel', 'onselectionchange',
    'oncontentvisibilityautostatechange', 'onscrollsnapchange',
  ])('recognizes the content handler %s across HTML, SVG, and MathML', (attribute) => {
    for (const namespace of [HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE]) {
      expect(factory.getAttributeType('anything', attribute.toUpperCase(), namespace)).toBe('TrustedScript');
      expect(factory.getAttributeType('anything', attribute, namespace, 'urn:attribute')).toBeNull();
    }
    expect(factory.getAttributeType('anything', attribute, 'urn:element')).toBeNull();
  });

  it.each(['ondoesnotexist', 'once', 'on', 'onopen', 'onreadystatechange', 'onmessageavailable', 'ONCLİCK'])(
    'does not invent a content handler for %s', (attribute) => {
      expect(factory.getAttributeType('div', attribute)).toBeNull();
    },
  );

  it.each([
    ['IFRAME', 'srcdoc', undefined, 'TrustedHTML'],
    ['iframe', 'srcDoc', undefined, null],
    ['SCRIPT', 'src', null, 'TrustedScriptURL'],
    ['script', 'innerText', HTML_NAMESPACE, 'TrustedScript'],
    ['script', 'text', HTML_NAMESPACE, 'TrustedScript'],
    ['script', 'textContent', HTML_NAMESPACE, 'TrustedScript'],
    ['script', 'textcontent', HTML_NAMESPACE, null],
    ['script', 'text', SVG_NAMESPACE, null],
    ['script', 'href', SVG_NAMESPACE, null],
    ['div', 'innerText', HTML_NAMESPACE, null],
    ['div', 'onclick', HTML_NAMESPACE, null],
    ['custom-name', 'innerHTML', HTML_NAMESPACE, 'TrustedHTML'],
    ['g', 'outerHTML', SVG_NAMESPACE, 'TrustedHTML'],
    ['mi', 'innerHTML', MATHML_NAMESPACE, 'TrustedHTML'],
    ['anything', 'innerHTML', 'urn:element', 'TrustedHTML'],
  ] as const)('classifies the property %s.%s in %s', (tag, property, namespace, type) => {
    expect(factory.getPropertyType(tag, property, namespace)).toBe(type);
  });
});
