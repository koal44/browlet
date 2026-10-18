import { assert, describe, expect, expectTypeOf, it } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../../src/infra/index';
import type { DocumentImpl } from '../../../../../src/browlet/dom/nodes/document';
import { getParagraphs } from '../../../../../src/browlet/dom/nodes/element-definitions/paragraphs';
import {
  modelAllowsImplicitParagraphs, resolveContentModelTransparency, flowContent,
} from '../../../../../src/browlet/dom/nodes/element-definitions/content-model';
import { createTestDocument, parseTestDocument } from '../../../../support/dom';

describe('HTML paragraphs', () => {
  it('requires a document and preserves the complete paragraph spanning an anchor', () => {
    expectTypeOf(getParagraphs).parameter(0).toEqualTypeOf<DocumentImpl>();
    const document = parseTestDocument('<section>Before <a>inside</a> after.</section>');
    const section = document.querySelector('section');
    assert(section !== null);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: section.firstChild, last: section.lastChild },
    ]);
  });

  it('handles an empty document and flattens an anchor used as the document element', () => {
    const document = createTestDocument();
    expect(getParagraphs(document)).toEqual([]);
    const anchor = document.createElementNS(HTML_NAMESPACE, 'a');
    const paragraph = document.createElementNS(HTML_NAMESPACE, 'p');
    anchor.appendChild(document.createTextNode('No containing element in the paragraph view.'));
    anchor.appendChild(paragraph);
    document.appendChild(anchor);
    expect(getParagraphs(document)).toEqual([{ kind: 'explicit', element: paragraph }]);
  });

  it('finds implicit and explicit paragraphs without classifying a heading as a paragraph', () => {
    const document = parseTestDocument('<section><h2>Heading</h2>Hello <em>first</em>.<p>Second.</p></section>');
    const section = document.querySelector('section');
    const heading = document.querySelector('h2');
    const paragraph = document.querySelector('p');
    assert(section !== null && heading !== null && paragraph !== null);
    const children = Array.from(section.childNodes);
    const version = document.collectionVersion;
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: heading.nextSibling, last: paragraph.previousSibling },
      { kind: 'explicit', element: paragraph },
    ]);
    expect(Array.from(section.childNodes)).toEqual(children);
    expect(document.collectionVersion).toBe(version);
  });

  it('preserves paragraph boundaries across ins and del from the specification example', () => {
    const document = parseTestDocument('<section><ins><h2>Heading</h2>This is the <em>first</em> paragraph in</ins> this example<del>.<p>Second.</p></del><!-- ignored --></section>');
    const heading = document.querySelector('h2');
    const deletion = document.querySelector('del');
    const paragraph = document.querySelector('p');
    assert(heading !== null && deletion !== null);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: heading.nextSibling, last: deletion.firstChild },
      { kind: 'explicit', element: paragraph },
    ]);
  });

  it('splits two implicit paragraphs around a heading inside an anchor', () => {
    const document = parseTestDocument('<header>Welcome!<a>This is home of...<h1>The Falcons!</h1>The aircraft!</a>More.</header>');
    const header = document.querySelector('header');
    const anchor = document.querySelector('a');
    const heading = document.querySelector('h1');
    assert(header !== null && anchor !== null && heading !== null);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: header.firstChild, last: anchor.firstChild },
      { kind: 'implicit', first: heading.nextSibling, last: header.lastChild },
    ]);
  });

  it('flattens nested and empty wrappers and continues through the rest of the document', () => {
    const document = parseTestDocument('<section><a><map></map><ins>Before <del><em>inside</em></del></ins></a> after.<p>Next.</p><del><map></map></del></section><p>Outside.</p>');
    const anchor = document.querySelector('a');
    const insertion = document.querySelector('ins');
    const paragraph = document.querySelector('p');
    const outside = document.querySelector('section + p');
    assert(anchor !== null && insertion !== null && outside !== null);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: insertion.firstChild, last: anchor.nextSibling },
      { kind: 'explicit', element: paragraph },
      { kind: 'explicit', element: outside },
    ]);
  });

  it('keeps an object in the outer paragraph and discovers its overlapping fallback paragraphs', () => {
    const document = parseTestDocument('<section><h2>My Cats</h2>You can play.<object>Use these links:<ul><li><a>Download</a></li><li><a>Online</a></li></ul>Alternatively, upgrade.</object>I am proud.</section>');
    const object = document.querySelector('object');
    const links = Array.from(document.querySelectorAll('a'));
    assert(object !== null);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: object.previousSibling, last: object.nextSibling },
      { kind: 'implicit', first: object.firstChild, last: object.firstChild },
      { kind: 'implicit', first: links[0]!.firstChild, last: links[0]!.firstChild },
      { kind: 'implicit', first: links[1]!.firstChild, last: links[1]!.firstChild },
      { kind: 'implicit', first: object.lastChild, last: object.lastChild },
    ]);
  });

  it('ignores comments and processing instructions without trimming whitespace from a qualifying run', () => {
    const document = createTestDocument();
    const div = document.createElementNS(HTML_NAMESPACE, 'div');
    const leading = document.createTextNode(' ');
    const text = document.createTextNode('hello');
    const trailing = document.createTextNode('\n');
    div.appendChild(leading);
    div.appendChild(document.createComment('comment'));
    div.appendChild(text);
    div.appendChild(document.createProcessingInstruction('target', 'data'));
    div.appendChild(trailing);
    document.appendChild(div);
    expect(getParagraphs(document)).toEqual([{ kind: 'implicit', first: leading, last: trailing }]);
    text.data = '\t';
    expect(getParagraphs(document)).toEqual([]);
    text.data = '\u00a0';
    expect(getParagraphs(document)).toHaveLength(1);
  });

  it('requires more than embedded content and whitespace, but an empty p still forms a paragraph', () => {
    const document = parseTestDocument('<div> <img> <p></p></div>');
    const div = document.querySelector('div');
    const paragraph = document.querySelector('p');
    assert(div !== null);
    expect(getParagraphs(document)).toEqual([{ kind: 'explicit', element: paragraph }]);
    const text = document.createTextNode('caption');
    div.insertBefore(text, paragraph);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: div.firstChild, last: text },
      { kind: 'explicit', element: paragraph },
    ]);
  });

  it('recognizes an explicit paragraph without classifying its children for implicit runs', () => {
    const document = createTestDocument();
    const paragraph = document.createElementNS(HTML_NAMESPACE, 'p');
    const foreign = document.createElementNS('urn:example', 'unknown');
    const insertion = document.createElementNS(HTML_NAMESPACE, 'ins');
    const nestedParagraph = document.createElementNS(HTML_NAMESPACE, 'p');
    paragraph.appendChild(foreign);
    insertion.appendChild(nestedParagraph);
    paragraph.appendChild(insertion);
    document.appendChild(paragraph);
    expect(getParagraphs(document)).toEqual([
      { kind: 'explicit', element: paragraph },
      { kind: 'explicit', element: nestedParagraph },
    ]);
  });

  it('forms a body paragraph around a phrasing-only container, without another paragraph inside it', () => {
    const document = parseTestDocument('<span>hello <em>there</em></span>');
    const span = document.querySelector('span');
    assert(span !== null);
    expect(getParagraphs(document)).toEqual([{ kind: 'implicit', first: span, last: span }]);
    expect(modelAllowsImplicitParagraphs(resolveContentModelTransparency(span))).toBe(false);
  });

  it('uses the declared model of a non-HTML document element', () => {
    const document = createTestDocument();
    const container = document.createElementNS('urn:example', 'container');
    container.contentModel = { childRules: [flowContent] };
    const text = document.createTextNode('An implicit paragraph.');
    const paragraph = document.createElementNS(HTML_NAMESPACE, 'p');
    container.appendChild(text);
    container.appendChild(paragraph);
    document.appendChild(container);
    expect(getParagraphs(document)).toEqual([
      { kind: 'implicit', first: text, last: text },
      { kind: 'explicit', element: paragraph },
    ]);
  });

  it('keeps missing container and foreign models explicit', () => {
    const document = parseTestDocument('<article>text</article><div></div>');
    const article = document.querySelector('article');
    const div = document.querySelector('div');
    assert(article !== null && div !== null);
    expect(() => getParagraphs(document)).toThrow('Content model for article is not implemented');
    article.remove();
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.appendChild(document.createTextNode('text'));
    div.appendChild(svg);
    expect(() => getParagraphs(document)).toThrow('Content model for svg is not implemented');
  });
});
