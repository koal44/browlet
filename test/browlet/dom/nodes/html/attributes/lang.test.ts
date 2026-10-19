import { assert, describe, expect, it } from 'vitest';

import { HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE, XML_NAMESPACE } from '../../../../../../src/infra/index';
import { Browlet } from '../../../../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../../../../src/browlet/browsing/navigation/navigable';
import { HTMLElementImpl } from '../../../../../../src/browlet/dom/nodes/html/html-element';
import { UserAgent } from '../../../../../../src/browlet/user-agent';
import { FetchResponse } from '../../../../../../src/fetch/response';
import { parseURL } from '../../../../../../src/url/index';
import { createTestDocument, parseTestDocument } from '../../../../../support/dom';

describe('HTML language determination', () => {
  // https://html.spec.whatwg.org/multipage/dom.html#language
  it.each(['html', 'xml'])('uses namespace identity and XML priority in an %s document', (type) => {
    const document = type === 'html' ? parseTestDocument() : createTestDocument();
    const parent = document.createElementNS(HTML_NAMESPACE, 'div');
    parent.setAttribute('lang', 'ancestor');
    for (const namespace of [HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:other', null]) {
      const element = document.createElementNS(namespace, 'child');
      parent.appendChild(element);
      element.setAttribute('lang', 'plain');
      expect(element.getLanguage()).toBe(namespace === HTML_NAMESPACE || namespace === SVG_NAMESPACE ? 'plain' : 'ancestor');
      element.setAttributeNS(XML_NAMESPACE, 'other:lang', 'xml'); // Prefix is immaterial.
      expect(element.getLanguage()).toBe('xml');
      element.setAttributeNS(XML_NAMESPACE, 'other:lang', '');
      expect(element.getLanguage()).toBe('');
      element.removeAttributeNS(XML_NAMESPACE, 'lang');
      element.removeAttribute('lang');
      element.setAttribute('xml:lang', 'compatibility');
      element.setAttributeNS('urn:other', 'p:lang', 'unrelated');
      expect(element.getLanguage()).toBe('ancestor');
    }
  });

  it('preserves unknown tags, casing, and whitespace without validating or normalizing', () => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, 'div');
    for (const language of ['EN-us', 'xyzzy', 'abcde', ' en ', 'en\r\nUS', 'É', '']) {
      element.setAttribute('lang', language);
      expect(element.getLanguage()).toBe(language);
      expect(element.getAttribute('lang')).toBe(language);
    }
    element.removeAttribute('lang');
    element.setAttribute('LANG', 'case-sensitive'); // XML document.
    element.setAttributeNS(XML_NAMESPACE, 'xml:LANG', 'case-sensitive');
    expect(element.getLanguage()).toBe('');
  });

  it('answers for text and other nodes and follows current ancestry and document ownership', () => {
    const first = createTestDocument();
    const second = createTestDocument(first.env);
    first.contentLanguage = 'en';
    second.contentLanguage = 'fr';
    const parent = first.createElementNS(HTML_NAMESPACE, 'div');
    const text = first.createTextNode('text');
    const comment = first.createComment('comment');
    const fragment = first.createDocumentFragment();
    parent.append(text, comment);
    expect(first.getLanguage()).toBe('en');
    expect(fragment.getLanguage()).toBe('en');
    expect(text.getLanguage()).toBe('en');
    parent.setAttribute('lang', 'de');
    expect(text.getLanguage()).toBe('de');
    expect(comment.getLanguage()).toBe('de');
    fragment.appendChild(text);
    expect(text.getLanguage()).toBe('en');
    second.adoptNode(fragment);
    expect(text.getLanguage()).toBe('fr');
    second.pragmaLanguage = 'es'; // Producer belongs to meta processing in §4.2.5.
    expect(text.getLanguage()).toBe('es');
    second.pragmaLanguage = undefined;
    expect(text.getLanguage()).toBe('fr');
  });

  // SPEC_CLASH(language-shadow-inheritance): HTML and Chromium/WebKit cross to the host; Firefox's :lang() does not.
  it.each(['open', 'closed'] as const)('crosses an %s shadow root but does not inherit through assigned slots', (mode) => {
    const document = createTestDocument();
    document.contentLanguage = 'document';
    const host = document.createElementNS(HTML_NAMESPACE, 'div');
    host.setAttribute('lang', 'host');
    const shadow = host.attachShadow({
      mode, delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const slot = document.createElementNS(HTML_NAMESPACE, 'slot');
    slot.setAttribute('lang', 'slot');
    const fallback = document.createTextNode('fallback');
    slot.appendChild(fallback);
    const shadowText = document.createTextNode('shadow');
    shadow.append(slot, shadowText);
    const assigned = document.createElementNS(HTML_NAMESPACE, 'span');
    host.appendChild(assigned);
    expect(assigned.getAssignedSlot()).toBe(slot);
    expect(assigned.getLanguage()).toBe('host');
    expect(shadowText.getLanguage()).toBe('host');
    expect(fallback.getLanguage()).toBe('slot'); // Language does not depend on rendering or assignment.
    expect(shadow.getLanguage()).toBe('document'); // The shadow root itself has no parent.
    host.setAttribute('lang', '');
    expect(assigned.getLanguage()).toBe('');
    expect(shadowText.getLanguage()).toBe('');
    host.removeAttribute('lang');
    expect(shadowText.getLanguage()).toBe('document');
  });

  // SPEC_CLASH(language-protocol-fallback): Use the first HTTP language like Chromium/WebKit; retain HTML's detached fallback.
  it.each([
    [[], ''], [[' FR-ca\t'], 'FR-ca'], [['xyzzy'], 'xyzzy'],
    [['en, fr'], 'en'], [['en', 'fr'], 'en'], [['fr, en'], 'fr'], [['fr', 'en'], 'fr'],
    [['', 'en', ''], 'en'],
  ] satisfies [string[], string][])('uses the first HTTP language from %j and preserves the retained response value', (headers, expected) => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://example.test/language').url!);
    for (const header of headers) response.headerList.append('Content-Language', header);
    const document = traversable.createAndInitializeDocument(
      'html', 'text/html', traversable.createNavigationParams(response),
    );
    const element = document.createElementNS(HTML_NAMESPACE, 'div');
    expect(document.getLanguage()).toBe(expected);
    expect(element.getLanguage()).toBe(expected);
    expect(element.matches(`:lang("${expected}")`)).toBe(true);
    response.headerList.set('Content-Language', 'changed');
    expect(element.getLanguage()).toBe(expected);
    document.pragmaLanguage = 'de';
    expect(element.getLanguage()).toBe('de');
    expect(element.matches(':lang(de)')).toBe(true);
    element.setAttribute('lang', '');
    expect(element.getLanguage()).toBe('');
    expect(element.matches(':lang(de)')).toBe(false);
  });

  it('permits the compatibility spelling only in HTML while leaving value checks separate', () => {
    const xml = createTestDocument();
    const html = parseTestDocument('', xml.env);
    const element = xml.createElementNS(HTML_NAMESPACE, 'div');
    assert(element instanceof HTMLElementImpl);
    expect(element.allowsContentAttribute('xml:lang')).toBe(false);
    html.adoptNode(element);
    expect(element.allowsContentAttribute('xml:lang')).toBe(true);
    element.setAttribute('xml:lang', 'fr');
    expect(element.getLanguage()).toBe('');
    element.setAttribute('lang', 'en'); // An author-conformance checker must report the unequal pair.
    expect(element.getLanguage()).toBe('en');
  });

  it('gives XML lang precedence in :lang(), including an explicitly unknown language', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.lang = 'en';
      element.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'fr');
      const explicit = [element.matches(':lang(fr)'), element.matches(':lang(en)')];
      element.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', '');
      return [explicit, element.matches(':lang(en)'), element.lang];
    })).toEqual([[true, false], false, 'en']);
  });

  it('does not interpret an unnamespaced lang on MathML or other foreign elements', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      parent.lang = 'en';
      return ['http://www.w3.org/1998/Math/MathML', 'urn:other'].map((namespace) => {
        const element = document.createElementNS(namespace, 'child');
        element.setAttribute('lang', 'fr');
        parent.append(element);
        return [element.matches(':lang(en)'), element.matches(':lang(fr)')];
      });
    })).toEqual([[true, false], [true, false]]);
  });

  // SPEC_CLASH(language-selector-ranges): Preserve CSS's quoted ranges and explicit unknown-language match.
  it('accepts a quoted language range and does not match unknown language with a wildcard', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.lang = 'en';
      const known = element.matches(':lang("*")');
      element.lang = '';
      return [known, element.matches(':lang("*")'), element.matches(':lang("")')];
    })).toEqual([true, false, true]);
  });

  it('matches unknown tags distinctly and matches ordinary language tags case-insensitively', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.lang = 'xyzzy';
      const unknown = [element.matches(':lang(xyzzy)'), element.matches(':lang(abcde)')];
      element.lang = 'EN-us';
      return [unknown, element.matches(':lang(en)')];
    })).toEqual([[true, false], true]);
  });
});
