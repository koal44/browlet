import { assert, describe, expect, it } from 'vitest';

import { HTMLElementImpl } from '../../../../../src/browlet/dom/nodes/html/html-element';
import { SanitizationCategory } from '../../../../../src/browlet/dom/nodes/html/sanitization';
import { HTML_NAMESPACE } from '../../../../../src/infra/index';
import { createTestDocument } from '../../../../support/dom';

describe('HTML element sanitization definitions', () => {
  it.each(['article', 'a', 'script', 'form'])('shares the %s definition between instances', (name) => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, name);
    const other = document.createElementNS(HTML_NAMESPACE, name);
    assert(element instanceof HTMLElementImpl);
    assert(other instanceof HTMLElementImpl);
    expect(element.sanitization).toBeDefined();
    expect(other.sanitization).toBe(element.sanitization);
    expect(Object.hasOwn(element, 'sanitization')).toBe(false);
    expect(Object.hasOwn(other, 'sanitization')).toBe(false);
  });

  // https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
  it('keeps default sanitizer attributes separate from content-attribute permissions', () => {
    const anchor = createTestDocument().createElementNS(HTML_NAMESPACE, 'a');
    assert(anchor instanceof HTMLElementImpl);
    assert(anchor.sanitization);
    const definition = anchor.sanitization;
    expect(definition.category).toBe(SanitizationCategory.Default);
    expect(definition.defaultAttributes).toEqual(['href', 'hreflang', 'type']);
    expect(definition.navigatingURLAttributes).toEqual(['href']);

    anchor.setAttribute('href', '/destination');
    anchor.setAttribute('target', '_blank');
    expect(anchor.allowsContentAttribute('target')).toBe(true);
    expect(definition.defaultAttributes).not.toContain('target');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.sanitization).toBe(definition);
  });

  // https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#sanitization-category
  it('distinguishes each specified category from an unfinished definition', () => {
    const document = createTestDocument();
    const article = document.createElementNS(HTML_NAMESPACE, 'article');
    const script = document.createElementNS(HTML_NAMESPACE, 'script');
    const form = document.createElementNS(HTML_NAMESPACE, 'form');
    const unfinished = document.createElementNS(HTML_NAMESPACE, 'div');
    assert(article instanceof HTMLElementImpl);
    assert(script instanceof HTMLElementImpl);
    assert(form instanceof HTMLElementImpl);
    assert(unfinished instanceof HTMLElementImpl);

    expect(article.sanitization?.category).toBe(SanitizationCategory.Default);
    expect(article.sanitization?.defaultAttributes).toBeUndefined();
    expect(article.sanitization?.navigatingURLAttributes).toBeUndefined();
    expect(script.sanitization?.category).toBe(SanitizationCategory.Unsafe);
    expect(form.sanitization?.category).toBe(SanitizationCategory.Uncategorized);
    expect(form.sanitization?.navigatingURLAttributes).toEqual(['action']);
    expect(unfinished.sanitization).toBeUndefined();
  });
});
