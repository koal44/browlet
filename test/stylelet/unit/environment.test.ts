import { createStyleletTestEnvironment } from '../environment-fixture';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { TimerHost } from '../../../src/infra/tasks';
import { Stylelet } from '../../../src/stylelet/index';
import { CascadeEngine } from '../../../src/stylelet/engine/cascade-engine';
import { ValueStage } from '../../../src/stylelet/value-processing/stage';
import { SyntaxValue } from '../../../src/stylelet/values/syntax-value';
import { WholeValue } from '../../../src/stylelet/values/whole-value';
import { serializeURL } from '../../../src/url/index';

describe('Stylelet host scheduling', () => {
  it('uses supplied host scheduling for deferred stylesheet delivery', async () => {
    const pending = new Set<() => void>();
    const timerHost: TimerHost = {
      scheduleTimeout(milliseconds, steps) {
        expect(milliseconds).toBe(0);
        pending.add(steps);
        return { remove: () => { pending.delete(steps); } };
      },
    };
    const document = new JSDOM().window.document;
    const sheet = Stylelet.create(document, { env: createStyleletTestEnvironment({ timerHost }) }).createStyleSheet();
    const completed = new Promise<typeof sheet>((resolve, reject) => {
      sheet.replace('main { color: red }').observe(resolve, reject);
    });
    const runNext = () => {
      const steps = pending.values().next().value!;
      pending.delete(steps);
      steps();
    };

    expect(sheet.cssRules.length).toBe(0);
    expect(pending.size).toBe(1);
    runNext();
    expect(sheet.cssRules.length).toBe(0);
    expect(pending.size).toBe(1);
    runNext();
    await expect(completed).resolves.toBe(sheet);
    expect(sheet.cssRules.length).toBe(1);
    expect(pending.size).toBe(0);
  });
});

describe('Stylelet URL integration', () => {
  it('parses stylesheet bases directly and rejects invalid URLs', () => {
    const document = new JSDOM('', { url: 'https://example.test/document/' }).window.document;
    const styles = Stylelet.create(document, { env: createStyleletTestEnvironment() });
    const sheet = styles.createStyleSheet({ baseURL: '../assets/' });

    expect(serializeURL(sheet.baseURL!)).toBe('https://example.test/assets/');
    expect(sheet.location).toBeNull();
    expect(sheet.href).toBeNull();
    expect(() => styles.createStyleSheet({ baseURL: 'http://[' }))
      .toThrow('The stylesheet base URL is invalid.');
  });

  it('retains the supplied environment when resolving computed resource URLs', () => {
    const document = new JSDOM('<style></style>', { url: 'https://example.test/document/' }).window.document;
    const env = createStyleletTestEnvironment();
    const styles = Stylelet.create(document, { env });
    const sheet = styles.createStyleSheet({ baseURL: '../assets/' });
    sheet.replaceSync('* { --image: url("icon.svg") }');
    styles.documentScope.adoptedStyleSheets.push(sheet);
    const engine = new CascadeEngine({ context: styles.context });
    const cascaded = engine.getCascadedProperty('--image', styles.documentScope)!;
    const context = engine.getPropertyContext(cascaded);
    const parseOrdinary = SyntaxValue.parse('<url>', {})!.createParser();
    const raw = WholeValue.parse('url("icon.svg")', context, parseOrdinary, true)!;
    const value = raw.resolve(ValueStage.Computed, context);

    expect(styles.context.env).toBe(env);
    expect(context.baseUrl).toBe(sheet.baseURL);
    expect(value.serialize()).toBe('url("https://example.test/assets/icon.svg")');

    const embedded = styles.documentScope.createStyleElementStyleSheet(document.querySelector('style')!, '');
    expect(serializeURL(embedded.baseURL!)).toBe('https://example.test/document/');
  });
});
