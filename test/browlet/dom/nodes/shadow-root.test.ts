import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import type { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';
import { CustomElementRegistryImpl } from '../../../../src/browlet/dom/nodes/html/custom-elements/registry';
import { getBindingContext, getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('ShadowRoot attachment', () => {
  it('retains its host, document, flags, and open or closed exposure', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const openHost = document.createElement('div');
      const closedHost = document.createElement('span');
      document.body.append(openHost, closedHost);
      const open = openHost.attachShadow({ mode: 'open' });
      const closed = closedHost.attachShadow({
        mode: 'closed', delegatesFocus: true, slotAssignment: 'manual', clonable: true, serializable: true,
      });
      const child = document.createElement('b');
      closed.append(child);
      const flags = (root: ShadowRoot) => [root.mode, root.delegatesFocus, root.slotAssignment, root.clonable, root.serializable];
      return [
        open instanceof ShadowRoot, open instanceof DocumentFragment, openHost.shadowRoot === open,
        closedHost.shadowRoot, closed.host === closedHost, closed.ownerDocument === document,
        closed.parentNode, closed.isConnected, child.getRootNode() === closed,
        child.getRootNode({ composed: true }) === document, flags(open), flags(closed),
        openHost.childNodes.length, openHost.contains(child),
      ];
    })).toEqual([
      true, true, true, null, true, true, null, true, true, true,
      ['open', false, 'named', false, false], ['closed', true, 'manual', true, true], 0, false,
    ]);
  });

  it('accepts only HTML shadow hosts and valid custom-element names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const accepted = ['article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3',
        'h4', 'h5', 'h6', 'header', 'main', 'nav', 'p', 'section', 'span', 'test-host'];
      const rejected = ['a', 'button', 'input', 'slot', 'template', 'html', 'font-face', 'unknown'];
      const namespace = 'http://www.w3.org/1999/xhtml';
      const rejectedNodes = [
        ...rejected.map((name) => document.createElement(name)),
        document.createElementNS('urn:test', 'div'), document.createElementNS(namespace, 'DIV'),
        document.createElementNS(namespace, 'Test-host'),
      ];
      return [
        accepted.every((name) => document.createElement(name).attachShadow({ mode: 'open' }) instanceof ShadowRoot),
        rejectedNodes.map((node) => {
          try { node.attachShadow({ mode: 'open' }); return ''; }
          catch (error) { return (error as DOMException).name; }
        }),
      ];
    })).toEqual([true, Array(11).fill('NotSupportedError')]);
  });

  it('converts required options and refuses repeated attachment without changing the root', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const errors: string[] = [];
      for (const init of [undefined, null, {}, { mode: 'invalid' }, { mode: 'open', slotAssignment: 'invalid' }]) {
        try { host.attachShadow(init as ShadowRootInit); }
        catch (error) { errors.push((error as Error).name); }
      }
      const root = host.attachShadow({ mode: 'open' });
      const child = root.appendChild(document.createTextNode('kept'));
      try { host.attachShadow({ mode: 'open' }); } catch (error) { errors.push((error as Error).name); }
      try { Reflect.construct(ShadowRoot, []); } catch (error) { errors.push((error as Error).name); }
      const other = document.createElement('div').attachShadow(root);
      return [errors, host.shadowRoot === root, root.firstChild === child, other.mode, other.slotAssignment];
    })).toEqual([[
      'TypeError', 'TypeError', 'TypeError', 'TypeError', 'TypeError', 'NotSupportedError', 'TypeError',
    ], true, true, 'open', 'named']);
  });

  it('reuses a declarative root without replacing its flags or combining child removal records', () => {
    const browser = new Browlet({ route: () => '' });
    const { document, MutationObserver } = browser.window;
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open', delegatesFocus: true });
    const first = root.appendChild(document.createElement('span'));
    const second = root.appendChild(document.createTextNode('second'));
    const implementation = unwrap<ShadowRootImpl>(root);
    implementation.declarative = true; // Parser construction remains a later slice.
    const observer = new MutationObserver(() => {});
    observer.observe(root, { childList: true });
    expect(() => host.attachShadow({ mode: 'closed' })).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
    expect(root.childNodes.length).toBe(2);
    expect(host.attachShadow({ mode: 'open' })).toBe(root);
    expect(root.delegatesFocus).toBe(true);
    expect(implementation.declarative).toBe(false);
    expect(observer.takeRecords().map((record) => record.removedNodes[0])).toEqual([first, second]);
    expect(() => host.attachShadow({ mode: 'open' })).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
  });

  it('retains explicit registry selection and rejects another document\'s global registry', () => {
    const browser = new Browlet({ route: () => '' });
    const document = browser.window.document;
    const context = getBindingContext(getRelevantRealm(browser.window));
    const foreign = context.project(CustomElementRegistryImpl, new CustomElementRegistryImpl());
    const host = document.createElement('div');
    expect(() => host.attachShadow({ mode: 'open', customElementRegistry: foreign }))
      .toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
    expect(host.shadowRoot).toBeNull();
    const root = host.attachShadow({ mode: 'open', customElementRegistry: null });
    expect(root.customElementRegistry).toBeNull();
  });

  it('allocates an adopted host\'s new root in its current document realm', () => {
    const source = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const host = source.window.document.createElement('div');
    target.window.document.adoptNode(host);
    const root = source.window.Element.prototype.attachShadow.call(host, { mode: 'open' });
    expect(root).toBeInstanceOf(target.window.ShadowRoot);
    expect(root).not.toBeInstanceOf(source.window.ShadowRoot);
    expect(root.host).toBe(host);
    expect(root.ownerDocument).toBe(target.window.document);
    expect(unwrap<ShadowRootImpl>(root).env).toBe(getRelevantRealm(target.window).env);
  });

  it('keeps light-tree queries, shadow queries, and event retargeting separate', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const child = document.createElement('span');
      child.setAttribute('id', 'inside');
      root.append(child);
      document.body.append(host);
      const log: boolean[] = [];
      root.addEventListener('test', (event) => log.push(event.target === child));
      host.addEventListener('test', (event) => log.push(event.target === host));
      child.dispatchEvent(new Event('test', { bubbles: true }));
      child.dispatchEvent(new Event('test', { bubbles: true, composed: true }));
      return [host.querySelector('span'), document.getElementById('inside'), root.querySelector('span') === child,
        root.getElementById('inside') === child, log];
    })).toEqual([null, null, true, true, [true, true, true]]);
  });
});
