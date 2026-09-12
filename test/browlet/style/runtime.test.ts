import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { browletBindings, getRelevantRealm } from '../../../src/browlet/bindings';
import { DocumentImpl } from '../../../src/browlet/dom/nodes/document';

describe('Stylelet runtime integration', () => {
  it.each(['initial', 'navigated', 'constructed'] as const)(
    'completes stylesheet work with the %s document host', async (kind) => {
      const browlet = new Browlet({ route: () => '<main></main>' });
      if (kind === 'navigated') await browlet.navigate('https://example.test/');
      const DocumentConstructor = Reflect.get(browlet.window, 'Document') as new () => Document;
      const document = kind === 'constructed'
        ? new DocumentConstructor()
        : browlet.document;
      const implementation = browletBindings.getImplementation<DocumentImpl>(document);
      const styles = DocumentImpl.getCSSEngine(implementation);
      const sheet = styles.createStyleSheet();
      const result = sheet.replace('main { color: red }');
      const realm = getRelevantRealm(document);
      let completed = false;
      let failure: unknown;
      result.observe((value) => { completed = value === sheet; }, (error) => { failure = error; });

      // Enter an actual Node task between HTML checkpoints; Vitest's own
      // Promise continuations are outside Browlet's execution stack.
      await new Promise<void>((resolve, reject) => {
        setImmediate(() => {
          try {
            realm.agent.eventLoop.performMicrotaskCheckpoint();
            resolve();
          } catch (error) {
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve any checkpoint failure for the test runner.
            reject(error);
          }
        });
      });
      expect(failure).toBeUndefined();
      expect(completed).toBe(true);
      expect(sheet.cssRules.length).toBe(1);
      expect(() => sheet.replaceSync('')).not.toThrow();
    },
  );
});
