import { test, chromium, expect, firefox, webkit } from '@playwright/test';
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { assertNever, type Permutations } from '../../../src/shared/util';
import {
  BROWSER_NAMES, type BrowserName, type ContextRef, type Engine,
  type Expectation, type RunScenariosOptions, type Scenario,
  type ScenariosStatus, type ScenarioStatus, type ScenarioStep,
  type TestCase,
} from '../harness';
import { installBrowserHelpers, type PwHelpers } from './page';

type HarnessMode = 'normal' | 'fixme';
const rawHarnessMode = process.env.HARNESS_MODE;
if (rawHarnessMode !== undefined && rawHarnessMode !== 'normal' && rawHarnessMode !== 'fixme') {
  throw new Error(`Invalid HARNESS_MODE: ${rawHarnessMode}`);
}
const HARNESS_MODE: HarnessMode = rawHarnessMode ?? 'normal';

type EngineResult = ReturnType<PwHelpers['toEngineResult']>;
type EngineAndQueryResult = ReturnType<PwHelpers['getResults']>;
type NamedQueryResult = Parameters<PwHelpers['compareQueryResults']>[0];
type EvalResult = {
  info: string;
  mismatchMsg?: string;
  equivMismatchMsg?: string;
  engineResults: Partial<Record<Engine, EngineResult>>;
};

type PassTracker = { passedEverywhere: boolean; resultInfo: string; stepIndex: number; caseIndex: number; };
type PassTrackers = Partial<Record<number, PassTracker>>;

type CaseInfo = {
  browser: BrowserName;
  scenario: Scenario;
  case: TestCase;
  stepIndex: number;
  caseIndex: number;
  stepCaseIndex: number;
  misfails: PassTrackers;
  misfixes: PassTrackers;
};

export function runScenarios(label: string, status: ScenariosStatus, scenarios: Scenario[], options: RunScenariosOptions = {}): void {
  const describeFn = getDescribeFn(status);
  describeFn(label, () => {
    if (options.parallel) {
      test.describe.configure({ mode: 'parallel' });
    }

    let browsers: Record<BrowserName, Browser>;
    let contexts: Record<BrowserName, BrowserContext>;
    let pages: Record<BrowserName, Page>;

    test.beforeAll(async () => {
      browsers = {
        chromium: await chromium.launch(),
        firefox: await firefox.launch(),
        webkit: await webkit.launch(),
      };

      contexts = {
        chromium: await browsers.chromium.newContext(),
        firefox: await browsers.firefox.newContext(),
        webkit: await browsers.webkit.newContext(),
      };

      for (const context of Object.values(contexts)) {
        await blockExternalRequests(context);
      }

      pages = {
        chromium: await contexts.chromium.newPage(),
        firefox: await contexts.firefox.newPage(),
        webkit: await contexts.webkit.newPage(),
      };

      for (const page of Object.values(pages)) {
        attachPageDiagnostics(page);
        await page.setContent('<!doctype html><html><body></body></html>');
      }
    });

    test.afterAll(async () => {
      await Promise.all(BROWSER_NAMES.map((name) => browsers[name].close()));
    });

    const scenarioHas = (s: Scenario, status: 'only' | 'fixme'): boolean =>
      s.status === status ||
      !!s.cases?.some((c) => c.status === status) ||
      !!s.steps?.some((step) => step.cases.some((c) => c.status === status));

    const hasScenariosOnly = scenarios.some((s) => scenarioHas(s, 'only'));

    for (const s of scenarios) {
      const hasFixme = scenarioHas(s, 'fixme');
      if (HARNESS_MODE === 'fixme' && !hasFixme) continue;

      const hasOnly = scenarioHas(s, 'only');
      if (hasScenariosOnly && !hasOnly) continue;

      const testFn = getTestFn(s.status);
      testFn(s.name, async ({ browserName: _browserName }, testInfo) => {
        if (s.timeout !== undefined) testInfo.setTimeout(s.timeout);
        await runScenario(s, pages);
      });
    }
  });
}

async function runScenario(s: Scenario, pages: Record<BrowserName, Page>): Promise<void> {
  const scenarioBrowsers = s.browsers ?? BROWSER_NAMES;

  // cases marked fail/fixme and whether they passed in every applicable browser so far
  const misfails: PassTrackers = {};
  const misfixes: PassTrackers = {};

  if (s.steps?.length && s.cases?.length) {
    throw new Error(`${s.name}: use either steps or top-level cases, not both`);
  }

  const steps: ScenarioStep[] = [
    ...(s.steps ?? []),
    ...(s.cases?.length ? [{ cases: s.cases }] : []),
  ];

  const hasOnlyCases = steps.some((step) => step.cases.some((c) => c.status === 'only'));

  for (const browserName of scenarioBrowsers) {
    const page = pages[browserName];
    const wrappedPage = s.markupMode === 'xml-document' ? wrapPageForXml(page) : page;

    await initPage(wrappedPage, s);

    let stepCaseIndex = 0;
    for (let stepIndex = 0; stepIndex < steps.length; ++stepIndex) {
      const step = steps[stepIndex];
      if (step.setupPage) {
        await step.setupPage(wrappedPage);
        await ensureHarnessInstalled(wrappedPage);
      }
      for (let caseIndex = 0; caseIndex < step.cases.length; ++caseIndex) {
        const c = step.cases[caseIndex];
        if (hasOnlyCases && c.status !== 'only') continue;
        await runCase(
          page,
          {
            browser: browserName, scenario: s, case: c,
            stepIndex, caseIndex, stepCaseIndex, misfails, misfixes,
          }
        );
        stepCaseIndex++;
      }
    }
  }

  // At the end of the scenario, check if any 'fail' or 'fixme' cases passed unexpectedly
  const throwOnUnexpectedPass = (kind: 'fail' | 'fixme', trackers: PassTrackers) => {
    for (const tracker of Object.values(trackers)) {
      if (!tracker?.passedEverywhere) continue;
      throw new Error(
        `${s.name}\n` +
        `Step #${tracker.stepIndex + 1}, Case #${tracker.caseIndex + 1} · Marked '${kind}' but passed unexpectedly.\n` +
        `Query: ${tracker.resultInfo}`
      );
    }
  };

  throwOnUnexpectedPass('fail', misfails);
  throwOnUnexpectedPass('fixme', misfixes);
}

async function runCase(page: Page, caseInfo: CaseInfo): Promise<void> {
  const { scenario: s, case: c, stepIndex, caseIndex, stepCaseIndex } = caseInfo;

  if (c.status === 'skip') return;
  if (s.status !== 'fixme' && HARNESS_MODE === 'fixme' && c.status !== 'fixme') {
    return;
  }
  if (c.browsers && !c.browsers.includes(caseInfo.browser)) return;
  c.engines = c.engines ?? s.engines;

  const result = await evalCase(page, caseInfo);
  const expectation = c.expect ?? {};

  let thrown: Error | undefined;

  try {
    checkResult(result, expectation, caseInfo);
  } catch (err) {
    thrown = err instanceof Error ? err : new Error(String(err));
  }

  const status = c.status ?? 'normal';

  if (status === 'normal' || status === 'only') {
    if (thrown) throw thrown;
    return;
  }

  const updatePassTracker = (trackers: PassTrackers) => {
    const prevPassed = trackers[stepCaseIndex]?.passedEverywhere ?? true;
    trackers[stepCaseIndex] = {
      passedEverywhere: !thrown && prevPassed,
      resultInfo: trackers[stepCaseIndex]?.resultInfo ?? result.info,
      stepIndex,
      caseIndex,
    };
  };

  if (status === 'fail') {
    updatePassTracker(caseInfo.misfails);
    return;
  }

  { // status is 'fixme'
    updatePassTracker(caseInfo.misfixes);
    if (thrown && HARNESS_MODE === 'fixme') throw thrown;
    return;
  }
}

async function evalCase(page: Page, caseInfo: CaseInfo): Promise<EvalResult> {
  return await page.evaluate(({ c, isXml } ) => {
    const pw = window.__pwHelpers;
    const doc = isXml ? window.__pwXml : window.document;
    const sxlt = selectlet;
    if (!sxlt) throw new Error('selectlet is not available');
    if (c.debug) {
      sxlt.snapshot.setDebug(true);
      sxlt.snapshot.clearDebug();
    }

    const query = pw.getCaseQuery(c);
    const ctx = pw.resolveContext(doc, c.ref);
    const ctxErrorMsg = ctx ? undefined : `Could not resolve context from ref: ${pw.stringify(c.ref)}`;

    const equivCase = c.expect?.equivalentCase;
    const equivQuery = equivCase ? pw.getCaseQuery(equivCase) : undefined;
    const equivCtx = equivCase ? pw.resolveContext(doc, equivCase.ref) : null;
    const equivCtxErrorMsg = equivCase && !equivCtx
      ? `Could not resolve equivalent context from ref: ${pw.stringify(equivCase.ref)}`
      : undefined;
    let equivMismatchMsg = equivCase && (pw.isRehomed(c.ref) || pw.isRehomed(equivCase.ref))
      ? `Equivalent-case assertion unsupported because one or more contexts were rehomed.\n` +
      `Identity-based equivalence is only supported for document-backed contexts.\n` +
      `  case context: ${pw.stringify(c.ref)}${pw.isRehomed(c.ref) ? ' (rehomed)' : ''}\n` +
      `  equivalent case context: ${pw.stringify(equivCase.ref)}${pw.isRehomed(equivCase.ref) ? ' (rehomed)' : ''}`
      : undefined;

    const allEngines: Permutations<Engine> = ['native', 'selectlet'];
    const engines = c.engines ?? allEngines;
    const engineResults: Partial<Record<Engine, EngineAndQueryResult>> = {};
    const makeNamedQr = (tc: TestCase, ng: Engine, res: EngineAndQueryResult, suffix = ''): NamedQueryResult =>
      ({ name: `${ng}${suffix}:${pw.getCaseLabel(tc, ng)}`, result: res.queryResult });

    let mismatchMsg: string | undefined;
    let firstNamedQr: NamedQueryResult | undefined;

    for (const engine of engines) {
      const fn = pw.getEngineQuery(c, engine);
      const res = pw.getResults(fn, query, ctx, ctxErrorMsg);
      engineResults[engine] = res;

      const namedQr = makeNamedQr(c, engine, res);
      if (!mismatchMsg && firstNamedQr) {
        mismatchMsg = pw.compareQueryResults(firstNamedQr, namedQr);
      }
      firstNamedQr ??= namedQr;

      if (!equivMismatchMsg && equivCase && equivQuery) {
        const equivFn = pw.getEngineQuery(equivCase, engine);
        const equivRes = pw.getResults(equivFn, equivQuery, equivCtx, equivCtxErrorMsg);
        equivMismatchMsg ??= pw.compareQueryResults(
          namedQr,
          makeNamedQr(equivCase, engine, equivRes, 'Equiv')
        );
      }
    }

    if (c.debug) {
      const debugText = sxlt.snapshot.printDebug();
      sxlt.snapshot.setDebug(false);
      throw new Error(debugText);
    }

    return {
      info: query, mismatchMsg, equivMismatchMsg,
      engineResults: Object.fromEntries(
        engines.map((engine) => [engine, engineResults[engine]!.engineResult])
      ),
    };
  }, { c: caseInfo.case, isXml: caseInfo.scenario.markupMode === 'xml-document' });
}

type DescribeFn = (title: string, callback: () => void) => void;
function getDescribeFn(mode?: ScenariosStatus): DescribeFn {
  if (mode === 'skip') return (title, callback) => test.describe.skip(title, callback);
  if (mode === 'only') return (title, callback) => test.describe.only(title, callback);
  // if (mode === 'fixme') return (title, callback) => test.describe.fixme(title, callback);
  return (title, callback) => test.describe(title, callback);
}

type TestFn = (
  title: string,
  callback: (_fixtures: { browserName: string; }, testInfo: TestInfo) => Promise<void>
) => void;
function getTestFn(mode?: ScenarioStatus): TestFn {
  if (mode === 'skip') return (title, callback) => test.skip(title, callback);
  if (mode === 'only') return (title, callback) => test.only(title, callback);
  if (mode === 'fixme') {
    if (HARNESS_MODE === 'fixme') return test;
    return (title, callback) => test.fixme(title, callback);
  }
  if (mode === 'fail') return test.fail;
  return test;
}

async function initPage(page: Page, scenario: Scenario): Promise<void> {
  const targetUrl = scenario.url ?? 'about:blank';

  if (scenario.url) {
    await page.route(scenario.url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body></body></html>',
      });
    });

    await page.goto(scenario.url);
  }

  if (scenario.markupMode === 'xml-document') {
    await page.goto(targetUrl);
    await page.setContent(`<!DOCTYPE html><html><body>dummy content</body></html>`);
    await page.evaluate((xmlString) => {
      const xml = new DOMParser().parseFromString(xmlString, 'text/xml');
      if (xml.getElementsByTagName('parsererror').length) {
        throw new Error(`invalid xml-document markup: ${xml.documentElement.textContent}`);
      }
      window.__pwXml = xml;
    }, scenario.markup);
  } else if (scenario.markupMode === 'html-document') {
    const hasHtml = /<html[\s>]/i.test(scenario.markup.trim());
    if (!hasHtml) {
      throw new Error(`markupMode="html-document" requires full HTML document markup including <html>`);
    }
    await page.goto(targetUrl);
    await page.setContent(scenario.markup);
  } else { // scenario.markupMode === 'html-body' || !scenario.markupMode
    await page.goto(targetUrl);
    await page.setContent(`<!doctype html><html><body>${scenario.markup}</body></html>`);
  }

  await ensureHarnessInstalled(page);

  if (scenario.setupPage) {
    await scenario.setupPage(page);
    await ensureHarnessInstalled(page);
  }
}

async function ensureHarnessInstalled(page: Page): Promise<void> {
  const state = await page.evaluate(() => ({
    hasHelpers: !!window.__pwHelpers,
    hasCreateSelectlet: typeof window.createSelectlet === 'function',
    hasStylelet: typeof window.Stylelet === 'function',
    hasSxlt: !!window.selectlet && typeof window.selectlet.select === 'function',
    hasStlt: !!window.stylelet && typeof window.stylelet.createStyleSheet === 'function',
  })).catch(() => ({
    hasHelpers: false,
    hasCreateSelectlet: false,
    hasStylelet: false,
    hasSxlt: false,
    hasStlt: false,
  }));

  if (!state.hasHelpers) {
    await page.evaluate(installBrowserHelpers);
  }

  if (!state.hasCreateSelectlet) {
    await installScript(page, 'packages/selectlet/dist/selectlet.js');
  }

  if (!state.hasStylelet) {
    await installScript(page, 'packages/stylelet/dist/stylelet.js');
  }

  if (!state.hasSxlt || !state.hasStlt) {
    await page.evaluate(() => {
      window.selectlet = window.createSelectlet(document) as typeof selectlet;
      window.stylelet = new window.Stylelet(document);
    });
  }
}

async function installScript(page: Page, path: string): Promise<void> {
  const script = await page.addScriptTag({ path });
  await script.evaluate((element) => element.parentNode?.removeChild(element));
}

function runEngineChecks(
  result: EvalResult,
  baseMsg: string,
  key: keyof EngineResult,
  check: (r: EngineResult, label: string) => void
): void {
  const entries = Object.entries(result.engineResults) as [Engine, EngineResult][];

  const sameIds = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);

  const sameJson = (a: unknown, b: unknown): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

  for (const [, r] of entries) {
    const enginesWithSameOutcome = entries
      .filter(([, other]) => {
        switch (key) {
          case 'count':   return r.count === other.count;
          case 'ids':     return sameIds(r.ids, other.ids);
          case 'classes': return sameIds(r.classes, other.classes);
          case 'threw':   return r.threw === other.threw;
          case 'error':   return true; // errors can differ even if threw is the same, so ignore them for grouping purposes
          case 'value':   return r.value === other.value;
          case 'cssom':   return sameJson(r.cssom, other.cssom);
          case 'supported': return r.supported === other.supported;
          default:        return assertNever(key);
        }
      })
      .map(([engine]) => engine);

    const engineLabel = ` · Engines=${enginesWithSameOutcome.join('+')}${baseMsg}`;
    check(r, engineLabel);
  }
}

function checkResult(result: EvalResult, expectation: Expectation, caseInfo: CaseInfo): void {
  const { stepIndex, caseIndex, browser, scenario: s } = caseInfo;
  const header = `${s.name}\nStep #${stepIndex + 1}, Case #${caseIndex + 1} · Browser=${browser}`;
  const msg =
    `\nQuery: ${result.info}` +
    `\nContext: ${formatContextRef(caseInfo.case.ref)}` +
    `${result.mismatchMsg ? `\n\n${result.mismatchMsg}` : ''}`;

  runEngineChecks(result, msg, 'threw', (r, nglabel) => {
    const errLabel = `Expected ${expectation.throws ? 'a throw' : 'no throw'}, got ${r.threw ? 'a throw' : 'no throw'}.` +
      (r.error ? `\nThrown error: ${r.error}` : '');
    expect(r.threw, `${errLabel}\n\n${header}${nglabel}`).toBe(expectation.throws ?? false);
  });
  if (expectation.throws) return;

  if (expectation.count !== undefined) {
    runEngineChecks(result, msg, 'count', (r, ngLabel) => {
      const errLabel = `Expected count ${expectation.count}, got ${r.count}.`;
      expect(r.count, `${errLabel}\n\n${header}${ngLabel}`).toEqual(expectation.count);
    });
  }

  if (expectation.ids) {
    runEngineChecks(result, msg, 'ids', (r, ngLabel) => {
      const errLabel = `Expected ids ${JSON.stringify(expectation.ids)}, got ${JSON.stringify(r.ids)}.`;
      expect(r.ids, `${errLabel}\n\n${header}${ngLabel}`).toEqual(expectation.ids);
    });
  }

  if (expectation.includesIds) {
    for (const id of expectation.includesIds) {
      runEngineChecks(result, msg, 'ids', (r, ngLabel) => {
        const errLabel = `Expected ids to include ${JSON.stringify(id)}, got ${JSON.stringify(r.ids)}.`;
        expect(r.ids, `${errLabel}\n\n${header}${ngLabel}`).toContain(id);
      });
    }
  }

  if (expectation.excludesIds) {
    for (const id of expectation.excludesIds) {
      runEngineChecks(result, msg, 'ids', (r, ngLabel) => {
        const errLabel = `Expected ids not to include ${JSON.stringify(id)}, got ${JSON.stringify(r.ids)}.`;
        expect(r.ids, `${errLabel}\n\n${header}${ngLabel}`).not.toContain(id);
      });
    }
  }

  if (expectation.classes) {
    runEngineChecks(result, msg, 'classes', (r, ngLabel) => {
      const errLabel = `Expected classes ${JSON.stringify(expectation.classes)}, got ${JSON.stringify(r.classes)}.`;
      expect(r.classes, `${errLabel}\n\n${header}${ngLabel}`).toEqual(expectation.classes);
    });
  }

  if (expectation.includesClasses) {
    for (const cls of expectation.includesClasses) {
      runEngineChecks(result, msg, 'classes', (r, ngLabel) => {
        const errLabel = `Expected classes to include ${JSON.stringify(cls)}, got ${JSON.stringify(r.classes)}.`;
        const classTokens = r.classes.flatMap((s) => s.trim() ? s.trim().split(/\s+/) : []);
        expect(classTokens, `${errLabel}\n\n${header}${ngLabel}`).toContain(cls);
      });
    }
  }

  if (expectation.excludesClasses) {
    for (const cls of expectation.excludesClasses) {
      runEngineChecks(result, msg, 'classes', (r, ngLabel) => {
        const errLabel = `Expected classes not to include ${JSON.stringify(cls)}, got ${JSON.stringify(r.classes)}.`;
        const classTokens = r.classes.flatMap((s) => s.trim() ? s.trim().split(/\s+/) : []);
        expect(classTokens, `${errLabel}\n\n${header}${ngLabel}`).not.toContain(cls);
      });
    }
  }

  if (expectation.value !== undefined) {
    runEngineChecks(result, msg, 'value', (r, ngLabel) => {
      const errLabel = `Expected value ${JSON.stringify(expectation.value)}, got ${JSON.stringify(r.value)}.`;
      expect(r.value, `${errLabel}\n\n${header}${ngLabel}`).toEqual(expectation.value);
    });
  }

  if (expectation.cssom !== undefined) {
    runEngineChecks(result, msg, 'cssom', (r, ngLabel) => {
      const errLabel =
        `Expected CSSOM ${JSON.stringify(expectation.cssom)}, got ${JSON.stringify(r.cssom)}.`;

      if (expectation.cssom === null) {
        expect(r.cssom, `${errLabel}\n\n${header}${ngLabel}`).toBeNull();
        return;
      }
      expect(r.cssom, `${errLabel}\n\n${header}${ngLabel}`).toMatchObject(expectation.cssom!);
    });
  }

  if (expectation.supported !== undefined) {
    runEngineChecks(result, msg, 'supported', (r, ngLabel) => {
      const errLabel = `Expected supported=${expectation.supported}, got ${r.supported}.`;
      expect(r.supported, `${errLabel}\n\n${header}${ngLabel}`).toBe(expectation.supported);
    });
  }

  expect(!!result.mismatchMsg, `Expected engine agreement, but they differed.\n\n${header}${msg}`).toBe(false);

  if (expectation.equivalentCase) {
    const errLabel = `Expected this case to match its equivalent case, but it did not.`;
    const equivMismatch = !!result.equivMismatchMsg;
    expect(equivMismatch, `${errLabel}\n\n${header}${msg}\n${result.equivMismatchMsg}`).toBe(false);
  }
}

function formatContextRef(ref?: ContextRef): string {
  if (!ref) return 'document';
  let base: string;
  switch (ref.by) {
    case 'document': base = 'document'; break;
    case 'id': base = `id(${ref.id})`; break;
    case 'first': base = `first(${ref.selector})`; break;
    case 'documentElement': base = 'documentElement'; break;
    case 'iframe': base = `iframe(${ref.id})`; break;
    case 'template': base = `template(${ref.id})`; break;
    case 'shadowRoot': base = `shadowRoot(${ref.id})`; break;
    default: assertNever(ref);
  }
  if ('home' in ref && ref.home) base += `:${ref.home}`;
  if ('within' in ref && ref.within) base = `${formatContextRef(ref.within)} > ${base}`;
  return base;
}

function wrapPageForXml(page: Page): Page {
  return new Proxy(page, {
    get(target, prop, receiver) {
      if (prop !== 'evaluate') return Reflect.get(target, prop, receiver) as unknown;

      return async (fn: unknown, arg?: unknown) => {
        if (typeof fn !== 'function') {
          throw new Error('xml proxy currently supports only function evaluate callbacks');
        }

        const fnSource = fn.toString();

        return target.evaluate(({ fnSource, arg }) => {
          window.__pwArg = arg;
          try {
            return eval(`
              (() => {
                const document = window.__pwXml;
                const fn = (${fnSource});
                return fn(window.__pwArg);
              })()
            `) as unknown;
          } finally {
            delete window.__pwArg;
          }
        }, { fnSource, arg });
      };
    },
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

async function blockExternalRequests(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    const { hostname } = new URL(url);

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'test.local'
    ) {
      await route.fallback();
      return;
    }

    throw new Error(`Unexpected external request in browser test: ${url}`);
  });
}
