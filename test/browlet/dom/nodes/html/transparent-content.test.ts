import { assert, describe, expect, it } from 'vitest';

import { HTML_NAMESPACE } from '../../../../../src/infra/index';
import {
  flowContent, phrasingContent, transparentContent, resolveContentModelTransparency, modelAllowsImplicitParagraphs,
  type ContentModel, type RepeatedContentRule,
} from '../../../../../src/browlet/dom/nodes/element-definitions/content-model';
import { HTMLMediaElementImpl } from '../../../../../src/browlet/dom/nodes/html/embedded/media';
import { HTMLSourceElementImpl } from '../../../../../src/browlet/dom/nodes/html/embedded/source';
import { HTMLTrackElementImpl } from '../../../../../src/browlet/dom/nodes/html/embedded/track';
import { createTestDocument, parseTestDocument } from '../../../../support/dom';

describe('HTML transparent content models', () => {
  it('leaves a non-transparent model unchanged without consulting an unfinished parent model', () => {
    const document = parseTestDocument('<article><span>text</span></article>');
    const span = document.querySelector('span');
    assert(span !== null);
    expect(resolveContentModelTransparency(span)).toBe(span.getContentModel());
  });

  it('resolves an anchor against its current parent without changing its declaration or restrictions', () => {
    const document = parseTestDocument('<div><a href="/">hello</a></div><p></p>');
    const anchor = document.querySelector('a');
    const paragraph = document.querySelector('p');
    assert(anchor !== null && paragraph !== null);
    const declared = anchor.getContentModel();
    expect(resolveContentModelTransparency(anchor)).toEqual({ ...declared, childRules: [flowContent] });
    paragraph.appendChild(anchor);
    expect(resolveContentModelTransparency(anchor)).toEqual({ ...declared, childRules: [phrasingContent] });
    expect(anchor.getContentModel()).toBe(declared);
    expect(declared.childRules).toEqual([transparentContent]);
    expect(anchor.parentNode).toBe(paragraph);
  });

  it('follows nested object/ins/map/a transparency and uses flow for an orphan', () => {
    const document = parseTestDocument('<p><object><ins><map><a>Apples</a></map></ins></object></p>');
    const anchor = document.querySelector('a');
    const object = document.querySelector('object');
    assert(anchor !== null && object !== null);
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([phrasingContent]);
    object.remove();
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([flowContent]);
    anchor.remove();
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([flowContent]);
  });

  it.each(['audio', 'video'])('preserves the %s source/track prefix while resolving transparent fallback content', (tag) => {
    const document = parseTestDocument(`<div><${tag}></${tag}></div><p></p>`);
    const media = document.querySelector(tag);
    const paragraph = document.querySelector('p');
    assert(media !== null && paragraph !== null);
    const sources: RepeatedContentRule = {
      kind: 'repeat', rule: { kind: 'element', implementation: HTMLSourceElementImpl }, min: 0,
    };
    const tracks: RepeatedContentRule = {
      kind: 'repeat', rule: { kind: 'element', implementation: HTMLTrackElementImpl }, min: 0,
    };
    // Supply the no-src media model until §4.8 installs it on the element implementations.
    const declared: ContentModel = {
      childRules: [{ kind: 'sequence', rules: [sources, tracks, transparentContent] }],
      forbiddenDescendants: [{ kind: 'element', implementation: HTMLMediaElementImpl }],
    };
    media.contentModel = declared;
    expect(resolveContentModelTransparency(media)).toEqual({
      ...declared, childRules: [{ kind: 'sequence', rules: [sources, tracks, flowContent] }],
    });
    paragraph.appendChild(media);
    expect(resolveContentModelTransparency(media)).toEqual({
      ...declared, childRules: [{ kind: 'sequence', rules: [sources, tracks, phrasingContent] }],
    });
    expect(media.getContentModel()).toBe(declared);
    expect(declared.childRules).toEqual([{ kind: 'sequence', rules: [sources, tracks, transparentContent] }]);
  });

  it('selects the flow portion after details summary rather than copying its whole sequence', () => {
    const document = parseTestDocument('<details><summary></summary><!-- ignored --><a>hello</a></details>');
    const details = document.querySelector('details');
    const anchor = document.querySelector('a');
    assert(details !== null && anchor !== null);
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([flowContent]);
    expect(details.getContentModel().childRules[0]?.kind).toBe('sequence');
    details.insertBefore(anchor, details.firstChild);
    expect(() => resolveContentModelTransparency(anchor)).toThrow('supported content-model position');
  });

  it('retains multiple independent surrounding child requirements', () => {
    const document = parseTestDocument('<div><a>hello</a></div>');
    const parent = document.querySelector('div');
    const anchor = document.querySelector('a');
    assert(parent !== null && anchor !== null);
    parent.contentModel = { childRules: [flowContent, phrasingContent] };
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([flowContent, phrasingContent]);
    expect(() => modelAllowsImplicitParagraphs(resolveContentModelTransparency(parent))).toThrow('intersecting content rules');
  });

  it('does not reuse a consumed prefix when a tail has an unsupported nested sequence', () => {
    const document = parseTestDocument('<details><summary></summary><a>hello</a></details>');
    const details = document.querySelector('details');
    const anchor = document.querySelector('a');
    assert(details !== null && anchor !== null);
    const sequence = details.getContentModel().childRules[0];
    assert(sequence?.kind === 'sequence');
    const summary = sequence.rules[0]!;
    details.contentModel = {
      childRules: [{ kind: 'sequence', rules: [summary, { kind: 'sequence', rules: [summary, flowContent] }] }],
    };
    expect(() => resolveContentModelTransparency(anchor)).toThrow('position matching');
  });

  it('does not substitute a permissive model for unfinished ruby or foreign-parent rules', () => {
    const document = parseTestDocument('<ruby><ins>base</ins><rt>annotation</rt></ruby>');
    const insertion = document.querySelector('ins');
    assert(insertion !== null);
    expect(() => resolveContentModelTransparency(insertion)).toThrow('Content model for ruby is not implemented');
    document.createDocumentFragment().appendChild(insertion);
    expect(() => resolveContentModelTransparency(insertion)).toThrow('non-element parent');
  });

  it('uses a non-HTML parent model when supplied and reports it when missing', () => {
    const document = createTestDocument();
    const parent = document.createElementNS('urn:example', 'container');
    const anchor = document.createElementNS(HTML_NAMESPACE, 'a');
    parent.appendChild(anchor);
    expect(() => resolveContentModelTransparency(anchor)).toThrow('Content model for container is not implemented');

    parent.contentModel = { childRules: [phrasingContent] };
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([phrasingContent]);
    parent.contentModel = { childRules: [flowContent] };
    expect(resolveContentModelTransparency(anchor).childRules).toEqual([flowContent]);
  });

  it('keeps div conditional models explicit, including nested select descendants and dl precedence', () => {
    const document = createTestDocument();
    const div = document.createElementNS(HTML_NAMESPACE, 'div');
    const span = document.createElementNS(HTML_NAMESPACE, 'span');
    const select = document.createElementNS(HTML_NAMESPACE, 'select');
    const list = document.createElementNS(HTML_NAMESPACE, 'dl');
    expect(div.getContentModel().childRules).toEqual([flowContent]);
    select.appendChild(span);
    span.appendChild(div);
    expect(div.getContentModel().childRules).toEqual([transparentContent]);
    select.appendChild(div);
    expect(() => resolveContentModelTransparency(div)).toThrow('Content model for select is not implemented');
    select.appendChild(list);
    list.appendChild(div);
    expect(() => div.getContentModel()).toThrow('div content model inside dl');
    div.remove();
    expect(div.getContentModel().childRules).toEqual([flowContent]);
  });
});
