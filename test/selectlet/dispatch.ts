import type * as BrowserScenarios from '../harness/browser/scenarios';
import { runScenarios as runBrowserScenarios } from '../harness/browser/scenarios';
import { getDomletScenarios } from './domlet/harness/registry';

type Harness = 'browser' | 'domlet';
type ScenarioModule = typeof BrowserScenarios;
type RunScenariosArgs = Parameters<ScenarioModule['runScenarios']>;
type RunScenariosReturn = ReturnType<ScenarioModule['runScenarios']>;

function getHarness(): Harness {
  const raw = process.env.HARNESS ?? 'browser';

  if (raw === 'browser' || raw === 'domlet') return raw;

  throw new Error(
    `Unknown HARNESS '${raw}'. Expected 'browser' or 'domlet'.`,
  );
}

export function runScenarios(...args: RunScenariosArgs): RunScenariosReturn {
  const harness = getHarness();

  if (harness === 'domlet') {
    return getDomletScenarios().runScenarios(...args);
  }

  return runBrowserScenarios(...args);
}
