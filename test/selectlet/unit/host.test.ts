import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createSelectlet } from '../../../src/selectlet/selectlet';
import { HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE, XML_NAMESPACE, standardDOM } from '../../../src/infra/index';
import { createOpaqueDOM } from '../../support/opaque-dom';

describe('Selectlet DOM hosts', () => {
  it.each([
    ['<div id="target" dir="auto">١A</div>', 'ltr'],
    ['<div id="target" dir="auto">中א</div>', 'ltr'],
    ['<div id="target" dir="auto">𞤀A</div>', 'rtl'],
    ['<div id="target" dir="auto"><script>א</script>A</div>', 'ltr'],
    ['<div dir="rtl"><svg id="target" dir="ltr"></svg></div>', 'rtl'],
  ])('uses HTML directionality for %s', (markup, direction) => {
    const host = createOpaqueDOM(markup);
    try {
      const selectlet = createSelectlet(host.document, { dom: host.dom });
      const target = host.opaque(host.window.document.getElementById('target')!);
      expect(selectlet.matches(`:dir(${direction})`, target)).toBe(true);
    } finally { host.close(); }
  });

  it('uses an existing environment and preserves the supplied node identities', () => {
    const host = createOpaqueDOM('<main id="target"></main>');
    try {
      const env = { userAgent: { dom: host.dom } };
      const selectlet = createSelectlet(host.document, { env, dom: standardDOM });
      expect(selectlet.context.env).toBe(env);
      expect(selectlet.context.dom).toBe(host.dom);
      expect(selectlet.first('#target') === host.opaque(host.window.document.querySelector('main')!)).toBe(true);
      expect(selectlet.context.config.NODE_LIST).toBe(false);
    } finally { host.close(); }
  });

  it('queries opaque nodes through their operations and preserves identity', () => {
    const host = createOpaqueDOM(`
      <main><span id="target" class="item" data-state="chosen"></span>
      text<span id="last" class="item"></span><input id="check" type="checkbox" checked></main>
    `);
    try {
      const { dom, document, window, opaque } = host;
      const selectlet = createSelectlet(document, { dom });
      const target = opaque(window.document.getElementById('target')!);
      expect(selectlet.first('main > .item:first-child:state(chosen)') === target).toBe(true);
      expect(Array.from(selectlet.select('main:has(> input) > span:nth-child(2), #target'), (element) => dom.getId(element)))
        .toEqual(['target', 'last']);
      expect(selectlet.matches(':target', target)).toBe(true);
      expect(selectlet.matches('[data-state|="chosen"]', target)).toBe(true);

      const input = window.document.querySelector('input')!;
      expect(selectlet.matches(':checked', opaque(input))).toBe(true);
      input.checked = false;
      expect(selectlet.matches(':checked', opaque(input))).toBe(false);
      input.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      expect(selectlet.matches(':hover', opaque(input))).toBe(true);

      const fragment = window.document.createDocumentFragment();
      const child = window.document.createElement('span');
      child.id = 'detached';
      fragment.appendChild(child);
      expect(selectlet.first('#detached', opaque(fragment)) === opaque(child)).toBe(true);
      const list = createSelectlet(document, { dom, config: { NODE_LIST: true } }).select('span');
      expect(Array.from(list, (element) => dom.getId(element))).toEqual(['target', 'last']);
    } finally { host.close(); }
  });

  it('uses namespace classification across realms without constructors', () => {
    const first = new JSDOM('<main></main><svg><circle></circle></svg>');
    const second = new JSDOM('<main></main>');
    try {
      const selectlet = createSelectlet(first.window.document);

      expect(selectlet.matches('MAIN', first.window.document.querySelector('main')!)).toBe(true);
      expect(selectlet.matches('MAIN', second.window.document.querySelector('main')!)).toBe(true);
      expect(selectlet.matches('CIRCLE', first.window.document.querySelector('circle')!)).toBe(false);
    } finally {
      first.window.close();
      second.window.close();
    }
  });

  it('uses the standard language query through an opaque host adapter', () => {
    const host = createOpaqueDOM('<main lang="en"><span></span></main>');
    try {
      const selectlet = createSelectlet(host.document, { dom: host.dom });
      const main = host.window.document.querySelector('main')!;
      const span = main.querySelector('span')!;
      expect(selectlet.matches(':lang(en)', host.opaque(span))).toBe(true);
      span.setAttribute('lang', 'de');
      span.setAttributeNS(XML_NAMESPACE, 'xml:lang', 'fr');
      expect(selectlet.matches(':lang(fr)', host.opaque(span))).toBe(true);
      expect(selectlet.matches(':lang(de)', host.opaque(span))).toBe(false);
      span.setAttributeNS(XML_NAMESPACE, 'xml:lang', '');
      expect(selectlet.matches(':lang("")', host.opaque(span))).toBe(true);
      expect(selectlet.matches(':lang("*")', host.opaque(span))).toBe(false);
      for (const namespace of [SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:other']) {
        const child = host.window.document.createElementNS(namespace, 'child');
        child.setAttribute('lang', 'fr');
        main.appendChild(child);
        expect(selectlet.matches(':lang(fr)', host.opaque(child))).toBe(namespace === SVG_NAMESPACE);
        expect(selectlet.matches(':lang(en)', host.opaque(child))).toBe(namespace !== SVG_NAMESPACE);
      }
      const shadow = main.attachShadow({ mode: 'closed' });
      const shadowChild = host.window.document.createElement('span');
      shadow.appendChild(shadowChild);
      expect(selectlet.matches(':lang(en)', host.opaque(shadowChild))).toBe(true);
    } finally { host.close(); }
  });

  it('folds ASCII letters only in language ranges and language tags', () => {
    const host = createOpaqueDOM('<main lang="ko"></main>');
    try {
      const selectlet = createSelectlet(host.document, { dom: host.dom });
      const main = host.dom.firstElementChild(host.dom.body(host.document)!)!;
      expect(selectlet.matches(':lang(KO)', main)).toBe(true);
      expect(selectlet.matches(':lang(Ko)', main)).toBe(false);
      host.dom.setAttribute(main, 'lang', 'Ko');
      expect(selectlet.matches(':lang(ko)', main)).toBe(false);
    } finally { host.close(); }
  });

  it('uses supplied constructors without namespace lookups during matching', () => {
    const { window } = new JSDOM('<main></main><x-example></x-example><svg><circle></circle></svg>');
    try {
      const getNamespaceURI = vi.fn((element: Element) => element.namespaceURI);
      const selectlet = createSelectlet(window.document, {
        dom: { ...standardDOM, getNamespaceURI, isHTMLElement: (element) => element instanceof window.HTMLElement },
      });
      getNamespaceURI.mockClear(); // Construction reads the document's default namespace once.

      expect(selectlet.matches('MAIN', window.document.querySelector('main')!)).toBe(true);
      expect(selectlet.matches('X-EXAMPLE', window.document.querySelector('x-example')!)).toBe(true);
      expect(selectlet.matches('CIRCLE', window.document.querySelector('circle')!)).toBe(false);
      expect(selectlet.matches('circle', window.document.querySelector('circle')!)).toBe(true);
      expect(getNamespaceURI).not.toHaveBeenCalled();
    } finally {
      window.close();
    }
  });

  it('keeps the supplied namespace accessor as the classification fallback', () => {
    const { window } = new JSDOM('<main></main>', { url: 'https://example.test/' });
    try {
      const main = window.document.querySelector('main')!;
      const getNamespaceURI = vi.fn((_element: object): string | null => null);
      const selectlet = createSelectlet(window.document, { dom: { ...standardDOM, getNamespaceURI, isHTMLElement: (element) => getNamespaceURI(element) === HTML_NAMESPACE } });

      expect(selectlet.matches('MAIN', main)).toBe(false);
      getNamespaceURI.mockReturnValue(HTML_NAMESPACE);
      expect(selectlet.matches('MAIN', main)).toBe(true);
      expect(getNamespaceURI).toHaveBeenCalledWith(main);
    } finally {
      window.close();
    }
  });
});
