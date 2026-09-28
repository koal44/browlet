import { describe, expect, it } from 'vitest';

import {
  DocumentImpl, DocumentMode,
} from '../../../../src/browlet/dom/nodes/document';
import { DocumentFragmentImpl } from '../../../../src/browlet/dom/nodes/document-fragment';
import { DocumentTypeImpl } from '../../../../src/browlet/dom/nodes/document-type';
import { NodeType } from '../../../../src/browlet/dom/nodes/node';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';
import { EventImpl } from '../../../../src/browlet/dom/events/event';
import { BrowsingContext } from '../../../../src/browlet/browsing/browsing-context';
import { WindowImpl } from '../../../../src/browlet/browsing/window/window';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL, type URLRecord } from '../../../../src/url/url';
import { CSPList } from '../../../../src/browlet/browsing/policy/csp/list';

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
    expect(document.origin.kind).toBe('opaque');
    expect(document.allowDeclarativeShadowRoots).toBe(false);
    expect(document.moduleMap).toEqual({ entries: [] });
    expect(document.policyContainer).toMatchObject({
      cspList: undefined,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    expect(document.permissionsPolicy).toEqual({});
    expect(document.openerPolicy).toEqual({
      value: 'unsafe-none',
      reportingEndpoint: null,
      reportOnlyValue: 'unsafe-none',
      reportOnlyReportingEndpoint: null,
    });
    expect(document.loadTimingInfo.navigationStartTime)
      .toBe(0);
    expect(document.isInitialAboutBlank).toBe(false);
  });

  it('initializes an empty CSP list once the document origin is known', () => {
    const document = new DocumentImpl();
    document.origin = obtainURLOrigin(documentURL('https://example.test/'));
    document.initializeCSP();
    expect(document.policyContainer.cspList).toEqual(new CSPList(document.origin));
    expect(document.policyContainer.cspList!.selfOrigin).toBe(document.origin);
  });

  it('preserves an inherited CSP list and its origin during document initialization', () => {
    const document = new DocumentImpl();
    const origin = obtainURLOrigin(documentURL('https://creator.test/'));
    const inherited = new CSPList(origin);
    document.policyContainer.cspList = inherited;
    document.initializeCSP();
    expect(document.policyContainer.cspList).toBe(inherited);
    expect(inherited.selfOrigin).toBe(origin);
    expect(document.origin).not.toEqual(origin);
  });

  it('always has a base URI', () => {
    const document = new DocumentImpl();
    document.url = documentURL('https://example.com/');
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
    first.url = documentURL('https://first.example/');
    second.url = documentURL('https://second.example/');
    const text = first.createTextNode('content');

    text.setNodeDocument(second);

    expect(text.ownerDocument).toBe(second);
    expect(text.baseURI).toBe(second.baseURI);
  });

  it('inherits the about base URL only for about:blank, including a query or fragment', () => {
    const document = new DocumentImpl();
    document.aboutBaseURL = documentURL('https://example.test/parent/');
    for (const url of ['about:blank', 'about:blank?query#fragment']) {
      document.url = documentURL(url);
      expect(document.baseURI).toBe('https://example.test/parent/');
    }
    for (const url of ['https://example.test/page', 'about:srcdoc', 'about:other']) {
      document.url = documentURL(url);
      expect(document.baseURI).toBe(url);
    }
  });

  it('uses an iframe srcdoc document\'s inherited base independently of its current URL', () => {
    const document = new DocumentImpl();
    document.aboutBaseURL = documentURL('https://example.test/parent/');
    document.isIframeSrcdocDocument = true;
    for (const url of ['about:srcdoc', 'about:srcdoc#fragment']) {
      document.url = documentURL(url);
      expect(document.baseURI).toBe('https://example.test/parent/');
    }
  });

  it('uses its relevant Window as its event parent while it has a browsing context', () => {
    const document = new DocumentImpl();
    const window = new WindowImpl(new URL('about:blank'));
    window.setAssociatedDocument(document);

    expect(document.getEventParent(new EventImpl('ready')))
      .toBeNull();

    document.browsingContext = new BrowsingContext();

    expect(document.getEventParent(new EventImpl('ready')))
      .toBe(window);
    expect(document.getEventParent(new EventImpl('load')))
      .toBeNull();
  });

  it('retains the relevant Window when that Window presents a second Document', () => {
    const browsingContext = new BrowsingContext();
    const first = new DocumentImpl();
    const second = new DocumentImpl();
    const window = new WindowImpl(new URL('about:blank'));
    first.browsingContext = browsingContext;
    second.browsingContext = browsingContext;

    window.setAssociatedDocument(first);
    window.setAssociatedDocument(second);

    expect(window.getAssociatedDocument()).toBe(second);
    expect(first.getEventParent(new EventImpl('ready')))
      .toBe(window);
    expect(second.getEventParent(new EventImpl('ready')))
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
    expect(root.getEventParent(new EventImpl('ready', { composed: true }))).toBe(host);
  });

  it('uses an assigned slot before a node tree parent', () => {
    const document = new DocumentImpl();
    const parent = document.createElementNode('main', HTML_NAMESPACE);
    const slot = document.createElementNode('slot', HTML_NAMESPACE);
    const element = document.createElementNode('span', HTML_NAMESPACE);
    const text = document.createTextNode('content');
    parent.appendChild(element);
    parent.appendChild(text);

    expect(element.getEventParent(new EventImpl('ready')))
      .toBe(parent);
    expect(text.getEventParent(new EventImpl('ready')))
      .toBe(parent);

    element.setAssignedSlot(slot);
    text.setAssignedSlot(slot);

    expect(element.getEventParent(new EventImpl('ready')))
      .toBe(slot);
    expect(text.getEventParent(new EventImpl('ready')))
      .toBe(slot);
  });

  it('is the tree root and exposes its first element child', () => {
    const document = new DocumentImpl();
    const comment = document.createComment('before');
    const element = document.createElement('html');

    expect(document.documentElement).toBeNull();

    document.appendChild(comment);
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
    expect(document.mode).toBe(DocumentMode.NoQuirks);
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
    document.type = 'html';
    document.contentType = 'text/html';
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
    document.type = 'html';
    document.contentType = 'text/html';

    expect(document.contentType).toBe('text/html');
    expect(document.compatMode).toBe('CSS1Compat');

    document.mode = DocumentMode.Quirks;

    expect(document.compatMode).toBe('BackCompat');
  });

  it('discriminates its node types without constructor identity', () => {
    const document = new DocumentImpl();
    const doctype = new DocumentTypeImpl('html', '', '');
    const element = document.createElementNode('main', HTML_NAMESPACE);
    const text = document.createTextNode('content');
    const comment = document.createComment('note');

    expect(document.isDocument()).toBe(true);
    expect(doctype.isDocumentType()).toBe(true);
    expect(element.isElement()).toBe(true);
    expect(text.isText()).toBe(true);
    expect(comment.isComment()).toBe(true);
    expect(text.isElement()).toBe(false);
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
