import { describe, expect, it } from 'vitest';
import { createTestDocument } from '../../../support/dom';
import { Browlet } from '../../../../src/browlet/browlet';
import { type NodeImpl, type InsertionParent } from '../../../../src/browlet/dom/nodes/node';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('Node tree order', () => {
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
