import { browletDOM } from '../../../src/browlet/integration/dom';
import { describe, expect, it, vi } from 'vitest';

import { Stylelet } from '../../../src/stylelet/stylelet';
import { StyleletContext } from '../../../src/stylelet/context';
import { createStyleletEnvironment } from '../../../src/stylelet/environment';
import { createBrowletDocument } from '../browlet-document';
import { HTML_NAMESPACE } from '../../../src/infra/index';

describe('style context', () => {
  it('uses supplied document and element operations', () => {
    const document = createBrowletDocument(
      '<main id="target" class="one two"></main>',
    );
    const target = document.getElementById('target')!;
    const getId = vi.fn(() => 'adapted-id');
    const context = new StyleletContext(document, createStyleletEnvironment({ dom: { ...browletDOM, getId } }));

    expect(context.document).toBe(document);
    expect(context.root).toBe(document.documentElement);
    expect(context.isHtml).toBe(true);
    expect(context.dom.getId(target)).toBe('adapted-id');
    expect(getId).toHaveBeenCalledWith(target);
    expect(context.dom.getClass(target)).toBe('one two');
  });

  it('owns reusable compiled-selector and regex caches', () => {
    const document = createBrowletDocument('<main></main>');
    const context = new StyleletContext(document, document.env);
    const selector = {};
    const compiled = () => true;

    context.setCompiledSelector(selector, compiled);

    expect(context.getCompiledSelector(selector)).toBe(compiled);
    expect(context.getClassRegex('one')).toBe(context.getClassRegex('one'));

    context.clearCaches();

    expect(context.getCompiledSelector(selector)).toBeUndefined();
  });

  it('keeps the supplied namespace accessor as the classification fallback', () => {
    const document = createBrowletDocument('<main></main>');
    const element = document.body!.firstElementChild!;
    const getNamespaceURI = vi.fn((_element: object): string | null => null);
    const env = createStyleletEnvironment({
      dom: { ...browletDOM, getNamespaceURI, isHTMLElement: (element) => getNamespaceURI(element) === HTML_NAMESPACE },
    });
    const context = new StyleletContext(document, env);

    expect(context.dom.isHTMLElement(element)).toBe(false);
    getNamespaceURI.mockReturnValue(HTML_NAMESPACE);
    expect(context.dom.isHTMLElement(element)).toBe(true);
    expect(getNamespaceURI).toHaveBeenCalledWith(element);
  });

  it('is created and retained by the public Stylelet API', () => {
    const document = createBrowletDocument('<main></main>');
    const stylelet = new Stylelet(document, { env: document.env });

    expect(stylelet.context.document).toBe(document);
    expect(stylelet.context.env).toBe(document.env);
  });
});
