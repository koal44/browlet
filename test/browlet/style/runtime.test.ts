import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { unwrap, getRelevantRealm } from '../../support/browlet-binding';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { serializeURL } from '../../../src/url/core/index';
import { BlobImpl } from '../../../src/file/index';

describe('Stylelet execution integration', () => {
  it('retains stylesheet state before creating the style engine', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const getStyleEngine = vi.spyOn(document, 'getStyleEngine');
    const scope = document.getStyleScope();
    const style = document.createElement('style');
    const sheet = scope.createStyleElementStyleSheet(style, 'div { color: red }');

    expect(getStyleEngine).not.toHaveBeenCalled();
    getStyleEngine.mockRestore();

    const engine = document.getStyleEngine();
    expect(engine.documentScope).toBe(scope);
    expect(engine.context).toBe(scope.context);
    expect(scope.styleSheets.item(0)).toBe(sheet);
    expect(engine.getComputedStyle(document.createElement('div')).getPropertyValue('color')).toBe('rgb(255, 0, 0)');
  });

  it('retains the owning environment while parsing stylesheet URLs directly', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const styles = document.getStyleEngine();
    const sheet = styles.createStyleSheet({ baseURL: 'https://example.test/assets/' });

    expect(styles.context.env.userAgent).toBe(document.env.userAgent);
    expect(sheet.location).toBeNull();
    expect(serializeURL(sheet.baseURL!)).toBe('https://example.test/assets/');
    expect(sheet.href).toBeNull();
  });

  it('captures the owning UserAgent Blob URL registration in a stylesheet base', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const env = document.env;
    const url = env.userAgent.blobURLStore.add(new BlobImpl([], {}, env), env);
    const entry = env.parseURL(url)!.blobURLEntry;
    const sheet = document.getStyleEngine().createStyleSheet({ baseURL: url });

    expect(entry).not.toBeNull();
    expect(sheet.baseURL!.blobURLEntry).toBe(entry);
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
      const styles = implementation.getStyleEngine();
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
    const sheet = document.getStyleEngine().createStyleSheet();
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
