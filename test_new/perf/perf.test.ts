import { Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const htmlStandard = readFileSync(
  //   'test_new/browser/fixtures/slick/template-standard.html',
  'test_new/perf/blob.html',
  'utf8',
);

type EngineName = 'native' | 'nw-current' | 'nw-2.2.23';
type Engine = {
  select(sel: string, ctx: QueryContext): Element[];
  first(sel: string, ctx: QueryContext): Element | null;
  match(sel: string, el: Element): boolean;
  closest(sel: string, el: Element): Element | null;
};
type PerfResult = {
  label: string;
  iters: number;
  ms: number;
  perIter: number;
  result: unknown;
  probe?: unknown;
};

const engines: { name: EngineName; script?: string }[] = [
  { name: 'native' },
  { name: 'nw-current', script: 'dist/nwsapi.js' },
  { name: 'nw-2.2.23', script: 'scratch/nwsapi-2.2.23.0.js' },
];

async function loadFixture(page: Page, markup: string) {
  await page.setContent(markup, { waitUntil: 'load' });
}

async function installNwsapi(page: Page, scriptPath: string) {
  await page.addScriptTag({ path: scriptPath });
}

async function installPerfHelpers(page: Page) {
  await page.evaluate(() => {
    function getNw() {
      const nwdom = (globalThis as any).NW?.Dom;
      if (!nwdom) throw new Error('NWSAPI not found');
      return nwdom;
    }

    const nativeEngine: Engine = {
      select: (s, c) => [...c.querySelectorAll(s)],
      first: (s, c) => c.querySelector(s),
      match: (s, e) => e.matches(s),
      closest: (s, e) => e.closest(s),
    };

    const nwEngine: Engine = {
      select: (s, c) => [...getNw().select(s, c)],
      first: (s, c) => getNw().first(s, c),
      match: (s, e) => getNw().match(s, e),
      closest: (s, e) => getNw().closest(s, e),
    };

    function bench(label: string, fn: () => unknown, iters = 1000): PerfResult {
      for (let i = 0; i < 50; i++) fn();
      const probe = (globalThis as any).NW?.Dom?.snapshot?.probe;
      if (probe) probe.reset?.();

      const t0 = performance.now();
      let result: unknown;
      for (let i = 0; i < iters; i++) result = fn();
      const ms = performance.now() - t0;

      return {
        label,
        iters,
        ms,
        perIter: ms / iters,
        result: summarize(result),
        probe: probe ? { ...probe } : undefined,
      };
    }

    function summarize(value: unknown) {
      if (Array.isArray(value)) return value.length;
      if (value instanceof Element) return value.id || value.localName;
      return value;
    }

    function walkElements(root: Element, fn: (el: Element) => void) {
      const walk = (node: ParentNode) => {
        for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
          fn(child);
          walk(child);
        }
      };
      walk(root);
    }

    function extractletShapedWalk(engine: Engine, root: Element) {
      const groups = [
        ['button', '[popover]', '[data-testid="author-avatar"]'],
        ['textarea', 'div', 'p'],
        ['a[href*="commits"]', '[class*="codeBlobInner"] textarea'],
        ['pre', 'code', '.highlight'],
      ];

      let hits = 0;
      let calls = 0;

      walkElements(root, (el) => {
        for (const group of groups) {
          for (const sel of group) {
            calls++;
            if (engine.match(sel, el)) {
              hits++;
              break;
            }
          }
        }
      });

      return { hits, calls };
    }

    function countWalk(root: Element) {
      let count = 0;
      walkElements(root, () => {
        count++;
      });
      return count;
    }

    function selectorLoopNoMatch(root: Element) {
      const selectors = [
        'button',
        '[popover]',
        '[data-testid="author-avatar"]',
        'textarea',
        'div',
        'p',
        'a[href*="commits"]',
        '[class*="codeBlobInner"] textarea',
        'pre',
        'code',
        '.highlight',
      ];

      let calls = 0;

      walkElements(root, () => {
        for (const _sel of selectors) {
          calls++;
        }
      });

      return { calls };
    }

    function matchWalk(engine: Engine, root: Element, selectors: string[]) {
      let hits = 0;
      let calls = 0;

      walkElements(root, (el) => {
        for (const sel of selectors) {
          calls++;
          if (engine.match(sel, el)) hits++;
        }
      });

      return { hits, calls };
    }

    function runPerf(engineName: 'native' | 'nw'): PerfResult[] {
      const engine = engineName === 'native' ? nativeEngine : nwEngine;
      const root = document.body;

      const selectors = [
        'div',
        '.comment',
        '[data-testid]',
        'a[href*="commits"]',
        'textarea',
        'button',
        '[popover]',
        ':not(button)',
        ':is(div, span, a)',
      ];

      const firstElement = document.body.querySelector('*')!;

      return [
        ...selectors.map((sel) =>
          bench(`select ${sel}`, () => engine.select(sel, root), 200),
        ),
        ...selectors.map((sel) =>
          bench(`first ${sel}`, () => engine.first(sel, root), 500),
        ),
        ...selectors.map((sel) =>
          bench(`match ${sel}`, () => engine.match(sel, firstElement), 5000),
        ),
        bench('walk only', () => countWalk(root), 50),
        bench('selector loop no match', () => selectorLoopNoMatch(root), 50),
        bench('match walk remove group', () =>
          matchWalk(engine, root, ['button', '[popover]', '[data-testid="author-avatar"]']), 20),
        bench('match walk replace group', () =>
          matchWalk(engine, root, ['textarea', 'div', 'p']), 20),
        bench('match walk links group', () =>
          matchWalk(engine, root, ['a[href*="commits"]', '[class*="codeBlobInner"] textarea']), 20),
        bench('match walk code group', () =>
          matchWalk(engine, root, ['pre', 'code', '.highlight']), 20),
        bench('extractlet-shaped match walk', () => extractletShapedWalk(engine, root), 20),
      ];
    }

    Object.assign(window, { __runPerf: runPerf });
  });
}

test('blob fixture comparison', async ({ browser }) => {
  const all: Record<EngineName, PerfResult[]> = {} as any;

  for (const engine of engines) {
    const page = await browser.newPage();
    await loadFixture(page, htmlStandard);
    if (engine.script) await installNwsapi(page, engine.script);
    await installPerfHelpers(page);

    const mode = engine.name === 'native' ? 'native' : 'nw';
    all[engine.name] = await page.evaluate((m) => (window as any).__runPerf(m), mode);

    await page.close();
  }

  printComparison(all);
});

function printComparison(all: Record<EngineName, PerfResult[]>) {
  const native = new Map(all['native'].map((r) => [r.label, r]));
  const old = new Map(all['nw-2.2.23'].map((r) => [r.label, r]));

  const rows = all['nw-current'].map((cur) => {
    const nat = native.get(cur.label)!;
    const prev = old.get(cur.label)!;

    return {
      label: cur.label,
      ms: cur.ms.toFixed(2),
      native: ratio(cur.ms, nat.ms),
      old: ratio(cur.ms, prev.ms),
      probe: JSON.stringify(cur.probe),
      // result: formatResult(cur.result, nat.result, prev.result),
    };
  });

  console.table(rows);

  function ratio(cur: number, base: number) {
    const r = cur / base;
    if (!Number.isFinite(r)) {
      return `${cur.toFixed(2)}/${base.toFixed(2)}`;
    }
    return r.toFixed(2);
  }

  function formatResult(cur: unknown, native: unknown, old: unknown) {
    const curStr = JSON.stringify(cur);
    const natStr = JSON.stringify(native);
    const oldStr = JSON.stringify(old);

    if (curStr !== natStr || curStr !== oldStr) {
      return `MISMATCH cur=${curStr} native=${natStr} old=${oldStr}`;
    }
    return curStr.slice(0, 30);
  }
}
