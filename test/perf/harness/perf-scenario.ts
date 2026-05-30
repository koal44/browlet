/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { chromium, firefox, webkit, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

type EngineName = 'native' | 'nw-2.2.23' | 'selectlet';
type EngineTarget = { name: EngineName; script?: string; };

const DEFAULT_ENGINES: EngineTarget[] = [
  { name: 'native' },
  { name: 'nw-2.2.23', script: 'test/perf/engines/nwsapi-2.2.23.js' },
  { name: 'selectlet', script: 'dist/selectlet.js' },
];

export type PerfHelpers = {
  runBenches(
    engineName: EngineName,
    benches: Bench[],
    options?: { quickIters?: number; focused?: boolean; },
  ): BenchResult[];
}

const BROWSER_NAMES = ['chromium', 'firefox', 'webkit'] as const;
type BrowserName = typeof BROWSER_NAMES[number];

type PerfScenarioStatus = 'normal' | 'skip' | 'only';

type BenchOps = {
  match(sel: string, el: Element): boolean;
  select(sel: string, ctx: QueryContext): Element[];
  first(sel: string, ctx: QueryContext): Element | null;
  closest(sel: string, el: Element): Element | null;
  byId(id: string, ctx: QueryContext): Element | null;
  byClass(cls: string, ctx: QueryContext): Element[];
  byTag(tag: string, ctx: QueryContext): Element[];
  byTagNs(byTagNs: { ns: string | null; local: string; }, ctx: QueryContext): Element[];
};

type MatchBench =   { op: 'match';     selector:  string;    ref:  ContextRef; } & BenchBase;
type SelectBench =  { op: 'select';    selector:  string;    ref?: ContextRef; } & BenchBase;
type FirstBench =   { op: 'first';     selector:  string;    ref?: ContextRef; } & BenchBase;
type ClosestBench = { op: 'closest';   selector:  string;    ref:  ContextRef; } & BenchBase;
type WalkBench =    { op: 'matchWalk'; selectors: string[];  ref?: ContextRef; } & BenchBase;
type ByIdBench =    { op: 'byId';      id:        string;    ref?: ContextRef; } & BenchBase;
type ByClassBench = { op: 'byClass';   cls:       string;    ref?: ContextRef; } & BenchBase;
type ByTagBench =   { op: 'byTag';     tag:       string;    ref?: ContextRef; } & BenchBase;
// Note: byTagNs perf won't really be useful as the comparisons would be apples ≈ apples.
type ByTagNsBench = { op: 'byTagNs';   byTagNs:   { ns: string | null; local: string; }; ref?: ContextRef; } & BenchBase;

type BenchBase = { label?: string; iters: number; maxRatio?: number; quickIters?: number; debug?: boolean; cold?: boolean; };
type Bench =
  MatchBench | SelectBench | FirstBench | ClosestBench | WalkBench | ByIdBench | ByClassBench | ByTagBench | ByTagNsBench;

export type ContextRef =
  | { by: 'document'; }
  | { by: 'id'; id: string; home?: ContextHome; within?: ContextRef; }
  | { by: 'first'; selector: string; home?: ContextHome; within?: ContextRef; }
  | { by: 'documentElement'; home?: ContextHome; }
  | { by: 'iframe'; id: string; within?: ContextRef; }
  | { by: 'template'; id: string; within?: ContextRef; }
  | { by: 'shadowRoot'; id: string; within?: ContextRef; };

export type ContextHome = 'document' | 'detached' | 'fragment';

type PerfScenario = {
  name: string;
  status?: PerfScenarioStatus;
  browsers?: BrowserName[];
  engines?: EngineName[];
  markup: string;
  markupMode?: 'html-body' | 'html-document' | 'xml-document';
  setupPage?: (page: Page) => void | Promise<void>;
  probeKeys?: string[];
  benches: Bench[];
  quickIters?: number;
};

type BenchResult = {
  label: string;
  iters: number;
  ms: number;
  perIter: number;
  result: unknown;
  probe?: Record<string, unknown>;
  maxRatio: number;
};

type GlobalWithNW = typeof globalThis & { NW?: { Dom: NWDom; }; };
type NWDom = {
  match(sel: string, el: Element): boolean;
  select(sel: string, ctx: QueryContext): Element[];
  first(sel: string, ctx: QueryContext): Element | null;
  closest(sel: string, el: Element): Element | null;
  byId(id: string, ctx: QueryContext): Element | null;
  byClass(cls: string, ctx: QueryContext): Element[];
  byTag(tag: string, ctx: QueryContext): Element[];

  snapshot?: {
    probe?: { reset?: () => void; } & Record<string, unknown>;
    clearCache?: () => void;
    setDebug?: (enabled: boolean) => void;
    clearDebug?: () => void;
    printDebug?: () => string;
  };
}

export function runPerfScenarios(label: string, scenarios: PerfScenario[]): void {
  const hasOnly = scenarios.some((s) => s.status === 'only');
  const active = hasOnly ? scenarios.filter((s) => s.status === 'only') : scenarios;

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
      for (const name of BROWSER_NAMES) await browsers[name]?.close();
    });

    for (const scenario of scenarios) {
      if (hasOnly && scenario.status !== 'only') continue;

      const testFn = getTestFn(scenario.status);
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
  const engineNames: EngineName[] = [...(scenario.engines ?? DEFAULT_ENGINES.map((e) => e.name))];
  if (!engineNames.includes('selectlet')) engineNames.push('selectlet');
  const scenarioEngines = resolveEngines(engineNames);

  for (const browserName of scenarioBrowsers) {
    const browser = browsers[browserName];
    if (!browser) throw new Error(`Browser not available: ${browserName}`);

    const all: Partial<Record<EngineName, BenchResult[]>> = {};

    for (const { name, script } of scenarioEngines) {
      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        attachPageDiagnostics(page);
        await initPage(page, scenario);

        if (script) await installEngine(page, script);
        if (scenario.setupPage) await scenario.setupPage(page);
        await installPerfHelpers(page);

        all[name] = await page.evaluate(
          ({ name, benches, quickIters, focused }) =>
            window.__perfHelpers.runBenches(name, benches, { quickIters, focused }),
          {
            name,
            benches: scenario.benches,
            quickIters: scenario.quickIters,
            focused: scenario.status === 'only',
          },
        );
      } finally {
        await context.close();
      }
    }

    const { rows, failedMaxRatio } = buildTable(all, 'selectlet', scenario.probeKeys ?? []);

    if (scenario.status === 'only' || failedMaxRatio) {
      console.log(`\n[perf:${browserName}] ${scenario.name}`);
      console.table(rows);
    }
  }
}

function buildTable(all: Partial<Record<EngineName, BenchResult[]>>, currentName: EngineName, probeKeys: string[]) {
  const current = all[currentName];
  if (!current) throw new Error(`Missing current perf engine: ${currentName}`);

  const displayLabels = uniqueDisplayLabels(current.map((r) => r.label), 56);

  let failedMaxRatio = false;
  const rows = Object.fromEntries(current.map((cur, i) => {
    const row: Record<string, unknown> = {
      ms: cur.ms.toFixed(2),
    };

    for (const [name, results] of Object.entries(all)) {
      if (name === currentName) continue;
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

    return warn && Number.isFinite(r) ? `${out}⚠` : out;
  }

  function pickProbe(probe?: Record<string, unknown>, keys?: string[]) {
    if (!probe || !keys?.length) return probe;
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = probe[key];
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
        const root = xml.documentElement as Element | null;
        throw new Error(`invalid xml-document markup: ${root?.textContent ?? 'unknown error'}`);
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

type TestFn = (title: string, callback: () => Promise<void>) => void;

function getTestFn(status?: PerfScenarioStatus): TestFn {
  if (status === 'skip') return (title, callback) => test.skip(title, callback);
  if (status === 'only') return (title, callback) => test.only(title, callback);
  return (title, callback) => test(title, callback);
}

function resolveEngines(names: EngineName[]): EngineTarget[] {
  return names.map((name) => {
    const engine = DEFAULT_ENGINES.find((e) => e.name === name);
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

async function installEngine(page: Page, scriptPath: string) {
  await page.addScriptTag({ path: scriptPath });
}

async function installPerfHelpers(page: Page) {
  await page.evaluate(() => {
    const DEFAULT_MAX_RATIO = 5;

    function getEngineApi(engineName: EngineName): null | typeof selectlet | NWDom {
      if (engineName === 'native') return null;
      if (engineName === 'nw-2.2.23') return (globalThis as GlobalWithNW).NW?.Dom;
      if (engineName === 'selectlet') return globalThis.selectlet;
      return assertNever(engineName);
    }

    function runBench(engineName: EngineName, b: Bench, fn: () => unknown, iters: number): BenchResult {
      const label = benchLabel(b);
      const maxRatio = b.maxRatio ?? DEFAULT_MAX_RATIO;

      for (let i = 0; i < 10; i++) fn();

      const api = getEngineApi(engineName);
      const probe = api?.snapshot?.probe;
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
      if (isElement(value)) return value.getAttribute('id') || value.localName;
      return value;
    }

    function walkElements(root: QueryContext, fn: (el: Element) => void) {
      if (isElement(root)) {
        fn(root);
        walkChildren(root, fn);
        return;
      }

      if (isDocument(root)) {
        const el = root.documentElement as Element | null;
        if (el) {
          fn(el);
          walkChildren(el, fn);
        }
        return;
      }

      // docfrag
      walkChildren(root, fn);
    }

    function walkChildren(root: ParentNode, fn: (el: Element) => void) {
      for (let child = root.firstElementChild; child; child = child.nextElementSibling) {
        fn(child);
        walkChildren(child, fn);
      }
    }

    function matchWalk(ops: BenchOps, root: QueryContext, selectors: string[]) {
      let hits = 0;
      let calls = 0;

      walkElements(root, (el) => {
        for (const sel of selectors) {
          calls++;
          if (ops.match(sel, el)) hits++;
        }
      });

      return { hits, calls };
    }

    function runBenches(
      engineName: EngineName,
      benches: Bench[],
      options: { quickIters?: number; focused?: boolean; } = {},
    ): BenchResult[] {
      const labels = benches.map(benchLabel);
      assertUniqueBenchLabels(labels);

      const hasDebugBench = benches.some((b) => b.debug);
      if (hasDebugBench) {
        if (engineName !== 'selectlet') return [];
        if (!supportsDebug(engineName)) return [];
      }

      const ops = getBenchOps(engineName);

      let clearCache: (() => void) | undefined;
      if (engineName !== 'native' && benches.some((b) => b.cold)) {
        const api = getEngineApi(engineName);

        const clearCacheFn = api?.snapshot?.clearCache;
        if (typeof clearCacheFn !== 'function') {
          throw new Error(`${engineName}.clearCache is not available`);
        }

        clearCache = () => clearCacheFn();
      }

      function benchFn<T>(b: Bench, fn: () => T): () => T {
        if (engineName === 'native' || !b.cold) return fn;
        return () => { clearCache!(); return fn(); };
      }

      return benches.map((b, i) => {
        const label = labels[i];
        const ctx = resolveContext(b.ref);
        const iters = options.focused
          ? b.iters
          : b.quickIters ?? options.quickIters ?? b.iters;

        switch (b.op) {
          case 'match':
            if (!isElement(ctx)) throw new Error(`${label}: match needs Element context`);
            if (b.debug) debugBench(engineName, label, () => ops.match(b.selector, ctx));
            return runBench(engineName, b, benchFn(b, () => ops.match(b.selector, ctx)), iters);

          case 'select':
            if (b.debug) debugBench(engineName, label, () => ops.select(b.selector, ctx));
            return runBench(engineName, b, benchFn(b, () => ops.select(b.selector, ctx)), iters);

          case 'first':
            if (b.debug) debugBench(engineName, label, () => ops.first(b.selector, ctx));
            return runBench(engineName, b, benchFn(b, () => ops.first(b.selector, ctx)), iters);

          case 'closest':
            if (!isElement(ctx)) throw new Error(`${label}: closest needs Element context`);
            if (b.debug) debugBench(engineName, label, () => ops.closest(b.selector, ctx));
            return runBench(engineName, b, benchFn(b, () => ops.closest(b.selector, ctx)), iters);

          case 'matchWalk':
            if (b.debug) debugBench(engineName, label, () => matchWalk(ops, ctx, b.selectors));
            return runBench(engineName, b, benchFn(b, () => matchWalk(ops, ctx, b.selectors)), iters);

          case 'byId':
            return runBench(engineName, b, benchFn(b, () => ops.byId(b.id, ctx)), iters);

          case 'byClass':
            return runBench(engineName, b, benchFn(b, () => ops.byClass(b.cls, ctx)), iters);

          case 'byTag':
            return runBench(engineName, b, benchFn(b, () => ops.byTag(b.tag, ctx)), iters);

          case 'byTagNs':
            return runBench(engineName, b, benchFn(b, () => ops.byTagNs(b.byTagNs, ctx)), iters);

          default:
            return assertNever(b);
        }
      });
    }

    function getBenchOps(engineName: EngineName): BenchOps {
      if (engineName === 'native') {
        return {
          match: (s, e) => e.matches(s),
          select: (s, c) => [...c.querySelectorAll(s)],
          first: (s, c) => c.querySelector(s),
          closest: (s, e) => e.closest(s),
          byId: (id, ctx) => queryId(ctx, id),
          byClass: (cls, ctx) => queryClass(ctx, cls),
          byTag: (tag, ctx) => queryTag(ctx, tag),
          byTagNs: (byTagNs, ctx) => queryTagNs(ctx, byTagNs),
        };
      }

      if (engineName === 'nw-2.2.23') {
        const nwdom = (globalThis as GlobalWithNW).NW?.Dom;
        if (!nwdom) throw new Error('NW.Dom is not available');

        return {
          match: (s, e) => nwdom.match(s, e),
          select: (s, c) => [...nwdom.select(s, c)],
          first: (s, c) => nwdom.first(s, c),
          closest: (s, e) => nwdom.closest(s, e),
          byId: (id, ctx) => nwdom.byId(id, ctx),
          byClass: (cls, ctx) => nwdom.byClass(cls, ctx),
          byTag: (tag, ctx) => nwdom.byTag(tag, ctx),
          byTagNs: () => { throw new Error('NW.Dom does not support byTagNs'); },
        };
      }

      if (engineName === 'selectlet') {
        const sxlt = globalThis.selectlet;
        if (!sxlt) throw new Error('selectlet is not available');

        return {
          match: (s, e) => sxlt.matches(s, e),
          select: (s, c) => [...sxlt.select(s, c)],
          first: (s, c) => sxlt.first(s, c),
          closest: (s, e) => sxlt.closest(s, e),
          byId: (id, ctx) => sxlt.byId(id, ctx),
          byClass: (cls, ctx) => sxlt.byClass(cls, ctx) as Element[],
          byTag: (tag, ctx) => sxlt.byTag(tag, ctx) as Element[],
          byTagNs: (byTagNs, ctx) => sxlt.byTagNs(byTagNs.ns, byTagNs.local, ctx) as Element[],
        };
      }

      return assertNever(engineName);
    }

    function benchLabel(b: Bench): string {
      if (b.label) return b.label;
      const cold = b.cold ? '-cold:' : '-hot:';

      switch (b.op) {
        case 'match':
        case 'select':
        case 'first':
        case 'closest':
          return `${b.op}${cold} ${b.selector}`;
        case 'matchWalk':
          return `${b.op}${cold} ${b.selectors.join(', ')}`;
        case 'byId':    return `${b.op}${cold} ${b.id}`;
        case 'byClass': return `${b.op}${cold} ${b.cls}`;
        case 'byTag':   return `${b.op}${cold} ${b.tag}`;
        case 'byTagNs': return `${b.op}${cold} ${b.byTagNs.ns ? `${b.byTagNs.ns}|` : ''}${b.byTagNs.local}`;
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

    function resolveContext(ref?: ContextRef): QueryContext {
      const doc = window.__perfXml ?? document;
      if (!ref || ref.by === 'document') return doc;

      const base = 'within' in ref && ref.within ? resolveContext(ref.within) : doc;

      if (ref.by === 'iframe') {
        const iframe = queryId(base, ref.id);
        if (!isIFrameElement(iframe)) {
          throw new Error(`Missing iframe context: ${JSON.stringify(ref)}`);
        }
        const child = iframe.contentDocument;
        if (!child) {
          throw new Error(`Iframe has no contentDocument: ${JSON.stringify(ref)}`);
        }
        return child;
      }

      if (ref.by === 'template') {
        const tmpl = queryId(base, ref.id);
        if (!isTemplateElement(tmpl)) {
          throw new Error(`Missing template context: ${JSON.stringify(ref)}`);
        }
        return tmpl.content;
      }

      if (ref.by === 'shadowRoot') {
        const host = queryId(base, ref.id);
        if (!host) {
          throw new Error(`Missing shadow host: ${JSON.stringify(ref)}`);
        }
        if (!host.shadowRoot) {
          throw new Error(`Host has no shadowRoot: ${JSON.stringify(ref)}`);
        }
        return host.shadowRoot;
      }

      const el = ref.by === 'id' ? queryId(base, ref.id)
        : ref.by === 'first' ? base.querySelector(ref.selector)
        : ref.by === 'documentElement' ? doc.documentElement
        : assertNever(ref);

      if (!el) {
        throw new Error(`Missing context element: ${JSON.stringify(ref)}`);
      }

      const home: ContextHome = ref.home ?? 'document';
      if (home === 'document') return el;

      const clone = el.cloneNode(true);
      if (!isElement(clone)) {
        throw new Error(`Context clone is not an Element: ${JSON.stringify(ref)}`);
      }

      if (home === 'detached') return clone;

      if (home === 'fragment') {
        const frag = doc.createDocumentFragment();
        frag.appendChild(clone);
        return frag;
      }

      return assertNever(home);
    }

    function isElement(x: unknown): x is Element {
      return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 1;
    }

    function isDocument(x: unknown): x is Document {
      return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 9;
    }

    function isDocumentFragment(x: unknown): x is DocumentFragment {
      return typeof x === 'object' && x !== null && 'nodeType' in x && x.nodeType === 11;
    }

    function isHtmlElement(x: unknown): x is HTMLElement {
      return isElement(x) && x.namespaceURI === 'http://www.w3.org/1999/xhtml';
    }

    function isIFrameElement(x: unknown): x is HTMLIFrameElement {
      return isHtmlElement(x) && x.localName === 'iframe';
    }

    function isTemplateElement(x: unknown): x is HTMLTemplateElement {
      return isHtmlElement(x) && x.localName === 'template';
    }

    // Native fallbacks approximate missing Element/Fragment APIs for perf only.
    // Some paths use selector-backed approximations rather than exact native API equivalents.
    function queryId(base: QueryContext, id: string): Element | null {
      if (isDocument(base) || isDocumentFragment(base)) return base.getElementById(id);
      return base.querySelector(`#${CSS.escape(id)}`);
    }

    function queryClass(base: QueryContext, cls: string): Element[] {
      if (isDocument(base) || isElement(base)) return [...base.getElementsByClassName(cls)];
      return [...base.querySelectorAll(`.${CSS.escape(cls)}`)];
    }

    function queryTag(base: QueryContext, tag: string): Element[] {
      if (isDocument(base) || isElement(base)) return [...base.getElementsByTagName(tag)];
      return [...base.querySelectorAll(tag)];
    }

    function queryTagNs(base: QueryContext, q: { ns: string | null; local: string; }): Element[] {
      const { ns, local } = q;
      if (!isDocumentFragment(base)) {
        return [...base.getElementsByTagNameNS(ns, local)];
      }
      const nodes: Element[] = [];
      for (let root = base.firstElementChild; root; root = root.nextElementSibling) {
        if ((ns === '*' || root.namespaceURI === ns) && (local === '*' || root.localName === local)) {
          nodes.push(root);
        }
        nodes.push(...root.getElementsByTagNameNS(ns, local));
      }
      return nodes;
    }

    function assertNever(value: never, message?: string): never {
      throw new Error(message ?? `Unexpected value: ${String(value)}`);
    }

    function debugBench(engineName: EngineName, label: string, fn: () => unknown): never {
      const api = getEngineApi(engineName);

      const setDebug = api?.snapshot?.setDebug;
      const clearDebug = api?.snapshot?.clearDebug;
      const printDebug = api?.snapshot?.printDebug;
      if (!setDebug || !clearDebug || !printDebug) {
        throw new Error(`${engineName} debug is not available`);
      }

      setDebug(true);
      clearDebug();

      try {
        fn();
        throw new Error(`[perf debug] ${label}\n${printDebug()}`);
      } finally {
        setDebug(false);
      }
    }

    function supportsDebug(engineName: EngineName): boolean {
      const api = getEngineApi(engineName);
      return !!(
        api && api.snapshot &&
        typeof api.snapshot.setDebug === 'function' &&
        typeof api.snapshot.clearDebug === 'function' &&
        typeof api.snapshot.printDebug === 'function'
      );
    }

    window.__perfHelpers = {
      runBenches,
    };

  });
}
