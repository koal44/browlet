import type * as BrowserScenarios from '../harness/browser/scenarios';
import { runScenarios as runBrowserScenarios } from '../harness/browser/scenarios';
import { getDomletScenarios } from './domlet/harness/registry';
import { getJsdomScenarios } from './jsdom/harness/registry';

type Harness = 'browser' | 'domlet' | 'jsdom';
type ScenarioModule = typeof BrowserScenarios;
type RunScenariosArgs = Parameters<ScenarioModule['runScenarios']>;
type RunScenariosReturn = ReturnType<ScenarioModule['runScenarios']>;

function getHarness(): Harness {
  const raw = process.env.HARNESS ?? 'browser';

  if (raw === 'browser' || raw === 'domlet' || raw === 'jsdom') return raw;

  throw new Error(
    `Unknown HARNESS '${raw}'. Expected 'browser', 'domlet', or 'jsdom'.`,
  );
}

export function runScenarios(...args: RunScenariosArgs): RunScenariosReturn {
  const harness = getHarness();

  if (harness === 'jsdom') {
    return getJsdomScenarios().runScenarios(...args);
  }

  if (harness === 'domlet') {
    return getDomletScenarios().runScenarios(...args);
  }

  return runBrowserScenarios(...args);
}
