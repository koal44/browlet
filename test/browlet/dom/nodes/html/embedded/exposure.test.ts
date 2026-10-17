import { describe, expect, it, vi } from 'vitest';

import type { DocumentImpl } from '../../../../../../src/browlet/dom/nodes/document';
import { NodeImpl } from '../../../../../../src/browlet/dom/nodes/node';
import { HTMLEmbedElementImpl } from '../../../../../../src/browlet/dom/nodes/html/embedded/embed';
import { HTMLObjectElementImpl } from '../../../../../../src/browlet/dom/nodes/html/embedded/object';
import { createTestDocument } from '../../../../../support/dom';

describe('object and embed exposure', () => {
  it('bounds ancestor traversal by tree depth for nested objects', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const depth = 16;
    let object = createObject(document);
    document.body!.appendChild(object);
    for (let index = 1; index < depth; index++) {
      const child = createObject(document);
      object.appendChild(child);
      object = child;
    }

    const parentReads = vi.spyOn(NodeImpl.prototype, 'parentElement', 'get');
    try {
      expect(object.isExposed()).toBe(false);
      // Allow a small linear budget; recursively rechecking ancestors grows exponentially.
      expect(parentReads.mock.calls.length).toBeLessThanOrEqual(depth * 2);
    } finally {
      parentReads.mockRestore();
    }
  });

  it('finds an exposed ancestor through objects showing fallback content', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const outer = createObject(document);
    const middle = createObject(document);
    const inner = createObject(document);
    const embed = document.createElement('embed');
    if (!(embed instanceof HTMLEmbedElementImpl)) throw new Error('Expected an embed implementation');
    document.body!.appendChild(outer);
    outer.appendChild(middle);
    middle.appendChild(inner);
    inner.appendChild(embed);
    middle.showsFallbackContent = true;
    inner.showsFallbackContent = true;

    expect([outer.isExposed(), middle.isExposed(), inner.isExposed(), embed.isExposed()])
      .toEqual([true, false, false, false]);
    outer.showsFallbackContent = true;
    expect([outer.isExposed(), middle.isExposed(), inner.isExposed(), embed.isExposed()])
      .toEqual([false, false, false, true]);
    middle.showsFallbackContent = false;
    expect([outer.isExposed(), middle.isExposed(), inner.isExposed(), embed.isExposed()])
      .toEqual([false, true, false, false]);
  });

  it('ignores foreign object and embed names when checking fallback descendants', () => {
    const document = createTestDocument().implementation.createHTMLDocument();
    const object = createObject(document);
    object.showsFallbackContent = true;
    document.body!.appendChild(object);
    const foreignObject = document.createElementNS('urn:other', 'object');
    const foreignEmbed = document.createElementNS('urn:other', 'embed');
    foreignObject.appendChild(foreignEmbed);
    object.appendChild(foreignObject);
    expect(object.isExposed()).toBe(true);

    const embed = document.createElement('embed');
    foreignEmbed.appendChild(embed);
    expect(object.isExposed()).toBe(false);
    embed.remove();
    expect(object.isExposed()).toBe(true);
    foreignEmbed.appendChild(createObject(document));
    expect(object.isExposed()).toBe(false);
  });
});

function createObject(document: DocumentImpl): HTMLObjectElementImpl {
  const element = document.createElement('object');
  if (!(element instanceof HTMLObjectElementImpl)) throw new Error('Expected an object implementation');
  return element;
}
