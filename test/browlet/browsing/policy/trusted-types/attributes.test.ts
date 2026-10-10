import { describe, expect, it } from 'vitest';
import { HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE, XLINK_NAMESPACE } from '../../../../../src/infra/namespaces';
import type { ElementImpl } from '../../../../../src/browlet/dom/nodes/element';
import { unwrap } from '../../../../support/browlet-binding';
import { parseTestDocument } from '../../../../support/dom';
import { createTrustedTypesWindow, attachments } from './fixture';

describe('Trusted Types attribute enforcement', () => {
  it('rejects an untrusted sink value without adding or changing an attribute', () => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    element.setAttribute('title', 'ordinary');
    expect(() => element.setAttribute('srcdoc', 'untrusted')).toThrow(window.TypeError);
    expect(element.getAttributeNames()).toEqual(['title']);
    element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const attribute = element.getAttributeNode('srcdoc');
    expect(() => element.setAttribute('srcdoc', 'replacement')).toThrow(window.TypeError);
    expect(element.getAttributeNode('srcdoc')).toBe(attribute);
    expect(attribute!.value).toBe('');
  });

  it('accepts each matching brand and reads retained data without author stringification', () => {
    const { window, runTask } = createTrustedTypesWindow();
    const policy = window.trustedTypes.createPolicy('app', {
      createHTML: (value) => value, createScript: (value) => value, createScriptURL: (value) => value,
    });
    const cases = [
      ['iframe', 'srcdoc', policy.createHTML('<p>safe</p>'), '<p>safe</p>'],
      ['main', 'onclick', policy.createScript('safe()'), 'safe()'],
      ['script', 'src', policy.createScriptURL('/safe.js'), '/safe.js'],
    ] as const;
    for (const [tag, name, value, expected] of cases) {
      Object.defineProperty(value, 'toString', { value: () => { throw new Error('overridden'); } });
      Object.defineProperty(value, 'data', { value: 'forged' });
      const element = window.document.createElement(tag);
      element.setAttribute(name, value);
      element.setAttributeNS(null, 'title', value);
      expect(element.getAttribute(name)).toBe(expected);
      expect(element.getAttribute('title')).toBe(expected);
    }
    expect(runTask()).toBe(false);
  });

  it('passes wrong trusted brands through the expected default callback', () => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    const wrong = window.trustedTypes.createPolicy('script', { createScript: (value) => value }).createScript('input');
    expect(() => element.setAttribute('srcdoc', wrong)).toThrow(window.TypeError);
    const calls: unknown[][] = [];
    window.trustedTypes.createPolicy('default', { createHTML: (...args) => { calls.push(args); return 'converted'; } });
    Object.defineProperty(wrong, 'toString', { value: () => { throw new Error('overridden'); } });
    element.setAttribute('srcdoc', wrong);
    expect(calls).toEqual([['input', 'TrustedHTML', 'HTMLIFrameElement srcdoc']]);
    expect(element.getAttribute('srcdoc')).toBe('converted');
  });

  it('does not recognize a forged trusted prototype as a trusted value', () => {
    const { window } = createTrustedTypesWindow();
    const fake = Object.create(window.TrustedHTML.prototype) as object;
    Object.defineProperty(fake, 'toString', { value: () => 'untrusted' });
    expect(() => window.document.createElement('iframe').setAttribute('srcdoc', fake as never)).toThrow(window.TypeError);
  });

  it('does not invoke a default policy without a sink requirement', () => {
    const { window, runTask } = createTrustedTypesWindow('trusted-types default');
    window.trustedTypes.createPolicy('default', {
      createHTML: () => { throw new Error('unexpected callback'); },
      createScript: () => { throw new Error('unexpected callback'); },
    });
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', 'unchanged');
    element.setAttributeNS(null, 'onclick', 'unchanged');
    element.getAttributeNode('srcdoc')!.value = 'updated';
    expect(element.getAttribute('srcdoc')).toBe('updated');
    expect(element.getAttribute('onclick')).toBe('unchanged');
    expect(runTask()).toBe(false);
  });

  it.each([
    ['iframe', HTML_NAMESPACE, null, 'srcdoc', true],
    ['script', HTML_NAMESPACE, '', 'src', true],
    ['script', SVG_NAMESPACE, null, 'href', true],
    ['script', SVG_NAMESPACE, XLINK_NAMESPACE, 'xlink:href', true],
    ['main', HTML_NAMESPACE, null, 'onclick', true],
    ['g', SVG_NAMESPACE, null, 'onclick', true],
    ['math', MATHML_NAMESPACE, null, 'onclick', true],
    ['iframe', HTML_NAMESPACE, null, 'SRCDOC', false],
    ['IFRAME', HTML_NAMESPACE, null, 'srcdoc', false],
    ['iframe', HTML_NAMESPACE, 'urn:attribute', 'a:srcdoc', false],
    ['iframe', SVG_NAMESPACE, null, 'srcdoc', false],
    ['script', SVG_NAMESPACE, 'urn:attribute', 'a:href', false],
    ['main', HTML_NAMESPACE, null, 'oncustom', false],
    ['main', HTML_NAMESPACE, null, 'onopen', false],
    ['main', HTML_NAMESPACE, 'urn:attribute', 'a:onclick', false],
    ['element', 'urn:element', null, 'onclick', false],
  ])('matches %s in %s, attribute %s / %s (protected: %s)', (tag, elementNs, attributeNs, name, protectedSink) => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElementNS(elementNs, tag);
    const set = () => element.setAttributeNS(attributeNs, name, 'input');
    if (protectedSink) {
      expect(set).toThrow(window.TypeError);
      expect(element.hasAttributes()).toBe(false);
    } else {
      set();
      expect(element.attributes[0]!.value).toBe('input');
    }
  });

  it('normalizes HTML setAttribute names, while XML documents preserve their case', () => {
    const { window } = createTrustedTypesWindow();
    const htmlElement = window.document.createElement('iframe');
    expect(() => htmlElement.setAttribute('SRCDOC', 'input')).toThrow(window.TypeError);
    const xmlElement = new window.Document().createElementNS(HTML_NAMESPACE, 'iframe');
    xmlElement.setAttribute('SRCDOC', 'ordinary');
    expect(xmlElement.getAttribute('SRCDOC')).toBe('ordinary');
    expect(() => xmlElement.setAttribute('srcdoc', 'input')).toThrow(window.TypeError);
  });

  it('checks setAttribute by its supplied name even when an existing attribute has a namespace', () => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    element.setAttributeNS('urn:attribute', 'srcdoc', 'ordinary');
    const attribute = element.attributes[0]!;
    expect(() => element.setAttribute('srcdoc', 'input')).toThrow(window.TypeError);
    attribute.value = 'still ordinary';
    expect(attribute.value).toBe('still ordinary');
  });

  it.each(attachments)('%s checks detached strings, including empty values, then retains attachment identity', (_name, attach) => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    const attribute = window.document.createAttribute('srcdoc');
    expect(() => attach(element, attribute)).toThrow(window.TypeError);
    expect(attribute.ownerElement).toBeNull();
    attribute.value = 'input';
    window.trustedTypes.createPolicy('default', { createHTML: (value) => `checked:${value}` });
    expect(attach(element, attribute)).toBeNull();
    expect(element.attributes[0]).toBe(attribute);
    expect(attribute.value).toBe('checked:input');
    attribute.value = 'next';
    expect(element.getAttribute('srcdoc')).toBe('checked:next');
  });

  it('stringifies Attr.value before checking it, even when given a trusted value', () => {
    const { window } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    element.setAttribute('srcdoc', window.trustedTypes.emptyHTML);
    const attribute = element.attributes[0]!;
    expect(() => { attribute.value = window.trustedTypes.emptyHTML as unknown as string; }).toThrow(window.TypeError);
    expect(attribute.value).toBe('');
    element.removeAttributeNode(attribute);
    attribute.value = 'unrestricted while detached';
    expect(attribute.value).toBe('unrestricted while detached');
  });

  it('does not apply setter enforcement to toggles, parser attributes, or internal storage steps', () => {
    const { window, env, runTask } = createTrustedTypesWindow();
    const element = window.document.createElement('iframe');
    expect(element.toggleAttribute('srcdoc')).toBe(true);
    expect(element.getAttribute('srcdoc')).toBe('');
    const implementation = unwrap<ElementImpl>(element);
    implementation.setAttributeValue('srcdoc', 'internal');
    expect(element.getAttribute('srcdoc')).toBe('internal');
    const parsed = parseTestDocument('<html><body><iframe srcdoc="parser" onclick="parser()"></iframe></body></html>', env);
    const iframe = parsed.body!.firstChild as ElementImpl;
    expect(iframe.getAttribute('srcdoc')).toBe('parser');
    expect(iframe.getAttribute('onclick')).toBe('parser()');
    expect(runTask()).toBe(false);
  });

  it('uses the construction Window for a detached Document', () => {
    const { window } = createTrustedTypesWindow();
    const document = new window.Document();
    const element = document.createElement('iframe');
    expect(() => element.setAttribute('srcdoc', 'untrusted')).toThrow(window.TypeError);
    expect(document.defaultView).toBeNull();
    window.trustedTypes.createPolicy('default', { createHTML: (value) => `checked:${value}` });
    element.setAttribute('srcdoc', 'input');
    expect(element.getAttribute('srcdoc')).toBe('checked:input');
  });
});
