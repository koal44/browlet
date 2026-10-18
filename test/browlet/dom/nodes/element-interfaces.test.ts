import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { browletDefinitions } from '../../../../src/browlet/bindings';
import { HTMLArticleElementImpl } from '../../../../src/browlet/dom/nodes/html/sections/article';
import { HTMLQElementImpl } from '../../../../src/browlet/dom/nodes/html/grouping/quote';
import { HTMLTableHeaderCellElementImpl } from '../../../../src/browlet/dom/nodes/html/tables/cell';
import { unwrap } from '../../../support/browlet-binding';
import { parseTestDocument } from '../../../support/dom';
import { validateImplementationMembers } from '../../../support/web-idl-binding';

describe('HTML element interfaces', () => {
  it.each(['html', 'xhtml', 'xml'] as const)('selects and clones every specified interface in %s documents', async (mode) => {
    const browser = new Browlet({ route: () => '' });
    const actual = await browser.evaluate(({ mode, interfaces }) => {
      const namespace = 'http://www.w3.org/1999/xhtml';
      const owner = mode === 'html' ? document : mode === 'xhtml'
        ? document.implementation.createDocument(namespace, 'html') : new Document();
      return interfaces.map(([expected, names]) => [expected, names.map((name) => {
        const element = mode === 'xml' ? owner.createElementNS(namespace, name) : owner.createElement(name);
        const constructor: unknown = Reflect.get(globalThis, expected);
        const prototype: unknown = typeof constructor === 'function' ? Reflect.get(constructor, 'prototype') : undefined;
        const clone = element.cloneNode();
        return [name, element.constructor.name,
          Object.getPrototypeOf(element) === prototype,
          Object.getPrototypeOf(clone) === prototype,
          element.ownerDocument === owner];
      })]);
    }, { mode, interfaces: elementInterfaces });
    expect(actual).toEqual(elementInterfaces.map(([name, names]) =>
      [name, names.map((localName) => [localName, name, true, true, true])]));
  });

  it('retains distinct implementations with their declared members when creating and cloning each HTML tag', () => {
    const browser = new Browlet({ route: () => '' });
    const definitions = new Map(browletDefinitions.filter((definition) => definition.kind === 'interface')
      .map((definition) => [definition.name, definition]));
    const constructors = new Set<object>();
    let count = 0;
    for (const [interfaceName, names] of elementInterfaces) {
      for (const name of names) {
        const element = browser.document.createElement(name);
        const implementation = unwrap(element);
        const clone = unwrap(element.cloneNode());
        validateImplementationMembers(definitions.get(interfaceName)!, implementation);
        expect(constructors.has(implementation.constructor), name).toBe(false);
        expect(clone.constructor, name).toBe(implementation.constructor);
        constructors.add(implementation.constructor);
        count++;
      }
    }
    expect(constructors.size).toBe(count);
  });

  it('selects tag-specific implementations through the HTML parser', () => {
    const document = parseTestDocument('<article><q>quote</q><table><tr><th>heading</th></tr></table></article>');
    expect(document.querySelector('article')).toBeInstanceOf(HTMLArticleElementImpl);
    expect(document.querySelector('q')).toBeInstanceOf(HTMLQElementImpl);
    expect(document.querySelector('th')).toBeInstanceOf(HTMLTableHeaderCellElementImpl);
  });

  it('distinguishes custom names, removed elements, and case-sensitive namespace creation', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const namespace = 'http://www.w3.org/1999/xhtml';
      const names = ['x-widget', 'a-', 'x-é', 'annotation-xml', 'font-face', 'menuitem', 'command', 'image', 'unknown'];
      return [names.map((name) => document.createElementNS(namespace, name).constructor.name),
        document.createElement('DIV').constructor.name,
        document.createElementNS(namespace, 'DIV').constructor.name,
        document.createElementNS(namespace, 'X-widget').constructor.name,
        document.createElementNS('urn:other', 'div').constructor.name,
        new Document().createElement('div').constructor.name];
    })).toEqual([
      ['HTMLElement', 'HTMLElement', 'HTMLElement', 'HTMLUnknownElement', 'HTMLUnknownElement',
        'HTMLUnknownElement', 'HTMLUnknownElement', 'HTMLUnknownElement', 'HTMLUnknownElement'],
      'HTMLDivElement', 'HTMLUnknownElement', 'HTMLUnknownElement', 'Element', 'Element',
    ]);
  });

  it.each([
    ['pre', 'HTMLPreElement'], ['article', 'HTMLElement'], ['q', 'HTMLQuoteElement'],
  ] as const)('allocates %s in the receiver document realm when a factory is borrowed', (name, interfaceName) => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const element = first.window.document.createElement.call(second.window.document, name);
    expect(Object.getPrototypeOf(element) === second.window[interfaceName].prototype).toBe(true);
    expect(Object.getPrototypeOf(element) === first.window[interfaceName].prototype).toBe(false);
    expect(element.ownerDocument).toBe(second.window.document);
  });
});

// Fixed expectations from HTML's element definitions and the obsolete-name rules.
// https://html.spec.whatwg.org/multipage/indices.html#elements-3
// https://html.spec.whatwg.org/multipage/dom.html#elements-in-the-dom
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
const elementInterfaces: [string, string[]][] = [
  ['HTMLAnchorElement', ['a']],
  ['HTMLElement', [
    'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'cite', 'code', 'dd', 'dfn', 'dt', 'em',
    'figcaption', 'figure', 'footer', 'header', 'hgroup', 'i', 'kbd', 'main', 'mark', 'nav', 'noscript',
    'rp', 'rt', 'ruby', 's', 'samp', 'search', 'section', 'small', 'strong', 'sub', 'summary', 'sup', 'u',
    'var', 'wbr', 'acronym', 'basefont', 'big', 'center', 'nobr', 'noembed', 'noframes', 'plaintext',
    'rb', 'rtc', 'strike', 'tt',
  ]],
  ['HTMLAreaElement', ['area']],
  ['HTMLAudioElement', ['audio']],
  ['HTMLBaseElement', ['base']],
  ['HTMLQuoteElement', ['blockquote', 'q']],
  ['HTMLBodyElement', ['body']],
  ['HTMLBRElement', ['br']],
  ['HTMLButtonElement', ['button']],
  ['HTMLCanvasElement', ['canvas']],
  ['HTMLTableCaptionElement', ['caption']],
  ['HTMLTableColElement', ['col', 'colgroup']],
  ['HTMLDataElement', ['data']],
  ['HTMLDataListElement', ['datalist']],
  ['HTMLModElement', ['del', 'ins']],
  ['HTMLDetailsElement', ['details']],
  ['HTMLDialogElement', ['dialog']],
  ['HTMLDivElement', ['div']],
  ['HTMLDListElement', ['dl']],
  ['HTMLEmbedElement', ['embed']],
  ['HTMLFieldSetElement', ['fieldset']],
  ['HTMLFormElement', ['form']],
  ['HTMLHeadingElement', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']],
  ['HTMLHeadElement', ['head']],
  ['HTMLHRElement', ['hr']],
  ['HTMLHtmlElement', ['html']],
  ['HTMLIFrameElement', ['iframe']],
  ['HTMLImageElement', ['img']],
  ['HTMLInputElement', ['input']],
  ['HTMLLabelElement', ['label']],
  ['HTMLLegendElement', ['legend']],
  ['HTMLLIElement', ['li']],
  ['HTMLLinkElement', ['link']],
  ['HTMLMapElement', ['map']],
  ['HTMLMenuElement', ['menu']],
  ['HTMLMetaElement', ['meta']],
  ['HTMLMeterElement', ['meter']],
  ['HTMLObjectElement', ['object']],
  ['HTMLOListElement', ['ol']],
  ['HTMLOptGroupElement', ['optgroup']],
  ['HTMLOptionElement', ['option']],
  ['HTMLOutputElement', ['output']],
  ['HTMLParagraphElement', ['p']],
  ['HTMLPictureElement', ['picture']],
  ['HTMLPreElement', ['pre', 'listing', 'xmp']],
  ['HTMLProgressElement', ['progress']],
  ['HTMLScriptElement', ['script']],
  ['HTMLSelectElement', ['select']],
  ['HTMLSelectedContentElement', ['selectedcontent']],
  ['HTMLSlotElement', ['slot']],
  ['HTMLSourceElement', ['source']],
  ['HTMLSpanElement', ['span']],
  ['HTMLStyleElement', ['style']],
  ['HTMLTableElement', ['table']],
  ['HTMLTableSectionElement', ['tbody', 'tfoot', 'thead']],
  ['HTMLTableCellElement', ['td', 'th']],
  ['HTMLTemplateElement', ['template']],
  ['HTMLTextAreaElement', ['textarea']],
  ['HTMLTimeElement', ['time']],
  ['HTMLTitleElement', ['title']],
  ['HTMLTableRowElement', ['tr']],
  ['HTMLTrackElement', ['track']],
  ['HTMLUListElement', ['ul']],
  ['HTMLVideoElement', ['video']],
  ['HTMLDirectoryElement', ['dir']],
  ['HTMLFontElement', ['font']],
  ['HTMLMarqueeElement', ['marquee']],
  ['HTMLFrameElement', ['frame']],
  ['HTMLFrameSetElement', ['frameset']],
  ['HTMLParamElement', ['param']],
  ['HTMLUnknownElement', ['applet', 'bgsound', 'blink', 'isindex', 'keygen', 'multicol', 'nextid', 'spacer']],
];
