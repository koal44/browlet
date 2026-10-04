import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { unwrap, getRelevantRealm } from '../../../src/browlet/bindings';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { URLImpl } from '../../../src/url/index';
import { decode } from '../../../src/encoding/index';
import { decodeStylesheetBytes } from '../../../src/stylelet/syntax/tokens';

describe('Stylelet execution integration', () => {
  it('uses Encoding to decode stylesheet bytes through the owning UserAgent', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const styles = document.getCSSEngine();

    expect(styles.context.env.userAgent).toHaveProperty('decodeText', decode);
    expect(decodeStylesheetBytes(Uint8Array.of(0xE9), {
      transportEncoding: 'windows-1252',
    }, styles.context.env)).toBe('é');
  });

  it('uses Browlet URL implementations for stylesheet state', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const styles = document.getCSSEngine();
    const sheet = styles.createStyleSheet({ baseURL: 'https://example.test/assets/' });

    expect(styles.context.env.userAgent.URL).toBe(URLImpl);
    expect(sheet.interpretedStyleSheet.location).toBeInstanceOf(URLImpl);
    expect(sheet.interpretedStyleSheet.baseUrl).toBeInstanceOf(URLImpl);
    expect(sheet.interpretedStyleSheet.baseUrl?.href).toBe('https://example.test/assets/');
    expect(typeof sheet.href).toBe('string');
  });

  it('exposes computed-style failures in the owning realm through the provisional CSSOM API', async () => {
    const browlet = new Browlet({ route: () => '' });
    const result = await browlet.evaluate(() => {
      const style = getComputedStyle(document.createElement('div'));
      try { style.setProperty('color', 'red'); }
      catch (error) {
        return {
          isDOMException: error instanceof DOMException,
          name: error instanceof DOMException ? error.name : undefined,
        };
      }
      return null;
    });

    expect(result).toEqual({ isDOMException: true, name: 'NoModificationAllowedError' });
  });

  it.each(['initial', 'navigated', 'constructed'] as const)(
    'completes stylesheet work with the %s document host', async (kind) => {
      const browlet = new Browlet({ route: () => '<main></main>' });
      if (kind === 'navigated') await browlet.navigate('https://example.test/');
      const DocumentConstructor = browlet.window.Document;
      const document = kind === 'constructed'
        ? new DocumentConstructor()
        : browlet.document;
      const implementation = unwrap<DocumentImpl>(document);
      const styles = implementation.getCSSEngine();
      const sheet = styles.createStyleSheet();
      const result = sheet.replace('main { color: red }');
      const completed = new Promise((resolve, reject) => { result.observe(resolve, reject); });
      await expect(completed).resolves.toBe(sheet);
      expect(sheet.cssRules.length).toBe(1);
      expect(() => sheet.replaceSync('')).not.toThrow();
    },
  );

  it('delivers stylesheet replacement completion without an unrelated task or manual checkpoint', async () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const sheet = document.getCSSEngine().createStyleSheet();
    const realm = getRelevantRealm(browlet.window);
    const started = Promise.withResolvers<void>();
    let completed = false;
    let failure: unknown;
    realm.queueGlobalTask(domManipulationTaskSource, () => {
      sheet.replace('main { color: red }').observe(
        () => { completed = true; }, (error) => { failure = error; },
      );
      started.resolve();
    });

    // Start inside a real HTML task, then allow background work and delivery.
    // No additional page script or test checkpoint should be needed.
    await started.promise;
    await nextTurn();
    await nextTurn();
    expect(sheet.cssRules.length).toBe(1);
    expect(failure).toBeUndefined();
    expect(completed).toBe(true);
  });
});
