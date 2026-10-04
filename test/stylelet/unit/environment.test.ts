import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createAsyncExecution, type TimerHost } from '../../../src/infra/execution';
import { createStyleletEnvironment, Stylelet } from '../../../src/stylelet/index';
import { ValueStage } from '../../../src/stylelet/value-processing/stage';
import { parseSyntax } from '../../../src/stylelet/values/syntax-value';
import { defineCustomProperty } from '../../../src/stylelet/values/whole-value';
import { decodeStylesheetBytes } from '../../../src/stylelet/syntax/tokens';

describe('Stylelet standalone scheduling', () => {
  it('uses supplied execution for deferred stylesheet delivery', async () => {
    const pending = new Set<() => void>();
    const timerHost: TimerHost = {
      scheduleTimeout(milliseconds, steps) {
        expect(milliseconds).toBe(0);
        pending.add(steps);
        return { remove: () => { pending.delete(steps); } };
      },
    };
    const exec = { ...createAsyncExecution(timerHost), DOMException };
    const document = new JSDOM().window.document;
    const sheet = new Stylelet(document, { exec }).createStyleSheet();
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

describe('Stylelet decoding integration', () => {
  it.each(['option', 'environment'] as const)('uses the %s decoder with a canonical fallback encoding', (source) => {
    const bytes = Uint8Array.of(0xE9);
    const decodeText = vi.fn(() => 'decoded stylesheet');
    const env = createStyleletEnvironment({ decodeText });
    const document = new JSDOM().window.document;
    const styles = new Stylelet(document, source === 'option' ? { decodeText } : {
      env,
      decodeText: () => { throw new Error('The supplied environment must take precedence'); },
    });

    expect(decodeStylesheetBytes(bytes, { transportEncoding: ' LATIN1 ' }, styles.context.env))
      .toBe('decoded stylesheet');
    expect(decodeText).toHaveBeenCalledExactlyOnceWith(bytes, 'windows-1252');
  });
});

describe('Stylelet URL integration', () => {
  it('uses the native URL constructor for standalone sheets', () => {
    const document = new JSDOM('', { url: 'https://example.test/document/' }).window.document;
    const styles = new Stylelet(document);
    const sheet = styles.createStyleSheet({ baseURL: '../assets/' });

    expect(styles.context.env.userAgent.URL).toBe(URL);
    expect(sheet.interpretedStyleSheet.location).toBeInstanceOf(URL);
    expect(sheet.interpretedStyleSheet.baseUrl?.href).toBe('https://example.test/assets/');
    expect(sheet.href).toBe('https://example.test/document/');
  });

  it.each(['option', 'environment'] as const)('uses the %s provider for sheet and computed resource URLs', (source) => {
    const calls: Array<[string, string | undefined]> = [];
    class HostURL {
      href: string;

      constructor(input: string, base?: string) {
        calls.push([input, base]);
        this.href = new URL(input, base).href;
      }
    }

    const document = new JSDOM('<style></style>', { url: 'https://example.test/document/' }).window.document;
    const env = createStyleletEnvironment({ URL: HostURL });
    const styles = new Stylelet(document, source === 'option'
      ? { URL: HostURL }
      : { env, URL });
    const sheet = styles.createStyleSheet({ baseURL: '../assets/' });
    sheet.replaceSync('* { --image: url("icon.svg") }');
    styles.documentScope.adoptedStyleSheets.push(sheet);
    const engine = styles.documentScope.cascade;
    const cascaded = engine.getCascadedProperty('--image', styles.documentScope)!;
    const context = engine.getPropertyContext(cascaded);
    const definition = defineCustomProperty({ syntax: parseSyntax('<url>')! });
    const value = definition.parse('url("icon.svg")')!.resolve(ValueStage.Computed, context)!;

    expect(styles.context.env.userAgent.URL).toBe(HostURL);
    if (source === 'environment') expect(styles.context.env).toBe(env);
    expect(sheet.interpretedStyleSheet.location).toBeInstanceOf(HostURL);
    expect(sheet.interpretedStyleSheet.baseUrl).toBeInstanceOf(HostURL);
    expect(value.serialize()).toBe('url("https://example.test/assets/icon.svg")');
    expect(calls).toContainEqual(['icon.svg', 'https://example.test/assets/']);

    const embedded = styles.documentScope.createStyleElementStyleSheet(document.querySelector('style')!, '');
    expect(embedded.interpretedStyleSheet.baseUrl).toBeInstanceOf(HostURL);
  });
});
