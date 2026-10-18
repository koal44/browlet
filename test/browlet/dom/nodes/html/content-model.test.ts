import { assert, describe, expect, it } from 'vitest';

import {
  ContentCategory, isValidHTMLText, textContent,
} from '../../../../../src/browlet/dom/nodes/html/content-model';
import { HTMLElementImpl } from '../../../../../src/browlet/dom/nodes/html/html-element';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../../src/infra/index';
import { createTestDocument } from '../../../../support/dom';

describe('HTML content-model descriptions', () => {
  it('keeps the two HTMLQuoteElement implementations distinct and shares each model between instances', () => {
    const document = createTestDocument();
    const quote = document.createElementNS(HTML_NAMESPACE, 'q');
    const anotherQuote = document.createElementNS(HTML_NAMESPACE, 'q');
    const blockquote = document.createElementNS(HTML_NAMESPACE, 'blockquote');
    assert(quote instanceof HTMLElementImpl);
    assert(anotherQuote instanceof HTMLElementImpl);
    assert(blockquote instanceof HTMLElementImpl);

    const phrasing = quote.getContentModel();
    const flow = blockquote.getContentModel();
    expect(anotherQuote.getContentModel()).toBe(phrasing);
    expect(Object.hasOwn(quote, 'contentModel')).toBe(false);
    expect(Object.hasOwn(anotherQuote, 'contentModel')).toBe(false);
    expect(flow).not.toBe(phrasing);
    const [phrasingRule] = phrasing.children;
    const [flowRule] = flow.children;
    assert(phrasingRule?.kind === 'repeat');
    assert(flowRule?.kind === 'repeat');
    assert(phrasingRule.rule.kind === 'category');
    assert(flowRule.rule.kind === 'category');
    expect(phrasingRule.rule.category).toBe(ContentCategory.Phrasing);
    expect(flowRule.rule.category).toBe(ContentCategory.Flow);
  });

  it('distinguishes an unfinished model from a specified empty model without restricting DOM insertion', () => {
    const document = createTestDocument();
    const input = document.createElementNS(HTML_NAMESPACE, 'input');
    const unfinished = document.createElementNS(HTML_NAMESPACE, 'article');
    assert(input instanceof HTMLElementImpl);
    assert(unfinished instanceof HTMLElementImpl);
    expect(input.getContentModel().children[0]?.kind).toBe('empty');
    expect(() => unfinished.getContentModel()).toThrow('Content model for article is not implemented');

    const child = document.createElementNS(HTML_NAMESPACE, 'q');
    input.appendChild(child);
    expect(child.parentNode).toBe(input);
    expect(input.getContentModel().children[0]?.kind).toBe('empty');
  });
});

describe('HTML nothing content model', () => {
  it.each<[string, boolean]>([
    ['', true],
    [' \t\n\f\r', true],
    [' \n \t ', true],
    ['text', false],
    [' \ntext\t', false],
    ['\u00a0', false],
    ['\v', false],
    ['\u2003', false],
    ['\ufeff', false],
  ])('classifies text %j as nothing: %s', (data, expected) => {
    const document = createTestDocument();
    const input = document.createElementNS(HTML_NAMESPACE, 'input');
    assert(input instanceof HTMLElementImpl);
    const text = document.createTextNode(data);
    input.appendChild(text);

    expect(text.isInterElementWhitespace()).toBe(expected);
    expect(text.isIgnoredHTMLContent()).toBe(expected);
    expect(input.matchesNothingContentModel()).toBe(expected);
    expect(text.data).toBe(data);
    expect(input.firstChild).toBe(text);
  });

  it('ignores comments and processing instructions without removing them from the DOM', () => {
    const document = createTestDocument();
    const input = document.createElementNS(HTML_NAMESPACE, 'input');
    assert(input instanceof HTMLElementImpl);
    const comment = document.createComment('not whitespace');
    const instruction = document.createProcessingInstruction('example', 'also not whitespace');
    input.appendChild(comment);
    input.appendChild(instruction);

    expect(comment.isIgnoredHTMLContent()).toBe(true);
    expect(instruction.isIgnoredHTMLContent()).toBe(true);
    expect(input.matchesNothingContentModel()).toBe(true);
    expect(input.childNodes.length).toBe(2);
    expect(input.firstChild).toBe(comment);
    expect(comment.nextSibling).toBe(instruction);
  });

  it('reads current Text and CDATA data after mutations', () => {
    const document = createTestDocument();
    const input = document.createElementNS(HTML_NAMESPACE, 'input');
    assert(input instanceof HTMLElementImpl);
    const text = document.createTextNode('');
    const cdata = document.createCDATASection(' \n');
    input.appendChild(text);
    input.appendChild(cdata);
    expect(input.matchesNothingContentModel()).toBe(true);

    for (const child of [text, cdata]) {
      expect(child.isIgnoredHTMLContent()).toBe(true);
      child.data = '\u00a0';
      expect(child.isIgnoredHTMLContent()).toBe(false);
      expect(input.matchesNothingContentModel()).toBe(false);
      child.data = '\t';
      expect(child.isIgnoredHTMLContent()).toBe(true);
      expect(input.matchesNothingContentModel()).toBe(true);
    }
  });

  it('counts HTML and foreign element children independently of voidness or the declared model', () => {
    const document = createTestDocument();
    for (const localName of ['input', 'p']) {
      const parent = document.createElementNS(HTML_NAMESPACE, localName);
      assert(parent instanceof HTMLElementImpl);
      expect(parent.parentNode).toBeNull();
      expect(parent.matchesNothingContentModel()).toBe(true);

      for (const namespace of [HTML_NAMESPACE, SVG_NAMESPACE]) {
        const child = document.createElementNS(namespace, 'a');
        parent.appendChild(child);
        expect(child.isIgnoredHTMLContent()).toBe(false);
        expect(parent.matchesNothingContentModel()).toBe(false);
        parent.removeChild(child);
        expect(parent.matchesNothingContentModel()).toBe(true);
      }
    }
  });
});


describe('HTML text content', () => {
  it('describes and checks text-only contents without enforcing character validity during DOM mutation', () => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, 'title');
    assert(element instanceof HTMLElementImpl);
    expect(textContent).toEqual({ kind: 'text' });
    expect(element.matchesTextContentModel()).toBe(true);
    element.appendChild(document.createComment('comment'));
    element.appendChild(document.createProcessingInstruction('test', 'data'));
    const text = document.createTextNode('\u0000\ud800');
    element.appendChild(text);
    expect(element.matchesTextContentModel()).toBe(true);
    expect(isValidHTMLText(text.data)).toBe(false);
    expect(text.data).toBe('\u0000\ud800');
    const child = document.createElementNS(HTML_NAMESPACE, 'span');
    element.appendChild(child);
    expect(element.matchesTextContentModel()).toBe(false);
    element.removeChild(child);
    element.appendChild(document.createCDATASection('CDATA'));
    expect(element.matchesTextContentModel()).toBe(true);
  });

  it.each<[string, boolean]>([
    ['', true], ['normal text', true], [' \t\n\f\r', true], ['\u00a0', true], ['\u{1f600}', true],
    ['\u0000', false], ['\u000b', false], ['\u001f', false], ['\u007f', false], ['\u0085', false],
    ['\u009f', false], ['\ud800', false], ['\udfff', false], ['\ufdd0', false], ['\ufdef', false],
    ['\ufffe', false], ['\uffff', false], ['\u{1fffe}', false], ['\u{10ffff}', false],
    ['\u{10fffd}', true], ['\ufdcf', true], ['\ufdf0', true],
  ])('checks authored characters %j: %s', (text, expected) => {
    expect(isValidHTMLText(text)).toBe(expected);
  });
});
