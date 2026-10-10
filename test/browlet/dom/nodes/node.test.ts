import { describe, expect, it } from 'vitest';
import { createTestDocument } from '../../../support/dom';
import { Browlet } from '../../../../src/browlet/browlet';
import { type NodeImpl, type InsertionParent } from '../../../../src/browlet/dom/nodes/node';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('Node tree links', () => {
  it('starts detached', () => {
    const document = createTestDocument();
    const node = document.createElement('node');

    expect(node.parentNode).toBeNull();
    expect(node.firstChild).toBeNull();
    expect(node.lastChild).toBeNull();
    expect(node.previousSibling).toBeNull();
    expect(node.nextSibling).toBeNull();
  });

  it('inserts children before a reference or at the end', () => {
    const document = createTestDocument();
    const parent = document.createElement('parent');
    const first = document.createElement('first');
    const middle = document.createElement('middle');
    const last = document.createElement('last');

    parent.appendChild(first);
    parent.appendChild(last);
    parent.insertBefore(middle, last);

    expect(parent.firstChild).toBe(first);
    expect(parent.lastChild).toBe(last);
    expect(first.parentNode).toBe(parent);
    expect(first.previousSibling).toBeNull();
    expect(first.nextSibling).toBe(middle);
    expect(middle.parentNode).toBe(parent);
    expect(middle.previousSibling).toBe(first);
    expect(middle.nextSibling).toBe(last);
    expect(last.parentNode).toBe(parent);
    expect(last.previousSibling).toBe(middle);
    expect(last.nextSibling).toBeNull();
  });

  it('moves and removes an existing node', () => {
    const document = createTestDocument();
    const firstParent = document.createElement('first-parent');
    const secondParent = document.createElement('second-parent');
    const before = document.createElement('before');
    const moved = document.createElement('moved');

    firstParent.appendChild(moved);
    secondParent.appendChild(before);
    moved.remove();
    secondParent.insertBefore(moved, before);

    expect(firstParent.firstChild).toBeNull();
    expect(firstParent.lastChild).toBeNull();
    expect(secondParent.firstChild).toBe(moved);
    expect(moved.parentNode).toBe(secondParent);
    expect(moved.nextSibling).toBe(before);
    expect(before.previousSibling).toBe(moved);

    before.remove();
    secondParent.insertBefore(before, moved);

    expect(secondParent.firstChild).toBe(before);
    expect(secondParent.lastChild).toBe(moved);
    expect(before.previousSibling).toBeNull();
    expect(before.nextSibling).toBe(moved);
    expect(moved.previousSibling).toBe(before);
    expect(moved.nextSibling).toBeNull();

    moved.remove();

    expect(moved.parentNode).toBeNull();
    expect(moved.previousSibling).toBeNull();
    expect(moved.nextSibling).toBeNull();
    expect(secondParent.firstChild).toBe(before);
    expect(before.previousSibling).toBeNull();
  });

  it('rejects a foreign reference child without changing either tree', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const child = document.createElement('child');
    const other = document.createElement('other');
    root.appendChild(child);

    let failure: unknown;
    try { other.insertBefore(child, child); } catch (error) { failure = error; }

    expect(failure).toMatchObject({ name: 'NotFoundError' });
    expect(child.parentNode).toBe(root);
    expect(root.firstChild).toBe(child);
    expect(root.lastChild).toBe(child);
    expect(other.firstChild).toBeNull();
    expect(other.lastChild).toBeNull();
  });
});

describe('Node tree order', () => {
  it('finds roots and tests inclusive containment', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const parent = document.createElement('parent');
    const child = document.createElement('child');
    const other = document.createElement('other');

    root.appendChild(parent);
    parent.appendChild(child);

    expect(root.getRoot()).toBe(root);
    expect(child.getRoot()).toBe(root);
    expect(root.hasChildren()).toBe(true);
    expect(child.hasChildren()).toBe(false);
    expect(root.contains(root)).toBe(true);
    expect(root.contains(child)).toBe(true);
    expect(child.contains(root)).toBe(false);
    expect(root.contains(other)).toBe(false);
    expect(root.contains(null)).toBe(false);
  });

  it('compares connected nodes in tree order', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const first = document.createElement('first');
    const descendant = document.createElement('descendant');
    const last = document.createElement('last');

    root.appendChild(first);
    root.appendChild(last);
    first.appendChild(descendant);

    expect(first.comparePosition(first)).toBe(0);
    expect(first.comparePosition(last)).toBe(-1);
    expect(last.comparePosition(first)).toBe(1);
    expect(root.comparePosition(descendant)).toBe(-1);
    expect(descendant.comparePosition(root)).toBe(1);
  });

  it('returns null for disconnected nodes', () => {
    const document = createTestDocument();
    const first = document.createElement('first');
    const second = document.createElement('second');

    expect(first.comparePosition(second)).toBeNull();
    expect(second.comparePosition(first)).toBeNull();
  });

  it('walks descendants without leaving the selected subtree', () => {
    const document = createTestDocument();
    const parent = document.createElement('parent');
    const root = document.createElement('root');
    const first = document.createElement('first');
    const nested = document.createTextNode('nested');
    const last = document.createComment('last');
    parent.appendChild(root);
    parent.appendChild(document.createElement('outside'));
    root.appendChild(first);
    first.appendChild(nested);
    root.appendChild(last);

    expect(collectDescendants(root, false)).toEqual([root, first, nested, last]);
    expect(collectDescendants(first, false)).toEqual([first, nested]);
    expect(last.nextDescendant(last)).toBeNull();
  });

  it('visits nested shadow trees before light children and respects a shadow-root boundary', () => {
    const document = createTestDocument();
    const host = document.createElement('host');
    const lightChild = document.createTextNode('light');
    host.appendChild(lightChild);
    const shadow = new ShadowRootImpl(host, 'closed', document.env);
    const nestedHost = document.createElement('nested-host');
    const shadowLast = document.createComment('shadow last');
    shadow.appendChild(nestedHost);
    shadow.appendChild(shadowLast);
    const nestedLight = document.createTextNode('nested light');
    nestedHost.appendChild(nestedLight);
    const nestedShadow = new ShadowRootImpl(nestedHost, 'open', document.env);
    const nestedShadowChild = document.createTextNode('nested shadow');
    nestedShadow.appendChild(nestedShadowChild);
    // attachShadow is a later slice; these are the implementation associations it establishes.
    host.shadowRoot = shadow;
    nestedHost.shadowRoot = nestedShadow;

    expect(collectDescendants(host, false)).toEqual([host, lightChild]);
    expect(collectDescendants(host, true)).toEqual([
      host, shadow, nestedHost, nestedShadow, nestedShadowChild, nestedLight, shadowLast, lightChild,
    ]);
    expect(collectDescendants(shadow, true)).toEqual([
      shadow, nestedHost, nestedShadow, nestedShadowChild, nestedLight, shadowLast,
    ]);
    expect(collectDescendants(nestedShadow, true)).toEqual([nestedShadow, nestedShadowChild]);
  });

  it('resumes at light children after an empty shadow tree', () => {
    const document = createTestDocument();
    const host = document.createElement('host');
    const lightChild = document.createTextNode('light');
    host.appendChild(lightChild);
    const shadow = new ShadowRootImpl(host, 'open', document.env);
    host.shadowRoot = shadow;

    expect(collectDescendants(host, true)).toEqual([host, shadow, lightChild]);
    expect(shadow.nextShadowIncludingDescendant(shadow)).toBeNull();
  });
});

describe('Node insertion contract', () => {
  it('retains the allowed parent type after validation without changing either tree', () => {
    const document = createTestDocument();
    const parent: NodeImpl = document.createElement('parent');
    const child = document.createTextNode('child');

    parent.ensurePreInsertValidity(child, null);
    const validatedParent: InsertionParent = parent;
    expect(validatedParent.children).toHaveLength(0);
    expect(child.parentNode).toBeNull();
  });
});

describe('Node text content', () => {
  // Approved DOM TODO: observed undefined while testing navigation; neither the
  // Node implementation nor its Web IDL declaration provides textContent yet.
  it.todo('reads descendant text through the projected Node.textContent attribute', async () => {
    const browlet = new Browlet({ route: () => '<p>Local page</p>' });

    await browlet.navigate('https://example.test/');

    expect(Reflect.get(browlet.document.body!, 'textContent')).toBe('Local page');
  });
});

function collectDescendants(root: NodeImpl, shadowIncluding: boolean): NodeImpl[] {
  const result: NodeImpl[] = [];
  for (let node: NodeImpl | null = root; node;
    node = shadowIncluding ? node.nextShadowIncludingDescendant(root) : node.nextDescendant(root)) {
    result.push(node);
  }
  return result;
}
