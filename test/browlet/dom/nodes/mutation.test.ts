import { describe, expect, it } from 'vitest';
import { createTestDocument } from '../../../support/dom';
import { Browlet } from '../../../../src/browlet/browlet';
import { DocumentFragmentImpl } from '../../../../src/browlet/dom/nodes/document-fragment';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('DOM insertion validity', () => {
  it('accepts ordered document children and ordinary element children', async () => {
    const browlet = new Browlet({ route: () => '<!doctype html>' });
    await browlet.navigate('https://example.test/');

    expect(await browlet.evaluate(() => {
      const target = new Document();
      const before = target.createComment('before');
      const after = target.createComment('after');
      const root = target.createElement('root');
      const text = target.createTextNode('text');
      const fragment = new DocumentFragment();
      const detached = document.createElement('detached');
      target.appendChild(before);
      target.appendChild(document.doctype!);
      target.appendChild(after);
      target.insertBefore(root, after);
      root.appendChild(text);
      fragment.appendChild(detached);
      return [
        target.firstChild === before,
        before.nextSibling === target.doctype,
        target.doctype!.nextSibling === root,
        root.nextSibling === after,
        target.lastChild === after,
        text.parentNode === root,
        detached.parentNode === fragment,
      ];
    })).toEqual([true, true, true, true, true, true, true]);
  });

  describe.each(['appendChild', 'insertBefore'] as const)('%s', (method) => {
    it.each(['text', 'comment', 'attribute'] as const)('rejects a parent of kind %s without detaching the child', async (kind) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate(({ method, kind }) => {
        const source = document.createElement('source');
        const child = document.createElement('child');
        source.appendChild(child);
        const parent = kind === 'text' ? document.createTextNode('text') :
          kind === 'comment' ? document.createComment('comment') : document.createAttribute('name');
        let error: unknown;
        try { parent[method](child, null); } catch (caught) { error = caught; }
        return [
          error instanceof DOMException && error.name,
          child.parentNode === source,
          source.firstChild === child,
          parent.firstChild === null,
        ];
      }, { method, kind })).toEqual(['HierarchyRequestError', true, true, true]);
    });

    it.each(['document', 'attribute'] as const)('rejects inserting a node of kind %s', async (kind) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate(({ method, kind }) => {
        const parent = document.createElement('parent');
        const node = kind === 'document' ? new Document() : document.createAttribute('name');
        let error: unknown;
        try { parent[method](node, null); } catch (caught) { error = caught; }
        return [error instanceof DOMException && error.name, parent.firstChild === null, node.parentNode === null];
      }, { method, kind })).toEqual(['HierarchyRequestError', true, true]);
    });

    it('rejects Text directly in a Document', async () => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate((method) => {
        const target = new Document();
        const text = target.createTextNode('text');
        let error: unknown;
        try { target[method](text, null); } catch (caught) { error = caught; }
        return [error instanceof DOMException && error.name, target.firstChild === null, text.parentNode === null];
      }, method)).toEqual(['HierarchyRequestError', true, true]);
    });

    it('rejects a second document element before removing or adopting it', async () => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate((method) => {
        const target = new Document();
        const source = new Document();
        const existing = target.createElement('existing');
        const candidate = source.createElement('candidate');
        const descendant = source.createElement('descendant');
        target.appendChild(existing);
        source.appendChild(candidate);
        candidate.appendChild(descendant);
        let error: unknown;
        try { target[method](candidate, null); } catch (caught) { error = caught; }
        return [
          error instanceof DOMException && error.name,
          target.firstChild === existing && target.lastChild === existing,
          source.firstChild === candidate && candidate.parentNode === source,
          candidate.ownerDocument === source && descendant.ownerDocument === source,
        ];
      }, method)).toEqual(['HierarchyRequestError', true, true, true]);
    });

    it.each(['two elements', 'text'] as const)('rejects a document fragment containing %s without changing it', async (contents) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate(({ method, contents }) => {
        const target = new Document();
        const fragment = new DocumentFragment();
        const first = document.createElement('first');
        const last = contents === 'text' ? document.createTextNode('text') : document.createElement('last');
        fragment.appendChild(first);
        fragment.appendChild(last);
        let error: unknown;
        try { target[method](fragment, null); } catch (caught) { error = caught; }
        return [
          error instanceof DOMException && error.name,
          target.firstChild === null,
          fragment.parentNode === null,
          fragment.firstChild === first && fragment.lastChild === last,
          first.parentNode === fragment && first.nextSibling === last && last.parentNode === fragment,
        ];
      }, { method, contents })).toEqual(['HierarchyRequestError', true, true, true, true]);
    });

    it.each(['self', 'ancestor'] as const)('rejects a cycle through %s as a DOMException', async (relation) => {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate(({ method, relation }) => {
        const root = document.createElement('root');
        const child = document.createElement('child');
        root.appendChild(child);
        let error: unknown;
        try { (relation === 'self' ? root : child)[method](root, null); }
        catch (caught) { error = caught; }
        return [error instanceof DOMException && error.name, root.parentNode === null, child.parentNode === root];
      }, { method, relation })).toEqual(['HierarchyRequestError', true, true]);
    });
  });

  it('checks parent and ancestor validity before a foreign reference child', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const leaf = document.createTextNode('leaf');
      const root = document.createElement('root');
      const child = document.createElement('child');
      root.appendChild(child);
      const foreign = document.createElement('foreign');
      return [leaf, child].map((parent) => {
        try { parent.insertBefore(root, foreign); }
        catch (error) { return error instanceof DOMException && error.name; }
      });
    })).toEqual(['HierarchyRequestError', 'HierarchyRequestError']);
  });

  it('rejects a foreign reference child before checking the inserted node kind', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const node = document.createAttribute('name');
      const foreign = document.createElement('foreign');
      try { parent.insertBefore(node, foreign); }
      catch (error) { return error instanceof DOMException && error.name; }
    })).toBe('NotFoundError');
  });

  it('keeps an existing document element invalid even when inserted before itself', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const root = target.createElement('root');
      target.appendChild(root);
      let error: unknown;
      try { target.insertBefore(root, root); } catch (caught) { error = caught; }
      return [error instanceof DOMException && error.name, target.firstChild === root, root.parentNode === target];
    })).toEqual(['HierarchyRequestError', true, true]);
  });

  it('creates a borrowed insertion failure in the method realm', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const root = first.document.createElement('root');
    const Node_ = second.window.Node;
    const DOMException_ = second.window.DOMException;
    expect(() => Node_.prototype.appendChild.call(root, root)).toThrow(DOMException_);
  });
});

describe('Document type insertion validity', () => {
  // DOMImplementation.createDocumentType is not projected yet.
  it.each(['element', 'fragment'] as const)('rejects a doctype under a parent of kind %s', (kind) => {
    const document = createTestDocument();
    const source = createTestDocument();
    const doctype = source.createDocumentType('html', '', '');
    source.appendChild(doctype);
    const parent = kind === 'element' ? document.createElement('parent') : document.createDocumentFragment();

    expect(() => parent.appendChild(doctype)).toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(doctype.parentNode).toBe(source);
    expect(parent.firstChild).toBeNull();
  });

  it('rejects a second doctype', () => {
    const document = createTestDocument();
    const first = document.createDocumentType('html', '', '');
    const second = document.createDocumentType('html', '', '');
    document.appendChild(first);

    expect(() => document.appendChild(second)).toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(document.firstChild).toBe(first);
    expect(document.lastChild).toBe(first);
    expect(second.parentNode).toBeNull();
  });

  it.each(['before doctype', 'before preceding comment'] as const)('rejects an element %s', (position) => {
    const document = createTestDocument();
    const comment = document.createComment('before');
    const doctype = document.createDocumentType('html', '', '');
    const element = document.createElement('root');
    document.appendChild(comment);
    document.appendChild(doctype);

    expect(() => document.insertBefore(element, position === 'before doctype' ? doctype : comment))
      .toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(element.parentNode).toBeNull();
    expect(comment.nextSibling).toBe(doctype);
  });

  it.each(['at end', 'before following comment'] as const)('rejects a doctype after the document element %s', (position) => {
    const document = createTestDocument();
    const element = document.createElement('root');
    const comment = document.createComment('after');
    const doctype = document.createDocumentType('html', '', '');
    document.appendChild(element);
    document.appendChild(comment);

    expect(() => document.insertBefore(doctype, position === 'at end' ? null : comment))
      .toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(doctype.parentNode).toBeNull();
    expect(element.nextSibling).toBe(comment);
  });

  it('rejects children under a doctype', () => {
    const document = createTestDocument();
    const doctype = document.createDocumentType('html', '', '');
    const comment = document.createComment('comment');

    expect(() => doctype.appendChild(comment)).toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(comment.parentNode).toBeNull();
    expect(doctype.firstChild).toBeNull();
  });
});

describe('Host-including insertion cycles', () => {
  it.each(['fragment', 'shadow root'] as const)('rejects inserting a host into its %s subtree', (kind) => {
    const document = createTestDocument();
    const host = document.createElement('host');
    const root = kind === 'fragment'
      ? new DocumentFragmentImpl(document, host, document.env)
      : new ShadowRootImpl(host, 'open', document.env);
    const child = document.createElement('child');
    root.appendChild(child);

    expect(() => child.appendChild(host)).toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(host.parentNode).toBeNull();
    expect(child.parentNode).toBe(root);
  });
});
