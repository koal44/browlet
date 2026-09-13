import { describe, expect, it } from 'vitest';

import {
  DocumentImpl, DocumentMode,
} from '../../../../src/browlet/dom/nodes/document';
import { DocumentFragmentImpl } from '../../../../src/browlet/dom/nodes/document-fragment';
import { DocumentTypeImpl } from '../../../../src/browlet/dom/nodes/document-type';
import {
  isComment, isDocument, isDocumentType, isElement, isText, NodeType,
} from '../../../../src/browlet/dom/nodes/node';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';
import { EventImpl } from '../../../../src/browlet/dom/events/event';
import { BrowsingContext } from '../../../../src/browlet/browsing/browsing-context';
import { WindowImpl } from '../../../../src/browlet/browsing/window/window';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { parseURL, type URLRecord } from '../../../../src/url/url';

describe('Document', () => {
  it('uses the DOM document defaults', () => {
    const document = new DocumentImpl();

    expect(document.URL).toBe('about:blank');
    expect(document.documentURI).toBe('about:blank');
    expect(document.baseURI).toBe('about:blank');
    expect(document.characterSet).toBe('UTF-8');
    expect(document.charset).toBe('UTF-8');
    expect(document.inputEncoding).toBe('UTF-8');
    expect(document.contentType).toBe('application/xml');
    expect(document.compatMode).toBe('CSS1Compat');
    expect(document.customElementRegistry).toBeNull();
    expect(document.type).toBe('xml');
    expect(document.getOrigin().kind).toBe('opaque');
    expect(document.allowsDeclarativeShadowRoots()).toBe(false);
    expect(document.getModuleMap()).toEqual({ entries: [] });
    expect(document.getPolicyContainer()).toMatchObject({
      cspList: [],
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    expect(document.getPermissionsPolicy()).toEqual({});
    expect(document.getOpenerPolicy()).toEqual({
      value: 'unsafe-none',
      reportingEndpoint: null,
      reportOnlyValue: 'unsafe-none',
      reportOnlyReportingEndpoint: null,
    });
    expect(document.getLoadTimingInfo().navigationStartTime)
      .toBe(0);
    expect(document.isInitialAboutBlank()).toBe(false);
  });

  it('always has a base URI', () => {
    const document = new DocumentImpl();
    document.setURL(documentURL('https://example.com/'));
    const text = document.createTextNode('content');

    expect(new DocumentImpl().baseURI).toBe('about:blank');
    expect(document.baseURI).toBe('https://example.com/');
    expect(text.baseURI).toBe(document.baseURI);
    expect(document.getNodeDocument()).toBe(document);
    expect(text.getNodeDocument()).toBe(document);
  });

  it('can update a node document during a future adoption operation', () => {
    const first = new DocumentImpl();
    const second = new DocumentImpl();
    first.setURL(documentURL('https://first.example/'));
    second.setURL(documentURL('https://second.example/'));
    const text = first.createTextNode('content');

    text.setNodeDocument(second);

    expect(text.ownerDocument).toBe(second);
    expect(text.baseURI).toBe(second.baseURI);
  });

  it('uses its relevant Window as its event parent while it has a browsing context', () => {
    const document = new DocumentImpl();
    const window = new WindowImpl(new URL('about:blank'));
    window.setAssociatedDocument(document);

    expect(document.getParent(new EventImpl('ready')))
      .toBeNull();

    document.setBrowsingContext(new BrowsingContext());

    expect(document.getParent(new EventImpl('ready')))
      .toBe(window);
    expect(document.getParent(new EventImpl('load')))
      .toBeNull();
  });

  it('retains the relevant Window when that Window presents a second Document', () => {
    const browsingContext = new BrowsingContext();
    const first = new DocumentImpl();
    const second = new DocumentImpl();
    const window = new WindowImpl(new URL('about:blank'));
    first.setBrowsingContext(browsingContext);
    second.setBrowsingContext(browsingContext);

    window.setAssociatedDocument(first);
    window.setAssociatedDocument(second);

    expect(window.getAssociatedDocument()).toBe(second);
    expect(first.getParent(new EventImpl('ready')))
      .toBe(window);
    expect(second.getParent(new EventImpl('ready')))
      .toBe(window);
  });

  it('represents document fragments and shadow-root event topology', () => {
    const document = new DocumentImpl();
    const host = document.createElementNode('main', HTML_NAMESPACE);
    const fragment = new DocumentFragmentImpl(document);
    const root = new ShadowRootImpl(host, 'closed');

    expect(fragment.nodeType).toBe(NodeType.DocumentFragment);
    expect(fragment.getHost()).toBeNull();
    expect(root.nodeType).toBe(NodeType.DocumentFragment);
    expect(root.host).toBe(host);
    expect(root.mode).toBe('closed');
    expect(root.getRootNode()).toBe(root);
    expect(root.getRootNode({ composed: true })).toBe(host);
    expect(root.getParent(new EventImpl('ready', { composed: true }))).toBe(host);
  });

  it('uses an assigned slot before a node tree parent', () => {
    const document = new DocumentImpl();
    const parent = document.createElementNode('main', HTML_NAMESPACE);
    const slot = document.createElementNode('slot', HTML_NAMESPACE);
    const element = document.createElementNode('span', HTML_NAMESPACE);
    const text = document.createTextNode('content');
    parent.appendChild(element);
    parent.appendChild(text);

    expect(element.getParent(new EventImpl('ready')))
      .toBe(parent);
    expect(text.getParent(new EventImpl('ready')))
      .toBe(parent);

    element.setAssignedSlot(slot);
    text.setAssignedSlot(slot);

    expect(element.getParent(new EventImpl('ready')))
      .toBe(slot);
    expect(text.getParent(new EventImpl('ready')))
      .toBe(slot);
  });

  it('is the tree root and exposes its first element child', () => {
    const document = new DocumentImpl();
    const text = document.createTextNode('before');
    const element = document.createElement('html');

    expect(document.documentElement).toBeNull();

    document.appendChild(text);
    document.appendChild(element);

    expect(document.nodeType).toBe(NodeType.Document);
    expect(document.documentElement).toBe(element);
    expect(element.nodeType).toBe(NodeType.Element);
    expect(element.parentNode).toBe(document);
  });

  it('exposes its doctype separately from its document element', () => {
    const document = new DocumentImpl();
    const doctype = new DocumentTypeImpl('html', '', '');
    const element = document.createElement('html');

    document.appendChild(doctype);
    document.appendChild(element);

    expect(document.doctype).toBe(doctype);
    expect(document.documentElement).toBe(element);
    expect(document.getMode()).toBe(DocumentMode.NoQuirks);
  });

  it('derives its head from the HTML document tree', () => {
    const document = new DocumentImpl();
    const html = document.createElement('html');
    const head = document.createElement('head');

    expect(document.head).toBeNull();

    document.appendChild(html);
    expect(document.head).toBeNull();

    html.appendChild(head);
    expect(document.head).toBe(head);
  });

  it('creates HTML elements and text nodes', () => {
    const document = new DocumentImpl();
    document.setType('html');
    document.setContentType('text/html');
    const element = document.createElement('MaIn');
    const text = document.createTextNode('content');
    const comment = document.createComment('note');

    expect(element.localName).toBe('main');
    expect(element.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(element.ownerDocument).toBe(document);
    expect(text.ownerDocument).toBe(document);
    expect(comment.ownerDocument).toBe(document);
    expect(text.nodeType).toBe(NodeType.Text);
    expect(text.data).toBe('content');
    expect(comment.nodeType).toBe(NodeType.Comment);
    expect(comment.data).toBe('note');
  });

  it('identifies HTML and compatibility mode', () => {
    const document = new DocumentImpl();
    document.setType('html');
    document.setContentType('text/html');

    expect(document.contentType).toBe('text/html');
    expect(document.compatMode).toBe('CSS1Compat');

    document.setMode(DocumentMode.Quirks);

    expect(document.compatMode).toBe('BackCompat');
  });

  it('discriminates its node types without constructor identity', () => {
    const document = new DocumentImpl();
    const doctype = new DocumentTypeImpl('html', '', '');
    const element = document.createElementNode('main', HTML_NAMESPACE);
    const text = document.createTextNode('content');
    const comment = document.createComment('note');

    expect(isDocument(document)).toBe(true);
    expect(isDocumentType(doctype)).toBe(true);
    expect(isElement(element)).toBe(true);
    expect(isText(text)).toBe(true);
    expect(isComment(comment)).toBe(true);
    expect(isElement(text)).toBe(false);
  });

  it('rejects document.write without an active parser', () => {
    const document = new DocumentImpl();

    expect(() => document.write('<main></main>')).toThrow(
      'Document has no active parser',
    );
  });

  it('limits document.write to the active writer scope', () => {
    const document = new DocumentImpl();
    const writes: string[] = [];

    document.withWriter((markup) => writes.push(markup), () => {
      document.write('<main>', '</main>');
    });

    expect(writes).toEqual(['<main></main>']);
    expect(() => document.write('<aside></aside>')).toThrow(
      'Document has no active parser',
    );
  });
});

function documentURL(input: string): URLRecord {
  const url = parseURL(input).url;
  if (url === null) throw new Error(`Could not parse document URL ${input}`);
  return url;
}
