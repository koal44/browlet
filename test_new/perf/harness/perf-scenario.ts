import { chromium, firefox, webkit, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

export interface PerfHelpers {
  runPerfBenches(
    engineName: 'native' | 'nw',
    benches: PerfBench[],
    options?: { quickIters?: number, focused?: boolean },
  ): BenchResult[];
}

const BROWSER_NAMES = ['chromium', 'firefox', 'webkit'] as const;
type BrowserName = typeof BROWSER_NAMES[number];

type PerfScenarioStatus = 'normal' | 'skip' | 'only';

type Engine = {
  select(sel: string, ctx: QueryContext): Element[];
  first(sel: string, ctx: QueryContext): Element | null;
  match(sel: string, el: Element): boolean;
  closest(sel: string, el: Element): Element | null;
};
type EngineName = 'native' | 'nw-current' | 'nw-2.2.23';

type PerfEngine = {
  name: EngineName;
  script?: string;
};

type PerfOp = 'select' | 'first' | 'match' | 'closest' | 'matchWalk';

type SelectBench =  { op: 'select';    selector:  string;    context?: string | null } & PerfBenchBase;
type FirstBench =   { op: 'first';     selector:  string;    context?: string | null } & PerfBenchBase;
type MatchBench =   { op: 'match';     selector:  string;    context:  string        } & PerfBenchBase;
type ClosestBench = { op: 'closest';   selector:  string;    context:  string        } & PerfBenchBase;
type WalkBench =    { op: 'matchWalk'; selectors: string[];  context?: string | null } & PerfBenchBase;

type PerfBenchBase = { label?: string; iters: number; maxRatio?: number, quickIters?: number, debug?: boolean };
type PerfBench = SelectBench | FirstBench | MatchBench | ClosestBench | WalkBench;

type PerfScenario = {
  name: string;
  status?: PerfScenarioStatus;
  browsers?: BrowserName[];
  engines?: EngineName[];
  markup: string;
  markupMode?: 'html-body' | 'html-document' | 'xml-document';
  setupPage?: (page: Page) => void | Promise<void>;
  probeKeys?: string[];
  benches: PerfBench[];
  quickIters?: number;
};

type BenchResult = {
  label: string;
  iters: number;
  ms: number;
  perIter: number;
  result: unknown;
  probe?: unknown;
  maxRatio: number;
};

const DEFAULT_ENGINES: PerfEngine[] = [
  { name: 'native' },
  { name: 'nw-2.2.23', script: 'test_new/perf/engines/nwsapi-2.2.23.js' },
  { name: 'nw-current', script: 'dist/nwsapi.js' },
];

export function runPerfScenarios(label: string, scenarios: PerfScenario[]): void {
  const hasOnly = scenarios.some(s => s.status === 'only');
  const active = hasOnly ? scenarios.filter(s => s.status === 'only') : scenarios;

  const browserSet = new Set<BrowserName>();
  for (const s of active) {
    for (const b of s.browsers ?? BROWSER_NAMES) browserSet.add(b);
  }

  test.describe(label, () => {
    let browsers: Record<BrowserName, Browser | null>;

    test.beforeAll(async () => {
      browsers = {
        chromium: browserSet.has('chromium') ? await chromium.launch() : null,
        firefox: browserSet.has('firefox') ? await firefox.launch() : null,
        webkit: browserSet.has('webkit') ? await webkit.launch() : null,
      };
    });

    test.afterAll(async () => {
      await Promise.all(BROWSER_NAMES.map((name) => browsers[name]?.close()));
    });

    for (const scenario of scenarios) {
      if (hasOnly && scenario.status !== 'only') continue;

      const testFn = getPerfTestFn(scenario.status);
      testFn(scenario.name, async () => {
        await runPerfScenario(scenario, browsers);
      });
    }
  });
}

async function runPerfScenario(
  scenario: PerfScenario,
  browsers: Record<BrowserName, Browser | null>,
): Promise<void> {
  const scenarioBrowsers = scenario.browsers ?? BROWSER_NAMES;
  const engineNames: EngineName[] = [...(scenario.engines ?? DEFAULT_ENGINES.map(e => e.name))];
  if (!engineNames.includes('nw-current')) engineNames.push('nw-current');
  const scenarioEngines = resolvePerfEngines(engineNames);

  for (const browserName of scenarioBrowsers) {
    const browser = browsers[browserName];
    if (!browser) throw new Error(`Browser not available: ${browserName}`);

    const all: Record<EngineName, BenchResult[]> = {} as any;

    for (const engine of scenarioEngines) {
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        attachPageDiagnostics(page);
        await initPage(page, scenario);

        if (scenario.setupPage) await scenario.setupPage(page);
        if (engine.script) await installNwsapi(page, engine.script);
        await installPerfHelpers(page);

        const mode: 'native' | 'nw' = engine.name === 'native' ? 'native' : 'nw';

        all[engine.name] = await page.evaluate(
          ({ mode, benches, quickIters, focused }) =>
            window.__perfHelpers.runPerfBenches(mode, benches, { quickIters, focused }),
          {
            mode,
            benches: scenario.benches,
            quickIters: scenario.quickIters,
            focused: scenario.status === 'only',
          },
        );
      } finally {
        await context.close();
      }
    }

    const { rows, failedMaxRatio } = buildTable(all, 'nw-current', scenario.probeKeys ?? []);

    if (scenario.status === 'only' || failedMaxRatio) {
      console.log(`\n[perf:${browserName}] ${scenario.name}`);
      console.table(rows);
    }
  }
}

function buildTable(all: Record<EngineName, BenchResult[]>, currentName: EngineName, probeKeys: string[]) {
  const current = all[currentName];
  if (!current) throw new Error(`Missing current perf engine: ${currentName}`);

  const displayLabels = uniqueDisplayLabels(current.map(r => r.label), 56);

  let failedMaxRatio = false;
  const rows = Object.fromEntries(current.map((cur, i) => {
    const row: Record<string, unknown> = {
      ms: cur.ms.toFixed(2),
    };

    for (const [name, results] of Object.entries(all)) {
      if (name === currentName || !results) continue;
      const base = results.find((r) => r.label === cur.label);
      if (!base) { row[name] = 'missing'; continue; }
      const r = base.ms > 0 ? cur.ms / base.ms : Infinity;
      const missedMaxRatio = name === 'native' && r > cur.maxRatio;
      if (missedMaxRatio) failedMaxRatio = true;
      row[name] = ratio(cur.ms, base.ms, missedMaxRatio);
    }

    row.probe = JSON.stringify(pickProbe(cur.probe, probeKeys));

    return [displayLabels[i], row];
  }));

  return { rows, failedMaxRatio };

  function ratio(cur: number, base: number, warn = false) {
    const r = cur / base;
    const out = Number.isFinite(r)
      ? r.toFixed(2)
      : `${cur.toFixed(2)}/${base.toFixed(2)}`;

    return warn ? `${out}⚠` : out;
  }

  function pickProbe(probe: unknown, keys?: string[]) {
    if (!probe || !keys?.length) return probe;
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = (probe as any)[key];
    return out;
  }

  function uniqueDisplayLabels(labels: string[], max = 56): string[] {
    const seen = new Set<string>();

    return labels.map((label) => {
      let out = truncateLabel(label, max);

      if (!seen.has(out)) {
        seen.add(out);
        return out;
      }

      let n = 2;

      while (true) {
        const suffix = ` (${n})`;
        const base = truncateLabel(label, Math.max(0, max - suffix.length));
        out = `${base}${suffix}`;

        if (!seen.has(out)) {
          seen.add(out);
          return out;
        }

        n++;
      }
    });
  }

  function truncateLabel(label: string, max: number): string {
    if (label.length <= max) return label;
    if (max <= 1) return label.slice(0, max);
    return `${label.slice(0, max - 1)}…`;
  }
}

async function initPage(page: Page, scenario: PerfScenario): Promise<void> {
  if (scenario.markupMode === 'xml-document') {
    await page.setContent('<!doctype html><html><body>dummy content</body></html>');
    await page.evaluate((xmlString) => {
      const xml = new DOMParser().parseFromString(xmlString, 'text/xml');
      if (xml.getElementsByTagName('parsererror').length) {
        throw new Error(`invalid xml-document markup: ${xml.documentElement?.textContent ?? 'parsererror'}`);
      }
      window.__perfXml = xml;
    }, scenario.markup);
    return;
  }

  if (scenario.markupMode === 'html-document') {
    if (!/<html[\s>]/i.test(scenario.markup.trim())) {
      throw new Error(`markupMode="html-document" requires full HTML document markup including <html>`);
    }
    await page.setContent(scenario.markup, { waitUntil: 'load' });
    return;
  }

  await page.setContent(`<!doctype html><html><body>${scenario.markup}</body></html>`, {
    waitUntil: 'load',
  });
}

function getPerfTestFn(status?: PerfScenarioStatus) {
  if (status === 'skip') return test.skip;
  if (status === 'only') return test.only;
  return test;
}

function resolvePerfEngines(names: EngineName[]): PerfEngine[] {
  return names.map((name) => {
    const engine = DEFAULT_ENGINES.find(e => e.name === name);
    if (!engine) throw new Error(`Unknown perf engine: ${name}`);
    return engine;
  });
}

function attachPageDiagnostics(page: Page): void {
  page.on('pageerror', (err) => { throw err; });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes('Cookie')) return;
    console.error(`[browser console:${msg.type()}] ${msg.text()}`);
  });

  page.on('requestfailed', (request) => {
    console.error(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
}

async function installNwsapi(page: Page, scriptPath: string) {
  await page.addScriptTag({ path: scriptPath });
}

async function installPerfHelpers(page: Page) {
  await page.evaluate(() => {
    const DEFAULT_MAX_RATIO = 5;

    function bench(label: string, fn: () => unknown, iters = 1000, maxRatio = DEFAULT_MAX_RATIO): BenchResult {
      for (let i = 0; i < 50; i++) fn();
      const probe = (globalThis as any).NW?.Dom?.snapshot?.probe;
      if (probe) probe.reset?.();

      const t0 = performance.now();
      let result: unknown;
      for (let i = 0; i < iters; i++) result = fn();
      const ms = performance.now() - t0;

      return {
        label, iters, ms, maxRatio,
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

    function matchWalk(engine: Engine, root: Element | Document, selectors: string[]) {
      root = root instanceof Element ? root : root.documentElement;
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

    function runPerfBenches(
      engineName: 'native' | 'nw',
      benches: PerfBench[],
      options: { quickIters?: number, focused?: boolean } = {},
    ): BenchResult[] {
      const labels = benches.map(perfBenchLabel);
      assertUniqueBenchLabels(labels);

      const hasDebugBench = benches.some(b => b.debug);
      if (hasDebugBench) {
        if (engineName === 'native') return [];
        if (!supportsNwDebug()) return [];
      }

      const engine = getEngine(engineName);

      return benches.map((b, i) => {
        const label = labels[i];
        const ctx = resolvePerfContext(b.context);
        const iters = options.focused
          ? b.iters
          : b.quickIters ?? options.quickIters ?? b.iters;

        switch (b.op) {
          case 'match':
            if (!(ctx instanceof Element)) throw new Error(`${label}: match needs Element context`);
            if (b.debug) debugBench(label, () => engine.match(b.selector, ctx));
            return bench(label, () => engine.match(b.selector, ctx), iters, b.maxRatio);

          case 'closest':
            if (!(ctx instanceof Element)) throw new Error(`${label}: closest needs Element context`);
            if (b.debug) debugBench(label, () => engine.closest(b.selector, ctx));
            return bench(label, () => engine.closest(b.selector, ctx), iters, b.maxRatio);

          case 'select':
            if (b.debug) debugBench(label, () => engine.select(b.selector, ctx));
            return bench(label, () => engine.select(b.selector, ctx), iters, b.maxRatio);

          case 'first':
            if (b.debug) debugBench(label, () => engine.first(b.selector, ctx));
            return bench(label, () => engine.first(b.selector, ctx), iters, b.maxRatio);

          case 'matchWalk':
            if (b.debug) debugBench(label, () => matchWalk(engine, ctx, b.selectors));
            return bench(label, () => matchWalk(engine, ctx, b.selectors), iters, b.maxRatio);

          default:
            return assertNever(b);
        }
      });
    }

    function getEngine(engineName: 'native' | 'nw'): Engine {
      if (engineName === 'native') {
        return {
          select: (s, c) => [...c.querySelectorAll(s)],
          first: (s, c) => c.querySelector(s),
          match: (s, e) => e.matches(s),
          closest: (s, e) => e.closest(s),
        };
      }

      const nwDom = (globalThis as any).NW?.Dom;
      if (!nwDom) throw new Error('NW.Dom is not available');

      return {
        select: (s, c) => [...nwDom.select(s, c)],
        first: (s, c) => nwDom.first(s, c),
        match: (s, e) => nwDom.match(s, e),
        closest: (s, e) => nwDom.closest(s, e),
      };
    }

    function perfBenchLabel(b: PerfBench): string {
      if (b.label) return b.label;

      switch (b.op) {
        case 'select':
        case 'first':
        case 'match':
        case 'closest':
          return `${b.op} ${b.selector}`;

        case 'matchWalk':
          return `${b.op} ${b.selectors.join(', ')}`;

        default:
          return assertNever(b);
      }
    }

    function assertUniqueBenchLabels(labels: string[]): void {
      const seen = new Set<string>();
      const dupes = new Set<string>();

      for (const label of labels) {
        if (seen.has(label)) dupes.add(label);
        else seen.add(label);
      }

      if (dupes.size) {
        throw new Error(`Duplicate bench labels: ${[...dupes].join(', ')}`);
      }
    }

    function resolvePerfContext(ref?: string | null): Document | Element {
      const doc = window.__perfXml ?? document;
      if (ref == null) return doc;

      const el = doc.getElementById(ref);
      if (!el) throw new Error(`Missing perf context: #${ref}`);
      return el;
    }

    function assertNever(value: never, message?: string): never {
      throw new Error(message ?? `Unexpected value: ${value}`);
    }

    function debugBench(label: string, fn: () => unknown): never {
      const nwdom = (globalThis as any).NW?.Dom;
      if (
        !nwdom ||
        typeof nwdom.setDebug !== 'function' ||
        typeof nwdom.clearDebug !== 'function' ||
        typeof nwdom.printDebug !== 'function'
      ) {
        throw new Error('NW.Dom debug is not available');
      }

      nwdom.setDebug(true);
      nwdom.clearDebug();

      try {
        fn();
        throw new Error(`[perf debug] ${label}\n${nwdom.printDebug()}`);
      } finally {
        nwdom.setDebug(false);
      }
    }

    function supportsNwDebug(): boolean {
      const nwdom = (globalThis as any).NW?.Dom;
      return !!(
        nwdom &&
        typeof nwdom.setDebug === 'function' &&
        typeof nwdom.clearDebug === 'function' &&
        typeof nwdom.printDebug === 'function'
      );
    }

    window.__perfHelpers = {
      runPerfBenches,
    };

  });
}
