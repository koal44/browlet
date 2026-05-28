import { test } from 'vitest';
import { getJsdomVariant, type JsdomEngineName as EngineName } from '../harness/engines';
import { createJsdomPage, type JsdomPage as Page } from '../harness/page';
import { initDom, type ContextRef } from '../harness/scenarios';
import { assertNever, cssEscape, isDocument, isDocumentFragment, isElement } from '../../utils/util';
import { resolveContext } from '../harness/case';

const MAX_LABEL_LENGTH = 32;
const DEFAULT_MAX_RATIO = 1;
const DEFAULT_ENGINES: EngineName[] = [
  'sx-vendor',
  'selectlet',
  'nwsapi',
  'dom-selector',
];

export type PerfScenarioStatus = 'normal' | 'skip' | 'only';

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

type BenchBase = { label?: string; iters: number; maxRatio?: number; quickIters?: number; };
export type Bench =
  MatchBench | SelectBench | FirstBench | ClosestBench | WalkBench | ByIdBench | ByClassBench | ByTagBench | ByTagNsBench;

export type PerfScenario = {
  name: string;
  status?: PerfScenarioStatus;
  engines?: EngineName[];
  markup: string;
  markupMode?: 'html-body' | 'html-document' | 'xml-document';
  setupPage?: (page: Page) => void | Promise<void>;
  benches: Bench[];
  quickIters?: number;
  url?: string;
};

type BenchResult = {
  label: string;
  iters: number;
  ms: number;
  perIter: number;
  result: unknown;
  maxRatio: number;
};

export function runPerfScenarios(label: string, scenarios: PerfScenario[]): void {
  const hasOnly = scenarios.some((s) => s.status === 'only');

  test.describe(label, () => {
    for (const scenario of scenarios) {
      if (hasOnly && scenario.status !== 'only') continue;

      const testFn = getTestFn(scenario.status);

      testFn(scenario.name, async () => {
        await runPerfScenario(scenario);
      });
    }
  });
}

async function runPerfScenario(scenario: PerfScenario): Promise<void> {
  const engineNames = scenario.engines ?? DEFAULT_ENGINES;
  if (!engineNames.length) throw new Error(`${scenario.name}: expected at least one engine`);
  const current = engineNames[0];
  const all: Partial<Record<EngineName, BenchResult[]>> = {};

  for (const engine of engineNames) {
    const { JSDOM } = getJsdomVariant(engine);
    const dom = initDom(JSDOM, scenario);
    const { document } = dom.window;

    try {
      const page = createJsdomPage(dom);

      if (scenario.setupPage) {
        await scenario.setupPage(page);
      }

      all[engine] = runBenches(document, scenario.benches, {
        quickIters: scenario.quickIters,
        focused: scenario.status === 'only',
      });
    } finally {
      dom.window.close();
    }
  }

  const { rows, failedMaxRatio } = buildTable(all, current);

  if (scenario.status === 'only' || failedMaxRatio) {
    console.log(`\n[jsdom/${current} perf] ${scenario.name}`);
    console.table(rows);
  }
}

function buildTable(all: Partial<Record<EngineName, BenchResult[]>>, currentName: EngineName) {
  const current = all[currentName];
  if (!current) throw new Error(`Missing current perf engine: ${currentName}`);

  const displayLabels = uniqueDisplayLabels(current.map((r) => r.label), MAX_LABEL_LENGTH);

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
      const missedMaxRatio = r > cur.maxRatio;
      if (missedMaxRatio) failedMaxRatio = true;
      row[name] = ratio(cur.ms, base.ms, missedMaxRatio);
    }

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

type TestFn = (title: string, callback: () => Promise<void>) => void;

function getTestFn(status?: PerfScenarioStatus): TestFn {
  if (status === 'skip') return (title, callback) => test.skip(title, callback);
  if (status === 'only') return (title, callback) => test.only(title, callback);
  return (title, callback) => test(title, callback);
}

function runBench(b: Bench, fn: () => unknown, iters: number): BenchResult {
  const label = benchLabel(b);
  const maxRatio = b.maxRatio ?? DEFAULT_MAX_RATIO;

  for (let i = 0; i < 10; i++) fn();

  const t0 = performance.now();
  let result: unknown;
  for (let i = 0; i < iters; i++) result = fn();
  const ms = performance.now() - t0;

  return {
    label, iters, ms, maxRatio,
    perIter: ms / iters,
    result: summarize(result),
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
  doc: Document,
  benches: Bench[],
  options: { quickIters?: number; focused?: boolean; } = {},
): BenchResult[] {
  const labels = benches.map(benchLabel);
  assertUniqueBenchLabels(labels);

  const ops = getBenchOps();

  return benches.map((b, i) => {
    const label = labels[i];
    const ctx = resolveContext(doc, b.ref);
    if (!ctx) throw new Error(`${label}: missing context ${JSON.stringify(b.ref)}`);
    const iters = options.focused
      ? b.iters
      : b.quickIters ?? options.quickIters ?? b.iters;

    switch (b.op) {
      case 'match':
        if (!isElement(ctx)) throw new Error(`${label}: match needs Element context`);
        return runBench(b, () => ops.match(b.selector, ctx), iters);

      case 'select':
        return runBench(b, () => ops.select(b.selector, ctx), iters);

      case 'first':
        return runBench(b, () => ops.first(b.selector, ctx), iters);

      case 'closest':
        if (!isElement(ctx)) throw new Error(`${label}: closest needs Element context`);
        return runBench(b, () => ops.closest(b.selector, ctx), iters);

      case 'matchWalk':
        return runBench(b, () => matchWalk(ops, ctx, b.selectors), iters);

      case 'byId':
        return runBench(b, () => ops.byId(b.id, ctx), iters);

      case 'byClass':
        return runBench(b, () => ops.byClass(b.cls, ctx), iters);

      case 'byTag':
        return runBench(b, () => ops.byTag(b.tag, ctx), iters);

      case 'byTagNs':
        return runBench(b, () => ops.byTagNs(b.byTagNs, ctx), iters);

      default:
        return assertNever(b);
    }
  });
}

function getBenchOps(): BenchOps {
  return {
    match: (s, e) => e.matches(s),
    select: (s, c) => [...c.querySelectorAll(s)],
    first: (s, c) => c.querySelector(s),
    closest: (s, e) => e.closest(s),
    byId: (id, ctx) => queryId(ctx, id),
    byClass: (cls, ctx) => queryClass(ctx, cls),
    byTag: (tag, ctx) => queryTag(ctx, tag),
    byTagNs: (q, ctx) => queryTagNs(ctx, q),
  };
}

function benchLabel(b: Bench): string {
  if (b.label) return b.label;

  switch (b.op) {
    case 'match':
    case 'select':
    case 'first':
    case 'closest':
      return `${b.op} ${b.selector}`;
    case 'matchWalk':
      return `${b.op} ${b.selectors.join(', ')}`;
    case 'byId':    return `${b.op} ${b.id}`;
    case 'byClass': return `${b.op} ${b.cls}`;
    case 'byTag':   return `${b.op} ${b.tag}`;
    case 'byTagNs': return `${b.op} ${b.byTagNs.ns ? `${b.byTagNs.ns}|` : ''}${b.byTagNs.local}`;
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

// DOM lookup helpers for byId/byClass/byTag benches.
// Some fragment paths use selector-backed approximations for perf only.
function queryId(base: QueryContext, id: string): Element | null {
  if (isDocument(base) || isDocumentFragment(base)) return base.getElementById(id);
  return base.querySelector(`#${cssEscape(id)}`);
}

function queryClass(base: QueryContext, cls: string): Element[] {
  if (isDocument(base) || isElement(base)) return [...base.getElementsByClassName(cls)];
  return [...base.querySelectorAll(`.${cssEscape(cls)}`)];
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
