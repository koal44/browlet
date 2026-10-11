import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe.each(['createNodeIterator', 'createTreeWalker'] as const)('%s filtering contract', (factory) => {
  it('handles every supported node mask and keeps attributes outside the child tree', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((factory) => {
      const xml = document.implementation.createDocument(null, 'root');
      const doctype = xml.implementation.createDocumentType('root', '', '');
      xml.insertBefore(doctype, xml.documentElement);
      const nodes: Node[] = [xml, doctype, xml.documentElement, xml.createTextNode('text'),
        xml.createCDATASection('cdata'), xml.createProcessingInstruction('target', 'data'), xml.createComment('comment')];
      for (const node of nodes.slice(3)) xml.documentElement.appendChild(node);
      const results = nodes.map((expected) => {
        const calls: Node[] = [];
        const traversal = xml[factory](xml, 1 << (expected.nodeType - 1), (node) => {
          calls.push(node);
          return NodeFilter.FILTER_ACCEPT;
        });
        const rootIsCurrent = factory === 'createTreeWalker' && expected === xml;
        return [traversal.nextNode() === (rootIsCurrent ? null : expected), traversal.nextNode() === null,
          calls.length === (rootIsCurrent ? 0 : 1)];
      });
      const attr = xml.createAttribute('attr');
      xml.documentElement.setAttributeNode(attr);
      const fragment = xml.createDocumentFragment();
      const roots = [attr, fragment].map((root) => {
        const traversal = xml[factory](root);
        return [traversal.root === root, traversal.nextNode() === (factory === 'createNodeIterator' ? root : null),
          traversal.nextNode() === null];
      });
      return [results, roots, xml[factory](xml, NodeFilter.SHOW_ATTRIBUTE).nextNode()];
    }, factory)).toEqual([Array.from({ length: 7 }, () => [true, true, true]),
      [[true, true, true], [true, true, true]], null]);
  });

  it('converts whatToShow and callback results using the declared unsigned types', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((factory) => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      const masks = [-1, 0x100000001, NaN].map((mask) => document[factory](root, mask).whatToShow);
      const filter = () => 0x10001;
      const traversal = document[factory](root, -1, filter);
      return [masks, traversal.filter === filter,
        traversal.nextNode() === (factory === 'createNodeIterator' ? root : child)];
    }, factory)).toEqual([[0xffffffff, 1, 0], true, true]);
  });

  it('releases the active flag when callback result conversion throws', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((factory) => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      const failure = new Error('conversion failure');
      const filter = { acceptNode() { return { valueOf() { throw failure; } }; } };
      const traversal = document[factory](root, NodeFilter.SHOW_ALL, filter as unknown as NodeFilter);
      let error: unknown;
      try { traversal.nextNode(); } catch (caught) { error = caught; }
      Reflect.set(filter, 'acceptNode', () => NodeFilter.FILTER_ACCEPT);
      return [error === failure, traversal.nextNode() === (factory === 'createNodeIterator' ? root : child)];
    }, factory)).toEqual([true, true]);
  });

  it('keeps filtering active during return-value conversion', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((factory) => {
      const root = document.createElement('root');
      const child = root.appendChild(document.createElement('child'));
      let error: unknown;
      const filter = {
        acceptNode() {
          return {
            valueOf() {
              try { traversal.nextNode(); } catch (caught) { error = caught; }
              return NodeFilter.FILTER_ACCEPT;
            },
          };
        },
      };
      const traversal = document[factory](root, NodeFilter.SHOW_ALL, filter as unknown as NodeFilter);
      return [traversal.nextNode() === (factory === 'createNodeIterator' ? root : child),
        error instanceof DOMException && error.name];
    }, factory)).toEqual([true, 'InvalidStateError']);
  });

  it('defers object-filter operation validation until an eligible node is visited', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((factory) => {
      const root = document.createElement('root');
      root.appendChild(document.createElement('child'));
      const filter = {} as NodeFilter;
      const hidden = document[factory](root, 0, filter);
      const visible = document[factory](root, NodeFilter.SHOW_ALL, filter);
      let error: unknown;
      try { visible.nextNode(); } catch (caught) { error = caught; }
      return [hidden.filter === filter, hidden.nextNode(), error instanceof TypeError];
    }, factory)).toEqual([true, null, true]);
  });

  it('uses the receiver document\'s realm while preserving foreign root identity', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const root = first.window.document.createElement('root');
    const child = root.appendChild(first.window.document.createElement('child'));
    const traversal = factory === 'createNodeIterator'
      ? first.window.document.createNodeIterator.call(second.window.document, root)
      : first.window.document.createTreeWalker.call(second.window.document, root);
    const name = factory === 'createNodeIterator' ? 'NodeIterator' : 'TreeWalker';
    expect(traversal).toBeInstanceOf(second.window[name]);
    expect(traversal).not.toBeInstanceOf(first.window[name]);
    expect(traversal.root).toBe(root);
    expect(traversal.nextNode()).toBe(factory === 'createNodeIterator' ? root : child);
  });
});

describe('traversal bindings', () => {
  it('rejects invalid roots and current nodes, and exposes read-only configuration', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const root = document.createElement('root');
      const errors: boolean[] = [];
      for (const factory of ['createNodeIterator', 'createTreeWalker'] as const) {
        for (const value of [null, undefined, {}]) {
          try { Reflect.apply(document[factory], document, [value]); errors.push(false); }
          catch (error) { errors.push(error instanceof TypeError); }
        }
      }
      const walker = document.createTreeWalker(root);
      for (const value of [null, undefined, {}]) {
        try { Reflect.set(walker, 'currentNode', value); errors.push(false); }
        catch (error) { errors.push(error instanceof TypeError); }
      }
      const readOnly = [document.createNodeIterator(root), walker].map((traversal) =>
        ['root', 'whatToShow', 'filter'].map((key) => Reflect.set(traversal, key, null)));
      return [errors, walker.currentNode === root, readOnly];
    })).toEqual([Array(9).fill(true), true, [[false, false, false], [false, false, false]]]);
  });
});
