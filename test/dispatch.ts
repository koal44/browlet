import type * as BrowserScenarios from './browser/harness/scenarios';
import { runScenarios as runBrowserScenarios } from './browser/harness/scenarios';
import { getJsdomScenarios } from './jsdom/harness/registry';

type Harness = 'browser' | 'jsdom';
type ScenarioModule = typeof BrowserScenarios;
type RunScenariosArgs = Parameters<ScenarioModule['runScenarios']>;
type RunScenariosReturn = ReturnType<ScenarioModule['runScenarios']>;

function getHarness(): Harness {
  const raw = process.env.HARNESS ?? 'browser';

  if (raw === 'browser' || raw === 'jsdom') return raw;

  throw new Error(`Unknown HARNESS '${raw}'. Expected 'browser' or 'jsdom'.`);
}

export function runScenarios(...args: RunScenariosArgs): RunScenariosReturn {
  const harness = getHarness();

  if (harness === 'jsdom') {
    return getJsdomScenarios().runScenarios(...args);
  }

  return runBrowserScenarios(...args);
}
