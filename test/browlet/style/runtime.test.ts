import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { unwrap, getRelevantRealm } from '../../../src/browlet/bindings';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';

describe('Stylelet execution integration', () => {
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
      const DocumentConstructor = Reflect.get(browlet.window, 'Document') as new () => Document;
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
