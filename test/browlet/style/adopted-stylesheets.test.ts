import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/index';

describe('CSSOM stylesheet collections', () => {
  it('retains the projected array and sheets while mutations update the cascade', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = document.createElement('div');
      document.body.append(target);
      const first = new CSSStyleSheet();
      const second = new CSSStyleSheet();
      first.replaceSync('div { opacity: .2 }');
      second.replaceSync('div { opacity: .7 }');
      const adopted = document.adoptedStyleSheets;
      document.adoptedStyleSheets = [first];
      const values = [getComputedStyle(target).opacity];
      adopted.push(second);
      values.push(getComputedStyle(target).opacity);
      adopted.reverse();
      values.push(getComputedStyle(target).opacity);
      adopted.splice(1, 1);
      values.push(getComputedStyle(target).opacity);
      return {
        stable: adopted === document.adoptedStyleSheets,
        array: Array.isArray(adopted) && Object.getPrototypeOf(adopted) === Array.prototype,
        identity: adopted[0] === second && adopted[0] instanceof CSSStyleSheet,
        associated: document.styleSheets.length,
        values,
      };
    })).toEqual({ stable: true, array: true, identity: true, associated: 0, values: ['0.2', '0.7', '0.2', '0.7'] });
  });

  it('gives each shadow root independent live collections and permits shared constructed sheets', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      document.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const list = shadow.styleSheets;
      const adopted = shadow.adoptedStyleSheets;
      const sheet = new CSSStyleSheet();
      shadow.adoptedStyleSheets = [sheet];
      document.adoptedStyleSheets.push(sheet);
      const style = document.createElement('style');
      style.textContent = 'div { opacity: .4 }';
      shadow.append(style);
      const before = {
        stable: shadow.styleSheets === list && shadow.adoptedStyleSheets === adopted,
        separate: list !== document.styleSheets && adopted !== document.adoptedStyleSheets,
        shared: adopted[0] === sheet && document.adoptedStyleSheets[0] === sheet,
        listed: list instanceof StyleSheetList && list[0] === style.sheet && list.item(0) === style.sheet,
        absent: list.item(1) === null && list[1] === undefined,
        documentLength: document.styleSheets.length,
      };
      style.remove();
      return { before, after: list.length };
    })).toEqual({
      before: { stable: true, separate: true, shared: true, listed: true, absent: true, documentLength: 0 },
      after: 0,
    });
  });

  it('converts all assignment values before mutation and realizes adoption failures in the realm', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const first = new CSSStyleSheet();
      const second = new CSSStyleSheet();
      const style = document.createElement('style');
      document.head.append(style);
      document.adoptedStyleSheets = [first];
      let wrongType = false;
      try { Reflect.set(document, 'adoptedStyleSheets', [second, {}]); }
      catch (error) { wrongType = error instanceof TypeError; }
      const preserved = document.adoptedStyleSheets[0] === first;
      let notConstructed = false;
      try { document.adoptedStyleSheets = [second, style.sheet!]; }
      catch (error) { notConstructed = error instanceof DOMException && error.name === 'NotAllowedError'; }
      return { wrongType, preserved, notConstructed, partial: document.adoptedStyleSheets.length === 1 && document.adoptedStyleSheets[0] === second };
    })).toEqual({ wrongType: true, preserved: true, notConstructed: true, partial: true });
  });

  it('rejects sheets constructed for another document through both assignment and indexed mutation', () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const foreign = new other.window.CSSStyleSheet();
    const adopted = browser.window.document.adoptedStyleSheets;
    for (const mutate of [
      () => { browser.window.document.adoptedStyleSheets = [foreign]; },
      () => { adopted.push(foreign); },
    ]) {
      expect(mutate).toThrow(browser.window.DOMException);
      expect(mutate).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    }
    expect(adopted).toHaveLength(0);
  });

  it('retains collection identities but clears adopted sheets when a shadow host changes document', () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const host = browser.window.document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const adopted = shadow.adoptedStyleSheets;
    const associated = shadow.styleSheets;
    const oldSheet = new browser.window.CSSStyleSheet();
    adopted.push(oldSheet);

    other.window.document.adoptNode(host);

    expect(shadow.adoptedStyleSheets).toBe(adopted);
    expect(shadow.styleSheets).toBe(associated);
    expect(adopted).toHaveLength(0);
    expect(() => adopted.push(oldSheet)).toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    const newSheet = new other.window.CSSStyleSheet();
    adopted.push(newSheet);
    expect(adopted[0]).toBe(newSheet);
    other.window.document.adoptNode(host);
    expect(adopted).toHaveLength(1);
  });
});
