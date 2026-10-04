import { setImmediate as nextTurn } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultStyleletExecution, Stylelet, type InternalPromise, type StyleletExecution,
} from '../../../src/stylelet/index';
import {
  standardDOM, type DOMOperations, type DOMNode, type DOMDocument, type DOMElement, type DOMDocumentFragment,
} from '../../../src/infra/index';
import { browletDOM } from '../../../src/browlet/integration/dom';
import { matchSelectorList } from '../../../src/stylelet/selector/match';
import { parseSelectorList } from '../../../src/stylelet/syntax/selector';
import { createBrowletDocument } from '../browlet-document';
import { createOpaqueDOM } from '../../support/opaque-dom';

// jsdom's private implementation accessor has no published TypeScript declaration.
const { implForWrapper } = createRequire(__filename)('jsdom/lib/generated/idl/utils.js') as {
  implForWrapper(this: void, value: Document): DOMDocument;
  implForWrapper(this: void, value: Element): DOMElement;
  implForWrapper(this: void, value: DocumentFragment): DOMDocumentFragment;
  implForWrapper(this: void, value: Node): DOMNode;
};

describe('Stylelet DOM hosts', () => {
  it('matches, orders sheets, and reads inline state without inspecting host nodes', () => {
    const host = createOpaqueDOM('<style id="first"></style><style id="second"></style><main id="target" data-state="chosen"><span></span></main>');
    try {
      const { document, dom, opaque, window } = host;
      const stylelet = new Stylelet(document, { dom });
      const first = opaque(window.document.getElementById('first')!);
      const second = opaque(window.document.getElementById('second')!);
      const target = opaque(window.document.getElementById('target')!);
      const later = stylelet.documentScope.createStyleElementStyleSheet(second, 'main:has(> span):state(chosen) { opacity: 0.75 }');
      const earlier = stylelet.documentScope.createStyleElementStyleSheet(first, 'main { opacity: 0.25 }');
      expect([...stylelet.documentScope.styleSheets].map((sheet) => sheet === earlier ? 'first' : 'second'))
        .toEqual(['first', 'second']);
      expect(later.ownerNode === second).toBe(true);
      expect(stylelet.getComputedStyle(target).getPropertyValue('opacity')).toBe('0.75');
      dom.setAttribute(target, 'style', 'opacity: 0.5');
      expect(stylelet.getComputedStyle(target).getPropertyValue('opacity')).toBe('0.5');
    } finally { host.close(); }
  });

  const hosts = [
    {
      name: 'Browlet implementations',
      create(html: string) {
        return { document: createBrowletDocument(html), dom: browletDOM as DOMOperations, close: () => {} };
      },
    },
    {
      name: 'jsdom implementations',
      create(html: string) {
        const { window } = new JSDOM(html, { url: 'https://example.test/' });
        return {
          document: implForWrapper(window.document),
          dom: standardDOM as DOMOperations,
          close: () => { window.close(); },
        };
      },
    },
  ];

  for (const host of hosts) {
    it(`uses ${host.name} directly for tree matching and stylesheet ownership`, () => {
      const { document, dom, close } = host.create('<main class="target">text<span></span></main>');
      try {
        const main = dom.firstElementChild(dom.body(document)!)!;
        const child = dom.firstElementChild(main)!;
        const styles = new Stylelet(document, { dom });
        const sheet = styles.documentScope.createStyleElementStyleSheet(main, `
          main.target { opacity: 0.25 }
          main.target > span:first-child { opacity: 0.5 }
        `);

        expect(styles.context.document).toBe(document);
        expect(sheet.ownerNode).toBe(main);
        expect(styles.getComputedStyle(main).getPropertyValue('opacity')).toBe('0.25');
        expect(styles.getComputedStyle(child).getPropertyValue('opacity')).toBe('0.5');
        dom.setAttribute(main, 'class', 'other');
        expect(styles.getComputedStyle(child).getPropertyValue('opacity')).toBe('');
      } finally {
        close();
      }
    });

    it(`reads live inline declarations and directionality from ${host.name}`, () => {
      const { document, dom, close } = host.create('<main dir="auto" style="opacity: 0.25">שלום</main>');
      try {
        const main = dom.firstElementChild(dom.body(document)!)!;
        const styles = new Stylelet(document, { dom });

        expect(matchSelectorList(parseSelectorList(':dir(rtl)')!, main, styles.context)).not.toBeNull();
        expect(styles.getComputedStyle(main).getPropertyValue('opacity')).toBe('0.25');
        dom.setAttribute(main, 'style', 'opacity: 0.75');
        expect(styles.getComputedStyle(main).getPropertyValue('opacity')).toBe('0.75');
      } finally {
        close();
      }
    });
  }

  it('uses Browlet implementation constructors for HTML classification', () => {
    const document = createBrowletDocument(`
      <main></main><x-example></x-example><unknown></unknown>
      <svg><circle></circle></svg><math><mi>x</mi></math>
    `);
    const context = document.getCSSEngine().context;
    const getNamespaceURI = vi.spyOn(context.dom, 'getNamespaceURI');
    const main = document.getElementsByTagName('main')[0]!;

    for (const tag of ['main', 'x-example', 'unknown']) {
      expect(context.dom.isHTMLElement(document.getElementsByTagName(tag)[0]!)).toBe(true);
    }
    for (const tag of ['svg', 'circle', 'math', 'mi']) {
      expect(context.dom.isHTMLElement(document.getElementsByTagName(tag)[0]!)).toBe(false);
    }
    expect(context.dom.isHTMLElement(document.createElementNS('urn:test', 'main'))).toBe(false);

    expect(matchSelectorList(parseSelectorList('MAIN')!, main, context)).not.toBeNull();
    const circle = document.getElementsByTagName('circle')[0]!;
    expect(matchSelectorList(parseSelectorList('CIRCLE')!, circle, context)).toBeNull();
    expect(matchSelectorList(parseSelectorList('circle')!, circle, context)).not.toBeNull();
    expect(getNamespaceURI).not.toHaveBeenCalled();
  });

  it('uses namespace classification across raw jsdom realms without constructors', () => {
    const first = new JSDOM('<main></main><svg><circle></circle></svg>');
    const second = new JSDOM('<main></main>');
    try {
      const context = new Stylelet(implForWrapper(first.window.document)).context;
      const firstMain = implForWrapper(first.window.document.querySelector('main')!);
      const secondMain = implForWrapper(second.window.document.querySelector('main')!);
      const circle = implForWrapper(first.window.document.querySelector<Element>('circle')!);

      expect(matchSelectorList(parseSelectorList('MAIN')!, firstMain, context)).not.toBeNull();
      expect(matchSelectorList(parseSelectorList('MAIN')!, secondMain, context)).not.toBeNull();
      expect(matchSelectorList(parseSelectorList('CIRCLE')!, circle, context)).toBeNull();
    } finally {
      first.window.close();
      second.window.close();
    }
  });

  it('reads live jsdom control state without substituting attributes', () => {
    const { window } = new JSDOM('<input type="checkbox" checked>');
    try {
      const document = implForWrapper(window.document);
      const dom: DOMOperations = standardDOM;
      const input = window.document.querySelector('input')!;
      const implementation = implForWrapper(input);
      const styles = new Stylelet(document, { dom });
      const checked = parseSelectorList(':checked')!;

      expect(matchSelectorList(checked, implementation, styles.context)).not.toBeNull();
      input.checked = false;
      expect(input.hasAttribute('checked')).toBe(true);
      expect(matchSelectorList(checked, implementation, styles.context)).toBeNull();
      input.indeterminate = true;
      expect(matchSelectorList(parseSelectorList(':indeterminate')!, implementation, styles.context)).not.toBeNull();
    } finally {
      window.close();
    }
  });

  it('matches URL fragments from a raw document without consulting Location', () => {
    const { window } = new JSDOM('<main id="target"></main>', { url: 'https://example.test/#target' });
    try {
      const document = implForWrapper(window.document);
      const dom: DOMOperations = standardDOM;
      const main = dom.firstElementChild(dom.body(document)!)!;
      const styles = new Stylelet(document, { dom });

      Object.defineProperty(document, 'location', { get() { throw new Error('Unexpected Location access'); } });
      expect(matchSelectorList(parseSelectorList(':target')!, main, styles.context)).not.toBeNull();
      window.history.replaceState(null, '', '#other');
      expect(matchSelectorList(parseSelectorList(':target')!, main, styles.context)).toBeNull();
    } finally {
      window.close();
    }
  });

  it('uses supplied focus and custom-element state with the original implementations', () => {
    const document = createBrowletDocument('<x-example></x-example>');
    const element = document.body!.firstElementChild!;
    const styles = new Stylelet(document, {
      dom: {
        ...browletDOM,
        hasFocus: (owner) => owner === document,
        activeElement: (owner) => owner === document ? element : null,
        isDefined: (owner, name) => owner === document && name === 'x-example',
      },
    });

    expect(matchSelectorList(parseSelectorList(':focus:defined')!, element, styles.context)).not.toBeNull();
    expect(matchSelectorList(parseSelectorList(':focus-within')!, document.body!, styles.context)).not.toBeNull();
  });
});

describe('Stylelet execution', () => {
  it('completes replacement with standalone execution', async () => {
    const { document } = new JSDOM('<main></main>', { url: 'https://example.test/' }).window;
    const styles = new Stylelet(document);
    const sheet = styles.createStyleSheet();
    const replacement = observe(sheet.replace('main { opacity: 0.25 }'));

    expect(sheet.cssRules.length).toBe(0);
    expect(() => sheet.replaceSync('')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    await expect(replacement).resolves.toBe(sheet);
    styles.documentScope.setAdoptedStyleSheets([sheet]);
    expect(styles.getComputedStyle(document.querySelector('main')!).getPropertyValue('opacity')).toBe('0.25');
    expect(() => sheet.replaceSync('')).not.toThrow();
  });

  it('waits for background work and owner delivery before applying a replacement', async () => {
    const document = new JSDOM().window.document;
    const work: (() => void)[] = [];
    const tasks: (() => void)[] = [];
    const exec: StyleletExecution = {
      ...defaultStyleletExecution,
      runInParallel: (steps) => { work.push(steps); },
      queueTask(source, steps) {
        expect(source).toBe('dom-manipulation');
        tasks.push(steps);
        return { remove: () => { tasks.splice(tasks.indexOf(steps), 1); } };
      },
    };
    const sheet = new Stylelet(document, { exec }).createStyleSheet();
    const completed = observe(sheet.replace('.first {} .second {}'));
    const rejected = expect(observe(sheet.replace('.wrong {}')))
      .rejects.toMatchObject({ name: 'NotAllowedError' });

    await nextTurn();
    expect(sheet.cssRules.length).toBe(0);
    expect(() => sheet.insertRule('.wrong {}')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    work.shift()!();
    expect(sheet.cssRules.length).toBe(0);
    expect(() => sheet.replaceSync('')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    expect(tasks).toHaveLength(1);
    tasks.shift()!();
    await expect(completed).resolves.toBe(sheet);
    await rejected;
    expect(sheet.cssRules.length).toBe(2);
    expect(sheet.insertRule('.third {}')).toBe(0);
  });

  it('uses host exceptions in sheets, media lists, declarations, and adoption', async () => {
    class HostDOMException extends DOMException {}
    const exec: StyleletExecution = {
      ...defaultStyleletExecution,
      DOMException: HostDOMException,
    };
    const { document } = new JSDOM('<main></main>').window;
    const styles = new Stylelet(document, { exec });
    const sheet = styles.createStyleSheet();

    expect(() => sheet.deleteRule(0)).toThrow(HostDOMException);
    expect(() => sheet.media.deleteMedium('screen')).toThrow(HostDOMException);
    const declaration = styles.getComputedStyle(document.querySelector('main')!);
    expect(() => declaration.setProperty('color', 'red')).toThrow(HostDOMException);
    const foreign = new Stylelet(new JSDOM().window.document).createStyleSheet();
    expect(() => styles.documentScope.setAdoptedStyleSheets([foreign])).toThrow(HostDOMException);

    const embedded = styles.documentScope.createStyleElementStyleSheet(
      document.createElement('style'), '',
    );
    expect(() => embedded.replaceSync('')).toThrow(HostDOMException);
    expect(() => embedded.media.deleteMedium('screen')).toThrow(HostDOMException);
    await expect(observe(embedded.replace(''))).rejects.toBeInstanceOf(HostDOMException);
  });
});

function observe<T>(value: InternalPromise<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.observe(resolve, reject); });
}
