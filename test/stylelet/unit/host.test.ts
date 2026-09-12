import { setImmediate as nextTurn } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  defaultRuntimeCaps, Stylelet, type PromiseValue, type RuntimeCaps,
} from '../../../src/stylelet/stylelet';

describe('Stylelet runtime capabilities', () => {
  it('completes replacement with the standalone native runtime', async () => {
    const { document } = new JSDOM('<main></main>', { url: 'https://example.test/' }).window;
    const styles = new Stylelet(document);
    const sheet = styles.createStyleSheet();
    const replacement = observe(sheet.replace('main { opacity: 0.25 }'));

    expect(sheet.cssRules.length).toBe(0);
    expect(() => sheet.replaceSync('')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    await expect(replacement).resolves.toBe(sheet);
    styles.documentScope.setAdoptedStyleSheets([sheet]);
    expect(styles.getComputedStyle(document.querySelector('main')!).opacity).toBe('0.25');
    expect(() => sheet.replaceSync('')).not.toThrow();
  });

  it('waits for runtime work and keeps a concurrent replacement from changing the result', async () => {
    const document = new JSDOM().window.document;
    const work: (() => void)[] = [];
    const runtime: RuntimeCaps = {
      ...defaultRuntimeCaps,
      runInParallel: (steps) => { work.push(steps); },
    };
    const sheet = new Stylelet(document, { runtime }).createStyleSheet();
    const completed = observe(sheet.replace('.first {} .second {}'));
    const rejected = expect(observe(sheet.replace('.wrong {}')))
      .rejects.toMatchObject({ name: 'NotAllowedError' });

    await nextTurn();
    expect(sheet.cssRules.length).toBe(0);
    expect(() => sheet.insertRule('.wrong {}')).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    work.shift()!();
    await expect(completed).resolves.toBe(sheet);
    await rejected;
    expect(sheet.cssRules.length).toBe(2);
    expect(sheet.insertRule('.third {}')).toBe(0);
  });

  it('uses runtime exceptions in sheets, media lists, declarations, and adoption', async () => {
    class HostDOMException extends DOMException {}
    const runtime: RuntimeCaps = {
      ...defaultRuntimeCaps,
      createDOMException: (name, message) => new HostDOMException(message, name),
    };
    const { document } = new JSDOM('<main></main>').window;
    const styles = new Stylelet(document, { runtime });
    const sheet = styles.createStyleSheet();

    expect(() => sheet.deleteRule(0)).toThrow(HostDOMException);
    expect(() => sheet.media.deleteMedium('screen')).toThrow(HostDOMException);
    const declaration = styles.getComputedStyle(document.querySelector('main')!);
    expect(() => declaration.setProperty('color', 'red')).toThrow(HostDOMException);
    const foreign = new Stylelet(new JSDOM().window.document).createStyleSheet();
    expect(() => styles.documentScope.setAdoptedStyleSheets([foreign])).toThrow(HostDOMException);

    const embedded = styles.documentScope.createStyleElementStyleSheet(
      document.createElement('style'), '',
    );
    expect(() => embedded.replaceSync('')).toThrow(HostDOMException);
    expect(() => embedded.media.deleteMedium('screen')).toThrow(HostDOMException);
    await expect(observe(embedded.replace(''))).rejects.toBeInstanceOf(HostDOMException);
  });
});

function observe<T>(value: PromiseValue<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.observe(resolve, reject); });
}
