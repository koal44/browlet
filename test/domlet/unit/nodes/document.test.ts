import { describe, expect, it } from 'vitest';

import {
  DocumentImpl, DocumentMode,
} from '../../../../src/domlet/nodes/document';
import { DocumentFragmentImpl } from '../../../../src/domlet/nodes/document-fragment';
import { DocumentTypeImpl } from '../../../../src/domlet/nodes/document-type';
import {
  ElementImpl, HTMLElementImpl, HTMLHeadElementImpl,
} from '../../../../src/domlet/nodes/element';
import {
  isComment, isDocument, isDocumentType, isElement, isText, NodeImpl, NodeType,
} from '../../../../src/domlet/nodes/node';
import { ShadowRootImpl } from '../../../../src/domlet/nodes/shadow-root';
import { TextImpl } from '../../../../src/domlet/nodes/text';
import { EventImpl } from '../../../../src/domlet/events/event';
import { EventTargetImpl } from '../../../../src/domlet/events/event-target';
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
    expect(DocumentImpl.getType(document)).toBe('xml');
    expect(DocumentImpl.getOrigin(document).kind).toBe('opaque');
    expect(DocumentImpl.allowsDeclarativeShadowRoots(document)).toBe(false);
    expect(DocumentImpl.getModuleMap(document)).toEqual({ entries: [] });
    expect(DocumentImpl.getPolicyContainer(document)).toMatchObject({
      cspList: [],
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    expect(DocumentImpl.getPermissionsPolicy(document)).toEqual({});
    expect(DocumentImpl.getOpenerPolicy(document)).toEqual({
      value: 'unsafe-none',
      reportingEndpoint: null,
      reportOnlyValue: 'unsafe-none',
      reportOnlyReportingEndpoint: null,
    });
    expect(DocumentImpl.getLoadTimingInfo(document).navigationStartTime)
      .toBe(0);
    expect(DocumentImpl.isInitialAboutBlank(document)).toBe(false);
  });

  it('always has a base URI', () => {
    const document = new DocumentImpl();
    DocumentImpl.setURL(document, documentURL('https://example.com/'));
    const text = document.createTextNode('content');

    expect(new DocumentImpl().baseURI).toBe('about:blank');
    expect(document.baseURI).toBe('https://example.com/');
    expect(text.baseURI).toBe(document.baseURI);
    expect(NodeImpl.getNodeDocument(document)).toBe(document);
    expect(NodeImpl.getNodeDocument(text)).toBe(document);
  });

  it('can update a node document during a future adoption operation', () => {
    const first = new DocumentImpl();
    const second = new DocumentImpl();
    DocumentImpl.setURL(first, documentURL('https://first.example/'));
    DocumentImpl.setURL(second, documentURL('https://second.example/'));
    const text = first.createTextNode('content');

    NodeImpl.setNodeDocument(text, second);

    expect(text.ownerDocument).toBe(second);
    expect(text.baseURI).toBe(second.baseURI);
  });

  it('uses the relevant global as its event parent except for load', () => {
    const document = new DocumentImpl();
    const global = new EventTargetImpl();
    DocumentImpl.setBrowsingContextWindow(document, global);

    expect(EventTargetImpl.getParent(document, new EventImpl('ready')))
      .toBe(global);
    expect(EventTargetImpl.getParent(document, new EventImpl('load')))
      .toBeNull();
  });

  it('represents document fragments and shadow-root event topology', () => {
    const document = new DocumentImpl();
    const host = document.createElement('main') as HTMLElementImpl;
    const fragment = new DocumentFragmentImpl(document);
    const root = new ShadowRootImpl(host, 'closed');

    expect(fragment.nodeType).toBe(NodeType.DocumentFragment);
    expect(DocumentFragmentImpl.getHost(fragment)).toBeNull();
    expect(root.nodeType).toBe(NodeType.DocumentFragment);
    expect(root.host).toBe(host);
    expect(root.mode).toBe('closed');
    expect(root.getRootNode()).toBe(root);
    expect(root.getRootNode({ composed: true })).toBe(host);
    expect(EventTargetImpl.getParent(
      root,
      new EventImpl('ready', { composed: true }),
    )).toBe(host);
  });

  it('uses an assigned slot before a node tree parent', () => {
    const document = new DocumentImpl();
    const parent = new HTMLElementImpl('main', document);
    const slot = new HTMLElementImpl('slot', document);
    const element = new HTMLElementImpl('span', document);
    const text = document.createTextNode('content');
    parent.appendChild(element);
    parent.appendChild(text);

    expect(EventTargetImpl.getParent(element, new EventImpl('ready')))
      .toBe(parent);
    expect(EventTargetImpl.getParent(text, new EventImpl('ready')))
      .toBe(parent);

    ElementImpl.setAssignedSlot(element, slot);
    TextImpl.setAssignedSlot(text, slot);

    expect(EventTargetImpl.getParent(element, new EventImpl('ready')))
      .toBe(slot);
    expect(EventTargetImpl.getParent(text, new EventImpl('ready')))
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
    expect(DocumentImpl.getMode(document)).toBe(DocumentMode.NoQuirks);
  });

  it('derives its head from the HTML document tree', () => {
    const document = new DocumentImpl();
    const html = document.createElement('html');
    const head = document.createElement('head');

    expect(head).toBeInstanceOf(HTMLHeadElementImpl);
    expect(document.head).toBeNull();

    document.appendChild(html);
    expect(document.head).toBeNull();

    html.appendChild(head);
    expect(document.head).toBe(head);
  });

  it('creates HTML elements and text nodes', () => {
    const document = new DocumentImpl();
    DocumentImpl.setType(document, 'html');
    DocumentImpl.setContentType(document, 'text/html');
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
    DocumentImpl.setType(document, 'html');
    DocumentImpl.setContentType(document, 'text/html');

    expect(document.contentType).toBe('text/html');
    expect(document.compatMode).toBe('CSS1Compat');

    DocumentImpl.setMode(document, DocumentMode.Quirks);

    expect(document.compatMode).toBe('BackCompat');
  });

  it('discriminates its node types without constructor identity', () => {
    const document = new DocumentImpl();
    const doctype = new DocumentTypeImpl('html', '', '');
    const element = new HTMLElementImpl('main', document);
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

    DocumentImpl.withWriter(document, (markup) => writes.push(markup), () => {
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
