import { describe, test } from 'vitest';
import type {
  Scenario, ScenariosStatus, TestCase, RunScenariosOptions, ContextRef, ScenarioStep,
  ContextHome, Expectation, MarkupMode,
} from '../../browser/harness/scenarios';
export type {
  Scenario, ScenariosStatus, TestCase, RunScenariosOptions, ContextRef, ScenarioStep,
  ContextHome, Expectation,
};
import { getJsdomVariant } from './engines';
import type { JSDOM as JsdomInst } from 'jsdom';
export type { JSDOM as JsdomInst } from 'jsdom';
import type * as JsdomMod from 'jsdom';
export type * as JsdomMod from 'jsdom';
import { hydrateDeclarativeShadowRoots, hydrateIframeSrcdocs, installSelectletShim, patchComputedStyleForWindow, patchIframeSrcdoc } from './patches';
import { createJsdomPage } from './page';
import { formatCaseHeader, runCase, thrownMessage, type CaseInfo } from './case';

const STACK_TRACE = false;
const ONLY = process.env.ONLY;

type JsdomCtor = typeof JsdomMod.JSDOM;

export function runScenarios(
  label: string, status: ScenariosStatus, scenarios: Scenario[], _opts: RunScenariosOptions = {}
): void {
  const { engine, JSDOM } = getJsdomVariant();
  const describeFn = getDescribeFn(status);

  const hasAnyOnly = scenarios.some((s) => scenarioHas(s, 'only'));
  const respectOnly = ONLY || hasAnyOnly;

  if (ONLY && !hasAnyOnly) {
    test.skip(`jsdom/${engine}/${label} [!ONLY]`, () => {});
    return;
  }

  describeFn(`jsdom/${engine}/${label}`, () => {
    for (const s of scenarios) {
      const hasOnly = scenarioHas(s, 'only');
      if (respectOnly && !hasOnly) continue;

      const skipReason = getScenarioSkipReason(s);
      const testFn = skipReason ? test.skip : getTestFn(s.status);
      const name = skipReason ? `${s.name} [${skipReason}]` : s.name;

      testFn(name, async () => {
        await runScenario(s, JSDOM);
      }, s.timeout);
    }
  });
}

async function runScenario(s: Scenario, jsdom: JsdomCtor): Promise<void> {
  if (s.steps?.length && s.cases?.length) {
    throw new Error(`${s.name}: use either steps or top-level cases, not both`);
  }

  const steps: ScenarioStep[] = s.steps ?? (s.cases?.length ? [{ cases: s.cases }] : []);
  const hasOnlyCases = steps.some((step) => step.cases.some((c) => c.status === 'only'));

  const dom = initDom(jsdom, s);

  const { document } = dom.window;
  const page = createJsdomPage(dom);

  if (s.setupPage) {
    await s.setupPage(page as never);
  }

  let stepCaseIndex = 0;
  for (let stepIndex = 0; stepIndex < steps.length; ++stepIndex) {
    const step = steps[stepIndex];

    if (step.setupPage) {
      await step.setupPage(page as never);
    }

    for (let caseIndex = 0; caseIndex < step.cases.length; ++caseIndex) {
      const c = step.cases[caseIndex];
      if (hasOnlyCases && c.status !== 'only') continue;
      if (c.browsers?.length) continue;
      if (c.engines?.length) continue;

      const info: CaseInfo = {
        scenario: s, case: c,
        stepIndex, caseIndex, stepCaseIndex,
      };

      try {
        runCase(document, info, STACK_TRACE);
      } catch (err) {
        throw new Error(`${formatCaseHeader(info)}\n${thrownMessage(err, STACK_TRACE)}`);
      }

      stepCaseIndex++;
    }
  }
}

function getDescribeFn(status: ScenariosStatus) {
  if (status === 'skip') return describe.skip;
  if (status === 'only') return describe.only;
  return describe;
}

function getTestFn(status: Scenario['status']) {
  if (status === 'skip' || status === 'fixme' || status === 'fail') return test.skip;
  if (status === 'only') return test.only;
  return test;
}

function scenarioHas(s: Scenario, status: 'only' | 'fixme'): boolean {
  return s.status === status ||
    !!s.cases?.some((c) => c.status === status) ||
    !!s.steps?.some((step) => step.cases.some((c) => c.status === status));
}

function getScenarioSkipReason(s: Scenario): string | null {
  if (s.status === 'skip') return 'scenario marked skip';
  if (s.status === 'fixme') return 'scenario marked fixme';
  if (s.status === 'fail') return 'scenario marked fail';
  if (s.browsers?.length) return 'browser-specific scenario';
  if (s.engines?.length) return 'engine-specific scenario';
  return null;
}

type ScenarioLike = { url?: string; markup: string; markupMode?: MarkupMode; };
export function initDom(jsdom: JsdomCtor, scenario: ScenarioLike): JsdomInst {
  const opts = {
    runScripts: 'outside-only' as const,
    url: scenario.url ?? 'https://test.local/',
  };

  let dom: JsdomInst;

  if (scenario.markupMode === 'xml-document') {
    dom = new jsdom(scenario.markup, {
      ...opts,
      contentType: 'text/xml',
    });
  } else if (scenario.markupMode === 'html-document') {
    const hasHtml = /<html[\s>]/i.test(scenario.markup.trim());
    if (!hasHtml) {
      throw new Error(`markupMode="html-document" requires full HTML document markup including <html>`);
    }
    dom = new jsdom(scenario.markup, opts);
  } else {
    dom = new jsdom(`<!doctype html><html><body>${scenario.markup}</body></html>`, opts);
  }

  installSelectletShim(dom.window);
  patchIframeSrcdoc(dom.window.document);
  hydrateIframeSrcdocs(dom.window.document);
  hydrateDeclarativeShadowRoots(dom.window.document);
  patchComputedStyleForWindow(dom.window);

  return dom;
}
