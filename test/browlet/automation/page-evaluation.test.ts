import { describe, expect, it, vi } from 'vitest';

import { Browlet, UserAgent } from '../../../src/browlet/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { PageEvaluation } from '../../../src/browlet/automation/index';

describe('local page evaluation', () => {
  it('routes Browlet source and function evaluation through the convenience adapter', async () => {
    const evaluate = vi.spyOn(PageEvaluation.prototype, 'evaluate');
    try {
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate('21 * 2')).toBe(42);
      expect(await browlet.evaluate((value) => value + 1, 41)).toBe(42);
      expect(evaluate).toHaveBeenCalledTimes(2);
    } finally {
      evaluate.mockRestore();
    }
  });

  it('selects the target Window and keeps different navigables separate', async () => {
    const userAgent = new UserAgent();
    const first = TopLevelTraversable.create(userAgent, null, 'first');
    const second = TopLevelTraversable.create(userAgent, null, 'second');
    const firstPage = new PageEvaluation(first);
    const secondPage = new PageEvaluation(second);
    await firstPage.evaluate(() => { Reflect.set(globalThis, 'answer', 42); });
    expect(await firstPage.evaluate(() => Reflect.get(globalThis, 'answer') as number | undefined)).toBe(42);
    expect(await secondPage.evaluate(() => Reflect.has(globalThis, 'answer'))).toBe(false);
  });

  it('copies input data and awaits the result in the target realm', async () => {
    const userAgent = new UserAgent();
    const target = TopLevelTraversable.create(userAgent, null, '');
    const input = { count: 1 };
    const page = new PageEvaluation(target);
    const result = page.evaluate(({ value, increment }) => {
      value.count += increment;
      return Promise.resolve({ value, inRealm: value instanceof Object });
    }, { value: input, increment: 41 });
    input.count = 100;
    expect(await result).toEqual({ value: { count: 42 }, inRealm: true });
    expect(input.count).toBe(100);
  });

  it('allows automation while document scripting is disabled and reports parse failures', async () => {
    const userAgent = new UserAgent();
    const target = TopLevelTraversable.create(userAgent, null, '');
    userAgent.scriptingEnabled = false;
    const page = new PageEvaluation(target);
    expect(await page.evaluate(() => 42)).toBe(42);
    await expect(page.evaluate('const =')).rejects.toBeInstanceOf(SyntaxError);
  });

  it('cancels old commands and restores exposed callbacks when navigation commits outside Browlet', async () => {
    const userAgent = new UserAgent();
    const target = TopLevelTraversable.create(userAgent, null, '');
    const page = new PageEvaluation(target);
    page.exposeFunction('hostValue', () => 42);
    const pending = page.evaluate(() => new Promise(() => {}));
    const rejected = expect(pending).rejects.toThrow('context was destroyed');
    // The next command confirms that the pending evaluation has entered the page.
    await page.evaluate(() => 0);
    const queued = page.evaluate(() => { Reflect.set(globalThis, 'oldCommandRan', true); });
    const queuedRejected = expect(queued).rejects.toThrow('context was destroyed');

    const url = target.activeWindow!.env.parseURL('https://example.test/next')!;
    const params = target.createNavigationParamsFromSource(url);
    const document = target.createAndInitializeDocument('html', 'text/html', params);
    const entry = target.createHistoryEntry(document, params, '');
    target.finalizeCrossDocumentNavigation('replace', params.userInvolvement, entry);

    await rejected;
    await queuedRejected;
    expect(await page.evaluate(() => {
      const hostValue = Reflect.get(globalThis, 'hostValue') as () => Promise<number>;
      return hostValue();
    })).toBe(42);
    expect(await page.evaluate(() => Reflect.has(globalThis, 'oldCommandRan'))).toBe(false);
  });

  it('rejects pending commands when the active Document is destroyed', async () => {
    const userAgent = new UserAgent();
    const target = TopLevelTraversable.create(userAgent, null, '');
    const document = target.activeDocument!;
    let rejection: unknown;
    const page = new PageEvaluation(target);
    const pending = page.evaluate(() => new Promise(() => {}));
    void pending.catch((error: unknown) => { rejection = error; });
    await page.evaluate(() => 0);

    await new Promise<void>((resolve) => {
      document.env.exec.queueTask('automation', () => {
        document.destroy();
        resolve();
      });
    });
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain('context was destroyed');
  });
});
