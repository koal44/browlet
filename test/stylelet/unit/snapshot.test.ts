import { describe, expect, it, vi } from 'vitest';

import {
  parseHTMLDocument,
} from '../../../src/browlet/parser/document-construction';
import { Stylelet } from '../../../src/stylelet/stylelet';
import { Snapshot } from '../../../src/stylelet/snapshot';

describe('style snapshot', () => {
  it('normalizes document and element host capabilities', () => {
    const document = createDocumentImpl(
      '<main id="target" class="one two"></main>',
    );
    const target = document.getElementById('target')!;
    const getId = vi.fn(() => 'adapted-id');
    const snapshot = new Snapshot(document, {
      caps: { element: { getId } },
    });

    expect(snapshot.document).toBe(document);
    expect(snapshot.root).toBe(document.documentElement);
    expect(snapshot.isHtml).toBe(true);
    expect(snapshot.getId(target)).toBe('adapted-id');
    expect(getId).toHaveBeenCalledWith(target);
    expect(snapshot.getClass(target)).toBe('one two');
  });

  it('owns reusable compiled-selector and regex caches', () => {
    const document = createDocumentImpl('<main></main>');
    const snapshot = new Snapshot(document);
    const selector = {};
    const compiled = () => true;

    snapshot.setCompiledSelector(selector, compiled);

    expect(snapshot.getCompiledSelector(selector)).toBe(compiled);
    expect(snapshot.getClassRegex('one')).toBe(snapshot.getClassRegex('one'));

    snapshot.clearCaches();

    expect(snapshot.getCompiledSelector(selector)).toBeUndefined();
  });

  it('is created and retained by the public Stylelet API', () => {
    const document = createDocumentImpl('<main></main>');
    const stylelet = new Stylelet(document);

    expect(stylelet.snapshot.document).toBe(document);
  });
});

function createDocumentImpl(source: string): Document {
  return parseHTMLDocument(source);
}
