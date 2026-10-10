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

describe('DOM insertion and adoption', () => {
  it('creates Text and Comment with the current document before either is inserted', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const other = new Document();
      return [
        new Text('text').ownerDocument === document,
        new Comment('comment').ownerDocument === document,
        other.createTextNode('text').ownerDocument === other,
        other.createComment('comment').ownerDocument === other,
      ];
    })).toEqual([true, true, true, true]);
  });

  it.each(['appendChild', 'insertBefore'] as const)('%s splices a fragment and returns the emptied fragment', async (method) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((method) => {
      const parent = document.createElement('parent');
      const before = document.createComment('before');
      const after = document.createComment('after');
      parent.appendChild(before);
      if (method === 'insertBefore') parent.appendChild(after);
      const fragment = new DocumentFragment();
      const first = document.createElement('first');
      const last = document.createTextNode('last');
      fragment.appendChild(first);
      fragment.appendChild(last);
      const result = parent[method](fragment, method === 'insertBefore' ? after : null);
      return [
        result === fragment,
        fragment.parentNode === null && fragment.firstChild === null && fragment.lastChild === null,
        parent.firstChild === before && before.nextSibling === first,
        first.parentNode === parent && first.previousSibling === before && first.nextSibling === last,
        last.parentNode === parent && last.previousSibling === first,
        method === 'insertBefore' ? last.nextSibling === after && after.previousSibling === last :
          last.nextSibling === null && parent.lastChild === last,
      ];
    }, method)).toEqual([true, true, true, true, true, true]);
  });

  it('leaves an empty fragment in its original document without changing the destination', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const parent = target.createElement('parent');
      const child = target.createComment('child');
      parent.appendChild(child);
      const fragment = new DocumentFragment();
      return [
        parent.insertBefore(fragment, child) === fragment,
        parent.firstChild === child && parent.lastChild === child,
        fragment.parentNode === null && fragment.firstChild === null,
        fragment.ownerDocument === document,
      ];
    })).toEqual([true, true, true, true]);
  });

  it('inserts a valid fragment into a Document while adopting only its children', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const fragment = new DocumentFragment();
      const comment = document.createComment('before');
      const root = document.createElement('root');
      fragment.appendChild(comment);
      fragment.appendChild(root);
      target.appendChild(fragment);
      return [
        target.firstChild === comment && target.lastChild === root,
        root.previousSibling === comment && comment.nextSibling === root,
        comment.ownerDocument === target && root.ownerDocument === target,
        comment.isConnected && root.isConnected,
        fragment.ownerDocument === document && fragment.firstChild === null,
      ];
    })).toEqual([true, true, true, true, true]);
  });

  it('reinserts before itself and adjacent siblings without losing tree links', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const first = document.createElement('first');
      const last = document.createElement('last');
      parent.appendChild(first);
      parent.appendChild(last);
      parent.insertBefore(first, first);
      parent.insertBefore(first, last);
      parent.appendChild(last);
      const unchanged = parent.firstChild === first && first.nextSibling === last &&
        last.previousSibling === first && parent.lastChild === last;
      parent.insertBefore(last, first);
      return [
        unchanged,
        parent.firstChild === last && last.previousSibling === null,
        last.nextSibling === first && first.previousSibling === last,
        parent.lastChild === first && first.nextSibling === null,
      ];
    })).toEqual([true, true, true, true]);
  });

  it('retains the destination document on detached adopted descendants and their attributes', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const parent = target.createElement('parent');
      const root = document.createElement('root');
      const child = document.createElement('child');
      const text = document.createTextNode('text');
      child.setAttribute('name', 'value');
      const attribute = child.attributes.getNamedItem('name')!;
      root.appendChild(child);
      child.appendChild(text);
      parent.appendChild(root);
      root.remove();
      return [
        root.parentNode === null,
        root.ownerDocument === target,
        child.ownerDocument === target,
        text.ownerDocument === target,
        attribute.ownerDocument === target && attribute.ownerElement === child,
      ];
    })).toEqual([true, true, true, true, true]);
  });

  it('adoptNode returns the same detached subtree, including fragment and attribute ownership', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const target = new Document();
      const fragment = new DocumentFragment();
      const child = document.createElement('child');
      child.setAttribute('name', 'value');
      const attribute = child.attributes.getNamedItem('name')!;
      fragment.appendChild(child);
      const prototype: unknown = Object.getPrototypeOf(child);
      const result = target.adoptNode(fragment);
      return [
        result === fragment && fragment.parentNode === null,
        fragment.firstChild === child && child.parentNode === fragment,
        fragment.ownerDocument === target && child.ownerDocument === target,
        attribute.ownerDocument === target && attribute.ownerElement === child,
        Object.getPrototypeOf(child) === prototype,
      ];
    })).toEqual([true, true, true, true, true]);
  });

  it('adoptNode detaches even within the same document and rejects Documents', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const child = document.createElement('child');
      parent.appendChild(child);
      const adopted = document.adoptNode(child);
      let error: unknown;
      try { document.adoptNode(document); } catch (caught) { error = caught; }
      return [
        adopted === child && child.parentNode === null && parent.firstChild === null,
        child.ownerDocument === document,
        error instanceof DOMException && error.name,
      ];
    })).toEqual([true, true, 'NotSupportedError']);
  });

  it('adopts an associated shadow tree but rejects adopting the shadow root itself', () => {
    // attachShadow() is not projected yet; exercise the existing implementation objects.
    const source = createTestDocument();
    const target = createTestDocument();
    const host = source.createElement('host');
    const shadow = new ShadowRootImpl(host, 'closed', source.env);
    host.shadowRoot = shadow;
    const child = source.createElement('child');
    shadow.appendChild(child);

    expect(() => target.adoptNode(shadow)).toThrow(expect.objectContaining({ name: 'HierarchyRequestError' }));
    expect(shadow.nodeDocument).toBe(source);
    expect(target.adoptNode(host)).toBe(host);
    expect(shadow.nodeDocument).toBe(target);
    expect(child.nodeDocument).toBe(target);
    expect(shadow.host).toBe(host);
    expect(child.parentNode).toBe(shadow);
  });
});

describe('DOM removal', () => {
  it('removeChild returns the child and preserves the remaining sibling links', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const first = document.createComment('first');
      const middle = document.createElement('middle');
      const last = document.createTextNode('last');
      parent.appendChild(first);
      parent.appendChild(middle);
      parent.appendChild(last);
      const removed = parent.removeChild(middle);
      return [
        removed === middle && middle.parentNode === null,
        middle.previousSibling === null && middle.nextSibling === null,
        parent.firstChild === first && parent.lastChild === last,
        first.nextSibling === last && last.previousSibling === first,
        middle.ownerDocument === document,
      ];
    })).toEqual([true, true, true, true, true]);
  });

  it('rejects removing a foreign child without detaching it', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const other = document.createElement('other');
      const child = document.createElement('child');
      other.appendChild(child);
      let error: unknown;
      try { parent.removeChild(child); } catch (caught) { error = caught; }
      return [
        error instanceof DOMException && error.name,
        child.parentNode === other && other.firstChild === child,
        parent.firstChild === null,
      ];
    })).toEqual(['NotFoundError', true, true]);
  });

  it('ChildNode.remove permits repeated removal and retains document ownership', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const parent = document.createElement('parent');
      const text = document.createTextNode('text');
      parent.appendChild(text);
      text.remove();
      text.remove();
      return [parent.firstChild === null, text.parentNode === null, text.ownerDocument === document];
    })).toEqual([true, true, true]);
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
