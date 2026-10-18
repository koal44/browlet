import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { HTMLCollectionImpl } from '../../../../src/browlet/dom/nodes/collections';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLElementImpl } from '../../../../src/browlet/dom/nodes/html/html-element';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLObjectElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/object';
import type { HTMLEmbedElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/embed';
import type { HTMLScriptElementImpl } from '../../../../src/browlet/dom/nodes/html/scripting/script';
import type { SVGScriptElementImpl } from '../../../../src/browlet/dom/nodes/svg/script-element';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../src/infra/index';
import { createTestDocument } from '../../../support/dom';
import { unwrap } from '../../../support/browlet-binding';

describe('Document tree accessors', () => {
  it('retains the document element between reads and follows root replacement and adoption', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const root = document.documentElement!;
    const firstChild = vi.spyOn(document, 'firstChild', 'get');
    expect(document.documentElement).toBe(root);
    expect(document.documentElement).toBe(root);
    expect(firstChild).not.toHaveBeenCalled();
    firstChild.mockRestore();

    const replacement = document.createElement('html');
    document.replaceChild(replacement, root);
    expect(document.documentElement).toBe(replacement);
    const other = createTestDocument();
    other.appendChild(replacement);
    expect(document.documentElement).toBeNull();
    expect(other.documentElement).toBe(replacement);
    document.appendChild(root);
    expect(document.documentElement).toBe(root);
  });

  it('finds the first direct head and body/frameset beneath an HTML html element', () => {
    const document = createTestDocument();
    const html = document.createElementNS(HTML_NAMESPACE, 'html');
    document.appendChild(html);
    const foreignHead = document.createElementNS(SVG_NAMESPACE, 'head');
    const foreignBody = document.createElementNS(SVG_NAMESPACE, 'body');
    const div = document.createElementNS(HTML_NAMESPACE, 'div');
    const nestedHead = document.createElementNS(HTML_NAMESPACE, 'head');
    const nestedBody = document.createElementNS(HTML_NAMESPACE, 'body');
    div.appendChild(nestedHead);
    div.appendChild(nestedBody);
    html.appendChild(foreignHead);
    html.appendChild(foreignBody);
    html.appendChild(div);
    expect(document.htmlElement).toBe(html);
    expect(document.head).toBeNull();
    expect(document.body).toBeNull();

    const head = document.createElementNS(HTML_NAMESPACE, 'head');
    const frameset = document.createElementNS(HTML_NAMESPACE, 'frameset');
    const body = document.createElementNS(HTML_NAMESPACE, 'body');
    html.appendChild(head);
    html.appendChild(frameset);
    html.appendChild(body);
    expect(document.head).toBe(head);
    expect(document.body).toBe(frameset);
    html.removeChild(frameset);
    expect(document.body).toBe(body);

    document.removeChild(html);
    const root = document.createElementNS(HTML_NAMESPACE, 'div');
    root.appendChild(head);
    root.appendChild(body);
    document.appendChild(root);
    expect(document.htmlElement).toBeNull();
    expect(document.head).toBeNull();
    expect(document.body).toBeNull();
  });

  it('reads the first HTML title anywhere, using child text and only ASCII whitespace', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const first = document.createElement('title');
    first.appendChild(document.createTextNode('\t one\n\r two\f '));
    const nested = document.createElement('span');
    nested.textContent = 'ignored';
    first.appendChild(nested);
    first.appendChild(document.createComment('ignored'));
    first.appendChild(document.createTextNode('three\u00a0\u000b '));
    document.body!.appendChild(first);
    const later = document.createElement('title');
    later.textContent = 'later';
    document.body!.appendChild(later);
    expect(document.htmlTitleElement).toBe(first);
    expect(document.title).toBe('one two three\u00a0\u000b');

    const host = document.createElement('div');
    document.documentElement!.insertBefore(host, document.head);
    const shadow = host.attachShadow({ mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const hidden = document.createElement('title');
    hidden.textContent = 'shadow';
    shadow.appendChild(hidden);
    expect(document.title).toBe('one two three\u00a0\u000b');
  });

  it('creates HTML title in head and replaces its children without normalizing stored text', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    document.title = '  new\n title  ';
    const title = document.htmlTitleElement!;
    expect(title.parentNode).toBe(document.head);
    expect(title.textContent).toBe('  new\n title  ');
    expect(document.title).toBe('new title');
    document.body!.appendChild(title);
    document.title = '';
    expect(document.htmlTitleElement).toBe(title);
    expect(title.parentNode).toBe(document.body);
    expect(title.firstChild).toBeNull();
  });

  it('caches normalized title text and updates it after direct text changes', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    document.title = '  first\n title  ';
    const title = document.htmlTitleElement!;
    const text = title.firstChild!;
    const readText = vi.spyOn(title, 'getChildTextContent');
    expect(document.title).toBe('first title');
    expect(document.title).toBe('first title');
    expect(readText).not.toHaveBeenCalled();
    readText.mockRestore();

    text.textContent = '\tchanged\r title ';
    expect(document.title).toBe('changed title');
    const second = document.createTextNode(' tail ');
    title.appendChild(second);
    expect(document.title).toBe('changed title tail');
    title.normalize();
    expect(document.title).toBe('changed title tail');
    const nested = document.createElement('span');
    title.appendChild(nested);
    nested.textContent = 'ignored';
    expect(document.title).toBe('changed title tail');
    title.replaceChildren();
    expect(document.title).toBe('');
  });

  it('updates the selected title when subtrees move, leave the document, or change owners', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const first = document.createElement('title');
    first.textContent = 'first';
    const container = document.createElement('div');
    const second = document.createElement('title');
    second.textContent = 'second';
    container.appendChild(second);
    document.body!.append(first, container);
    expect(document.title).toBe('first');
    document.body!.moveBefore(container, first);
    expect(document.htmlTitleElement).toBe(second);
    expect(document.title).toBe('second');
    first.moveBefore(second.firstChild!, null);
    expect(document.title).toBe('');
    first.moveBefore(second, null);
    expect(document.htmlTitleElement).toBe(first);
    expect(document.title).toBe('firstsecond');

    const shadow = container.attachShadow({ mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    shadow.appendChild(first);
    expect(document.htmlTitleElement).toBeNull();
    expect(document.title).toBe('');
    const other = createTestDocument().implementation.createHTMLDocument();
    other.head!.appendChild(first);
    expect(document.title).toBe('');
    expect(other.title).toBe('firstsecond');
    other.head!.removeChild(first);
    expect(other.title).toBe('');
  });

  it('switches cached HTML and SVG title selection when the document root changes', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    document.title = 'HTML';
    const html = document.documentElement!;
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    const htmlTitle = document.createElement('title');
    htmlTitle.textContent = 'foreign HTML title';
    svg.appendChild(htmlTitle);
    const first = document.createElementNS(SVG_NAMESPACE, 'title');
    first.appendChild(createTestDocument().createCDATASection('\tSVG\n title '));
    const second = document.createElementNS(SVG_NAMESPACE, 'title');
    second.textContent = 'second';
    svg.append(first, second);
    document.replaceChild(svg, html);
    expect(document.htmlTitleElement).toBe(htmlTitle);
    expect(document.title).toBe('SVG title');
    first.firstChild!.textContent = ' changed ';
    expect(document.title).toBe('changed');
    svg.moveBefore(second, first);
    expect(document.title).toBe('second');
    const group = document.createElementNS(SVG_NAMESPACE, 'g');
    svg.appendChild(group);
    group.moveBefore(second, null);
    expect(document.title).toBe('changed');
    svg.removeChild(first);
    expect(document.title).toBe('');
    document.replaceChild(html, svg);
    expect(document.title).toBe('HTML');
  });

  it.each([HTML_NAMESPACE, SVG_NAMESPACE])('updates title text after moves within and between %s titles', (namespace) => {
    const document = createTestDocument().implementation.createDocument(
      namespace, namespace === HTML_NAMESPACE ? 'html' : 'svg', null,
    );
    const root = document.documentElement!;
    const first = document.createElementNS(namespace, 'title');
    const second = document.createElementNS(namespace, 'title');
    const start = document.createTextNode('one ');
    const end = document.createTextNode('two ');
    first.append(start, end);
    root.append(first, second);
    expect(document.title).toBe('one two');

    first.moveBefore(end, start);
    expect(document.title).toBe('two one');
    second.moveBefore(end, null);
    expect(document.title).toBe('one');
    first.moveBefore(end, null);
    expect(document.title).toBe('one two');

    const nested = document.createElementNS(namespace, 'span');
    first.appendChild(nested);
    nested.moveBefore(start, null);
    expect(document.title).toBe('two');
    first.moveBefore(start, null);
    expect(document.title).toBe('two one');

    const other = createTestDocument().implementation.createDocument(
      namespace, namespace === HTML_NAMESPACE ? 'html' : 'svg', null,
    );
    other.documentElement!.appendChild(first);
    expect(document.title).toBe('');
    expect(other.title).toBe('two one');
    first.remove();
    expect(other.title).toBe('');
  });

  it('does not invent a head or root and can update an existing title under another HTML root', () => {
    const document = createTestDocument();
    document.title = 'ignored';
    expect(document.firstChild).toBeNull();
    const root = document.createElementNS(HTML_NAMESPACE, 'div');
    document.appendChild(root);
    document.title = 'ignored';
    expect(root.firstChild).toBeNull();
    const title = document.createElementNS(HTML_NAMESPACE, 'title');
    root.appendChild(title);
    document.title = 'kept';
    expect(title.textContent).toBe('kept');

    const foreign = document.implementation.createDocument('urn:example', 'root', null);
    const htmlTitle = foreign.createElementNS(HTML_NAMESPACE, 'title');
    htmlTitle.textContent = 'readable';
    foreign.documentElement!.appendChild(htmlTitle);
    foreign.title = 'ignored';
    expect(foreign.title).toBe('readable');
  });

  it('projects title mutation and DOMString conversion for both HTML and SVG documents', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const html = document.implementation.createHTMLDocument();
      const svg = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null);
      html.title = '\tHTML\n title ';
      svg.title = '\tSVG\n title ';
      const titles = [html.title, svg.title];
      Reflect.set(html, 'title', null);
      Reflect.set(svg, 'title', undefined);
      return { titles, converted: [html.title, svg.title] };
    })).toEqual({ titles: ['HTML title', 'SVG title'], converted: ['null', 'undefined'] });
  });

  it('uses only direct SVG title children and inserts a missing SVG title first', () => {
    const document = createTestDocument().implementation.createDocument(SVG_NAMESPACE, 'svg', null);
    const root = document.documentElement!;
    const group = document.createElementNS(SVG_NAMESPACE, 'g');
    const nested = document.createElementNS(SVG_NAMESPACE, 'title');
    nested.textContent = 'nested';
    group.appendChild(nested);
    root.appendChild(group);
    const htmlTitle = document.createElementNS(HTML_NAMESPACE, 'title');
    htmlTitle.textContent = 'HTML';
    root.appendChild(htmlTitle);
    expect(document.title).toBe('');
    document.title = '\tSVG\n title ';
    const title = root.firstChild!;
    expect(title).toMatchObject({ namespaceURI: SVG_NAMESPACE, localName: 'title' });
    expect(title.textContent).toBe('\tSVG\n title ');
    expect(title.nextSibling).toBe(group);
    expect(document.title).toBe('SVG title');
    document.title = 'updated';
    expect(root.firstChild).toBe(title);
    expect(title.textContent).toBe('updated');
  });

  it('replaces and adopts body/frameset, while assigning the same body does nothing', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const old = document.body!;
    const version = document.collectionVersion;
    document.body = old;
    expect(document.collectionVersion).toBe(version);
    const source = createTestDocument();
    const frameset = source.createElementNS(HTML_NAMESPACE, 'frameset') as HTMLElementImpl;
    document.body = frameset;
    expect(document.body).toBe(frameset);
    expect(frameset.nodeDocument).toBe(document);
    expect(old.parentNode).toBeNull();
  });

  it('rejects null and other elements, and requires a root only when there is no existing body', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const errors: string[] = [];
      for (const value of [null, doc.createElement('div'), doc.createElementNS('urn:example', 'body')]) {
        try { Reflect.set(doc, 'body', value); } catch (error) { errors.push((error as Error).name); }
      }
      doc.removeChild(doc.documentElement);
      try { doc.body = doc.createElement('body'); } catch (error) { errors.push((error as Error).name); }
      return errors;
    })).toEqual(['HierarchyRequestError', 'HierarchyRequestError', 'TypeError', 'HierarchyRequestError']);
  });

  it('appends an HTML body even to a foreign document element, without changing the getter rule', () => {
    const document = createTestDocument().implementation.createDocument(SVG_NAMESPACE, 'svg', null);
    const body = document.createElementNS(HTML_NAMESPACE, 'body') as HTMLElementImpl;
    document.body = body;
    expect(body.parentNode).toBe(document.documentElement);
    expect(document.body).toBeNull();
  });

  it('exposes stable live collections with exact namespace, attribute, and tree filters', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const images = doc.images;
      const embeds = doc.embeds;
      const links = doc.links;
      const forms = doc.forms;
      const scripts = doc.scripts;
      const image = doc.createElement('img');
      const embed = doc.createElement('embed');
      const anchor = doc.createElement('a');
      const area = doc.createElement('area');
      const form = doc.createElement('form');
      const script = doc.createElement('script');
      for (const element of [image, embed, anchor, area, form, script]) doc.body.appendChild(element);
      for (const tag of ['img', 'embed', 'a', 'form', 'script']) {
        const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        element.setAttribute('href', '');
        doc.body.appendChild(element);
      }
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      host.attachShadow({ mode: 'open' }).appendChild(doc.createElement('img'));
      const beforeLinks = links.length;
      anchor.setAttribute('href', '');
      area.setAttributeNS('urn:example', 'x:href', '');
      const afterAnchor = links.length;
      area.setAttribute('href', '');
      const afterArea = Array.from(links, (element) => element.localName);
      anchor.removeAttribute('href');
      const afterRemoval = Array.from(links, (element) => element.localName);
      const counts = [images.length, embeds.length, forms.length, scripts.length];
      image.remove();
      return {
        same: images === doc.images && embeds === doc.embeds && embeds === doc.plugins &&
          links === doc.links && forms === doc.forms && scripts === doc.scripts,
        counts, beforeLinks, afterAnchor, afterArea, afterRemoval, imagesAfterRemoval: images.length,
      };
    })).toEqual({
      same: true, counts: [1, 1, 1, 1], beforeLinks: 0, afterAnchor: 1,
      afterArea: ['a', 'area'], afterRemoval: ['area'], imagesAfterRemoval: 0,
    });
  });

  it('getElementsByName is a live, case-sensitive NodeList of any HTML element', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const list = doc.getElementsByName('Case');
      const empty = doc.getElementsByName('');
      doc.documentElement.setAttribute('name', 'Case');
      const div = doc.createElement('div');
      div.setAttribute('name', 'Case');
      const lower = doc.createElement('div');
      lower.setAttribute('name', 'case');
      const foreign = doc.createElementNS('urn:example', 'div');
      foreign.setAttribute('name', 'Case');
      const namedAttr = doc.createElement('div');
      namedAttr.setAttributeNS('urn:example', 'x:name', 'Case');
      const blank = doc.createElement('div');
      blank.setAttribute('name', '');
      for (const element of [div, lower, foreign, namedAttr, blank]) doc.body.appendChild(element);
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      const hidden = doc.createElement('div');
      hidden.setAttribute('name', 'Case');
      host.attachShadow({ mode: 'open' }).appendChild(hidden);
      const before = Array.from(list, (node) => (node as Element).localName);
      div.setAttribute('name', 'changed');
      return { nodeList: list instanceof NodeList, before, after: list.length, empty: empty.length };
    })).toEqual({ nodeList: true, before: ['html', 'div'], after: 1, empty: 1 });
  });

  it('projects retained currentScript state for both HTML and SVG scripts', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    expect(browser.document.currentScript).toBeNull();
    const html = browser.document.createElement('script');
    document.currentScript = unwrap<HTMLScriptElementImpl>(html);
    expect(browser.document.currentScript).toBe(html);
    const svg = browser.document.createElementNS(SVG_NAMESPACE, 'script');
    document.currentScript = unwrap<SVGScriptElementImpl>(svg);
    expect(browser.document.currentScript).toBe(svg);
    expect(await browser.evaluate(() => Reflect.set(document, 'currentScript', null))).toBe(false);
    document.currentScript = null;
    expect(browser.document.currentScript).toBeNull();
  });
});

describe('Document named properties', () => {
  it('selects eligible names and IDs, excluding generic elements, foreign namespaces, and empty names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const result: [string, boolean, boolean][] = [];
      for (const tag of ['form', 'iframe', 'img', 'embed', 'object', 'div', 'input', 'a']) {
        const element = doc.createElement(tag);
        element.setAttribute('id', `${tag}ID`);
        element.setAttribute('name', `${tag}Name`);
        doc.body.appendChild(element);
        result.push([tag, Reflect.get(doc, `${tag}ID`) === element, Reflect.get(doc, `${tag}Name`) === element]);
      }
      const image = doc.createElement('img');
      image.id = 'idWithoutName';
      doc.body.appendChild(image);
      const foreign = doc.createElementNS('urn:example', 'form');
      foreign.setAttribute('name', 'foreign');
      doc.body.appendChild(foreign);
      const empty = doc.createElement('form');
      empty.setAttribute('name', '');
      empty.setAttributeNS('urn:example', 'x:name', 'namespaced');
      doc.body.appendChild(empty);
      return { result, excluded: ['idWithoutName', 'foreign', '', 'namespaced'].every((name) => !(name in doc)) };
    })).toEqual({
      result: [
        ['form', false, true], ['iframe', false, true], ['img', true, true], ['embed', false, true],
        ['object', true, true], ['div', false, false], ['input', false, false], ['a', false, false],
      ], excluded: true,
    });
  });

  it('updates image ID eligibility when its name is added, emptied, or removed', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const image = doc.createElement('img');
      image.id = 'imageID';
      doc.body.appendChild(image);
      const snapshots: boolean[][] = [];
      for (const name of [null, 'imageName', '', 'restored', null]) {
        if (name === null) image.removeAttribute('name');
        else image.setAttribute('name', name);
        snapshots.push([
          Reflect.get(doc, 'imageID') === image,
          Object.getOwnPropertyNames(doc).includes('imageID'),
          name !== null && name !== '' && Reflect.get(doc, name) === image,
        ]);
      }
      return snapshots;
    })).toEqual([
      [false, false, false], [true, true, true], [false, false, false],
      [true, true, true], [false, false, false],
    ]);
  });

  // SPEC_CLASH(document-named-scope): HTML includes XML and detached documents.
  it('also resolves HTML elements inside an XML document', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createDocument('urn:example', 'root', null);
      const form = doc.createElementNS('http://www.w3.org/1999/xhtml', 'form');
      form.setAttribute('name', 'named');
      doc.documentElement.appendChild(form);
      return Reflect.get(doc, 'named') === form;
    })).toBe(true);
  });

  // SPEC_CLASH(document-named-order): HTML uses tree order, with IDs before names and later duplicates ignored.
  it('enumerates names in tree order, including overrides of built-in members', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const form = doc.createElement('form');
      form.setAttribute('name', 'zForm');
      const image = doc.createElement('img');
      image.setAttribute('id', 'mID');
      image.setAttribute('name', 'aName');
      const duplicate = doc.createElement('img');
      duplicate.setAttribute('id', 'mID');
      duplicate.setAttribute('name', 'title');
      for (const element of [form, image, duplicate]) doc.body.appendChild(element);
      const keys = () => Object.getOwnPropertyNames(doc).filter((key) => ['zForm', 'mID', 'aName', 'title'].includes(key));
      const before = keys();
      const namedTitle: unknown = Reflect.get(doc, 'title');
      const overrides = namedTitle === duplicate;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoke the borrowed getter with an explicit receiver.
      const getter = Object.getOwnPropertyDescriptor(Document.prototype, 'title')!.get!;
      const original: unknown = Reflect.apply(getter, doc, []);
      const enumerable = Object.getOwnPropertyDescriptor(doc, 'title')!.enumerable;
      form.remove();
      doc.body.appendChild(form);
      return { before, after: keys(), overrides, original, enumerable };
    })).toEqual({
      before: ['zForm', 'mID', 'aName', 'title'], after: ['mID', 'aName', 'title', 'zForm'],
      overrides: true, original: '', enumerable: true,
    });
  });

  it('retains a live collection across changes between multiple and single named matches', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const form = doc.createElement('form');
      const image = doc.createElement('img');
      form.setAttribute('name', 'shared');
      image.setAttribute('name', 'shared');
      doc.body.appendChild(form);
      doc.body.appendChild(image);
      const list = Reflect.get(doc, 'shared') as HTMLCollection;
      const same = list === Reflect.get(doc, 'shared');
      image.remove();
      const single = Reflect.get(doc, 'shared') === form && list.length === 1;
      form.remove();
      const absent = !('shared' in doc) && list.length === 0;
      doc.body.appendChild(image);
      doc.body.appendChild(form);
      return {
        collection: list instanceof HTMLCollection, same, single, absent,
        restored: list === Reflect.get(doc, 'shared'), first: list.item(0) === image,
      };
    })).toEqual({ collection: true, same: true, single: true, absent: true, restored: true, first: true });
  });

  it('excludes shadow-tree names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const doc = document.implementation.createHTMLDocument();
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      const form = doc.createElement('form');
      form.setAttribute('name', 'hidden');
      host.attachShadow({ mode: 'open' }).appendChild(form);
      return 'hidden' in doc;
    })).toBe(false);
  });

  it('uses fallback state and exposed object ancestors, invalidating retained collections when state changes', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const outer = document.createElement('object') as HTMLObjectElementImpl;
    const inner = document.createElement('object') as HTMLObjectElementImpl;
    const embed = document.createElement('embed') as HTMLEmbedElementImpl;
    const form = document.createElement('form');
    for (const element of [outer, inner, embed, form]) element.setAttribute('name', 'shared');
    inner.appendChild(embed);
    outer.appendChild(inner);
    document.body!.appendChild(outer);
    document.body!.appendChild(form);
    const collection = document.getNamedProperty('shared');
    expect(collection).toBeInstanceOf(HTMLCollectionImpl);
    if (!(collection instanceof HTMLCollectionImpl)) throw new Error('Expected a collection');
    expect([...collection]).toEqual([outer, form]);
    expect(outer.isExposed()).toBe(true);
    expect(inner.isExposed()).toBe(false);
    expect(embed.isExposed()).toBe(false);
    outer.showsFallbackContent = true;
    expect(outer.isExposed()).toBe(false);
    expect(inner.isExposed()).toBe(true);
    expect(embed.isExposed()).toBe(false);
    expect(document.getNamedProperty('shared')).toBe(collection);
    expect([...collection]).toEqual([inner, form]);
    inner.showsFallbackContent = true;
    expect(inner.isExposed()).toBe(false);
    expect(embed.isExposed()).toBe(true);
    expect([...collection]).toEqual([embed, form]);
    outer.showsFallbackContent = false;
    expect(embed.isExposed()).toBe(false);
    expect([...collection]).toEqual([outer, form]);
    inner.removeChild(embed);
    outer.showsFallbackContent = true;
    expect(inner.isExposed()).toBe(true);
  });

  it('returns the active WindowProxy when an iframe has a content navigable', () => {
    const parent = new Browlet({ route: () => '' });
    const child = new Browlet({ route: () => '' });
    const childDocument = unwrap<DocumentImpl>(child.document);
    const frame = parent.document.createElement('iframe');
    frame.setAttribute('name', 'frame');
    // Child navigation is not implemented yet; connect a real existing navigable at its retained seam.
    const implementation = unwrap<HTMLIFrameElementImpl>(frame);
    implementation.contentNavigable = childDocument.getNodeNavigable();
    expect(implementation.contentNavigable).not.toBeNull();
    parent.document.documentElement!.appendChild(frame);
    expect(Reflect.get(parent.document, 'frame')).toBe(child.window);
    implementation.contentNavigable = null;
    expect(Reflect.get(parent.document, 'frame')).toBe(frame);
  });
});
