import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { unwrap } from '../../../support/browlet-binding';

describe('Document factories', () => {
  it('creates detached XML and HTML documents through a stable DOMImplementation', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const implementation = document.implementation;
      const doctype = implementation.createDocumentType('root', 'public', 'system');
      const xml = implementation.createDocument('urn:example', 'p:root', doctype);
      const html = implementation.createHTMLDocument('<title>');
      const untitled = implementation.createHTMLDocument();
      const emptyTitle = implementation.createHTMLDocument('');
      return [implementation === document.implementation, implementation.hasFeature(),
        xml instanceof XMLDocument, xml.documentElement.nodeName, xml.contentType, xml.URL, xml.defaultView,
        xml.doctype === doctype, doctype.ownerDocument === xml, doctype.publicId, doctype.systemId,
        html instanceof Document, html instanceof XMLDocument, html.contentType, html.characterSet,
        xml.readyState, html.readyState, xml.referrer, html.referrer,
        html.compatMode, html.doctype!.name, html.documentElement.nodeName, html.head.textContent,
        html.body.nodeName, untitled.head.childNodes.length, emptyTitle.head.firstChild!.firstChild!.nodeValue];
    })).toEqual([true, true, true, 'p:root', 'application/xml', 'about:blank', null, true, true,
      'public', 'system', true, false, 'text/html', 'UTF-8', 'complete', 'complete', '', '',
      'CSS1Compat', 'html', 'HTML', '<title>', 'BODY', 0, '']);
  });

  it('projects retained referrer and readiness state as readonly attributes', () => {
    const browser = new Browlet({ route: () => '' });
    const document = browser.window.document;
    const implementation = unwrap<DocumentImpl>(document);
    implementation.referrer = 'https://referrer.test/';
    implementation.currentDocumentReadiness = 'interactive';

    expect(document.referrer).toBe('https://referrer.test/');
    expect(document.readyState).toBe('interactive');
    for (const name of ['referrer', 'readyState']) {
      const descriptor = Object.getOwnPropertyDescriptor(browser.window.Document.prototype, name);
      expect(typeof descriptor?.get).toBe('function');
      expect(typeof descriptor?.set).toBe('undefined');
    }
  });

  it('selects XHTML and SVG content types and preserves the receiver realm when borrowed', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const factory = second.window.document.implementation;
    const xml = first.window.document.implementation.createDocument.call(factory, 'http://www.w3.org/1999/xhtml', 'html');
    expect(xml).toBeInstanceOf(second.window.XMLDocument);
    expect(xml).not.toBeInstanceOf(first.window.XMLDocument);
    expect(xml.contentType).toBe('application/xhtml+xml');
    expect(xml.createElement('Mixed').namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(xml.createElement('Mixed').localName).toBe('Mixed');
    expect(factory.createDocument('http://www.w3.org/2000/svg', 'svg').contentType).toBe('image/svg+xml');
    expect(factory.createDocument(null, '').documentElement).toBeNull();
  });

  it('validates before adopting a supplied doctype', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const source = document.implementation.createHTMLDocument();
      const doctype = source.doctype!;
      const errors: string[] = [];
      for (const action of [
        () => document.implementation.createDocumentType('bad name', '', ''),
        () => document.implementation.createDocument(null, 'p:root', doctype),
      ]) {
        try { action(); } catch (error) { errors.push((error as DOMException).name); }
      }
      return [errors, doctype.parentNode === source, doctype.ownerDocument === source];
    })).toEqual([['InvalidCharacterError', 'NamespaceError'], true, true]);
  });

  it('validates element names before allocation and selects the document namespace', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = new Document();
      const errors: string[] = [];
      for (const name of ['', 'has space', '1name', 'bad/name']) {
        try { document.createElement(name); }
        catch (error) { errors.push((error as DOMException).name); }
      }
      const element = xml.createElement('MiXeD');
      return [errors, element.namespaceURI, element.localName, element instanceof HTMLElement,
        document.createElement('MiXeD').localName];
    })).toEqual([Array(4).fill('InvalidCharacterError'), null, 'MiXeD', false, 'mixed']);
  });

  it('selects specialized elements and namespace fallbacks without changing name casing', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const html = 'http://www.w3.org/1999/xhtml';
      const svg = 'http://www.w3.org/2000/svg';
      const mathml = 'http://www.w3.org/1998/Math/MathML';
      const names: [string, string][] = [
        [html, 'script'], [svg, 'script'], [html, 'style'], [svg, 'style'],
        [html, 'dialog'], [html, 'div'], [html, 'custom-widget'], [html, 'unknown'],
        [html, 'applet'], [html, 'SCRIPT'], [svg, 'unknown'], [mathml, 'mi'],
        ['', 'dialog'], ['urn:other', 'dialog'],
      ];
      return names.map(([namespace, name]) =>
        document.createElementNS(namespace, name).constructor.name,
      );
    })).toEqual([
      'HTMLScriptElement', 'SVGScriptElement', 'HTMLStyleElement', 'SVGStyleElement',
      'HTMLDialogElement', 'HTMLElement', 'HTMLElement', 'HTMLUnknownElement',
      'HTMLUnknownElement', 'HTMLUnknownElement', 'SVGElement', 'MathMLElement',
      'Element', 'Element',
    ]);
  });

  it('constructs a selected element in the receiver document realm when the factory is borrowed', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const element = first.window.document.createElement.call(second.window.document, 'dialog');
    expect(element).toBeInstanceOf(second.window.HTMLDialogElement);
    expect(element).not.toBeInstanceOf(first.window.HTMLDialogElement);
    expect(element.ownerDocument).toBe(second.window.document);
  });

  it('validates XML leaf construction and preserves CDATA identity through Text operations', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xml = new Document();
      const errors: string[] = [];
      for (const action of [() => document.createCDATASection('x'), () => xml.createCDATASection(']]>'),
        () => xml.createProcessingInstruction('1bad', ''), () => xml.createProcessingInstruction('ok', '?>')]) {
        try { action(); } catch (error) { errors.push((error as DOMException).name); }
      }
      const root = xml.appendChild(xml.createElement('root'));
      root.append(xml.createTextNode('left'));
      const cdata = root.appendChild(xml.createCDATASection('middle'));
      root.append(xml.createTextNode('right'));
      root.normalize();
      const whole = cdata.wholeText;
      const split = cdata.splitText(3);
      return [errors, cdata instanceof CDATASection, cdata instanceof Text, cdata.nodeType,
        whole, root.childNodes.length, cdata.data, split.nodeType, split.data];
    })).toEqual([['NotSupportedError', 'InvalidCharacterError', 'InvalidCharacterError', 'InvalidCharacterError'],
      true, true, 4, 'leftmiddleright', 4, 'mid', 3, 'dle']);
  });

  it('creates uninitialized legacy events and recognizes only supported legacy aliases', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const event = document.createEvent('hTmLeVeNtS');
      let errorName = '';
      try { document.dispatchEvent(event); } catch (error) { errorName = (error as DOMException).name; }
      const before = [event.type, event.isTrusted, event.bubbles, event.cancelable];
      event.initEvent('test', true, true);
      document.addEventListener('test', (e) => e.preventDefault());
      const custom = document.createEvent('CustomEvent');
      custom.initCustomEvent('custom', false, false, 42);
      let unsupported = '';
      try { document.createEvent('MutationEvent'); } catch (error) { unsupported = (error as DOMException).name; }
      return [before, errorName, document.dispatchEvent(event), custom instanceof CustomEvent, custom.detail === 42, unsupported];
    })).toEqual([['', false, false, false], 'InvalidStateError', false, true, true, 'NotSupportedError']);
  });
});
