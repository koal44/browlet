import { describe, expect, it, vi } from 'vitest';

import { styleletEnv as env } from '../../environment-fixture';
import { parseURL } from '../../url-fixture';
import { serializeURL } from '../../../../src/url/core/index';
import { CSSStyleSheetImpl } from '../../../../src/stylelet/cssom/css-stylesheet';
import { CSSImportRuleImpl } from '../../../../src/stylelet/cssom/rules/import';
import { RuleListContext } from '../../../../src/stylelet/cssom/rules/context';
import type { FetchImportedStyleSheet, StyleSheetLoad } from '../../../../src/stylelet/cssom/stylesheet-load';
import { parseStylesheetContents } from '../../../../src/stylelet/syntax/parser';

describe('explicit stylesheet import loading', () => {
  it('retains imports during parsing and starts requests only when asked', () => {
    const sheet = createSheet('@import "a.css";');
    const rule = getImport(sheet);
    expect(rule.parentStyleSheet).toBe(sheet);
    expect(rule.styleSheet).toBeNull();
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    expect(requests.map(({ url }) => url)).toEqual(['https://example.test/a.css']);
    expect(complete).not.toHaveBeenCalled();
  });

  it('completes an import-free sheet without fetching', () => {
    const fetchImport = vi.fn<FetchImportedStyleSheet>();
    const complete = vi.fn();
    const load = createSheet('p { opacity: .5 }').loadImports(fetchImport, complete);
    expect(fetchImport).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
    load.cancel();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('waits for nested imports even after a sibling fails, and shares import associations', () => {
    const sheet = createSheet('@import "a.css" screen; @import "b.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    const imported = createSheet('@import "leaf.css";', 'https://example.test/nested/a.css');
    requests[0]!.complete(imported, true);
    expect(requests[2]!.url).toBe('https://example.test/nested/leaf.css');
    expect(requests[2]!.parent).toBe(imported);
    expect(imported.parentStyleSheet).toBe(sheet);
    expect(imported.ownerRule).toBe(getImport(sheet));
    expect(imported.ownerNode).toBeNull();
    expect(imported.media).toBe(getImport(sheet).media);
    imported.media.mediaText = 'print';
    expect(getImport(sheet).media.mediaText).toBe('print');
    requests[1]!.complete(null, false);
    expect(complete).not.toHaveBeenCalled();
    const leaf = createSheet('', requests[2]!.url);
    requests[2]!.complete(leaf, true);
    expect(getImport(imported).styleSheet).toBe(leaf);
    expect(complete).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('reports a failed grandchild once after an unrelated import finishes', () => {
    const sheet = createSheet('@import "a.css"; @import "b.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    const imported = createSheet('@import "missing.css";', requests[0]!.url);
    requests[0]!.complete(imported, true);
    const failed = createSheet('', requests[2]!.url);
    requests[2]!.complete(failed, false);
    expect(getImport(imported).styleSheet).toBe(failed);
    expect(failed.parentStyleSheet).toBe(imported);
    expect(complete).not.toHaveBeenCalled();
    requests[1]!.complete(createSheet('', requests[1]!.url), true);
    expect(complete).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each([
    { parentClean: true, responseClean: true, clean: true },
    { parentClean: true, responseClean: false, clean: false },
    { parentClean: false, responseClean: true, clean: false },
    { parentClean: false, responseClean: false, clean: false },
  ])('propagates origin-clean through imports (parent=$parentClean, response=$responseClean)', ({ parentClean, responseClean, clean }) => {
    const sheet = createSheet('@import "child.css";', undefined, parentClean);
    const imported = createSheet('@import "leaf.css";', 'https://example.test/child.css', responseClean);
    const leaf = createSheet('p { opacity: .5 }', 'https://example.test/leaf.css');
    const complete = vi.fn();
    sheet.loadImports((url, _rule, loaded) => {
      loaded(serializeURL(url).endsWith('/child.css') ? imported : leaf, true);
      return vi.fn();
    }, complete);
    expect(getImport(sheet).styleSheet).toBe(imported);
    expect(getImport(imported).styleSheet).toBe(leaf);
    for (const child of [imported, leaf]) {
      expect(child.ruleList.length).toBe(1);
      if (clean) {
        expect(child.cssRules.length).toBe(1);
      } else {
        expect(() => child.cssRules).toThrow(expect.objectContaining({ name: 'SecurityError' }));
        expect(() => child.insertRule('p { opacity: 1 }', 1)).toThrow(expect.objectContaining({ name: 'SecurityError' }));
        expect(() => child.deleteRule(0)).toThrow(expect.objectContaining({ name: 'SecurityError' }));
      }
    }
    if (parentClean) expect(sheet.cssRules.length).toBe(1);
    else expect(() => sheet.cssRules).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('keeps repeated imports independent and ignores ancestor cycles including fragments', () => {
    const sheet = createSheet('@import "a.css"; @import "a.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    expect(requests).toHaveLength(2);
    const first = createSheet('@import "root.css#fragment";', requests[0]!.url);
    const second = createSheet('@import "a.css#self";', requests[1]!.url);
    requests[0]!.complete(first, true);
    requests[1]!.complete(second, true);
    expect(requests).toHaveLength(2);
    expect(getImport(sheet, 0).styleSheet).toBe(first);
    expect(getImport(sheet, 1).styleSheet).toBe(second);
    expect(getImport(first).styleSheet).toBeNull();
    expect(getImport(second).styleSheet).toBeNull();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('finishes once after all imports when the supplied fetcher completes synchronously', () => {
    const sheet = createSheet('@import "a.css"; @import "b.css";');
    const urls: string[] = [];
    const complete = vi.fn(() => expect(urls).toHaveLength(2));
    sheet.loadImports((url, _rule, loaded) => {
      urls.push(serializeURL(url));
      loaded(createSheet('', serializeURL(url)), true);
      return vi.fn();
    }, complete);
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('cancels only outstanding requests and discards their late results', () => {
    const sheet = createSheet('@import "a.css"; @import "b.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    const load = sheet.loadImports(fetchImport, complete);
    const imported = createSheet('@import "leaf.css";', requests[0]!.url);
    requests[0]!.complete(imported, true);
    load.cancel();
    load.cancel();
    expect(requests[0]!.cancel).not.toHaveBeenCalled();
    expect(requests[1]!.cancel).toHaveBeenCalledTimes(1);
    expect(requests[2]!.cancel).toHaveBeenCalledTimes(1);
    requests[1]!.complete(createSheet('', requests[1]!.url), true);
    requests[2]!.complete(createSheet('', requests[2]!.url), true);
    expect(getImport(sheet, 1).styleSheet).toBeNull();
    expect(getImport(imported).styleSheet).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    sheet.insertRule('@import "later.css";', 2);
    imported.insertRule('@import "later-leaf.css";', 1);
    expect(requests).toHaveLength(3);
  });

  it('disconnects a completed attempt when cancelled, including its imported sheets', () => {
    const sheet = createSheet('@import "a.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    const load = sheet.loadImports(fetchImport, complete);
    const imported = createSheet('', requests[0]!.url);
    requests[0]!.complete(imported, true);
    load.cancel();
    sheet.insertRule('@import "later.css";', 1);
    imported.insertRule('@import "later-leaf.css";');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.cancel).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('does not attach a response to a rule removed during its request', () => {
    const sheet = createSheet('@import "a.css";');
    const rule = getImport(sheet);
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    sheet.deleteRule(0);
    expect(requests[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
    requests[0]!.complete(createSheet('', requests[0]!.url), true);
    expect(rule.styleSheet).toBeNull();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('loads inserted imports only after connection and successful insertion', () => {
    const sheet = createSheet('');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.insertRule('@import "a.css";');
    expect(requests).toHaveLength(0);
    sheet.loadImports(fetchImport, complete);
    sheet.insertRule('@import "b.css";', 1);
    expect(requests.map(({ url }) => url)).toEqual(['https://example.test/a.css', 'https://example.test/b.css']);
    expect(() => sheet.insertRule('@import "rejected.css";', 3)).toThrow();
    expect(() => sheet.deleteRule(3)).toThrow();
    expect(requests).toHaveLength(2);
    requests[0]!.complete(createSheet('', requests[0]!.url), true);
    expect(complete).not.toHaveBeenCalled();
    requests[1]!.complete(createSheet('', requests[1]!.url), true);
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('starts a new attempt for a later descendant insertion without refetching loaded imports', () => {
    const sheet = createSheet('@import "a.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    const started = vi.fn<(load: StyleSheetLoad) => void>();
    const first = sheet.loadImports(fetchImport, complete, started);
    expect(started).toHaveBeenCalledExactlyOnceWith(first);
    const imported = createSheet('', requests[0]!.url);
    requests[0]!.complete(imported, true);
    imported.insertRule('@import "later.css";');
    expect(started).toHaveBeenCalledTimes(2);
    expect(started.mock.calls[1]![0]).not.toBe(first);
    expect(requests.map(({ url }) => url)).toEqual(['https://example.test/a.css', 'https://example.test/later.css']);
    first.cancel();
    expect(sheet.getImportLoad()).toBe(started.mock.calls[1]![0]);
    expect(requests[1]!.cancel).not.toHaveBeenCalled();
    requests[1]!.complete(createSheet('', requests[1]!.url), true);
    expect(complete.mock.calls).toEqual([[true], [true]]);
    imported.deleteRule(0);
    sheet.insertRule('p { opacity: .5 }', 1);
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('withdraws pending descendants when their importing rule is removed', () => {
    const sheet = createSheet('@import "a.css"; @import "b.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    const imported = createSheet('@import "leaf.css"; @import "other.css";', requests[0]!.url);
    requests[0]!.complete(imported, true);
    const leafRule = getImport(imported);
    sheet.deleteRule(0);
    expect(requests[0]!.cancel).not.toHaveBeenCalled();
    expect(requests[1]!.cancel).not.toHaveBeenCalled();
    expect(requests[2]!.cancel).toHaveBeenCalledTimes(1);
    expect(requests[3]!.cancel).toHaveBeenCalledTimes(1);
    requests[2]!.complete(createSheet('', requests[2]!.url), false);
    expect(leafRule.styleSheet).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    requests[1]!.complete(createSheet('', requests[1]!.url), true);
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
    imported.insertRule('@import "detached.css";', 2);
    expect(requests).toHaveLength(4);
  });

  it('replaces pending imports without finishing between withdrawal and insertion', () => {
    const sheet = createSheet('@import "old.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    const previous = getImport(sheet);
    const replacement = createSheet('@import "new.css";');
    sheet.replaceRules([...replacement.ruleList]);
    expect(requests[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(requests.map(({ url }) => url)).toEqual(['https://example.test/old.css', 'https://example.test/new.css']);
    expect(complete).not.toHaveBeenCalled();
    requests[0]!.complete(createSheet('', requests[0]!.url), false);
    expect(previous.styleSheet).toBeNull();
    requests[1]!.complete(createSheet('', requests[1]!.url), true);
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('publishes each attempt before synchronous completion can insert another import', () => {
    const sheet = createSheet('');
    const events: string[] = [];
    let inserted = false;
    sheet.loadImports((url, _rule, loaded) => {
      events.push(serializeURL(url));
      loaded(createSheet('', serializeURL(url)), true);
      return vi.fn();
    }, () => {
      events.push('complete');
      if (!inserted) {
        inserted = true;
        sheet.insertRule('@import "a.css";');
      }
    }, () => events.push('start'));
    expect(events).toEqual(['start', 'complete', 'start', 'https://example.test/a.css', 'complete']);
  });

  it('stops visiting a branch removed synchronously by the supplied fetcher', () => {
    const sheet = createSheet('@import "a.css";');
    const imported = createSheet('@import "first.css"; @import "second.css";', 'https://example.test/a.css');
    const urls: string[] = [];
    const cancel = vi.fn();
    const complete = vi.fn();
    sheet.loadImports((url, rule, loaded) => {
      urls.push(serializeURL(url));
      if (rule.parentStyleSheet === sheet) loaded(imported, true);
      else if (serializeURL(url).endsWith('/first.css')) sheet.deleteRule(0);
      return cancel;
    }, complete);
    expect(urls).toEqual(['https://example.test/a.css', 'https://example.test/first.css']);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('allows the start notification to cancel before any requests begin', () => {
    const fetchImport = vi.fn<FetchImportedStyleSheet>();
    const complete = vi.fn();
    createSheet('@import "a.css";').loadImports(fetchImport, complete, (load) => load.cancel());
    expect(fetchImport).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('cancels a superseded attempt and retains already associated sheets', () => {
    const sheet = createSheet('@import "a.css";');
    const { fetchImport, requests } = createFetcher();
    const oldComplete = vi.fn();
    sheet.loadImports(fetchImport, oldComplete);
    const imported = createSheet('@import "leaf.css";', requests[0]!.url);
    requests[0]!.complete(imported, true);
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    expect(requests[1]!.cancel).toHaveBeenCalledTimes(1);
    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/a.css', 'https://example.test/leaf.css', 'https://example.test/leaf.css',
    ]);
    requests[1]!.complete(createSheet('', requests[1]!.url), false);
    expect(getImport(imported).styleSheet).toBeNull();
    requests[2]!.complete(createSheet('', requests[2]!.url), true);
    expect(getImport(sheet).styleSheet).toBe(imported);
    expect(oldComplete).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('reports invalid URLs without preventing the remaining requests', () => {
    const sheet = createSheet('@import "https://["; @import "a.css";');
    const { fetchImport, requests } = createFetcher();
    const complete = vi.fn();
    sheet.loadImports(fetchImport, complete);
    expect(requests).toHaveLength(1);
    requests[0]!.complete(createSheet('', requests[0]!.url), true);
    expect(complete).toHaveBeenCalledExactlyOnceWith(false);
  });
});

function createSheet(source: string, href = 'https://example.test/root.css', originClean = true): CSSStyleSheetImpl {
  const location = parseURL(href)!;
  const sheet = new CSSStyleSheetImpl({
    location, baseURL: location, encoding: 'UTF-8', parentStyleSheet: null, ownerRule: null,
    ownerNode: null, media: '', title: '', alternate: false, originClean,
  }, env);
  sheet.replaceRules(parseStylesheetContents(source, new RuleListContext(sheet.ruleList, null, false, env)));
  return sheet;
}

function getImport(sheet: CSSStyleSheetImpl, index = 0): CSSImportRuleImpl {
  const rule = sheet.ruleList.item(index);
  expect(rule).toBeInstanceOf(CSSImportRuleImpl);
  return rule as CSSImportRuleImpl;
}

function createFetcher(): { fetchImport: FetchImportedStyleSheet; requests: ImportRequest[]; } {
  const requests: ImportRequest[] = [];
  const fetchImport: FetchImportedStyleSheet = (url, rule, complete) => {
    const cancel = vi.fn();
    requests.push({ url: serializeURL(url), parent: rule.parentStyleSheet!, complete, cancel });
    return cancel;
  };
  return { fetchImport, requests };
}

type ImportRequest = {
  url: string;
  parent: CSSStyleSheetImpl;
  complete: (sheet: CSSStyleSheetImpl | null, success: boolean) => void;
  cancel: () => void;
};
