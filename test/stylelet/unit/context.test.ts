import { describe, expect, it, vi } from 'vitest';

import { Stylelet } from '../../../src/stylelet/stylelet';
import { StyleletContext } from '../../../src/stylelet/context';
import { createBrowletDocument } from '../browlet-document';

describe('style context', () => {
  it('normalizes document and element host capabilities', () => {
    const document = createBrowletDocument(
      '<main id="target" class="one two"></main>',
    );
    const target = document.getElementById('target')!;
    const getId = vi.fn(() => 'adapted-id');
    const context = new StyleletContext(document, {
      element: { getId },
    });

    expect(context.document).toBe(document);
    expect(context.root).toBe(document.documentElement);
    expect(context.isHtml).toBe(true);
    expect(context.getId(target)).toBe('adapted-id');
    expect(getId).toHaveBeenCalledWith(target);
    expect(context.getClass(target)).toBe('one two');
  });

  it('owns reusable compiled-selector and regex caches', () => {
    const document = createBrowletDocument('<main></main>');
    const context = new StyleletContext(document);
    const selector = {};
    const compiled = () => true;

    context.setCompiledSelector(selector, compiled);

    expect(context.getCompiledSelector(selector)).toBe(compiled);
    expect(context.getClassRegex('one')).toBe(context.getClassRegex('one'));

    context.clearCaches();

    expect(context.getCompiledSelector(selector)).toBeUndefined();
  });

  it('is created and retained by the public Stylelet API', () => {
    const document = createBrowletDocument('<main></main>');
    const stylelet = new Stylelet(document);

    expect(stylelet.context.document).toBe(document);
  });
});
